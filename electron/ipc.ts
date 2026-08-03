import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  IPC,
  type AnalyzeArgs,
  type IpcResult,
  type MusicPick,
  type PublicSettings,
  type DropExpansion,
  type LibraryIndex,
  type ReframeArgs,
  type SaveProjectArgs,
  type SettingsPatch,
  type StartRenderArgs,
} from '@shared/channels'
import type {
  AnalysisResult,
  AudioAnalysis,
  ImageAsset,
  Metadata,
  RenderProgress,
} from '@shared/contract'
import {
  PROJECT_EXTENSION,
  type OpenedProject,
  type ProjectFile,
} from '@shared/project-file'
import { analyzeAudio } from './services/audio'
import { publish } from './services/media-server'
import {
  importImages,
  reframeImage,
  type ImportFocus,
  type ImportSection,
} from './services/assets'
import { expandDrop } from './services/folders'
import { scanLibrary } from './services/library'
import {
  clearAutosave,
  openProjectFile,
  readAutosave,
  saveProjectFile,
  writeAutosave,
} from './services/project'
import { cancelRender, RenderCancelled, renderVideo } from './services/render'
import { analyze } from './services/transcribe'
import { generateMetadata } from './services/metadata'
import { getSettings, getSettingsForRenderer, saveSettings } from './services/settings'
import { ensureSfxDir, listSfx, sfxDir } from './services/sfx'
import { checkForUpdateNow, installUpdate } from './services/updater'

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

  handle<
    [
      readonly string[],
      readonly ImportFocus[] | undefined,
      readonly (ImportSection | null)[] | undefined,
    ],
    ImageAsset[]
  >(IPC.importImages, (paths, focus, sections) => importImages(paths, focus, sections))

  handle<[ReframeArgs], string>(IPC.reframeImage, ({ id, path, focusX, focusY }) =>
    reframeImage(id, path, focusX, focusY),
  )

  handle<[readonly string[]], DropExpansion>(IPC.expandDrop, (paths) =>
    Promise.resolve(expandDrop(paths)),
  )

  /*
   * O roteiro nao passa por nenhum parser: e texto puro. Le em utf-8 e derruba
   * o BOM, que o Bloco de Notas grava e viraria um caractere invisivel na
   * primeira palavra -- justo a que o alinhamento usa como ancora inicial.
   */
  handle<[string], string>(IPC.readScript, async (path) => {
    const raw = await readFile(path, 'utf8')
    return raw.replace(/^\ufeff/, '')
  })

  // ---------------------------------------------------------------- biblioteca

  /*
   * A biblioteca do AnCut e so leitura, e a varredura e sincrona de proposito:
   * sao 27 arquivos de texto, 300ms no pior caso e 100ms com cache. Jogar isso
   * num worker custaria mais em complexidade do que economiza em tempo.
   */
  handle<[], LibraryIndex>(IPC.scanLibrary, async () => {
    const { libraryDir } = getSettings()
    if (!libraryDir) {
      throw new Error(
        'Nenhuma biblioteca escolhida. Abra as configuracoes (Ctrl+,) e aponte a pasta onde o AnCut grava as cenas.',
      )
    }
    return scanLibrary(libraryDir, publish)
  })

  handle<[], string | null>(IPC.pickLibraryDir, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Escolher a pasta da biblioteca de cenas',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const escolhida = result.filePaths[0]!
    saveSettings({ libraryDir: escolhida })
    return escolhida
  })

  // So o clipe que vai realmente tocar entra no servidor. Publicar os 9 mil de
  // uma vez encheria o mapa de ids para 99% de coisa que ninguem vai abrir.
  handle<[string], string>(IPC.libraryClipUrl, async (path) => {
    if (!existsSync(path)) {
      throw new Error(`Essa cena nao esta mais no disco: ${basename(path)}`)
    }
    return publish(path)
  })

  handle<[], string[]>(IPC.listSfx, async () => listSfx())

  handle<[], null>(IPC.openSfxDir, async () => {
    ensureSfxDir()
    await shell.openPath(sfxDir())
    return null
  })

  handle<[], string>(IPC.appVersion, async () => app.getVersion())

  handle<[], null>(IPC.installUpdate, async () => {
    await installUpdate()
    return null
  })

  handle<[], null>(IPC.checkUpdate, async () => {
    await checkForUpdateNow()
    return null
  })

  handle<[], string[]>(IPC.pickFiles, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Selecionar audio, imagens e roteiro',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Tudo que o Dangai abre',
          extensions: [
            ...AUDIO_EXTENSIONS,
            ...IMAGE_EXTENSIONS,
            'srt',
            'txt',
            'md',
            PROJECT_EXTENSION,
          ],
        },
        // Varios projetos de uma vez entram na fila de render.
        { name: 'Projetos do Dangai', extensions: [PROJECT_EXTENSION] },
        { name: 'Roteiro', extensions: ['txt', 'md'] },
        { name: 'Audio', extensions: [...AUDIO_EXTENSIONS] },
        { name: 'Imagens', extensions: [...IMAGE_EXTENSIONS] },
      ],
    })
    return result.canceled ? [] : result.filePaths
  })

  handle<[], MusicPick | null>(IPC.pickMusic, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Escolher a musica de fundo',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: [...AUDIO_EXTENSIONS] }],
    })
    const picked = result.canceled ? undefined : result.filePaths[0]
    return picked ? { path: picked, fileName: basename(picked), url: publish(picked) } : null
  })

  // Republica uma faixa vinda de projeto salvo: o .dangai guarda o caminho, mas
  // a URL do servidor local morre junto com a sessao que a criou.
  handle<[string], MusicPick>(IPC.loadMusic, async (path) => {
    if (!existsSync(path)) {
      throw new Error(`A musica "${basename(path)}" nao esta mais nesse lugar.`)
    }
    return { path, fileName: basename(path), url: publish(path) }
  })

  // Devolve null quando o usuario cancelou -- cancelar nao e falha, entao nao
  // vira { ok: false }. Sem isso a interface mostra erro para uma acao pedida.
  handle<[StartRenderArgs], string | null>(IPC.startRender, async (args) => {
    try {
      // A pasta de SFX e escolha das configuracoes, nao do renderer.
      return await renderVideo({ ...args, sfxDir: sfxDir() }, broadcast)
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

  // ------------------------------------------------------------------ projeto

  // null de volta = o usuario fechou o dialogo. Cancelar nao e falha, entao nao
  // vira { ok: false } nem mensagem vermelha na barra.
  handle<[SaveProjectArgs], string | null>(
    IPC.saveProject,
    async ({ path, file, suggestedName }) => {
      let alvo = path

      if (!alvo) {
        const result = await dialog.showSaveDialog({
          title: 'Salvar projeto',
          defaultPath: `${suggestedName}.${PROJECT_EXTENSION}`,
          filters: [{ name: 'Projeto do Dangai', extensions: [PROJECT_EXTENSION] }],
        })
        if (result.canceled || !result.filePath) return null
        alvo = result.filePath
      }

      saveProjectFile(alvo, file)
      // O projeto salvo passa a ser a verdade; o autosave existia so para cobrir
      // o intervalo ate aqui.
      clearAutosave()
      return alvo
    },
  )

  handle<[string | null], OpenedProject | null>(IPC.openProject, async (path) => {
    let alvo = path

    if (!alvo) {
      const result = await dialog.showOpenDialog({
        title: 'Abrir projeto',
        properties: ['openFile'],
        filters: [{ name: 'Projeto do Dangai', extensions: [PROJECT_EXTENSION] }],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      alvo = result.filePaths[0]!
    }

    return openProjectFile(alvo)
  })

  handle<[ProjectFile, string | null], null>(
    IPC.autosaveProject,
    async (file, projectPath) => {
      writeAutosave(file, projectPath)
      return null
    },
  )

  handle<[], OpenedProject | null>(IPC.readAutosave, async () => readAutosave())

  handle<[], null>(IPC.clearAutosave, async () => {
    clearAutosave()
    return null
  })

  handle<[string], Metadata>(IPC.generateMetadata, async (texto) => {
    const { anthropicApiKey } = getSettings()
    if (!anthropicApiKey) {
      throw new Error(
        'Sem chave da Anthropic. Abra as configuracoes (Ctrl+,) e cole a sua para gerar os textos.',
      )
    }
    return generateMetadata({ apiKey: anthropicApiKey, texto })
  })

  handle<[string], null>(IPC.copyText, async (text) => {
    clipboard.writeText(text)
    return null
  })

  handle<[], PublicSettings>(IPC.getSettings, async () => getSettingsForRenderer())

  handle<[SettingsPatch], PublicSettings>(IPC.saveSettings, async (patch) => {
    saveSettings(patch)
    return getSettingsForRenderer()
  })
}
