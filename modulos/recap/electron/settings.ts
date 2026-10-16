import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getSettings as settingsDoNucleo } from '../../../electron/services/settings'
import type { VozPadrao } from '../shared/tipos-da-voz'
import { configDoRecap, contexto } from './contexto'

/**
 * [recap] O getSettings que os servicos do Studio esperam, montado com o que o
 * modulo pode ler: a libraryDir pelo contexto, a biblioteca do recap pela
 * configuracao dele, e os campos de IA do nucleo.
 *
 * Os de IA vem do getSettings do nucleo porque o llm.ts (que e do nucleo) pede
 * as chaves para escolher o provedor, e o cache do passo 2 entra pelo modelo
 * pedido. Tudo isso fica no main: nada daqui vai para o renderer.
 */

/** A voz ainda nao mora no modulo (parte 2): o ritmo do roteiro sai do inicial. */
const SEM_VOZ: VozPadrao = { provedor: '', voiceId: '', modelId: '', velocidadeNativa: 1.2 }

export function getSettings() {
  const s = settingsDoNucleo()
  return {
    libraryDir: contexto().config().libraryDir,
    iaProvedor: s.iaProvedor,
    geminiApiKey: s.geminiApiKey,
    anthropicApiKey: s.anthropicApiKey,
    geminiModelo: s.geminiModelo,
    anthropicModelo: s.anthropicModelo,
    bibliotecaStudio: configDoRecap().biblioteca,
    vozPadrao: SEM_VOZ,
  }
}

export function pastaDeDocumentos(): string {
  try {
    return app.getPath('documents')
  } catch {
    return join(homedir(), 'Documents')
  }
}

/**
 * A biblioteca do recap, ja resolvida: a escolhida ou o padrao
 * <Documentos>/AniRecap Studio/Biblioteca (o do Studio, para quem vem de la
 * achar os mesmos episodios). Nao cria a pasta -- quem grava cria.
 */
export function pastaDaBibliotecaStudio(): string {
  return configDoRecap().biblioteca || join(pastaDeDocumentos(), 'AniRecap Studio', 'Biblioteca')
}
