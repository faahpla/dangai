import type { Nucleo } from '@/modulos/nucleo'

/** [thumb] A fachada do nucleo que o Dangai entrega no `iniciar` (src/modulos/nucleo.ts). */
let atual: Nucleo | null = null

export function guardarNucleo(n: Nucleo): void {
  atual = n
}

export function nucleo(): Nucleo {
  if (!atual) throw new Error('O modulo Thumbnail ainda nao iniciou.')
  return atual
}
