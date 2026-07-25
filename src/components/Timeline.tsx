import { useCallback, useRef, useState } from 'react'
import { useProject, formatTimecode } from '@/store/project'
import { Waveform } from './Waveform'

/**
 * O elemento assinatura. Uma faixa horizontal unica: waveform em cinza ao
 * fundo, tiras de cena com miniatura por cima, playhead rosa de 1px com um
 * ponto no topo.
 *
 * Durante o render a propria timeline se preenche de rosa da esquerda para a
 * direita. Sem barra de progresso separada, sem modal -- o progresso acontece
 * no lugar onde o trabalho esta.
 */
export function Timeline() {
  const audio = useProject((s) => s.audio)
  const images = useProject((s) => s.images)
  const playhead = useProject((s) => s.playhead)
  const selectedScene = useProject((s) => s.selectedScene)
  const render = useProject((s) => s.render)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const selectScene = useProject((s) => s.selectScene)
  const splitScene = useProject((s) => s.splitScene)
  const moveBoundary = useProject((s) => s.moveBoundary)
  const scenes = useProject((s) => s.plan)?.scenes ?? []

  const trackRef = useRef<HTMLDivElement | null>(null)
  /** Indice da fronteira sendo arrastada, ou null. */
  const [dragging, setDragging] = useState<number | null>(null)

  const duration = audio?.durationSec ?? 0
  const progress = duration > 0 ? playhead / duration : 0
  const isRendering = render !== null

  const timeAt = useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track || duration === 0) return 0
      const rect = track.getBoundingClientRect()
      return ((clientX - rect.left) / rect.width) * duration
    },
    [duration],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isRendering) return
      event.currentTarget.setPointerCapture(event.pointerId)
      setPlayhead(timeAt(event.clientX))
    },
    [isRendering, setPlayhead, timeAt],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isRendering || event.buttons !== 1) return
      if (dragging !== null) {
        moveBoundary(dragging, timeAt(event.clientX))
        return
      }
      setPlayhead(timeAt(event.clientX))
    },
    [isRendering, dragging, moveBoundary, setPlayhead, timeAt],
  )

  const stopDragging = useCallback(() => setDragging(null), [])

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between px-1">
        <div className="flex items-baseline gap-3">
          <span className="tnum text-[15px] font-medium text-ink">{formatTimecode(playhead)}</span>
          <span className="tnum text-[11px] text-ink-3">
            {duration > 0 ? formatTimecode(duration) : '--:--'}
          </span>
        </div>
        <span className="text-[11px] text-ink-3">
          {scenes.length > 0
            ? `${scenes.length} ${scenes.length === 1 ? 'bloco' : 'blocos'} · ${images.length} ${images.length === 1 ? 'imagem' : 'imagens'}`
            : 'sem imagens'}
        </span>
      </header>

      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        className={[
          'group relative h-[104px] overflow-hidden rounded-md border border-line bg-surface',
          isRendering ? 'cursor-default' : 'cursor-ew-resize',
        ].join(' ')}
      >
        <div className="pointer-events-none absolute inset-0">
          {audio ? (
            <Waveform peaks={audio.peaks} className="block h-full w-full" />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-ink-3">
              Solte a narracao para ver o waveform
            </div>
          )}
        </div>

        {duration > 0 && scenes.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[38px]">
            {scenes.map((scene, index) => {
              const image = images[scene.imageIndex]
              if (!image) return null

              return (
                <button
                  key={`${image.id}-${index}`}
                  type="button"
                  disabled={isRendering}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    selectScene(index)
                  }}
                  // Duplo clique corta o bloco no ponto clicado, como a lamina
                  // de um editor. E o mesmo gesto de sempre, sem modo nem
                  // ferramenta para escolher antes.
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    splitScene(index, timeAt(event.clientX))
                  }}
                  style={{ width: `${((scene.end - scene.start) / duration) * 100}%` }}
                  className={[
                    'pointer-events-auto relative min-w-0 overflow-hidden border-r border-black/40 last:border-r-0',
                    selectedScene === index ? 'ring-1 ring-inset ring-accent' : '',
                  ].join(' ')}
                  title={`${image.fileName} — clique duas vezes para cortar`}
                  aria-label={`Bloco ${index + 1}: ${image.fileName}`}
                >
                  <img
                    src={image.thumbnail}
                    alt=""
                    className="h-full w-full object-cover opacity-70"
                    draggable={false}
                  />
                  <span className="tnum absolute left-1 top-0.5 text-[10px] text-white/70 drop-shadow">
                    {index + 1}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/*
          Alcas de arraste das fronteiras. Ficam por cima das tiras, com area de
          clique maior que o tracinho visivel -- 2px e impossivel de pegar.
        */}
        {!isRendering &&
          duration > 0 &&
          scenes.slice(1).map((scene, i) => {
            const index = i + 1
            const image = images[scene.imageIndex]
            return (
              <div
                key={`limite-${image?.id ?? index}`}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setDragging(index)
                }}
                onPointerMove={(event) => {
                  if (dragging === index) moveBoundary(index, timeAt(event.clientX))
                }}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
                style={{ left: `${(scene.start / duration) * 100}%` }}
                className="absolute inset-y-0 -ml-[5px] w-[10px] cursor-col-resize"
                aria-label={`Ajustar limite da cena ${index + 1}`}
              >
                <span
                  className={[
                    'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150',
                    dragging === index ? 'bg-accent' : 'bg-transparent group-hover:bg-line-strong',
                  ].join(' ')}
                />
              </div>
            )
          })}

        {/*
          O progresso do render acontece aqui: a faixa inteira se preenche de
          rosa da esquerda para a direita. Nao existe outra barra no app.
        */}
        {isRendering && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 bg-accent-glow transition-[width] duration-300 ease-linear"
            style={{ width: `${render.progress * 100}%` }}
          >
            <span className="absolute inset-y-0 right-0 w-px bg-accent" />
          </div>
        )}

        {duration > 0 && !isRendering && (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-accent"
            style={{ left: `${progress * 100}%` }}
          >
            <span className="absolute -left-[3px] -top-px size-[7px] rounded-full bg-accent" />
          </div>
        )}
      </div>
    </section>
  )
}
