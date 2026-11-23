import { DatabaseSync } from 'node:sqlite'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  EpisodioNoAncut,
  EventoDeOrganizar,
  FimDaRepescagem,
  FimDoReforco,
  PlanoDeJuntarAnimes,
  PlanoDeRenomear,
} from '@shared/ancut'
import { bancoDoAncut, episodioNoBanco } from '../mesclar'
import { perguntar, rodarLongo } from './motor'
import { pastaDoEpisodioDoClipe } from './revisar'

/**
 * [ancut] ORGANIZAR A BIBLIOTECA (23/11, "a estrutura do AnCut no Dangai"):
 * o que ele fazia na Biblioteca do AnCut, agora pelo botao direito na coluna
 * da Biblioteca do Dangai -- juntar dois animes numa pasta so, mudar a
 * temporada, passar um episodio para B-roll, tirar um personagem errado do
 * episodio, reforcar as fotos do elenco e repescar quem ficou sem marcacao.
 *
 * Como na revisao (revisar.ts): o banco so e LIDO daqui (achar o episodio do
 * clipe); tudo que muda e pelo motor, com os mesmos comandos e os mesmos dois
 * tempos do AnCut -- o plano primeiro (o que vai mudar), a tela mostra, e so
 * entao o `apply`. Mover centenas de clipes sem ele ver a lista seria decidir
 * por ele.
 */

const SEM_RESPOSTA = 'O motor de cortes não respondeu. Se o AnCut estiver cortando, espere ele terminar e tente de novo.'

/** O id do episodio de um clipe da Biblioteca (null = nao e de um episodio do AnCut). */
export function idDoEpisodio(clipe: string): number | null {
  const caminho = bancoDoAncut()
  if (!caminho) return null
  const db = new DatabaseSync(caminho, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    return episodioNoBanco(db, pastaDoEpisodioDoClipe(clipe))?.id ?? null
  } finally {
    db.close()
  }
}

/** Os ids distintos dos episodios de varios clipes (os que nao sao do AnCut ficam de fora). */
function idsDosEpisodios(clipes: readonly string[]): number[] {
  const pastas = [...new Set(clipes.map(pastaDoEpisodioDoClipe))]
  const caminho = bancoDoAncut()
  if (!caminho) return []
  const db = new DatabaseSync(caminho, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    return [...new Set(pastas.map((p) => episodioNoBanco(db, p)?.id).filter((id): id is number => typeof id === 'number'))]
  } finally {
    db.close()
  }
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')
const numero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** O episodio de um clipe, como o AnCut o tem: personagens, cenas sem ninguem, o video de origem. */
export async function episodioDoAncut(clipe: string): Promise<EpisodioNoAncut | null> {
  const id = idDoEpisodio(clipe)
  if (id === null) return null
  const r = await perguntar<Record<string, unknown>>(['results', String(id)], 'results')
  if (!r) throw new Error(SEM_RESPOSTA)
  const pasta = texto(r['episodeRoot']) || pastaDoEpisodioDoClipe(clipe)
  return {
    episodioId: numero(r['episodeId']) || id,
    anime: texto(r['animeTitle']),
    temporada: numero(r['season']),
    episodio: numero(r['episode']),
    tipo: texto(r['kind']),
    titulo: texto(r['titulo']),
    pasta,
    pastaDoAnime: dirname(pasta),
    cenas: numero(r['totalShots']),
    semPersonagem: numero(r['untaggedShots']),
    personagens: lista(r['characters']).flatMap((c) => {
      if (!c || typeof c !== 'object') return []
      const o = c as Record<string, unknown>
      return [{ id: numero(o['id']), nome: texto(o['name']), cenas: numero(o['shotCount']) }]
    }),
    video: texto(r['sourceFile']),
    videoExiste: r['sourceExists'] === true,
  }
}

/**
 * As outras pastas de anime ao lado da deste clipe (para onde juntar). So a
 * pasta de cima e lida -- um readdir, nunca a biblioteca inteira.
 */
export function animesVizinhos(clipe: string): string[] {
  const doAnime = dirname(pastaDoEpisodioDoClipe(clipe))
  const pai = dirname(doAnime)
  try {
    return readdirSync(pai, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_') && join(pai, d.name).toLowerCase() !== doAnime.toLowerCase())
      .map((d) => join(pai, d.name))
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true }))
  } catch {
    return []
  }
}

/** JUNTAR: os episodios do anime deste clipe passam para a pasta `destino`. Sem `aplicar`, so o plano. */
export async function juntarAnimes(clipe: string, destino: string, aplicar: boolean): Promise<PlanoDeJuntarAnimes> {
  const origem = dirname(pastaDoEpisodioDoClipe(clipe))
  const r = await perguntar<Record<string, unknown>>(['merge-anime', origem, destino, ...(aplicar ? ['apply'] : [])], 'merge-anime')
  if (!r) throw new Error(SEM_RESPOSTA)
  return {
    origem: texto(r['origem']) || origem,
    destino: texto(r['destino']) || destino,
    mover: lista(r['mover']).filter((x): x is string => typeof x === 'string'),
    conflitos: lista(r['conflitos']).filter((x): x is string => typeof x === 'string'),
    linhas: numero(r['linhas']),
    erro: texto(r['erro']),
    pode: r['pode'] === true,
    aplicado: r['aplicado'] === true,
  }
}

function plano(r: Record<string, unknown>): PlanoDeRenomear {
  return {
    mudancas: lista(r['mudancas']).flatMap((m) => {
      if (!m || typeof m !== 'object') return []
      const o = m as Record<string, unknown>
      return [{ episodioId: numero(o['episodeId']), de: texto(o['de']), para: texto(o['para']) }]
    }),
    conflitos: lista(r['conflitos']).filter((x): x is string => typeof x === 'string'),
    erro: texto(r['erro']),
    pode: r['pode'] === true,
    aplicado: r['aplicado'] === true,
  }
}

/** MUDAR A TEMPORADA dos episodios destes clipes (renomeia as pastas e reaponta o historico). */
export async function mudarTemporada(clipes: readonly string[], temporada: number, aplicar: boolean): Promise<PlanoDeRenomear> {
  const ids = idsDosEpisodios(clipes)
  if (ids.length === 0) throw new Error('Esses episódios não estão no histórico do AnCut.')
  const t = Math.max(1, Math.trunc(temporada))
  const r = await perguntar<Record<string, unknown>>(['set-season', String(t), ids.join(','), ...(aplicar ? ['apply'] : [])], 'set-season')
  if (!r) throw new Error(SEM_RESPOSTA)
  return plano(r)
}

/** PASSAR PARA B-ROLL os episodios destes clipes (o trailer que entrou como episodio). */
export async function passarParaBroll(clipes: readonly string[], aplicar: boolean): Promise<PlanoDeRenomear> {
  const ids = idsDosEpisodios(clipes)
  if (ids.length === 0) throw new Error('Esses episódios não estão no histórico do AnCut.')
  const r = await perguntar<Record<string, unknown>>(['to-broll', ids.join(','), ...(aplicar ? ['apply'] : [])], 'to-broll')
  if (!r) throw new Error(SEM_RESPOSTA)
  return plano(r)
}

/** TIRA um personagem do episodio inteiro: as cenas continuam, so deixam de ser dele. */
export async function tirarPersonagem(clipe: string, personagemId: number): Promise<EpisodioNoAncut | null> {
  const id = idDoEpisodio(clipe)
  if (id === null) throw new Error('Esse episódio não está no histórico do AnCut.')
  const r = await perguntar<{ error?: string }>(['remove-character', String(id), String(Math.trunc(personagemId))], 'remove-character')
  if (!r) throw new Error(SEM_RESPOSTA)
  if (r.error) throw new Error(r.error)
  return episodioDoAncut(clipe)
}

/**
 * REFORCAR AS FOTOS: os rostos mais confiaveis deste episodio viram
 * referencia do elenco -- o reconhecimento dos proximos episodios melhora. So
 * acrescenta, nunca apaga. Demora (carrega os modelos): o andamento vai por
 * `aoEvento`.
 */
export async function reforcar(clipe: string, aoEvento: (e: EventoDeOrganizar) => void): Promise<FimDoReforco> {
  const id = idDoEpisodio(clipe)
  if (id === null) throw new Error('Esse episódio não está no histórico do AnCut.')
  let erro = ''
  const r = await rodarLongo<Record<string, unknown>>(['harvest', String(id)], 'harvest-done', (e) => {
    if (e['type'] === 'harvest-progress') aoEvento({ tipo: 'reforcar', nome: texto(e['name']), feitos: numero(e['done']), total: numero(e['total']) })
    if (e['type'] === 'failed') erro = texto(e['message'])
  })
  if (!r) return { adicionadas: {}, total: 0, personagens: 0, erro: erro || SEM_RESPOSTA }
  const adicionadas: Record<string, number> = {}
  const cru = r['added']
  if (cru && typeof cru === 'object') for (const [k, v] of Object.entries(cru as Record<string, unknown>)) adicionadas[k] = numero(v)
  return { adicionadas, total: numero(r['total']), personagens: numero(r['characters']) }
}

/**
 * REPESCAR: marca quem ficou sem marcacao nos episodios destes clipes (a
 * segunda IA do motor passa pelas cenas sem ninguem). Um evento por episodio.
 */
export async function repescar(clipes: readonly string[], aoEvento: (e: EventoDeOrganizar) => void): Promise<FimDaRepescagem> {
  const ids = idsDosEpisodios(clipes)
  if (ids.length === 0) throw new Error('Esses episódios não estão no histórico do AnCut.')
  const r = await rodarLongo<Record<string, unknown>>(['repescar', ids.join(',')], 'repescar-fim', (e) => {
    if (e['type'] === 'repescar-progresso') aoEvento({ tipo: 'repescar', feitos: numero(e['feitos']), total: numero(e['total']), cenas: numero(e['cenas']) })
  })
  if (!r) return { episodios: 0, cenas: 0, porPersonagem: {}, erro: SEM_RESPOSTA }
  const porPersonagem: Record<string, number> = {}
  const cru = r['porPersonagem']
  if (cru && typeof cru === 'object') for (const [k, v] of Object.entries(cru as Record<string, unknown>)) porPersonagem[k] = numero(v)
  return {
    episodios: numero(r['episodios']),
    cenas: numero(r['cenas']),
    porPersonagem,
    ...(texto(r['erro']) ? { erro: texto(r['erro']) } : {}),
  }
}
