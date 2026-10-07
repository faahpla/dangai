import { create } from 'zustand'

/**
 * AS ONDAS FINAS dos arquivos de audio (100 picos por segundo, com RMS), por
 * caminho. Ficam so na memoria: sao grandes demais para ir em cada clipe do
 * .dangai, e refazer custa menos de um segundo por arquivo. Varios clipes do
 * mesmo arquivo (cortes, copias) dividem a mesma onda.
 *
 * Enquanto a fina nao chega, quem desenha usa a onda curta que ja esta no
 * projeto.
 */
export interface Onda {
  peaks: number[]
  rms: number[]
  durationSec: number
}

export const useOndas = create<{ ondas: Record<string, Onda> }>(() => ({ ondas: {} }))

const pedidos = new Set<string>()

/** Pede a onda fina de um arquivo, uma vez so. */
export function carregarOnda(path: string): void {
  if (!path || pedidos.has(path) || useOndas.getState().ondas[path]) return
  pedidos.add(path)
  void window.dangai.ondaDetalhada(path).then((r) => {
    if (r.ok && r.value.peaks.length > 0) {
      useOndas.setState((s) => ({ ondas: { ...s.ondas, [path]: r.value } }))
    } else {
      // Deu errado: libera para tentar de novo na proxima vez que aparecer.
      pedidos.delete(path)
    }
  })
}
