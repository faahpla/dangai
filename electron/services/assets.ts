import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { ImageAsset } from '@shared/contract'

/** Largura da miniatura usada no strip e nas tiras da timeline. */
const THUMBNAIL_WIDTH = 220

/**
 * Le as dimensoes reais e gera a miniatura. A ordem do array de entrada e
 * preservada na saida: a ordem em que o usuario solta e a ordem do video.
 */
export async function importImages(paths: readonly string[]): Promise<ImageAsset[]> {
  return Promise.all(paths.map(importOne))
}

async function importOne(path: string): Promise<ImageAsset> {
  const fileName = basename(path)

  try {
    const image = sharp(path, { failOn: 'error' })
    const metadata = await image.metadata()
    const width = metadata.width
    const height = metadata.height

    if (!width || !height) {
      throw new Error('dimensoes ilegiveis')
    }

    const thumbnail = await image
      .rotate() // respeita a orientacao EXIF
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()

    return {
      id: randomUUID(),
      path,
      fileName,
      width,
      height,
      thumbnail: `data:image/webp;base64,${thumbnail.toString('base64')}`,
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Nao foi possivel ler "${fileName}" (${detail}). Salve a imagem como PNG ou JPG e solte de novo.`)
  }
}
