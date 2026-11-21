import { DatabaseSync } from 'node:sqlite'
import { dirname, relative } from 'node:path'
import type { CenaNoAncut, PersonagemDoAncut, PlanoDeApagarEpisodio } from '@shared/ancut'
import { bancoDoAncut, episodioNoBanco } from '../mesclar'
import { perguntar } from './motor'

/**
 * [ancut] REVISAR NA BIBLIOTECA (20/11): mandar cena para a lixeira, corrigir
 * quem esta na cena, apagar o episodio -- o que ele fazia no AnCut, agora na
 * Biblioteca do Dangai.
 *
 * Ler e daqui: o banco do AnCut (index.db) aberto SO PARA LEITURA, para achar
 * qual episodio e qual cena sao o clipe da Biblioteca e quem esta nela (uma
 * consulta, sem abrir processo). Mudar e sempre pelo MOTOR do AnCut (os
 * comandos dele): ele move o arquivo para a lixeira, mexe nas pastas de
 * personagem e reescreve o shots.json que a Biblioteca le -- tudo junto, do
 * jeito que o AnCut faz. O Dangai nunca grava nesse banco por aqui.
 */

const normal = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/** O banco do AnCut so para leitura (null = nao tem AnCut nesta maquina). */
function abrir(): DatabaseSync | null {
  const caminho = bancoDoAncut()
  if (!caminho) return null
  const db = new DatabaseSync(caminho, { readOnly: true })
  db.exec('PRAGMA busy_timeout = 5000')
  return db
}

/** A pasta do episodio de um clipe da Biblioteca (<episodio>\shots\0008.mp4). */
export function pastaDoEpisodioDoClipe(clipe: string): string {
  return dirname(dirname(clipe))
}

interface Ids {
  episodioId: number
  cenaId: number
}

/** O episodio e a cena do banco de um clipe; null = o clipe nao e de um episodio do AnCut. */
function idsDoClipe(db: DatabaseSync, clipe: string): Ids | null {
  const raiz = pastaDoEpisodioDoClipe(clipe)
  const ep = episodioNoBanco(db, raiz)
  if (!ep) return null
  const rel = normal(relative(raiz, clipe))
  const linhas = db.prepare('SELECT id, file FROM shot WHERE episode_id = ?').all(ep.id) as { id: number; file: string }[]
  const cena = linhas.find((l) => normal(l.file) === rel)
  return cena ? { episodioId: ep.id, cenaId: cena.id } : null
}

/**
 * A cena de um clipe no AnCut: quem esta nela e os personagens do anime (os
 * deste episodio primeiro, pelas cenas). null = nao e do AnCut (manga, solto,
 * pasta de fora) ou nao tem AnCut aqui.
 */
export function cenaNoAncut(clipe: string): CenaNoAncut | null {
  const db = abrir()
  if (!db) return null
  try {
    const ids = idsDoClipe(db, clipe)
    if (!ids) return null
    const ep = db
      .prepare('SELECT e.anime_id AS animeId, a.title AS titulo FROM episode e JOIN anime a ON a.id = e.anime_id WHERE e.id = ?')
      .get(ids.episodioId) as { animeId: number; titulo: string } | undefined
    if (!ep) return null
    const naCena = db
      .prepare('SELECT c.id AS id, c.name AS nome FROM shot_character sc JOIN character c ON c.id = sc.character_id WHERE sc.shot_id = ? ORDER BY c.name')
      .all(ids.cenaId) as { id: number; nome: string }[]
    const doAnime = db
      .prepare(
        `SELECT c.id AS id, c.name AS nome,
           (SELECT COUNT(*) FROM shot_character sc JOIN shot s ON s.id = sc.shot_id WHERE sc.character_id = c.id AND s.episode_id = ?) AS cenas
         FROM character c WHERE c.anime_id = ? ORDER BY cenas DESC, c.name`,
      )
      .all(ids.episodioId, ep.animeId) as { id: number; nome: string; cenas: number }[]
    const contagem = new Map(doAnime.map((p) => [p.id, Number(p.cenas)]))
    const personagem = (p: { id: number; nome: string; cenas?: number }): PersonagemDoAncut => ({
      id: Number(p.id),
      nome: String(p.nome),
      cenas: Number(p.cenas ?? contagem.get(p.id) ?? 0),
    })
    return {
      episodioId: ids.episodioId,
      cenaId: ids.cenaId,
      anime: String(ep.titulo),
      personagens: naCena.map(personagem),
      doAnime: doAnime.map(personagem),
    }
  } finally {
    db.close()
  }
}

/**
 * MANDA PARA A LIXEIRA: as cenas saem do episodio e os arquivos vao para a
 * `_lixeira/<data-hora>` DENTRO da pasta dele (o motor nao destroi nada --
 * da para voltar copiando de la). Um pedido ao motor por episodio.
 */
export async function mandarParaALixeira(clipes: readonly string[]): Promise<{ apagadas: number; erro?: string }> {
  const db = abrir()
  if (!db) return { apagadas: 0, erro: 'Não achei o banco do AnCut neste computador.' }
  const porEpisodio = new Map<number, number[]>()
  try {
    for (const clipe of clipes) {
      const ids = idsDoClipe(db, clipe)
      if (!ids) continue
      porEpisodio.set(ids.episodioId, [...(porEpisodio.get(ids.episodioId) ?? []), ids.cenaId])
    }
  } finally {
    db.close()
  }
  if (porEpisodio.size === 0) return { apagadas: 0, erro: 'Essas cenas não são de um episódio do AnCut.' }
  let apagadas = 0
  for (const [ep, cenas] of porEpisodio) {
    const r = await perguntar<{ deletedCount?: number }>(['delete', String(ep), ...cenas.map(String)], 'deleted')
    if (!r) return { apagadas, erro: 'O motor do AnCut não respondeu. Feche o AnCut se ele estiver cortando e tente de novo.' }
    apagadas += Number(r.deletedCount) || 0
  }
  return { apagadas }
}

/** Marca (ou desmarca) um personagem na cena; volta a cena como ficou. */
export async function marcarPersonagem(clipe: string, personagemId: number, remover: boolean): Promise<CenaNoAncut | null> {
  const cena = cenaNoAncut(clipe)
  if (!cena) return null
  const r = await perguntar<{ error?: string }>(
    ['tag-shot', String(cena.cenaId), String(Math.trunc(personagemId)), ...(remover ? ['remove'] : [])],
    'tag-shot',
  )
  if (!r) throw new Error('O motor do AnCut não respondeu. Feche o AnCut se ele estiver cortando e tente de novo.')
  if (r.error) throw new Error(r.error)
  return cenaNoAncut(clipe)
}

/** Marca na cena um personagem que o anime ainda nao tem (pelo nome); volta a cena como ficou. */
export async function marcarNovoPersonagem(clipe: string, nome: string): Promise<CenaNoAncut | null> {
  const cena = cenaNoAncut(clipe)
  if (!cena) return null
  const limpo = nome.trim().slice(0, 80)
  if (!limpo) return cena
  const r = await perguntar<{ error?: string }>(['tag-shot-new', String(cena.cenaId), limpo], 'tag-shot')
  if (!r) throw new Error('O motor do AnCut não respondeu. Feche o AnCut se ele estiver cortando e tente de novo.')
  if (r.error) throw new Error(r.error)
  return cenaNoAncut(clipe)
}

/**
 * APAGAR O EPISODIO INTEIRO, em dois tempos (como no AnCut): sem `aplicar`, so
 * o que seria apagado; com, apaga a pasta e tira do historico. Sem lixeira --
 * por isso a tela mostra o plano e pede para confirmar. O motor so apaga pasta
 * DENTRO da saida configurada.
 */
export async function apagarEpisodio(clipe: string, aplicar: boolean): Promise<PlanoDeApagarEpisodio | null> {
  const db = abrir()
  if (!db) return null
  let ep: { id: number } | null
  try {
    ep = episodioNoBanco(db, pastaDoEpisodioDoClipe(clipe))
  } finally {
    db.close()
  }
  if (!ep) return null
  const r = await perguntar<{
    aplicado?: boolean
    episodeId?: number
    root?: string
    rootExists?: boolean
    insideOutput?: boolean
    shots?: number
    bytes?: number
    erro?: string
    sharedWith?: number
  }>(['delete-episode', String(ep.id), ...(aplicar ? ['apply'] : [])], 'delete-episode')
  if (!r) throw new Error('O motor do AnCut não respondeu. Feche o AnCut se ele estiver cortando e tente de novo.')
  const dentro = r.insideOutput === true
  const existe = r.rootExists !== false
  // A trava do motor e para a PASTA: sem ela no disco, so o registro sai (de onde quer que fosse).
  const pode = !r.erro && (dentro || !existe)
  return {
    episodioId: Number(r.episodeId ?? ep.id),
    pasta: String(r.root ?? ''),
    cenas: Number(r.shots) || 0,
    bytes: Number(r.bytes) || 0,
    pode,
    motivo: r.erro ? String(r.erro) : pode ? '' : 'Esse episódio fica fora da pasta de saída do AnCut: por segurança, o motor não apaga.',
    aplicado: r.aplicado === true,
    outrosNaPasta: Math.max(0, Number(r.sharedWith) || 0),
    pastaExiste: existe,
  }
}
