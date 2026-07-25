import type {
  AnalysisResult,
  AudioAnalysis,
  ImageAsset,
  RenderProgress,
  RenderProps,
} from './contract'

/**
 * Valores de runtime que o preload precisa, sem dependencias.
 *
 * Isto vive separado de contract.ts de proposito: contract.ts importa zod, e
 * qualquer valor importado dele arrasta zod para dentro do bundle. O preload
 * roda antes de cada pagina carregar, entao ele fica pequeno.
 */

/**
 * Todo handler de IPC devolve isto. Erro nunca vira excecao atravessando a
 * ponte: vira um valor com mensagem pronta para a interface. A copy do erro
 * explica o que aconteceu e como resolver -- nunca pede desculpa.
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Canais de IPC, centralizados para nao existir string solta nos dois lados. */
export const IPC = {
  analyzeAudio: 'audio:analyze',
  importImages: 'images:import',
  pickFiles: 'dialog:pick-files',
  startRender: 'render:start',
  cancelRender: 'render:cancel',
  revealFile: 'shell:reveal',
  analyze: 'plan:analyze',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  /** main -> renderer, evento de progresso */
  renderProgress: 'render:progress',
  /** main -> renderer, texto de andamento da analise */
  analyzeProgress: 'plan:progress',
} as const

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] as const
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const

export function classifyFile(fileName: string): 'audio' | 'image' | 'subtitle' | 'unknown' {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return 'audio'
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image'
  if (ext === 'srt') return 'subtitle'
  return 'unknown'
}

export interface StartRenderArgs {
  props: RenderProps
  audioPath: string
  durationInFrames: number
}

export interface AnalyzeArgs {
  audioPath: string
  subtitlePath: string | null
  images: readonly ImageAsset[]
  durationSec: number
}

/** O que a interface pode ver das configuracoes. A chave nunca volta inteira. */
export interface PublicSettings {
  whisperModel: 'base' | 'small' | 'medium'
  sfxDir: string
  hasApiKey: boolean
  apiKeyHint: string
}

export interface SettingsPatch {
  anthropicApiKey?: string
  whisperModel?: 'base' | 'small' | 'medium'
  sfxDir?: string
}

/**
 * A superficie que o preload expoe. O renderer nao conhece nada alem disto.
 * O import de contract aqui e `import type`, entao e apagado na compilacao.
 */
export interface DangaiBridge {
  /** Resolve o caminho real de um File soltado na janela (Electron >= 32). */
  pathForFile(file: File): string
  analyzeAudio(path: string): Promise<IpcResult<AudioAnalysis>>
  importImages(paths: readonly string[]): Promise<IpcResult<ImageAsset[]>>
  pickFiles(): Promise<IpcResult<string[]>>
  /** Resolve com o caminho do MP4, ou com null se o usuario cancelou. */
  startRender(args: StartRenderArgs): Promise<IpcResult<string | null>>
  cancelRender(): Promise<IpcResult<null>>
  revealFile(path: string): Promise<IpcResult<null>>
  analyze(args: AnalyzeArgs): Promise<IpcResult<AnalysisResult>>
  getSettings(): Promise<IpcResult<PublicSettings>>
  saveSettings(patch: SettingsPatch): Promise<IpcResult<PublicSettings>>
  /** Assina o progresso do render. Devolve a funcao para cancelar a assinatura. */
  onRenderProgress(listener: (progress: RenderProgress) => void): () => void
  onAnalyzeProgress(listener: (message: string) => void): () => void
}
