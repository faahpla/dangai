import type { ContextoDoModulo } from '../../../electron/modulos'
import { coerceConfig, type ConfigDoRecap } from '../shared/config'

/**
 * [recap] O CONTEXTO que o nucleo entrega no `configurar`, guardado para os
 * servicos portados do Studio (que liam getSettings e app.getPath direto).
 * Tudo que o modulo sabe do Dangai passa por aqui.
 */

let ctx: ContextoDoModulo | null = null

export function guardarContexto(c: ContextoDoModulo): void {
  ctx = c
}

export function contexto(): ContextoDoModulo {
  if (!ctx) throw new Error('O modulo do recap ainda nao foi configurado.')
  return ctx
}

/** A configuracao dele agora (ja passada pelo coerce do nucleo). */
export function configDoRecap(): ConfigDoRecap {
  return coerceConfig(contexto().config().modulo)
}
