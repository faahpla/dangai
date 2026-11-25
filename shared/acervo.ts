/**
 * O ACERVO (25/11, "assim como no AnCut eu tenha a tela de personagens,
 * juntar personagem, marcar uma cena com tal personagem... eu preciso da
 * biblioteca assim como no AnCut: saber o que eu ja cortei, o que preciso
 * cortar, e o exportar pacote de elenco, pois o Levi usa bastante").
 *
 * A Biblioteca do AnCut dentro do Dangai: os animes cortados em capas, a
 * pagina de cada um (temporadas, episodios, o que falta), o episodio aberto
 * (as cenas por personagem e as sem ninguem), os personagens do acervo
 * inteiro e o pacote de elenco. Tudo vem do motor (os comandos `recent`,
 * `characters`, `character-shots`, `shots`, `cast-*` do app.headless) e
 * tudo que muda e pelo motor; aqui so o contrato e as contas puras (agrupar
 * por anime, o que falta, o numero do episodio pelo nome do arquivo).
 */

/** '' = episodio; 'OP'/'ED' = abertura/encerramento; 'MOVIE' = filme; 'BROLL'. */
export type TipoDoEpisodio = '' | 'OP' | 'ED' | 'MOVIE' | 'BROLL'

/** Um episodio cortado (o `recent` do motor, com a capa em URL e o video de origem). */
export interface EpisodioDoAcervo {
  episodioId: number
  anime: string
  temporada: number
  episodio: number
  tipo: TipoDoEpisodio
  pasta: string
  cenas: number
  /** Cenas com alguem marcado. */
  marcadas: number
  /** ISO, ou '' (o motor nao gravou). */
  cortadoEm: string
  /** A capa (um quadro do episodio), em URL; '' = sem. */
  capa: string
  /** B-roll: o nome do video e o link. */
  titulo: string
  origem: string
  /** O video de onde saiu ('' = o banco nao guardou). */
  video: string
}

/** Um episodio que o historico tem e a pasta sumiu do disco. */
export interface EpisodioSemPasta {
  episodioId: number
  anime: string
  temporada: number
  episodio: number
  tipo: TipoDoEpisodio
  titulo: string
  pasta: string
}

/** Um video na pasta de onde os episodios vieram, ainda nao cortado. */
export interface ParaCortar {
  arquivo: string
  /** O numero que o nome do arquivo diz (null = nao deu para ler). */
  episodio: number | null
  /** A temporada que a pasta costuma ter (a dos episodios cortados de la). */
  temporada: number
}

export interface Acervo {
  episodios: EpisodioDoAcervo[]
  semPasta: EpisodioSemPasta[]
  /** pasta do anime (minusculas) -> videos ainda nao cortados nas pastas de origem. */
  paraCortar: Record<string, ParaCortar[]>
  /** A pasta de saida do motor (D:\Animes). */
  saida: string | null
}

export interface Temporada {
  numero: number
  episodios: EpisodioDoAcervo[]
  cenas: number
  /** Os numeros que faltam entre 1 e o maior cortado (so episodio comum). */
  faltam: number[]
}

export interface AnimeDoAcervo {
  /** A pasta do anime no disco: a identidade do grupo. */
  pasta: string
  /** O nome da pasta (o rotulo). */
  nome: string
  /** Os titulos que o motor gravou (mais de um = a pasta junta nomes diferentes). */
  titulos: string[]
  temporadas: Temporada[]
  broll: EpisodioDoAcervo[]
  /** Episodios das temporadas (sem o B-roll). */
  episodios: number
  cenas: number
  marcadas: number
  capa: string
  /** O corte mais recente (ISO). */
  recente: string
  /** So filme (B-roll nao conta). */
  filme: boolean
}

/** Pedacos de um caminho, aceitando as duas barras. */
function pedacos(caminho: string): string[] {
  return caminho.split(/[\\/]+/).filter(Boolean)
}

/** A pasta do anime de um episodio: a mae da pasta dele. */
export function pastaDoAnime(pastaDoEpisodio: string): string {
  const partes = pedacos(pastaDoEpisodio)
  if (partes.length < 2) return pastaDoEpisodio
  const sep = pastaDoEpisodio.includes('\\') ? '\\' : '/'
  const corpo = partes.slice(0, -1).join(sep)
  // "D:" sozinho perderia a barra da raiz.
  return /^[A-Za-z]:$/.test(corpo) ? `${corpo}${sep}` : pastaDoEpisodio.startsWith(sep) && !corpo.startsWith(sep) ? `${sep}${corpo}` : corpo
}

const PESO: Record<TipoDoEpisodio, number> = { '': 0, OP: 1, ED: 2, MOVIE: 3, BROLL: 4 }
const porNome = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

/**
 * Os numeros que faltam numa temporada: de 1 ate o maior cortado, so os
 * episodios comuns (abertura e encerramento tem numeracao propria). Uma
 * temporada que comeca alto (o S02 numerado 13, 14...) conta a partir do
 * menor: "faltam 1 a 12" seria mentira.
 */
export function faltando(numeros: readonly number[]): number[] {
  const vistos = [...new Set(numeros.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b)
  if (vistos.length === 0) return []
  const menor = vistos[0]! <= 3 ? 1 : vistos[0]!
  const maior = vistos[vistos.length - 1]!
  const tem = new Set(vistos)
  const saida: number[] = []
  for (let n = menor; n <= maior; n++) if (!tem.has(n)) saida.push(n)
  return saida
}

/** Agrupa os episodios em anime -> temporada -> episodio (pela pasta, como o AnCut). */
export function agruparPorAnime(episodios: readonly EpisodioDoAcervo[]): AnimeDoAcervo[] {
  const grupos = new Map<string, AnimeDoAcervo>()
  for (const ep of episodios) {
    const pasta = pastaDoAnime(ep.pasta)
    const chave = pasta.toLowerCase()
    let a = grupos.get(chave)
    if (!a) {
      a = {
        pasta,
        nome: pedacos(pasta).at(-1) || pasta || 'Sem pasta',
        titulos: [],
        temporadas: [],
        broll: [],
        episodios: 0,
        cenas: 0,
        marcadas: 0,
        capa: '',
        recente: '',
        filme: false,
      }
      grupos.set(chave, a)
    }
    a.cenas += ep.cenas
    a.marcadas += ep.marcadas
    if (ep.cortadoEm > a.recente) {
      a.recente = ep.cortadoEm
      if (ep.capa) a.capa = ep.capa
    }
    if (!a.capa && ep.capa) a.capa = ep.capa
    if (ep.anime && !a.titulos.includes(ep.anime)) a.titulos.push(ep.anime)
    if (ep.tipo === 'BROLL') {
      a.broll.push(ep)
      continue
    }
    if (ep.tipo === 'MOVIE') {
      if (a.episodios === 0 || a.filme) a.filme = true
    } else {
      a.filme = false
    }
    let t = a.temporadas.find((x) => x.numero === ep.temporada)
    if (!t) {
      t = { numero: ep.temporada, episodios: [], cenas: 0, faltam: [] }
      a.temporadas.push(t)
    }
    t.episodios.push(ep)
    t.cenas += ep.cenas
    a.episodios += 1
  }
  const lista = [...grupos.values()]
  for (const a of lista) {
    a.titulos.sort(porNome.compare)
    a.temporadas.sort((x, y) => x.numero - y.numero)
    a.broll.sort((x, y) => x.episodio - y.episodio)
    for (const t of a.temporadas) {
      t.episodios.sort((x, y) => PESO[x.tipo] - PESO[y.tipo] || x.episodio - y.episodio)
      t.faltam = a.filme ? [] : faltando(t.episodios.filter((e) => e.tipo === '').map((e) => e.episodio))
    }
  }
  lista.sort((x, y) => porNome.compare(x.nome, y.nome))
  return lista
}

/** Filtra pelo texto, mantendo o anime inteiro quando o nome dele bate. */
export function filtrarAnimes(animes: readonly AnimeDoAcervo[], busca: string): AnimeDoAcervo[] {
  const alvo = busca.trim().toLowerCase()
  if (!alvo) return [...animes]
  const bate = (t: string): boolean => t.toLowerCase().includes(alvo)
  return animes.filter((a) => bate(a.nome) || a.titulos.some(bate) || a.broll.some((e) => bate(e.titulo)))
}

/** "S01E05", "Abertura 2", "Filme", "B-roll 03 · Teaser". */
export function rotuloDoEpisodioDoAcervo(e: Pick<EpisodioDoAcervo, 'tipo' | 'temporada' | 'episodio' | 'titulo'>): string {
  const pad = (n: number): string => String(Math.max(0, Math.trunc(n))).padStart(2, '0')
  if (e.tipo === 'BROLL') return e.titulo ? `B-roll ${pad(e.episodio)} · ${e.titulo}` : `B-roll ${pad(e.episodio)}`
  if (e.tipo === 'OP') return `Abertura ${e.episodio}`
  if (e.tipo === 'ED') return `Encerramento ${e.episodio}`
  if (e.tipo === 'MOVIE') return 'Filme'
  return `S${pad(e.temporada)}E${pad(e.episodio)}`
}

// ------------------------------------------------------------ o que falta cortar

const VIDEO = /\.(mkv|mp4|avi|mov|webm|m4v|ts|m2ts|wmv|flv)$/i

/** Abertura, encerramento, previa, trailer: nao sao episodio a cortar. */
const NAO_E_EPISODIO = /\b(nc ?op|nc ?ed|creditless|opening|ending|preview|trailer|teaser|pv|cm|menu|extras?|sample)\b/i

/**
 * O numero do episodio pelo nome do arquivo, como os releases costumam
 * escrever: "S01E05", "- 05", "Ep 05", "E05", "[05]", "05v2". null = nao deu
 * (ou nao e episodio: abertura, trailer). O motor le de novo na hora de
 * cortar (o `parse` dele); isto so serve para dizer o que falta.
 */
export function numeroDoArquivo(arquivo: string): number | null {
  const nome = (arquivo.split(/[\\/]/).pop() ?? arquivo).replace(VIDEO, '')
  if (NAO_E_EPISODIO.test(nome)) return null
  // Tira o que confunde: resolucao, codec, ano, hash entre colchetes.
  const limpo = nome
    .replace(/\[[0-9A-F]{8}\]/gi, ' ')
    .replace(/\b(1080|720|480|2160|1440)p\b/gi, ' ')
    .replace(/\b[xh]\.?26[45]\b|\bhevc\b|\bav1\b|\b10 ?bits?\b|\baac\b|\bflac\b/gi, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
  const tentativas = [
    /\bS\d{1,2}\s*E(\d{1,4})\b/i,
    /\b(?:ep|episod[eio]o?|e)\.?\s*(\d{1,4})(?:v\d)?\b/i,
    /\s-\s*(\d{1,4})(?:v\d)?(?:\s|$|\[|\()/,
    /\[(\d{1,4})(?:v\d)?\]/,
    /(?:^|[\s_.])(\d{1,3})(?:v\d)?(?:[\s_.]|$)/,
  ]
  for (const re of tentativas) {
    const m = re.exec(limpo)
    if (m?.[1]) {
      const n = Number(m[1])
      if (Number.isInteger(n) && n > 0 && n < 5000) return n
    }
  }
  return null
}

/** E um arquivo de video? */
export function ehVideo(arquivo: string): boolean {
  return VIDEO.test(arquivo)
}

/**
 * O comeco do nome que e da SERIE, antes do numero ("[SubsPlease] Kusuriya no
 * Hitorigoto - 30 (1080p)" -> "[subsplease] kusuriya no hitorigoto"). E o que
 * separa, numa pasta de downloads com varios animes, os arquivos deste.
 */
export function prefixoDaSerie(arquivo: string): string {
  const nome = (arquivo.split(/[\\/]/).pop() ?? arquivo).replace(VIDEO, '').toLowerCase()
  const n = numeroDoArquivo(arquivo)
  // Onde o numero comeca (com o "S01E", "Ep", "E" ou "[" que vem antes dele).
  const corte = n === null ? -1 : nome.search(new RegExp(String.raw`(s\d{1,2}\s*)?(ep|episod[eio]o?|e)?\.?\s*\[?0*${n}(v\d)?\b`))
  const antes = corte > 0 ? nome.slice(0, corte) : nome
  return antes
    .replace(/[\s_.\-[(]+$/g, '')
    .replace(/[\s_.]+/g, ' ')
    .trim()
}

/**
 * O que falta cortar numa pasta de origem: os videos que nao viraram
 * episodio. Cortado = o mesmo arquivo de algum episodio, ou o mesmo numero na
 * temporada que a pasta tem. So entram os arquivos da MESMA serie (o mesmo
 * comeco de nome dos ja cortados de la): a pasta de downloads costuma ter
 * varios animes.
 */
export function paraCortarNaPasta(
  arquivos: readonly string[],
  cortados: readonly { video: string; temporada: number; episodio: number; tipo: TipoDoEpisodio }[],
): ParaCortar[] {
  const normal = (p: string): string => p.replace(/\//g, '\\').toLowerCase()
  const daPasta = new Set(cortados.map((c) => normal(c.video)))
  // A temporada da pasta: a mais comum entre os cortados que vieram dela.
  const conta = new Map<number, number>()
  for (const c of cortados) if (c.tipo === '') conta.set(c.temporada, (conta.get(c.temporada) ?? 0) + 1)
  const temporada = [...conta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1
  const numeros = new Set(cortados.filter((c) => c.tipo === '' && c.temporada === temporada).map((c) => c.episodio))
  const prefixos = new Set(cortados.map((c) => prefixoDaSerie(c.video)).filter((p) => p.length >= 3))
  const saida: ParaCortar[] = []
  for (const arquivo of arquivos) {
    if (!ehVideo(arquivo) || daPasta.has(normal(arquivo))) continue
    if (prefixos.size > 0) {
      const p = prefixoDaSerie(arquivo)
      if (![...prefixos].some((x) => p === x || p.startsWith(x) || x.startsWith(p) && p.length >= 3)) continue
    }
    const n = numeroDoArquivo(arquivo)
    if (n === null && NAO_E_EPISODIO.test(arquivo.split(/[\\/]/).pop() ?? '')) continue
    if (n !== null && numeros.has(n)) continue
    saida.push({ arquivo, episodio: n, temporada })
  }
  return saida.sort((a, b) => (a.episodio ?? 1e9) - (b.episodio ?? 1e9) || porNome.compare(a.arquivo, b.arquivo))
}

// ------------------------------------------------------------- os personagens

/** Um personagem do acervo (as grafias do mesmo ja juntas pelo motor). */
export interface PersonagemDoAcervo {
  nome: string
  /** Os ids do banco (uma linha por grafia/temporada). */
  ids: number[]
  /** As outras grafias ("Hayakawa, Aki" do "Aki"). */
  apelidos: string[]
  cenas: number
  episodios: number
  /** Quanto ele tem em cada anime (pasta). */
  porAnime: { anime: string; cenas: number; episodios: number }[]
  /** O rosto (URL); '' = ainda sem. */
  rosto: string
}

/** Uma cena (de um personagem, ou de um episodio). */
export interface CenaDoAcervo {
  id: number
  idx: number
  /** O clipe (caminho absoluto) e o quadro (URL). */
  clipe: string
  quadro: string
  /** O clipe em URL (para tocar no hover). */
  video: string
  duracao: number
  confianca: number | null
  /** De onde e (para a grade de um personagem, que atravessa episodios). */
  anime: string
  temporada: number
  episodio: number
  tipo: TipoDoEpisodio
  episodioId: number
  /** So nas cenas sem ninguem: quem a repescagem acha que e. */
  palpite?: { id: number; nome: string } | null
}

/** Um personagem dentro de um episodio aberto. */
export interface PersonagemDoEpisodioAberto {
  id: number
  nome: string
  cenas: number
}

/** O id que o motor usa para "as cenas sem ninguem" (SEM_PERSONAGEM_ID). */
export const SEM_NINGUEM = -2
/** "Todas as cenas" do episodio. */
export const TODAS = 0

// --------------------------------------------------------- o pacote de elenco

/** O que um pacote de elenco traz (lido antes de importar). */
export interface InfoDoPacote {
  erro: string
  titulo: string
  titulos: string[]
  personagens: number
  comFoto: number
  fotos: number
  /** Quantos ja vem com o reconhecimento pronto. */
  prontos: number
  /** Um episodio de quem exportou (para reconhecer o anime). */
  exemplo: string
}

/** O que exportar/importar fez. */
export interface ResultadoDoPacote {
  erro: string
  personagens: number
  comFoto: number
  semFoto: string[]
  fotos: number
  /** Nomes repetidos (o mesmo personagem escrito de dois jeitos) que viraram um. */
  juntados: number
  titulo: string
  /** So no exportar: onde o .zip foi gravado. */
  arquivo: string
}

/**
 * O titulo base, para achar o anime do pacote na lista (o `titulo_base` do
 * motor): sem acento, pontuacao nem temporada.
 */
export function tituloBase(t: string): string {
  return t
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:\d+(?:st|nd|rd|th)\s+season|season\s*\d+|s\d{1,2}|part\s*\d+|cour\s*\d+|final\s+season|ii|iii|iv)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
