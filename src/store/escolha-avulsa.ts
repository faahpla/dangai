import { create } from 'zustand'

/**
 * A BIBLIOTECA RESPONDENDO UMA PERGUNTA SO: "qual cena?". Quem pede (a cena da
 * frase de ligacao do Juntar projetos) abre a Biblioteca com este pedido; o
 * primeiro clique numa cena devolve o caminho dela e fecha. Irmao do
 * `replaceTarget` (trocar a cena de um bloco), para quem ainda nao tem projeto
 * aberto -- ou tem outro.
 */
export interface PedidoDeCena {
  /** O que a faixa no alto da Biblioteca diz ("Escolha a cena da ligação 1"). */
  titulo: string
  aoEscolher: (caminho: string) => void
}

export const useEscolhaAvulsa = create<{
  pedido: PedidoDeCena | null
  pedir: (pedido: PedidoDeCena) => void
  limpar: () => void
}>((set) => ({
  pedido: null,
  pedir: (pedido) => set({ pedido }),
  limpar: () => set({ pedido: null }),
}))
