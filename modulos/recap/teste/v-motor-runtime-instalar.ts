/**
 * RUNTIME DO MOTOR, de verdade: instala pelo uv (download real), sobe o motor
 * por ele e corta um trecho. Simula o APP INSTALADO: resources/modulos/recap/motor e uma
 * copia do codigo (como o extraResources), o ffprobe vem do compositor do
 * Remotion num app.asar.unpacked falso, e o PATH do processo fica so com o
 * System32 (nada do ffmpeg do Levi).
 *
 * Modos (rodar da raiz, depois de compilar):
 *   (sem compilar: tsx)
 *
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-motor-runtime-instalar.ts cpu <base>
 *     Instalacao CPU completa numa pasta TEMPORARIA (<base>/rt/motor-runtime,
 *     ~320 MB): cancela no meio do torch e continua (retoma do byte certo),
 *     confere o impressao.json e o probe; depois um lock alterado SO nos
 *     pacotes (six 1.17.0 -> 1.16.0) vira 'desatualizado' automatico, o
 *     iniciarMotorRuntime atualiza sozinho e so o six muda; o lock de volta
 *     volta ao 'pronto'. Nada pode ser gravado em resources/modulos/recap/motor.
 *
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-motor-runtime-instalar.ts instalar <base> [cu128|cpu]
 *     So instala, na pasta do runtime efetiva (ANIRECAP_MOTOR_RUNTIME_PASTA ou
 *     a padrao, %LOCALAPPDATA%\AniRecap Studio\motor-runtime). E o que roda
 *     FORA do pacote MSIX do Claude (.cmd pelo explorer) para o cu128 de verdade.
 *
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-motor-runtime-instalar.ts corte <base> <video> [segundos]
 *     Com o runtime ja pronto: probe (GPU) pelo motor.ts e um corte curto sem
 *     personagens de um trecho do video, numa biblioteca temporaria.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { EstadoDoMotorRuntime, LockDoRuntime } from '../shared/motor-runtime'
import { MARGEM_DA_RETOMADA } from '../electron/motor-runtime/baixar'
import type { FimDaAnalise } from '../shared/episodio'
import {
  backendDoRuntime,
  cancelarMotorRuntime,
  configurarMotorRuntime,
  definirAvisoDoMotorRuntime,
  estadoDoMotorRuntime,
  iniciarMotorRuntime,
  instalarMotorRuntime,
} from '../electron/motor-runtime/index'
import { esquecerLock } from '../electron/motor-runtime/lock'
import { caminhosDoRuntime, pastaDoRuntime } from '../electron/motor-runtime/pastas'
import { pacotesInstalados } from '../electron/motor-runtime/protocolo'
import { analisarEpisodio, configurarMotor, encerrarMotor, esquecerSondaDoMotor, statusDoMotor } from '../electron/motor'
import { configureSettings, saveSettings, type Cofre } from '../../../electron/services/settings'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { guardarContexto } from '../electron/contexto'

const raiz = process.cwd()
const [modo = 'cpu', baseArg, ...resto] = process.argv.slice(2)
const base = resolve(baseArg ?? join(process.env['TEMP'] ?? '.', 'v-motor-runtime'))
const versaoDoApp = (JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')) as { version: string }).version

let falhas = 0
function confere(cond: unknown, msg: string): void {
  console.log(`  ${cond ? 'ok  ' : 'FALHA'} ${msg}`)
  if (!cond) falhas += 1
}
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------- o app simulado

const res = join(base, 'res')
const userData = join(base, 'userData')

/** [recap] O codigo do motor no instalado: resources/modulos/recap/motor (o extraResources do Dangai). */
const motorRes = join(res, 'modulos', 'recap', 'motor')

/** resources/ de um app instalado: o codigo do motor (sem .venv, python, cache, models, __pycache__) e o compositor. */
function montarResources(): void {
  const motor = motorRes
  rmSync(motor, { recursive: true, force: true })
  mkdirSync(motor, { recursive: true })
  const fonte = join(raiz, 'modulos', 'recap', 'motor')
  cpSync(join(fonte, 'app'), join(motor, 'app'), {
    recursive: true,
    filter: (p) => !/[\\/]__pycache__([\\/]|$)/.test(p) && !p.endsWith('.pyc'),
  })
  for (const f of ['run.py', 'requirements.txt', 'studio-runtime.json']) cpSync(join(fonte, f), join(motor, f))
  const remotion = join(res, 'app.asar.unpacked', 'node_modules', '@remotion')
  if (!existsSync(join(remotion, 'compositor-win32-x64-msvc'))) {
    mkdirSync(remotion, { recursive: true })
    cpSync(join(raiz, 'node_modules', '@remotion', 'compositor-win32-x64-msvc'), join(remotion, 'compositor-win32-x64-msvc'), { recursive: true })
  }
}

/** O PATH de quem nao tem ffmpeg nem Python: so o Windows. */
function pathLimpo(): void {
  const sr = process.env['SystemRoot'] ?? 'C:\\Windows'
  const chave = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path'
  process.env[chave] = [join(sr, 'System32'), sr, join(sr, 'System32', 'Wbem'), join(sr, 'System32', 'WindowsPowerShell', 'v1.0')].join(';')
}

function configurar(empacotado: boolean): void {
  mkdirSync(userData, { recursive: true })
  configurarMotorRuntime({ userData, appPath: raiz, resourcesPath: res, empacotado, versaoDoApp })
  configurarMotor({ userData, appPath: raiz, empacotado })
  // [recap] O uv NAO vem no instalador do Dangai: a instalacao baixa (fontes.ts).
}

type Foto = Map<string, string>
function fotografar(pasta: string): Foto {
  const foto: Foto = new Map()
  const andar = (dir: string): void => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome)
      const st = statSync(p)
      foto.set(p, `${st.size}|${st.mtimeMs}`)
      if (st.isDirectory()) andar(p)
    }
  }
  andar(pasta)
  return foto
}
function diferencas(a: Foto, b: Foto): string[] {
  const out: string[] = []
  for (const [p, v] of b) if (a.get(p) !== v) out.push(`${a.has(p) ? 'mudou' : 'novo'}: ${p}`)
  for (const p of a.keys()) if (!b.has(p)) out.push(`sumiu: ${p}`)
  return out
}

// ------------------------------------------------------------- andamento

let ultimaLinha = 0
let aoEstado: ((e: EstadoDoMotorRuntime) => void) | null = null
definirAvisoDoMotorRuntime((e) => {
  aoEstado?.(e)
  const a = e.andamento
  if (e.fase !== 'instalando' || !a) return
  if (Date.now() - ultimaLinha < 2000) return
  ultimaLinha = Date.now()
  const gbs = a.baixados !== undefined && a.total ? ` ${(a.baixados / 1e9).toFixed(2)}/${(a.total / 1e9).toFixed(2)} GB` : ''
  const vel = a.bytesPorSegundo ? ` ${(a.bytesPorSegundo / 1e6).toFixed(1)} MB/s` : ''
  console.log(`  [${a.etapa}] ${Math.round((a.fracao ?? 0) * 100)}% ${a.mensagem}${gbs}${vel}`)
})

/** Espera a instalacao deste processo acabar e devolve o estado do fim. */
async function esperarFim(limiteMin = 90): Promise<EstadoDoMotorRuntime> {
  const ate = Date.now() + limiteMin * 60_000
  for (;;) {
    const e = await estadoDoMotorRuntime()
    if (e.fase !== 'instalando') return e
    if (Date.now() > ate) throw new Error('instalacao nao terminou no prazo')
    await esperar(1000)
  }
}

async function instalarAteOFim(variante?: 'cu128' | 'cpu'): Promise<EstadoDoMotorRuntime> {
  const t = Date.now()
  const e0 = await instalarMotorRuntime(variante ? { variante } : {})
  console.log(`  instalando ${e0.variante} em ${e0.pasta} (baixar ${(e0.bytesParaBaixar / 1e6).toFixed(0)} MB, livre ${((e0.livreNoDisco ?? 0) / 1e9).toFixed(0)} GB)`)
  const fim = await esperarFim()
  console.log(`  fim: ${fim.fase} em ${Math.round((Date.now() - t) / 1000)} s${fim.erro ? ` -- ${fim.erro.mensagem} | ${fim.erro.detalhe ?? ''}` : ''}`)
  return fim
}

// ------------------------------------------------------------------ modos

async function modoCpu(): Promise<void> {
  // O caminho do runtime tem limite de 80 letras: o scratchpad e longo demais, a pasta curta vem por env.
  const rt = process.env['ANIRECAP_MOTOR_RUNTIME_PASTA'] ?? join(base, 'rt', 'motor-runtime')
  process.env['ANIRECAP_MOTOR_RUNTIME_PASTA'] = rt
  process.env['ANIRECAP_MOTOR_RUNTIME_VARIANTE'] = 'cpu'
  montarResources()
  pathLimpo()
  configurar(true)
  const fotoRes = fotografar(motorRes)
  const c = caminhosDoRuntime(rt)

  console.log('\n[estado inicial]')
  let e = await estadoDoMotorRuntime()
  console.log(`  ${e.fase}, sugerida ${e.varianteSugerida}, gpu ${e.gpu?.nome} (${e.gpu?.fonte}, driver ${e.gpu?.driver}), baixar ${(e.bytesParaBaixar / 1e6).toFixed(0)} MB`)
  confere(['ausente', 'incompleto', 'pronto'].includes(e.fase), `fase ${e.fase}`)
  confere(/nao esta instalado|nao terminou/.test(('erro' in backendDoRuntime() && (backendDoRuntime() as { erro: string }).erro) || 'x') || e.fase === 'pronto', 'backendDoRuntime recusa antes de instalar')

  if (e.fase !== 'pronto') {
    console.log('\n[instalar e cancelar no meio do torch]')
    let cancelou = false
    let parteNoCancelar = 0
    aoEstado = (s) => {
      const a = s.andamento
      if (!cancelou && s.fase === 'instalando' && a?.etapa === 'baixar-torch' && (a.baixados ?? 0) > 25e6) {
        cancelou = true
        parteNoCancelar = a.baixados ?? 0
        console.log(`  -> cancelar com ${(parteNoCancelar / 1e6).toFixed(0)} MB`)
        void cancelarMotorRuntime()
      }
    }
    await instalarMotorRuntime({ variante: 'cpu' })
    e = await esperarFim()
    aoEstado = null
    confere(cancelou, 'cancelou no meio do download do torch')
    confere(e.fase === 'incompleto', `fase depois de cancelar: ${e.fase}`)
    const gravado = JSON.parse(readFileSync(c.estado, 'utf8')) as { cancelado: boolean; fracao: number; etapa: string }
    confere(gravado.cancelado === true && gravado.etapa === 'baixar-torch', `estado.json cancelado em ${gravado.etapa} (${Math.round(gravado.fracao * 100)}%)`)
    const parte = readdirSync(c.baixando).find((n) => n.endsWith('.whl.part'))
    const tamParte = parte ? statSync(join(c.baixando, parte)).size : 0
    confere(tamParte > 0, `a parte ficou: ${parte} (${(tamParte / 1e6).toFixed(0)} MB)`)
    confere(!existsSync(c.trava), 'trava solta depois do cancelar')
    confere(/nao terminou/.test((backendDoRuntime() as { erro?: string }).erro ?? ''), 'backendDoRuntime: "nao terminou"')

    console.log('\n[continuar]')
    let primeiroBaixados = -1
    aoEstado = (s) => {
      if (primeiroBaixados < 0 && s.andamento?.etapa === 'baixar-torch' && s.andamento.baixados !== undefined) primeiroBaixados = s.andamento.baixados
    }
    e = await instalarAteOFim()
    aoEstado = null
    // A retomada de outra sessao recua MARGEM_DA_RETOMADA do fim do .part (queda de luz), nunca do zero.
    confere(
      primeiroBaixados >= Math.max(0, tamParte - MARGEM_DA_RETOMADA) && primeiroBaixados <= tamParte,
      `retomou de ${(primeiroBaixados / 1e6).toFixed(0)} MB (parte tinha ${(tamParte / 1e6).toFixed(0)}, recuo de ate ${MARGEM_DA_RETOMADA / 1024 / 1024} MiB)`,
    )
  }
  confere(e.fase === 'pronto', `fase ${e.fase}`)
  const imp = JSON.parse(readFileSync(c.impressao, 'utf8')) as Record<string, unknown>
  console.log(`  impressao.json: ${JSON.stringify({ ...imp, pacotes: Object.keys(imp['pacotes'] as object).length })}`)
  confere(imp['variante'] === 'cpu' && imp['cudaOk'] === false, 'impressao: cpu, cudaOk false')
  confere(!existsSync(c.estado) && !existsSync(c.baixando) && !existsSync(c.trava), 'sem estado.json, baixando/ e trava no fim')
  confere(typeof imp['bytesNoDisco'] === 'number', `no disco: ${((imp['bytesNoDisco'] as number) / 1e9).toFixed(2)} GB`)
  const instalados = pacotesInstalados(c.sitePackages)
  confere(!instalados.has('pyside6') && !instalados.has('shiboken6'), 'sem o Qt no runtime')
  confere(instalados.get('torch') === '2.11.0+cpu', `torch ${instalados.get('torch')}`)
  const pyc = readdirSync(join(c.sitePackages, 'torch', '__pycache__')).length
  confere(pyc > 0, `site-packages compilado (${pyc} .pyc em torch/__pycache__)`)

  console.log('\n[motor pelo runtime: probe]')
  esquecerSondaDoMotor()
  const st = await statusDoMotor()
  console.log(`  ${JSON.stringify(st.studio)}`)
  confere(st.studio.pronto, 'statusDoMotor pronto pelo runtime (ffmpeg achado sem o PATH do Levi)')

  console.log('\n[atualizacao do app que muda so um pacote]')
  const lockArq = join(motorRes, 'studio-runtime.json')
  const original = readFileSync(lockArq, 'utf8')
  const lock = JSON.parse(original) as LockDoRuntime
  const six = lock.pacotes.find((p) => p.nome === 'six')!
  const pypi = (await (await fetch('https://pypi.org/pypi/six/1.16.0/json')).json()) as { urls: { digests: { sha256: string }; size: number; packagetype: string }[] }
  six.versao = '1.16.0'
  six.hashes = pypi.urls.map((u) => u.digests.sha256)
  six.bytes = pypi.urls.find((u) => u.packagetype === 'bdist_wheel')?.size ?? 11000
  writeFileSync(lockArq, JSON.stringify(lock, null, 2))
  esquecerLock()
  e = await estadoDoMotorRuntime()
  console.log(`  ${e.fase}: ${JSON.stringify(e.mudancas)}`)
  confere(e.fase === 'desatualizado' && e.mudancas?.automatica === true, 'desatualizado e automatica')
  confere(JSON.stringify(e.mudancas?.pacotes) === JSON.stringify(['six 1.17.0 -> 1.16.0']), 'so o six muda')
  confere(/precisa de uma atualizacao/.test((backendDoRuntime() as { erro?: string }).erro ?? ''), 'o motor nao sobe desatualizado')
  const antes = pacotesInstalados(c.sitePackages)
  const tamLog = statSync(c.log).size
  iniciarMotorRuntime()
  console.log('  iniciarMotorRuntime: espera 10 s e atualiza sozinho')
  await esperar(11_000)
  e = await esperarFim()
  confere(e.fase === 'pronto', `fase ${e.fase}`)
  confere(e.aviso === 'Motor atualizado: 1 pacote', `aviso: ${e.aviso}`)
  const depois = pacotesInstalados(c.sitePackages)
  const mudou = [...new Set([...antes.keys(), ...depois.keys()])].filter((n) => antes.get(n) !== depois.get(n))
  confere(JSON.stringify(mudou) === '["six"]' && depois.get('six') === '1.16.0', `mudou so: ${mudou.join(', ')} (six ${depois.get('six')})`)
  const logNovo = readFileSync(c.log, 'utf8').slice(tamLog)
  confere(!/baixar-torch: Baixando/.test(logNovo) && !/python install/.test(logNovo), 'nao baixou torch nem Python de novo')

  console.log('\n[lock de volta]')
  writeFileSync(lockArq, original)
  esquecerLock()
  e = await estadoDoMotorRuntime()
  confere(e.fase === 'desatualizado', `fase ${e.fase}`)
  e = await instalarAteOFim()
  confere(e.fase === 'pronto' && pacotesInstalados(c.sitePackages).get('six') === '1.17.0', 'six 1.17.0 de volta, pronto')

  console.log('\n[resources/modulos/recap/motor intocado]')
  // O proprio teste reescreveu o studio-runtime.json (a atualizacao simulada): o resto nao pode mudar.
  const dif = diferencas(fotoRes, fotografar(motorRes)).filter((l) => !l.endsWith('studio-runtime.json'))
  confere(dif.length === 0, dif.length ? dif.slice(0, 8).join('\n        ') : 'nada novo nem mudado em resources/modulos/recap/motor')
}

async function modoInstalar(): Promise<void> {
  const variante = (resto[0] as 'cu128' | 'cpu' | undefined) ?? undefined
  // O codigo do motor do repositorio (como o dev), runtime ligado no dev.
  process.env['ANIRECAP_MOTOR_RUNTIME'] = '1'
  configurar(false)
  console.log(`[instalar] pasta ${pastaDoRuntime().pasta}`)
  let e = await estadoDoMotorRuntime()
  console.log(`  ${e.fase}, sugerida ${e.varianteSugerida}, gpu ${e.gpu?.nome} (driver ${e.gpu?.driver}), baixar ${(e.bytesParaBaixar / 1e9).toFixed(2)} GB, livre ${((e.livreNoDisco ?? 0) / 1e9).toFixed(0)} GB`)
  if (e.fase === 'pronto' && !variante) {
    console.log('  ja pronto')
    return
  }
  // Mede o pico de disco: o livre a cada 2 s.
  let menorLivre = e.livreNoDisco ?? 0
  const livre0 = menorLivre
  aoEstado = (s) => {
    if (s.livreNoDisco !== null) menorLivre = Math.min(menorLivre, s.livreNoDisco)
  }
  e = await instalarAteOFim(variante)
  aoEstado = null
  const c = caminhosDoRuntime(pastaDoRuntime().pasta)
  console.log(`  pico de disco ~${((livre0 - menorLivre) / 1e9).toFixed(2)} GB; impressao: ${existsSync(c.impressao) ? readFileSync(c.impressao, 'utf8') : '-'}`)
  confere(e.fase === 'pronto', `fase ${e.fase}`)
}

async function modoCorte(): Promise<void> {
  const [video, segundos = '120'] = resto
  if (!video || !existsSync(video)) throw new Error(`video? ${video}`)
  montarResources()
  const fotoRes = fotografar(motorRes)
  const c = caminhosDoRuntime(pastaDoRuntime().pasta)
  const fotoRt = existsSync(c.venv) ? fotografar(c.venv) : new Map()
  // Trecho curto (com o ffmpeg do sistema, ANTES de limpar o PATH: e so ferramenta do teste).
  const trecho = join(base, 'trecho', 'Dr. Stone S04E24.mkv')
  if (!existsSync(trecho)) {
    mkdirSync(join(base, 'trecho'), { recursive: true })
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '300', '-t', segundos, '-i', video, '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', trecho])
  }
  pathLimpo()
  configurar(true)
  const biblioteca = join(base, 'Biblioteca')
  rmSync(biblioteca, { recursive: true, force: true })
  const cofre: Cofre = {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  }
  configureSettings(userData, cofre)
  saveSettings({ libraryDir: '' })
  // [recap] A biblioteca do recap vem da configuracao do modulo (o ctx do nucleo).
  guardarContexto({
    id: 'recap',
    empacotado: false,
    config: () => ({ libraryDir: '', iaProvedor: 'gemini', whisperModel: 'small', modulo: { biblioteca } }),
    ligado: () => true,
    pasta: (tipo: string) => (tipo === 'dados' ? userData : base),
  } as unknown as ContextoDoModulo)

  console.log(`\n[probe pelo runtime ${pastaDoRuntime().pasta}]`)
  const b = backendDoRuntime()
  console.log(`  backend: ${JSON.stringify(b)}`)
  const t0 = Date.now()
  const st = await statusDoMotor()
  console.log(`  ${JSON.stringify(st.studio)} (${Date.now() - t0} ms)`)
  confere(st.studio.pronto, 'motor pronto pelo runtime')
  confere(/RTX|NVIDIA|GeForce/i.test(st.studio.gpu ?? ''), `GPU: ${st.studio.gpu}`)

  console.log(`\n[corte de ${segundos} s, sem personagens]`)
  const t = Date.now()
  let ultima = ''
  const fim = await new Promise<FimDaAnalise>((resolver, rejeitar) => {
    analisarEpisodio(
      { path: trecho, anime: 'Dr. Stone', temporada: 4, episodio: 24, kind: '', motor: 'studio', reconhecer: false },
      {
        progresso: (p) => {
          const linha = `${p.etapa} ${p.fracao === null ? '' : `${Math.round(p.fracao * 100)}%`} ${p.mensagem}`
          if (linha !== ultima) console.log(`  ${linha}`)
          ultima = linha
        },
        fim: resolver,
      },
    ).catch(rejeitar)
  })
  console.log(`  fim: ${JSON.stringify(fim)} (${Math.round((Date.now() - t) / 1000)} s)`)
  confere(fim.ok, 'corte ok')
  if (fim.ok) {
    const shots = join(fim.pastaDoEpisodio, 'shots')
    const n = existsSync(shots) ? readdirSync(shots).filter((f) => f.endsWith('.mp4')).length : 0
    confere(n > 0 && n === fim.totalCenas, `${n} clipes em shots/ (${fim.totalCenas} cenas)`)
    const log = join(userData, 'motor', 'logs', 'ultima-analise.log')
    if (existsSync(log)) {
      const texto = readFileSync(log, 'utf8')
      const enc = /h264_nvenc|libx264/.exec(texto)?.[0]
      console.log(`  encoder no log: ${enc ?? '?'}`)
    }
  }
  encerrarMotor()
  await esperar(1500)
  const dif = diferencas(fotoRes, fotografar(motorRes))
  confere(dif.length === 0, dif.length ? dif.slice(0, 8).join('\n        ') : 'nada gravado em resources/modulos/recap/motor')
  if (fotoRt.size) {
    const difRt = diferencas(fotoRt, fotografar(c.venv)).filter((l) => !/[\\/]__pycache__[\\/]/.test(l) || l.startsWith('novo'))
    confere(difRt.length === 0, difRt.length ? `venv mudou: ${difRt.slice(0, 5).join(' | ')}` : 'nada gravado no venv do runtime')
  }
}

async function main(): Promise<void> {
  try {
    if (modo === 'cpu') await modoCpu()
    else if (modo === 'instalar') await modoInstalar()
    else if (modo === 'corte') await modoCorte()
    else throw new Error(`modo? ${modo}`)
  } catch (e) {
    falhas += 1
    console.error(e)
  } finally {
    encerrarMotor()
  }
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK')
  process.exit(falhas ? 1 : 0)
}

void main()
