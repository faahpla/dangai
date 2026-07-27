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

/**
 * Como avisar a interface, guardado no modulo.
 *
 * Precisa viver fora de startUpdater porque a busca manual (o usuario clicando
 * na versao) tambem precisa reportar -- inclusive o caso em que o updater nem
 * chegou a iniciar, que antes ficava invisivel.
 */
let enviarStatus: Enviar | null = null

/** Se o updater chegou a subir. Falso em dev e se a carga falhou. */
let ativo = false

/**
 * Carrega o electron-updater lidando com o embrulho de CJS.
 *
 * A biblioteca e CommonJS e o processo main sai bundlado como CJS, entao o
 * `await import()` devolve `{ default: { autoUpdater } }` em vez de
 * `{ autoUpdater }`. Sem desembrulhar, autoUpdater vem undefined e a primeira
 * atribuicao explode.
 *
 * Isso NUNCA aparece em desenvolvimento, onde o updater nem chega a rodar --
 * so no app empacotado, e so quando ele tenta se atualizar.
 */
async function carregar(): Promise<typeof import('electron-updater')> {
  const modulo = await import('electron-updater')
  const embrulhado = (modulo as { default?: typeof import('electron-updater') }).default
  return embrulhado?.autoUpdater ? embrulhado : modulo
}

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
  enviarStatus = enviar

  // Em dev nao existe instalacao para substituir; o updater reclamaria da falta
  // de app-update.yml a cada abertura.
  if (!isPackaged) return

  const { autoUpdater } = await carregar()
  ativo = true

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
  const { autoUpdater } = await carregar()
  autoUpdater.quitAndInstall()
}

/**
 * Procura atualizacao agora, porque o usuario pediu.
 *
 * Existe por um motivo que a busca automatica nao resolve: quando tudo esta em
 * dia, o app nao mostra nada -- e "em dia" fica visualmente igual a "quebrado".
 * Sem uma forma de perguntar, a unica maneira de saber se a atualizacao
 * funciona e esperar sair uma versao nova e torcer.
 *
 * Ao contrario da busca automatica, esta REPORTA o erro: quem clicou esta
 * esperando uma resposta, e silencio seria a mesma armadilha de novo.
 */
export async function checkForUpdateNow(): Promise<void> {
  const enviar = enviarStatus
  if (!enviar) return

  if (!ativo) {
    enviar({
      state: 'erro',
      message: 'A atualizacao automatica so funciona no app instalado.',
    })
    return
  }

  enviar({ state: 'procurando' })

  try {
    const { autoUpdater } = await carregar()
    const resultado = await autoUpdater.checkForUpdates()
    // Sem updateInfo nao ha o que baixar, e nenhum evento vai chegar depois --
    // sem isto a interface ficaria presa em "procurando" para sempre.
    if (!resultado) enviar({ state: 'atual' })
  } catch (err) {
    enviar({
      state: 'erro',
      message: err instanceof Error ? err.message : 'Nao consegui verificar agora.',
    })
  }
}
