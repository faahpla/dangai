import type { ModuloDoMain } from '../electron/modulos'
import { claude } from './claude/electron'
import { recap } from './recap/electron'
import { thumb } from './thumb/electron'

/**
 * OS MODULOS DO MAIN -- uma linha por modulo. Ver electron/modulos.ts.
 */
export const MODULOS_DO_MAIN: ModuloDoMain[] = [recap, thumb, claude]
