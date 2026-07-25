import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { bundle } from '@remotion/bundler'
import { ensureBrowser, makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer'
import type { RenderProgress, RenderProps } from '@shared/contract'
import { VIDEO_FPS } from '@shared/contract'
import { makeWebpackOverride } from '../../remotion.webpack'
import { ffmpegPath } from './ffmpeg-path'

const COMPOSITION_ID = 'dangai'

/**
 * Onde encontrar o bundle da composicao e a origem do projeto. Injetado pelo
 * main na inicializacao em vez de lido de `app` aqui dentro: mantem este
 * servico livre do Electron, o que o torna testavel sem abrir janela.
 */
export interface RenderPaths {
  /** Raiz do projeto (dev) ou do app empacotado. */
  appPath: string
  /** Pasta do bundle pre-gerado, se existir. */
  prebuiltBundle: string
}

let paths: RenderPaths | null = null

export function configureRender(next: RenderPaths): void {
  paths = next
}

function requirePaths(): RenderPaths {
  if (!paths) throw new Error('Render nao configurado')
  return paths
}

export interface RenderRequest {
  props: RenderProps
  audioPath: string
  durationInFrames: number
}

type ProgressSink = (progress: RenderProgress) => void

/**
 * Cancelamento nao e erro: foi o usuario que pediu. Um tipo proprio deixa o
 * handler de IPC distinguir isso de uma falha real, em vez de procurar a
 * palavra "cancel" na mensagem interna do Remotion.
 */
export class RenderCancelled extends Error {
  constructor() {
    super('Render cancelado')
    this.name = 'RenderCancelled'
  }
}

let activeCancel: (() => void) | null = null
let cancelRequested = false

export function cancelRender(): void {
  cancelRequested = true
  activeCancel?.()
}

/**
 * Render em duas etapas:
 *  1. Remotion desenha o video puro (sem faixa de audio);
 *  2. FFmpeg normaliza a narracao em -14 LUFS e faz o mux, copiando o video
 *     sem reencodar.
 *
 * Separar assim evita decodificar audio dentro do Chrome (lento) e coloca o
 * loudnorm de duas passadas onde ele precisa estar de qualquer jeito.
 */
export async function renderVideo(
  request: RenderRequest,
  onProgress: ProgressSink,
): Promise<string> {
  const workDir = mkdtempSync(join(tmpdir(), 'dangai-'))
  const silentVideo = join(workDir, 'video.mp4')
  const outputPath = uniqueOutputPath(request.audioPath)

  const { cancelSignal, cancel } = makeCancelSignal()
  activeCancel = cancel
  cancelRequested = false

  try {
    onProgress({ progress: 0, stage: 'bundling', message: 'Preparando a composicao...' })
    const browserExecutable = await resolveBrowser(onProgress)
    const serveUrl = await getServeUrl()

    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps: request.props,
      browserExecutable,
    })

    onProgress({ progress: 0, stage: 'rendering', message: 'Renderizando...' })

    await renderMedia({
      composition: {
        ...composition,
        durationInFrames: request.durationInFrames,
        fps: VIDEO_FPS,
      },
      serveUrl,
      codec: 'h264',
      outputLocation: silentVideo,
      inputProps: request.props,
      browserExecutable,
      // JPEG em vez de PNG: para imagem fotografica a diferenca visual e nula e
      // a serializacao de cada frame fica bem mais rapida.
      imageFormat: 'jpeg',
      jpegQuality: 90,
      crf: 18,
      // Sem isto o H.264 sai em yuvj420p (full range, formato legado herdado
      // dos frames JPEG), que alguns decodificadores mostram com cor lavada.
      pixelFormat: 'yuv420p',
      colorSpace: 'bt709',
      cancelSignal,
      onProgress: ({ progress }) => {
        // O render e ~90% do tempo; o mux fecha os 10% restantes.
        onProgress({ progress: progress * 0.9, stage: 'rendering' })
      },
    })

    onProgress({ progress: 0.9, stage: 'muxing', message: 'Ajustando o audio...' })
    await muxWithNormalizedAudio(silentVideo, request.audioPath, outputPath)

    onProgress({ progress: 1, stage: 'done', outputPath })
    return outputPath
  } catch (err) {
    // O Remotion aborta com a propria mensagem em ingles; traduzir para o tipo
    // do dominio aqui evita que ela chegue na interface.
    if (cancelRequested) throw new RenderCancelled()
    throw err
  } finally {
    activeCancel = null
    rmSync(workDir, { recursive: true, force: true })
  }
}

// ------------------------------------------------------------------- bundle

let cachedServeUrl: string | null = null

/**
 * Prefere o bundle gerado no build (`npm run remotion:bundle`). Se nao existir
 * -- caso tipico em dev logo depois de um clone -- monta na hora e guarda em
 * cache para os proximos renders da sessao.
 */
async function getServeUrl(): Promise<string> {
  if (cachedServeUrl) return cachedServeUrl

  const { appPath, prebuiltBundle } = requirePaths()

  if (existsSync(join(prebuiltBundle, 'index.html'))) {
    cachedServeUrl = prebuiltBundle
    return prebuiltBundle
  }

  cachedServeUrl = await bundle({
    entryPoint: join(appPath, 'src', 'remotion', 'index.ts'),
    webpackOverride: makeWebpackOverride(join(appPath, 'shared')),
    onProgress: () => undefined,
  })
  return cachedServeUrl
}

/**
 * Resolve qual navegador o render usa.
 *
 * Prefere o Chrome Headless Shell do Remotion, baixado uma vez (~113MB). Medido
 * nesta maquina, 60s de video / 1800 frames:
 *
 *   Headless Shell .... 51 fps ... 35s
 *   Edge instalado .... 18 fps ... 101s
 *
 * Quase 3x. O navegador completo carrega custo por aba que o headless shell nao
 * tem, entao trocar o download unico por navegador instalado sairia caro em
 * TODO render. O Edge/Chrome local fica como plano B para quando o download nao
 * pode acontecer -- sem internet o app continua produzindo video, so mais devagar.
 *
 * Devolver null significa "usa o teu proprio", que e o que queremos.
 */
async function resolveBrowser(onProgress: ProgressSink): Promise<string | null> {
  try {
    await ensureBrowser({
      onBrowserDownload: () => ({
        version: null,
        onProgress: ({ percent, alreadyAvailable }) => {
          if (alreadyAvailable) return
          onProgress({
            progress: 0,
            stage: 'bundling',
            message: `Baixando o navegador de render... ${Math.round(percent * 100)}%`,
          })
        },
      }),
    })
    return null
  } catch {
    const installed = findInstalledBrowser()
    if (!installed) {
      throw new Error(
        'Nenhum navegador disponivel para o render. Conecte a internet uma vez para o Dangai baixar o navegador, ou instale o Google Chrome.',
      )
    }
    return installed
  }
}

function findInstalledBrowser(): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']

  return candidates.find((path) => existsSync(path)) ?? null
}

// ---------------------------------------------------------------------- mux

/**
 * Mede o loudness da narracao e depois normaliza em -14 LUFS enquanto faz o
 * mux. Duas passadas porque a passada unica do loudnorm e um ajuste dinamico
 * que bombeia o volume; com as medidas em maos o ajuste vira linear.
 *
 * O video e copiado sem reencodar -- o Remotion ja entregou H.264.
 */
async function muxWithNormalizedAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
): Promise<void> {
  const measured = await measureLoudness(audioPath)

  const loudnormFilter = measured
    ? `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=summary`
    : 'loudnorm=I=-14:TP=-1.5:LRA=11'

  await runFfmpeg([
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-af', loudnormFilter,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    // Estereo na entrega: narracao de TTS costuma vir mono, e alguns
    // encoders de plataforma tratam mono de forma inconsistente.
    '-ac', '2',
    '-movflags', '+faststart',
    // O video tem exatamente a duracao do audio; -shortest apara qualquer
    // sobra de arredondamento de frame.
    '-shortest',
    outputPath,
  ])
}

interface LoudnessMeasurement {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

async function measureLoudness(audioPath: string): Promise<LoudnessMeasurement | null> {
  try {
    const stderr = await runFfmpeg([
      '-hide_banner',
      '-i', audioPath,
      '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
      '-f', 'null',
      '-',
    ])

    // O loudnorm imprime o JSON no fim do stderr.
    const start = stderr.lastIndexOf('{')
    const end = stderr.lastIndexOf('}')
    if (start === -1 || end === -1) return null

    const parsed: unknown = JSON.parse(stderr.slice(start, end + 1))
    if (typeof parsed !== 'object' || parsed === null) return null

    const m = parsed as Record<string, unknown>
    const fields = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'] as const
    if (!fields.every((f) => typeof m[f] === 'string')) return null

    return {
      input_i: m['input_i'] as string,
      input_tp: m['input_tp'] as string,
      input_lra: m['input_lra'] as string,
      input_thresh: m['input_thresh'] as string,
      target_offset: m['target_offset'] as string,
    }
  } catch {
    // Sem medicao o loudnorm ainda funciona numa passada so. Perde precisao,
    // nao trava o render.
    return null
  }
}

function runFfmpeg(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [...args], { windowsHide: true })
    let stderr = ''

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => reject(new Error(`FFmpeg nao pode ser executado: ${err.message}`)))

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stderr)
        return
      }
      const detail = stderr.trim().split('\n').slice(-3).join(' ')
      reject(new Error(`FFmpeg falhou: ${detail}`))
    })
  })
}

// -------------------------------------------------------------------- saida

/**
 * Salva ao lado da narracao com nome previsivel. Nunca sobrescreve: se ja
 * existir, numera. Sem dialogo de "salvar como" -- e um clique a menos e o
 * usuario sempre sabe onde o arquivo caiu.
 */
function uniqueOutputPath(audioPath: string): string {
  const folder = dirname(audioPath)
  const stem = basename(audioPath, extname(audioPath))

  let candidate = join(folder, `${stem}-short.mp4`)
  let counter = 2
  while (existsSync(candidate)) {
    candidate = join(folder, `${stem}-short-${counter}.mp4`)
    counter++
  }
  return candidate
}
