import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import type { AudioAnalysis } from '@shared/contract'
import { ffmpegPath } from './ffmpeg-path'
import { publish } from './media-server'

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
  const pcm = await decodeToPcm(path)
  const sampleCount = Math.floor(pcm.byteLength / 2)

  if (sampleCount === 0) {
    throw new Error(
      `Nao foi possivel ler audio de "${basename(path)}". O arquivo pode estar corrompido ou vazio. Tente exportar a narracao novamente.`,
    )
  }

  return {
    path,
    fileName: basename(path),
    url: publish(path),
    durationSec: sampleCount / ANALYSIS_SAMPLE_RATE,
    ...computePeaks(pcm, sampleCount),
  }
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
      reject(new Error(`FFmpeg nao pode ser executado (${err.message}). Reinstale as dependencias com "npm install".`))
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
