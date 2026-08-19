import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * As cenas que ele marcou para achar de novo.
 *
 * Guarda o ID da cena -- `<serie>/<SxxExx>/<shot>` --, e nao o caminho absoluto:
 * o id e estavel entre varreduras e sobrevive se ele mover a biblioteca de
 * disco, que e exatamente o plano dele com a nuvem.
 *
 * Fica no userData, nunca na pasta do AnCut. A biblioteca dele e so leitura --
 * o Dangai nao escreve, nao renomeia e nao apaga nada la.
 *
 * Nao ha lista por anime no arquivo: o anime esta dentro do proprio id, e a
 * tela agrupa na hora. Guardar por anime criaria um segundo lugar onde o nome
 * da serie vive, e ele mudaria de nome no dia em que a pasta mudasse.
 */

let caminho: string | null = null

export function configureFavorites(userDataDir: string): void {
  caminho = join(userDataDir, 'favoritos.json')
}

export function readFavorites(): string[] {
  if (!caminho) throw new Error('Favoritos nao configurados')
  try {
    const cru: unknown = JSON.parse(readFileSync(caminho, 'utf8'))
    if (!Array.isArray(cru)) return []
    return [...new Set(cru.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  } catch {
    // Sem arquivo ainda, ou arquivo corrompido: comeca vazio em vez de derrubar
    // a Biblioteca por causa de uma lista de conveniencia.
    return []
  }
}

/** Liga ou desliga um favorito. Devolve a lista inteira depois da troca. */
export function toggleFavorite(id: string): string[] {
  if (!caminho) throw new Error('Favoritos nao configurados')
  if (!id.trim()) throw new Error('Sem cena para favoritar.')

  const atuais = readFavorites()
  const proximos = atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id]

  mkdirSync(dirname(caminho), { recursive: true })
  // Temporario e rename, como o settings: morrer no meio da escrita deixa o
  // arquivo antigo intacto em vez de virar json pela metade.
  const temp = caminho + '.tmp'
  writeFileSync(temp, JSON.stringify(proximos, null, 2), 'utf8')
  renameSync(temp, caminho)

  return proximos
}
