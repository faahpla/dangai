import { create } from 'zustand'

/**
 * O LAYOUT da tela, do jeito dele -- "me da a possibilidade de personalizar o
 * layout, assim como no Premiere".
 *
 * As divisorias se arrastam (altura da linha do tempo, largura da coluna do
 * bloco), e o preview pode morar ao lado do bloco ou na direita. E gosto desta
 * maquina, e nao do projeto: fica no localStorage, e qualquer valor estranho la
 * cai no padrao.
 */

export interface Layout {
  /** Altura da parte de baixo (barra + linha do tempo), em px. */
  alturaDeBaixo: number
  /** Largura da coluna do bloco, em px. */
  larguraDoBloco: number
  /** O preview ao lado do bloco (padrao) ou na direita, depois dos paineis. */
  previewAoLado: boolean
}

export const LAYOUT_PADRAO: Layout = { alturaDeBaixo: 330, larguraDoBloco: 236, previewAoLado: true }

const CHAVE = 'dangai.layout'

function ler(): Layout {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) ?? 'null') as Partial<Layout> | null
    if (!bruto) return LAYOUT_PADRAO
    return {
      alturaDeBaixo: typeof bruto.alturaDeBaixo === 'number' ? bruto.alturaDeBaixo : LAYOUT_PADRAO.alturaDeBaixo,
      larguraDoBloco: typeof bruto.larguraDoBloco === 'number' ? bruto.larguraDoBloco : LAYOUT_PADRAO.larguraDoBloco,
      previewAoLado: typeof bruto.previewAoLado === 'boolean' ? bruto.previewAoLado : LAYOUT_PADRAO.previewAoLado,
    }
  } catch {
    return LAYOUT_PADRAO
  }
}

export const useLayout = create<Layout & { mudar: (patch: Partial<Layout>) => void; restaurar: () => void }>(
  (set, get) => ({
    ...ler(),
    mudar: (patch) => {
      set(patch)
      const { alturaDeBaixo, larguraDoBloco, previewAoLado } = get()
      try {
        localStorage.setItem(CHAVE, JSON.stringify({ alturaDeBaixo, larguraDoBloco, previewAoLado }))
      } catch {
        /* sem armazenamento: vale so nesta sessao */
      }
    },
    restaurar: () => get().mudar(LAYOUT_PADRAO),
  }),
)

/*
 * O IMA da linha do tempo, ligado ou nao. Mora fora da Timeline porque agora
 * um atalho (N, como no DaVinci) liga e desliga, e o atalho vive no App.
 */
function lerIma(): boolean {
  try {
    return localStorage.getItem('dangai.ima') !== 'nao'
  } catch {
    return true
  }
}

export const useIma = create<{ ligado: boolean; alternar: () => void }>((set, get) => ({
  ligado: lerIma(),
  alternar: () => {
    const novo = !get().ligado
    set({ ligado: novo })
    try {
      localStorage.setItem('dangai.ima', novo ? 'sim' : 'nao')
    } catch {
      /* vale so nesta sessao */
    }
  },
}))

/*
 * A FERRAMENTA da linha do tempo, como no DaVinci: com a de AGULHA, clicar e
 * arrastar no vazio de uma faixa leva a agulha; com a de SELECAO (tecla V),
 * abre um laco que escolhe os clipes que tocar. Nas cenas a agulha vale sempre.
 */
export type Ferramenta = 'agulha' | 'selecao'
export const useFerramenta = create<{
  ferramenta: Ferramenta
  definir: (f: Ferramenta) => void
  alternar: () => void
}>((set, get) => ({
  ferramenta: 'agulha',
  definir: (ferramenta) => set({ ferramenta }),
  alternar: () => set({ ferramenta: get().ferramenta === 'selecao' ? 'agulha' : 'selecao' }),
}))

/*
 * A ALTURA DAS FAIXAS, como no DaVinci/Premiere: Shift+roda encolhe ou estica
 * todas de uma vez (o `fator`), e a borda de baixo do cabecalho estica uma so
 * (a altura propria dela). Gosto desta maquina: fica no localStorage.
 *
 * Chaves: 'cenas', 'video-0', 'audio-2'...
 */
export const ALTURA_PADRAO = { cenas: 104, video: 40, audio: 52, legendas: 28 } as const
const LIMITES = { cenas: [44, 260], video: [20, 220], audio: [20, 220], legendas: [16, 72] } as const

function lerAlturas(): { fator: number; proprias: Record<string, number> } {
  try {
    const bruto = JSON.parse(localStorage.getItem('dangai.alturas') ?? 'null') as {
      fator?: unknown
      proprias?: unknown
    } | null
    const fator = typeof bruto?.fator === 'number' && bruto.fator >= 0.4 && bruto.fator <= 3 ? bruto.fator : 1
    const proprias: Record<string, number> = {}
    if (bruto?.proprias && typeof bruto.proprias === 'object') {
      for (const [k, v] of Object.entries(bruto.proprias as Record<string, unknown>)) {
        if (typeof v === 'number' && v > 0 && v < 400) proprias[k] = v
      }
    }
    return { fator, proprias }
  } catch {
    return { fator: 1, proprias: {} }
  }
}

export const useAlturas = create<{
  fator: number
  /** Alturas proprias, ja sem o fator (o fator multiplica por cima). */
  proprias: Record<string, number>
  escalar: (multiplicador: number) => void
  definir: (chave: string, altura: number) => void
  voltar: (chave: string) => void
}>((set, get) => {
  const gravar = (): void => {
    try {
      const { fator, proprias } = get()
      localStorage.setItem('dangai.alturas', JSON.stringify({ fator, proprias }))
    } catch {
      /* vale so nesta sessao */
    }
  }
  return {
    ...lerAlturas(),
    escalar: (m) => {
      set({ fator: Math.min(Math.max(get().fator * m, 0.4), 3) })
      gravar()
    },
    definir: (chave, altura) => {
      set({ proprias: { ...get().proprias, [chave]: altura / get().fator } })
      gravar()
    },
    voltar: (chave) => {
      const { [chave]: _fora, ...resto } = get().proprias
      set({ proprias: resto })
      gravar()
    },
  }
})

/** A altura de uma faixa agora, em px, ja dentro dos limites do tipo dela. */
export function alturaDaFaixa(
  estado: { fator: number; proprias: Record<string, number> },
  chave: string,
): number {
  const tipo =
    chave === 'cenas' ? 'cenas' : chave === 'legendas' ? 'legendas' : chave.startsWith('video') ? 'video' : 'audio'
  const [min, max] = LIMITES[tipo]
  const base = estado.proprias[chave] ?? ALTURA_PADRAO[tipo]
  return Math.round(Math.min(Math.max(base * estado.fator, min), max))
}

/** O FX Console (Ctrl+Espaco): busca nas bins sem sair da linha do tempo. */
export const useConsoleFx = create<{ aberto: boolean; alternar: () => void; fechar: () => void }>((set, get) => ({
  aberto: false,
  alternar: () => set({ aberto: !get().aberto }),
  fechar: () => set({ aberto: false }),
}))

/*
 * OS PRESETS DE VOLUME dos audios da timeline: "me de a possibilidade de
 * criar novos presets de dB manualmente". Comeca com os seis de sempre; ele
 * acrescenta (o "+") e tira (botao direito). Gosto desta maquina.
 */
const PRESETS_DE_VOLUME_PADRAO = [-3, -5, -10, -15, -20, -25]
function lerPresetsDeVolume(): number[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem('dangai.presetsDeVolume') ?? 'null')
    if (Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x))) return v as number[]
  } catch {
    /* padrao */
  }
  return PRESETS_DE_VOLUME_PADRAO
}
export const usePresetsDeVolume = create<{
  lista: number[]
  adicionar: (db: number) => void
  remover: (db: number) => void
  restaurar: () => void
}>((set, get) => {
  const gravar = (lista: number[]): void => {
    const limpa = [...new Set(lista.map((x) => Math.round(Math.min(Math.max(x, -40), 12) * 10) / 10))].sort((a, b) => b - a)
    set({ lista: limpa })
    try {
      localStorage.setItem('dangai.presetsDeVolume', JSON.stringify(limpa))
    } catch {
      /* vale so nesta sessao */
    }
  }
  return {
    lista: lerPresetsDeVolume(),
    adicionar: (db) => gravar([...get().lista, db]),
    remover: (db) => gravar(get().lista.filter((x) => x !== db)),
    restaurar: () => gravar(PRESETS_DE_VOLUME_PADRAO),
  }
})
