import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type DangaiBridge, type IpcResult, type StartRenderArgs } from '@shared/channels'
import type { AudioAnalysis, ImageAsset, RenderProgress } from '@shared/contract'

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

  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles) as Promise<IpcResult<string[]>>,

  startRender: (args: StartRenderArgs) =>
    ipcRenderer.invoke(IPC.startRender, args) as Promise<IpcResult<string | null>>,

  cancelRender: () => ipcRenderer.invoke(IPC.cancelRender) as Promise<IpcResult<null>>,

  revealFile: (path) => ipcRenderer.invoke(IPC.revealFile, path) as Promise<IpcResult<null>>,

  onRenderProgress: (listener) => {
    const handler = (_event: unknown, progress: RenderProgress): void => listener(progress)
    ipcRenderer.on(IPC.renderProgress, handler)
    return () => {
      ipcRenderer.off(IPC.renderProgress, handler)
    }
  },
}

contextBridge.exposeInMainWorld('dangai', bridge)
