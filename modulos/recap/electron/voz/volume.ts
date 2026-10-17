import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ffmpegPath } from '../ffmpeg-path'
import { Cancelado } from './ffmpeg'
import { wavDoPcm, type Pcm } from './wav'

/**
 * O VOLUME da narracao: toda narracao sai no mesmo loudness, qualquer que seja
 * a fonte.
 *
 * Antes cada take saia no nivel de quem gerou: o ElevenLabs em -28 LUFS e o
 * audio importado em -24. Trocar de take ou de fonte no tocador do passo 3
 * mudava o volume em 4-5 LU, e o render (que normaliza em -14) recebia uma
 * narracao 20 dB abaixo do pico.
 *
 * A conta: ebur128 do ffmpeg (loudness integrado + true peak) e um GANHO
 * LINEAR ate REFERENCIA_LUFS -- so ganho, nada de limitador: o limitador mexe
 * no tempo do ataque (lookahead) e o remapeamento das palavras e exato por
 * amostra. Se o pico passaria de TETO_DBTP, o ganho para antes (o take fica
 * um pouco mais baixo, mas nunca estoura). -23 LUFS (EBU R128) cabe nos dois
 * casos medidos no S4-37: ElevenLabs +5,2 dB (pico -2,9 dBTP) e importado
 * +0,8 dB.
 */

export const REFERENCIA_LUFS = -23
const TETO_DBTP = -1.5
/** Abaixo disto de diferenca nao mexe (o arquivo fica igual ao do pos). */
const GANHO_MINIMO_DB = 0.1
const GANHO_MAXIMO_DB = 20

export interface Loudness {
  /** Loudness integrado (LUFS). */
  lufs: number
  /** True peak (dBTP). */
  pico: number
}

/** Le o resumo do ebur128 no stderr do ffmpeg. null = nao veio (audio mudo, ffmpeg diferente). */
export function lerResumoDoEbur128(stderr: string): Loudness | null {
  const resumo = stderr.slice(stderr.lastIndexOf('Summary:'))
  const lufs = /\bI:\s+(-?[\d.]+|-inf)\s+LUFS/.exec(resumo)?.[1]
  const pico = /\bPeak:\s+(-?[\d.]+|-inf)\s+dBFS/.exec(resumo)?.[1]
  if (!lufs || !pico || lufs === '-inf') return null
  const l = Number(lufs)
  const p = pico === '-inf' ? -120 : Number(pico)
  return Number.isFinite(l) && Number.isFinite(p) ? { lufs: l, pico: p } : null
}

/** Mede o loudness de um WAV no disco (ffmpeg, ~0,3 s por minuto de audio). */
export function medirLoudness(caminho: string, signal?: AbortSignal): Promise<Loudness | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Cancelado())
      return
    }
    // framelog=verbose: as linhas por quadro ficam fora do -loglevel info; so o resumo sai.
    const child = spawn(
      ffmpegPath,
      ['-nostdin', '-hide_banner', '-nostats', '-i', caminho, '-af', 'ebur128=peak=true:framelog=verbose', '-f', 'null', '-'],
      { windowsHide: true },
    )
    let stderr = ''
    const abortar = (): void => {
      try {
        child.kill()
      } catch {
        /* ja morreu */
      }
    }
    signal?.addEventListener('abort', abortar, { once: true })
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', () => {
      signal?.removeEventListener('abort', abortar)
      resolve(null)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abortar)
      if (signal?.aborted) {
        reject(new Cancelado())
        return
      }
      resolve(code === 0 ? lerResumoDoEbur128(stderr) : null)
    })
  })
}

/** O ganho (dB) que leva o loudness a referencia sem o pico passar do teto. 0 = deixa como esta. */
export function ganhoParaReferencia(l: Loudness): number {
  const ate = REFERENCIA_LUFS - l.lufs
  const folga = TETO_DBTP - l.pico
  const g = Math.max(-GANHO_MAXIMO_DB, Math.min(GANHO_MAXIMO_DB, ate, folga))
  return Math.abs(g) < GANHO_MINIMO_DB ? 0 : Math.round(g * 100) / 100
}

/** Ganho linear em PCM 16 bits (arredonda; o teto do pico ja impede o corte). */
export function aplicarGanho(pcm: Pcm, db: number): Pcm {
  if (db === 0) return pcm
  const g = 10 ** (db / 20)
  const amostras = new Int16Array(pcm.amostras.length)
  for (let i = 0; i < amostras.length; i++) amostras[i] = Math.max(-32768, Math.min(32767, Math.round(pcm.amostras[i]! * g)))
  return { taxa: pcm.taxa, amostras }
}

export interface ResultadoDoVolume {
  pcm: Pcm
  /** O que foi medido (antes do ganho) e o ganho aplicado. null = nao deu para medir (fica como veio). */
  volume: { lufs: number; ganho: number } | null
}

/**
 * Iguala a narracao a referencia. Falhou a medida (ffmpeg, audio mudo): devolve
 * o mesmo PCM, sem erro -- volume nunca derruba um take ja pago.
 */
export async function igualarVolume(pcm: Pcm, signal?: AbortSignal): Promise<ResultadoDoVolume> {
  const pasta = mkdtempSync(join(tmpdir(), 'anirecap-volume-'))
  try {
    const arquivo = join(pasta, 'narracao.wav')
    writeFileSync(arquivo, wavDoPcm(pcm))
    const l = await medirLoudness(arquivo, signal)
    if (!l) return { pcm, volume: null }
    const ganho = ganhoParaReferencia(l)
    return { pcm: aplicarGanho(pcm, ganho), volume: { lufs: l.lufs, ganho } }
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}
