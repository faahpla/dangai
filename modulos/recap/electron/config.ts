import { isAbsolute, join } from 'node:path'
import type { ConfigDoModulo } from '../../../electron/modulos'
import { CONFIG_PADRAO, coerceConfig, type ConfigDoRecap, type ConfigDoRecapNaTela } from '../shared/config'
import { contexto } from './contexto'
import { garantirGravavel } from './episodio/protegidas'
import { pastaDeDocumentos } from './settings'

/**
 * [recap] A configuracao do modulo para o nucleo (ConfigDoModulo): o padrao,
 * o coerce do que veio do disco, o que a tela ve e a conferencia do patch.
 *
 * A biblioteca e onde o recap GRAVA: nunca numa pasta do AnCut ou do Corte
 * Cenas (protegidas.ts) -- a mesma regra do "Trocar pasta" do Studio.
 */

/** A pasta resolvida de uma config: a escolhida ou o padrao do Studio. */
export function bibliotecaEfetiva(c: ConfigDoRecap): string {
  return c.biblioteca || join(pastaDeDocumentos(), 'AniRecap Studio', 'Biblioteca')
}

export function configNaTela(raw: unknown): ConfigDoRecapNaTela {
  const c = coerceConfig(raw)
  let bibliotecaDoDangai = ''
  try {
    bibliotecaDoDangai = contexto().config().libraryDir
  } catch {
    /* antes do configurar (teste): sem a libraryDir */
  }
  return { ...c, bibliotecaEfetiva: bibliotecaEfetiva(c), bibliotecaDoDangai }
}

export const configDoRecap: ConfigDoModulo = {
  padrao: CONFIG_PADRAO,
  coerce: coerceConfig,
  paraRenderer: configNaTela,
  validarPatch(patch, atual) {
    const nova = coerceConfig({ ...coerceConfig(atual), ...(patch && typeof patch === 'object' ? patch : {}) })
    if (nova.biblioteca) {
      if (!isAbsolute(nova.biblioteca)) throw new Error('Escolha uma pasta inteira (com a letra do disco).')
      garantirGravavel(nova.biblioteca)
    }
    return nova
  },
}
