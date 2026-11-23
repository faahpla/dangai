import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ambienteDoRuntime, backendDoRuntime } from './runtime'
import { ambienteDosDados, dadosDeTeste, usaRuntime } from './runtime/pastas'
import { pythonDoMotor } from './runtime/python-do-motor'
import { publish } from '../media-server'
import {
  eventoDoMotor,
  pedidoParaOMotor,
  type ConfigDoMotor,
  type EventoDoCorte,
  type MotorDoAncut,
  type NomeLido,
  type PedidoDeCorte,
  type RespostaDoBatismo,
} from '@shared/ancut'

/**
 * [ancut] O MOTOR DO ANCUT, falado daqui (20/11, "a estrutura do AnCut no
 * Dangai"). Os mesmos comandos de app/headless.py, o mesmo config.json, o
 * mesmo banco: um episodio cortado aqui e igual a um cortado no AnCut, e os
 * dois apps convivem.
 *
 * DE ONDE VEM O MOTOR (23/11, "quero tudo funcionando dentro do Dangai,
 * deixa como opcao baixar esse motor, igual o modulo recap"), nesta ordem:
 * 1. o de TESTE (DANGAI_ANCUT_MOTOR);
 * 2. o DO DANGAI: o codigo vem no instalador (resources/motor/ancut, copiado do
 *    ancut-hub-engine) e o Python dele e baixado pela tela "Motor de cortes"
 *    (./runtime, o instalador do recap trazido para o nucleo);
 * 3. o do AnCut instalado (CorteCenas.exe), para quem ja tem e nao baixou.
 * Os dois usam os mesmos dados (o config.json, o index.db e as fotos do elenco
 * do AnCut, em %LOCALAPPDATA%\CorteCenas): trocar de um para o outro nao muda
 * o acervo.
 *
 * Como o AnCut (src/main/services/python-service.ts dele): cada consulta e um
 * processo curto que responde uma linha JSON; o corte e um processo longo que
 * le o pedido do stdin e escreve um evento por linha no stdout (o log humano
 * vai no stderr). Um corte por vez -- o motor segura a placa de video.
 */

export type QualMotor = 'teste' | 'dangai' | 'ancut'

export interface LocalDoMotor {
  cmd: string
  args: string[]
  cwd: string
  /** De onde veio, para a mensagem ("Motor do Dangai", "AnCut HUB instalado"). */
  origem: string
  qual: QualMotor
  /** O ambiente do processo (o do runtime leva o Python isolado e os dados do AnCut). */
  env: NodeJS.ProcessEnv
}

/**
 * O ambiente do motor: sem o UTF-8, o Python do Windows em portugues escreve
 * "análise" em cp1252 e o acento chega quebrado (o mesmo conserto do AnCut).
 */
const AMBIENTE: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' }

const deExe = (exe: string, origem: string, qual: QualMotor = 'ancut'): LocalDoMotor | null =>
  existsSync(exe) ? { cmd: exe, args: ['--headless'], cwd: dirname(exe), origem, qual, env: AMBIENTE } : null

/**
 * O motor do Dangai: o Python que a tela "Motor de cortes" baixou, rodando o
 * codigo que veio no instalador. null = nao baixado (ou instalando, ou
 * desatualizado: o runtime so serve pronto).
 */
function doDangai(): LocalDoMotor | null {
  if (!usaRuntime()) return null
  const b = backendDoRuntime()
  if ('erro' in b) return null
  const py = pythonDoMotor(b.python)
  const env = { ...ambienteDoRuntime(process.env, { cudaOk: b.cudaOk }), ...py.env, ...ambienteDosDados() }
  return { cmd: py.cmd, args: ['-m', 'app.headless'], cwd: b.cwd, origem: 'Motor do Dangai', qual: 'dangai', env }
}

/**
 * Um motor de TESTE (DANGAI_ANCUT_MOTOR): o python.exe de um venv rodando o
 * codigo do motor de uma pasta (DANGAI_ANCUT_MOTOR_PASTA) -- com a pasta de
 * cache dela, longe do banco de verdade -- ou outro CorteCenas.exe.
 */
function doAmbiente(): LocalDoMotor | null {
  const v = process.env['DANGAI_ANCUT_MOTOR']
  if (v && existsSync(v)) {
    if (/python(w)?\.exe$/i.test(v)) {
      const pasta = process.env['DANGAI_ANCUT_MOTOR_PASTA'] ?? process.cwd()
      const dados = dadosDeTeste()
      return {
        cmd: v,
        args: ['-m', 'app.headless'],
        cwd: pasta,
        origem: 'motor de teste',
        qual: 'teste',
        env: dados ? { ...AMBIENTE, ANCUT_DADOS: dados } : AMBIENTE,
      }
    }
    return deExe(v, 'motor de teste', 'teste')
  }
  const doAncut = process.env['ANCUT_BACKEND']
  return doAncut ? deExe(doAncut, 'ANCUT_BACKEND', 'teste') : null
}

function rodarReg(args: string[]): Promise<string> {
  return new Promise((ok) => {
    execFile('reg', args, { windowsHide: true, timeout: 8000 }, (_erro, stdout) => ok(String(stdout ?? '')))
  })
}

/**
 * Onde o AnCut foi instalado, pelo registro do Windows (o desinstalador dele
 * grava a pasta): o instalador deixa escolher o disco -- no PC dele e
 * E:\Apps\AnCut HUB, que nenhum caminho padrao acharia.
 */
async function doRegistro(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const raizes = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]
  const pastas: string[] = []
  for (const raiz of raizes) {
    const achados = await rodarReg(['query', raiz, '/s', '/f', 'AnCut HUB', '/d'])
    const chaves = achados.split(/\r?\n/).filter((l) => /^HKEY_/i.test(l.trim()))
    for (const chave of chaves) {
      const r = await rodarReg(['query', chave.trim(), '/v', 'InstallLocation'])
      const m = /InstallLocation\s+REG_\w+\s+(.+)/i.exec(r)
      if (m?.[1]) pastas.push(m[1].trim())
    }
  }
  return pastas
}

let lembrado: LocalDoMotor | null = null

/**
 * O motor mudou (o Python do Dangai instalou, atualizou ou foi removido):
 * procura de novo, e a sondagem (versao, placa) e refeita.
 */
export function esquecerMotor(): void {
  lembrado = null
  sondado = null
}

/** O motor do AnCut instalado (o CorteCenas.exe), sem olhar o do Dangai. */
async function doAncutInstalado(): Promise<LocalDoMotor | null> {
  if (lembrado?.qual === 'ancut' && existsSync(lembrado.cmd)) return lembrado
  for (const pasta of await doRegistro()) {
    const m = deExe(join(pasta, 'engine', 'CorteCenas.exe'), 'AnCut HUB instalado') ?? deExe(join(pasta, 'CorteCenas.exe'), 'AnCut HUB instalado')
    if (m) return (lembrado = m)
  }
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const porUsuario = join(process.env['LOCALAPPDATA'] ?? '', 'Programs')
  for (const base of [join(programFiles, 'AnCut HUB'), join(porUsuario, 'AnCut HUB'), join(programFiles, 'CorteCenas'), join(porUsuario, 'CorteCenas')]) {
    const m = deExe(join(base, 'engine', 'CorteCenas.exe'), 'AnCut HUB instalado') ?? deExe(join(base, 'CorteCenas.exe'), 'Corte Cenas instalado')
    if (m) return (lembrado = m)
  }
  return null
}

/** O AnCut HUB esta instalado (a tela diz que da para usar o motor dele sem baixar). */
export async function ancutInstalado(): Promise<boolean> {
  const antes = lembrado
  const achado = (await doAncutInstalado()) !== null
  // Perguntar nao troca o motor em uso (o do Dangai continua na frente).
  if (antes && antes.qual !== 'ancut') lembrado = antes
  return achado
}

/** O motor desta maquina, ou null. Achado uma vez (sem achar, procura de novo na proxima). */
export async function localizarMotor(): Promise<LocalDoMotor | null> {
  // O do Dangai e conferido toda vez (le dois JSON pequenos): ele pode ter acabado de instalar.
  const daqui = doAmbiente() ?? doDangai()
  if (daqui) {
    if (lembrado?.qual !== daqui.qual) sondado = null
    return (lembrado = daqui)
  }
  if (lembrado && lembrado.qual !== 'ancut') esquecerMotor()
  const instalado = await doAncutInstalado()
  if (instalado && lembrado !== instalado) sondado = null
  return (lembrado = instalado)
}

const SEM_MOTOR =
  'O motor de cortes ainda não está neste computador. Baixe o motor (uma vez só, uns 3 GB) e o Dangai corta sozinho, sem o AnCut.'

// ------------------------------------------------------------- as configuracoes

/** O config.json do motor (o mesmo que o AnCut le e grava; o de teste com DANGAI_ANCUT_DADOS). */
export function caminhoDaConfig(): string {
  const teste = dadosDeTeste()
  if (teste) return join(teste, 'config.json')
  return join(process.env['LOCALAPPDATA'] ?? '', 'CorteCenas', 'CorteCenas', 'config.json')
}

/**
 * Muda campos do config.json do motor, sem perder os outros (as chaves de IA,
 * os ultimos usados do AnCut). Grava num .tmp e troca: o motor nunca le meio
 * arquivo.
 */
export function gravarConfigDoMotor(mudancas: Partial<ConfigDoMotor>): ConfigDoMotor {
  const arquivo = caminhoDaConfig()
  const atual: Record<string, unknown> = { ...configDoMotor() }
  for (const [k, v] of Object.entries(mudancas)) if (v !== undefined) atual[k] = v
  mkdirSync(dirname(arquivo), { recursive: true })
  const tmp = `${arquivo}.dangai.tmp`
  writeFileSync(tmp, `${JSON.stringify(atual, null, 2)}\n`, 'utf8')
  renameSync(tmp, arquivo)
  return atual as ConfigDoMotor
}

export function configDoMotor(): ConfigDoMotor {
  try {
    const cru = JSON.parse(readFileSync(caminhoDaConfig(), 'utf8')) as unknown
    return cru && typeof cru === 'object' ? (cru as ConfigDoMotor) : {}
  } catch {
    return {}
  }
}

/**
 * A pasta de saida: a do AnCut (D:\Animes). DANGAI_ANCUT_SAIDA so no teste,
 * para o corte de mentira nao cair no acervo dele.
 */
export function pastaDeSaida(): string | null {
  const teste = process.env['DANGAI_ANCUT_SAIDA']
  if (teste) return teste
  const s = configDoMotor().output_dir
  return typeof s === 'string' && s.trim() ? s : null
}

// ------------------------------------------------------------- consultas curtas

/**
 * Um comando curto do motor: devolve o primeiro evento do tipo esperado, ou
 * null (sem motor, motor quebrado, ou nao respondeu no prazo -- a tela nunca
 * fica esperando para sempre). O primeiro atendimento custa alguns segundos:
 * o motor importa o torch.
 */
export async function perguntar<T>(args: readonly string[], tipo: string, prazoMs = 60_000): Promise<T | null> {
  const motor = await localizarMotor()
  if (!motor) return null
  return new Promise<T | null>((ok) => {
    let saida = ''
    let feito = false
    const fim = (v: T | null): void => {
      if (feito) return
      feito = true
      ok(v)
    }
    const filho = spawn(motor.cmd, [...motor.args, ...args], { cwd: motor.cwd, windowsHide: true, env: motor.env })
    filho.stdout.setEncoding('utf-8')
    filho.stdout.on('data', (d: string) => (saida += d))
    filho.stderr.on('data', () => {})
    filho.on('error', () => fim(null))
    filho.on('close', () => {
      for (const linha of saida.split('\n')) {
        try {
          const e = JSON.parse(linha.trim()) as { type?: string }
          if (e.type === tipo) return fim(e as T)
        } catch {
          /* linha que nao e do canal: fica de fora */
        }
      }
      fim(null)
    })
    setTimeout(() => {
      if (feito) return
      filho.kill()
      fim(null)
    }, prazoMs).unref?.()
  })
}

/**
 * Um comando LONGO do motor (reforcar as fotos, repescar): sem prazo -- ele
 * carrega os modelos e passa por cada episodio --, cada linha JSON vai para
 * `aoEvento`; volta com a ultima do tipo `fim` (ou null: sem motor, quebrou).
 */
export async function rodarLongo<T>(args: readonly string[], fim: string, aoEvento: (e: Record<string, unknown>) => void): Promise<T | null> {
  const motor = await localizarMotor()
  if (!motor) return null
  return new Promise<T | null>((ok) => {
    let resultado: T | null = null
    let sobra = ''
    const filho = spawn(motor.cmd, [...motor.args, ...args], { cwd: motor.cwd, windowsHide: true, env: motor.env })
    longos.add(filho)
    const linha = (l: string): void => {
      try {
        const e = JSON.parse(l) as Record<string, unknown>
        if (e['type'] === fim) resultado = e as T
        aoEvento(e)
      } catch {
        /* log solto */
      }
    }
    filho.stdout.setEncoding('utf-8')
    filho.stdout.on('data', (pedaco: string) => {
      sobra += pedaco
      const linhas = sobra.split('\n')
      sobra = linhas.pop() ?? ''
      for (const l of linhas) if (l.trim()) linha(l.trim())
    })
    filho.stderr.on('data', () => {})
    filho.on('error', () => ok(null))
    filho.on('close', () => {
      longos.delete(filho)
      if (sobra.trim()) linha(sobra.trim())
      ok(resultado)
    })
  })
}

/** Os comandos longos vivos (ao fechar o Dangai, vao junto). */
const longos = new Set<ChildProcessWithoutNullStreams>()

/** Algum comando longo rodando (reinstalar o motor por baixo dele quebraria). */
export function motorOcupado(): boolean {
  return cortando() || longos.size > 0
}

/** A sondagem do motor (versao, placa), uma vez por sessao. */
let sondado: { versao: string; placa: string | null } | null = null

export async function estadoDoMotor(): Promise<MotorDoAncut> {
  const motor = await localizarMotor()
  if (!motor) return { achado: false, origem: '', qual: null, versao: null, placa: null, saida: pastaDeSaida(), motivo: SEM_MOTOR }
  if (!sondado) {
    const p = await perguntar<{ version?: string; gpuName?: string | null }>(['probe'], 'probe')
    if (p) sondado = { versao: String(p.version ?? ''), placa: p.gpuName ?? null }
  }
  return {
    achado: true,
    origem: motor.origem,
    qual: motor.qual,
    versao: sondado?.versao ?? null,
    placa: sondado?.placa ?? null,
    saida: pastaDeSaida(),
    ...(sondado ? {} : { motivo: 'O motor de cortes não respondeu. Se o AnCut estiver cortando, espere ele terminar e tente de novo.' }),
  }
}

/** Anime, temporada e episodio pelo nome do arquivo (a regra do motor). */
export async function lerNome(video: string): Promise<NomeLido | null> {
  const r = await perguntar<{ anime?: string; season?: number; episode?: number; kind?: string }>(['parse', video], 'parsed')
  if (!r) return null
  return {
    anime: String(r.anime ?? ''),
    temporada: Number(r.season) || 1,
    episodio: Number(r.episode) || 1,
    tipo: r.kind === 'BROLL' ? 'BROLL' : '',
  }
}

/** Em que pasta da saida um anime cai (a memoria de pastas do motor), e as que ja existem. */
export async function pastaDoAnime(anime: string): Promise<{ pasta: string; existentes: string[] } | null> {
  const r = await perguntar<{ folder?: string; existing?: unknown }>(['anime-folder', anime || '_'], 'anime-folder')
  if (!r) return null
  return {
    pasta: String(r.folder ?? anime),
    existentes: Array.isArray(r.existing) ? r.existing.filter((x): x is string => typeof x === 'string') : [],
  }
}

// ------------------------------------------------------------- o corte

let atual: ChildProcessWithoutNullStreams | null = null
/** O corte ja disse como acabou e o processo esta so saindo (o "done" chega antes do "close"). */
let saindo = false
/** Ele pediu para cancelar: o processo que fecha sem evento final foi cancelado, nao quebrou. */
let pediuCancelar = false

/** Espera o corte anterior acabar de sair (ate 15 s; depois, a forca -- ele ja disse que acabou). */
async function esperarOAnterior(): Promise<void> {
  const ate = Date.now() + 15_000
  while (atual && saindo && Date.now() < ate) await new Promise((r) => setTimeout(r, 50))
  if (atual && saindo) {
    try {
      atual.kill()
    } catch {
      /* ja tinha saido */
    }
    atual = null
    saindo = false
  }
}

export function cortando(): boolean {
  return atual !== null && !saindo
}

/** O corte parou no batismo, esperando os nomes (responderBatismo). */
let esperandoBatismo = false

/**
 * O batismo com os recortes e as fotos em URL (o media-server do Dangai): o
 * motor manda caminhos relativos a pasta do episodio, que a janela nao abre.
 */
function batismoComUrls(e: Extract<EventoDoCorte, { tipo: 'batismo' }>): EventoDoCorte {
  const b = e.batismo
  const url = (rel: string): string => (rel ? publish(join(b.pasta, rel)) : '')
  return {
    tipo: 'batismo',
    batismo: {
      ...b,
      fotos: b.fotos.map((f) => ({ ...f, foto: url(f.foto) })),
      grupos: b.grupos.map((g) => ({ ...g, recortes: g.recortes.map(url) })),
    },
  }
}

/**
 * OS NOMES DO BATISMO: o motor ficou aberto esperando (os recortes e as
 * contas nao sobreviveriam a uma ida ao disco). Com os nomes ele grava os
 * personagens, as referencias e termina o corte (o `pronto` chega pelo mesmo
 * aoEvento). Sem nenhum nome nao ha o que gravar: quem desiste cancela.
 */
export function responderBatismo(r: RespostaDoBatismo): boolean {
  const filho = atual
  if (!filho || !esperandoBatismo) return false
  const names: Record<string, string> = {}
  for (const [k, v] of Object.entries(r.nomes ?? {})) {
    const nome = typeof v === 'string' ? v.trim() : ''
    if (nome && /^-?\d+$/.test(k)) names[k] = nome
  }
  const removed: Record<string, number[]> = {}
  for (const [k, v] of Object.entries(r.removidos ?? {})) {
    if (!/^-?\d+$/.test(k) || !Array.isArray(v)) continue
    const idx = v.filter((n): n is number => Number.isInteger(n) && n >= 0)
    if (idx.length) removed[k] = idx
  }
  try {
    filho.stdin.write(`${JSON.stringify({ cmd: 'commit-discovery', names, removed })}\n`)
    esperandoBatismo = false
    return true
  } catch {
    return false
  }
}

/**
 * CORTA UM EPISODIO: manda o pedido e repassa cada evento (`aoEvento`); volta
 * com o evento do fim (pronto, falhou, cancelado). Morreu sem dizer nada (o
 * processo fechou com erro): vira falha com o codigo, e a fila segue.
 */
export async function cortar(pedido: PedidoDeCorte, aoEvento: (e: EventoDoCorte) => void): Promise<EventoDoCorte> {
  await esperarOAnterior()
  if (atual) return { tipo: 'falhou', mensagem: 'Já tem um corte em andamento.' }
  const motor = await localizarMotor()
  if (!motor) return { tipo: 'falhou', mensagem: SEM_MOTOR }
  const saida = pastaDeSaida()
  if (!saida) return { tipo: 'falhou', mensagem: 'Escolha antes onde guardar as cenas cortadas (a pasta dos animes), no alto desta janela.' }
  if (!existsSync(pedido.video)) return { tipo: 'falhou', mensagem: `O vídeo não está mais no lugar: ${pedido.video}` }

  return new Promise<EventoDoCorte>((ok) => {
    let ultimo: EventoDoCorte | null = null
    let sobra = ''
    saindo = false
    pediuCancelar = false
    const filho = spawn(motor.cmd, [...motor.args, 'run'], { cwd: motor.cwd, windowsHide: true, env: motor.env })
    atual = filho
    const linha = (l: string): void => {
      let cru: unknown
      try {
        cru = JSON.parse(l)
      } catch {
        return
      }
      const e = eventoDoMotor(cru)
      if (!e) return
      if (e.tipo === 'batismo') {
        // O motor fica aberto: a resposta vem por responderBatismo.
        esperandoBatismo = true
        aoEvento(batismoComUrls(e))
        return
      }
      if (e.tipo !== 'etapa') {
        ultimo = e
        saindo = true
      }
      aoEvento(e)
    }
    filho.stdout.setEncoding('utf-8')
    filho.stdout.on('data', (pedaco: string) => {
      sobra += pedaco
      const linhas = sobra.split('\n')
      sobra = linhas.pop() ?? ''
      for (const l of linhas) if (l.trim()) linha(l.trim())
    })
    filho.stderr.on('data', () => {})
    filho.on('error', (erro) => {
      if (!ultimo) ultimo = { tipo: 'falhou', mensagem: `O motor de cortes não abriu: ${erro.message}` }
    })
    filho.on('close', (codigo) => {
      if (sobra.trim()) linha(sobra.trim())
      esperandoBatismo = false
      if (atual === filho) {
        atual = null
        saindo = false
      }
      const fim: EventoDoCorte =
        ultimo ??
        (pediuCancelar
          ? { tipo: 'cancelado' }
          : {
              tipo: 'falhou',
              mensagem: codigo === 0 ? 'O motor terminou sem dizer como foi.' : `O motor de cortes fechou no meio do corte (código ${codigo}).`,
            })
      if (!ultimo) aoEvento(fim)
      ok(fim)
    })
    filho.stdin.write(`${JSON.stringify(pedidoParaOMotor(pedido, configDoMotor(), saida))}\n`)
  })
}

/**
 * Cancela o corte: o pedido educado (o motor para na proxima etapa) e, se em
 * 5 s ele nao saiu, a forca -- cancelar nunca pode deixar a tela presa.
 */
export function cancelarCorte(): void {
  const filho = atual
  if (!filho) return
  pediuCancelar = true
  try {
    filho.stdin.write(`${JSON.stringify({ cmd: 'cancel' })}\n`)
  } catch {
    filho.kill()
    return
  }
  setTimeout(() => {
    if (atual === filho) filho.kill()
  }, 5_000).unref?.()
}

/** Ao fechar o Dangai: o motor nao fica orfao segurando a placa. */
export function encerrarAncut(): void {
  try {
    atual?.kill()
  } catch {
    /* ja tinha saido */
  }
  atual = null
  for (const f of longos) {
    try {
      f.kill()
    } catch {
      /* idem */
    }
  }
  longos.clear()
}
