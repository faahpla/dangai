import type { ModuloDoRenderer } from '../src/modulos/api'
import { recap } from './recap/src'
import { thumb } from './thumb/src'

/**
 * OS MODULOS DO RENDERER -- uma linha por modulo. Ver src/modulos/api.ts.
 */
export const MODULOS_DO_RENDERER: ModuloDoRenderer[] = [recap, thumb]
