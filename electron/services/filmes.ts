import { statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { getSettings } from './settings'
import { dentroDe, PREFIXO_DOS_FILMES, registrarRaizDaBiblioteca } from './library'

/**
 * A BIBLIOTECA DE FILMES CORTADOS: "quero poder buscar minha biblioteca de
 * filmes cortados também". O AnCut corta filme como corta episodio --
 *
 *   <titulo>/Filme (2010)/
 *     shots/0000.mp4, keyframes/, metadata/shots.json
 *
 * -- entao ela entra na Biblioteca como mais uma raiz (prefixo `filme:`), e
 * toda busca, a grade e as sugestoes passam a ver as cenas dela. O Dangai so
 * le: nada e escrito na pasta dele.
 */

/**
 * A pasta dos filmes cortados: a das configuracoes, ou a que ele ja usa ao
 * lado da biblioteca (D:\Animes -> D:\Filmes\Corte de Filmes).
 *
 * Nunca a propria biblioteca nem uma pasta dentro dela (ou que a contenha): as
 * mesmas cenas entrariam duas vezes, com ids diferentes.
 */
export function pastaDosFilmes(): string | null {
  const { filmesDir, libraryDir } = getSettings()
  const candidatas: string[] = []
  if (filmesDir) candidatas.push(filmesDir)
  else if (libraryDir) {
    const vizinha = dirname(resolve(libraryDir))
    for (const nome of [
      join('Filmes', 'Corte de Filmes'),
      join('Filmes', 'Cortes de Filmes'),
      join('Filmes', 'Cortes'),
      'Corte de Filmes',
      'Cortes de Filmes',
    ]) {
      candidatas.push(join(vizinha, nome))
    }
  }
  for (const pasta of candidatas) {
    if (!ehPasta(pasta)) continue
    if (libraryDir && (dentroDe(pasta, libraryDir) || dentroDe(libraryDir, pasta))) continue
    return pasta
  }
  return null
}

/** Poe os filmes na biblioteca. A pasta e relida a cada varredura. */
export function configureFilmes(): void {
  registrarRaizDaBiblioteca({ id: 'filmes', prefixo: PREFIXO_DOS_FILMES, raiz: pastaDosFilmes })
}

function ehPasta(caminho: string): boolean {
  try {
    return statSync(caminho).isDirectory()
  } catch {
    return false
  }
}
