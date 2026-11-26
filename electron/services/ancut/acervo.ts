import { DatabaseSync } from 'node:sqlite'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import {
  chaveDoVideo,
  paraCortarNaPasta,
  pastaDoAnime,
  type Acervo,
  type CenaDoAcervo,
  type EpisodioDoAcervo,
  type EpisodioSemPasta,
  type InfoDoPacote,
  type ParaCortar,
  type PersonagemDoAcervo,
  type PersonagemDoEpisodioAberto,
  type ResultadoDoPacote,
  type TipoDoEpisodio,
} from '@shared/acervo'
import { publish } from '../media-server'
import { bancoDoAncut } from '../mesclar'
import { pastaDeSaida, perguntar } from './motor'

/**
 * [ancut] O ACERVO (25/11): a Biblioteca do AnCut dentro do Dangai. Le o que
 * o motor diz (`recent`, `characters`, `character-shots`, `shots`, `results`)
 * e muda so pelo motor (`tag-shot`, `tag-shot-new`, `remove-character`,
 * `delete`, `cast-*`) -- os mesmos comandos da tela do AnCut, entao os dois
 * apps continuam vendo o mesmo acervo. O banco so e lido aqui para uma coisa
 * que o `recent` nao traz: de onde veio cada episodio (o "o que falta cortar").
 */

const SEM_RESPOSTA = 'O motor de cortes não respondeu. Se o AnCut estiver cortando, espere ele terminar e tente de novo.'

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')
const numero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const tipo = (v: unknown): TipoDoEpisodio => (v === 'OP' || v === 'ED' || v === 'MOVIE' || v === 'BROLL' ? v : '')
/** O caminho em URL do media-server, ou '' (sem arquivo). */
const url = (caminho: string): string => (caminho ? publish(caminho) : '')

/** episodio -> o video de onde saiu (o banco, so leitura). Vazio sem banco. */
function videosDeOrigem(): Map<number, string> {
  const caminho = bancoDoAncut()
  const saida = new Map<number, string>()
  if (!caminho) return saida
  const db = new DatabaseSync(caminho, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    for (const r of db.prepare('SELECT id, source_file FROM episode').all() as { id: number; source_file: string | null }[]) {
      if (r.source_file) saida.set(Number(r.id), String(r.source_file))
    }
  } catch {
    /* banco de um motor velho sem a coluna: sem o "o que falta" */
  } finally {
    db.close()
  }
  return saida
}

/**
 * O que falta cortar de cada anime: os videos das pastas de onde os episodios
 * dele vieram que ainda nao viraram episodio. Uma leitura de pasta por pasta
 * de origem (nunca a biblioteca inteira).
 */
function oQueFaltaCortar(episodios: readonly EpisodioDoAcervo[]): Record<string, ParaCortar[]> {
  // Os de origem do acervo todo: o cortado como outro anime tambem e cortado.
  const jaCortados = new Set(episodios.filter((e) => e.video).map((e) => chaveDoVideo(e.video)))
  const porAnime = new Map<string, EpisodioDoAcervo[]>()
  for (const e of episodios) {
    if (!e.video || e.tipo === 'BROLL') continue
    const chave = pastaDoAnime(e.pasta).toLowerCase()
    porAnime.set(chave, [...(porAnime.get(chave) ?? []), e])
  }
  const saida: Record<string, ParaCortar[]> = {}
  for (const [anime, eps] of porAnime) {
    const porPasta = new Map<string, EpisodioDoAcervo[]>()
    for (const e of eps) {
      const pasta = dirname(e.video)
      porPasta.set(pasta.toLowerCase(), [...(porPasta.get(pasta.toLowerCase()) ?? []), e])
    }
    const achados: ParaCortar[] = []
    for (const daPasta of porPasta.values()) {
      const pasta = dirname(daPasta[0]!.video)
      // A pasta de downloads que ja nao existe (apagou, HD fora): nada a dizer.
      if (!existsSync(pasta)) continue
      let arquivos: string[]
      try {
        arquivos = readdirSync(pasta, { withFileTypes: true })
          .filter((d) => d.isFile())
          .map((d) => join(pasta, d.name))
      } catch {
        continue
      }
      achados.push(...paraCortarNaPasta(arquivos, daPasta, jaCortados))
    }
    if (achados.length) saida[anime] = achados
  }
  return saida
}

/** O acervo inteiro: os episodios cortados (com capa), os sem pasta e o que falta cortar. */
export async function acervo(): Promise<Acervo> {
  const r = await perguntar<Record<string, unknown>>(['recent'], 'recent', 180_000)
  if (!r) throw new Error(SEM_RESPOSTA)
  const videos = videosDeOrigem()
  // Um existsSync por video (nao le pasta): o "reconhecer os so cortados" precisa saber quais ainda dao.
  const existe = new Map<string, boolean>()
  const noLugar = (v: string): boolean => {
    if (!v) return false
    if (!existe.has(v)) existe.set(v, existsSync(v))
    return existe.get(v)!
  }
  const episodios: EpisodioDoAcervo[] = lista(r['episodes']).flatMap((cru) => {
    if (!cru || typeof cru !== 'object') return []
    const e = cru as Record<string, unknown>
    const pasta = texto(e['episodeRoot'])
    const id = numero(e['episodeId'])
    const capa = texto(e['cover'])
    return [
      {
        episodioId: id,
        anime: texto(e['animeTitle']),
        temporada: numero(e['season']),
        episodio: numero(e['episode']),
        tipo: tipo(e['kind']),
        pasta,
        cenas: numero(e['shotCount']),
        marcadas: numero(e['tagged']),
        cortadoEm: texto(e['processedAt']),
        capa: capa ? url(isAbsolute(capa) ? capa : join(pasta, capa)) : '',
        titulo: texto(e['titulo']),
        origem: texto(e['origem']),
        video: videos.get(id) ?? '',
        videoExiste: noLugar(videos.get(id) ?? ''),
      },
    ]
  })
  const semPasta: EpisodioSemPasta[] = lista(r['semPasta']).flatMap((cru) => {
    if (!cru || typeof cru !== 'object') return []
    const e = cru as Record<string, unknown>
    return [
      {
        episodioId: numero(e['episodeId']),
        anime: texto(e['animeTitle']),
        temporada: numero(e['season']),
        episodio: numero(e['episode']),
        tipo: tipo(e['kind']),
        titulo: texto(e['titulo']),
        pasta: texto(e['episodeRoot']),
      },
    ]
  })
  return { episodios, semPasta, paraCortar: oQueFaltaCortar(episodios), saida: pastaDeSaida() }
}

/** Os personagens do acervo inteiro (as grafias do mesmo ja juntas pelo motor), com o rosto. */
export async function personagensDoAcervo(): Promise<PersonagemDoAcervo[]> {
  const r = await perguntar<Record<string, unknown>>(['characters'], 'characters', 180_000)
  if (!r) throw new Error(SEM_RESPOSTA)
  return lista(r['characters']).flatMap((cru) => {
    if (!cru || typeof cru !== 'object') return []
    const c = cru as Record<string, unknown>
    const nome = texto(c['name'])
    if (!nome) return []
    const rosto = texto(c['avatar'])
    return [
      {
        nome,
        ids: lista(c['ids']).filter((x): x is number => typeof x === 'number'),
        apelidos: lista(c['aliases']).filter((x): x is string => typeof x === 'string'),
        cenas: numero(c['shots']),
        episodios: numero(c['episodes']),
        porAnime: lista(c['byAnime']).flatMap((p) => {
          if (!p || typeof p !== 'object') return []
          const o = p as Record<string, unknown>
          return [{ anime: texto(o['anime']), cenas: numero(o['shots']), episodios: numero(o['episodes']) }]
        }),
        rosto: rosto && existsSync(rosto) ? url(rosto) : '',
      },
    ]
  })
}

/** As cenas destes personagens (ids de um grupo), no acervo inteiro; `anime` filtra pela pasta. */
export async function cenasDoPersonagem(ids: readonly number[], anime?: string): Promise<CenaDoAcervo[]> {
  const limpos = ids.filter((i) => Number.isInteger(i) && i > 0)
  if (limpos.length === 0) return []
  const r = await perguntar<Record<string, unknown>>(['character-shots', limpos.join(',')], 'character-shots', 180_000)
  if (!r) throw new Error(SEM_RESPOSTA)
  const saida = texto(r['outputDir'])
  return lista(r['shots']).flatMap((cru) => {
    if (!cru || typeof cru !== 'object') return []
    const s = cru as Record<string, unknown>
    const doAnime = texto(s['anime'])
    if (anime && doAnime.toLowerCase() !== anime.toLowerCase()) return []
    const clipe = texto(s['absolute']) || (saida ? join(saida, texto(s['file'])) : '')
    const kf = texto(s['keyframe'])
    return [
      {
        id: numero(s['id']),
        idx: numero(s['idx']),
        clipe,
        quadro: kf ? url(isAbsolute(kf) ? kf : join(saida, kf)) : '',
        video: clipe && existsSync(clipe) ? url(clipe) : '',
        duracao: numero(s['duration']),
        confianca: typeof s['confidence'] === 'number' ? s['confidence'] : null,
        anime: doAnime,
        temporada: numero(s['season']),
        episodio: numero(s['episode']),
        tipo: tipo(s['kind']),
        episodioId: numero(s['episodeId']),
      },
    ]
  })
}

/** Os personagens de um episodio (e quantas cenas tem cada um, e sem ninguem). */
export async function personagensDoEpisodio(episodioId: number): Promise<{ personagens: PersonagemDoEpisodioAberto[]; cenas: number; semNinguem: number; video: string; videoExiste: boolean }> {
  const r = await perguntar<Record<string, unknown>>(['results', String(Math.trunc(episodioId))], 'results', 120_000)
  if (!r) throw new Error(SEM_RESPOSTA)
  return {
    personagens: lista(r['characters']).flatMap((c) => {
      if (!c || typeof c !== 'object') return []
      const o = c as Record<string, unknown>
      return [{ id: numero(o['id']), nome: texto(o['name']), cenas: numero(o['shotCount']) }]
    }),
    cenas: numero(r['totalShots']),
    semNinguem: numero(r['untaggedShots']),
    video: texto(r['sourceFile']),
    videoExiste: r['sourceExists'] === true,
  }
}

/**
 * As cenas de um episodio: de um personagem, todas (TODAS = 0) ou as sem
 * ninguem (SEM_NINGUEM = -2, com o palpite da repescagem). Os caminhos do
 * motor sao relativos a pasta do episodio.
 */
export async function cenasDoEpisodio(episodioId: number, pasta: string, personagemId: number): Promise<CenaDoAcervo[]> {
  const r = await perguntar<Record<string, unknown>>(['shots', String(Math.trunc(episodioId)), String(Math.trunc(personagemId))], 'shots', 120_000)
  if (!r) throw new Error(SEM_RESPOSTA)
  return lista(r['shots']).flatMap((cru) => {
    if (!cru || typeof cru !== 'object') return []
    const s = cru as Record<string, unknown>
    const arquivo = texto(s['file'])
    const clipe = arquivo ? (isAbsolute(arquivo) ? arquivo : join(pasta, arquivo)) : ''
    const kf = texto(s['keyframe'])
    const p = s['sugestao']
    const palpite =
      p && typeof p === 'object' && texto((p as Record<string, unknown>)['name'])
        ? { id: numero((p as Record<string, unknown>)['id']), nome: texto((p as Record<string, unknown>)['name']) }
        : null
    return [
      {
        id: numero(s['id']),
        idx: numero(s['idx']),
        clipe,
        quadro: kf ? url(isAbsolute(kf) ? kf : join(pasta, kf)) : '',
        video: clipe && existsSync(clipe) ? url(clipe) : '',
        duracao: numero(s['duration']) || Math.max(0, numero(s['end']) - numero(s['start'])),
        confianca: typeof s['confidence'] === 'number' ? s['confidence'] : null,
        anime: '',
        temporada: 0,
        episodio: 0,
        tipo: '' as TipoDoEpisodio,
        episodioId,
        ...(personagemId === -2 ? { palpite } : {}),
      },
    ]
  })
}

/** Marca (ou tira) um personagem em varias cenas de uma vez. Volta quantas mudaram. */
export async function marcarCenas(cenaIds: readonly number[], personagemId: number, remover: boolean): Promise<number> {
  const ids = cenaIds.filter((i) => Number.isInteger(i) && i > 0)
  if (ids.length === 0) return 0
  const r = await perguntar<{ error?: string; count?: number }>(['tag-shot', ids.join(','), String(Math.trunc(personagemId)), ...(remover ? ['remove'] : [])], 'tag-shot', 120_000)
  if (!r) throw new Error(SEM_RESPOSTA)
  if (r.error) throw new Error(r.error)
  return numero(r.count) || ids.length
}

/** Marca as cenas com um personagem pelo NOME (o motor cria se o anime ainda nao tem). */
export async function marcarCenasComNome(cenaIds: readonly number[], nome: string): Promise<number> {
  const ids = cenaIds.filter((i) => Number.isInteger(i) && i > 0)
  const limpo = nome.trim().slice(0, 80)
  if (ids.length === 0 || !limpo) return 0
  const r = await perguntar<{ error?: string; count?: number }>(['tag-shot-new', ids.join(','), limpo], 'tag-shot', 120_000)
  if (!r) throw new Error(SEM_RESPOSTA)
  if (r.error) throw new Error(r.error)
  return numero(r.count) || ids.length
}

/** Manda cenas para a lixeira do episodio delas (o motor move para <episodio>\_lixeira). */
export async function lixeiraDasCenas(porEpisodio: readonly { episodioId: number; cenaIds: number[] }[]): Promise<number> {
  let feitas = 0
  for (const g of porEpisodio) {
    const ids = g.cenaIds.filter((i) => Number.isInteger(i) && i > 0)
    if (ids.length === 0) continue
    const r = await perguntar<{ deletedCount?: number }>(['delete', String(Math.trunc(g.episodioId)), ...ids.map(String)], 'deleted', 120_000)
    if (!r) throw new Error(SEM_RESPOSTA)
    feitas += numero(r.deletedCount)
  }
  return feitas
}

/**
 * JUNTAR UM PERSONAGEM NO OUTRO: as cenas de `de` passam a ser de `para`, e
 * `de` sai de cada episodio. E o que o AnCut fazia na mao (marcar as cenas,
 * tirar o errado): pelo motor, a marcacao fica nos tres lugares (banco, pasta
 * do personagem, shots.json) e o "tirar" vira um bloqueio -- uma reanalise do
 * episodio nao traz o nome antigo de volta. So dentro do anime da secao
 * (`anime`): o mesmo nome em outro anime e outra pessoa.
 *
 * A TRAVA: o motor acha o personagem pelo NOME dentro do anime da cena ("Aki"
 * e "Hayakawa Aki" sao o mesmo para ele). Se o destino cair num id de `de`,
 * tirar `de` tiraria o proprio destino -- e as cenas ficariam sem ninguem
 * (foi o que um "renomear" fez no teste de 25/11). Entao: marca, olha quem o
 * motor marcou, e so tira se for outra pessoa.
 */
export async function juntarPersonagem(
  de: { ids: number[]; anime: string },
  para: { id: number },
  aoAndar: (feitos: number, total: number) => void,
): Promise<{ cenas: number; episodios: number }> {
  if (de.ids.includes(para.id)) throw new Error('É o mesmo personagem.')
  const cenas = await cenasDoPersonagem(de.ids, de.anime)
  if (cenas.length === 0) return { cenas: 0, episodios: 0 }
  const ids = cenas.map((c) => c.id)
  // 1) As cenas ganham o personagem certo (de 200 em 200: a linha de comando tem limite).
  const marcados = new Set<number>()
  for (let i = 0; i < ids.length; i += 200) {
    const r = await perguntar<{ error?: string; characterId?: number }>(['tag-shot', ids.slice(i, i + 200).join(','), String(Math.trunc(para.id))], 'tag-shot', 120_000)
    if (!r) throw new Error(SEM_RESPOSTA)
    if (r.error) throw new Error(r.error)
    if (typeof r.characterId === 'number') marcados.add(r.characterId)
  }
  if ([...marcados].some((id) => de.ids.includes(id))) {
    throw new Error('O motor considera os dois o mesmo personagem (os nomes batem), então as cenas já são dele. Nada foi tirado.')
  }
  // 2) O antigo sai de cada episodio em que estava (so os ids dele que tem cena la).
  const pares = new Map<string, { ep: number; id: number }>()
  for (const c of cenas) for (const id of de.ids) pares.set(`${c.episodioId}:${id}`, { ep: c.episodioId, id })
  const lista = [...pares.values()]
  let feitos = 0
  for (const { ep, id } of lista) {
    const r = await perguntar<{ error?: string }>(['remove-character', String(ep), String(id)], 'remove-character', 120_000)
    // "personagem nao existe" (a outra grafia ja saiu) nao derruba o resto.
    if (!r) throw new Error(SEM_RESPOSTA)
    feitos += 1
    aoAndar(feitos, lista.length)
  }
  return { cenas: ids.length, episodios: new Set(cenas.map((c) => c.episodioId)).size }
}

// --------------------------------------------------------- o pacote de elenco

function resultado(r: Record<string, unknown> | null, arquivo = ''): ResultadoDoPacote {
  if (!r) return { erro: SEM_RESPOSTA, personagens: 0, comFoto: 0, semFoto: [], fotos: 0, juntados: 0, titulo: '', arquivo }
  return {
    erro: texto(r['erro']) || texto(r['error']),
    personagens: numero(r['characters']),
    comFoto: numero(r['withPhotos']),
    semFoto: lista(r['withoutPhotos']).filter((x): x is string => typeof x === 'string'),
    fotos: numero(r['photos']),
    juntados: numero(r['merged']),
    titulo: texto(r['title']),
    arquivo: texto(r['file']) || arquivo,
  }
}

/** Exporta os personagens destes episodios num .zip (nomes, fotos e o reconhecimento). */
export async function exportarElenco(arquivo: string, episodioIds: readonly number[], nome: string): Promise<ResultadoDoPacote> {
  const ids = episodioIds.filter((i) => Number.isInteger(i) && i > 0)
  if (ids.length === 0) return { ...resultado(null, arquivo), erro: 'Nenhum episódio para exportar.' }
  const r = await perguntar<Record<string, unknown>>(['cast-export', arquivo, ids.join(','), nome || 'anime'], 'cast-export', 600_000)
  return resultado(r, arquivo)
}

/** O que um pacote traz (antes de importar). */
export async function lerPacote(arquivo: string): Promise<InfoDoPacote> {
  const r = await perguntar<Record<string, unknown>>(['cast-inspect', arquivo], 'cast-inspect', 120_000)
  if (!r) return { erro: SEM_RESPOSTA, titulo: '', titulos: [], personagens: 0, comFoto: 0, fotos: 0, prontos: 0, exemplo: '' }
  return {
    erro: texto(r['erro']) || texto(r['error']),
    titulo: texto(r['title']),
    titulos: lista(r['titles']).filter((x): x is string => typeof x === 'string'),
    personagens: numero(r['characters']),
    comFoto: numero(r['withPhotos']),
    fotos: numero(r['photos']),
    prontos: numero(r['centroids']),
    exemplo: texto(r['sampleFile']),
  }
}

/** Importa o pacote, ligado ao anime `titulo` (vale para qualquer temporada com esse nome). */
export async function importarPacote(arquivo: string, titulo: string): Promise<ResultadoDoPacote> {
  const r = await perguntar<Record<string, unknown>>(['cast-import', arquivo, titulo.trim()], 'cast-import', 600_000)
  return resultado(r, arquivo)
}

/** O arquivo existe e e um .zip (o dialogo ja filtra; isto e a conferencia do main). */
export function pacoteValido(arquivo: string): boolean {
  try {
    return /\.zip$/i.test(arquivo) && statSync(arquivo).isFile()
  } catch {
    return false
  }
}
