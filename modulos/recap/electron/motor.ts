import { spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import {
  etapaDoEstagio,
  kindDoEpisodioSchema,
  type FimDaAnalise,
  type Motor,
  type PalpiteDoEpisodio,
  type PedidoDeAnalise,
  type ProgressoDaAnalise,
  type StatusDoMotor,
} from '../shared/episodio'
import { ORIGEM_DO_BATISMO, origemDeUmaArte, type ComandoCommitDiscovery } from '../shared/descoberta'
import { soUmaArte } from './descoberta/arte-unica'
import { dependeDoBatismo } from './descoberta/refs'
import { desarmarCorteDeOutroArquivo, pastaLembradaPeloMotor } from './episodio/corte-de-outro-arquivo'
import { impressaoLembrada } from './episodio/impressao'
import { garantirGravavel, saidaDoCorteCenas } from './episodio/protegidas'
import { porDeLadoElencoDegradado } from './elenco-degradado'
import { fotosDoElenco, idDaPastaDeRefs, reservarElenco, type ReservaDoElenco } from './elenco-reserva'
import { ffmpegPath } from './ffmpeg-path'
import { ascii, fraseDoErroDoMotor, fraseDoMotor } from './frase-do-motor'
import { pastaDaBibliotecaStudio, pastaDeDocumentos } from './settings'
import { pythonDoMotor } from './python-do-motor'
import { ambienteDoRuntime, backendDoRuntime, usaRuntime } from './motor-runtime'

/**
 * O MOTOR: corta o episodio em cenas e reconhece os personagens pelo rosto,
 * com o mesmo codigo do AnCut (motor/, copia do ancut-hub-engine).
 *
 * [recap] Portado do Studio na parte 4. O codigo do motor mora em
 * modulos/recap/motor (no instalado, resources/modulos/recap/motor); o Python
 * e o runtime instalado pela tela do modulo (motor-runtime/) ou, no dev, o
 * modulos/recap/motor/.venv. Os dados do motor (config, index.db, fotos do
 * elenco, logs) ficam em <dados do modulo>/motor -- nunca nos do Studio nem
 * nos do Corte Cenas.
 *
 * O Studio continua em TypeScript. So o corte e o reconhecimento rodam num
 * processo Python separado, falando JSON-lines (motor/app/headless.py, modo
 * `run`, com `cutOnly` quando nao e para reconhecer).
 *
 * Duas formas, mesmo resultado:
 * - 'studio': motor/.venv/Scripts/python.exe -m app.headless, com cwd motor/,
 *   gravando na biblioteca do Studio (pastaDaBibliotecaStudio, depois de
 *   garantirGravavel) e com pasta de dados, banco e config PROPRIOS -- nunca
 *   %LOCALAPPDATA%\CorteCenas. O host passa ANIRECAP_MOTOR_DADOS e o
 *   motor/app/config.py ja nao usa o APP_NAME 'CorteCenas' (motor/STUDIO.md).
 * - 'ancut': o CorteCenas.exe --headless do AnCut HUB instalado, com outputDir
 *   = a saida dele (saidaDoCorteCenas). Quem grava e o motor do AnCut, que e a
 *   escolha do usuario; o Studio so le depois.
 *
 * O desenho segue o python-service.ts do AnCut HUB, com as armadilhas de
 * Windows que ele ja pagou para descobrir (ver os comentarios abaixo).
 */

export interface ConfigDoMotor {
  /** [recap] A pasta de dados do modulo (<userData>/modulos/recap). Base da pasta de dados do motor. */
  userData: string
  /** app.getAppPath(): em dev, a raiz do repositorio (onde mora modulos/recap/motor/). */
  appPath: string
  /**
   * app.isPackaged. No app instalado o motor roda no RUNTIME baixado no 1o uso
   * (electron/services/motor-runtime/), com o codigo em resources/motor.
   */
  empacotado: boolean
}

let config: ConfigDoMotor | null = null

/** Chamada no `configurar` do modulo (electron/index.ts). */
export function configurarMotor(c: ConfigDoMotor): void {
  config = c
}

/** A configuracao do main. Lanca antes do configurarMotor. */
export function configDoMotor(): ConfigDoMotor {
  if (!config) throw new Error('Motor nao configurado')
  return config
}

/** Para onde o motor manda andamento e fim de um job. O ipc.ts liga isto aos canais. */
export interface OuvintesDaAnalise {
  progresso(progresso: ProgressoDaAnalise): void
  fim(fim: FimDaAnalise): void
  /**
   * Reconhecer na mao (electron/services/descoberta/): o `discovery-ready`
   * cru. O processo fica VIVO esperando os nomes (comandarDescoberta), sem o
   * relogio de 30 s. Sem este ouvinte o evento e dispensado como antes.
   */
  descobertaPronta?(evento: Record<string, unknown>): void
  /** O `result` cru do `done`, antes do fim (a descoberta le o `refsDir`). */
  resultadoDoMotor?(resultado: Record<string, unknown>): void
}

// ------------------------------------------------------------------ onde mora

/**
 * Config, cache (index.db, refs do elenco), modelos e logs do motor do Studio.
 *
 * Vai para o motor pela env ANIRECAP_MOTOR_DADOS. E o que separa o Studio do
 * Corte Cenas e do AnCut: os dois dividem %LOCALAPPDATA%\CorteCenas, e um
 * index.db misturado nao tem volta.
 */
export function pastaDeDadosDoMotor(): string {
  return join(configDoMotor().userData, 'motor')
}

/** Como subir um motor: executavel, argumentos antes do modo e cwd. */
interface Backend {
  cmd: string
  args: string[]
  cwd: string
  /** Variaveis a mais para o processo (o __PYVENV_LAUNCHER__ do motor do Studio). */
  env?: Record<string, string>
  /** O motor do Studio no runtime do app instalado: o ambiente vem do ambienteDoRuntime. */
  runtime?: { cudaOk: boolean; modelos: string }
}

/**
 * O motor do Studio, ou o motivo de nao haver um (texto para a tela).
 *
 * Em dev e o venv de motor/ rodando o modulo direto (mexer no Python vale na
 * hora). O venv e PROPRIO, nunca o do Corte Cenas: o torch dele e o cu128 que
 * roda na RTX 5080.
 */
function backendDoStudio(): Backend | { erro: string } {
  const c = configDoMotor()
  if (usaRuntime()) {
    // App instalado (ou o dev sem o .venv): o Python + torch que a tela do
    // modulo instalou no 1o uso em %LOCALAPPDATA%/Dangai/recap/motor-runtime
    // (o GitHub limita a 2 GB por arquivo de release; o torch cu128 sozinho
    // tem 2,7). O erro e a frase da tela ("nao esta instalado", "esta sendo
    // instalado", "precisa de uma atualizacao"...): o resumoDoMotor reconhece.
    const r = backendDoRuntime()
    if ('erro' in r) return { erro: r.erro }
    const { cmd, env } = pythonDoMotor(r.python)
    return { cmd, args: ['-m', 'app.headless'], cwd: r.cwd, env, runtime: { cudaOk: r.cudaOk, modelos: r.modelos } }
  }
  // [recap] O venv de dev do modulo: modulos/recap/motor/.venv (fora do git).
  const pasta = join(c.appPath, 'modulos', 'recap', 'motor')
  const python =
    process.platform === 'win32'
      ? join(pasta, '.venv', 'Scripts', 'python.exe')
      : join(pasta, '.venv', 'bin', 'python')
  if (!existsSync(python)) {
    return { erro: `O motor de personagens nao esta instalado: falta o Python dele em ${python}.` }
  }
  // Direto no Python base, sem o lancador do venv (python-do-motor.ts).
  const { cmd, env } = pythonDoMotor(python)
  return { cmd, args: ['-m', 'app.headless'], cwd: pasta, env }
}

/**
 * O CorteCenas.exe do AnCut HUB instalado, ou null.
 *
 * Os mesmos lugares do resolveBackend do AnCut HUB: ANCUT_BACKEND, o
 * instalador unico (motor em engine\, ao lado da interface) e o instalador do
 * motor (exe direto na pasta), em Program Files ou por usuario.
 *
 * De fora DE PROPOSITO: a pasta "CorteCenas" que o AnCut HUB tambem aceita.
 * E onde instala o Corte Cenas ORIGINAL do Levi, que nao tem o modo
 * --headless -- chamar o exe dele com a flag abriria a janela Qt dele em vez
 * de analisar.
 */
export function acharAnCut(): string | null {
  const override = process.env['ANCUT_BACKEND']
  if (override && existsSync(override)) return override
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const porUsuario = join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Programs')
  for (const base of [join(programFiles, 'AnCut HUB'), join(porUsuario, 'AnCut HUB')]) {
    for (const exe of [join(base, 'engine', 'CorteCenas.exe'), join(base, 'CorteCenas.exe')]) {
      if (existsSync(exe)) return exe
    }
  }
  return null
}

function backendDoAnCut(): Backend | { erro: string } {
  const exe = acharAnCut()
  if (!exe) return { erro: 'O AnCut HUB nao esta instalado neste computador.' }
  return { cmd: exe, args: ['--headless'], cwd: dirname(exe) }
}

/**
 * Ambiente dos processos do motor.
 *
 * - PYTHONIOENCODING: sem ele o Python abre a saida em cp1252 e todo acento
 *   do log chega quebrado (a licao do AnCut HUB). O canal de eventos ja vai em
 *   ASCII puro, mas o stderr nao.
 * - YOLO_AUTOINSTALL: o run.py do exe liga isto antes de tudo; rodando o
 *   modulo direto (dev) o run.py nao entra, e a ultralytics tentaria um
 *   `pip install` sozinha no meio da analise.
 * - PATH: o ffmpeg do sistema primeiro (ele tem ffprobe e NVENC); o
 *   ffmpeg-static do app no FIM, so de reserva. O motor acha o ffmpeg pelo
 *   PATH (motor/app/ffmpeg_locate.py) quando nao ha motor/bin/.
 * - ANIRECAP_MOTOR_DADOS: so no motor do Studio. O do AnCut usa a pasta dele,
 *   que e a escolha do usuario quando ele pede "Analisar com o AnCut".
 * - Motor no runtime (app instalado): o ambienteDoRuntime por cima -- o
 *   ffmpeg do APP primeiro e o ffprobe do Remotion no fim (nada do PATH de
 *   quem instalou decide o corte), Python isolado e PYTHONDONTWRITEBYTECODE
 *   (o codigo fica na pasta de instalacao, onde nada pode ser gravado).
 */
function ambiente(motor: Motor, backend?: Backend): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', YOLO_AUTOINSTALL: 'false' }
  if (motor === 'studio') env['ANIRECAP_MOTOR_DADOS'] = pastaDeDadosDoMotor()
  else delete env['ANIRECAP_MOTOR_DADOS']
  if (motor === 'studio' && backend?.runtime) return ambienteDoRuntime(env, backend.runtime)
  // No Windows a chave e 'Path'. Criar 'PATH' ao lado deixaria duas, e qual
  // vale fica por conta da ordem.
  const chave = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  env[chave] = [env[chave], dirname(ffmpegPath)].filter(Boolean).join(delimiter)
  return env
}

// ------------------------------------------------------------- utilidades

/**
 * Le um stream de JSON-lines respeitando fronteira de linha.
 *
 * O chunk do pipe NAO e uma linha: vem cortado no meio de um objeto ou com
 * tres de uma vez. Sem o buffer o JSON.parse quebra justo nos eventos longos.
 */
class LeitorDeLinhas {
  private resto = ''

  constructor(private readonly aoLer: (linha: string) => void) {}

  push(pedaco: string): void {
    this.resto += pedaco
    let i = this.resto.indexOf('\n')
    while (i >= 0) {
      const linha = this.resto.slice(0, i).trim()
      this.resto = this.resto.slice(i + 1)
      if (linha) this.aoLer(linha)
      i = this.resto.indexOf('\n')
    }
  }

  flush(): void {
    const linha = this.resto.trim()
    this.resto = ''
    if (linha) this.aoLer(linha)
  }
}

type Evento = Record<string, unknown> & { type?: unknown }

function lerEvento(linha: string): Evento | null {
  try {
    const cru: unknown = JSON.parse(linha)
    return cru && typeof cru === 'object' && !Array.isArray(cru) ? (cru as Evento) : null
  } catch {
    return null
  }
}

/**
 * Mata o processo e os filhos dele (o ffmpeg que o motor sobe por cena).
 *
 * No Windows o child.kill() so derruba o python; o ffmpeg continuaria
 * gravando um mp4 pela metade e segurando o arquivo. taskkill /T leva a
 * arvore. `sincrono` e para a saida do app, quando nao ha depois.
 */
function matarArvore(filho: ChildProcess, sincrono = false): void {
  const pid = filho.pid
  if (!pid || filho.exitCode !== null || filho.signalCode !== null) return
  if (process.platform !== 'win32') {
    filho.kill('SIGKILL')
    return
  }
  const args = ['/PID', String(pid), '/T', '/F']
  if (sincrono) {
    spawnSync('taskkill', args, { windowsHide: true, timeout: 5000, stdio: 'ignore' })
  } else {
    spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => {
      filho.kill()
    })
  }
}

/** As ultimas linhas do stderr, para explicar uma morte sem evento final. */
function cauda(linhas: string[]): string {
  // O traceback do Python termina na linha que importa; as 6 ultimas bastam
  // para a tela, o resto fica no log.
  return ascii(linhas.slice(-6).join(' | ')).slice(0, 600)
}

// ------------------------------------------------------- consultas curtas

/** Processos curtos vivos (probe, parse), para o encerrarMotor nao deixar orfao. */
const curtos = new Set<ChildProcess>()

interface SaidaCurta {
  eventos: Evento[]
  stderr: string[]
  /** Por que nao houve resposta: spawn falhou ou o tempo estourou. null = saiu sozinho. */
  falha: string | null
}

/**
 * Roda um modo de tiro curto do headless e devolve os eventos.
 *
 * spawn assincrono, nunca execFileSync: o probe importa o torch e leva
 * segundos, e o main nao pode parar (a licao do tracker.ts).
 */
function rodarCurto(backend: Backend, motor: Motor, args: string[], limiteMs: number): Promise<SaidaCurta> {
  return new Promise((resolver) => {
    const eventos: Evento[] = []
    const stderr: string[] = []
    let falha: string | null = null
    let acabou = false
    const terminar = (): void => {
      if (acabou) return
      acabou = true
      clearTimeout(relogio)
      resolver({ eventos, stderr, falha })
    }

    let filho: ChildProcessWithoutNullStreams
    try {
      filho = spawn(backend.cmd, [...backend.args, ...args], {
        cwd: backend.cwd,
        windowsHide: true,
        env: { ...ambiente(motor, backend), ...backend.env },
      })
    } catch (e) {
      resolver({ eventos, stderr, falha: e instanceof Error ? e.message : String(e) })
      return
    }
    curtos.add(filho)
    // Sem stdin: o modo curto nao le nada, e o pipe aberto nao serve a ninguem.
    filho.stdin.on('error', () => {})
    filho.stdin.end()

    const leitor = new LeitorDeLinhas((linha) => {
      const ev = lerEvento(linha)
      if (ev) eventos.push(ev)
    })
    filho.stdout.setEncoding('utf8')
    filho.stdout.on('data', (d: string) => leitor.push(d))
    const leitorErro = new LeitorDeLinhas((linha) => {
      stderr.push(linha)
      if (stderr.length > 200) stderr.shift()
    })
    filho.stderr.setEncoding('utf8')
    filho.stderr.on('data', (d: string) => leitorErro.push(d))

    filho.on('error', (e) => {
      falha = e.message
      curtos.delete(filho)
      terminar()
    })
    filho.on('close', () => {
      leitor.flush()
      leitorErro.flush()
      curtos.delete(filho)
      terminar()
    })

    // Rede de seguranca: motor travado nao pode deixar a promessa pendurada.
    const relogio = setTimeout(() => {
      falha = `o motor nao respondeu em ${Math.round(limiteMs / 1000)} s`
      matarArvore(filho)
      terminar()
    }, limiteMs)
  })
}

/**
 * [recap] A1: um modo curto do headless no motor do Studio (buscar-anime,
 * escolher-anime) e os eventos dele. Lanca com a frase para a tela quando o
 * motor nao esta pronto, falhou ou nao respondeu no prazo. Nao usa a vaga do
 * motor (`atual`): roda ao lado de um corte ou de uma descoberta esperando nomes.
 */
export async function rodarNoMotor(args: string[], limiteMs: number, padrao: string): Promise<Record<string, unknown>[]> {
  const backend = backendDoStudio()
  if ('erro' in backend) throw new Error(backend.erro)
  const saida = await rodarCurto(backend, 'studio', args, limiteMs)
  if (saida.eventos.some((e) => e.type === 'failed') || (saida.falha && saida.eventos.length === 0)) {
    throw new Error(explicar(saida, padrao))
  }
  return saida.eventos
}

function explicar(saida: SaidaCurta, padrao: string): string {
  const falhou = saida.eventos.find((e) => e.type === 'failed')
  if (falhou && typeof falhou['message'] === 'string') return `${padrao}: ${ascii(falhou['message'])}`
  if (saida.falha) return `${padrao}: ${ascii(saida.falha)}`
  if (saida.stderr.length) return `${padrao}: ${cauda(saida.stderr)}`
  return padrao
}

// ----------------------------------------------------------------- status

/**
 * A sondagem do motor do Studio. O probe importa torch e CUDA (~4 s, mais na
 * primeira vez do disco frio); a resposta BOA nao muda enquanto o app esta
 * aberto e fica para a sessao inteira. A ruim nao: o probe que estourou o
 * tempo com o disco frio, ou o venv que ainda estava sendo instalado, tem que
 * poder ser conferido de novo sem reiniciar o app.
 */
let sondaDoStudio: Promise<StatusDoMotor['studio']> | null = null

/**
 * O runtime do motor mudou (instalou, atualizou, removeu: motor-runtime/ipc.ts):
 * a resposta guardada, boa ou ruim, ja nao vale. O proximo statusDoMotor sonda
 * de novo.
 */
export function esquecerSondaDoMotor(): void {
  sondaDoStudio = null
}

async function sondarStudio(): Promise<StatusDoMotor['studio']> {
  const vazio = { pronto: false, versao: null, gpu: null }
  try {
    const backend = backendDoStudio()
    if ('erro' in backend) return { ...vazio, erro: backend.erro }
    // 2 min: o primeiro import do torch com o disco frio passa de 30 s.
    const saida = await rodarCurto(backend, 'studio', ['probe'], 120_000)
    const probe = saida.eventos.find((e) => e.type === 'probe')
    if (!probe) return { ...vazio, erro: explicar(saida, 'O motor de personagens nao respondeu') }
    const versao = typeof probe['version'] === 'string' ? probe['version'] : null
    const gpu = typeof probe['gpuName'] === 'string' && probe['gpuName'] ? probe['gpuName'] : null
    // Sem ffmpeg o motor nao corta nada: melhor dizer agora do que no meio.
    if (probe['ffmpeg'] === false) {
      return { pronto: false, versao, gpu, erro: 'O motor de personagens nao achou o ffmpeg.' }
    }
    return { pronto: true, versao, gpu, erro: null }
  } catch (e) {
    return { ...vazio, erro: ascii(e instanceof Error ? e.message : String(e)) }
  }
}

/**
 * O motor do Studio responde? E o AnCut HUB esta instalado?
 *
 * Chamadas ao mesmo tempo dividem um probe so (a promessa fica guardada), que
 * nunca trava o main. Depois que ele responde pronto, a resposta vale para a
 * sessao; `pronto: false` (motor ausente, timeout, crash) volta com o `erro`
 * em texto para a tela e e esquecido, para a proxima chamada sondar de novo.
 * O AnCut e conferido a cada chamada: e so olhar se um arquivo existe, e ele
 * pode ter sido instalado com o app aberto.
 */
export async function statusDoMotor(): Promise<StatusDoMotor> {
  const sonda = (sondaDoStudio ??= sondarStudio())
  const caminho = acharAnCut()
  const studio = await sonda
  if (!studio.pronto && sondaDoStudio === sonda) sondaDoStudio = null
  return { studio, ancut: { instalado: caminho !== null, caminho } }
}

/**
 * Anime, temporada, episodio e kind pelo nome do arquivo, com o parse do
 * proprio motor (`python -m app.headless parse <path>`, sem torch, ~0,2 s).
 *
 * Fica no motor e nao reescrito em TS porque a heuristica tem dezenas de
 * padroes e o nome da pasta como reserva. null quando o motor nao esta pronto
 * ou nao entendeu o nome; quem chama (sondar.ts) cai no parse do Studio.
 */
export async function adivinharPeloMotor(path: string): Promise<PalpiteDoEpisodio | null> {
  const backend = backendDoStudio()
  if ('erro' in backend) return null
  const saida = await rodarCurto(backend, 'studio', ['parse', path], 30_000)
  const p = saida.eventos.find((e) => e.type === 'parsed')
  if (!p) return null
  const anime = typeof p['anime'] === 'string' ? p['anime'].trim() : ''
  const temporada = Number(p['season'])
  const episodio = Number(p['episode'])
  if (!anime || !Number.isInteger(temporada) || temporada < 0 || !Number.isInteger(episodio) || episodio < 0) {
    return null
  }
  const kind = kindDoEpisodioSchema.safeParse(p['kind'])
  return { anime, temporada, episodio, kind: kind.success ? kind.data : '' }
}

// ---------------------------------------------------------------- analise

interface Job {
  id: string
  motor: Motor
  anime: string
  temporada: number
  reconhecer: boolean
  backend: Backend
  requisicao: Record<string, unknown>
  ouvintes: OuvintesDaAnalise
  filho: ChildProcessWithoutNullStreams | null
  inicio: number
  /** O fim ja foi entregue. Daqui em diante o processo so esta terminando de morrer. */
  entregue: boolean
  cancelado: boolean
  stderr: string[]
  log: WriteStream | null
  relogio: NodeJS.Timeout | null
  /** O que o Studio arrumou nas proprias pastas antes de subir o motor. So para o log. */
  preparo: string[]
  /**
   * O motor voltou sem fotos do elenco (needs-input) e o fim esta SEGURO ate a
   * reserva (elenco-reserva.ts) dizer se ha fotos para copiar. Entregue no close
   * do processo, se a reserva nao der em nada.
   */
  fimPendente: FimDaAnalise | null
  /** A pasta de refs do needs-input: o id da franquia esta no nome dela. */
  refsDir: string | null
  /** O motor ja rodou de novo com a reserva: uma vez por job, nunca em laco. */
  repetiu: boolean
  /** As fotos do elenco que a reserva copiou neste job. */
  fotos: ReservaDoElenco | null
  /** Reconhecer na mao: o discovery-ready chegou e o processo espera UMA linha de nomes. */
  esperandoNomes: boolean
  /**
   * O done ja chegou e o fim espera a conferencia das fotos do elenco
   * (arte-unica.ts, ate ~15 s). O close do processo nao entrega por cima, e
   * o cancelar e no-op: o trabalho do motor ja acabou.
   */
  conferindo: boolean
}

/** O job da vez. Um por vez: o motor ocupa a GPU inteira. */
let atual: Job | null = null

/**
 * Espera o job anterior acabar de morrer, quando ele JA entregou o fim.
 *
 * O `done` chega antes do `close` do processo: quem recebe o fim e pede outra
 * analise na hora (o "Analisar de novo") bateria em "ja existe uma analise"
 * por um processo que so esta descarregando o torch. Job rodando de verdade
 * nao espera: e erro na hora.
 */
async function esperarOAnterior(limiteMs = 15_000): Promise<void> {
  const ate = Date.now() + limiteMs
  while (atual && atual.entregue && Date.now() < ate) {
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** Entrega o fim UMA vez por job, aconteca o que acontecer depois. */
function entregar(job: Job, fim: FimDaAnalise): void {
  if (job.entregue) return
  job.entregue = true
  job.log?.write(`\n[studio] fim: ${JSON.stringify(fim)}\n`)
  try {
    job.ouvintes.fim(fim)
  } catch (e) {
    console.error('[motor] ouvinte do fim falhou:', e)
  }
  // O processo tem 30 s para sair sozinho depois do evento final. Preso alem
  // disso (thread pendurada no shutdown do torch), ele so segura a GPU.
  if (job.filho) {
    const filho = job.filho
    if (job.relogio) clearTimeout(job.relogio)
    job.relogio = setTimeout(() => matarArvore(filho), 30_000)
  } else {
    soltar(job)
  }
}

function falhou(job: Job, erro: string): FimDaAnalise {
  return { jobId: job.id, ok: false, cancelado: false, erro, precisaDescoberta: null }
}

function cancelou(job: Job): FimDaAnalise {
  return { jobId: job.id, ok: false, cancelado: true, erro: 'Analise cancelada.', precisaDescoberta: null }
}

/** Libera a vaga do job e fecha o log. */
function soltar(job: Job): void {
  if (job.relogio) clearTimeout(job.relogio)
  job.relogio = null
  job.log?.end()
  job.log = null
  if (atual === job) atual = null
}

function segundosDesde(inicio: number): number {
  return Math.round((Date.now() - inicio) / 100) / 10
}

/** Um evento do headless -> progresso ou fim do contrato. */
function tratarEvento(job: Job, ev: Evento): void {
  switch (ev.type) {
    case 'stage': {
      if (job.entregue) return
      const estagio = typeof ev['stage'] === 'string' ? ev['stage'] : ''
      const fracao = Number(ev['fraction'])
      try {
        job.ouvintes.progresso({
          jobId: job.id,
          etapa: etapaDoEstagio(estagio),
          etapaDoMotor: estagio,
          // -1 e o "nao sei quanto falta" do motor.
          fracao: Number.isFinite(fracao) && fracao >= 0 ? Math.min(1, fracao) : null,
          // A frase de log do motor vira uma curta de tela (frase-do-motor.ts).
          mensagem: fraseDoMotor(typeof ev['message'] === 'string' ? ev['message'] : ''),
        })
      } catch (e) {
        console.error('[motor] ouvinte do progresso falhou:', e)
      }
      return
    }
    case 'done': {
      const r = (ev['result'] ?? {}) as Record<string, unknown>
      const pasta = typeof r['episodeRoot'] === 'string' ? r['episodeRoot'] : ''
      if (!pasta) {
        entregar(job, falhou(job, 'O motor terminou sem dizer onde gravou as cenas.'))
        return
      }
      const total = Number(r['totalShots'])
      const nomes = Array.isArray(r['identifiedCharacters'])
        ? r['identifiedCharacters'].filter((n): n is string => typeof n === 'string' && n.trim() !== '')
        : []
      try {
        job.ouvintes.resultadoDoMotor?.(r)
      } catch (e) {
        console.error('[motor] ouvinte do resultado falhou:', e)
      }
      let fotos: ReservaDoElenco | null = null
      let doBatismo = false
      if (job.motor === 'studio' && job.reconhecer) {
        // De onde vieram as fotos do elenco: a reserva deste job, ou a de uma
        // analise anterior (reserva-do-studio.json na pasta do banco).
        fotos = job.fotos ?? fotosDoElenco(pastaDeDadosDoMotor(), job.anime, job.temporada)
        // Algum reconhecido so passou do minimo com as fotos do Reconhecer na mao: a tela pede para conferir.
        doBatismo = dependeDoBatismo(typeof r['refsDir'] === 'string' ? r['refsDir'] : null, nomes)
        job.log?.write(`[studio] fotos do elenco: ${fotos ? `${fotos.origem} (${fotos.de})` : 'busca online'}${doBatismo ? ' + Reconhecer na mao' : ''}\n`)
      }
      const fim: FimDaAnalise = {
        jobId: job.id,
        ok: true,
        motor: job.motor,
        pastaDoEpisodio: pasta,
        totalCenas: Number.isFinite(total) && total > 0 ? Math.trunc(total) : 0,
        personagens: nomes,
        segundos: segundosDesde(job.inicio),
        // A tela diz "Fotos: Corte Cenas" quando o elenco veio da reserva.
        fotosDoElenco: doBatismo ? ORIGEM_DO_BATISMO : (fotos?.origem ?? null),
      }
      // Reconhecido com UMA arte contada duas vezes (o retrato do MAL e o da
      // AniList em dois recortes): a tela pede para conferir, com os nomes.
      // Fora do Reconhecer na mao, em que os nomes sao os do Levi.
      if (job.motor === 'studio' && job.reconhecer && !doBatismo && job.requisicao['discovery'] !== true && nomes.length > 0) {
        job.conferindo = true
        const inicio = Date.now()
        void soUmaArte(typeof r['refsDir'] === 'string' ? r['refsDir'] : null, nomes)
          .then((umaArte) => {
            job.log?.write(`[studio] uma arte so: ${umaArte.length ? umaArte.join('; ') : 'ninguem'} (${Date.now() - inicio} ms)\n`)
            if (umaArte.length && fim.ok) fim.fotosDoElenco = origemDeUmaArte(umaArte)
          })
          .catch(() => {})
          .finally(() => {
            job.conferindo = false
            entregar(job, fim)
          })
        return
      }
      entregar(job, fim)
      return
    }
    case 'needs-input': {
      // O motor parou antes de reconhecer: nao achou o anime nas fontes de
      // elenco, ou ninguem ficou com fotos suficientes. A saida do passo 1 e
      // cortar sem reconhecer; a rodada de descoberta com nomes fica para depois.
      const semAnime = ev['kind'] === 'anime-not-found'
      const fim: FimDaAnalise = {
        jobId: job.id,
        ok: false,
        cancelado: false,
        // Curto: a tela mostra o pedido de descoberta com as proprias frases,
        // e este vai para o tooltip dela e para o log.
        erro: semAnime
          ? `Nao achei "${job.anime}" no AniList nem no MyAnimeList.`
          : `Nenhum personagem de "${job.anime}" ficou com fotos suficientes, nem com as do Corte Cenas (as fontes de imagem podem estar fora do ar).`,
        precisaDescoberta: semAnime ? 'anime-nao-encontrado' : 'sem-referencias',
      }
      // Sem fotos: antes de desistir, a reserva do elenco. O motor ja resolveu
      // o id da franquia (esta no nome da refsDir) e o corte ja esta no disco,
      // entao rodar de novo com as fotos copiadas custa so o reconhecimento.
      // Uma vez por job; o fim fica seguro ate o close do processo.
      if (!semAnime && job.motor === 'studio' && !job.repetiu && !job.cancelado && !job.entregue) {
        job.fimPendente = fim
        job.refsDir = typeof ev['refsDir'] === 'string' ? ev['refsDir'] : null
        job.log?.write('\n[studio] sem fotos do elenco: tentando a reserva antes de entregar\n')
        // O processo sai sozinho depois do needs-input; preso, so seguraria a
        // GPU (a mesma rede de seguranca do entregar). O close segue o fluxo.
        const filho = job.filho
        if (filho) {
          if (job.relogio) clearTimeout(job.relogio)
          job.relogio = setTimeout(() => matarArvore(filho), 30_000)
        }
        return
      }
      entregar(job, fim)
      return
    }
    case 'cancelled':
      entregar(job, cancelou(job))
      return
    case 'failed': {
      const msg = typeof ev['message'] === 'string' && ev['message'] ? ascii(ev['message']) : 'erro sem mensagem'
      if (typeof ev['detail'] === 'string') job.log?.write(`\n[studio] detalhe do erro:\n${ev['detail']}\n`)
      // Os modelos da 1a analise sem rede saiam como "AttributeError ... CascadeClassifier".
      const frase = fraseDoErroDoMotor(msg, typeof ev['detail'] === 'string' ? ev['detail'] : '')
      entregar(job, job.cancelado ? cancelou(job) : falhou(job, frase ?? `O motor parou com erro: ${msg}`))
      return
    }
    case 'discovery-ready': {
      // Reconhecer na mao: os grupos vao para a descoberta e o processo fica
      // vivo, SEM relogio, esperando a linha de nomes (comandarDescoberta). O
      // cancelamento e o de sempre; o app fechando mata a arvore (encerrarMotor).
      if (job.ouvintes.descobertaPronta && !job.entregue && !job.cancelado) {
        job.esperandoNomes = true
        const grupos = Array.isArray(ev['groups']) ? ev['groups'].length : 0
        job.log?.write(`\n[studio] discovery-ready: ${grupos} grupos, ${String(ev['totalFaces'])} rostos; esperando os nomes\n`)
        try {
          job.ouvintes.descobertaPronta(ev)
          return
        } catch (e) {
          job.esperandoNomes = false
          console.error('[motor] ouvinte da descoberta falhou:', e)
        }
      }
      // Sem ouvinte (ou ele quebrou): o processo ficaria esperando nomes para
      // sempre. Dispensa e avisa.
      try {
        job.filho?.stdin.write('{"cmd":"cancel"}\n')
      } catch {
        /* o close cuida */
      }
      entregar(job, falhou(job, 'O motor pediu os nomes do elenco (descoberta), que o recap ainda nao faz.'))
      return
    }
    default:
      // 'timings' e o que vier de novo: so para o log.
      job.log?.write(`[studio] evento: ${JSON.stringify(ev)}\n`)
  }
}

/**
 * Andamento que o proprio Studio manda (a reserva do elenco). A copia de antes
 * do motor subir conta como 'preparando': na etapa 'elenco' ela acendia o
 * Elenco antes do Preparar, e a tela andava elenco -> preparando -> elenco.
 */
function avisar(job: Job, etapa: 'preparando' | 'elenco', mensagem: string): void {
  if (job.entregue) return
  try {
    job.ouvintes.progresso({ jobId: job.id, etapa, etapaDoMotor: 'studio_reserva_elenco', fracao: null, mensagem })
  } catch (e) {
    console.error('[motor] ouvinte do progresso falhou:', e)
  }
}

/**
 * O que roda entre o jobId voltar e o processo subir: a reserva do elenco
 * (elenco-reserva.ts), quando a analise reconhece personagens. Assincrona
 * porque copia centenas de fotos, e o main nao pode parar.
 */
async function prepararEIniciar(job: Job): Promise<void> {
  if (job.motor === 'studio' && job.reconhecer && !job.cancelado) {
    try {
      const r = await reservarElenco(pastaDeDadosDoMotor(), {
        anime: job.anime,
        temporada: job.temporada,
        aoCopiar: (origem, n) => avisar(job, 'preparando', `Copiando as fotos do elenco do ${origem} (${n} personagens)...`),
      })
      job.preparo.push(r.linha)
      if (r.reserva) job.fotos = r.reserva
    } catch (e) {
      job.preparo.push(`reserva do elenco falhou: ${e instanceof Error ? e.message : String(e)}`)
    }
    // O app fechou (encerrarMotor soltou a vaga) enquanto copiava: nada sobe.
    if (atual !== job) return
    // Sincrono e sem lancar. Banco copiado pela reserva nunca e `partial`.
    for (const pasta of porDeLadoElencoDegradado(pastaDeDadosDoMotor())) {
      job.preparo.push(`elenco degradado posto de lado (o motor busca de novo): ${pasta}`)
    }
  }
  iniciar(job, false)
}

/**
 * O motor voltou sem fotos do elenco: tenta a reserva com o id que ele
 * resolveu e, se ela copiou alguma coisa, roda o motor de novo (o corte ja
 * esta no disco e e reaproveitado). Sem reserva, entrega o fim que estava
 * seguro. job.filho ja e null aqui: o entregar solta a vaga sozinho.
 */
async function tentarComAReserva(job: Job, pendente: FimDaAnalise): Promise<void> {
  let reserva: ReservaDoElenco | null = null
  try {
    const r = await reservarElenco(pastaDeDadosDoMotor(), {
      anime: job.anime,
      temporada: job.temporada,
      cacheId: job.refsDir ? idDaPastaDeRefs(job.refsDir) : null,
      aoCopiar: (origem, n) => avisar(job, 'elenco', `Sem fotos online; copiando as do ${origem} (${n} personagens)...`),
    })
    job.log?.write(`[studio] ${r.linha}\n`)
    reserva = r.reserva
  } catch (e) {
    job.log?.write(`[studio] reserva do elenco falhou: ${e instanceof Error ? e.message : String(e)}\n`)
  }
  if (atual !== job) return
  if (job.cancelado) {
    entregar(job, cancelou(job))
    return
  }
  if (!reserva) {
    entregar(job, pendente)
    return
  }
  job.fotos = reserva
  job.repetiu = true
  iniciar(job, true)
}

/**
 * Sobe o processo do job. A 1a vez roda depois do jobId ter voltado (via
 * prepararEIniciar); a 2a (`repeticao`) so depois da reserva do elenco, no
 * mesmo job e no mesmo log.
 */
function iniciar(job: Job, repeticao: boolean): void {
  const { backend, requisicao } = job
  if (job.cancelado) {
    entregar(job, cancelou(job))
    return
  }

  if (repeticao) {
    job.log?.write('\n[studio] ---- motor de novo, com as fotos do elenco da reserva ----\n\n')
  } else {
    try {
      const logs = join(pastaDeDadosDoMotor(), 'logs')
      mkdirSync(logs, { recursive: true })
      // Um arquivo so, sobrescrito: o log do pipeline e longo, e o que importa
      // depurar e sempre a ultima analise.
      job.log = createWriteStream(join(logs, 'ultima-analise.log'), { flags: 'w' })
      job.log.on('error', () => {
        job.log = null
      })
      job.log.write(`[studio] ${new Date().toISOString()} job ${job.id} motor ${job.motor}\n`)
      job.log.write(`[studio] ${backend.cmd} ${backend.args.join(' ')} run\n[studio] ${JSON.stringify(requisicao)}\n`)
      for (const linha of job.preparo) job.log.write(`[studio] ${linha}\n`)
      job.log.write('\n')
    } catch {
      job.log = null
    }
  }

  let filho: ChildProcessWithoutNullStreams
  try {
    filho = spawn(backend.cmd, [...backend.args, 'run'], {
      cwd: backend.cwd,
      windowsHide: true,
      env: { ...ambiente(job.motor, backend), ...backend.env },
    })
  } catch (e) {
    entregar(job, falhou(job, `Nao deu para iniciar o motor: ${e instanceof Error ? e.message : String(e)}`))
    return
  }
  job.filho = filho

  const leitor = new LeitorDeLinhas((linha) => {
    const ev = lerEvento(linha)
    if (ev) tratarEvento(job, ev)
    else job.log?.write(`[studio] linha fora do protocolo: ${linha.slice(0, 300)}\n`)
  })
  filho.stdout.setEncoding('utf8')
  filho.stdout.on('data', (d: string) => leitor.push(d))

  // stderr e o log humano do pipeline: vai para o arquivo, e a cauda explica
  // uma morte sem evento final.
  const leitorErro = new LeitorDeLinhas((linha) => {
    job.stderr.push(linha)
    if (job.stderr.length > 80) job.stderr.shift()
  })
  filho.stderr.setEncoding('utf8')
  filho.stderr.on('data', (d: string) => {
    job.log?.write(d)
    leitorErro.push(d)
  })

  // Escrever num processo que ja morreu da EPIPE como evento 'error' do stdin;
  // sem ouvinte, o Node derrubaria o main inteiro.
  filho.stdin.on('error', () => {})

  filho.on('error', (e) => {
    entregar(job, falhou(job, `Nao deu para iniciar o motor: ${e.message}`))
    // Sem pid o close pode nao vir: libera a vaga aqui.
    if (!filho.pid) soltar(job)
  })

  filho.on('close', (codigo) => {
    leitor.flush()
    leitorErro.flush()
    if (job.conferindo && !job.entregue) {
      // O done ja chegou e o fim sai quando a conferencia acabar; com o
      // filho null, o entregar de la solta a vaga.
      job.filho = null
      if (job.relogio) clearTimeout(job.relogio)
      job.relogio = null
      return
    }
    if (job.fimPendente && !job.entregue) {
      // Sem fotos do elenco (needs-input seguro): o processo saiu, a vaga
      // continua do job enquanto a reserva olha os caches.
      const pendente = job.fimPendente
      job.fimPendente = null
      job.filho = null
      if (job.relogio) clearTimeout(job.relogio)
      job.relogio = null
      if (job.cancelado) entregar(job, cancelou(job))
      else void tentarComAReserva(job, pendente)
      return
    }
    if (!job.entregue) {
      if (job.cancelado) {
        entregar(job, cancelou(job))
      } else {
        const porque = job.stderr.length ? `: ${cauda(job.stderr)}` : '.'
        entregar(job, falhou(job, `O motor parou sem terminar (codigo ${codigo ?? '?'})${porque}`))
      }
    }
    soltar(job)
  })

  // A requisicao vai na 1a linha do stdin. O stdin fica ABERTO: e por ele que
  // o cancelamento chega, e o motor le pipe fechado como "o host morreu" e
  // cancela sozinho.
  filho.stdin.write(`${JSON.stringify(requisicao)}\n`)
}

/**
 * Comeca a analise e devolve o jobId.
 *
 * - Um job por vez: com outro rodando, lanca "Ja existe uma analise rodando.".
 * - O processo sobe DEPOIS de devolver o jobId (setImmediate): nenhum evento
 *   do job chega ao renderer antes da resposta do invoke.
 * - `reconhecer: false` -> `cutOnly: true`. O corte sai em renderExportMode
 *   'compat' (8 bits, 23,976 CFR), para os pontos de corte sairem iguais aos do
 *   AnCut.
 * - Com reconhecimento no motor do Studio, as fotos do elenco ja baixadas pelo
 *   Corte Cenas sao copiadas antes de o motor subir (elenco-reserva.ts); e, se
 *   ele ainda voltar sem fotos, a reserva tenta de novo com o id que ele
 *   resolveu e o motor roda uma 2a vez no mesmo job.
 * - `fim` e chamado exatamente uma vez por job, sempre.
 * - `opcoes.descoberta` (Reconhecer na mao, so motor do Studio): `discovery:
 *   true`. O motor agrupa os rostos, manda o discovery-ready ao ouvinte
 *   `descobertaPronta` e espera os nomes (comandarDescoberta); o `done` do
 *   commit e o fim ok de sempre.
 */
export async function analisarEpisodio(
  pedido: PedidoDeAnalise,
  ouvintes: OuvintesDaAnalise,
  opcoes?: { descoberta?: true },
): Promise<string> {
  const descoberta = opcoes?.descoberta === true
  if (descoberta && (pedido.motor !== 'studio' || !ouvintes.descobertaPronta)) {
    throw new Error('Reconhecer na mao so roda no motor de personagens.')
  }
  await esperarOAnterior()
  // A impressao (para o desarme abaixo) vem ANTES da checagem da vaga: dali
  // ate reservar o job nao pode haver await, ou dois cliques passariam juntos.
  const impressao = pedido.motor === 'studio' ? await impressaoLembrada(pedido.path) : null
  if (atual) throw new Error('Ja existe uma analise rodando.')

  const backend = pedido.motor === 'studio' ? backendDoStudio() : backendDoAnCut()
  if ('erro' in backend) throw new Error(backend.erro)

  // Onde grava. A ordem importa: a guarda vem antes de tudo, e a pasta so e
  // criada depois de conferir o video -- um pedido torto nao deixa nem pasta
  // vazia para tras.
  let outputDir: string
  if (pedido.motor === 'studio') {
    outputDir = pastaDaBibliotecaStudio()
    garantirGravavel(outputDir)
  } else {
    // Quem grava e o AnCut, na saida dele (a do config.json que ele divide
    // com o Corte Cenas). Sem config, o padrao do exe instalado.
    outputDir = saidaDoCorteCenas() ?? join(pastaDeDocumentos(), 'CorteCenas', 'Output')
  }
  if (!existsSync(pedido.path)) throw new Error('Esse arquivo de video nao esta mais no disco.')
  // Guardas do Studio sobre as proprias pastas, ate as correcoes do motor
  // voltarem do ancut-hub-engine (ver cada arquivo). Sincronas e sem lancar.
  const preparo: string[] = []
  if (pedido.motor === 'studio') {
    mkdirSync(outputDir, { recursive: true })
    for (const pasta of desarmarCorteDeOutroArquivo({
      biblioteca: outputDir,
      path: pedido.path,
      anime: pedido.anime,
      temporada: pedido.temporada,
      episodio: pedido.episodio,
      kind: pedido.kind,
      id: impressao,
      pastaLembrada: pastaLembradaPeloMotor(pastaDeDadosDoMotor(), pedido.anime),
    })) {
      preparo.push(`cortada de outro arquivo, recorte forcado se o motor usar: ${pasta}`)
    }
    // O elenco degradado (elenco-degradado.ts) e conferido no prepararEIniciar,
    // DEPOIS da reserva do elenco: ela precisa ver o banco do Studio como ele
    // esta para decidir se ele ja reconhece alguem.
  }

  // Os nomes sao os de headless._run/_apply_request_to_config. Sem `params`:
  // limiar, margem e cia ficam no padrao do motor (config.py), que e o que o
  // AnCut usa. Sem skipHead/skipTail: o episodio e cortado INTEIRO, e OP/ED
  // viram exclusoes no indice do Studio.
  const requisicao: Record<string, unknown> = {
    videoPath: pedido.path,
    anime: pedido.anime,
    season: pedido.temporada,
    episode: pedido.episodio,
    kind: pedido.kind,
    outputDir,
    cutOnly: !pedido.reconhecer && !descoberta,
    renderExportMode: 'compat',
    aiReview: false,
    discovery: descoberta,
    mergePrevious: false,
    skipCreditShots: false,
    useDanbooru: false,
    mediaKind: 'anime',
  }
  // Pasta do anime que ja existe (o "Reconhecer agora" sobre cenas cortadas):
  // o motor grava nela mesmo com o nome corrigido para achar o elenco, e o
  // corte que esta la e reaproveitado em vez de refeito noutra pasta.
  if (pedido.motor === 'studio' && pedido.pastaDoAnime) requisicao['outputFolder'] = pedido.pastaDoAnime

  const job: Job = {
    id: `job_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`,
    motor: pedido.motor,
    anime: pedido.anime,
    temporada: pedido.temporada,
    reconhecer: pedido.reconhecer || descoberta,
    backend,
    requisicao,
    ouvintes,
    filho: null,
    inicio: Date.now(),
    entregue: false,
    cancelado: false,
    stderr: [],
    log: null,
    relogio: null,
    preparo,
    fimPendente: null,
    refsDir: null,
    repetiu: false,
    fotos: null,
    esperandoNomes: false,
    conferindo: false,
  }
  // A vaga e reservada JA, antes do processo subir: um segundo clique no
  // mesmo instante leva "ja existe" em vez de subir dois motores.
  atual = job
  setImmediate(() => void prepararEIniciar(job))
  return job.id
}

/**
 * Pede para parar o job: {"cmd":"cancel"} no stdin e, se o processo nao sair
 * em 10 s, mata a arvore dele.
 *
 * O motor so olha o pedido na proxima chamada de progresso -- entre uma cena
 * e outra, segundos no maximo --, mas carregar o CLIP na GPU pode passar disso
 * sem nenhum progresso no meio. jobId que nao esta rodando e no-op (o usuario
 * pode clicar duas vezes).
 */
export async function cancelarAnalise(jobId: string): Promise<void> {
  const job = atual
  if (!job || job.id !== jobId || job.entregue || job.cancelado || job.conferindo) return
  job.cancelado = true
  const filho = job.filho
  // Ainda nao subiu, ou esta entre as duas rodadas copiando a reserva do
  // elenco: quem viria subir o processo ve o `cancelado` e entrega o fim.
  if (!filho) return
  try {
    filho.stdin.write('{"cmd":"cancel"}\n')
  } catch {
    matarArvore(filho)
    return
  }
  if (job.relogio) clearTimeout(job.relogio)
  job.relogio = setTimeout(() => matarArvore(filho), 10_000)
}

/**
 * Reconhecer na mao: manda a linha de nomes ao processo que espera depois do
 * discovery-ready. UMA vez por job. false = o job nao esta esperando nomes
 * (cancelado, morreu, ja recebeu) -- quem chama diz "os grupos expiraram".
 * A decisao ja vem conferida (paraOMotor): nome vazio para todos faria o
 * motor lancar e o processo morrer com os grupos.
 */
export function comandarDescoberta(jobId: string, comando: ComandoCommitDiscovery): boolean {
  const job = atual
  if (!job || job.id !== jobId || !job.esperandoNomes || job.entregue || job.cancelado || !job.filho) return false
  const filho = job.filho
  if (filho.exitCode !== null || filho.signalCode !== null || filho.stdin.destroyed) return false
  job.esperandoNomes = false
  job.log?.write(
    `\n[studio] commit-discovery: ${Object.keys(comando.names).length} grupos com nome (${[...new Set(Object.values(comando.names))].length} personagens)\n`,
  )
  try {
    filho.stdin.write(`${JSON.stringify(comando)}\n`)
    return true
  } catch {
    return false
  }
}

/**
 * Mata o processo do motor ao sair do app. Ligado ao before-quit no main.ts.
 *
 * Nunca lanca: roda no caminho de saida, e uma excecao aqui seguraria o app
 * aberto. O Windows nao mata o filho junto (a licao do whisper-cli), e um
 * motor orfao segura a GPU ate alguem abrir o Gerenciador de Tarefas.
 */
/**
 * Ha um processo do motor vivo (a analise/corte, ou um comando curto)? O
 * runtime recusa Reinstalar/Recomecar enquanto isso (o venv esta em uso), e a
 * barra segura o "Atualizar" (o quitAndInstall mataria o corte no meio).
 */
export function motorRodando(): boolean {
  const vivo = (f: ChildProcess | null | undefined): boolean => !!f && f.exitCode === null && f.signalCode === null
  // Um job na fila (filho ainda nulo) tambem conta: ele sobe o python do runtime ja ja.
  return atual !== null || [...curtos].some(vivo)
}

export function encerrarMotor(): void {
  try {
    const job = atual
    if (job?.filho) matarArvore(job.filho, true)
    if (job) soltar(job)
  } catch {
    /* saindo do app: nada a fazer */
  }
  for (const filho of curtos) {
    try {
      filho.kill()
    } catch {
      /* ja morreu */
    }
  }
  curtos.clear()
}
