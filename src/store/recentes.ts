import { create } from 'zustand'
import { useProject } from './project'

/**
 * OS PROJETOS RECENTES, para a tela inicial.
 *
 * "Na pagina inicial quero que tenha um historico de projetos recentes." Cada
 * projeto aberto ou salvo entra no topo da lista, com a miniatura do primeiro
 * bloco, quantos blocos e quanto dura -- o bastante para reconhecer o video
 * sem abrir. A lista mora no settings.json (sobrevive a atualizacao), com no
 * maximo 12.
 */

export interface Recente {
  path: string
  nome: string
  /** WEBP pequeno em data URL: a miniatura do primeiro bloco. */
  capa: string | null
  /** Quando foi aberto ou salvo por ultimo, em ms. */
  em: number
  blocos: number
  duracaoSec: number
}

const MAXIMO = 12

function conferir(bruto: readonly Record<string, unknown>[]): Recente[] {
  const ok: Recente[] = []
  for (const r of bruto) {
    if (typeof r['path'] !== 'string' || typeof r['nome'] !== 'string') continue
    ok.push({
      path: r['path'],
      nome: r['nome'],
      capa: typeof r['capa'] === 'string' && r['capa'].startsWith('data:image/') ? r['capa'] : null,
      em: typeof r['em'] === 'number' ? r['em'] : 0,
      blocos: typeof r['blocos'] === 'number' ? r['blocos'] : 0,
      duracaoSec: typeof r['duracaoSec'] === 'number' ? r['duracaoSec'] : 0,
    })
  }
  return ok
}

interface EstadoDosRecentes {
  lista: Recente[]
  /** path -> o arquivo ainda existe. Sem resposta ainda = presume que sim. */
  existe: Record<string, boolean>
  carregar: () => Promise<void>
  /** Poe o projeto aberto agora no topo da lista. */
  lembrar: (path: string) => Promise<void>
  esquecer: (path: string) => Promise<void>
}

export const useRecentes = create<EstadoDosRecentes>((set, get) => {
  const gravar = async (lista: Recente[]): Promise<void> => {
    set({ lista })
    await window.dangai.saveSettings({ recentes: lista as unknown as Record<string, unknown>[] })
  }
  return {
    lista: [],
    existe: {},
    carregar: async () => {
      const r = await window.dangai.getSettings()
      if (!r.ok) return
      const lista = conferir(r.value.recentes)
      set({ lista })
      const e = await window.dangai.existemArquivos(lista.map((x) => x.path))
      if (e.ok) set({ existe: Object.fromEntries(lista.map((x, i) => [x.path, e.value[i] ?? false])) })
    },
    lembrar: async (path) => {
      const p = useProject.getState()
      const primeira = p.plan?.scenes[0]
      const capa = primeira ? (p.images[primeira.imageIndex]?.thumbnail ?? null) : (p.images[0]?.thumbnail ?? null)
      const novo: Recente = {
        path,
        nome: path.split(/[\\/]/).pop()?.replace(/\.dangai$/i, '') ?? path,
        // Miniatura grande demais nao entra: o settings.json e lido a cada abertura.
        capa: capa && capa.length < 60_000 ? capa : null,
        em: Date.now(),
        blocos: p.plan?.scenes.length ?? 0,
        duracaoSec: p.audio?.durationSec ?? 0,
      }
      // Le de novo antes de gravar: a lista do settings pode ter mudado noutra tela.
      const r = await window.dangai.getSettings()
      const atual = r.ok ? conferir(r.value.recentes) : get().lista
      const lista = [novo, ...atual.filter((x) => x.path.toLowerCase() !== path.toLowerCase())].slice(0, MAXIMO)
      set((s) => ({ existe: { ...s.existe, [path]: true } }))
      await gravar(lista)
    },
    esquecer: async (path) => {
      await gravar(get().lista.filter((x) => x.path !== path))
    },
  }
})
