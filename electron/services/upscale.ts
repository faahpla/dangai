import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { InferenceSession } from 'onnxruntime-node'
import { RENDER_HEIGHT, RENDER_WIDTH, type ImageAsset } from '@shared/contract'
import { ffmpegPath } from './ffmpeg-path'

/**
 * Melhora a imagem das cenas ANTES do recorte 9:16, na hora de renderizar.
 *
 * O problema que isto resolve foi medido no material dele: um quadro 1920x1080
 * entra no app e o recorte 9:16 usa uma tira de 608x1080 -- 32% da largura --
 * esticada ate 1242x2208 (o quadro do render, com a folga do Ken Burns). Ou
 * seja, o video ja nasce de um aumento de 2,04x, e e dai que vem a moleza.
 *
 * Aqui a ordem se inverte: recorta a tira da FONTE, amplia a tira em 4x, e so
 * entao reduz para 1242x2208. O quadro final passa a sair de uma REDUCAO, que e
 * a operacao que nao inventa nada e nao borra.
 *
 * Medido nas cenas dele, com zoom de 2x lado a lado: o contorno do cabelo volta
 * a ser linha fechada em vez de mancha, e fio separado em vez de massa cinza.
 *
 * O modelo e o realesr-animevideov3 (BSD-3), 2,4 MB, treinado em VIDEO DE ANIME
 * -- que e exatamente o material dele. Um ESRGAN completo de 68 MB foi medido
 * junto: 30x mais lento para um ganho que nao aparece em video.
 */

/** x4 fixo do modelo. A reducao para o quadro do render acontece depois. */
const ESCALA = 4

/**
 * O modelo vai JUNTO com o app, e nao e baixado.
 *
 * Sao 2,4 MB -- perto de nada num instalador de 215 MB -- e a licenca BSD-3
 * permite redistribuir com o aviso junto (assets/upscale/LICENSE-Real-ESRGAN).
 * Baixar economizaria 2 MB e custaria uma dependencia de rede no meio de um
 * render, que e o pior momento possivel para descobrir que a internet caiu.
 */
let modeloDir: string | null = null
let sessao: InferenceSession | null = null

export function configureUpscale(dir: string): void {
  modeloDir = dir
}

export function modeloPath(): string {
  if (!modeloDir) throw new Error('Upscale nao configurado')
  return join(modeloDir, 'realesr-animevideov3.onnx')
}

/** O modelo esta no lugar? Falso so se o app veio quebrado. */
export function upscaleReady(): boolean {
  try {
    return existsSync(modeloPath()) && statSync(modeloPath()).size > 1_000_000
  } catch {
    return false
  }
}

/**
 * Onde ficam os arquivos melhorados.
 *
 * No userData, e nao junto do modelo: sao dezenas de MB por projeto, e a pasta
 * do app pode nem ter permissao de escrita numa instalacao para todos.
 */
let cacheDir: string | null = null

export function configureUpscaleCache(userDataDir: string): void {
  cacheDir = join(userDataDir, 'upscale')
}

function exigirCache(): string {
  if (!cacheDir) throw new Error('Cache do upscale nao configurado')
  mkdirSync(cacheDir, { recursive: true })
  return cacheDir
}

async function abrirSessao(): Promise<InferenceSession> {
  if (sessao) return sessao
  // Import dinamico: o onnxruntime carrega DLLs nativas e custa quase um
  // segundo. Quem nunca liga o upscale nao paga isso na abertura do app.
  const ort = await import('onnxruntime-node')
  sessao = await ort.InferenceSession.create(modeloPath(), {
    // A mesma lista do etiquetador: DirectML quando ha placa, CPU quando nao ha.
    // Medido na 3060 dele: DML e 21x mais rapida que a CPU neste modelo.
    executionProviders: ['dml', 'cpu'],
  })
  return sessao
}

/**
 * A janela da FONTE que vira o quadro 9:16.
 *
 * E a mesma conta do makeRenderReady, so que resolvida em coordenadas do
 * arquivo original em vez das da imagem ja redimensionada. Se as duas
 * discordarem, o upscale enquadraria diferente do preview.
 */
export function janelaDaFonte(
  largura: number,
  altura: number,
  focusX: number,
  focusY: number,
): { left: number; top: number; width: number; height: number } {
  const escala = Math.max(RENDER_WIDTH / largura, RENDER_HEIGHT / altura)
  const sw = Math.max(Math.ceil(largura * escala), RENDER_WIDTH)
  const sh = Math.max(Math.ceil(altura * escala), RENDER_HEIGHT)

  const w = Math.min(largura, Math.max(1, Math.round(RENDER_WIDTH / escala)))
  const h = Math.min(altura, Math.max(1, Math.round(RENDER_HEIGHT / escala)))
  const left = Math.round(((sw - RENDER_WIDTH) * focusX) / escala)
  const top = Math.round(((sh - RENDER_HEIGHT) * focusY) / escala)

  return {
    left: Math.min(Math.max(left, 0), largura - w),
    top: Math.min(Math.max(top, 0), altura - h),
    width: w,
    height: h,
  }
}

/**
 * Amplia um quadro cru e devolve o quadro do render (1242x2208) pronto.
 *
 * Numa passada so, sem ladrilhar. Medido: ladrilhar a tira em quadradinhos de
 * 256 triplicava o custo (800ms contra 236ms) sem mudar o resultado -- o gasto
 * era empacotar tensor dezenas de vezes, nao a inferencia.
 */
async function rodarModelo(
  cru: Buffer,
  largura: number,
  altura: number,
  canais: number,
): Promise<Float32Array> {
  const ort = await import('onnxruntime-node')
  const s = await abrirSessao()

  const plano = largura * altura
  const entrada = new Float32Array(3 * plano)
  for (let i = 0; i < plano; i++) {
    const p = i * canais
    entrada[i] = cru[p]! / 255
    entrada[plano + i] = cru[p + 1]! / 255
    entrada[2 * plano + i] = cru[p + 2]! / 255
  }

  const saida = await s.run({
    input: new ort.Tensor('float32', entrada, [1, 3, altura, largura]),
  })
  return saida.output!.data as Float32Array
}

/** Do que o modelo devolveu para o quadro do render, pronto para codificar. */
async function paraQuadroDoRender(
  dados: Float32Array,
  largura: number,
  altura: number,
): Promise<Buffer> {
  const ow = largura * ESCALA
  const oh = altura * ESCALA
  const planoSaida = ow * oh
  const rgb = Buffer.allocUnsafe(planoSaida * 3)
  for (let i = 0; i < planoSaida; i++) {
    rgb[i * 3] = clamp255(dados[i]!)
    rgb[i * 3 + 1] = clamp255(dados[planoSaida + i]!)
    rgb[i * 3 + 2] = clamp255(dados[2 * planoSaida + i]!)
  }

  return sharp(rgb, { raw: { width: ow, height: oh, channels: 3 } })
    .resize(RENDER_WIDTH, RENDER_HEIGHT, { fit: 'fill' })
    .raw()
    .toBuffer()
}

/**
 * Amplia um quadro cru e devolve o quadro do render (1242x2208) pronto.
 *
 * Numa passada so, sem ladrilhar. Medido: ladrilhar a tira em quadradinhos de
 * 256 triplicava o custo (800ms contra 236ms) sem mudar o resultado -- o gasto
 * era empacotar tensor dezenas de vezes, nao a inferencia.
 */
async function ampliarQuadro(
  cru: Buffer,
  largura: number,
  altura: number,
  canais: number,
): Promise<Buffer> {
  return paraQuadroDoRender(await rodarModelo(cru, largura, altura, canais), largura, altura)
}

function clamp255(v: number): number {
  const n = Math.round(v * 255)
  return n < 0 ? 0 : n > 255 ? 255 : n
}

/** Um print: um quadro so, e sai um JPEG como o makeRenderReady faz. */
async function ampliarPrint(asset: ImageAsset, destino: string): Promise<void> {
  const janela = janelaDaFonte(asset.width, asset.height, asset.focusX, asset.focusY)
  const { data, info } = await sharp(asset.path)
    .rotate()
    .extract(janela)
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pronto = await ampliarQuadro(data, info.width, info.height, info.channels)
  await sharp(pronto, { raw: { width: RENDER_WIDTH, height: RENDER_HEIGHT, channels: 3 } })
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(destino)
}

/**
 * Um clipe: quadro a quadro, do ffmpeg para o modelo e de volta para o ffmpeg.
 *
 * Dois processos e um laco no meio. O de entrada corta a tira da fonte e cospe
 * pixel cru; o de saida recebe o quadro ja reduzido e codifica. A reducao
 * acontece AQUI e nao no ffmpeg de saida de proposito: o quadro ampliado tem
 * 31 MB e mandar isso por cano a cada frame custaria mais que o proprio modelo.
 */
async function ampliarClipe(
  asset: ImageAsset,
  destino: string,
  /**
   * Ate que segundo do clipe o video chega. undefined = o clipe todo.
   *
   * As cenas da biblioteca ja chegam cortadas, mas quase sempre sobram alguns
   * segundos depois do ponto onde o bloco acaba -- e melhorar quadro que
   * ninguem vai ver e o tipo de gasto que faz a opcao parecer cara sem motivo.
   *
   * Corta so o FIM, nunca o comeco: o `trimBefore` do Remotion conta a partir
   * do quadro zero do arquivo, e comer o inicio desalinharia o clipe inteiro.
   */
  ate: number | undefined,
  onFrame: (feitos: number) => void,
): Promise<void> {
  const janela = janelaDaFonte(asset.width, asset.height, asset.focusX, asset.focusY)
  const fps = 24000 / 1001

  const entrada = spawn(ffmpegPath, [
    '-i', asset.path,
    // Meio segundo de folga: o congelamento do ultimo quadro precisa que ele exista.
    ...(ate === undefined ? [] : ['-t', (ate + 0.5).toFixed(3)]),
    '-vf', `crop=${janela.width}:${janela.height}:${janela.left}:${janela.top}`,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-',
  ])
  const saida = spawn(ffmpegPath, [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-s', `${RENDER_WIDTH}x${RENDER_HEIGHT}`,
    '-r', String(fps),
    '-i', '-',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '17',
    '-pix_fmt', 'yuv420p',
    destino,
  ])

  entrada.stderr.resume()
  saida.stderr.resume()

  const bytesPorQuadro = janela.width * janela.height * 3
  let sobra: Buffer = Buffer.alloc(0)
  let feitos = 0

  /*
   * Duas filas, para a GPU e o resto trabalharem AO MESMO TEMPO.
   *
   * Antes era um quadro por vez do inicio ao fim: decodificar, inferir,
   * desempacotar, reduzir, codificar -- cada etapa esperando a anterior. A GPU
   * ficava parada enquanto o ffmpeg codificava, e o ffmpeg parado enquanto a
   * GPU rodava. Medido assim: 238ms de trabalho viravam ~505ms de relogio.
   *
   * `naGpu` mantem a inferencia em fila indiana, que e o que a sessao do
   * onnxruntime aceita. `naEscrita` cuida do que vem depois -- e como ela e
   * outra corrente, o desempacotar e o codificar do quadro N acontecem enquanto
   * o modelo ja esta no N+1. A ORDEM se mantem porque cada corrente e serial.
   */
  let naGpu: Promise<unknown> = Promise.resolve()
  let naEscrita: Promise<void> = Promise.resolve()
  let emVoo = 0

  const terminou = new Promise<void>((resolve, reject) => {
    entrada.on('error', reject)
    saida.on('error', reject)
    saida.on('close', (codigo) => {
      if (codigo === 0) resolve()
      else reject(new Error(`ffmpeg saiu com ${codigo} ao gravar o clipe melhorado`))
    })
  })

  /*
   * No maximo tres quadros em voo.
   *
   * Cada quadro ampliado tem 31 MB antes de reduzir. Sem esse teto o ffmpeg de
   * entrada despeja o clipe inteiro na memoria enquanto o modelo ainda esta no
   * primeiro quadro -- um clipe de seis segundos vira mais de um giga parado.
   */
  const TETO = 3

  entrada.stdout.on('data', (pedaco: Buffer) => {
    sobra = sobra.length === 0 ? Buffer.from(pedaco) : Buffer.concat([sobra, pedaco])
    while (sobra.length >= bytesPorQuadro) {
      const quadro = Buffer.from(sobra.subarray(0, bytesPorQuadro))
      sobra = sobra.subarray(bytesPorQuadro)

      emVoo += 1
      if (emVoo >= TETO) entrada.stdout.pause()

      const inferido = naGpu.then(() =>
        rodarModelo(quadro, janela.width, janela.height, 3),
      )
      naGpu = inferido.catch(() => undefined)

      naEscrita = naEscrita.then(async () => {
        const dados = await inferido
        const pronto = await paraQuadroDoRender(dados, janela.width, janela.height)
        if (!saida.stdin.write(pronto)) {
          await new Promise<void>((r) => saida.stdin.once('drain', () => r()))
        }
        feitos += 1
        onFrame(feitos)
        emVoo -= 1
        if (emVoo < TETO) entrada.stdout.resume()
      })
    }
  })

  entrada.stdout.on('end', () => {
    void naEscrita.then(() => saida.stdin.end()).catch(() => saida.stdin.end())
  })

  await terminou
}

/**
 * Melhora as cenas escolhidas e devolve, por id, o caminho do arquivo novo.
 *
 * O resultado tem exatamente as mesmas medidas do recorte de hoje -- 1242x2208
 * -- entao nada depois daqui precisa saber que o upscale existiu. O que muda e
 * so a qualidade dos pixels.
 *
 * Guarda em cache pelo id do asset e pelo enquadramento: renderizar duas vezes
 * o mesmo projeto nao paga de novo, e mudar o foco de uma cena so refaz aquela.
 */
export async function upscaleAssets(
  assets: readonly ImageAsset[],
  /** Ate que segundo de cada clipe o video chega, por id. */
  limites: Readonly<Record<string, number>>,
  onProgress: (feitos: number, total: number, nome: string) => void,
): Promise<Record<string, string>> {
  const dir = exigirCache()
  const feitos: Record<string, string> = {}

  for (const [i, asset] of assets.entries()) {
    const ate = limites[asset.id]
    // O limite entra na chave: usar mais do clipe depois exige melhorar de novo.
    const marca =
      `${Math.round(asset.focusX * 1000)}-${Math.round(asset.focusY * 1000)}` +
      (ate === undefined ? '' : `-${Math.round(ate * 10)}`)
    const ext = asset.kind === 'video' ? 'mp4' : 'jpg'
    const destino = join(dir, `${asset.id}-${marca}.${ext}`)

    if (!existsSync(destino)) {
      const parcial = `${destino}.part.${ext}`
      onProgress(i, assets.length, asset.fileName)
      if (asset.kind === 'video') {
        await ampliarClipe(asset, parcial, ate, () => onProgress(i, assets.length, asset.fileName))
      } else {
        await ampliarPrint(asset, parcial)
      }
      renameSync(parcial, destino)
    }
    feitos[asset.id] = destino
  }

  onProgress(assets.length, assets.length, '')
  return feitos
}
