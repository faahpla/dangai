import { createHash, randomBytes } from 'node:crypto'
import { constants, readdirSync, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { garantirGravavel } from './episodio/protegidas'

/**
 * A RESERVA DE FOTOS DO ELENCO.
 *
 * O reconhecimento precisa de 2 fotos por personagem
 * (min_references_per_character). Com o api.jikan.moe fora do alcance desta
 * rede, o motor monta o elenco pela AniList com UMA foto cada, a Kitsu nao tem
 * elenco de anime de 2020 para ca, e a analise termina em "sem-referencias".
 * So que o Corte Cenas do Levi ja baixou e curou esse elenco: 80 personagens de
 * Dr. Stone, 44 com 2 fotos ou mais, prints do proprio episodio inclusive.
 *
 * Antes de o motor buscar o elenco -- ou quando ele volta sem referencias --,
 * o Studio procura a pasta do MESMO anime nos caches conhecidos e COPIA para o
 * cache do proprio motor (<userData>/motor/cache/anime_db). Daqui em diante o
 * motor segue normal: ele acha o banco pelo id da franquia e reaproveita as
 * fotos, que tem o nome que o downloader dele daria (sha1 da URL).
 *
 * Regras:
 * - As origens sao SO LEITURA (protegidas.ts). Daqui so sai readdir, stat,
 *   readFile e copyFile DE la; nada e movido, apagado nem tocado na origem.
 * - O casamento e pelo id da franquia no nome da pasta ([al<id>], o mesmo
 *   sufixo que o motor procura), que vem do que o PROPRIO motor ja resolveu
 *   (busca_resolvida.json e pastas_de_anime.json dele) ou do indice de buscas
 *   do Corte Cenas. Na falta, pelo titulo -- so quando ha um anime so que case.
 * - So copia quando o banco do Studio para aquele id nao tem ninguem com fotos
 *   suficientes. Banco do Studio que ja reconhece alguem nao e trocado: o
 *   elenco dele pode estar com outros nomes (AniList x MyAnimeList), e trocar
 *   no meio da temporada partiria o mesmo personagem em dois.
 * - O banco ruim do Studio nao e apagado: vai para
 *   <dados>/cache/elenco-posto-de-lado/, fora do anime_db, onde o motor nao olha.
 * - A copia vai primeiro para uma pasta temporaria e so entao ganha o nome
 *   final: uma copia pela metade nunca fica com cara de banco pronto.
 * - De onde vieram as fotos fica em reserva-do-studio.json, dentro da pasta
 *   copiada, para a interface poder dizer "fotos do elenco: Corte Cenas".
 */

/** Um cache de elenco de outro app, so leitura. */
export interface CacheDeElenco {
  /** Quem baixou as fotos, como a interface mostra ('Corte Cenas'). */
  origem: string
  /** A pasta anime_db dele. */
  raiz: string
}

/** O que a reserva fez. Gravado em reserva-do-studio.json na pasta copiada. */
export interface ReservaDoElenco {
  origem: string
  /** A pasta de origem (so leitura). */
  de: string
  /** A pasta no cache do motor do Studio. */
  para: string
  /** 'al105333': a chave da franquia, como o motor chama. */
  cacheId: string
  /** Como o id foi achado: 'motor' (o que o motor do Studio ja resolveu), 'indice' (busca do Corte Cenas) ou 'titulo'. */
  como: 'motor' | 'indice' | 'titulo'
  quando: string
  personagens: number
  /** Personagens com fotos suficientes para o reconhecimento. */
  comFotos: number
  arquivos: number
  /** Bancos ruins do Studio que sairam do caminho (nada e apagado). */
  postosDeLado: string[]
}

export interface ResultadoDaReserva {
  /** Preenchido so quando copiou. */
  reserva: ReservaDoElenco | null
  /** Uma linha para o log da analise, copiando ou nao. */
  linha: string
}

/** O minimo de fotos por personagem do motor (config.min_references_per_character). */
const MIN_FOTOS = 2
const REGISTRO = 'reserva-do-studio.json'
const EXTENSOES = new Set(['.jpg', '.jpeg', '.png', '.webp'])
/** Nome que o downloader do motor da (image_filters.HASH_FILENAME): o resto e foto posta a mao. */
const NOME_DO_DOWNLOADER = /^[0-9a-f]{16}\.(?:jpg|jpeg|png|webp)$/i
const ID_NA_PASTA = /\[((?:al|mal)\d+)\]$/
const ID_SOLTO = /^(?:al|mal)\d+$/

function localAppData(): string {
  return process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
}

/**
 * Os caches de elenco conhecidos, na ordem de preferencia.
 *
 * - G:\App Corte Cenas: o Corte Cenas do Levi rodando do fonte (cache/ ao lado
 *   do codigo, config.DEFAULT_CACHE).
 * - %LOCALAPPDATA%\CorteCenas\CorteCenas: o Corte Cenas instalado. O AnCut HUB
 *   instalado grava NA MESMA pasta (APP_NAME 'CorteCenas'), e o ancut-hub-engine
 *   rodando do fonte usa cache/ ao lado do codigo como junction para ela -- o
 *   cache do AnCut e este. O `cache_dir` nao e persistido no config.json deles,
 *   entao nao ha outro lugar a ler.
 *
 * ANIRECAP_ELENCO_RESERVA (raizes separadas por ';') troca a lista inteira:
 * serve aos testes e a quem guarda o Corte Cenas em outro disco.
 */
export function cachesDeElencoConhecidos(): CacheDeElenco[] {
  const extra = process.env['ANIRECAP_ELENCO_RESERVA']
  if (extra !== undefined) {
    return extra
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((raiz) => ({ origem: 'Corte Cenas', raiz }))
  }
  return [
    { origem: 'Corte Cenas', raiz: 'G:\\App Corte Cenas\\cache\\anime_db' },
    { origem: 'Corte Cenas', raiz: join(localAppData(), 'CorteCenas', 'CorteCenas', 'cache', 'anime_db') },
  ]
}

// ------------------------------------------------------------ leitura crua

function lerJson(caminho: string): unknown {
  try {
    return JSON.parse(readFileSync(caminho, 'utf8')) as unknown
  } catch {
    return null
  }
}

function objeto(cru: unknown): Record<string, unknown> | null {
  return cru && typeof cru === 'object' && !Array.isArray(cru) ? (cru as Record<string, unknown>) : null
}

function subpastas(pasta: string): string[] {
  try {
    return readdirSync(pasta, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

function arquivosDeImagem(pasta: string): string[] {
  try {
    return readdirSync(pasta, { withFileTypes: true })
      .filter((e) => e.isFile() && EXTENSOES.has(extensao(e.name)))
      .map((e) => e.name)
  } catch {
    return []
  }
}

function extensao(nome: string): string {
  const i = nome.lastIndexOf('.')
  return i >= 0 ? nome.slice(i).toLowerCase() : ''
}

function carimbo(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

// ---------------------------------------------- as regras de nome do motor

/** naming.base_do_nome / AnimeProvider._atalho_chave. */
function baseDoNome(nome: string): string {
  return nome
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** anime_folders._chave: caixa e pontuacao fora, espacos unidos. */
function chaveDaPasta(nome: string): string {
  return nome
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]|_/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/** anime_folders._SUFIXO_TEMPORADA. */
const SUFIXO_TEMPORADA =
  /\s+(?:\d+(?:st|nd|rd|th)\s+(?:season|cour)|(?:season|cour|part|parte)\s+\d+|s\d{1,2}|final\s+season)$/i

/**
 * anime_folders.resolver_franquia, a leitura tolerante do indice de buscas
 * (busca_resolvida.json; index.json no Corte Cenas mais antigo, mesmo formato).
 */
function resolverFranquia(dados: Record<string, unknown>, nome: string, temporada: number): string {
  const base = baseDoNome(nome)
  if (!base) return ''
  const exato = dados[`${base}|s${temporada}`]
  if (typeof exato === 'string' && exato) return exato
  const porBase = new Map<string, string>()
  for (const [chave, v] of Object.entries(dados)) {
    const b = chave.split('|')[0] ?? ''
    if (typeof v === 'string' && v && !porBase.has(b)) porBase.set(b, v)
  }
  const direto = porBase.get(base)
  if (direto) return direto
  let aparado = base
  for (;;) {
    const novo = aparado.replace(SUFIXO_TEMPORADA, '').trim()
    if (novo === aparado || !novo) break
    aparado = novo
    const achado = porBase.get(aparado)
    if (achado) return achado
  }
  let melhor = ''
  for (const b of porBase.keys()) {
    if (b.length >= 5 && (base.startsWith(`${b} `) || b.startsWith(`${base} `)) && b.length > melhor.length) melhor = b
  }
  return melhor ? (porBase.get(melhor) ?? '') : ''
}

/** reference_store._slug: o nome da pasta do personagem. */
function slugDoPersonagem(nome: string): string {
  return nome.replace(/[<>:"/\\|?*]/g, '_').trim() || 'unknown'
}

/** naming.name_tokens. */
function tokens(nome: string): Set<string> {
  return new Set(
    nome
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(' ')
      .filter(Boolean),
  )
}

function mesmoConjunto(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((t) => b.has(t))
}

function subconjuntoProprio(a: Set<string>, b: Set<string>): boolean {
  return a.size < b.size && [...a].every((t) => b.has(t))
}

/** naming.find_token_match: a mesma pessoa escrita de outro jeito, ou null. */
function casarPorTokens(nome: string, candidatos: string[]): string | null {
  const tn = tokens(nome)
  if (!tn.size) return null
  const parciais: string[] = []
  for (const c of candidatos) {
    const tc = tokens(c)
    if (!tc.size) continue
    if (mesmoConjunto(tc, tn)) return c
    if (subconjuntoProprio(tc, tn) || subconjuntoProprio(tn, tc)) parciais.push(c)
  }
  return parciais.length === 1 ? (parciais[0] ?? null) : null
}

/** image_downloader._name_for: sha1 da URL + extensao. */
function nomeDoDownload(url: string): string {
  let ext = extensao(url.split('?')[0] ?? '')
  if (!EXTENSOES.has(ext) || ext.includes('/')) ext = '.jpg'
  return `${createHash('sha1').update(url, 'utf8').digest('hex').slice(0, 16)}${ext}`
}

function idDaPasta(nome: string): string | null {
  const m = ID_NA_PASTA.exec(nome)
  if (m?.[1]) return m[1]
  return ID_SOLTO.test(nome) ? nome : null
}

/** reference_store.resolve_anime_dir: as pastas do id (com titulo ou o nome antigo so com o id). */
function pastasDoId(raiz: string, cacheId: string): string[] {
  return subpastas(raiz)
    .filter((n) => idDaPasta(n) === cacheId)
    .map((n) => join(raiz, n))
}

// ------------------------------------------------------ avaliar um banco

interface Avaliacao {
  /** metadata.json que o motor aceita (load_cached: versao >= 4 e elenco). */
  valido: boolean
  personagens: number
  /** Quantos ficariam com MIN_FOTOS ou mais no ensure_references do motor. */
  comFotos: number
  titulos: string[]
}

/**
 * Conta como o motor contaria: por personagem do metadata, as fotos das URLs
 * que ja estao no disco (nome do downloader) mais as postas a mao; e as pastas
 * de personagem sem par no elenco (pipeline._local_only_characters), so com as
 * postas a mao. Fotos do downloader cujas URLs nao estao no metadata o motor
 * ignora -- por isso o metadata vai junto na copia.
 */
function avaliar(pasta: string): Avaliacao {
  const meta = objeto(lerJson(join(pasta, 'metadata.json')))
  const elenco = Array.isArray(meta?.['characters']) ? (meta['characters'] as unknown[]) : []
  const versao = Number(meta?.['version'] ?? 1)
  const valido = !!meta && Number.isFinite(versao) && versao >= 4 && elenco.length > 0
  const titulos = [meta?.['title'], meta?.['title_english']].filter((t): t is string => typeof t === 'string' && !!t)
  const raizDosPersonagens = join(pasta, 'characters')
  const dirs = subpastas(raizDosPersonagens).filter((n) => !n.startsWith('_'))
  const usados = new Set<string>()
  let comFotos = 0
  if (valido) {
    for (const cru of elenco) {
      const c = objeto(cru)
      const nome = typeof c?.['name'] === 'string' ? c['name'] : ''
      if (!nome) continue
      const slug = slugDoPersonagem(nome)
      const dir = dirs.includes(slug) ? slug : casarPorTokens(nome, dirs)
      if (!dir) continue
      usados.add(dir)
      const arquivos = new Set(arquivosDeImagem(join(raizDosPersonagens, dir)))
      const urls = Array.isArray(c?.['image_urls']) ? (c['image_urls'] as unknown[]) : []
      let n = 0
      for (const u of new Set(urls.filter((x): x is string => typeof x === 'string'))) {
        if (arquivos.has(nomeDoDownload(u))) n += 1
      }
      for (const a of arquivos) if (!NOME_DO_DOWNLOADER.test(a)) n += 1
      if (n >= MIN_FOTOS) comFotos += 1
    }
  }
  const nomes = valido
    ? elenco.map((c) => objeto(c)?.['name']).filter((n): n is string => typeof n === 'string')
    : []
  for (const dir of dirs) {
    if (usados.has(dir) || casarPorTokens(dir, nomes)) continue
    const postas = arquivosDeImagem(join(raizDosPersonagens, dir)).filter((a) => !NOME_DO_DOWNLOADER.test(a))
    if (postas.length >= MIN_FOTOS) comFotos += 1
  }
  return { valido, personagens: elenco.length, comFotos, titulos }
}

// --------------------------------------------------------- achar o id

interface IdAchado {
  cacheId: string
  como: ReservaDoElenco['como']
}

/** O que o motor do Studio ja resolveu: busca_resolvida.json, depois a memoria de pastas. */
function idPeloMotor(dadosDoMotor: string, anime: string, temporada: number): string {
  const cache = join(dadosDoMotor, 'cache')
  const atalho = objeto(lerJson(join(cache, 'anime_db', 'busca_resolvida.json')))
  const pelaBusca = atalho ? resolverFranquia(atalho, anime, temporada) : ''
  if (pelaBusca) return pelaBusca
  // pastas_de_anime.json: nome -> pasta (nomes) e franquia -> pasta (franquias).
  // A franquia so e gravada por uma analise com reconhecimento que passou do
  // elenco, mesmo quando as fotos faltaram.
  const memoria = objeto(lerJson(join(cache, 'pastas_de_anime.json')))
  const nomes = objeto(memoria?.['nomes'])
  const franquias = objeto(memoria?.['franquias'])
  const pasta = nomes?.[chaveDaPasta(anime)]
  if (typeof pasta !== 'string' || !franquias) return ''
  const ids = Object.entries(franquias)
    .filter(([id, p]) => p === pasta && ID_SOLTO.test(id))
    .map(([id]) => id)
  return ids.length === 1 ? (ids[0] ?? '') : ''
}

/** O indice de buscas do Corte Cenas (busca_resolvida.json, ou index.json no formato antigo). */
function idPeloIndice(caches: CacheDeElenco[], anime: string, temporada: number): string {
  for (const { raiz } of caches) {
    for (const arquivo of ['busca_resolvida.json', 'index.json']) {
      const dados = objeto(lerJson(join(raiz, arquivo)))
      const id = dados ? resolverFranquia(dados, anime, temporada) : ''
      if (id && ID_SOLTO.test(id)) return id
    }
  }
  return ''
}

/**
 * Pelo titulo das pastas dos caches: igual, ou um e o comeco do outro em
 * palavra inteira (a mesma regra do resolver_franquia). Dois animes casando
 * e ninguem: copiar o elenco errado e pior do que nao copiar.
 */
function idPeloTitulo(caches: CacheDeElenco[], anime: string): string {
  const alvos = new Set<string>()
  let a = baseDoNome(anime)
  while (a) {
    alvos.add(a)
    const novo = a.replace(SUFIXO_TEMPORADA, '').trim()
    if (novo === a) break
    a = novo
  }
  const achados = new Set<string>()
  for (const { raiz } of caches) {
    for (const nome of subpastas(raiz)) {
      const id = idDaPasta(nome)
      if (!id) continue
      const av = avaliar(join(raiz, nome))
      if (!av.valido) continue
      const titulos = [...av.titulos, nome.replace(ID_NA_PASTA, '')].map(baseDoNome).filter(Boolean)
      const casa = titulos.some((t) =>
        [...alvos].some((b) => t === b || (Math.min(t.length, b.length) >= 5 && (t.startsWith(`${b} `) || b.startsWith(`${t} `)))),
      )
      if (casa) achados.add(id)
    }
  }
  return achados.size === 1 ? ([...achados][0] ?? '') : ''
}

function acharId(
  dadosDoMotor: string,
  caches: CacheDeElenco[],
  anime: string,
  temporada: number,
): IdAchado | null {
  const doMotor = idPeloMotor(dadosDoMotor, anime, temporada)
  if (doMotor && ID_SOLTO.test(doMotor)) return { cacheId: doMotor, como: 'motor' }
  const doIndice = idPeloIndice(caches, anime, temporada)
  if (doIndice) return { cacheId: doIndice, como: 'indice' }
  const doTitulo = idPeloTitulo(caches, anime)
  if (doTitulo) return { cacheId: doTitulo, como: 'titulo' }
  return null
}

/** O id da franquia pela pasta de refs que o motor manda no needs-input (`refsDir`). */
export function idDaPastaDeRefs(refsDir: string): string | null {
  const limpo = refsDir.replace(/[\\/]+$/, '')
  const pasta = basename(limpo) === 'characters' ? basename(resolve(limpo, '..')) : basename(limpo)
  return idDaPasta(pasta)
}

// --------------------------------------------------------------- copiar

/** Copia arvore SO lendo a origem. Nunca sobrescreve no destino. Devolve quantos arquivos. */
async function copiarArvore(de: string, para: string): Promise<number> {
  await mkdir(para, { recursive: true })
  let n = 0
  for (const e of await readdir(de, { withFileTypes: true })) {
    const origem = join(de, e.name)
    const destino = join(para, e.name)
    if (e.isDirectory()) n += await copiarArvore(origem, destino)
    else if (e.isFile()) {
      await copyFile(origem, destino, constants.COPYFILE_EXCL)
      n += 1
    }
  }
  return n
}

/**
 * O metadata.json do banco copiado, com uma correcao so: o Corte Cenas grava
 * `fetched_at` em segundos (numero) e o motor do Studio espera texto ISO --
 * o _mais_velho_que dele quebraria com TypeError no dia em que o banco tiver
 * galeria faltando. O resto vai como esta.
 */
async function copiarMetadata(de: string, para: string): Promise<void> {
  const texto = await readFile(de, 'utf8')
  const dados = objeto(JSON.parse(texto) as unknown)
  if (dados && typeof dados['fetched_at'] === 'number' && Number.isFinite(dados['fetched_at'])) {
    dados['fetched_at'] = new Date(dados['fetched_at'] * 1000).toISOString().replace(/\.\d{3}Z$/, '+00:00')
    await writeFile(para, JSON.stringify(dados, null, 2), { encoding: 'utf8', flag: 'wx' })
  } else {
    await writeFile(para, texto, { encoding: 'utf8', flag: 'wx' })
  }
}

/**
 * Ensina ao motor do Studio o nome -> franquia que veio do indice do Corte
 * Cenas, no indice de buscas DELE (busca_resolvida.json). Com isso ele acha o
 * banco copiado sem consultar a AniList -- e segue funcionando com ela fora do
 * ar, como em set/2026. So a chave exata e so quando ela ainda nao existe: e
 * exatamente o que o _atalho_gravar dele gravaria depois da busca.
 */
async function ensinarABusca(dadosDoMotor: string, anime: string, temporada: number, cacheId: string): Promise<void> {
  const caminho = join(dadosDoMotor, 'cache', 'anime_db', 'busca_resolvida.json')
  const base = baseDoNome(anime)
  if (!base) return
  const dados = objeto(lerJson(caminho)) ?? {}
  const chave = `${base}|s${temporada}`
  if (typeof dados[chave] === 'string' && dados[chave]) return
  dados[chave] = cacheId
  await writeFile(caminho, JSON.stringify(dados, null, 2), 'utf8')
}

export interface PedidoDeReserva {
  anime: string
  temporada: number
  /** O id da franquia, quando ja se sabe (needs-input do motor). Sem ele, a reserva acha sozinha. */
  cacheId?: string | null
  /** Chamado uma vez, antes de copiar, para a tela mostrar o que esta acontecendo. */
  aoCopiar?: (origem: string, comFotos: number) => void
}

/**
 * Procura o elenco do anime nos caches conhecidos e copia para o cache do
 * motor do Studio quando o banco dele nao reconhece ninguem.
 *
 * Nunca lanca: qualquer erro vira `reserva: null` com o motivo na `linha`, e
 * a analise segue como seguiria sem a reserva.
 */
export async function reservarElenco(dadosDoMotor: string, pedido: PedidoDeReserva): Promise<ResultadoDaReserva> {
  const nada = (linha: string): ResultadoDaReserva => ({ reserva: null, linha: `reserva do elenco: ${linha}` })
  let temporaria: string | null = null
  try {
    const animeDb = join(dadosDoMotor, 'cache', 'anime_db')
    // O destino nunca pode ser pasta do Corte Cenas/AnCut (lanca, e vira `nada`).
    garantirGravavel(animeDb)
    const caches = cachesDeElencoConhecidos().filter(
      // Nunca a propria pasta do Studio como origem.
      (c) => resolve(c.raiz).toLowerCase() !== resolve(animeDb).toLowerCase(),
    )

    const achado: IdAchado | null =
      pedido.cacheId && ID_SOLTO.test(pedido.cacheId)
        ? { cacheId: pedido.cacheId, como: 'motor' }
        : acharId(dadosDoMotor, caches, pedido.anime, pedido.temporada)
    if (!achado) return nada(`nenhum cache conhece "${pedido.anime}" s${pedido.temporada}`)
    const { cacheId } = achado

    // O banco do Studio para esse id ja reconhece alguem? Entao fica.
    const doStudio = pastasDoId(animeDb, cacheId)
    const melhorDoStudio = Math.max(0, ...doStudio.map((p) => avaliar(p).comFotos))
    if (melhorDoStudio > 0) {
      return nada(`o banco do Studio para ${cacheId} ja tem ${melhorDoStudio} personagens com fotos; nada copiado`)
    }

    let escolhido: { cache: CacheDeElenco; pasta: string; av: Avaliacao } | null = null
    for (const cache of caches) {
      for (const pasta of pastasDoId(cache.raiz, cacheId)) {
        const av = avaliar(pasta)
        if (!av.valido || av.comFotos === 0) continue
        if (!escolhido || av.comFotos > escolhido.av.comFotos) escolhido = { cache, pasta, av }
      }
    }
    if (!escolhido) return nada(`${cacheId} sem banco com fotos nos caches conhecidos`)
    const { cache, pasta: de, av } = escolhido

    pedido.aoCopiar?.(cache.origem, av.comFotos)

    // 1. Copia para uma pasta temporaria (o motor nao olha: nao termina em [id]).
    temporaria = join(animeDb, `.reserva-${carimbo()}-${randomBytes(3).toString('hex')}`)
    garantirGravavel(temporaria)
    await mkdir(temporaria, { recursive: true })
    await copiarMetadata(join(de, 'metadata.json'), join(temporaria, 'metadata.json'))
    let arquivos = 1
    if (statSync(join(de, 'characters'), { throwIfNoEntry: false })?.isDirectory()) {
      arquivos += await copiarArvore(join(de, 'characters'), join(temporaria, 'characters'))
    }
    // ref_features.npz fica: o cache de features e chaveado pelo caminho
    // absoluto do arquivo e nenhuma entrada dele bateria aqui.

    // 2. O banco ruim do Studio sai do caminho, inteiro, para fora do anime_db.
    const postosDeLado: string[] = []
    const ladoRaiz = join(dadosDoMotor, 'cache', 'elenco-posto-de-lado')
    for (const velho of doStudio) {
      await mkdir(ladoRaiz, { recursive: true })
      const destino = join(ladoRaiz, `${basename(velho)} (${carimbo()}-${randomBytes(2).toString('hex')})`)
      await rename(velho, destino)
      postosDeLado.push(destino)
    }

    // 3. O registro e o nome final.
    const para = join(animeDb, basename(de))
    const reserva: ReservaDoElenco = {
      origem: cache.origem,
      de,
      para,
      cacheId,
      como: achado.como,
      quando: new Date().toISOString(),
      personagens: av.personagens,
      comFotos: av.comFotos,
      arquivos,
      postosDeLado,
    }
    await writeFile(join(temporaria, REGISTRO), JSON.stringify(reserva, null, 2), 'utf8')
    await rename(temporaria, para)
    temporaria = null

    // 4. Nome -> franquia no indice do motor, quando o id veio do indice do
    // Corte Cenas ou da memoria do proprio motor (nunca de um palpite de titulo).
    if (achado.como !== 'titulo') {
      try {
        await ensinarABusca(dadosDoMotor, pedido.anime, pedido.temporada, cacheId)
      } catch {
        /* conveniencia: sem o atalho o motor acha o banco pela AniList */
      }
    }

    return {
      reserva,
      linha:
        `reserva do elenco: ${av.comFotos} de ${av.personagens} personagens com fotos copiados do ${cache.origem} ` +
        `(${arquivos} arquivos, id ${cacheId} pelo ${achado.como}) de ${de} para ${para}` +
        (postosDeLado.length ? `; banco anterior posto de lado em ${postosDeLado.join(', ')}` : ''),
    }
  } catch (e) {
    if (temporaria) {
      // So a pasta temporaria que esta funcao criou, dentro do cache do Studio.
      await rm(temporaria, { recursive: true, force: true }).catch(() => {})
    }
    return nada(`falhou (${e instanceof Error ? e.message : String(e)}); a analise segue sem ela`)
  }
}

/**
 * De onde vieram as fotos do elenco que o motor do Studio usa para este anime:
 * a `origem` do reserva-do-studio.json ('Corte Cenas'), ou null quando o
 * banco e da busca online (ou nao ha banco). Nunca lanca.
 */
export function fotosDoElenco(dadosDoMotor: string, anime: string, temporada: number, cacheId?: string | null): ReservaDoElenco | null {
  try {
    const animeDb = join(dadosDoMotor, 'cache', 'anime_db')
    const id = cacheId && ID_SOLTO.test(cacheId) ? cacheId : idPeloMotor(dadosDoMotor, anime, temporada)
    if (!id) return null
    for (const pasta of pastasDoId(animeDb, id)) {
      const r = objeto(lerJson(join(pasta, REGISTRO)))
      if (r && typeof r['origem'] === 'string') return r as unknown as ReservaDoElenco
    }
    return null
  } catch {
    return null
  }
}
