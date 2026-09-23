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
 * A versao baixada e esperando, e se ele ja mandou instalar.
 *
 * Os dois existem para distinguir DUAS falhas que chegam pelo mesmo evento
 * `error`: "nao consegui verificar" (rede, GitHub fora) e "o sistema nao
 * deixou instalar o que ja esta baixado". A segunda tem uma saida -- baixar o
 * pacote em pasta -- e a primeira nao, entao dizer as duas do mesmo jeito
 * manda o usuario procurar o problema no lugar errado.
 */
let prontaPara: string | null = null
let instalando = false

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
    prontaPara = info.version
    enviar({ state: 'pronta', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    enviar({ state: 'atual' })
  })
  autoUpdater.on('error', (err) => {
    // Falha de atualizacao nunca vira erro na cara do usuario: ele esta editando
    // um video, e o app funciona perfeitamente na versao que ja tem.
    console.error('[updater]', err)

    /*
     * Erro DEPOIS de mandar instalar e sempre sobre instalar.
     *
     * O electron-updater manda tudo pelo mesmo `error`, entao sem esta
     * distincao o "o Windows barrou o instalador" aparecia como "nao consegui
     * verificar" -- e mandava procurar problema na internet, que estava
     * perfeita: o arquivo ja tinha sido baixado e conferido.
     */
    if (instalando && prontaPara) {
      instalando = false
      enviar({ state: 'bloqueada', version: prontaPara, message: err.message })
      return
    }
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

/**
 * Fecha e instala. So chamado por acao explicita do usuario.
 *
 * `quitAndInstall` nao devolve o fracasso: quando ele consegue, o app morre
 * na linha seguinte; quando nao consegue, ele volta em silencio e a falha
 * chega depois, pelo evento `error`. A marca abaixo e o que liga um ao outro.
 */
export async function installUpdate(): Promise<void> {
  const { autoUpdater } = await carregar()
  instalando = true
  try {
    autoUpdater.quitAndInstall()
  } catch (err) {
    // Alguns fracassos sao sincronos. Sem este ramo, um deles deixaria a
    // marca ligada e o proximo erro de rede sairia como "o Windows barrou".
    instalando = false
    if (enviarStatus && prontaPara) {
      enviarStatus({
        state: 'bloqueada',
        version: prontaPara,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
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
