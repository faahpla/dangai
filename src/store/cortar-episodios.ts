import { create } from 'zustand'
import {
  andamentoGeral,
  type BatismoDoMotor,
  type EventoDoCorte,
  type ModoDoCorte,
  type MotorDoAncut,
  type PedidoDeCorte,
  type QualidadeDoDownload,
  type RespostaDoBatismo,
  type VideoDoLink,
} from '@shared/ancut'
import { useProject } from './project'
import { quandoOMotorMudar } from './motor-de-cortes'

/**
 * A FILA DE CORTE (20/11, o AnCut dentro do Dangai): os episodios soltos (ou
 * escolhidos), um depois do outro, no motor do AnCut (electron/services/ancut).
 * Cada um com o anime, a temporada e o episodio que o nome do arquivo diz --
 * e ele corrige na tela antes de comecar. Um link de B-roll primeiro baixa
 * (para a "Baixados" do anime) e depois corta.
 *
 * Terminou um: a Biblioteca le de novo (so o episodio novo e lido -- o cache
 * dela pula o resto), e a cena ja aparece para usar.
 */

/**
 * 'pergunta': o motor parou e quer uma decisao (anime que o AniList nao tem,
 * elenco sem fotos) -- o item oferece batizar na mao ou so cortar.
 * 'batizando': o corte parou no batismo, esperando os nomes (a janela abre).
 */
export type StatusDoItem = 'esperando' | 'baixando' | 'cortando' | 'batizando' | 'pergunta' | 'pronto' | 'falhou' | 'cancelado'

export interface ItemDoCorte {
  id: string
  pedido: PedidoDeCorte
  /** O nome do arquivo (ou o titulo do video do link). */
  nome: string
  status: StatusDoItem
  /** O que esta acontecendo agora ("Cortando os clipes"). */
  etapa?: string
  /** 0..1, so sobe. */
  andamento: number
  erro?: string
  cenas?: number
  personagens?: string[]
  /** Veio de um link: baixa primeiro. `pedido.video` fica vazio ate o download terminar. */
  link?: { url: string; pasta: string; qualidade: QualidadeDoDownload }
  /** A decisao que o motor pediu (status 'pergunta'). */
  pergunta?: { motivo: string; mensagem: string; pastaDasFotos?: string }
  /** Reforcar as fotos do elenco quando o corte terminar (escolhido no batismo). */
  reforcarAoTerminar?: boolean
}

interface EstadoDoCorte {
  aberta: boolean
  aba: 'arquivos' | 'link'
  motor: MotorDoAncut | null
  itens: ItemDoCorte[]
  rodando: boolean
  /** Lendo o nome dos arquivos que acabaram de entrar. */
  lendo: boolean
  /** O modo dos que entram (o de todo dia: so cortar). */
  modo: ModoDoCorte
  /** O batismo aberto (o corte parado esperando os nomes). */
  batismo: { itemId: string; batismo: BatismoDoMotor } | null
  /** O reforco das fotos rodando depois de um batismo ("Reforcando a Maomao (3/12)"). */
  reforco: string | null
  /** Manda os nomes; o corte continua. `reforcar`: reforcar as fotos quando terminar. */
  responderBatismo: (resposta: RespostaDoBatismo, reforcar: boolean) => Promise<void>
  /** Desiste do batismo: o corte do episodio e cancelado (as cenas cortadas ficam no disco). */
  desistirDoBatismo: () => void
  /** Um item que parou numa pergunta volta para a fila num modo novo e a fila anda. */
  refazer: (id: string, modo: ModoDoCorte) => void
  abrir: (aba?: 'arquivos' | 'link') => void
  /** Pergunta de novo qual motor vale (o do Dangai acabou de baixar, a pasta de saida mudou). */
  atualizarMotor: () => Promise<void>
  fechar: () => void
  setAba: (aba: 'arquivos' | 'link') => void
  setModo: (modo: ModoDoCorte) => void
  adicionar: (videos: readonly string[]) => Promise<void>
  /** Um pedido ja montado (o "Reconhecer de novo" de um episodio da Biblioteca). */
  adicionarPedido: (pedido: PedidoDeCorte, nome: string) => void
  adicionarLinks: (videos: readonly VideoDoLink[], o: { anime: string; pastaDoAnime: string; pasta: string; qualidade: QualidadeDoDownload }) => void
  mudar: (id: string, pedido: Partial<PedidoDeCorte>) => void
  remover: (id: string) => void
  limparTerminados: () => void
  comecar: () => Promise<void>
  cancelar: () => void
}

const LEMBRAR_MODO = 'dangai.cortar.modo'

function modoLembrado(): ModoDoCorte {
  try {
    const m = localStorage.getItem(LEMBRAR_MODO)
    return m === 'reconhecer' || m === 'batizar' ? m : 'cortar'
  } catch {
    return 'cortar'
  }
}

const nomeDe = (c: string): string => c.split(/[\\/]/).pop() ?? c
let seq = 0
const novoId = (): string => `c${Date.now().toString(36)}${(seq++).toString(36)}`

export const useCortar = create<EstadoDoCorte>((set, get) => ({
  aberta: false,
  aba: 'arquivos',
  motor: null,
  itens: [],
  rodando: false,
  lendo: false,
  modo: modoLembrado(),
  batismo: null,
  reforco: null,

  responderBatismo: async (resposta, reforcar) => {
    const b = get().batismo
    if (!b) return
    set({ batismo: null })
    editar(b.itemId, { status: 'cortando', etapa: 'Gravando os personagens…', reforcarAoTerminar: reforcar })
    const r = await window.dangai.ancutResponderBatismo(resposta)
    if (!r.ok || !r.value) editar(b.itemId, { status: 'falhou', etapa: undefined, erro: 'O motor já tinha fechado. Corte de novo em "Batizar na mão".' })
  },

  desistirDoBatismo: () => {
    const b = get().batismo
    set({ batismo: null })
    if (b) editar(b.itemId, { status: 'cortando', etapa: 'Cancelando…' })
    void window.dangai.ancutCancelar()
  },

  refazer: (id, modo) => {
    set({
      itens: get().itens.map((i) =>
        i.id === id ? { ...i, status: 'esperando', erro: undefined, pergunta: undefined, andamento: 0, etapa: undefined, pedido: { ...i.pedido, modo } } : i,
      ),
    })
    void get().comecar()
  },

  abrir: (aba) => {
    set({ aberta: true, ...(aba ? { aba } : {}) })
    void get().atualizarMotor()
  },

  atualizarMotor: async () => {
    const r = await window.dangai.ancutMotor()
    set({ motor: r.ok ? r.value : null })
  },

  fechar: () => set({ aberta: false }),
  setAba: (aba) => set({ aba }),

  setModo: (modo) => {
    try {
      localStorage.setItem(LEMBRAR_MODO, modo)
    } catch {
      /* so a lembranca */
    }
    // Os que ainda esperam seguem o modo novo; os que ja comecaram ficam.
    set({ modo, itens: get().itens.map((i) => (i.status === 'esperando' && i.pedido.tipo !== 'BROLL' ? { ...i, pedido: { ...i.pedido, modo } } : i)) })
  },

  adicionar: async (videos) => {
    const novos = videos.filter((v) => !get().itens.some((i) => i.pedido.video === v && i.status === 'esperando'))
    if (novos.length === 0) return
    const modo = get().modo
    const itens: ItemDoCorte[] = novos.map((video) => ({
      id: novoId(),
      nome: nomeDe(video),
      status: 'esperando',
      andamento: 0,
      pedido: { video, anime: '', temporada: 1, episodio: 1, tipo: '', modo },
    }))
    set({ itens: [...get().itens, ...itens], lendo: true })
    // O nome de cada arquivo pela regra do motor (um de cada vez: cada pergunta abre o motor).
    for (const item of itens) {
      const r = await window.dangai.ancutLerNome(item.pedido.video)
      const lido = r.ok ? r.value : null
      if (!lido) continue
      set({
        itens: get().itens.map((i) =>
          i.id === item.id && !i.pedido.anime
            ? { ...i, pedido: { ...i.pedido, anime: lido.anime, temporada: lido.temporada, episodio: lido.episodio, tipo: lido.tipo } }
            : i,
        ),
      })
    }
    set({ lendo: false })
  },

  adicionarPedido: (pedido, nome) => {
    if (get().itens.some((i) => i.status === 'esperando' && i.pedido.video === pedido.video && i.pedido.modo === pedido.modo)) return
    set({ itens: [...get().itens, { id: novoId(), nome, status: 'esperando', andamento: 0, pedido }], aba: 'arquivos' })
  },

  adicionarLinks: (videos, o) => {
    const itens: ItemDoCorte[] = videos.map((v) => ({
      id: novoId(),
      nome: v.titulo,
      status: 'esperando',
      andamento: 0,
      // B-roll e so corte, com o numero livre que o motor escolhe.
      pedido: { video: '', anime: o.anime, temporada: 1, episodio: 0, tipo: 'BROLL', modo: 'cortar', titulo: v.titulo, origem: v.url, pastaDoAnime: o.pastaDoAnime },
      link: { url: v.url, pasta: o.pasta, qualidade: o.qualidade },
    }))
    set({ itens: [...get().itens, ...itens], aba: 'arquivos' })
  },

  mudar: (id, pedido) => set({ itens: get().itens.map((i) => (i.id === id && i.status === 'esperando' ? { ...i, pedido: { ...i.pedido, ...pedido } } : i)) }),

  remover: (id) => set({ itens: get().itens.filter((i) => i.id !== id || i.status === 'cortando' || i.status === 'baixando') }),

  limparTerminados: () => set({ itens: get().itens.filter((i) => i.status === 'esperando' || i.status === 'cortando' || i.status === 'baixando') }),

  comecar: async () => {
    if (get().rodando) return
    set({ rodando: true })
    try {
      for (;;) {
        if (!get().rodando) break
        const proximo = get().itens.find((i) => i.status === 'esperando')
        if (!proximo) break
        await processar(proximo.id)
      }
    } finally {
      set({ rodando: false })
    }
  },

  cancelar: () => {
    set({ rodando: false, batismo: null })
    const atual = get().itens.find((i) => i.status === 'cortando' || i.status === 'baixando' || i.status === 'batizando')
    if (atual?.status === 'baixando') void window.dangai.ancutLinkCancelar()
    if (atual?.status === 'cortando' || atual?.status === 'batizando') void window.dangai.ancutCancelar()
  },
}))

function editar(id: string, parcial: Partial<ItemDoCorte>): void {
  useCortar.setState((s) => ({ itens: s.itens.map((i) => (i.id === id ? { ...i, ...parcial } : i)) }))
}

const item = (id: string): ItemDoCorte | undefined => useCortar.getState().itens.find((i) => i.id === id)

/** Um item: baixa (se veio de link) e corta. */
async function processar(id: string): Promise<void> {
  let atual = item(id)
  if (!atual) return
  if (!atual.pedido.anime.trim()) {
    editar(id, { status: 'falhou', erro: 'Escreva de que anime é este episódio.' })
    return
  }
  if (atual.link && !atual.pedido.video) {
    editar(id, { status: 'baixando', etapa: 'Começando o download…', andamento: 0, erro: undefined })
    const r = await window.dangai.ancutLinkBaixar({ url: atual.link.url, pasta: atual.link.pasta, qualidade: atual.link.qualidade })
    const baixado = r.ok ? r.value : { erro: r.error }
    if ('erro' in baixado) {
      editar(id, { status: useCortar.getState().rodando ? 'falhou' : 'cancelado', erro: baixado.erro, etapa: undefined })
      return
    }
    editar(id, { pedido: { ...atual.pedido, video: baixado.arquivo, titulo: atual.pedido.titulo || baixado.titulo, origem: baixado.origem } })
    atual = item(id)
    if (!atual || !useCortar.getState().rodando) return
  }
  editar(id, { status: 'cortando', etapa: 'Abrindo o motor do AnCut…', andamento: 0, erro: undefined })
  const r = await window.dangai.ancutCortar(atual.pedido)
  const fim: EventoDoCorte = r.ok ? r.value : { tipo: 'falhou', mensagem: r.error }
  if (useCortar.getState().batismo?.itemId === id) useCortar.setState({ batismo: null })
  if (fim.tipo === 'pronto') {
    editar(id, { status: 'pronto', andamento: 1, etapa: undefined, cenas: fim.cenas, personagens: fim.personagens })
    // A Biblioteca ja aberta le de novo (so o episodio novo); fechada, le quando abrir.
    if (useProject.getState().library) void useProject.getState().syncLibrary()
    // Batizou e pediu para reforcar: os rostos mais confiaveis viram foto do elenco (so acrescenta).
    if (item(id)?.reforcarAoTerminar && fim.pasta) await reforcarDepois(fim.pasta)
  } else if (fim.tipo === 'cancelado') {
    editar(id, { status: 'cancelado', etapa: undefined })
  } else if (fim.tipo === 'falhou') {
    editar(id, { status: 'falhou', etapa: undefined, erro: fim.mensagem })
  } else if (fim.tipo === 'pergunta') {
    editar(id, { status: 'pergunta', etapa: undefined, pergunta: { motivo: fim.motivo, mensagem: fim.mensagem, ...(fim.pastaDasFotos ? { pastaDasFotos: fim.pastaDasFotos } : {}) } })
  }
}

/** O reforco das fotos depois de um batismo (o "Reforcar refs ao terminar" do AnCut). */
async function reforcarDepois(pastaDoEpisodio: string): Promise<void> {
  useCortar.setState({ reforco: 'Reforçando as fotos do elenco…' })
  const sair = window.dangai.onAncutOrganizar((e) => {
    if (e.tipo === 'reforcar') useCortar.setState({ reforco: `Reforçando as fotos: ${e.nome}${e.total ? ` (${e.feitos}/${e.total})` : ''}` })
  })
  try {
    await window.dangai.ancutReforcar(`${pastaDoEpisodio}\\shots\\_`)
  } finally {
    sair()
    useCortar.setState({ reforco: null })
  }
}

let ouvindo = false

/** O andamento do motor no item que esta cortando (um ouvinte so, ligado na primeira vez). */
export function ouvirOMotor(): void {
  if (ouvindo) return
  ouvindo = true
  window.dangai.onAncutEvento((e) => {
    if (e.tipo === 'batismo') {
      const quem = useCortar.getState().itens.find((i) => i.status === 'cortando')
      if (!quem) return
      editar(quem.id, { status: 'batizando', etapa: 'Esperando os nomes' })
      useCortar.setState({ batismo: { itemId: quem.id, batismo: e.batismo }, aberta: true })
      return
    }
    if (e.tipo !== 'etapa') return
    const atual = useCortar.getState().itens.find((i) => i.status === 'cortando')
    if (!atual) return
    const geral = andamentoGeral(e.etapa, e.fracao, atual.pedido.tipo === 'BROLL' ? 'cortar' : atual.pedido.modo)
    // So sobe: o motor passa duas vezes por "achando as cenas", e uma etapa fora da conta nao volta a barra.
    editar(atual.id, { etapa: e.rotulo, andamento: Math.max(atual.andamento, geral) })
  })
  window.dangai.onAncutLinkEvento((e) => {
    const atual = useCortar.getState().itens.find((i) => i.status === 'baixando')
    if (!atual) return
    if (e.tipo === 'ferramenta') {
      editar(atual.id, { etapa: `${e.mensagem}${e.fracao >= 0 ? ` ${Math.round(e.fracao * 100)}%` : ''}` })
      return
    }
    const partes =
      e.fase === 'juntando'
        ? ['Juntando áudio e vídeo…']
        : [
            e.fracao >= 0 ? `Baixando ${Math.round(e.fracao * 100)}%` : 'Baixando…',
            e.velocidade && e.velocidade !== 'NA' ? e.velocidade : '',
            e.falta && e.falta !== 'NA' ? `falta ${e.falta}` : '',
          ]
    editar(atual.id, { etapa: partes.filter(Boolean).join(' · '), andamento: e.fracao >= 0 ? e.fracao : atual.andamento })
  })
}

// O motor do Dangai baixou, atualizou ou foi removido: a tela pergunta de novo qual motor vale.
quandoOMotorMudar(() => {
  if (useCortar.getState().aberta) void useCortar.getState().atualizarMotor()
})
