import {
  adicionarVersao,
  aplicarEdicao,
  CODIGOS_PARA_REFAZER,
  ehParadaNoReserva,
  faixaDePalavras,
  frasesPorPapel,
  guardarNoHistorico,
  PAPEIS,
  palavrasDoRoteiro,
  proximaVersao,
  roteiroAtual,
  roteiroDaIa,
  roteiroDaIaSchema,
  secaoDaIaSchema,
  semAcentos,
  trocarSecao,
  validarRoteiro,
  type AlvoSec,
  type ContextoDaVersao,
  type PapelDaSecao,
  type ParadoNoReserva,
  type PedidoDeRoteiro,
  type ProblemaDoRoteiro,
  type ProgressoDoRoteiro,
  type RascunhoDoRecap,
  type Roteiro,
  type RoteiroGerado,
} from '../../shared/roteiro'
import type { EpisodeIndex } from '../../shared/episodio'
import type { PedidoJson } from '../../../../electron/services/llm'
import type { z } from 'zod'
import { blocoDoEstilo, estimarTokens } from '../../shared/estilo'
import { modeloGeminiProDe } from '../../shared/config'
import {
  ESCRITORES,
  estimarCusto,
  ehPerguntaDeCusto,
  tokensDeSaida,
  type Escritor,
  type PerguntaDeCusto,
} from '../../shared/escritor'
import { configDoRecap, contexto } from '../contexto'
import { gerarEventos } from './eventos'
import { lerEstilo } from './estilo'
import { umaFrasePorItem, umaFrasePorItemDaSecao } from './frases'
import { estaNoCache, gerarComCache, nomeDoProvedor, paradaDoPasso } from './ia'
import { acertarNomesDaSecao, acertarNomesDoRoteiro, elencoDoEpisodio, nomesDoElenco, type Elenco } from './nomes'
import { frasesDoAlvo, promptDaSecao, promptDoRoteiro, SISTEMA_ROTEIRO, SISTEMA_SECAO } from './prompts'
import { gravarRascunho, indiceDoRascunho, lerRascunhoDoDisco } from './rascunho'
import { ritmoDoRascunho } from '../voz/ritmo'

/**
 * Passo 2b: o ROTEIRO do short em PT-BR falado, em secoes com papel.
 *
 * - `pedido.base` presente: grava antes com aplicarEdicao (a tela pode ter
 *   edicao ainda nao gravada);
 * - sem eventos no rascunho: roda gerarEventos primeiro;
 * - SEM `secaoId` ("Outra versao" ou a primeira): o roteiro inteiro. Para a
 *   versao nova sair diferente, o prompt leva os ganchos das versoes
 *   anteriores; e, havendo versao anterior, o cache NAO e lido (so gravado) --
 *   pedir outra tomada e pedir outra resposta;
 * - COM `secaoId` ("Refazer esta parte"): so a secao, com o roteiro atual
 *   inteiro no prompt para manter a costura; trocarSecao monta a versao nova,
 *   derivada da atual. Tambem nao le o cache;
 * - uma nova tentativa no maximo, levando a resposta anterior e o MOTIVO para
 *   ajustar em vez de recomecar: `erro` (validarRoteiro) na parte que importa,
 *   tamanho fora da faixa (dito em frases por secao, com os eventos fortes que
 *   ficaram de fora), gancho igual ao de uma versao anterior, ou termo que o
 *   prompt veta (CODIGOS_PARA_REFAZER). Erro de novo = Error para a tela; o
 *   resto de novo = fica a melhor das duas, com o aviso;
 * - so entra no cache a resposta que passou do `erro` (ver ia.ts);
 * - item com duas frases vira dois (frases.ts): um ponto final, uma cena;
 * - CANCELAR (cancelarRoteiro): a resposta que chega depois entra so no
 *   historico (guardarNoHistorico), sem trocar a versao da tela nem tirar a
 *   aprovacao;
 * - o rascunho e relido na hora de gravar (ver rascunho.ts);
 * - MODELO RESERVA: sem `pedido.aceitouReserva`, eventos e roteiro pedem com
 *   `permitirReserva: false`. So sobrou reserva = devolve ParadoNoReserva sem
 *   gravar versao (a atual e a aprovacao ficam como estavam) e a tela
 *   pergunta. Na segunda tentativa, se ja ha uma resposta boa, fica ela.
 *
 * Lote 1 das ideias do Levi (17/10):
 * - MEU ESTILO: o bloco do estilo (shared/estilo.ts, nomes dos exemplos
 *   mascarados, teto de tokens) vai no fim do prompt do roteiro inteiro e do
 *   "Refazer esta parte". Sem estilo, o prompt e o de sempre;
 * - ESCRITOR PAGO (shared/escritor.ts): com Claude Sonnet ou Gemini Pro na
 *   config, SO a escrita vai forcada para ele (os eventos ficam no padrao).
 *   Antes de cada chamada paga: resposta no cache = de graca; senao a conta
 *   tem que caber no `custoAceito` do pedido -- sem ele, volta a
 *   PerguntaDeCusto sem chamar; a segunda tentativa que nao cabe nao acontece
 *   (fica a primeira). Pago le o cache SEMPRE: o mesmo pedido nunca paga duas
 *   vezes. Sem a chave do provedor: escreve o gratis, com aviso.
 */

/** Um pedido de roteiro por rascunho de cada vez: rascunhoId -> pedidoId ('' = sem id). */
const emAndamento = new Map<string, string>()
/** Rascunhos cujo pedido em andamento a tela cancelou. */
const cancelados = new Set<string>()

function agora(): string {
  return new Date().toISOString()
}

/**
 * A tela cancelou o pedido `pedidoId`: a resposta, quando chegar, vai so para
 * o historico. A chamada a IA nao tem como ser abortada; o que muda e o
 * destino. false = esse pedido ja terminou (ou nunca existiu).
 */
export function cancelarRoteiro(rascunhoId: string, pedidoId: string): boolean {
  if (!pedidoId || emAndamento.get(rascunhoId) !== pedidoId) return false
  cancelados.add(rascunhoId)
  return true
}

/**
 * A vez do pedido de IA do rascunho, para quem nao e o gerarRoteiro: o
 * religar do modo Texto (religar.ts) divide com ele a regra de um pedido por
 * rascunho e o Cancelar (cancelarRoteiro vale para os dois). `cancelado()`
 * diz se a tela ja desistiu DESTE pedido.
 */
export async function naVezDoRoteiro<T>(
  rascunhoId: string,
  pedidoId: string | null | undefined,
  fazer: (cancelado: () => boolean) => Promise<T>,
): Promise<T> {
  if (emAndamento.has(rascunhoId)) throw new Error('Ja estou escrevendo este roteiro. Espere terminar.')
  emAndamento.set(rascunhoId, pedidoId?.trim() || '')
  cancelados.delete(rascunhoId)
  try {
    return await fazer(() => cancelados.has(rascunhoId))
  } finally {
    emAndamento.delete(rascunhoId)
    cancelados.delete(rascunhoId)
  }
}

export async function gerarRoteiro(
  rascunhoId: string,
  pedido: PedidoDeRoteiro,
  avisar: (progresso: ProgressoDoRoteiro) => void,
): Promise<RoteiroGerado> {
  if (emAndamento.has(rascunhoId)) throw new Error('Ja estou escrevendo este roteiro. Espere terminar.')
  emAndamento.set(rascunhoId, pedido.pedidoId?.trim() || '')
  cancelados.delete(rascunhoId)
  try {
    return await gerar(rascunhoId, pedido, avisar)
  } finally {
    emAndamento.delete(rascunhoId)
    cancelados.delete(rascunhoId)
  }
}

interface Candidato {
  roteiro: Roteiro
  reparos: string[]
  palavras: number
  /** Quanto pior, maior: gancho repetido, termo vetado, distancia do alvo. A menor fica. */
  nota: number
}

interface Contexto {
  rascunhoId: string
  r: RascunhoDoRecap
  indice: EpisodeIndex
  elenco: Elenco
  alvoSec: AlvoSec
  /**
   * Palavras por segundo da voz que vai narrar (o take atual, ou a voz padrao
   * na velocidade nativa do perfil): o alvo, o minimo de 92% e o numero de
   * frases do prompt sao no ritmo DELA (shared/ritmo.ts).
   */
  ritmo: number
  instrucao: string | null
  /** O usuario aceitou o modelo reserva para este pedido. */
  permitirReserva: boolean
  avisar: (progresso: ProgressoDoRoteiro) => void
  /** O bloco do "Meu estilo" (null = sem estilo: o prompt de sempre). */
  estilo: string | null
  escritor: EscritorDoPedido
  /** O teto em US$ que ele aceitou (escritor pago). */
  custoAceito: number | undefined
  /** O que este pedido ja gastou (estimado), no pago. */
  conta: { gasto: number }
}

/** Quem escreve este pedido (configDoRecap().escritor, ja conferida a chave). */
interface EscritorDoPedido {
  id: Escritor
  rotulo: string
  pago: boolean
  provedor?: 'gemini' | 'anthropic'
  modelo?: string
}

function escritorDoPedido(avisos: string[]): EscritorDoPedido {
  const c = configDoRecap()
  const d = ESCRITORES[c.escritor]
  const gratis: EscritorDoPedido = { id: 'gemini', rotulo: ESCRITORES.gemini.rotulo, pago: false }
  if (d.provedor === null) return gratis
  if (contexto().ia.provedor(d.provedor) === null) {
    avisos.push(`${d.rotulo} sem chave: escrito pelo gratis.`)
    return gratis
  }
  const modelo = c.escritor === 'gemini-pro' ? modeloGeminiProDe(c) : d.modelo!
  return { id: c.escritor, rotulo: d.rotulo, pago: true, provedor: d.provedor, modelo }
}

/** O pedido de IA com o escritor forcado (so no pago). */
function comEscritor<S extends z.ZodType>(pedido: PedidoJson<S>, e: EscritorDoPedido): PedidoJson<S> {
  return e.pago ? { ...pedido, provedor: e.provedor!, modelo: e.modelo! } : pedido
}

/**
 * A porta do pago: 'ok' = pode chamar (cache, gratis, ou cabe no aceito, e a
 * conta soma); a pergunta = a primeira chamada precisa do sim dele; 'parar' =
 * a chamada extra nao cabe no que ele aceitou (fica a resposta que ja tem).
 */
function portaDoCusto(c: Contexto, pedido: PedidoJson<z.ZodType>, frases: number, primeira: boolean): 'ok' | 'parar' | PerguntaDeCusto {
  if (!c.escritor.pago || estaNoCache(pedido)) return 'ok'
  const est = estimarCusto(c.escritor.id, c.escritor.modelo!, pedido.sistema.length + pedido.prompt.length, tokensDeSaida(frases))
  if (c.custoAceito !== undefined && c.conta.gasto + est.usd <= c.custoAceito + 1e-9) {
    c.conta.gasto += est.usd
    console.log(`[gerar:${pedido.etapa}] ${c.escritor.rotulo} (${c.escritor.modelo}): ~US$ ${est.usd.toFixed(3)} (${est.tokensDeEntrada} + ${est.tokensDeSaida} tokens)`)
    return 'ok'
  }
  return primeira ? { motivo: 'custo', estimativa: est } : 'parar'
}

/** O que escreverInteiro e refazerSecao devolvem quando deu certo. */
interface Feito {
  candidato: Candidato
  doCache: boolean
}

async function gerar(
  rascunhoId: string,
  pedido: PedidoDeRoteiro,
  avisar: (progresso: ProgressoDoRoteiro) => void,
): Promise<RoteiroGerado> {
  let r = lerRascunhoDoDisco(rascunhoId)
  if (pedido.base && roteiroAtual(r)) {
    const editado = aplicarEdicao(r, pedido.base, agora())
    if (editado !== r) {
      gravarRascunho(editado)
      r = editado
    }
  }

  let doCache = true
  const avisos: string[] = []
  const permitirReserva = pedido.aceitouReserva === true
  if (r.eventos.length === 0) {
    const ev = await gerarEventos(rascunhoId, avisar, { permitirReserva })
    if (ehParadaNoReserva(ev)) return ev
    doCache = ev.doCache
    avisos.push(...ev.avisos)
    r = lerRascunhoDoDisco(rascunhoId)
  }

  const { indice } = indiceDoRascunho(r)
  const elenco = elencoDoEpisodio(indice)
  const escritor = escritorDoPedido(avisos)
  const ctx: Contexto = {
    rascunhoId,
    r,
    indice,
    elenco,
    alvoSec: pedido.alvoSec,
    ritmo: ritmoDoRascunho(r).ritmo,
    instrucao: pedido.instrucao?.trim() || null,
    permitirReserva,
    avisar,
    estilo: blocoDoEstilo(lerEstilo(), nomesDoElenco(elenco)),
    escritor,
    custoAceito: pedido.custoAceito,
    conta: { gasto: 0 },
  }
  const secaoId = pedido.secaoId?.trim() || null
  const feito = secaoId ? await refazerSecao(ctx, secaoId) : await escreverInteiro(ctx)
  if (ehParadaNoReserva(feito) || ehPerguntaDeCusto(feito)) return feito
  doCache &&= feito.doCache

  // Relido agora: sem await daqui ate gravar. A versao ganha o numero livre do
  // rascunho DE AGORA (o autosave pode ter criado uma 'editado' no meio).
  const fresco = lerRascunhoDoDisco(rascunhoId)
  const quando = agora()
  const roteiro: Roteiro = { ...feito.candidato.roteiro, versao: proximaVersao(fresco), criadoEm: quando }
  const soNoHistorico = cancelados.has(rascunhoId) && fresco.atual !== null
  const rascunho = soNoHistorico ? guardarNoHistorico(fresco, roteiro, quando) : adicionarVersao(fresco, roteiro, quando)
  gravarRascunho(rascunho)

  avisos.push(...feito.candidato.reparos, ...resumirAvisos(validarRoteiro(roteiro, rascunho.eventos, indice, ctx.ritmo)))
  return { rascunho, roteiro, doCache, soNoHistorico, avisos, ...(escritor.pago ? { escritor: escritor.rotulo } : {}) }
}

/** Os avisos do validarRoteiro, um por tipo ("Sem evento (3x)"): a tela nao precisa de dez linhas iguais. */
function resumirAvisos(problemas: readonly ProblemaDoRoteiro[]): string[] {
  const porCodigo = new Map<string, { mensagem: string; n: number }>()
  for (const p of problemas) {
    if (p.nivel !== 'aviso') continue
    const g = porCodigo.get(p.codigo) ?? { mensagem: p.mensagem, n: 0 }
    g.n += 1
    porCodigo.set(p.codigo, g)
  }
  return [...porCodigo.values()].map((g) => (g.n > 1 ? `${g.mensagem} (${g.n}x)` : g.mensagem))
}

/** As palavras de um texto na forma de comparar (sem acento, minusculas). */
function palavras(texto: string): string[] {
  return semAcentos(texto).match(/[\p{L}\p{N}]+/gu) ?? []
}

/** Mesmo texto, ou quase: mais de 70% das palavras em comum (Jaccard). */
function parecido(a: string, b: string): boolean {
  const pa = new Set(palavras(a))
  const pb = new Set(palavras(b))
  if (pa.size === 0 || pb.size === 0) return false
  let comuns = 0
  for (const p of pa) if (pb.has(p)) comuns += 1
  return comuns / (pa.size + pb.size - comuns) > 0.7
}

/** A primeira frase de cada versao, sem repetir, com a versao onde apareceu primeiro. */
function primeirasFrases(r: RascunhoDoRecap): { versao: number; texto: string }[] {
  const vistas: { versao: number; texto: string }[] = []
  for (const rot of r.roteiros) {
    const texto = rot.secoes[0]?.frases[0]?.texto.trim()
    if (texto && !vistas.some((v) => v.texto === texto)) vistas.push({ versao: rot.versao, texto })
  }
  return vistas
}

function contextoDaVersao(c: Contexto, modelo: string, extra: Pick<ContextoDaVersao, 'pedido' | 'derivadoDe'>): ContextoDaVersao {
  return {
    eventos: c.r.eventos,
    indice: c.indice,
    alvoSec: c.alvoSec,
    modelo,
    // Provisorio: o numero de verdade sai na hora de gravar (proximaVersao do rascunho relido).
    versao: proximaVersao(c.r),
    agoraIso: agora(),
    ...extra,
  }
}

/** O papel como vai no recado ao modelo. */
const PAPEL_NO_RECADO: Record<PapelDaSecao, string> = {
  gancho: 'gancho',
  contexto: 'contexto',
  desenvolvimento: 'desenvolvimento',
  virada: 'virada',
  climax: 'clímax',
  fechamento: 'fechamento',
}

/**
 * O recado do tamanho, em FRASES por secao (o modelo nao conta palavras):
 * onde faltam ou sobram, e -- curto -- os eventos fortes que ficaram de fora.
 * Antes era so "alongue", e o de 90 s voltava com 196 de 224.
 */
function motivoDoTamanho(roteiro: Roteiro, palavrasNoTotal: number, c: Contexto): string {
  const faixa = faixaDePalavras(c.alvoSec, c.ritmo)
  const pedidas = frasesPorPapel(c.alvoSec, c.ritmo)
  const porPapel = new Map<PapelDaSecao, number>()
  for (const s of roteiro.secoes) porPapel.set(s.papel, (porPapel.get(s.papel) ?? 0) + s.frases.length)
  const frases = roteiro.secoes.reduce((n, s) => n + s.frases.length, 0)
  const curto = palavrasNoTotal < faixa.min
  const desvios = PAPEIS.flatMap((p) => {
    const tem = porPapel.get(p) ?? 0
    const quer = pedidas[p]
    // A virada e opcional: sem ela, as frases foram para o desenvolvimento.
    if (p === 'virada' && tem === 0) return []
    if (curto ? tem < quer : tem > quer) return [`${PAPEL_NO_RECADO[p]} (tem ${tem}, o pedido é ${quer})`]
    return []
  })
  let texto =
    `ela tinha ${palavrasNoTotal} palavras faladas em ${frases} frases, e o alvo é ${faixa.alvo} palavras ` +
    `(entre ${faixa.min} e ${faixa.max}), em umas ${frasesDoAlvo(c.alvoSec, c.ritmo)} frases. `
  // O numero de frases certo com frases longas tambem estoura: o lite do S4-37
  // devolveu 18 frases de ~13 palavras (233 para 60 s), e o recado so de
  // frases nao mexia nisso.
  const media = palavrasNoTotal / Math.max(1, frases)
  if (!curto && media > 11) {
    texto += `As frases estão longas (média de ${Math.round(media)} palavras; o certo é de 5 a 12, média 9): encurte CADA frase. `
  }
  if (curto && media < 7) {
    texto += `As frases estão curtas demais (média de ${Math.round(media)} palavras; o certo é média 9): junte detalhe do acontecimento em cada uma. `
  }
  if (curto) {
    texto += desvios.length > 0 ? `Faltam frases em: ${desvios.join('; ')}. ` : `Acrescente umas ${Math.ceil((faixa.alvo - palavrasNoTotal) / 9)} frases. `
    const usados = new Set(roteiro.secoes.flatMap((s) => s.frases.flatMap((f) => f.eventoIds)))
    const fora = c.r.eventos
      .filter((e) => !usados.has(e.id))
      .sort((a, b) => b.peso - a.peso || a.t0 - b.t0)
      .slice(0, 4)
      .map((e) => e.id)
    if (fora.length > 0) texto += `Acontecimentos fortes que ficaram de fora: ${fora.join(', ')}. `
    texto += 'Alongue com eles, um passo a mais da escalada ou da virada, sem encher linguiça.'
  } else {
    if (desvios.length > 0) texto += `Sobram frases em: ${desvios.join('; ')}. `
    texto += 'Encurte: corte detalhe secundário e personagem que não é crítico.'
  }
  return texto
}

/** O recado dos termos vetados: o que, e em qual frase. */
function motivoDosTermos(problemas: readonly ProblemaDoRoteiro[], roteiro: Pick<Roteiro, 'secoes'>): string {
  const frases = new Map(roteiro.secoes.flatMap((s) => s.frases.map((f) => [f.id, f.texto] as const)))
  const itens = problemas.map((p) => `${p.mensagem} em "${(p.fraseId && frases.get(p.fraseId)) || '?'}"`)
  return `algumas frases quebram as regras: ${itens.join('; ')}. Reescreva essas frases dentro das regras, sem perder a fidelidade.`
}

async function escreverInteiro(c: Contexto): Promise<Feito | ParadoNoReserva | PerguntaDeCusto> {
  const faixa = faixaDePalavras(c.alvoSec, c.ritmo)
  const quem = c.escritor.pago ? c.escritor.rotulo : nomeDoProvedor()
  const anteriores = primeirasFrases(c.r)
  const ganchos = anteriores.slice(-4).map((g) => g.texto)
  // Com versao anterior, e outra tomada: o cache so devolveria a de antes.
  const lerCache = c.r.roteiros.length === 0
  let ajuste: { anterior: Pick<Roteiro, 'secoes'>; motivo: string } | null = null
  let rotuloDoAjuste = 'Ajustando'
  let melhor: Candidato | null = null
  let doCache = true
  let ultimoErro = ''

  for (let tentativa = 0; tentativa < 2; tentativa++) {
    c.avisar({
      rascunhoId: c.rascunhoId,
      etapa: 'roteiro',
      mensagem: tentativa === 0 ? `${quem} · ate 2 min` : `${rotuloDoAjuste} · ${quem}`,
    })
    const pedidoIa = comEscritor(
      {
        schema: roteiroDaIaSchema,
        sistema: SISTEMA_ROTEIRO,
        prompt: promptDoRoteiro({
          indice: c.indice,
          eventos: c.r.eventos,
          alvoSec: c.alvoSec,
          ritmo: c.ritmo,
          elenco: c.elenco,
          instrucao: c.instrucao,
          ganchosAnteriores: ganchos,
          ajuste,
          estilo: c.estilo,
        }),
        etapa: 'roteiro',
        maxTokens: 8000,
        permitirReserva: c.permitirReserva,
      },
      c.escritor,
    )
    if (tentativa === 0 && c.estilo) {
      console.log(`[gerar:roteiro] prompt ~${estimarTokens(pedidoIa.sistema + pedidoIa.prompt)} tokens (estilo ~${estimarTokens(c.estilo)})`)
    }
    const porta = portaDoCusto(c, pedidoIa, frasesDoAlvo(c.alvoSec, c.ritmo), !melhor)
    if (porta === 'parar') break
    if (porta !== 'ok') return porta
    // Pago le o cache sempre: o mesmo pedido nunca paga duas vezes.
    const resposta = await gerarComCache(pedidoIa, { lerCache: lerCache || c.escritor.pago })
    if (!resposta.ok) {
      // A segunda tentativa falhou (cota, rede, so reserva livre): fica a
      // primeira, que ja serve -- melhor que perguntar por um ajuste.
      if (melhor) break
      if (resposta.motivo === 'so-reserva') return paradaDoPasso(resposta, 'roteiro')
      throw new Error(resposta.nota)
    }
    doCache &&= resposta.doCache

    const { roteiro, avisos: reparos } = roteiroDaIa(
      acertarNomesDoRoteiro(umaFrasePorItem(resposta.valor), c.elenco),
      contextoDaVersao(c, resposta.modelo, {
        pedido: { tipo: 'inteiro', secaoId: null, instrucao: c.instrucao },
        derivadoDe: null,
      }),
    )
    const problemas = validarRoteiro(roteiro, c.r.eventos, c.indice, c.ritmo)
    const erros = problemas.filter((p) => p.nivel === 'erro')
    if (erros.length > 0) {
      ultimoErro = erros[0]!.mensagem
      ajuste = {
        anterior: roteiro,
        motivo: `ela veio com problema de formato (${[...new Set(erros.map((e) => e.mensagem))].join('; ')}). Toda seção precisa de frases com texto.`,
      }
      rotuloDoAjuste = 'Pedindo de novo'
      continue
    }
    resposta.guardar()

    const palavrasNoTotal = palavrasDoRoteiro(roteiro)
    const dentro = palavrasNoTotal >= faixa.min && palavrasNoTotal <= faixa.max
    const primeira = roteiro.secoes[0]?.frases[0]?.texto ?? ''
    const repetido = anteriores.find((g) => parecido(g.texto, primeira)) ?? null
    const termos = problemas.filter((p) => CODIGOS_PARA_REFAZER.has(p.codigo))
    const nota = (repetido ? 1000 : 0) + termos.length * 50 + (dentro ? 0 : Math.abs(palavrasNoTotal - faixa.alvo))
    if (!melhor || nota < melhor.nota) melhor = { roteiro, reparos, palavras: palavrasNoTotal, nota }

    const motivos: string[] = []
    if (repetido) {
      motivos.push(
        `o gancho saiu igual ao da versão ${repetido.versao} ("${repetido.texto}"). Escreva OUTRO gancho, com outro acontecimento ou outro ângulo e outras palavras.`,
      )
    }
    if (!dentro) motivos.push(motivoDoTamanho(roteiro, palavrasNoTotal, c))
    if (termos.length > 0) motivos.push(motivoDosTermos(termos, roteiro))
    if (motivos.length === 0) break
    ajuste = { anterior: roteiro, motivo: motivos.join(' ') }
    rotuloDoAjuste = repetido ? 'Trocando o gancho' : !dentro ? 'Ajustando o tamanho' : 'Corrigindo termos'
  }
  if (!melhor) throw new Error(`A IA devolveu um roteiro com problema (${ultimoErro || 'sem frases'}). Tente de novo.`)
  return { candidato: melhor, doCache }
}

async function refazerSecao(c: Contexto, secaoId: string): Promise<Feito | ParadoNoReserva | PerguntaDeCusto> {
  const atual = roteiroAtual(c.r)
  if (!atual) throw new Error('Gere um roteiro antes de refazer uma parte.')
  const secao = atual.secoes.find((s) => s.id === secaoId)
  if (!secao) throw new Error('Essa parte nao existe mais nesta versao.')

  // A parte nova cobre o que falta para o alvo, sem fugir muito do tamanho de
  // hoje: "refazer" nao e "reescrever o roteiro dentro de uma secao".
  const faixa = faixaDePalavras(c.alvoSec, c.ritmo)
  const hoje = palavrasDoRoteiro({ secoes: [secao] })
  const outras = palavrasDoRoteiro(atual) - hoje
  const piso = Math.max(6, Math.round(hoje * 0.6))
  const teto = Math.max(piso, Math.round(hoje * 1.6), 12)
  const palavrasDaSecao = Math.min(teto, Math.max(piso, faixa.alvo - outras))

  const quem = c.escritor.pago ? c.escritor.rotulo : nomeDoProvedor()
  let aviso: string | null = null
  let doCache = true
  let melhor: { candidato: Candidato; ruins: number } | null = null
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    c.avisar({
      rascunhoId: c.rascunhoId,
      etapa: 'secao',
      mensagem: tentativa === 0 ? `${quem} · ate 1 min` : `Pedindo de novo · ${quem}`,
    })
    // Refazer e sempre outra tomada: nunca le o cache (voltar a mesma base com
    // a mesma instrucao devolvia a parte que o Levi acabou de recusar).
    const pedidoIa = comEscritor(
      {
        schema: secaoDaIaSchema,
        sistema: SISTEMA_SECAO,
        prompt: promptDaSecao({
          indice: c.indice,
          eventos: c.r.eventos,
          alvoSec: c.alvoSec,
          ritmo: c.ritmo,
          elenco: c.elenco,
          roteiro: atual,
          secaoId,
          palavrasDaSecao,
          instrucao: c.instrucao,
          aviso,
          estilo: c.estilo,
        }),
        etapa: 'secao',
        maxTokens: 4000,
        permitirReserva: c.permitirReserva,
      },
      c.escritor,
    )
    const porta = portaDoCusto(c, pedidoIa, Math.max(1, Math.round(palavrasDaSecao / 9.5)), !melhor)
    if (porta === 'parar') break
    if (porta !== 'ok') return porta
    // Pago le o cache sempre (o mesmo pedido nunca paga duas vezes); o gratis nunca, aqui.
    const resposta = await gerarComCache(pedidoIa, { lerCache: c.escritor.pago })
    if (!resposta.ok) {
      if (melhor) break
      if (resposta.motivo === 'so-reserva') return paradaDoPasso(resposta, 'secao')
      throw new Error(resposta.nota)
    }
    doCache &&= resposta.doCache

    let trocado: { roteiro: Roteiro; avisos: string[] }
    try {
      trocado = trocarSecao(
        atual,
        secaoId,
        acertarNomesDaSecao(umaFrasePorItemDaSecao(resposta.valor), c.elenco),
        contextoDaVersao(c, resposta.modelo, {
          pedido: { tipo: 'secao', secaoId, instrucao: c.instrucao },
          derivadoDe: atual.versao,
        }),
      )
    } catch {
      aviso = 'ela veio sem nenhuma frase com texto. Devolva as frases da seção.'
      continue
    }
    // So o que e DESTA parte: uma frase vazia que o Levi deixou em outra parte
    // barra a aprovacao, nao o "Refazer" (antes falhava sempre, gastando 2 chamadas).
    const daParte = validarRoteiro(trocado.roteiro, c.r.eventos, c.indice, c.ritmo).filter((p) => p.secaoId === secaoId)
    const erros = daParte.filter((p) => p.nivel === 'erro')
    if (erros.length > 0) {
      aviso = `ela veio com problema de formato (${[...new Set(erros.map((e) => e.mensagem))].join('; ')}).`
      continue
    }
    resposta.guardar()
    const ruins = daParte.filter((p) => CODIGOS_PARA_REFAZER.has(p.codigo) || p.codigo === 'repete-frase')
    const candidato: Candidato = {
      roteiro: trocado.roteiro,
      reparos: trocado.avisos,
      palavras: palavrasDoRoteiro(trocado.roteiro),
      nota: ruins.length,
    }
    if (!melhor || ruins.length < melhor.ruins) melhor = { candidato, ruins: ruins.length }
    if (ruins.length === 0) break
    aviso = motivoDosTermos(ruins, trocado.roteiro)
  }
  if (!melhor) throw new Error('A IA devolveu essa parte com problema. Tente de novo.')
  return { candidato: melhor.candidato, doCache }
}
