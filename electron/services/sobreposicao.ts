import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import sharp from 'sharp'
import { ffmpegPath } from './ffmpeg-path'
import { probeClip } from './clips'

/**
 * Prepara um arquivo para a FAIXA DE VIDEO (setas, circulos, emoji animado).
 *
 * O .mov que ele exporta do editor costuma ser ProRes 4444 ou QuickTime
 * Animation com canal alfa -- o fundo vazado e o que faz a seta flutuar sobre a
 * cena. Nem o preview (Chromium) nem o <video> tocam ProRes. O que os dois
 * tocam COM transparencia e WebM VP9 com alfa, e e para isso que o .mov e
 * convertido, uma vez, num cache pela identidade do arquivo.
 *
 * WebM e MP4 ja tocam e entram como estao (MP4 nao tem alfa, mas pode ser um
 * overlay opaco de proposito). Imagem entra direto.
 */

let cacheDir: string | null = null

export function configureSobreposicao(userDataDir: string): void {
  cacheDir = join(userDataDir, 'sobreposicoes')
}

function dir(): string {
  if (!cacheDir) throw new Error('Sobreposicao nao configurada')
  mkdirSync(cacheDir, { recursive: true })
  return cacheDir
}

const TOCA_DIRETO = ['.webm', '.mp4', '.m4v']

export interface SobreposicaoPronta {
  /** O arquivo que o preview e o render vao tocar. */
  arquivo: string
  tipo: 'video' | 'image'
  durationSec: number
  aspecto: number
}

export async function prepararSobreposicao(path: string): Promise<SobreposicaoPronta> {
  const ext = extname(path).toLowerCase()

  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    const meta = await sharp(path).metadata()
    return {
      arquivo: path,
      tipo: 'image',
      // Imagem nao tem duracao: o teto e largo, e quanto ela fica na tela e
      // decidido na faixa (nasce com 3 s).
      durationSec: 3600,
      aspecto: meta.width && meta.height ? meta.width / meta.height : 1,
    }
  }

  const info = await probeClip(path)
  const aspecto = info.width / info.height
  if (TOCA_DIRETO.includes(ext)) {
    return { arquivo: path, tipo: 'video', durationSec: info.durationSec, aspecto }
  }

  const s = statSync(path)
  const chave = createHash('sha1').update(`${path}|${s.size}|${s.mtimeMs}`).digest('hex').slice(0, 20)
  const alvo = join(dir(), `${chave}.webm`)
  if (!existsSync(alvo)) {
    const parcial = `${alvo}.part.webm`
    try {
      await rodar([
        '-y', '-hide_banner', '-loglevel', 'error', '-i', path,
        // yuva420p guarda o canal alfa; sem alfa na fonte, ele sai opaco.
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
        '-b:v', '0', '-crf', '24', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
        // Alfa em VP9 exige isto desligado.
        '-auto-alt-ref', '0',
        '-an', parcial,
      ])
      renameSync(parcial, alvo)
    } catch (erro) {
      rmSync(parcial, { force: true })
      throw erro
    }
  }
  return { arquivo: alvo, tipo: 'video', durationSec: info.durationSec, aspecto }
}

function rodar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Nao deu para preparar o video: ${stderr.trim().split('\n').slice(-2).join(' ')}`)),
    )
  })
}
