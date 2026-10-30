import type { PonteDaThumb } from '../shared/canais'

/** [thumb] A ponte no renderer: `window.dangai.modulos.thumb`, pedida na hora. */
const doMain = (): PonteDaThumb => window.dangai.modulos.thumb

export const ponte = new Proxy({} as PonteDaThumb, {
  get: (_alvo, nome: string) => doMain()[nome as keyof PonteDaThumb],
})
