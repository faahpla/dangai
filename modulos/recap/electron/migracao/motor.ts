import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { arquivosEm, conferirSinal, copiarSeFalta, gravarJson, juntarMapa, lerJsonOuNull } from './arquivos'

/**
 * [recap] O MOTOR DO STUDIO na migracao (parte 5): os personagens batizados
 * no "Reconhecer na mao" (index.db) e as fotos do elenco (anime_db).
 *
 * - index.db: SO os animes e os personagens (com o centroide em `embedding`).
 *   Episodios e cenas ficam: apontam para a biblioteca do Studio, que nao vem
 *   (o episodio e cortado de novo), e um episodio "ja analisado" com a pasta
 *   velha faria o motor reaproveitar a pasta do Studio.
 * - O banco do Studio e lido por uma COPIA no temp (nunca aberto la: o sqlite
 *   pode criar journal ao lado). Sem banco no modulo, a copia sem episodios
 *   vira o banco dele; com banco, entra so o anime/personagem que falta (pelo
 *   anilist_id, ou pelo nome) -- o que ja existe no Dangai ganha.
 * - anime_db: cada arquivo que falta, menos o ref_features.npz (o motor refaz
 *   pelas fotos); busca_resolvida.json e pastas_de_anime.json juntam as chaves.
 */

/** O node:sqlite pelo getBuiltinModule: fora do bundle (o Electron 43 traz o node 24). */
function sqlite(): typeof import('node:sqlite') {
  return process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')
}

type Linha = Record<string, unknown>

function colunas(db: DatabaseSync, tabela: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name)
}

function chaveDoNome(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
}

export interface ResultadoDoIndice {
  trazidos: number
  jaEstavam: number
}

/** Junta o index.db do Studio no do modulo. `temp` = uma pasta so do modulo. */
export async function juntarIndiceDoMotor(studioDb: string, moduloDb: string, temp: string): Promise<ResultadoDoIndice> {
  if (!existsSync(studioDb)) return { trazidos: 0, jaEstavam: 0 }
  mkdirSync(temp, { recursive: true })
  const copia = join(temp, `studio-index-${process.pid}-${Date.now()}.db`)
  await copyFile(studioDb, copia)
  if (existsSync(`${studioDb}-wal`)) await copyFile(`${studioDb}-wal`, `${copia}-wal`)
  const { DatabaseSync } = sqlite()
  try {
    if (!existsSync(moduloDb)) {
      // O banco inteiro, sem episodios: o cascade leva cenas, favoritos e curadoria.
      const db = new DatabaseSync(copia)
      try {
        db.exec('PRAGMA foreign_keys = ON')
        db.exec('DELETE FROM episode')
        const n = Number((db.prepare('SELECT COUNT(*) AS n FROM character').get() as { n: number }).n)
        mkdirSync(dirname(moduloDb), { recursive: true })
        const parcial = `${moduloDb}.${process.pid}.migrando`
        rmSync(parcial, { force: true })
        db.prepare('VACUUM INTO ?').run(parcial)
        db.close()
        renameSync(parcial, moduloDb)
        return { trazidos: n, jaEstavam: 0 }
      } finally {
        if (db.isOpen) db.close()
      }
    }
    const origem = new DatabaseSync(copia, { readOnly: true })
    const destino = new DatabaseSync(moduloDb)
    try {
      return juntarPersonagens(origem, destino)
    } finally {
      origem.close()
      destino.close()
    }
  } finally {
    rmSync(copia, { force: true })
    rmSync(`${copia}-wal`, { force: true })
    rmSync(`${copia}-journal`, { force: true })
  }
}

function juntarPersonagens(origem: DatabaseSync, destino: DatabaseSync): ResultadoDoIndice {
  const colAnime = colunas(origem, 'anime').filter((c) => c !== 'id' && colunas(destino, 'anime').includes(c))
  const colChar = colunas(origem, 'character').filter((c) => c !== 'id' && c !== 'anime_id' && colunas(destino, 'character').includes(c))
  const animes = origem.prepare('SELECT * FROM anime').all() as Linha[]
  const personagens = origem.prepare('SELECT * FROM character').all() as Linha[]
  const animesDoDestino = destino.prepare('SELECT id, anilist_id, title FROM anime').all() as Linha[]
  const charsDoDestino = destino.prepare('SELECT id, anilist_id, anime_id, name FROM character').all() as Linha[]

  let trazidos = 0
  let jaEstavam = 0
  destino.exec('BEGIN')
  try {
    const mapa = new Map<unknown, number>()
    const inserirAnime = destino.prepare(`INSERT INTO anime(${colAnime.join(',')}) VALUES(${colAnime.map(() => '?').join(',')})`)
    for (const a of animes) {
      const igual = animesDoDestino.find((d) =>
        a['anilist_id'] != null ? d['anilist_id'] === a['anilist_id'] : d['anilist_id'] == null && chaveDoNome(d['title']) === chaveDoNome(a['title']),
      )
      if (igual) {
        mapa.set(a['id'], Number(igual['id']))
        continue
      }
      const r = inserirAnime.run(...(colAnime.map((c) => a[c] ?? null) as never[]))
      const id = Number(r.lastInsertRowid)
      mapa.set(a['id'], id)
      animesDoDestino.push({ id, anilist_id: a['anilist_id'] ?? null, title: a['title'] })
    }
    const cols = ['anime_id', ...colChar]
    const inserirChar = destino.prepare(`INSERT INTO character(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`)
    for (const c of personagens) {
      const anime = mapa.get(c['anime_id'])
      if (anime === undefined) continue
      const igual = charsDoDestino.find((d) =>
        c['anilist_id'] != null
          ? d['anilist_id'] === c['anilist_id']
          : d['anime_id'] === anime && chaveDoNome(d['name']) === chaveDoNome(c['name']),
      )
      if (igual) {
        jaEstavam++
        continue
      }
      inserirChar.run(anime, ...(colChar.map((k) => c[k] ?? null) as never[]))
      charsDoDestino.push({ anilist_id: c['anilist_id'] ?? null, anime_id: anime, name: c['name'] })
      trazidos++
    }
    destino.exec('COMMIT')
  } catch (err) {
    destino.exec('ROLLBACK')
    throw err
  }
  return { trazidos, jaEstavam }
}

/** Os nomes dos personagens de um index.db (para o teste e o resumo). */
export function personagensDoIndice(db: string): string[] {
  if (!existsSync(db)) return []
  const { DatabaseSync } = sqlite()
  const d = new DatabaseSync(db, { readOnly: true })
  try {
    return (d.prepare('SELECT name FROM character ORDER BY name').all() as { name: string }[]).map((r) => r.name)
  } finally {
    d.close()
  }
}

const FOTO = /\.(jpe?g|png|webp)$/i
/** Refeito pelo motor a partir das fotos (e chaveado pelo caminho: o do Studio nao serve). */
const REFEITOS = new Set(['ref_features.npz'])
/** Mapas que juntam chave a chave em vez de copiar. */
const MAPAS = new Set(['busca_resolvida.json'])

/** Os arquivos do anime_db que a migracao copia (relativos). */
export function arquivosDoElenco(animeDbDoStudio: string): string[] {
  return arquivosEm(animeDbDoStudio).filter((r) => !REFEITOS.has(basename(r)) && !(MAPAS.has(basename(r)) && dirname(r) === '.'))
}

/** Copia o que falta do anime_db. Devolve as fotos copiadas. */
export async function copiarElenco(
  animeDbDoStudio: string,
  animeDbDoModulo: string,
  aoCopiar: () => void,
  sinal?: AbortSignal,
): Promise<number> {
  let fotos = 0
  for (const rel of arquivosDoElenco(animeDbDoStudio)) {
    conferirSinal(sinal)
    const bytes = await copiarSeFalta(join(animeDbDoStudio, rel), join(animeDbDoModulo, rel), sinal)
    if (bytes > 0 && FOTO.test(rel)) fotos++
    aoCopiar()
  }
  // O atalho anime|temporada -> id do AniList: as do Dangai ganham.
  for (const nome of MAPAS) juntarArquivoDeMapa(join(animeDbDoStudio, nome), join(animeDbDoModulo, nome), [])
  return fotos
}

/**
 * Junta um JSON de mapas: na raiz (`campos` vazio) ou nos campos dados
 * (pastas_de_anime.json: `nomes` e `franquias`). Os do destino ganham.
 */
export function juntarArquivoDeMapa(origem: string, destino: string, campos: readonly string[]): number {
  const o = lerJsonOuNull(origem)
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 0
  const atual = lerJsonOuNull(destino)
  const d: Record<string, unknown> = atual && typeof atual === 'object' && !Array.isArray(atual) ? { ...(atual as Record<string, unknown>) } : {}
  const or = o as Record<string, unknown>
  let novas = 0
  if (campos.length === 0) {
    novas = juntarMapa(d, or)
  } else {
    for (const [k, v] of Object.entries(or)) {
      if (campos.includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
        const sub = d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) ? { ...(d[k] as Record<string, unknown>) } : {}
        novas += juntarMapa(sub, v as Record<string, unknown>)
        d[k] = sub
      }
      // O resto (o `semeado` do pastas_de_anime) e do processo do Studio: fica la.
    }
  }
  if (novas > 0 || !existsSync(destino)) gravarJson(destino, d)
  return novas
}
