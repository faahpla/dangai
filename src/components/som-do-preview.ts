import { useMemo } from 'react'
import type { Ducking, Word } from '@shared/contract'
import { envelopeDeDucking, ganhoDoEnvelope, type PontoDeGanho } from '@shared/ducking'

/**
 * O SOM DO PREVIEW IGUAL AO DO RENDER.
 *
 * DUCKING: o trecho com `ducking` desce sob a voz pelo MESMO envelope que o
 * render usa (envelopeDeDucking com as palavras do transcript, interpolado por
 * ganhoDoEnvelope) -- nao um compressor ouvindo o audio, entao o que se ouve
 * aqui e o que sai no MP4. Trecho sem `ducking`: 0 dB, o preview de sempre.
 */

/**
 * O ganho do ducking (dB, 0 ou negativo) de um trecho no instante do VIDEO.
 * Um envelope por configuracao de ducking (trechos com a mesma dividem),
 * refeito so quando as palavras ou a duracao mudam.
 */
export function useDucking(
  faixas: readonly { ducking?: Ducking | null }[],
  words: readonly Word[] | undefined,
  duracaoSec: number | undefined,
): (ducking: Ducking | null | undefined, tVideo: number) => number {
  const configs = [...new Set(faixas.flatMap((f) => (f.ducking ? [JSON.stringify(f.ducking)] : [])))].sort().join('\n')
  const envelopes = useMemo(() => {
    const m = new Map<string, PontoDeGanho[]>()
    if (!configs || !words || !duracaoSec) return m
    for (const c of configs.split('\n')) m.set(c, envelopeDeDucking(words, duracaoSec, JSON.parse(c) as Ducking))
    return m
  }, [configs, words, duracaoSec])
  return useMemo(
    () => (ducking: Ducking | null | undefined, tVideo: number) => {
      if (!ducking) return 0
      const env = envelopes.get(JSON.stringify(ducking))
      return env ? ganhoDoEnvelope(env, tVideo) : 0
    },
    [envelopes],
  )
}
