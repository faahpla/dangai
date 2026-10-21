import { create } from 'zustand'
import { recapDoProjeto } from '../../shared/projeto-do-recap'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'

/**
 * [recap] A TELA POS-RENDER (shared/pos-render.ts): abre sozinha quando um
 * render termina bem num projeto do recap (`modulos.recap` na raiz) -- o
 * projeto normal do Dangai segue como sempre, so com o "Abrir pasta" da barra.
 *
 * O render bom fica anotado no projeto (`modulos.recap.render`, guardarORender):
 * o "Video pronto" da barra de status e da paleta reabre a tela (reabrir) com
 * o projeto fechado e aberto de novo. A descricao e as hashtags sao o
 * `metadata` do nucleo, que ja vai no mesmo .dangai: reabrir nao gera nada.
 * Os titulos e thumbs do "Escrever de novo" (escreverTitulos, um pedido de IA
 * para os dois) ficam em `modulos.recap.sugestoesDoVideo` e valem no lugar dos
 * do roteiro.
 */
export interface EstadoDoPosRender {
  aberta: boolean
  /** O arquivo que o render gravou. */
  outputPath: string | null
  /** O .dangai aberto (o "Abrir pasta" mostra ele quando o video sumiu). */
  projetoPath: string | null
  videoUrl: string | null
  titulos: string[]
  thumbs: string[]
  carregando: boolean
  erro: string | null
  /** A descricao e as hashtags sendo escritas (o gerarMetadata do nucleo). */
  escrevendo: boolean
  erroDosTextos: string | null
  /** O "Escrever de novo" dos titulos/thumbs rodando: de qual secao veio o clique. */
  escrevendoTitulos: 'titulos' | 'thumbs' | null
  /** O recado do ultimo "Escrever de novo" que falhou, e em qual secao (os textos de antes ficam). */
  erroDosTitulos: { secao: 'titulos' | 'thumbs'; texto: string } | null
  /** Abre para este arquivo, se o projeto aberto for do recap. Devolve se abriu. */
  abrir(outputPath: string | null): Promise<boolean>
  /** O "Video pronto": reabre com o render anotado no projeto. Devolve se abriu. */
  reabrir(): Promise<boolean>
  fechar(): void
  /** "Escrever descricao e hashtags": uma chamada de IA, pelo nucleo. */
  escreverTextos(): Promise<void>
  /** "Escrever de novo" nos titulos ou nos textos de thumb: os dois de uma vez, num pedido so. */
  escreverTitulos(secao: 'titulos' | 'thumbs'): Promise<void>
}

/** Cada abrir ganha um numero: a resposta de um render antigo nao cai por cima da do novo. */
let pedidoAtual = 0

export const usePosRender = create<EstadoDoPosRender>((set, get) => ({
  aberta: false,
  outputPath: null,
  projetoPath: null,
  videoUrl: null,
  titulos: [],
  thumbs: [],
  carregando: false,
  erro: null,
  escrevendo: false,
  erroDosTextos: null,
  escrevendoTitulos: null,
  erroDosTitulos: null,

  abrir: async (outputPath) => {
    if (!outputPath) return false
    const estado = nucleo().ler()
    const recap = recapDoProjeto(estado.modulos)
    if (!recap) return false
    const meu = ++pedidoAtual
    const projetoPath = estado.projectPath
    set({ aberta: true, outputPath, projetoPath, videoUrl: null, titulos: [], thumbs: [], carregando: true, erro: null, erroDosTextos: null, erroDosTitulos: null })
    const r = await ponte
      .posRender({ outputPath, rascunhoId: recap.rascunhoId, roteiroVersao: recap.roteiroVersao, projetoPath })
      .catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
    if (meu !== pedidoAtual || !get().aberta) return true
    if (!r.ok) {
      set({ carregando: false, erro: r.error })
      return true
    }
    // Os do "Escrever de novo" (no projeto) valem no lugar dos do roteiro.
    const doVideo = recap.sugestoesDoVideo
    set({
      carregando: false,
      videoUrl: r.value.videoUrl,
      outputPath: r.value.videoPath ?? outputPath,
      titulos: doVideo?.titulos.length ? doVideo.titulos : r.value.titulos,
      thumbs: doVideo?.thumbs.length ? doVideo.thumbs : r.value.thumbs,
    })
    return true
  },

  reabrir: async () => {
    const render = renderDoProjeto(nucleo().ler().modulos)
    return render ? get().abrir(render.arquivo) : false
  },

  fechar: () => {
    pedidoAtual += 1
    set({ aberta: false, videoUrl: null, carregando: false })
  },

  escreverTextos: async () => {
    if (get().escrevendo) return
    set({ escrevendo: true, erroDosTextos: null })
    const n = nucleo()
    const antes = n.ler().metadata
    try {
      await n.gerarMetadata()
    } catch (e) {
      set({ escrevendo: false, erroDosTextos: e instanceof Error ? e.message : String(e) })
      return
    }
    const depois = n.ler()
    // O nucleo poe o erro no `error` dele; sem metadata novo, a tela mostra o recado.
    set({
      escrevendo: false,
      erroDosTextos: depois.metadata && depois.metadata !== antes ? null : (depois.error ?? 'Nao deu para escrever os textos.'),
    })
  },

  escreverTitulos: async (secao) => {
    if (get().escrevendoTitulos !== null) return
    const n = nucleo()
    const estado = n.ler()
    const recap = recapDoProjeto(estado.modulos)
    if (!recap) return
    set({ escrevendoTitulos: secao, erroDosTitulos: null })
    const { titulos, thumbs } = get()
    const r = await ponte
      .titulosDoVideo({
        roteiro: estado.script ?? '',
        rascunhoId: recap.rascunhoId,
        roteiroVersao: recap.roteiroVersao,
        atuais: { titulos, thumbs },
      })
      .catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
    if (!r.ok) {
      // Cota, rede, IA sem chave: o recado curto, e os textos de antes ficam.
      set({ escrevendoTitulos: null, erroDosTitulos: { secao, texto: r.error } })
      return
    }
    // A parte que a IA nao trouxe fica como estava.
    const novos = {
      titulos: r.value.titulos.length > 0 ? r.value.titulos : titulos,
      thumbs: r.value.thumbs.length > 0 ? r.value.thumbs : thumbs,
    }
    set({ escrevendoTitulos: null, ...novos })
    // No projeto (um passo de Ctrl+Z, o clique e dele): reabrir mostra estes, sem gerar de novo.
    const cru = n.ler().modulos?.recap
    if (cru && typeof cru === 'object') {
      n.gravarNoProjeto({ ...(cru as Record<string, unknown>), sugestoesDoVideo: { ...novos, em: new Date().toISOString() } })
    }
  },
}))

/** O ultimo render anotado no projeto do recap (null = projeto sem render, ou nao e do recap). */
export function renderDoProjeto(modulos: Record<string, unknown> | undefined | null): { arquivo: string; em: string } | null {
  return recapDoProjeto(modulos)?.render ?? null
}

/**
 * Anota o render bom no projeto do recap (`modulos.recap.render`), para o
 * "Video pronto" reabrir a tela depois. Sem passo de Ctrl+Z (nao e edicao
 * dele: um Ctrl+Z logo depois do render desfaz o que ele editou, nao isto),
 * mas o projeto fica "nao salvo" -- salvando, o botao volta com o projeto.
 * Devolve se anotou (projeto normal do Dangai: nao).
 */
export async function guardarORender(outputPath: string | null): Promise<boolean> {
  if (!outputPath) return false
  const n = nucleo()
  const estado = n.ler()
  if (!recapDoProjeto(estado.modulos)) return false
  const cru = estado.modulos?.recap as Record<string, unknown>
  const novo = { ...cru, render: { arquivo: outputPath, em: new Date().toISOString() } }
  await n.semSujar(() => n.gravarNoProjeto(novo))
  n.marcarSujo()
  return true
}
