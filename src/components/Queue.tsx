import { CheckCircle2, CircleDashed, Loader2, Play, Square, X, FolderOpen } from 'lucide-react'
import { useProject } from '@/store/project'

/**
 * A fila de render.
 *
 * Existe para o caso que muda o dia dele: soltar cinco projetos, ir dormir e
 * acordar com cinco MP4. Enquanto ela roda, o app abre e renderiza um projeto
 * de cada vez -- o proprio conteudo da tela vai trocando, e isso e proposital:
 * da para ver o que esta sendo feito em vez de olhar uma barra sem contexto.
 *
 * So aparece quando ha fila. Sem projetos enfileirados ela nao ocupa espaco
 * nenhum na interface.
 */
export function Queue() {
  const queue = useProject((s) => s.queue)
  const running = useProject((s) => s.queueRunning)
  const runQueue = useProject((s) => s.runQueue)
  const stopQueue = useProject((s) => s.stopQueue)
  const removeFromQueue = useProject((s) => s.removeFromQueue)
  const clearQueue = useProject((s) => s.clearQueue)

  if (queue.length === 0) return null

  const pendentes = queue.filter((item) => item.status === 'pendente').length
  const prontos = queue.filter((item) => item.status === 'pronto').length
  const falhas = queue.filter((item) => item.status === 'falhou').length

  return (
    <section className="enter flex shrink-0 flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <header className="flex items-center gap-3">
        <span className="text-[11px] text-ink-2">
          Fila
          <span className="tnum ml-2 text-ink-3">
            {prontos}/{queue.length}
            {falhas > 0 && ` · ${falhas} ${falhas === 1 ? 'falhou' : 'falharam'}`}
          </span>
        </span>

        <div className="flex-1" />

        {running ? (
          <button
            type="button"
            onClick={stopQueue}
            title="Para depois que o video atual terminar"
            className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1 text-[11px] text-ink-2 hover:text-ink"
          >
            <Square size={11} strokeWidth={1.5} />
            Parar depois deste
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void runQueue()}
            disabled={pendentes === 0}
            className="lift flex items-center gap-1.5 rounded-sm border border-accent bg-accent-dim px-2.5 py-1 text-[11px] text-ink disabled:opacity-40"
          >
            <Play size={11} strokeWidth={1.5} className="text-accent" />
            Renderizar {pendentes}
          </button>
        )}

        <button
          type="button"
          onClick={clearQueue}
          disabled={running}
          className="text-[11px] text-ink-3 hover:text-ink disabled:opacity-40"
        >
          Limpar
        </button>
      </header>

      <ul className="flex max-h-[132px] flex-col gap-0.5 overflow-y-auto">
        {queue.map((item) => (
          <li
            key={item.path}
            className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-[11px]"
            title={item.error ?? item.path}
          >
            <Icone status={item.status} />

            <span
              className={[
                'min-w-0 flex-1 truncate',
                item.status === 'falhou' ? 'text-danger' : 'text-ink-2',
              ].join(' ')}
            >
              {item.fileName}
              {item.error && <span className="ml-2 text-ink-3">{item.error}</span>}
            </span>

            {item.output && (
              <button
                type="button"
                onClick={() => void window.dangai.revealFile(item.output!)}
                aria-label="Abrir a pasta do video"
                className="shrink-0 text-ink-3 hover:text-ink"
              >
                <FolderOpen size={12} strokeWidth={1.5} />
              </button>
            )}

            <button
              type="button"
              onClick={() => removeFromQueue(item.path)}
              disabled={item.status === 'renderizando'}
              aria-label="Tirar da fila"
              className="shrink-0 text-ink-3 hover:text-ink disabled:opacity-30"
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Icone({ status }: { status: 'pendente' | 'renderizando' | 'pronto' | 'falhou' }) {
  if (status === 'renderizando') {
    return <Loader2 size={12} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
  }
  if (status === 'pronto') {
    return <CheckCircle2 size={12} strokeWidth={1.5} className="shrink-0 text-accent" />
  }
  if (status === 'falhou') {
    return <X size={12} strokeWidth={1.5} className="shrink-0 text-danger" />
  }
  return <CircleDashed size={12} strokeWidth={1.5} className="shrink-0 text-ink-3" />
}
