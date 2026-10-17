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
import type { AjustesDaVoz, CampoDeChaveDaVoz, TesteDeVoz, VozPadrao } from './tipos-da-voz'
import type {
  AudioDoTake,
  EstimativaDeCusto,
  PedidoDeAjuste,
  PedidoDeEstimativa,
  PedidoDeGeracao,
  PedidoDeImportacao,
  PedidoDeRegravar,
  ProgressoDaVoz,
  VozGerada,
} from './voz'

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

  // passo 3 (Voz). Tipos em shared/voz.ts; o motor e electron/voz/.
  estimarVoz: 'recap:voz:estimar',
  gerarVoz: 'recap:voz:gerar',
  regravarFrases: 'recap:voz:regravar',
  ajustarVoz: 'recap:voz:ajustar',
  importarAudio: 'recap:voz:importar',
  cancelarVoz: 'recap:voz:cancelar',
  escolherTake: 'recap:voz:escolher-take',
  aprovarVoz: 'recap:voz:aprovar',
  desaprovarVoz: 'recap:voz:desaprovar',
  urlDoAudio: 'recap:voz:url-do-audio',
  escolherNarracao: 'recap:voz:escolher-narracao',
  /** main -> renderer, ProgressoDaVoz (andamento de gerar/regravar/ajustar/importar) */
  vozProgresso: 'recap:voz:progresso',

  // chaves e voz padrao (a secao "Voz" das Configuracoes)
  lerAjustesDaVoz: 'recap:voz:ler-ajustes',
  salvarChaveDaVoz: 'recap:voz:salvar-chave',
  testarEleven: 'recap:voz:testar-eleven',
  testarFish: 'recap:voz:testar-fish',
} as const

/** O que aparece em `window.dangai.modulos.recap`. Os nomes sao os do Studio. */
export interface PonteDoRecap {
  lerConfig(): Promise<IpcResult<ConfigDoRecapNaTela>>
  /**
   * Grava a biblioteca ('' = o padrao; recusa pasta do AnCut/Corte Cenas) e/ou
   * a voz padrao. Voz sem `velocidadeNativa` mantem a que ja estava.
   */
  salvarConfig(patch: { biblioteca?: string; vozPadrao?: VozPadrao }): Promise<IpcResult<ConfigDoRecapNaTela>>
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

  // Passo 3 (Voz), como no Studio: tudo que muda o rascunho devolve o rascunho
  // INTEIRO do disco. Gastar SEMPRE passa por estimarVoz antes: gerarVoz e
  // regravarFrases levam o `confirmado` que a tela mostrou, e o main recusa se
  // o custo real passar.
  estimarVoz(rascunhoId: string, pedido: PedidoDeEstimativa): Promise<IpcResult<EstimativaDeCusto>>
  gerarVoz(rascunhoId: string, pedido: PedidoDeGeracao): Promise<IpcResult<VozGerada>>
  regravarFrases(rascunhoId: string, pedido: PedidoDeRegravar): Promise<IpcResult<VozGerada>>
  /** Take novo a partir do BRUTO do atual so com outra velocidade/corte. Nao gasta. */
  ajustarVoz(rascunhoId: string, pedido: PedidoDeAjuste): Promise<IpcResult<VozGerada>>
  /** Take novo do audio que ele gravou: Whisper + alinhador do nucleo. Nao gasta. */
  importarAudio(rascunhoId: string, pedido: PedidoDeImportacao): Promise<IpcResult<VozGerada>>
  cancelarVoz(rascunhoId: string, pedidoId: string): Promise<IpcResult<boolean>>
  escolherTake(rascunhoId: string, takeId: string): Promise<IpcResult<RascunhoDoRecap>>
  aprovarVoz(rascunhoId: string): Promise<IpcResult<RascunhoDoRecap>>
  desaprovarVoz(rascunhoId: string): Promise<IpcResult<RascunhoDoRecap>>
  /** O WAV do take no servidor de midia do nucleo, pedido por id (nunca por caminho). */
  urlDoAudio(rascunhoId: string, takeId: string): Promise<IpcResult<AudioDoTake>>
  escolherNarracao(): Promise<IpcResult<string | null>>
  onVozProgresso(listener: (progresso: ProgressoDaVoz) => void): () => void

  /** As chaves (so tem/dica) e a voz padrao. */
  lerAjustesDaVoz(): Promise<IpcResult<AjustesDaVoz>>
  /** Grava (ou apaga, com '') uma chave de voz no cofre do nucleo. */
  salvarChaveDaVoz(campo: CampoDeChaveDaVoz, valor: string): Promise<IpcResult<AjustesDaVoz>>
  /** Confere a chave sem gastar: plano/saldo e vozes. `chave` null testa a salva, que nunca volta para ca. */
  testarEleven(chave: string | null): Promise<IpcResult<TesteDeVoz>>
  testarFish(chave: string | null): Promise<IpcResult<TesteDeVoz>>
}
