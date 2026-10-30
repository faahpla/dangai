import type { ContextoDoModulo } from '../../../electron/modulos'

/** [thumb] O contexto que o nucleo deu no `configurar` (as pastas, a config). */
let atual: ContextoDoModulo | null = null

export function guardarContexto(ctx: ContextoDoModulo): void {
  atual = ctx
}

export function contexto(): ContextoDoModulo {
  if (!atual) throw new Error('O modulo Thumbnail ainda nao configurou.')
  return atual
}
