import { app, net } from 'electron'
import { execFile, spawn } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const executar = promisify(execFile)

/**
 * Atualizar SEM instalador: baixa a pasta pronta e troca os arquivos.
 *
 * POR QUE ISTO EXISTE, e nao o `quitAndInstall` do electron-updater:
 *
 * O caminho normal no Windows e rodar o instalador NSIS. Esse arquivo nasce
 * novo e sem assinatura a cada versao, e o Smart App Control -- ligado por
 * padrao em instalacao limpa do Windows 11 -- recusa executa-lo. Na maquina
 * dele isso barrou a 1.31.0 seis vezes seguidas, com o instalador ja baixado
 * e com o hash conferido no disco. Sem certificado nao ha o que negociar: o
 * arquivo e novo, e continuara novo a cada versao.
 *
 * MEDIDO antes de escrever isto, na mesma maquina e com a politica ligada:
 *
 *   o instalador NSIS                       BARRADO   (evento 3077, 6x)
 *   o Dangai.exe recem-compilado            ABRIU
 *   um .bat novo executado pelo cmd.exe      RODOU
 *   renomear o Dangai.exe EM USO             FUNCIONA
 *
 * O que a politica barra e o INSTALADOR -- nao o app, nao script. Entao a
 * atualizacao passa a ser o que ela nunca deveria ter deixado de ser: trocar
 * arquivos de lugar.
 *
 * TUDO O QUE ISTO USA JA VEM NO WINDOWS e e assinado pela Microsoft:
 * `tar.exe` abre zip desde o Windows 10 1803, `move` troca as pastas e
 * `cmd.exe` roda o script. Nenhuma dependencia nova entrou no projeto.
 */

/**
 * A pasta onde o app esta instalado -- a que vai ser substituida.
 *
 * Em dev isto aponta para o electron do node_modules, e por isso nada daqui
 * roda fora do app empacotado.
 */
function pastaDoApp(): string {
  return dirname(app.getPath('exe'))
}

/**
 * O canteiro de obras fica AO LADO da instalacao, e nao no temp.
 *
 * A troca inteira depende de `move` ser instantaneo, e `move` so e
 * instantaneo dentro do mesmo volume -- entre volumes ele vira uma copia de
 * 640 MB, e a janela em que o app nao existe em lugar nenhum deixa de ser de
 * milissegundos. Vizinho da instalacao, o mesmo volume e garantido.
 */
function pastaDeTroca(): string {
  return join(dirname(pastaDoApp()), '.dangai-troca')
}

export interface PacotePronto {
  version: string
  /** A pasta ja desempacotada e conferida, pronta para tomar o lugar. */
  staging: string
}

function limpar(caminho: string): void {
  try {
    rmSync(caminho, { recursive: true, force: true })
  } catch {
    /* em uso ou ja sumiu; quem chama decide o que fazer */
  }
}

/**
 * Baixa o zip da release, com progresso.
 *
 * Usa o `net` do Electron e nao o `https` do Node: ele ja segue os
 * redirecionamentos do GitHub (a release manda para objects.githubusercontent)
 * e respeita o proxy do sistema, que e o que faz isto funcionar em rede
 * alheia sem nenhuma configuracao.
 */
export function baixarPacote(
  version: string,
  repo: string,
  aoProgredir: (fracao: number) => void,
): Promise<string> {
  const raiz = pastaDeTroca()
  mkdirSync(raiz, { recursive: true })
  const nome = `Dangai-${version}-win-x64.zip`
  const destino = join(raiz, nome)
  limpar(destino)

  const url = `https://github.com/${repo}/releases/download/v${version}/${nome}`

  return new Promise<string>((resolve, reject) => {
    const pedido = net.request(url)
    pedido.on('response', (resposta) => {
      if (resposta.statusCode !== 200) {
        reject(new Error(`o pacote da ${version} respondeu ${resposta.statusCode}`))
        return
      }

      const tamanho = Number(resposta.headers['content-length'] ?? 0)
      let recebido = 0
      const arquivo = createWriteStream(destino)

      resposta.on('data', (pedaco: Buffer) => {
        recebido += pedaco.length
        arquivo.write(pedaco)
        // Sem content-length nao ha fracao honesta a mostrar -- melhor nao
        // dizer nada do que inventar uma barra que anda para tras.
        if (tamanho > 0) aoProgredir(recebido / tamanho)
      })

      resposta.on('end', () => {
        arquivo.end(() => {
          /*
           * O TAMANHO E A PRIMEIRA CONFERENCIA.
           *
           * Download cortado no meio produz um arquivo que ainda parece um
           * zip. Sem esta linha ele seguiria para a troca e so falharia ao
           * desempacotar -- depois de o app ter fechado, que e o pior momento
           * possivel para descobrir.
           */
          if (tamanho > 0 && statSync(destino).size !== tamanho) {
            limpar(destino)
            reject(new Error('o download veio incompleto'))
            return
          }
          resolve(destino)
        })
      })

      resposta.on('error', (erro: Error) => {
        arquivo.destroy()
        limpar(destino)
        reject(erro)
      })
    })
    pedido.on('error', reject)
    pedido.end()
  })
}

/**
 * Desempacota e CONFERE antes de deixar trocar.
 *
 * A conferencia toda acontece aqui, com o app ainda aberto e podendo
 * reclamar na tela. Depois deste ponto o app fecha, e um pacote quebrado
 * descoberto dali em diante deixaria o usuario sem app nenhum.
 */
export async function prepararPacote(zip: string, version: string): Promise<PacotePronto> {
  const staging = join(pastaDeTroca(), 'novo')
  limpar(staging)
  mkdirSync(staging, { recursive: true })

  // `tar.exe` do proprio Windows valida o CRC de cada entrada: zip corrompido
  // falha AQUI, e nao no meio da troca.
  await executar('tar.exe', ['-xf', zip, '-C', staging])

  if (!existsSync(join(staging, 'Dangai.exe'))) throw new Error('o pacote nao tem Dangai.exe')
  if (!existsSync(join(staging, 'resources', 'app.asar'))) {
    throw new Error('o pacote nao tem resources/app.asar')
  }
  /*
   * Um pacote de verdade tem dezenas de itens na raiz.
   *
   * Um zip que desempacota "com sucesso" para tres arquivos passaria nas duas
   * checagens acima. Este piso e grosseiro de proposito: nao tenta provar que
   * o pacote esta certo, so recusa o que obviamente nao esta.
   */
  if (readdirSync(staging).length < 10) throw new Error('o pacote veio quase vazio')

  limpar(zip)
  return { version, staging }
}

/**
 * Fecha o app e troca as pastas.
 *
 * A troca mora num .bat porque ela precisa acontecer DEPOIS de o app fechar:
 * enquanto ele roda, os .dll e os .pak estao mapeados em memoria e nao se
 * deixam substituir. E e .bat, e nao um executavel auxiliar, porque um
 * executavel auxiliar seria mais um arquivo novo e sem assinatura -- ou seja,
 * exatamente o que a politica barra, e estariamos de volta ao comeco.
 *
 * DUAS RENOMEACOES, e nao uma copia. `move` no mesmo volume e instantaneo,
 * entao a janela em que o app nao esta no lugar dura milissegundos -- e
 * desfazer e outro `move`, nao uma restauracao de 640 MB.
 *
 * E SEMPRE TERMINA ABRINDO O APP. Por qualquer caminho: deu certo, nao deu,
 * ou nem comecou. Uma atualizacao que falha e um aborrecimento; uma que falha
 * e deixa a pessoa sem app e outra coisa.
 */
export function trocarEReabrir(pacote: PacotePronto): void {
  const instalado = pastaDoApp()
  const antiga = join(pastaDeTroca(), 'anterior')
  const bat = join(pastaDeTroca(), 'trocar.bat')
  limpar(antiga)

  const exe = join(instalado, 'Dangai.exe')

  const roteiro = [
    '@echo off',
    // Espera este processo morrer. Ele morre no app.quit() logo abaixo.
    ':espera',
    `tasklist /fi "PID eq ${process.pid}" 2>nul | find "${process.pid}" >nul`,
    'if not errorlevel 1 (',
    '  timeout /t 1 /nobreak >nul',
    '  goto espera',
    ')',
    // Tira a atual do caminho. Falhou? Nada foi tocado -- so reabre.
    `move "${instalado}" "${antiga}" >nul 2>&1`,
    'if errorlevel 1 goto abrir',
    // Poe a nova no lugar. Falhou? Devolve a antiga.
    `move "${pacote.staging}" "${instalado}" >nul 2>&1`,
    'if errorlevel 1 goto voltar',
    /*
     * O DESINSTALADOR NAO VEM NO PACOTE.
     *
     * Ele e criado pelo NSIS na instalacao, nao pelo empacotamento. Sem estas
     * duas linhas a entrada em "Aplicativos instalados" passaria a apontar
     * para um arquivo que nao existe mais.
     */
    `copy /y "${antiga}\\Uninstall Dangai.exe" "${instalado}\\" >nul 2>&1`,
    `copy /y "${antiga}\\uninstallerIcon.ico" "${instalado}\\" >nul 2>&1`,
    `rmdir /s /q "${antiga}" >nul 2>&1`,
    'goto abrir',
    ':voltar',
    `move "${antiga}" "${instalado}" >nul 2>&1`,
    ':abrir',
    `start "" "${exe}"`,
    // Apaga a si mesmo: sobrar um .bat com os caminhos de uma troca que ja
    // aconteceu so serve para confundir quem for olhar depois.
    'del "%~f0"',
  ].join('\r\n')

  writeFileSync(bat, roteiro + '\r\n', 'ascii')

  /*
   * Solto, e sobrevivendo a morte do pai.
   *
   * O script so faz sentido depois que este processo morre. Preso a ele,
   * morreria junto e a troca nunca aconteceria.
   */
  const filho = spawn('cmd.exe', ['/c', bat], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  filho.unref()

  app.quit()
}

/**
 * Varre o que sobrou de uma troca anterior. Chamado na abertura.
 *
 * A pasta antiga so pode sumir DEPOIS de o app novo subir, e a essa altura o
 * .bat ja acabou. Se ele morreu antes de limpar -- maquina desligada no meio,
 * por exemplo -- sobram centenas de megabytes parados ali, e nada no app
 * denunciaria isso.
 */
export function limparTrocaAntiga(): void {
  const raiz = pastaDeTroca()
  if (!existsSync(raiz)) return
  for (const nome of ['anterior', 'novo']) limpar(join(raiz, nome))
}
