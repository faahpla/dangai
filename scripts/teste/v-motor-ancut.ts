/**
 * O MOTOR DE CORTES DO DANGAI (23/11): o que vai no instalador e o que o
 * Dangai passa para o motor. `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-motor-ancut.ts`.
 *
 * "Quero tudo funcionando aqui no Dangai, deixa como opcao baixar esse motor,
 * igual funciona no modulo recap": o codigo do motor do AnCut vai junto do
 * Dangai (motor/ancut) e o Python dele e baixado pela tela. Uma lista torta ou
 * um codigo faltando so apareceria quando alguem clicasse em "Baixar o motor"
 * -- este teste para a versao antes:
 *
 * - a lista do Python (ancut-runtime.json) le no MESMO leitor do app, com o
 *   Python oficial, o uv, o torch das duas variantes e as bibliotecas que o
 *   motor importa; sem o Qt e sem o empacotador;
 * - o codigo do motor esta la (o app.headless), sem a interface Qt, e e o
 *   ancut-hub-engine que sabe rodar com os dados do AnCut (ANCUT_COMO_INSTALADO,
 *   ANCUT_DADOS, ANCUT_SEM_CUDA);
 * - o instalador do Dangai leva a pasta (electron-builder.yml);
 * - os dados: sem teste, os do AnCut instalado; com DANGAI_ANCUT_DADOS, so a
 *   pasta de teste (o banco tambem).
 *
 * Nada baixa e nada roda o motor.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { impressaoDoLock, lerLock, requisitosDoLock } from '../../electron/services/ancut/runtime/lock.ts'
import { ambienteDosDados, caminhoDoLock, configurarMotorRuntime, dadosDeTeste, pastaDoCodigoDoMotor, pastaPadraoDoRuntime } from '../../electron/services/ancut/runtime/pastas.ts'
import { bancoDoAncut } from '../../electron/services/mesclar.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const raiz = process.cwd()
const motor = join(raiz, 'motor', 'ancut')

console.log('a lista do Python')
let lock: ReturnType<typeof lerLock> | null = null
try {
  lock = lerLock(join(motor, 'ancut-runtime.json'))
} catch (e) {
  ok('o leitor do app aceita a lista', false, e instanceof Error ? e.message : String(e))
}
if (lock) {
  ok('o leitor do app aceita a lista', true)
  ok('Python 3.12 oficial (o mesmo do recap)', /^3\.12\.\d+$/.test(lock.python) && lock.pythonOficial.assinante === 'Python Software Foundation')
  ok('torch das duas variantes', lock.torch.cu128.some((r) => r.nome === 'torch' && r.versao.endsWith('+cu128')) && lock.torch.cpu.some((r) => r.nome === 'torch' && r.versao.endsWith('+cpu')))
  const nomes = new Set(lock.pacotes.map((p) => p.nome))
  const precisa = ['open-clip-torch', 'ultralytics', 'onnxruntime', 'scenedetect', 'opencv-python', 'httpx', 'platformdirs', 'huggingface-hub', 'numpy', 'pillow']
  const faltam = precisa.filter((n) => !nomes.has(n))
  ok('as bibliotecas que o motor importa', faltam.length === 0, faltam.join(', '))
  const fora = ['pyside6', 'pyside6-essentials', 'shiboken6', 'pyinstaller', 'pip'].filter((n) => nomes.has(n))
  ok('sem o Qt e sem o empacotador', fora.length === 0, fora.join(', '))
  ok('cada biblioteca com o codigo de conferencia', lock.pacotes.every((p) => p.hashes.every((h) => /^[0-9a-f]{64}$/.test(h))))
  const req = requisitosDoLock(lock)
  ok('o requirements tem todas, com --hash', lock.pacotes.every((p) => req.includes(`${p.nome}==${p.versao}`)) && req.includes('--hash=sha256:'))
  ok('a impressao muda com a variante', impressaoDoLock(lock, 'cu128') !== impressaoDoLock(lock, 'cpu'))
}

console.log('o codigo do motor')
ok('o app.headless esta la', existsSync(join(motor, 'app', 'headless.py')) && existsSync(join(motor, 'app', 'pipeline.py')))
ok('sem a interface Qt', !existsSync(join(motor, 'app', 'ui')) && !existsSync(join(motor, 'app', 'main.py')))
let origem: { commit?: string; versao?: string } = {}
try {
  origem = JSON.parse(readFileSync(join(motor, 'origem.json'), 'utf8')) as typeof origem
} catch {
  /* sem origem */
}
ok('diz de onde veio (commit e versao)', /^[0-9a-f]{40}$/.test(origem.commit ?? '') && !!origem.versao, `${origem.versao ?? '?'} ${origem.commit?.slice(0, 7) ?? '?'}`)
const config = readFileSync(join(motor, 'app', 'config.py'), 'utf8')
ok('o motor roda com os dados do AnCut (ANCUT_COMO_INSTALADO, ANCUT_DADOS)', config.includes('ANCUT_COMO_INSTALADO') && config.includes('ANCUT_DADOS'))
ok('o motor sabe ir pela CPU (ANCUT_SEM_CUDA)', config.includes('ANCUT_SEM_CUDA'))
const builder = readFileSync(join(raiz, 'electron-builder.yml'), 'utf8')
ok('o instalador do Dangai leva a pasta', /from:\s*motor\/ancut\s*\n\s*to:\s*motor\/ancut/.test(builder))

console.log('as pastas e os dados')
const tmp = mkdtempSync(join(tmpdir(), 'dangai-motor-ancut-'))
try {
  configurarMotorRuntime({ userData: join(tmp, 'ud'), appPath: raiz, resourcesPath: join(tmp, 'res'), empacotado: true, versaoDoApp: '0.0.0' })
  ok('instalado: o codigo em resources/motor/ancut', pastaDoCodigoDoMotor() === join(tmp, 'res', 'motor', 'ancut') && caminhoDoLock().endsWith(join('motor', 'ancut', 'ancut-runtime.json')))
  configurarMotorRuntime({ userData: join(tmp, 'ud'), appPath: raiz, resourcesPath: join(tmp, 'res'), empacotado: false, versaoDoApp: '0.0.0' })
  ok('dev: o codigo do repositorio', pastaDoCodigoDoMotor() === motor)
  ok('o Python fica em %LOCALAPPDATA%\\Dangai\\ancut (nao no do recap)', /[\\/]Dangai[\\/]ancut[\\/]motor-runtime$/.test(pastaPadraoDoRuntime()))
  const antes = process.env['DANGAI_ANCUT_DADOS']
  delete process.env['DANGAI_ANCUT_DADOS']
  ok('sem teste: os dados do AnCut instalado', dadosDeTeste() === null && ambienteDosDados()['ANCUT_COMO_INSTALADO'] === '1' && !('ANCUT_DADOS' in ambienteDosDados()))
  const dados = join(tmp, 'dados')
  process.env['DANGAI_ANCUT_DADOS'] = dados
  ok('com teste: so a pasta de teste', ambienteDosDados()['ANCUT_DADOS'] === dados && !('ANCUT_COMO_INSTALADO' in ambienteDosDados()))
  ok('com teste e sem banco ainda: nenhum banco (nunca o de verdade)', bancoDoAncut() === null)
  mkdirSync(join(dados, 'cache'), { recursive: true })
  writeFileSync(join(dados, 'cache', 'index.db'), '')
  ok('com teste: o banco da pasta de teste', bancoDoAncut() === join(dados, 'cache', 'index.db'))
  if (antes === undefined) delete process.env['DANGAI_ANCUT_DADOS']
  else process.env['DANGAI_ANCUT_DADOS'] = antes
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo ok')
process.exit(falhas ? 1 : 0)
