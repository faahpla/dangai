import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import { registerIpc } from './ipc'
import { startMediaServer } from './services/media-server'
import { configureProjects } from './services/project'
import { configureRender } from './services/render'
import { configureSettings } from './services/settings'
import { configureLibrary } from './services/library'
import { configureNicknames } from './services/nicknames'
import { configureFavorites } from './services/favorites'
import { configureDescribe } from './services/describe'
import { configureTagger } from './services/tagger'
import { configureSfx, ensureSfxDir } from './services/sfx'
import { configureFontes, ensureFontesDir } from './services/fontes'
import { configureUpscale, configureUpscaleCache } from './services/upscale'
import { startUpdater } from './services/updater'
import { configureWhisper, encerrarWhisper } from './services/whisper'
import { configureFaces } from './services/faces'

/*
 * ABRE E SAI. So serve para provar que este binario consegue rodar.
 *
 * Quem chama e o updater, na versao NOVA, antes de deixar ela tomar o lugar
 * da que funciona. Parece bobo e nao e: em 23/09/2026 o Smart App Control
 * passou a recusar o Dangai.exe recem-compilado nesta maquina -- a 1.32.0 e a
 * 1.33.0 publicadas nao abrem, enquanto a 1.31.0 instalada abre. Sem esta
 * prova, a troca de pastas instalaria um app que o Windows nao executa, e o
 * usuario ficaria sem app nenhum: pior do que nao ter atualizado.
 *
 * Fica na PRIMEIRA linha executavel do main. Se o binario estiver barrado,
 * nem isto roda -- e e justamente o `spawn` falhando que responde a pergunta.
 */
if (process.argv.includes('--dangai-abre')) app.exit(0)

const isDev = !app.isPackaged

function createWindow(): void {
  const window = new BrowserWindow({
    // useContentSize: as medidas abaixo valem para a area de conteudo, nao para
    // a moldura. Sem isto a barra de titulo do Windows come ~38px do layout.
    useContentSize: true,
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: '#0A0A0B',
    // No app empacotado o icone ja vem no executavel; isto e para a janela e a
    // barra de tarefas em desenvolvimento nao ficarem com o icone do Electron.
    icon: join(__dirname, '../../build/icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  /*
   * F12 abre o devtools EM DESENVOLVIMENTO.
   *
   * Era a unica coisa do menu do Electron que fazia falta aqui. No app
   * empacotado ele nao existe: nao ha o que depurar do lado de quem usa.
   */
  if (isDev) {
    window.webContents.on('before-input-event', (_evento, entrada) => {
      if (entrada.type === 'keyDown' && entrada.key === 'F12') {
        window.webContents.toggleDevTools()
      }
    })
  }

  // Sem flash branco na abertura: mostra apenas quando ha algo para ver.
  window.once('ready-to-show', () => window.show())

  // Nada de navegacao para fora da janela.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  /*
   * SEM MENU NENHUM, e nao apenas escondido.
   *
   * `autoHideMenuBar` esconde a barra mas o Alt continua revelando ela: no
   * Windows, apertar Alt joga o foco no menu do Electron -- "quando aperto alt
   * ta aparecendo as config do electron e ta bugando o zoom". E o Alt e
   * justamente o atalho de ampliar a timeline, entao os dois brigavam.
   *
   * Some junto o resto dos atalhos que vinham de graca e nao sao deste app:
   * recarregar, abrir o devtools, e o zoom do Chromium no Ctrl+/-/0, que
   * aumenta a INTERFACE inteira e nao tem nada a ver com ampliar a timeline.
   */
  /*
   * No macOS o menu FICA: la o Ctrl+C e o Ctrl+V de um campo de texto passam
   * pelos papeis do menu, e tira-lo deixaria o usuario sem copiar e colar. O
   * Alt tambem nao abre menu nenhum por la, entao nao ha o que consertar.
   */
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

  // Antes da janela: os servicos publicam URLs assim que um arquivo entra.
  await startMediaServer()

  const userData = app.getPath('userData')

  /*
   * O Remotion decide onde guardar o Chrome do render subindo a partir de
   * process.cwd() ate achar um package.json, e nao expoe opcao nem variavel de
   * ambiente para sobrescrever isso.
   *
   * Num app instalado nao existe package.json acima do executavel, entao o
   * cache cairia na pasta de instalacao -- que some numa atualizacao e, numa
   * instalacao para todos os usuarios, nem tem permissao de escrita. Sem
   * permissao o download falha e o render cai no navegador do sistema, que e
   * ~3x mais lento, sem nenhum aviso.
   *
   * Fixar o cwd no userData resolve: o Chrome fica ao lado do modelo do
   * Whisper, sobrevive a atualizacao e sempre tem escrita. Nada no app usa
   * caminho relativo, entao mudar o cwd nao afeta mais nada.
   */
  process.chdir(userData)

  configureSettings(userData)
  // O autosave mora no userData e nao ao lado do projeto: ele precisa existir
  // mesmo antes de haver um projeto com pasta propria.
  configureProjects(userData)
  // Binario e modelo do Whisper ficam no userData: sobrevivem a atualizacao do
  // app e nao sujam a pasta do projeto.
  configureWhisper(join(userData, 'whisper'))
  // O cache da biblioteca tambem: a pasta de cenas do usuario e so leitura, e
  // nada do Dangai pode ser gravado dentro dela.
  configureLibrary(userData)
  // Apelidos tambem: e escolha do usuario sobre a biblioteca dele, nao parte
  // dela -- a pasta de cenas continua sendo so leitura.
  configureNicknames(userData)
  configureFavorites(userData)
  configureTagger(userData)
  configureDescribe(userData)

  // Os SFX moram no userData para o usuario poder trocar os arquivos: a pasta
  // do app some numa atualizacao e pode nem ter permissao de escrita.
  const sfxUserDir = join(userData, 'sfx')
  configureSfx({
    userDir: sfxUserDir,
    bundledDir: app.isPackaged
      ? join(process.resourcesPath, 'sfx')
      : join(app.getAppPath(), 'assets', 'sfx'),
  })
  ensureSfxDir()

  // As fontes das legendas seguem o mesmo desenho dos SFX: pasta no userData
  // onde ele larga os arquivos. O app nao vem com fonte nenhuma alem da
  // embutida -- fonte tem licenca, e a escolha do visual e dele.
  configureFontes(join(userData, 'fontes'))
  ensureFontesDir()

  // O modelo de upscale vai junto com o app (2,4 MB); os arquivos melhorados
  // vao para o userData, que e onde ha permissao de escrita.
  configureUpscale(
    app.isPackaged
      ? join(process.resourcesPath, 'upscale')
      : join(app.getAppPath(), 'assets', 'upscale'),
  )
  configureUpscaleCache(userData)

  // O cascade de rosto de anime: 247 KB soltos junto do app, como os SFX.
  configureFaces(
    app.isPackaged
      ? join(process.resourcesPath, 'vision', 'anime-face.xml')
      : join(app.getAppPath(), 'assets', 'vision', 'anime-face.xml'),
  )

  configureRender({
    appPath: app.getAppPath(),
    prebuiltBundle: app.isPackaged
      ? join(process.resourcesPath, 'remotion')
      : join(app.getAppPath(), 'out', 'remotion'),
    defaultSfxDir: sfxUserDir,
    binariesDirectory: app.isPackaged ? findCompositorDir() : null,
  })

  registerIpc()
  createWindow()

  // Com catch: sem ele, uma falha aqui vira UnhandledPromiseRejection no
  // stdout do processo main -- que ninguem le -- e a atualizacao simplesmente
  // nunca acontece, em silencio.
  startUpdater(() => BrowserWindow.getAllWindows(), app.isPackaged).catch((err: unknown) => {
    console.error('[updater] nao pode iniciar:', err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/*
 * O Whisper vai junto ao sair.
 *
 * O whisper-cli e filho deste processo, mas o Windows nao o mata junto: em
 * 12/09/2026 sobraram 24 deles segurando 20,4 GB depois de a janela fechar, e
 * so o Gerenciador de Tarefas resolveu. Quem cria o processo tem a obrigacao
 * de leva-lo embora.
 */
app.on('before-quit', encerrarWhisper)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Acha a pasta do compositor do Remotion desempacotada ao lado do asar.
 *
 * O nome do pacote muda por plataforma e ABI (compositor-win32-x64-msvc,
 * compositor-darwin-arm64, compositor-linux-x64-gnu...). Procurar pelo prefixo
 * e mais confiavel que montar o nome na mao -- so existe um por build.
 */
function findCompositorDir(): string | null {
  const base = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@remotion')
  try {
    const match = readdirSync(base).find((name) => name.startsWith('compositor-'))
    return match ? join(base, match) : null
  } catch {
    return null
  }
}
