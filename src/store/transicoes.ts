import { create } from 'zustand'
import {
  ajusteDaTransicaoSchema,
  duracaoDoTrecho,
  framesDaTransicao,
  TRANSITIONS,
  type AjusteDaTransicao,
  type Scene,
  type Transition,
} from '@shared/contract'
import { z } from 'zod'
import { useProject } from './project'
import { ondaDoTrecho } from './projeto/apoio'
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
    useProject.setState({ error: 'A faixa de cenas está trancada. Destranque no cadeado da faixa Cenas.' })
    return
  }
  // O som do Pan: entra quando a emenda VIRA Pan, sai quando deixa de ser (trocar de lado nao duplica).
  const antes = lerEmenda(scenes, e, s.audio?.durationSec ?? 0)
  if (antes) {
    if (PANS.has(tipo) && !PANS.has(antes.tipo)) void porSomDoPan(antes.em)
    else if (!PANS.has(tipo) && PANS.has(antes.tipo)) tirarSomDoPan(antes.em)
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

/*
 * O SOM DO PAN: "toda vez que for adicionada a transicao Pan eu quero que voce
 * automaticamente coloque esse efeito sonoro" (o Flash Swoosh dele; o arquivo
 * fica nas Configuracoes, somDoPan). O som entra como um SFX posto a mao --
 * da para mover, aparar, mudar o volume ou apagar como qualquer outro -- com o
 * PONTO MAIS FORTE dele bem no corte: a transicao e centrada no corte (ver
 * toRenderProps), entao o swoosh bate no meio do movimento. Tirar o Pan (ou
 * trocar por outra transicao) tira o som que ele pos.
 */
const PANS: ReadonlySet<Transition> = new Set<Transition>(['pan-left', 'pan-right', 'pan-up', 'pan-down'])
/**
 * O id dos sons que o Pan pos: `pan-g<ms>-...`, com o ponto mais forte do som (em
 * ms desde o comeco dele). E assim que ele acha o SEU som de cada corte -- para
 * nao pôr dois no mesmo corte e para tirar so o dele --, mesmo com outro Pan
 * logo ao lado.
 */
const PREFIXO_DO_PAN = 'pan-'

/** Onde o som de um Pan bate na linha do tempo (o ponto mais forte), ou null se o id nao diz. */
function golpeDoPan(x: { id: string; at: number }): number | null {
  const m = /^(?:sfx-)?pan-g(\d+)-/.exec(x.id)
  return m ? x.at + Number(m[1]) / 1000 : null
}

const ehDoPan = (x: { id: string }): boolean => x.id.startsWith(PREFIXO_DO_PAN) || x.id.startsWith(`sfx-${PREFIXO_DO_PAN}`)

/** Este som e o do Pan DESTE corte? Pelo golpe; id antigo (sem golpe), pelo som cobrir o corte. */
function doCorte(x: { id: string; at: number; durationSec: number }, corte: number): boolean {
  if (!ehDoPan(x)) return false
  const golpe = golpeDoPan(x)
  return golpe !== null ? Math.abs(golpe - corte) < 0.12 : x.at <= corte + 0.05 && x.at + x.durationSec >= corte - 0.05
}

/*
 * O som entra numa FAIXA DE AUDIO (A1, A2...), como qualquer som que ele solta
 * ali. Ate a 2.3 ele ia para a faixa de SFX antiga -- que saiu da tela e nao
 * toca nem no preview nem no render: "as transicoes de pan nao estao colocando
 * o audio junto". O som so aparecia ao reabrir o projeto (convertido para a
 * faixa de audio, e 12 dB mais baixo).
 */
async function porSomDoPan(corte: number): Promise<void> {
  const r = await window.dangai.getSettings()
  const caminho = r.ok ? r.value.somDoPan : ''
  if (!caminho) return
  // Ja tem o som deste corte (desfazer e refazer, aplicar duas vezes): nao empilha.
  if (useProject.getState().trilhas.some((x) => doCorte(x, corte))) return
  const a = await window.dangai.analyzeAudio(caminho)
  if (!a.ok) {
    useProject.setState({ error: `O som do Pan não abriu: ${a.error}` })
    return
  }
  const { peaks, durationSec } = a.value
  let maior = 0
  for (let i = 1; i < peaks.length; i++) if (peaks[i]! > peaks[maior]!) maior = i
  const pico = peaks.length > 0 ? ((maior + 0.5) / peaks.length) * durationSec : 0
  const at = Math.max(0, corte - pico)
  const golpe = Math.round((corte - at) * 1000)
  useProject.setState((st) => {
    if (st.trilhas.some((x) => doCorte(x, corte))) return {}
    // A faixa dos outros Pans, se estiver livre nesse pedaco; senao, a primeira livre (e que nao esteja muda).
    const livre = (f: number): boolean =>
      !st.faixasMudas.audio.includes(f) &&
      !st.trilhas.some((t) => t.faixa === f && at < t.at + duracaoDoTrecho(t) - 1e-3 && at + durationSec > t.at + 1e-3)
    const dosPans = [...new Set(st.trilhas.filter(ehDoPan).map((t) => t.faixa))].sort((a, b) => a - b)
    let faixa = dosPans.find(livre) ?? 0
    while (!livre(faixa)) faixa++
    return {
      trilhas: [
        ...st.trilhas,
        {
          id: `${PREFIXO_DO_PAN}g${golpe}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          path: caminho,
          fileName: a.value.fileName,
          faixa,
          at,
          durationSec,
          inicioSec: 0,
          usarSec: null,
          gainDb: 0,
          fadeInSec: 0,
          fadeOutSec: 0,
          ...ondaDoTrecho(a.value),
          url: a.value.url,
        },
      ],
      projectDirty: true,
    }
  })
}

function tirarSomDoPan(corte: number): void {
  const st = useProject.getState()
  const trilhas = st.trilhas.filter((x) => !doCorte(x, corte))
  // O de projeto de antes (na faixa de SFX antiga, ainda nao convertida).
  const sfxManual = st.sfxManual.filter((x) => !doCorte(x, corte))
  if (trilhas.length !== st.trilhas.length || sfxManual.length !== st.sfxManual.length) {
    useProject.setState({ trilhas, sfxManual, projectDirty: true })
  }
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
