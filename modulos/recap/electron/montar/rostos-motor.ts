import { spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { medidasDo, type Formato } from '@shared/contract'
import type { FocoDoRosto, FonteDoRosto, LoteDeRostos, PedidoDeRosto, RostosDoLote } from '../../shared/edicao-rapida'
import type { EpisodeIndex } from '../../shared/episodio'
import { fichasDoNome } from '@shared/nomes'
import { abrirIndicePorId } from '../episodio/abrir-indice'
import { ffmpegPath } from '../ffmpeg-path'
import { configDoMotor, pastaDeDadosDoMotor } from '../motor'
import { focoNoQuadro, focosDosPedacos, instantesDoTrecho } from './foco'
import { chaveDoPedaco } from './projeto'
import { pythonDoMotor } from '../python-do-motor'
import { ambienteDoRuntime, backendDoRuntime, usaRuntime } from '../motor-runtime'

/**
 * O ROSTO PELO MOTOR (Edicao rapida, agente B, 14/10).
 *
 * O detector antigo do Dangai (lbpcascade, ./foco.ts) e frontal e conservador:
 * no S4-37 achou rosto em 6 de 20 blocos. Aqui o enquadramento vem do YOLO de
 * rosto de anime do MOTOR (motor/app/matching/face_detector.py, o mesmo do
 * AnCut, com a cabeca de reserva para perfil e personagem de longe), num modo
 * headless NOVO e pequeno (`python -m app.headless rostos`, motor/app/rostos.py,
 * anotado em motor/STUDIO.md): UM processo para o lote inteiro, porque importar
 * o torch e subir a GPU custa ~8 s.
 *
 * Divisao do trabalho:
 * - o motor DETECTA (rosto/cabeca, com confianca) nos instantes pedidos e,
 *   quando o quadro tem 2+ rostos e um citado da frase esta entre os que o
 *   INDICE reconhece no plano, IDENTIFICA pelo CLIP qual rosto e quem -- so
 *   entre esses do plano (conjunto fechado, 2-3 pessoas), com as fotos do
 *   elenco do cache do motor do Studio (so lido). Contra o elenco inteiro o
 *   CLIP errava demais (medido no S4-37: Gen virava Gozan);
 * - daqui sai a DECISAO (escolherNoPedaco, pura e testada): os rostos dos
 *   instantes viram trilhas (o mesmo rosto ao longo do pedaco), e o foco e a
 *   mediana da trilha escolhida -- um foco so por bloco, sem tremer. Escolhe a
 *   trilha do personagem citado (identificado pelo motor, ou pelo indice quando
 *   so ha uma pessoa na tela e o plano so tem ela); sem isso, a de mais
 *   presenca x tamanho ("o maior rosto", suavizado). Outro rosto grande que
 *   cabe junto na janela 9:16 entra no enquadramento (plano de dois).
 *
 * Reserva: motor desligado (lote.motor false), sem motor (app instalado sem o
 * runtime: motor-runtime/), erro ao subir ou teto: os pedacos sem resposta vao para o detector
 * antigo (focosDosPedacos), e `fonte` diz quem achou cada um. Rosto e melhoria,
 * nunca requisito: nada daqui lanca para quem chama.
 *
 * Teto: lote.tetoMs vale para a etapa inteira. O motor recebe ate 75% dele; o
 * resto fica para o detector antigo terminar o que faltou.
 */

/** Um quadro como o motor devolve (pixels do quadro original). */
export interface QuadroDoMotor {
  t: number
  /** false = o instante nao abriu (arquivo ruim, depois do fim). */
  ok: boolean
  rostos: RostoDoMotor[]
}

export interface RostoDoMotor {
  x: number
  y: number
  w: number
  h: number
  conf: number
  tipo: 'rosto' | 'cabeca'
  /** O nome CITADO (como veio no pedido) quando o motor identificou. */
  personagem: string | null
  /** Similaridade com quem o motor achou mais parecido (so quando identificou). */
  sim: number | null
  /** O mais parecido do elenco (pasta do personagem), so quando identificou. */
  quem: string | null
}

/** O que o motor devolve de um pedaco. */
export interface RostosDoPedaco {
  largura: number
  altura: number
  quadros: QuadroDoMotor[]
}

// ================================================================ decisao

/** Como o foco foi escolhido (o teste e o log contam). */
export type ComoEscolheu = 'citado' | 'indice' | 'maior' | 'nenhum'

export interface EscolhaNoPedaco {
  /** Ponto do quadro (fracao 0..1) que vai ao centro da janela. null = centro, sem rosto. */
  centro: { centroX: number; centroY: number } | null
  /** O personagem citado que ficou enquadrado. null = o maior rosto (ou nenhum). */
  personagem: string | null
  como: ComoEscolheu
  /** Outros rostos que couberam junto na janela (plano de dois). */
  juntos: number
  instantesComRosto: number
  instantes: number
}

interface Deteccao {
  q: number
  cx: number
  cy: number
  w: number
  h: number
  peso: number
  personagem: string | null
}

/** A cabeca (rosto + cabelo) tem ~2x a area do rosto: pesa metade, para nao ganhar so por ser cabeca. */
const PESO_DA_CABECA = 0.5
/** O mesmo rosto de um instante ao outro: anda menos que o proprio tamanho e nao muda de escala demais. */
const ANDA_NO_MAXIMO = 1.0
const ESCALA_NO_MAXIMO = 3
/** O citado identificado so ganha do maior quando pesa pelo menos isto dele. */
const CITADO_PESO_MIN = 0.2
/** Outro rosto entra junto quando pesa pelo menos isto do escolhido... */
const JUNTO_PESO_MIN = 0.5
/** ...e os dois cabem nesta fracao da janela visivel (folga para o Ken Burns). */
const JUNTO_CABE = 0.9

/** Mediana ponderada (poucos valores: a trilha tem no maximo um por instante). */
function medianaPonderada(valores: readonly { v: number; p: number }[]): number {
  const ordem = [...valores].sort((a, b) => a.v - b.v)
  const total = ordem.reduce((s, x) => s + x.p, 0)
  let acc = 0
  for (let i = 0; i < ordem.length; i++) {
    acc += ordem[i]!.p
    // Exatamente na metade (dois instantes de mesmo peso): o meio dos dois.
    if (Math.abs(acc - total / 2) <= total * 1e-9 && i + 1 < ordem.length) return (ordem[i]!.v + ordem[i + 1]!.v) / 2
    if (acc >= total / 2) return ordem[i]!.v
  }
  return ordem[ordem.length - 1]?.v ?? 0.5
}

/** A vogal longa do romaji: "Senkuu" (MyAnimeList) == "Senku" (roteiro). O semVogalLonga do nomes.ts. */
function fichasCurtas(nome: string): string[] {
  return fichasDoNome(nome).map((f) => f.replace(/ou/g, 'o').replace(/uu/g, 'u').replace(/oo/g, 'o'))
}

/** A mesma pessoa: as mesmas palavras, ou um nome contido no outro ("Senku" em "Ishigami, Senkuu"). */
export function mesmaPessoa(a: string, b: string): boolean {
  const fa = new Set(fichasCurtas(a))
  const fb = new Set(fichasCurtas(b))
  if (fa.size === 0 || fb.size === 0) return false
  const [menor, maior] = fa.size <= fb.size ? [fa, fb] : [fb, fa]
  for (const f of menor) if (!maior.has(f)) return false
  return true
}

/** A largura visivel da janela do formato, em fracao da largura do quadro. */
export function janelaDoFormato(largura: number, altura: number, formato: Formato = 'short'): number {
  const m = medidasDo(formato)
  const escala = Math.max(m.renderWidth / largura, m.renderHeight / altura)
  return Math.min(1, m.width / escala / largura)
}

/**
 * O foco de UM pedaco a partir dos quadros do motor (pura).
 *
 * `citados`: quem a frase cita, em ordem de preferencia. `noPlano`: quem o
 * indice reconhece no plano (pode estar vazio). `janela`: janelaDoFormato.
 */
export function escolherNoPedaco(
  pedaco: RostosDoPedaco,
  citados: readonly string[],
  noPlano: readonly string[],
  janela: number,
): EscolhaNoPedaco {
  const { largura, altura, quadros } = pedaco
  const instantes = quadros.length
  const instantesComRosto = quadros.filter((q) => q.ok && q.rostos.length > 0).length
  const nada: EscolhaNoPedaco = { centro: null, personagem: null, como: 'nenhum', juntos: 0, instantesComRosto, instantes }
  if (largura <= 0 || altura <= 0 || instantesComRosto === 0) return nada

  // 1. Trilhas: o mesmo rosto de um instante ao outro (guloso, do maior ao menor).
  const trilhas: Deteccao[][] = []
  quadros.forEach((quadro, q) => {
    if (!quadro.ok) return
    const dets: Deteccao[] = quadro.rostos
      .filter((r) => r.w > 0 && r.h > 0)
      .map((r) => {
        const w = r.w / largura
        const h = r.h / altura
        return {
          q,
          cx: (r.x + r.w / 2) / largura,
          cy: (r.y + r.h / 2) / altura,
          w,
          h,
          peso: w * h * (r.tipo === 'cabeca' ? PESO_DA_CABECA : 1),
          personagem: r.personagem,
        }
      })
      .sort((a, b) => b.peso - a.peso)
    const usadas = new Set<Deteccao[]>()
    for (const d of dets) {
      let melhor: Deteccao[] | null = null
      let menor = Infinity
      for (const t of trilhas) {
        if (usadas.has(t)) continue
        const u = t[t.length - 1]!
        if (u.q >= q) continue
        const escala = (d.w * d.h) / (u.w * u.h)
        if (escala > ESCALA_NO_MAXIMO || escala < 1 / ESCALA_NO_MAXIMO) continue
        const anda = Math.hypot((d.cx - u.cx) / Math.max(d.w, u.w), (d.cy - u.cy) / Math.max(d.h, u.h))
        if (anda < ANDA_NO_MAXIMO && anda < menor) {
          menor = anda
          melhor = t
        }
      }
      if (melhor) {
        melhor.push(d)
        usadas.add(melhor)
      } else {
        const nova = [d]
        trilhas.push(nova)
        usadas.add(nova)
      }
    }
  })
  if (trilhas.length === 0) return nada

  const pesoDa = (t: readonly Deteccao[]): number => t.reduce((s, d) => s + d.peso, 0)
  const rankDa = (t: readonly Deteccao[]): number => {
    let rank = Infinity
    for (const d of t) {
      if (!d.personagem) continue
      const i = citados.findIndex((c) => c === d.personagem || mesmaPessoa(c, d.personagem!))
      if (i >= 0 && i < rank) rank = i
    }
    return rank
  }

  // 2. Quem: o citado identificado (o de maior preferencia); senao o maior.
  const porPeso = [...trilhas].sort((a, b) => pesoDa(b) - pesoDa(a))
  let escolhida = porPeso[0]!
  let como: ComoEscolheu = 'maior'
  let personagem: string | null = null
  if (citados.length > 0) {
    // Rosto miudo de fundo nao puxa o quadro, mesmo marcado: o CLIP erra mais
    // neles (no S4-37 um figurante de fundo saiu "Chrome" com sim maior que o Chrome).
    const maiorPeso = pesoDa(porPeso[0]!)
    const comRank = porPeso
      .filter((t) => pesoDa(t) >= CITADO_PESO_MIN * maiorPeso)
      .map((t) => ({ t, rank: rankDa(t) }))
      .filter((x) => Number.isFinite(x.rank))
    if (comRank.length > 0) {
      comRank.sort((a, b) => a.rank - b.rank || pesoDa(b.t) - pesoDa(a.t))
      escolhida = comRank[0]!.t
      como = 'citado'
      personagem = citados[comRank[0]!.rank] ?? null
    } else if (trilhas.length === 1) {
      // Uma pessoa so na tela, e o indice diz que o plano tem UMA pessoa e
      // ela e citada: e ela (o que o indice sabe, sem precisar do CLIP).
      const pessoas: string[] = []
      for (const n of noPlano) if (!pessoas.some((p) => mesmaPessoa(p, n))) pessoas.push(n)
      const unica = pessoas.length === 1 ? pessoas[0]! : null
      const citado = unica ? citados.find((c) => mesmaPessoa(c, unica)) : undefined
      if (citado) {
        como = 'indice'
        personagem = citado
      }
    }
  }

  // 3. Onde: a mediana da trilha (suaviza o pedaco inteiro num foco so).
  const caixa = (t: readonly Deteccao[]): { cx: number; cy: number; w: number; h: number } => ({
    cx: medianaPonderada(t.map((d) => ({ v: d.cx, p: d.peso }))),
    cy: medianaPonderada(t.map((d) => ({ v: d.cy, p: d.peso }))),
    w: medianaPonderada(t.map((d) => ({ v: d.w, p: d.peso }))),
    h: medianaPonderada(t.map((d) => ({ v: d.h, p: d.peso }))),
  })
  const base = caixa(escolhida)
  let x0 = base.cx - base.w / 2
  let x1 = base.cx + base.w / 2
  let y0 = base.cy - base.h / 2
  let y1 = base.cy + base.h / 2
  let juntos = 0
  const pesoEscolhida = pesoDa(escolhida)
  for (const t of porPeso) {
    if (t === escolhida || pesoDa(t) < JUNTO_PESO_MIN * pesoEscolhida) continue
    const c = caixa(t)
    const nx0 = Math.min(x0, c.cx - c.w / 2)
    const nx1 = Math.max(x1, c.cx + c.w / 2)
    if (nx1 - nx0 > janela * JUNTO_CABE) continue
    x0 = nx0
    x1 = nx1
    y0 = Math.min(y0, c.cy - c.h / 2)
    y1 = Math.max(y1, c.cy + c.h / 2)
    juntos += 1
  }
  return {
    centro: { centroX: (x0 + x1) / 2, centroY: (y0 + y1) / 2 },
    personagem,
    como,
    juntos,
    instantesComRosto,
    instantes,
  }
}

// ================================================================== motor

/** Para os testes (sem Electron) e para trocar o motor; tudo opcional. */
export interface OpcoesDoRostoPeloMotor {
  /** O python do venv do motor. Padrao: <appPath>/motor/.venv/Scripts/python.exe. */
  python?: string
  /** A pasta motor/ (cwd do processo). */
  cwd?: string
  /** ANIRECAP_MOTOR_DADOS (elenco e config do motor, so lidos). Padrao: pastaDeDadosDoMotor(). */
  dados?: string
  /** O indice ja aberto. Padrao: abrirIndicePorId(lote.episodioId); null = sem indice. */
  indice?: Pick<EpisodeIndex, 'anime' | 'temporada' | 'planos'> | null
  /** O stderr do motor. Padrao: <dados>/logs/ultimos-rostos.log. null = nao grava. */
  log?: string | null
  /** false = so detectar (nao sobe o CLIP). Padrao: true. */
  identificar?: boolean
}

interface Backend {
  python: string
  cwd: string
  dados: string
  /** O runtime do app instalado: o ambiente vem do ambienteDoRuntime. */
  runtime?: { cudaOk: boolean; modelos: string }
}

function backend(o: OpcoesDoRostoPeloMotor): Backend | { erro: string } {
  try {
    if (o.python && o.cwd) return { python: o.python, cwd: o.cwd, dados: o.dados ?? pastaDeDadosDoMotor() }
    const c = configDoMotor()
    // App instalado: o runtime baixado no 1o uso (o mesmo do motor.ts). Sem ele, o detector antigo.
    if (usaRuntime()) {
      const r = backendDoRuntime()
      if ('erro' in r) return { erro: r.erro }
      return { python: r.python, cwd: r.cwd, dados: o.dados ?? pastaDeDadosDoMotor(), runtime: { cudaOk: r.cudaOk, modelos: r.modelos } }
    }
    const cwd = join(c.appPath, 'motor')
    const python =
      process.platform === 'win32' ? join(cwd, '.venv', 'Scripts', 'python.exe') : join(cwd, '.venv', 'bin', 'python')
    if (!existsSync(python)) return { erro: 'motor de personagens nao instalado' }
    return { python, cwd, dados: o.dados ?? pastaDeDadosDoMotor() }
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) }
  }
}

/** Processos vivos, para a saida do app nao deixar orfao. */
const vivos = new Set<ChildProcess>()

function matarArvore(filho: ChildProcess, sincrono = false): void {
  const pid = filho.pid
  if (!pid || filho.exitCode !== null || filho.signalCode !== null) return
  if (process.platform !== 'win32') {
    filho.kill('SIGKILL')
    return
  }
  // O child.kill() so derruba o python no Windows; o /T leva o ffmpeg de reserva junto.
  const args = ['/PID', String(pid), '/T', '/F']
  if (sincrono) spawnSync('taskkill', args, { windowsHide: true, timeout: 5000, stdio: 'ignore' })
  else spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => filho.kill())
}

/** Ha um lote de rostos rodando (o runtime nao reinstala por baixo dele). */
export function rostosRodando(): boolean {
  return [...vivos].some((f) => f.exitCode === null && f.signalCode === null)
}

/** Mata o motor de rostos que estiver rodando (saida do app). */
export function encerrarRostosDoMotor(): void {
  for (const f of vivos) matarArvore(f, true)
  vivos.clear()
}

export interface ItemDoMotor {
  chave: string
  arquivo: string
  instantes: number[]
  /** Quem a frase cita, em ordem de preferencia. */
  personagens: string[]
  /**
   * Quem o INDICE reconhece no plano: o motor identifica os rostos ENTRE eles
   * (conjunto fechado). Vazio = nao identifica -- so vale quando um citado
   * esta no plano (candidatosDoPedaco).
   */
  candidatos: string[]
}

export interface RespostaDoMotor {
  resultados: Map<string, RostosDoPedaco>
  /** null = respondeu tudo. Senao, por que parou (ASCII). */
  falha: string | null
  /** Tempo ate os modelos subirem (torch + YOLO + aquecer a GPU). */
  prontoMs: number | null
  gpu: boolean | null
  /** A pasta do elenco usada para identificar. null = sem identificar. */
  elenco: string | null
  semElenco: string | null
  identificados: number
  clipMs: number
  ms: number
}

/**
 * Roda o modo `rostos` do motor e junta as respostas. Nunca lanca: falha vira
 * `falha` e o que chegou antes fica em `resultados`.
 */
export function rodarMotorDeRostos(
  itens: readonly ItemDoMotor[],
  extra: { anime: string | null; temporada: number | null; identificar: boolean },
  limiteMs: number,
  o: OpcoesDoRostoPeloMotor = {},
): Promise<RespostaDoMotor> {
  const inicio = Date.now()
  const resposta: RespostaDoMotor = {
    resultados: new Map(),
    falha: null,
    prontoMs: null,
    gpu: null,
    elenco: null,
    semElenco: null,
    identificados: 0,
    clipMs: 0,
    ms: 0,
  }
  const b = backend(o)
  if ('erro' in b) return Promise.resolve({ ...resposta, falha: b.erro })

  return new Promise((resolver) => {
    const stderr: string[] = []
    let acabou = false
    let fim = false
    let filho: ChildProcessWithoutNullStreams

    const terminar = (falha: string | null): void => {
      if (acabou) return
      acabou = true
      clearTimeout(relogio)
      vivos.delete(filho)
      try {
        filho.stdin.end()
      } catch {
        // ja fechado
      }
      if (!fim && !falha) falha = stderr.length ? `o motor parou: ${ascii(stderr.slice(-3).join(' | ')).slice(0, 300)}` : 'o motor parou sem responder'
      resposta.falha = falha
      resposta.ms = Date.now() - inicio
      const log = o.log === undefined ? join(b.dados, 'logs', 'ultimos-rostos.log') : o.log
      if (log) {
        try {
          mkdirSync(dirname(log), { recursive: true })
          writeFileSync(log, stderr.slice(-400).join('\n'), 'utf8')
        } catch {
          // log e conveniencia
        }
      }
      resolver(resposta)
    }

    let env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      // O run.py do exe liga isto; rodando o modulo, a ultralytics tentaria um pip install sozinha.
      YOLO_AUTOINSTALL: 'false',
      ANIRECAP_MOTOR_DADOS: b.dados,
    }
    if (b.runtime) {
      // App instalado: ffmpeg do app primeiro, Python isolado, sem .pyc na pasta de instalacao.
      env = ambienteDoRuntime(env, b.runtime)
    } else {
      const chavePath = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
      env[chavePath] = [env[chavePath], dirname(ffmpegPath)].filter(Boolean).join(delimiter)
    }

    try {
      // Direto no Python base, sem o lancador do venv (python-do-motor.ts).
      const py = pythonDoMotor(b.python)
      filho = spawn(py.cmd, ['-m', 'app.headless', 'rostos'], { cwd: b.cwd, windowsHide: true, env: { ...env, ...py.env } })
    } catch (e) {
      resolver({ ...resposta, falha: e instanceof Error ? e.message : String(e), ms: Date.now() - inicio })
      return
    }
    vivos.add(filho)
    const relogio = setTimeout(() => {
      matarArvore(filho)
      terminar(`o motor nao terminou em ${Math.round(limiteMs / 1000)} s`)
    }, limiteMs)

    let resto = ''
    filho.stdout.setEncoding('utf8')
    filho.stdout.on('data', (d: string) => {
      resto += d
      let i = resto.indexOf('\n')
      while (i >= 0) {
        const linha = resto.slice(0, i).trim()
        resto = resto.slice(i + 1)
        if (linha) lerLinha(linha)
        i = resto.indexOf('\n')
      }
    })
    let resto2 = ''
    filho.stderr.setEncoding('utf8')
    filho.stderr.on('data', (d: string) => {
      resto2 += d
      const linhas = resto2.split(/\r?\n/)
      resto2 = linhas.pop() ?? ''
      for (const l of linhas) if (l.trim()) stderr.push(l)
      if (stderr.length > 600) stderr.splice(0, stderr.length - 600)
    })
    filho.stdin.on('error', () => {})
    filho.on('error', (e) => terminar(e.message))
    filho.on('close', () => terminar(null))

    // A requisicao na 1a linha; o stdin fica ABERTO: pipe fechado o motor le como "o host morreu".
    filho.stdin.write(
      `${JSON.stringify({ itens, anime: extra.anime, temporada: extra.temporada, identificar: extra.identificar })}\n`,
    )

    function lerLinha(linha: string): void {
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(linha) as Record<string, unknown>
      } catch {
        return
      }
      if (ev['type'] === 'pronto') {
        resposta.prontoMs = num(ev['ms'])
        resposta.gpu = ev['gpu'] === true
        resposta.elenco = typeof ev['elenco'] === 'string' ? ev['elenco'] : null
        resposta.semElenco = typeof ev['semElenco'] === 'string' ? ev['semElenco'] : null
      } else if (ev['type'] === 'rostos' && typeof ev['chave'] === 'string') {
        resposta.resultados.set(ev['chave'], {
          largura: num(ev['largura']) ?? 0,
          altura: num(ev['altura']) ?? 0,
          quadros: Array.isArray(ev['quadros']) ? (ev['quadros'] as unknown[]).map(lerQuadro) : [],
        })
      } else if (ev['type'] === 'fim') {
        fim = true
        resposta.identificados = num(ev['identificados']) ?? 0
        resposta.clipMs = num(ev['clipMs']) ?? 0
      } else if (ev['type'] === 'failed') {
        const m = typeof ev['message'] === 'string' ? ev['message'] : 'erro do motor'
        matarArvore(filho)
        terminar(ascii(m).slice(0, 300))
      }
    }
  })
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function ascii(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?')
}

function lerQuadro(cru: unknown): QuadroDoMotor {
  const q = (cru && typeof cru === 'object' ? cru : {}) as Record<string, unknown>
  const rostos = Array.isArray(q['rostos']) ? (q['rostos'] as unknown[]) : []
  return {
    t: num(q['t']) ?? 0,
    ok: q['ok'] !== false,
    rostos: rostos
      .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
      .map((r) => ({
        x: num(r['x']) ?? 0,
        y: num(r['y']) ?? 0,
        w: num(r['w']) ?? 0,
        h: num(r['h']) ?? 0,
        conf: num(r['conf']) ?? 0,
        tipo: r['tipo'] === 'cabeca' ? ('cabeca' as const) : ('rosto' as const),
        personagem: typeof r['personagem'] === 'string' ? r['personagem'] : null,
        sim: num(r['sim']),
        quem: typeof r['quem'] === 'string' ? r['quem'] : null,
      }))
      .filter((r) => r.w > 0 && r.h > 0),
  }
}

// ================================================================== o lote

/** Fracao do teto que o motor pode gastar; o resto e do detector antigo. */
const PARTE_DO_MOTOR = 0.75

/** Quem o indice reconhece no plano que e este mp4 (pelo caminho, sem caixa nem barra). */
function personagensPorArquivo(indice: Pick<EpisodeIndex, 'planos'> | null): (arquivo: string) => string[] {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
  const mapa = new Map<string, string[]>()
  for (const p of indice?.planos ?? []) mapa.set(norm(p.arquivo), p.personagens.map((x) => x.nome))
  return (arquivo) => mapa.get(norm(arquivo)) ?? []
}

/** Os citados com quem o indice reconhece no plano na frente (o motor tenta nessa ordem). */
function citadosNaOrdem(citados: readonly string[], noPlano: readonly string[]): string[] {
  const unicos: string[] = []
  for (const c of citados) if (c.trim() && !unicos.some((u) => mesmaPessoa(u, c))) unicos.push(c)
  const naTela = unicos.filter((c) => noPlano.some((n) => mesmaPessoa(c, n)))
  return [...naTela, ...unicos.filter((c) => !naTela.includes(c))]
}

/**
 * Quem o motor pode identificar no pedaco: os nomes do indice no plano, mas so
 * quando algum citado esta entre eles (senao a preferencia nao muda nada e o
 * CLIP nem sobe). Grafias da mesma pessoa vao uma vez.
 */
export function candidatosDoPedaco(citados: readonly string[], noPlano: readonly string[]): string[] {
  if (!citados.some((c) => noPlano.some((n) => mesmaPessoa(c, n)))) return []
  const unicos: string[] = []
  for (const n of noPlano) if (!unicos.some((u) => mesmaPessoa(u, n))) unicos.push(n)
  return unicos
}

export async function rostosDosPedacos(lote: LoteDeRostos, o: OpcoesDoRostoPeloMotor = {}): Promise<RostosDoLote> {
  const inicio = Date.now()
  const limite = inicio + lote.tetoMs
  const avisos: string[] = []
  const formato = lote.formato
  const focos = new Map<string, FocoDoRosto>()

  // O indice: quem esta em cada plano e o anime (para o motor achar o elenco).
  let indice: Pick<EpisodeIndex, 'anime' | 'temporada' | 'planos'> | null = o.indice ?? null
  if (o.indice === undefined && lote.episodioId) {
    try {
      indice = abrirIndicePorId(lote.episodioId).indice
    } catch {
      indice = null
    }
  }
  const noPlanoDe = personagensPorArquivo(indice)

  // Um item por chave (o mesmo pedaco pode vir duas vezes).
  const unicos = new Map<string, PedidoDeRosto>()
  for (const p of lote.pedidos) if (!unicos.has(p.chave)) unicos.set(p.chave, p)
  const pedidos = [...unicos.values()]

  // 1. O motor.
  if (lote.motor && pedidos.length > 0) {
    const itens: ItemDoMotor[] = pedidos.map((p) => ({
      chave: p.chave,
      arquivo: p.arquivo,
      instantes: instantesDoTrecho(p.de, Math.max(p.ate, p.de)),
      personagens: citadosNaOrdem(p.personagens, noPlanoDe(p.arquivo)),
      candidatos: candidatosDoPedaco(p.personagens, noPlanoDe(p.arquivo)),
    }))
    const r = await rodarMotorDeRostos(
      itens,
      { anime: indice?.anime ?? null, temporada: indice?.temporada ?? null, identificar: o.identificar !== false },
      Math.max(1000, Math.round(lote.tetoMs * PARTE_DO_MOTOR)),
      o,
    )
    if (r.falha) {
      avisos.push(
        r.resultados.size > 0
          ? `Motor parou no meio (${r.falha}): o resto foi pelo detector antigo.`
          : `Motor indisponivel (${r.falha}): usei o detector antigo.`,
      )
    }
    for (const item of itens) {
      const achado = r.resultados.get(item.chave)
      if (!achado) continue
      const escolha = escolherNoPedaco(
        achado,
        item.personagens,
        noPlanoDe(item.arquivo),
        janelaDoFormato(achado.largura || 1920, achado.altura || 1080, formato),
      )
      const foco = escolha.centro ? focoNoQuadro(escolha.centro, achado.largura, achado.altura, formato) : null
      focos.set(item.chave, {
        chave: item.chave,
        focusX: foco?.focusX ?? 0.5,
        focusY: foco?.focusY ?? 0.5,
        focusAuto: foco !== null,
        fonte: foco ? 'motor' : null,
        personagem: escolha.personagem,
        instantesComRosto: escolha.instantesComRosto,
        instantes: escolha.instantes,
      })
    }
  }

  // 2. A reserva: o detector antigo nos pedacos que o motor nao respondeu.
  const faltam = pedidos.filter((p) => !focos.has(p.chave))
  if (faltam.length > 0) {
    const resta = limite - Date.now()
    let achados = new Map<string, { focusX: number; focusY: number; focusAuto: boolean }>()
    if (resta > 500) {
      try {
        achados = await focosDosPedacos(
          faltam.map((p) => ({ arquivo: p.arquivo, de: p.de, ate: Math.max(p.ate, p.de) })),
          resta,
          formato,
        )
      } catch {
        avisos.push('Nao deu para procurar os rostos: os blocos ficam no centro.')
      }
    } else {
      avisos.push('Sem tempo para procurar os rostos que faltaram: ficam no centro.')
    }
    for (const p of faltam) {
      const f = achados.get(chaveDoPedaco({ arquivo: p.arquivo, de: p.de }))
      focos.set(p.chave, {
        chave: p.chave,
        focusX: f?.focusX ?? 0.5,
        focusY: f?.focusY ?? 0.5,
        focusAuto: f?.focusAuto ?? false,
        fonte: f ? 'lbp' : null,
        personagem: null,
        // O detector antigo olha os mesmos 3 instantes e nao diz em quantos achou.
        instantesComRosto: f ? 1 : 0,
        instantes: instantesDoTrecho(p.de, p.ate).length,
      })
    }
  }

  // Um por pedido, na ordem dos pedidos (repetidos ganham o foco do primeiro).
  const lista: FocoDoRosto[] = lote.pedidos.map((p) => ({ ...focos.get(p.chave)!, chave: p.chave }))
  const comRosto = lista.filter((f) => f.focusAuto).length
  const fontes = new Set(lista.filter((f) => f.focusAuto).map((f) => f.fonte).filter((f): f is FonteDoRosto => f !== null))
  return {
    focos: lista,
    fonte: fontes.size === 0 ? 'nenhum' : fontes.size > 1 ? 'misto' : [...fontes][0]!,
    comRosto,
    total: lista.length,
    avisos,
    ms: Date.now() - inicio,
  }
}
