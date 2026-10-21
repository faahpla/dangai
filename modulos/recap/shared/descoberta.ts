import { z } from 'zod'
import { etapaDaAnaliseSchema, temPlanos, type EpisodeIndex, type EstadoDoCorte, type EtapaDaAnalise } from './episodio'
import { fichasDoNome } from '@shared/nomes'

/**
 * RECONHECER NA MAO (pedido do Levi, 15/10): o Modo Descoberta do AnCut HUB
 * dentro do passo 1.
 *
 * QUANDO: o reconhecimento automatico precisa de 2+ fotos por personagem. Com
 * o Jikan bloqueado na rede dele, a AniList da 1 foto, o Corte Cenas nao tem o
 * anime, e o motor para em 'sem-referencias' (ou 'anime-nao-encontrado'). Nos
 * animes novos a cena fica sem personagem (Nia Liston S01E01: 432 cenas, 0
 * personagens). Aqui o motor AGRUPA os rostos do episodio por semelhanca, o
 * Levi da nome a cada grupo e essas fotos viram REFERENCIA no banco do motor
 * do Studio: no proximo episodio do mesmo anime o reconhecimento automatico
 * funciona sozinho.
 *
 * O MOTOR JA FAZ (motor/app/headless.py `_run` com `discovery: true` +
 * `_discovery_naming_round`; motor/app/pipeline.py `run_discovery` e
 * `commit_discovery`). Nada muda no Python:
 *   1. `run` com `discovery: true`: corta (reaproveita o corte que ja esta no
 *      disco), detecta e embeda os rostos, agrupa, e grava ate 8 recortes por
 *      grupo em <pasta do episodio>/metadata/discovery/gNNN_MMM.jpg (apaga os
 *      da rodada anterior).
 *   2. evento `discovery-ready` (formato em discoveryReadyDoMotorSchema). O
 *      processo fica VIVO segurando os embeddings em memoria, sem timeout.
 *   3. o host manda UMA linha no stdin:
 *      {"cmd":"commit-discovery","names":{"0":"Nia Liston"},"removed":{"0":[2]}}
 *      ou {"cmd":"cancel"}.
 *   4. o motor cria os personagens, atribui as cenas, grava as fotos como
 *      auto_disc_NN.jpg (ate 10 por nome) em <dados>/cache/anime_db/<anime>/
 *      characters/<nome>/, regrava shots.json/characters.json e manda `done`
 *      (o mesmo _result_payload do run normal).
 *
 * "JUNTAR" NAO EXISTE NO MOTOR. Dois grupos com o MESMO nome viram um
 * personagem so (commit_discovery: `by_name`). Entao a decisao da tela tem
 * `juntar`, e o main traduz cada conjunto em "o mesmo nome em todos os grupos
 * dele" (paraOMotor, abaixo). Grupo sem nome = ignorado (o motor pula). Nome
 * vazio para TODOS os grupos faz o motor lancar e o processo MORRER: por isso
 * o main confere com paraOMotor antes de mandar, e a descoberta nunca se perde
 * por uma decisao vazia.
 *
 * QUANDO A TELA OFERECE (podeReconhecerNaMao, abaixo): so com o motor do
 * Studio e na biblioteca do Studio. Tres casos:
 *   - o corte em segundo plano parou em 'sem-referencias' ou
 *     'anime-nao-encontrado' (indice sem planos): [Reconhecer na mao] corta
 *     (se ainda nao cortou) e agrupa; no fim os planos chegam ao indice como
 *     no fim de um corte;
 *   - cenas cortadas sem nenhum personagem (o "Cortar sem personagens"): o
 *     mesmo botao, ao lado do "Reconhecer agora";
 *   - episodio ja reconhecido: "Revisar personagens", discreto. A descoberta
 *     refaz a atribuicao do episodio inteiro (os grupos ja batizados em outro
 *     episodio chegam com nome, `conhecido`).
 *
 * TEMPO: o indice e o shots.json so mudam no commit. Cancelar a qualquer
 * momento deixa o indice como estava (o motor so limpa as linhas do episodio
 * no index.db PROPRIO dele, que o Studio nao le).
 *
 * Funcoes puras: rodam igual no main, no renderer e nos testes. Os tipos
 * saem de z.infer, como em episodio.ts; channels.ts importa so TIPOS daqui.
 */

// ===================================================================== numeros

/** A1: quantas sugestoes de nome por grupo (as teclas 1-9). */
export const SUGESTOES_MAX = 9

/** O motor grava ate 8 recortes por grupo (`reps[:8]` em run_discovery). */
export const ROSTOS_POR_GRUPO_MAX = 8
/** Ate 10 fotos viram referencia por NOME (commit_discovery), somando os grupos juntados. */
export const REFS_POR_PERSONAGEM_MAX = 10
/**
 * Espelho de config.min_shots_per_character (motor/app/config.py, padrao 4):
 * o _finalize_episode TIRA o personagem que ficou com menos cenas que isso.
 * So para o aviso da tela; quem decide e o motor.
 */
export const CENAS_MINIMAS_POR_PERSONAGEM = 4
/** Nome de personagem: depois do limparNome, no maximo isto. */
export const NOME_MAX = 80
/**
 * O processo da descoberta segura a vaga do motor (e a GPU) enquanto espera os
 * nomes. Sem nenhuma confirmacao em 60 min o main cancela: os cortes de outros
 * episodios esperam na fila por ele. Refazer e rapido (corte e rostos em cache).
 */
export const ESPERA_MAXIMA_DOS_NOMES_MS = 60 * 60_000
/**
 * O commit leva segundos (auditoria de 15/10: ~2 s) e o motor narra cada passo.
 * Sem NENHUM sinal do motor nesse prazo, o main mata o processo e libera a vaga:
 * antes, um motor travado deixava a tela em "Salvando..." para sempre.
 */
export const PRAZO_DO_SALVAR_MS = 3 * 60_000
/** Mudo ha tanto tempo no 'salvando', a tela oferece "Parar" (o main confere de novo). */
export const MUDO_PARA_PARAR_MS = 30_000
/**
 * Abaixo disto o palpite do motor e so dica cinza e o Enter NAO aceita. Medido
 * na auditoria de 15/10: os palpites errados vinham com 0,90 a 0,94 (a mesma
 * faixa dos certos), e os conhecidos certos com 1,00.
 */
export const SIMILARIDADE_FORTE = 0.96
/**
 * O `fotosDoElenco` de uma analise em que algum personagem so foi reconhecido
 * porque as fotos do Reconhecer na mao completaram as 2 do minimo: a tela pede
 * para conferir (no E02 do Nia Liston, Bendelio e Neil erraram muito).
 */
export const ORIGEM_DO_BATISMO = 'Reconhecer na mao'
/**
 * O `fotosDoElenco` de uma analise em que algum reconhecido so tinha UMA arte
 * no catalogo: o retrato do MyAnimeList e o da AniList costumam ser a mesma
 * imagem em dois recortes, e as duas passam do minimo de 2 fotos como se
 * fossem duas (electron/services/descoberta/arte-unica.ts). No E02 do Nia
 * Liston (15/10) o Anzel assim errou 7 de 13 cenas e o Gandolf 2 de 4. A tela
 * pede para conferir, com os nomes: e o prefixo seguido dos nomes do motor
 * separados por SEPARADOR_DE_UMA_ARTE (os nomes do MAL ja tem virgula).
 */
export const PREFIXO_DE_UMA_ARTE = 'Uma arte so: '
const SEPARADOR_DE_UMA_ARTE = '; '

export function origemDeUmaArte(nomes: readonly string[]): string {
  return PREFIXO_DE_UMA_ARTE + nomes.join(SEPARADOR_DE_UMA_ARTE)
}

/** Os nomes do aviso de uma arte so, ou null quando o `fotosDoElenco` e outra coisa. */
export function nomesDeUmaArte(fotosDoElenco: string | null | undefined): string[] | null {
  if (!fotosDoElenco?.startsWith(PREFIXO_DE_UMA_ARTE)) return null
  const nomes = fotosDoElenco.slice(PREFIXO_DE_UMA_ARTE.length).split(SEPARADOR_DE_UMA_ARTE).filter(Boolean)
  return nomes.length ? nomes : null
}

// =========================================================== protocolo do motor
// So o main usa. Os nomes sao os do Python (camelCase do headless.py), sem
// traducao: um campo renomeado aqui e um campo que some calado.
//
// ATENCAO: o tipo NeedsInputEvent do AnCut HUB (src/shared/types.ts) declara
// requestId/payload/'discovery-groups', que o Python NAO manda. Vale o Python.

/** Um grupo do `discovery-ready` (headless._discovery_naming_round). */
export const grupoDoMotorSchema = z.object({
  key: z.number().int().nonnegative(),
  /** Rostos (recortes) no grupo inteiro. */
  faces: z.number().int().nonnegative(),
  /** Cenas em que o grupo aparece. A lista ja vem ordenada por isto, do maior ao menor. */
  shots: z.number().int().nonnegative(),
  /** Figurante: menos de 3 cenas, ou mais nuca/cabelo do que rosto. Nunca true num `known`. */
  minor: z.boolean().default(false),
  /**
   * Recortes RELATIVOS a episodeRoot ('metadata/discovery/g000_000.jpg'), ate 8.
   * O indice nesta lista e o indice que volta em `removed`.
   */
  crops: z.array(z.string()),
  /** '' = sem palpite. Com `known`, e o nome batizado em outro episodio. */
  suggestedName: z.string().default(''),
  suggestedSim: z.number().default(0),
  /** Reconhecido com folga (face_clustering.reconhece): o nome vem preenchido. */
  known: z.boolean().default(false),
  /** A1: os nomes mais parecidos (ate 9), do mais ao menos. As teclas 1-9 da tela. */
  suggestions: z.array(z.object({ name: z.string(), sim: z.number() })).default([]),
})
export type GrupoDoMotor = z.infer<typeof grupoDoMotorSchema>

/** O evento `discovery-ready`, inteiro. */
export const discoveryReadyDoMotorSchema = z.object({
  type: z.literal('discovery-ready'),
  episodeRoot: z.string().min(1),
  /** O titulo resolvido (AniList) ou, offline, o nome digitado. */
  animeTitle: z.string(),
  season: z.number().int(),
  episode: z.number().int(),
  totalFaces: z.number().int().nonnegative(),
  /** O anime resolveu online: as fotos entram no banco REAL (al<id>) e o roster e o elenco oficial. */
  online: z.boolean(),
  /** Nomes do elenco (AniList), ou os do banco local quando offline. Sem fotos. */
  roster: z.array(z.string()),
  groups: z.array(grupoDoMotorSchema),
  /** O1: os grupos foram gravados no disco (descoberta.json): o processo sai sem esperar nomes. */
  saved: z.string().optional(),
})
export type DiscoveryReadyDoMotor = z.infer<typeof discoveryReadyDoMotorSchema>

/** A linha que o main escreve no stdin do processo vivo. Chaves = String(key). */
export interface ComandoCommitDiscovery {
  cmd: 'commit-discovery'
  names: Record<string, string>
  removed: Record<string, number[]>
}

// ================================================================== a tela

/** Por que a descoberta foi aberta. So muda o texto da tela. */
export const motivoDaDescobertaSchema = z.enum([
  /** O corte parou: o anime nao foi achado na AniList/MAL. */
  'anime-nao-encontrado',
  /** O corte parou: ninguem do elenco com 2+ fotos. */
  'sem-referencias',
  /** Cenas cortadas sem nenhum personagem ("Cortar sem personagens"). */
  'sem-personagens',
  /** Episodio ja reconhecido: "Revisar personagens". */
  'revisar',
])
export type MotivoDaDescoberta = z.infer<typeof motivoDaDescobertaSchema>

/** Um personagem sem nome achado pelo agrupamento. O que a grade mostra. */
export const grupoDeRostosSchema = z.object({
  /** A `key` do motor. Estavel durante a sessao; e a chave de tudo na decisao. */
  key: z.number().int().nonnegative(),
  /**
   * URLs dos recortes (servidor de midia local, como as miniaturas), na ordem
   * do motor: o i daqui e o i de `removidos`. Ate ROSTOS_POR_GRUPO_MAX. O main
   * publica uma COPIA por job (<userData>/motor/descoberta/<jobId>/): o motor
   * reusa os mesmos nomes de arquivo a cada rodada, e a mesma URL mostraria o
   * rosto da rodada anterior.
   */
  rostos: z.array(z.string()),
  /** Rostos no grupo inteiro (`faces`), nao so os mostrados. */
  totalDeRostos: z.number().int().nonnegative(),
  /** Em quantas cenas o grupo aparece (`shots`). */
  cenas: z.number().int().nonnegative(),
  /**
   * Os planos (ids do indice, '0025') em que o grupo aparece. O motor de hoje
   * NAO manda (o discovery-ready nao tem as posicoes): ausente. Fica previsto
   * para um "ver as cenas do grupo" futuro, com uma mudanca [Studio] no headless.
   */
  planoIds: z.array(z.string()).optional(),
  /**
   * O palpite do motor. Com `conhecido`, e o nome certo (vem preenchido). Sem,
   * e so a dica "parece X" (similaridade >= 0,90 contra fotos fracas): botao,
   * nunca campo preenchido. null = sem palpite.
   */
  sugestao: z.object({ nome: z.string().min(1), similaridade: z.number() }).nullable(),
  /**
   * A1: os nomes mais parecidos com o grupo (ate SUGESTOES_MAX, do mais ao
   * menos), do elenco e dos ja batizados. As teclas 1-9 escolhem daqui.
   * Vazio = sem elenco (digitar).
   */
  sugestoes: z.array(z.object({ nome: z.string().min(1), similaridade: z.number() })).default([]),
  /** Batizado em outro episodio (`known`): a decisao inicial ja traz o nome. */
  conhecido: z.boolean(),
  /** Figurante (`minor`): fica atras do "Figurantes (N)"; sem nome, e ignorado. */
  figurante: z.boolean(),
})
export type GrupoDeRostos = z.infer<typeof grupoDeRostosSchema>

/** Um nome do elenco para a sugestao. A AniList manda o nome mesmo sem foto. */
export const elencoDaDescobertaSchema = z.object({
  /** EXATAMENTE como a fonte escreve: escolher daqui grava este texto, sem mexer. */
  nome: z.string().min(1),
  /** URL da foto pequena que o motor ja baixou (anime_db), ou null. */
  foto: z.string().nullable(),
})
export type ElencoDaDescoberta = z.infer<typeof elencoDaDescobertaSchema>

/** Os grupos chegaram: a tela de nomes. */
export const descobertaProntaSchema = z.object({
  episodioId: z.string().regex(/^ep_[0-9a-f]{40}$/),
  jobId: z.string().min(1),
  /** O titulo do anime como o motor resolveu (`animeTitle`). */
  anime: z.string(),
  temporada: z.number().int(),
  episodio: z.number().int(),
  /** Achou o anime online: o elenco e o oficial e as fotos reforcam o banco real. */
  online: z.boolean(),
  totalDeRostos: z.number().int().nonnegative(),
  /** Na ordem do motor: mais cenas primeiro. */
  grupos: z.array(grupoDeRostosSchema),
  /** O roster do motor com foto quando houver. Vazio = digitar o nome. */
  elenco: z.array(elencoDaDescobertaSchema),
  /** A pasta do episodio (`episodeRoot`). So para o log e o "Abrir pasta". */
  pastaDoEpisodio: z.string(),
})
export type DescobertaPronta = z.infer<typeof descobertaProntaSchema>

// ================================================================= a decisao

const chaveDeGrupoSchema = z.string().regex(/^\d{1,5}$/)

/**
 * O que o Levi decidiu na tela. renderer -> main (confirmarDescoberta), conferido
 * por zod no ipc.ts e traduzido por paraOMotor no main.
 *
 * - nomes: String(key) -> nome como digitado ('' ou ausente = sem nome).
 * - ignorados: keys marcadas "ignorar" (figurante, rosto errado). Ganham de
 *   qualquer nome e saem de qualquer `juntar`.
 * - juntar: conjuntos de keys que sao o MESMO personagem. O nome do conjunto e
 *   o primeiro nome nao vazio na ordem do conjunto (o 1o e o "dono"). Vira o
 *   mesmo nome em todos os grupos dele.
 * - removidos: String(key) -> indices de `rostos` que NAO sao daquele
 *   personagem (rosto alheio infiltrado). Nao viram referencia; as cenas do
 *   grupo continuam atribuidas.
 */
export const decisaoDaDescobertaSchema = z.object({
  nomes: z.record(chaveDeGrupoSchema, z.string().max(400)),
  ignorados: z.array(z.number().int().nonnegative()).max(5000),
  juntar: z.array(z.array(z.number().int().nonnegative()).min(2).max(500)).max(2500),
  removidos: z.record(chaveDeGrupoSchema, z.array(z.number().int().nonnegative()).max(64)).default({}),
})
export type DecisaoDaDescoberta = z.infer<typeof decisaoDaDescobertaSchema>

/** renderer -> main: comecar a descoberta deste episodio. */
export const pedidoDaDescobertaSchema = z.object({
  episodioId: z.string().regex(/^ep_[0-9a-f]{40}$/),
  /**
   * O nome corrigido na tela (o campo do anime), para achar o elenco e
   * sugerir nomes. Ausente = o do indice. A pasta das cenas NAO muda: com
   * cenas no disco o main manda a pasta do anime como `outputFolder`.
   */
  anime: z.string().trim().min(1).max(200).optional(),
})
export type PedidoDaDescoberta = z.infer<typeof pedidoDaDescobertaSchema>

// ===================================================== A1: buscar o elenco

/**
 * "BUSCAR ELENCO" (A1, pedido do Levi em 18/10): ele digita o nome do anime,
 * escolhe da lista (com a capa) e o elenco do anime escolhido vira o elenco da
 * tela: as fotos, as sugestoes de nome dos grupos e, nas proximas analises, o
 * reconhecimento automatico (a escolha fica guardada para este nome no motor).
 * O motor busca na AniList, no site do MyAnimeList (sem o Jikan) e na Kitsu
 * (motor/app/providers/busca_anime.py).
 */
export const candidatoDeAnimeSchema = z.object({
  fonte: z.string(),
  titulo: z.string().min(1),
  tituloIngles: z.string().nullable(),
  anilistId: z.number().int().positive().nullable(),
  malId: z.number().int().positive().nullable(),
  kitsuId: z.number().int().positive().nullable(),
  ano: z.number().int().nullable(),
  formato: z.string().nullable(),
  /** A capa no servidor de midia local (a tela so mostra imagem local), ou null. */
  capa: z.string().nullable(),
  /** 0..1: o quanto o titulo bate com o que ele digitou. */
  nota: z.number(),
})
export type CandidatoDeAnime = z.infer<typeof candidatoDeAnimeSchema>

/** O que a busca devolve para a tela. `avisos`: fonte fora do ar, em ASCII. */
export interface BuscaDeAnime {
  termo: string
  candidatos: CandidatoDeAnime[]
  avisos: string[]
}

/** renderer -> main: ele escolheu este anime para o elenco do episodio. */
export const pedidoDeElencoSchema = z.object({
  episodioId: z.string().regex(/^ep_[0-9a-f]{40}$/),
  /** O nome do anime como as analises chamam (o campo do passo 1, ou o do indice). */
  anime: z.string().trim().min(1).max(200),
  escolha: candidatoDeAnimeSchema.pick({ fonte: true, titulo: true, tituloIngles: true, anilistId: true, malId: true, kitsuId: true }),
})
export type PedidoDeElenco = z.infer<typeof pedidoDeElencoSchema>

/** O elenco montado. */
export interface ElencoEscolhido {
  /** O titulo do anime na fonte. */
  titulo: string
  /** Quantos personagens o elenco tem (com os batizados juntados). */
  personagens: number
  /** Os nomes batizados antes (banco local) que entraram no elenco. */
  juntados: string[]
  /** Os grupos da tela ganharam sugestoes novas. */
  comSugestoes: boolean
}

/** A1: as sugestoes do motor ({name, sim}) no formato da tela, sem repetir nome, ate SUGESTOES_MAX. */
export function sugestoesDoMotor(lista: readonly { name: string; sim: number }[] | undefined): { nome: string; similaridade: number }[] {
  const vistos = new Set<string>()
  const saida: { nome: string; similaridade: number }[] = []
  for (const s of lista ?? []) {
    const nome = s.name.trim()
    if (!nome || vistos.has(nome) || !Number.isFinite(s.sim)) continue
    vistos.add(nome)
    saida.push({ nome, similaridade: s.sim })
    if (saida.length >= SUGESTOES_MAX) break
  }
  return saida
}

// ============================================================ estado e eventos

/**
 * agrupando: o motor esta (cortando e) agrupando os rostos. pronta: os grupos
 * estao na tela, o processo espera os nomes. salvando: o commit rodando.
 * feita: personagens nas cenas e fotos no banco. falhou / cancelada: o indice
 * ficou como estava.
 */
export const statusDaDescobertaSchema = z.enum(['agrupando', 'pronta', 'salvando', 'feita', 'falhou', 'cancelada'])
export type StatusDaDescoberta = z.infer<typeof statusDaDescobertaSchema>

export const estadoDaDescobertaSchema = z.object({
  episodioId: z.string(),
  /** O job do motor.ts. null so antes de o processo subir. */
  jobId: z.string().nullable(),
  motivo: motivoDaDescobertaSchema,
  status: statusDaDescobertaSchema,
  /** A etapa do motor (etapaDoEstagio). null fora do 'agrupando'/'salvando'. */
  etapa: etapaDaAnaliseSchema.nullable(),
  /** 0..1 da rodada inteira (progressoDaDescoberta). null = indeterminado. */
  progresso: z.number().min(0).max(1).nullable(),
  /** Frase curta, ASCII ("Agrupando 1204 rostos..."). '' = nada. */
  mensagem: z.string(),
  /** Por que falhou, ASCII e curto. null fora do 'falhou'. */
  erro: z.string().nullable(),
  /** O erro cru do motor (stderr, em ingles), so para o tooltip. O log tem o resto. */
  detalhe: z.string().nullable().optional(),
  /** O episodio ainda nao tinha cenas: o motor corta antes de agrupar (minutos, nao segundos). */
  comCorte: z.boolean(),
  /** ISO de quando comecou. */
  inicio: z.string(),
  atualizadoEm: z.string(),
})
export type EstadoDaDescoberta = z.infer<typeof estadoDaDescobertaSchema>

/** O que o commit deixou. main -> renderer (resposta do confirmarDescoberta e evento 'feita'). */
export interface ResultadoDaDescoberta {
  episodioId: string
  jobId: string
  /** Do shots.json regravado (o que o indice tem agora), do mais frequente ao menos. */
  personagens: { nome: string; cenas: number }[]
  cenasComPersonagem: number
  totalCenas: number
  /** Fotos gravadas como referencia (auto_disc_NN.jpg), somando os nomes. */
  refsSalvas: number
  /** A pasta characters/ do banco do anime no motor (o `refsDir` do done). null = nao veio. */
  pastaDasReferencias: string | null
  /** Nomes dados que o motor tirou por ter menos de CENAS_MINIMAS_POR_PERSONAGEM cenas. */
  descartados: string[]
  /** ASCII, para a tela. */
  avisos: string[]
  /** O tempo da rodada inteira (agrupar + nomes + salvar), em segundos. */
  segundos: number
  /** O indice novo, ja gravado (o mesmo que vai no corteProgresso). */
  indice: EpisodeIndex
}

/**
 * main -> renderer (canal descobertaProgresso), a cada mudanca. Tambem e a
 * resposta do descobertaAtual (a tela reabrindo com o processo ainda vivo).
 */
export interface EventoDaDescoberta {
  episodioId: string
  estado: EstadoDaDescoberta
  /** So no 'pronta' (e enquanto ele durar no descobertaAtual). */
  pronta: DescobertaPronta | null
  /** So no 'feita'. */
  resultado: ResultadoDaDescoberta | null
  /**
   * O2: com `pronta`, o que ele ja tinha decidido nestes grupos e ficou gravado
   * (o app fechou no meio). A tela reaplica nos grupos iguais (reaplicarDecisao).
   */
  decisaoSalva?: DecisaoGuardada | null
}

export const ROTULO_DO_STATUS_DA_DESCOBERTA: Record<StatusDaDescoberta, string> = {
  agrupando: 'Agrupando rostos',
  pronta: 'Grupos prontos',
  salvando: 'Salvando',
  feita: 'Personagens salvos',
  falhou: 'Parou',
  cancelada: 'Cancelada',
}

/** Status em que o processo do motor esta vivo (segura a vaga do motor). */
export function descobertaViva(estado: Pick<EstadoDaDescoberta, 'status'> | null | undefined): boolean {
  return !!estado && (estado.status === 'agrupando' || estado.status === 'pronta' || estado.status === 'salvando')
}

// ======================================================== quando oferecer

export interface OfertaDaDescoberta {
  pode: boolean
  /** null quando nao pode. */
  motivo: MotivoDaDescoberta | null
  /** Por que nao pode, ASCII (tooltip). '' quando pode. */
  porque: string
}

/**
 * Cenas de outra biblioteca: nem o "Reconhecer agora" nem o "na mao" rodam aqui.
 * (21/10) Antes cada um mandava para o outro, e o passo 4 ficava com um botao
 * que nao clicava. O caminho e o AnCut, que reconhece as cenas dele.
 */
export const SO_NO_ANCUT = 'Cenas do AnCut: o recap so le. Reconheca os personagens no AnCut e volte.'

/**
 * A tela mostra [Reconhecer na mao] / "Revisar personagens"? O main confere de
 * novo com o indice lido do disco (a mesma funcao) antes de subir o motor.
 *
 * - cenas de outra biblioteca (AnCut, Corte Cenas): nao. O Studio nunca grava
 *   la, e a descoberta regrava shots.json;
 * - sem cenas: so com o corte parado pedindo o elenco (corte.descoberta);
 * - cenas do Studio sem personagem nenhum: 'sem-personagens';
 * - cenas do Studio com personagens: 'revisar'.
 *
 * `corte` e o estado que a tela tem (useGerar.corte) ou o do indice. Cortando
 * ou na fila: nao (o corte regravaria o resultado por cima).
 */
export function podeReconhecerNaMao(
  indice: Pick<EpisodeIndex, 'planos' | 'biblioteca' | 'corte'>,
  corte: Pick<EstadoDoCorte, 'status' | 'descoberta' | 'mensagem'> | null,
): OfertaDaDescoberta {
  const nao = (porque: string): OfertaDaDescoberta => ({ pode: false, motivo: null, porque })
  const c = corte ?? indice.corte ?? null
  if (c && (c.status === 'cortando' || (c.status === 'pendente' && (c.mensagem === 'Na fila' || c.mensagem === 'Esperando o motor')))) {
    return nao('Espere o corte das cenas acabar.')
  }
  if (!temPlanos(indice)) {
    if (c?.status === 'falhou' && c.descoberta) return { pode: true, motivo: c.descoberta, porque: '' }
    return nao('As cenas ainda nao foram cortadas.')
  }
  if (indice.biblioteca.origem !== 'studio') {
    return nao(SO_NO_ANCUT)
  }
  const algum = indice.planos.some((p) => p.personagens.length > 0)
  return { pode: true, motivo: algum ? 'revisar' : 'sem-personagens', porque: '' }
}

// ========================================================== andamento

/**
 * Fatias de cada etapa na rodada inteira, na ordem do run_discovery:
 * parse -> detect_shots -> cut_shots -> fetch_characters -> download_refs ->
 * embed_refs -> analyze_shots (por cena) -> organize (agrupar). Com o corte no
 * disco, detectar/cortar vem do cache em segundos e o grosso e achar e embedar
 * os rostos (a 1a vez: o corte sem personagens nao calcula rosto nenhum).
 */
const FATIAS_COM_CORTE: Record<EtapaDaAnalise, [number, number]> = {
  preparando: [0, 0.02],
  detectando: [0.02, 0.25],
  cortando: [0.25, 0.55],
  elenco: [0.55, 0.6],
  personagens: [0.6, 0.92],
  organizando: [0.92, 1],
}
const FATIAS_SEM_CORTE: Record<EtapaDaAnalise, [number, number]> = {
  preparando: [0, 0.03],
  detectando: [0.03, 0.06],
  cortando: [0.06, 0.12],
  elenco: [0.12, 0.2],
  personagens: [0.2, 0.9],
  organizando: [0.9, 1],
}

/** O andamento da rodada (0..1) pela etapa e pela fracao dentro dela. null na fracao = comeco da etapa. */
export function progressoDaDescoberta(etapa: EtapaDaAnalise, fracao: number | null, comCorte: boolean): number {
  const [de, ate] = (comCorte ? FATIAS_COM_CORTE : FATIAS_SEM_CORTE)[etapa]
  const f = fracao === null || !Number.isFinite(fracao) ? 0 : Math.min(1, Math.max(0, fracao))
  return Math.round((de + (ate - de) * f) * 1000) / 1000
}

// ====================================================== editar a decisao
// Todas puras e imutaveis: devolvem uma decisao nova. A store da tela so chama.

/** Sem espacos sobrando, sem caractere de controle, ate NOME_MAX. */
export function limparNome(nome: string): string {
  return nome
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOME_MAX)
    .trim()
}

function chave(key: number): string {
  return String(key)
}

/** O conjunto de juntar em que a key esta, ou null. */
export function conjuntoDe(decisao: Pick<DecisaoDaDescoberta, 'juntar'>, key: number): number[] | null {
  return decisao.juntar.find((c) => c.includes(key)) ?? null
}

/**
 * A decisao com que a tela abre: os `conhecido` com o nome do motor; o resto
 * vazio (figurante tambem: sem nome ja e ignorado). Nada juntado, nada tirado.
 */
export function decisaoInicial(pronta: Pick<DescobertaPronta, 'grupos'>): DecisaoDaDescoberta {
  const nomes: Record<string, string> = {}
  for (const g of pronta.grupos) {
    if (g.conhecido && g.sugestao) nomes[chave(g.key)] = g.sugestao.nome
  }
  return { nomes, ignorados: [], juntar: [], removidos: {} }
}

/**
 * Da nome ao grupo. Num conjunto juntado, o nome vale para o conjunto inteiro
 * (todos os grupos dele recebem o mesmo texto). Dar nome tira o "ignorar" do
 * grupo nomeado (so dele: um irmao ignorado do conjunto continua ignorado).
 */
export function nomearGrupo(decisao: DecisaoDaDescoberta, key: number, nome: string): DecisaoDaDescoberta {
  const alvo = conjuntoDe(decisao, key) ?? [key]
  const nomes = { ...decisao.nomes }
  for (const k of alvo) nomes[chave(k)] = nome
  const ignorados = nome.trim() ? decisao.ignorados.filter((k) => k !== key) : decisao.ignorados
  return { ...decisao, nomes, ignorados }
}

/**
 * Marca (ou desmarca) "ignorar". O nome e o conjunto juntado FICAM na decisao:
 * o botao e um liga/desliga, e um clique errado nao pode apagar o trabalho
 * (auditoria de 15/10). Quem le a decisao (resumoDaDecisao, paraOMotor) trata o
 * ignorado como sem nome e fora de qualquer conjunto.
 */
export function ignorarGrupo(decisao: DecisaoDaDescoberta, key: number, ignorar: boolean): DecisaoDaDescoberta {
  if (!ignorar) return { ...decisao, ignorados: decisao.ignorados.filter((k) => k !== key) }
  if (decisao.ignorados.includes(key)) return decisao
  return { ...decisao, ignorados: [...decisao.ignorados, key] }
}

/**
 * Junta o grupo `de` ao grupo `em` (o mesmo personagem). Os dois conjuntos
 * viram um, com o de `em` na frente (o dono). O nome do conjunto e o primeiro
 * nao vazio, e todos passam a ter ele. Juntar tira o "ignorar" dos dois.
 */
export function juntarGrupos(decisao: DecisaoDaDescoberta, de: number, em: number): DecisaoDaDescoberta {
  if (de === em) return decisao
  const cEm = conjuntoDe(decisao, em) ?? [em]
  const cDe = conjuntoDe(decisao, de) ?? [de]
  if (cEm.includes(de)) return decisao
  const unido = [...cEm, ...cDe.filter((k) => !cEm.includes(k))]
  const juntar = [...decisao.juntar.filter((c) => !c.includes(em) && !c.includes(de)), unido]
  const nome = unido.map((k) => (decisao.nomes[chave(k)] ?? '').trim()).find((n) => n !== '') ?? ''
  const nomes = { ...decisao.nomes }
  for (const k of unido) {
    if (nome) nomes[chave(k)] = nome
    else delete nomes[chave(k)]
  }
  const ignorados = decisao.ignorados.filter((k) => !unido.includes(k))
  return { ...decisao, nomes, ignorados, juntar }
}

/** Tira o grupo do conjunto em que esta. Ele volta sem nome (era "o mesmo"; agora e outro). */
export function separarGrupo(decisao: DecisaoDaDescoberta, key: number): DecisaoDaDescoberta {
  if (!conjuntoDe(decisao, key)) return decisao
  const nomes = { ...decisao.nomes }
  delete nomes[chave(key)]
  const juntar = decisao.juntar.map((c) => c.filter((k) => k !== key)).filter((c) => c.length >= 2)
  return { ...decisao, nomes, juntar }
}

/** Tira (ou devolve) o recorte `indice` do grupo: "esse rosto nao e dele". */
export function alternarRosto(decisao: DecisaoDaDescoberta, key: number, indice: number): DecisaoDaDescoberta {
  const atual = decisao.removidos[chave(key)] ?? []
  const lista = atual.includes(indice) ? atual.filter((i) => i !== indice) : [...atual, indice].sort((a, b) => a - b)
  const removidos = { ...decisao.removidos }
  if (lista.length) removidos[chave(key)] = lista
  else delete removidos[chave(key)]
  return { ...decisao, removidos }
}

// =================================================== resumo e traducao

/** Um personagem como vai sair do commit (previa; o numero final vem do shots.json). */
export interface PersonagemDaDecisao {
  /** O nome que vai ao motor: a grafia do elenco quando bate (grafiasDaDecisao). */
  nome: string
  /** Os grupos que viram este personagem, na ordem (o 1o e o dono). */
  keys: number[]
  /**
   * Soma das cenas dos grupos. APROXIMADO: dois grupos podem dividir uma cena
   * (o motor conta uma vez). Serve para o aviso de poucas cenas.
   */
  cenas: number
  /** Fotos que viram referencia (recortes menos os removidos, ate REFS_POR_PERSONAGEM_MAX). */
  refs: number
}

/** Um nome dado que nao e do elenco (com elenco na tela): a tela pergunta antes de confirmar. */
export interface ForaDoElenco {
  nome: string
  keys: number[]
  /** O nome do elenco que ele provavelmente queria ("lyn" -> "Lynette Blanc"), ou null. */
  parece: string | null
}

export interface ResumoDaDecisao {
  personagens: PersonagemDaDecisao[]
  /** Keys que o motor vai pular: ignoradas, sem nome ou figurante sem nome. */
  ignorados: number[]
  /** Dessas, as que nao sao figurante nem foram marcadas "ignorar": o "N sem nome" da tela. */
  semNome: number[]
  /** Dessas, os figurantes sem nome e nao marcados (os que o motor ja pularia sozinho). */
  figurantes: number[]
  /** Dessas, as marcadas "ignorar". */
  marcados: number[]
  /**
   * Nomes que nao sao do elenco nem conhecidos de outro episodio. Vazio sem
   * elenco (offline, ou o roster nao veio): ai qualquer nome vale.
   */
  foraDoElenco: ForaDoElenco[]
  /** ASCII, para a tela (poucas cenas, sem foto, fora do elenco). */
  avisos: string[]
  /** Por que nao da para confirmar, ASCII. null = da. */
  erro: string | null
}

/** O que resumoDaDecisao precisa de cada grupo (o conhecido so para o "fora do elenco"). */
export type GrupoDoResumo = Pick<GrupoDeRostos, 'key' | 'cenas' | 'rostos' | 'figurante'> &
  Partial<Pick<GrupoDeRostos, 'conhecido' | 'sugestao'>>

export interface OpcoesDoResumo {
  /** Os nomes do elenco (DescobertaPronta.elenco), exatos como a fonte escreve. */
  elenco?: readonly string[]
}

/** A frase do erro de decisao vazia (a tela compara para limpar o aviso velho). */
export const ERRO_SEM_NOME = 'De nome a pelo menos um personagem.'

/**
 * A chave de pessoa do nome: as palavras sem acento, ordenadas ("Liston, Nia"
 * == "nia liston"). A tela usa para marcar "junta" no elenco.
 */
export function chaveDaPessoa(nome: string): string {
  const f = fichasDoNome(nome)
  // Nome sem nenhuma letra latina (kanji, so simbolos): a pessoa e o texto mesmo.
  return f.length ? f.join(' ') : `#${nome.toLocaleLowerCase('en')}`
}

/** Para o "parece": sem acento, minusculo, so letras e numeros separados por espaco. */
function textoNormal(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * A GRAFIA de cada nome dado: nome limpo -> o nome que vai ao motor. A mesma
 * regra do motor (motor/app/naming.py, find_token_match) e do canonizar do
 * indice, aplicada ANTES de mandar -- sem ela "Nia" num grupo e "Nia Liston"
 * noutro iam como dois personagens, as fotos dos dois caiam na mesma pasta do
 * banco e se sobrescreviam (auto_disc_00 recomeca por nome), e o resultado
 * acusava um falso "ficou de fora".
 *
 *   1. mesmas palavras (caixa, acento, ordem, virgula) = mesma pessoa; a
 *      grafia do ELENCO ganha, senao a 1a dada (ordem dos grupos);
 *   2. nome curto contido em UM nome maior so: vira o maior. Primeiro entre
 *      os nomes dados ("Nia" + "Nia Liston"), depois no elenco ("Neil" ->
 *      "Neil Liston"). Cabendo em dois ("Liston": Nia e Neil), fica como esta.
 */
export function grafiasDaDecisao(nomes: readonly string[], elenco: readonly string[] = []): Map<string, string> {
  const doElenco = new Map<string, string>()
  const fichasDoElenco = new Map<string, string[]>()
  for (const e of elenco) {
    const nome = e.trim()
    if (!nome) continue
    const k = chaveDaPessoa(nome)
    if (!doElenco.has(k)) doElenco.set(k, nome)
    fichasDoElenco.set(k, fichasDoNome(nome))
  }
  const primeira = new Map<string, string>()
  const fichasDados = new Map<string, string[]>()
  for (const n of nomes) {
    if (!n) continue
    const k = chaveDaPessoa(n)
    if (!primeira.has(k)) primeira.set(k, n)
    fichasDados.set(k, fichasDoNome(n))
  }
  const grafia = (k: string): string => doElenco.get(k) ?? primeira.get(k) ?? k

  const contido = (f: readonly string[], maior: readonly string[]): boolean =>
    f.length > 0 && f.length < maior.length && f.every((x) => maior.includes(x))
  const destino = new Map<string, string>()
  for (const [k, f] of fichasDados) {
    if (doElenco.has(k)) continue
    const nosDados = [...fichasDados].filter(([k2, f2]) => k2 !== k && contido(f, f2)).map(([k2]) => k2)
    if (nosDados.length === 1) {
      destino.set(k, nosDados[0]!)
      continue
    }
    if (nosDados.length > 1) continue
    const noElenco = [...fichasDoElenco].filter(([k2, f2]) => k2 !== k && contido(f, f2)).map(([k2]) => k2)
    if (noElenco.length === 1) destino.set(k, noElenco[0]!)
  }

  const mapa = new Map<string, string>()
  for (const n of nomes) {
    if (!n || mapa.has(n)) continue
    let k = chaveDaPessoa(n)
    // O maior pode ser curto de outro ainda maior: segue (o tamanho so cresce, nao ha ciclo).
    for (let passo = 0; passo < 8 && destino.has(k); passo++) k = destino.get(k)!
    mapa.set(n, grafia(k))
  }
  return mapa
}

/** O nome do elenco que ele provavelmente queria ao digitar `nome`, ou null. */
function pareceDoElenco(nome: string, elenco: readonly string[]): string | null {
  const q = textoNormal(nome)
  if (!q) return null
  let melhor: { nome: string; nota: number } | null = null
  for (const e of elenco) {
    const n = textoNormal(e)
    const nota = n.startsWith(q) ? 0 : n.split(' ').some((t) => t.startsWith(q)) ? 1 : n.includes(q) ? 2 : null
    if (nota !== null && (!melhor || nota < melhor.nota)) melhor = { nome: e, nota }
  }
  return melhor?.nome ?? null
}

/**
 * A decisao como o motor vai entender: nome efetivo de cada grupo (ignorar
 * ganha de nome e tira do conjunto; conjunto juntado = o primeiro nome nao
 * vazio dele), as grafias da mesma pessoa unidas (grafiasDaDecisao, com a do
 * elenco), e os personagens que saem. Keys que nao existem em `grupos` sao
 * descartadas.
 */
export function resumoDaDecisao(
  grupos: readonly GrupoDoResumo[],
  decisao: DecisaoDaDescoberta,
  opcoes: OpcoesDoResumo = {},
): ResumoDaDecisao {
  const elenco = opcoes.elenco ?? []
  const existe = new Map(grupos.map((g) => [g.key, g]))
  const ignorado = new Set(decisao.ignorados.filter((k) => existe.has(k)))

  // Conjuntos limpos: so keys que existem e nao estao ignoradas, cada key num conjunto so.
  const usada = new Set<number>()
  const conjuntos: number[][] = []
  for (const c of decisao.juntar) {
    const limpo = c.filter((k, i) => existe.has(k) && !ignorado.has(k) && !usada.has(k) && c.indexOf(k) === i)
    if (limpo.length < 2) continue
    for (const k of limpo) usada.add(k)
    conjuntos.push(limpo)
  }
  const nomeDoGrupo = (k: number): string => limparNome(decisao.nomes[chave(k)] ?? '')
  const efetivo = new Map<number, string>()
  for (const c of conjuntos) {
    const nome = c.map(nomeDoGrupo).find((n) => n !== '') ?? ''
    for (const k of c) efetivo.set(k, nome)
  }
  for (const g of grupos) {
    if (ignorado.has(g.key)) efetivo.set(g.key, '')
    else if (!efetivo.has(g.key)) efetivo.set(g.key, nomeDoGrupo(g.key))
  }

  // A mesma pessoa escrita de outro jeito vira UM personagem, na grafia do elenco quando bate.
  const grafias = grafiasDaDecisao(
    grupos.map((g) => efetivo.get(g.key) ?? '').filter((n) => n !== ''),
    elenco,
  )
  const grafia = new Map<string, string>()
  const porNome = new Map<string, number[]>()
  for (const g of grupos) {
    const dado = efetivo.get(g.key) ?? ''
    if (!dado) continue
    const nome = grafias.get(dado) ?? dado
    const id = chaveDaPessoa(nome)
    if (!grafia.has(id)) grafia.set(id, nome)
    const lista = porNome.get(id) ?? []
    lista.push(g.key)
    porNome.set(id, lista)
  }

  const personagens: PersonagemDaDecisao[] = []
  const avisos: string[] = []
  for (const [id, keys] of porNome) {
    const nome = grafia.get(id)!
    let cenas = 0
    let refs = 0
    for (const k of keys) {
      const g = existe.get(k)!
      cenas += g.cenas
      const tirados = new Set((decisao.removidos[chave(k)] ?? []).filter((i) => i >= 0 && i < g.rostos.length))
      refs += g.rostos.length - tirados.size
    }
    refs = Math.min(REFS_POR_PERSONAGEM_MAX, refs)
    personagens.push({ nome, keys, cenas, refs })
    if (cenas < CENAS_MINIMAS_POR_PERSONAGEM) {
      avisos.push(`${nome}: so ${cenas} ${cenas === 1 ? 'cena' : 'cenas'}; com menos de ${CENAS_MINIMAS_POR_PERSONAGEM} o motor descarta.`)
    }
    if (refs === 0) avisos.push(`${nome}: todos os rostos tirados, fica sem foto de referencia.`)
  }
  personagens.sort((a, b) => b.cenas - a.cenas || a.nome.localeCompare(b.nome, 'pt-BR'))

  // Fora do elenco: so com elenco, e sem contar quem ja e conhecido de outro episodio.
  const foraDoElenco: ForaDoElenco[] = []
  if (elenco.length > 0) {
    const doElenco = new Set(elenco.map(chaveDaPessoa))
    const conhecidos = new Set(
      grupos.filter((g) => g.conhecido && g.sugestao).map((g) => chaveDaPessoa(g.sugestao!.nome)),
    )
    for (const p of personagens) {
      const id = chaveDaPessoa(p.nome)
      if (doElenco.has(id) || conhecidos.has(id)) continue
      const parece = pareceDoElenco(p.nome, elenco)
      foraDoElenco.push({ nome: p.nome, keys: p.keys, parece })
      avisos.push(`${p.nome}: nao esta no elenco${parece ? ` (seria ${parece}?)` : ''}.`)
    }
  }

  const ignorados = grupos.filter((g) => !(efetivo.get(g.key) ?? '')).map((g) => g.key)
  const semNome = grupos.filter((g) => !ignorado.has(g.key) && !g.figurante && !(efetivo.get(g.key) ?? '')).map((g) => g.key)
  const figurantes = grupos.filter((g) => !ignorado.has(g.key) && g.figurante && !(efetivo.get(g.key) ?? '')).map((g) => g.key)
  return {
    personagens,
    ignorados,
    semNome,
    figurantes,
    marcados: [...ignorado],
    foraDoElenco,
    avisos,
    erro: personagens.length === 0 ? ERRO_SEM_NOME : null,
  }
}

/**
 * A linha do stdin para o motor. Lanca (com a frase do `erro`) quando nenhum
 * grupo tem nome: o commit_discovery lancaria e o processo morreria com os
 * grupos. So entra em `names` grupo com nome (o motor ignora os outros), com a
 * grafia unida (resumoDaDecisao), e em `removed` so indice que existe.
 */
export function paraOMotor(
  grupos: readonly GrupoDoResumo[],
  decisao: DecisaoDaDescoberta,
  opcoes: OpcoesDoResumo = {},
): ComandoCommitDiscovery {
  const resumo = resumoDaDecisao(grupos, decisao, opcoes)
  if (resumo.erro) throw new Error(resumo.erro)
  const names: Record<string, string> = {}
  for (const p of resumo.personagens) for (const k of p.keys) names[chave(k)] = p.nome
  const removed: Record<string, number[]> = {}
  for (const g of grupos) {
    if (!names[chave(g.key)]) continue
    const lista = [...new Set(decisao.removidos[chave(g.key)] ?? [])]
      .filter((i) => i >= 0 && i < g.rostos.length)
      .sort((a, b) => a - b)
    if (lista.length) removed[chave(g.key)] = lista
  }
  return { cmd: 'commit-discovery', names, removed }
}

/**
 * Os nomes mandados que o motor tirou: quem nao aparece no indice depois do
 * commit (menos de CENAS_MINIMAS_POR_PERSONAGEM cenas). Pela chave de pessoa,
 * com o nome curto contido num do indice contando como presente: o canonizar
 * do indice une "Nia" a "Nia Liston", e isso nao e ficar de fora.
 */
export function nomesDescartados(mandados: readonly string[], noIndice: readonly string[]): string[] {
  const ficaram = noIndice.map((n) => fichasDoNome(n))
  const chaves = new Set(noIndice.map(chaveDaPessoa))
  return mandados.filter((n) => {
    if (chaves.has(chaveDaPessoa(n))) return false
    const f = fichasDoNome(n)
    return !(f.length > 0 && ficaram.some((m) => f.every((x) => m.includes(x))))
  })
}

// ====================================================== mudancas e retomada

/** O que ele mudou desde que a tela abriu: e o que se perde descartando. */
export interface MudancasDaDecisao {
  /** Grupos com o nome diferente do inicial (digitado, trocado ou apagado). */
  nomes: number
  ignorados: number
  /** Conjuntos juntados. */
  juntas: number
  /** Rostos tirados das referencias. */
  rostos: number
  total: number
}

export function mudancasDaDecisao(pronta: Pick<DescobertaPronta, 'grupos'> | null, decisao: DecisaoDaDescoberta): MudancasDaDecisao {
  const vazio = { nomes: 0, ignorados: 0, juntas: 0, rostos: 0, total: 0 }
  if (!pronta) return vazio
  const inicial = decisaoInicial(pronta)
  const existe = new Map(pronta.grupos.map((g) => [g.key, g]))
  let nomes = 0
  let rostos = 0
  for (const g of pronta.grupos) {
    const k = chave(g.key)
    if (limparNome(decisao.nomes[k] ?? '') !== limparNome(inicial.nomes[k] ?? '')) nomes += 1
    rostos += new Set((decisao.removidos[k] ?? []).filter((i) => i >= 0 && i < g.rostos.length)).size
  }
  const ignorados = new Set(decisao.ignorados.filter((k) => existe.has(k))).size
  const juntas = decisao.juntar.filter((c) => c.filter((k) => existe.has(k)).length >= 2).length
  return { nomes, ignorados, juntas, rostos, total: nomes + ignorados + juntas + rostos }
}

/** "3 nomes, 2 ignorados, 1 junta" (so o que tem). '' = nada. */
export function textoDasMudancas(m: MudancasDaDecisao): string {
  const partes: string[] = []
  if (m.nomes) partes.push(`${m.nomes} ${m.nomes === 1 ? 'nome' : 'nomes'}`)
  if (m.ignorados) partes.push(`${m.ignorados} ${m.ignorados === 1 ? 'ignorado' : 'ignorados'}`)
  if (m.juntas) partes.push(`${m.juntas} ${m.juntas === 1 ? 'junta' : 'juntas'}`)
  if (m.rostos) partes.push(`${m.rostos} ${m.rostos === 1 ? 'rosto tirado' : 'rostos tirados'}`)
  return partes.join(', ')
}

/** O que identifica um grupo entre duas rodadas do mesmo episodio (o motor reusa o cache). */
export function assinaturaDoGrupo(g: Pick<GrupoDeRostos, 'cenas' | 'totalDeRostos' | 'rostos'>): string {
  return `${g.cenas}|${g.totalDeRostos}|${g.rostos.length}`
}

/** A decisao de uma rodada que caiu (motor morreu, grupos expiraram), para o "Tentar de novo". */
export interface DecisaoGuardada {
  episodioId: string
  /** String(key) -> assinaturaDoGrupo. */
  assinaturas: Record<string, string>
  decisao: DecisaoDaDescoberta
}

export function guardarDecisao(episodioId: string, pronta: Pick<DescobertaPronta, 'grupos'>, decisao: DecisaoDaDescoberta): DecisaoGuardada {
  const assinaturas: Record<string, string> = {}
  for (const g of pronta.grupos) assinaturas[chave(g.key)] = assinaturaDoGrupo(g)
  return { episodioId, assinaturas, decisao }
}

/**
 * A decisao guardada aplicada aos grupos NOVOS: so nos grupos com a mesma key
 * e a mesma assinatura (o corte e os rostos vem do cache, entao uma rodada
 * refeita costuma trazer os mesmos grupos). O resto comeca como a tela abriria.
 */
export function reaplicarDecisao(guardada: Pick<DecisaoGuardada, 'assinaturas' | 'decisao'>, pronta: Pick<DescobertaPronta, 'grupos'>): DecisaoDaDescoberta {
  const base = decisaoInicial(pronta)
  const igual = new Map<number, GrupoDeRostos>()
  for (const g of pronta.grupos) if (guardada.assinaturas[chave(g.key)] === assinaturaDoGrupo(g)) igual.set(g.key, g)
  const velha = guardada.decisao
  const nomes = { ...base.nomes }
  for (const k of igual.keys()) {
    if (chave(k) in velha.nomes) nomes[chave(k)] = velha.nomes[chave(k)]!
  }
  const ignorados = velha.ignorados.filter((k) => igual.has(k))
  const juntar = velha.juntar.map((c) => c.filter((k) => igual.has(k))).filter((c) => c.length >= 2)
  const removidos: Record<string, number[]> = {}
  for (const [k, g] of igual) {
    const lista = (velha.removidos[chave(k)] ?? []).filter((i) => i >= 0 && i < g.rostos.length)
    if (lista.length) removidos[chave(k)] = lista
  }
  return { nomes, ignorados, juntar, removidos }
}

/*
 * ============================================================ DONOS (15/10)
 *
 * Contrato: este arquivo + channels.ts (IPC.iniciarDescoberta,
 * descobertaAtual, confirmarDescoberta, cancelarDescoberta,
 * descobertaProgresso e os metodos do DangaiBridge) + preload.ts + ipc.ts (os
 * handlers, ja ligados aos stubs) + electron/services/descoberta/index.ts
 * (stubs) + src/store/gerar-descoberta.ts (a store da tela, fina).
 *
 * (A) MOTOR/MAIN -- electron/services/descoberta/* (index.ts: a sessao, uma
 *     por vez; e o que mais precisar: recortes.ts para copiar/publicar os
 *     recortes e achar a foto do elenco no anime_db, aplicar.ts para levar o
 *     resultado ao indice) e DUAS edicoes cirurgicas:
 *     - electron/services/motor.ts: `analisarEpisodio(pedido, ouvintes,
 *       opcoes?: { descoberta?: true })` poe `discovery: true` (com
 *       `reconhecer: true`, motor 'studio', renderExportMode 'compat' e a
 *       `outputFolder` da pasta do anime quando ha cenas, como o "Reconhecer
 *       agora"); `OuvintesDaAnalise.descobertaPronta?(ev)` recebe o
 *       discovery-ready (sem o relogio de 30 s: o processo fica vivo); e um
 *       `comandarDescoberta(jobId, comando: ComandoCommitDiscovery)` que
 *       escreve a linha no stdin. Sem o ouvinte, o discovery-ready segue como
 *       hoje (cancel + falha). O `done` do commit e o FimDaAnalise ok de
 *       sempre; o cancelarAnalise de sempre cancela.
 *     - electron/services/episodio/corte-fundo.ts: iniciarCorte recusa o
 *       episodio com descoberta viva ("Esse episodio esta no Reconhecer na
 *       mao..."); e a descoberta recusa episodio com corte vivo
 *       (estadoDoCorte). Um corte que entrasse depois regravaria o shots.json.
 *     Regras do main: confere podeReconhecerNaMao com o indice do disco; motor
 *     ocupado = erro na hora, sem fila; paraOMotor ANTES de escrever no stdin
 *     (nunca manda decisao vazia); recortes copiados por job e publicados
 *     (media-server); elenco com a foto do anime_db quando houver; timeout de
 *     ESPERA_MAXIMA_DOS_NOMES_MS no 'pronta'. No `done`: lerPastaDoEpisodio +
 *     montarPlanos (cues do indice lido AGORA) + anexarPlanos (com
 *     corte.reconhecer = true), grava em caminhoDoIndice('studio', pasta, id)
 *     com guardarAnterior, lembrarIndice, e manda os DOIS eventos: o
 *     corteProgresso de sempre ({ estado: indice.corte, indice }) -- e por ele
 *     que gerar.ts, gerar-roteiro.ts e gerar-cenas.ts trocam o indice, sem
 *     mudar nada neles -- e o descobertaProgresso 'feita' com o resultado.
 *     Log em <dados>/logs/ultima-analise.log (o do motor.ts). Testes em
 *     scripts/teste/ (copia do episodio numa biblioteca temporaria, perfil
 *     temporario).
 *
 * (B) TELA -- src/store/gerar-descoberta.ts (dono; a casca ja existe),
 *     src/components/gerar/ReconhecerNaMao.tsx (a tela de grupos, por cima
 *     do passo 1, no visual do passo 4 / Biblioteca: grade de cartoes,
 *     rodape com Confirmar e Cancelar) e GrupoDeRostos.tsx (o cartao: os
 *     rostos -- clicar tira/devolve --, o nome com o elenco como sugestao, o
 *     "parece X", Ignorar, Juntar/Separar, N cenas), "Figurantes (N)" atras
 *     de um botao, e edicoes pequenas para ABRIR: AndamentoDoCorte.tsx
 *     (Parou com descoberta: [Reconhecer na mao]), ResumoDoEpisodio.tsx
 *     (ao lado do "Reconhecer agora" e o "Revisar personagens" discreto no
 *     titulo Personagens), GerarRecap.tsx (montar a tela e
 *     escutarDescoberta), e o texto do erro 'sem-referencias' do receberFim
 *     em gerar.ts (uma linha). gerar.ts nao ganha estado novo: o indice novo
 *     chega pelo corteProgresso.
 */
