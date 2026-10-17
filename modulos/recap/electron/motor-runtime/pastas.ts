import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * ONDE MORA o runtime do motor e o que vai no instalador.
 *
 * [recap] Portado do Studio. Contrato em shared/motor-runtime.ts (o layout da
 * pasta esta no comentario do topo de la). No Dangai:
 * - o CODIGO do motor vai no instalador em resources/modulos/recap/motor (em
 *   dev, modulos/recap/motor);
 * - o RUNTIME (Python oficial + torch) e instalado pela tela do modulo no 1o
 *   uso em %LOCALAPPDATA%/Dangai/recap/motor-runtime: Local (5 GB nao
 *   sincronizam) e fora da pasta de instalacao do app;
 * - o uv NAO vai no instalador do Dangai (66 MB para todo mundo, ligado ou
 *   nao): e baixado na instalacao do runtime, para <runtime>/uv (fontes.ts).
 *
 * Sem import do electron de proposito: os testes (teste/) rodam isto no Node
 * puro, passando a configuracao na mao.
 */

export interface ConfigDoRuntime {
  /**
   * [recap] A pasta de dados do MODULO (<userData>/modulos/recap, ou a dos
   * testes): o motor-runtime.json da pasta escolhida e os dados do motor.
   */
  userData: string
  /** app.getAppPath(): em dev, a raiz do repositorio. */
  appPath: string
  /** process.resourcesPath: no app instalado, <instalacao>/resources. */
  resourcesPath: string
  empacotado: boolean
  /** app.getVersion(), gravado no impressao.json. */
  versaoDoApp: string
}

let config: ConfigDoRuntime | null = null

/** Chamada no `configurar` do modulo, logo depois do configurarMotor. */
export function configurarMotorRuntime(c: ConfigDoRuntime): void {
  config = c
}

export function configDoRuntime(): ConfigDoRuntime {
  if (!config) throw new Error('Runtime do motor nao configurado')
  return config
}

/**
 * O caminho FIXO em %LOCALAPPDATA%, e nao o basename do userData: nos testes o
 * userData e uma pasta temporaria (--user-data-dir), e o runtime tem que
 * continuar no lugar definitivo, que e o que o Levi usa. [recap] Dangai/recap:
 * o runtime e do modulo, nao do app.
 */
export const NOME_DO_APP = join('Dangai', 'recap')

/** Caminho maximo da pasta do runtime: o torch tem arquivos 150+ caracteres abaixo do venv. */
export const CAMINHO_MAXIMO_DA_PASTA = 80

/** [recap] O python do venv de dev (modulos/recap/motor/.venv, fora do git). */
export function pythonDoVenvDeDev(appPath: string): string {
  const pasta = join(appPath, 'modulos', 'recap', 'motor', '.venv')
  return process.platform === 'win32' ? join(pasta, 'Scripts', 'python.exe') : join(pasta, 'bin', 'python')
}

/**
 * O app usa o runtime (e nao o motor/.venv)? No app instalado, sempre. Em dev,
 * com ANIRECAP_MOTOR_RUNTIME=1 ou [recap] sem o modulos/recap/motor/.venv: o
 * dev sem venv instala pela tela, igual ao app instalado.
 */
export function usaRuntime(): boolean {
  // Sem configuracao (os testes antigos do motor, que so chamam configurarMotor): o dev de sempre.
  if (!config) return false
  if (config.empacotado || process.env['ANIRECAP_MOTOR_RUNTIME'] === '1') return true
  return !existsSync(pythonDoVenvDeDev(config.appPath))
}

/**
 * O codigo do motor (app/, run.py, studio-runtime.json): [recap]
 * resources/modulos/recap/motor (o `recursos` do contrato) ou
 * <repo>/modulos/recap/motor.
 */
export function pastaDoCodigoDoMotor(): string {
  const c = configDoRuntime()
  return c.empacotado ? join(c.resourcesPath, 'modulos', 'recap', 'motor') : join(c.appPath, 'modulos', 'recap', 'motor')
}

/** motor/studio-runtime.json (scripts/motor-lock.mjs). */
export function caminhoDoLock(): string {
  return join(pastaDoCodigoDoMotor(), 'studio-runtime.json')
}

/**
 * [recap] O uv.exe: baixado na instalacao para <runtime>/uv (fontes.ts), da
 * release oficial do astral-sh/uv, pinado por versao e sha256 no lock.
 * ANIRECAP_UV troca, para testes.
 */
export function caminhoDoUv(pasta: string = pastaDoRuntime().pasta): string {
  const env = process.env['ANIRECAP_UV']
  if (env) return env
  return join(pasta, 'uv', 'uv.exe')
}

/** A versao do uv que o app espera (o `uv.versao` do lock; scripts/motor-lock.mjs). */
export const VERSAO_DO_UV = '0.11.7'

function localAppData(): string {
  return process.env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local')
}

/** %LOCALAPPDATA%/Dangai/recap/motor-runtime: Local, e nao Roaming (5 GB nao sincronizam). */
export function pastaPadraoDoRuntime(): string {
  return join(localAppData(), NOME_DO_APP, 'motor-runtime')
}

/** <dados do modulo>/motor-runtime.json: {"pasta": "..."} quando o Levi escolhe outro disco. */
export function arquivoDaPastaEscolhida(): string {
  return join(configDoRuntime().userData, 'motor-runtime.json')
}

/**
 * A pasta efetiva: ANIRECAP_MOTOR_RUNTIME_PASTA (testes) > a escolhida > a padrao.
 * Arquivo torto conta como "nao escolheu".
 */
export function pastaDoRuntime(): { pasta: string; padrao: boolean } {
  const env = process.env['ANIRECAP_MOTOR_RUNTIME_PASTA']
  if (env) return { pasta: env, padrao: false }
  try {
    const j = JSON.parse(readFileSync(arquivoDaPastaEscolhida(), 'utf8')) as { pasta?: unknown }
    if (typeof j.pasta === 'string' && j.pasta.trim()) return { pasta: j.pasta.trim(), padrao: false }
  } catch {
    // sem arquivo: a padrao
  }
  return { pasta: pastaPadraoDoRuntime(), padrao: true }
}

/** Grava (ou apaga, com null) a pasta escolhida. Quem chama confere antes se da para gravar la. */
export function gravarPastaEscolhida(pasta: string | null): void {
  const arquivo = arquivoDaPastaEscolhida()
  if (pasta === null) {
    if (existsSync(arquivo)) writeFileSync(arquivo, '{}\n', 'utf8')
    return
  }
  mkdirSync(configDoRuntime().userData, { recursive: true })
  writeFileSync(arquivo, `${JSON.stringify({ pasta }, null, 2)}\n`, 'utf8')
}

/** Os caminhos dentro da pasta do runtime (o layout de shared/motor-runtime.ts). */
export function caminhosDoRuntime(pasta: string) {
  return {
    pasta,
    /** [recap] O Python OFICIAL (nuget.org, assinado pela PSF): cpython-<versao>-windows-x86_64-nuget/ aqui dentro. */
    python: join(pasta, 'python'),
    /** [recap] O uv baixado na instalacao (uv.exe + uv.json). */
    uv: join(pasta, 'uv'),
    venv: join(pasta, 'venv'),
    /** O python do venv (o lancador; o app abre o base com __PYVENV_LAUNCHER__, python-do-motor.ts). */
    pythonDoVenv:
      process.platform === 'win32' ? join(pasta, 'venv', 'Scripts', 'python.exe') : join(pasta, 'venv', 'bin', 'python'),
    sitePackages: join(pasta, 'venv', 'Lib', 'site-packages'),
    baixando: join(pasta, 'baixando'),
    uvCache: join(pasta, 'uv-cache'),
    /**
     * HF_HOME do motor no runtime: os modelos da 1a analise (~1,1 GB) ficam
     * AQUI, e nao no %USERPROFILE%/.cache/huggingface: entram no disco
     * escolhido, no Remover e no desinstalador.
     */
    modelos: join(pasta, 'modelos'),
    requisitos: join(pasta, 'req', 'pacotes.txt'),
    log: join(pasta, 'logs', 'instalar.log'),
    estado: join(pasta, 'estado.json'),
    impressao: join(pasta, 'impressao.json'),
    trava: join(pasta, 'instalando.trava'),
  }
}

export type CaminhosDoRuntime = ReturnType<typeof caminhosDoRuntime>
