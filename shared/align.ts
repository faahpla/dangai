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
  return tokenizeWithBreaks(script).tokens
}

/**
 * Igual, mas dizendo quais tokens fecham um paragrafo.
 *
 * A quebra de paragrafo e o sinal mais forte de troca de assunto no roteiro, e
 * ela se perde no instante em que o texto vira uma lista de palavras. Aqui ela
 * e capturada antes disso.
 */
export function tokenizeWithBreaks(script: string): {
  tokens: string[]
  fechaParagrafo: boolean[]
} {
  const limpo = script.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ')

  const tokens: string[] = []
  const fechaParagrafo: boolean[] = []

  for (const paragrafo of limpo.split(/\n\s*\n+/)) {
    const palavras = paragrafo
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0 && normalize(token).length > 0)

    if (palavras.length === 0) continue

    for (const palavra of palavras) {
      tokens.push(palavra)
      fechaParagrafo.push(false)
    }
    fechaParagrafo[fechaParagrafo.length - 1] = true
  }

  // O ultimo token do roteiro nao fecha paragrafo nenhum: nao ha nada depois.
  if (fechaParagrafo.length > 0) fechaParagrafo[fechaParagrafo.length - 1] = false

  return { tokens, fechaParagrafo }
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
  const { tokens, fechaParagrafo } = tokenizeWithBreaks(script)
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
    const paragraph = fechaParagrafo[index] === true
    const match = pairedWith[index]
    if (match === null || match === undefined) {
      return { text, start: Number.NaN, end: Number.NaN, paragraph }
    }
    const timedWord = timed[match]!
    return { text, start: timedWord.start, end: timedWord.end, paragraph }
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
    const quantas = to - from - 1
    if (quantas <= 0) continue

    const inicio = words[from]!.end
    let fim = words[to]!.start

    /*
     * Quando NAO SOBRA TEMPO entre as duas medidas, tira da seguinte.
     *
     * O Whisper as vezes fecha uma palavra exatamente onde abre a proxima, e a
     * palavra do roteiro que mora entre as duas ficava com duracao ZERO. No
     * projeto real dele isso aconteceu 9 vezes, e todas as 9 eram a primeira
     * palavra depois de um ponto final -- "original." / No, "importante." / O,
     * "final." / Ou. Sao palavrinhas ditas COLADAS na palavra seguinte, e o
     * Whisper simplesmente as contou como parte dela.
     *
     * Duracao zero nao e um detalhe: a legenda que comeca com essa palavra
     * nascia curta demais, o piso de leitura a esticava para tras, e ela
     * aparecia ate 0,29s ANTES de ser dita. Emprestar da seguinte -- que e de
     * onde o audio veio -- poe cada uma perto de onde ela realmente esta.
     *
     * O emprestimo para na metade da palavra seguinte: ela e medida, e mexer
     * demais numa medida honesta para acomodar uma estimativa seria trocar um
     * erro pequeno por outro maior.
     */
    const precisa = MINIMO_ESTIMADO * quantas
    if (fim - inicio < precisa) {
      const seguinte = words[to]!
      const cede = Math.min(precisa - (fim - inicio), (seguinte.end - seguinte.start) / 2)
      if (cede > 0) {
        fim += cede
        seguinte.start = fim
      }
    }

    spread(from + 1, to - 1, inicio, fim)
  }
}

/**
 * Tempo minimo que uma palavra estimada recebe, em segundos.
 *
 * Perto de um frame e meio a 23,976fps. Nao e para ela ser lida com calma -- e
 * para ela EXISTIR: com zero, a legenda que comeca nela nasce sem duracao e o
 * resto do sistema tenta consertar empurrando a legenda para tras.
 */
const MINIMO_ESTIMADO = 0.06

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
