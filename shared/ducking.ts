import type { Ducking, TrechoDeAudioSalvo } from './contract'
import { DUCKING_PADRAO, duracaoDoTrecho } from './contract'

/**
 * O ENVELOPE DE GANHO de um trecho de audio com `ducking` (ver duckingSchema):
 * a conta pura que o preview (src/components/som-do-preview.ts) e o render
 * (electron/services/mix.ts, filtroDoEnvelope) fazem com as MESMAS palavras do
 * transcript. O que se ouve no preview e o que sai no MP4.
 *
 * Trecho sem `ducking` nao passa por nada daqui: o grafo do ffmpeg e o volume
 * do preview ficam exatamente os de antes (scripts/teste/v-som-mix.ts).
 */

/** Um ponto do envelope: em `t` (s do VIDEO), `db` sobre o ganho do trecho (0 ou negativo). */
export interface PontoDeGanho {
  t: number
  db: number
}

/** Uma palavra do transcript para o ducking (o Word de contract.ts serve direto). */
export interface PalavraDoDucking {
  start: number
  end: number
  /** O texto com pontuacao (o do roteiro): diz onde a frase fecha. */
  text?: string
  /** Fecha um paragrafo do roteiro. */
  paragraph?: boolean
}

/**
 * O menor vao depois de um fim de frase que ja conta como respiro, s. Abreviacao
 * colada na palavra seguinte ("Dr. Stone") fica abaixo disso.
 */
export const RESPIRO_MIN_SEC = 0.1

/** Milissegundo: mais fino nao muda nada no som e polui o IPC. */
function arredondar(s: number): number {
  return Math.round(s * 1000) / 1000
}

/** Termina em . ! ? ... (com aspas/parenteses depois), ou fecha paragrafo. */
function fechaFrase(p: PalavraDoDucking): boolean {
  if (p.paragraph === true) return true
  return typeof p.text === 'string' && /[.!?…]["'”’)\]]*$/.test(p.text.trim())
}

/**
 * O ENVELOPE DE DUCKING: 0 dB nas pausas e -abaixoDb enquanto a voz fala, com
 * rampas lineares (em dB) de `ataqueSec` antes da fala e `soltaSec` depois.
 * Pausa menor que `pausaMinSec` nao sobe. Pausa curta demais para a rampa
 * inteira sobe so ate onde as duas rampas se cruzam ("sobe um pouco").
 *
 * FIM DE FRASE TAMBEM E PAUSA: narracao com as pausas cortadas deixa o vao
 * entre frases do tamanho do vao entre palavras, e so com `pausaMinSec` o
 * trecho ficaria embaixo do comeco ao fim. Por isso a palavra que FECHA frase
 * (. ! ? ..., ou `paragraph`) abre um respiro quando o vao depois dela passa de
 * RESPIRO_MIN_SEC. O respiro curto sobe so o pedaco das rampas que cabe no vao.
 *
 * Palavra sem tempo (NaN) ou invertida e ignorada. Sem palavra nenhuma: [] (o
 * ganho do trecho vale sozinho).
 */
export function envelopeDeDucking(
  palavras: readonly PalavraDoDucking[],
  duracaoSec: number,
  ducking: Ducking = DUCKING_PADRAO,
): PontoDeGanho[] {
  const A = Math.max(ducking.abaixoDb, 0)
  const validas = palavras
    .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end >= p.start)
    .map((p) => ({ start: Math.max(p.start, 0), end: Math.min(p.end, duracaoSec), fecha: fechaFrase(p) }))
    .filter((p) => p.start < duracaoSec)
    .sort((a, b) => a.start - b.start)
  if (validas.length === 0 || A === 0 || !(duracaoSec > 0)) return []

  // Fala = palavras juntas enquanto o vao for menor que a pausa minima (ou,
  // depois de fim de frase, menor que o respiro).
  const falas: { a: number; b: number }[] = []
  let anterior: { fecha: boolean } | null = null
  for (const p of validas) {
    const ultima = falas[falas.length - 1]
    const vao = ultima ? p.start - ultima.b : 0
    const respiro = anterior !== null && anterior.fecha && vao >= RESPIRO_MIN_SEC
    if (ultima && vao < ducking.pausaMinSec && !respiro) ultima.b = Math.max(ultima.b, p.end)
    else falas.push({ a: p.start, b: Math.max(p.end, p.start) })
    anterior = p
  }

  const ataque = Math.max(ducking.ataqueSec, 1e-3)
  const solta = Math.max(ducking.soltaSec, 1e-3)
  const pontos: PontoDeGanho[] = []
  const por = (t: number, db: number): void => {
    const tt = Math.min(Math.max(t, 0), duracaoSec)
    const ultimo = pontos[pontos.length - 1]
    if (ultimo && Math.abs(ultimo.t - tt) < 1e-6) {
      ultimo.db = db
      return
    }
    if (ultimo && tt < ultimo.t) return
    pontos.push({ t: arredondar(tt), db: Math.round(db * 100) / 100 })
  }

  // Antes da 1a fala: em cima, descendo na rampa de ataque.
  const primeira = falas[0]!
  if (primeira.a >= ataque) {
    por(0, 0)
    por(primeira.a - ataque, 0)
  } else {
    por(0, -A * (1 - primeira.a / ataque))
  }
  por(primeira.a, -A)

  for (let i = 0; i < falas.length; i++) {
    const f = falas[i]!
    por(f.b, -A)
    const seguinte = falas[i + 1]
    if (!seguinte) {
      // Depois da ultima fala: sobe ate 0 (ou ate onde o video deixar).
      const fim = f.b + solta
      if (fim <= duracaoSec) {
        por(fim, 0)
        if (duracaoSec > fim) por(duracaoSec, 0)
      } else {
        por(duracaoSec, -A * (1 - (duracaoSec - f.b) / solta))
      }
      break
    }
    const vao = seguinte.a - f.b
    if (vao >= solta + ataque) {
      por(f.b + solta, 0)
      por(seguinte.a - ataque, 0)
    } else {
      // As rampas se cruzam no meio do vao: sobe so um pouco.
      const tp = (f.b * ataque + seguinte.a * solta) / (solta + ataque)
      por(tp, -A * (1 - vao / (solta + ataque)))
    }
    por(seguinte.a, -A)
  }
  return pontos
}

/** O ganho (dB) do envelope no instante t: linear entre pontos, constante fora. [] = 0. */
export function ganhoDoEnvelope(pontos: readonly PontoDeGanho[], t: number): number {
  const n = pontos.length
  if (n === 0) return 0
  if (t <= pontos[0]!.t) return pontos[0]!.db
  if (t >= pontos[n - 1]!.t) return pontos[n - 1]!.db
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const meio = (lo + hi) >> 1
    if (pontos[meio]!.t <= t) lo = meio
    else hi = meio
  }
  const p0 = pontos[lo]!
  const p1 = pontos[hi]!
  const dt = p1.t - p0.t
  return dt <= 0 ? p1.db : p0.db + ((p1.db - p0.db) * (t - p0.t)) / dt
}

/** So o pedaco [de, ate] do envelope, com os pontos das pontas interpolados (menos coisa no IPC e no ffmpeg). */
export function recortarEnvelope(pontos: readonly PontoDeGanho[], de: number, ate: number): PontoDeGanho[] {
  if (pontos.length === 0 || !(ate > de)) return []
  const dentro = pontos.filter((p) => p.t > de && p.t < ate)
  return [{ t: de, db: ganhoDoEnvelope(pontos, de) }, ...dentro, { t: ate, db: ganhoDoEnvelope(pontos, ate) }]
}

/**
 * Um trecho pronto para o mix (o item de StartRenderArgs.trilhas): o de sempre
 * e, com ducking, o ENVELOPE recortado no tempo do trecho (s do video, dB sobre
 * gainDb). Sem `ducking`: o MESMO objeto de antes, sem a chave `envelope`.
 */
export interface TrilhaParaMixar {
  path: string
  at: number
  inicioSec: number
  duracaoSec: number
  gainDb: number
  fadeInSec: number
  fadeOutSec: number
  /** Ausente = volume fixo. Tempo do VIDEO (o mesmo de `at`). */
  envelope?: PontoDeGanho[]
}

export function trilhaParaMixar(
  t: Pick<TrechoDeAudioSalvo, 'path' | 'at' | 'inicioSec' | 'usarSec' | 'durationSec' | 'gainDb' | 'fadeInSec' | 'fadeOutSec' | 'ducking'>,
  palavras: readonly PalavraDoDucking[],
  duracaoVideoSec: number,
): TrilhaParaMixar {
  const duracaoSec = duracaoDoTrecho(t)
  const base: TrilhaParaMixar = {
    path: t.path,
    at: t.at,
    inicioSec: t.inicioSec,
    duracaoSec,
    gainDb: t.gainDb,
    fadeInSec: t.fadeInSec,
    fadeOutSec: t.fadeOutSec,
  }
  if (!t.ducking) return base
  const envelope = recortarEnvelope(envelopeDeDucking(palavras, duracaoVideoSec, t.ducking), t.at, t.at + duracaoSec)
  return envelope.length > 0 ? { ...base, envelope } : base
}
