import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { ConfigDoModulo } from '../../../electron/modulos'
import { aplicarPatch, CONFIG_PADRAO, coerceConfig, modeloGeminiProDe, type ConfigDoRecap, type ConfigDoRecapNaTela } from '../shared/config'
import { ESCRITORES, ESCRITORES_IDS, type Escritor } from '../shared/escritor'
import { contexto } from './contexto'
import { garantirGravavel } from './episodio/protegidas'
import { bibliotecaPadrao } from './settings'

/**
 * [recap] A configuracao do modulo para o nucleo (ConfigDoModulo): o padrao,
 * o coerce do que veio do disco, o que a tela ve e a conferencia do patch.
 *
 * A biblioteca e onde o recap GRAVA: nunca numa pasta do AnCut ou do Corte
 * Cenas (protegidas.ts) -- a mesma regra do "Trocar pasta" do Studio.
 */

/** A pasta resolvida de uma config: a escolhida ou o padrao do modulo. */
export function bibliotecaEfetiva(c: ConfigDoRecap): string {
  return c.biblioteca || bibliotecaPadrao()
}

export function configNaTela(raw: unknown): ConfigDoRecapNaTela {
  const c = coerceConfig(raw)
  let bibliotecaDoDangai = ''
  try {
    bibliotecaDoDangai = contexto().config().libraryDir
  } catch {
    /* antes do configurar (teste): sem a libraryDir */
  }
  const musicas = c.pastaDeMusicas && existsSync(c.pastaDeMusicas) ? c.pastaDeMusicas : ''
  return {
    ...c,
    bibliotecaEfetiva: bibliotecaEfetiva(c),
    bibliotecaDoDangai,
    pastaDeMusicasEfetiva: musicas,
    escritoresComChave: escritoresComChave(),
    modeloGeminiProEfetivo: modeloGeminiProDe(c),
  }
}

/** Quem pode escrever agora: o provedor do escritor tem chave no nucleo (so o sim/nao, nunca a chave). */
export function escritoresComChave(): Record<Escritor, boolean> {
  const tem = {} as Record<Escritor, boolean>
  for (const id of ESCRITORES_IDS) {
    const provedor = ESCRITORES[id].provedor
    try {
      tem[id] = provedor === null ? true : contexto().ia.provedor(provedor) !== null
    } catch {
      tem[id] = provedor === null
    }
  }
  return tem
}

export const configDoRecap: ConfigDoModulo = {
  padrao: CONFIG_PADRAO,
  coerce: coerceConfig,
  paraRenderer: configNaTela,
  validarPatch(patch, atual) {
    const nova = aplicarPatch(coerceConfig(atual), patch)
    if (nova.biblioteca) {
      if (!isAbsolute(nova.biblioteca)) throw new Error('Escolha uma pasta inteira (com a letra do disco).')
      garantirGravavel(nova.biblioteca)
    }
    // A pasta de musicas so e lida (o historico mora no perfil): basta ser inteira.
    if (nova.pastaDeMusicas && !isAbsolute(nova.pastaDeMusicas)) throw new Error('Escolha uma pasta inteira (com a letra do disco).')
    return nova
  },
}
