import { useEffect, useMemo, useState } from 'react'
import { responderPergunta, usePergunta, type Pergunta as PerguntaAberta } from '@/store/pergunta'

/**
 * A janelinha de pergunta (ver store/pergunta). Esc ou clicar fora = nao.
 * Com campo (o nome do projeto), Enter confirma.
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

  // Uma janela nova por pergunta: o campo ja nasce com o texto dela.
  const chave = useMemo(() => (perguntas += 1), [p])
  return p ? <Janela key={chave} p={p} /> : null
}

let perguntas = 0

function Janela({ p }: { p: PerguntaAberta }) {
  const [texto, setTexto] = useState(p.campo ?? '')
  const comCampo = p.campo !== undefined
  const pode = !comCampo || texto.trim().length > 0
  const sim = (): void => {
    if (pode) responderPergunta(true, texto.trim())
  }
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-6" onPointerDown={() => responderPergunta(false)}>
      <div
        role="alertdialog"
        aria-label={p.titulo}
        onPointerDown={(e) => e.stopPropagation()}
        className="glass enter flex w-full max-w-[440px] flex-col gap-3 rounded-lg p-5"
      >
        <h2 className="text-[15px] font-semibold text-ink">{p.titulo}</h2>
        {comCampo && (
          <input
            autoFocus
            // O nome que ja vem escrito fica selecionado: digitar troca, Enter aceita.
            onFocus={(e) => e.currentTarget.select()}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                sim()
              }
            }}
            spellCheck={false}
            className="rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[14px] text-ink outline-none focus:border-accent"
          />
        )}
        <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{p.texto}</p>
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
            autoFocus={!comCampo}
            disabled={!pode}
            onClick={sim}
            className="lift rounded-sm border border-accent bg-accent-dim px-3 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40"
          >
            {p.sim}
          </button>
        </div>
      </div>
    </div>
  )
}
