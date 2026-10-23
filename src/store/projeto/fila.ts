import { semExtensaoDeProjeto } from '@shared/project-file'
import type { GetProjeto, ProjectState, QueueItem, SetProjeto } from '../project'

/** Do store do editor (ver ../project.ts): a fila de projetos. */
export type FatiaDaFila = Pick<ProjectState, 'enqueue' | 'removeFromQueue' | 'clearQueue' | 'stopQueue' | 'runQueue'>

export const fatiaDaFila = (set: SetProjeto, get: GetProjeto): FatiaDaFila => ({

  // --------------------------------------------------------------------- fila

  enqueue: (paths) => {
    const existentes = new Set(get().queue.map((item) => item.path))
    const novos: QueueItem[] = paths
      .filter((path) => !existentes.has(path))
      .map((path) => ({
        path,
        fileName: semExtensaoDeProjeto(path.split(/[\\/]/).pop() ?? path),
        status: 'pendente' as const,
        output: null,
        error: null,
      }))

    if (novos.length === 0) return
    set((state) => ({ queue: [...state.queue, ...novos] }))
  },

  removeFromQueue: (path) =>
    set((state) => ({ queue: state.queue.filter((item) => item.path !== path) })),

  clearQueue: () => set({ queue: [] }),

  stopQueue: () => set({ queueRunning: false }),

  /**
   * Renderiza a fila abrindo cada projeto de verdade.
   *
   * Parece indireto e e de proposito: abrir e renderizar pelo mesmo caminho da
   * interface garante que um video da fila saia identico ao mesmo video
   * renderizado a mao. Um segundo caminho de montagem no main seria outra
   * implementacao para manter em dia -- e o dia em que as duas divergissem, o
   * usuario descobriria pelo arquivo errado.
   *
   * Um projeto que falha nao para a fila: os outros continuam, e o erro fica
   * registrado no item. Quem deixou cinco projetos rodando de madrugada quer
   * quatro videos e um aviso, nao zero videos.
   */
  runQueue: async () => {
    if (get().queueRunning) return
    if (get().queue.every((item) => item.status !== 'pendente')) return

    // A fila abre outro projeto por cima deste. Trabalho nao salvo morreria ai.
    if (get().projectDirty && get().audio) {
      set({ error: 'Salve o projeto aberto antes de rodar a fila (Ctrl+S).' })
      return
    }

    set({ queueRunning: true, error: null })

    const marcar = (path: string, patch: Partial<QueueItem>): void => {
      set((state) => ({
        queue: state.queue.map((item) => (item.path === path ? { ...item, ...patch } : item)),
      }))
    }

    while (get().queueRunning) {
      const proximo = get().queue.find((item) => item.status === 'pendente')
      if (!proximo) break

      marcar(proximo.path, { status: 'renderizando', error: null })

      await get().openProject(proximo.path)
      const erroAoAbrir = get().error
      if (erroAoAbrir) {
        marcar(proximo.path, { status: 'falhou', error: erroAoAbrir })
        set({ error: null })
        continue
      }

      const saida = await get().startRender()
      if (saida) {
        marcar(proximo.path, { status: 'pronto', output: saida })
      } else {
        marcar(proximo.path, {
          status: 'falhou',
          error: get().error ?? 'O render não terminou.',
        })
        set({ error: null })
      }
    }

    set({ queueRunning: false })
  },
})
