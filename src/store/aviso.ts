import { create } from 'zustand'

/**
 * Um recado CINZA na barra de baixo, por alguns segundos: o que acabou de dar
 * certo ("Do seu jeito: 14 sons e a sua cor"). O vermelho continua sendo o
 * `error` do store, so para o que deu errado.
 */
export const useAviso = create<{ texto: string | null }>(() => ({ texto: null }))
let apagar: ReturnType<typeof setTimeout> | null = null

export function avisar(texto: string, ms = 8000): void {
  useAviso.setState({ texto })
  if (apagar) clearTimeout(apagar)
  apagar = setTimeout(() => useAviso.setState({ texto: null }), ms)
}
