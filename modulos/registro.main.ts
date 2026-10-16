import type { ModuloDoMain } from '../electron/modulos'
import { recap } from './recap/electron'

/**
 * OS MODULOS DO MAIN -- uma linha por modulo. Ver electron/modulos.ts.
 */
export const MODULOS_DO_MAIN: ModuloDoMain[] = [recap]
