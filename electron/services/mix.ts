import type { PontoDeGanho } from '@shared/ducking'

/**
 * Pedacos do grafo do ffmpeg do MIX FINAL (render.ts, grafoDoMix) que nao sao
 * o de sempre. Ficam aqui, fora do render.ts, para o teste
 * (scripts/teste/v-som-mix.ts) montar o mesmo filtro sem Remotion.
 */

/** Numero curto e sem notacao exponencial para a expressao do ffmpeg. */
function num(x: number, casas: number): string {
  const s = x.toFixed(casas)
  // "-0.000" vira "0": o parser aceita, mas polui.
  return /^-?0\.?0*$/.test(s) ? '0' : s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/**
 * O ENVELOPE DE GANHO (ducking) como filtro do ffmpeg, no tempo LOCAL do trecho
 * (o `t` do filtro comeca em 0 no inicio do trecho, depois do atrim/asetpts).
 *
 * `pontos` vem em tempo do VIDEO (trilhaParaMixar, a mesma conta do preview);
 * `at` e onde o trecho entra. A curva e linear em dB entre os pontos, constante
 * fora deles -- exatamente ganhoDoEnvelope. Escrita como SOMA de segmentos
 * (gte*lt*reta) e nao como if aninhado: o parser do ffmpeg limita o
 * aninhamento a ~100 niveis, e um video longo tem centenas de pausas. Segmento
 * em 0 dB nao entra na soma (nao muda nada).
 *
 * `asetnsamples` corta o audio em quadros de 256 amostras (~5 ms): o volume
 * com eval=frame muda uma vez por quadro, e quadro grande (1152 amostras do
 * mp3) faria degrau audivel numa rampa curta.
 *
 * null = sem envelope (ausente, vazio ou tudo em 0 dB): o grafo fica o de antes.
 */
export function filtroDoEnvelope(pontos: readonly PontoDeGanho[] | undefined, at: number): string | null {
  if (!pontos || pontos.length === 0) return null
  const p = pontos.map((x) => ({ t: Math.max(x.t - at, 0), db: x.db }))
  if (p.every((x) => Math.abs(x.db) < 1e-3)) return null

  const termos: string[] = []
  const T = (x: number): string => num(x, 4)
  const D = (x: number): string => num(x, 3)
  const primeiro = p[0]!
  const ultimo = p[p.length - 1]!
  if (Math.abs(primeiro.db) >= 1e-3 && primeiro.t > 0) termos.push(`lt(t,${T(primeiro.t)})*(${D(primeiro.db)})`)
  for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i]!
    const b = p[i + 1]!
    const dt = b.t - a.t
    if (dt <= 1e-6) continue
    if (Math.abs(a.db) < 1e-3 && Math.abs(b.db) < 1e-3) continue
    const janela = `gte(t,${T(a.t)})*lt(t,${T(b.t)})`
    if (Math.abs(b.db - a.db) < 1e-3) termos.push(`${janela}*(${D(a.db)})`)
    else termos.push(`${janela}*(${D(a.db)}+(t-${T(a.t)})*(${num((b.db - a.db) / dt, 5)}))`)
  }
  if (Math.abs(ultimo.db) >= 1e-3) termos.push(`gte(t,${T(ultimo.t)})*(${D(ultimo.db)})`)
  if (termos.length === 0) return null
  return `asetnsamples=n=256:p=0,volume=volume='pow(10,(${termos.join('+')})/20)':eval=frame`
}
