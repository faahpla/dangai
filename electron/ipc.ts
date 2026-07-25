import { dialog, ipcMain } from 'electron'
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  IPC,
  type IpcResult,
} from '@shared/channels'
import type { AudioAnalysis, ImageAsset } from '@shared/contract'
import { analyzeAudio } from './services/audio'
import { importImages } from './services/assets'

/**
 * Envolve um handler para que erro nunca atravesse a ponte como excecao. O
 * renderer sempre recebe um valor, e a mensagem ja esta em portugues pronta
 * para virar toast.
 */
function handle<Args extends unknown[], T>(
  channel: string,
  fn: (...args: Args) => Promise<T>,
): void {
  ipcMain.handle(channel, async (_event, ...args: Args): Promise<IpcResult<T>> => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc:${channel}]`, err)
      return { ok: false, error: message }
    }
  })
}

export function registerIpc(): void {
  handle<[string], AudioAnalysis>(IPC.analyzeAudio, (path) => analyzeAudio(path))

  handle<[readonly string[]], ImageAsset[]>(IPC.importImages, (paths) => importImages(paths))

  handle<[], string[]>(IPC.pickFiles, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Selecionar audio e imagens',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Audio e imagens',
          extensions: [...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS, 'srt'],
        },
        { name: 'Audio', extensions: [...AUDIO_EXTENSIONS] },
        { name: 'Imagens', extensions: [...IMAGE_EXTENSIONS] },
      ],
    })
    return result.canceled ? [] : result.filePaths
  })
}
