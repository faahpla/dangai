import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'
import type { LibraryClip } from '@shared/channels'
import { acharQuadros, recortarQuadro } from './quadros'
import { getSettings } from './settings'

/**
 * Le a pasta de MANGAS e poe os quadrinhos na Biblioteca.
 *
 * "As vezes eu tenho que usar paineis de mangas para compor os b-rolls do
 * video." A pasta e assim, com as paginas do jeito que ele baixa:
 *
 *   <pasta dos mangas>/<serie>/<capitulo>/001.jpg, 002.jpg...
 *
 * Cada pagina vira um item (a pagina inteira) e os quadrinhos dela outros
 * (ver quadros.ts). Como a Biblioteca do AnCut, a pasta dele so e LIDA: os
 * recortes e as miniaturas moram no perfil do Dangai, e apagar o perfil so
 * custa recortar de novo.
 *
 * O recorte roda uma vez por capitulo (6s nas 68 paginas do Bleach dele) e
 * fica no cache; so refaz quando as paginas mudam.
 */

/** Sobe quando o que sai do recorte muda: refaz todos os capitulos uma vez. */
const CACHE_VERSION = 1
const MINIATURA = 320
const IMAGEM = /\.(jpe?g|png|webp)$/i
/** Prefixo do id: unico entre as raizes da Biblioteca (ver registrarRaizDaBiblioteca). */
export const PREFIXO_DO_MANGA = 'manga:'

type ItemGuardado = Omit<LibraryClip, 'thumbUrl' | 'thumbPath'> & { thumb: string }

interface CapituloGuardado {
  /** Nome, tamanho e data de cada pagina: mudou qualquer uma, recorta de novo. */
  assinatura: string
  itens: ItemGuardado[]
}

interface CacheDoManga {
  version: number
  capitulos: Record<string, CapituloGuardado>
}

const daVez = (): Promise<void> => new Promise((r) => setImmediate(r))
const NATURAL = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

let pastaDosRecortes: string | null = null
let caminhoDoCache: string | null = null

export function configureManga(userDataDir: string): void {
  pastaDosRecortes = join(userDataDir, 'manga')
  caminhoDoCache = join(userDataDir, 'manga-cache.json')
}

/**
 * A pasta dos mangas: a das configuracoes, ou a "Mangás" ao lado da
 * biblioteca (D:\Animes -> D:\Mangás), que e onde ele ja guarda.
 */
export function pastaDosMangas(): string | null {
  const { mangaDir, libraryDir } = getSettings()
  if (mangaDir) return mangaDir
  if (!libraryDir) return null
  const vizinha = dirname(resolve(libraryDir))
  for (const nome of ['Mangás', 'Mangas', 'Manga', 'Mangá']) {
    const pasta = join(vizinha, nome)
    if (ehPasta(pasta)) return pasta
  }
  return null
}

/**
 * O arquivo e de manga? (um recorte do Dangai, ou uma pagina da pasta dele)
 *
 * E o que decide, na importacao, que o quadrinho deitado entra INTEIRO e nao
 * cobrindo a tela (ver ImageAsset.inteira).
 */
export function ehDoManga(caminho: string): boolean {
  const pastas = [pastaDosRecortes, pastaDosMangas()].filter((p): p is string => !!p)
  const alvo = normal(caminho)
  return pastas.some((p) => alvo.startsWith(`${normal(p)}/`))
}

/** O numero do capitulo pelo nome da pasta: "Capítulo 45", "Cap. 45", "Ch 45", "045". */
export function numeroDoCapitulo(nome: string): number | null {
  const m = /(?:cap[ií]tulo|cap\b\.?|ch\b\.?|chapter)\s*(\d{1,4})/i.exec(nome) ?? /^\s*(\d{1,4})\b/.exec(nome)
  return m ? Number(m[1]) : null
}

/**
 * Os quadrinhos de todos os capitulos, prontos para a grade.
 *
 * Nunca derruba a Biblioteca: pasta que sumiu, pagina que nao abre ou capitulo
 * pela metade ficam de fora, e o resto aparece.
 */
export async function lerMangas(
  publishThumb: (absolutePath: string) => string,
  onProgress: (mensagem: string) => void = () => {},
): Promise<LibraryClip[]> {
  const raiz = pastaDosMangas()
  if (!raiz || !ehPasta(raiz) || !pastaDosRecortes) return []

  const cache = await lerCache()
  const proximos: Record<string, CapituloGuardado> = {}
  let mudou = false

  for (const serie of subpastas(raiz)) {
    for (const capitulo of subpastas(join(raiz, serie))) {
      const dir = join(raiz, serie, capitulo)
      const paginas = paginasDe(dir)
      if (paginas.length === 0) continue
      const assinatura = assinar(dir, paginas)
      const anterior = cache.capitulos[dir]
      const aproveitavel =
        anterior &&
        anterior.assinatura === assinatura &&
        (anterior.itens.length === 0 || existsSync(anterior.itens[0]!.thumb))
      if (aproveitavel) {
        proximos[dir] = anterior
        continue
      }
      await daVez()
      try {
        const itens = await recortarCapitulo(serie, capitulo, dir, paginas, (feitas) =>
          onProgress(`Recortando o mangá ${serie} · ${capitulo} (${feitas}/${paginas.length})...`),
        )
        proximos[dir] = { assinatura, itens }
        mudou = true
      } catch (err) {
        console.warn('[manga] capitulo nao recortado:', dir, err)
      }
    }
  }

  if (mudou || Object.keys(proximos).length !== Object.keys(cache.capitulos).length) {
    gravarCache({ version: CACHE_VERSION, capitulos: proximos })
  }

  const saida: LibraryClip[] = []
  for (const capitulo of Object.values(proximos)) {
    for (const { thumb, ...resto } of capitulo.itens) {
      saida.push({ ...resto, thumbUrl: publishThumb(thumb), thumbPath: thumb })
    }
  }
  return saida
}

/** Os capitulos da pasta dos mangas, por serie (o resumo de manga escolhe daqui). */
export function capitulosDaPasta(): { serie: string; capitulos: { dir: string; capitulo: string; numero: number | null; paginas: number }[] }[] {
  const raiz = pastaDosMangas()
  if (!raiz || !ehPasta(raiz)) return []
  return subpastas(raiz)
    .map((serie) => ({
      serie,
      capitulos: subpastas(join(raiz, serie))
        .map((capitulo) => {
          const dir = join(raiz, serie, capitulo)
          return { dir, capitulo, numero: numeroDoCapitulo(capitulo), paginas: paginasDe(dir).length }
        })
        .filter((c) => c.paginas > 0),
    }))
    .filter((s) => s.capitulos.length > 0)
}

/** As paginas de um capitulo, em ordem, com o caminho inteiro. */
export function paginasDoCapitulo(dir: string): string[] {
  return paginasDe(dir).map((nome) => join(dir, nome))
}

/**
 * Os recortes de UM capitulo: do cache da Biblioteca, ou recortando agora (e
 * guardando, para a Biblioteca nao recortar de novo).
 */
export async function recortesDoCapitulo(
  dir: string,
  andamento: (feitas: number, total: number) => void = () => {},
): Promise<{ path: string; thumb: string; pagina: number; quadro: number | null }[]> {
  if (!pastaDosRecortes) throw new Error('A pasta dos recortes não foi configurada.')
  const paginas = paginasDe(dir)
  const assinatura = assinar(dir, paginas)
  const cache = await lerCache()
  let capitulo = cache.capitulos[dir]
  const aproveitavel =
    capitulo && capitulo.assinatura === assinatura && (capitulo.itens.length === 0 || existsSync(capitulo.itens[0]!.thumb))
  if (!aproveitavel) {
    const partes = resolve(dir).split(/[\\/]/)
    const nomeDoCapitulo = partes.at(-1) ?? ''
    const serie = partes.at(-2) ?? ''
    const itens = await recortarCapitulo(serie, nomeDoCapitulo, dir, paginas, (feitas) => andamento(feitas, paginas.length))
    capitulo = { assinatura, itens }
    const atual = await lerCache()
    gravarCache({ version: CACHE_VERSION, capitulos: { ...atual.capitulos, [dir]: capitulo } })
  }
  return capitulo!.itens.map((i) => ({ path: i.path, thumb: i.thumb, pagina: i.manga!.pagina, quadro: i.manga!.quadro }))
}

/**
 * Recorta as paginas de um capitulo: a pagina inteira e, depois dela, os
 * quadrinhos na ordem de leitura.
 */
async function recortarCapitulo(
  serie: string,
  capitulo: string,
  dir: string,
  paginas: string[],
  andamento: (feitas: number) => void,
): Promise<ItemGuardado[]> {
  const destino = join(pastaDosRecortes!, createHash('sha1').update(normal(dir)).digest('hex').slice(0, 16))
  mkdirSync(destino, { recursive: true })
  const numero = numeroDoCapitulo(capitulo)
  const itens: ItemGuardado[] = []

  const item = (pagina: number, quadro: number | null, caminho: string, thumb: string): ItemGuardado => {
    const shot = quadro === null ? dois(pagina) : `${dois(pagina)}-${quadro}`
    return {
      id: `${PREFIXO_DO_MANGA}${serie}/${capitulo}/${shot}`,
      path: caminho,
      thumb,
      // A resolucao cheia: e o que o leitor de cenas e o etiquetador olham.
      keyframe: caminho,
      anime: serie,
      animeTitle: '',
      season: 0,
      episode: numero ?? 0,
      shot,
      start: 0,
      duration: 0,
      characters: [],
      manga: { capitulo, pagina, quadro },
    }
  }

  for (const [i, nome] of paginas.entries()) {
    andamento(i + 1)
    await daVez()
    const arquivo = join(dir, nome)
    const pagina = i + 1
    try {
      const thumbDaPagina = join(destino, `${dois(pagina)}.webp`)
      await miniatura(sharp(arquivo).rotate(), thumbDaPagina)
      itens.push(item(pagina, null, arquivo, thumbDaPagina))

      const { data, info } = await sharp(arquivo).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true })
      const lida = acharQuadros(data, info.width, info.height, info.channels)
      for (const [k, quadro] of lida.quadros.entries()) {
        const base = join(destino, `${dois(pagina)}-${k + 1}`)
        const pixels = recortarQuadro(data, info.width, info.channels, lida, quadro)
        const cru = sharp(pixels, { raw: { width: quadro.largura, height: quadro.altura, channels: 3 } })
        await cru.clone().jpeg({ quality: 92 }).toFile(`${base}.jpg`)
        await miniatura(cru.clone(), `${base}.webp`)
        itens.push(item(pagina, k + 1, `${base}.jpg`, `${base}.webp`))
      }
    } catch (err) {
      // Uma pagina que nao abre nao leva o capitulo junto.
      console.warn('[manga] pagina nao lida:', arquivo, err)
    }
  }
  return itens
}

async function miniatura(imagem: ReturnType<typeof sharp>, destino: string): Promise<void> {
  await imagem.resize({ width: MINIATURA, withoutEnlargement: true }).webp({ quality: 72 }).toFile(destino)
}

function paginasDe(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && IMAGEM.test(e.name) && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort(NATURAL.compare)
  } catch {
    return []
  }
}

function subpastas(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort(NATURAL.compare)
  } catch {
    return []
  }
}

function assinar(dir: string, paginas: readonly string[]): string {
  const partes = paginas.map((nome) => {
    try {
      const s = statSync(join(dir, nome))
      return `${nome}:${s.size}:${Math.round(s.mtimeMs)}`
    } catch {
      return nome
    }
  })
  return createHash('sha1').update(partes.join('|')).digest('hex')
}

async function lerCache(): Promise<CacheDoManga> {
  try {
    const cru: unknown = JSON.parse(await readFile(caminhoDoCache!, 'utf8'))
    if (
      typeof cru === 'object' &&
      cru !== null &&
      (cru as CacheDoManga).version === CACHE_VERSION &&
      typeof (cru as CacheDoManga).capitulos === 'object'
    ) {
      return cru as CacheDoManga
    }
  } catch {
    // Sem cache: recorta tudo de novo.
  }
  return { version: CACHE_VERSION, capitulos: {} }
}

function gravarCache(dados: CacheDoManga): void {
  if (!caminhoDoCache) return
  try {
    const temp = `${caminhoDoCache}.tmp`
    writeFileSync(temp, JSON.stringify(dados), 'utf8')
    renameSync(temp, caminhoDoCache)
  } catch {
    // Cache e otimizacao: sem ele, a proxima leitura recorta de novo.
  }
}

function ehPasta(caminho: string): boolean {
  try {
    return statSync(caminho).isDirectory()
  } catch {
    return false
  }
}

function normal(caminho: string): string {
  return resolve(caminho).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function dois(n: number): string {
  return String(n).padStart(2, '0')
}
