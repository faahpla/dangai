import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  eventoDoMotor,
  pedidoParaOMotor,
  type ConfigDoMotor,
  type EventoDoCorte,
  type MotorDoAncut,
  type NomeLido,
  type PedidoDeCorte,
} from '@shared/ancut'

/**
 * [ancut] O MOTOR DO ANCUT, falado daqui (20/11, "a estrutura do AnCut no
 * Dangai"). O Dangai e uma segunda tela para o MESMO motor que o AnCut usa:
 * os mesmos comandos de app/headless.py, o mesmo config.json, o mesmo banco.
 * Nada do motor e copiado ou mudado -- um episodio cortado aqui e igual a um
 * cortado la, e os dois apps convivem.
 *
 * Como o AnCut (src/main/services/python-service.ts dele): cada consulta e um
 * processo curto que responde uma linha JSON; o corte e um processo longo que
 * le o pedido do stdin e escreve um evento por linha no stdout (o log humano
 * vai no stderr). Um corte por vez -- o motor segura a placa de video.
 */

export interface LocalDoMotor {
  cmd: string
  args: string[]
  cwd: string
  /** De onde veio, para a mensagem ("AnCut HUB instalado"). */
  origem: string
}

/**
 * O ambiente do motor: sem o UTF-8, o Python do Windows em portugues escreve
 * "análise" em cp1252 e o acento chega quebrado (o mesmo conserto do AnCut).
 */
const AMBIENTE: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' }

const deExe = (exe: string, origem: string): LocalDoMotor | null =>
  existsSync(exe) ? { cmd: exe, args: ['--headless'], cwd: dirname(exe), origem } : null

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
      return { cmd: v, args: ['-m', 'app.headless'], cwd: pasta, origem: 'motor de teste' }
    }
    return deExe(v, 'motor de teste')
  }
  const doAncut = process.env['ANCUT_BACKEND']
  return doAncut ? deExe(doAncut, 'ANCUT_BACKEND') : null
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

/** O motor do AnCut nesta maquina, ou null. Achado uma vez (sem achar, procura de novo na proxima). */
export async function localizarMotor(): Promise<LocalDoMotor | null> {
  if (lembrado && existsSync(lembrado.cmd)) return lembrado
  const daqui = doAmbiente()
  if (daqui) return (lembrado = daqui)
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

const SEM_MOTOR =
  'O motor do AnCut não está neste computador. O corte usa o mesmo motor do AnCut HUB: instale o AnCut HUB uma vez (ele traz o motor), e o Dangai passa a cortar sozinho.'

// ------------------------------------------------------------- as configuracoes

/** O config.json do motor (o mesmo que o AnCut le e grava). */
export function caminhoDaConfig(): string {
  return join(process.env['LOCALAPPDATA'] ?? '', 'CorteCenas', 'CorteCenas', 'config.json')
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
    const filho = spawn(motor.cmd, [...motor.args, ...args], { cwd: motor.cwd, windowsHide: true, env: AMBIENTE })
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

/** A sondagem do motor (versao, placa), uma vez por sessao. */
let sondado: { versao: string; placa: string | null } | null = null

export async function estadoDoMotor(): Promise<MotorDoAncut> {
  const motor = await localizarMotor()
  if (!motor) return { achado: false, origem: '', versao: null, placa: null, saida: pastaDeSaida(), motivo: SEM_MOTOR }
  if (!sondado) {
    const p = await perguntar<{ version?: string; gpuName?: string | null }>(['probe'], 'probe')
    if (p) sondado = { versao: String(p.version ?? ''), placa: p.gpuName ?? null }
  }
  return {
    achado: true,
    origem: motor.origem,
    versao: sondado?.versao ?? null,
    placa: sondado?.placa ?? null,
    saida: pastaDeSaida(),
    ...(sondado ? {} : { motivo: 'O motor do AnCut não respondeu. Feche o AnCut se ele estiver cortando e tente de novo.' }),
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
  if (!saida) return { tipo: 'falhou', mensagem: 'O AnCut ainda não tem pasta de saída. Escolha a pasta nas configurações do AnCut (onde ficam os animes cortados).' }
  if (!existsSync(pedido.video)) return { tipo: 'falhou', mensagem: `O vídeo não está mais no lugar: ${pedido.video}` }

  return new Promise<EventoDoCorte>((ok) => {
    let ultimo: EventoDoCorte | null = null
    let sobra = ''
    saindo = false
    pediuCancelar = false
    const filho = spawn(motor.cmd, [...motor.args, 'run'], { cwd: motor.cwd, windowsHide: true, env: AMBIENTE })
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
      if (!ultimo) ultimo = { tipo: 'falhou', mensagem: `O motor do AnCut não abriu: ${erro.message}` }
    })
    filho.on('close', (codigo) => {
      if (sobra.trim()) linha(sobra.trim())
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
              mensagem: codigo === 0 ? 'O motor terminou sem dizer como foi.' : `O motor do AnCut fechou no meio do corte (código ${codigo}).`,
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
}
