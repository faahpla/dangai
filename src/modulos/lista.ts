import { create } from 'zustand'
import type { ModuloPublico } from '@shared/modulos'

/**
 * Os modulos instalados, como o main os ve (ligado, config publica, dica das
 * chaves). Mora sozinho para a fachada (./nucleo) e o runtime (./index)
 * usarem sem um importar o outro.
 */
export const useModulos = create<{
  lista: ModuloPublico[]
  carregar(): Promise<void>
  ligar(id: string, ligado: boolean): Promise<string | null>
}>((set) => ({
  lista: [],
  carregar: async () => {
    const r = await window.dangai.listarModulos()
    if (r.ok) set({ lista: r.value })
  },
  ligar: async (id, ligado) => {
    const r = await window.dangai.ligarModulo(id, ligado)
    if (!r.ok) return r.error
    set({ lista: r.value })
    return null
  },
}))

