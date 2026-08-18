import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import type { LibraryClip, LibraryIndex } from '@shared/channels'

/**
 * Le a biblioteca de cenas que o AnCut HUB ja produziu.
 *
 * O AnCut corta o episodio em cenas, identifica os personagens por referencia e
 * grava tudo em `metadata/shots.json`. Nada disso precisa ser refeito aqui: este
 * servico so LE. Ele nunca escreve, move ou renomeia nada dentro da biblioteca
 * do usuario -- se o Dangai sumir amanha, a pasta fica exatamente como estava.
 *
 * A pasta de um episodio processado e assim:
 *
 *   <serie>/<SxxExx>/
 *     shots/0008.mp4          <- a cena
 *     keyframes/0008_1.jpg    <- ja extraido, em 1920x1080
 *     metadata/shots.json     <- personagem, duracao, posicao no episodio
 *     metadata/characters.json
 *     _lixeira/               <- o que o usuario descartou
 *
 * A miniatura que a grade usa NAO e o keyframe: e uma copia reduzida no
 * userData. Medido no acervo real, os keyframes sao 5,6 GB -- quase um quarto do
 * total -- porque estao em 1920x1080 para aparecer com 190 pixels de largura. A
 * copia local fica em 53 MB e custa 44 segundos uma vez.
 *
 * Isso vale mesmo com tudo no disco (ler 200 KB para desenhar 190px e desperdicio)
 * e e o que torna possivel por os clipes na nuvem depois: navegar deixa de tocar
 * na biblioteca, e so o preview e o render precisam do arquivo grande.
 */

/** O que guardamos por episodio, para nao reler o que nao mudou. */
interface CachedEpisode {
  /** mtime do shots.json quando foi lido. Mudou = o AnCut reprocessou. */
  mtimeMs: number
  /** Quantos arquivos existiam em shots/. A lixeira mexe aqui sem tocar no json. */
  fileCount: number
  clips: StoredClip[]
}

/** No disco a URL nao entra: ela morre junto com a sessao que a criou. */
type StoredClip = Omit<LibraryClip, 'thumbUrl'> & { thumb: string }

interface CacheFile {
  version: number
  episodes: Record<string, CachedEpisode>
}

/**
 * Muda quando a forma do que extraimos muda. Subir isto invalida o cache
 * inteiro de proposito -- e mais barato reler 27 arquivos de texto do que
 * carregar para sempre um indice montado por uma versao antiga.
 */
const CACHE_VERSION = 4

/** Profundidade maxima da varredura a partir da raiz. */
const MAX_DEPTH = 3

/**
 * Largura da miniatura local. A grade desenha com ~190px; 320 cobre tela de
 * densidade dobrada e ainda deixa folga se um dia ela aumentar.
 */
const THUMB_WIDTH = 320
const THUMB_QUALITY = 72
/** Quantas miniaturas em voo. Medido: 8 dá 4,8ms por imagem nesta maquina. */
const THUMB_PARALELO = 8

let cachePath: string | null = null
let thumbsDir: string | null = null

export function configureLibrary(userDataDir: string): void {
  cachePath = join(userDataDir, 'library-cache.json')
  thumbsDir = join(userDataDir, 'thumbs')
}

/**
 * Varre a raiz e devolve o indice inteiro.
 *
 * `publishThumb` vem de fora (o servidor de midia) para este arquivo continuar
 * sendo so leitura de disco -- da para testar a varredura sem subir servidor.
 */
export async function scanLibrary(
  root: string,
  publishThumb: (absolutePath: string) => string,
  onProgress: (mensagem: string) => void = () => {},
): Promise<LibraryIndex> {
  if (!root) throw new Error('Nenhuma pasta de biblioteca escolhida.')
  if (!ehPasta(root)) {
    throw new Error(`A pasta da biblioteca nao existe mais: ${root}`)
  }

  const cache = lerCache()
  const proximos: Record<string, CachedEpisode> = {}
  const clips: LibraryClip[] = []
  let scanned = 0

  const episodios = [...episodiosEm(root, 0)]

  for (const [posicao, dir] of episodios.entries()) {
    const jsonPath = join(dir, 'metadata', 'shots.json')

    let mtimeMs: number
    try {
      mtimeMs = statSync(jsonPath).mtimeMs
    } catch {
      continue
    }

    // A lixeira do AnCut move o mp4 e o keyframe para fora MAS NAO atualiza o
    // shots.json -- ele continua listando a cena descartada. Por isso a lista de
    // arquivos reais e a verdade, e por isso ela entra no cache: e a unica forma
    // de perceber que o usuario descartou algo sem reler o json toda vez.
    const naPasta = arquivosEm(join(dir, 'shots'))

    const anterior = cache.episodes[dir]
    const aproveitavel =
      anterior &&
      anterior.mtimeMs === mtimeMs &&
      anterior.fileCount === naPasta.size &&
      // Uma conferida so por episodio: se alguem limpou o userData, as
      // miniaturas sumiram e a grade viria com os quadros quebrados. Refazer sai
      // mais barato do que 9 mil statSync a cada sincronizacao.
      (anterior.clips.length === 0 || existsSync(anterior.clips[0]!.thumb))

    if (!aproveitavel) {
      onProgress(
        `Preparando ${basename(dir)} de ${basename(join(dir, '..'))}... (${posicao + 1}/${episodios.length})`,
      )
    }

    const guardados = aproveitavel ? anterior.clips : await lerEpisodio(dir, root, naPasta)
    if (!aproveitavel) scanned += 1

    proximos[dir] = { mtimeMs, fileCount: naPasta.size, clips: guardados }

    for (const clip of guardados) {
      const { thumb, ...resto } = clip
      clips.push({ ...resto, thumbUrl: publishThumb(thumb) })
    }
  }

  // Episodios que sumiram do disco somem do cache junto: reescrevemos o mapa
  // inteiro em vez de remendar o antigo.
  gravarCache({ version: CACHE_VERSION, episodes: proximos })

  unificarNomes(clips)
  clips.sort(ordemNatural)

  return {
    root,
    clips,
    animes: unicos(clips.map((c) => c.anime)),
    characters: unicos(clips.flatMap((c) => c.characters)),
    episodes: Object.keys(proximos).length,
    scanned,
  }
}

// --------------------------------------------------- o mesmo personagem, um nome

/**
 * Junta as varias grafias do mesmo personagem, dentro de cada serie.
 *
 * Roda DEPOIS de tudo lido porque o problema atravessa episodios, e o cache
 * guarda os nomes crus -- entao mudar esta regra nao obriga a reler o disco.
 *
 * O `character_id` do AnCut nao resolve: ele vale por conjunto de referencias,
 * nao por pessoa. Medido no acervo real, o Rimuru aparece com NOVE combinacoes
 * de nome e id ("Tempest, Rimuru" com os ids 157, 582 e 706, "Rimuru Tempest"
 * com 261 e 97, e por ai). Juntar por id entre episodios juntaria gente
 * diferente; e nao juntar deixava 102 cenas dele invisiveis no filtro.
 */
function unificarNomes(clips: LibraryClip[]): void {
  const porSerie = new Map<string, Map<string, number>>()
  for (const clip of clips) {
    const contagem = porSerie.get(clip.anime) ?? new Map<string, number>()
    for (const nome of clip.characters) contagem.set(nome, (contagem.get(nome) ?? 0) + 1)
    porSerie.set(clip.anime, contagem)
  }

  const mapas = new Map<string, ReadonlyMap<string, string>>()
  for (const [serie, contagem] of porSerie) mapas.set(serie, canonizar(contagem))

  for (const clip of clips) {
    const mapa = mapas.get(clip.anime)
    if (!mapa) continue
    const vistos = new Set<string>()
    for (const nome of clip.characters) vistos.add(mapa.get(nome) ?? nome)
    clip.characters = [...vistos].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }
}

/** Sem acento, minusculas, so as palavras, ordenadas: "Tempest, Rimuru" == "Rimuru Tempest". */
function fichas(nome: string): string[] {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
}

/** nome cru -> nome escolhido, para uma serie. */
function canonizar(contagem: ReadonlyMap<string, number>): ReadonlyMap<string, string> {
  interface Grupo {
    fichas: string[]
    nomes: [string, number][]
  }

  // 1) Mesmas palavras, mesma pessoa. Pega inversao e caixa de uma vez.
  const grupos = new Map<string, Grupo>()
  for (const [nome, n] of contagem) {
    const f = fichas(nome)
    const chave = f.join(' ')
    const g = grupos.get(chave) ?? { fichas: f, nomes: [] }
    g.nomes.push([nome, n])
    grupos.set(chave, g)
  }

  /*
   * 2) Nome curto entra no longo -- mas so quando cabe em UM. "Rudeus" so pode
   * ser "Greyrat, Rudeus"; ja "Greyrat" sozinho caberia em Rudeus, Paul, Zenith
   * e Eris, e um palpite ali juntaria a familia inteira numa pessoa so.
   */
  const chaves = [...grupos.keys()]
  const destino = new Map<string, string>()
  for (const chave of chaves) {
    const g = grupos.get(chave)!
    const maiores = chaves.filter((outra) => {
      if (outra === chave) return false
      const o = grupos.get(outra)!
      return g.fichas.length < o.fichas.length && g.fichas.every((f) => o.fichas.includes(f))
    })
    if (maiores.length === 1) destino.set(chave, maiores[0]!)
  }

  // 3) Fica a grafia mais usada: e a que ele reconhece de ver na tela do AnCut.
  const juntos = new Map<string, [string, number][]>()
  for (const chave of chaves) {
    const alvo = destino.get(chave) ?? chave
    juntos.set(alvo, [...(juntos.get(alvo) ?? []), ...grupos.get(chave)!.nomes])
  }

  const mapa = new Map<string, string>()
  for (const nomes of juntos.values()) {
    const escolhido = nomes.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
    for (const [nome] of nomes) mapa.set(nome, escolhido)
  }
  return mapa
}

// ---------------------------------------------------------------- leitura crua

/** O shots.json do AnCut, so os campos que usamos. */
interface RawShot {
  shot_id?: unknown
  file?: unknown
  keyframe?: unknown
  start?: unknown
  end?: unknown
  duration?: unknown
  characters?: unknown
  anime?: unknown
  season?: unknown
  episode?: unknown
}

/**
 * Monta as cenas de um episodio, com o DISCO mandando e o json respondendo.
 *
 * A ordem importa e custou uma medicao para descobrir. O shots.json e um retrato
 * do momento do corte e nunca mais e reescrito: mandar a lixeira para uma cena
 * nao apaga a linha dela, e JUNTAR cenas tambem nao. Quem itera o json acha
 * cenas que nao existem mais e perde as que foram juntadas.
 *
 * Iterando os arquivos e consultando o json isso se resolve sozinho, e a conta
 * fecha exata com o que o AnCut mostra na tela: no S01E42 sao 522 linhas no
 * json, menos 4 na lixeira, menos 5 absorvidas por juncao, igual a 513.
 */
async function lerEpisodio(
  dir: string,
  root: string,
  naPasta: ReadonlySet<string>,
): Promise<StoredClip[]> {
  let cru: unknown
  try {
    cru = JSON.parse(readFileSync(join(dir, 'metadata', 'shots.json'), 'utf8'))
  } catch {
    // Episodio no meio de um processamento, ou json truncado: pular e seguir. Um
    // arquivo quebrado nao pode derrubar a biblioteca inteira.
    return []
  }
  if (!Array.isArray(cru)) return []

  const porShot = new Map<string, RawShot>()
  for (const item of cru as RawShot[]) {
    const shot = texto(item.shot_id)
    if (shot) porShot.set(shot, item)
  }

  const canonico = nomesCanonicos(dir)
  const keyframes = arquivosEm(join(dir, 'keyframes'))
  const prefixo = relativo(root, dir)

  /*
   * Quem agrupa a serie e a PASTA do usuario, nao o campo `anime` do json.
   *
   * Medido na biblioteca real: o AnCut nem sempre acerta a serie e guarda o nome
   * do arquivo no lugar ("S01E01-Jobless Reincarnation V2"), e quando acerta ele
   * grava o titulo da TEMPORADA -- o Tensura sozinho aparece com cinco titulos
   * diferentes. Os dois casos quebram o filtro exatamente onde ele mais serve.
   *
   * A pasta e escolha dele, e constante: "Tensura" e "Tensura" em todo episodio.
   */
  const serie = prefixo.split('/')[0] || basename(dir)
  const titulo = (cru as RawShot[]).map((s) => texto(s.anime)).find((t) => t.length > 0) ?? ''

  /*
   * Temporada e episodio saem da PASTA tambem, pelo mesmo motivo.
   *
   * Medido na biblioteca dele: as pastas S17E41, S17E42, S17E43 e S17E44 de
   * Bleach guardam no json as temporadas 1, 1, 1 e 17. O mesmo anime, a mesma
   * leva, quatro pastas -- e uma delas discorda das outras tres.
   *
   * Isso nao era visivel enquanto a biblioteca so servia para BUSCAR. Passou a
   * importar quando o recap ganhou cronologia: comparando os numeros do json, o
   * episodio 44 fica dezesseis temporadas na frente do 43, e a montagem
   * automatica acha que deu um salto gigante quando andou um episodio.
   */
  const daPasta = /S(\d+)E(\d+)/i.exec(basename(dir))

  const saida: StoredClip[] = []

  for (const nomeMp4 of [...naPasta].sort(naturalmente)) {
    if (!nomeMp4.toLowerCase().endsWith('.mp4')) continue

    const shot = nomeMp4.slice(0, -4)
    const cobertas = abrangidas(shot, porShot)
    if (cobertas.length === 0) continue

    const inicio = cobertas[0]!
    const fim = cobertas[cobertas.length - 1]!

    const thumb = acharKeyframe(dir, keyframes, texto(inicio.keyframe), texto(inicio.shot_id))
    if (!thumb) continue

    // Numa cena juntada a duracao e o vao inteiro, nao a da primeira parte --
    // senao o bloco receberia 1.2s de um clipe de 5.4s e cortaria no meio.
    const span = numero(fim.end) - numero(inicio.start)

    saida.push({
      id: `${prefixo}/${shot}`,
      path: join(dir, 'shots', nomeMp4),
      thumb,
      anime: serie,
      animeTitle: titulo,
      season: daPasta ? Number(daPasta[1]) : numero(inicio.season),
      episode: daPasta ? Number(daPasta[2]) : numero(inicio.episode),
      shot,
      start: numero(inicio.start),
      duration: span > 0 ? span : numero(inicio.duration),
      characters: personagens(
        cobertas.flatMap((s) => (Array.isArray(s.characters) ? s.characters : [])),
        canonico,
      ),
    })
  }

  // O `thumb` acima ainda e o keyframe grande do AnCut. Aqui ele vira a copia
  // reduzida no userData -- e o que a grade vai de fato carregar.
  await reduzirMiniaturas(saida)

  return saida
}

/**
 * Troca o keyframe de 1920x1080 pela copia local de 320px.
 *
 * Roda so quando o episodio e lido do zero, entao o custo aparece uma vez por
 * episodio e nunca mais: 44s pelo acervo inteiro na primeira vez, ~2s no
 * episodio novo da semana.
 *
 * Falhar aqui nao pode custar a cena: se o sharp nao der conta de uma imagem,
 * ela fica com o keyframe original, que funciona -- so pesa mais.
 */
async function reduzirMiniaturas(clips: StoredClip[]): Promise<void> {
  if (!thumbsDir || clips.length === 0) return

  let proxima = 0
  const trabalhar = async (): Promise<void> => {
    while (proxima < clips.length) {
      const clip = clips[proxima++]!
      const destino = caminhoDaMiniatura(clip.id)
      try {
        if (!existsSync(destino)) {
          mkdirSync(join(destino, '..'), { recursive: true })
          await sharp(clip.thumb)
            .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
            .webp({ quality: THUMB_QUALITY })
            .toFile(destino)
        }
        clip.thumb = destino
      } catch {
        // Fica o keyframe original.
      }
    }
  }

  await Promise.all(Array.from({ length: THUMB_PARALELO }, trabalhar))
}

/**
 * Onde a miniatura de uma cena mora.
 *
 * Fatiado em subpastas pelos dois primeiros caracteres do hash: 9 mil arquivos
 * numa pasta so deixa o proprio Explorer lento, e a biblioteca so cresce.
 */
function caminhoDaMiniatura(id: string): string {
  const hash = createHash('sha1').update(id).digest('hex')
  return join(thumbsDir!, hash.slice(0, 2), `${hash.slice(2)}.webp`)
}

/**
 * As linhas do json que um arquivo representa.
 *
 * `0008.mp4` e uma cena so. `0164-0167.mp4` e o resultado de o usuario ter
 * juntado quatro cenas no AnCut -- os arquivos individuais somem e sobra este,
 * que nao existe em lugar nenhum do json. Ele vale pelas quatro linhas juntas,
 * inclusive somando os personagens: quem aparece so na terceira parte continua
 * encontravel pelo clipe inteiro.
 */
function abrangidas(shot: string, porShot: ReadonlyMap<string, RawShot>): RawShot[] {
  const direto = porShot.get(shot)
  if (direto) return [direto]

  const faixa = /^(\d+)-(\d+)$/.exec(shot)
  if (!faixa) return []

  const largura = faixa[1]!.length
  const de = Number(faixa[1])
  const ate = Number(faixa[2])
  if (!Number.isFinite(de) || !Number.isFinite(ate) || ate < de) return []

  const encontradas: RawShot[] = []
  for (let n = de; n <= ate; n += 1) {
    const item = porShot.get(String(n).padStart(largura, '0'))
    if (item) encontradas.push(item)
  }
  return encontradas
}

/**
 * Um personagem pode aparecer com mais de um nome apontando para o mesmo id --
 * no Bleach, "Urahara" e "Kisuke Urahara" sao os dois o 422. Sem unificar, o
 * mesmo personagem viraria dois filtros diferentes e cada um acharia metade das
 * cenas.
 *
 * Fica o nome mais longo, que e o mais especifico ("Kisuke Urahara").
 */
function nomesCanonicos(dir: string): ReadonlyMap<string, string> {
  const mapa = new Map<string, string>()

  let cru: unknown
  try {
    cru = JSON.parse(readFileSync(join(dir, 'metadata', 'characters.json'), 'utf8'))
  } catch {
    // Episodio antigo sem characters.json: os nomes crus servem.
    return mapa
  }
  if (!Array.isArray(cru)) return mapa

  const porId = new Map<number, string[]>()
  for (const item of cru as { name?: unknown; character_id?: unknown }[]) {
    const nome = texto(item.name)
    if (!nome || typeof item.character_id !== 'number') continue
    const lista = porId.get(item.character_id) ?? []
    lista.push(nome)
    porId.set(item.character_id, lista)
  }

  for (const nomes of porId.values()) {
    const melhor = nomes.reduce((a, b) => (b.length > a.length ? b : a))
    for (const nome of nomes) mapa.set(nome, melhor)
  }

  return mapa
}

function personagens(cru: unknown, canonico: ReadonlyMap<string, string>): string[] {
  if (!Array.isArray(cru)) return []
  const vistos = new Set<string>()
  for (const item of cru as { name?: unknown }[]) {
    const nome = texto(item.name)
    if (nome) vistos.add(canonico.get(nome) ?? nome)
  }
  return [...vistos].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/**
 * O shots.json aponta para o keyframe do meio (`_1`), mas ele nem sempre esta
 * la: a lixeira leva justamente esse, e um punhado de cenas nunca teve. Como
 * existem tres por cena, cair para os vizinhos salva a miniatura.
 */
function acharKeyframe(
  dir: string,
  existentes: ReadonlySet<string>,
  citado: string,
  shot: string,
): string | null {
  const candidatos = [
    citado ? basename(citado) : '',
    `${shot}_1.jpg`,
    `${shot}_0.jpg`,
    `${shot}_2.jpg`,
  ]
  for (const nome of candidatos) {
    if (nome && existentes.has(nome)) return join(dir, 'keyframes', nome)
  }
  return null
}

// ------------------------------------------------------------------ varredura

/**
 * Acha as pastas de episodio abaixo da raiz.
 *
 * Pasta que comeca com `_` fica de fora, e isso nao e cosmetico: `_lixeira` e
 * `_quarentena_...` guardam material que o usuario ja tirou de circulacao, com
 * shots.json proprio e tudo. Sem este filtro o descartado voltaria para a busca.
 */
function* episodiosEm(dir: string, profundidade: number): Generator<string> {
  if (profundidade > MAX_DEPTH) return

  if (existsSync(join(dir, 'metadata', 'shots.json'))) {
    yield dir
    return
  }

  let nomes: string[]
  try {
    nomes = readdirSync(dir)
  } catch {
    return
  }

  for (const nome of nomes.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))) {
    if (nome.startsWith('_') || nome.startsWith('.')) continue
    const filho = join(dir, nome)
    if (ehPasta(filho)) yield* episodiosEm(filho, profundidade + 1)
  }
}

/**
 * Nomes dos arquivos de uma pasta, em Set.
 *
 * Uma leitura de pasta por episodio em vez de um stat por cena: sao 27 chamadas
 * em vez de 9 mil para a mesma resposta.
 */
function arquivosEm(dir: string): Set<string> {
  try {
    return new Set(
      readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => e.name),
    )
  } catch {
    return new Set()
  }
}

function ehPasta(caminho: string): boolean {
  try {
    return statSync(caminho).isDirectory()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------- cache

function lerCache(): CacheFile {
  if (!cachePath) throw new Error('Biblioteca nao configurada')
  try {
    const cru: unknown = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (
      typeof cru === 'object' &&
      cru !== null &&
      (cru as CacheFile).version === CACHE_VERSION &&
      typeof (cru as CacheFile).episodes === 'object'
    ) {
      return cru as CacheFile
    }
  } catch {
    // Sem cache ou cache de outra versao: varre tudo de novo, que sao segundos.
  }
  return { version: CACHE_VERSION, episodes: {} }
}

function gravarCache(dados: CacheFile): void {
  if (!cachePath) return
  try {
    // Temporario e rename, como o settings: morrer no meio da escrita deixa o
    // cache antigo intacto em vez de virar json pela metade.
    const temp = `${cachePath}.tmp`
    writeFileSync(temp, JSON.stringify(dados), 'utf8')
    renameSync(temp, cachePath)
  } catch {
    // Cache e otimizacao. Nao conseguir gravar deixa a proxima varredura lenta,
    // nao quebrada -- entao nao vira erro na cara do usuario.
  }
}

// --------------------------------------------------------------------- uteis

/**
 * Ordem natural, entendendo o numero: sem isto "0164-0167" e "10" cairiam em
 * lugares errados na comparacao letra a letra.
 */
function naturalmente(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })
}

/** Ordem de leitura humana: anime, temporada, episodio, e a cena na sequencia. */
function ordemNatural(a: LibraryClip, b: LibraryClip): number {
  return (
    a.anime.localeCompare(b.anime, 'pt-BR') ||
    a.season - b.season ||
    a.episode - b.episode ||
    a.shot.localeCompare(b.shot, 'pt-BR', { numeric: true })
  )
}

function unicos(valores: readonly string[]): string[] {
  return [...new Set(valores)].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

function relativo(root: string, dir: string): string {
  const corte = dir.startsWith(root) ? dir.slice(root.length) : dir
  return corte.replace(/\\/g, '/').replace(/^\/+/, '')
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : ''
}

function numero(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0
}
