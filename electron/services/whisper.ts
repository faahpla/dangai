import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Segment, Transcript, Word } from '@shared/contract'
import { cutCandidatesFrom } from '@shared/plan'
import { ffmpegPath } from './ffmpeg-path'
import type { Settings } from './settings'

/**
 * Transcricao local com whisper.cpp.
 *
 * Usa o binario pre-compilado oficial em vez do nodejs-whisper: aquele compila
 * o whisper.cpp na instalacao, o que no Windows exige o Visual Studio Build
 * Tools e falha na cara do usuario. Aqui e um .exe baixado uma vez.
 *
 * Nada sai da maquina nesta etapa -- o audio nunca vai para lugar nenhum.
 */

const WHISPER_VERSION = 'v1.9.1'
const BINARY_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`

const MODEL_URLS: Readonly<Record<Settings['whisperModel'], string>> = {
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
  medium: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
}

/** Tamanho aproximado, so para a mensagem de progresso fazer sentido. */
const MODEL_SIZE_MB: Readonly<Record<Settings['whisperModel'], number>> = {
  base: 142,
  small: 466,
  medium: 1500,
}

export type WhisperProgress = (message: string) => void

let baseDir: string | null = null

export function configureWhisper(dir: string): void {
  baseDir = dir
}

function requireBaseDir(): string {
  if (!baseDir) throw new Error('Whisper nao configurado')
  return baseDir
}

export function binaryPath(): string {
  return join(requireBaseDir(), 'Release', 'whisper-cli.exe')
}

export function modelPath(model: Settings['whisperModel']): string {
  return join(requireBaseDir(), `ggml-${model}.bin`)
}

export function isWhisperReady(model: Settings['whisperModel']): boolean {
  return existsSync(binaryPath()) && existsSync(modelPath(model))
}

/**
 * Transcreve com timestamps por palavra.
 *
 * Devolve null em vez de lancar quando o Whisper simplesmente nao esta
 * disponivel -- e o chamador cai no fallback de silencio. Erro de verdade
 * (audio corrompido, binario quebrado) continua lancando.
 */
export async function transcribe(
  audioPath: string,
  model: Settings['whisperModel'],
  onProgress: WhisperProgress,
  vocabulary: readonly string[] = [],
): Promise<Transcript | null> {
  if (!isWhisperReady(model)) {
    const installed = await tryInstall(model, onProgress)
    if (!installed) return null
  }

  // O whisper.cpp so aceita WAV PCM 16kHz mono.
  const wav = join(tmpdir(), `dangai-whisper-${Date.now()}.wav`)
  try {
    onProgress('Preparando o audio...')
    await toWav16k(audioPath, wav)

    onProgress(`Transcrevendo com Whisper (${model})...`)
    const jsonPath = `${wav}.json`
    await runWhisper(wav, model, onProgress, buildVocabularyPrompt(vocabulary))

    if (!existsSync(jsonPath)) {
      throw new Error('O Whisper terminou sem gerar a transcricao.')
    }

    return parseWhisperJson(readFileSync(jsonPath, 'utf8'))
  } finally {
    rmSync(wav, { force: true })
    rmSync(`${wav}.json`, { force: true })
  }
}

function toWav16k(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', input,
       '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output],
      { windowsHide: true },
    )
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Conversao para WAV falhou: ${stderr.trim()}`)),
    )
  })
}

/**
 * Enviesa o Whisper com os nomes proprios que o video provavelmente cita.
 *
 * Nome de personagem de anime e justamente o que o modelo mais erra em
 * portugues -- "Cell" sai como "céu", "Zoro" como "zorro". E sao exatamente as
 * palavras que a IA usa para casar imagem com trecho da narracao, entao errar
 * ali degrada a distribuicao das cenas.
 *
 * O vocabulario sai dos nomes dos arquivos de imagem, que o usuario ja
 * escolheu: "gohan-ssj2.png" vira a dica "gohan". Nao custa nada e nao pede
 * nada a mais dele.
 */
export function buildVocabularyPrompt(fileNames: readonly string[]): string {
  const words = new Set<string>()

  for (const name of fileNames) {
    const stem = name.replace(/\.[^.]+$/, '')
    for (const token of stem.split(/[^\p{L}]+/u)) {
      // Descarta o generico ("cena", "print") e fragmento curto demais.
      if (token.length < 3) continue
      if (/^(cena|scene|print|img|image|foto|shot|frame|screenshot)$/i.test(token)) continue
      words.add(token.toLowerCase())
    }
  }

  if (words.size === 0) return ''
  // O prompt inicial do whisper.cpp e tratado como texto anterior; uma frase
  // com os nomes funciona melhor que uma lista solta.
  return `Recap de anime. Nomes citados: ${[...words].join(', ')}.`
}

function runWhisper(
  wavPath: string,
  model: Settings['whisperModel'],
  onProgress: WhisperProgress,
  vocabularyPrompt: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      binaryPath(),
      [
        '-m', modelPath(model),
        '-f', wavPath,
        '-l', 'pt',
        // Timestamps por palavra: e o que permite garantir que nenhum corte
        // cai no meio de uma palavra.
        '--output-json-full',
        '--output-file', wavPath,
        '--print-progress',
        '--no-prints',
        ...(vocabularyPrompt ? ['--prompt', vocabularyPrompt] : []),
      ],
      { windowsHide: true, cwd: requireBaseDir() },
    )

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      const match = /progress\s*=\s*(\d+)%/.exec(text)
      if (match) onProgress(`Transcrevendo com Whisper... ${match[1]}%`)
    })

    child.on('error', (err) =>
      reject(new Error(`Nao foi possivel executar o Whisper: ${err.message}`)),
    )
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Whisper falhou: ${stderr.trim().split('\n').slice(-2).join(' ')}`))
    })
  })
}

interface WhisperJsonToken {
  text?: string
  offsets?: { from?: number; to?: number }
}
interface WhisperJsonSegment {
  text?: string
  offsets?: { from?: number; to?: number }
  tokens?: WhisperJsonToken[]
}

/**
 * Junta os tokens do Whisper em palavras.
 *
 * O modelo trabalha com BPE, nao com palavras: "Bem-vindos" sai como
 * " Bem", "-", "v", "ind", "os". Tratar token como palavra quebra tudo que
 * depende de palavra -- a legenda fica em pedacos e o alinhamento dos cortes
 * passa a mirar fronteiras que nao existem na fala.
 *
 * O sinal de inicio de palavra e o espaco a esquerda do token, entao NAO da
 * para dar trim antes de decidir. A palavra comeca no primeiro token e termina
 * no ultimo.
 */
function mergeTokensIntoWords(tokens: readonly WhisperJsonToken[]): Word[] {
  const words: Word[] = []
  let buffer = ''
  let start = 0
  let end = 0

  const flush = (): void => {
    const text = buffer.trim()
    if (text.length > 0) words.push({ text, start, end })
    buffer = ''
  }

  for (const token of tokens) {
    const raw = token.text ?? ''
    const from = token.offsets?.from
    const to = token.offsets?.to

    // Tokens especiais do modelo vem entre colchetes; nao sao fala.
    if (raw.trim().length === 0 || raw.trimStart().startsWith('[')) continue
    if (typeof from !== 'number' || typeof to !== 'number') continue

    if (raw.startsWith(' ') || buffer.length === 0) {
      flush()
      start = from / 1000
    }
    buffer += raw
    end = to / 1000
  }
  flush()

  return words
}

export function parseWhisperJson(raw: string): Transcript {
  const parsed: unknown = JSON.parse(raw)
  const root = parsed as { transcription?: WhisperJsonSegment[] }
  const rows = Array.isArray(root.transcription) ? root.transcription : []

  const segments: Segment[] = []
  const words: Word[] = []

  for (const row of rows) {
    const from = row.offsets?.from
    const to = row.offsets?.to
    const text = row.text?.trim() ?? ''
    if (typeof from !== 'number' || typeof to !== 'number' || text.length === 0) continue

    segments.push({ start: from / 1000, end: to / 1000, text })
    words.push(...mergeTokensIntoWords(row.tokens ?? []))
  }

  if (segments.length === 0) {
    throw new Error('O Whisper nao encontrou fala no audio.')
  }

  return {
    source: 'whisper',
    words,
    segments,
    text: segments.map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim(),
    cutCandidates: cutCandidatesFrom(words, segments),
  }
}

// ------------------------------------------------------------------ instalacao

/**
 * Baixa binario e modelo na primeira vez. Sem internet devolve false e o app
 * segue pelo fallback de silencio -- transcrever e um ganho, nao um requisito.
 */
async function tryInstall(
  model: Settings['whisperModel'],
  onProgress: WhisperProgress,
): Promise<boolean> {
  try {
    const dir = requireBaseDir()
    mkdirSync(dir, { recursive: true })

    if (!existsSync(binaryPath())) {
      onProgress('Baixando o Whisper...')
      const zip = join(dir, 'whisper-bin.zip')
      await download(BINARY_URL, zip, () => onProgress('Baixando o Whisper...'))
      await unzip(zip, dir)
      rmSync(zip, { force: true })
    }

    if (!existsSync(modelPath(model))) {
      const totalMb = MODEL_SIZE_MB[model]
      await download(MODEL_URLS[model], modelPath(model), (mb) =>
        onProgress(`Baixando o modelo ${model}... ${mb}/${totalMb} MB`),
      )
    }

    return isWhisperReady(model)
  } catch {
    return false
  }
}

async function download(
  url: string,
  target: string,
  onBytes: (megabytes: number) => void,
): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`download falhou: ${response.status}`)
  }

  // Baixa para .part e renomeia no fim: um download interrompido nunca deixa
  // um arquivo pela metade que pareca valido na proxima abertura.
  const partial = `${target}.part`
  let downloaded = 0
  let lastReport = 0

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  source.on('data', (chunk: Buffer) => {
    downloaded += chunk.length
    const mb = Math.floor(downloaded / 1_000_000)
    if (mb > lastReport) {
      lastReport = mb
      onBytes(mb)
    }
  })

  await pipeline(source, createWriteStream(partial))
  renameSync(partial, target)
}

/** Expande o zip com o utilitario do proprio Windows -- sem dependencia nova. */
function unzip(zipPath: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
       `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${target}' -Force`],
      { windowsHide: true },
    )
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Expand-Archive falhou: ${stderr.trim()}`)),
    )
  })
}

/** Tamanho em disco do que ja foi baixado, para a tela de settings. */
export function installedSize(model: Settings['whisperModel']): number {
  let total = 0
  for (const path of [binaryPath(), modelPath(model)]) {
    try {
      total += statSync(path).size
    } catch {
      /* nao baixado ainda */
    }
  }
  return total
}
