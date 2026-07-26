import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type AnalyzeArgs,
  type DangaiBridge,
  type IpcResult,
  type PublicSettings,
  type ReframeArgs,
  type SettingsPatch,
  type StartRenderArgs,
  type UpdateStatus,
} from '@shared/channels'
import type { AnalysisResult, AudioAnalysis, ImageAsset, RenderProgress } from '@shared/contract'

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

  importImages: (paths) =>
    ipcRenderer.invoke(IPC.importImages, paths) as Promise<IpcResult<ImageAsset[]>>,

  reframeImage: (args: ReframeArgs) =>
    ipcRenderer.invoke(IPC.reframeImage, args) as Promise<IpcResult<string>>,

  readScript: (path) => ipcRenderer.invoke(IPC.readScript, path) as Promise<IpcResult<string>>,

  listSfx: () => ipcRenderer.invoke(IPC.listSfx) as Promise<IpcResult<string[]>>,

  openSfxDir: () => ipcRenderer.invoke(IPC.openSfxDir) as Promise<IpcResult<null>>,

  appVersion: () => ipcRenderer.invoke(IPC.appVersion) as Promise<IpcResult<string>>,

  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate) as Promise<IpcResult<null>>,

  onUpdateStatus: (listener) => {
    const handler = (_event: unknown, status: UpdateStatus): void => listener(status)
    ipcRenderer.on(IPC.updateStatus, handler)
    return () => {
      ipcRenderer.off(IPC.updateStatus, handler)
    }
  },

  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles) as Promise<IpcResult<string[]>>,

  startRender: (args: StartRenderArgs) =>
    ipcRenderer.invoke(IPC.startRender, args) as Promise<IpcResult<string | null>>,

  cancelRender: () => ipcRenderer.invoke(IPC.cancelRender) as Promise<IpcResult<null>>,

  revealFile: (path) => ipcRenderer.invoke(IPC.revealFile, path) as Promise<IpcResult<null>>,

  analyze: (args: AnalyzeArgs) =>
    ipcRenderer.invoke(IPC.analyze, args) as Promise<IpcResult<AnalysisResult>>,

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
