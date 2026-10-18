import {
  candidatoDeAnimeSchema,
  type BuscaDeAnime,
  type CandidatoDeAnime,
  type ElencoDaDescoberta,
  type ElencoEscolhido,
  type PedidoDeElenco,
} from '../../shared/descoberta'
import { temPlanos } from '../../shared/episodio'
import { abrirIndicePorId } from '../episodio/abrir-indice'
import { ascii } from '../frase-do-motor'
import { publish, startMediaServer } from '../media-server'
import { rodarNoMotor } from '../motor'
import { aplicarElencoNaSessao, pastaDaSessao } from './index'

/**
 * A1: o "BUSCAR ELENCO" no main (pedido do Levi, 18/10). O motor faz o
 * trabalho (motor/app/elenco_escolhido.py): a busca nas tres fontes e, na
 * escolha, o elenco com as fotos e as sugestoes de nome dos grupos. Aqui so a
 * ponte: as capas e fotos viram URLs do servidor de midia, e a descoberta
 * aberta do episodio ganha o elenco novo (index.ts, aplicarElencoNaSessao).
 */

/** A busca leva segundos (rede); a escolha baixa fotos e carrega o CLIP. */
const PRAZO_DA_BUSCA_MS = 90_000
const PRAZO_DA_ESCOLHA_MS = 6 * 60_000

const FONTE: Record<string, string> = { anilist: 'AniList', mal: 'MyAnimeList', kitsu: 'Kitsu' }

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function inteiro(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

/** Um candidato do motor (snake_case) no formato da tela. null = torto. */
function candidatoDoMotor(cru: unknown): CandidatoDeAnime | null {
  if (!cru || typeof cru !== 'object') return null
  const c = cru as Record<string, unknown>
  const capaLocal = texto(c['capaLocal'])
  const lido = candidatoDeAnimeSchema.safeParse({
    fonte: texto(c['fonte']) ?? 'anilist',
    titulo: texto(c['titulo']) ?? '',
    tituloIngles: texto(c['titulo_ingles']),
    anilistId: inteiro(c['anilist_id']),
    malId: inteiro(c['mal_id']),
    kitsuId: inteiro(c['kitsu_id']),
    ano: typeof c['ano'] === 'number' && Number.isInteger(c['ano']) ? c['ano'] : null,
    formato: texto(c['formato']),
    capa: capaLocal ? publish(capaLocal) : null,
    nota: typeof c['nota'] === 'number' && Number.isFinite(c['nota']) ? c['nota'] : 0,
  })
  return lido.success ? lido.data : null
}

/** Os animes que batem com o termo. Lanca com a frase (motor fora, busca que falhou). */
export async function buscarAnime(termo: string): Promise<BuscaDeAnime> {
  const t = String(termo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (t.length < 2) return { termo: t, candidatos: [], avisos: [] }
  const eventos = await rodarNoMotor(['buscar-anime', t], PRAZO_DA_BUSCA_MS, 'A busca do anime falhou')
  const ev = eventos.find((e) => e.type === 'anime-busca')
  if (!ev) throw new Error('O motor nao devolveu a busca do anime.')
  await startMediaServer()
  const candidatos = (Array.isArray(ev['candidatos']) ? ev['candidatos'] : [])
    .map(candidatoDoMotor)
    .filter((c): c is CandidatoDeAnime => c !== null)
  const erros = ev['erros'] && typeof ev['erros'] === 'object' ? Object.keys(ev['erros'] as object) : []
  const avisos = erros.map((f) => `${FONTE[f] ?? ascii(f)} nao respondeu`)
  return { termo: t, candidatos, avisos }
}

/**
 * O anime escolhido vira o elenco do episodio: o motor guarda a escolha para
 * este nome (as proximas analises usam), monta o elenco com as fotos, junta
 * os nomes batizados antes e, com a descoberta deste episodio aberta (ou com
 * os grupos dela no disco), calcula as sugestoes de nome. A descoberta aberta
 * recebe tudo pelo evento de sempre, com o que ele ja decidiu intacto.
 */
export async function escolherAnime(pedido: PedidoDeElenco): Promise<ElencoEscolhido> {
  const { indice } = abrirIndicePorId(pedido.episodioId)
  const pasta = pastaDaSessao(pedido.episodioId) ?? (temPlanos(indice) ? indice.biblioteca.pasta : null)
  const e = pedido.escolha
  const req = {
    anime: pedido.anime,
    season: indice.temporada,
    episodeRoot: pasta,
    escolha: {
      fonte: e.fonte,
      titulo: e.titulo,
      titulo_ingles: e.tituloIngles,
      anilist_id: e.anilistId,
      mal_id: e.malId,
      kitsu_id: e.kitsuId,
    },
  }
  const eventos = await rodarNoMotor(['escolher-anime', JSON.stringify(req)], PRAZO_DA_ESCOLHA_MS, 'Nao deu para montar o elenco')
  const ev = eventos.find((x) => x.type === 'anime-escolhido')
  if (!ev) throw new Error('O motor nao devolveu o elenco.')
  await startMediaServer()
  const vistos = new Set<string>()
  const elenco: ElencoDaDescoberta[] = []
  for (const cru of Array.isArray(ev['elenco']) ? ev['elenco'] : []) {
    const item = cru as Record<string, unknown>
    const nome = texto(item['nome'])
    if (!nome || vistos.has(nome)) continue
    vistos.add(nome)
    const foto = texto(item['foto'])
    elenco.push({ nome, foto: foto ? publish(foto) : null })
  }
  const sugestoes: Record<string, { nome: string; sim: number }[]> = {}
  const cruas = ev['sugestoes'] && typeof ev['sugestoes'] === 'object' ? (ev['sugestoes'] as Record<string, unknown>) : {}
  for (const [k, lista] of Object.entries(cruas)) {
    if (!/^\d{1,5}$/.test(k) || !Array.isArray(lista)) continue
    sugestoes[k] = lista
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x['nome'] === 'string' && typeof x['sim'] === 'number')
      .map((x) => ({ nome: String(x['nome']), sim: Number(x['sim']) }))
  }
  const titulo = texto(ev['titulo']) ?? e.titulo
  const juntados = ev['juntados'] && typeof ev['juntados'] === 'object' ? Object.keys(ev['juntados'] as object) : []
  const comSugestoes = aplicarElencoNaSessao(pedido.episodioId, { titulo, elenco, sugestoes })
  return { titulo, personagens: elenco.length, juntados, comSugestoes }
}
