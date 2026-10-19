import { spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { LibraryClip } from '@shared/channels'
import type { EpisodeIndex } from '../../shared/episodio'
import type { Frase } from '../../shared/roteiro'
import {
  confiancaDasTagsGravadas,
  kDoKeyframe,
  linhasDaMatriz,
  posDoKeyframe,
  type CamadasDoCasar,
  type QuadroDaVisao,
  type SinaisDoCasar,
} from '../../shared/visao'
import type { ConfigDasCenas } from '../../shared/config'
import { etiquetarComConfianca, taggerReady } from '../../../../electron/services/tagger'
import { pastaDoPerfil } from '../episodio/perfil'
import { garantirGravavel } from '../episodio/protegidas'
import { ffmpegPath } from '../ffmpeg-path'
import { configDoMotor, pastaDeDadosDoMotor } from '../motor'
import { ambienteDoRuntime, backendDoRuntime, usaRuntime } from '../motor-runtime'
import { pythonDoMotor } from '../python-do-motor'

/**
 * [recap] O QUE SE VE das cenas (lote 2 das ideias do Levi, C1/C2/C3/C7): o
 * servico que pede ao motor (modo `cenas`, motor/app/cenas.py) e ao
 * etiquetador do nucleo (electron/services/tagger.ts) e guarda o resultado.
 *
 * - Do EPISODIO (uma vez por corte): o CLIP, a beleza e a nitidez de cada
 *   keyframe, o sentido de cada fala da legenda e as etiquetas de cada plano.
 *   Mora ao lado do indice (<pasta do episodio.json>/visao), ou no perfil do
 *   modulo se aquela pasta for so leitura. Roda sozinho depois do corte
 *   (complementar) e, se faltar, no passo 4.
 * - Das FRASES (a cada sugestao): o CLIP da `visualEn` e o sentido do texto,
 *   num cache por texto no perfil (<perfil>/visao-frases.json).
 *
 * Tudo e opcional: sem motor, sem modelo, sem etiquetador, devolve o que
 * tiver (ou nada) e o casar fica com as regras de antes.
 */

/** Sobe quando a forma do visao.json muda: o que estiver gravado e refeito. */
const VISAO_VERSAO = 1
/** Teto de uma passada do motor (o ViT-L/14 na CPU leva ~0,5 s por quadro). */
const LIMITE_DO_EPISODIO_MS = 30 * 60_000
const LIMITE_DAS_FRASES_MS = 5 * 60_000

// ------------------------------------------------------------------- motor

interface Backend {
  python: string
  cwd: string
  dados: string
  runtime?: { cudaOk: boolean; modelos: string }
}

function backend(): Backend | { erro: string } {
  try {
    if (usaRuntime()) {
      const r = backendDoRuntime()
      if ('erro' in r) return { erro: r.erro }
      return { python: r.python, cwd: r.cwd, dados: pastaDeDadosDoMotor(), runtime: { cudaOk: r.cudaOk, modelos: r.modelos } }
    }
    const cwd = join(configDoMotor().appPath, 'modulos', 'recap', 'motor')
    const python = process.platform === 'win32' ? join(cwd, '.venv', 'Scripts', 'python.exe') : join(cwd, '.venv', 'bin', 'python')
    if (!existsSync(python)) return { erro: 'motor de personagens nao instalado' }
    return { python, cwd, dados: pastaDeDadosDoMotor() }
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) }
  }
}

const vivos = new Set<ChildProcess>()

function matarArvore(filho: ChildProcess, sincrono = false): void {
  const pid = filho.pid
  if (!pid || filho.exitCode !== null || filho.signalCode !== null) return
  if (process.platform !== 'win32') {
    filho.kill('SIGKILL')
    return
  }
  const args = ['/PID', String(pid), '/T', '/F']
  if (sincrono) spawnSync('taskkill', args, { windowsHide: true, timeout: 5000, stdio: 'ignore' })
  else spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => filho.kill())
}

/** O motor esta vendo cenas (o runtime nao reinstala por baixo dele). */
export function visaoRodando(): boolean {
  return [...vivos].some((f) => f.exitCode === null && f.signalCode === null)
}

/** Mata o que estiver rodando (saida do app, desligar o modulo). */
export function encerrarVisao(): void {
  for (const f of vivos) matarArvore(f, true)
  vivos.clear()
}

export interface PedidoDoMotor {
  imagens?: { id: string; arquivo: string; prioridade: number }[]
  clipTextos?: { id: string; texto: string }[]
  sentido?: { id: string; texto: string }[]
}

export interface RespostaDoModo {
  falha: string | null
  gpu: boolean | null
  /** O evento `fim` cru (tempos, puladas). */
  fim: Record<string, unknown> | null
  ms: number
}

function ascii(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '').replace(/[^\x20-\x7e]/g, '')
}

/** Roda o modo `cenas` com a saida em `saida`. Nunca lanca: falha vira `falha`. */
export function rodarModoCenas(
  pedido: PedidoDoMotor,
  saida: string,
  aoProgresso: (etapa: string, feitas: number, total: number) => void,
  limiteMs: number,
): Promise<RespostaDoModo> {
  const inicio = Date.now()
  const b = backend()
  if ('erro' in b) return Promise.resolve({ falha: b.erro, gpu: null, fim: null, ms: 0 })
  return new Promise((resolver) => {
    const stderr: string[] = []
    let acabou = false
    let gpu: boolean | null = null
    let fim: Record<string, unknown> | null = null
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
      try {
        const log = join(b.dados, 'logs', 'ultimas-cenas.log')
        mkdirSync(dirname(log), { recursive: true })
        writeFileSync(log, stderr.slice(-300).join('\n'), 'utf8')
      } catch {
        // log e conveniencia
      }
      resolver({ falha, gpu, fim, ms: Date.now() - inicio })
    }
    let env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      YOLO_AUTOINSTALL: 'false',
      HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
      ANIRECAP_MOTOR_DADOS: b.dados,
    }
    if (b.runtime) env = ambienteDoRuntime(env, b.runtime)
    else {
      const chavePath = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
      env[chavePath] = [env[chavePath], dirname(ffmpegPath)].filter(Boolean).join(delimiter)
    }
    try {
      const py = pythonDoMotor(b.python)
      filho = spawn(py.cmd, ['-m', 'app.headless', 'cenas'], { cwd: b.cwd, windowsHide: true, env: { ...env, ...py.env } })
    } catch (e) {
      resolver({ falha: e instanceof Error ? e.message : String(e), gpu: null, fim: null, ms: Date.now() - inicio })
      return
    }
    vivos.add(filho)
    const relogio = setTimeout(() => {
      matarArvore(filho)
      terminar(`o motor nao terminou em ${Math.round(limiteMs / 60000)} min`)
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
      if (stderr.length > 400) stderr.splice(0, stderr.length - 400)
    })
    filho.stdin.on('error', () => {})
    filho.on('error', (e) => terminar(e.message))
    filho.on('close', () => terminar(null))
    // O pedido na 1a linha; o stdin fica ABERTO (pipe fechado o motor le como "o host morreu").
    filho.stdin.write(`${JSON.stringify({ ...pedido, saida, soCpuPrioridade0: true })}\n`)

    function lerLinha(linha: string): void {
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(linha) as Record<string, unknown>
      } catch {
        return
      }
      if (ev['type'] === 'pronto') gpu = ev['gpu'] === true
      else if (ev['type'] === 'progresso') aoProgresso(String(ev['etapa'] ?? ''), Number(ev['feitas']) || 0, Number(ev['total']) || 0)
      else if (ev['type'] === 'fim') fim = ev
      else if (ev['type'] === 'failed') {
        const m = typeof ev['message'] === 'string' ? ev['message'] : 'erro do motor'
        matarArvore(filho)
        terminar(ascii(m).slice(0, 300))
      }
    }
  })
}

function lerMatriz(pasta: string, nome: string): { ids: string[]; linhas: Float32Array[]; meta: Record<string, unknown> } | null {
  try {
    const meta = JSON.parse(readFileSync(join(pasta, `${nome}.json`), 'utf8')) as Record<string, unknown>
    const ids = Array.isArray(meta['ids']) ? (meta['ids'] as unknown[]).map(String) : []
    const dim = typeof meta['dim'] === 'number' ? meta['dim'] : 0
    const linhas = linhasDaMatriz(readFileSync(join(pasta, `${nome}.f32`)), dim)
    if (linhas.length !== ids.length) return null
    return { ids, linhas, meta }
  } catch {
    return null
  }
}

// --------------------------------------------------------- do episodio

/** O visao.json: o que foi medido do episodio (os vetores moram nos .f32 ao lado). */
interface VisaoGravada {
  versao: number
  /** O indice que foi medido: outro corte (ou outro numero de planos) refaz. */
  chave: string
  /** Os quadros: id "<planoId>|<k>", o arquivo, a beleza e a nitidez (vetores em imagens.f32). */
  quadros: { id: string; arquivo: string; beleza: number | null; nitidez: number | null }[] | null
  /** As falas medidas (vetores em sentido.f32, na mesma ordem). */
  cues: string[] | null
  /** As etiquetas de cada plano, da mais confiante para a menos. */
  tags: Record<string, string[]> | null
  /**
   * (19/10) A confianca (0..1) de cada etiqueta, na MESMA ordem de `tags`.
   * Campo novo, a versao fica: quem so le `tags` segue igual. Ausente = medido
   * antes (pelo tagClips, sem confianca): o proximo garantirVisao reetiqueta.
   */
  confiancas?: Record<string, number[]> | null
  gpu: boolean | null
  tempos: Record<string, number>
}

function chaveDoIndice(indice: Pick<EpisodeIndex, 'id' | 'planos' | 'atualizadoEm'>): string {
  return `${indice.id}|${indice.planos.length}|${indice.atualizadoEm}`
}

/** A pasta da visao: ao lado do episodio.json, ou no perfil quando ali e so leitura. */
export function pastaDaVisao(indice: Pick<EpisodeIndex, 'id'>, caminhoDoIndice: string): string {
  const ao = join(dirname(caminhoDoIndice), 'visao')
  try {
    garantirGravavel(ao)
    return ao
  } catch {
    return join(pastaDoPerfil(), 'visao', indice.id.replace(/[^0-9A-Za-z_-]/g, '_'))
  }
}

function lerGravada(pasta: string, chave: string): VisaoGravada | null {
  try {
    const v = JSON.parse(readFileSync(join(pasta, 'visao.json'), 'utf8')) as VisaoGravada
    return v.versao === VISAO_VERSAO && v.chave === chave ? v : null
  } catch {
    return null
  }
}

function gravarJson(arquivo: string, valor: unknown): void {
  mkdirSync(dirname(arquivo), { recursive: true })
  const tmp = `${arquivo}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(valor), 'utf8')
  renameSync(tmp, arquivo)
}

/** Os keyframes (_0, _1, _2) de cada plano que existem no disco. O do meio e a prioridade 0. */
function keyframesDosPlanos(indice: Pick<EpisodeIndex, 'planos'>): { planoId: string; k: number; arquivo: string }[] {
  const saida: { planoId: string; k: number; arquivo: string }[] = []
  for (const p of indice.planos) {
    if (!p.keyframe) continue
    const k0 = kDoKeyframe(p.keyframe)
    for (const k of k0 === null ? [null] : [0, 1, 2]) {
      const arquivo = k === null ? p.keyframe : p.keyframe.replace(/_\d(\.jpe?g)$/i, `_${k}$1`)
      if (existsSync(arquivo)) saida.push({ planoId: p.id, k: k ?? 1, arquivo })
    }
  }
  return saida
}

export interface EstadoDaVisao {
  pronta: boolean
  /** Por que nao (ASCII curto). */
  motivo: string | null
  tempos: Record<string, number>
}

const emAndamento = new Map<string, Promise<EstadoDaVisao>>()

/** A visao deste episodio esta sendo medida agora (o mover para o AnCut espera). */
export function visaoDoEpisodioRodando(episodioId: string): boolean {
  return [...emAndamento.keys()].some((k) => k.startsWith(`${episodioId}|`))
}

/**
 * Mede o episodio (o que faltar): CLIP + beleza + nitidez dos keyframes e o
 * sentido das falas pelo motor; as etiquetas pelo etiquetador do nucleo. Um
 * por episodio de cada vez; o resultado fica em pastaDaVisao.
 */
export function garantirVisao(
  indice: EpisodeIndex,
  caminhoDoIndice: string,
  quer: { motor: boolean; etiquetas: boolean },
  aoProgresso: (texto: string) => void = () => {},
): Promise<EstadoDaVisao> {
  const chave = `${chaveDoIndice(indice)}|${quer.motor}|${quer.etiquetas}`
  const ja = emAndamento.get(chave)
  if (ja) return ja
  const p = medir(indice, caminhoDoIndice, quer, aoProgresso).finally(() => emAndamento.delete(chave))
  emAndamento.set(chave, p)
  return p
}

async function medir(
  indice: EpisodeIndex,
  caminhoDoIndice: string,
  quer: { motor: boolean; etiquetas: boolean },
  aoProgresso: (texto: string) => void,
): Promise<EstadoDaVisao> {
  const pasta = pastaDaVisao(indice, caminhoDoIndice)
  const chave = chaveDoIndice(indice)
  const gravada = lerGravada(pasta, chave)
  const atual: VisaoGravada = gravada ?? { versao: VISAO_VERSAO, chave, quadros: null, cues: null, tags: null, confiancas: null, gpu: null, tempos: {} }
  const motivos: string[] = []

  if (quer.motor && (atual.quadros === null || atual.cues === null)) {
    const t0 = Date.now()
    const kfs = atual.quadros === null ? keyframesDosPlanos(indice) : []
    const cues = atual.cues === null ? indice.cues.filter((c) => c.texto.trim() && c.tipo !== 'musica') : []
    const tmp = join(pasta, `tmp-${randomBytes(4).toString('hex')}`)
    const r = await rodarModoCenas(
      {
        imagens: kfs.map((x) => ({ id: `${x.planoId}|${x.k}`, arquivo: x.arquivo, prioridade: x.k === 1 ? 0 : 1 })),
        sentido: cues.map((c) => ({ id: c.id, texto: c.texto })),
      },
      tmp,
      (etapa, feitas, total) => aoProgresso(etapa === 'sentido' ? `Lendo as falas ${feitas}/${total}` : `Vendo as cenas ${feitas}/${total}`),
      LIMITE_DO_EPISODIO_MS,
    )
    if (r.falha) motivos.push(r.falha)
    else {
      const im = kfs.length > 0 ? lerMatriz(tmp, 'imagens') : null
      if (im) {
        const est = (im.meta['estetica'] as (number | null)[] | undefined) ?? []
        const nit = (im.meta['nitidez'] as (number | null)[] | undefined) ?? []
        const arquivoDe = new Map(kfs.map((x) => [`${x.planoId}|${x.k}`, x.arquivo]))
        atual.quadros = im.ids.map((id, i) => ({ id, arquivo: arquivoDe.get(id) ?? '', beleza: est[i] ?? null, nitidez: nit[i] ?? null }))
        renameSync(join(tmp, 'imagens.f32'), join(pasta, 'imagens.f32'))
      }
      const se = cues.length > 0 ? lerMatriz(tmp, 'sentido') : null
      if (se) {
        atual.cues = se.ids
        renameSync(join(tmp, 'sentido.f32'), join(pasta, 'sentido.f32'))
      }
      atual.gpu = r.gpu
      atual.tempos['motor'] = Date.now() - t0
      gravarJson(join(pasta, 'visao.json'), atual)
    }
    rmSync(tmp, { recursive: true, force: true })
  }

  if (quer.etiquetas && (atual.tags === null || !atual.confiancas)) {
    const reetiquetar = atual.tags !== null
    // Reetiquetar (o visao.json de antes) so com o modelo no disco: nunca um download de 379 MB no passo 4.
    if (!reetiquetar || taggerReady()) {
      const t0 = Date.now()
      try {
        const r = await etiquetarDoEpisodio(indice, pasta, gravada === null, aoProgresso)
        atual.tags = r.tags
        atual.confiancas = r.confiancas
        atual.tempos['etiquetas'] = Date.now() - t0
        gravarJson(join(pasta, 'visao.json'), atual)
        rmSync(arquivoDoCacheDasEtiquetas(pasta), { force: true })
        if (reetiquetar) console.log(`[cenas] etiquetas de ${indice.id} com confianca em ${Date.now() - t0} ms`)
      } catch (e) {
        // Reetiquetar que falha nao tira nada: as etiquetas de antes continuam valendo (sem confianca).
        if (!reetiquetar) motivos.push(`etiquetas: ${ascii(e instanceof Error ? e.message : String(e)).slice(0, 120)}`)
      }
    }
  }
  const pronta = (!quer.motor || (atual.quadros !== null && atual.cues !== null)) && (!quer.etiquetas || atual.tags !== null)
  return { pronta, motivo: motivos.join('; ') || null, tempos: atual.tempos }
}

function idDaEtiqueta(indiceId: string, planoId: string): string {
  return `recap/${indiceId}/${planoId}`
}

/**
 * O cache do etiquetador para este episodio: na pasta da visao (do modulo, ao
 * lado do indice ou no perfil), nunca no etiquetas.json da Biblioteca do
 * Dangai. So vive durante a etiquetagem (o resultado mora no visao.json): se
 * ela cair no meio, a proxima continua de onde parou.
 */
function arquivoDoCacheDasEtiquetas(pasta: string): string {
  return join(pasta, 'etiquetas-cache.json')
}

/**
 * As etiquetas COM confianca de cada plano (etiquetarComConfianca do nucleo).
 * `novo` = a visao deste corte ainda nao existia: um cache que sobrou e de
 * outro corte (os ids dos planos se repetem) e sai antes.
 */
async function etiquetarDoEpisodio(
  indice: EpisodeIndex,
  pasta: string,
  novo: boolean,
  aoProgresso: (texto: string) => void,
): Promise<{ tags: Record<string, string[]>; confiancas: Record<string, number[]> }> {
  const cache = arquivoDoCacheDasEtiquetas(pasta)
  if (novo) rmSync(cache, { force: true })
  const clips = indice.planos
    .filter((p) => p.keyframe && existsSync(p.keyframe))
    .map((p) => ({ id: idDaEtiqueta(indice.id, p.id), keyframe: p.keyframe!, thumbPath: p.keyframe! }) as unknown as LibraryClip)
  const todas = await etiquetarComConfianca(clips, (m) => aoProgresso(m), cache)
  const tags: Record<string, string[]> = {}
  const confiancas: Record<string, number[]> = {}
  for (const p of indice.planos) {
    const t = todas[idDaEtiqueta(indice.id, p.id)]
    if (!t) continue
    tags[p.id] = t.map((x) => x.tag)
    confiancas[p.id] = t.map((x) => x.p)
  }
  return { tags, confiancas }
}

/** O que ja foi medido do episodio, no formato do casar. Nada medido = mapas ausentes. */
export function sinaisDoEpisodio(
  indice: EpisodeIndex,
  caminhoDoIndice: string,
): Pick<SinaisDoCasar, 'quadros' | 'sentidoDaCue' | 'tagsDoPlano' | 'confiancaDasTags'> {
  const pasta = pastaDaVisao(indice, caminhoDoIndice)
  const v = lerGravada(pasta, chaveDoIndice(indice))
  if (!v) return {}
  const saida: Pick<SinaisDoCasar, 'quadros' | 'sentidoDaCue' | 'tagsDoPlano' | 'confiancaDasTags'> = {}
  if (v.quadros) {
    try {
      const linhas = linhasDaMatriz(readFileSync(join(pasta, 'imagens.f32')), 768)
      if (linhas.length === v.quadros.length) {
        const quadros = new Map<string, QuadroDaVisao[]>()
        v.quadros.forEach((q, i) => {
          const [planoId, k] = q.id.split('|')
          if (!planoId) return
          const lista = quadros.get(planoId) ?? []
          lista.push({ k: Number(k), pos: posDoKeyframe(Number(k)), arquivo: q.arquivo, vetor: linhas[i]!, beleza: q.beleza, nitidez: q.nitidez })
          quadros.set(planoId, lista)
        })
        saida.quadros = quadros
      }
    } catch {
      // sem os vetores: sem C2/C7
    }
  }
  if (v.cues) {
    try {
      const linhas = linhasDaMatriz(readFileSync(join(pasta, 'sentido.f32')), 384)
      if (linhas.length === v.cues.length) saida.sentidoDaCue = new Map(v.cues.map((id, i) => [id, linhas[i]!]))
    } catch {
      // sem o sentido das falas
    }
  }
  if (v.tags) {
    saida.tagsDoPlano = new Map(Object.entries(v.tags))
    if (v.confiancas) saida.confiancaDasTags = confiancaDasTagsGravadas(v.tags, v.confiancas)
  }
  return saida
}

/** C7: o keyframe mais bonito e nitido de cada plano (a miniatura da grade). Vazio = sem medida. */
export function melhoresKeyframes(indice: EpisodeIndex, caminhoDoIndice: string): Map<string, string> {
  const v = lerGravada(pastaDaVisao(indice, caminhoDoIndice), chaveDoIndice(indice))
  const saida = new Map<string, string>()
  if (!v?.quadros) return saida
  const nit = v.quadros.flatMap((q) => (q.nitidez === null ? [] : [Math.log1p(q.nitidez)]))
  const media = nit.reduce((s, x) => s + x, 0) / Math.max(1, nit.length)
  const melhor = new Map<string, { arquivo: string; nota: number }>()
  for (const q of v.quadros) {
    const planoId = q.id.split('|')[0]!
    const nota = (q.beleza ?? 0) + 0.5 * Math.max(-2, Math.min(2, q.nitidez === null ? 0 : Math.log1p(q.nitidez) - media))
    const atual = melhor.get(planoId)
    if (q.arquivo && (!atual || nota > atual.nota)) melhor.set(planoId, { arquivo: q.arquivo, nota })
  }
  for (const [id, x] of melhor) saida.set(id, x.arquivo)
  return saida
}

// ------------------------------------------------------------ das frases

const MODELO_CLIP = 'clip-vit-l-14-openai'
const MODELO_SENTIDO = 'multilingual-e5-small@761b726d'

function chaveDoTexto(tipo: string, texto: string): string {
  return createHash('sha256').update(`${tipo}|${texto.normalize('NFC').trim()}`).digest('hex').slice(0, 32)
}

function arquivoDasFrases(): string {
  return join(pastaDoPerfil(), 'visao-frases.json')
}

let cacheDasFrases: Record<string, string> | null = null

function lerCacheDasFrases(): Record<string, string> {
  if (cacheDasFrases) return cacheDasFrases
  try {
    const j = JSON.parse(readFileSync(arquivoDasFrases(), 'utf8')) as { versao?: number; vetores?: Record<string, string> }
    cacheDasFrases = j.versao === 1 && j.vetores ? j.vetores : {}
  } catch {
    cacheDasFrases = {}
  }
  return cacheDasFrases
}

function vetorDe(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64')
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

/**
 * Os vetores das frases (CLIP da visualEn, sentido do texto), do cache ou do
 * motor (uma passada para todos os que faltam).
 */
export async function sinaisDasFrases(
  frases: readonly Pick<Frase, 'id' | 'texto' | 'visualEn'>[],
  quer: { imagem: boolean; sentido: boolean; soCache?: boolean },
  /** (4a rodada) As consultas da ponte visual (consultaVisual), por frase ou pedaco: o CLIP do texto, no mesmo cache. */
  consultas: readonly { id: string; texto: string }[] = [],
): Promise<{ sinais: Pick<SinaisDoCasar, 'imagemDaFrase' | 'sentidoDaFrase' | 'imagemDaPonte'>; falha: string | null; ms: number }> {
  const t0 = Date.now()
  const cache = lerCacheDasFrases()
  const pedidos: { tipo: 'clip' | 'sentido' | 'ponte'; fraseId: string; texto: string; chave: string }[] = []
  for (const f of frases) {
    if (quer.imagem && f.visualEn?.trim()) pedidos.push({ tipo: 'clip', fraseId: f.id, texto: f.visualEn.trim(), chave: chaveDoTexto(MODELO_CLIP, f.visualEn) })
    if (quer.sentido && f.texto.trim()) pedidos.push({ tipo: 'sentido', fraseId: f.id, texto: f.texto.trim(), chave: chaveDoTexto(MODELO_SENTIDO, f.texto) })
  }
  if (quer.imagem) for (const c of consultas) if (c.texto.trim()) pedidos.push({ tipo: 'ponte', fraseId: c.id, texto: c.texto.trim(), chave: chaveDoTexto(MODELO_CLIP, c.texto) })
  const faltam = pedidos.filter((p) => !cache[p.chave])
  let falha: string | null = null
  if (faltam.length > 0 && !quer.soCache) {
    const tmp = join(pastaDoPerfil(), 'visao', `frases-${randomBytes(4).toString('hex')}`)
    const unicos = (...tipos: string[]): { id: string; texto: string }[] => [
      ...new Map(faltam.filter((p) => tipos.includes(p.tipo)).map((p) => [p.chave, { id: p.chave, texto: p.texto }])).values(),
    ]
    const r = await rodarModoCenas({ clipTextos: unicos('clip', 'ponte'), sentido: unicos('sentido') }, tmp, () => {}, LIMITE_DAS_FRASES_MS)
    if (r.falha) falha = r.falha
    else {
      for (const nome of ['clip-textos', 'sentido']) {
        const m = lerMatriz(tmp, nome)
        if (!m) continue
        m.ids.forEach((id, i) => {
          const v = m.linhas[i]!
          cache[id] = Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64')
        })
      }
      try {
        gravarJson(arquivoDasFrases(), { versao: 1, vetores: cache })
      } catch {
        // o cache e conveniencia
      }
    }
    rmSync(tmp, { recursive: true, force: true })
  }
  const imagemDaFrase = new Map<string, Float32Array>()
  const sentidoDaFrase = new Map<string, Float32Array>()
  const imagemDaPonte = new Map<string, Float32Array>()
  for (const p of pedidos) {
    const b64 = cache[p.chave]
    if (!b64) continue
    ;(p.tipo === 'clip' ? imagemDaFrase : p.tipo === 'ponte' ? imagemDaPonte : sentidoDaFrase).set(p.fraseId, vetorDe(b64))
  }
  return {
    sinais: {
      ...(imagemDaFrase.size > 0 ? { imagemDaFrase } : {}),
      ...(sentidoDaFrase.size > 0 ? { sentidoDaFrase } : {}),
      ...(imagemDaPonte.size > 0 ? { imagemDaPonte } : {}),
    },
    falha,
    ms: Date.now() - t0,
  }
}

/** As camadas do casar pela config "Cenas" do modulo. */
export function camadasDaConfig(c: ConfigDasCenas): Partial<CamadasDoCasar> {
  return { imagem: c.visao, sentido: c.visao, melhorQuadro: c.visao, tags: c.etiquetas, conta: c.conta, personagemForte: true }
}
