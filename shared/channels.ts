import type {
  AnalysisResult,
  AudioAnalysis,
  ImageAsset,
  Metadata,
  RenderProgress,
  RenderProps,
} from './contract'
import type { OpenedProject, ProjectFile } from './project-file'

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
  reframeImage: 'images:reframe',
  readScript: 'script:read',
  listSfx: 'sfx:list',
  openSfxDir: 'sfx:open',
  pickFiles: 'dialog:pick-files',
  pickMusic: 'dialog:pick-music',
  loadMusic: 'music:load',
  generateMetadata: 'metadata:generate',
  copyText: 'clipboard:write',
  startRender: 'render:start',
  cancelRender: 'render:cancel',
  revealFile: 'shell:reveal',
  analyze: 'plan:analyze',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  saveProject: 'project:save',
  openProject: 'project:open',
  autosaveProject: 'project:autosave',
  readAutosave: 'project:autosave-read',
  clearAutosave: 'project:autosave-clear',
  /** main -> renderer, evento de progresso */
  renderProgress: 'render:progress',
  /** main -> renderer, texto de andamento da analise */
  analyzeProgress: 'plan:progress',
  /** main -> renderer, andamento da atualizacao do app */
  updateStatus: 'update:status',
  installUpdate: 'update:install',
  checkUpdate: 'update:check',
  appVersion: 'app:version',
} as const

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] as const
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const

export function classifyFile(
  fileName: string,
): 'audio' | 'image' | 'subtitle' | 'script' | 'project' | 'unknown' {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return 'audio'
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image'
  if (ext === 'srt') return 'subtitle'
  if (ext === 'txt' || ext === 'md') return 'script'
  if (ext === 'dangai') return 'project'
  return 'unknown'
}

export interface StartRenderArgs {
  props: RenderProps
  audioPath: string
  durationInFrames: number
  /** Vazio quando o usuario mutou os SFX. */
  sfxCues: readonly { at: number; sound: string }[]
  /** Cama de musica, quando ha uma escolhida. */
  music: { path: string; gainDb: number } | null
}

/** Uma faixa de musica escolhida pelo usuario. */
export interface MusicPick {
  path: string
  fileName: string
  /** URL do servidor de midia local, para o preview conseguir tocar a faixa. */
  url: string
}

export interface ReframeArgs {
  id: string
  path: string
  /** 0 = esquerda/topo, 1 = direita/base. */
  focusX: number
  focusY: number
}

export interface SaveProjectArgs {
  /** null abre o dialogo de "salvar como". */
  path: string | null
  file: ProjectFile
  /** Nome sugerido no dialogo, sem extensao. */
  suggestedName: string
}

export interface AnalyzeArgs {
  audioPath: string
  subtitlePath: string | null
  images: readonly ImageAsset[]
  durationSec: number
  /** Roteiro escrito, quando o usuario forneceu. */
  script: string | null
}

/**
 * Andamento da atualizacao automatica.
 *
 * 'baixando' cobre desde "achei uma versao nova" ate o download terminar, com
 * percent indo de 0 a 1. A interface nao precisa distinguir os dois momentos.
 */
export type UpdateStatus =
  | { state: 'procurando' }
  | { state: 'atual' }
  | { state: 'baixando'; version?: string; percent: number }
  | { state: 'pronta'; version: string }
  | { state: 'erro'; message: string }

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
  /** `focus` so vem preenchido ao abrir projeto salvo, para o recorte sair certo de primeira. */
  importImages(
    paths: readonly string[],
    focus?: readonly { focusX: number; focusY: number }[],
  ): Promise<IpcResult<ImageAsset[]>>
  /** Recorta de novo com outro enquadramento. Resolve com a URL da nova versao. */
  reframeImage(args: ReframeArgs): Promise<IpcResult<string>>
  /** Le um .txt de roteiro do disco. */
  readScript(path: string): Promise<IpcResult<string>>
  /** Nomes dos arquivos de som na pasta de SFX em uso. */
  listSfx(): Promise<IpcResult<string[]>>
  /** Abre a pasta de SFX no explorador, para o usuario largar os arquivos dele. */
  openSfxDir(): Promise<IpcResult<null>>
  /** Versao instalada, para a interface mostrar. */
  appVersion(): Promise<IpcResult<string>>
  /** Fecha e instala a atualizacao ja baixada. */
  installUpdate(): Promise<IpcResult<null>>
  /** Procura atualizacao agora, a pedido do usuario. O resultado vem por onUpdateStatus. */
  checkUpdate(): Promise<IpcResult<null>>
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void
  pickFiles(): Promise<IpcResult<string[]>>
  /** Escolhe a faixa de fundo. null se o usuario fechou o dialogo. */
  pickMusic(): Promise<IpcResult<MusicPick | null>>
  /** Republica no servidor local uma faixa que veio de projeto salvo. */
  loadMusic(path: string): Promise<IpcResult<MusicPick>>
  /** Titulo, descricao e hashtags a partir do roteiro. Precisa da chave da API. */
  generateMetadata(texto: string): Promise<IpcResult<Metadata>>
  /** Copia texto para a area de transferencia pelo Electron. */
  copyText(text: string): Promise<IpcResult<null>>
  /** Resolve com o caminho do MP4, ou com null se o usuario cancelou. */
  startRender(args: StartRenderArgs): Promise<IpcResult<string | null>>
  cancelRender(): Promise<IpcResult<null>>
  revealFile(path: string): Promise<IpcResult<null>>
  analyze(args: AnalyzeArgs): Promise<IpcResult<AnalysisResult>>
  /** Grava o .dangai. Resolve com o caminho usado, ou null se cancelou o dialogo. */
  saveProject(args: SaveProjectArgs): Promise<IpcResult<string | null>>
  /** Abre um .dangai. `path` null abre o dialogo; null de volta significa cancelado. */
  openProject(path: string | null): Promise<IpcResult<OpenedProject | null>>
  /** Rede de seguranca silenciosa no userData. Guarda de qual .dangai o trabalho veio. */
  autosaveProject(file: ProjectFile, projectPath: string | null): Promise<IpcResult<null>>
  /** O que sobrou da ultima sessao, se ainda abrir. */
  readAutosave(): Promise<IpcResult<OpenedProject | null>>
  clearAutosave(): Promise<IpcResult<null>>
  getSettings(): Promise<IpcResult<PublicSettings>>
  saveSettings(patch: SettingsPatch): Promise<IpcResult<PublicSettings>>
  /** Assina o progresso do render. Devolve a funcao para cancelar a assinatura. */
  onRenderProgress(listener: (progress: RenderProgress) => void): () => void
  onAnalyzeProgress(listener: (message: string) => void): () => void
}
