import { spawn } from 'node:child_process'
import { ffmpegPath } from '../ffmpeg-path'
import { lerWav, type Pcm } from './wav'

/**
 * O ffmpeg do projeto (ffmpeg-path.ts) para o motor de voz: decodificar o que
 * chega (mp3/m4a/wav do Levi, WAV do provedor fora do padrao) e o pos.
 *
 * Tudo sai por stdout como WAV PCM 16 bits mono e e lido por lerWav: assim a
 * taxa e a contagem de amostras vem do proprio audio, sem ffprobe.
 *
 * O AbortSignal mata o processo (o Cancelar do andamento): nada de ffmpeg
 * orfao rodando depois de o Levi desistir.
 */

export class Cancelado extends Error {
  constructor() {
    super('Cancelado.')
    this.name = 'Cancelado'
  }
}

/** Roda o ffmpeg e devolve o stdout. Lanca com a ultima linha do stderr. */
export function rodarFfmpeg(args: readonly string[], signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Cancelado())
      return
    }
    const child = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true })
    const pedacos: Buffer[] = []
    let stderr = ''
    const abortar = (): void => {
      try {
        child.kill()
      } catch {
        /* ja morreu */
      }
    }
    signal?.addEventListener('abort', abortar, { once: true })
    child.stdout.on('data', (c: Buffer) => pedacos.push(c))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', (err) => {
      signal?.removeEventListener('abort', abortar)
      reject(new Error(`FFmpeg nao pode ser executado (${err.message}).`))
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abortar)
      if (signal?.aborted) {
        reject(new Cancelado())
        return
      }
      if (code === 0) {
        resolve(Buffer.concat(pedacos))
        return
      }
      const detalhe = stderr.trim().split('\n').at(-1) ?? `codigo ${code}`
      reject(new Error(`FFmpeg falhou no audio da voz: ${detalhe}`))
    })
  })
}

/** Saida padrao do motor: WAV PCM 16 bits mono no stdout. */
export const SAIDA_WAV = ['-vn', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'] as const

/**
 * Decodifica qualquer audio para PCM 16 bits mono. `taxa` null = mantem a do
 * arquivo (ate 48 kHz; acima disso desce para 48 kHz, que e o que o video usa).
 */
export async function decodificar(caminho: string, taxa: number | null, signal?: AbortSignal): Promise<Pcm> {
  const args = ['-i', caminho]
  if (taxa !== null) args.push('-ar', String(taxa))
  const saida = await rodarFfmpeg([...args, ...SAIDA_WAV], signal)
  const pcm = lerWav(saida)
  if (!pcm || pcm.amostras.length === 0) throw new Error('Nao deu para ler esse audio (vazio ou em formato estranho).')
  if (taxa === null && pcm.taxa > 48_000) return decodificar(caminho, 48_000, signal)
  return pcm
}
