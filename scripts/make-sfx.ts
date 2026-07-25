import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import ffmpegStatic from 'ffmpeg-static'

/**
 * Gera os SFX que vem com o app.
 *
 * Sao sintetizados aqui, e nao arquivos baixados, por um motivo pratico: whoosh
 * e impact prontos sao material licenciado e nao podem ser distribuidos junto.
 * Estes soam genericos de proposito -- funcionam, e a pasta e configuravel para
 * o usuario trocar pelos dele.
 *
 * Rode com: npm run sfx
 */

const SAMPLE_RATE = 48000

function wavHeader(samples: number): Buffer {
  const dataSize = samples * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  return header
}

function toWav(path: string, signal: readonly number[]): void {
  const pcm = Buffer.alloc(signal.length * 2)
  for (let i = 0; i < signal.length; i++) {
    const clamped = Math.max(-1, Math.min(1, signal[i]!))
    pcm.writeInt16LE(Math.round(clamped * 32767), i * 2)
  }
  writeFileSync(path, Buffer.concat([wavHeader(signal.length), pcm]))
}

/**
 * Whoosh: ruido branco passando por um passa-banda que varre de grave para
 * agudo e volta, com envelope em sino. E o que da a sensacao de algo cruzando
 * o quadro.
 */
function whoosh(durationSec = 0.45): number[] {
  const n = Math.floor(SAMPLE_RATE * durationSec)
  const out = new Array<number>(n)

  // Filtro de um polo, com o corte varrendo ao longo do tempo.
  let low = 0
  let band = 0

  for (let i = 0; i < n; i++) {
    const t = i / n
    const noise = Math.random() * 2 - 1

    // A varredura sobe rapido e desce devagar.
    const sweep = Math.sin(t * Math.PI) ** 0.7
    const cutoff = 0.02 + sweep * 0.45

    low += cutoff * (noise - low)
    band = low - band * 0.35

    // Envelope em sino: entra e sai sem clique.
    const envelope = Math.sin(t * Math.PI) ** 1.6
    out[i] = band * envelope * 0.9
  }
  return out
}

/**
 * Impact: transiente curto de ruido somado a um grave que decai rapido. O grave
 * cai de frequencia junto com a amplitude, que e o que da peso ao golpe.
 */
function impact(durationSec = 0.6): number[] {
  const n = Math.floor(SAMPLE_RATE * durationSec)
  const out = new Array<number>(n)
  let phase = 0

  for (let i = 0; i < n; i++) {
    const t = i / n

    // Grave descendo de 110Hz para 45Hz.
    const freq = 110 - 65 * Math.min(t * 3, 1)
    phase += (2 * Math.PI * freq) / SAMPLE_RATE
    const body = Math.sin(phase) * Math.exp(-t * 7)

    // Estalo inicial, so nos primeiros milissegundos.
    const click = (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.5

    out[i] = Math.tanh((body + click) * 1.4) * 0.85
  }
  return out
}

async function encode(wavPath: string, mp3Path: string): Promise<void> {
  const ffmpeg = ffmpegStatic
  if (!ffmpeg) throw new Error('ffmpeg-static nao encontrado')

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpeg.replace('app.asar', 'app.asar.unpacked'),
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', wavPath,
       '-ac', '2', '-ar', '48000', '-b:a', '192k', mp3Path],
      { windowsHide: true },
    )
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg saiu ${code}`))))
  })
}

const outDir = join(process.cwd(), 'assets', 'sfx')
mkdirSync(outDir, { recursive: true })
const temp = tmpdir()

for (const [name, signal] of [
  ['whoosh', whoosh()],
  ['impact', impact()],
] as const) {
  const wav = join(temp, `dangai-sfx-${name}.wav`)
  toWav(wav, signal)
  await encode(wav, join(outDir, `${name}.mp3`))
  rmSync(wav, { force: true })
  console.log(`gerado: assets/sfx/${name}.mp3`)
}
