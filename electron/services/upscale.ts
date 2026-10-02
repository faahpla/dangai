import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { InferenceSession } from 'onnxruntime-node'
import type { ImageAsset } from '@shared/contract'
import { formatoAtual, medidasAtuais } from './formato'
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

/**
 * Cancelar no meio.
 *
 * "Uma opcao de poder cancelar o upscale enquanto ele ocorre." O botao
 * Cancelar do render ja aparecia durante o upscale, mas so avisava o Remotion
 * -- que nessa fase ainda nem comecou. O upscale seguia ate a ultima cena.
 * Agora o cancelar mata os ffmpeg vivos, o laco desiste, e quem chamou recebe
 * UpscaleCancelado.
 */
const vivos = new Set<ChildProcess>()
let cancelado = false

export class UpscaleCancelado extends Error {
  constructor() {
    super('Upscale cancelado')
    this.name = 'UpscaleCancelado'
  }
}

export function cancelarUpscale(): void {
  cancelado = true
  for (const filho of vivos) {
    try {
      filho.kill()
    } catch {
      /* ja saiu */
    }
  }
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

/**
 * A VERSAO DO RESULTADO, que entra no nome do arquivo em cache.
 *
 * Mudou o jeito de gerar? Sobe o numero, e todo mundo refaz em vez de reusar um
 * arquivo produzido pela regra antiga. Sem isto, um conserto no pipeline so
 * chega a quem nunca tinha renderizado aquele clipe -- e quem mais precisa do
 * conserto e justamente quem ja tem o arquivo errado guardado.
 *
 * v2: ate a v1.30.0 o clipe era decodificado na taxa NATIVA do arquivo e
 * recodificado declarando 23.976, entao uma fonte de 30fps saia 25% mais longa.
 * Os arquivos gerados antes disso tem a duracao errada.
 *
 * v3: a chave ganhou o FORMATO. Os arquivos da v2 nao tem esse pedaco no nome,
 * entao nunca mais seriam lidos -- e a faxina, que so olha a versao, os
 * manteria no disco para sempre. Subir o numero e o que os manda embora.
 *
 * v4: o criterio de "mesmo desenho" era cego para movimento de baixo
 * contraste e congelava fumaca, fogo e fade no meio do bloco. O congelamento
 * esta GRAVADO dentro dos arquivos da v3 -- sem subir o numero, quem ja
 * renderizou continuaria recebendo o video travado vindo do cache, que e
 * exatamente o caso de quem reportou o problema.
 *
 * v5: os limites do "mesmo desenho" passaram a acompanhar o contraste da cena.
 * As cenas de baixo contraste (o Hitogami, no plano branco) sairam da v4 com
 * 80% dos quadros reaproveitados e o movimento travado -- e isso esta gravado
 * nos arquivos em cache.
 */
const VERSAO_DO_UPSCALE = 5

export function configureUpscaleCache(userDataDir: string): void {
  cacheDir = join(userDataDir, 'upscale')
  limparVersoesVelhas()
}

/**
 * Apaga o que sobrou de versoes anteriores do pipeline.
 *
 * Sao dezenas de MB por clipe e eles nunca mais serao lidos -- a chave mudou.
 * Refazer custa tempo de GPU, mas guardar o errado nao adianta nada.
 *
 * Nunca lanca: isto roda na subida do app, e uma faxina que falha nao pode
 * impedir o programa de abrir.
 */
function limparVersoesVelhas(): void {
  if (!cacheDir) return
  try {
    if (!existsSync(cacheDir)) return
    for (const nome of readdirSync(cacheDir)) {
      if (nome.includes(`-v${VERSAO_DO_UPSCALE}-`)) continue
      rmSync(join(cacheDir, nome), { force: true })
    }
  } catch (err) {
    console.error('[upscale] nao deu para limpar o cache velho:', err)
  }
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
  const medidas = medidasAtuais()
  const escala = Math.max(medidas.renderWidth / largura, medidas.renderHeight / altura)
  const sw = Math.max(Math.ceil(largura * escala), medidas.renderWidth)
  const sh = Math.max(Math.ceil(altura * escala), medidas.renderHeight)

  const w = Math.min(largura, Math.max(1, Math.round(medidas.renderWidth / escala)))
  const h = Math.min(altura, Math.max(1, Math.round(medidas.renderHeight / escala)))
  const left = Math.round(((sw - medidas.renderWidth) * focusX) / escala)
  const top = Math.round(((sh - medidas.renderHeight) * focusY) / escala)

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

  const medidas = medidasAtuais()
  return sharp(rgb, { raw: { width: ow, height: oh, channels: 3 } })
    .resize(medidas.renderWidth, medidas.renderHeight, { fit: 'fill' })
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

/**
 * Os dois quadros sao o MESMO DESENHO?
 *
 * Nao "sao iguais": o H.264 poe ruido proprio em cada quadro, entao dois
 * quadros do mesmo desenho quase nunca batem byte a byte -- medido na
 * biblioteca dele, a igualdade exata pegava 0% dos casos onde o desenho nao
 * mudou.
 *
 * SAO DOIS CRITERIOS, e cada um existe por um motivo oposto ao do outro.
 *
 * POUCOS PIXELS MUDANDO MUITO. Uma boca que mexe num rosto parado altera
 * pouquissimos pixels, mas altera MUITO neles. Numa media ela desaparece no
 * ruido, e o quadro seria reusado congelando a fala. Contando so mudanca
 * acima de 30, o ruido de compressao nao entra e a boca entra.
 *
 * MUITOS PIXELS MUDANDO POUCO -- e este faltava. Fumaca, fogo, agua, luz e
 * fade mexem a tela inteira sem que quase nenhum pixel mude mais que 30, e o
 * criterio de cima os declarava "mesmo desenho": o clipe ganhava vida no
 * comeco e congelava no meio, sem nada no app avisar. Palavras dele: "tem um
 * clipe q ta passando uma fumaca, a cena tem constante movimento, mas
 * simplesmente trava do nada depois de renderizar".
 *
 * MEDIDO em 2.196 pares de quadros vizinhos de 40 clipes dele. Entre os pares
 * que o criterio antigo reusava, o quanto da imagem mudava mais de 8:
 *
 *   p50    0,00%     desenho realmente parado
 *   p95    2,70%
 *   p98    8,31%
 *   p99   77,61%     a tela inteira se mexendo, e reusada assim mesmo
 *
 * O corte de 2% cai no vale entre os dois grupos: mantem 93% da economia e
 * recalcula 68 quadros que hoje saem congelados. A troca e barata de
 * proposito -- recalcular a toa custa alguns milissegundos de GPU, e reusar a
 * toa custa um congelamento no meio do video.
 *
 * A amostragem de 1 em cada 5 bytes existe porque isto roda entre duas
 * inferencias: comparar 1,9 MB inteiros custaria mais do que o tempo que
 * economiza em parte dos quadros. Um desenho novo muda muito mais que 1 em 5.
 */
/**
 * O alcance de brilho do quadro: do tom mais escuro ao mais claro que importa
 * (percentis 5 e 95, para um pixel perdido nao mentir o contraste inteiro).
 *
 * Anime comum fica perto de 200. As cenas do Hitogami, lavadas de branco,
 * ficam entre 18 e 35 -- medido em dez clipes dele.
 */
function alcanceDe(quadro: Buffer): number {
  const histograma = new Uint32Array(256)
  let n = 0
  // 1 em cada 15 bytes: e um histograma, nao precisa de todos.
  for (let p = 0; p < quadro.length; p += 15) {
    histograma[quadro[p]!]! += 1
    n += 1
  }
  let acumulado = 0
  let baixo = 0
  for (let v = 0; v < 256; v++) {
    acumulado += histograma[v]!
    if (acumulado >= n * 0.05) {
      baixo = v
      break
    }
  }
  acumulado = 0
  let alto = 255
  for (let v = 255; v >= 0; v--) {
    acumulado += histograma[v]!
    if (acumulado >= n * 0.05) {
      alto = v
      break
    }
  }
  return Math.max(alto - baixo, 1)
}

/*
 * Abaixo disto uma diferenca e ruido de compressao, qualquer que seja o
 * contraste da cena. Calibrado junto com os limites relativos: ver o
 * comentario de `mesmoDesenho`.
 */
const RUIDO = 2

function mesmoDesenho(a: Buffer, b: Buffer, alcance: number): boolean {
  if (a.length !== b.length) return false

  /*
   * OS LIMITES ACOMPANHAM O CONTRASTE DA CENA.
   *
   * "Em cenas com cor predominante, quando renderiza o clipe fica todo
   * travado." O exemplo dele e o Hitogami: silhueta num plano todo branco, e
   * qualquer movimento dele saia parado depois do render. Os limites de 8 e
   * 30 foram calibrados em anime comum, com alcance de brilho perto de 200;
   * no Hitogami o alcance e 18 a 35, e o personagem inteiro se move sem quase
   * nenhum pixel passar de 8. A regra reaproveitava 80% dos quadros.
   *
   * O erro que isso causava so aparece medido CONTRA O CONTRASTE: o quadro
   * reusado errava ate 2 niveis de brilho, que parece nada -- e num alcance de
   * 19 e 10% de toda a imagem. Medido em dez clipes do Hitogami e catorze de
   * anime comum, o pior erro do quadro reusado, em % do contraste da cena:
   *
   *                        Hitogami             anime comum
   *                     reuso  pior erro      reuso  pior erro
   *   limites fixos      80%     24,5%         43%      1,5%
   *   relativos, ruido 2  8%      1,4%         40%      1,5%
   *
   * O Hitogami passa a ter o MESMO padrao de qualidade que o anime comum ja
   * tinha, e o anime comum quase nao muda. Ruido 3 deixava 1,8% no Hitogami,
   * acima do padrao; ruido 1 so tirava economia sem ganhar qualidade.
   *
   * O alcance e o do quadro de REFERENCIA, medido uma vez quando ele e
   * inferido, e nao a cada comparacao.
   */
  const k = Math.min(alcance / 200, 1)
  const FRACO = Math.max(RUIDO, 8 * k)
  const FORTE = Math.max(RUIDO + 1, 30 * k)
  const PASSO = 5

  const amostras = Math.ceil(a.length / PASSO)
  // 0,02% dos bytes vistos. Acima disso nao e mais ruido de compressao.
  const limiteForte = Math.max(8, Math.floor(amostras / 5000))
  const limiteFraco = Math.floor(amostras * 0.02)

  let fortes = 0
  let fracos = 0
  for (let p = 0; p < a.length; p += PASSO) {
    const d = a[p]! - b[p]!
    const abs = d < 0 ? -d : d
    if (abs <= FRACO) continue

    fracos += 1
    if (fracos > limiteFraco) return false

    if (abs > FORTE) {
      fortes += 1
      if (fortes > limiteForte) return false
    }
  }
  return true
}

function clamp255(v: number): number {
  const n = Math.round(v * 255)
  return n < 0 ? 0 : n > 255 ? 255 : n
}

/** Um print: um quadro so, e sai um JPEG como o makeRenderReady faz. */
async function ampliarPrint(asset: ImageAsset, destino: string): Promise<void> {
  const medidas = medidasAtuais()
  const janela = janelaDaFonte(asset.width, asset.height, asset.focusX, asset.focusY)
  const { data, info } = await sharp(asset.path)
    .rotate()
    .extract(janela)
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pronto = await ampliarQuadro(data, info.width, info.height, info.channels)
  await sharp(pronto, { raw: { width: medidas.renderWidth, height: medidas.renderHeight, channels: 3 } })
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
  const medidas = medidasAtuais()
  const janela = janelaDaFonte(asset.width, asset.height, asset.focusX, asset.focusY)
  const fps = 24000 / 1001

  const argsEntrada = [
    '-i', asset.path,
    // Meio segundo de folga: o congelamento do ultimo quadro precisa que ele exista.
    ...(ate === undefined ? [] : ['-t', (ate + 0.5).toFixed(3)]),
    /*
     * A TAXA DE QUADROS E FORCADA AQUI, e isto nao e detalhe.
     *
     * Este lado decodificava na taxa NATIVA do arquivo e o lado de baixo declara
     * `-r 23.976`. Com uma fonte de 30fps, os 90 quadros de tres segundos viram
     * 90/23.976 = 3,75s: o clipe estica 25%.
     *
     * Medido: fonte 30fps esticava 750ms em 3s, 25fps esticava 130ms, e 24 e
     * 23.976 saiam exatas -- que e por que o defeito ficou escondido enquanto o
     * material vinha todo a 23.976.
     *
     * O estrago aparece duas vezes no render, e as duas com cara de bug do app:
     * procurar o segundo X cai num instante ANTERIOR ao pedido, porque o tempo
     * do arquivo nao e mais o tempo que o app calculou; e o congelamento do
     * ultimo quadro dispara cedo, porque o app mede a sobra pela duracao
     * ORIGINAL enquanto o arquivo ficou mais longo.
     *
     * O filtro vem antes do crop de proposito: descartar quadro e mais barato
     * que recortar para descartar depois.
     */
    '-vf', `fps=${fps},crop=${janela.width}:${janela.height}:${janela.left}:${janela.top}`,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-',
  ]
  const argsSaida = [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-s', `${medidas.renderWidth}x${medidas.renderHeight}`,
    '-r', String(fps),
    '-i', '-',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '17',
    '-pix_fmt', 'yuv420p',
    destino,
  ]

  await processarQuadros(argsEntrada, argsSaida, janela.width, janela.height, (dados) =>
    paraQuadroDoRender(dados, janela.width, janela.height), onFrame)
}

/**
 * O laco de quadro a quadro: um ffmpeg cospe pixel cru, o modelo amplia, o
 * `converter` leva ao tamanho final, e outro ffmpeg codifica.
 *
 * Serve ao clipe do render e ao video pronto. Os dois processos ficam
 * registrados em `vivos`: e o que deixa o Cancelar mata-los no meio.
 */
async function processarQuadros(
  argsEntrada: string[],
  argsSaida: string[],
  largura: number,
  altura: number,
  converter: (dados: Float32Array) => Promise<Buffer>,
  onFrame: (feitos: number) => void,
): Promise<void> {
  if (cancelado) throw new UpscaleCancelado()
  const entrada = spawn(ffmpegPath, argsEntrada, { windowsHide: true })
  const saida = spawn(ffmpegPath, argsSaida, { windowsHide: true })
  for (const filho of [entrada, saida]) {
    vivos.add(filho)
    filho.on('close', () => vivos.delete(filho))
  }
  // Morto pelo Cancelar, o ffmpeg de saida fecha a escrita no meio: engolir o
  // EPIPE aqui evita um erro solto que derrubaria o processo principal.
  saida.stdin.on('error', () => {})

  entrada.stderr.resume()
  saida.stderr.resume()

  const bytesPorQuadro = largura * altura * 3
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
      else if (cancelado) reject(new UpscaleCancelado())
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

  /*
   * O DESENHO ANTERIOR, e o que o modelo devolveu para ele.
   *
   * Anime e animado "on twos" ou "on threes": o arquivo tem 24 quadros por
   * segundo, mas o desenho so muda a cada dois ou tres. Medido em clipes da
   * biblioteca dele: 71%, 82% e 100% dos quadros repetem o desenho anterior.
   * Sem isto, o modelo amplia o MESMO desenho tres vezes seguidas -- a 164ms
   * cada, numa 3060.
   *
   * Reusar aqui nao congela movimento nenhum: o que se reusa e o resultado de
   * um desenho que ja era identico. Congelaria se o criterio fosse frouxo, e e
   * por isso que ele e por PIXEL FORTE e nao por media -- uma boca que mexe
   * muda poucos pixels e muda muito neles. Na media ela desapareceria.
   */
  /*
   * O quadro que GEROU o resultado que esta sendo reusado -- e nao o vizinho.
   *
   * A diferenca aparece justamente no movimento lento. Comparando sempre com o
   * vizinho, a referencia anda junto com a imagem: cada passo e pequeno demais
   * para disparar o criterio, e o resultado do PRIMEIRO quadro vai sendo
   * arrastado indefinidamente enquanto a cena se afasta dele. Preso ao quadro
   * que originou o resultado, o desvio acumula -- e na hora que passa do
   * criterio, recalcula.
   */
  let referencia: Buffer | null = null
  /** O contraste da referencia, medido uma vez quando ela e inferida. */
  let alcanceDaReferencia = 200
  /*
   * Guarda o quadro PRONTO, e nao o que o modelo devolveu.
   *
   * Depois da inferencia ainda ha a conversao para o quadro do render: um laco
   * de sete milhoes de iteracoes mais um resize. Se o desenho e o mesmo, esse
   * resultado tambem e -- reaproveita-lo poupa as duas etapas, e nao so a GPU.
   */
  let referenciaPronta: Promise<Buffer> | null = null

  entrada.stdout.on('data', (pedaco: Buffer) => {
    sobra = sobra.length === 0 ? Buffer.from(pedaco) : Buffer.concat([sobra, pedaco])
    while (sobra.length >= bytesPorQuadro) {
      const quadro = Buffer.from(sobra.subarray(0, bytesPorQuadro))
      sobra = sobra.subarray(bytesPorQuadro)

      emVoo += 1
      if (emVoo >= TETO) entrada.stdout.pause()

      const repetido =
        referencia !== null &&
        referenciaPronta !== null &&
        mesmoDesenho(referencia, quadro, alcanceDaReferencia)

      let pronto: Promise<Buffer>
      if (repetido) {
        // A referencia NAO anda aqui: e isso que faz o desvio acumular em vez
        // de se dissolver passo a passo.
        pronto = referenciaPronta!
      } else {
        /*
         * `naGpu` segura so a INFERENCIA, e nao a conversao depois dela: assim
         * o quadro N converte enquanto o N+1 ja esta na placa. Enfileirar a
         * conversao aqui deixaria a GPU esperando a CPU sem motivo.
         */
        const inferido = naGpu.then(() => rodarModelo(quadro, largura, altura, 3))
        naGpu = inferido.catch(() => undefined)
        pronto = inferido.then(converter)
        referencia = quadro
        alcanceDaReferencia = alcanceDe(quadro)
        referenciaPronta = pronto
      }

      naEscrita = naEscrita.then(async () => {
        const quadroPronto = await pronto
        if (!saida.stdin.write(quadroPronto)) {
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
  if (cancelado) throw new UpscaleCancelado()
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
  cancelado = false

  for (const [i, asset] of assets.entries()) {
    if (cancelado) throw new UpscaleCancelado()
    const ate = limites[asset.id]
    // O limite entra na chave: usar mais do clipe depois exige melhorar de novo.
    /*
     * O FORMATO entra na chave.
     *
     * O arquivo melhorado sai ja recortado no quadro do projeto: o mesmo clipe
     * vira 1242x2208 no vertical e 2208x1242 no horizontal. Sem o formato aqui,
     * abrir um projeto long form depois de ter melhorado o material em short
     * devolveria o recorte EM PE -- e o render aceitaria calado.
     */
    const marca =
      `v${VERSAO_DO_UPSCALE}-${formatoAtual()}-${Math.round(asset.focusX * 1000)}-${Math.round(asset.focusY * 1000)}` +
      (ate === undefined ? '' : `-${Math.round(ate * 10)}`) +
      // O invertido e outro arquivo: sem isto, inverter depois de melhorar
      // devolveria do cache o clipe ainda tocando para frente.
      (asset.invertido ? '-inv' : '')
    const ext = asset.kind === 'video' ? 'mp4' : 'jpg'
    const destino = join(dir, `${asset.id}-${marca}.${ext}`)

    if (!existsSync(destino)) {
      const parcial = `${destino}.part.${ext}`
      onProgress(i, assets.length, asset.fileName)
      try {
        if (asset.kind === 'video') {
          await ampliarClipe(asset, parcial, ate, () => onProgress(i, assets.length, asset.fileName))
        } else {
          await ampliarPrint(asset, parcial)
        }
      } catch (erro) {
        // Pela metade nao serve para nada -- e no proximo render pareceria pronto.
        rmSync(parcial, { force: true })
        throw erro
      }
      renameSync(parcial, destino)
    }
    feitos[asset.id] = destino
  }

  onProgress(assets.length, assets.length, '')
  return feitos
}

// ------------------------------------------------------------- video pronto

/**
 * Um MP4 JA PRONTO, inteiro, pelo mesmo modelo.
 *
 * "Deixar importar video pronto em mp4 pra dar upscale." Fora de qualquer
 * projeto: entra o arquivo, sai `nome-upscale.mp4` ao lado, com o audio
 * original copiado sem mexer.
 *
 * O TAMANHO: o video sai com o DOBRO da resolucao (1080x1920 vira 2160x3840),
 * limitado a 3840 no lado maior. O modelo amplia 4x, entao ele recebe o quadro
 * reduzido a metade -- a mesma ordem do upscale do render, em que o quadro
 * final nasce de uma reducao e nao de um aumento. Num 1080x1920 o modelo ve
 * 540x960, quase o mesmo tamanho da tira que ele ja amplia em cada clipe
 * (608x1080), entao memoria e velocidade sao as que ja se conhecem.
 */
export async function ampliarVideoPronto(
  entrada: string,
  destino: string,
  onProgress: (feitos: number, total: number) => void,
): Promise<void> {
  const info = await sondarVideo(entrada)
  const fator = Math.min(2, 3840 / Math.max(info.width, info.height))
  const par = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
  const saidaW = par(info.width * fator)
  const saidaH = par(info.height * fator)
  // O que o modelo recebe: um quarto da saida, em pares.
  const inW = par(saidaW / ESCALA)
  const inH = par(saidaH / ESCALA)
  const total = Math.max(1, Math.round(info.durationSec * info.fps))

  cancelado = false
  const parcial = `${destino}.part.mp4`
  try {
    await processarQuadros(
      [
        '-hide_banner', '-loglevel', 'error', '-i', entrada,
        '-vf', `scale=${inW}:${inH}:flags=area`,
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
      ],
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${saidaW}x${saidaH}`, '-r', info.fpsTexto, '-i', '-',
        // O audio vem do ARQUIVO original, copiado: nada nele precisa mudar.
        '-i', entrada, '-map', '0:v', '-map', '1:a?',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy', '-shortest', '-movflags', '+faststart',
        parcial,
      ],
      inW,
      inH,
      (dados) => paraTamanho(dados, inW, inH, saidaW, saidaH),
      (feitos) => onProgress(feitos, total),
    )
    renameSync(parcial, destino)
  } catch (erro) {
    rmSync(parcial, { force: true })
    throw erro
  }
}

/** Do que o modelo devolveu para um tamanho qualquer -- o irmao do paraQuadroDoRender. */
async function paraTamanho(
  dados: Float32Array,
  largura: number,
  altura: number,
  destW: number,
  destH: number,
): Promise<Buffer> {
  const ow = largura * ESCALA
  const oh = altura * ESCALA
  const plano = ow * oh
  const rgb = Buffer.allocUnsafe(plano * 3)
  for (let i = 0; i < plano; i++) {
    rgb[i * 3] = clamp255(dados[i]!)
    rgb[i * 3 + 1] = clamp255(dados[plano + i]!)
    rgb[i * 3 + 2] = clamp255(dados[2 * plano + i]!)
  }
  if (ow === destW && oh === destH) return rgb
  return sharp(rgb, { raw: { width: ow, height: oh, channels: 3 } })
    .resize(destW, destH, { fit: 'fill' })
    .raw()
    .toBuffer()
}

/**
 * Medidas, duracao e taxa de quadros, lidas do cabecalho que o ffmpeg imprime.
 *
 * A taxa volta EXATA quando e uma das NTSC: o ffmpeg escreve "23.98 fps", e
 * declarar 23.98 no lugar de 24000/1001 deslizaria o video contra o audio ao
 * longo de minutos.
 */
async function sondarVideo(
  path: string,
): Promise<{ width: number; height: number; durationSec: number; fps: number; fpsTexto: string }> {
  const texto = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', path], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', reject)
    child.on('close', () => resolve(stderr))
  })
  const video = texto.split('\n').find((l) => /Stream .*Video:/.test(l)) ?? ''
  const dim = /,\s(\d{2,5})x(\d{2,5})[\s,]/.exec(video)
  const dur = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(texto)
  const fps = /([\d.]+)\s+fps/.exec(video)
  if (!dim || !dur) throw new Error('Nao deu para ler esse video. Ele e um MP4 de verdade?')
  const bruto = fps ? Number(fps[1]) : 24000 / 1001
  const ntsc: Record<string, string> = { '23.98': '24000/1001', '29.97': '30000/1001', '59.94': '60000/1001', '47.95': '48000/1001' }
  const fpsTexto = ntsc[bruto.toFixed(2)] ?? String(bruto)
  const [n, d] = fpsTexto.split('/').map(Number)
  return {
    width: Number(dim[1]),
    height: Number(dim[2]),
    durationSec: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]),
    fps: d ? n! / d : n!,
    fpsTexto,
  }
}
