import { existsSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { RENDER_HEIGHT, RENDER_WIDTH } from '@shared/contract'

/**
 * Onde esta o rosto, para o recorte 9:16 nao cortar a cabeca do personagem.
 *
 * Um print 16:9 perde 68% da largura ao virar 9:16, e ate agora o app sempre
 * ficava com o terco central. Medido nas 46 imagens de um episodio real: o
 * centro acerta na maioria, mas em 4 delas mostrava roupa, fundo desfocado ou um
 * tufo de cabelo -- nenhum rosto. Sao essas que isto resgata.
 *
 * Detector: lbpcascade_animeface (nagadomi), um cascade LBP de 247 KB rodando no
 * OpenCV compilado para WebAssembly. A escolha e por peso: os detectores
 * modernos de rosto de anime sao PyTorch, o que somaria gigabytes ao instalador
 * para um ganho de quatro imagens por video.
 */

/** Onde a analise acontece. Resolucao cheia nao melhora e custa tres vezes mais. */
const LARGURA_ANALISE = 960

/**
 * Quantas janelas vizinhas precisam concordar para o rosto valer.
 *
 * Seis, e nao os tres que maximizam a deteccao, por medida: com tres o detector
 * achou rosto em 31 das 46 imagens, mas inventou um nos creditos do episodio e
 * jogou o recorte para fora. Com seis, os quatro resgates de verdade sobrevivem
 * e o falso positivo morre. Aqui errar e pior que nao achar -- um rosto
 * inventado move o enquadramento sem o usuario perceber.
 */
const VIZINHOS = 6

/** Rosto menor que isto nao decide enquadramento nenhum, so traz ruido. */
const MINIMO_PX = 24

const ESCALA = 1.05

export interface FaceFocus {
  focusX: number
  focusY: number
  /**
   * Que fracao da imagem o rosto ocupa, de 0 a 1.
   *
   * Existe para o CLIPE, que e olhado em varios instantes: entre um rosto de
   * perto e um la no fundo, quem manda no enquadramento e o de perto. Num print
   * so ha um instante e o numero nao decide nada -- mas nao custa carregar.
   */
  area: number
}

let cascadePath: string | null = null

/** Chamado na subida do app com o caminho do .xml empacotado. */
export function configureFaces(caminho: string): void {
  cascadePath = caminho
}

/*
 * Carga preguicosa: o WASM do OpenCV sao 17 MB e a maioria das sessoes abre um
 * projeto salvo, que ja tem o enquadramento decidido e nunca chama aqui.
 */
interface Cv {
  Mat: new (linhas: number, colunas: number, tipo: number) => CvMat
  RectVector: new () => CvRectVector
  Size: new (largura: number, altura: number) => unknown
  CascadeClassifier: new () => CvCascade
  CV_8UC1: number
  FS_createDataFile: (
    pasta: string,
    nome: string,
    dados: Buffer,
    ler: boolean,
    escrever: boolean,
    procurar: boolean,
  ) => void
}
interface CvMat {
  data: Uint8Array
  delete: () => void
}
interface CvRect {
  x: number
  y: number
  width: number
  height: number
}
interface CvRectVector {
  size: () => number
  get: (indice: number) => CvRect
  delete: () => void
}
interface CvCascade {
  load: (nome: string) => boolean
  empty: () => boolean
  detectMultiScale: (
    imagem: CvMat,
    saida: CvRectVector,
    escala: number,
    vizinhos: number,
    bandeiras: number,
    minimo: unknown,
    maximo: unknown,
  ) => void
}

let carregando: Promise<{ cv: Cv; cascade: CvCascade } | null> | null = null

async function motor(): Promise<{ cv: Cv; cascade: CvCascade } | null> {
  if (carregando) return carregando

  carregando = (async () => {
    if (!cascadePath || !existsSync(cascadePath)) {
      console.error('[faces] cascade nao encontrado em', cascadePath)
      return null
    }
    try {
      /*
       * O `?? default` nao e paranoia: o opencv-wasm e CommonJS, e import()
       * dinamico de CJS entrega os exports embrulhados em `default`. Em
       * desenvolvimento o Vite faz o interop e `modulo.cv` funciona; no app
       * empacotado o import e real e `modulo.cv` vem undefined.
       *
       * Isso ja custou um build: a deteccao falhava em silencio no instalador,
       * e todas as imagens saiam centralizadas como antes -- sem erro nenhum na
       * tela, porque a falha aqui e proposital e silenciosa para o usuario.
       */
      const modulo = (await import('opencv-wasm')) as unknown as {
        cv?: Cv
        default?: { cv?: Cv }
      }
      const cv = modulo.cv ?? modulo.default?.cv
      if (!cv?.CascadeClassifier) {
        console.error('[faces] opencv carregou sem o modulo de deteccao')
        return null
      }

      cv.FS_createDataFile('/', 'anime.xml', readFileSync(cascadePath), true, false, false)
      const cascade = new cv.CascadeClassifier()
      if (!cascade.load('anime.xml') || cascade.empty()) {
        console.error('[faces] cascade nao carregou')
        return null
      }
      return { cv, cascade }
    } catch (err) {
      // Detector indisponivel nao pode impedir ninguem de importar imagem: sem
      // ele o app so volta a enquadrar pelo centro, como sempre fez. Mas o
      // motivo vai para o stderr do main -- silencio total ja me custou um ciclo
      // inteiro de empacotamento para descobrir o que tinha quebrado.
      console.error('[faces] detector indisponivel:', err)
      return null
    }
  })()

  return carregando
}

/**
 * O enquadramento sugerido para esta imagem, ou null quando nao ha rosto
 * confiavel.
 *
 * Devolve focusX/focusY no mesmo sistema que makeRenderReady consome: fracao do
 * deslocamento possivel da janela de recorte, nao posicao do pixel. A conta
 * generaliza para qualquer proporcao de entrada -- num print 16:9 so o eixo X
 * tem folga, mas numa imagem mais alta que 9:16 o Y passa a mandar.
 */
export async function detectFocus(caminho: string): Promise<FaceFocus | null> {
  const m = await motor()
  if (!m) return null

  try {
    const { data, info } = await sharp(caminho)
      .rotate()
      .resize(LARGURA_ANALISE)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const mat = new m.cv.Mat(info.height, info.width, m.cv.CV_8UC1)
    mat.data.set(data)

    const achados = new m.cv.RectVector()
    m.cascade.detectMultiScale(
      mat,
      achados,
      ESCALA,
      VIZINHOS,
      0,
      new m.cv.Size(MINIMO_PX, MINIMO_PX),
      new m.cv.Size(0, 0),
    )

    const rostos: CvRect[] = []
    for (let i = 0; i < achados.size(); i++) {
      const r = achados.get(i)
      rostos.push({ x: r.x, y: r.y, width: r.width, height: r.height })
    }
    mat.delete()
    achados.delete()

    if (rostos.length === 0) return null

    /*
     * Com mais de um rosto vale o MAIOR, e nao a media.
     *
     * A media entre dois personagens em lados opostos aponta exatamente para o
     * vazio no meio deles -- o pior recorte possivel, pior que o centro. O maior
     * rosto e quase sempre quem esta em primeiro plano.
     */
    const maior = rostos.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b))

    // Em fracao da imagem, nao em pixel: assim a conta seguinte independe da
    // resolucao em que a analise rodou.
    const centroX = (maior.x + maior.width / 2) / info.width
    const centroY = (maior.y + maior.height / 2) / info.height
    const area = (maior.width * maior.height) / (info.width * info.height)

    return focoPara(caminho, centroX, centroY, area)
  } catch {
    return null
  }
}

/**
 * Converte "o rosto esta nesta fracao da imagem" em focusX/focusY.
 *
 * Repete a geometria de makeRenderReady de proposito: escala ate cobrir o quadro
 * e desliza a janela. Se as duas contas divergirem, o foco calculado aqui aponta
 * para um lugar diferente do que o recorte usa, e o rosto sai do quadro.
 */
async function focoPara(
  caminho: string,
  centroX: number,
  centroY: number,
  area: number,
): Promise<FaceFocus | null> {
  const metadata = await sharp(caminho).metadata()
  const bruta = { width: metadata.width ?? 0, height: metadata.height ?? 0 }
  if (bruta.width === 0 || bruta.height === 0) return null

  const girada = (metadata.orientation ?? 1) >= 5
  const width = girada ? bruta.height : bruta.width
  const height = girada ? bruta.width : bruta.height

  const escala = Math.max(RENDER_WIDTH / width, RENDER_HEIGHT / height)
  const largura = Math.max(Math.ceil(width * escala), RENDER_WIDTH)
  const altura = Math.max(Math.ceil(height * escala), RENDER_HEIGHT)

  const folgaX = largura - RENDER_WIDTH
  const folgaY = altura - RENDER_HEIGHT

  // Eixo sem folga fica no meio: nao ha o que escolher ali.
  const focusX = folgaX > 0 ? (centroX * largura - RENDER_WIDTH / 2) / folgaX : 0.5
  const focusY = folgaY > 0 ? (centroY * altura - RENDER_HEIGHT / 2) / folgaY : 0.5

  return { focusX: clamp01(focusX), focusY: clamp01(focusY), area }
}

function clamp01(valor: number): number {
  return Number.isFinite(valor) ? Math.min(Math.max(valor, 0), 1) : 0.5
}
