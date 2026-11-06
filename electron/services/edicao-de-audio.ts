import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  filtrosDaCadeia,
  limiteDaIa,
  silenciosDoSinal,
  type EdicaoDeAudio,
  type OpcoesDosSilencios,
  type TrechoDaGravacao,
} from '@shared/edicao-de-audio'
import { EnergiaK } from '@shared/loudness'
import { ffmpegPath } from './ffmpeg-path'
import { publish } from './media-server'
import { aplicarPlugins } from './vst'

/**
 * A ETAPA DE AUDIO por dentro: da gravacao crua a narracao pronta.
 *
 *   gravacao -> 48 kHz mono (uma vez) -> IA de limpeza (uma vez por quantidade)
 *   -> os trechos que ficam, emendados aqui -> nivelar, EQ, compressor (ffmpeg)
 *   -> plugins VST3 (o Fresh Air) -> normalizar (LUFS medido aqui) -> .wav
 *
 * Cada passo caro fica em cache no userData: mexer num botao do compressor nao
 * refaz a IA, e desfazer um corte acha o audio de antes pronto. A gravacao
 * nunca e alterada; o "Pronto" grava a narracao final AO LADO dela.
 */

const TAXA = 48_000
/** Muda quando a receita muda: o cache velho deixa de servir sozinho. */
const VERSAO = 2
/** Emenda de dois trechos: 4 ms descendo e 4 subindo, sem clique. */
const EMENDA_SEC = 0.004

let pasta: string | null = null

export function configureEdicaoDeAudio(userData: string): void {
  pasta = join(userData, 'audio-editado')
  // Sem esperar: limpar o cache velho nao pode atrasar a abertura.
  setTimeout(limparCacheVelho, 30_000).unref?.()
}

function dir(...partes: string[]): string {
  if (!pasta) throw new Error('Edição de áudio não configurada')
  const d = join(pasta, ...partes)
  mkdirSync(d, { recursive: true })
  return d
}

/** O que identifica uma gravacao: caminho, tamanho e data. Trocar o arquivo invalida tudo. */
function identidade(caminho: string): string {
  const st = statSync(caminho)
  return createHash('sha1').update(`${caminho}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 16)
}

const hash = (x: unknown): string => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 20)

// ------------------------------------------------------------- ffmpeg e wav

function rodarFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', (e) => reject(new Error(`FFmpeg falhou: ${e.message}`)))
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Não deu para processar o áudio: ${stderr.trim().split('\n').slice(-2).join(' ')}`)),
    )
  })
}

/** A gravacao inteira em float, mono, 48 kHz -- direto do stdout do ffmpeg. */
function lerMono(caminho: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', caminho, '-vn', '-ac', '1', '-ar', String(TAXA), '-f', 'f32le', '-'],
      { windowsHide: true },
    )
    const pedacos: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => pedacos.push(c))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', (e) => reject(new Error(`FFmpeg falhou: ${e.message}`)))
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Não deu para ler o áudio: ${stderr.trim().split('\n').pop() ?? ''}`))
      const buf = Buffer.concat(pedacos)
      const x = new Float32Array(Math.floor(buf.length / 4))
      Buffer.from(x.buffer).set(buf.subarray(0, x.length * 4))
      resolve(x)
    })
  })
}

/** As ultimas gravacoes lidas ficam na memoria: cada mexida le de novo a mesma. */
const lidas = new Map<string, Promise<Float32Array>>()
function lerMonoComCache(caminho: string): Promise<Float32Array> {
  const chave = `${caminho}|${identidade(caminho)}`
  let p = lidas.get(chave)
  if (!p) {
    p = lerMono(caminho)
    p.catch(() => lidas.delete(chave))
    lidas.set(chave, p)
    while (lidas.size > 4) lidas.delete(lidas.keys().next().value!)
  }
  return p
}

/** WAV de 32 bits float: os ganhos dos trechos podem passar de 0 dBFS sem cortar. */
function gravarWavFloat(caminho: string, x: Float32Array): void {
  const cabecalho = Buffer.alloc(44)
  const dados = x.length * 4
  cabecalho.write('RIFF', 0)
  cabecalho.writeUInt32LE(36 + dados, 4)
  cabecalho.write('WAVE', 8)
  cabecalho.write('fmt ', 12)
  cabecalho.writeUInt32LE(16, 16)
  cabecalho.writeUInt16LE(3, 20) // IEEE float
  cabecalho.writeUInt16LE(1, 22)
  cabecalho.writeUInt32LE(TAXA, 24)
  cabecalho.writeUInt32LE(TAXA * 4, 28)
  cabecalho.writeUInt16LE(4, 32)
  cabecalho.writeUInt16LE(32, 34)
  cabecalho.write('data', 36)
  cabecalho.writeUInt32LE(dados, 40)
  const parcial = `${caminho}.part`
  writeFileSync(parcial, Buffer.concat([cabecalho, Buffer.from(x.buffer, x.byteOffset, dados)]))
  renameSync(parcial, caminho)
}

// ------------------------------------------------------------- a gravacao

/** A gravacao em 48 kHz mono, 16 bits: o que a IA de limpeza le. */
async function base(bruto: string): Promise<string> {
  const alvo = join(dir('base'), `${identidade(bruto)}.wav`)
  if (!existsSync(alvo)) {
    const parcial = `${alvo}.part.wav`
    await rodarFfmpeg(['-i', bruto, '-vn', '-ac', '1', '-ar', String(TAXA), '-c:a', 'pcm_s16le', parcial])
    renameSync(parcial, alvo)
  }
  return alvo
}

// ------------------------------------------------------------- a IA de limpeza

/**
 * O "AI Voice Isolation": DeepFilterNet 3, um programa so (27 MB) com a rede
 * dentro, de codigo aberto (MIT/Apache). Medido numa narracao dele com ruido
 * rosa e zumbido de 60 Hz: o ruido sozinho caiu 17 dB e a voz ficou onde
 * estava, 20 s em 1,7 s de CPU. Baixado na primeira vez, como o Whisper.
 */
const IA = {
  versao: '0.5.6',
  url: 'https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/deep-filter-0.5.6-x86_64-pc-windows-msvc.exe',
  sha256: '75e11fa16445f560cb6b021521ddb89e89270d13b83089705d98776f58fd7915',
  mb: 27,
}

export const TAMANHO_DA_IA_DE_LIMPEZA_MB = IA.mb
const caminhoDaIa = (): string => join(dir('ferramentas'), `deep-filter-${IA.versao}.exe`)

export function iaDeLimpezaPronta(): boolean {
  return process.platform === 'win32' && pasta !== null && existsSync(caminhoDaIa())
}

let baixandoIa: Promise<void> | null = null

export function prepararIaDeLimpeza(onProgress: (m: string) => void): Promise<void> {
  if (iaDeLimpezaPronta()) return Promise.resolve()
  if (process.platform !== 'win32') return Promise.reject(new Error('A limpeza de voz por IA ainda só existe no Windows.'))
  baixandoIa ??= (async () => {
    const alvo = caminhoDaIa()
    const parcial = `${alvo}.part`
    onProgress(`Baixando a IA de limpeza (só na primeira vez)... 0/${IA.mb} MB`)
    const resposta = await fetch(IA.url, { redirect: 'follow' })
    if (!resposta.ok || !resposta.body) throw new Error(`Não deu para baixar a IA de limpeza (${resposta.status}).`)
    let baixado = 0
    let ultimo = 0
    const fonte = Readable.fromWeb(resposta.body as Parameters<typeof Readable.fromWeb>[0])
    fonte.on('data', (c: Buffer) => {
      baixado += c.length
      const mb = Math.floor(baixado / 1_000_000)
      if (mb > ultimo) {
        ultimo = mb
        onProgress(`Baixando a IA de limpeza (só na primeira vez)... ${mb}/${IA.mb} MB`)
      }
    })
    await pipeline(fonte, createWriteStream(parcial))
    // Programa que roda na maquina dele: so entra se for o arquivo publicado.
    const soma = createHash('sha256')
    await pipeline(createReadStream(parcial), soma)
    if (soma.digest('hex') !== IA.sha256) {
      rmSync(parcial, { force: true })
      throw new Error('O download da IA de limpeza veio diferente do esperado. Tente de novo.')
    }
    renameSync(parcial, alvo)
  })().finally(() => {
    baixandoIa = null
  })
  return baixandoIa
}

const limpando = new Map<string, Promise<string>>()

/** A gravacao limpa pela IA, uma vez por quantidade. */
async function limpa(baseWav: string, quantidade: number, onProgress: (m: string) => void): Promise<string> {
  const limite = limiteDaIa(quantidade)
  const alvo = join(dir('limpa'), `${basename(baseWav, '.wav')}-a${limite}.wav`)
  if (existsSync(alvo)) return alvo
  let p = limpando.get(alvo)
  if (!p) {
    p = (async () => {
      await prepararIaDeLimpeza(onProgress)
      onProgress('Limpando a voz (IA)...')
      const saida = dir('limpa', `_${process.pid}-${Date.now()}`)
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(caminhoDaIa(), ['-D', '-a', String(limite), '-o', saida, baseWav], { windowsHide: true })
          let stderr = ''
          child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
          child.on('error', (e) => reject(new Error(`A IA de limpeza não abriu: ${e.message}`)))
          child.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error(`A IA de limpeza falhou: ${stderr.trim().split('\n').pop() ?? code}`)),
          )
        })
        renameSync(join(saida, basename(baseWav)), alvo)
      } finally {
        rmSync(saida, { recursive: true, force: true })
      }
      return alvo
    })().finally(() => limpando.delete(alvo))
    limpando.set(alvo, p)
  }
  return p
}

// ------------------------------------------------------------- os cortes

/**
 * Os trechos que ficam, emendados. Cada um com o volume dele; nas emendas, 4 ms
 * descendo e 4 subindo -- um corte seco no meio de uma onda estala.
 */
export function montarCortes(x: Float32Array, trechos: readonly TrechoDaGravacao[]): Float32Array {
  const pedacos = trechos.map((t) => {
    const a = Math.max(0, Math.min(x.length, Math.round(t.de * TAXA)))
    const b = Math.max(a, Math.min(x.length, Math.round(t.ate * TAXA)))
    return { a, b, ganho: 10 ** (t.ganhoDb / 20) }
  })
  const total = pedacos.reduce((s, p) => s + (p.b - p.a), 0)
  const saida = new Float32Array(total)
  const emenda = Math.round(EMENDA_SEC * TAXA)
  let o = 0
  for (const [k, p] of pedacos.entries()) {
    const n = p.b - p.a
    const subir = k > 0 ? Math.min(emenda, Math.floor(n / 2)) : 0
    const descer = k < pedacos.length - 1 ? Math.min(emenda, Math.floor(n / 2)) : 0
    for (let i = 0; i < n; i++) {
      let g = p.ganho
      if (i < subir) g *= i / subir
      if (i >= n - descer) g *= (n - 1 - i) / descer
      saida[o + i] = x[p.a + i]! * g
    }
    o += n
  }
  return saida
}

/** 100 picos por segundo (e o RMS) para a onda da linha do tempo. */
function ondaDe(x: Float32Array): { peaks: number[]; rms: number[] } {
  const porBalde = TAXA / 100
  const baldes = Math.max(1, Math.ceil(x.length / porBalde))
  const peaks: number[] = new Array(baldes)
  const rms: number[] = new Array(baldes)
  for (let b = 0; b < baldes; b++) {
    const ini = Math.floor(b * porBalde)
    const fim = Math.min(x.length, Math.floor((b + 1) * porBalde))
    let max = 0
    let soma = 0
    for (let i = ini; i < fim; i++) {
      const v = x[i]!
      const m = v < 0 ? -v : v
      if (m > max) max = m
      soma += v * v
    }
    peaks[b] = Math.round(Math.min(1, max) * 1000) / 1000
    rms[b] = fim > ini ? Math.round(Math.min(1, Math.sqrt(soma / (fim - ini))) * 1000) / 1000 : 0
  }
  return { peaks, rms }
}

// ------------------------------------------------------------- render

export interface AudioEditado {
  arquivo: string
  url: string
  durationSec: number
  /** O volume medido do resultado, LUFS (null = silencio). */
  lufs: number | null
}

export interface OndaDaGravacao {
  /** 100 por segundo, da gravacao INTEIRA (o corte e feito na tela). */
  peaks: number[]
  rms: number[]
  durationSec: number
}

/** A fonte dos cortes: a gravacao limpa pela IA, ou a crua. */
async function fonte(edicao: EdicaoDeAudio, comIa: boolean, onProgress: (m: string) => void): Promise<string> {
  onProgress('Lendo a gravação...')
  const b = await base(edicao.bruto)
  const { isolarVoz } = edicao.cadeia
  return comIa && isolarVoz.ligado && isolarVoz.quantidade > 0 ? limpa(b, isolarVoz.quantidade, onProgress) : b
}

const processando = new Map<string, Promise<string>>()

/**
 * A GRAVACAO INTEIRA com os efeitos do meio (nivelar, EQ, compressor) e os
 * plugins -- ANTES dos cortes. Cortar depois faz o corte ser instantaneo: so
 * mexer num efeito refaz isto. Comprimir antes ou depois de tirar uma pausa
 * muda so os milissegundos em volta da emenda.
 */
async function processado(edicao: EdicaoDeAudio, onProgress: (m: string) => void): Promise<string> {
  const f = await fonte(edicao, true, onProgress)
  const filtros = filtrosDaCadeia(edicao.cadeia)
  const plugins = edicao.cadeia.plugins.filter((p) => p.ligado)
  if (!filtros && plugins.length === 0) return f
  const chave = hash({ v: VERSAO, f: basename(f), filtros, p: plugins.map((p) => [p.caminho, p.estado, p.parametros]) })
  const alvo = join(dir('processado'), `${chave}.wav`)
  if (existsSync(alvo)) return alvo
  let p = processando.get(chave)
  if (!p) {
    p = (async () => {
      const temp = dir('processado', `_${chave}`)
      try {
        let atual = f
        if (filtros) {
          onProgress('Aplicando os efeitos...')
          const proximo = join(temp, 'meio.wav')
          await rodarFfmpeg(['-i', atual, '-af', filtros, '-ar', String(TAXA), '-ac', '1', '-c:a', 'pcm_f32le', proximo])
          atual = proximo
        }
        if (plugins.length > 0) {
          onProgress(plugins.length === 1 ? `Passando pelo ${plugins[0]!.nome}...` : 'Passando pelos plugins...')
          const proximo = join(temp, 'plugins.wav')
          await aplicarPlugins(atual, proximo, plugins)
          atual = proximo
        }
        renameSync(atual, alvo)
      } finally {
        rmSync(temp, { recursive: true, force: true })
      }
      return alvo
    })().finally(() => processando.delete(chave))
    processando.set(chave, p)
  }
  return p
}

/** O que se ouve: com os efeitos, a gravacao processada; sem, a crua. */
function fonteDaEscuta(edicao: EdicaoDeAudio, efeitos: boolean, onProgress: (m: string) => void): Promise<string> {
  return efeitos ? processado(edicao, onProgress) : fonte(edicao, false, onProgress)
}

/**
 * A onda da gravacao INTEIRA (com ou sem os efeitos), 100 picos por segundo.
 * A tela corta ela pelos trechos: cortar nao pede onda nova.
 */
export async function ondaDaEdicao(
  edicao: EdicaoDeAudio,
  efeitos: boolean,
  onProgress: (m: string) => void,
): Promise<OndaDaGravacao> {
  if (!existsSync(edicao.bruto)) throw new Error(`A gravação não está mais no disco: ${basename(edicao.bruto)}`)
  const f = await fonteDaEscuta(edicao, efeitos, onProgress)
  const ficha = `${f}.onda.json`
  if (existsSync(ficha)) return JSON.parse(readFileSync(ficha, 'utf8')) as OndaDaGravacao
  const x = await lerMonoComCache(f)
  const onda = { ...ondaDe(x), durationSec: x.length / TAXA }
  writeFileSync(ficha, JSON.stringify(onda))
  return onda
}

function lufsDe(x: Float32Array): number | null {
  const medidor = new EnergiaK(TAXA, 1)
  medidor.intercalado(x)
  return medidor.resultado().integrado
}

const rendendo = new Map<string, Promise<AudioEditado>>()

/**
 * O audio da edicao para ouvir e para o "Pronto": a fonte da escuta cortada
 * pelos trechos e, com os efeitos, normalizada. Mesma receita, mesmo arquivo:
 * desfazer um corte acha o audio de antes pronto.
 */
export async function renderizarEdicao(
  edicao: EdicaoDeAudio,
  efeitos: boolean,
  onProgress: (m: string) => void,
): Promise<AudioEditado> {
  if (!existsSync(edicao.bruto)) throw new Error(`A gravação não está mais no disco: ${basename(edicao.bruto)}`)
  const f = await fonteDaEscuta(edicao, efeitos, onProgress)
  const normalizar = efeitos && edicao.cadeia.normalizar.ligado ? edicao.cadeia.normalizar.alvoLufs : null
  const chave = hash({ v: VERSAO, f: basename(f), t: edicao.trechos, n: normalizar })
  const arquivo = join(dir('render'), `${chave}.wav`)
  const ficha = join(dir('render'), `${chave}.json`)
  if (existsSync(arquivo) && existsSync(ficha)) {
    const fi = JSON.parse(readFileSync(ficha, 'utf8')) as { durationSec: number; lufs: number | null }
    return { ...fi, arquivo, url: publish(arquivo) }
  }
  let p = rendendo.get(chave)
  if (!p) {
    p = (async () => {
      const x = montarCortes(await lerMonoComCache(f), edicao.trechos)
      if (normalizar !== null) {
        const medido = lufsDe(x)
        if (medido !== null) {
          const ganho = 10 ** ((normalizar - medido) / 20)
          for (let i = 0; i < x.length; i++) x[i] = x[i]! * ganho
        }
      }
      // O teto: nada passa de -1 dB, nem ENTRE as amostras. O limiter roda em
      // 4x a taxa: em 48 kHz ele deixava picos reais de +1,2 dB (medido com o
      // ebur128), que estouram quando o video e comprimido para o YouTube.
      const temp = `${arquivo}.pre.wav`
      gravarWavFloat(temp, x)
      try {
        await rodarFfmpeg(['-i', temp, '-af', `aresample=${TAXA * 4},alimiter=limit=0.891:level=0:attack=2:release=60,aresample=${TAXA}`, '-ar', String(TAXA), '-ac', '1', '-c:a', 'pcm_s16le', `${arquivo}.part.wav`])
        renameSync(`${arquivo}.part.wav`, arquivo)
      } finally {
        rmSync(temp, { force: true })
      }
      const fi = { durationSec: x.length / TAXA, lufs: lufsDe(await lerMono(arquivo)) }
      writeFileSync(ficha, JSON.stringify(fi))
      return { ...fi, arquivo, url: publish(arquivo) }
    })().finally(() => rendendo.delete(chave))
    rendendo.set(chave, p)
  }
  return p
}

/**
 * Os silencios da gravacao, em segundos DELA. Lidos do audio limpo quando a IA
 * esta ligada: sem o ruido de fundo, a pausa e funda e o limiar acha todas.
 */
export async function silenciosDaGravacao(
  edicao: EdicaoDeAudio,
  opcoes: OpcoesDosSilencios,
  onProgress: (m: string) => void,
): Promise<{ de: number; ate: number }[]> {
  const x = await lerMonoComCache(await fonte(edicao, true, onProgress))
  const passo = Math.round(TAXA * 0.01)
  const db: number[] = []
  for (let i = 0; i + passo <= x.length; i += passo) {
    let soma = 0
    for (let k = i; k < i + passo; k++) soma += x[k]! * x[k]!
    db.push(10 * Math.log10(soma / passo + 1e-12))
  }
  return silenciosDoSinal(db, 0.01, opcoes)
}

/**
 * O "Pronto": a narracao final AO LADO da gravacao, "<nome> (editado).wav".
 * Ele acha o arquivo onde guarda os audios e pode usar fora do Dangai. Um
 * arquivo com esse nome que nao seja o desta edicao nunca e sobrescrito.
 */
export async function concluirEdicao(edicao: EdicaoDeAudio, onProgress: (m: string) => void): Promise<string> {
  const pronto = await renderizarEdicao(edicao, true, onProgress)
  const pasta = dirname(edicao.bruto)
  const nome = basename(edicao.bruto, extname(edicao.bruto))
  let saida = edicao.saida && dirname(edicao.saida) === pasta ? edicao.saida : join(pasta, `${nome} (editado).wav`)
  for (let k = 2; existsSync(saida) && saida !== edicao.saida; k++) saida = join(pasta, `${nome} (editado ${k}).wav`)
  copyFileSync(pronto.arquivo, saida)
  return saida
}

/** Renders com mais de 2 dias e gravacoes lidas ha mais de 14 saem do cache. */
function limparCacheVelho(): void {
  if (!pasta || !existsSync(pasta)) return
  const agora = Date.now()
  for (const [sub, dias] of [['render', 2], ['processado', 3], ['base', 14], ['limpa', 14]] as const) {
    const d = join(pasta, sub)
    if (!existsSync(d)) continue
    for (const nome of readdirSync(d)) {
      try {
        const p = join(d, nome)
        if (agora - statSync(p).mtimeMs > dias * 86_400_000) rmSync(p, { recursive: true, force: true })
      } catch {
        // Em uso por outro render: fica para a proxima.
      }
    }
  }
}
