import type { ProjectState } from './project'

/**
 * Os campos que constituem o DOCUMENTO.
 *
 * Estado de sessao (playhead, selecao, busy, o que esta aberto na tela) fica de
 * fora de proposito: mover a agulha nao e editar o projeto. Marcar isso como
 * alteracao faria o app pedir para salvar depois de so assistir ao preview -- e,
 * no desfazer, gastaria um passo de Ctrl+Z para devolver a agulha de lugar.
 *
 * Mora sozinho porque tem dois donos: o autosave, que grava quando isto muda, e
 * o desfazer, que fotografa quando isto muda. Os dois respondem a mesma
 * pergunta -- "o usuario editou o projeto?" -- e ela precisa ter uma resposta
 * so.
 */
export const CAMPOS = [
  'audio',
  'images',
  'plan',
  'planOrigin',
  'planEdited',
  'transcript',
  'captions',
  'captionsEdited',
  'captionsEnabled',
  'captionColor',
  'captionY',
  'sfxEnabled',
  'music',
  'musicGainDb',
  'hookText',
  'hookSec',
  'endText',
  'endSec',
  'metadata',
  'script',
  'subtitlePath',
] as const

export type CampoDoDocumento = (typeof CAMPOS)[number]
export type Documento = Pick<ProjectState, CampoDoDocumento>

export function mudou(a: ProjectState, b: ProjectState): boolean {
  return CAMPOS.some((campo) => a[campo] !== b[campo])
}

/**
 * Fotografia do documento.
 *
 * Copia rasa de proposito: os objetos de dentro (imagem, cena, bloco de
 * legenda) sao tratados como imutaveis em todo o store -- editar sempre cria
 * outro. Entao guardar a referencia basta, e cinquenta fotografias custam
 * cinquenta ponteiros, nao cinquenta copias das imagens.
 */
export function fotografar(state: ProjectState): Documento {
  const foto = {} as Record<string, unknown>
  for (const campo of CAMPOS) foto[campo] = state[campo]
  return foto as Documento
}
