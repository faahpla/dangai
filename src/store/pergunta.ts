import { create } from 'zustand'

/**
 * UMA PERGUNTA numa janelinha do proprio app (ver components/Pergunta). Uma
 * por vez: uma pergunta nova responde "nao" a que estava aberta.
 *
 *  - `perguntar`: sim ou nao. Devolve true no "sim".
 *  - `perguntarTexto`: com um campo de texto (o nome do projeto). Devolve o
 *    texto, ou null no "nao".
 */
export interface Pergunta {
  titulo: string
  texto: string
  sim: string
  nao: string
  /** Com campo: o texto que ja vem escrito (e selecionado). */
  campo?: string
}

let responder: ((resposta: string | null) => void) | null = null

export const usePergunta = create<{ aberta: Pergunta | null }>(() => ({ aberta: null }))

function abrir(p: Pergunta): Promise<string | null> {
  responder?.(null)
  return new Promise((resolve) => {
    responder = resolve
    usePergunta.setState({ aberta: p })
  })
}

export async function perguntar(p: Omit<Pergunta, 'campo'>): Promise<boolean> {
  return (await abrir(p)) !== null
}

export function perguntarTexto(p: Pergunta & { campo: string }): Promise<string | null> {
  return abrir(p)
}

/** `sim` com o texto do campo (vazio quando a pergunta nao tem campo). */
export function responderPergunta(sim: boolean, texto = ''): void {
  const r = responder
  responder = null
  usePergunta.setState({ aberta: null })
  r?.(sim ? texto : null)
}
