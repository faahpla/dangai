/**
 * A1 (18/10): ACHAR O ANIME sem o Jikan e o "Buscar elenco".
 *
 * 1. O contrato da tela (shared/descoberta.ts): as sugestoes do motor viram a
 *    lista das teclas 1-9 (sem nome repetido, ate SUGESTOES_MAX, numero torto
 *    fora) e o candidato da busca passa pelo zod.
 * 2. Os testes do MOTOR (motor/tests/test_busca_anime.py, unittest, sem rede):
 *    o nome do arquivo encurtado, a similaridade com limiar, a AniList, o site
 *    do MAL e a Kitsu FALSOS, o cache, a escolha da pessoa e a juncao dos nomes
 *    batizados no banco local com o elenco online. Rodam no Python do runtime
 *    do motor (ou do motor/.venv); sem ele, pulam com aviso.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-busca-elenco.ts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { candidatoDeAnimeSchema, SUGESTOES_MAX, sugestoesDoMotor } from '../shared/descoberta'

// --------------------------------------------------------------- 1. contrato
const muitas = Array.from({ length: 14 }, (_, i) => ({ name: `Nome ${i % 11}`, sim: 1 - i / 100 }))
const lista = sugestoesDoMotor(muitas)
assert.equal(lista.length, SUGESTOES_MAX)
assert.equal(new Set(lista.map((s) => s.nome)).size, lista.length, 'nome repetido fica de fora')
assert.deepEqual(lista[0], { nome: 'Nome 0', similaridade: 1 })
assert.deepEqual(sugestoesDoMotor([{ name: '  ', sim: 0.9 }, { name: 'X', sim: Number.NaN }, { name: 'Elle', sim: 0.93 }]), [
  { nome: 'Elle', similaridade: 0.93 },
])
assert.deepEqual(sugestoesDoMotor(undefined), [])

const cand = candidatoDeAnimeSchema.parse({
  fonte: 'anilist',
  titulo: 'Kashita Maryoku wa [Revo Barai] de Kyousei Choushuu',
  tituloIngles: 'Magic Repo Man',
  anilistId: 202250,
  malId: 62922,
  kitsuId: null,
  ano: 2026,
  formato: 'TV',
  capa: null,
  nota: 0.95,
})
assert.equal(cand.malId, 62922)
assert.throws(() => candidatoDeAnimeSchema.parse({ ...cand, titulo: '' }))
console.log('contrato: ok')

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
if (!py) {
  console.warn('AVISO: sem o Python do motor (runtime ou .venv): os testes do motor (test_busca_anime.py) pularam.')
} else {
  const r = spawnSync(py.cmd, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_busca_anime.py'], {
    cwd: motor,
    encoding: 'utf8',
    env: { ...process.env, ...py.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' },
  })
  const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.status !== 0) {
    console.error(saida)
    assert.fail('os testes do motor (test_busca_anime.py) falharam')
  }
  console.log(`motor: ${/Ran (\d+) tests?/.exec(saida)?.[0] ?? 'ok'}`)
}
console.log('v-busca-elenco: tudo ok')
