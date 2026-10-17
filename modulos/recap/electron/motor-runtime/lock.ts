import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { ArquivoOficial, ImpressaoGravada, LockDoRuntime, VarianteDoMotor } from '../../shared/motor-runtime'
import { caminhoDoLock } from './pastas'

/**
 * O LOCK do runtime (motor/studio-runtime.json) e a IMPRESSAO que diz se o que
 * esta instalado e o que este app espera.
 *
 * DONO: agente A. A definicao da impressao e contrato: mudar o que entra nela
 * faz TODO app instalado achar que o runtime esta desatualizado.
 */

let emCache: { caminho: string; lock: LockDoRuntime } | null = null

/** So para os testes: o lock do disco mudou (simular uma atualizacao do app). */
export function esquecerLock(): void {
  emCache = null
}

/** [recap] Um arquivo oficial pinado: https, sha256 e tamanho. */
function oficialBom(a: Partial<ArquivoOficial> | undefined): boolean {
  return (
    !!a &&
    typeof a.versao === 'string' &&
    typeof a.arquivo === 'string' &&
    /^[\w.+-]+$/.test(a.arquivo) &&
    typeof a.url === 'string' &&
    a.url.startsWith('https://') &&
    /^[0-9a-f]{64}$/.test(a.sha256 ?? '') &&
    typeof a.bytes === 'number' &&
    a.bytes > 0
  )
}

/**
 * Le e confere o lock. Fica em memoria: o arquivo e do instalador e nao muda
 * com o app aberto. Lanca com frase curta quando falta ou esta torto -- e
 * instalador quebrado, e o erro tem que dizer isso.
 */
export function lerLock(caminho: string = caminhoDoLock()): LockDoRuntime {
  if (emCache?.caminho === caminho) return emCache.lock
  let cru: unknown
  try {
    cru = JSON.parse(readFileSync(caminho, 'utf8'))
  } catch {
    throw new Error(`O app veio sem a lista do motor (${caminho}). Reinstale o Dangai.`)
  }
  const l = cru as Partial<LockDoRuntime>
  const ok =
    l.formato === 1 &&
    typeof l.python === 'string' &&
    /^\d+\.\d+\.\d+$/.test(l.python) &&
    typeof l.indice === 'string' &&
    Array.isArray(l.pacotes) &&
    l.pacotes.every((p) => typeof p?.nome === 'string' && typeof p.versao === 'string' && Array.isArray(p.hashes) && p.hashes.length > 0) &&
    !!l.torch &&
    (['cu128', 'cpu'] as const).every(
      (v) => Array.isArray(l.torch?.[v]) && l.torch[v].length > 0 && l.torch[v].every((r) => /^[0-9a-f]{64}$/.test(r.sha256) && r.bytes > 0),
    ) &&
    // [recap] O Python oficial e o uv, pinados (baixados na instalacao).
    oficialBom(l.pythonOficial) &&
    l.pythonOficial?.versao === l.python &&
    typeof l.pythonOficial?.assinante === 'string' &&
    oficialBom(l.uv) &&
    /^[0-9a-f]{64}$/.test(l.uv?.sha256Exe ?? '')
  if (!ok) throw new Error(`A lista do motor (${caminho}) esta torta. Reinstale o Dangai.`)
  emCache = { caminho, lock: l as LockDoRuntime }
  return emCache.lock
}

/**
 * sha256 de {formato, python, variante, rodas [nome, versao], pacotes
 * ["nome==versao"] em ordem}. Hashes, tamanhos e URLs ficam de fora: a mesma
 * versao com outro espelho nao e "outro runtime".
 */
export function impressaoDoLock(lock: LockDoRuntime, variante: VarianteDoMotor): string {
  const canonico = {
    formato: 1,
    python: lock.python,
    variante,
    rodas: lock.torch[variante].map((r) => [r.nome, r.versao]),
    pacotes: lock.pacotes.map((p) => `${p.nome}==${p.versao}`).sort(),
  }
  return createHash('sha256').update(JSON.stringify(canonico)).digest('hex')
}

/**
 * Os pacotes (sem torch) em formato pip, com todos os hashes: o uv instala com
 * `--no-deps --require-hashes -r <isto>`. Gravado em <runtime>/req/pacotes.txt.
 */
export function requisitosDoLock(lock: LockDoRuntime): string {
  const linhas = ['# Gerado pelo Dangai (modulo recap) a partir de motor/studio-runtime.json. Nao editar.']
  for (const p of lock.pacotes) {
    linhas.push(`${p.nome}==${p.versao} \\`)
    p.hashes.forEach((h, i) => linhas.push(`    --hash=sha256:${h}${i < p.hashes.length - 1 ? ' \\' : ''}`))
  }
  return `${linhas.join('\n')}\n`
}

/** Os mapas nome -> versao que o impressao.json guarda (para o diff da proxima atualizacao). */
export function versoesDoLock(lock: LockDoRuntime, variante: VarianteDoMotor): Pick<ImpressaoGravada, 'rodas' | 'pacotes'> {
  return {
    rodas: Object.fromEntries(lock.torch[variante].map((r) => [r.nome, r.versao])),
    pacotes: Object.fromEntries(lock.pacotes.map((p) => [p.nome, p.versao])),
  }
}

/** O impressao.json da pasta, ou null (ausente, torto, de outro formato). */
export function lerImpressaoGravada(arquivo: string): ImpressaoGravada | null {
  try {
    const j = JSON.parse(readFileSync(arquivo, 'utf8')) as Partial<ImpressaoGravada>
    if (j.formato !== 1 || typeof j.impressao !== 'string' || (j.variante !== 'cu128' && j.variante !== 'cpu')) return null
    if (typeof j.python !== 'string' || !j.rodas || !j.pacotes) return null
    return j as ImpressaoGravada
  } catch {
    return null
  }
}
