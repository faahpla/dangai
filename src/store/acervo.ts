import { create } from 'zustand'
import type { Acervo, EpisodioDoAcervo, PersonagemDoAcervo } from '@shared/acervo'
import { useProject } from './project'

/**
 * O ACERVO na tela (25/11): a Biblioteca do AnCut dentro do Dangai. O que
 * esta aberto (a grade dos animes, um anime, um episodio, os personagens, um
 * personagem), os dados que o motor deu e o aviso de uma linha do que a
 * ultima acao fez ("Exportado: 32 personagens...").
 *
 * Os dados ficam guardados entre uma abertura e outra (o `recent` do motor
 * leva alguns segundos num acervo grande); "Atualizar" e qualquer mudanca
 * (marcar, juntar, temporada) leem de novo.
 */

export type AbaDoAcervo = 'animes' | 'personagens'

interface LojaDoAcervo {
  aberto: boolean
  aba: AbaDoAcervo
  dados: Acervo | null
  lendo: boolean
  erro: string | null
  /** A pasta do anime aberto (null = a grade). */
  anime: string | null
  /** O episodio aberto (dentro do anime). */
  episodio: EpisodioDoAcervo | null
  personagens: PersonagemDoAcervo[] | null
  lendoPersonagens: boolean
  /** O personagem aberto, e de qual anime (a secao clicada). */
  personagem: { p: PersonagemDoAcervo; anime: string } | null
  aviso: { ok: boolean; texto: string } | null
  abrir: (aba?: AbaDoAcervo) => void
  fechar: () => void
  setAba: (aba: AbaDoAcervo) => void
  ler: () => Promise<void>
  lerPersonagens: () => Promise<void>
  abrirAnime: (pasta: string | null) => void
  abrirEpisodio: (e: EpisodioDoAcervo | null) => void
  abrirPersonagem: (p: PersonagemDoAcervo | null, anime?: string) => void
  avisar: (texto: string, ok?: boolean) => void
  /** Algo mudou no motor: le de novo o que estiver na tela (e a Biblioteca, se aberta). */
  mudou: () => void
}

export const useAcervo = create<LojaDoAcervo>((set, get) => ({
  aberto: false,
  aba: 'animes',
  dados: null,
  lendo: false,
  erro: null,
  anime: null,
  episodio: null,
  personagens: null,
  lendoPersonagens: false,
  personagem: null,
  aviso: null,

  abrir: (aba) => {
    // A Biblioteca e o Acervo nao ficam abertos juntos (os menus e as janelas de organizar sao os mesmos).
    if (useProject.getState().libraryOpen) useProject.setState({ libraryOpen: false })
    set({ aberto: true, ...(aba ? { aba } : {}) })
    if (!get().dados) void get().ler()
    if ((aba ?? get().aba) === 'personagens' && !get().personagens) void get().lerPersonagens()
  },
  fechar: () => set({ aberto: false }),
  setAba: (aba) => {
    set({ aba })
    if (aba === 'personagens' && !get().personagens) void get().lerPersonagens()
  },

  ler: async () => {
    if (get().lendo) return
    set({ lendo: true, erro: null })
    const r = await window.dangai.acervoLer()
    if (!r.ok) {
      set({ lendo: false, erro: r.error })
      return
    }
    const { episodio } = get()
    // O episodio aberto pode ter mudado (temporada, B-roll): acha o mesmo pelo id.
    const novo = episodio ? (r.value.episodios.find((e) => e.episodioId === episodio.episodioId) ?? null) : null
    set({ lendo: false, dados: r.value, episodio: novo })
  },

  lerPersonagens: async () => {
    if (get().lendoPersonagens) return
    set({ lendoPersonagens: true })
    const r = await window.dangai.acervoPersonagens()
    if (!r.ok) {
      set({ lendoPersonagens: false })
      get().avisar(r.error, false)
      return
    }
    const aberto = get().personagem
    const mesmo = aberto ? r.value.find((p) => p.ids.some((id) => aberto.p.ids.includes(id))) : null
    set({ lendoPersonagens: false, personagens: r.value, personagem: aberto && mesmo ? { p: mesmo, anime: aberto.anime } : null })
  },

  abrirAnime: (pasta) => set({ anime: pasta, episodio: null }),
  abrirEpisodio: (e) => set({ episodio: e }),
  abrirPersonagem: (p, anime = '') => {
    set({ personagem: p ? { p, anime } : null, aba: 'personagens' })
    if (!get().personagens) void get().lerPersonagens()
  },

  avisar: (texto, ok = true) => set({ aviso: { ok, texto } }),

  mudou: () => {
    if (get().aberto) {
      void get().ler()
      if (get().personagens) void get().lerPersonagens()
    }
    if (useProject.getState().library) void useProject.getState().syncLibrary()
  },
}))
