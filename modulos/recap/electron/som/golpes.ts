import { spawn } from 'node:child_process'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ffmpegPath } from '../ffmpeg-path'
import { pastaDoSomNoPerfil } from './medir'

/**
 * Os GOLPES de um arquivo de SFX (01/11): um pacote como "sword slash (sound
 * effects)" traz 9 espadadas no mesmo mp3, separadas por 0,3-0,6 s de
 * silencio. A Edicao rapida usa UM golpe por vez, no momento certo pela onda:
 * o pico de cada golpe e o que cai na virada.
 *
 * A onda: ffmpeg decodifica mono 16 kHz e a conta e o RMS em janelas de 10 ms.
 * Audivel = ate `ABAIXO_DO_MAXIMO_DB` abaixo da janela mais forte; um vao de
 * `VAO_MIN_SEC` ou mais separa dois golpes. Arquivo com um golpe so devolve
 * um so (quem chama usa o arquivo inteiro).
 *
 * Cache por caminho + tamanho + mtime em <userData>/som/golpes.json.
 */

export interface Golpe {
  /** Primeiro e ultimo instante audivel do golpe, s. */
  inicioSec: number
  fimSec: number
  /** O centro da janela de 10 ms mais forte do golpe, s. */
  picoSec: number
  /** O pico do golpe contra o do golpe mais forte do arquivo, dB (<= 0). */
  relativoDb: number
  /** Ate onde o golpe pode tocar sem pegar o proximo (cauda incluida), s. */
  ateSec: number
}

const VERSAO = 1
const TAXA = 16_000
const JANELA = 160 // 10 ms
const ABAIXO_DO_MAXIMO_DB = 35
const VAO_MIN_SEC = 0.2
const GOLPE_MIN_SEC = 0.05
const CAUDA_SEC = 0.25
const TETO_MS = 30_000

let cache: Map<string, Golpe[]> | null = null

function caminhoDoCache(): string | null {
  const pasta = pastaDoSomNoPerfil()
  return pasta ? join(pasta, 'golpes.json') : null
}

function lerCache(): Map<string, Golpe[]> {
  if (cache) return cache
  cache = new Map()
  const arq = caminhoDoCache()
  if (!arq || !existsSync(arq)) return cache
  try {
    const bruto = JSON.parse(readFileSync(arq, 'utf8')) as { versao?: number; golpes?: Record<string, Golpe[]> }
    if (bruto.versao === VERSAO && bruto.golpes) for (const [k, v] of Object.entries(bruto.golpes)) if (Array.isArray(v)) cache.set(k, v)
  } catch {
    // Cache corrompido: mede de novo.
  }
  return cache
}

function gravarCache(): void {
  const arq = caminhoDoCache()
  if (!arq || !cache) return
  const parcial = `${arq}.${process.pid}.tmp`
  try {
    writeFileSync(parcial, JSON.stringify({ versao: VERSAO, golpes: Object.fromEntries([...cache.entries()].slice(-400)) }))
    renameSync(parcial, arq)
  } catch (err) {
    console.warn('[som] nao deu para gravar o cache de golpes:', err)
  }
}

/** Os golpes do arquivo, do cache quando ele nao mudou. */
export async function golpesDoSom(path: string): Promise<Golpe[]> {
  const st = statSync(path)
  const chave = `${path}|${st.size}|${Math.round(st.mtimeMs)}`
  const pronto = lerCache().get(chave)
  if (pronto) return pronto
  const rms = await ondaEmDb(path)
  const golpes = golpesDaOnda(rms, JANELA / TAXA)
  lerCache().set(chave, golpes)
  gravarCache()
  return golpes
}

/**
 * Os golpes de uma onda em dB (uma janela por elemento, `passoSec` cada).
 * Pura (o teste chama direto).
 */
export function golpesDaOnda(db: readonly number[], passoSec: number): Golpe[] {
  if (db.length === 0) return []
  const maximo = Math.max(...db)
  if (!Number.isFinite(maximo)) return []
  const piso = maximo - ABAIXO_DO_MAXIMO_DB
  const vao = Math.round(VAO_MIN_SEC / passoSec)
  const trechos: { de: number; ate: number }[] = []
  let de = -1
  let ultimoAudivel = -1
  db.forEach((v, i) => {
    if (v < piso) return
    if (de >= 0 && i - ultimoAudivel > vao) {
      trechos.push({ de, ate: ultimoAudivel })
      de = -1
    }
    if (de < 0) de = i
    ultimoAudivel = i
  })
  if (de >= 0) trechos.push({ de, ate: ultimoAudivel })

  const arred = (x: number): number => Math.round(x * 1000) / 1000
  const validos = trechos.filter((t) => (t.ate - t.de + 1) * passoSec >= GOLPE_MIN_SEC)
  return validos.map((t, k) => {
    let pico = t.de
    for (let i = t.de; i <= t.ate; i++) if (db[i]! > db[pico]!) pico = i
    const fim = (t.ate + 1) * passoSec
    const proximo = validos[k + 1]
    const ate = proximo ? Math.min(fim + CAUDA_SEC, (fim + proximo.de * passoSec) / 2) : fim + CAUDA_SEC
    return {
      inicioSec: arred(t.de * passoSec),
      fimSec: arred(fim),
      picoSec: arred((pico + 0.5) * passoSec),
      relativoDb: Math.round((db[pico]! - maximo) * 10) / 10,
      ateSec: arred(Math.min(ate, db.length * passoSec)),
    }
  })
}

/** RMS em dBFS por janela de 10 ms (mono 16 kHz). */
function ondaEmDb(path: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', path, '-vn', '-ac', '1', '-ar', String(TAXA), '-f', 'f32le', '-'], {
      windowsHide: true,
    })
    const saida: number[] = []
    let soma = 0
    let n = 0
    let resto: Buffer | null = null
    const teto = setTimeout(() => child.kill(), TETO_MS)
    child.stdout.on('data', (pedaco: Buffer) => {
      const buf: Buffer = resto ? Buffer.concat([resto, pedaco]) : pedaco
      const util = buf.length - (buf.length % 4)
      resto = util < buf.length ? Buffer.from(buf.subarray(util)) : null
      for (let o = 0; o < util; o += 4) {
        const x = buf.readFloatLE(o)
        soma += x * x
        if (++n === JANELA) {
          saida.push(10 * Math.log10(soma / n + 1e-12))
          soma = 0
          n = 0
        }
      }
    })
    child.on('error', (err) => {
      clearTimeout(teto)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(teto)
      if (n > 0) saida.push(10 * Math.log10(soma / n + 1e-12))
      if (code !== 0) reject(new Error(`Nao deu para ler a onda (codigo ${code}).`))
      else resolve(saida)
    })
  })
}
