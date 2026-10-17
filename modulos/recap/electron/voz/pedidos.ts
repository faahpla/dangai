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

/** Ha pedido rodando neste rascunho? */
export function pedidoEmAndamento(rascunhoId: string): string | null {
  return emAndamento.get(rascunhoId)?.pedidoId ?? null
}
