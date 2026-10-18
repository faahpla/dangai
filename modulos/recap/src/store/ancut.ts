import { create } from 'zustand'
import type { EnvioAutomatico } from '../../shared/ancut'
import type { EpisodeIndex } from '../../shared/episodio'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { useGerar } from './gerar'

/**
 * MOVER PARA O ANCUT (L1), na tela: o estado do botao por episodio. O main
 * confere tudo de novo antes de escrever; aqui so se pergunta "substituir?"
 * quando o episodio ja esta la diferente, e o resultado do "Enviar sempre"
 * chega por evento (nunca pergunta no meio do fluxo). O indice novo (o
 * episodio agora mora no AnCut) chega pelo evento do corte, como o fim do
 * corte: o passo 1 e o passo 4 trocam sozinhos.
 */

export type FaseDoEnvio =
  | 'conferindo'
  | 'perguntando'
  | 'enviando'
  | 'feito'
  | 'recusado'
  /** Ja esta igual no AnCut (copiado pela versao antiga): o botao vira "Unificar". */
  | 'unificavel'
  | 'unificando'
  /** O "Reconhecer agora" de quem mora no AnCut: voltando para o recap. */
  | 'trazendo'

export interface EnvioNaTela {
  fase: FaseDoEnvio
  mensagem: string
}

interface EstadoDoAncut {
  /** null = ainda nao se sabe. */
  achado: boolean | null
  porEpisodio: Record<string, EnvioNaTela>
  conferirAchado: () => Promise<void>
  /** Sem custo (sem olhar o processo): so para o rotulo do botao (Mover ou Unificar). */
  conferirRotulo: (episodioId: string) => Promise<void>
  /** O clique: confere; pronto = move; ja existe = pergunta; igual la = unifica. */
  enviar: (episodioId: string) => Promise<void>
  /** A resposta do "substituir?". */
  responder: (episodioId: string, substituir: boolean) => Promise<void>
  unificar: (episodioId: string) => Promise<void>
  /** O "Reconhecer agora" de um episodio que mora no AnCut: volta antes. O indice de volta (null = nao voltou). */
  trazer: (episodioId: string) => Promise<EpisodeIndex | null>
  receberAutomatico: (aviso: EnvioAutomatico) => void
}

/** Com o assistente aberto, o recado vai no rodape dele; fechado, na barra do editor. */
function avisar(mensagem: string): void {
  if (useGerar.getState().aberto) useGerar.setState({ recado: mensagem })
  else nucleo().mostrarErro(mensagem)
}

/** O episodio saiu da biblioteca do recap: a Biblioteca do editor relê (ele aparece uma vez, na raiz do AnCut). */
function relerBiblioteca(): void {
  try {
    if (nucleo().ler().library) void nucleo().sincronizarBiblioteca()
  } catch {
    /* sem Biblioteca aberta: a proxima abertura ja le tudo */
  }
}

export const useAncut = create<EstadoDoAncut>((set, get) => {
  const marcar = (id: string, envio: EnvioNaTela): void => set({ porEpisodio: { ...get().porEpisodio, [id]: envio } })
  const ocupado = (id: string): boolean => {
    const f = get().porEpisodio[id]?.fase
    return f === 'conferindo' || f === 'enviando' || f === 'unificando' || f === 'trazendo'
  }
  const mandar = async (id: string, substituir: boolean): Promise<void> => {
    marcar(id, { fase: 'enviando', mensagem: 'Movendo para o AnCut...' })
    const r = await ponte.enviarAoAncut(id, substituir)
    if (!r.ok) marcar(id, { fase: 'recusado', mensagem: r.error })
    else {
      marcar(id, { fase: r.value.enviado ? 'feito' : 'recusado', mensagem: r.value.mensagem })
      if (r.value.enviado) relerBiblioteca()
    }
  }
  return {
    achado: null,
    porEpisodio: {},
    conferirAchado: async () => {
      const r = await ponte.ancutAchado()
      set({ achado: r.ok ? r.value : false })
    },
    conferirRotulo: async (id) => {
      if (ocupado(id)) return
      const r = await ponte.conferirAncut(id, true)
      if (!r.ok || ocupado(id)) return
      const atual = get().porEpisodio[id]
      if (r.value.situacao === 'unificar') marcar(id, { fase: 'unificavel', mensagem: r.value.mensagem })
      else if (atual?.fase === 'unificavel') {
        const { [id]: _, ...resto } = get().porEpisodio
        set({ porEpisodio: resto })
      }
    },
    enviar: async (id) => {
      if (ocupado(id)) return
      marcar(id, { fase: 'conferindo', mensagem: 'Conferindo o AnCut...' })
      const c = await ponte.conferirAncut(id)
      if (!c.ok) {
        marcar(id, { fase: 'recusado', mensagem: c.error })
        return
      }
      if (c.value.situacao === 'sem-ancut') set({ achado: false })
      if (c.value.situacao === 'unificar') {
        await get().unificar(id)
        return
      }
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
    unificar: async (id) => {
      const atual = get().porEpisodio[id]?.fase
      if (atual === 'enviando' || atual === 'unificando' || atual === 'trazendo') return
      marcar(id, { fase: 'unificando', mensagem: 'Unificando...' })
      const r = await ponte.unificarComOAncut(id)
      if (!r.ok) marcar(id, { fase: 'recusado', mensagem: r.error })
      else {
        marcar(id, { fase: r.value.enviado ? 'feito' : 'recusado', mensagem: r.value.mensagem })
        if (r.value.enviado) relerBiblioteca()
      }
    },
    trazer: async (id) => {
      if (ocupado(id)) return null
      marcar(id, { fase: 'trazendo', mensagem: 'Trazendo do AnCut...' })
      const r = await ponte.trazerDoAncut(id)
      const ok = r.ok && r.value.trazido && r.value.indice !== null
      if (ok) {
        // De volta ao recap: o botao volta ao "Mover" (o fim do reconhecimento devolve).
        const { [id]: _, ...resto } = get().porEpisodio
        set({ porEpisodio: resto })
        relerBiblioteca()
      } else marcar(id, { fase: 'recusado', mensagem: r.ok ? r.value.mensagem : r.error })
      return ok && r.ok ? r.value.indice : null
    },
    receberAutomatico: (aviso) => {
      marcar(aviso.episodioId, { fase: aviso.enviado ? 'feito' : 'recusado', mensagem: aviso.mensagem })
      if (aviso.enviado) relerBiblioteca()
      // Nao moveu: avisa uma vez, sem perguntar (o corte ja acabou e a tela pode estar em outro passo).
      else avisar(aviso.mensagem)
    },
  }
})

/** A escuta do "Enviar sempre" (montada com o assistente, como a do motor). */
export function escutarAncut(): () => void {
  return ponte.onEnvioAutomatico((aviso) => useAncut.getState().receberAutomatico(aviso))
}
