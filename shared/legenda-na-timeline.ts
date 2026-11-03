import type { CaptionBlock } from './contract'

/*
 * A LEGENDA EDITADA NA MAO, NA LINHA DO TEMPO: mover, puxar as pontas, cortar.
 *
 * "As vezes eu coloco efeito na voz pra fazer piada e o Whisper nao identifica
 * muito bem." O texto continua o do roteiro; o que sai errado e o TEMPO, e ele
 * corrige arrastando, como um clipe. Tudo em quadros, como o resto da legenda.
 *
 * As palavras andam junto: o marcador palavra a palavra le o comeco de cada uma,
 * e uma palavra fora do bloco nunca acenderia.
 */

type Palavra = CaptionBlock['words'][number]

/** O menor bloco que a mao deixa: um quadro por palavra, e nunca menos de tres. */
export function duracaoMinima(bloco: Pick<CaptionBlock, 'words'>): number {
  return Math.max(3, bloco.words.length)
}

/**
 * Onde a legenda `i` pode estar: entre o fim da anterior e o comeco da proxima,
 * e dentro do video. Legenda por cima de legenda mostraria duas linhas ao mesmo
 * tempo.
 */
export function limitesDaLegenda(
  blocos: readonly CaptionBlock[],
  i: number,
  totalDeQuadros: number,
): { piso: number; teto: number } {
  const anterior = blocos[i - 1]
  const proxima = blocos[i + 1]
  return {
    piso: anterior ? anterior.from + anterior.durationInFrames : 0,
    teto: Math.max(proxima ? proxima.from : totalDeQuadros, 1),
  }
}

/**
 * Poe as palavras dentro de [de, ate), na ordem, com um quadro pelo menos cada.
 * Quem passa da borda e empurrado para dentro; o resto fica onde estava.
 */
function encaixarPalavras(palavras: readonly Palavra[], de: number, ate: number): Palavra[] {
  const n = palavras.length
  const inicios: number[] = []
  for (const [k, p] of palavras.entries()) {
    const minimo = Math.max(de + k, k > 0 ? inicios[k - 1]! + 1 : de)
    inicios.push(Math.min(Math.max(p.from, minimo), ate - (n - k)))
  }
  return palavras.map((p, k) => {
    const teto = k < n - 1 ? inicios[k + 1]! : ate
    const fim = Math.min(Math.max(p.from + p.durationInFrames, inicios[k]! + 1), teto)
    return { text: p.text, from: inicios[k]!, durationInFrames: Math.max(fim - inicios[k]!, 1) }
  })
}

/**
 * O bloco com as pontas em [de, ate): as palavras esticam ou encolhem na mesma
 * proporcao, entao o ritmo da fala dentro dele continua o mesmo. Mover e o caso
 * em que a duracao nao muda.
 */
export function reposicionarLegenda(bloco: CaptionBlock, de: number, ate: number): CaptionBlock {
  const inicio = Math.max(0, Math.round(de))
  const fim = Math.max(Math.round(ate), inicio + duracaoMinima(bloco))
  const escala = (fim - inicio) / Math.max(bloco.durationInFrames, 1)
  const levar = (q: number): number => inicio + Math.round((q - bloco.from) * escala)
  const palavras = bloco.words.map((p) => {
    const from = levar(p.from)
    return { text: p.text, from, durationInFrames: Math.max(levar(p.from + p.durationInFrames) - from, 1) }
  })
  return { from: inicio, durationInFrames: fim - inicio, words: encaixarPalavras(palavras, inicio, fim) }
}

/**
 * Corta a legenda no quadro `q`, como a lamina corta um clipe. Cada palavra fica
 * do lado onde esta o meio dela, e cada metade leva pelo menos uma.
 *
 * null quando nao da: a agulha fora da legenda, uma palavra so, ou um lado
 * pequeno demais para as palavras que caberiam nele.
 */
export function cortarLegenda(bloco: CaptionBlock, q: number): [CaptionBlock, CaptionBlock] | null {
  const corte = Math.round(q)
  const fim = bloco.from + bloco.durationInFrames
  const n = bloco.words.length
  if (n < 2 || corte <= bloco.from || corte >= fim) return null
  const antes = bloco.words.filter((p) => p.from + p.durationInFrames / 2 < corte).length
  const k = Math.min(Math.max(antes, 1), n - 1)
  if (corte - bloco.from < k || fim - corte < n - k) return null
  return [
    { from: bloco.from, durationInFrames: corte - bloco.from, words: encaixarPalavras(bloco.words.slice(0, k), bloco.from, corte) },
    { from: corte, durationInFrames: fim - corte, words: encaixarPalavras(bloco.words.slice(k), corte, fim) },
  ]
}
