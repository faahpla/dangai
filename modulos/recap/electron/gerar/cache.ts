import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gravarJsonAtomico } from '../episodio/perfil'
import { pastaDosRascunhos } from './rascunho'

/**
 * Cache das respostas da IA, para reabrir e repetir sem gastar cota.
 *
 * - chave = sha256 de JSON.stringify({ etapa, provedor, modeloPedido, sistema,
 *   prompt, schema }) -- o prompt inteiro ja carrega as entradas. O
 *   `modeloPedido` e o de settings ('' = automatico): o modelo de fato so se
 *   sabe depois da chamada, e vai DENTRO do valor guardado;
 * - mora em <userData>/recaps/cache/<chave>.json (pastaDosRascunhos), escrita
 *   atomica; so guarda resposta ok (erro de cota nunca entra no cache);
 * - nunca guarda nem loga a chave da API: ela nao entra em nenhuma das partes.
 */

/** Sobe quando a forma do arquivo do cache muda: o arquivo velho vira "nao tem". */
const CACHE_VERSAO = 1

export interface PartesDaChave {
  etapa: string
  provedor: string
  /** O modelo de settings ('' = automatico). */
  modeloPedido: string
  sistema: string
  prompt: string
  /** O JSON Schema do pedido (z.toJSONSchema), para schema novo nao ler resposta velha. */
  schema: unknown
}

export interface RespostaGuardada<T> {
  valor: T
  /** O modelo que de fato respondeu. */
  modelo: string
  provedor: string
  /** ISO. */
  criadoEm: string
}

export function chaveDoCache(partes: PartesDaChave): string {
  const { etapa, provedor, modeloPedido, sistema, prompt, schema } = partes
  return createHash('sha256')
    .update(JSON.stringify({ v: CACHE_VERSAO, etapa, provedor, modeloPedido, sistema, prompt, schema }))
    .digest('hex')
}

export function pastaDoCache(): string {
  return join(pastaDosRascunhos(), 'cache')
}

function arquivoDaChave(chave: string): string {
  // A chave e sempre o hex do sha256; qualquer outra coisa nao vira caminho.
  if (!/^[0-9a-f]{64}$/.test(chave)) throw new Error('chave de cache invalida')
  return join(pastaDoCache(), `${chave}.json`)
}

/** null = nao tem (ou o arquivo nao abre). Quem le confere `valor` com o schema. */
export function lerDoCache<T>(chave: string): RespostaGuardada<T> | null {
  try {
    const cru = JSON.parse(readFileSync(arquivoDaChave(chave), 'utf8')) as Partial<RespostaGuardada<T>> & { v?: number }
    if (cru.v !== CACHE_VERSAO || cru.valor === undefined) return null
    if (typeof cru.modelo !== 'string' || typeof cru.provedor !== 'string' || typeof cru.criadoEm !== 'string') return null
    return { valor: cru.valor, modelo: cru.modelo, provedor: cru.provedor, criadoEm: cru.criadoEm }
  } catch {
    return null
  }
}

export function gravarNoCache<T>(chave: string, resposta: RespostaGuardada<T>): void {
  try {
    gravarJsonAtomico(arquivoDaChave(chave), { v: CACHE_VERSAO, ...resposta })
  } catch (err) {
    // Cache e atalho: sem ele a proxima chamada so gasta cota de novo.
    console.warn(`[gerar:cache] nao gravou: ${err instanceof Error ? err.message : String(err)}`)
  }
}
