import { Loader2 } from 'lucide-react'
import { useProject } from '@/store/project'

interface StatusBarProps {
  isDragging: boolean
}

/**
 * Barra inferior discreta. Carrega o feedback de progresso e o erro -- nenhum
 * estado de carregamento fica sem sinal visivel. Erro e texto vermelho
 * discreto, e nada mais.
 *
 * Sem animacao de opacidade aqui: a barra e o unico canal de feedback do app, e
 * ela nao pode ficar invisivel se um frame engasgar.
 */
export function StatusBar({ isDragging }: StatusBarProps) {
  const busy = useProject((s) => s.busy)
  const error = useProject((s) => s.error)
  const audio = useProject((s) => s.audio)
  const lastOutput = useProject((s) => s.lastOutput)
  const dismissError = useProject((s) => s.dismissError)

  // So o nome do arquivo: o caminho inteiro e ruido, e o botao "Abrir pasta"
  // esta a um clique de distancia.
  const idleMessage = isDragging
    ? 'Solte para importar'
    : lastOutput
      ? `Renderizado · ${lastOutput.split(/[\\/]/).pop()}`
      : (audio?.fileName ?? 'Solte a narracao e as prints')

  return (
    <footer className="flex h-[38px] shrink-0 items-center justify-between border-t border-line px-6">
      {busy ? (
        <span className="flex items-center gap-2 text-[11px] text-ink-2">
          <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
          {busy}
        </span>
      ) : error ? (
        <button
          type="button"
          onClick={dismissError}
          className="truncate text-left text-[11px] text-danger"
          title={error}
        >
          {error}
        </button>
      ) : (
        <span className="truncate text-[11px] text-ink-3">{idleMessage}</span>
      )}

      <span className="text-[11px] text-ink-3">v0.1</span>
    </footer>
  )
}
