import { spawn } from 'node:child_process'
import { ffmpegPath } from './ffmpeg-path'

/**
 * Pausas naturais da narracao, direto do audio.
 *
 * E o fallback de baixo: nao precisa de transcricao, nem de modelo baixado, nem
 * de internet. So o FFmpeg, que ja esta no pacote. Cortar numa pausa e quase
 * sempre melhor que cortar num ponto arbitrario da divisao igual.
 */

/** Abaixo disto conta como silencio. -32dB pega respiro de narracao. */
const NOISE_FLOOR_DB = -32
/** Pausa mais curta que isso e respiro, nao fronteira de ideia. */
const MIN_SILENCE_SEC = 0.25

export async function detectSilences(audioPath: string): Promise<number[]> {
  const stderr = await runSilenceDetect(audioPath)

  const starts: number[] = []
  const ends: number[] = []

  for (const line of stderr.split('\n')) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line)
    if (start?.[1]) starts.push(Number(start[1]))
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line)
    if (end?.[1]) ends.push(Number(end[1]))
  }

  // O melhor instante para cortar e o meio da pausa, nao a borda: cortar
  // exatamente onde a fala para ainda soa apertado.
  const candidates: number[] = []
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    const from = starts[i]!
    const to = ends[i]!
    if (to > from) candidates.push((from + to) / 2)
  }

  return candidates.filter((t) => t > 0).sort((a, b) => a - b)
}

function runSilenceDetect(audioPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-hide_banner', '-i', audioPath,
       '-af', `silencedetect=noise=${NOISE_FLOOR_DB}dB:d=${MIN_SILENCE_SEC}`,
       '-f', 'null', '-'],
      { windowsHide: true },
    )

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', (err) => reject(new Error(`FFmpeg falhou: ${err.message}`)))
    child.on('close', (code) =>
      code === 0 ? resolve(stderr) : reject(new Error('Nao foi possivel analisar as pausas do audio.')),
    )
  })
}
