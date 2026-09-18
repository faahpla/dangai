import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { ffmpegPath } from './ffmpeg-path'
import { carregarOpenCv, type Cv, type CvMat } from './vision'

/**
 * Seguir um ponto do clipe ao longo do bloco, por fluxo optico.
 *
 * POR QUE NAO E O DETECTOR DE ROSTO. Medido nos 52 clipes de um projeto real,
 * 5 instantes cada: o cascade frontal acha rosto em 16% dos quadros e em 13 dos
 * 52 clipes. Ele nao dispara em perfil, nuca nem plano aberto, que e a maior
 * parte de uma cena de acao. Afrouxar a calibragem sobe para 23% e traz de
 * volta o falso positivo que a calibragem existe para evitar.
 *
 * Aqui nao ha nada para reconhecer: o usuario aponta o que quer seguir, e o
 * fluxo optico mede para onde AQUELES pixels foram. Funciona em qualquer cena,
 * porque nao depende de a cena conter algo que um modelo saiba nomear -- e era
 * isso que ele tinha pedido desde o comeco, "onde eu seleciono o objeto ou
 * rosto q se move".
 *
 * O preco e o oposto do detector: ele nunca se recusa a responder. Pixels sem
 * textura (ceu, parede lisa) nao dao pontos para seguir, e a perseguicao escorre
 * sem avisar. Por isso o resultado conta QUANTOS pontos sobreviveram -- quem
 * chamou precisa poder dizer que o caminho e fraco.
 */

/**
 * Quadros por segundo da perseguicao.
 *
 * O fluxo optico piramidal acompanha deslocamento de poucos pixels entre um
 * quadro e o proximo; espacar demais quebra a perseguicao justamente no
 * movimento rapido, que e quando ela serve. Doze por segundo cobre o passo de
 * uma cena de anime sem extrair o clipe inteiro.
 */
const POR_SEGUNDO = 12

/** Resolucao da analise. A mesma do detector, pelo mesmo motivo: nao adianta mais. */
const LARGURA = 960

/** Abaixo disto a perseguicao perdeu o alvo e continuar seria inventar. */
const MINIMO_DE_PONTOS = 6

/**
 * Teto de quadros por perseguicao.
 *
 * Isto roda NO MAIN, e o OpenCV em WASM e sincrono: um bloco absurdamente longo
 * seguraria o processo inteiro sem nada na tela explicando por que o app parou.
 * Em 12/09 uma operacao sem teto no main custou 20,4 GB e um travamento que so
 * o Gerenciador de Tarefas resolveu -- o custo de nao limitar ja e conhecido.
 *
 * Cento e vinte quadros sao dez segundos de bloco, mais do que qualquer cena de
 * recap; passando disso, a perseguicao cobre os dez primeiros e para.
 */
const MAXIMO_DE_QUADROS = 120

export interface PontoDoCaminho {
  /** Fracao do trecho pedido, de 0 a 1. */
  t: number
  /** Centro do alvo, em fracao da largura e da altura do quadro. */
  centroX: number
  centroY: number
  /** Quantos pontos sustentaram esta medida. Zero = herdado do quadro anterior. */
  pontos: number
}

export interface Perseguicao {
  caminho: PontoDoCaminho[]
  /** Ate onde a perseguicao se sustentou, de 0 a 1. */
  ateOnde: number
  /** Quantos quadros foram olhados. */
  quadros: number
}

/**
 * Extrai o trecho como uma SEQUENCIA, numa chamada so de ffmpeg.
 *
 * Um processo por quadro custava mais em spawn do que em decodificacao -- e um
 * bloco de tres segundos sao 36 quadros. Aqui o ffmpeg abre o arquivo uma vez,
 * anda ate o ponto e despeja tudo.
 */
function extrairSequencia(
  path: string,
  inicio: number,
  duracao: number,
  pasta: string,
): string[] {
  mkdirSync(pasta, { recursive: true })
  execFileSync(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      // O -ss ANTES do -i procura por palavra-chave e e ordens de grandeza mais
      // rapido; a precisao que ele perde e menor que o passo da perseguicao.
      '-ss',
      inicio.toFixed(3),
      '-i',
      path,
      '-t',
      duracao.toFixed(3),
      '-vf',
      `fps=${POR_SEGUNDO},scale=${LARGURA}:-2`,
      '-q:v',
      '4',
      '-y',
      join(pasta, 'q-%04d.jpg'),
    ],
    { windowsHide: true, stdio: 'pipe' },
  )
  return readdirSync(pasta)
    .filter((n) => n.startsWith('q-'))
    .sort()
    .slice(0, MAXIMO_DE_QUADROS)
    .map((n) => join(pasta, n))
}

/**
 * Segue a caixa do primeiro quadro ate o fim do trecho.
 *
 * A caixa chega em fracoes do quadro (0 a 1), que e o sistema em que a camera
 * pensa -- converter para pixel aqui e nao no renderer mantem a interface longe
 * da resolucao em que a analise por acaso rodou.
 */
export async function perseguir(
  path: string,
  inicio: number,
  duracao: number,
  caixa: { x: number; y: number; width: number; height: number },
): Promise<Perseguicao> {
  const cv = await carregarOpenCv()
  if (!cv) return { caminho: [], ateOnde: 0, quadros: 0 }

  const pasta = join(tmpdir(), `dangai-track-${Date.now()}`)
  try {
    const quadros = extrairSequencia(path, inicio, duracao, pasta)
    if (quadros.length < 2) return { caminho: [], ateOnde: 0, quadros: quadros.length }

    const cinza = async (arquivo: string): Promise<{ mat: CvMat; w: number; h: number }> => {
      const { data, info } = await sharp(arquivo)
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const mat = new cv.Mat(info.height, info.width, cv.CV_8UC1)
      mat.data.set(data)
      return { mat, w: info.width, h: info.height }
    }

    let atual = await cinza(quadros[0]!)
    const { w, h } = atual

    // A caixa em pixels deste quadro, e o centro que vai andando.
    let cx = caixa.x * w + (caixa.width * w) / 2
    let cy = caixa.y * h + (caixa.height * h) / 2
    const meiaLargura = Math.max((caixa.width * w) / 2, 8)
    const meiaAltura = Math.max((caixa.height * h) / 2, 8)

    const caminho: PontoDoCaminho[] = [
      { t: 0, centroX: cx / w, centroY: cy / h, pontos: MINIMO_DE_PONTOS },
    ]
    let ateOnde = 0

    for (let i = 1; i < quadros.length; i++) {
      const proximo = await cinza(quadros[i]!)
      const passo = seguirUmPasso(cv, atual.mat, proximo.mat, cx, cy, meiaLargura, meiaAltura, w, h)

      atual.mat.delete()
      atual = proximo

      const t = i / (quadros.length - 1)
      if (passo === null) {
        /*
         * Perdeu o alvo: o caminho PARA aqui em vez de continuar chutando.
         *
         * Repetir o ultimo centro pareceria uma perseguicao que deu certo e
         * ficou parada -- e quem olha nao teria como saber que a partir dali a
         * camera nao esta seguindo mais nada.
         */
        break
      }
      cx = passo.x
      cy = passo.y
      ateOnde = t
      caminho.push({ t, centroX: cx / w, centroY: cy / h, pontos: passo.pontos })
    }

    atual.mat.delete()
    return { caminho, ateOnde, quadros: quadros.length }
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

/**
 * Um passo do fluxo optico: para onde os pixels da caixa foram.
 *
 * Os pontos sao RESEMEADOS a cada quadro, dentro da caixa nova. Seguir sempre
 * os pontos do primeiro quadro parece mais barato e nao e: o alvo gira, entra
 * sombra, e os pontos originais somem um a um ate a perseguicao morrer no meio.
 * Reencontrar textura na posicao atual custa pouco e aguenta o clipe inteiro.
 *
 * E a MEDIANA, nao a media: basta um ponto grudar no fundo que se move ao
 * contrario para a media sair puxada para o nada entre os dois.
 */
function seguirUmPasso(
  cv: Cv,
  de: CvMat,
  para: CvMat,
  cx: number,
  cy: number,
  meiaLargura: number,
  meiaAltura: number,
  w: number,
  h: number,
): { x: number; y: number; pontos: number } | null {
  const x0 = Math.max(Math.round(cx - meiaLargura), 0)
  const y0 = Math.max(Math.round(cy - meiaAltura), 0)
  const x1 = Math.min(Math.round(cx + meiaLargura), w)
  const y1 = Math.min(Math.round(cy + meiaAltura), h)
  if (x1 - x0 < 8 || y1 - y0 < 8) return null

  const mascara = new cv.Mat(h, w, cv.CV_8UC1)
  mascara.data.fill(0)
  for (let y = y0; y < y1; y++) mascara.data.fill(255, y * w + x0, y * w + x1)

  const antes = new cv.Mat(0, 0, cv.CV_32FC2)
  const depois = new cv.Mat(0, 0, cv.CV_32FC2)
  const estado = new cv.Mat(0, 0, cv.CV_8UC1)
  const erro = new cv.Mat(0, 0, cv.CV_32FC1)

  try {
    cv.goodFeaturesToTrack(de, antes, 80, 0.01, 6, mascara, 3, false, 0.04)
    const quantos = antes.rows ?? 0
    if (quantos < MINIMO_DE_PONTOS) return null

    cv.calcOpticalFlowPyrLK(
      de,
      para,
      antes,
      depois,
      estado,
      erro,
      new cv.Size(21, 21),
      3,
      new cv.TermCriteria(cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 30, 0.01),
    )

    const dxs: number[] = []
    const dys: number[] = []
    const a = antes.data32F
    const b = depois.data32F
    const ok = estado.data
    for (let i = 0; i < quantos; i++) {
      if (!ok[i]) continue
      dxs.push(b[i * 2]! - a[i * 2]!)
      dys.push(b[i * 2 + 1]! - a[i * 2 + 1]!)
    }
    if (dxs.length < MINIMO_DE_PONTOS) return null

    const dx = mediana(dxs)
    const dy = mediana(dys)
    return {
      x: Math.min(Math.max(cx + dx, 0), w),
      y: Math.min(Math.max(cy + dy, 0), h),
      pontos: dxs.length,
    }
  } finally {
    mascara.delete()
    antes.delete()
    depois.delete()
    estado.delete()
    erro.delete()
  }
}

function mediana(valores: number[]): number {
  const ordenados = valores.slice().sort((a, b) => a - b)
  const meio = ordenados.length >> 1
  return ordenados.length % 2 === 0
    ? (ordenados[meio - 1]! + ordenados[meio]!) / 2
    : ordenados[meio]!
}
