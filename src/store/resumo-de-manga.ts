import { create } from 'zustand'
import {
  textoDoResumo,
  type ResumoDoManga,
  type SerieDoManga,
  type TamanhoDoResumo,
} from '@shared/resumo-de-manga'
import { useProject } from './project'

/**
 * A TELA DO RESUMO DE MANGA (ver shared/resumo-de-manga.ts): escolher os
 * capitulos, corrigir o roteiro que a IA escreveu e soltar a narracao.
 *
 * Fica fora do projeto ate a narracao chegar: antes disso nao ha projeto (o
 * projeto do Dangai nasce do audio). Por isso o RASCUNHO -- capitulos, roteiro
 * e quadrinhos -- mora no localStorage: ele escreve, fecha o app para gravar,
 * e quando volta esta tudo ali.
 */

const CHAVE = 'dangai.resumo-de-manga.rascunho'

interface Rascunho {
  escolhidos: string[]
  tamanho: TamanhoDoResumo
  pedido: string
  resumo: ResumoDoManga | null
}

interface EstadoDoResumo extends Rascunho {
  aberta: boolean
  series: SerieDoManga[] | null
  andamento: string | null
  erro: string | null
  abrir: () => Promise<void>
  fechar: () => void
  alternarCapitulo: (dir: string) => void
  definir: (parte: Partial<Pick<Rascunho, 'tamanho' | 'pedido'>>) => void
  escrever: () => Promise<void>
  /** Volta a escolher capitulos; o roteiro escrito vai embora. */
  recomecar: () => void
  mudarTitulo: (titulo: string) => void
  mudarFrase: (i: number, texto: string) => void
  apagarFrase: (i: number) => void
  novaFrase: (depoisDe: number) => void
  /** Liga/desliga um quadrinho na frase (pelo ref). */
  alternarQuadro: (i: number, ref: string) => void
  moverQuadro: (i: number, de: number, para: number) => void
  /** A narracao gravada: nasce o projeto, ja com o roteiro e os quadrinhos de cada frase. */
  usarNarracao: (caminho: string) => Promise<void>
}

function lerRascunho(): Rascunho {
  const vazio: Rascunho = { escolhidos: [], tamanho: 'curto', pedido: '', resumo: null }
  try {
    const cru = localStorage.getItem(CHAVE)
    if (!cru) return vazio
    const r = JSON.parse(cru) as Partial<Rascunho>
    return {
      escolhidos: Array.isArray(r.escolhidos) ? r.escolhidos.filter((x): x is string => typeof x === 'string') : [],
      tamanho: r.tamanho === 'medio' || r.tamanho === 'longo' ? r.tamanho : 'curto',
      pedido: typeof r.pedido === 'string' ? r.pedido : '',
      resumo: r.resumo && Array.isArray(r.resumo.frases) && Array.isArray(r.resumo.quadros) ? r.resumo : null,
    }
  } catch {
    return vazio
  }
}

let gravarDepois: ReturnType<typeof setTimeout> | null = null
function guardar(r: Rascunho): void {
  if (gravarDepois) clearTimeout(gravarDepois)
  gravarDepois = setTimeout(() => {
    try {
      const { escolhidos, tamanho, pedido, resumo } = r
      localStorage.setItem(CHAVE, JSON.stringify({ escolhidos, tamanho, pedido, resumo }))
    } catch {
      /* sem espaco: o rascunho so nao sobrevive a fechar o app */
    }
  }, 400)
}

function esquecerRascunho(): void {
  if (gravarDepois) clearTimeout(gravarDepois)
  try {
    localStorage.removeItem(CHAVE)
  } catch {
    /* nada */
  }
}

export const useResumoDeManga = create<EstadoDoResumo>((set, get) => {
  /** Muda o roteiro e guarda o rascunho. */
  const mudarResumo = (f: (r: ResumoDoManga) => ResumoDoManga): void => {
    const atual = get().resumo
    if (!atual) return
    set({ resumo: f(atual) })
    guardar(get())
  }

  return {
    ...lerRascunho(),
    aberta: false,
    series: null,
    andamento: null,
    erro: null,

    abrir: async () => {
      set({ aberta: true, erro: null })
      const r = await window.dangai.seriesDosMangas()
      if (r.ok) set({ series: r.value })
      else set({ series: [], erro: r.error })
      // Rascunho de outra sessao: o endereco das miniaturas mudou.
      const resumo = get().resumo
      if (resumo && resumo.quadros.length > 0) {
        const urls = await window.dangai.miniaturasDoResumo(resumo.quadros.map((q) => q.arquivoDaMiniatura))
        if (urls.ok && get().resumo === resumo) {
          set({ resumo: { ...resumo, quadros: resumo.quadros.map((q, i) => ({ ...q, miniatura: urls.value[i] || q.miniatura })) } })
        }
      }
    },

    fechar: () => set({ aberta: false }),

    alternarCapitulo: (dir) => {
      const { escolhidos, series } = get()
      const proximos = escolhidos.includes(dir) ? escolhidos.filter((d) => d !== dir) : [...escolhidos, dir]
      // Na ordem da pasta (serie, depois capitulo), e nao na ordem do clique: o resumo segue a historia.
      const ordem = (series ?? []).flatMap((s) => s.capitulos.map((c) => c.dir))
      proximos.sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b))
      set({ escolhidos: proximos })
      guardar(get())
    },

    definir: (parte) => {
      set(parte)
      guardar(get())
    },

    escrever: async () => {
      const { escolhidos, tamanho, pedido, andamento } = get()
      if (escolhidos.length === 0 || andamento) return
      set({ andamento: 'Começando...', erro: null })
      const parar = window.dangai.onProgressoDoResumo((m) => set({ andamento: m }))
      try {
        const r = await window.dangai.escreverResumoDoManga({ dirs: escolhidos, tamanho, pedido })
        if (r.ok) {
          set({ resumo: r.value })
          guardar(get())
        } else set({ erro: r.error })
      } finally {
        parar()
        set({ andamento: null })
      }
    },

    recomecar: () => {
      set({ resumo: null, erro: null })
      guardar(get())
    },

    mudarTitulo: (titulo) => mudarResumo((r) => ({ ...r, titulo })),

    mudarFrase: (i, texto) =>
      mudarResumo((r) => ({ ...r, frases: r.frases.map((f, k) => (k === i ? { ...f, texto } : f)) })),

    apagarFrase: (i) => mudarResumo((r) => ({ ...r, frases: r.frases.filter((_, k) => k !== i) })),

    novaFrase: (depoisDe) =>
      mudarResumo((r) => ({
        ...r,
        frases: [...r.frases.slice(0, depoisDe + 1), { texto: '', quadros: [] }, ...r.frases.slice(depoisDe + 1)],
      })),

    alternarQuadro: (i, ref) =>
      mudarResumo((r) => ({
        ...r,
        frases: r.frases.map((f, k) => {
          if (k !== i) return f
          if (f.quadros.includes(ref)) return { ...f, quadros: f.quadros.filter((x) => x !== ref) }
          // Entra na ordem do manga, que e a ordem em que a frase conta.
          const ordem = r.quadros.map((q) => q.ref)
          return { ...f, quadros: [...f.quadros, ref].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b)) }
        }),
      })),

    moverQuadro: (i, de, para) =>
      mudarResumo((r) => ({
        ...r,
        frases: r.frases.map((f, k) => {
          if (k !== i || de === para || para < 0 || para >= f.quadros.length) return f
          const q = [...f.quadros]
          const [x] = q.splice(de, 1)
          q.splice(para, 0, x!)
          return { ...f, quadros: q }
        }),
      })),

    usarNarracao: async (caminho) => {
      const { resumo } = get()
      if (!resumo) return
      const frases = resumo.frases.filter((f) => f.texto.trim())
      const porRef = new Map(resumo.quadros.map((q) => [q.ref, q.caminho]))
      const projeto = useProject.getState()
      // Um projeto aberto fica onde esta (o auto save ja gravou): o resumo e um video novo.
      if (projeto.audio) projeto.reset()
      useProject.setState({
        script: textoDoResumo(frases),
        resumoDoManga: {
          titulo: resumo.titulo,
          capitulos: resumo.capitulos.map((c) => c.dir),
          frases: frases.map((f) => ({
            texto: f.texto.trim(),
            quadros: f.quadros.map((r) => porRef.get(r)).filter((x): x is string => !!x),
          })),
        },
      })
      // O roteiro que ele vai gravar, ja corrigido, e o melhor exemplo do jeito dele.
      void window.dangai.aprenderResumo({ titulo: resumo.titulo, texto: textoDoResumo(frases) })
      set({ aberta: false })
      await useProject.getState().ingest([caminho], undefined, 'dialogo')
      // Deu certo (a narracao entrou): o rascunho virou projeto.
      if (useProject.getState().audio?.path) {
        esquecerRascunho()
        set({ resumo: null, escolhidos: [], pedido: '' })
      }
    },
  }
})
