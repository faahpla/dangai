import { useEffect, useState } from 'react'
import type { ModuloDoRenderer } from '@/modulos/api'
import type { EstadoDoServidor, PonteDoClaude } from '../shared/canais'
import { executar } from './executar'

/**
 * [claude] O MODULO "CLAUDE (MCP)" no renderer: responde os pedidos do
 * servidor MCP (o projeto aberto, abrir, Biblioteca) e mostra nas
 * Configuracoes o comando que liga o Claude Code ao Dangai.
 */

const ponte = (): PonteDoClaude => window.dangai.modulos.claude

function SecaoDoClaude() {
  const [e, setE] = useState<EstadoDoServidor | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [mostrar, setMostrar] = useState(false)

  useEffect(() => {
    void ponte()
      .estado()
      .then((r) => r.ok && setE(r.value))
    return ponte().aoEstado(setE)
  }, [])

  const copiar = async (): Promise<void> => {
    if (!e?.comando) return
    await navigator.clipboard.writeText(e.comando)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1800)
  }
  const nova = async (): Promise<void> => {
    const r = await ponte().novaSenha()
    if (r.ok) setE(r.value)
  }

  const botao = 'lift flex h-7 shrink-0 items-center rounded-sm border border-line bg-elevated px-2.5 text-[11px] font-medium text-ink-2 hover:text-ink'
  if (!e) return null
  return (
    <div className="flex flex-col gap-2 text-[12px] text-ink-2">
      <p>
        Com isto ligado, o <b className="text-ink">Claude Code</b> edita o projeto aberto aqui: le as cenas, ve o recorte 9:16 e muda enquadramento,
        entrada, efeito, sons e setas. Cada edição reabre o projeto sozinha.
      </p>
      {e.erro && <p className="text-red-400">{e.erro}</p>}
      {e.rodando && e.comando ? (
        <>
          <p>
            Rodando em <span className="text-ink">{e.url}</span>. Cole este comando uma vez no terminal (com o Dangai aberto):
          </p>
          <code className="block break-all rounded-sm border border-line bg-elevated px-2 py-1.5 font-mono text-[11px] text-ink">
            {mostrar ? e.comando : e.comando.replace(e.senha, '•'.repeat(12))}
          </code>
          <div className="flex gap-2">
            <button type="button" className={botao} onClick={() => void copiar()}>
              {copiado ? 'Copiado!' : 'Copiar comando'}
            </button>
            <button type="button" className={botao} onClick={() => setMostrar((m) => !m)}>
              {mostrar ? 'Esconder senha' : 'Mostrar senha'}
            </button>
            <button type="button" className={botao} title="Quem tinha a senha antiga para de conseguir conectar" onClick={() => void nova()}>
              Nova senha
            </button>
          </div>
          <p className="text-[11px]">A senha é só deste PC: o servidor só aceita conexão do próprio computador.</p>
        </>
      ) : (
        !e.erro && <p>Ligando o servidor…</p>
      )}
    </div>
  )
}

export const claude: ModuloDoRenderer = {
  id: 'claude',

  iniciar(n) {
    const p = ponte()
    return p.aoPedido((pedido) => {
      executar(n, pedido).then(
        (resultado) => void p.responder({ id: pedido.id, ok: true, resultado }),
        (err: unknown) => void p.responder({ id: pedido.id, ok: false, erro: err instanceof Error ? err.message : String(err) }),
      )
    })
  },

  secoesDasConfiguracoes: [{ id: 'claude-mcp', titulo: 'Claude (MCP)', depoisDe: 'fim', Componente: SecaoDoClaude }],
}
