import { spawn } from 'node:child_process'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EntradaDaMusica } from '../../shared/trilha-sonora'
import { ffmpegPath } from '../ffmpeg-path'
import { pastaDoSomNoPerfil } from './medir'

/**
 * Os PONTOS DE ENTRADA de uma musica (01/11): onde ela "entra legal" -- a
 * energia e o grave sobem de uma vez (o drop, o refrao, a bateria entrando).
 * A Edicao rapida poe um deles em cima do corte gancho > contexto e de cada
 * troca de clima.
 *
 * A onda: ffmpeg decodifica mono 11025 Hz; por janela de 50 ms, o RMS (dB) e
 * o do grave (passa-baixa de 1 polo em 150 Hz). A forca de um instante e a
 * media dos 3 s seguintes menos a dos 3 s anteriores (energia + metade do
 * grave). Ficam os picos dessa forca com pelo menos 6 s entre eles e forca
 * >= FORCA_MIN (o comeco do som nao conta: silencio > musica nao e drop);
 * cada um e afinado para o maior salto de energia a ate 0,5 s
 * (o ataque, nao o meio da subida).
 *
 * Medido nas 10 musicas do Levi (01/11): We Don't Talk Anymore em 19,5 s e
 * 58,0 s; Where Our Blue Is em 48,9 s e 152,0 s; Haruka Mirai em 14,4 s.
 *
 * Cache por caminho + tamanho + mtime em <userData>/som/entradas.json.
 */

export interface EntradasDaMusica {
  durationSec: number
  entradas: EntradaDaMusica[]
}

const VERSAO = 3
const TAXA = 11_025
const PASSO = Math.round(TAXA * 0.05)
const JANELA_SEC = 3
const SEPARACAO_SEC = 6
const FORCA_MIN = 3
const MAXIMO = 8
const TETO_MS = 60_000

let cache: Map<string, EntradasDaMusica> | null = null

function caminhoDoCache(): string | null {
  const pasta = pastaDoSomNoPerfil()
  return pasta ? join(pasta, 'entradas.json') : null
}

function lerCache(): Map<string, EntradasDaMusica> {
  if (cache) return cache
  cache = new Map()
  const arq = caminhoDoCache()
  if (!arq || !existsSync(arq)) return cache
  try {
    const bruto = JSON.parse(readFileSync(arq, 'utf8')) as { versao?: number; musicas?: Record<string, EntradasDaMusica> }
    if (bruto.versao === VERSAO && bruto.musicas) {
      for (const [k, v] of Object.entries(bruto.musicas)) if (v && Array.isArray(v.entradas)) cache.set(k, v)
    }
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
    writeFileSync(parcial, JSON.stringify({ versao: VERSAO, musicas: Object.fromEntries([...cache.entries()].slice(-300)) }))
    renameSync(parcial, arq)
  } catch (err) {
    console.warn('[som] nao deu para gravar o cache de entradas:', err)
  }
}

/** As entradas da musica, do cache quando o arquivo nao mudou. */
export async function entradasDaMusica(path: string): Promise<EntradasDaMusica> {
  const st = statSync(path)
  const chave = `${path}|${st.size}|${Math.round(st.mtimeMs)}`
  const pronta = lerCache().get(chave)
  if (pronta) return pronta
  const { rms, grave } = await ondaDaMusica(path)
  const r: EntradasDaMusica = { durationSec: Math.round(rms.length * 0.05 * 1000) / 1000, entradas: entradasDaOnda(rms, grave, 0.05) }
  lerCache().set(chave, r)
  gravarCache()
  return r
}

/** As entradas de uma onda (dB por janela de `passoSec`). Pura (o teste chama direto). */
export function entradasDaOnda(rms: readonly number[], grave: readonly number[], passoSec: number): EntradaDaMusica[] {
  const n = rms.length
  const k = Math.round(JANELA_SEC / passoSec)
  if (n < 2 * k + 1) return []
  const suave = (xs: readonly number[]): number[] => xs.map((_, i) => {
    let s = 0
    let c = 0
    for (let j = Math.max(i - 2, 0); j <= Math.min(i + 2, xs.length - 1); j++) {
      s += xs[j]!
      c++
    }
    return s / c
  })
  const sr = suave(rms)
  const sg = suave(grave)
  // Somas acumuladas: a media de qualquer janela em O(1).
  const acum = (xs: number[]): number[] => {
    const a = [0]
    for (const x of xs) a.push(a[a.length - 1]! + x)
    return a
  }
  const ar = acum(sr)
  const ag = acum(sg)
  const media = (a: number[], de: number, ate: number): number => (a[ate]! - a[de]!) / (ate - de)
  // O comeco da musica (silencio > som) nao e drop: so depois de JANELA_SEC + 1 s de som.
  const pico = Math.max(...rms)
  const primeiro = Math.max(rms.findIndex((v) => v > pico - 30), 0)
  const desde = Math.max(k, primeiro + k + Math.round(1 / passoSec))
  const forcas: { i: number; f: number }[] = []
  for (let i = desde; i <= n - k; i++) {
    const sobe = media(ar, i, i + k) - media(ar, i - k, i)
    const sobeG = media(ag, i, i + k) - media(ag, i - k, i)
    forcas.push({ i, f: sobe + 0.5 * sobeG })
  }
  forcas.sort((a, b) => b.f - a.f)
  const sep = Math.round(SEPARACAO_SEC / passoSec)
  const escolhidas: { i: number; f: number }[] = []
  for (const c of forcas) {
    if (c.f < FORCA_MIN || escolhidas.length >= MAXIMO) break
    if (escolhidas.some((e) => Math.abs(e.i - c.i) < sep)) continue
    escolhidas.push(c)
  }
  // Afina para o ataque: o maior salto de energia a ate 0,5 s.
  const raio = Math.round(0.5 / passoSec)
  return escolhidas
    .map((c) => {
      let melhor = c.i
      let salto = Number.NEGATIVE_INFINITY
      for (let i = Math.max(c.i - raio, 1); i <= Math.min(c.i + raio, n - 1); i++) {
        const d = rms[i]! - rms[i - 1]!
        if (d > salto) {
          salto = d
          melhor = i
        }
      }
      // (18/11) Musica com SUBIDA antes da pancada (o grave crescendo, um riser): a
      // media de 3 s acha o meio da subida, e o drop de verdade e o 1o bumbo depois
      // dela. Na Montagem Batchi a subida vai de 16,2 a 18,9 s e o bumbo entra em
      // 19,2 s (+7,5 dB no grave num quadro; o Levi moveu a musica a mao para ele).
      const bumbo = primeiroBumbo(grave, c.i - raio, c.i + Math.round(BUMBO_ATE_SEC / passoSec))
      if (bumbo !== null && bumbo > melhor && subidaLisa(grave, melhor, bumbo)) melhor = bumbo
      return { t: Math.round(melhor * passoSec * 1000) / 1000, forca: Math.round(c.f * 10) / 10 }
    })
    .sort((a, b) => a.t - b.t)
}

/** Ate quanto depois da subida o 1o bumbo pode vir. */
const BUMBO_ATE_SEC = 4
/** Salto minimo do grave (dB, de um quadro para o mais baixo dos 2 anteriores) para ser bumbo. */
const BUMBO_MIN_DB = 4

/**
 * O 1o BUMBO FORTE do grave em [de, ate]: o primeiro quadro cujo salto chega a
 * 60% do maior salto da janela (e a BUMBO_MIN_DB). Os bumbos seguintes do mesmo
 * ritmo saltam igual, entao "o maior" cairia num qualquer; "o primeiro forte" e a
 * entrada. null = sem bumbo (musica sem batida marcada: fica o ataque do RMS).
 */
function primeiroBumbo(grave: readonly number[], de: number, ate: number): number | null {
  const ini = Math.max(de, 2)
  const fim = Math.min(ate, grave.length - 1)
  const saltos: { i: number; d: number }[] = []
  for (let i = ini; i <= fim; i++) saltos.push({ i, d: grave[i]! - Math.min(grave[i - 1]!, grave[i - 2]!) })
  if (saltos.length === 0) return null
  const maior = Math.max(...saltos.map((s) => s.d))
  if (maior < BUMBO_MIN_DB) return null
  const limiar = Math.max(BUMBO_MIN_DB, maior * 0.6)
  return saltos.find((s) => s.d >= limiar)?.i ?? null
}

/** Na subida LISA nenhum quadro do grave pula mais que isto (dB) do anterior. */
const SUBIDA_LISA_DB = 5

/**
 * O trecho [de, ate) e uma SUBIDA LISA (o grave cresce sem picotar)? So entao o
 * 1o bumbo depois dele e o drop. Grave picotado o tempo todo (o Naruto - Afternoon
 * of Konoha) tem "saltos" em todo buraco do picote: la fica o ataque do RMS.
 */
function subidaLisa(grave: readonly number[], de: number, ate: number): boolean {
  const difs: number[] = []
  for (let j = Math.max(de + 1, 1); j < ate - 1; j++) difs.push(Math.abs(grave[j]! - grave[j - 1]!))
  if (difs.length < 4) return false
  return Math.max(...difs) < SUBIDA_LISA_DB
}

/** RMS e grave (dB) por janela de 50 ms, mono 11025 Hz. */
function ondaDaMusica(path: string): Promise<{ rms: number[]; grave: number[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', path, '-vn', '-ac', '1', '-ar', String(TAXA), '-f', 'f32le', '-'], {
      windowsHide: true,
    })
    const rms: number[] = []
    const grave: number[] = []
    const a = 1 - Math.exp((-2 * Math.PI * 150) / TAXA)
    let y = 0
    let s = 0
    let sg = 0
    let c = 0
    let resto: Buffer | null = null
    const teto = setTimeout(() => child.kill(), TETO_MS)
    const fechar = (): void => {
      rms.push(10 * Math.log10(s / c + 1e-12))
      grave.push(10 * Math.log10(sg / c + 1e-12))
      s = 0
      sg = 0
      c = 0
    }
    child.stdout.on('data', (pedaco: Buffer) => {
      const buf: Buffer = resto ? Buffer.concat([resto, pedaco]) : pedaco
      const util = buf.length - (buf.length % 4)
      resto = util < buf.length ? Buffer.from(buf.subarray(util)) : null
      for (let o = 0; o < util; o += 4) {
        const x = buf.readFloatLE(o)
        y += a * (x - y)
        s += x * x
        sg += y * y
        if (++c === PASSO) fechar()
      }
    })
    child.on('error', (err) => {
      clearTimeout(teto)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(teto)
      if (c > 0) fechar()
      if (code !== 0) reject(new Error(`Nao deu para ler a musica (codigo ${code}).`))
      else resolve({ rms, grave })
    })
  })
}
