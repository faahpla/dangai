import type { PonteDoRecap } from '../shared/canais'

/**
 * [recap] A PONTE no renderer: `window.dangai.modulos.recap` (shared/canais.ts)
 * com os nomes do Studio, para as stores portadas ficarem iguais as de la.
 * Parte 4: o motor (status, analise, corte por tras, Reconhecer na mao e o
 * runtime) tambem vai ao main, como o resto.
 */

/** O main do modulo, pedido na hora (a ponte so existe com o preload carregado). */
const doMain = (): PonteDoRecap => window.dangai.modulos.recap

export const ponte = new Proxy({} as PonteDoRecap, {
  get: (_alvo, nome: string) => doMain()[nome as keyof PonteDoRecap],
})
