import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import { registerIpc } from './ipc'
import { startMediaServer } from './services/media-server'
import { configureRender } from './services/render'
import { configureSettings } from './services/settings'
import { configureSfx, ensureSfxDir } from './services/sfx'
import { startUpdater } from './services/updater'
import { configureWhisper } from './services/whisper'

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
  // Binario e modelo do Whisper ficam no userData: sobrevivem a atualizacao do
  // app e nao sujam a pasta do projeto.
  configureWhisper(join(userData, 'whisper'))

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

  void startUpdater(() => BrowserWindow.getAllWindows(), app.isPackaged)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

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
