import type { EpisodeIndex } from './episodio'

/**
 * MOVER PARA O ANCUT (L1): um episodio cortado pelo motor do recap MUDA para
 * a biblioteca do AnCut HUB -- a pasta (shots/, keyframes/, metadata/...) e as
 * linhas do banco (anime, episode, character, shot e o que pende delas), com
 * os ids remapeados, numa transacao so e com backup do index.db antes. Fica
 * UMA copia, a do AnCut ("enviar sempre pro ancut e pra quem nao quer a
 * biblioteca separada", Levi); no recap so o indice pequeno, em _indices/<id>.
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
  /** O episodio ja esta la, diferente: substituir ou pular. */
  | 'ja-existe'
  /**
   * Ja esta la IGUAL (copiado pela versao antiga, que copiava): unificar = o
   * recap passa a usar a de la e a daqui vai para a Lixeira. Nao escreve no AnCut.
   */
  | 'unificar'
  /** Ja mora so no AnCut (movido). */
  | 'no-ancut'
  | 'pronto'

export interface ConferenciaDoEnvio {
  situacao: SituacaoNoAncut
  /** Curta, ASCII, para a tela. */
  mensagem: string
  /** O anime e o episodio ("Nia Liston ... S01E01"), quando se sabe. */
  rotulo: string | null
}

/** Como a pasta mudou: rename (mesmo disco), copia conferida (outro disco) ou unificado (a daqui foi para a Lixeira). */
export type ModoDaMudanca = 'rename' | 'copia' | 'unificado'

export interface ResultadoDoEnvio {
  /** Mudou (o episodio agora mora so no AnCut). */
  enviado: boolean
  mensagem: string
  /** Linhas gravadas no AnCut (so com `enviado`; zeradas no unificar). */
  linhas: { anime: number; episode: number; character: number; shot: number; shotCharacter: number; favorite: number; manualOverride: number } | null
  /** A pasta do episodio na biblioteca do AnCut. */
  pasta: string | null
  /** O backup do index.db feito antes. */
  backup: string | null
  /** Como mudou (so com `enviado`). */
  modo?: ModoDaMudanca | null
  /** O indice novo (em _indices/<id>, apontando a pasta do AnCut). */
  indice?: EpisodeIndex | null
}

/** O "Reconhecer agora" de um episodio que mora no AnCut: ele volta para o recap antes. */
export interface ResultadoDaVolta {
  trazido: boolean
  mensagem: string
  /** A pasta do episodio de volta na biblioteca do recap. */
  pasta: string | null
  backup: string | null
  indice: EpisodeIndex | null
}

/** main -> tela: o resultado do "Enviar sempre" ao fim de um corte (nunca pergunta no meio do fluxo). */
export interface EnvioAutomatico {
  episodioId: string
  enviado: boolean
  mensagem: string
}

/**
 * A pasta escolhida para a biblioteca do recap e a do AnCut: recusada (o
 * recap nunca corta direto la -- o index.db do AnCut nao conheceria o
 * episodio), e a tela oferece ligar o "Enviar sempre". O main lanca com este
 * texto; a tela reconhece por ele.
 */
export const RECADO_BIBLIOTECA_DO_ANCUT = "Essa e a biblioteca do AnCut. Pra ter uma biblioteca so, ligue 'Enviar sempre para o AnCut'."
