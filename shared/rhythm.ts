import { MIN_SCENE_SEC } from './plan'
import type { Word } from './contract'

/**
 * Onde a narracao pede uma troca de imagem.
 *
 * A distribuicao antiga cortava em intervalos iguais e depois empurrava cada
 * corte para a pausa mais proxima. Numa narracao corrida quase nao ha pausa,
 * entao o resultado era divisao igual pura: as imagens trocavam no meio de
 * frases e o video nao conversava com o que estava sendo dito.
 *
 * Com o roteiro alinhado palavra a palavra, existe informacao muito melhor que
 * silencio: PONTUACAO. Um ponto final e o fim de uma ideia -- e exatamente ali
 * que o olho aceita ver outra imagem. Uma virgula e uma pausa de respiro, boa
 * mas mais fraca. Um paragrafo e uma troca de assunto, a mais forte de todas.
 *
 * O que este modulo faz: pontua cada fronteira entre palavras e escolhe, para
 * cada corte, a melhor fronteira perto de onde ele cairia -- resolvendo todos
 * os cortes de uma vez, e nao um por um, porque a melhor escolha para um corte
 * depende de onde os vizinhos ficaram.
 */

const FIM_DE_FRASE = '.!?…'
const PAUSA_CURTA = ',;:'

/** Peso de cada sinal. Fim de frase vale o dobro de uma virgula. */
const PESO_FRASE = 10
const PESO_VIRGULA = 5
const PESO_PARAGRAFO = 16
/** Quanto uma pausa longa soma, por segundo, ate o teto. */
const PESO_PAUSA = 8
const PAUSA_MAXIMA = 0.6

/**
 * Custo de fugir do espacamento ideal, por segundo.
 *
 * E o que impede o plano de amontoar todos os cortes nos pontos finais e deixar
 * um bloco de quinze segundos no meio. Com 1.5, vale a pena andar um segundo
 * para pegar um fim de frase (+10) mas nao para pegar uma virgula distante.
 */
const CUSTO_DESVIO = 1.5

export interface Boundary {
  /** Instante do corte, em segundos. */
  at: number
  score: number
}

/** Tira aspas e parenteses do fim para enxergar a pontuacao de verdade. */
function pontuacaoFinal(text: string): string {
  const bare = text.replace(/["'”’)\]}»]+$/u, '')
  return bare.at(-1) ?? ''
}

/**
 * Pontua cada fronteira entre duas palavras.
 *
 * O instante fica no meio do intervalo entre as duas: cortar exatamente no fim
 * da palavra ainda soa apertado, e o meio do respiro e onde a troca passa
 * despercebida.
 */
export function boundariesFrom(words: readonly Word[]): Boundary[] {
  const boundaries: Boundary[] = []

  for (let i = 0; i < words.length - 1; i++) {
    const atual = words[i]!
    const proxima = words[i + 1]!

    const gap = Math.max(proxima.start - atual.end, 0)
    const fim = pontuacaoFinal(atual.text)

    let score = Math.min(gap, PAUSA_MAXIMA) * PESO_PAUSA
    if (FIM_DE_FRASE.includes(fim)) score += PESO_FRASE
    else if (PAUSA_CURTA.includes(fim)) score += PESO_VIRGULA
    if (atual.paragraph) score += PESO_PARAGRAFO

    boundaries.push({ at: atual.end + gap / 2, score })
  }

  return boundaries
}

/**
 * Escolhe os n-1 cortes que melhor casam com a narracao.
 *
 * Cada corte procura sua fronteira dentro de uma janela em volta de onde ele
 * cairia numa divisao igual. A escolha e feita por programacao dinamica e nao
 * corte a corte: decidir cada um isoladamente leva ao caso em que dois cortes
 * disputam o mesmo ponto final e o segundo fica sem lugar bom.
 *
 * Devolve null quando nao ha material suficiente -- quem chama volta para a
 * divisao igual.
 */
export function pickCuts(
  boundaries: readonly Boundary[],
  cuts: number,
  durationSec: number,
): number[] | null {
  if (cuts <= 0) return []
  if (boundaries.length < cuts) return null

  const ideal = Array.from({ length: cuts }, (_, k) => ((k + 1) * durationSec) / (cuts + 1))
  const bloco = durationSec / (cuts + 1)
  // Janela generosa o bastante para achar um fim de frase, curta o bastante
  // para os blocos nao virarem tamanhos completamente diferentes entre si.
  const raio = Math.min(bloco * 0.45, 2.5)

  // Cortes demais para o audio: nem espacados por igual eles caberiam.
  if (durationSec / (cuts + 1) < MIN_SCENE_SEC) return null

  /**
   * Candidatos de cada corte, ja com a pontuacao final (sinal menos desvio).
   *
   * O instante ideal entra SEMPRE, mesmo quando ha fronteiras na janela. Ele
   * vale zero, entao qualquer pontuacao ganha dele -- mas a presenca dele
   * garante que existe pelo menos um caminho valido de ponta a ponta. Sem isso,
   * um roteiro com poucas frases e muitas imagens deixava o algoritmo sem saida
   * e ele devolvia null, jogando tudo de volta para a divisao igual.
   */
  const opcoes: { at: number; valor: number }[][] = ideal.map((alvo, k) => {
    const piso = MIN_SCENE_SEC * (k + 1)
    const teto = durationSec - MIN_SCENE_SEC * (cuts - k)

    const dentro = boundaries
      .filter((b) => Math.abs(b.at - alvo) <= raio && b.at >= piso && b.at <= teto)
      .map((b) => ({ at: b.at, valor: b.score - Math.abs(b.at - alvo) * CUSTO_DESVIO }))

    return [...dentro, { at: alvo, valor: 0 }].sort((a, b) => a.at - b.at)
  })

  // dp[j] = melhor total ate o corte k terminando na opcao j.
  let dp = opcoes[0]!.map((o) => o.valor)
  const veio: number[][] = [opcoes[0]!.map(() => -1)]

  for (let k = 1; k < cuts; k++) {
    const anterior = opcoes[k - 1]!
    const atual = opcoes[k]!
    const proximo = new Array<number>(atual.length).fill(-Infinity)
    const rastro = new Array<number>(atual.length).fill(-1)

    for (let j = 0; j < atual.length; j++) {
      for (let i = 0; i < anterior.length; i++) {
        if (dp[i] === -Infinity) continue
        if (atual[j]!.at - anterior[i]!.at < MIN_SCENE_SEC) continue
        const total = dp[i]! + atual[j]!.valor
        if (total > proximo[j]!) {
          proximo[j] = total
          rastro[j] = i
        }
      }
    }

    // Nenhuma combinacao respeitou o minimo: o audio nao comporta tantos cortes.
    if (proximo.every((v) => v === -Infinity)) return null

    dp = proximo
    veio.push(rastro)
  }

  let melhor = 0
  for (let j = 1; j < dp.length; j++) if (dp[j]! > dp[melhor]!) melhor = j

  const escolhidos: number[] = []
  for (let k = cuts - 1; k >= 0; k--) {
    escolhidos.unshift(opcoes[k]![melhor]!.at)
    melhor = veio[k]![melhor]!
    if (melhor === -1 && k > 0) return null
  }

  return escolhidos
}
