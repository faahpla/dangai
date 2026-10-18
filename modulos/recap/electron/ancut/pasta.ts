import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { basename, dirname, join, parse, relative, resolve } from 'node:path'
import { shell } from 'electron'

/**
 * [recap] MOVER A PASTA DE UM EPISODIO entre a biblioteca do recap e a do
 * AnCut (L1): uma copia so, nunca duas.
 *
 * - Mesmo disco: rename da pasta inteira (instantaneo).
 * - Outro disco: copia para a pasta nova e confere (a lista, os tamanhos e o
 *   sha256 de cada .json). A de origem continua no lugar: quem chama tira
 *   depois do COMMIT do banco (apagarOrigem), nunca antes.
 * - A Lixeira do Windows (shell.trashItem): o que sai por "Unificar" ou o
 *   episodio antigo do AnCut num "Substituir". Item que nao cabe na Lixeira
 *   da erro em vez de ser apagado de vez.
 *
 * Costuras do teste: simularOutroDisco (a copia mesmo no mesmo disco) e
 * trocarLixeira (uma lixeira falsa numa pasta temporaria).
 */

/** Um arquivo da pasta: o caminho relativo, o tamanho e, nos .json, o sha256. */
export interface ArquivoDaPasta {
  rel: string
  tamanho: number
  sha: string | null
}

/** Barra, caixa e barra final nao importam no Windows. */
export function normal(caminho: string): string {
  return resolve(caminho).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** `caminho` e a `raiz` ou fica dentro dela. */
export function dentroDe(caminho: string, raiz: string): boolean {
  const a = normal(caminho)
  const r = normal(raiz)
  return a === r || a.startsWith(`${r}\\`)
}

function sha256(arquivo: string): string {
  return createHash('sha256').update(readFileSync(arquivo)).digest('hex')
}

/**
 * Todos os arquivos da pasta (inclusive os ocultos, como shots/.cor), em
 * ordem. `pular` recebe o caminho relativo de cada item do primeiro nivel e
 * de cada pasta: true = fora da lista.
 */
export function listarPasta(pasta: string, pular: (rel: string) => boolean = () => false): ArquivoDaPasta[] {
  const saida: ArquivoDaPasta[] = []
  const andar = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      const rel = relative(pasta, p)
      if (pular(rel)) continue
      if (e.isDirectory()) andar(p)
      else if (e.isSymbolicLink()) saida.push({ rel, tamanho: -1, sha: null })
      else saida.push({ rel, tamanho: statSync(p).size, sha: /\.json$/i.test(e.name) ? sha256(p) : null })
    }
  }
  andar(pasta)
  return saida.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}

/** null = as duas listas sao iguais; senao, o primeiro arquivo que difere (para a mensagem). */
export function diferencaEntre(a: readonly ArquivoDaPasta[], b: readonly ArquivoDaPasta[]): string | null {
  const mb = new Map(b.map((x) => [x.rel.toLowerCase(), x]))
  for (const x of a) {
    const y = mb.get(x.rel.toLowerCase())
    if (!y) return `falta ${x.rel}`
    if (y.tamanho !== x.tamanho) return `tamanho de ${x.rel}`
    if (x.sha !== y.sha) return `conteudo de ${x.rel}`
    mb.delete(x.rel.toLowerCase())
  }
  const sobra = mb.values().next()
  return sobra.done ? null : `sobra ${sobra.value.rel}`
}

/** A soma dos tamanhos dos arquivos (a conta de espaco do teste e da tela). */
export function tamanhoDaPasta(pasta: string): number {
  if (!existsSync(pasta)) return 0
  return listarPastaSemSha(pasta).reduce((s, x) => s + Math.max(0, x.tamanho), 0)
}

function listarPastaSemSha(pasta: string): { rel: string; tamanho: number }[] {
  const saida: { rel: string; tamanho: number }[] = []
  const andar = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) andar(p)
      else saida.push({ rel: relative(pasta, p), tamanho: e.isSymbolicLink() ? 0 : statSync(p).size })
    }
  }
  andar(pasta)
  return saida
}

let copiaForcada = false

/** Costura do teste: o "outro disco" (copia + confere) mesmo com as duas pastas no mesmo disco. */
export function simularOutroDisco(sim: boolean): void {
  copiaForcada = sim
}

/** As duas pastas estao no mesmo disco (a letra)? Na duvida, o rename tenta e o EXDEV cai na copia. */
export function mesmoDisco(a: string, b: string): boolean {
  return !copiaForcada && parse(resolve(a)).root.toLowerCase() === parse(resolve(b)).root.toLowerCase()
}

/**
 * Copia `de` para `para` (que nao pode existir) e confere. Sem `pular` no
 * destino: o que foi pulado na origem simplesmente nao vai. Copia que nao
 * bate sai inteira e lanca.
 */
export async function copiarEConferir(de: string, para: string, pular: (rel: string) => boolean = () => false): Promise<void> {
  if (existsSync(para)) throw new Error(`ja existe ${basename(para)}`)
  mkdirSync(dirname(para), { recursive: true })
  try {
    await cp(de, para, {
      recursive: true,
      errorOnExist: true,
      force: false,
      // O motor confere mtime (face_cache, o reaproveitar do indice): a copia leva o de cada arquivo.
      preserveTimestamps: true,
      filter: (origem) => {
        const rel = relative(de, origem)
        return rel === '' || !pular(rel)
      },
    })
    const diferenca = diferencaEntre(listarPasta(de, pular), listarPasta(para))
    if (diferenca) throw new Error(`a copia nao bateu (${diferenca})`)
  } catch (err) {
    rmSync(para, { recursive: true, force: true })
    throw err
  }
}

const OCUPADO = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * Rename que lanca com o erro do sistema (EXDEV, EPERM de arquivo aberto...).
 * Arquivo preso por um instante (o motor acabou de sair, o preview soltando o
 * mp4): tenta de novo algumas vezes antes de desistir.
 */
export function renomear(de: string, para: string): void {
  mkdirSync(dirname(para), { recursive: true })
  for (let tentativa = 1; ; tentativa++) {
    try {
      renameSync(de, para)
      return
    } catch (err) {
      if (tentativa >= 5 || !OCUPADO.has((err as NodeJS.ErrnoException).code ?? '')) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
    }
  }
}

/**
 * Tira a pasta que ja foi copiada e conferida do outro lado (o "mover" entre
 * discos), depois do COMMIT. O shots.json sai primeiro: uma sobra (arquivo
 * preso por outro programa) nunca parece episodio para as varreduras.
 */
export function apagarOrigem(pasta: string): boolean {
  try {
    rmSync(join(pasta, 'metadata', 'shots.json'), { force: true })
  } catch {
    /* segue: o rm abaixo tenta de novo */
  }
  try {
    rmSync(pasta, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    return !existsSync(pasta)
  } catch {
    return false
  }
}

/** A pasta do anime ficou vazia (o episodio era o unico): sai. Com qualquer coisa dentro, fica. */
export function tirarSeVazia(pasta: string): void {
  try {
    if (readdirSync(pasta).length === 0) rmdirSync(pasta)
  } catch {
    /* nao existe, ou nao e nossa: fica */
  }
}

// ------------------------------------------------------------ a Lixeira

async function lixeiraDoWindows(caminho: string): Promise<void> {
  // Fora do Electron (o teste em node) nao ha `shell`.
  if (!shell?.trashItem) throw new Error('sem a Lixeira do Windows aqui')
  await shell.trashItem(caminho)
}

let lixeira: (caminho: string) => Promise<void> = lixeiraDoWindows

/** Costura do teste: quem leva para a Lixeira. null = a do Windows. */
export function trocarLixeira(f: ((caminho: string) => Promise<void>) | null): void {
  lixeira = f ?? lixeiraDoWindows
}

/**
 * Manda para a Lixeira do Windows (nunca apaga de vez). A Lixeira recusa a
 * pasta com algum arquivo em uso (o preview que o Dangai abriu nesta sessao,
 * visto no teste de UI): tenta mais duas vezes e lanca com a frase para a tela.
 */
export async function paraALixeira(caminho: string): Promise<void> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await lixeira(caminho)
      break
    } catch {
      if (tentativa >= 3) throw new Error('a Lixeira recusou a pasta (algum arquivo em uso?)')
      await new Promise((ok) => setTimeout(ok, 800))
    }
  }
  if (existsSync(caminho)) throw new Error('a pasta continua no lugar')
}
