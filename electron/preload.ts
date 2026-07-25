import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type DangaiBridge, type IpcResult } from '@shared/channels'
import type { AudioAnalysis, ImageAsset } from '@shared/contract'

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
}

contextBridge.exposeInMainWorld('dangai', bridge)
