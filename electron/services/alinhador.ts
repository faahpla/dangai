import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { alinharPalavras, type TempoDaPalavra, type Vocabulario } from '@shared/alinhar'
import { ffmpegPath } from './ffmpeg-path'

/**
 * O modelo que diz em que quadro cada letra do roteiro soa.
 *
 * E o MESMO do LegendAI -- jonatasgrosman/wav2vec2-large-xlsr-53-portuguese,
 * que o WhisperX usa para portugues --, na exportacao ONNX da onnx-community
 * (Apache 2.0). A conta sobre a saida dele mora em @shared/alinhar.
 *
 * Por que o fp16 e nao outra das exportacoes, medido no projeto dele (Lye x
 * Ram, 246 palavras) contra o LegendAI:
 *
 *   fp16  631 MB   inicio da palavra identico em 221, ate 20 ms em 230
 *   q4    241 MB   184 ate 20 ms, pior caso 159 ms
 *
 * 20 ms e um quadro do modelo -- menos que um quadro do video. O q4 economiza
 * download mas erra palavra por mais de um quadro de video, que e exatamente o
 * defeito que isto veio consertar.
 *
 * DirectML primeiro (1,7 s pela narracao inteira numa RTX 3060), CPU como
 * reserva (20 s). O onnxruntime-node do Windows ja traz o DirectML, como no
 * etiquetador.
 */

const REPO = 'https://huggingface.co/onnx-community/wav2vec2-large-xlsr-53-portuguese-ONNX/resolve/main'
const MODEL_URL = `${REPO}/onnx/model_fp16.onnx`
const VOCAB_URL = `${REPO}/vocab.json`
const MODEL_MB = 631

const TAXA = 16_000
/** Amostras por quadro de emissao do wav2vec2 (o passo das convolucoes). */
const PASSO = 320

/**
 * Janela maxima de uma passada so.
 *
 * O LegendAI passa a narracao inteira de uma vez, e e isso que da a paridade
 * exata. Mas a atencao do wav2vec2 cresce com o quadrado da duracao: 67 s ja
 * sao ~700 MB de intermediario por camada. Acima disto a narracao vai em
 * janelas sobrepostas, e cada quadro e tirado da janela onde ele esta mais
 * longe da borda.
 */
const JANELA_SEC = 90
const SOBRA_SEC = 5

export type AlinhadorProgresso = (mensagem: string) => void

let baseDir: string | null = null

export function configureAlinhador(userDataDir: string): void {
  baseDir = join(userDataDir, 'alinhamento')
}

function dir(): string {
  if (!baseDir) throw new Error('Alinhador nao configurado')
  return baseDir
}

const caminhoModelo = (): string => join(dir(), 'model_fp16.onnx')
const caminhoVocab = (): string => join(dir(), 'vocab.json')

export function alinhadorPronto(): boolean {
  return existsSync(caminhoModelo()) && existsSync(caminhoVocab())
}

/**
 * Um download por vez, compartilhado.
 *
 * A analise e a leitura do roteiro na Biblioteca podem pedir o alinhamento
 * quase juntas. Dois downloads do mesmo arquivo de 631 MB brigariam pelo
 * mesmo .part.
 */
let baixando: Promise<void> | null = null

async function garantirModelo(onProgress: AlinhadorProgresso): Promise<void> {
  if (alinhadorPronto()) return
  baixando ??= (async () => {
    mkdirSync(dir(), { recursive: true })
    if (!existsSync(caminhoVocab())) await baixar(VOCAB_URL, caminhoVocab(), () => {})
    if (!existsSync(caminhoModelo())) {
      onProgress(`Baixando o sincronizador de legendas (so na primeira vez)... 0/${MODEL_MB} MB`)
      await baixar(MODEL_URL, caminhoModelo(), (mb) =>
        onProgress(`Baixando o sincronizador de legendas (so na primeira vez)... ${mb}/${MODEL_MB} MB`),
      )
    }
  })().finally(() => {
    baixando = null
  })
  await baixando
}

/** .part e rename so no fim: download interrompido nao passa por modelo pronto. */
async function baixar(url: string, alvo: string, onMb: (mb: number) => void): Promise<void> {
  const resposta = await fetch(url, { redirect: 'follow' })
  if (!resposta.ok || !resposta.body) {
    throw new Error(`Nao deu para baixar o sincronizador (${resposta.status}).`)
  }
  const parcial = `${alvo}.part`
  let baixado = 0
  let ultimo = 0
  const fonte = Readable.fromWeb(resposta.body as Parameters<typeof Readable.fromWeb>[0])
  fonte.on('data', (pedaco: Buffer) => {
    baixado += pedaco.length
    const mb = Math.floor(baixado / 1_000_000)
    if (mb > ultimo) {
      ultimo = mb
      onMb(mb)
    }
  })
  await pipeline(fonte, createWriteStream(parcial))
  renameSync(parcial, alvo)
}

/**
 * O audio como o WhisperX o le: mono, 16 kHz, inteiro de 16 bits dividido por
 * 32768. Sem normalizacao -- o WhisperX tambem nao normaliza, e qualquer
 * diferenca aqui mudaria os tempos.
 */
function lerAudio(caminho: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', caminho,
       '-f', 's16le', '-ac', '1', '-acodec', 'pcm_s16le', '-ar', String(TAXA), '-'],
      { windowsHide: true },
    )
    const pedacos: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => pedacos.push(c))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Nao deu para ler o audio: ${stderr.trim()}`))
        return
      }
      const bruto = Buffer.concat(pedacos)
      const pcm = new Int16Array(bruto.buffer, bruto.byteOffset, Math.floor(bruto.byteLength / 2))
      resolve(Float32Array.from(pcm, (v) => v / 32768))
    })
  })
}

type Ort = typeof import('onnxruntime-node')
type Sessao = import('onnxruntime-node').InferenceSession

async function abrirSessao(ort: Ort): Promise<Sessao> {
  try {
    return await ort.InferenceSession.create(caminhoModelo(), {
      executionProviders: ['dml', 'cpu'],
      graphOptimizationLevel: 'all',
    })
  } catch {
    // DirectML indisponivel nesta maquina (driver, GPU antiga): CPU pura.
    return ort.InferenceSession.create(caminhoModelo(), {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    })
  }
}

/** Quantos quadros o wav2vec2 devolve para `n` amostras. */
const quadrosDe = (n: number): number => (n < 400 ? 1 : Math.floor((n - 400) / PASSO) + 1)

/** log_softmax de uma janela de logits, no lugar. */
function logSoftmax(dados: Float32Array, quadros: number, classes: number): void {
  for (let f = 0; f < quadros; f++) {
    const o = f * classes
    let m = -Infinity
    for (let c = 0; c < classes; c++) if (dados[o + c]! > m) m = dados[o + c]!
    let z = 0
    for (let c = 0; c < classes; c++) z += Math.exp(dados[o + c]! - m)
    const l = m + Math.log(z)
    for (let c = 0; c < classes; c++) dados[o + c] = dados[o + c]! - l
  }
}

async function emitir(
  ort: Ort,
  sessao: Sessao,
  amostras: Float32Array,
): Promise<{ dados: Float32Array; quadros: number; classes: number }> {
  const entrada = sessao.inputNames[0]!
  const saida = sessao.outputNames[0]!
  // Minimo de 400 amostras, como o WhisperX garante com padding.
  const pedaco =
    amostras.length >= 400 ? amostras : Float32Array.from({ length: 400 }, (_, i) => amostras[i] ?? 0)
  const r = await sessao.run({ [entrada]: new ort.Tensor('float32', pedaco, [1, pedaco.length]) })
  const t = r[saida]!
  const [, quadros, classes] = t.dims as number[]
  const dados =
    t.type === 'float32'
      ? new Float32Array(t.data as Float32Array)
      : Float32Array.from(t.data as ArrayLike<number>, Number)
  logSoftmax(dados, quadros!, classes!)
  return { dados, quadros: quadros!, classes: classes! }
}

/**
 * A emissao da narracao inteira: uma passada so ate JANELA_SEC, e janelas
 * sobrepostas acima disso.
 */
async function emissaoCompleta(
  ort: Ort,
  sessao: Sessao,
  audio: Float32Array,
  onProgress: AlinhadorProgresso,
): Promise<{ dados: Float32Array; quadros: number; classes: number }> {
  if (audio.length <= JANELA_SEC * TAXA) return emitir(ort, sessao, audio)

  const total = quadrosDe(audio.length)
  const janela = JANELA_SEC * TAXA
  const sobra = SOBRA_SEC * TAXA
  let dados: Float32Array | null = null
  let classes = 0
  // Cada janela fica dona dos quadros do seu miolo: [inicio + sobra, fim - sobra).
  const util = janela - 2 * sobra
  for (let dono = 0; dono < audio.length; dono += util) {
    const ini = Math.max(0, dono - sobra)
    // Inicio alinhado ao passo: o quadro local i vira o global ini/PASSO + i.
    const iniAlinhado = ini - (ini % PASSO)
    const fim = Math.min(audio.length, dono + util + sobra)
    onProgress(`Sincronizando as legendas... ${Math.round((dono / audio.length) * 100)}%`)
    const e = await emitir(ort, sessao, audio.subarray(iniAlinhado, fim))
    classes = e.classes
    dados ??= new Float32Array(total * classes)
    const primeiro = Math.floor(dono / PASSO)
    const ultimo = Math.min(total, Math.floor((dono + util) / PASSO))
    for (let g = primeiro; g < ultimo; g++) {
      const local = g - iniAlinhado / PASSO
      if (local < 0 || local >= e.quadros) continue
      dados.set(e.dados.subarray(local * classes, (local + 1) * classes), g * classes)
    }
  }
  return { dados: dados!, quadros: total, classes }
}

export interface Alinhamento {
  tempos: TempoDaPalavra[]
  /** Confianca media -- abaixo de ~0,35 o roteiro nao e o deste audio. */
  score: number
}

/**
 * Onde cada palavra soa. `null` quando nao da para alinhar (texto sem letra
 * nenhuma, audio mais curto que o texto).
 */
export async function alinharAoAudio(
  audioPath: string,
  palavras: readonly string[],
  onProgress: AlinhadorProgresso,
): Promise<Alinhamento | null> {
  if (palavras.length === 0) return null
  await garantirModelo(onProgress)

  onProgress('Sincronizando as legendas com a narracao...')
  const audio = await lerAudio(audioPath)
  const vocab = JSON.parse(readFileSync(caminhoVocab(), 'utf8')) as Vocabulario
  const ort = await import('onnxruntime-node')
  const sessao = await abrirSessao(ort)
  try {
    const e = await emissaoCompleta(ort, sessao, audio, onProgress)
    // Segundos por quadro como o WhisperX calcula: duracao / quadros.
    const tempos = alinharPalavras(palavras, e.dados, e.quadros, e.classes, vocab, audio.length / TAXA / e.quadros)
    if (!tempos) return null
    const comNota = tempos.filter((t) => t.score > 0)
    const score = comNota.reduce((a, t) => a + t.score, 0) / Math.max(comNota.length, 1)
    return { tempos, score }
  } finally {
    await sessao.release()
  }
}
