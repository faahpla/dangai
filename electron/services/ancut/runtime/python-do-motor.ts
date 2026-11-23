import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Como chamar o Python do venv do motor sem passar pelo lancador.
 *
 * No Windows, o motor/.venv/Scripts/python.exe de um venv do uv e um LANCADOR
 * (venvlauncher): ele le o `home` do pyvenv.cfg e abre o Python de verdade.
 * Em 15/10/2026 ele falhou no app aberto pelo atalho com "No Python at
 * '"C:\...\python.exe'" (codigo 103), embora o Python estivesse la -- e no
 * mesmo minuto funcionava pelo terminal. Para nao depender dele, o app abre o
 * Python base direto e passa __PYVENV_LAUNCHER__, que e exatamente o que o
 * lancador faz: o Python ve o pyvenv.cfg ao lado desse caminho e vira o venv
 * (sys.prefix, site-packages, torch). Conferido: sys.prefix = .venv e
 * torch.cuda.is_available() = True.
 *
 * Sem pyvenv.cfg legivel, ou sem o Python base no disco, volta o lancador de
 * sempre: o erro dele continua aparecendo como antes.
 */
export interface PythonDoMotor {
  cmd: string
  /** Variaveis que precisam ir junto no ambiente do processo. */
  env: Record<string, string>
}

/** `lancador` e o python do venv (motor/.venv/Scripts/python.exe ou bin/python). */
export function pythonDoMotor(lancador: string): PythonDoMotor {
  if (process.platform !== 'win32') return { cmd: lancador, env: {} }
  const venv = dirname(dirname(lancador))
  try {
    const cfg = readFileSync(join(venv, 'pyvenv.cfg'), 'utf8')
    const home = /^\s*home\s*=\s*(.+?)\s*$/m.exec(cfg)?.[1]?.replace(/^["']+|["']+$/g, '')
    const base = home ? join(home, 'python.exe') : null
    if (base && existsSync(base)) return { cmd: base, env: { __PYVENV_LAUNCHER__: lancador } }
  } catch {
    // Sem pyvenv.cfg: fica o lancador.
  }
  return { cmd: lancador, env: {} }
}
