import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { startMediaServer } from './services/media-server'
import { configureRender } from './services/render'
import { configureSettings } from './services/settings'
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
  configureSettings(userData)
  // Binario e modelo do Whisper ficam no userData: sobrevivem a atualizacao do
  // app e nao sujam a pasta do projeto.
  configureWhisper(join(userData, 'whisper'))

  configureRender({
    appPath: app.getAppPath(),
    prebuiltBundle: app.isPackaged
      ? join(process.resourcesPath, 'remotion')
      : join(app.getAppPath(), 'out', 'remotion'),
    defaultSfxDir: app.isPackaged
      ? join(process.resourcesPath, 'sfx')
      : join(app.getAppPath(), 'assets', 'sfx'),
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
