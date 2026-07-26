import type { BrowserWindow } from 'electron'
import type { UpdateStatus } from '@shared/channels'
import { IPC } from '@shared/channels'

/**
 * Atualizacao automatica pelas releases do GitHub.
 *
 * O app instalado consulta o repositorio, baixa a versao nova em segundo plano
 * e troca de versao na proxima abertura -- ou na hora, se o usuario clicar.
 *
 * Quem decide reiniciar e o usuario, sempre. Um render de um minuto morrendo
 * porque o app resolveu se atualizar sozinho seria pior que ficar uma versao
 * atras.
 *
 * O import do electron-updater e dinamico: em desenvolvimento nao ha app
 * instalado para atualizar, e carregar a biblioteca so para nao usa-la custa
 * tempo de abertura.
 */

type Enviar = (status: UpdateStatus) => void

/** Uma vez por dia basta: o app fica aberto por sessoes de edicao, nao dias. */
const INTERVALO_MS = 6 * 60 * 60 * 1000

export async function startUpdater(
  windows: () => BrowserWindow[],
  isPackaged: boolean,
): Promise<void> {
  const enviar: Enviar = (status) => {
    for (const window of windows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.updateStatus, status)
    }
  }

  // Em dev nao existe instalacao para substituir; o updater reclamaria da falta
  // de app-update.yml a cada abertura.
  if (!isPackaged) return

  const { autoUpdater } = await import('electron-updater')

  autoUpdater.autoDownload = true
  // Instalar sozinho ao fechar surpreenderia: a troca acontece quando o usuario
  // manda, e nao quando ele so quis fechar a janela.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    enviar({ state: 'baixando', version: info.version, percent: 0 })
  })
  autoUpdater.on('download-progress', (progress) => {
    enviar({ state: 'baixando', percent: progress.percent / 100 })
  })
  autoUpdater.on('update-downloaded', (info) => {
    enviar({ state: 'pronta', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    enviar({ state: 'atual' })
  })
  autoUpdater.on('error', (err) => {
    // Falha de atualizacao nunca vira erro na cara do usuario: ele esta editando
    // um video, e o app funciona perfeitamente na versao que ja tem.
    console.error('[updater]', err)
    enviar({ state: 'erro', message: err.message })
  })

  const verificar = (): void => {
    void autoUpdater.checkForUpdates().catch(() => undefined)
  }

  // Nao na abertura: os primeiros segundos sao do usuario soltando arquivos,
  // e nao de uma consulta de rede disputando a banda.
  setTimeout(verificar, 8000)
  setInterval(verificar, INTERVALO_MS)
}

/** Fecha e instala. So chamado por acao explicita do usuario. */
export async function installUpdate(): Promise<void> {
  const { autoUpdater } = await import('electron-updater')
  autoUpdater.quitAndInstall()
}
