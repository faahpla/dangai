import { create } from 'zustand'
import type { EnvioAutomatico } from '../../shared/ancut'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'

/**
 * ENVIAR PARA O ANCUT (L1), na tela: o estado do botao por episodio. O main
 * confere tudo de novo antes de escrever; aqui so se pergunta "substituir?"
 * quando o episodio ja esta la, e o resultado do "Enviar sempre" chega por
 * evento (nunca pergunta no meio do fluxo).
 */

export type FaseDoEnvio = 'conferindo' | 'perguntando' | 'enviando' | 'feito' | 'recusado'

export interface EnvioNaTela {
  fase: FaseDoEnvio
  mensagem: string
}

interface EstadoDoAncut {
  /** null = ainda nao se sabe. */
  achado: boolean | null
  porEpisodio: Record<string, EnvioNaTela>
  conferirAchado: () => Promise<void>
  /** O clique: confere; pronto = envia; ja existe = pergunta. */
  enviar: (episodioId: string) => Promise<void>
  /** A resposta do "substituir?". */
  responder: (episodioId: string, substituir: boolean) => Promise<void>
  receberAutomatico: (aviso: EnvioAutomatico) => void
}

export const useAncut = create<EstadoDoAncut>((set, get) => {
  const marcar = (id: string, envio: EnvioNaTela): void => set({ porEpisodio: { ...get().porEpisodio, [id]: envio } })
  const mandar = async (id: string, substituir: boolean): Promise<void> => {
    marcar(id, { fase: 'enviando', mensagem: 'Enviando ao AnCut...' })
    const r = await ponte.enviarAoAncut(id, substituir)
    if (!r.ok) marcar(id, { fase: 'recusado', mensagem: r.error })
    else marcar(id, { fase: r.value.enviado ? 'feito' : 'recusado', mensagem: r.value.mensagem })
  }
  return {
    achado: null,
    porEpisodio: {},
    conferirAchado: async () => {
      const r = await ponte.ancutAchado()
      set({ achado: r.ok ? r.value : false })
    },
    enviar: async (id) => {
      const atual = get().porEpisodio[id]
      if (atual && (atual.fase === 'conferindo' || atual.fase === 'enviando')) return
      marcar(id, { fase: 'conferindo', mensagem: 'Conferindo o AnCut...' })
      const c = await ponte.conferirAncut(id)
      if (!c.ok) {
        marcar(id, { fase: 'recusado', mensagem: c.error })
        return
      }
      if (c.value.situacao === 'sem-ancut') set({ achado: false })
      if (c.value.situacao === 'ja-existe') {
        marcar(id, { fase: 'perguntando', mensagem: 'Ja esta no AnCut.' })
        return
      }
      if (c.value.situacao !== 'pronto') {
        marcar(id, { fase: 'recusado', mensagem: c.value.mensagem })
        return
      }
      await mandar(id, false)
    },
    responder: async (id, substituir) => {
      if (!substituir) {
        marcar(id, { fase: 'recusado', mensagem: 'Pulado: ficou o que estava no AnCut.' })
        return
      }
      await mandar(id, true)
    },
    receberAutomatico: (aviso) => {
      marcar(aviso.episodioId, { fase: aviso.enviado ? 'feito' : 'recusado', mensagem: aviso.mensagem })
      // Nao enviou: avisa uma vez, sem perguntar (o corte ja acabou e a tela pode estar em outro passo).
      if (!aviso.enviado) nucleo().mostrarErro(aviso.mensagem)
    },
  }
})

/** A escuta do "Enviar sempre" (montada com o assistente, como a do motor). */
export function escutarAncut(): () => void {
  return ponte.onEnvioAutomatico((aviso) => useAncut.getState().receberAutomatico(aviso))
}
