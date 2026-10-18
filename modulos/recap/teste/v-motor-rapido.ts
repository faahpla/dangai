/**
 * O1 (18/10): o CORTE MAIS RAPIDO sem mudar o resultado. Roda os testes do
 * motor (motor/tests/test_rapido.py, unittest) no Python do runtime (ou do
 * motor/.venv); sem ele, pula com aviso. Sem rede e sem a biblioteca dele: o
 * video de teste e sintetico (o ffmpeg do motor gera 75 s com cortes secos).
 *
 *   - a deteccao em pedacos paralelos = a sequencial, cena por cena;
 *   - a deteccao por tras (enquanto o elenco e buscado) devolve o mesmo e para;
 *   - os vetores do CCIP em 3 sessoes = os de uma sessao so;
 *   - o corte decodificando na GPU: so H.264/HEVC 8 bits e, com NVENC, os
 *     mesmos quadros (framemd5) da CPU.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-motor-rapido.ts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

// --------------------------------------------------------------- 2. motor
const motor = resolve(import.meta.dirname, '..', 'motor')

/** O Python do runtime instalado (o mesmo jeito do app: o base + __PYVENV_LAUNCHER__), ou o .venv de dev. */
function pythonDoMotor(): { cmd: string; env: Record<string, string> } | null {
  const runtime = process.env['ANIRECAP_MOTOR_RUNTIME_PASTA'] || join(process.env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local'), 'Dangai', 'recap', 'motor-runtime')
  for (const lancador of [join(runtime, 'venv', 'Scripts', 'python.exe'), join(motor, '.venv', 'Scripts', 'python.exe')]) {
    if (!existsSync(lancador)) continue
    try {
      const cfg = readFileSync(join(lancador, '..', '..', 'pyvenv.cfg'), 'utf8')
      const home = /^\s*home\s*=\s*(.+?)\s*$/m.exec(cfg)?.[1]
      const base = home ? join(home, 'python.exe') : null
      if (base && existsSync(base)) return { cmd: base, env: { __PYVENV_LAUNCHER__: lancador } }
    } catch {
      // sem pyvenv.cfg: o lancador
    }
    return { cmd: lancador, env: {} }
  }
  return null
}

const py = pythonDoMotor()
/** No Windows a chave e 'Path': criar 'PATH' ao lado deixaria duas. */
const CHAVE_DO_PATH = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
if (!py) {
  console.warn('AVISO: sem o Python do motor (runtime ou .venv): os testes do motor (test_rapido.py) pularam.')
} else {
  const r = spawnSync(py.cmd, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_rapido.py'], {
    cwd: motor,
    encoding: 'utf8',
    // O ffmpeg do app na frente, como o motor roda no app (ambienteDoRuntime).
    env: {
      ...process.env,
      ...py.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONNOUSERSITE: '1',
      [CHAVE_DO_PATH]: [join(resolve(import.meta.dirname, '..', '..', '..'), 'node_modules', 'ffmpeg-static'), process.env[CHAVE_DO_PATH] ?? ''].join(';'),
    },
  })
  const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.status !== 0) {
    console.error(saida)
    assert.fail('os testes do motor (test_rapido.py) falharam')
  }
  console.log(`motor: ${/Ran (\d+) tests?/.exec(saida)?.[0] ?? 'ok'}`)
}
console.log('v-motor-rapido: tudo ok')
