import { app } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Provedor } from '../../../electron/services/llm'
import { configDoRecap, contexto } from './contexto'

/**
 * [recap] O getSettings que os servicos do Studio esperam, montado com o que o
 * modulo pode ler: a libraryDir e o modelo do Whisper pelo contexto, a
 * biblioteca e a voz padrao pela configuracao dele, e as chaves de voz pelo
 * cofre (`ctx.chave`, so no main; nunca vao para a tela). A IA vem pelo
 * `ctx.ia` (gerar/ia.ts): o modulo nunca le as chaves dela.
 */
export function getSettings() {
  const ctx = contexto()
  const c = configDoRecap()
  return {
    libraryDir: ctx.config().libraryDir,
    whisperModel: ctx.config().whisperModel,
    bibliotecaStudio: c.biblioteca,
    vozPadrao: c.vozPadrao,
    pastaDeMusicas: c.pastaDeMusicas,
    edicaoRapidaPadrao: c.edicaoRapidaPadrao,
    get elevenlabsApiKey(): string {
      return ctx.chave('elevenlabsApiKey')
    },
    get fishApiKey(): string {
      return ctx.chave('fishApiKey')
    },
  }
}

/**
 * O modelo escolhido nas Configuracoes para o provedor ('' = o automatico). So
 * o nome, nunca a chave: entra na chave do cache do passo 2, para trocar de
 * modelo nao devolver a resposta do outro.
 */
export function modeloEscolhido(provedor: Provedor): string {
  return contexto().ia.modelo(provedor)
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

/**
 * A pasta de musicas da Edicao rapida, se existe. [recap] Sem padrao: a do
 * Studio (`G:/App Resumo/music`) e da maquina do Levi. '' = nenhuma: a Edicao
 * rapida segue sem musica e avisa. So leitura -- quem lista nunca grava nela.
 */
export function pastaDeMusicasEfetiva(): string {
  const escolhida = configDoRecap().pastaDeMusicas
  return escolhida && existsSync(escolhida) ? escolhida : ''
}
