/**
 * ENVIAR PARA O ANCUT (L1): um episodio cortado pelo motor do recap vai para a
 * biblioteca do AnCut HUB -- a pasta (shots/, keyframes/, metadata/) e as
 * linhas do banco (anime, episode, character, shot e o que pende delas), com
 * os ids remapeados, numa transacao so e com backup do index.db antes.
 *
 * E a UNICA escrita do recap no AnCut, e so com o clique do Levi (ou o
 * "Enviar sempre", desligado por padrao). So tipos e constantes: a ponte roda
 * no sandbox.
 */

/** O que a conferencia (sem escrever nada) achou. */
export type SituacaoNoAncut =
  /** Sem o AnCut nesta maquina (sem config/banco). */
  | 'sem-ancut'
  /** O episodio nao e da biblioteca do recap (ou nao tem cenas). */
  | 'nao-e-do-recap'
  /** O banco do motor do recap nao tem este episodio. */
  | 'sem-banco-do-recap'
  /** O index.db instalado tem outro esquema (outra versao do AnCut). */
  | 'esquema-diferente'
  /** O AnCut (ou o motor dele) esta aberto. */
  | 'aberto'
  /** O episodio ja esta la: substituir ou pular. */
  | 'ja-existe'
  | 'pronto'

export interface ConferenciaDoEnvio {
  situacao: SituacaoNoAncut
  /** Curta, ASCII, para a tela. */
  mensagem: string
  /** O anime e o episodio ("Nia Liston ... S01E01"), quando se sabe. */
  rotulo: string | null
}

export interface ResultadoDoEnvio {
  enviado: boolean
  mensagem: string
  /** Linhas gravadas no AnCut (so com `enviado`). */
  linhas: { anime: number; episode: number; character: number; shot: number; shotCharacter: number; favorite: number; manualOverride: number } | null
  /** A pasta do episodio na biblioteca do AnCut. */
  pasta: string | null
  /** O backup do index.db feito antes. */
  backup: string | null
}

/** main -> tela: o resultado do "Enviar sempre" ao fim de um corte (nunca pergunta no meio do fluxo). */
export interface EnvioAutomatico {
  episodioId: string
  enviado: boolean
  mensagem: string
}
