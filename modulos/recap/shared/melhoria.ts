import type { EpisodeIndex } from './episodio'
import type { MelhoriaDaIa } from './revisao'
import {
  contarPalavras,
  dividirEmFrases,
  idsDeFrase,
  palavrasDoRoteiro,
  proximoId,
  semAcentos,
  validarRoteiro,
  type CodigoDoProblema,
  type Evento,
  type Frase,
  type OpcoesDaValidacao,
  type Roteiro,
  type Secao,
} from './roteiro'

/**
 * [recap, A2] O "MELHORAR TEXTO" do revisor, a parte pura (o pedido mora em
 * electron/gerar/revisor.ts): a resposta da IA vira TROCAS de frase, as trocas
 * passam pela mesma conferencia de prova (sem outro pedido) e viram a versao
 * 'Melhorada'.
 *
 * A troca e frase por frase, pelo id: a frase melhorada mantem os eventos, o
 * momento, a intencao visual e as dicas das cenas -- a voz e as cenas seguem
 * pelo id, como no religar. Uma frase pode virar DUAS curtas (o ponto final e
 * a cena): a segunda ganha id novo com os mesmos vinculos.
 */

/** Uma troca do "Melhorar texto". */
export interface TrocaDaMelhoria {
  fraseId: string
  /** O texto de hoje. */
  antes: string
  /** As frases novas: uma, ou duas curtas. */
  textos: string[]
  motivo: string
}

/** Quantas frases o "Melhorar texto" troca, no maximo. */
export const MELHORIAS_MAX = 14

/** Uma linha, sem aspas de enfeite em volta, com ponto no fim. */
function linhaLimpa(s: string): string {
  const t = s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“]|["”]$/g, '')
    .trim()
  return !t || /[.!?…]$/.test(t) ? t : `${t}.`
}

/**
 * A resposta -> as trocas: so frase que existe, uma vez, com texto novo
 * diferente do de hoje, de 1 ou 2 frases (3 ou mais = a IA reescreveu demais:
 * fica a de hoje), no maximo MELHORIAS_MAX, na ordem do roteiro.
 */
export function trocasDaMelhoria(bruto: MelhoriaDaIa, roteiro: Pick<Roteiro, 'secoes'>): TrocaDaMelhoria[] {
  const ordem = roteiro.secoes.flatMap((s) => s.frases.map((f) => f.id))
  const textos = new Map(roteiro.secoes.flatMap((s) => s.frases.map((f) => [f.id, f.texto] as const)))
  const porId = new Map<string, TrocaDaMelhoria>()
  for (const item of bruto.frases) {
    const id = /f\d{2,}/.exec(item.fraseId)?.[0]
    const antes = id ? textos.get(id) : undefined
    if (!id || antes === undefined || porId.has(id)) continue
    const novo = linhaLimpa(item.sugestao)
    if (!novo || novo === antes.trim()) continue
    const partes = dividirEmFrases(novo)
    if (partes.length === 0 || partes.length > 2) continue
    porId.set(id, { fraseId: id, antes, textos: partes, motivo: item.motivo.replace(/\s+/g, ' ').trim().slice(0, 120) })
  }
  return ordem.flatMap((id) => (porId.has(id) ? [porId.get(id)!] : [])).slice(0, MELHORIAS_MAX)
}

/** As partes com as trocas, e de onde veio cada frase nova (id novo -> id da frase dividida). */
function aplicarTrocas(base: Pick<Roteiro, 'secoes'>, trocas: readonly TrocaDaMelhoria[]): { secoes: Secao[]; origem: Map<string, string> } {
  const porId = new Map(trocas.map((t) => [t.fraseId, t] as const))
  const usados = idsDeFrase(base)
  const origem = new Map<string, string>()
  const secoes = base.secoes.map((s) => ({
    ...s,
    frases: s.frases.flatMap((f): Frase[] => {
      const t = porId.get(f.id)
      if (!t) return [f]
      const [primeira, segunda] = t.textos
      const citacao = /["“”]/.test(primeira ?? '') ? f.citacaoCueId : null
      const um: Frase = { ...f, texto: primeira ?? f.texto, citacaoCueId: citacao }
      if (!segunda) return [um]
      const id = proximoId('f', usados)
      usados.push(id)
      origem.set(id, f.id)
      return [um, { ...f, id, texto: segunda, textoDeTela: null, citacaoCueId: null }]
    }),
  }))
  return { secoes, origem }
}

/**
 * A VERSAO 'MELHORADA': 'ia', derivada da base, com as trocas. As sugestoes
 * de titulo e thumb da base vao junto. null = nenhuma troca.
 */
export function roteiroMelhorado(
  base: Roteiro,
  trocas: readonly TrocaDaMelhoria[],
  ctx: { versao: number; agoraIso: string; modelo: string },
): Roteiro | null {
  if (trocas.length === 0) return null
  const { secoes } = aplicarTrocas(base, trocas)
  return {
    versao: ctx.versao,
    alvoSec: base.alvoSec,
    secoes,
    modelo: ctx.modelo,
    criadoEm: ctx.agoraIso,
    origem: 'ia',
    derivadoDe: base.versao,
    pedido: null,
    melhorada: true,
    ...(base.sugestoes ? { sugestoes: base.sugestoes } : {}),
  }
}

/**
 * O TEMPO DO SHORT E FIXO: melhorar nao pode empurrar o roteiro para fora do
 * alvo. Se a soma das trocas passa de `limite` palavras (o maximo da faixa do
 * alvo, ou o tamanho de hoje + 3%, o que for maior), as trocas que mais
 * crescem voltam atras, ate caber. No Magic Repo Man (18/10) a versao
 * melhorada foi de 255 para 282 palavras (~68 s -> ~75 s num short de 60 s).
 */
export function limitarCrescimento(
  base: Pick<Roteiro, 'secoes'>,
  trocas: readonly TrocaDaMelhoria[],
  limite: number,
): { trocas: TrocaDaMelhoria[]; desfeitas: string[] } {
  const total = (t: readonly TrocaDaMelhoria[]): number => palavrasDoRoteiro({ secoes: aplicarTrocas(base, t).secoes })
  const teto = Math.max(limite, Math.round(palavrasDoRoteiro(base) * 1.03))
  const ficam = [...trocas]
  const desfeitas: string[] = []
  const cresce = (t: TrocaDaMelhoria): number => contarPalavras(t.textos.join(' ')) - contarPalavras(t.antes)
  while (ficam.length > 0 && total(ficam) > teto) {
    const pior = ficam.reduce((a, b) => (cresce(b) > cresce(a) ? b : a))
    if (cresce(pior) <= 0) break
    ficam.splice(ficam.indexOf(pior), 1)
    desfeitas.push(pior.fraseId)
  }
  return { trocas: ficam, desfeitas }
}

/** Os avisos de FIDELIDADE do validarRoteiro: troca que faz aparecer um deles volta atras. */
const DE_FIDELIDADE: ReadonlySet<CodigoDoProblema> = new Set([
  'termo-proibido',
  'hipotese-como-fato',
  'pronome-ambiguo',
  'frase-partida',
  'cta',
  'duas-frases',
])

/** As palavras de um texto, sem acento, para achar nome e numero. */
function palavras(texto: string): Set<string> {
  return new Set(semAcentos(texto).match(/[\p{L}\p{N}]+/gu) ?? [])
}

/**
 * A MESMA CONFERENCIA DE PROVA, sem outro pedido: a troca que (a) faz
 * aparecer um aviso de fidelidade que a frase de antes nao tinha (termo
 * vigiado que o evento nao diz, hipotese dita como fato, pronome ambiguo...),
 * (b) traz um nome do episodio que nem a frase de antes nem os eventos dela
 * citam, ou (c) traz um numero que nao esta na frase nem no resumo dos
 * eventos dela, volta ao texto de antes. Devolve as que ficam e os ids das
 * desfeitas.
 */
export function conferirMelhorias(
  base: Pick<Roteiro, 'secoes' | 'alvoSec'>,
  trocas: readonly TrocaDaMelhoria[],
  eventos: readonly Evento[],
  indice?: Pick<EpisodeIndex, 'cues'> & Partial<Pick<EpisodeIndex, 'exclusoes' | 'planos'>>,
  ritmo?: number,
  opcoes: OpcoesDaValidacao = {},
): { trocas: TrocaDaMelhoria[]; desfeitas: string[] } {
  if (trocas.length === 0) return { trocas: [], desfeitas: [] }
  const codigos = (r: Pick<Roteiro, 'secoes' | 'alvoSec'>, origem: ReadonlyMap<string, string>): Map<string, Set<CodigoDoProblema>> => {
    const porFrase = new Map<string, Set<CodigoDoProblema>>()
    for (const p of validarRoteiro(r, eventos, indice, ritmo, opcoes)) {
      if (!p.fraseId || !DE_FIDELIDADE.has(p.codigo)) continue
      const id = origem.get(p.fraseId) ?? p.fraseId
      porFrase.set(id, (porFrase.get(id) ?? new Set()).add(p.codigo))
    }
    return porFrase
  }
  const antes = codigos(base, new Map())
  const { secoes, origem } = aplicarTrocas(base, trocas)
  const depois = codigos({ secoes, alvoSec: base.alvoSec }, origem)
  const frases = new Map(base.secoes.flatMap((s) => s.frases.map((f) => [f.id, f] as const)))
  const nomesDoEpisodio = [...new Set(eventos.flatMap((e) => e.personagens))]
  const ficam: TrocaDaMelhoria[] = []
  const desfeitas: string[] = []
  for (const t of trocas) {
    const frase = frases.get(t.fraseId)
    const citados = eventos.filter((e) => frase?.eventoIds.includes(e.id))
    const novo = t.textos.join(' ')
    const novas = palavras(novo)
    const velhas = palavras(t.antes)
    const doEvento = palavras(citados.flatMap((e) => [...e.personagens, e.resumo]).join(' '))
    const problemaNovo = [...(depois.get(t.fraseId) ?? [])].some((c) => !antes.get(t.fraseId)?.has(c))
    const nomeSemProva = nomesDoEpisodio.some((nome) => {
      const partes = [...palavras(nome)].filter((p) => p.length >= 3)
      return partes.length > 0 && partes.every((p) => novas.has(p)) && !partes.every((p) => velhas.has(p) || doEvento.has(p))
    })
    const numeroSemProva = [...novas].some((p) => /^\d+$/.test(p) && !velhas.has(p) && !doEvento.has(p))
    if (problemaNovo || nomeSemProva || numeroSemProva) desfeitas.push(t.fraseId)
    else ficam.push(t)
  }
  return { trocas: ficam, desfeitas }
}
