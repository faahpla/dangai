import type { GetProjeto, ProjectState, SetProjeto } from '../project'
import { avisar } from '../aviso'

/** Do store do editor (ver ../project.ts): a Biblioteca, os apelidos, favoritos, etiquetas e descricoes. */
export type FatiaDaBiblioteca = Pick<ProjectState, 'openPalette' | 'mostrarNaBiblioteca' | 'esquecerIrParaClipe' | 'definirTrechoAoVivo' | 'mesclarCenas' | 'openLibrary' | 'loadNicknames' | 'loadFavorites' | 'loadTags' | 'loadDescriptions' | 'describeLibrary' | 'pararLeitura' | 'tagLibrary' | 'toggleFavorite' | 'saveNicknames' | 'setLibraryBusy' | 'syncLibrary' | 'addFromLibrary'>

export const fatiaDaBiblioteca = (set: SetProjeto, get: GetProjeto): FatiaDaBiblioteca => ({

  openPalette: (open) => set({ paletteOpen: open }),

  /*
   * Abrir varre so na primeira vez. Depois disso o indice fica no estado e a
   * tela abre instantanea -- reler seria pagar de novo por uma resposta que nao
   * mudou, e o botao "Sincronizar" existe justamente para quando ela mudou.
   */
  mostrarNaBiblioteca: async (path) => {
    // Sem troca pendurada: e para OLHAR o clipe, nao para substituir um bloco.
    set({ irParaClipe: path, replaceTarget: null })
    await get().openLibrary(true)
  },

  esquecerIrParaClipe: () => set({ irParaClipe: null }),

  definirTrechoAoVivo: (t) => set({ trechoAoVivo: t }),

  mesclarCenas: async (paths) => {
    set({ busy: `Mesclando ${paths.length} cenas...` })
    const r = await window.dangai.mesclarClipes(paths)
    if (!r.ok) {
      set({ busy: null })
      return { ok: false, recado: r.error }
    }
    const novo = r.value.path
    const saiu = new Set(r.value.pedacos)
    const nomeNovo = novo.split(/[\\/]/).pop()!.replace(/\.mp4$/i, '')
    /*
     * O ROTEIRO SEGUE A MESCLA: um trecho que usava os pedacos passa a usar o
     * clipe novo (uma vez so), e a fila de escolhidas tambem -- senao os dois
     * apontariam para arquivos que foram para a lixeira.
     */
    set((state) => {
      const blockClips: Record<number, string[]> = {}
      for (const [k, lista] of Object.entries(state.blockClips)) {
        const proxima: string[] = []
        for (const p of lista) {
          if (!saiu.has(p)) proxima.push(p)
          else if (!proxima.includes(novo)) proxima.push(novo)
        }
        blockClips[Number(k)] = proxima
      }
      const idsQueSairam = new Set(
        (state.library?.clips ?? []).filter((c) => saiu.has(c.path)).map((c) => c.id),
      )
      const escolhidos: string[] = []
      for (const id of state.escolhidos) {
        if (!idsQueSairam.has(id)) escolhidos.push(id)
        else {
          const idNovo = `${id.slice(0, id.lastIndexOf('/'))}/${nomeNovo}`
          if (!escolhidos.includes(idNovo)) escolhidos.push(idNovo)
        }
      }
      return { blockClips, escolhidos, busy: null }
    })
    await get().syncLibrary()
    const banco =
      r.value.ancut === 'atualizado'
        ? 'O AnCut já ve o mesmo.'
        : r.value.ancut === 'episodio-nao-encontrado'
          ? 'O AnCut não conhece este episódio, então só os arquivos mudaram.'
          : r.value.ancut === 'sem-banco'
            ? 'O AnCut não está instalado aqui; só os arquivos mudaram.'
            : 'Não deu para atualizar o banco do AnCut (ele está aberto?); os arquivos já mudaram.'
    return {
      ok: true,
      path: novo,
      recado: `${paths.length} cenas viraram ${nomeNovo} (${r.value.segundos.toFixed(1)}s). Os pedacos foram para a _lixeira do episódio. ${banco}`,
    }
  },

  openLibrary: async (open) => {
    // Fechar cancela a substituicao: sair da tela e desistir da pergunta.
    set(open ? { libraryOpen: true } : { libraryOpen: false, replaceTarget: null })
    if (!open) return
    // Os apelidos vem junto: sao poucos bytes e a tela precisa deles para dizer
    // quantos cada serie tem.
    await Promise.all([
      get().library ? Promise.resolve() : get().syncLibrary(),
      get().loadNicknames(),
      get().loadFavorites(),
      get().loadTags(),
      get().loadDescriptions(),
    ])
  },

  loadNicknames: async () => {
    const result = await window.dangai.readNicknames()
    if (result.ok) set({ nicknames: result.value })
  },

  loadFavorites: async () => {
    const result = await window.dangai.readFavorites()
    if (result.ok) set({ favorites: result.value })
  },

  loadTags: async () => {
    const result = await window.dangai.readTags()
    if (result.ok) set({ tags: result.value })
  },

  loadDescriptions: async () => {
    const result = await window.dangai.readDescriptions()
    if (result.ok) set({ descriptions: result.value })
  },

  describeLibrary: async (anime, ids) => {
    if (get().describeBusy) return
    /*
     * Pouco e o que importa, e nunca sozinho.
     *
     * Sao ~3,3s por cena: um episodio leva meia hora e o acervo inteiro passa
     * de dois dias. Por isso o botao le os episodios do B-roll, ou o anime
     * aberto, e nao tudo -- ele trabalha no mesmo dia em vez de esperar.
     */
    set({ describeBusy: true, libraryError: null, libraryBusy: 'Preparando o leitor de cenas...' })
    const result = await window.dangai.describeLibrary(anime, ids)
    // O ultimo recado do leitor e o resumo ("2.286 cenas lidas em 2h", "Leitura
    // parada: ..."): fica na barra de baixo depois que o botao volta ao normal.
    const resumo = get().libraryBusy
    if (result.ok) {
      set({ descriptions: result.value, describeBusy: false, libraryBusy: null })
      if (resumo && !resumo.startsWith('Preparando')) avisar(resumo, 12000)
    } else set({ libraryError: result.error, describeBusy: false, libraryBusy: null })
  },

  pararLeitura: async () => {
    await window.dangai.stopDescribe()
  },

  tagLibrary: async () => {
    if (get().taggerBusy) return
    /*
     * `libraryBusy` comeca preenchido de proposito.
     *
     * setLibraryBusy so substitui um andamento que JA existe -- guarda que
     * existe para a mensagem final da varredura nao ressuscitar o "carregando".
     * Sem semear aqui, os treze minutos de etiquetagem passariam em silencio e
     * a tela pareceria travada.
     */
    set({ taggerBusy: true, libraryError: null, libraryBusy: 'Preparando o etiquetador...' })
    const result = await window.dangai.tagLibrary()
    if (result.ok) set({ tags: result.value, taggerBusy: false, libraryBusy: null })
    else set({ libraryError: result.error, taggerBusy: false, libraryBusy: null })
  },

  toggleFavorite: async (id) => {
    /*
     * A tela muda ANTES do disco responder.
     *
     * Favoritar e um gesto de garimpo: ele passa por dezenas de cenas marcando
     * as boas, e uma estrela que so acende depois do ida-e-volta do IPC faz
     * cada clique parecer que nao pegou. O disco confirma logo atras, e se
     * falhar a lista volta ao que o main disse que e verdade.
     */
    const antes = get().favorites
    set({
      favorites: antes.includes(id) ? antes.filter((x) => x !== id) : [...antes, id],
    })
    const result = await window.dangai.toggleFavorite(id)
    if (result.ok) set({ favorites: result.value })
    else set({ favorites: antes, libraryError: result.error })
  },

  saveNicknames: async (series, list) => {
    set({ nicknamesBusy: true })
    const result = await window.dangai.saveNicknames(series, list)
    if (result.ok) set({ nicknames: result.value, nicknamesBusy: false })
    else set({ libraryError: result.error, nicknamesBusy: false })
  },

  // So substitui um andamento que ainda existe: a mensagem final do main pode
  // chegar depois de a varredura ter terminado e ressuscitaria o "carregando".
  setLibraryBusy: (mensagem) =>
    set((state) => (state.libraryBusy === null ? state : { libraryBusy: mensagem })),

  syncLibrary: async () => {
    set({ libraryBusy: 'Lendo a biblioteca...', libraryError: null })
    const result = await window.dangai.scanLibrary()
    if (result.ok) {
      set({ library: result.value, libraryBusy: null })
    } else {
      set({ libraryError: result.error, libraryBusy: null })
    }
  },

  /*
   * A biblioteca entrega CAMINHO, e caminho e exatamente o que o drop entrega.
   * Por isso ela reusa o ingest inteiro em vez de ter porta propria: o clipe que
   * veio da busca e o clipe que veio do Explorer sao a mesma coisa daqui para a
   * frente, com a mesma analise e o mesmo render.
   */
  /*
   * Adicionar uma PARTE deixa a biblioteca aberta; adicionar solto fecha.
   *
   * Sai do que cada acao quer dizer. Quem monta partes vai montar a proxima
   * agora, e fechar a tela a cada leva transformaria um video de cinco partes
   * em cinco reaberturas. Quem adiciona solto terminou de escolher.
   */
  addFromLibrary: async (paths, parte) => {
    if (paths.length === 0) return
    if (!parte) set({ libraryOpen: false })
    await get().ingest(paths, parte)
  },
})
