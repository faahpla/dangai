import { readdirSync, readFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * O ELENCO DEGRADADO no cache do motor do Studio (<dados>/cache/anime_db).
 *
 * O motor (providers/anime_provider.py, igual ao ancut-hub-engine) guarda o
 * banco de personagens mesmo quando o Jikan falhou, marcado `partial`, e a
 * cada analise tenta de novo SO as galerias de `missing_gallery`, depois de
 * uma tregua de 6 h. So que quando o Jikan cai ja na LISTA de personagens, o
 * banco sai com `partial: true`, `missing_gallery: []` e os personagens sem
 * mal_id (so a foto do AniList). Com a lista de faltas vazia o
 * `_completar_galerias` volta na hora, e o atalho busca_resolvida.json
 * reaproveita esse banco para sempre: o reconhecimento daquele anime fica em
 * "sem-referencias" mesmo com o Jikan de volta, ate alguem apagar o cache.
 *
 * A correcao e do ancut-hub-engine (motor/STUDIO.md: o motor daqui nao e
 * "melhorado"). Ate ela voltar por copia, o Studio -- dono desta pasta de
 * dados -- poe de lado o metadata.json desse banco quando a tregua de 6 h ja
 * passou. Sem ele, o motor monta o elenco de novo do zero na proxima analise,
 * que e o que a tregua faria se a lista de faltas nao estivesse vazia. Nada e
 * apagado: o arquivo vira metadata.degradado-<carimbo>.json na mesma pasta, e
 * as fotos ja baixadas continuam la.
 *
 * Roda DEPOIS da reserva do elenco (elenco-reserva.ts, no prepararEIniciar do
 * motor.ts): se o banco degradado nao reconhecia ninguem e o Corte Cenas tem o
 * mesmo anime, a reserva ja trocou o banco (o do Corte Cenas nunca e
 * `partial`) e aqui nao ha mais nada a fazer. Refazer o banco do zero ficou
 * barato: com o Jikan fora, o motor desiste dele no 1o pedido (motor/STUDIO.md).
 */

const TREGUA_MS = 6 * 3600 * 1000

function carimbo(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

function degradado(cru: unknown, agora: number): boolean {
  if (!cru || typeof cru !== 'object') return false
  const dados = cru as { partial?: unknown; missing_gallery?: unknown; fetched_at?: unknown }
  if (dados.partial !== true) return false
  // Com faltas na lista, o proprio motor cobra o troco depois da tregua.
  if (Array.isArray(dados.missing_gallery) && dados.missing_gallery.length > 0) return false
  const quando = typeof dados.fetched_at === 'string' ? Date.parse(dados.fetched_at) : Number.NaN
  // Sem carimbo, o motor tambem trata como velho (_mais_velho_que).
  return !Number.isFinite(quando) || agora - quando > TREGUA_MS
}

/** Devolve as pastas de anime cujo banco foi posto de lado (para o log). Nunca lanca. */
export function porDeLadoElencoDegradado(dadosDoMotor: string): string[] {
  const raiz = join(dadosDoMotor, 'cache', 'anime_db')
  const postas: string[] = []
  let pastas: string[]
  try {
    pastas = readdirSync(raiz, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(raiz, e.name))
  } catch {
    return postas
  }
  const agora = Date.now()
  for (const pasta of pastas) {
    const meta = join(pasta, 'metadata.json')
    try {
      if (!existsSync(meta) || !degradado(JSON.parse(readFileSync(meta, 'utf8')), agora)) continue
      renameSync(meta, join(pasta, `metadata.degradado-${carimbo()}.json`))
      postas.push(pasta)
    } catch (e) {
      console.error('[motor] nao deu para por de lado o elenco degradado em', pasta, e)
    }
  }
  return postas
}
