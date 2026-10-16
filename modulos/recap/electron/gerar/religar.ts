import {
  adicionarVersao,
  aplicarEdicao,
  aplicarReligacao,
  ehParadaNoReserva,
  frasesParaReligar,
  mesmoConteudo,
  mesmoTextoDoRoteiro,
  proximaVersao,
  redividirRoteiro,
  religacaoDaIaSchema,
  roteiroAtual,
  textoDoRoteiro,
  type FraseRedividida,
  type PedidoDeReligar,
  type ProgressoDoRoteiro,
  type RascunhoDoRecap,
  type Roteiro,
  type RoteiroReligado,
  type RoteiroReligadoPronto,
} from '../../shared/roteiro'
import { cenasDepoisDaRedivisao } from '../../shared/cenas'
import { gerarEventos } from './eventos'
import { gerarComCache, nomeDoProvedor, paradaDoPasso } from './ia'
import { elencoDoEpisodio } from './nomes'
import { promptDoReligar, SISTEMA_RELIGAR } from './prompt-religar'
import { gravarRascunho, indiceDoRascunho, lerRascunhoDoDisco } from './rascunho'
import { naVezDoRoteiro } from './roteiro'

/**
 * O MODO TEXTO e o "USAR MEU ROTEIRO" do passo 2, no main.
 *
 * Em duas fases, para o texto do Levi nunca depender da IA:
 * 1. O TEXTO VAI PARA O DISCO, sem await no meio (a regra do rascunho.ts):
 *    - 'editar' (sair do modo Texto): redividirRoteiro contra a versao atual
 *      (cada ponto final = uma frase; a igual ou parecida mantem id e
 *      vinculos, a nova nasce sem vinculo) e aplicarEdicao (versao 'editado',
 *      desaprova). Texto igual ao da atual (so espaco mudou) nao re-divide;
 *    - 'meu-roteiro' (colado): tudo 'nova', partes s1.. com papel pela
 *      posicao, numa versao 'editado' NOVA -- tambem sem roteiro nenhum ainda
 *      (o aplicarEdicao exige um). Colar o mesmo texto de novo (o "Usar modelo
 *      reserva" refaz o pedido) nao cria outra versao;
 *    - as escolhas de cena das frases mantidas seguem (cenasDepoisDaRedivisao).
 * 2. AS FRASES SEM VINCULO SAO LIGADAS aos eventos com UMA chamada em lote
 *    (gerarComCache: cache, permitirReserva so com o aceite da tela; etapa
 *    'religar'). Sem eventos ainda (roteiro colado antes de a IA ler o
 *    episodio), os eventos vem antes. Quem e "sem vinculo" e precisaReligar
 *    (sem evento e sem intencao visual): uma ligacao que nao terminou --
 *    cancelada, sem cota, so reserva livre -- deixa as frases assim no disco,
 *    e a proxima religacao (o "Ligar N frases" da tela) completa. A resposta
 *    entra no rascunho RELIDO, so nas frases que continuam por ligar com o
 *    mesmo texto, e troca a versao no lugar (aplicarEdicao).
 *
 * Cancelar (cancelarRoteiro, a vez e dividida com o gerarRoteiro por
 * naVezDoRoteiro): a resposta que chega depois nao e aplicada -- a tela ja e
 * dele -- mas fica no cache, e a proxima religacao do mesmo texto e de graca.
 */

function agora(): string {
  return new Date().toISOString()
}

export async function religarRoteiro(
  rascunhoId: string,
  pedido: PedidoDeReligar,
  progresso: (p: ProgressoDoRoteiro) => void,
): Promise<RoteiroReligado> {
  return naVezDoRoteiro(rascunhoId, pedido.pedidoId, (cancelado) => religar(rascunhoId, pedido, progresso, cancelado))
}

/** Todas 'igual' (o texto nao mudou): o casamento que a tela recebe quando nada foi re-dividido. */
function todasIguais(roteiro: Pick<Roteiro, 'secoes'>): FraseRedividida[] {
  return roteiro.secoes.flatMap((s) => s.frases.map((f) => ({ id: f.id, destino: 'igual' as const, deId: f.id, similaridade: 1 })))
}

/**
 * Fase 1: o texto da tela -> o rascunho com a versao nova (ainda sem as
 * ligacoes). Pura sobre `r`; quem grava e quem chama. Lanca com recado para a
 * tela (texto vazio, sem roteiro para editar).
 */
export function rascunhoComOTexto(
  r: RascunhoDoRecap,
  pedido: PedidoDeReligar,
  quando: string,
): { rascunho: RascunhoDoRecap; frases: FraseRedividida[] } {
  const atual = roteiroAtual(r)
  // O mesmo texto da versao atual: nada a re-dividir (nem a colar de novo).
  if (atual && mesmoTextoDoRoteiro(pedido.texto, textoDoRoteiro(atual))) return { rascunho: r, frases: todasIguais(atual) }

  if (pedido.modo === 'editar') {
    if (!atual) throw new Error('Gere um roteiro antes de editar em texto.')
    const redivisao = redividirRoteiro(atual, pedido.texto)
    if (redivisao.secoes.length === 0) throw new Error('O roteiro ficou vazio.')
    const editado = aplicarEdicao(
      r,
      {
        secoes: redivisao.secoes,
        alvoSec: pedido.alvoSec ?? atual.alvoSec,
        ...(pedido.versao !== undefined ? { versao: pedido.versao } : {}),
        ...(pedido.criadoEm !== undefined ? { criadoEm: pedido.criadoEm } : {}),
      },
      quando,
    )
    if (editado === r) return { rascunho: r, frases: redivisao.frases }
    return { rascunho: { ...editado, cenas: cenasDepoisDaRedivisao(r.cenas, redivisao) }, frases: redivisao.frases }
  }

  // "Usar meu roteiro": tudo novo, os ids antigos reservados, versao nova no historico.
  const redivisao = redividirRoteiro(atual ?? { secoes: [] }, pedido.texto, { casar: false })
  if (redivisao.secoes.length === 0) throw new Error('O roteiro ficou vazio.')
  const colado: Roteiro = {
    versao: proximaVersao(r),
    alvoSec: pedido.alvoSec ?? r.alvoSec,
    secoes: redivisao.secoes,
    // Ninguem escreveu: o modelo fica vazio (a tela nao marca "Modelo reserva").
    modelo: '',
    criadoEm: quando,
    origem: 'editado',
    derivadoDe: null,
    pedido: null,
  }
  const novo = adicionarVersao(r, colado, quando)
  return { rascunho: { ...novo, cenas: cenasDepoisDaRedivisao(r.cenas, redivisao) }, frases: redivisao.frases }
}

async function religar(
  rascunhoId: string,
  pedido: PedidoDeReligar,
  avisar: (p: ProgressoDoRoteiro) => void,
  cancelado: () => boolean,
): Promise<RoteiroReligado> {
  // Fase 1: ler -> aplicar -> gravar, sem await no meio.
  const lido = lerRascunhoDoDisco(rascunhoId)
  const fase1 = rascunhoComOTexto(lido, pedido, agora())
  if (fase1.rascunho !== lido) gravarRascunho(fase1.rascunho)

  let r = fase1.rascunho
  const roteiro1 = roteiroAtual(r)!
  const alvo = frasesParaReligar(roteiro1)
  const avisos: string[] = []
  let doCache = true
  const pronto = (rascunho: RascunhoDoRecap, religadas: string[] = []): RoteiroReligadoPronto => {
    const roteiro = roteiroAtual(rascunho)!
    const porLigar = new Set(alvo)
    const semEvento = roteiro.secoes.flatMap((s) => s.frases.filter((f) => porLigar.has(f.id) && f.eventoIds.length === 0).map((f) => f.id))
    return { rascunho, roteiro, frases: fase1.frases, religadas, semEvento, doCache: doCache && alvo.length > 0, avisos }
  }
  if (alvo.length === 0) return pronto(r)

  // Fase 2: ligar. Sem eventos ainda (roteiro colado antes da leitura do episodio), eles vem antes.
  const permitirReserva = pedido.aceitouReserva === true
  if (r.eventos.length === 0) {
    const ev = await gerarEventos(rascunhoId, avisar, { permitirReserva })
    if (ehParadaNoReserva(ev)) return ev
    doCache = ev.doCache
    avisos.push(...ev.avisos)
    r = lerRascunhoDoDisco(rascunhoId)
    if (cancelado()) return pronto(r)
  }

  const { indice } = indiceDoRascunho(r)
  avisar({ rascunhoId, etapa: 'religar', mensagem: `${nomeDoProvedor()} · ate 1 min` })
  const resposta = await gerarComCache({
    schema: religacaoDaIaSchema,
    sistema: SISTEMA_RELIGAR,
    prompt: promptDoReligar({ indice, eventos: r.eventos, elenco: elencoDoEpisodio(indice), roteiro: roteiro1, alvo }),
    etapa: 'religar',
    maxTokens: 4000,
    permitirReserva,
  })
  if (!resposta.ok) {
    // O texto ja esta no disco (fase 1): so a ligacao ficou para depois.
    if (resposta.motivo === 'so-reserva') return paradaDoPasso(resposta, 'religar')
    throw new Error(resposta.nota)
  }
  doCache &&= resposta.doCache

  // Relido agora: sem await daqui ate gravar.
  const fresco = lerRascunhoDoDisco(rascunhoId)
  const atual = roteiroAtual(fresco)
  // So as que continuam por ligar, com o MESMO texto que foi no prompt.
  const textoNoPrompt = new Map(roteiro1.secoes.flatMap((s) => s.frases.map((f) => [f.id, f.texto] as const)))
  const aindaPorLigar = new Set(atual ? frasesParaReligar(atual) : [])
  const alvoAgora = atual
    ? atual.secoes.flatMap((s) => s.frases.filter((f) => aindaPorLigar.has(f.id) && textoNoPrompt.get(f.id) === f.texto).map((f) => f.id))
    : []
  const religacao = atual
    ? aplicarReligacao(atual, resposta.valor, alvoAgora, { eventos: fresco.eventos, indice })
    : null
  // Resposta que falou de alguma frase pedida e boa: fica no cache (mesmo cancelada).
  const respondeu = aplicarReligacao(roteiro1, resposta.valor, alvo, { eventos: fresco.eventos, indice }).respondidas > 0
  if (respondeu) resposta.guardar()
  if (cancelado() || !atual || !religacao) return pronto(fresco)

  avisos.push(...religacao.avisos)
  if (mesmoConteudo(atual, { secoes: religacao.secoes, alvoSec: atual.alvoSec })) return pronto(fresco)
  const final = aplicarEdicao(
    fresco,
    { secoes: religacao.secoes, alvoSec: atual.alvoSec, versao: atual.versao, criadoEm: atual.criadoEm },
    agora(),
  )
  gravarRascunho(final)
  return pronto(final, religacao.religadas)
}
