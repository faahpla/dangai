import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  IPC,
  type AnalyzeArgs,
  type AutomountRequest,
  type AutomountResult,
  type ScriptBlocksResult,
  type IpcResult,
  type MusicPick,
  type PublicSettings,
  type DropExpansion,
  type LibraryIndex,
  type Nickname,
  type NicknameSuggestion,
  type ReframeArgs,
  type SaveProjectArgs,
  type SceneDescription,
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
import { readNicknames, saveNicknames, suggestNicknames } from './services/nicknames'
import { automount, scriptBlocks } from './services/automount'
import { readFavorites, toggleFavorite } from './services/favorites'
import { describeClips, readDescriptions } from './services/describe'
import { readTags, tagClips } from './services/tagger'
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

function broadcastLibrary(message: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.libraryProgress, message)
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
  >(IPC.importImages, (paths, focus, sections) =>
    /*
     * O andamento vai pelo mesmo canal da analise: quem esta olhando a tela ve
     * uma frase mudando, e nao dois indicadores disputando o mesmo canto.
     */
    importImages(paths, focus, sections, (feitos, total) => {
      if (total > 1) broadcastAnalyze(`Preparando cena ${feitos} de ${total}...`)
    }),
  )

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
    return semGrifo(raw.replace(/^\ufeff/, ''))
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
    return scanLibrary(libraryDir, publish, broadcastLibrary)
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

  // ----------------------------------------------------------------- apelidos

  handle<[], Record<string, Nickname[]>>(IPC.readNicknames, async () => readNicknames())

  handle<[string, readonly Nickname[]], Record<string, Nickname[]>>(
    IPC.saveNicknames,
    async (series, list) => saveNicknames(series, list),
  )

  handle<[string, readonly string[]], NicknameSuggestion[]>(
    IPC.suggestNicknames,
    (series, characters) => suggestNicknames(series, characters),
  )

  /*
   * Reusa o mesmo aviso de andamento da analise: quem esta olhando a tela ve
   * uma frase mudando, e nao dois indicadores disputando o mesmo canto.
   */
  handle<[AutomountRequest], AutomountResult>(IPC.automount, (request) =>
    automount(request, publish, broadcastAnalyze),
  )

  handle<
    [{ audioPath: string; subtitlePath: string | null; script: string | null }],
    ScriptBlocksResult
  >(IPC.scriptBlocks, (request) => scriptBlocks(request, publish, broadcastAnalyze))

  handle<[], Record<string, string[]>>(IPC.readTags, async () => readTags())

  handle<[], Record<string, string[]>>(IPC.tagLibrary, async () => {
    const { libraryDir } = getSettings()
    if (!libraryDir) {
      throw new Error('Escolha a pasta das cenas nas configuracoes antes de etiquetar.')
    }
    // A varredura e cacheada: pedir o indice de novo aqui custa quase nada e
    // garante que episodio recem-adicionado tambem seja etiquetado.
    const library = await scanLibrary(libraryDir, publish, broadcastLibrary)
    return tagClips(library.clips, broadcastLibrary)
  })

  handle<[], Record<string, SceneDescription>>(IPC.readDescriptions, async () => readDescriptions())

  handle<[string | null], Record<string, SceneDescription>>(IPC.describeLibrary, async (anime) => {
    const { libraryDir } = getSettings()
    if (!libraryDir) {
      throw new Error('Escolha a pasta das cenas nas configuracoes antes de ler as cenas.')
    }
    const library = await scanLibrary(libraryDir, publish, broadcastLibrary)
    /*
     * Um anime por vez e o uso esperado: sao ~4,7s por cena, entao o acervo
     * inteiro passa de 24 horas e um episodio sai em meia hora. null le tudo,
     * para quem quiser deixar rodando de madrugada.
     */
    const alvo = anime ? library.clips.filter((c) => c.anime === anime) : library.clips
    if (alvo.length === 0) {
      throw new Error(`Nenhuma cena encontrada${anime ? ` em "${anime}"` : ''}.`)
    }
    return describeClips(alvo, broadcastLibrary)
  })

  handle<[], string[]>(IPC.readFavorites, async () => readFavorites())
  handle<[string], string[]>(IPC.toggleFavorite, async (id) => toggleFavorite(id))

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

/**
 * Tira o GRIFO de markdown do roteiro, sem tocar no texto.
 *
 * Ele escreve o roteiro com destaque (`**todas as mortes dele.**`) para saber o
 * que enfatizar ao gravar, e a TTS nunca leu os asteriscos -- sao anotacao
 * dele, nao fala.
 *
 * Deixar passar quebrava tres coisas de uma vez, e a primeira em silencio:
 * `dele.**` nao termina em ponto, entao a frase NAO FECHAVA e emendava na
 * seguinte. No roteiro de Re:Zero dele isso virou um bloco de 10,5 segundos
 * com tres frases dentro. Alem disso a legenda sairia com `**todas` queimado
 * no video, e o alinhamento tentaria casar `**todas` com o `todas` que o
 * Whisper ouviu.
 *
 * So os marcadores que envolvem palavra -- asterisco, til e crase. O sublinhado
 * fica de fora de proposito: ele aparece em nome de arquivo e de episodio, e
 * tirar seria estragar texto de verdade para consertar um grifo que ele quase
 * nunca usa.
 */
function semGrifo(texto: string): string {
  return texto.replace(/[*~`]/g, '')
}
