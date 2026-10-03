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
