import { create } from 'zustand'
import type { VozDoProvedor } from '../../shared/tipos-da-voz'
import { ponte } from '../ponte'

/**
 * (21/10) A BIBLIOTECA PUBLICA DO FISH AUDIO na escolha de voz: o amigo do
 * Levi tinha a chave, nenhuma voz propria e nada para escolher. Agora o select
 * do Fish tem "Suas vozes" e "Biblioteca do Fish" (as populares em portugues,
 * ou o resultado da busca por nome), e o "Colar ID da voz" aceita o ID ou o
 * link fish.audio/m/<id>.
 *
 * Um store so para as duas telas (Configuracoes > Voz e o passo Voz): a busca
 * feita numa aparece na outra. Tudo aqui e GET: listar nao gasta nada.
 */
interface EstadoDaBiblioteca {
  /** A busca que deu `vozes` ('' = as populares). */
  busca: string
  /** null = ainda nao lida (ou a chave mudou). */
  vozes: VozDoProvedor[] | null
  /** A busca nao achou nada em portugues e veio de todas as linguas. */
  todasAsLinguas: boolean
  carregando: boolean
  erro: string | null
  /** As vozes coladas pelo ID e a salva achada pelo ID: ficam na lista mesmo depois de outra busca. */
  avulsas: VozDoProvedor[]
  /** IDs ja procurados (achou ou nao): nao perguntar de novo a cada render. */
  procurados: string[]
  /** Populares ('' ) ou uma busca por nome. */
  carregar: (busca: string) => Promise<void>
  /** O "Colar ID da voz": a voz pronta, ou a nota do que deu errado. */
  colar: (entrada: string) => Promise<{ ok: true; voz: VozDoProvedor } | { ok: false; erro: string }>
  /** A voz salva que nao esta em lista nenhuma: busca o nome dela (uma vez). */
  conhecer: (id: string) => void
  /** Chave trocada ou apagada: a lista era da chave antiga. */
  esquecer: () => void
}

/** A ultima resposta que vale: uma busca antiga que chega depois nao apaga a nova. */
let pedidoAtual = 0
let buscaNoAr: string | null = null

export const useBibliotecaFish = create<EstadoDaBiblioteca>()((set, get) => ({
  busca: '',
  vozes: null,
  todasAsLinguas: false,
  carregando: false,
  erro: null,
  avulsas: [],
  procurados: [],

  carregar: async (busca) => {
    const termo = busca.trim()
    // A mesma busca ja no ar (as duas telas montadas juntas): espera a dela.
    if (get().carregando && termo === buscaNoAr) return
    buscaNoAr = termo
    const meu = ++pedidoAtual
    set({ carregando: true, erro: null })
    const r = await ponte.bibliotecaFish(termo)
    if (meu !== pedidoAtual) return
    if (r.ok) set({ busca: r.value.busca, vozes: r.value.vozes, todasAsLinguas: r.value.todasAsLinguas, carregando: false })
    else set({ carregando: false, erro: r.error })
  },

  colar: async (entrada) => {
    const r = await ponte.vozDoFish(entrada)
    if (!r.ok) return { ok: false, erro: r.error }
    const voz = r.value
    set({ avulsas: [voz, ...get().avulsas.filter((v) => v.id !== voz.id)] })
    return { ok: true, voz }
  },

  conhecer: (id) => {
    if (!id || get().procurados.includes(id)) return
    set({ procurados: [...get().procurados, id] })
    void ponte.vozDoFish(id).then((r) => {
      if (r.ok && !get().avulsas.some((v) => v.id === r.value.id)) set({ avulsas: [...get().avulsas, r.value] })
    })
  },

  esquecer: () => {
    pedidoAtual++
    set({ busca: '', vozes: null, todasAsLinguas: false, carregando: false, erro: null, procurados: [] })
  },
}))

/**
 * As vozes da biblioteca para o select: as coladas primeiro, depois as da
 * lista, sem repetir e sem as que ja estao em "Suas vozes".
 */
export function vozesDaBiblioteca(
  doStore: Pick<EstadoDaBiblioteca, 'vozes' | 'avulsas'>,
  daConta: readonly VozDoProvedor[],
): VozDoProvedor[] {
  const vistas = new Set(daConta.map((v) => v.id))
  const lista: VozDoProvedor[] = []
  for (const v of [...doStore.avulsas, ...(doStore.vozes ?? [])]) {
    if (vistas.has(v.id)) continue
    vistas.add(v.id)
    lista.push(v)
  }
  return lista
}

/** O texto da opcao no select: "Nome (pt, 12 mil usos)". */
export function rotuloDaVoz(v: VozDoProvedor): string {
  return v.detalhe ? `${v.nome} (${v.detalhe})` : v.nome
}
