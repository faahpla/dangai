import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  IPC,
  type AnalyzeArgs,
  type IpcResult,
  type PublicSettings,
  type ReframeArgs,
  type SettingsPatch,
  type StartRenderArgs,
} from '@shared/channels'
import type { AnalysisResult, AudioAnalysis, ImageAsset, RenderProgress } from '@shared/contract'
import { analyzeAudio } from './services/audio'
import { importImages, reframeImage } from './services/assets'
import { cancelRender, RenderCancelled, renderVideo } from './services/render'
import { analyze } from './services/transcribe'
import { getSettings, getSettingsForRenderer, saveSettings } from './services/settings'

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

function broadcast(progress: RenderProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.renderProgress, progress)
  }
}

function broadcastAnalyze(message: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.analyzeProgress, message)
  }
}

export function registerIpc(): void {
  handle<[string], AudioAnalysis>(IPC.analyzeAudio, (path) => analyzeAudio(path))

  handle<[readonly string[]], ImageAsset[]>(IPC.importImages, (paths) => importImages(paths))

  handle<[ReframeArgs], string>(IPC.reframeImage, ({ id, path, focusX, focusY }) =>
    reframeImage(id, path, focusX, focusY),
  )

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

  // Devolve null quando o usuario cancelou -- cancelar nao e falha, entao nao
  // vira { ok: false }. Sem isso a interface mostra erro para uma acao pedida.
  handle<[StartRenderArgs], string | null>(IPC.startRender, async (args) => {
    try {
      // A pasta de SFX e escolha das configuracoes, nao do renderer.
      return await renderVideo({ ...args, sfxDir: getSettings().sfxDir }, broadcast)
    } catch (err) {
      if (err instanceof RenderCancelled) {
        broadcast({ progress: 0, stage: 'cancelled' })
        return null
      }
      // O renderer precisa saber que o render morreu mesmo quando a chamada
      // falha, senao a timeline fica presa preenchida pela metade.
      const message = err instanceof Error ? err.message : String(err)
      broadcast({ progress: 0, stage: 'failed', message })
      throw err
    }
  })

  handle<[], null>(IPC.cancelRender, async () => {
    cancelRender()
    return null
  })

  handle<[string], null>(IPC.revealFile, async (path) => {
    shell.showItemInFolder(path)
    return null
  })

  handle<[AnalyzeArgs], AnalysisResult>(IPC.analyze, (args) => analyze(args, broadcastAnalyze))

  handle<[], PublicSettings>(IPC.getSettings, async () => getSettingsForRenderer())

  handle<[SettingsPatch], PublicSettings>(IPC.saveSettings, async (patch) => {
    saveSettings(patch)
    return getSettingsForRenderer()
  })
}
