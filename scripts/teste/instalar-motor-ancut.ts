/**
 * O MOTOR DE CORTES DO DANGAI, de verdade (manual, fora do `npm test`: baixa
 * da internet). Simula o app instalado -- o codigo do motor copiado para um
 * resources/motor/ancut falso -- instala o Python numa pasta de rascunho, sobe
 * o motor por ele (como o motor.ts faz) e corta um video:
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/teste/instalar-motor-ancut.ts <base> <video> [cpu|cu128]
 *
 * Tudo fica em <base>: o runtime (DANGAI_ANCUT_RUNTIME_PASTA), os dados do
 * motor (DANGAI_ANCUT_DADOS: config, index.db, logs) e a saida do corte. Nada
 * encosta no acervo nem no %LOCALAPPDATA% de verdade. A versao `cpu` baixa
 * ~330 MB; a `cu128`, ~3 GB.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const raiz = process.cwd()
const [baseArg, videoArg, varianteArg = 'cpu'] = process.argv.slice(2)
if (!baseArg || !videoArg) {
  console.error('uso: instalar-motor-ancut.ts <base> <video> [cpu|cu128]')
  process.exit(2)
}
const base = resolve(baseArg)
const video = resolve(videoArg)
const variante = varianteArg === 'cu128' ? 'cu128' : 'cpu'
process.env['DANGAI_ANCUT_RUNTIME_PASTA'] = join(base, 'rt', 'motor-runtime')
process.env['DANGAI_ANCUT_DADOS'] = join(base, 'dados')
process.env['DANGAI_ANCUT_SAIDA'] = join(base, 'saida')
delete process.env['DANGAI_ANCUT_MOTOR']
delete process.env['ANCUT_BACKEND']

let falhas = 0
const confere = (cond: unknown, msg: string): void => {
  console.log(`  ${cond ? 'ok   ' : 'FALHA'} ${msg}`)
  if (!cond) falhas++
}
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  // O app instalado: resources/motor/ancut e uma copia do codigo (o extraResources).
  const res = join(base, 'res')
  const codigo = join(res, 'motor', 'ancut')
  rmSync(codigo, { recursive: true, force: true })
  mkdirSync(codigo, { recursive: true })
  cpSync(join(raiz, 'motor', 'ancut'), codigo, { recursive: true, filter: (p) => !/__pycache__/.test(p) })
  mkdirSync(join(base, 'dados'), { recursive: true })
  mkdirSync(join(base, 'saida'), { recursive: true })

  const runtime = await import('../../electron/services/ancut/runtime/index')
  const motor = await import('../../electron/services/ancut/motor')
  const versaoDoApp = (JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')) as { version: string }).version
  runtime.configurarMotorRuntime({ userData: join(base, 'userData'), appPath: raiz, resourcesPath: res, empacotado: true, versaoDoApp })

  let e = await runtime.estadoDoMotorRuntime()
  console.log(`fase ${e.fase}, placa ${e.gpu?.nome ?? '-'}, falta baixar ${(e.bytesParaBaixar / 1e6).toFixed(0)} MB, pasta ${e.pasta}`)
  if (e.fase !== 'pronto') {
    const t0 = Date.now()
    await runtime.instalarMotorRuntime({ variante })
    let ultimo = ''
    for (;;) {
      await esperar(1000)
      e = await runtime.estadoDoMotorRuntime()
      const a = e.andamento
      const linha = `${e.fase} ${a?.etapa ?? ''} ${a?.fracao !== null && a?.fracao !== undefined ? Math.round(a.fracao * 100) + '%' : ''} ${a?.mensagem ?? ''}`
      if (linha !== ultimo) console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${linha}`)
      ultimo = linha
      if (e.fase !== 'instalando') break
    }
    console.log(`instalacao: ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    if (e.erro) console.log('  erro:', e.erro.mensagem, '\n', e.erro.detalhe ?? '')
  }
  confere(e.fase === 'pronto', `o motor ficou pronto (fase ${e.fase})`)
  if (e.fase !== 'pronto') return

  motor.esquecerMotor()
  const achado = await motor.localizarMotor()
  confere(achado?.qual === 'dangai', `o motor.ts acha o do Dangai (${achado?.origem ?? 'nenhum'})`)
  const estado = await motor.estadoDoMotor()
  confere(estado.achado && !!estado.versao, `probe: versao ${estado.versao}, placa ${estado.placa ?? 'CPU'}`)

  const nome = await motor.lerNome(video)
  confere(!!nome?.anime, `lerNome: ${JSON.stringify(nome)}`)

  const t1 = Date.now()
  const fim = await motor.cortar(
    { video, anime: 'Teste do Motor', temporada: 1, episodio: 1, tipo: '', modo: 'cortar' },
    (ev) => {
      if (ev.tipo === 'etapa') console.log(`    ${ev.rotulo} ${ev.fracao >= 0 ? Math.round(ev.fracao * 100) + '%' : ''} ${ev.mensagem}`)
    },
  )
  confere(fim.tipo === 'pronto', `corte: ${JSON.stringify(fim).slice(0, 300)} em ${((Date.now() - t1) / 1000).toFixed(1)} s`)
  if (fim.tipo === 'pronto') {
    const shots = join(fim.pasta, 'shots')
    const n = existsSync(shots) ? readdirSync(shots).filter((f) => f.endsWith('.mp4')).length : 0
    confere(n > 0 && n === fim.cenas, `${n} clipes em ${shots}`)
    confere(existsSync(join(base, 'dados', 'cache', 'index.db')), 'o banco ficou na pasta de teste (nada no acervo real)')
  }
}

main()
  .catch((e) => {
    console.error(e)
    falhas++
  })
  .finally(() => {
    console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo ok')
    process.exit(falhas ? 1 : 0)
  })
