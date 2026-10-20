import { create } from 'zustand'

/**
 * UMA PERGUNTA DE SIM OU NAO, numa janelinha do proprio app (ver
 * components/Pergunta). `perguntar` devolve true no "sim". Uma por vez: uma
 * pergunta nova responde "nao" a que estava aberta.
 */
export interface Pergunta {
  titulo: string
  texto: string
  sim: string
  nao: string
}

let responder: ((sim: boolean) => void) | null = null

export const usePergunta = create<{ aberta: Pergunta | null }>(() => ({ aberta: null }))

export function perguntar(p: Pergunta): Promise<boolean> {
  responder?.(false)
  return new Promise((resolve) => {
    responder = resolve
    usePergunta.setState({ aberta: p })
  })
}

export function responderPergunta(sim: boolean): void {
  const r = responder
  responder = null
  usePergunta.setState({ aberta: null })
  r?.(sim)
}
