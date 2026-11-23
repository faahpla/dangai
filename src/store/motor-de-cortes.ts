import { create } from 'zustand'
import type { EstadoDoMotorRuntime, PedidoDeInstalacao } from '@shared/runtime-do-motor'

/**
 * O MOTOR DE CORTES do Dangai na tela (23/11): o Python do motor do AnCut,
 * baixado so por quem quiser, igual ao motor do modulo recap (a loja de la,
 * modulos/recap/src/store/motor-runtime.ts, sem o "pedir uma vez por sessao":
 * aqui o painel mora dentro do Cortar episodios e das Configuracoes).
 *
 * O main manda o estado INTEIRO a cada mudanca (ancut:runtime-mudou); aqui so
 * guarda o ultimo. Quando a fase vira 'pronto' (ou sai dela), quem usa o motor
 * pergunta de novo qual motor esta valendo (quandoOMotorMudar).
 */

interface LojaDoMotorDeCortes {
  /** null = ainda nao perguntou ao main. */
  estado: EstadoDoMotorRuntime | null
  /** Erro de um pedido (instalar, remover...) que nao veio no estado. */
  erroDoPedido: string | null
  conferir(): Promise<void>
  instalar(pedido?: PedidoDeInstalacao): Promise<void>
  cancelar(): Promise<void>
  escolherPasta(padrao?: boolean): Promise<void>
  remover(): Promise<void>
}

export const useMotorDeCortes = create<LojaDoMotorDeCortes>((set, get) => ({
  estado: null,
  erroDoPedido: null,
  async conferir() {
    const r = await window.dangai.ancutRuntimeEstado()
    if (r.ok) receber(r.value)
  },
  async instalar(pedido = {}) {
    set({ erroDoPedido: null })
    const r = await window.dangai.ancutRuntimeInstalar(pedido)
    if (r.ok) receber(r.value)
    else set({ erroDoPedido: r.error })
  },
  async cancelar() {
    const r = await window.dangai.ancutRuntimeCancelar()
    if (!r.ok) set({ erroDoPedido: r.error })
    await get().conferir()
  },
  async escolherPasta(padrao = false) {
    set({ erroDoPedido: null })
    const r = await window.dangai.ancutRuntimePasta(padrao)
    if (r.ok) receber(r.value)
    else set({ erroDoPedido: r.error })
  },
  async remover() {
    set({ erroDoPedido: null })
    const r = await window.dangai.ancutRuntimeRemover()
    if (r.ok) receber(r.value)
    else set({ erroDoPedido: r.error })
  },
}))

/** Quem quer saber que o motor do Dangai ficou pronto (ou deixou de estar). */
const aoMudar = new Set<(estado: EstadoDoMotorRuntime) => void>()

export function quandoOMotorMudar(fn: (estado: EstadoDoMotorRuntime) => void): () => void {
  aoMudar.add(fn)
  return () => aoMudar.delete(fn)
}

function receber(estado: EstadoDoMotorRuntime): void {
  const antes = useMotorDeCortes.getState().estado
  useMotorDeCortes.setState({ estado })
  const mudouDeFase = antes !== null && antes.fase !== estado.fase
  if (!mudouDeFase) return
  for (const fn of aoMudar) {
    try {
      fn(estado)
    } catch (e) {
      console.error('[motor-de-cortes]', e)
    }
  }
}

let ouvindo: (() => void) | null = null

/** Liga o evento do main a loja (uma vez so; quem chama de novo nao duplica). */
export function ouvirMotorDeCortes(): void {
  if (ouvindo) return
  ouvindo = window.dangai.onAncutRuntime((estado) => receber(estado))
}

/** O motor do Dangai esta baixado e serve. */
export function motorDoDangaiPronto(estado: EstadoDoMotorRuntime | null): boolean {
  return estado?.fase === 'pronto'
}
