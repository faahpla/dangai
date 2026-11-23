/**
 * O ANCUT DENTRO DO DANGAI (20/11): "a ideia e ter a estrutura do AnCut no
 * Dangai e poupar trabalho de ter 2 apps que fazem a mesma coisa" -- cortar o
 * episodio, revisar personagens, excluir, juntar, baixar B-roll. O Levi deixou.
 *
 * O CORTE E O DO PROPRIO ANCUT: o Dangai fala com o MESMO motor instalado
 * (E:\Apps\AnCut HUB\engine\CorteCenas.exe), pelos mesmos comandos da tela
 * do AnCut (electron/services/ancut). Assim o episodio sai igualzinho -- a
 * mesma pasta em D:\Animes, o mesmo banco (index.db), os mesmos personagens --
 * e os dois apps convivem sem um bagunçar o outro. Juntar o motor dentro do
 * Dangai (o do Gerar recap do Levi) e um passo depois, combinado com ele.
 *
 * Aqui: o contrato entre o main e a tela, e as contas puras (o pedido que vai
 * ao motor, o evento que volta, o andamento geral). Os nomes dos campos do
 * motor (snake/camelCase do AnCut) so aparecem em `pedidoParaOMotor` e
 * `eventoDoMotor`: o resto do Dangai fala portugues.
 */

/** '' = episodio; 'BROLL' = video avulso (trailer, gameplay), sem temporada nem episodio. */
export type TipoDoCorte = '' | 'BROLL'

/**
 * "Só cortar": pica o episodio em cenas, sem internet e sem reconhecer
 * ninguem -- o rapido, o de todo dia dele. "Cortar e reconhecer": a Analise
 * rapida do AnCut -- reconhece quem o app ja conhece (o elenco do AniList e
 * quem foi batizado antes). "Batizar": o Modo Descoberta do AnCut (23/11) --
 * agrupa os rostos do proprio episodio e ele da os nomes no fim (anime que o
 * AniList nao tem, personagem novo); os nomeados viram referencia para os
 * proximos episodios.
 */
export type ModoDoCorte = 'cortar' | 'reconhecer' | 'batizar'

export interface PedidoDeCorte {
  video: string
  anime: string
  temporada: number
  episodio: number
  tipo: TipoDoCorte
  modo: ModoDoCorte
  /** B-roll: o nome do video (vira o nome da pasta) e o link de onde veio. */
  titulo?: string
  origem?: string
  /** A pasta do anime dentro da saida; vazio = o motor decide (a memoria de pastas dele). */
  pastaDoAnime?: string
}

/** O que o motor deduz do nome do arquivo ("[SubsPlease] Kusuriya no Hitorigoto - 30"). */
export interface NomeLido {
  anime: string
  temporada: number
  episodio: number
  tipo: TipoDoCorte
}

/** O motor do AnCut nesta maquina. */
export interface MotorDoAncut {
  achado: boolean
  /** De onde veio ("Motor do Dangai", "AnCut HUB instalado"). */
  origem: string
  /** O do Dangai (baixado pela tela), o do AnCut instalado, ou o de teste. null = nenhum. */
  qual: 'dangai' | 'ancut' | 'teste' | null
  /** A versao do motor (o `probe`); null = nao respondeu. */
  versao: string | null
  /** A placa que ele usa ("NVIDIA GeForce RTX 3060"); null = CPU. */
  placa: string | null
  /** A pasta de saida das configuracoes do AnCut (D:\Animes). */
  saida: string | null
  /** Sem motor: o que fazer. */
  motivo?: string
}

/** As configuracoes do AnCut que o pedido usa (o config.json dele, em snake_case). */
export interface ConfigDoMotor {
  output_dir?: string
  default_threshold?: number
  argmax_margin?: number
  min_shots_per_character?: number
  face_crop_padding?: number
  credit_edge_threshold?: number
  use_danbooru?: boolean
  media_kind?: string
  render_export_mode?: string
  pular_capitulos?: boolean
}

/**
 * As etapas do corte, na ordem do motor (STAGES de app/pipeline_types.py), com
 * o nome que ele entende e o peso de cada uma no andamento geral. Os pesos sao
 * os de um episodio de 24 min numa RTX 3060: no "Só cortar" so as quatro do
 * corte contam.
 */
export const ETAPAS_DO_CORTE = [
  { id: 'parse', rotulo: 'Lendo o arquivo', peso: 2, soCorte: true },
  { id: 'detect_shots', rotulo: 'Achando as cenas', peso: 30, soCorte: true },
  { id: 'cut_shots', rotulo: 'Cortando os clipes', peso: 40, soCorte: true },
  { id: 'fetch_characters', rotulo: 'Buscando os personagens', peso: 2, soCorte: false },
  { id: 'download_refs', rotulo: 'Baixando as fotos dos personagens', peso: 4, soCorte: false },
  // No "Só cortar" o motor tambem passa por aqui (prepara as cenas para a busca): o nome serve aos dois.
  { id: 'embed_refs', rotulo: 'Preparando as cenas', peso: 4, soCorte: false },
  { id: 'analyze_shots', rotulo: 'Reconhecendo os personagens', peso: 12, soCorte: false },
  { id: 'second_pass', rotulo: 'Conferindo as cenas parecidas', peso: 2, soCorte: false },
  { id: 'ai_review', rotulo: 'Revisão por IA', peso: 0, soCorte: false },
  { id: 'organize', rotulo: 'Organizando as pastas', peso: 4, soCorte: true },
] as const

export type EtapaDoCorte = (typeof ETAPAS_DO_CORTE)[number]['id']

/** O que volta do motor durante um corte, ja em portugues. */
export type EventoDoCorte =
  | { tipo: 'etapa'; etapa: string; rotulo: string; fracao: number; mensagem: string }
  | {
      tipo: 'pronto'
      episodioId: number
      /** A pasta do episodio cortado (onde a Biblioteca o acha). */
      pasta: string
      cenas: number
      personagens: string[]
      anime: string
      temporada: number
      episodio: number
    }
  | { tipo: 'falhou'; mensagem: string }
  | { tipo: 'cancelado' }
  /**
   * O motor parou e precisa de uma decisao (o needs-input do AnCut): o anime
   * nao esta no AniList, ou o elenco ficou sem fotos. O motor ja saiu: a
   * resposta e um corte novo, no modo 'batizar' (ou 'cortar').
   */
  | { tipo: 'pergunta'; motivo: 'anime-nao-achado' | 'sem-fotos' | 'outra'; mensagem: string; pastaDasFotos?: string }
  /**
   * O batismo esta pronto (o discovery-ready do AnCut): os grupos de rostos
   * esperando nome. O motor CONTINUA aberto ate a resposta (responderBatismo)
   * -- os recortes e as contas nao sobreviveriam a uma ida ao disco.
   */
  | { tipo: 'batismo'; batismo: BatismoDoMotor }

/** Um "personagem sem nome" que o agrupamento achou. */
export interface GrupoDoBatismo {
  chave: number
  rostos: number
  cenas: number
  /** Os recortes que viram referencia (URL para a tela; o indice vai em `removidos`). */
  recortes: string[]
  /** O palpite ("parece a Maomao") e a semelhanca. */
  sugestao: string
  semelhanca: number
  /** Figurante de fundo (ou mais nuca que rosto): fica atras de um botao. */
  figurante: boolean
  /** Reconhecido com folga como alguem batizado antes: ja vem com nome. */
  conhecido: boolean
  /** Ate 3 palpites, do mais parecido para o menos. */
  palpites: { nome: string; semelhanca: number }[]
}

/** O batismo de um episodio: os grupos e o elenco para escolher o nome. */
export interface BatismoDoMotor {
  pasta: string
  anime: string
  temporada: number
  episodio: number
  rostos: number
  /** O anime foi achado online: o elenco oficial vira sugestao. */
  online: boolean
  /** Os nomes do elenco (o autocompletar). */
  elenco: string[]
  /** O elenco com foto (URL para a tela; vazia = sem foto). */
  fotos: { nome: string; foto: string }[]
  grupos: GrupoDoBatismo[]
}

/** Os nomes dados no batismo (o commit-discovery do AnCut). */
export interface RespostaDoBatismo {
  /** chave do grupo -> nome (vazio = ignorar). Dois grupos com o mesmo nome viram um so. */
  nomes: Record<number, string>
  /** chave do grupo -> indices dos recortes que NAO viram referencia. */
  removidos: Record<number, number[]>
}

/** O nome de uma etapa do motor (a desconhecida, um motor mais novo, vai como veio). */
export function rotuloDaEtapa(id: string): string {
  return ETAPAS_DO_CORTE.find((e) => e.id === id)?.rotulo ?? id
}

/**
 * O ANDAMENTO GERAL (0..1): as etapas que ja passaram mais o pedaco da atual.
 * `fracao` -1 (o motor nao sabe quanto falta) conta como metade da etapa.
 */
export function andamentoGeral(etapa: string, fracao: number, modo: ModoDoCorte): number {
  const conta = ETAPAS_DO_CORTE.filter((e) => modo !== 'cortar' || e.soCorte)
  const total = conta.reduce((s, e) => s + e.peso, 0)
  const i = conta.findIndex((e) => e.id === etapa)
  if (i < 0 || total <= 0) return 0
  const antes = conta.slice(0, i).reduce((s, e) => s + e.peso, 0)
  const parte = fracao < 0 ? 0.5 : Math.max(0, Math.min(1, fracao))
  return Math.max(0, Math.min(1, (antes + conta[i]!.peso * parte) / total))
}

/**
 * O PEDIDO QUE O MOTOR ENTENDE (o `toWireRequest` do AnCut). As opcoes que
 * nao vem do episodio (pasta de saida, sensibilidade do reconhecimento, tipo
 * de midia, formato dos clipes) saem das configuracoes do AnCut -- as mesmas
 * que a tela dele usa: os dois apps cortam igual.
 */
export function pedidoParaOMotor(p: PedidoDeCorte, cfg: ConfigDoMotor, saida: string): Record<string, unknown> {
  const broll = p.tipo === 'BROLL'
  const num = (v: unknown, padrao: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : padrao)
  return {
    videoPath: p.video,
    anime: p.anime.trim(),
    season: broll ? 1 : Math.max(1, Math.trunc(p.temporada)),
    // B-roll vai com 0: o motor escolhe o proximo numero livre ("B-roll 03").
    episode: broll ? 0 : Math.max(0, Math.trunc(p.episodio)),
    kind: p.tipo,
    outputDir: saida,
    outputFolder: p.pastaDoAnime ?? '',
    skipHeadSeconds: 0,
    skipTailSeconds: 0,
    params: {
      threshold: num(cfg.default_threshold, 0.8),
      margin: num(cfg.argmax_margin, 0.03),
      minShots: num(cfg.min_shots_per_character, 3),
      padding: num(cfg.face_crop_padding, 0.25),
      credit: num(cfg.credit_edge_threshold, 0.55),
    },
    aiReview: false,
    // O batismo: o motor para no fim com os grupos de rostos e espera os nomes (responderBatismo).
    discovery: p.modo === 'batizar' && !broll,
    // B-roll e sempre so corte: trailer de jogo nao tem elenco.
    cutOnly: p.modo === 'cortar' || broll,
    // A Analise rapida soma por cima do que ja existe (nao apaga marcacao a mao).
    mergePrevious: p.modo === 'reconhecer' && !broll,
    skipCreditShots: false,
    skipChapters: cfg.pular_capitulos !== false,
    useDanbooru: cfg.use_danbooru === true,
    mediaKind: cfg.media_kind === 'live' ? 'live' : 'anime',
    renderExportMode: cfg.render_export_mode === 'off' || cfg.render_export_mode === 'intra' ? cfg.render_export_mode : 'compat',
    titulo: p.titulo ?? '',
    origem: p.origem ?? '',
  }
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')
const numero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * O evento do motor (uma linha JSON do canal dele) no evento do Dangai. null =
 * o que a tela nao mostra (log solto, tempos por etapa).
 *
 * A pergunta do motor ("anime nao encontrado", "faltam fotos dos
 * personagens") vira falha com o motivo e o que fazer -- como na Analise
 * rapida da fila do AnCut: ele sai depois de perguntar, e quem responderia e
 * a tela de batismo, que mora no AnCut.
 */
export function eventoDoMotor(cru: unknown): EventoDoCorte | null {
  if (!cru || typeof cru !== 'object') return null
  const e = cru as Record<string, unknown>
  switch (e['type']) {
    case 'stage': {
      const etapa = texto(e['stage'])
      const fracao = typeof e['fraction'] === 'number' ? e['fraction'] : -1
      return { tipo: 'etapa', etapa, rotulo: rotuloDaEtapa(etapa), fracao, mensagem: texto(e['message']) }
    }
    case 'done': {
      const r = (e['result'] && typeof e['result'] === 'object' ? e['result'] : {}) as Record<string, unknown>
      const nomes = Array.isArray(r['identifiedCharacters']) ? (r['identifiedCharacters'] as unknown[]).filter((n): n is string => typeof n === 'string') : []
      return {
        tipo: 'pronto',
        episodioId: numero(r['episodeId']),
        pasta: texto(r['episodeRoot']),
        cenas: numero(r['totalShots']),
        personagens: nomes,
        anime: texto(r['animeTitle']),
        temporada: numero(r['season']),
        episodio: numero(r['episode']),
      }
    }
    case 'failed':
      return { tipo: 'falhou', mensagem: texto(e['message']) || 'O corte falhou.' }
    case 'cancelled':
      return { tipo: 'cancelado' }
    case 'needs-input': {
      const tipo = texto(e['kind'])
      const pastaDasFotos = texto(e['refsDir']) || undefined
      if (tipo === 'anime-not-found') {
        return {
          tipo: 'pergunta',
          motivo: 'anime-nao-achado',
          mensagem: 'Não achei esse anime no AniList nem no MyAnimeList, e ainda não há personagens batizados dele. Confira o nome, ou batize na mão: o Dangai agrupa os rostos do episódio e você dá os nomes.',
        }
      }
      if (tipo === 'refs-missing') {
        return {
          tipo: 'pergunta',
          motivo: 'sem-fotos',
          mensagem: 'Nenhum personagem desse anime tem fotos boas para reconhecer. Batize na mão: o Dangai agrupa os rostos do episódio e você dá os nomes.',
          ...(pastaDasFotos ? { pastaDasFotos } : {}),
        }
      }
      return { tipo: 'pergunta', motivo: 'outra', mensagem: texto(e['message']) || 'O motor precisa de uma decisão.' }
    }
    case 'discovery-ready':
      return { tipo: 'batismo', batismo: batismoDoMotor(e) }
    default:
      return null
  }
}

/**
 * O discovery-ready do motor no batismo do Dangai. Os recortes e as fotos vem
 * RELATIVOS a pasta do episodio: o main troca por URL (motor.ts) antes de
 * mandar para a tela.
 */
export function batismoDoMotor(e: Record<string, unknown>): BatismoDoMotor {
  const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const grupos = lista(e['groups']).flatMap((g): GrupoDoBatismo[] => {
    if (!g || typeof g !== 'object') return []
    const o = g as Record<string, unknown>
    const shots = numero(o['shots'])
    return [
      {
        chave: numero(o['key']),
        rostos: numero(o['faces']),
        cenas: shots,
        recortes: lista(o['crops']).filter((c): c is string => typeof c === 'string'),
        sugestao: texto(o['suggestedName']),
        semelhanca: numero(o['suggestedSim']),
        // Motor velho sem `minor`: o piso de antes (menos de 2 cenas).
        figurante: o['known'] !== true && (typeof o['minor'] === 'boolean' ? o['minor'] : shots < 2),
        conhecido: o['known'] === true,
        palpites: lista(o['candidates']).flatMap((c) => {
          if (!c || typeof c !== 'object') return []
          const p = c as Record<string, unknown>
          const nome = texto(p['name'])
          return nome ? [{ nome, semelhanca: numero(p['sim']) }] : []
        }),
      },
    ]
  })
  return {
    pasta: texto(e['episodeRoot']),
    anime: texto(e['animeTitle']),
    temporada: numero(e['season']),
    episodio: numero(e['episode']),
    rostos: numero(e['totalFaces']),
    online: e['online'] === true,
    elenco: lista(e['roster']).filter((n): n is string => typeof n === 'string'),
    fotos: lista(e['cast']).flatMap((c) => {
      if (!c || typeof c !== 'object') return []
      const o = c as Record<string, unknown>
      const nome = texto(o['name'])
      return nome ? [{ nome, foto: texto(o['photo']) }] : []
    }),
    grupos,
  }
}

/** "Episódio 30 · temporada 1" -- o que o item da fila mostra. */
export function rotuloDoEpisodio(p: Pick<PedidoDeCorte, 'tipo' | 'temporada' | 'episodio' | 'titulo'>): string {
  if (p.tipo === 'BROLL') return p.titulo ? `B-roll · ${p.titulo}` : 'B-roll'
  const pad = (n: number): string => String(Math.max(0, Math.trunc(n))).padStart(2, '0')
  return `S${pad(p.temporada)}E${pad(p.episodio)}`
}

// ------------------------------------------------------------- a revisao

/** Um personagem, como o banco do AnCut o tem. */
export interface PersonagemDoAncut {
  id: number
  nome: string
  /** Em quantas cenas DESTE episodio ele esta (0 = do anime, ainda nao neste episodio). */
  cenas: number
}

/** A cena de um episodio do AnCut, vista da Biblioteca. */
export interface CenaNoAncut {
  episodioId: number
  cenaId: number
  anime: string
  /** Quem esta marcado nesta cena agora. */
  personagens: PersonagemDoAncut[]
  /** Os personagens do anime (os do episodio primeiro): de onde se escolhe quem marcar. */
  doAnime: PersonagemDoAncut[]
}

/** O que apagar um episodio inteiro faria (ou fez). */
export interface PlanoDeApagarEpisodio {
  episodioId: number
  pasta: string
  cenas: number
  bytes: number
  /** O motor so apaga pasta DENTRO da saida configurada (a trava dele). */
  pode: boolean
  motivo: string
  aplicado: boolean
  /**
   * Quantos outros episodios do historico usam a MESMA pasta (filme sem
   * SxxExx: cada grafia do titulo vira um registro na mesma pasta). Com
   * algum, o motor tira so o registro: os arquivos ficam para os outros.
   */
  outrosNaPasta: number
  /** A pasta ainda esta no disco (sem ela, so o registro sai do historico). */
  pastaExiste: boolean
}

// ------------------------------------------------------------- o B-roll por link

/** Um video achado num link (uma playlist traz varios). */
export interface VideoDoLink {
  id: string
  titulo: string
  url: string
  /** Segundos; 0 quando o site nao diz. */
  duracao: number
}

export type QualidadeDoDownload = '1080' | 'max'

export interface PedidoDeDownload {
  url: string
  /** Onde o video baixado fica guardado (a "Baixados" do anime). */
  pasta: string
  qualidade: QualidadeDoDownload
}

export interface VideoBaixado {
  arquivo: string
  titulo: string
  /** O link do video (nao o da playlist): a identidade do B-roll. */
  origem: string
}

/** O que o baixador esta fazendo (main -> tela). */
export type EventoDoDownload =
  | { tipo: 'ferramenta'; mensagem: string; fracao: number }
  | { tipo: 'progresso'; fracao: number; velocidade: string; falta: string; fase: 'video' | 'audio' | 'juntando' }

/** "Official Trailer [abc123def45].mp4" -> "Official Trailer". */
export function tituloDoArquivoBaixado(arquivo: string): string {
  const nome = arquivo.split(/[\\/]/).pop() ?? arquivo
  return nome.replace(/\s*\[[^\]]+\].*$/, '').replace(/\.[^.]+$/, '')
}

// ------------------------------------------------------------- organizar (23/11)

/** Um personagem de um episodio, com quantas cenas tem nele. */
export interface PersonagemDoEpisodio {
  id: number
  nome: string
  cenas: number
}

/** Um episodio do AnCut visto da Biblioteca (o `results` do motor). */
export interface EpisodioNoAncut {
  episodioId: number
  anime: string
  temporada: number
  episodio: number
  /** '' = episodio; 'BROLL'; o que mais o motor mandar ("MOVIE"). */
  tipo: string
  titulo: string
  pasta: string
  /** A pasta do anime (a de cima da do episodio). */
  pastaDoAnime: string
  cenas: number
  semPersonagem: number
  personagens: PersonagemDoEpisodio[]
  /** O video de onde saiu (para reconhecer depois de um "Só cortar"). */
  video: string
  videoExiste: boolean
}

/** Juntar duas pastas de anime: o plano (e, aplicado, o que foi feito). */
export interface PlanoDeJuntarAnimes {
  origem: string
  destino: string
  /** Pastas de episodio que vao (ou foram) para o destino. */
  mover: string[]
  conflitos: string[]
  linhas: number
  erro: string
  pode: boolean
  aplicado: boolean
}

/** Mudar a temporada (ou passar para B-roll): o que muda de nome. */
export interface PlanoDeRenomear {
  mudancas: { episodioId: number; de: string; para: string }[]
  conflitos: string[]
  erro: string
  pode: boolean
  aplicado: boolean
}

/** O andamento de um reforco ou de uma repescagem (main -> tela). */
export type EventoDeOrganizar =
  | { tipo: 'reforcar'; nome: string; feitos: number; total: number }
  | { tipo: 'repescar'; feitos: number; total: number; cenas: number }

export interface FimDoReforco {
  /** nome -> quantas fotos entraram. */
  adicionadas: Record<string, number>
  total: number
  personagens: number
  erro?: string
}

export interface FimDaRepescagem {
  episodios: number
  /** Cenas que ganharam personagem. */
  cenas: number
  porPersonagem: Record<string, number>
  erro?: string
}
