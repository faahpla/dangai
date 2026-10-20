import { useEffect } from 'react'
import { responderPergunta, usePergunta } from '@/store/pergunta'

/**
 * A janelinha de SIM OU NAO (ver store/pergunta). Esc ou clicar fora = nao.
 */
export function Pergunta() {
  const p = usePergunta((s) => s.aberta)

  useEffect(() => {
    if (!p) return
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        responderPergunta(false)
      }
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [p])

  if (!p) return null
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-6" onPointerDown={() => responderPergunta(false)}>
      <div
        role="alertdialog"
        aria-label={p.titulo}
        onPointerDown={(e) => e.stopPropagation()}
        className="glass enter flex w-full max-w-[440px] flex-col gap-3 rounded-lg p-5"
      >
        <h2 className="text-[15px] font-semibold text-ink">{p.titulo}</h2>
        <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{p.texto}</p>
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => responderPergunta(false)}
            className="lift rounded-sm border border-line bg-elevated px-3 py-1.5 text-[13px] text-ink-2 hover:text-ink"
          >
            {p.nao}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => responderPergunta(true)}
            className="lift rounded-sm border border-accent bg-accent-dim px-3 py-1.5 text-[13px] font-medium text-ink"
          >
            {p.sim}
          </button>
        </div>
      </div>
    </div>
  )
}
