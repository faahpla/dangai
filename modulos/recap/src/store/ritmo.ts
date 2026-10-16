import { useEffect } from 'react'
import { create } from 'zustand'
import { PALAVRAS_POR_SEGUNDO } from '../../shared/roteiro'
import { chaveDoRitmo, type RitmoDaVoz } from '../../shared/ritmo'
import type { ConfigDaVoz } from '../../shared/voz'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'

/**
 * O RITMO DA VOZ na tela do roteiro: palavras por segundo do take final da voz
 * que vai narrar (shared/ritmo.ts), lido do main (ritmoDaVoz, que nao gasta).
 * O "~Xs", a faixa de palavras e o "Curto/Longo" do validarRoteiro usam ele.
 *
 * Muda quando: o rascunho troca, o take atual troca (um take novo e uma medida
 * nova) e as Configuracoes fecham (a velocidade nativa do perfil pode ter
 * mudado). Ate chegar, vale o 2,7 de antes: o numero so pisca uma vez.
 */

interface EstadoDoRitmo {
  /** De que pedido o valor fala: `${rascunhoId}:${takeAtual}`. */
  chave: string | null
  valor: RitmoDaVoz | null
  carregar: (rascunhoId: string | null, takeAtual: string | null) => Promise<void>
  /** O ritmo de cada config pedida no passo 3 (a previsao), por `${chaveDoRitmo}:${takeAtual}`. */
  porConfig: Record<string, number>
  carregarDaConfig: (config: ConfigDaVoz, takeAtual: string | null) => Promise<void>
}

let ultimoPedido = 0

export const useRitmo = create<EstadoDoRitmo>((set) => ({
  chave: null,
  valor: null,
  carregar: async (rascunhoId, takeAtual) => {
    const chave = `${rascunhoId ?? '-'}:${takeAtual ?? '-'}`
    const pedido = ++ultimoPedido
    const r = await ponte.ritmoDaVoz(rascunhoId)
    // Resposta velha (trocou de rascunho no meio) nao entra.
    if (pedido !== ultimoPedido || !r.ok) return
    set({ chave, valor: r.value })
  },
  porConfig: {},
  carregarDaConfig: async (config, takeAtual) => {
    const chave = `${chaveDoRitmo(config)}:${takeAtual ?? '-'}`
    if (chave in useRitmo.getState().porConfig) return
    const r = await ponte.ritmoDaVoz(null, config)
    if (!r.ok) return
    set((s) => ({ porConfig: { ...s.porConfig, [chave]: r.value.ritmo } }))
  },
}))

/**
 * O ritmo de uma config do formulario do passo 3 (a voz, a nativa e o acelerar
 * escolhidos AGORA), para prever a duracao antes de gastar ou de aplicar.
 * null = ainda nao chegou. O take atual entra na chave: um take novo e uma
 * medida nova.
 */
export function useRitmoDaConfig(config: ConfigDaVoz | null, takeAtual: string | null): number | null {
  const chave = config ? `${chaveDoRitmo(config)}:${takeAtual ?? '-'}` : null
  const valor = useRitmo((s) => (chave ? s.porConfig[chave] : undefined))
  useEffect(() => {
    if (config) void useRitmo.getState().carregarDaConfig(config, takeAtual)
    // A chave resume a config (voz, modelo, nativa enviada, acelerar).
  }, [chave])
  return valor ?? null
}

/** Palavras por segundo da voz (o 2,7 de antes ate o main responder). */
export function useRitmoDaVoz(): number {
  return useRitmo((s) => s.valor?.ritmo ?? PALAVRAS_POR_SEGUNDO)
}

/**
 * Mantem o ritmo em dia com o rascunho na tela. Monta no passo do roteiro
 * (PassoDoRoteiro): e la que o alvo e medido.
 */
export function useSeguirRitmo(rascunhoId: string | null, takeAtual: string | null): void {
  const configuracoesAbertas = nucleo().usar((s) => s.settingsOpen)
  useEffect(() => {
    if (configuracoesAbertas) return
    void useRitmo.getState().carregar(rascunhoId, takeAtual)
  }, [rascunhoId, takeAtual, configuracoesAbertas])
}
