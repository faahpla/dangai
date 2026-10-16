import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { SkipRangesDoAnime } from '../../shared/oped'
import { chaveDoAnime } from './perfil'
import { saidaDoCorteCenas } from './protegidas'

/**
 * O "pular inicio/fim" que o Corte Cenas guarda por anime (skip_ranges.json,
 * `{"Dr. Stone": {"head": 90, "tail": 90}}`). SO LEITURA: o arquivo e do Corte
 * Cenas e do AnCut.
 *
 * Mora no cache deles, que fica em lugares diferentes conforme o jeito de
 * rodar: <app>/cache quando roda do fonte (o do Levi, ao lado de Output/) ou
 * %LOCALAPPDATA%\CorteCenas\CorteCenas\cache quando roda instalado. Procura nos
 * dois; o caminho do cache no config.json NAO e lido -- daquele arquivo so o
 * output_dir.
 */

function candidatos(): string[] {
  const local = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
  const lista = [join(local, 'CorteCenas', 'CorteCenas', 'cache', 'skip_ranges.json')]
  const saida = saidaDoCorteCenas()
  if (saida) lista.unshift(join(dirname(saida), 'cache', 'skip_ranges.json'))
  lista.push('G:\\App Corte Cenas\\cache\\skip_ranges.json')
  const vistos = new Set<string>()
  return lista.filter((c) => {
    const chave = resolve(c).toLowerCase()
    if (vistos.has(chave)) return false
    vistos.add(chave)
    return true
  })
}

/**
 * O pulo guardado para algum dos nomes do anime (o digitado, o da pasta, o
 * titulo do motor). null quando nao ha, ou quando os dois sao zero.
 */
export function skipRangesDoAnime(nomes: readonly string[]): SkipRangesDoAnime | null {
  const procurados = new Set(nomes.map(chaveDoAnime).filter((n) => n.length > 0))
  if (procurados.size === 0) return null
  for (const arquivo of candidatos()) {
    let cru: unknown
    try {
      cru = JSON.parse(readFileSync(arquivo, 'utf8'))
    } catch {
      continue
    }
    if (!cru || typeof cru !== 'object') continue
    for (const [anime, valor] of Object.entries(cru as Record<string, unknown>)) {
      if (!procurados.has(chaveDoAnime(anime)) || !valor || typeof valor !== 'object') continue
      const { head, tail } = valor as { head?: unknown; tail?: unknown }
      const h = typeof head === 'number' && Number.isFinite(head) ? head : 0
      const t = typeof tail === 'number' && Number.isFinite(tail) ? tail : 0
      if (h > 0 || t > 0) return { head: h, tail: t }
    }
  }
  return null
}
