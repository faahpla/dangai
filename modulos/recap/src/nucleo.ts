import type { Nucleo } from '@/modulos/nucleo'

/**
 * [recap] A FACHADA DO NUCLEO que o Dangai entrega no `iniciar`. As stores e as
 * telas portadas do Studio falavam com o useProject; aqui falam com isto
 * (src/modulos/nucleo.ts), a parte do Dangai que o modulo pode usar.
 */
let atual: Nucleo | null = null

export function guardarNucleo(n: Nucleo): void {
  atual = n
}

export function nucleo(): Nucleo {
  if (!atual) throw new Error('O modulo do recap ainda nao iniciou.')
  return atual
}
