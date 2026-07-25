import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useProject } from '@/store/project'

/**
 * O roteiro escrito. Cola aqui, ou solta o .txt na janela -- da no mesmo.
 *
 * A ideia: o Whisper acerta quando cada palavra e dita e erra o que foi dito.
 * Com o roteiro, o texto para de ser um palpite e vira transcricao dos tempos
 * sobre o texto certo.
 */
export function Script() {
  const open = useProject((s) => s.scriptOpen)
  const openScript = useProject((s) => s.openScript)
  const script = useProject((s) => s.script)
  const scriptNote = useProject((s) => s.scriptNote)
  const setScript = useProject((s) => s.setScript)

  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (open) setDraft(script ?? '')
  }, [open, script])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        openScript(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openScript])

  if (!open) return null

  const palavras = draft.trim().split(/\s+/).filter(Boolean).length
  const mudou = draft.trim() !== (script ?? '').trim()

  const aplicar = (): void => {
    openScript(false)
    void setScript(draft.trim().length > 0 ? draft : null)
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6"
      onPointerDown={() => openScript(false)}
    >
      <div
        onPointerDown={(event) => event.stopPropagation()}
        className="glass enter flex h-full max-h-[620px] w-full max-w-[640px] flex-col rounded-lg p-5"
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Roteiro</h2>
          <button
            type="button"
            onClick={() => openScript(false)}
            aria-label="Fechar"
            className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </header>

        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Sem stopPropagation o Espaco daqui chega no atalho global e
            // comeca a tocar o video no meio da digitacao.
            event.stopPropagation()
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) aplicar()
          }}
          spellCheck={false}
          placeholder={'Cole aqui o texto exato que voce narrou.\n\nMarcacoes entre [colchetes] ou (parenteses) sao ignoradas.'}
          className="min-h-0 flex-1 select-text resize-none rounded-sm border border-line bg-elevated px-3 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
        />

        <footer className="mt-3 flex items-center gap-3">
          <span className="tnum text-[11px] text-ink-3">
            {palavras > 0 ? `${palavras} palavras` : 'vazio'}
          </span>
          {scriptNote && !mudou && (
            <span className="min-w-0 truncate text-[11px] text-ink-3">{scriptNote}</span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={aplicar}
            disabled={!mudou}
            className="lift rounded-sm border border-line bg-elevated px-3.5 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40"
          >
            Aplicar
          </button>
        </footer>
      </div>
    </div>
  )
}
