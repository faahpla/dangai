import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { CaminhosDoRuntime } from './pastas'
import { InstalacaoCancelada } from './erros'

/**
 * RODA O UV (e o Python do runtime, na conferencia) com o ambiente certo, e
 * mata a arvore no cancelar.
 *
 * DONO: agente A. Sem electron.
 *
 * O ambiente do uv e LIMPO: nada de UV_*, PYTHON*, VIRTUAL_ENV ou CONDA_* do
 * computador de quem instala (um UV_INDEX_URL de outro projeto, um
 * PYTHONHOME velho) entra. E tudo que o uv grava fica na pasta do runtime:
 * - UV_CACHE_DIR=<rt>/uv-cache: retomada dos pacotes; apagada no fim. Na mesma
 *   pasta do venv, o UV_LINK_MODE=hardlink liga os arquivos sem copiar.
 * - [recap] UV_PYTHON_DOWNLOADS=never: o Python e o OFICIAL que o app poe em
 *   <rt>/python (fontes.ts) e passa pelo --python; o uv nunca baixa outro. O
 *   UV_PYTHON_INSTALL_DIR aponta para uma pasta vazia do runtime: nada do uv
 *   cai fora dele.
 * - UV_NO_CONFIG: nenhum uv.toml/pyproject do usuario.
 * - UV_SYSTEM_CERTS: antivirus e proxy que interceptam HTTPS poem o
 *   certificado deles no repositorio do Windows; sem isto o uv recusa.
 */

const FORA = /^(UV_|PYTHON|VIRTUAL_ENV$|CONDA_|PIP_|__PYVENV_LAUNCHER__$)/i

export function ambienteDoUv(c: CaminhosDoRuntime, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) if (!FORA.test(k)) env[k] = v
  Object.assign(env, {
    UV_NO_CONFIG: '1',
    UV_CACHE_DIR: c.uvCache,
    UV_PYTHON_INSTALL_DIR: join(c.pasta, 'uv-python'),
    UV_PYTHON_DOWNLOADS: 'never',
    UV_LINK_MODE: 'hardlink',
    UV_SYSTEM_CERTS: '1',
    UV_NO_PROGRESS: '1',
    // O uv so escreve sem cor quando nao ha terminal; garante.
    NO_COLOR: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONDONTWRITEBYTECODE: '1',
  })
  return env
}

/** Os processos vivos (uv, python da conferencia), para o cancelar e a saida do app. */
const vivos = new Set<ChildProcess>()

/** Mata o processo e os filhos (o uv sobe python para compilar). Nunca lanca. */
export function matarArvore(filho: ChildProcess, sincrono = false): void {
  const pid = filho.pid
  if (!pid || filho.exitCode !== null || filho.signalCode !== null) return
  try {
    if (process.platform !== 'win32') {
      filho.kill('SIGKILL')
      return
    }
    const args = ['/PID', String(pid), '/T', '/F']
    if (sincrono) spawnSync('taskkill', args, { windowsHide: true, timeout: 5000, stdio: 'ignore' })
    else spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => filho.kill())
  } catch {
    // ja morreu
  }
}

/** Mata todos os processos da instalacao. `sincrono` na saida do app. */
export function matarTodos(sincrono = false): void {
  for (const f of vivos) matarArvore(f, sincrono)
}

export interface SaidaDoProcesso {
  codigo: number | null
  /** As ultimas linhas (stdout e stderr juntos, na ordem em que chegaram). */
  linhas: string[]
  /** So o stdout (a saida do `uv pip freeze`, o JSON da conferencia). */
  stdout: string
}

/**
 * Roda um executavel e devolve o codigo e as linhas. Cada linha vai para o
 * `log` e para o `aoLinha` (o andamento dos pacotes). Cancelado pelo `signal`:
 * mata a arvore e lanca InstalacaoCancelada. `limiteMs` estourado: mata e
 * devolve codigo null com a frase na ultima linha.
 */
export function rodar(
  cmd: string,
  args: string[],
  o: {
    env: NodeJS.ProcessEnv
    cwd?: string
    signal: AbortSignal
    log(linha: string): void
    aoLinha?(linha: string): void
    limiteMs?: number
  },
): Promise<SaidaDoProcesso> {
  return new Promise((resolver, rejeitar) => {
    if (o.signal.aborted) {
      rejeitar(new InstalacaoCancelada())
      return
    }
    const linhas: string[] = []
    let stdout = ''
    let filho: ChildProcess
    try {
      filho = spawn(cmd, args, { env: o.env, cwd: o.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolver({ codigo: null, linhas: [e instanceof Error ? e.message : String(e)], stdout: '' })
      return
    }
    vivos.add(filho)
    let estourou = false
    const relogio = o.limiteMs
      ? setTimeout(() => {
          estourou = true
          matarArvore(filho)
        }, o.limiteMs)
      : null
    const cancelar = (): void => matarArvore(filho)
    o.signal.addEventListener('abort', cancelar, { once: true })

    const ler = (eStdout: boolean) => {
      let resto = ''
      return (d: Buffer | string): void => {
        const texto = String(d)
        if (eStdout) stdout += texto
        resto += texto
        let i = resto.search(/\r?\n|\r/)
        while (i >= 0) {
          const linha = resto.slice(0, i).trimEnd()
          resto = resto.slice(i + (resto[i] === '\r' && resto[i + 1] === '\n' ? 2 : 1))
          if (linha.trim()) {
            linhas.push(linha)
            if (linhas.length > 400) linhas.shift()
            o.log(linha)
            o.aoLinha?.(linha)
          }
          i = resto.search(/\r?\n|\r/)
        }
        if (resto.length > 1 << 20) resto = resto.slice(-4096)
      }
    }
    filho.stdout?.setEncoding('utf8')
    filho.stderr?.setEncoding('utf8')
    filho.stdout?.on('data', ler(true))
    filho.stderr?.on('data', ler(false))

    let acabou = false
    const fim = (codigo: number | null, erro?: string): void => {
      if (acabou) return
      acabou = true
      if (relogio) clearTimeout(relogio)
      vivos.delete(filho)
      o.signal.removeEventListener('abort', cancelar)
      if (o.signal.aborted) {
        rejeitar(new InstalacaoCancelada())
        return
      }
      if (erro) linhas.push(erro)
      if (estourou) linhas.push(`nao terminou em ${Math.round((o.limiteMs ?? 0) / 1000)} s`)
      resolver({ codigo: estourou ? null : codigo, linhas, stdout })
    }
    filho.on('error', (e) => fim(null, e.message))
    filho.on('close', (codigo) => fim(codigo))
  })
}
