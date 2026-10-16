import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

/**
 * [recap] OS LEITORES DE PASTA DA BIBLIOTECA, copiados do nucleo
 * (electron/services/library.ts), onde sao privados.
 *
 * O passo 1 le a pasta de um episodio cortado (shots.json, keyframes,
 * characters.json) com as MESMAS regras da grade do Dangai, para o indice e a
 * Biblioteca falarem das mesmas cenas. No Studio o library.ts exportava estes;
 * aqui eles ficam copiados para o modulo nao mexer no nucleo. Mudou la? Copie
 * de novo (sao funcoes puras de leitura, sem cache e sem escrita).
 */

const MAX_DEPTH = 3

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : ''
}

/** O shots.json do AnCut, so os campos que usamos. */
export interface RawShot {
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
 * As linhas do json que um arquivo representa.
 *
 * `0008.mp4` e uma cena so. `0164-0167.mp4` e o resultado de o usuario ter
 * juntado quatro cenas no AnCut -- os arquivos individuais somem e sobra este,
 * que nao existe em lugar nenhum do json. Ele vale pelas quatro linhas juntas,
 * inclusive somando os personagens: quem aparece so na terceira parte continua
 * encontravel pelo clipe inteiro.
 */
export function abrangidas(shot: string, porShot: ReadonlyMap<string, RawShot>): RawShot[] {
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
export function nomesCanonicos(dir: string): ReadonlyMap<string, string> {
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

/**
 * O shots.json aponta para o keyframe do meio (`_1`), mas ele nem sempre esta
 * la: a lixeira leva justamente esse, e um punhado de cenas nunca teve. Como
 * existem tres por cena, cair para os vizinhos salva a miniatura.
 */
export function acharKeyframe(
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

/**
 * Acha as pastas de episodio abaixo da raiz.
 *
 * Pasta que comeca com `_` fica de fora, e isso nao e cosmetico: `_lixeira` e
 * `_quarentena_...` guardam material que o usuario ja tirou de circulacao, com
 * shots.json proprio e tudo. Sem este filtro o descartado voltaria para a busca.
 */
export function* episodiosEm(dir: string, profundidade: number): Generator<string> {
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
export function arquivosEm(dir: string): Set<string> {
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

/**
 * Ordem natural, entendendo o numero: sem isto "0164-0167" e "10" cairiam em
 * lugares errados na comparacao letra a letra.
 */
export function naturalmente(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })
}
