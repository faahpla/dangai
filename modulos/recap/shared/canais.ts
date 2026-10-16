import type { IpcResult } from '@shared/channels'
import type { ConfigDoRecapNaTela } from './config'
import type {
  EpisodeIndex,
  EpisodioEncontrado,
  Exclusao,
  IndexarEpisodioArgs,
  IndexarFalasArgs,
  PalpiteDoEpisodio,
  SondaDoEpisodio,
} from './episodio'
import type {
  EventosGerados,
  PedidoDeReligar,
  PedidoDeRoteiro,
  ProgressoDoRoteiro,
  RascunhoAberto,
  RascunhoDoRecap,
  ResumoDoRascunho,
  Roteiro,
  RoteiroGerado,
  RoteiroReligado,
} from './roteiro'
import type { RitmoDaVoz } from './ritmo'

/**
 * [recap] OS CANAIS DO MODULO: `recap:<area>:<acao>`, o prefixo que o nucleo
 * exige (electron/modulos.ts recusa qualquer outro). No Studio eram canais do
 * app ('episodio:sondar', 'recap:gerar-roteiro'); a logica de cada um e a
 * mesma, so o nome mudou.
 *
 * So constantes e tipos: a ponte roda no preload (sandbox) e importa daqui.
 */
export const CANAIS = {
  // configuracao do modulo (a biblioteca do recap)
  lerConfig: 'recap:config:ler',
  salvarConfig: 'recap:config:salvar',
  escolherBiblioteca: 'recap:config:escolher-biblioteca',

  // passo 1 (Episodio). Tipos em shared/episodio.ts.
  escolherEpisodio: 'recap:episodio:escolher',
  sondarEpisodio: 'recap:episodio:sondar',
  procurarEpisodio: 'recap:episodio:procurar',
  indexarEpisodio: 'recap:episodio:indexar',
  indexarFalas: 'recap:episodio:indexar-falas',
  salvarExclusoes: 'recap:episodio:salvar-exclusoes',
  /** main -> renderer, texto de andamento da indexacao (legenda, OP/ED, indice) */
  indexarProgresso: 'recap:episodio:indexar-progresso',

  // passo 2 (Roteiro). Tipos em shared/roteiro.ts.
  abrirRascunho: 'recap:roteiro:abrir-rascunho',
  listarRascunhos: 'recap:roteiro:listar-rascunhos',
  gerarEventos: 'recap:roteiro:gerar-eventos',
  gerarRoteiro: 'recap:roteiro:gerar',
  cancelarRoteiro: 'recap:roteiro:cancelar',
  salvarRoteiro: 'recap:roteiro:salvar',
  escolherVersao: 'recap:roteiro:escolher-versao',
  aprovarRoteiro: 'recap:roteiro:aprovar',
  desaprovarRoteiro: 'recap:roteiro:desaprovar',
  religarRoteiro: 'recap:roteiro:religar',
  miniaturasDasCenas: 'recap:roteiro:miniaturas',
  /** O ritmo da voz que narra o rascunho (shared/ritmo.ts): o "~Xs" do roteiro. */
  ritmoDaVoz: 'recap:roteiro:ritmo',
  /** main -> renderer, ProgressoDoRoteiro (texto de andamento das chamadas a IA) */
  roteiroProgresso: 'recap:roteiro:progresso',
} as const

/** O que aparece em `window.dangai.modulos.recap`. Os nomes sao os do Studio. */
export interface PonteDoRecap {
  lerConfig(): Promise<IpcResult<ConfigDoRecapNaTela>>
  /** Grava a biblioteca ('' = o padrao). Recusa pasta do AnCut/Corte Cenas. */
  salvarConfig(patch: { biblioteca: string }): Promise<IpcResult<ConfigDoRecapNaTela>>
  /** Dialogo de pasta. null = fechou sem escolher. */
  escolherBiblioteca(): Promise<IpcResult<string | null>>

  escolherEpisodio(): Promise<IpcResult<string | null>>
  sondarEpisodio(path: string): Promise<IpcResult<SondaDoEpisodio>>
  procurarEpisodio(path: string, palpite: PalpiteDoEpisodio): Promise<IpcResult<EpisodioEncontrado[]>>
  indexarEpisodio(args: IndexarEpisodioArgs): Promise<IpcResult<EpisodeIndex>>
  indexarFalas(args: IndexarFalasArgs): Promise<IpcResult<EpisodeIndex>>
  salvarExclusoes(indiceId: string, exclusoes: readonly Exclusao[]): Promise<IpcResult<EpisodeIndex>>
  onIndexarProgresso(listener: (mensagem: string) => void): () => void

  abrirRascunho(episodioId: string, novo?: boolean): Promise<IpcResult<RascunhoAberto>>
  listarRascunhos(): Promise<IpcResult<ResumoDoRascunho[]>>
  gerarEventos(rascunhoId: string): Promise<IpcResult<EventosGerados>>
  gerarRoteiro(rascunhoId: string, pedido: PedidoDeRoteiro): Promise<IpcResult<RoteiroGerado>>
  cancelarRoteiro(rascunhoId: string, pedidoId: string): Promise<IpcResult<boolean>>
  salvarRoteiro(rascunhoId: string, roteiro: Roteiro): Promise<IpcResult<RascunhoDoRecap>>
  escolherVersao(rascunhoId: string, versao: number): Promise<IpcResult<RascunhoDoRecap>>
  aprovarRoteiro(rascunhoId: string, roteiro: Roteiro): Promise<IpcResult<RascunhoDoRecap>>
  desaprovarRoteiro(rascunhoId: string): Promise<IpcResult<RascunhoDoRecap>>
  religarRoteiro(rascunhoId: string, pedido: PedidoDeReligar): Promise<IpcResult<RoteiroReligado>>
  miniaturasDasCenas(episodioId: string, planoIds: readonly string[]): Promise<IpcResult<Record<string, string | null>>>
  ritmoDaVoz(rascunhoId: string | null, config?: unknown): Promise<IpcResult<RitmoDaVoz>>
  onRoteiroProgresso(listener: (progresso: ProgressoDoRoteiro) => void): () => void
}
