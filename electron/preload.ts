import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type AnalyzeArgs,
  type DangaiBridge,
  type IpcResult,
  type MusicPick,
  type PublicSettings,
  type DropExpansion,
  type LibraryIndex,
  type Nickname,
  type NicknameSuggestion,
  type ReframeArgs,
  type SaveProjectArgs,
  type SettingsPatch,
  type StartRenderArgs,
  type UpdateStatus,
} from '@shared/channels'
import type {
  AnalysisResult,
  AudioAnalysis,
  ImageAsset,
  Metadata,
  RenderProgress,
} from '@shared/contract'
import type { OpenedProject, ProjectFile } from '@shared/project-file'

/**
 * Unica superficie entre renderer e sistema. Tipada por DangaiBridge, entao um
 * metodo novo aqui exige a assinatura no contrato compartilhado.
 *
 * pathForFile existe porque File.path foi removido no Electron 32: webUtils e
 * a unica forma de obter o caminho real de um arquivo soltado na janela.
 */
const bridge: DangaiBridge = {
  pathForFile: (file) => webUtils.getPathForFile(file),

  analyzeAudio: (path) =>
    ipcRenderer.invoke(IPC.analyzeAudio, path) as Promise<IpcResult<AudioAnalysis>>,

  importImages: (paths, focus, sections) =>
    ipcRenderer.invoke(IPC.importImages, paths, focus, sections) as Promise<
      IpcResult<ImageAsset[]>
    >,

  reframeImage: (args: ReframeArgs) =>
    ipcRenderer.invoke(IPC.reframeImage, args) as Promise<IpcResult<string>>,

  expandDrop: (paths) =>
    ipcRenderer.invoke(IPC.expandDrop, paths) as Promise<IpcResult<DropExpansion>>,

  readScript: (path) => ipcRenderer.invoke(IPC.readScript, path) as Promise<IpcResult<string>>,

  scanLibrary: () => ipcRenderer.invoke(IPC.scanLibrary) as Promise<IpcResult<LibraryIndex>>,

  pickLibraryDir: () =>
    ipcRenderer.invoke(IPC.pickLibraryDir) as Promise<IpcResult<string | null>>,

  libraryClipUrl: (path) =>
    ipcRenderer.invoke(IPC.libraryClipUrl, path) as Promise<IpcResult<string>>,

  onLibraryProgress: (listener) => {
    const handler = (_event: unknown, mensagem: string): void => listener(mensagem)
    ipcRenderer.on(IPC.libraryProgress, handler)
    return () => {
      ipcRenderer.off(IPC.libraryProgress, handler)
    }
  },

  readNicknames: () =>
    ipcRenderer.invoke(IPC.readNicknames) as Promise<IpcResult<Record<string, Nickname[]>>>,

  saveNicknames: (series, list) =>
    ipcRenderer.invoke(IPC.saveNicknames, series, list) as Promise<
      IpcResult<Record<string, Nickname[]>>
    >,

  suggestNicknames: (series, characters) =>
    ipcRenderer.invoke(IPC.suggestNicknames, series, characters) as Promise<
      IpcResult<NicknameSuggestion[]>
    >,

  listSfx: () => ipcRenderer.invoke(IPC.listSfx) as Promise<IpcResult<string[]>>,

  openSfxDir: () => ipcRenderer.invoke(IPC.openSfxDir) as Promise<IpcResult<null>>,

  appVersion: () => ipcRenderer.invoke(IPC.appVersion) as Promise<IpcResult<string>>,

  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate) as Promise<IpcResult<null>>,

  checkUpdate: () => ipcRenderer.invoke(IPC.checkUpdate) as Promise<IpcResult<null>>,

  onUpdateStatus: (listener) => {
    const handler = (_event: unknown, status: UpdateStatus): void => listener(status)
    ipcRenderer.on(IPC.updateStatus, handler)
    return () => {
      ipcRenderer.off(IPC.updateStatus, handler)
    }
  },

  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles) as Promise<IpcResult<string[]>>,

  pickMusic: () => ipcRenderer.invoke(IPC.pickMusic) as Promise<IpcResult<MusicPick | null>>,

  loadMusic: (path) => ipcRenderer.invoke(IPC.loadMusic, path) as Promise<IpcResult<MusicPick>>,

  generateMetadata: (texto) =>
    ipcRenderer.invoke(IPC.generateMetadata, texto) as Promise<IpcResult<Metadata>>,

  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text) as Promise<IpcResult<null>>,

  startRender: (args: StartRenderArgs) =>
    ipcRenderer.invoke(IPC.startRender, args) as Promise<IpcResult<string | null>>,

  cancelRender: () => ipcRenderer.invoke(IPC.cancelRender) as Promise<IpcResult<null>>,

  revealFile: (path) => ipcRenderer.invoke(IPC.revealFile, path) as Promise<IpcResult<null>>,

  analyze: (args: AnalyzeArgs) =>
    ipcRenderer.invoke(IPC.analyze, args) as Promise<IpcResult<AnalysisResult>>,

  saveProject: (args: SaveProjectArgs) =>
    ipcRenderer.invoke(IPC.saveProject, args) as Promise<IpcResult<string | null>>,

  openProject: (path) =>
    ipcRenderer.invoke(IPC.openProject, path) as Promise<IpcResult<OpenedProject | null>>,

  autosaveProject: (file: ProjectFile, projectPath) =>
    ipcRenderer.invoke(IPC.autosaveProject, file, projectPath) as Promise<IpcResult<null>>,

  readAutosave: () =>
    ipcRenderer.invoke(IPC.readAutosave) as Promise<IpcResult<OpenedProject | null>>,

  clearAutosave: () => ipcRenderer.invoke(IPC.clearAutosave) as Promise<IpcResult<null>>,

  getSettings: () => ipcRenderer.invoke(IPC.getSettings) as Promise<IpcResult<PublicSettings>>,

  saveSettings: (patch: SettingsPatch) =>
    ipcRenderer.invoke(IPC.saveSettings, patch) as Promise<IpcResult<PublicSettings>>,

  onRenderProgress: (listener) => {
    const handler = (_event: unknown, progress: RenderProgress): void => listener(progress)
    ipcRenderer.on(IPC.renderProgress, handler)
    return () => {
      ipcRenderer.off(IPC.renderProgress, handler)
    }
  },

  onAnalyzeProgress: (listener) => {
    const handler = (_event: unknown, message: string): void => listener(message)
    ipcRenderer.on(IPC.analyzeProgress, handler)
    return () => {
      ipcRenderer.off(IPC.analyzeProgress, handler)
    }
  },
}

contextBridge.exposeInMainWorld('dangai', bridge)
