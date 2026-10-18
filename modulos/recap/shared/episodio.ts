import { z } from 'zod'
import { canonizar } from '@shared/nomes'

/**
 * O EPISODIO, do jeito que o Studio o entende: o contrato do passo 1 do
 * assistente "Gerar recap" (Episodio -> Roteiro -> Voz -> Cenas).
 *
 * Fonte unica da verdade para os tres lados que mexem nele:
 *   - o motor (electron/services/motor.ts), que corta e reconhece personagens;
 *   - o episodio (electron/services/episodio/*), que sonda, procura, le a
 *     legenda, sugere OP/ED e grava o indice;
 *   - a interface (src/components/gerar/GerarRecap.tsx e src/store/gerar.ts),
 *     que mostra e confirma.
 *
 * Os tipos saem de z.infer, como em contract.ts. channels.ts so importa TIPOS
 * daqui (`import type`): este arquivo puxa zod, e o preload tem que ficar
 * pequeno.
 *
 * TEMPO: todo segundo neste arquivo (cues, planos, exclusoes, capitulos) e o
 * tempo de REPRODUCAO do .mkv -- 0 e o primeiro quadro que o player mostra, ou
 * seja PTS menos `startTimeSec`. E a mesma base do shots.json do AnCut (quadro
 * dividido por fps, contado do primeiro quadro). Quem le algo com PTS absoluto
 * (a legenda extraida, por exemplo) subtrai `startTimeSec` antes de gravar.
 */

/** Sobe quando a forma do episodio.json muda de um jeito que o leitor antigo nao entende. */
export const EPISODIO_VERSAO = 1 as const

/** O nome do arquivo do indice dentro da pasta do episodio no Studio. */
export const NOME_DO_INDICE = 'episodio.json'

// ------------------------------------------------------------------ identidade

/** '' = episodio normal. OP/ED/MOVIE seguem o `kind` do motor do AnCut. */
export const kindDoEpisodioSchema = z.enum(['', 'OP', 'ED', 'MOVIE'])
export type KindDoEpisodio = z.infer<typeof kindDoEpisodioSchema>

/**
 * De que biblioteca vem a pasta do episodio (a que tem shots/).
 *
 * - studio: a do proprio Studio (settings.bibliotecaStudio). E a unica em que
 *   o Studio grava.
 * - ancut: a saida do AnCut HUB instalado.
 * - cortecenas: a saida do Corte Cenas do Levi (o `output_dir` do config dele).
 * - dangai: a raiz de biblioteca herdada do Dangai (settings.libraryDir),
 *   quando ela nao e nenhuma das de cima.
 *
 * So `studio` aceita escrita. As outras sao so leitura, sempre.
 */
export const origemDaBibliotecaSchema = z.enum(['studio', 'ancut', 'cortecenas', 'dangai'])
export type OrigemDaBiblioteca = z.infer<typeof origemDaBibliotecaSchema>

/**
 * Anime, temporada e episodio, adivinhados pelo nome do arquivo e corrigiveis
 * pelo usuario. E a mesma tupla que o motor usa para nomear a pasta.
 */
export const palpiteDoEpisodioSchema = z.object({
  anime: z.string(),
  temporada: z.number().int().nonnegative(),
  /** Num MOVIE e o ano, como no motor ("Filme (2019)"). */
  episodio: z.number().int().nonnegative(),
  kind: kindDoEpisodioSchema,
})
export type PalpiteDoEpisodio = z.infer<typeof palpiteDoEpisodioSchema>

// ------------------------------------------------------------------- sondagem

/**
 * O arquivo de video em si: medidas e tempo. Vai inteiro para o indice, para
 * quem abrir o episodio.json saber de que arquivo ele fala sem reabrir o .mkv.
 */
export const fonteDoEpisodioSchema = z.object({
  /** Caminho absoluto do .mkv/.mp4 no momento da sondagem. */
  path: z.string().min(1),
  /** Bytes. Entra na impressao digital. */
  tamanho: z.number().int().nonnegative(),
  duracaoSec: z.number().positive(),
  /** Quadros por segundo do stream de video (23.976 = 24000/1001). */
  fps: z.number().positive(),
  /**
   * start_time do stream de video (o do container de reserva): o zero do
   * shots.json. Quase sempre 0; quando nao e, desloca a legenda (ver sondar.ts).
   */
  startTimeSec: z.number(),
  largura: z.number().int().positive(),
  altura: z.number().int().positive(),
  /** BT.2020 + PQ/HLG. Muda a miniatura e a conversao para SDR. */
  hdr: z.boolean(),
  /** codec_name do video: 'h264', 'hevc', 'av1'... */
  codec: z.string(),
})
export type FonteDoEpisodio = z.infer<typeof fonteDoEpisodioSchema>

/** Uma faixa de legenda dentro do arquivo. */
export const faixaDeLegendaSchema = z.object({
  /**
   * Indice ABSOLUTO do stream no arquivo (o `index` do ffprobe, o N de
   * "Stream #0:N" do ffmpeg). Extrair com `-map 0:<index>`, nunca `0:s:<index>`.
   */
  index: z.number().int().nonnegative(),
  /** Tag language como vem no arquivo ('por', 'eng', 'jpn'). '' sem tag. */
  idioma: z.string(),
  /** Tag title ('Brazilian Portuguese', 'Signs & Songs'). '' sem tag. */
  nome: z.string(),
  /**
   * codec_name: 'ass', 'ssa', 'subrip', 'webvtt', 'mov_text' sao texto.
   * 'hdmv_pgs_subtitle' e 'dvd_subtitle' sao imagem e nao servem para falas.
   */
  codec: z.string(),
  default: z.boolean(),
  forced: z.boolean(),
})
export type FaixaDeLegenda = z.infer<typeof faixaDeLegendaSchema>

/** Codecs de legenda que tem TEXTO. Os outros sao imagem e nao dao falas. */
export const CODECS_DE_LEGENDA_TEXTO = ['ass', 'ssa', 'subrip', 'srt', 'webvtt', 'mov_text', 'text'] as const

export function legendaTemTexto(faixa: Pick<FaixaDeLegenda, 'codec'>): boolean {
  return (CODECS_DE_LEGENDA_TEXTO as readonly string[]).includes(faixa.codec.toLowerCase())
}

/** Um capitulo do container. CR, Netflix e Erai costumam marcar OP/ED assim. */
export const capituloSchema = z.object({
  start: z.number(),
  end: z.number(),
  titulo: z.string(),
})
export type Capitulo = z.infer<typeof capituloSchema>

/** O que a sondagem devolve: o arquivo, as faixas, os capitulos e o palpite. */
export const sondaDoEpisodioSchema = fonteDoEpisodioSchema.extend({
  /** Impressao digital, a mesma que vira o `id` do indice ('ep_' + sha1). */
  id: z.string().regex(/^ep_[0-9a-f]{40}$/),
  legendas: z.array(faixaDeLegendaSchema),
  /**
   * A faixa que o Studio escolheria sozinho (`index` absoluto): PT > EN, texto
   * antes de imagem, .ass antes de .srt, pulando "Signs"/"Songs"/forced.
   * null = nenhuma faixa de texto (o episodio fica sem falas).
   */
  legendaSugerida: z.number().int().nonnegative().nullable(),
  capitulos: z.array(capituloSchema),
  palpite: palpiteDoEpisodioSchema,
  /** De onde saiu o palpite: o parse do motor ou o do Studio (reserva). */
  palpiteOrigem: z.enum(['motor', 'nome']),
})
export type SondaDoEpisodio = z.infer<typeof sondaDoEpisodioSchema>

// ---------------------------------------------------------------------- busca

/**
 * Como a busca nas bibliotecas reconheceu o episodio, do mais forte ao mais
 * fraco:
 * - source: o `shot_bounds.json.source` (ou `fonte.path` de um indice do
 *   Studio) e este mesmo arquivo;
 * - impressao: um indice do Studio com o mesmo `id` (o arquivo mudou de lugar);
 * - nome: o source aponta para outro lugar, mas o nome do arquivo e o mesmo;
 * - anime+episodio: so a pasta bate (anime parecido + SxxEyy). O mais fraco: a
 *   interface avisa que pode ser outro release.
 */
export const comoAchouSchema = z.enum(['source', 'impressao', 'nome', 'anime+episodio'])
export type ComoAchou = z.infer<typeof comoAchouSchema>

export const episodioEncontradoSchema = z.object({
  origem: origemDaBibliotecaSchema,
  /** Pasta do episodio (a que tem shots/, keyframes/ e metadata/). */
  pasta: z.string(),
  /** O nome da pasta da serie, que e o que agrupa na Biblioteca. */
  anime: z.string(),
  temporada: z.number().int().nonnegative(),
  episodio: z.number().int().nonnegative(),
  kind: kindDoEpisodioSchema,
  /** Cenas que EXISTEM em shots/ (o disco manda, como na Biblioteca). */
  totalCenas: z.number().int().nonnegative(),
  /** Personagens reconhecidos e em quantas cenas, do mais frequente ao menos. */
  personagens: z.array(z.object({ nome: z.string(), cenas: z.number().int().nonnegative() })),
  comoAchou: comoAchouSchema,
  /** episodio.json do Studio que ja aponta para esta pasta. null = ainda nao indexado. */
  indice: z.string().nullable(),
  /** ISO, mtime do shots.json. null quando nao deu para ler. */
  analisadoEm: z.string().nullable(),
  /**
   * De onde vieram as fotos do elenco que reconheceram os personagens, quando
   * nao foi a busca online ('Corte Cenas', da reserva do elenco). So para a
   * biblioteca do Studio; null/ausente = busca online ou nao se sabe.
   */
  fotosDoElenco: z.string().nullable().optional(),
})
export type EpisodioEncontrado = z.infer<typeof episodioEncontradoSchema>

// ---------------------------------------------------------------------- motor

/** Qual motor corta: o do Studio (motor/) ou o do AnCut HUB instalado. */
export const motorSchema = z.enum(['studio', 'ancut'])
export type Motor = z.infer<typeof motorSchema>

export const statusDoMotorSchema = z.object({
  studio: z.object({
    /** Python, torch e o modulo app.headless respondem. */
    pronto: z.boolean(),
    versao: z.string().nullable(),
    /** Nome da GPU com CUDA. null = roda na CPU (bem mais lento). */
    gpu: z.string().nullable(),
    /** Por que nao esta pronto, em texto para a tela. null quando pronto. */
    erro: z.string().nullable(),
  }),
  ancut: z.object({
    /** O CorteCenas.exe do AnCut HUB foi achado. Liga o botao "Analisar com o AnCut". */
    instalado: z.boolean(),
    caminho: z.string().nullable(),
  }),
})
export type StatusDoMotor = z.infer<typeof statusDoMotorSchema>

export const pedidoDeAnaliseSchema = z.object({
  path: z.string().min(1),
  anime: z.string().min(1),
  temporada: z.number().int().nonnegative(),
  episodio: z.number().int().nonnegative(),
  kind: kindDoEpisodioSchema,
  motor: motorSchema,
  /**
   * true = corta E reconhece os personagens pelo rosto (busca o elenco na
   * primeira vez de cada anime). false = so corta (`cutOnly`), bem mais rapido.
   */
  reconhecer: z.boolean(),
  /**
   * A pasta do anime na biblioteca, quando ela ja existe e nao pode mudar (o
   * "Reconhecer agora" sobre cenas ja cortadas). Vai como `outputFolder`: o
   * nome em `anime` passa a servir so para achar o elenco, e corrigi-lo nao
   * corta o episodio de novo em outra pasta. Ausente = o motor decide pelo nome.
   */
  pastaDoAnime: z.string().min(1).optional(),
})
export type PedidoDeAnalise = z.infer<typeof pedidoDeAnaliseSchema>

/** As etapas que a interface mostra. O estagio cru do motor vai junto em `etapaDoMotor`. */
export const etapaDaAnaliseSchema = z.enum([
  'preparando',
  'detectando',
  'cortando',
  'elenco',
  'personagens',
  'organizando',
])
export type EtapaDaAnalise = z.infer<typeof etapaDaAnaliseSchema>

/** main -> renderer, varias vezes por job. */
export const progressoDaAnaliseSchema = z.object({
  jobId: z.string(),
  etapa: etapaDaAnaliseSchema,
  /** O `stage` que o motor mandou ('detect_shots', 'embed_refs'...). Para log e depuracao. */
  etapaDoMotor: z.string(),
  /** 0 a 1 dentro da etapa. null = o motor nao sabe quanto falta (mostrar indeterminado). */
  fracao: z.number().min(0).max(1).nullable(),
  /** Frase pronta do motor, para a linha de andamento. */
  mensagem: z.string(),
})
export type ProgressoDaAnalise = z.infer<typeof progressoDaAnaliseSchema>

/** main -> renderer, exatamente uma vez por job. */
export const fimDaAnaliseSchema = z.union([
  z.object({
    jobId: z.string(),
    ok: z.literal(true),
    motor: motorSchema,
    /** A pasta que o motor gravou (`episodeRoot`). E o que vai para indexarEpisodio. */
    pastaDoEpisodio: z.string(),
    totalCenas: z.number().int().nonnegative(),
    /** Nomes reconhecidos. Vazio quando `reconhecer` era false. */
    personagens: z.array(z.string()),
    segundos: z.number().nonnegative(),
    /**
     * De onde vieram as fotos do elenco quando nao foi a busca online: a
     * `origem` da reserva ('Corte Cenas', ver electron/services/elenco-reserva.ts).
     * null = busca online, ou analise sem reconhecimento.
     */
    fotosDoElenco: z.string().nullable(),
  }),
  z.object({
    jobId: z.string(),
    ok: z.literal(false),
    /** Cancelar nao e falha: a interface volta ao estado anterior sem mensagem vermelha. */
    cancelado: z.boolean(),
    erro: z.string(),
    /**
     * O motor parou pedindo ajuda para achar o elenco (`needs-input` do
     * headless). A interface oferece "So cortar" (reconhecer: false). A rodada
     * de descoberta com nomes fica para depois.
     */
    precisaDescoberta: z.enum(['anime-nao-encontrado', 'sem-referencias']).nullable(),
    /**
     * O1: a pasta do episodio em que o motor ja deixou a descoberta GRAVADA
     * (o corte seguiu e os rostos foram agrupados antes de pedir o elenco): o
     * Reconhecer na mao abre na hora. null/ausente = nao gravou.
     */
    pastaDaDescoberta: z.string().nullable().optional(),
  }),
])
export type FimDaAnalise = z.infer<typeof fimDaAnaliseSchema>

/**
 * O estagio cru do motor -> a etapa que a interface mostra. Estagio novo que o
 * motor inventar cai em 'preparando' em vez de quebrar a tela.
 */
export function etapaDoEstagio(estagio: string): EtapaDaAnalise {
  switch (estagio) {
    case 'detect_shots':
      return 'detectando'
    case 'cut_shots':
      return 'cortando'
    case 'fetch_characters':
    case 'download_refs':
    case 'embed_refs':
      return 'elenco'
    case 'analyze_shots':
    case 'second_pass':
    case 'ai_review':
      return 'personagens'
    case 'organize':
      return 'organizando'
    default:
      return 'preparando'
  }
}

// ------------------------------------------------- corte em segundo plano

/*
 * O CORTE EM SEGUNDO PLANO (decisao do Levi, 14/10): o passo 1 nao espera o
 * motor. A legenda (falas, quem fala) e a sugestao de OP/ED saem em segundos e
 * o indice NASCE SO COM ELAS (`planos: []`, `corte.status: 'pendente'`); o
 * "Proximo: Roteiro" ja libera. O corte + reconhecimento roda por tras
 * (electron/services/episodio/corte-fundo.ts, que usa o motor.ts de sempre) e,
 * quando termina, os planos sao ANEXADOS ao mesmo indice (anexarPlanos): id,
 * cues e exclusoes ficam como estavam -- os eventos e o roteiro citam essas
 * cues, e a regua que o usuario ja mexeu nao volta a sugestao.
 *
 * COMPATIBILIDADE: `corte` e opcional. Ausente = 'pronto' (todo indice que ja
 * existe tem planos e nasceu depois do corte). Um indice com corte diferente
 * de 'pronto' tem `planos: []` enquanto espera.
 *
 * ONDE MORA o indice que espera o corte: <bibliotecaStudio>/_indices/<id>/
 * episodio.json, com `biblioteca: { origem: 'studio', pasta: <essa pasta> }`
 * (caminhoDoIndice('studio', pasta, id) da o mesmo arquivo, entao salvarExclusoes
 * e acharIndice funcionam sem mudar). Quando o corte termina, o indice com
 * planos vai para <pasta do episodio>/episodio.json, como todo episodio
 * cortado pelo Studio, e o de _indices e renomeado para episodio.<carimbo>.json
 * (nunca apagado); lembrarIndice aponta para o novo.
 *
 * O PROGRESSO nao e gravado a cada passo: o indice so e regravado nas trocas de
 * status. O andamento ao vivo vem pelo evento corteProgresso (EventoDoCorte). Um
 * 'cortando' lido do disco sem job vivo no main (o app fechou no meio) vale como
 * 'pendente'.
 */

export const statusDoCorteSchema = z.enum(['pendente', 'cortando', 'pronto', 'falhou'])
export type StatusDoCorte = z.infer<typeof statusDoCorteSchema>

export const estadoDoCorteSchema = z.object({
  status: statusDoCorteSchema,
  /** O job do motor (motor.ts) enquanto corta. null fora disso. */
  jobId: z.string().nullable(),
  /** 0..1 do corte inteiro. null = indeterminado (mostrar a barra andando). */
  progresso: z.number().min(0).max(1).nullable(),
  /** A etapa da tela (ROTULO_DA_ETAPA). null fora do corte. */
  etapa: etapaDaAnaliseSchema.nullable(),
  /** Frase pronta, ASCII, para a linha discreta ("Cortando as cenas 42%"). '' = nada. */
  mensagem: z.string().default(''),
  motor: motorSchema,
  /** Corta E reconhece os personagens (o padrao do passo 1). */
  reconhecer: z.boolean(),
  /** Por que falhou, ASCII. null fora do 'falhou'. */
  erro: z.string().nullable().default(null),
  /** ISO de quando comecou a cortar. null = ainda nao comecou. */
  inicio: z.string().nullable().default(null),
  atualizadoEm: z.string(),
  /**
   * O motor parou pedindo o elenco (needs-input), como o `precisaDescoberta`
   * do fim da analise: a tela oferece "Cortar sem personagens" e, quando o
   * anime nao foi achado, o nome para corrigir. null fora disso.
   */
  descoberta: z.enum(['anime-nao-encontrado', 'sem-referencias']).nullable().default(null),
  /** O1: com `descoberta`, a pasta em que o motor deixou os grupos de rostos gravados (FimDaAnalise). */
  pastaDaDescoberta: z.string().nullable().optional(),
})
export type EstadoDoCorte = z.infer<typeof estadoDoCorteSchema>

export const ROTULO_DO_STATUS_DO_CORTE: Record<StatusDoCorte, string> = {
  pendente: 'Cenas na fila',
  cortando: 'Cortando as cenas',
  pronto: 'Cenas prontas',
  falhou: 'Corte parou',
}

// ---------------------------------------------------------------------- indice

/** Uma linha da legenda, com id estavel. */
export const cueSchema = z.object({
  /** 'c0001', 'c0002'... na ordem de inicio. Estavel enquanto a faixa nao muda. */
  id: z.string().regex(/^c\d{4,}$/),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  /** Texto limpo: sem tags {\...}, \N vira espaco. */
  texto: z.string(),
  /** Campo Name do .ass. null quando vazio ou quando a legenda nao tem o campo (.srt). */
  falante: z.string().nullable(),
  /** Campo Style do .ass ('Default', 'Sign', 'OP'). '' no .srt. */
  estilo: z.string(),
  /**
   * fala: alguem dizendo algo. placa: texto de tela traduzido (Name 'Text',
   * estilo de sign, posicionamento \pos). musica: letra de OP/ED/insert.
   */
  tipo: z.enum(['fala', 'placa', 'musica']),
})
export type Cue = z.infer<typeof cueSchema>

export const motivoDaExclusaoSchema = z.enum(['op', 'ed', 'preview', 'creditos', 'manual'])
export type MotivoDaExclusao = z.infer<typeof motivoDaExclusaoSchema>

/**
 * De onde veio a marcacao:
 * - capitulo: capitulo do container chamado Opening/OP/Ending/ED/Preview;
 * - estilo: cues de musica com estilo de OP/ED no .ass;
 * - vao: um vao longo sem fala no comeco ou no fim;
 * - skip_ranges: o skip_ranges.json do AnCut/Corte Cenas (so leitura);
 * - serie: a marcacao que o usuario confirmou em outro episodio da mesma serie;
 * - usuario: desenhada ou ajustada a mao na regua;
 * - audio: impressao de audio da OP (F5).
 */
export const origemDaExclusaoSchema = z.enum([
  'capitulo',
  'estilo',
  'vao',
  'skip_ranges',
  'serie',
  'usuario',
  'audio',
])
export type OrigemDaExclusao = z.infer<typeof origemDaExclusaoSchema>

/** Um trecho do episodio que nao entra no recap (OP, ED, previa...). */
export const exclusaoSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  motivo: motivoDaExclusaoSchema,
  origem: origemDaExclusaoSchema,
  /** false = sugestao do Studio, ainda nao vista. true = o usuario confirmou na regua. */
  confirmada: z.boolean(),
  /**
   * Por que o Studio sugeriu, em ASCII para a tela: "Capitulo 'Opening' do
   * arquivo", "1m29s sem fala no comeco". '' numa marcacao manual.
   */
  porque: z.string().default(''),
})
export type Exclusao = z.infer<typeof exclusaoSchema>

/** Uma sugestao de OP/ED que o usuario ainda nao viu. */
export type ExclusaoSugerida = Exclusao & { confirmada: false }

export const fonteDoPersonagemSchema = z.enum(['ancut-curado', 'ancut', 'falante', 'visao', 'manual'])
export type FonteDoPersonagem = z.infer<typeof fonteDoPersonagemSchema>

/**
 * Uma cena (shot) do episodio, ja cortada em mp4 no formato do AnCut.
 *
 * Sinal de personagem, nunca veto: a precisao do motor no benchmark ficou entre
 * 0,27 e 0,45, com cobertura de ~34% das cenas.
 */
export const planoSchema = z.object({
  /** O nome do mp4 sem extensao: '0025', ou '0164-0167' quando cenas foram juntadas. */
  id: z.string().min(1),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  /** Caminho absoluto do mp4 (shots/NNNN.mp4). Numa biblioteca externa, so leitura. */
  arquivo: z.string().min(1),
  /**
   * [recap] Onde o plano comeca DENTRO do `arquivo`, em segundos. Ausente = 0
   * (o arquivo e so dele). So em memoria: quando o NNNN.mp4 foi mesclado pelo
   * Dangai num AAAA-BBBB.mp4, o passo 4 e a montagem leem o mesclado a partir
   * daqui (shared/mesclas.ts). Nunca e gravado no indice.
   */
  inicioNoArquivo: z.number().nonnegative().optional(),
  /** [recap] A duracao do mesclado inteiro (a tira de quadros da grade anda so no pedaco do plano). */
  duracaoDoArquivo: z.number().positive().optional(),
  /** Keyframe do meio (_1.jpg) ou o vizinho que existir. null quando nao ha nenhum. */
  keyframe: z.string().nullable(),
  /** Cues que cruzam o plano no tempo, em ordem. */
  cueIds: z.array(z.string()),
  /** Falantes dessas cues (sem repetir, na ordem em que falam). */
  falantes: z.array(z.string()),
  personagens: z.array(
    z.object({
      nome: z.string().min(1),
      conf: z.number().min(0).max(1),
      /**
       * ancut: reconhecimento automatico do motor (o do Studio e o mesmo do
       * AnCut). ancut-curado: aprovado/corrigido no index.db. falante: veio do
       * Name do .ass. visao: juiz visual (F2). manual: o usuario disse.
       */
      fonte: fonteDoPersonagemSchema,
    }),
  ),
})
export type Plano = z.infer<typeof planoSchema>

export const bibliotecaDoEpisodioSchema = z.object({
  origem: origemDaBibliotecaSchema,
  /** A pasta do episodio onde moram shots/, keyframes/ e metadata/. */
  pasta: z.string().min(1),
})
export type BibliotecaDoEpisodio = z.infer<typeof bibliotecaDoEpisodioSchema>

/**
 * O INDICE do episodio, gravado em episodio.json.
 *
 * Onde mora: SEMPRE dentro da biblioteca do Studio, nunca numa externa.
 * - origem 'studio': `<biblioteca.pasta>/episodio.json`, ao lado de shots/.
 * - outras origens: `<bibliotecaStudio>/_indices/<id>/episodio.json`. A pasta
 *   do AnCut/Corte Cenas fica intocada, o `_` faz a varredura da Biblioteca
 *   pular a pasta, e a chave pelo id nao colide com a pasta que o motor do
 *   Studio criaria se o mesmo episodio fosse cortado aqui depois (ver
 *   electron/services/episodio/indice.ts).
 */
const episodeIndexBase = z.object({
  versao: z.literal(EPISODIO_VERSAO),
  /** 'ep_' + sha1(tamanho, 4 MiB iniciais, 4 MiB finais, duracao). Nao depende do caminho. */
  id: z.string().regex(/^ep_[0-9a-f]{40}$/),
  fonte: fonteDoEpisodioSchema,
  anime: z.string().min(1),
  temporada: z.number().int().nonnegative(),
  episodio: z.number().int().nonnegative(),
  kind: kindDoEpisodioSchema,
  /** A faixa lida. null = sem legenda de texto, e o episodio fica sem falas. */
  faixaLegenda: faixaDeLegendaSchema.nullable(),
  cues: z.array(cueSchema),
  /** Sugeridas (confirmada: false) e confirmadas. A regua mostra as duas. */
  exclusoes: z.array(exclusaoSchema),
  planos: z.array(planoSchema),
  biblioteca: bibliotecaDoEpisodioSchema,
  /**
   * Se os personagens foram procurados. 'pulado' = analise so de corte; 'desconhecido' =
   * biblioteca externa sem como saber (nenhuma cena com personagem).
   */
  reconhecimento: z.enum(['feito', 'pulado', 'desconhecido']),
  /** Avisos para a tela, em ASCII ("Legenda sem o campo Name: falas sem falante"). */
  avisos: z.array(z.string()).default([]),
  /** ISO. Quando o indice foi montado. */
  criadoEm: z.string(),
  /** ISO. Muda a cada salvarExclusoes. */
  atualizadoEm: z.string(),
  /**
   * O corte em segundo plano. Ausente = 'pronto' (todo indice de antes disto).
   * Diferente de 'pronto' = indice que nasceu so com as falas e espera os
   * planos (ver o comentario de estadoDoCorteSchema).
   */
  corte: estadoDoCorteSchema.optional(),
})

/**
 * Com as conferencias que atravessam campos: ids unicos, plano so cita cue que
 * existe e nenhum trecho termina antes de comecar. Um indice que falha aqui
 * nao e gravado nem lido -- melhor refazer do que casar cena com fala errada.
 */
export const episodeIndexSchema = episodeIndexBase.superRefine((indice, ctx) => {
  const cues = new Set<string>()
  for (const [i, cue] of indice.cues.entries()) {
    if (cues.has(cue.id)) ctx.addIssue({ code: 'custom', path: ['cues', i, 'id'], message: `cue repetida: ${cue.id}` })
    cues.add(cue.id)
    if (cue.end < cue.start) ctx.addIssue({ code: 'custom', path: ['cues', i], message: `cue ${cue.id} termina antes de comecar` })
  }
  const planos = new Set<string>()
  for (const [i, plano] of indice.planos.entries()) {
    if (planos.has(plano.id)) ctx.addIssue({ code: 'custom', path: ['planos', i, 'id'], message: `plano repetido: ${plano.id}` })
    planos.add(plano.id)
    if (plano.end < plano.start) ctx.addIssue({ code: 'custom', path: ['planos', i], message: `plano ${plano.id} termina antes de comecar` })
    for (const id of plano.cueIds) {
      if (!cues.has(id)) ctx.addIssue({ code: 'custom', path: ['planos', i, 'cueIds'], message: `plano ${plano.id} cita cue inexistente: ${id}` })
    }
  }
  for (const [i, ex] of indice.exclusoes.entries()) {
    if (ex.end <= ex.start) ctx.addIssue({ code: 'custom', path: ['exclusoes', i], message: 'exclusao vazia ou invertida' })
  }
})
export type EpisodeIndex = z.infer<typeof episodeIndexSchema>

/** Le um episodio.json cru. Lanca com a mensagem do zod quando nao confere. */
export function lerIndice(cru: unknown): EpisodeIndex {
  return episodeIndexSchema.parse(cru)
}

/** O pedido de indexarEpisodio. */
export const indexarEpisodioArgsSchema = z.object({
  /** O .mkv/.mp4. */
  path: z.string().min(1),
  /** A pasta com shots/ (do fim da analise ou do EpisodioEncontrado escolhido). */
  pastaDoEpisodio: z.string().min(1),
  origem: origemDaBibliotecaSchema,
  /** O palpite que o usuario confirmou na tela. Da nome a pasta do indice. */
  palpite: palpiteDoEpisodioSchema,
  /**
   * `index` absoluto da faixa de legenda. Ausente = a sugerida pela sonda.
   * null = ler sem legenda (sem falas).
   */
  faixaLegenda: z.number().int().nonnegative().nullable().optional(),
  /**
   * true = monta de novo mesmo havendo indice valido para esta pasta e esta
   * faixa. As exclusoes CONFIRMADAS do indice anterior sao herdadas.
   */
  refazer: z.boolean().optional(),
})
export type IndexarEpisodioArgs = z.infer<typeof indexarEpisodioArgsSchema>

export const listaDeExclusoesSchema = z.array(exclusaoSchema)

/**
 * O pedido de indexarFalas: o indice SO COM AS FALAS (cues, falantes, OP/ED
 * sugeridas), sem esperar o corte. Se o episodio ja tem indice com planos,
 * devolve esse (nada a esperar).
 */
export const indexarFalasArgsSchema = z.object({
  path: z.string().min(1),
  palpite: palpiteDoEpisodioSchema,
  /** `index` absoluto da faixa. Ausente = a sugerida pela sonda; null = sem legenda. */
  faixaLegenda: z.number().int().nonnegative().nullable().optional(),
})
export type IndexarFalasArgs = z.infer<typeof indexarFalasArgsSchema>

/**
 * O pedido de iniciarCorte: corta (e reconhece) o episodio do indice
 * `episodioId` em segundo plano. O arquivo e o nome saem do indice; `palpite`
 * so quando o usuario corrigiu o nome depois de indexar as falas.
 */
export const pedidoDeCorteSchema = z.object({
  episodioId: z.string().regex(/^ep_[0-9a-f]{40}$/),
  motor: motorSchema,
  reconhecer: z.boolean(),
  palpite: palpiteDoEpisodioSchema.optional(),
})
export type PedidoDeCorte = z.infer<typeof pedidoDeCorteSchema>

/** main -> renderer (canal corteProgresso), a cada mudanca do corte em segundo plano. */
export interface EventoDoCorte {
  episodioId: string
  estado: EstadoDoCorte
  /** O indice COM os planos, so quando o status vira 'pronto'. null nas outras vezes. */
  indice: EpisodeIndex | null
  /**
   * So no 'pronto' com reconhecimento: de onde vieram as fotos do elenco quando
   * nao foi a busca online ('Corte Cenas', da reserva). Igual ao do fim da
   * analise; a tela diz "Fotos do elenco: Corte Cenas".
   */
  fotosDoElenco?: string | null
}

// ------------------------------------------------------------------- uteis puros

/**
 * A pasta do episodio no formato do motor: 'S04E37', 'S01-OP2', 'Filme (2019)'.
 * Espelha `EpisodeInfo.slug` de motor/app/video_ingest.py.
 */
export function slugDoEpisodio(temporada: number, episodio: number, kind: KindDoEpisodio): string {
  const dois = (n: number): string => String(n).padStart(2, '0')
  if (kind === 'MOVIE') return episodio > 1900 ? `Filme (${episodio})` : 'Filme'
  if (kind) return `S${dois(temporada)}-${kind}${episodio}`
  return `S${dois(temporada)}E${dois(episodio)}`
}

/** O status do corte do indice. Ausente = 'pronto' (indice de antes do corte em segundo plano). */
export function statusDoCorte(indice: Pick<EpisodeIndex, 'corte'>): StatusDoCorte {
  return indice.corte?.status ?? 'pronto'
}

/** O indice ja tem as cenas (o passo 2 mostra miniaturas, o passo 4 abre). */
export function temPlanos(indice: Pick<EpisodeIndex, 'planos'>): boolean {
  return indice.planos.length > 0
}

/**
 * O2: o .mkv reaberto pelo dialogo (sem rascunho: o passo 1) cujo corte por
 * tras nao acabou. Em vez do "Episodio novo / Analisar" de novo, o passo 1
 * volta onde estava: o resumo com as falas e o corte seguindo (`retomar`), ou
 * o "Corte parou" com os botoes dele (o anime nao achado: Buscar elenco e
 * Reconhecer na mao, sem cortar de novo). O nome e a legenda sao os do indice
 * (o nome corrigido na tela nao volta ao do arquivo).
 */
export interface CorteParado {
  palpite: PalpiteDoEpisodio
  faixaLegenda: number | null
  motor: Motor
  reconhecer: boolean
  /** true = o corte recomeca (ou segue, se ainda vivo no main); false = so abre. */
  retomar: boolean
}

/**
 * A regra do CorteParado, pura (o teste). `vivo` = o main ainda corta (ou tem
 * na fila) este episodio. null = nada a retomar: ja tem as cenas, nunca pediu
 * corte, ou ele cancelou (Cancelar nao volta sozinho, como no "Continuar").
 */
export function corteParado(
  indice: Pick<EpisodeIndex, 'planos' | 'corte' | 'anime' | 'temporada' | 'episodio' | 'kind' | 'faixaLegenda'>,
  vivo: boolean,
): CorteParado | null {
  const c = indice.corte
  if (!c || temPlanos(indice)) return null
  const base = {
    palpite: { anime: indice.anime, temporada: indice.temporada, episodio: indice.episodio, kind: indice.kind },
    faixaLegenda: indice.faixaLegenda?.index ?? null,
    motor: c.motor,
    reconhecer: c.reconhecer,
  }
  if (vivo) return { ...base, retomar: true }
  // 'cortando' no disco sem job vivo: o app fechou (ou caiu) no meio.
  if (c.status === 'cortando') return { ...base, retomar: true }
  // Parou pedindo o elenco: os grupos de rostos estao gravados; nada de cortar de novo.
  if (c.status === 'falhou' && c.descoberta) return { ...base, retomar: false }
  return null
}

/** O que o corte traz para anexar ao indice que nasceu so com as falas. */
export interface PlanosDoCorte {
  /** Ja cruzados com as cues DESTE indice (montarPlanos do main, com as mesmas cues). */
  planos: Plano[]
  /** A pasta que o motor gravou (a que tem shots/). */
  biblioteca: BibliotecaDoEpisodio
  reconhecimento: EpisodeIndex['reconhecimento']
  /** Avisos do corte (tempo, outro arquivo), somados aos do indice. */
  avisos?: string[]
}

/**
 * ANEXA os planos ao indice que esperava o corte. Fica tudo que o usuario e o
 * roteiro ja usam -- id, fonte, nome, faixa, cues e exclusoes (inclusive as
 * mexidas na regua) e criadoEm --; mudam so os planos, a biblioteca, o
 * reconhecimento, os avisos e o corte ('pronto'). Lanca (zod) se um plano cita
 * cue que o indice nao tem: sinal de que os planos foram cruzados com outra
 * legenda.
 */
export function anexarPlanos(indice: EpisodeIndex, corte: PlanosDoCorte, agoraIso: string): EpisodeIndex {
  const avisos = [...indice.avisos]
  for (const a of corte.avisos ?? []) if (!avisos.includes(a)) avisos.push(a)
  const anterior = indice.corte
  return episodeIndexSchema.parse({
    ...indice,
    planos: corte.planos,
    biblioteca: corte.biblioteca,
    reconhecimento: corte.reconhecimento,
    avisos,
    atualizadoEm: agoraIso,
    corte: {
      status: 'pronto',
      jobId: null,
      progresso: 1,
      etapa: null,
      mensagem: '',
      motor: anterior?.motor ?? 'studio',
      reconhecer: anterior?.reconhecer ?? corte.reconhecimento === 'feito',
      erro: null,
      inicio: anterior?.inicio ?? null,
      atualizadoEm: agoraIso,
      descoberta: null,
    },
  } satisfies EpisodeIndex)
}

/** 1 -> 'c0001'. A contagem comeca em 1, na ordem de inicio das cues. */
export function idDaCue(n: number): string {
  return `c${String(n).padStart(4, '0')}`
}

/** Rotulos de tela (ASCII, como o resto da interface). */
export const ROTULO_DA_ORIGEM: Record<OrigemDaBiblioteca, string> = {
  // [recap] No Dangai a biblioteca onde o recap grava e a "Biblioteca do recap".
  studio: 'Recap',
  ancut: 'AnCut HUB',
  cortecenas: 'Corte Cenas',
  // A raiz herdada do Dangai (settings.libraryDir) e a pasta onde o AnCut
  // grava: o mesmo nome que as Configuracoes dao a ela.
  dangai: 'Biblioteca do AnCut',
}

export const ROTULO_DA_ETAPA: Record<EtapaDaAnalise, string> = {
  preparando: 'Preparando',
  detectando: 'Achando os cortes',
  cortando: 'Cortando as cenas',
  elenco: 'Buscando o elenco',
  personagens: 'Reconhecendo personagens',
  organizando: 'Finalizando',
}

export const ROTULO_DO_MOTIVO: Record<MotivoDaExclusao, string> = {
  op: 'Abertura',
  ed: 'Encerramento',
  preview: 'Previa',
  creditos: 'Creditos',
  // O mesmo nome na regua e no select: dois nomes para a mesma marcacao confundiam.
  manual: 'Outro',
}

/** O que a tela de resumo do passo 1 mostra. */
export interface ResumoDoIndice {
  totalCenas: number
  /** Cenas com pelo menos uma cue de fala. */
  cenasComFala: number
  totalFalas: number
  /** Falantes do .ass e quantas falas cada um tem, do que mais fala ao que menos. */
  falantes: { nome: string; falas: number }[]
  /** Personagens reconhecidos e em quantas cenas, do mais frequente ao menos. */
  personagens: { nome: string; cenas: number }[]
  /** Segundos dentro de exclusoes (sugeridas e confirmadas). */
  excluidoSec: number
  /** Sugestoes que o usuario ainda nao confirmou. */
  exclusoesPendentes: number
}

export function resumirIndice(indice: EpisodeIndex): ResumoDoIndice {
  const falas = indice.cues.filter((c) => c.tipo === 'fala')
  const porFalante = new Map<string, number>()
  for (const cue of falas) {
    if (cue.falante) porFalante.set(cue.falante, (porFalante.get(cue.falante) ?? 0) + 1)
  }
  const tipoDaCue = new Map(indice.cues.map((c) => [c.id, c.tipo]))
  // Indice montado antes de o indice.ts unir as grafias ("Saionji, Ukyou" e
  // "Ukyo Saionji") ainda as traz separadas: a contagem une do mesmo jeito, e
  // num indice novo nao muda nada.
  const crus = new Map<string, number>()
  for (const plano of indice.planos) for (const p of plano.personagens) crus.set(p.nome, (crus.get(p.nome) ?? 0) + 1)
  const unido = canonizar(crus)
  const porPersonagem = new Map<string, number>()
  let cenasComFala = 0
  for (const plano of indice.planos) {
    if (plano.cueIds.some((id) => tipoDaCue.get(id) === 'fala')) cenasComFala += 1
    for (const nome of new Set(plano.personagens.map((p) => unido.get(p.nome) ?? p.nome))) {
      porPersonagem.set(nome, (porPersonagem.get(nome) ?? 0) + 1)
    }
  }
  const ordenar = <K extends string>(mapa: Map<string, number>, chave: K): ({ nome: string } & Record<K, number>)[] =>
    [...mapa.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
      .map(([nome, n]) => ({ nome, [chave]: n }) as { nome: string } & Record<K, number>)
  return {
    totalCenas: indice.planos.length,
    cenasComFala,
    totalFalas: falas.length,
    falantes: ordenar(porFalante, 'falas'),
    personagens: ordenar(porPersonagem, 'cenas'),
    excluidoSec: indice.exclusoes.reduce((s, e) => s + Math.max(0, e.end - e.start), 0),
    exclusoesPendentes: indice.exclusoes.filter((e) => !e.confirmada).length,
  }
}
