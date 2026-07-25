import { basename, join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { VIDEO_HEIGHT, VIDEO_WIDTH, type ImageAsset } from '@shared/contract'
import { publish } from './media-server'

/** Largura da miniatura usada no strip e nas tiras da timeline. */
const THUMBNAIL_WIDTH = 220

/**
 * Folga de escala para o Ken Burns. A imagem de render tem 1.15x o quadro final:
 * com scale(1.15) a regiao visivel volta a ser exatamente 1080 pixels nativos,
 * entao nao ha upscale visivel nem pixel desperdicado.
 */
const RENDER_HEADROOM = 1.15
const RENDER_WIDTH = Math.round(VIDEO_WIDTH * RENDER_HEADROOM)
const RENDER_HEIGHT = Math.round(VIDEO_HEIGHT * RENDER_HEADROOM)

const cacheDir = join(tmpdir(), 'dangai-render-cache')

/**
 * Le as dimensoes reais, gera a miniatura e a versao pronta para render. A ordem
 * do array de entrada e preservada na saida: a ordem em que o usuario solta e a
 * ordem do video.
 */
export async function importImages(paths: readonly string[]): Promise<ImageAsset[]> {
  mkdirSync(cacheDir, { recursive: true })
  return Promise.all(paths.map(importOne))
}

async function importOne(path: string): Promise<ImageAsset> {
  const fileName = basename(path)

  try {
    const metadata = await sharp(path, { failOn: 'error' }).metadata()
    const width = metadata.width
    const height = metadata.height

    if (!width || !height) {
      throw new Error('dimensoes ilegiveis')
    }

    const id = randomUUID()

    const [thumbnail, renderPath] = await Promise.all([
      makeThumbnail(path),
      makeRenderReady(path, id),
    ])

    return {
      id,
      path,
      fileName,
      // Publica a versao reduzida, nao a original: e o que o preview e o render
      // consomem, e a diferenca no tempo de render e grande.
      url: publish(renderPath),
      width,
      height,
      thumbnail,
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Nao foi possivel ler "${fileName}" (${detail}). Salve a imagem como PNG ou JPG e solte de novo.`,
    )
  }
}

async function makeThumbnail(path: string): Promise<string> {
  const buffer = await sharp(path)
    .rotate() // respeita a orientacao EXIF
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer()

  return `data:image/webp;base64,${buffer.toString('base64')}`
}

/**
 * Recorta para 9:16 cobrindo o quadro, no tamanho exato que o render precisa.
 *
 * Isto e a diferenca entre bater e nao bater os 90 segundos de render: sem
 * isso o Chrome rasteriza a imagem inteira em resolucao original a cada um dos
 * 1800 frames. O recorte centralizado e o mesmo que o objectFit cover faria.
 */
async function makeRenderReady(path: string, id: string): Promise<string> {
  const target = join(cacheDir, `${id}.jpg`)
  if (existsSync(target)) return target

  await sharp(path)
    .rotate()
    .resize({
      width: RENDER_WIDTH,
      height: RENDER_HEIGHT,
      fit: 'cover',
      position: 'centre',
    })
    // JPEG de qualidade alta: o Remotion serializa cada frame como JPEG de
    // qualquer forma, entao PNG aqui so custaria tempo de decodificacao.
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(target)

  return target
}
