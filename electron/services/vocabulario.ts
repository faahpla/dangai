import { escanearRaizes, raizesDaBiblioteca } from './library'

/**
 * Os nomes proprios que o Whisper recebe como dica antes de transcrever.
 *
 * Nome de personagem de anime e justamente o que o modelo mais erra, e o
 * whisper.cpp aceita um prompt inicial que enviesa a saida. A lista sai da
 * biblioteca: sao os nomes que o AnCut ja identificou nas cenas.
 *
 * Mora num arquivo proprio porque dois caminhos precisam dela -- os trechos da
 * Biblioteca e a analise da importacao -- e os dois ja importam o transcribe.
 */

/**
 * Quantos nomes entram no prompt.
 *
 * O prompt inicial do whisper.cpp cabe em ~224 tokens; a biblioteca dele ja tem
 * 96 personagens, e mandar todos passaria do limite e diluiria os que importam.
 * Os mais filmados sao os que a narracao tem mais chance de citar.
 */
const VOCABULARIO_MAX = 40

export function vocabulario(library: { clips: readonly { characters: string[] }[] }): string[] {
  const quantos = new Map<string, number>()
  for (const clip of library.clips) {
    for (const nome of clip.characters) quantos.set(nome, (quantos.get(nome) ?? 0) + 1)
  }
  return [...quantos]
    .sort((a, b) => b[1] - a[1])
    .slice(0, VOCABULARIO_MAX)
    .map(([nome]) => nome)
}

/**
 * O vocabulario da biblioteca (todas as raizes, como a grade), ou nada.
 *
 * Existe para os dois caminhos que transcrevem chegarem ao MESMO prompt. Antes
 * a importacao mandava os nomes dos ARQUIVOS soltos ("print-1.jpg", que o
 * buildVocabularyPrompt descarta quase inteiro) e so a Biblioteca mandava os
 * nomes dos personagens -- duas transcricoes diferentes do mesmo audio, e a boa
 * era sempre a segunda.
 *
 * Falha em silencio de proposito: biblioteca ilegivel nao pode impedir de
 * transcrever, so faz voltar ao que havia antes de existir vocabulario.
 */
export async function vocabularioDaBiblioteca(
  publishThumb: (absolutePath: string) => string,
): Promise<string[]> {
  const raizes = raizesDaBiblioteca()
  if (raizes.length === 0) return []
  try {
    return vocabulario(await escanearRaizes(raizes, publishThumb, () => {}))
  } catch {
    return []
  }
}
