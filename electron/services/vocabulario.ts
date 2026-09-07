import { scanLibrary } from './library'
import { getSettings } from './settings'

/**
 * Os nomes proprios que o Whisper recebe como dica antes de transcrever.
 *
 * Nome de personagem de anime e justamente o que o modelo mais erra, e o
 * whisper.cpp aceita um prompt inicial que enviesa a saida. A lista sai da
 * biblioteca: sao os nomes que o AnCut ja identificou nas cenas.
 *
 * Mora num arquivo proprio, e nao dentro do automount, porque agora DOIS
 * caminhos precisam dela -- a montagem automatica e a analise da importacao --
 * e o automount ja importa o transcribe: pedir o contrario fecharia um ciclo
 * entre os dois modulos.
 */

/**
 * Quantos nomes entram no prompt.
 *
 * O prompt inicial do whisper.cpp cabe em ~224 tokens; a biblioteca dele ja tem
 * 96 personagens, e mandar todos passaria do limite e diluiria os que importam.
 * Os mais filmados sao os que a narracao tem mais chance de citar.
 */
const VOCABULARIO_MAX = 40

export function vocabulario(
  library: { clips: readonly { anime: string; characters: string[] }[] },
  series: string | null,
): string[] {
  const quantos = new Map<string, number>()
  for (const clip of library.clips) {
    // Com a serie escolhida, so os nomes dela viram dica -- 40 vagas gastas com
    // personagem de outro anime sao 40 vagas a menos para o que a narracao cita.
    if (series && clip.anime !== series) continue
    for (const nome of clip.characters) quantos.set(nome, (quantos.get(nome) ?? 0) + 1)
  }
  return [...quantos]
    .sort((a, b) => b[1] - a[1])
    .slice(0, VOCABULARIO_MAX)
    .map(([nome]) => nome)
}

/**
 * O vocabulario da biblioteca apontada nas configuracoes, ou nada.
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
  const { libraryDir } = getSettings()
  if (!libraryDir) return []
  try {
    return vocabulario(await scanLibrary(libraryDir, publishThumb, () => {}), null)
  } catch {
    return []
  }
}
