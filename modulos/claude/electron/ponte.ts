import type { CriarPonte } from '../../../shared/modulos'
import { CANAIS_DO_CLAUDE as C, type EstadoDoServidor, type PedidoDoClaude, type PonteDoClaude } from '../shared/canais'

/**
 * [claude] A PONTE do modulo Claude (MCP): `window.dangai.modulos.claude`. Roda
 * no preload (sandbox): so tipos e as constantes dos canais.
 */
export const criarPonteDoClaude = (({ invocar, assinar }) => {
  const ponte: PonteDoClaude = {
    responder: (r) => invocar(C.resposta, r),
    estado: () => invocar(C.estado),
    novaSenha: () => invocar(C.novaSenha),
    aoPedido: (ouvinte) => assinar<PedidoDoClaude>(C.pedido, ouvinte),
    aoEstado: (ouvinte) => assinar<EstadoDoServidor>(C.estado, ouvinte),
  }
  return ponte
}) satisfies CriarPonte
