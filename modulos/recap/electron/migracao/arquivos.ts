import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

/**
 * [recap] Os auxiliares de disco da migracao (parte 5): LER do Studio e
 * escrever SO no perfil do modulo, sem nunca sobrescrever.
 *
 * - copiar e temporario + rename: cancelar ou morrer no meio nunca deixa meio
 *   arquivo com o nome final (e a proxima rodada copia de novo);
 * - quem ja existe no destino fica (o Dangai ganha);
 * - nada aqui abre arquivo do Studio para escrita.
 */

export class Cancelado extends Error {
  constructor() {
    super('Cancelado')
  }
}

export function conferirSinal(sinal?: AbortSignal): void {
  if (sinal?.aborted) throw new Cancelado()
}

/** Copia se o destino nao existe. Devolve os bytes copiados (0 = ja estava). */
export async function copiarSeFalta(origem: string, destino: string, sinal?: AbortSignal): Promise<number> {
  conferirSinal(sinal)
  if (existsSync(destino)) return 0
  mkdirSync(dirname(destino), { recursive: true })
  const temp = `${destino}.${process.pid}.migrando`
  try {
    await copyFile(origem, temp)
    renameSync(temp, destino)
  } catch (err) {
    rmSync(temp, { force: true })
    throw err
  }
  return statSync(destino).size
}

/** Os arquivos de uma pasta, recursivo, em caminhos relativos. Pasta que nao existe = []. */
export function arquivosEm(pasta: string): string[] {
  const saida: string[] = []
  const andar = (p: string): void => {
    let itens
    try {
      itens = readdirSync(p, { withFileTypes: true })
    } catch {
      return
    }
    for (const it of itens) {
      const c = join(p, it.name)
      if (it.isDirectory()) andar(c)
      else if (it.isFile()) saida.push(relative(pasta, c))
    }
  }
  andar(pasta)
  return saida.sort()
}

export function tamanhoDe(caminho: string): number {
  try {
    return statSync(caminho).size
  } catch {
    return 0
  }
}

/** JSON do disco, ou null (nao existe, quebrado). */
export function lerJsonOuNull(caminho: string): unknown {
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'))
  } catch {
    return null
  }
}

/** Temporario + rename. */
export function gravarJson(caminho: string, dados: unknown): void {
  mkdirSync(dirname(caminho), { recursive: true })
  const temp = `${caminho}.${process.pid}.migrando`
  writeFileSync(temp, JSON.stringify(dados, null, 2), 'utf8')
  renameSync(temp, caminho)
}

/** Caminho comparavel no Windows: barra invertida, sem barra no fim, minusculo. */
function normal(p: string): string {
  return p.replace(/[\\/]+/g, '\\').replace(/\\$/, '').toLowerCase()
}

/** `caminho` mora dentro de `pasta`? (Windows: sem caixa, qualquer barra.) */
export function dentroDe(caminho: string, pasta: string): boolean {
  const c = normal(caminho)
  const p = normal(pasta)
  return c === p || c.startsWith(`${p}\\`)
}

/**
 * Troca, em todo texto do JSON, o caminho que aponta para dentro do perfil do
 * Studio pelo mesmo caminho no perfil do modulo (os dois tem o mesmo desenho:
 * recaps/, som/, motor/). O resto (a biblioteca, o .mkv) fica como veio.
 */
export function trocarPerfil<T>(valor: T, perfilDoStudio: string, perfilDoModulo: string): T {
  const p = normal(perfilDoStudio)
  const trocar = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (!/^[A-Za-z]:[\\/]|^\\\\/.test(v)) return v
      const n = normal(v)
      if (n !== p && !n.startsWith(`${p}\\`)) return v
      const resto = v.replace(/[\\/]+/g, '\\').slice(p.length).replace(/^\\/, '')
      return resto ? join(perfilDoModulo, ...resto.split('\\')) : perfilDoModulo
    }
    if (Array.isArray(v)) return v.map(trocar)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trocar(x)]))
    return v
  }
  return trocar(valor) as T
}

/** Junta dois mapas: as chaves do destino ganham, as que faltam vem da origem. Devolve quantas entraram. */
export function juntarMapa(destino: Record<string, unknown>, origem: Record<string, unknown>): number {
  let novas = 0
  for (const [k, v] of Object.entries(origem)) {
    if (k in destino) continue
    destino[k] = v
    novas++
  }
  return novas
}
