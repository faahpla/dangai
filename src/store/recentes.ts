import { create } from 'zustand'
import { modulosDoProjeto, semExtensaoDeProjeto } from '@shared/project-file'
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
  /**
   * Os modulos com dado no projeto (ids, ver modulosDoProjeto): o card mostra a
   * etiqueta dos que estao ligados. Ausente = sem dado de modulo, ou entrada de
   * antes disto (ganha o campo quando o projeto abrir ou salvar de novo).
   */
  modulos?: string[]
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
      ...(Array.isArray(r['modulos'])
        ? { modulos: r['modulos'].filter((id): id is string => typeof id === 'string') }
        : {}),
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
  /**
   * Depois do auto save: refaz o card so se ele mudaria (capa, blocos, duracao).
   * Gravar o settings a cada 1,2 s de edicao seria barulho para nada.
   */
  atualizarSeMudou: (path: string) => Promise<void>
  esquecer: (path: string) => Promise<void>
}

/** O card do projeto aberto agora, do jeito que entra na lista. */
function cardDoAberto(path: string): Recente {
  const p = useProject.getState()
  const primeira = p.plan?.scenes[0]
  const capa = primeira ? (p.images[primeira.imageIndex]?.thumbnail ?? null) : (p.images[0]?.thumbnail ?? null)
  const modulos = modulosDoProjeto(p)
  return {
    path,
    nome: semExtensaoDeProjeto(path.split(/[\\/]/).pop() ?? path),
    // Miniatura grande demais nao entra: o settings.json e lido a cada abertura.
    capa: capa && capa.length < 60_000 ? capa : null,
    em: Date.now(),
    blocos: p.plan?.scenes.length ?? 0,
    duracaoSec: p.audio?.durationSec ?? 0,
    // So com dado de modulo: projeto do Dangai grava a entrada de sempre.
    ...(modulos.length > 0 ? { modulos } : {}),
  }
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
      const novo = cardDoAberto(path)
      // Le de novo antes de gravar: a lista do settings pode ter mudado noutra tela.
      const r = await window.dangai.getSettings()
      const atual = r.ok ? conferir(r.value.recentes) : get().lista
      const lista = [novo, ...atual.filter((x) => x.path.toLowerCase() !== path.toLowerCase())].slice(0, MAXIMO)
      set((s) => ({ existe: { ...s.existe, [path]: true } }))
      await gravar(lista)
    },
    atualizarSeMudou: async (path) => {
      const novo = cardDoAberto(path)
      const atual = get().lista.find((x) => x.path.toLowerCase() === path.toLowerCase())
      const igual =
        atual !== undefined &&
        atual.capa === novo.capa &&
        atual.blocos === novo.blocos &&
        Math.round(atual.duracaoSec) === Math.round(novo.duracaoSec) &&
        (atual.modulos ?? []).join() === (novo.modulos ?? []).join()
      if (!igual) await get().lembrar(path)
    },
    esquecer: async (path) => {
      await gravar(get().lista.filter((x) => x.path !== path))
    },
  }
})
