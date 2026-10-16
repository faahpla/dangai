import { create } from 'zustand'

/**
 * [recap] O RECONHECER NA MAO depende do motor (parte 4). Ate la, nenhuma
 * rodada e nenhum resultado na tela.
 */
export const useDescoberta = create<{ resultado: null; episodioId: string | null }>(() => ({
  resultado: null,
  episodioId: null,
}))
