import {
  adicionarVersao,
  proximaVersao,
  roteiroAtual,
  textoDaParada,
  type RascunhoDoRecap,
  type Roteiro,
} from '../../shared/roteiro'
import {
  comRevisao,
  itensDaRevisao,
  marcasNaTela,
  revisaoDaIaSchema,
  revisaoDaVersao,
  roteiroRevisado,
  type Revisao,
  type RevisaoFeita,
} from '../../shared/revisao'
import type { EpisodeIndex } from '../../shared/episodio'
import { configDoRecap } from '../contexto'
import { lerEstilo } from './estilo'
import { gerarComCache } from './ia'
import { elencoDoEpisodio, nomesDoElenco, type Elenco } from './nomes'
import { blocoDosEventos, tituloDoEpisodio } from './prompts'
import { gravarRascunho, indiceDoRascunho, lerRascunhoDoDisco } from './rascunho'

/**
 * [recap] O REVISOR + "NAO ALUCINAR" do passo 2 (shared/revisao.ts): UMA
 * chamada, no provedor padrao (gratis no Gemini), depois de gerar. Com o free
 * tier sao 3 pedidos por roteiro: eventos + roteiro + revisao.
 *
 * - nunca trava: cota, rede, so o reserva livre -> `pulada: 'falhou'`, com a
 *   nota, e a tela so avisa. Nao usa o modelo reserva (o lite revisando
 *   erraria mais do que acharia);
 * - le o roteiro GRAVADO (a tela grava antes) e grava a revisao no rascunho
 *   RELIDO na hora (sem await entre ler e gravar, a regra do rascunho.ts);
 * - com cache: revisar de novo a mesma versao nao gasta;
 * - nao divide a vez do roteiro (naVezDoRoteiro): ele pode pedir "Outra
 *   versao" com a revisao no ar. Uma revisao por rascunho de cada vez.
 */

export const SISTEMA_REVISOR = `Você é o revisor de roteiros de shorts de anime. Você recebe os ACONTECIMENTOS de um episódio (cada um com as falas da legenda que o provam) e o ROTEIRO de um short, frase por frase, com os acontecimentos que cada frase cita. Você confere CADA frase contra as falas dos acontecimentos que ela cita e aponta o que está errado. Você NÃO reescreve o roteiro inteiro.

PARA CADA FRASE COM PROBLEMA, devolva:
- fraseId: o id da frase, copiado da lista (ex.: "f07").
- problema (o mais grave que ela tiver):
  "sem-prova" — a frase afirma um fato, nome, lugar, número, motivo, relação ou emoção que NÃO está nas falas nem no resumo dos acontecimentos citados (alucinação). O que você sabe da obra e não está nas falas também é sem prova.
  "contradiz" — as falas dizem outra coisa: vítima ou autor trocado; verbo escalado ("sugere" virou "convence", "pede" virou "enfrenta", "menciona" virou "revela"); HIPÓTESE dita como FATO ("maybe", "could", "I think", "what if" viraram certeza ou plano decidido); a IDEIA de um personagem dada a outro ou ao grupo (IDEIA TEM DONO); o que veio depois de um salto de tempo dito como simultâneo.
  "confusa" — "ele"/"ela" sem dono claro (a frase anterior tem outro sujeito, ou dois personagens), frase que o espectador não entende sozinha, ordem que confunde.
  "fraca" — genérica, sem informação nova, clichê, ou gancho que não prende quando o episódio tem algo mais forte.
  "repetida" — repete o fato ou as palavras de outra frase do roteiro.
- motivo: o porquê, curto (até 15 palavras), em português do Brasil; cite a fala quando ajudar.
- sugestao: a frase reescrita que resolve o problema — UMA frase só, no mesmo tom falado (português do Brasil, "pra", "tá") e no mesmo tamanho (5 a 12 palavras), sem inventar nada que as falas não sustentem: o fato errado sai ou vira o que as falas dizem. Mantenha os nomes como no ELENCO. null quando o certo é cortar a frase.

REGRAS:
- Frase de ligação, pergunta ao espectador e fechamento sem fato ("E agora?") não têm o que provar: só marque se forem confusas, fracas ou repetidas.
- Tom dramatizado ("e o pior", "caraca") não é problema; fato exagerado é.
- Na dúvida, NÃO marque. Marque só o que importa: no máximo 10 frases, as mais graves primeiro.
- Frase sem problema não entra na lista.`

export interface EntradaDoRevisor {
  indice: Pick<EpisodeIndex, 'anime' | 'temporada' | 'episodio' | 'kind' | 'cues' | 'exclusoes' | 'planos'>
  eventos: RascunhoDoRecap['eventos']
  elenco: Elenco
  roteiro: Pick<Roteiro, 'secoes'>
  /** As instrucoes do "Meu estilo" (so o texto dele, sem os exemplos): a sugestao segue o tom. */
  instrucoes?: string | null
}

export function promptDoRevisor(e: EntradaDoRevisor): string {
  // So os acontecimentos citados (com todas as falas deles); roteiro sem citacao nenhuma leva todos.
  const citados = new Set(e.roteiro.secoes.flatMap((s) => s.frases.flatMap((f) => f.eventoIds)))
  const eventos = citados.size > 0 ? e.eventos.filter((ev) => citados.has(ev.id)) : e.eventos
  const nomes = nomesDoElenco(e.elenco)
  const linhas = [
    `EPISÓDIO: ${tituloDoEpisodio(e.indice)}`,
    `ELENCO (grafia da legenda): ${nomes.length > 0 ? nomes.join(', ') : '(a legenda não traz nomes)'}`,
    '',
    'ACONTECIMENTOS CITADOS (id [início-fim] peso | personagens: resumo; embaixo, quem está em cena e as falas do trecho):',
    blocoDosEventos(eventos, e.indice, e.elenco),
    '',
  ]
  if (e.instrucoes?.trim()) linhas.push(`INSTRUÇÕES DO EDITOR (a sugestão segue o tom dele): ${e.instrucoes.trim()}`, '')
  linhas.push('ROTEIRO (id: frase (acontecimentos citados)):')
  for (const s of e.roteiro.secoes) {
    linhas.push(`[${s.id} · ${s.papel}]`)
    for (const f of s.frases) {
      const texto = f.texto.replace(/\s+/g, ' ').trim()
      linhas.push(`  ${f.id}: ${texto}${f.eventoIds.length > 0 ? ` (${f.eventoIds.join(', ')})` : ' (sem acontecimento)'}`)
    }
  }
  return linhas.join('\n')
}

const emRevisao = new Set<string>()

function agora(): string {
  return new Date().toISOString()
}

export async function revisarRoteiro(rascunhoId: string, automatico: boolean): Promise<RevisaoFeita> {
  if (automatico && !configDoRecap().revisarAoGerar) return { pulada: 'desligada', nota: 'Revisor desligado.' }
  if (emRevisao.has(rascunhoId)) throw new Error('Ja estou revisando este roteiro.')
  emRevisao.add(rascunhoId)
  try {
    return await revisar(rascunhoId)
  } finally {
    emRevisao.delete(rascunhoId)
  }
}

async function revisar(rascunhoId: string): Promise<RevisaoFeita> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const atual = roteiroAtual(r)
  if (!atual || !atual.secoes.some((s) => s.frases.some((f) => f.texto.trim()))) {
    return { pulada: 'falhou', nota: 'Sem roteiro para revisar.' }
  }
  if (r.eventos.length === 0) return { pulada: 'falhou', nota: 'Sem eventos: gere o roteiro antes.' }
  const { indice } = indiceDoRascunho(r)
  const resposta = await gerarComCache({
    schema: revisaoDaIaSchema,
    sistema: SISTEMA_REVISOR,
    prompt: promptDoRevisor({
      indice,
      eventos: r.eventos,
      elenco: elencoDoEpisodio(indice),
      roteiro: atual,
      instrucoes: lerEstilo().instrucoes,
    }),
    etapa: 'revisao',
    maxTokens: 4000,
    permitirReserva: false,
  })
  if (!resposta.ok) {
    const nota = resposta.motivo === 'so-reserva' ? textoDaParada(resposta) : resposta.nota
    console.log(`[gerar:revisao] pulada: ${resposta.bruto}`)
    return { pulada: 'falhou', nota }
  }
  resposta.guardar()
  const revisao: Revisao = { versao: atual.versao, criadoEm: agora(), modelo: resposta.modelo, itens: itensDaRevisao(resposta.valor, atual) }

  // Relido agora: sem await daqui ate gravar. A versao pode ter saido do historico no meio.
  const fresco = lerRascunhoDoDisco(rascunhoId)
  if (!fresco.roteiros.some((v) => v.versao === revisao.versao)) return { pulada: 'falhou', nota: 'A versao mudou durante a revisao.' }
  const final = comRevisao(fresco, revisao, agora())
  gravarRascunho(final)
  return { pulada: null, revisao, doCache: resposta.doCache, rascunho: final }
}

/** "Aplicar todas": versao nova a partir da atual, com as sugestoes das marcas que valem. */
export function aplicarRevisao(rascunhoId: string): RascunhoDoRecap {
  const r = lerRascunhoDoDisco(rascunhoId)
  const atual = roteiroAtual(r)
  if (!atual) throw new Error('Nao ha roteiro.')
  const revisao = revisaoDaVersao(r, atual.versao)
  const quando = agora()
  const novo = roteiroRevisado(atual, marcasNaTela(revisao, atual), {
    versao: proximaVersao(r),
    agoraIso: quando,
    modelo: revisao?.modelo ?? atual.modelo,
  })
  if (!novo) throw new Error('Nada para aplicar: nenhuma marca com sugestao.')
  const final = adicionarVersao(r, novo, quando)
  gravarRascunho(final)
  return final
}

/** "Ignorar": as marcas dessas frases somem (na revisao que vale para a versao atual). */
export function ignorarRevisao(rascunhoId: string, fraseIds: readonly string[]): RascunhoDoRecap {
  const r = lerRascunhoDoDisco(rascunhoId)
  const atual = roteiroAtual(r)
  const revisao = atual ? revisaoDaVersao(r, atual.versao) : null
  if (!revisao) return r
  const tirar = new Set(fraseIds)
  if (!revisao.itens.some((i) => tirar.has(i.fraseId) && !i.ignorado)) return r
  const final = comRevisao(r, { ...revisao, itens: revisao.itens.map((i) => (tirar.has(i.fraseId) ? { ...i, ignorado: true } : i)) }, agora())
  gravarRascunho(final)
  return final
}
