import { basename, join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { RENDER_HEIGHT, RENDER_WIDTH, type ImageAsset } from '@shared/contract'
import { classifyFile } from '@shared/channels'
import { publish } from './media-server'
import { detectFocus } from './faces'
import { configureClips, makeClipRenderReady, makeClipThumbnail, probeClip } from './clips'

/** Largura da miniatura usada no strip e nas tiras da timeline. */
const THUMBNAIL_WIDTH = 220

const cacheDir = join(tmpdir(), 'dangai-render-cache')
configureClips(cacheDir)

/** Clipe e print dividem a esteira; so o jeito de preparar o arquivo difere. */
function isClip(path: string): boolean {
  return classifyFile(path) === 'video'
}

/** Enquadramento ja escolhido, quando a imagem vem de um projeto salvo. */
export interface ImportFocus {
  focusX: number
  focusY: number
  /** Se aquele enquadramento tinha vindo do detector. Preserva a marca ao reabrir. */
  focusAuto?: boolean
}

/**
 * A qual parte do roteiro o material pertence.
 *
 * Vem separado do `focus` de proposito. Em `importOne`, `focus` preenchido quer
 * dizer "o usuario ja decidiu o enquadramento" e por isso desliga a deteccao de
 * rosto. Se a parte viajasse dentro dele, soltar pastas desligaria o
 * enquadramento automatico sem nenhuma relacao de causa -- um efeito colateral
 * invisivel ate alguem comparar dois videos e nao entender a diferenca.
 */
export interface ImportSection {
  index: number
  name: string
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
  sections?: readonly (ImportSection | null)[],
): Promise<ImageAsset[]> {
  mkdirSync(cacheDir, { recursive: true })
  return Promise.all(
    paths.map((path, index) => importOne(path, focus?.[index], sections?.[index] ?? null)),
  )
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

  // Clipe usa o mesmo controle e a mesma conta; muda so a ferramenta que corta.
  // Custa ~0.28s contra alguns milissegundos da imagem, por isso a interface
  // acompanha o arraste em CSS e so chama aqui quando o usuario solta.
  if (isClip(path)) {
    return publish(await makeClipRenderReady(path, id, focusX, focusY, await probeClip(path)))
  }
  return publish(await makeRenderReady(path, id, focusX, focusY))
}

async function importOne(
  path: string,
  focus: ImportFocus | undefined,
  section: ImportSection | null,
): Promise<ImageAsset> {
  return isClip(path) ? importClip(path, focus, section) : importImage(path, focus, section)
}

/**
 * Importa um clipe: sonda, gera a miniatura e converte para o quadro 9:16.
 *
 * Nao ha deteccao de rosto aqui. O detector foi medido em imagem parada; num
 * clipe ele teria que rodar quadro a quadro para significar alguma coisa, e o
 * enquadramento ficaria pulando de rosto em rosto ao longo do bloco. Clipe
 * comeca no centro e o usuario ajusta, que e o mesmo controle da imagem.
 */
async function importClip(
  path: string,
  focus: ImportFocus | undefined,
  section: ImportSection | null,
): Promise<ImageAsset> {
  const fileName = basename(path)

  const focusX = clamp01(focus?.focusX ?? 0.5)
  const focusY = clamp01(focus?.focusY ?? 0.5)

  try {
    const id = randomUUID()
    const info = await probeClip(path)
    const [thumbnail, renderPath] = await Promise.all([
      makeClipThumbnail(path),
      makeClipRenderReady(path, id, focusX, focusY, info),
    ])

    return {
      id,
      path,
      fileName,
      url: publish(renderPath),
      width: info.width,
      height: info.height,
      thumbnail,
      focusX,
      focusY,
      focusAuto: false,
      kind: 'video',
      section: section?.index ?? null,
      ...(section === null ? {} : { sectionName: section.name }),
      durationSec: info.durationSec,
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Nao foi possivel ler o clipe "${fileName}" (${detail}). Exporte como MP4 H.264 e solte de novo.`,
    )
  }
}

async function importImage(
  path: string,
  focus: ImportFocus | undefined,
  section: ImportSection | null,
): Promise<ImageAsset> {
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
      kind: 'image',
      section: section?.index ?? null,
      ...(section === null ? {} : { sectionName: section.name }),
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
