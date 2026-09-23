import type { BrowserWindow } from 'electron'
import type { UpdateStatus } from '@shared/channels'
import { IPC, REPO } from '@shared/channels'
import {
  baixarPacote,
  limparTrocaAntiga,
  prepararPacote,
  trocarEReabrir,
  type PacotePronto,
} from './troca'

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
 * O pacote ja baixado, desempacotado e conferido, esperando a troca.
 *
 * Null quer dizer que nao ha o que instalar -- nem que nunca houve versao
 * nova, mas que nada esta pronto para tomar o lugar da instalacao atual.
 */
let pronto: PacotePronto | null = null

/** Impede duas preparacoes simultaneas do mesmo pacote. */
let preparando = false

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

  // Sobras de uma troca anterior somem agora, com o app recem-aberto e nada
  // em uso.
  limparTrocaAntiga()

  const { autoUpdater } = await carregar()
  ativo = true

  /*
   * O electron-updater so PROCURA. Baixar e instalar sao nossos.
   *
   * Deixado ligado, ele baixaria o instalador NSIS de 213 MB para uma etapa
   * que o Smart App Control recusa executar -- e recusaria de novo a cada
   * versao. Quem baixa e o `troca.ts`, e o que ele baixa e a pasta pronta.
   */
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    void prepararTroca(info.version, enviar)
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

/**
 * Baixa a pasta pronta e deixa tudo conferido, esperando o usuario mandar.
 *
 * Tudo o que pode dar errado acontece AQUI, com o app aberto e podendo
 * mostrar o problema na tela. Depois da troca o app fecha, e a partir dali um
 * erro nao tem mais onde aparecer.
 */
async function prepararTroca(version: string, enviar: Enviar): Promise<void> {
  if (preparando || pronto?.version === version) return
  preparando = true
  try {
    enviar({ state: 'baixando', version, percent: 0 })
    const zip = await baixarPacote(version, REPO, (fracao) =>
      enviar({ state: 'baixando', version, percent: fracao }),
    )
    pronto = await prepararPacote(zip, version)
    enviar({ state: 'pronta', version })
  } catch (err) {
    console.error('[updater] preparar', err)
    enviar({
      state: 'erro',
      message: err instanceof Error ? err.message : 'Nao consegui baixar a atualizacao.',
    })
  } finally {
    preparando = false
  }
}

/**
 * Fecha o app e troca as pastas. So por acao explicita do usuario.
 *
 * Nao ha instalador envolvido: o que roda depois daqui e um .bat que espera
 * este processo morrer, renomeia duas pastas e reabre o app. Ver `troca.ts`
 * para o porque de nao ser o `quitAndInstall` do electron-updater.
 */
export async function installUpdate(): Promise<void> {
  if (!pronto) {
    enviarStatus?.({
      state: 'erro',
      message: 'Nao ha atualizacao preparada. Procure de novo.',
    })
    return
  }

  try {
    trocarEReabrir(pronto)
  } catch (err) {
    /*
     * Se ate a troca por script for barrada, ainda ha uma saida -- e ela e a
     * mesma que o chip vermelho ensina: baixar o pacote da release e trocar
     * os arquivos na mao. Por isso o estado e `bloqueada` e nao `erro`: um
     * manda esperar, o outro manda fazer.
     */
    console.error('[updater] trocar', err)
    enviarStatus?.({
      state: 'bloqueada',
      version: pronto.version,
      message: err instanceof Error ? err.message : String(err),
    })
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
