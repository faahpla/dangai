import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { getSettings } from './settings'

/**
 * A pasta de SFX do usuario.
 *
 * Fica no userData e nao junto do app: a pasta de instalacao some numa
 * atualizacao e, numa instalacao para todos os usuarios, nem tem permissao de
 * escrita -- os arquivos que ele largasse la desapareceriam sem aviso.
 *
 * Na primeira execucao os sons que vem com o app sao copiados para dentro dela.
 * Assim existe algo tocando de saida, e os arquivos ficam num lugar onde da
 * para trocar, apagar e acrescentar.
 */

const EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']

let userDir: string | null = null
let bundledDir: string | null = null

export function configureSfx(dirs: { userDir: string; bundledDir: string }): void {
  userDir = dirs.userDir
  bundledDir = dirs.bundledDir
}

/** Pasta em uso: a escolhida nas configuracoes, ou a do userData. */
export function sfxDir(): string {
  const chosen = getSettings().sfxDir
  if (chosen && existsSync(chosen)) return chosen
  if (!userDir) throw new Error('SFX nao configurado')
  return userDir
}

/**
 * Garante que a pasta existe e tem os sons iniciais.
 *
 * So semeia quando esta vazia. Se o usuario apagou tudo de proposito, repor na
 * proxima abertura seria desfazer a escolha dele.
 */
export function ensureSfxDir(): void {
  if (!userDir) return
  mkdirSync(userDir, { recursive: true })

  if (listSfx().length > 0) return
  if (!bundledDir || !existsSync(bundledDir)) return

  for (const name of readdirSync(bundledDir)) {
    if (!isSound(name)) continue
    const target = join(userDir, name)
    if (!existsSync(target)) copyFileSync(join(bundledDir, name), target)
  }
}

/** Nomes dos arquivos de som na pasta em uso, em ordem estavel. */
export function listSfx(): string[] {
  try {
    return readdirSync(sfxDir())
      .filter(isSound)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  } catch {
    return []
  }
}

function isSound(name: string): boolean {
  return EXTENSIONS.includes(extname(name).toLowerCase())
}
