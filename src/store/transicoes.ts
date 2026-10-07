import { create } from 'zustand'
import {
  ajusteDaTransicaoSchema,
  framesDaTransicao,
  TRANSITIONS,
  type AjusteDaTransicao,
  type Scene,
  type Transition,
} from '@shared/contract'
import { z } from 'zod'
import { useProject } from './project'
import { exportarPreset, importarPreset, nomeLivre } from './arquivo-de-preset'

/**
 * AS EMENDAS E AS TRANSICOES DELAS, do lado da interface.
 *
 * Uma EMENDA e um ponto entre blocos, numerado de 0 a n: a 0 e o comeco do
 * video (a entrada do primeiro bloco), a n e o fim (a saida do ultimo), e as
 * do meio sao os cortes. A transicao de uma emenda do meio mora no bloco de
 * DEPOIS (`transitionIn`); a do fim, no ultimo (`transitionOut`).
 */

export const TRANSITION_LABEL: Readonly<Record<Transition, string>> = {
  cut: 'Corte seco',
  crossfade: 'Crossfade',
  'zoom-in': 'Zoom in',
  'zoom-out': 'Zoom out',
  light: 'Light',
  'pan-left': 'Pan ←',
  'pan-right': 'Pan →',
  'pan-up': 'Pan ↑',
  'pan-down': 'Pan ↓',
  'slide-left': 'Desliza ←',
  'slide-right': 'Desliza →',
  'whip-pan-left': 'Whip-pan (antigo)',
  'whip-pan-right': 'Whip-pan (antigo)',
  'whip-pan': 'Whip-pan (antigo)',
}

export interface Emenda {
  tipo: Transition
  ajuste: AjusteDaTransicao | undefined
  /** Em segundos, no tempo da narracao. */
  em: number
}

export function lerEmenda(scenes: readonly Scene[], e: number, duracao: number): Emenda | null {
  const n = scenes.length
  if (n === 0 || e < 0 || e > n) return null
  if (e === n) {
    const ultima = scenes[n - 1]!
    return { tipo: ultima.transitionOut ?? 'cut', ajuste: ultima.transicaoSaida, em: duracao }
  }
  const cena = scenes[e]!
  return { tipo: cena.transitionIn, ajuste: cena.transicao, em: e === 0 ? 0 : cena.start }
}

/** Duracao da transicao da emenda, em segundos (0 = corte seco). */
export function segundosDaEmenda(emenda: Emenda): number {
  return framesDaTransicao(emenda.tipo, emenda.ajuste) / (24000 / 1001)
}

/**
 * Poe uma transicao na emenda. `ajuste` undefined mantem o que a emenda ja
 * tinha (trocar de Zoom para Light nao joga fora a duracao escolhida).
 */
export function aplicarNaEmenda(e: number, tipo: Transition, ajuste?: AjusteDaTransicao): void {
  const s = useProject.getState()
  const scenes = s.plan?.scenes ?? []
  const n = scenes.length
  if (n === 0 || e < 0 || e > n) return
  if (s.cenasTrancadas) {
    useProject.setState({ error: 'A faixa de cenas esta trancada. Destranque no cadeado da faixa Cenas.' })
    return
  }
  if (e === n) {
    const ultima = scenes[n - 1]!
    s.updateScene(n - 1, {
      transitionOut: tipo === 'cut' ? undefined : tipo,
      transicaoSaida: ajuste ?? ultima.transicaoSaida,
    })
    return
  }
  s.updateScene(e, { transitionIn: tipo, transicao: ajuste ?? scenes[e]!.transicao })
}

/** Muda so uma parte do ajuste da emenda. */
export function ajustarEmenda(e: number, parcial: AjusteDaTransicao): void {
  const s = useProject.getState()
  const scenes = s.plan?.scenes ?? []
  const atual = lerEmenda(scenes, e, 0)
  if (!atual || atual.tipo === 'cut') return
  aplicarNaEmenda(e, atual.tipo, { ...atual.ajuste, ...parcial })
}

/*
 * ARRASTAR UMA TRANSICAO: o mesmo gesto das bins, com um tipo proprio no
 * dataTransfer. Quem recebe e a faixa de cenas, que solta na emenda mais perto.
 */
export const TIPO_ARRASTE_TRANSICAO = 'application/x-dangai-transicao'

export interface TransicaoArrastada {
  tipo: Transition
  ajuste?: AjusteDaTransicao
}

export function iniciarArrasteDeTransicao(event: React.DragEvent, t: TransicaoArrastada): void {
  event.dataTransfer.setData(TIPO_ARRASTE_TRANSICAO, JSON.stringify(t))
  event.dataTransfer.effectAllowed = 'copy'
}

const arrastadaSchema = z.object({ tipo: z.enum(TRANSITIONS), ajuste: ajusteDaTransicaoSchema.optional() })

export function transicaoDoArraste(event: React.DragEvent): TransicaoArrastada | null {
  const bruto = event.dataTransfer.getData(TIPO_ARRASTE_TRANSICAO)
  if (!bruto) return null
  try {
    const ok = arrastadaSchema.safeParse(JSON.parse(bruto))
    return ok.success ? ok.data : null
  } catch {
    return null
  }
}

export function ehArrasteDeTransicao(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes(TIPO_ARRASTE_TRANSICAO)
}

/*
 * OS PRESETS DE TRANSICAO: uma transicao do jeito que ele gostou (tipo,
 * duracao, intensidade, borrao, cor), guardada com nome. Aparecem junto das
 * transicoes para arrastar, valem para todos os projetos, e exportam/importam
 * como os outros presets.
 */
export const presetDeTransicaoSchema = z.object({
  nome: z.string().trim().min(1).max(36),
  tipo: z.enum(TRANSITIONS),
  ajuste: ajusteDaTransicaoSchema.default({}),
})
export type PresetDeTransicao = z.infer<typeof presetDeTransicaoSchema>

const dadosDoPresetSchema = presetDeTransicaoSchema.omit({ nome: true })

export const usePresetsDeTransicao = create<{
  lista: PresetDeTransicao[]
  carregado: boolean
  carregar: () => Promise<void>
  salvar: (nome: string, tipo: Transition, ajuste: AjusteDaTransicao | undefined) => Promise<void>
  remover: (nome: string) => Promise<void>
  exportar: (nome: string) => Promise<string | null>
  importar: () => Promise<string | null>
}>((set, get) => {
  const gravar = async (lista: PresetDeTransicao[]): Promise<void> => {
    set({ lista })
    await window.dangai.saveSettings({ presetsDeTransicao: lista as unknown as Record<string, unknown>[] })
  }
  return {
    lista: [],
    carregado: false,
    carregar: async () => {
      const r = await window.dangai.getSettings()
      if (!r.ok) return
      set({
        carregado: true,
        lista: r.value.presetsDeTransicao.flatMap((p) => {
          const ok = presetDeTransicaoSchema.safeParse(p)
          return ok.success ? [ok.data] : []
        }),
      })
    },
    // Mesmo nome substitui: e o jeito de atualizar um preset refinado.
    salvar: (nome, tipo, ajuste) => {
      const limpo = nome.trim().slice(0, 36)
      if (!limpo || tipo === 'cut') return Promise.resolve()
      return gravar([...get().lista.filter((p) => p.nome !== limpo), { nome: limpo, tipo, ajuste: ajuste ?? {} }])
    },
    remover: (nome) => gravar(get().lista.filter((p) => p.nome !== nome)),
    exportar: async (nome) => {
      const p = get().lista.find((x) => x.nome === nome)
      if (!p) return null
      return exportarPreset('transicao', p.nome, { tipo: p.tipo, ajuste: p.ajuste })
    },
    importar: async () => {
      const r = await importarPreset('transicao', dadosDoPresetSchema)
      if (r === null) return null
      if ('erro' in r) return r.erro
      const nome = nomeLivre(r.nome, get().lista.map((p) => p.nome))
      await gravar([...get().lista, { nome, tipo: r.dados.tipo, ajuste: r.dados.ajuste }])
      return `"${nome}" importada.`
    },
  }
})
