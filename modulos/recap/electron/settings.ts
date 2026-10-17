import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getSettings as settingsDoNucleo } from '../../../electron/services/settings'
import type { Provedor } from '../../../electron/services/llm'
import type { VozPadrao } from '../shared/tipos-da-voz'
import { configDoRecap, contexto } from './contexto'

/**
 * [recap] O getSettings que os servicos do Studio esperam, montado com o que o
 * modulo pode ler: a libraryDir pelo contexto e a biblioteca do recap pela
 * configuracao dele. A IA vem pelo `ctx.ia` (gerar/ia.ts): o modulo nunca le
 * as chaves.
 */

/** A voz ainda nao mora no modulo (parte 2): o ritmo do roteiro sai do inicial. */
const SEM_VOZ: VozPadrao = { provedor: '', voiceId: '', modelId: '', velocidadeNativa: 1.2 }

export function getSettings() {
  return {
    libraryDir: contexto().config().libraryDir,
    bibliotecaStudio: configDoRecap().biblioteca,
    vozPadrao: SEM_VOZ,
  }
}

/**
 * O modelo escolhido nas Configuracoes para o provedor ('' = o automatico). So
 * o nome, nunca a chave: entra na chave do cache do passo 2, para trocar de
 * modelo nao devolver a resposta do outro.
 */
export function modeloEscolhido(provedor: Provedor): string {
  const s = settingsDoNucleo()
  return provedor === 'gemini' ? s.geminiModelo : s.anthropicModelo
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
