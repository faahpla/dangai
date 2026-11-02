import { basename, join } from 'node:path'
import { mkdirSync, existsSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { ImageAsset } from '@shared/contract'
import { medidasAtuais } from './formato'
import { classifyFile } from '@shared/channels'
import { publish } from './media-server'
import { clipeInvertido } from './inverter'
import { ehDoManga } from './manga'
import { detectFace, detectFocus, type FaceFocus, type RostoNoQuadro } from './faces'
import {
  configureClips,
  extrairFrames,
  makeClipRenderReady,
  makeClipThumbnail,
  probeClip,
  versaoSdr,
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
  /** A imagem inteira sobre ela mesma desfocada (ImageAsset.inteira). Ausente = coberta. */
  inteira?: boolean
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
  const { imagens, erros } = await importar(paths, focus, sections, onProgress, false)
  if (erros[0]) throw erros[0].erro
  return imagens as ImageAsset[]
}

/**
 * Como importImages, mas o arquivo que nao abre vira null (e o motivo vai em
 * `erros`) em vez de derrubar a leva inteira. E o da montagem automatica: um
 * clipe preto na biblioteca (o 0440.mp4 do Faah, 10/2026) jogava fora as 34
 * cenas escolhidas.
 */
export function importImagesPulando(
  paths: readonly string[],
  onProgress?: ImportProgress,
): Promise<{ imagens: (ImageAsset | null)[]; erros: { indice: number; erro: Error }[] }> {
  return importar(paths, undefined, undefined, onProgress, true)
}

async function importar(
  paths: readonly string[],
  focus: readonly ImportFocus[] | undefined,
  sections: readonly (ImportSection | null)[] | undefined,
  onProgress: ImportProgress | undefined,
  pular: boolean,
): Promise<{ imagens: (ImageAsset | null)[]; erros: { indice: number; erro: Error }[] }> {
  mkdirSync(cacheDir, { recursive: true })

  const saida = new Array<ImageAsset | null>(paths.length).fill(null)
  const erros: { indice: number; erro: Error }[] = []
  let proxima = 0
  let feitos = 0

  /*
   * NADA DEPOIS DO FIM. Antes, o primeiro erro rejeitava o Promise.all na hora
   * e os outros trabalhadores seguiam -- mandando "Preparando cena 33 de 34"
   * DEPOIS de a janela ja ter tratado o erro, e o recado ficava preso na barra
   * com os botoes travados. Agora cada um termina o que pegou e para; o erro
   * (quando nao e para pular) so sai quando todos pararam.
   */
  const trabalhar = async (): Promise<void> => {
    while (proxima < paths.length && (pular || erros.length === 0)) {
      const i = proxima++
      try {
        // A ORDEM da saida e a da entrada, e nao a de quem terminou primeiro: ela
        // e a ordem do video.
        saida[i] = await importOne(paths[i]!, focus?.[i], sections?.[i] ?? null)
      } catch (err) {
        erros.push({ indice: i, erro: err instanceof Error ? err : new Error(String(err)) })
        if (!pular) return
      }
      feitos += 1
      onProgress?.(feitos, paths.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(IMPORTE_PARALELO, paths.length) }, trabalhar))
  return { imagens: saida, erros }
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
  inteira = false,
): Promise<string> {
  mkdirSync(cacheDir, { recursive: true })

  // Clipe usa o mesmo controle e a mesma conta; muda so a ferramenta que corta.
  // Custa ~0.28s contra alguns milissegundos da imagem, por isso a interface
  // acompanha o arraste em CSS e so chama aqui quando o usuario solta.
  if (isClip(path)) {
    const fonte = await versaoSdr(path)
    return publish(await makeClipRenderReady(fonte, id, focusX, focusY, await probeClip(fonte)))
  }
  // Inteira: o recorte sai da MONTAGEM, que e o arquivo da cena.
  const fonte = inteira ? (await montarInteira(path)).caminho : path
  return publish(await makeRenderReady(fonte, id, focusX, focusY))
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
    // Clipe HDR vira video comum ANTES de tudo: daqui para baixo todo mundo usa
    // a mesma copia, e o render sai com a cor que o preview mostra.
    const fonte = await versaoSdr(path)
    const info = await probeClip(fonte)

    /*
     * O rosto so e procurado quando ele ainda nao decidiu.
     *
     * `focus` preenchido quer dizer projeto salvo reabrindo, ou enquadramento
     * que ele ja moveu na mao -- em nenhum dos dois casos um detector pode
     * chegar por cima e mexer.
     */
    const detectado = focus ? null : await rostoNoClipe(fonte, info.durationSec)
    const x = clamp01(detectado?.focusX ?? focusX)
    const y = clamp01(detectado?.focusY ?? focusY)

    const [thumbnail, renderPath] = await Promise.all([
      // A duracao vai junto: a miniatura sai da METADE do clipe, e cena de
      // anime pode durar menos de um segundo.
      makeClipThumbnail(fonte, info.durationSec),
      makeClipRenderReady(fonte, id, x, y, info),
    ])

    return {
      id,
      path,
      fileName,
      url: publish(renderPath),
      // O original vai junto, para a tela dividida poder fazer o proprio corte
      // (a copia em cor comum, se o clipe era HDR).
      urlSource: publish(fonte),
      width: info.width,
      height: info.height,
      thumbnail,
      focusX: x,
      focusY: y,
      // Marcado para a interface poder DIZER que mexeu. Enquadrar doze clipes
      // em silencio seria mudar o video sem avisar. Projeto reaberto guarda a
      // marca que tinha (como a imagem, abaixo): sem isso o foco automatico
      // voltava como "posto a mao" e nao era mais atualizado.
      focusAuto: focus ? (focus.focusAuto ?? false) : detectado !== null,
      kind: 'video',
      section: section?.index ?? null,
      ...(section === null ? {} : { sectionName: section.name }),
      durationSec: info.durationSec,
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Não foi possível ler o clipe "${fileName}" (${detail}). Exporte como MP4 H.264 e solte de novo.`,
    )
  }
}

async function importImage(
  path: string,
  focus: ImportFocus | undefined,
  section: ImportSection | null,
): Promise<ImageAsset> {
  /*
   * INTEIRA ou cobrindo. Projeto reaberto diz o que era; importacao nova
   * decide: o quadrinho de manga que perderia mais de um quarto ao cobrir o
   * quadro entra inteiro. Print comum continua cobrindo, como sempre.
   */
  const inteira = focus
    ? focus.inteira === true
    : ehDoManga(path) && sobraAoCobrir(await orientedSize(path).catch(() => null)) < SOBRA_MINIMA
  return inteira ? importarInteira(path, focus, section) : importarCoberta(path, focus, section)
}

/** O print cobrindo o quadro, recortado no rosto: o caminho de sempre. */
async function importarCoberta(
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
      /*
       * O original vai junto tambem no print.
       *
       * Nao e para a tela dividida -- essa continua sendo coisa de clipe. E
       * para o GIRO: `url` ja vem recortado em 9:16, e girar um quarto de volta
       * um quadro recortado ampliaria uma tira estreita ate cobrir a tela. Com
       * o original, o recorte acontece DEPOIS do giro e a imagem inteira volta
       * a estar disponivel.
       *
       * Publicar nao custa render: `url` continua sendo a versao reduzida, e o
       * original so e lido quando o bloco esta girado.
       */
      urlSource: publish(path),
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
      `Não foi possível ler "${fileName}" (${detail}). Salve a imagem como PNG ou JPG e solte de novo.`,
    )
  }
}

/**
 * Abaixo disto de imagem sobrando ao cobrir o quadro, o quadrinho de manga
 * entra inteiro. Uma pagina (687x1080) perde 12% e cobre; um quadrinho deitado
 * em 9:16 perderia 64%.
 */
const SOBRA_MINIMA = 0.75

/** Quanto da imagem continua no quadro ao cobri-lo: 1 = tudo. */
export function sobraAoCobrir(medidas: { width: number; height: number } | null): number {
  if (!medidas) return 1
  const { renderWidth, renderHeight } = medidasAtuais()
  const a = medidas.width / medidas.height
  const b = renderWidth / renderHeight
  return Math.min(a / b, b / a)
}

/**
 * A MONTAGEM da imagem inteira: ela no meio do quadro, sobre ela mesma
 * ampliada, desfocada e escurecida.
 *
 * Uma vez e meia o quadro, para a camera livre ter de onde ampliar antes de o
 * proprio quadrinho borrar. No cache pelo arquivo, pela data dele e pelo
 * quadro: o mesmo quadrinho em dois blocos e uma montagem so.
 */
const FOLGA_DA_MONTAGEM = 1.5

export async function montarInteira(path: string): Promise<{ caminho: string; width: number; height: number }> {
  const { renderWidth, renderHeight } = medidasAtuais()
  const width = Math.round(renderWidth * FOLGA_DA_MONTAGEM)
  const height = Math.round(renderHeight * FOLGA_DA_MONTAGEM)
  let data = 0
  try {
    data = Math.round(statSync(path).mtimeMs)
  } catch {
    // O sharp logo abaixo da o erro que importa.
  }
  const chave = createHash('sha1').update(`${path}|${data}|${width}x${height}`).digest('hex').slice(0, 20)
  const caminho = join(cacheDir, `inteira-${chave}.jpg`)
  if (existsSync(caminho)) return { caminho, width, height }

  mkdirSync(cacheDir, { recursive: true })
  /*
   * O desfoque sai de uma copia PEQUENA ampliada de volta: o mesmo efeito de
   * um blur forte no tamanho cheio, numa fracao do tempo.
   */
  const [fundo, frente] = await Promise.all([
    sharp(path)
      .rotate()
      .resize(Math.round(width / 8), Math.round(height / 8), { fit: 'cover' })
      .blur(8)
      .modulate({ brightness: 0.55 })
      .toBuffer()
      .then((pequeno) => sharp(pequeno).resize(width, height).toBuffer()),
    sharp(path).rotate().resize(width, height, { fit: 'inside' }).toBuffer({ resolveWithObject: true }),
  ])
  await sharp(fundo)
    .composite([
      {
        input: frente.data,
        left: Math.round((width - frente.info.width) / 2),
        top: Math.round((height - frente.info.height) / 2),
      },
    ])
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(caminho)
  return { caminho, width, height }
}

/**
 * Importa a imagem INTEIRA: a cena passa a ser a montagem (ver montarInteira).
 *
 * Sem procurar rosto: a montagem ja tem o formato do quadro, entao nao ha
 * recorte para mirar. `path` continua o original -- e por ele que a
 * Biblioteca e o projeto salvo reconhecem a imagem.
 */
async function importarInteira(
  path: string,
  focus: ImportFocus | undefined,
  section: ImportSection | null,
): Promise<ImageAsset> {
  const fileName = basename(path)
  try {
    const id = randomUUID()
    const montagem = await montarInteira(path)
    const focusX = clamp01(focus?.focusX ?? 0.5)
    const focusY = clamp01(focus?.focusY ?? 0.5)
    const [thumbnail, renderPath] = await Promise.all([
      makeThumbnail(path),
      makeRenderReady(montagem.caminho, id, focusX, focusY),
    ])
    return {
      id,
      path,
      fileName,
      // A camera livre e o giro partem da montagem, nao do quadrinho cru.
      urlSource: publish(montagem.caminho),
      url: publish(renderPath),
      width: montagem.width,
      height: montagem.height,
      thumbnail,
      focusX,
      focusY,
      focusAuto: false,
      kind: 'image',
      section: section?.index ?? null,
      ...(section === null ? {} : { sectionName: section.name }),
      inteira: true,
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Não foi possível ler "${fileName}" (${detail}). Salve a imagem como PNG ou JPG e solte de novo.`,
    )
  }
}

/**
 * Liga ou desliga a imagem inteira de um print ja importado.
 *
 * Os ajustes do bloco (camera, movimento, curva) ficam: moram na cena, e aqui
 * so troca o arquivo que ela mostra. Voltando a cobrir, o rosto e procurado
 * de novo, como numa importacao nova.
 */
export async function alternarInteira(asset: ImageAsset, inteira: boolean): Promise<ImageAsset> {
  if (asset.kind !== 'image') throw new Error('Só imagem pode aparecer inteira.')
  const secao = asset.section === null ? null : { index: asset.section, name: asset.sectionName ?? '' }
  const nova = inteira
    ? await importarInteira(asset.path, undefined, secao)
    : await importarCoberta(asset.path, undefined, secao)
  if (asset.sectionName !== undefined || nova.sectionName === undefined) return nova
  // A parte vai junto; o nome so se ela tinha.
  const { sectionName: _semNome, ...resto } = nova
  return resto
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
  const medidas = medidasAtuais()
  const scale = Math.max(medidas.renderWidth / width, medidas.renderHeight / height)
  const scaledWidth = Math.max(Math.ceil(width * scale), medidas.renderWidth)
  const scaledHeight = Math.max(Math.ceil(height * scale), medidas.renderHeight)

  await sharp(path)
    .rotate()
    .resize(scaledWidth, scaledHeight, { fit: 'fill' })
    .extract({
      left: Math.round((scaledWidth - medidas.renderWidth) * x),
      top: Math.round((scaledHeight - medidas.renderHeight) * y),
      width: medidas.renderWidth,
      height: medidas.renderHeight,
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

/**
 * Onde o rosto esta em cada instante pedido do clipe.
 *
 * Serve a camera livre: com o rosto no comeco e no fim do bloco, as duas pontas
 * da camera saem prontas e o movimento acompanha o personagem em vez de ficar
 * parado enquanto ele atravessa o quadro.
 *
 * Devolve UMA entrada por instante, com null onde nao houve rosto confiavel --
 * e nao uma lista curta. Quem chamou precisa saber QUAL instante falhou: um
 * rosto achado so no comeco ainda serve para metade do trabalho, e a interface
 * so consegue dizer isso se a posicao for preservada.
 *
 * Print entra pelo mesmo caminho e nao passa por ffmpeg: nele o rosto nao anda,
 * entao um instante responde por todos.
 */
export async function rostoNosInstantes(
  path: string,
  instantes: readonly number[],
): Promise<(RostoNoQuadro | null)[]> {
  if (!isClip(path)) {
    const achado = await detectFace(path).catch(() => null)
    return instantes.map(() => achado)
  }

  const comum = await versaoSdr(path)
  const info = await probeClip(comum)
  if (info.durationSec <= 0) return instantes.map(() => null)

  /*
   * O extrairFrames fala em FRACAO da duracao, e aqui os instantes sao
   * segundos. A conversao mora deste lado porque quem sabe a duracao e quem
   * acabou de sondar o arquivo.
   */
  const fracoes = instantes.map((t) =>
    Math.min(Math.max(t / info.durationSec, 0), 1),
  )

  const frames = await extrairFrames(comum, info.durationSec, fracoes)
  // extrairFrames pula o instante que nao abre, entao a lista pode vir menor.
  // Sem os quadros na mesma quantidade nao da para dizer qual e qual.
  if (frames.length !== instantes.length) return instantes.map(() => null)

  const achados: (RostoNoQuadro | null)[] = []
  for (const frame of frames) {
    achados.push(await detectFace(frame).catch(() => null))
  }
  return achados
}

/**
 * Liga ou desliga o "tocar de tras para frente" de um clipe ja importado.
 *
 * Refaz o recorte 9:16 a partir da copia invertida (ou do original, ao
 * desligar). O recorte invertido ganha chave propria no cache -- `id-inv` --
 * porque o cache e por id e enquadramento, e sem isto o original e o invertido
 * de um mesmo clipe se devolveriam um ao outro.
 */
export async function inverterAsset(asset: ImageAsset, invertido: boolean): Promise<ImageAsset> {
  if (asset.kind !== 'video') throw new Error('Só clipe pode tocar invertido.')
  const comum = await versaoSdr(asset.path)
  const fonte = invertido ? await clipeInvertido(comum) : comum
  const render = await makeClipRenderReady(
    fonte,
    invertido ? `${asset.id}-inv` : asset.id,
    asset.focusX,
    asset.focusY,
    await probeClip(fonte),
  )
  const { caminhoInvertido: _velho, ...resto } = asset
  return {
    ...resto,
    invertido,
    ...(invertido ? { caminhoInvertido: fonte } : {}),
    url: publish(render),
    urlSource: publish(fonte),
  }
}
