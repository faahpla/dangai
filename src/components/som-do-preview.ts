import { useEffect, useMemo, useState } from 'react'
import type { Ducking, Word } from '@shared/contract'
import { envelopeDeDucking, ganhoDoEnvelope, type PontoDeGanho } from '@shared/ducking'
import { LUFS_DA_NARRACAO, monoEmDoisCanais, type MedidaDoSom } from '@shared/loudness'

/**
 * O SOM DO PREVIEW IGUAL AO DO RENDER.
 *
 * NIVEL: no render a narracao vai a LUFS_DA_NARRACAO (-14, o loudnorm); aqui
 * ela toca CRUA. Sem descontar, uma narracao de -20 LUFS deixava as faixas
 * ~6 dB mais altas em relacao a voz do que no MP4, e ele acertava o volume no
 * ouvido errado. O desconto e a diferenca entre a voz ouvida aqui e a do
 * render, aplicado em TODAS as faixas de audio. Mono conta +3 dB aqui: o
 * navegador copia o canal nos dois alto-falantes, e o render sobe mono para
 * estereo a -3 dB por canal (ver monoEmDoisCanais). O render NAO muda.
 *
 * A medida vem do main (medirSom). Ainda medindo ou falhou: desconto 0, o
 * preview de antes. Voz mais alta que -14: as faixas SOBEM o mesmo tanto (o
 * render abaixa a voz), ate o teto de 1 do <audio>.
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

const medidas = new Map<string, Promise<MedidaDoSom | null>>()
/** As medidas que ja chegaram: reabrir o preview comeca no valor certo, sem degrau. */
const chegaram = new Map<string, MedidaDoSom | null>()

function medir(path: string): Promise<MedidaDoSom | null> {
  let p = medidas.get(path)
  if (!p) {
    p = window.dangai
      .medirSom(path)
      .then((r) => (r.ok ? r.value : null))
      .catch(() => null)
      .then((m) => {
        chegaram.set(path, m)
        return m
      })
    medidas.set(path, p)
  }
  return p
}

/** Quanto a voz do render fica acima da voz tocada aqui, em dB (negativo = a voz aqui e mais alta). */
export function descontoDaVoz(m: Pick<MedidaDoSom, 'lufsIntegrado' | 'canais'> | null | undefined): number {
  if (!m || m.lufsIntegrado === null) return 0
  const ouvida = m.lufsIntegrado + monoEmDoisCanais(m.canais ?? 2)
  return Math.min(Math.max(ouvida - LUFS_DA_NARRACAO, -40), 20)
}

/** O quanto um arquivo de faixa soa mais alto aqui do que no render, em dB (mono: +3). */
export function descontoDoArquivo(m: Pick<MedidaDoSom, 'canais'> | null | undefined): number {
  return m ? -monoEmDoisCanais(m.canais ?? 2) : 0
}

/**
 * dB a somar em cada arquivo de faixa no preview (por caminho). Arquivo ainda
 * sem medida usa so o desconto da voz.
 */
export function useAjusteDasFaixas(vozPath: string | undefined, faixaPaths: readonly string[]): (path: string) => number {
  const [vozDb, setVozDb] = useState(() => (vozPath ? descontoDaVoz(chegaram.get(vozPath)) : 0))
  const [arquivoDb, setArquivoDb] = useState<Record<string, number>>({})
  const chave = [...new Set(faixaPaths)].sort().join('\n')

  useEffect(() => {
    let vivo = true
    if (!vozPath) {
      setVozDb(0)
      return
    }
    void medir(vozPath).then((m) => {
      if (vivo) setVozDb(descontoDaVoz(m))
    })
    return () => {
      vivo = false
    }
  }, [vozPath])

  useEffect(() => {
    let vivo = true
    const paths = chave ? chave.split('\n') : []
    void Promise.all(paths.map(async (p) => [p, await medir(p)] as const)).then((lista) => {
      if (!vivo) return
      const novo: Record<string, number> = {}
      for (const [p, m] of lista) novo[p] = descontoDoArquivo(m)
      setArquivoDb(novo)
    })
    return () => {
      vivo = false
    }
  }, [chave])

  return useMemo(() => (path: string) => vozDb + (arquivoDb[path] ?? descontoDoArquivo(chegaram.get(path))), [vozDb, arquivoDb])
}
