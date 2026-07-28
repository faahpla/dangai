import { basename, join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { RENDER_HEIGHT, RENDER_WIDTH, type ImageAsset } from '@shared/contract'
import { publish } from './media-server'
import { detectFocus } from './faces'

/** Largura da miniatura usada no strip e nas tiras da timeline. */
const THUMBNAIL_WIDTH = 220

const cacheDir = join(tmpdir(), 'dangai-render-cache')

/** Enquadramento ja escolhido, quando a imagem vem de um projeto salvo. */
export interface ImportFocus {
  focusX: number
  focusY: number
  /** Se aquele enquadramento tinha vindo do detector. Preserva a marca ao reabrir. */
  focusAuto?: boolean
}

/**
 * Le as dimensoes reais, gera a miniatura e a versao pronta para render. A ordem
 * do array de entrada e preservada na saida: a ordem em que o usuario solta e a
 * ordem do video.
 *
 * `focus` chega preenchido ao abrir um projeto salvo. Sem ele o recorte sairia
 * centralizado e so depois seria refeito imagem por imagem -- o dobro do
 * trabalho do sharp, e um piscar de enquadramento errado na tela.
 */
export async function importImages(
  paths: readonly string[],
  focus?: readonly ImportFocus[],
): Promise<ImageAsset[]> {
  mkdirSync(cacheDir, { recursive: true })
  return Promise.all(paths.map((path, index) => importOne(path, focus?.[index])))
}

/**
 * Refaz o recorte 9:16 de uma imagem ja importada com outro enquadramento.
 *
 * O recorte acontece aqui e nao em CSS de proposito: o que o preview mostra tem
 * que ser byte a byte o que o render consome. Deixar o corte para o objectFit
 * significaria publicar a imagem inteira -- uma foto 16:9 que cobre 1242x2208
 * tem 3925px de largura, e o Chrome rasterizaria isso em cada um dos 1800
 * frames.
 */
export async function reframeImage(
  id: string,
  path: string,
  focusX: number,
  focusY: number,
): Promise<string> {
  mkdirSync(cacheDir, { recursive: true })
  return publish(await makeRenderReady(path, id, focusX, focusY))
}

async function importOne(path: string, focus?: ImportFocus): Promise<ImageAsset> {
  const fileName = basename(path)

  /*
   * So procura rosto quando o enquadramento ainda nao foi decidido.
   *
   * Abrir projeto salvo passa o foco pronto, e ali a escolha ja e do usuario --
   * mesmo quando ela veio de uma deteccao anterior. Redetectar desfaria o
   * arraste que ele fez na mao.
   */
  const detectado = focus ? null : await detectFocus(path).catch(() => null)

  const focusX = clamp01(focus?.focusX ?? detectado?.focusX ?? 0.5)
  const focusY = clamp01(focus?.focusY ?? detectado?.focusY ?? 0.5)

  try {
    const id = randomUUID()
    const { width, height } = await orientedSize(path)
    const [thumbnail, renderPath] = await Promise.all([
      makeThumbnail(path),
      makeRenderReady(path, id, focusX, focusY),
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
      focusX,
      focusY,
      focusAuto: focus ? (focus.focusAuto ?? false) : detectado !== null,
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Nao foi possivel ler "${fileName}" (${detail}). Salve a imagem como PNG ou JPG e solte de novo.`,
    )
  }
}

/**
 * Dimensoes como a imagem aparece depois de aplicada a orientacao EXIF.
 *
 * `sharp().metadata()` devolve os pixels como estao gravados; uma foto de
 * celular em retrato costuma chegar como paisagem com orientacao 6. Sem a troca
 * o app trataria um retrato como paisagem e o recorte sairia do eixo errado.
 */
async function orientedSize(path: string): Promise<{ width: number; height: number }> {
  const metadata = await sharp(path, { failOn: 'error' }).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('dimensoes ilegiveis')

  const rotated = (metadata.orientation ?? 1) >= 5
  return rotated ? { width: height, height: width } : { width, height }
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
 * Recorta para 9:16 cobrindo o quadro, no tamanho exato que o render precisa,
 * ancorado no ponto escolhido pelo usuario.
 *
 * O `position` do sharp so aceita nove ancoras discretas, entao o recorte e
 * feito na mao: escala ate cobrir e extrai a janela na posicao proporcional.
 */
async function makeRenderReady(
  path: string,
  id: string,
  focusX: number,
  focusY: number,
): Promise<string> {
  const x = clamp01(focusX)
  const y = clamp01(focusY)

  // O enquadramento entra no nome: mudar o foco tem que gerar outro arquivo,
  // senao o cache devolveria o recorte antigo. O id e sorteado na importacao,
  // entao dois arquivos diferentes nunca disputam o mesmo nome.
  const target = join(cacheDir, `${id}-${Math.round(x * 1000)}-${Math.round(y * 1000)}.jpg`)
  if (existsSync(target)) return target

  const { width, height } = await orientedSize(path)

  // Escala minima que ainda cobre o quadro inteiro -- o mesmo que objectFit
  // cover faria, so que resolvido em pixels antes do render.
  const scale = Math.max(RENDER_WIDTH / width, RENDER_HEIGHT / height)
  const scaledWidth = Math.max(Math.ceil(width * scale), RENDER_WIDTH)
  const scaledHeight = Math.max(Math.ceil(height * scale), RENDER_HEIGHT)

  await sharp(path)
    .rotate()
    .resize(scaledWidth, scaledHeight, { fit: 'fill' })
    .extract({
      left: Math.round((scaledWidth - RENDER_WIDTH) * x),
      top: Math.round((scaledHeight - RENDER_HEIGHT) * y),
      width: RENDER_WIDTH,
      height: RENDER_HEIGHT,
    })
    // JPEG de qualidade alta: o Remotion serializa cada frame como JPEG de
    // qualquer forma, entao PNG aqui so custaria tempo de decodificacao.
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(target)

  return target
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.5
}
