import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

/**
 * As fontes das legendas que o usuario largou na pasta.
 *
 * Mesmo desenho da pasta de SFX, e pelo mesmo motivo: fica no userData, nao
 * junto do app -- a pasta de instalacao some numa atualizacao, e numa
 * instalacao para todos os usuarios nem tem permissao de escrita.
 *
 * O app vem com UMA fonte embutida (Komika Axis) e ela continua sendo o padrao.
 * Esta pasta e para o resto: a fonte do canal dele, a de um video especifico,
 * qualquer coisa que ele queira sem depender de eu escolher por ele -- e sem o
 * app carregar licenca de fonte que nao e dele.
 *
 * Nao da para depender da fonte instalada no Windows: o render roda num Chrome
 * headless proprio, que nao enxerga as fontes do sistema. Por isso o arquivo
 * precisa existir e ser servido, e nao so nomeado.
 */

const EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2']

let userDir: string | null = null

export function configureFontes(dir: string): void {
  userDir = dir
}

export function fontesDir(): string {
  if (!userDir) throw new Error('Fontes nao configurado')
  return userDir
}

export function ensureFontesDir(): void {
  if (!userDir) return
  mkdirSync(userDir, { recursive: true })
}

/** Nomes dos arquivos de fonte na pasta, em ordem estavel. */
export function listFontes(): string[] {
  try {
    return readdirSync(fontesDir())
      .filter((name) => EXTENSIONS.includes(extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  } catch {
    return []
  }
}

/**
 * O caminho de um arquivo de fonte pelo NOME, se ele existir.
 *
 * Recebe so o nome de propósito. O projeto guarda o nome do arquivo, e nao o
 * caminho inteiro: assim um projeto salvo continua abrindo depois de o app
 * mudar de pasta, e um caminho vindo de fora nao vira leitura de disco
 * arbitraria -- o basename descarta qualquer "..\\" que aparecesse ali.
 */
export function caminhoDaFonte(nome: string): string | null {
  if (!nome) return null
  const limpo = basename(nome)
  if (!EXTENSIONS.includes(extname(limpo).toLowerCase())) return null
  const alvo = join(fontesDir(), limpo)
  return existsSync(alvo) ? alvo : null
}
