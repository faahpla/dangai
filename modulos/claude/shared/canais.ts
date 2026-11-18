/**
 * [claude] Os canais entre o main (o servidor MCP) e a janela (o projeto aberto).
 *
 * O servidor MCP mora no main; o projeto aberto, na janela. Cada ferramenta que
 * precisa do projeto vira um PEDIDO para a janela, que responde pelo canal de
 * resposta (com o id do pedido).
 */
import type { IpcResult } from '@shared/channels'

export const CANAIS_DO_CLAUDE = {
  pedido: 'claude:pedido',
  resposta: 'claude:resposta',
  estado: 'claude:estado',
  novaSenha: 'claude:nova-senha',
} as const

/** O que a janela sabe fazer (ver src/executar.ts). */
export type AcaoDaJanela = 'estado' | 'projeto' | 'abrir' | 'biblioteca' | 'legenda'

export interface PedidoDoClaude {
  id: string
  acao: AcaoDaJanela
  args: Record<string, unknown>
}

export interface RespostaDoClaude {
  id: string
  ok: boolean
  resultado?: unknown
  erro?: string
}

export interface EstadoDoServidor {
  ligado: boolean
  rodando: boolean
  url: string | null
  senha: string
  /** O comando para colar no terminal: `claude mcp add ...`. */
  comando: string | null
  erro: string | null
}

export interface PonteDoClaude {
  responder(r: RespostaDoClaude): Promise<IpcResult<null>>
  estado(): Promise<IpcResult<EstadoDoServidor>>
  novaSenha(): Promise<IpcResult<EstadoDoServidor>>
  aoPedido(ouvinte: (p: PedidoDoClaude) => void): () => void
  aoEstado(ouvinte: (e: EstadoDoServidor) => void): () => void
}
