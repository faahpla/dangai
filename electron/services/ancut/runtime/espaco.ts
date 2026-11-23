import { existsSync } from 'node:fs'
import { readdir, lstat, statfs } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'

/**
 * ESPACO no disco: o livre (antes de comecar) e o ocupado (no fim).
 *
 * DONO: agente A. Sem electron: os testes rodam isto no Node.
 */

/** A pasta existente mais proxima (a do runtime pode ainda nao existir). */
function existente(pasta: string): string {
  let atual = pasta
  while (!existsSync(atual)) {
    const pai = dirname(atual)
    if (pai === atual) return parse(pasta).root || pasta
    atual = pai
  }
  return atual
}

/** Bytes livres para o usuario no disco da pasta. null = nao deu para medir. */
export async function livreNoDisco(pasta: string): Promise<number | null> {
  try {
    const s = await statfs(existente(pasta))
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return null
  }
}

/** "C:" (ou a raiz) da pasta, para a frase "precisa de X GB livres em C:". */
export function discoDa(pasta: string): string {
  const raiz = parse(pasta).root.replace(/[\\/]+$/, '')
  return raiz || pasta
}

/**
 * Quanto a pasta ocupa (soma dos arquivos, sem seguir links). Os hardlinks do
 * uv contam uma vez por caminho: depois de apagar o uv-cache, o que sobra e o
 * que o venv ocupa de verdade. Nunca lanca: o que nao der para ler fica de fora.
 */
export async function tamanhoDaPasta(pasta: string): Promise<number> {
  let total = 0
  const pilha = [pasta]
  while (pilha.length > 0) {
    const atual = pilha.pop()!
    let itens: import('node:fs').Dirent[]
    try {
      itens = await readdir(atual, { withFileTypes: true })
    } catch {
      continue
    }
    for (const item of itens) {
      const caminho = join(atual, item.name)
      if (item.isDirectory()) pilha.push(caminho)
      else if (item.isFile()) {
        try {
          total += (await lstat(caminho)).size
        } catch {
          // sumiu no meio
        }
      }
    }
  }
  return total
}

/** "9,2 GB" / "850 MB": o numero da frase de espaco. */
export function gb(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}
