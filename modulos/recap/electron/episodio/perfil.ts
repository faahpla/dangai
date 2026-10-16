import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { MarcacaoDaSerie } from '../../shared/oped'

/**
 * O que o passo 1 guarda no PERFIL (userData/episodios), nunca numa biblioteca:
 * - indices.json: id do episodio -> o ultimo episodio.json gravado para ele.
 *   E como salvarExclusoes acha o arquivo so pelo id;
 * - series.json: a OP/ED que o usuario confirmou por serie, para sugerir no
 *   proximo episodio (origem 'serie');
 * - legendas/: a faixa extraida de cada .mkv, para nao demuxar 1,4 GB de novo.
 *
 * O userData mora aqui (e nao em indice.ts, que o reexporta para o main.ts)
 * para os auxiliares lerem o perfil sem import circular com o indice.
 */

let userData: string | (() => string) | null = null

/**
 * Chamada pelo main.ts depois do ready (pelo reexport de indice.ts). O que o
 * indice guarda no perfil mora aqui, nunca numa biblioteca externa.
 *
 * [recap] Aceita uma funcao: o modulo passa a pasta de dados do contexto
 * (`ctx.pasta('dados')`, que cria a pasta) e ela so e pedida quando o recap
 * grava algo -- desligado, o modulo nao cria nada no perfil do Dangai.
 */
export function configurarEpisodios(userDataDir: string | (() => string)): void {
  userData = userDataDir
}

/** O userData configurado. Lanca antes do configurarEpisodios. */
export function pastaDoPerfil(): string {
  if (!userData) throw new Error('Episodios nao configurados')
  return typeof userData === 'function' ? userData() : userData
}

export function pastaDosEpisodios(): string {
  return join(pastaDoPerfil(), 'episodios')
}

export function pastaDasLegendas(): string {
  return join(pastaDosEpisodios(), 'legendas')
}

function lerJson<T>(caminho: string, vazio: T): T {
  try {
    const cru: unknown = JSON.parse(readFileSync(caminho, 'utf8'))
    return cru && typeof cru === 'object' ? (cru as T) : vazio
  } catch {
    return vazio
  }
}

/** Temporario + rename: morrer no meio deixa o arquivo antigo inteiro. */
export function gravarJsonAtomico(caminho: string, dados: unknown): void {
  mkdirSync(dirname(caminho), { recursive: true })
  const temp = `${caminho}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(dados, null, 2), 'utf8')
  renameSync(temp, caminho)
}

// ------------------------------------------------------------- id -> arquivo

interface MapaDeIndices {
  versao: 1
  ultimos: Record<string, string>
}

function caminhoDoMapa(): string {
  return join(pastaDosEpisodios(), 'indices.json')
}

export function lembrarIndice(id: string, caminho: string): void {
  const mapa = lerJson<MapaDeIndices>(caminhoDoMapa(), { versao: 1, ultimos: {} })
  mapa.ultimos = { ...(mapa.ultimos ?? {}), [id]: caminho }
  try {
    gravarJsonAtomico(caminhoDoMapa(), mapa)
  } catch {
    // So atalho: sem ele, salvarExclusoes varre a biblioteca do Studio.
  }
}

export function indiceLembrado(id: string): string | null {
  const mapa = lerJson<MapaDeIndices>(caminhoDoMapa(), { versao: 1, ultimos: {} })
  const caminho = mapa.ultimos?.[id]
  return typeof caminho === 'string' ? caminho : null
}

// ------------------------------------------------------------- marcacao por serie

/** "Dr. STONE" e "Dr Stone" sao a mesma serie: caixa e pontuacao nao contam. */
export function chaveDoAnime(anime: string): string {
  return anime
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

interface MarcacaoGuardada extends MarcacaoDaSerie {
  anime: string
  temporada: number
  atualizadoEm: string
}

interface ArquivoDeSeries {
  versao: 1
  series: Record<string, MarcacaoGuardada>
}

function caminhoDasSeries(): string {
  return join(pastaDosEpisodios(), 'series.json')
}

export function guardarMarcacaoDaSerie(
  anime: string,
  temporada: number,
  marcacao: MarcacaoDaSerie,
): void {
  const arquivo = lerJson<ArquivoDeSeries>(caminhoDasSeries(), { versao: 1, series: {} })
  const chave = `${chaveDoAnime(anime)}|s${temporada}`
  arquivo.series = {
    ...(arquivo.series ?? {}),
    [chave]: { ...marcacao, anime, temporada, atualizadoEm: new Date().toISOString() },
  }
  gravarJsonAtomico(caminhoDasSeries(), arquivo)
}

/**
 * A marcacao confirmada mais recente da serie: a da mesma temporada, ou (sem
 * ela) a de outra temporada do mesmo anime.
 */
export function marcacaoDaSerie(anime: string, temporada: number): MarcacaoDaSerie | null {
  const arquivo = lerJson<ArquivoDeSeries>(caminhoDasSeries(), { versao: 1, series: {} })
  const base = chaveDoAnime(anime)
  if (!base) return null
  const series = arquivo.series ?? {}
  const exata = series[`${base}|s${temporada}`]
  const escolhida =
    exata ??
    Object.entries(series)
      .filter(([chave]) => chave.split('|')[0] === base)
      .map(([, m]) => m)
      .sort((a, b) => (b.atualizadoEm ?? '').localeCompare(a.atualizadoEm ?? ''))[0]
  if (!escolhida || !Array.isArray(escolhida.exclusoes) || !(escolhida.duracaoSec > 0)) return null
  return { episodio: escolhida.episodio, duracaoSec: escolhida.duracaoSec, exclusoes: escolhida.exclusoes }
}
