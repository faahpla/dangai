import { cutCandidatesFrom } from './plan'
import type { Transcript, Word } from './contract'

/**
 * Casa o roteiro escrito com os tempos que o Whisper achou.
 *
 * O problema que isto resolve: o Whisper acerta QUANDO cada palavra e dita e
 * erra O QUE foi dito -- escreve "ceu" onde o narrador falou "Cell". Quem sabe
 * o texto certo e o roteiro. Entao o texto sai sempre do roteiro e os tempos
 * sempre da transcricao.
 *
 * O casamento e um alinhamento de sequencias (Needleman-Wunsch) sobre as
 * palavras normalizadas, e nao uma comparacao posicao a posicao: o Whisper
 * inventa, engole e junta palavras, entao os dois lados andam fora de passo.
 * O alinhamento absorve isso -- as palavras que casam viram ancoras e as que
 * nao casam ficam entre duas ancoras, com tempo interpolado.
 */

/** Abaixo disto o roteiro provavelmente nao e desta narracao. */
const MIN_COVERAGE = 0.5

const MATCH = 3
const NEAR = 1
const MISMATCH = -2
const GAP = -2

export interface Alignment {
  words: Word[]
  /** Quantas palavras do roteiro receberam tempo medido, e nao interpolado. */
  anchored: number
  total: number
}

/**
 * Quebra o roteiro em palavras preservando a pontuacao, que faz parte do texto
 * exibido. Marcacoes de cena entre colchetes ou parenteses saem fora -- ninguem
 * narrou "[PAUSA]".
 */
export function tokenizeScript(script: string): string[] {
  return script
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && normalize(token).length > 0)
}

/** Chave de comparacao: sem acento, sem pontuacao, minuscula. */
function normalize(token: string): string {
  return token
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Distancia de edicao com teto: sai cedo quando ja passou do limite. Serve so
 * para decidir se duas palavras sao "quase iguais", entao nao precisa do valor
 * exato quando a diferenca e grande.
 */
function closeEnough(a: string, b: string): boolean {
  if (a === b) return true
  const diff = Math.abs(a.length - b.length)
  if (diff > 2 || Math.min(a.length, b.length) < 3) return false

  // Levenshtein em uma linha so.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]! <= 2
}

function score(a: string, b: string): number {
  if (a === b) return MATCH
  return closeEnough(a, b) ? NEAR : MISMATCH
}

/**
 * Alinha os tokens do roteiro contra as palavras cronometradas.
 *
 * Devolve uma palavra por token do roteiro, na ordem do roteiro, com start/end
 * em segundos. Nenhum token e descartado e nenhum texto e alterado.
 */
export function alignScript(script: string, timed: readonly Word[]): Alignment | null {
  const tokens = tokenizeScript(script)
  if (tokens.length === 0 || timed.length === 0) return null

  const a = tokens.map(normalize)
  const b = timed.map((word) => normalize(word.text))

  // Matriz de pontuacao. Float64Array e uma alocacao so: um roteiro de 10
  // minutos da ~1500x1500, que em array de arrays vira 1500 objetos.
  const cols = b.length + 1
  const matrix = new Float64Array((a.length + 1) * cols)
  for (let i = 1; i <= a.length; i++) matrix[i * cols] = i * GAP
  for (let j = 1; j <= b.length; j++) matrix[j] = j * GAP

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i * cols + j] = Math.max(
        matrix[(i - 1) * cols + (j - 1)]! + score(a[i - 1]!, b[j - 1]!),
        matrix[(i - 1) * cols + j]! + GAP,
        matrix[i * cols + (j - 1)]! + GAP,
      )
    }
  }

  // Volta pelo caminho otimo montando os pares.
  const pairedWith: (number | null)[] = new Array(a.length).fill(null)
  let i = a.length
  let j = b.length
  while (i > 0 && j > 0) {
    const diagonal = matrix[(i - 1) * cols + (j - 1)]! + score(a[i - 1]!, b[j - 1]!)
    if (matrix[i * cols + j] === diagonal) {
      // So vale como ancora se as palavras realmente se parecem; o diagonal
      // tambem e escolhido para trocas, e uma troca nao da tempo confiavel.
      if (score(a[i - 1]!, b[j - 1]!) > MISMATCH) pairedWith[i - 1] = j - 1
      i--
      j--
    } else if (matrix[i * cols + j] === matrix[(i - 1) * cols + j]! + GAP) {
      i--
    } else {
      j--
    }
  }

  const anchored = pairedWith.filter((value) => value !== null).length
  if (anchored / tokens.length < MIN_COVERAGE) return null

  const words: Word[] = tokens.map((text, index) => {
    const match = pairedWith[index]
    if (match === null || match === undefined) {
      return { text, start: Number.NaN, end: Number.NaN }
    }
    const timedWord = timed[match]!
    return { text, start: timedWord.start, end: timedWord.end }
  })

  fillGaps(words, timed)
  return { words, anchored, total: tokens.length }
}

/**
 * Da tempo as palavras que nao acharam par, espalhando o intervalo livre entre
 * as ancoras vizinhas proporcionalmente ao tamanho de cada palavra.
 *
 * Palavra maior demora mais para ser dita, entao o comprimento e uma
 * aproximacao melhor que dividir igualmente.
 */
function fillGaps(words: Word[], timed: readonly Word[]): void {
  const known = words
    .map((word, index) => (Number.isNaN(word.start) ? -1 : index))
    .filter((index) => index >= 0)

  if (known.length === 0) return

  const audioStart = timed[0]!.start
  const audioEnd = timed.at(-1)!.end

  const spread = (from: number, to: number, start: number, end: number): void => {
    const span = Math.max(end - start, 0)
    const weights = words.slice(from, to + 1).map((word) => Math.max(word.text.length, 1))
    const total = weights.reduce((sum, weight) => sum + weight, 0)

    let cursor = start
    for (let index = from; index <= to; index++) {
      const share = (span * weights[index - from]!) / total
      words[index]!.start = cursor
      words[index]!.end = cursor + share
      cursor += share
    }
  }

  const first = known[0]!
  const last = known.at(-1)!
  if (first > 0) spread(0, first - 1, audioStart, words[first]!.start)
  if (last < words.length - 1) spread(last + 1, words.length - 1, words[last]!.end, audioEnd)

  for (let k = 0; k < known.length - 1; k++) {
    const from = known[k]!
    const to = known[k + 1]!
    if (to - from > 1) spread(from + 1, to - 1, words[from]!.end, words[to]!.start)
  }
}

/**
 * Transcricao com o texto do roteiro e os tempos medidos.
 *
 * Devolve null quando o roteiro nao bate com o audio -- roteiro de outro
 * episodio, ou colado pela metade. Nesse caso quem chama fica com a
 * transcricao do Whisper, que e pior no texto mas honesta nos tempos.
 */
export function transcriptFromScript(
  script: string,
  base: Transcript,
): { transcript: Transcript; anchored: number; total: number } | null {
  const alignment = alignScript(script, base.words)
  if (!alignment) return null

  return {
    transcript: {
      source: 'script',
      words: alignment.words,
      segments: base.segments,
      text: alignment.words.map((word) => word.text).join(' '),
      cutCandidates: cutCandidatesFrom(alignment.words, base.segments),
    },
    anchored: alignment.anchored,
    total: alignment.total,
  }
}
