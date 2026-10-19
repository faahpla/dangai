import type { IpcResult } from '@shared/channels'
import type { ConferenciaDoEnvio, EnvioAutomatico, ResultadoDaVolta, ResultadoDoEnvio } from './ancut'
import type { ConfigDasCenas, ConfigDoRecapNaTela } from './config'
import type {
  CorteParado,
  EpisodeIndex,
  EpisodioEncontrado,
  EstadoDoCorte,
  EventoDoCorte,
  Exclusao,
  FimDaAnalise,
  IndexarEpisodioArgs,
  IndexarFalasArgs,
  PalpiteDoEpisodio,
  PedidoDeAnalise,
  PedidoDeCorte,
  ProgressoDaAnalise,
  SondaDoEpisodio,
  StatusDoMotor,
} from './episodio'
import type {
  BuscaDeAnime,
  DecisaoDaDescoberta,
  ElencoEscolhido,
  EstadoDaDescoberta,
  EventoDaDescoberta,
  PedidoDaDescoberta,
  PedidoDeElenco,
  ResultadoDaDescoberta,
} from './descoberta'
import type { EstadoDoMotorRuntime, PedidoDeInstalacao } from './motor-runtime'
import type { ProgressoDaMigracao, ResumoDaMigracao, StudioAchado } from './migracao'
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
import type { EstiloDoRecap, EstiloNaTela } from './estilo'
import type { ModoDaRevisao, RevisaoFeita } from './revisao'
import type { Escritor } from './escritor'
import type { PlanoNoMesclado } from './mesclas'
import type {
  CandidatosDaFrase,
  CenasGravadas,
  EscolhaDaFrase,
  EtapaDaMontagem,
  FiltrosDeCandidatos,
  PedidoDeMontagem,
  ProjetoMontado,
} from './cenas'
import type {
  LoteDeRostos,
  MusicaDaPasta,
  PedidoDePlanoDeSom,
  PlanoDeSom,
  RostosDoLote,
  SfxDaEdicaoRapida,
} from './edicao-rapida'
import type { AjustesDaVoz, CampoDeChaveDaVoz, TesteDeVoz, VozPadrao } from './tipos-da-voz'
import type { PedidoDeTextos, PngDoTexto } from './textos-na-tela'
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
  VozInterrompida,
} from './voz'

/** As IAs do nucleo (o `Provedor` do llm.ts, que a ponte nao importa). */
export type ProvedorDaIa = 'gemini' | 'anthropic'

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
  /** Quem atende a IA agora (o `ctx.ia.provedor()`): null = nenhuma chave. A boas-vindas. */
  provedorDaIa: 'recap:ia:provedor',

  // L1: mover para o AnCut. Tipos em shared/ancut.ts.
  ancutAchado: 'recap:ancut:achado',
  ancutConferir: 'recap:ancut:conferir',
  ancutEnviar: 'recap:ancut:enviar',
  ancutUnificar: 'recap:ancut:unificar',
  ancutTrazer: 'recap:ancut:trazer',
  ancutDepoisDaAnalise: 'recap:ancut:depois-da-analise',
  /** main -> renderer, EnvioAutomatico (o "Enviar sempre" ao fim de um corte) */
  ancutAutomatico: 'recap:ancut:automatico',

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
  // lote 1 das ideias (17/10): o "Meu estilo" e o revisor. Tipos em estilo.ts e revisao.ts.
  lerEstilo: 'recap:roteiro:ler-estilo',
  salvarEstilo: 'recap:roteiro:salvar-estilo',
  importarExemplo: 'recap:roteiro:importar-exemplo',
  revisarRoteiro: 'recap:roteiro:revisar',
  aplicarRevisao: 'recap:roteiro:aplicar-revisao',
  ignorarRevisao: 'recap:roteiro:ignorar-revisao',

  // passo 3 (Voz). Tipos em shared/voz.ts; o motor e electron/voz/.
  estimarVoz: 'recap:voz:estimar',
  gerarVoz: 'recap:voz:gerar',
  regravarFrases: 'recap:voz:regravar',
  ajustarVoz: 'recap:voz:ajustar',
  importarAudio: 'recap:voz:importar',
  cancelarVoz: 'recap:voz:cancelar',
  /** O2: o pedido de voz que o app largou no meio (le e apaga a marca). */
  vozInterrompida: 'recap:voz:interrompida',
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

  // passo 4 (Cenas) e o "Abrir no editor" (parte 3)
  sugerirCenas: 'recap:cenas:sugerir',
  candidatosDaFrase: 'recap:cenas:candidatos',
  salvarCenas: 'recap:cenas:salvar',
  encaixarNaVoz: 'recap:cenas:encaixar',
  /** (rodada 4) "Grid" / "Tela cheia" numa frase (cenas/grid.ts). */
  gridDaFrase: 'recap:cenas:grid',
  mesclasDoEpisodio: 'recap:cenas:mesclas',
  montarProjeto: 'recap:montar:projeto',
  /** O2: a montagem (Abrir no editor) que o app largou no meio. */
  montagemInterrompida: 'recap:montar:interrompida',
  /** main -> renderer, EtapaDaMontagem */
  montarProgresso: 'recap:montar:progresso',

  // Edicao rapida (parte 3)
  listarMusicas: 'recap:som:listar-musicas',
  escolherMusica: 'recap:som:escolher-musica',
  registrarMusicaUsada: 'recap:som:registrar-musica',
  planejarSom: 'recap:som:planejar',
  sfxDaEdicaoRapida: 'recap:som:sfx-da-edicao-rapida',
  rostosDosPedacos: 'recap:rosto:pedacos',
  /** Os PNGs dos textos na tela (shared/textos-na-tela.ts, electron/montar/textos.ts). */
  textosNaTela: 'recap:textos:png',
  /** Os textos de tela de uma versao do roteiro (projeto montado antes dos Textos na tela). */
  telasDoRascunho: 'recap:textos:do-rascunho',

  // O motor de personagens (parte 4). Tipos em episodio.ts, descoberta.ts e
  // motor-runtime.ts; o main e electron/motor.ts, episodio/corte-fundo.ts,
  // descoberta/ e motor-runtime/.
  statusDoMotor: 'recap:motor:status',
  analisarEpisodio: 'recap:motor:analisar',
  cancelarAnalise: 'recap:motor:cancelar',
  /** main -> renderer, ProgressoDaAnalise */
  analiseProgresso: 'recap:motor:progresso',
  /** main -> renderer, FimDaAnalise (uma vez por job) */
  analiseFim: 'recap:motor:fim',
  iniciarCorte: 'recap:corte:iniciar',
  estadoDoCorte: 'recap:corte:estado',
  /** O2: o corte que o app largou no meio (o .mkv reaberto volta onde estava). */
  corteParado: 'recap:corte:parado',
  cancelarCorte: 'recap:corte:cancelar',
  /** main -> renderer, EventoDoCorte */
  corteProgresso: 'recap:corte:progresso',
  iniciarDescoberta: 'recap:descoberta:iniciar',
  descobertaAtual: 'recap:descoberta:atual',
  confirmarDescoberta: 'recap:descoberta:confirmar',
  cancelarDescoberta: 'recap:descoberta:cancelar',
  /** main -> renderer, EventoDaDescoberta */
  descobertaProgresso: 'recap:descoberta:progresso',
  /** A1: "Buscar elenco" (o motor busca na AniList, no site do MAL e na Kitsu). */
  buscarAnime: 'recap:descoberta:buscar-anime',
  escolherAnime: 'recap:descoberta:escolher-anime',
  /** O2: a decisao do Reconhecer na mao, gravada a cada mudanca (fechar o app nao perde). */
  salvarDecisao: 'recap:descoberta:salvar-decisao',
  estadoDoMotorRuntime: 'recap:motor-runtime:estado',
  instalarMotorRuntime: 'recap:motor-runtime:instalar',
  cancelarMotorRuntime: 'recap:motor-runtime:cancelar',
  escolherPastaDoMotorRuntime: 'recap:motor-runtime:escolher-pasta',
  removerMotorRuntime: 'recap:motor-runtime:remover',
  /** main -> renderer, EstadoDoMotorRuntime inteiro (no maximo ~4 por segundo) */
  motorRuntimeEstado: 'recap:motor-runtime:mudou',

  // Trazer do AniRecap Studio (parte 5): tipos em migracao.ts, main em electron/migracao/.
  acharStudio: 'recap:studio:achar',
  trazerDoStudio: 'recap:studio:trazer',
  cancelarTrazer: 'recap:studio:cancelar',
  /** main -> renderer, ProgressoDaMigracao (no maximo ~10 por segundo) */
  trazerProgresso: 'recap:studio:progresso',
} as const

/** O que aparece em `window.dangai.modulos.recap`. Os nomes sao os do Studio. */
export interface PonteDoRecap {
  lerConfig(): Promise<IpcResult<ConfigDoRecapNaTela>>
  /**
   * Grava a biblioteca ('' = o padrao; recusa pasta do AnCut/Corte Cenas) e/ou
   * a voz padrao. Voz sem `velocidadeNativa` mantem a que ja estava.
   */
  salvarConfig(patch: {
    biblioteca?: string
    vozPadrao?: VozPadrao
    pastaDeMusicas?: string
    edicaoRapidaPadrao?: unknown
    revisarAoGerar?: boolean
    escritor?: Escritor
    modeloGeminiPro?: string
    cenas?: Partial<ConfigDasCenas>
    enviarSempreAoAncut?: boolean
    naoPerguntarChave?: boolean
  }): Promise<IpcResult<ConfigDoRecapNaTela>>
  /** Dialogo de pasta. null = fechou sem escolher. */
  escolherBiblioteca(): Promise<IpcResult<string | null>>
  /**
   * A IA que atenderia agora, pelo nucleo (Gemini ou Anthropic; so o nome,
   * nunca a chave). null = sem chave de IA nenhuma: a boas-vindas pede a do
   * Gemini.
   */
  provedorDaIa(): Promise<IpcResult<ProvedorDaIa | null>>

  /** L1: o AnCut esta nesta maquina (config e index.db)? */
  ancutAchado(): Promise<IpcResult<boolean>>
  /** L1: as conferencias, sem escrever nada. `rapido` = sem conferir se o AnCut esta aberto. */
  conferirAncut(episodioId: string, rapido?: boolean): Promise<IpcResult<ConferenciaDoEnvio>>
  /** L1: MOVE (ou substitui) o episodio para o AnCut; igual la = unifica. So com o clique. */
  enviarAoAncut(episodioId: string, substituir: boolean): Promise<IpcResult<ResultadoDoEnvio>>
  /** L1: ja esta igual no AnCut (a versao antiga copiava): usa a de la e manda a daqui para a Lixeira. */
  unificarComOAncut(episodioId: string): Promise<IpcResult<ResultadoDoEnvio>>
  /** L1: o "Reconhecer agora" de um episodio que mora no AnCut: ele volta para o recap antes. */
  trazerDoAncut(episodioId: string): Promise<IpcResult<ResultadoDaVolta>>
  /**
   * L1: o fim de uma analise em primeiro plano (Reconhecer agora, Analisar de
   * novo): o "Enviar sempre", ou `devolver` o episodio que veio do AnCut. O
   * resultado tambem chega pelo onEnvioAutomatico.
   */
  depoisDaAnaliseNoAncut(episodioId: string, devolver: boolean): Promise<IpcResult<EnvioAutomatico | null>>
  onEnvioAutomatico(listener: (aviso: EnvioAutomatico) => void): () => void

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
  /** O "Meu estilo" e a medida do que vai ao prompt. */
  lerEstilo(): Promise<IpcResult<EstiloNaTela>>
  salvarEstilo(estilo: EstiloDoRecap): Promise<IpcResult<EstiloNaTela>>
  /** Dialogo de .txt: o nome (do arquivo) e o texto. null = fechou sem escolher. */
  importarExemplo(): Promise<IpcResult<{ nome: string; texto: string } | null>>
  /**
   * Revisa a versao atual (gravada). `automatico` = depois de gerar: respeita o
   * "Revisar depois de gerar" e so marca. `modo` (o botao "Revisar"): corrigir
   * erros (padrao) ou melhorar texto; na mao, os dois ja fazem a versao nova.
   */
  revisarRoteiro(rascunhoId: string, automatico: boolean, modo?: ModoDaRevisao): Promise<IpcResult<RevisaoFeita>>
  /** "Aplicar todas": versao nova a partir da atual, com as sugestoes da revisao. */
  aplicarRevisao(rascunhoId: string): Promise<IpcResult<RascunhoDoRecap>>
  /** "Ignorar": tira as marcas dessas frases da revisao que vale para a versao atual. */
  ignorarRevisao(rascunhoId: string, fraseIds: readonly string[]): Promise<IpcResult<RascunhoDoRecap>>

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
  /** O2: o pedido de voz deste rascunho que o app largou no meio. null = nenhum (le e apaga: avisa uma vez). */
  vozInterrompida(rascunhoId: string): Promise<IpcResult<VozInterrompida | null>>
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

  // Passo 4 (Cenas), como no Studio: tudo que muda o rascunho devolve o
  // rascunho INTEIRO (CenasGravadas.rascunho). O casar e por regras, de graca.
  sugerirCenas(rascunhoId: string): Promise<IpcResult<CenasGravadas>>
  candidatosDaFrase(rascunhoId: string, fraseId: string, filtros: FiltrosDeCandidatos): Promise<IpcResult<CandidatosDaFrase>>
  salvarCenas(rascunhoId: string, escolhas: readonly EscolhaDaFrase[]): Promise<IpcResult<CenasGravadas>>
  encaixarNaVoz(rascunhoId: string): Promise<IpcResult<CenasGravadas>>
  /**
   * (rodada 4) O "Grid" / "Tela cheia" da frase: `ligar` poe o grid na mao (a
   * cena dele fica como uma das metades); desligado volta a tela cheia e o
   * automatico nao poe mais. Erro (ASCII) quando nenhuma outra cena serve.
   */
  gridDaFrase(rascunhoId: string, fraseId: string, ligar: boolean): Promise<IpcResult<CenasGravadas>>
  /** Os planos que o Dangai mesclou depois do indice: planoId -> o mesclado e o ponto dentro dele. So le. */
  mesclasDoEpisodio(episodioId: string): Promise<IpcResult<Record<string, PlanoNoMesclado>>>
  /** Grava o .dangai em <biblioteca do recap>/_projetos/. A tela abre pelo abrirProjeto do nucleo. */
  montarProjeto(rascunhoId: string, pedido?: PedidoDeMontagem): Promise<IpcResult<ProjetoMontado>>
  /** O2: o "Abrir no editor" que o app largou no meio (avisa uma vez). null = nenhum. */
  montagemInterrompida(rascunhoId: string): Promise<IpcResult<{ inicio: string } | null>>
  onMontarProgresso(listener: (etapa: EtapaDaMontagem) => void): () => void

  // Edicao rapida
  listarMusicas(): Promise<IpcResult<MusicaDaPasta[]>>
  escolherMusica(evitar?: readonly string[]): Promise<IpcResult<MusicaDaPasta | null>>
  /** O historico de "ja usada": uma entrada por projeto, gravada ao salvar/renderizar. */
  registrarMusicaUsada(path: string | null, projeto?: string | null): Promise<IpcResult<true>>
  sfxDaEdicaoRapida(): Promise<IpcResult<SfxDaEdicaoRapida>>
  planejarSom(pedido: PedidoDePlanoDeSom): Promise<IpcResult<PlanoDeSom>>
  /** O enquadramento de cada pedaco num lote so: o motor (YOLO de anime) e, sem ele, o detector antigo. */
  rostosDosPedacos(lote: LoteDeRostos): Promise<IpcResult<RostosDoLote>>
  /** Desenha os rotulos (PNG do tamanho do quadro) em <pasta>/textos. Nao gasta nada. */
  textosNaTela(pedido: PedidoDeTextos): Promise<IpcResult<{ pngs: PngDoTexto[]; avisos: string[] }>>
  /** fraseId -> texto de tela da versao `versao` do rascunho. null = rascunho ou versao sumiu. */
  telasDoRascunho(rascunhoId: string, versao: number): Promise<IpcResult<Record<string, string | null> | null>>

  // O motor de personagens (parte 4), com os nomes do Studio.
  /** Se o motor responde (e com qual GPU) e se o AnCut HUB esta instalado. */
  statusDoMotor(): Promise<IpcResult<StatusDoMotor>>
  /** Comeca a analise (corte + personagens) e devolve o jobId na hora. */
  analisarEpisodio(pedido: PedidoDeAnalise): Promise<IpcResult<string>>
  cancelarAnalise(jobId: string): Promise<IpcResult<null>>
  onAnaliseProgresso(listener: (progresso: ProgressoDaAnalise) => void): () => void
  onAnaliseFim(listener: (fim: FimDaAnalise) => void): () => void
  iniciarCorte(pedido: PedidoDeCorte): Promise<IpcResult<EstadoDoCorte>>
  estadoDoCorte(episodioId: string): Promise<IpcResult<EstadoDoCorte | null>>
  /** O2: o corte deste .mkv que nao acabou (CorteParado). null = nada a retomar. */
  corteParado(episodioId: string): Promise<IpcResult<CorteParado | null>>
  cancelarCorte(episodioId: string): Promise<IpcResult<boolean>>
  onCorteProgresso(listener: (evento: EventoDoCorte) => void): () => void
  iniciarDescoberta(pedido: PedidoDaDescoberta): Promise<IpcResult<EstadoDaDescoberta>>
  descobertaAtual(episodioId: string): Promise<IpcResult<EventoDaDescoberta | null>>
  confirmarDescoberta(jobId: string, decisao: DecisaoDaDescoberta): Promise<IpcResult<ResultadoDaDescoberta>>
  /** O2: `manterDecisao` = trocar de episodio (os nomes ja dados ficam no disco); sem ele, Descartar esquece. */
  cancelarDescoberta(jobId: string, manterDecisao?: boolean): Promise<IpcResult<boolean>>
  onDescobertaProgresso(listener: (evento: EventoDaDescoberta) => void): () => void
  /** A1: os animes que batem com o termo, com a capa local. */
  buscarAnime(termo: string): Promise<IpcResult<BuscaDeAnime>>
  /** A1: o elenco do anime escolhido (guarda a escolha; com a descoberta aberta, as sugestoes chegam pelo evento). */
  escolherAnime(pedido: PedidoDeElenco): Promise<IpcResult<ElencoEscolhido>>
  /** O2: grava o que ele decidiu ate agora (os nomes, juntar, ignorar). false = sem grupos na tela. */
  salvarDecisao(episodioId: string, decisao: DecisaoDaDescoberta): Promise<IpcResult<boolean>>
  /** O runtime do motor (Python + torch, instalado pela tela no 1o uso). */
  estadoDoMotorRuntime(): Promise<IpcResult<EstadoDoMotorRuntime>>
  instalarMotorRuntime(pedido: PedidoDeInstalacao): Promise<IpcResult<EstadoDoMotorRuntime>>
  cancelarMotorRuntime(): Promise<IpcResult<null>>
  /** Dialogo de pasta (so com o motor ausente); `padrao` = voltar a pasta padrao. */
  escolherPastaDoMotorRuntime(padrao?: boolean): Promise<IpcResult<EstadoDoMotorRuntime>>
  removerMotorRuntime(): Promise<IpcResult<EstadoDoMotorRuntime>>
  onMotorRuntime(listener: (estado: EstadoDoMotorRuntime) => void): () => void

  // Trazer do AniRecap Studio (parte 5): so le o Studio, nunca sobrescreve o Dangai.
  /** Ha perfil do Studio neste PC? (a secao so mostra o botao com dado dele) */
  acharStudio(): Promise<IpcResult<StudioAchado>>
  trazerDoStudio(pedidoId: string): Promise<IpcResult<ResumoDaMigracao>>
  cancelarTrazer(pedidoId: string): Promise<IpcResult<boolean>>
  onTrazerProgresso(listener: (progresso: ProgressoDaMigracao) => void): () => void
}
