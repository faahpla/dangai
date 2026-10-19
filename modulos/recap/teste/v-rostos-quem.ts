/**
 * [recap] QUEM E CADA ROSTO no modo `rostos` do motor (19/10, o teste real do
 * Magic Repo Man E02): roda motor/tests/test_rostos_quem.py (unittest) no
 * Python do runtime (ou do motor/.venv); sem ele, pula com aviso. Sem modelo e
 * sem rede: as similaridades sao as medidas no episodio.
 *
 *   - cada rosto disputa so a pessoa que ele quer (a Misa grande nao tira mais
 *     o Lent do rosto pequeno dele); quase empate entre dois rostos: nenhum;
 *   - uma pessoa so no conjunto: so acima do LIMIAR_SOZINHO;
 *   - a janela do recorte e de quem mais parece com ela, com folga da 2a;
 *   - a cabeca que cobre um rosto achado e a mesma pessoa.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-rostos-quem.ts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const motor = resolve(import.meta.dirname, '..', 'motor')

/** O Python do runtime instalado (o base + __PYVENV_LAUNCHER__, como o app), ou o .venv de dev. */
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
if (!py) {
  console.warn('AVISO: sem o Python do motor (runtime ou .venv): test_rostos_quem.py pulou.')
} else {
  const r = spawnSync(py.cmd, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_rostos_quem.py'], {
    cwd: motor,
    encoding: 'utf8',
    env: { ...process.env, ...py.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' },
  })
  const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.status !== 0) {
    console.error(saida)
    assert.fail('os testes de quem e cada rosto (test_rostos_quem.py) falharam')
  }
  console.log(`motor: ${/Ran (\d+) tests?/.exec(saida)?.[0] ?? 'ok'}`)
}
console.log('v-rostos-quem: tudo ok')
