import { basename, join } from 'node:path'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { RENDER_HEIGHT, RENDER_WIDTH, type ImageAsset } from '@shared/contract'
import { classifyFile } from '@shared/channels'
import { publish } from './media-server'
import { detectFocus, type FaceFocus } from './faces'
import {
  configureClips,
  extrairFrames,
  makeClipRenderReady,
  makeClipThumbnail,
  probeClip,
} from './clips'

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
/**
 * Quantos arquivos sao preparados ao mesmo tempo.
 *
 * Era `Promise.all` na lista inteira: doze clipes viravam doze ffmpeg
 * simultaneos re-codificando 1080p, a maquina inteira parava e a janela do app
 * congelava. Palavras dele: "o app deu uma congelada ate carregar tudo na
 * timeline, eu acho necessario ter algum tipo de loading pra eu nao acabar
 * fechando tudo achando que travou".
 *
 * Tres de cada vez mantem os nucleos ocupados sem sequestrar a maquina, e --
 * mais importante -- deixa o andamento aparecer de verdade em vez de tudo
 * terminar junto no fim.
 */
const IMPORTE_PARALELO = 3

export type ImportProgress = (feitos: number, total: number) => void

export async function importImages(
  paths: readonly string[],
  focus?: readonly ImportFocus[],
  sections?: readonly (ImportSection | null)[],
  onProgress?: ImportProgress,
): Promise<ImageAsset[]> {
  mkdirSync(cacheDir, { recursive: true })

  const saida = new Array<ImageAsset>(paths.length)
  let proxima = 0
  let feitos = 0

  const trabalhar = async (): Promise<void> => {
    while (proxima < paths.length) {
      const i = proxima++
      // A ORDEM da saida e a da entrada, e nao a de quem terminou primeiro: ela
      // e a ordem do video.
      saida[i] = await importOne(paths[i]!, focus?.[i], sections?.[i] ?? null)
      feitos += 1
      onProgress?.(feitos, paths.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(IMPORTE_PARALELO, paths.length) }, trabalhar))
  return saida
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
 * Quantos frames do clipe o detector de rosto olha.
 *
 * Um clipe nao tem "a imagem": o personagem pode entrar no quadro depois do
 * primeiro segundo, ou sair antes do fim. Olhar um instante so decidiria o
 * enquadramento pela sorte -- tres cobrem a cena sem virar rastreamento quadro
 * a quadro, que faria o recorte pular ao longo do bloco.
 *
 * TRES, e nao cinco: medido em 28 cenas reais da biblioteca dele, cinco
 * amostras acharam exatamente os mesmos rostos, custaram 34% mais tempo e
 * ainda trouxeram um falso positivo a mais. O que limita nao e quantas vezes
 * se olha -- e o detector, que nao dispara em perfil, nuca e plano aberto.
 */
const FRAMES_DE_ROSTO = [0.25, 0.5, 0.75] as const

/**
 * Importa um clipe: sonda, acha o rosto, gera a miniatura e converte para 9:16.
 *
 * O recorte 9:16 joga fora 68% da largura de um quadro 16:9, e ate a v1.11 o
 * clipe sempre ficava com o terco central -- o mesmo problema que o print ja
 * tinha resolvido. Pedido dele: "e importante os clipes serem automaticamente
 * identificado os rostos".
 *
 * O detector e o mesmo do print (lbpcascade_animeface). A diferenca e que aqui
 * ele olha TRES instantes e fica com o maior rosto entre eles. O enquadramento
 * continua sendo UM para o bloco inteiro: seguir o rosto quadro a quadro faria
 * a imagem deslizar sozinha, que e pior que um recorte fixo levemente errado.
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

    /*
     * O rosto so e procurado quando ele ainda nao decidiu.
     *
     * `focus` preenchido quer dizer projeto salvo reabrindo, ou enquadramento
     * que ele ja moveu na mao -- em nenhum dos dois casos um detector pode
     * chegar por cima e mexer.
     */
    const detectado = focus ? null : await rostoNoClipe(path, info.durationSec)
    const x = clamp01(detectado?.focusX ?? focusX)
    const y = clamp01(detectado?.focusY ?? focusY)

    const [thumbnail, renderPath] = await Promise.all([
      // A duracao vai junto: a miniatura sai da METADE do clipe, e cena de
      // anime pode durar menos de um segundo.
      makeClipThumbnail(path, info.durationSec),
      makeClipRenderReady(path, id, x, y, info),
    ])

    return {
      id,
      path,
      fileName,
      url: publish(renderPath),
      // O original vai junto, para a tela dividida poder fazer o proprio corte.
      urlSource: publish(path),
      width: info.width,
      height: info.height,
      thumbnail,
      focusX: x,
      focusY: y,
      // Marcado para a interface poder DIZER que mexeu. Enquadrar doze clipes
      // em silencio seria mudar o video sem avisar.
      focusAuto: detectado !== null,
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
      // Print nao entra em tela dividida -- a divisao existe para mostrar duas
      // CENAS ao mesmo tempo, e print ja e um quadro parado.
      urlSource: null,
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

/**
 * O enquadramento sugerido para um CLIPE, olhando alguns instantes dele.
 *
 * Fica com o maior rosto encontrado entre os frames, pelo mesmo motivo que o
 * print fica com o maior dentro de um quadro: quem esta em primeiro plano e
 * quem a cena esta mostrando. Devolve null quando nenhum instante tinha rosto
 * confiavel -- ai o clipe fica no centro, como sempre ficou.
 */
async function rostoNoClipe(path: string, durationSec: number): Promise<FaceFocus | null> {
  let frames: string[] = []
  try {
    frames = await extrairFrames(path, durationSec, FRAMES_DE_ROSTO)
    let melhor: FaceFocus | null = null
    for (const frame of frames) {
      const achado = await detectFocus(frame).catch(() => null)
      if (achado && (melhor === null || achado.area > melhor.area)) melhor = achado
    }
    return melhor
  } catch {
    // Rosto e melhoria, nunca requisito: falhar aqui deixa o clipe no centro.
    return null
  } finally {
    /*
     * Apagar e melhor esforco, nunca requisito.
     *
     * No Windows o sharp pode ainda estar com o arquivo aberto quando chegamos
     * aqui, e o EPERM subia como "Nao foi possivel ler o clipe" -- derrubando a
     * importacao inteira por causa de um temporario. Eles ficam no cache do
     * sistema, tem nome deterministico (o proximo import sobrescreve) e pesam
     * 100 KB.
     */
    for (const frame of frames) {
      try {
        rmSync(frame, { force: true })
      } catch {
        // Fica para o proximo import sobrescrever.
      }
    }
  }
}
