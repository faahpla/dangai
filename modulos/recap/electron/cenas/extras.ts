import { readFileSync, statSync } from 'node:fs'
import { temPlanos, type EpisodeIndex, type Plano } from '../../shared/episodio'
import type { RascunhoDoRecap } from '../../shared/roteiro'
import { comExtras, MAXIMO_DE_EXTRAS, planosDoExtra, type EpisodioExtra } from '../../shared/extras'
import type { EpisodioConhecido, ExtrasDasCenas } from '../../shared/canais'
import { abrirIndicePorId } from '../episodio/abrir-indice'
import { indicesLembrados } from '../episodio/perfil'
import { gravarRascunho, lerRascunhoDoDisco } from '../gerar/rascunho'
import { tituloDoEpisodio } from '../gerar/prompts'
import { comMesclas } from './mesclas'

/**
 * EPISODIOS EXTRAS no main (shared/extras.ts): abrir, listar e escolher.
 * Extra que nao abre (apagado, biblioteca fora) fica de fora em silencio na
 * montagem; a tela mostra `ok: false` e as cenas dele viram "sem arquivo"
 * ate o usuario tirar o extra (o casar refaz as frases).
 */

/** Os indices dos extras do rascunho, com as mesclas do Dangai. Os que nao abrem ficam de fora. */
export function indicesDosExtras(r: Pick<RascunhoDoRecap, 'episodiosExtras'>): EpisodeIndex[] {
  const saida: EpisodeIndex[] = []
  for (const e of r.episodiosExtras) {
    try {
      saida.push(comMesclas(abrirIndicePorId(e.episodioId, e.indicePath).indice))
    } catch {
      /* fica de fora */
    }
  }
  return saida
}

/** O indice do principal com os planos dos extras (prefixados) no fim: para achar plano por id. */
export function comOsExtras<T extends Pick<EpisodeIndex, 'planos'>>(r: Pick<RascunhoDoRecap, 'episodiosExtras'>, indice: T): T {
  return r.episodiosExtras.length === 0 ? indice : comExtras(indice, indicesDosExtras(r))
}

/** Para a tela: os extras (aberto ou nao) e os planos deles, prefixados. */
export function extrasDasCenas(rascunhoId: string): ExtrasDasCenas {
  const r = lerRascunhoDoDisco(rascunhoId)
  const extras: ExtrasDasCenas['extras'] = []
  const planos: Plano[] = []
  for (const e of r.episodiosExtras) {
    try {
      const indice = comMesclas(abrirIndicePorId(e.episodioId, e.indicePath).indice)
      const ok = temPlanos(indice)
      extras.push({ ...e, ok, cenas: indice.planos.length })
      planos.push(...planosDoExtra(indice))
    } catch {
      extras.push({ ...e, ok: false, cenas: 0 })
    }
  }
  return { extras, planos }
}

// ----------------------------------------------------------- os conhecidos

interface Cabecalho {
  mtimeMs: number
  info: Omit<EpisodioConhecido, 'episodioId' | 'indicePath'> | null
}
const cabecalhos = new Map<string, Cabecalho>()

function cabecalhoDe(caminho: string): Cabecalho['info'] {
  let mtimeMs: number
  try {
    mtimeMs = statSync(caminho).mtimeMs
  } catch {
    return null
  }
  const guardado = cabecalhos.get(caminho)
  if (guardado && guardado.mtimeMs === mtimeMs) return guardado.info
  let info: Cabecalho['info'] = null
  try {
    const cru = JSON.parse(readFileSync(caminho, 'utf8')) as Partial<EpisodeIndex>
    if (typeof cru.anime === 'string' && typeof cru.temporada === 'number' && typeof cru.episodio === 'number') {
      info = {
        anime: cru.anime,
        temporada: cru.temporada,
        episodio: cru.episodio,
        titulo: tituloDoEpisodio({ anime: cru.anime, temporada: cru.temporada, episodio: cru.episodio, kind: cru.kind ?? '' }),
        cenas: Array.isArray(cru.planos) ? cru.planos.length : 0,
      }
    }
  } catch {
    info = null
  }
  cabecalhos.set(caminho, { mtimeMs, info })
  return info
}

/**
 * Os episodios que este Dangai ja abriu (o mapa indices.json), menos o
 * principal: os do mesmo anime primeiro, em ordem de temporada e episodio.
 */
export function episodiosConhecidos(rascunhoId: string): EpisodioConhecido[] {
  const r = lerRascunhoDoDisco(rascunhoId)
  let animeDoPrincipal = ''
  try {
    animeDoPrincipal = abrirIndicePorId(r.episodioId, r.indicePath).indice.anime
  } catch {
    /* sem o principal: so a ordem por nome */
  }
  const chave = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const doMesmo = chave(animeDoPrincipal)
  const saida: EpisodioConhecido[] = []
  for (const [episodioId, indicePath] of Object.entries(indicesLembrados())) {
    if (episodioId === r.episodioId || !/^ep_[0-9a-f]{40}$/.test(episodioId)) continue
    const info = cabecalhoDe(indicePath)
    if (info) saida.push({ episodioId, indicePath, ...info })
  }
  return saida.sort(
    (a, b) =>
      Number(chave(b.anime) === doMesmo) - Number(chave(a.anime) === doMesmo) ||
      a.anime.localeCompare(b.anime) ||
      a.temporada - b.temporada ||
      a.episodio - b.episodio,
  )
}

/** Troca a lista de extras do rascunho (ids; o principal e os repetidos saem). Devolve o rascunho gravado. */
export function definirExtras(rascunhoId: string, episodioIds: readonly string[]): RascunhoDoRecap {
  const r = lerRascunhoDoDisco(rascunhoId)
  const lista: EpisodioExtra[] = []
  for (const id of new Set(episodioIds)) {
    if (id === r.episodioId || lista.length >= MAXIMO_DE_EXTRAS) continue
    const ja = r.episodiosExtras.find((e) => e.episodioId === id)
    try {
      const aberto = abrirIndicePorId(id, ja?.indicePath ?? null)
      lista.push({ episodioId: id, indicePath: aberto.caminho, titulo: tituloDoEpisodio(aberto.indice) })
    } catch (e) {
      if (ja) lista.push(ja)
      else throw e
    }
  }
  const mesmo = lista.map((e) => e.episodioId).join('|') === r.episodiosExtras.map((e) => e.episodioId).join('|')
  if (mesmo && lista.every((e, i) => e.indicePath === r.episodiosExtras[i]?.indicePath)) return r
  const novo: RascunhoDoRecap = { ...r, episodiosExtras: lista, atualizadoEm: new Date().toISOString() }
  gravarRascunho(novo)
  return novo
}
