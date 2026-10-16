import { spawn } from 'node:child_process'
import type { PontoDeGanho } from '@shared/ducking'
import { ffmpegPath } from './ffmpeg-path'

/**
 * Pedacos do grafo do ffmpeg do MIX FINAL (render.ts, grafoDoMix) que nao sao
 * o de sempre. Ficam aqui, fora do render.ts, para o teste
 * (scripts/teste/v-som-mix.ts) montar o mesmo filtro sem Remotion.
 */

/**
 * O teto do mix, em dBTP. O limitador trabalha a 192 kHz (4x de 48 kHz: o
 * mesmo sobreamostrado que o ebur128 usa para medir pico VERDADEIRO), entao o
 * pico entre amostras tambem fica abaixo. -1,5 e o mesmo TP do loudnorm da
 * narracao: a voz sozinha ja chega ate ele e passa intacta; so a soma com
 * faixas e SFX encosta. O AAC sobe o pico uns decimos depois disso.
 */
export const TETO_DO_MIX_DBTP = -1.5

/** O pico verdadeiro maximo do MP4 entregue (o padrao das plataformas). */
export const PICO_MAXIMO_DBTP = -1

/**
 * O pico VERDADEIRO do audio de um arquivo (ebur128 peak=true: 4x
 * sobreamostrado), em dBTP. null = nao deu para medir (o render segue: medir
 * e conferencia, nao requisito).
 */
export function picoVerdadeiro(path: string): Promise<number | null> {
  return new Promise((resolve) => {
    const c = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-nostats', '-i', path, '-vn', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], {
      windowsHide: true,
    })
    let err = ''
    c.stderr.on('data', (d: Buffer) => {
      err += d.toString()
      // So o resumo do fim importa; o resto (cabecalho) nao precisa acumular.
      if (err.length > 200_000) err = err.slice(-20_000)
    })
    c.on('error', () => resolve(null))
    c.on('close', (code) => {
      if (code !== 0) return resolve(null)
      const m = /True peak:\s*[\r\n]+\s*Peak:\s*(-?[\d.]+|-inf)/.exec(err)
      const v = m ? Number(m[1]) : NaN
      resolve(m?.[1] === '-inf' ? Number.NEGATIVE_INFINITY : Number.isFinite(v) ? v : null)
    })
  })
}

/**
 * O limitador do fim do mix: lookahead de 5 ms (o "attack" do alimiter e a
 * janela que ele olha a frente), solta em 80 ms, sem o "auto level" (que
 * normalizaria tudo para 0 dB) e com a latencia compensada (sem isso o audio
 * sairia 5 ms atrasado da imagem).
 */
export function filtroDoLimitador(tetoDbtp = TETO_DO_MIX_DBTP): string {
  const limite = 10 ** (tetoDbtp / 20)
  return [
    'aresample=192000',
    `alimiter=limit=${limite.toFixed(5)}:attack=5:release=80:level=disabled:latency=1`,
    'aresample=48000',
  ].join(',')
}

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
