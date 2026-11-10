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
  duracaoEditada,
  fatorDaVelocidade,
  filtrosDaCadeia,
  fimDo,
  FONTE_PRINCIPAL,
  fonteDo,
  limiteDaIa,
  silenciosDoSinal,
  type EdicaoDeAudio,
  type EfeitoDoTrecho,
  type OpcoesDosSilencios,
  type TrechoDaGravacao,
} from '@shared/edicao-de-audio'
import { EnergiaK } from '@shared/loudness'
import { ffmpegPath } from './ffmpeg-path'
import { publish } from './media-server'
import { aplicarPlugins, prepararPlugins } from './vst'

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

/** A gravacao inteira em float, mono, 48 kHz -- direto do stdout do ffmpeg. `filtro`: um -af no caminho. */
function lerMono(caminho: string, filtro?: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', caminho, '-vn', ...(filtro ? ['-af', filtro] : []), '-ac', '1', '-ar', String(TAXA), '-f', 'f32le', '-'],
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
/*
 * Uma conversao por gravacao: a onda e a escuta pedem a mesma base juntas ao abrir
 * a etapa, e as duas escrevendo o mesmo .part davam ENOENT no rename da segunda.
 */
const convertendo = new Map<string, Promise<string>>()

async function base(bruto: string): Promise<string> {
  const alvo = join(dir('base'), `${identidade(bruto)}.wav`)
  if (existsSync(alvo)) return alvo
  let p = convertendo.get(alvo)
  if (!p) {
    p = (async () => {
      const parcial = `${alvo}.part.wav`
      await rodarFfmpeg(['-i', bruto, '-vn', '-ac', '1', '-ar', String(TAXA), '-c:a', 'pcm_s16le', parcial])
      renameSync(parcial, alvo)
      return alvo
    })()
    convertendo.set(alvo, p)
    void p.then(
      () => convertendo.delete(alvo),
      () => convertendo.delete(alvo),
    )
  }
  return p
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
 * A MISTURA DAS FAIXAS: cada trecho, da gravacao dele (a principal ou uma
 * correcao) e com o volume dele, no lugar dele da linha do tempo. Faixas
 * diferentes no mesmo instante somam; vao e silencio. Em cada ponta de trecho,
 * 4 ms subindo ou descendo -- um corte seco no meio de uma onda estala --, menos
 * onde o vizinho da mesma faixa continua a mesma gravacao sem pulo (so cortou
 * ali, nao tirou nada): ali a onda segue inteira.
 */
export function montarMix(
  fontes: Readonly<Record<string, Float32Array>>,
  trechos: readonly TrechoDaGravacao[],
  /** O som de um trecho COM o efeito dele (pelo id), no lugar do pedaco da gravacao. */
  comEfeito: ReadonlyMap<string, Float32Array> = new Map(),
): Float32Array {
  const saida = new Float32Array(Math.round(duracaoEditada(trechos) * TAXA))
  const emenda = Math.round(EMENDA_SEC * TAXA)
  const continua = (antes: TrechoDaGravacao, depois: TrechoDaGravacao): boolean =>
    antes.faixa === depois.faixa &&
    fonteDo(antes) === fonteDo(depois) &&
    Math.abs(fimDo(antes) - depois.em) < 0.001 &&
    Math.abs(antes.ate - depois.de) < 0.001 &&
    antes.ganhoDb === depois.ganhoDb &&
    !antes.efeito &&
    !depois.efeito
  for (const t of trechos) {
    const trocado = comEfeito.get(t.id)
    const x = trocado ?? fontes[fonteDo(t)] ?? new Float32Array(0)
    const a = trocado ? 0 : Math.max(0, Math.min(x.length, Math.round(t.de * TAXA)))
    const b = trocado ? x.length : Math.max(a, Math.min(x.length, Math.round(t.ate * TAXA)))
    const n = b - a
    const o = Math.round(t.em * TAXA)
    const ganho = 10 ** (t.ganhoDb / 20)
    const subir = trechos.some((y) => y !== t && continua(y, t)) ? 0 : Math.min(emenda, Math.floor(n / 2))
    const descer = trechos.some((y) => y !== t && continua(t, y)) ? 0 : Math.min(emenda, Math.floor(n / 2))
    for (let i = 0; i < n && o + i < saida.length; i++) {
      let g = ganho
      if (i < subir) g *= i / subir
      if (i >= n - descer) g *= (n - 1 - i) / descer
      saida[o + i]! += x[a + i]! * g
    }
  }
  return saida
}

/** O pedaco [de, ate) de uma gravacao lida, como copia. */
function pedacoDe(x: Float32Array, de: number, ate: number): Float32Array {
  const a = Math.max(0, Math.min(x.length, Math.round(de * TAXA)))
  const b = Math.max(a, Math.min(x.length, Math.round(ate * TAXA)))
  return x.slice(a, b)
}

/** Meio-tom: o quanto a voz sobe ou desce em "fina" e "grossa" (7 = uma quinta, a voz de esquilo). */
const SEMITONS = 7

/** Os filtros do ffmpeg de cada efeito. Todos devolvem o mesmo tamanho (sem eco passando do fim). */
function filtroDoEfeito(efeito: EfeitoDoTrecho): string | null {
  const subir = (2 ** (SEMITONS / 12)).toFixed(6)
  const descer = (2 ** (-SEMITONS / 12)).toFixed(6)
  switch (efeito) {
    // Muda o tom pela taxa e devolve o tempo pelo atempo: mais aguda (ou grave), no mesmo tempo.
    case 'fina':
      return `asetrate=${TAXA}*${subir},aresample=${TAXA},atempo=${(1 / Number(subir)).toFixed(6)}`
    case 'grossa':
      return `asetrate=${TAXA}*${descer},aresample=${TAXA},atempo=${(1 / Number(descer)).toFixed(6)}`
    // Fase zerada em cada janela: a voz vira robo (o "robotize" classico).
    case 'robo':
      return "afftfilt=real='hypot(re,im)':imag='0':win_size=512:overlap=0.75"
    case 'eco':
      return 'aecho=0.8:0.8:180|360:0.45|0.25'
    case 'radio':
      return 'highpass=f=400,lowpass=f=3200,acompressor=threshold=0.1:ratio=4:makeup=2.5'
    case 'reverso':
      return 'areverse'
    default:
      return null
  }
}

const comEfeitoLidos = new Map<string, Promise<Float32Array>>()

/**
 * O som do trecho COM o efeito, do tamanho exato do trecho. "bip" e "mudo" sao
 * feitos aqui (o bipe no volume da fala que ele cobre); o resto passa pelo
 * ffmpeg. Guardado na memoria pela receita: mexer em outro trecho nao refaz.
 */
export async function efeitoNoPedaco(pedaco: Float32Array, efeito: EfeitoDoTrecho, chave: string): Promise<Float32Array> {
  const n = pedaco.length
  if (efeito === 'mudo') return new Float32Array(n)
  if (efeito === 'bip') {
    let soma = 0
    for (let i = 0; i < n; i++) soma += pedaco[i]! * pedaco[i]!
    const rms = Math.sqrt(soma / Math.max(1, n))
    // Um seno com o mesmo volume medio da fala (seno: pico = RMS x 1,41), nem sumido nem estourado.
    const amplitude = Math.min(0.5, Math.max(0.05, rms * 1.41))
    const bip = new Float32Array(n)
    for (let i = 0; i < n; i++) bip[i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / TAXA)
    return bip
  }
  const filtro = filtroDoEfeito(efeito)
  if (!filtro) return pedaco
  let p = comEfeitoLidos.get(chave)
  if (!p) {
    p = (async () => {
      const temp = join(dir('render'), `_efeito-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`)
      gravarWavFloat(temp, pedaco)
      try {
        const y = await lerMono(temp, filtro)
        // Do tamanho exato: o atempo erra por alguns ms, e o resto da linha nao pode andar.
        const certo = new Float32Array(n)
        certo.set(y.subarray(0, n))
        return certo
      } finally {
        rmSync(temp, { force: true })
      }
    })()
    p.catch(() => comEfeitoLidos.delete(chave))
    comEfeitoLidos.set(chave, p)
    while (comEfeitoLidos.size > 40) comEfeitoLidos.delete(comEfeitoLidos.keys().next().value!)
  }
  return p
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

/**
 * As gravacoes desta edicao: a principal e as correcoes, pelo id. Uma que saiu
 * do disco para tudo com o nome dela -- tocar sem ela seria um buraco mudo.
 */
function fontesDa(edicao: EdicaoDeAudio): [string, string][] {
  const todas: [string, string][] = [[FONTE_PRINCIPAL, edicao.bruto], ...edicao.correcoes.map((c): [string, string] => [c.id, c.caminho])]
  for (const [, caminho] of todas) {
    if (!existsSync(caminho)) throw new Error(`A gravação não está mais no disco: ${basename(caminho)}`)
  }
  return todas
}

/** O arquivo de onde os cortes saem: a gravacao limpa pela IA, ou a crua. */
async function fonte(caminho: string, edicao: EdicaoDeAudio, comIa: boolean, onProgress: (m: string) => void): Promise<string> {
  onProgress('Lendo a gravação...')
  const b = await base(caminho)
  const { isolarVoz } = edicao.cadeia
  return comIa && isolarVoz.ligado && isolarVoz.quantidade > 0 ? limpa(b, isolarVoz.quantidade, onProgress) : b
}

const processando = new Map<string, Promise<string>>()

/**
 * A GRAVACAO INTEIRA com os efeitos do meio (nivelar, EQ, compressor) e os
 * plugins -- ANTES dos cortes. Cortar depois faz o corte ser instantaneo: so
 * mexer num efeito refaz isto. Comprimir antes ou depois de tirar uma pausa
 * muda so os milissegundos em volta da emenda. Cada correcao passa pela mesma
 * cadeia, separada: a voz regravada sai com o mesmo som da principal.
 */
async function processado(caminho: string, edicao: EdicaoDeAudio, onProgress: (m: string) => void): Promise<string> {
  const f = await fonte(caminho, edicao, true, onProgress)
  const filtros = filtrosDaCadeia(edicao.cadeia)
  const plugins = edicao.cadeia.plugins.filter((p) => p.ligado)
  if (!filtros && plugins.length === 0) return f
  // A identidade da gravacao na frente do nome: a faxina acha o que e de quem.
  const identidadeDaFonte = basename(f, '.wav').slice(0, 16)
  const meio = filtros ? await comFiltros(f, filtros, identidadeDaFonte, onProgress) : f
  if (plugins.length === 0) return meio
  /*
   * OS PLUGINS em cima do arquivo com os filtros, guardado a parte: mexer no
   * Fresh Air (inclusive com a janela dele aberta, ao vivo) so refaz esta
   * passada, nao o nivelador, o EQ e o compressor.
   */
  const chave = hash({ v: VERSAO, f: basename(meio), p: plugins.map((p) => [p.caminho, p.estado, p.parametros]) })
  const alvo = join(dir('processado'), `${identidadeDaFonte}-${chave}.wav`)
  if (existsSync(alvo)) return alvo
  let p = processando.get(chave)
  if (!p) {
    p = (async () => {
      const temp = dir('processado', `_${chave}`)
      try {
        // O leitor de plugins pode ser de uma versao anterior (ou nao estar baixado): sem
        // isto, quem atualizou o Dangai com o Fresh Air na cadeia via "nao esta instalado".
        await prepararPlugins(onProgress)
        onProgress(plugins.length === 1 ? `Passando pelo ${plugins[0]!.nome}...` : 'Passando pelos plugins...')
        const proximo = join(temp, 'plugins.wav')
        await aplicarPlugins(meio, proximo, plugins)
        renameSync(proximo, alvo)
      } finally {
        rmSync(temp, { recursive: true, force: true })
      }
      return alvo
    })().finally(() => processando.delete(chave))
    processando.set(chave, p)
  }
  return p
}

/** A gravacao com o nivelador, o EQ e o compressor (o ffmpeg), uma vez por receita. */
async function comFiltros(f: string, filtros: string, identidadeDaFonte: string, onProgress: (m: string) => void): Promise<string> {
  const chave = hash({ v: VERSAO, f: basename(f), filtros })
  const alvo = join(dir('processado'), `${identidadeDaFonte}-${chave}.wav`)
  if (existsSync(alvo)) return alvo
  let p = processando.get(chave)
  if (!p) {
    p = (async () => {
      onProgress('Aplicando os efeitos...')
      const parcial = `${alvo}.part.wav`
      await rodarFfmpeg(['-i', f, '-af', filtros, '-ar', String(TAXA), '-ac', '1', '-c:a', 'pcm_f32le', parcial])
      renameSync(parcial, alvo)
      return alvo
    })().finally(() => processando.delete(chave))
    processando.set(chave, p)
  }
  return p
}

/** O que se ouve de cada gravacao: com os efeitos, a processada; sem, a crua. */
async function fontesDaEscuta(
  edicao: EdicaoDeAudio,
  efeitos: boolean,
  onProgress: (m: string) => void,
): Promise<[string, string][]> {
  const saida: [string, string][] = []
  // Uma de cada vez: duas IAs ou dois Fresh Air juntos so disputariam o processador.
  for (const [id, caminho] of fontesDa(edicao)) {
    saida.push([id, efeitos ? await processado(caminho, edicao, onProgress) : await fonte(caminho, edicao, false, onProgress)])
  }
  return saida
}

/**
 * A onda de cada gravacao INTEIRA (com ou sem os efeitos), 100 picos por
 * segundo, pelo id. A tela corta pelos trechos: cortar nao pede onda nova.
 */
export async function ondaDaEdicao(
  edicao: EdicaoDeAudio,
  efeitos: boolean,
  onProgress: (m: string) => void,
): Promise<Record<string, OndaDaGravacao>> {
  const ondas: Record<string, OndaDaGravacao> = {}
  for (const [id, f] of await fontesDaEscuta(edicao, efeitos, onProgress)) {
    const ficha = `${f}.onda.json`
    if (existsSync(ficha)) {
      ondas[id] = JSON.parse(readFileSync(ficha, 'utf8')) as OndaDaGravacao
      continue
    }
    const x = await lerMonoComCache(f)
    const onda = { ...ondaDe(x), durationSec: x.length / TAXA }
    writeFileSync(ficha, JSON.stringify(onda))
    ondas[id] = onda
  }
  return ondas
}

function lufsDe(x: Float32Array): number | null {
  const medidor = new EnergiaK(TAXA, 1)
  medidor.intercalado(x)
  return medidor.resultado().integrado
}

const rendendo = new Map<string, Promise<AudioEditado>>()

/**
 * O audio da edicao para ouvir e para o "Pronto": os trechos de cada gravacao
 * emendados e, com os efeitos, normalizados JUNTOS (a correcao sai no volume do
 * resto). Mesma receita, mesmo arquivo: desfazer um corte acha o audio pronto.
 */
export async function renderizarEdicao(
  edicao: EdicaoDeAudio,
  efeitos: boolean,
  onProgress: (m: string) => void,
  /**
   * A velocidade entra so na narracao final (o "Pronto"): na tela, a agulha e os
   * cortes vivem no tempo da gravacao, e o preview acelera tocando (playbackRate).
   */
  comVelocidade = false,
): Promise<AudioEditado> {
  const escutas = await fontesDaEscuta(edicao, efeitos, onProgress)
  const normalizar = efeitos && edicao.cadeia.normalizar.ligado ? edicao.cadeia.normalizar.alvoLufs : null
  const fator = comVelocidade && efeitos ? fatorDaVelocidade(edicao.cadeia) : 1
  const chave = hash({
    v: VERSAO,
    f: escutas.map(([id, f]) => [id, basename(f)]),
    // So o que muda o som: a faixa e o id nao entram (trocar de faixa no mesmo lugar acha o mesmo arquivo).
    m: 'faixas',
    t: edicao.trechos.map((x) => [x.de, x.ate, x.ganhoDb, fonteDo(x), x.em, x.efeito ?? null]),
    n: normalizar,
    // `atempo`: o arquivo acelerado pelo R3 (1.99) nao volta do cache.
    ...(fator !== 1 ? { vel: fator, metodo: 'atempo' } : {}),
  })
  const dono = identidade(edicao.bruto)
  const arquivo = join(dir('render'), `${dono}-${chave}.wav`)
  const ficha = join(dir('render'), `${dono}-${chave}.json`)
  if (existsSync(arquivo) && existsSync(ficha)) {
    const fi = JSON.parse(readFileSync(ficha, 'utf8')) as { durationSec: number; lufs: number | null }
    return { ...fi, arquivo, url: publish(arquivo) }
  }
  let p = rendendo.get(chave)
  if (!p) {
    p = (async () => {
      const usadas = new Set(edicao.trechos.map(fonteDo))
      const lidas: Record<string, Float32Array> = {}
      for (const [id, f] of escutas) if (usadas.has(id)) lidas[id] = await lerMonoComCache(f)
      // Os trechos com efeito (bip, voz fina...): o som deles ja com o efeito.
      const comEfeito = new Map<string, Float32Array>()
      for (const t of edicao.trechos) {
        const fonteLida = lidas[fonteDo(t)]
        if (!t.efeito || !fonteLida) continue
        const arquivo = escutas.find(([id]) => id === fonteDo(t))?.[1] ?? ''
        comEfeito.set(t.id, await efeitoNoPedaco(pedacoDe(fonteLida, t.de, t.ate), t.efeito, `${arquivo}|${t.de}|${t.ate}|${t.efeito}`))
      }
      let x = montarMix(lidas, edicao.trechos, comEfeito)
      /*
       * A VELOCIDADE, sem mudar o tom: o atempo do ffmpeg -- o mesmo jeito do
       * preview (o navegador acelera emendando pedacos da propria onda, sem
       * refazer o timbre). Antes de normalizar e do teto, que medem e seguram o
       * audio ja acelerado.
       *
       * Na 1.99 era o Rubber Band R3 (pelo vst-host), e no Pronto a voz saiu
       * "robotizada, sintetica": ele refaz a onda pelo espectro e espalha os
       * pulsos da voz. Medido na narracao dele a 115% (crista nos quadros com
       * voz; 100% = 2,74): R3 2,57, atempo 2,81. O modulo do Levi ja tinha
       * ouvido o mesmo (o rubberband robotico; o atempo, o som do App Resumo).
       */
      if (fator !== 1) {
        onProgress(`Acelerando para ${Math.round(fator * 100)}% sem mudar o tom...`)
        const lento = `${arquivo}.lento.wav`
        gravarWavFloat(lento, x)
        try {
          x = await lerMono(lento, `atempo=${fator}`)
        } finally {
          rmSync(lento, { force: true })
        }
      }
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
 * Os silencios de cada gravacao, em segundos DELA, com o id. Lidos do audio
 * limpo quando a IA esta ligada: sem o ruido de fundo, a pausa e funda e o
 * limiar acha todas.
 */
export async function silenciosDaGravacao(
  edicao: EdicaoDeAudio,
  opcoes: OpcoesDosSilencios,
  onProgress: (m: string) => void,
): Promise<{ de: number; ate: number; fonte: string }[]> {
  const todos: { de: number; ate: number; fonte: string }[] = []
  for (const [id, caminho] of fontesDa(edicao)) {
    const x = await lerMonoComCache(await fonte(caminho, edicao, true, onProgress))
    const passo = Math.round(TAXA * 0.01)
    const db: number[] = []
    for (let i = 0; i + passo <= x.length; i += passo) {
      let soma = 0
      for (let k = i; k < i + passo; k++) soma += x[k]! * x[k]!
      db.push(10 * Math.log10(soma / passo + 1e-12))
    }
    for (const s of silenciosDoSinal(db, 0.01, opcoes)) todos.push({ ...s, fonte: id })
  }
  return todos
}

/**
 * O "Pronto": a narracao final AO LADO da gravacao, "<nome> (editado).wav".
 * Ele acha o arquivo onde guarda os audios e pode usar fora do Dangai. Um
 * arquivo com esse nome que nao seja o desta edicao nunca e sobrescrito.
 */
export async function concluirEdicao(edicao: EdicaoDeAudio, onProgress: (m: string) => void): Promise<string> {
  const pronto = await renderizarEdicao(edicao, true, onProgress, true)
  const pasta = dirname(edicao.bruto)
  const nome = basename(edicao.bruto, extname(edicao.bruto))
  let saida = edicao.saida && dirname(edicao.saida) === pasta ? edicao.saida : join(pasta, `${nome} (editado).wav`)
  for (let k = 2; existsSync(saida) && saida !== edicao.saida; k++) saida = join(pasta, `${nome} (editado ${k}).wav`)
  copyFileSync(pronto.arquivo, saida)
  return saida
}

/**
 * EXPORTAR: "quero uma opcao de exportar o audio editado ali". A mesma narracao
 * do "Pronto" (cortes, efeitos, velocidade, -14 LUFS), para onde ele escolher:
 * WAV como sai, ou MP3 (320 kbps) pela extensao que ele deu. Nao mexe no projeto.
 */
export async function exportarEdicao(edicao: EdicaoDeAudio, destino: string, onProgress: (m: string) => void): Promise<string> {
  const pronto = await renderizarEdicao(edicao, true, onProgress, true)
  if (extname(destino).toLowerCase() === '.mp3') {
    onProgress('Gravando o MP3...')
    const parcial = `${destino}.part.mp3`
    await rodarFfmpeg(['-i', pronto.arquivo, '-c:a', 'libmp3lame', '-b:a', '320k', parcial])
    renameSync(parcial, destino)
  } else {
    copyFileSync(pronto.arquivo, destino)
  }
  return destino
}

/**
 * DEPOIS DO RENDER: o trabalho desta edicao sai do cache -- a gravacao em 48 kHz,
 * a limpa pela IA, a com efeitos e as emendas. Fica a narracao pronta (ao lado
 * da gravacao) e a propria gravacao. Voltar na etapa refaz o que precisar.
 * Devolve quantos bytes saíram.
 */
export function limparTrabalhoDaEdicao(edicao: EdicaoDeAudio): number {
  if (!pasta || !existsSync(pasta)) return 0
  const ids: string[] = []
  for (const caminho of [edicao.bruto, ...edicao.correcoes.map((c) => c.caminho)]) {
    try {
      ids.push(identidade(caminho))
    } catch {
      // Saiu do disco: o que era dela fica para a limpeza por idade.
    }
  }
  if (ids.length === 0) return 0
  let liberado = 0
  for (const sub of ['base', 'limpa', 'processado', 'render']) {
    const d = join(pasta, sub)
    if (!existsSync(d)) continue
    for (const nome of readdirSync(d)) {
      if (!ids.some((id) => nome.startsWith(id))) continue
      try {
        const p = join(d, nome)
        const tamanho = statSync(p).size
        rmSync(p, { force: true })
        liberado += tamanho
      } catch {
        // Em uso (a etapa tocando): fica para a proxima.
      }
    }
  }
  // O que estava lido na memoria era desses arquivos.
  lidas.clear()
  return liberado
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
