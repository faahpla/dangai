import type { CriarPonte } from '../shared/modulos'
import { criarPonteDoRecap } from './recap/electron/ponte'
import { criarPonteDaThumb } from './thumb/electron/ponte'

/**
 * AS PONTES DOS MODULOS -- uma linha por modulo. Cada uma aparece em
 * `window.dangai.modulos.<id>`. Roda no preload (sandbox): so `import type`
 * e constantes. Ver shared/modulos.ts.
 */
export const PONTES = { recap: criarPonteDoRecap, thumb: criarPonteDaThumb } satisfies Record<string, CriarPonte>

export type PontesDosModulos = { [K in keyof typeof PONTES]: ReturnType<(typeof PONTES)[K]> }
