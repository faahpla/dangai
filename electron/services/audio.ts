import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { AudioAnalysis } from '@shared/contract'
import { ffmpegPath } from './ffmpeg-path'
import { publish } from './media-server'

/*
 * A COPIA DE ESCUTA do preview: o que o <audio> toca, quando o arquivo e
 * comprimido.
 *
 * "Algumas musicas que eu importo, a waveform nao condiz quando eu dou play no
 * preview." Nao era a onda: era o player. O Chromium pula para o meio de um MP3
 * de taxa variavel por ESTIMATIVA e cai antes do lugar -- medido nas musicas
 * dele (11/2026), 0,3 a 0,8 s na maioria e 2,9 s na GONE TOO FAR aos 140 s. A
 * onda e o render decodificam com o ffmpeg e estao certos; o preview tocava
 * outro pedaco. Em WAV o pulo e exato (mesma medida: erro zero).
 *
 * Entao o preview toca uma copia WAV do arquivo, feita uma vez (0,4 s numa
 * musica de 3 min) e guardada no userData. O render continua lendo o ORIGINAL:
 * so a URL do preview muda.
 */
let pastaDeEscuta: string | null = null

export function configureAudio(userData: string): void {
  pastaDeEscuta = join(userData, 'escuta')
  setTimeout(limparEscutaVelha, 60_000).unref?.()
}

/** Onde o pulo do Chromium nao e exato. WAV, FLAC e AIFF tocam como estao. */
const COMPRIMIDOS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wma', '.webm', '.mp4'])
const convertendo = new Map<string, Promise<void>>()

/** Onde fica (ou ficaria) a copia de escuta deste arquivo. null = toca o proprio. */
function copiaDeEscuta(path: string): string | null {
  if (!pastaDeEscuta || !COMPRIMIDOS.has(extname(path).toLowerCase())) return null
  const st = statSync(path)
  const chave = createHash('sha1').update(`${path}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 20)
  return join(pastaDeEscuta, `${chave}.wav`)
}

/** A copia de escuta de um audio que saiu do projeto (a gravacao crua depois do "Pronto"). */
export function esquecerEscuta(path: string): number {
  try {
    const alvo = copiaDeEscuta(path)
    if (!alvo || !existsSync(alvo)) return 0
    const tamanho = statSync(alvo).size
    rmSync(alvo, { force: true })
    return tamanho
  } catch {
    return 0
  }
}

/** A URL que o preview toca: a copia de escuta, ou o proprio arquivo. */
export async function urlDeEscuta(path: string): Promise<string> {
  let alvo: string
  try {
    const copia = copiaDeEscuta(path)
    if (!copia) return publish(path)
    mkdirSync(dirname(copia), { recursive: true })
    alvo = copia
  } catch {
    return publish(path)
  }
  if (existsSync(alvo)) {
    // Usada agora: a limpeza conta os dias a partir daqui.
    const agora = new Date()
    try {
      utimesSync(alvo, agora, agora)
    } catch {
      /* so a data */
    }
    return publish(alvo)
  }
  let p = convertendo.get(alvo)
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const parcial = `${alvo}.part.wav`
      const child = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-vn', '-c:a', 'pcm_s16le', parcial], {
        windowsHide: true,
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error('copia de escuta falhou'))
        try {
          renameSync(parcial, alvo)
          resolve()
        } catch (e) {
          reject(e as Error)
        }
      })
    }).finally(() => convertendo.delete(alvo))
    convertendo.set(alvo, p)
  }
  try {
    await p
    return publish(alvo)
  } catch {
    // Sem copia, o preview toca o original como sempre tocou.
    return publish(path)
  }
}

/** Copias sem uso ha 30 dias saem: musica de video antigo nao ocupa disco para sempre. */
function limparEscutaVelha(): void {
  if (!pastaDeEscuta || !existsSync(pastaDeEscuta)) return
  const limite = Date.now() - 30 * 86_400_000
  for (const nome of readdirSync(pastaDeEscuta)) {
    try {
      const p = join(pastaDeEscuta, nome)
      if (statSync(p).mtimeMs < limite) rmSync(p, { force: true })
    } catch {
      /* em uso: fica */
    }
  }
}

/** Buckets de pico. ~2000 da resolucao de sobra para uma timeline de 1920px. */
const PEAK_BUCKETS = 2000

/** Taxa de decodificacao. Baixa de proposito: so precisamos da envoltoria. */
const ANALYSIS_SAMPLE_RATE = 8000

/**
 * Decodifica o audio para PCM mono 16-bit e devolve duracao + picos.
 *
 * A duracao sai da contagem de amostras, nao do ffprobe -- e exata e nos
 * poupa um segundo binario no pacote.
 */
export async function analyzeAudio(path: string): Promise<AudioAnalysis> {
  // A copia de escuta sai junto com a leitura, nao depois dela.
  const escuta = urlDeEscuta(path)
  const pcm = await decodeToPcm(path)
  const sampleCount = Math.floor(pcm.byteLength / 2)

  if (sampleCount === 0) {
    throw new Error(
      `Não foi possível ler áudio de "${basename(path)}". O arquivo pode estar corrompido ou vazio. Tente exportar a narração novamente.`,
    )
  }

  return {
    path,
    fileName: basename(path),
    url: await escuta,
    durationSec: sampleCount / ANALYSIS_SAMPLE_RATE,
    ...computePeaks(pcm, sampleCount),
  }
}

/**
 * A onda fina, para o zoom alto: 100 picos por segundo (ate 40 mil), com RMS.
 * Os 2000 da analise normal davam um pico a cada 36 ms numa narracao de 72 s --
 * ampliada, a onda virava bolhas lisas que nao eram o som. Tres casas: e o que
 * a tela distingue, e a resposta fica leve.
 */
export async function ondaDetalhada(path: string): Promise<{ peaks: number[]; rms: number[]; durationSec: number }> {
  const pcm = await decodeToPcm(path)
  const sampleCount = Math.floor(pcm.byteLength / 2)
  if (sampleCount === 0) return { peaks: [], rms: [], durationSec: 0 }
  const durationSec = sampleCount / ANALYSIS_SAMPLE_RATE
  const buckets = Math.max(1, Math.min(40_000, Math.round(durationSec * 100), sampleCount))
  const porBucket = sampleCount / buckets
  const peaks: number[] = new Array(buckets)
  const rms: number[] = new Array(buckets)
  for (let b = 0; b < buckets; b++) {
    const ini = Math.floor(b * porBucket)
    const fim = Math.min(Math.floor((b + 1) * porBucket), sampleCount)
    let max = 0
    let soma = 0
    for (let i = ini; i < fim; i++) {
      const a = pcm.readInt16LE(i * 2)
      const m = a < 0 ? -a : a
      if (m > max) max = m
      soma += a * a
    }
    peaks[b] = Math.round((max / 32768) * 1000) / 1000
    rms[b] = fim > ini ? Math.round(Math.min(1, Math.sqrt(soma / (fim - ini)) / 32768) * 1000) / 1000 : 0
  }
  return { peaks, rms, durationSec }
}

function decodeToPcm(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', path,
        '-vn',
        '-ac', '1',
        '-ar', String(ANALYSIS_SAMPLE_RATE),
        '-f', 's16le',
        '-',
      ],
      { windowsHide: true },
    )

    const chunks: Buffer[] = []
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      reject(new Error(`FFmpeg não pode ser executado (${err.message}). Reinstale as dependencias com "npm install".`))
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks))
        return
      }
      const detail = stderr.trim().split('\n').at(-1) ?? `codigo ${code}`
      reject(new Error(`FFmpeg falhou ao ler "${basename(path)}": ${detail}`))
    })
  })
}

/**
 * Pico absoluto e RMS por bucket, normalizados 0..1.
 *
 * O RMS existe por causa da MUSICA: uma faixa masterizada bate perto do teto
 * o tempo inteiro, e so com o pico a onda vira um bloco chapado. O RMS mostra
 * onde a musica cresce e respira -- desenhado por cima do pico, como no editor.
 */
function computePeaks(pcm: Buffer, sampleCount: number): { peaks: number[]; rms: number[] } {
  const buckets = Math.min(PEAK_BUCKETS, sampleCount)
  const samplesPerBucket = sampleCount / buckets
  const peaks: number[] = new Array(buckets).fill(0)
  const rms: number[] = new Array(buckets).fill(0)

  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = Math.floor(bucket * samplesPerBucket)
    const end = Math.min(Math.floor((bucket + 1) * samplesPerBucket), sampleCount)
    let max = 0
    let soma = 0

    for (let i = start; i < end; i++) {
      const amostra = pcm.readInt16LE(i * 2)
      const magnitude = Math.abs(amostra)
      if (magnitude > max) max = magnitude
      soma += amostra * amostra
    }

    peaks[bucket] = max / 32768
    rms[bucket] = end > start ? Math.min(1, Math.sqrt(soma / (end - start)) / 32768) : 0
  }

  return { peaks, rms }
}
