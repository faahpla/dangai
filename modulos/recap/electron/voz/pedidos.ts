import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { VozInterrompida } from '../../shared/voz'
import { pastaDaVoz } from './pastas'

/**
 * Os pedidos de voz em andamento (gerar, regravar, ajustar, importar), para o
 * Cancelar e para nao rodar dois no mesmo rascunho.
 *
 * Um por rascunho: dois takes sendo montados ao mesmo tempo disputariam o
 * `atual` e, pior, poderiam pagar duas vezes pelo mesmo texto antes de o
 * primeiro cair no cache.
 *
 * Cancelar NAO desfaz o que ja foi pago: o motor aborta o fetch se ainda da
 * (AbortSignal) e, se a resposta ja voltou, guarda no cache e poe o take so
 * no historico (VozGerada.soNoHistorico).
 */

interface Pedido {
  pedidoId: string
  controle: AbortController
}

const emAndamento = new Map<string, Pedido>()

/**
 * Registra o pedido e devolve o sinal de cancelamento. Lanca (com a frase
 * para a tela) se o rascunho ja tem outro pedido rodando.
 */
export function comecarPedido(rascunhoId: string, pedidoId: string): AbortSignal {
  if (emAndamento.has(rascunhoId)) throw new Error('Ja tem uma voz sendo feita neste recap. Espere ou cancele.')
  const controle = new AbortController()
  emAndamento.set(rascunhoId, { pedidoId, controle })
  return controle.signal
}

/** Tira o pedido da lista (sempre, no finally de quem comecou). */
export function terminarPedido(rascunhoId: string, pedidoId: string): void {
  if (emAndamento.get(rascunhoId)?.pedidoId === pedidoId) emAndamento.delete(rascunhoId)
}

/** O Cancelar. false = esse pedido ja tinha terminado (ou nunca existiu). */
export function cancelarPedido(rascunhoId: string, pedidoId: string): boolean {
  const p = emAndamento.get(rascunhoId)
  if (!p || p.pedidoId !== pedidoId) return false
  p.controle.abort()
  return true
}

// ------------------------------------------------- O2: a marca no disco

function arquivoNoAr(rascunhoId: string): string {
  return join(pastaDaVoz(rascunhoId), 'no-ar.json')
}

/**
 * O2: o pedido comecou -- a marca vai ao disco. Com o app fechado (ou morto)
 * no meio, ela fica, e o passo 3 avisa ao reabrir (pedidoInterrompido).
 */
export function marcarNoAr(rascunhoId: string, pedidoId: string, tipo: VozInterrompida['tipo']): void {
  try {
    const arquivo = arquivoNoAr(rascunhoId)
    mkdirSync(dirname(arquivo), { recursive: true })
    writeFileSync(arquivo, JSON.stringify({ pedidoId, tipo, inicio: new Date().toISOString() }), 'utf8')
  } catch {
    /* sem a marca, so falta o aviso ao reabrir */
  }
}

/** O pedido terminou (bem, mal ou cancelado): a marca DELE sai. */
export function desmarcarNoAr(rascunhoId: string, pedidoId: string): void {
  try {
    const arquivo = arquivoNoAr(rascunhoId)
    const d = JSON.parse(readFileSync(arquivo, 'utf8')) as { pedidoId?: unknown }
    if (d.pedidoId === pedidoId) rmSync(arquivo, { force: true })
  } catch {
    /* ja saiu */
  }
}

const TIPOS: readonly VozInterrompida['tipo'][] = ['gerar', 'regravar', 'ajustar', 'importar']

/**
 * O2: o pedido que o app largou no meio: a marca ficou e nada roda neste
 * rascunho agora. Le e APAGA (o aviso aparece uma vez). null = nenhum.
 */
export function pedidoInterrompido(rascunhoId: string): VozInterrompida | null {
  if (emAndamento.has(rascunhoId)) return null
  const arquivo = arquivoNoAr(rascunhoId)
  let d: { tipo?: unknown; inicio?: unknown }
  try {
    d = JSON.parse(readFileSync(arquivo, 'utf8')) as { tipo?: unknown; inicio?: unknown }
  } catch {
    return null
  }
  try {
    rmSync(arquivo, { force: true })
  } catch {
    /* presa: aparece de novo na proxima */
  }
  const tipo = TIPOS.find((t) => t === d.tipo)
  return tipo && typeof d.inicio === 'string' ? { tipo, inicio: d.inicio } : null
}

/** Ha pedido rodando neste rascunho? */
export function pedidoEmAndamento(rascunhoId: string): string | null {
  return emAndamento.get(rascunhoId)?.pedidoId ?? null
}
