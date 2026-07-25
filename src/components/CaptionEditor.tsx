import { useCallback, useEffect, useRef, useState } from 'react'
import { Merge, RotateCcw, Split } from 'lucide-react'
import { VIDEO_FPS } from '@shared/contract'
import { useProject, formatTimecode } from '@/store/project'

/**
 * Mesclar e dividir legendas, no estilo do merge captions do Premiere.
 *
 * O que o Whisper entrega e uma sugestao de agrupamento, nao uma decisao. Duas
 * frases que deveriam aparecer juntas chegam separadas, e um bloco de quatro
 * palavras as vezes precisa virar dois. Aqui isso se resolve sem sair do app e
 * sem exportar SRT no meio do caminho.
 *
 * Os tempos nunca sao inventados: mesclar usa o inicio do primeiro e o fim do
 * ultimo, dividir usa o instante real da palavra que abre o bloco novo. Uma
 * legenda editada continua caindo exatamente quando a palavra e dita.
 */
export function CaptionEditor() {
  const captions = useProject((s) => s.captions)
  const captionsEdited = useProject((s) => s.captionsEdited)
  const playhead = useProject((s) => s.playhead)
  const mergeCaptions = useProject((s) => s.mergeCaptions)
  const splitCaption = useProject((s) => s.splitCaption)
  const editCaptionWord = useProject((s) => s.editCaptionWord)
  const resetCaptions = useProject((s) => s.resetCaptions)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const setPlaying = useProject((s) => s.setPlaying)

  const [selected, setSelected] = useState<readonly number[]>([])
  const [editing, setEditing] = useState<{ block: number; word: number } | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const ordered = [...selected].sort((a, b) => a - b)
  const contiguous =
    ordered.length >= 2 && ordered.at(-1)! - ordered[0]! + 1 === ordered.length

  // Bloco que esta no ar agora, para acompanhar a reproducao.
  const currentFrame = Math.round(playhead * VIDEO_FPS)
  const activeIndex = captions.findIndex(
    (block) => currentFrame >= block.from && currentFrame < block.from + block.durationInFrames,
  )

  const toggle = useCallback((index: number, additive: boolean) => {
    setSelected((previous) => {
      if (!additive) return previous.length === 1 && previous[0] === index ? [] : [index]
      return previous.includes(index)
        ? previous.filter((item) => item !== index)
        : [...previous, index]
    })
  }, [])

  // Mesclar e dividir mudam os indices; manter a selecao antiga apontaria para
  // blocos que nao existem mais.
  const merge = useCallback(() => {
    if (!contiguous) return
    mergeCaptions(ordered)
    setSelected([ordered[0]!])
  }, [contiguous, ordered, mergeCaptions])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing) return
      if ((event.key === 'm' || event.key === 'M') && contiguous) {
        event.preventDefault()
        merge()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [contiguous, merge, editing])

  if (captions.length === 0) {
    return (
      <div className="grid flex-1 place-items-center rounded-md border border-line bg-surface px-6 text-center text-[11px] leading-relaxed text-ink-3">
        Sem legendas ainda. Elas aparecem depois que a narracao e transcrita —
        cole o roteiro para o texto sair exato.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={merge}
          disabled={!contiguous}
          title="Mesclar os blocos selecionados (M)"
          className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40"
        >
          <Merge size={12} strokeWidth={1.5} />
          Mesclar{ordered.length >= 2 ? ` (${ordered.length})` : ''}
        </button>

        <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <Split size={12} strokeWidth={1.5} />
          Clique no traco entre duas palavras para dividir
        </span>

        <div className="flex-1" />

        {captionsEdited && (
          <button
            type="button"
            onClick={() => {
              resetCaptions()
              setSelected([])
            }}
            title="Voltar as legendas automaticas"
            className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[11px] text-ink-3 hover:text-ink-2"
          >
            <RotateCcw size={12} strokeWidth={1.5} />
            Refazer
          </button>
        )}

        <span className="tnum text-[11px] text-ink-3">{captions.length} blocos</span>
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-md border border-line bg-surface"
      >
        {captions.map((block, index) => {
          const isSelected = selected.includes(index)
          const isActive = index === activeIndex

          return (
            <div
              key={`${block.from}-${index}`}
              onPointerDown={(event) => toggle(index, event.ctrlKey || event.metaKey || event.shiftKey)}
              className={[
                'flex cursor-pointer items-baseline gap-3 border-b border-line px-3 py-2 last:border-b-0',
                isSelected ? 'bg-accent-dim' : isActive ? 'bg-elevated' : '',
              ].join(' ')}
            >
              <button
                type="button"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  setPlaying(false)
                  setPlayhead(block.from / VIDEO_FPS)
                }}
                title="Ir para este ponto"
                className={[
                  'tnum shrink-0 text-[11px]',
                  isActive ? 'text-accent' : 'text-ink-3 hover:text-ink-2',
                ].join(' ')}
              >
                {formatTimecode(block.from / VIDEO_FPS)}
              </button>

              <div className="flex min-w-0 flex-1 flex-wrap items-baseline">
                {block.words.map((word, wordIndex) => (
                  <span key={`${word.from}-${wordIndex}`} className="flex items-baseline">
                    {wordIndex > 0 && (
                      <button
                        type="button"
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          splitCaption(index, wordIndex)
                          setSelected([])
                        }}
                        aria-label={`Dividir antes de ${word.text}`}
                        title="Dividir aqui"
                        // Visivel de proposito: um alvo invisivel so seria
                        // achado por quem ja sabe que ele existe.
                        className="mx-0.5 px-1 text-[13px] leading-none text-ink-3 hover:text-accent"
                      >
                        |
                      </button>
                    )}

                    {editing?.block === index && editing.word === wordIndex ? (
                      <input
                        autoFocus
                        defaultValue={word.text}
                        onPointerDown={(event) => event.stopPropagation()}
                        onBlur={(event) => {
                          const value = event.target.value.trim()
                          if (value.length > 0 && value !== word.text) {
                            editCaptionWord(index, wordIndex, value)
                          }
                          setEditing(null)
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.key === 'Enter' || event.key === 'Escape') {
                            event.currentTarget.blur()
                          }
                        }}
                        size={Math.max(word.text.length, 3)}
                        className="select-text rounded-[3px] border border-accent bg-elevated px-1 text-[13px] text-ink focus:outline-none"
                      />
                    ) : (
                      <span
                        onDoubleClick={(event) => {
                          event.stopPropagation()
                          setEditing({ block: index, word: wordIndex })
                        }}
                        title="Clique duas vezes para corrigir"
                        className={[
                          'rounded-[3px] px-0.5 text-[13px]',
                          isActive && currentFrame >= word.from &&
                          currentFrame < word.from + word.durationInFrames
                            ? 'text-accent'
                            : 'text-ink-2',
                        ].join(' ')}
                      >
                        {word.text}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
