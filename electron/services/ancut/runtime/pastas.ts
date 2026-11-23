import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * ONDE MORA o motor do AnCut no Dangai e o Python dele.
 *
 * O instalador do recap (modulos/recap/electron/motor-runtime) trazido para o
 * nucleo, para o motor do AnCut. Contrato em shared/runtime-do-motor.ts (o
 * layout da pasta esta no topo de la):
 * - o CODIGO do motor (o app/ do ancut-hub-engine, ~2 MB de Python) vai no
 *   instalador do Dangai em resources/motor/ancut (em dev, <repo>/motor/ancut);
 * - o PYTHON dele (o oficial do python.org + torch, ~5 GB) e baixado pela tela
 *   "Motor de cortes" so por quem quiser, em %LOCALAPPDATA%/Dangai/ancut/motor-runtime;
 * - os DADOS (config.json, index.db, fotos do elenco) sao os do AnCut
 *   instalado (%LOCALAPPDATA%/CorteCenas/CorteCenas): os dois apps veem o mesmo
 *   acervo. DANGAI_ANCUT_DADOS troca a pasta (testes).
 *
 * Sem import do electron: os testes rodam isto no Node puro.
 */

export interface ConfigDoRuntime {
  /** O userData do Dangai (o motor-ancut.json da pasta escolhida). */
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

/** Chamada uma vez no main, antes da janela. */
export function configurarMotorRuntime(c: ConfigDoRuntime): void {
  config = c
}

export function configDoRuntime(): ConfigDoRuntime {
  if (!config) throw new Error('Runtime do motor nao configurado')
  return config
}

/** O caminho FIXO em %LOCALAPPDATA%: nos testes o userData e temporario e o runtime fica no lugar definitivo. */
export const NOME_DO_APP = join('Dangai', 'ancut')

/** Caminho maximo da pasta do runtime: o torch tem arquivos 150+ caracteres abaixo do venv. */
export const CAMINHO_MAXIMO_DA_PASTA = 80

/**
 * O Dangai usa o runtime? Sempre que esta configurado: no dev nao ha um venv
 * proprio (quem testa com o venv do ancut-hub-engine usa DANGAI_ANCUT_MOTOR,
 * que passa na frente de tudo no motor.ts).
 */
export function usaRuntime(): boolean {
  return config !== null
}

/** O codigo do motor (app/ e ancut-runtime.json): resources/motor/ancut ou <repo>/motor/ancut. */
export function pastaDoCodigoDoMotor(): string {
  const c = configDoRuntime()
  return c.empacotado ? join(c.resourcesPath, 'motor', 'ancut') : join(c.appPath, 'motor', 'ancut')
}

/** motor/ancut/ancut-runtime.json (scripts/motor-ancut.mjs --lock). */
export function caminhoDoLock(): string {
  return join(pastaDoCodigoDoMotor(), 'ancut-runtime.json')
}

/**
 * O uv.exe: baixado na instalacao para <runtime>/uv (fontes.ts), da release
 * oficial do astral-sh/uv, pinado por versao e sha256 no lock.
 * DANGAI_ANCUT_UV troca, para testes.
 */
export function caminhoDoUv(pasta: string = pastaDoRuntime().pasta): string {
  const env = process.env['DANGAI_ANCUT_UV']
  if (env) return env
  return join(pasta, 'uv', 'uv.exe')
}

/** A versao do uv que o app espera (o `uv.versao` do lock). */
export const VERSAO_DO_UV = '0.11.7'

function localAppData(): string {
  return process.env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local')
}

/** %LOCALAPPDATA%/Dangai/ancut/motor-runtime: Local, e nao Roaming (5 GB nao sincronizam). */
export function pastaPadraoDoRuntime(): string {
  return join(localAppData(), NOME_DO_APP, 'motor-runtime')
}

/** <userData>/motor-ancut.json: {"pasta": "..."} quando a pessoa escolhe outro disco. */
export function arquivoDaPastaEscolhida(): string {
  return join(configDoRuntime().userData, 'motor-ancut.json')
}

/**
 * A pasta efetiva: DANGAI_ANCUT_RUNTIME_PASTA (testes) > a escolhida > a padrao.
 * Arquivo torto conta como "nao escolheu".
 */
export function pastaDoRuntime(): { pasta: string; padrao: boolean } {
  const env = process.env['DANGAI_ANCUT_RUNTIME_PASTA']
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

/**
 * Os dados do motor nos testes: DANGAI_ANCUT_DADOS (vira o ANCUT_DADOS do
 * motor: config, cache, modelos e logs numa pasta de rascunho). null = os do
 * AnCut instalado (ANCUT_COMO_INSTALADO=1).
 */
export function dadosDeTeste(): string | null {
  const env = process.env['DANGAI_ANCUT_DADOS']?.trim()
  return env ? env : null
}

/** As variaveis que dizem ao motor de onde sao os dados (config.py do ancut-hub-engine). */
export function ambienteDosDados(): Record<string, string> {
  const teste = dadosDeTeste()
  return teste ? { ANCUT_DADOS: teste } : { ANCUT_COMO_INSTALADO: '1' }
}

/** Os caminhos dentro da pasta do runtime (o layout de shared/runtime-do-motor.ts). */
export function caminhosDoRuntime(pasta: string) {
  return {
    pasta,
    /** O Python OFICIAL (nuget.org, assinado pela PSF): cpython-<versao>-windows-x86_64-nuget/ aqui dentro. */
    python: join(pasta, 'python'),
    /** O uv baixado na instalacao (uv.exe + uv.json). */
    uv: join(pasta, 'uv'),
    venv: join(pasta, 'venv'),
    /** O python do venv (o lancador; o app abre o base com __PYVENV_LAUNCHER__, python-do-motor.ts). */
    pythonDoVenv:
      process.platform === 'win32' ? join(pasta, 'venv', 'Scripts', 'python.exe') : join(pasta, 'venv', 'bin', 'python'),
    sitePackages: join(pasta, 'venv', 'Lib', 'site-packages'),
    baixando: join(pasta, 'baixando'),
    uvCache: join(pasta, 'uv-cache'),
    /**
     * HF_HOME do motor: os modelos da 1a analise (~1,1 GB). NAO fica no
     * runtime: o motor do AnCut ja baixou os dele no %USERPROFILE%/.cache, e
     * o mesmo acervo usa os mesmos modelos (ambiente.ts so poe HF_HOME quando
     * recebe um). Fica aqui para o plano de disco contar com ele.
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
