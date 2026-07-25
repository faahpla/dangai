import { useCallback, useRef } from 'react'
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
  const selectedImageId = useProject((s) => s.selectedImageId)
  const render = useProject((s) => s.render)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const selectImage = useProject((s) => s.selectImage)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const duration = audio?.durationSec ?? 0
  const progress = duration > 0 ? playhead / duration : 0
  const isRendering = render !== null

  // As mesmas cenas que vao para o render, para as tiras baterem com o video.
  const scenes = useProject((s) => s.plan)?.scenes ?? []

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track || duration === 0) return
      const rect = track.getBoundingClientRect()
      setPlayhead(((clientX - rect.left) / rect.width) * duration)
    },
    [duration, setPlayhead],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isRendering) return
      event.currentTarget.setPointerCapture(event.pointerId)
      seekFromEvent(event.clientX)
    },
    [isRendering, seekFromEvent],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isRendering || event.buttons !== 1) return
      seekFromEvent(event.clientX)
    },
    [isRendering, seekFromEvent],
  )

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
          {images.length > 0
            ? `${images.length} ${images.length === 1 ? 'cena' : 'cenas'}`
            : 'sem imagens'}
        </span>
      </header>

      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
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
              const widthPct = ((scene.end - scene.start) / duration) * 100

              return (
                <button
                  key={image.id}
                  type="button"
                  disabled={isRendering}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    selectImage(image.id)
                  }}
                  style={{ width: `${widthPct}%` }}
                  className={[
                    'pointer-events-auto relative min-w-0 overflow-hidden border-r border-black/40 last:border-r-0',
                    selectedImageId === image.id ? 'ring-1 ring-inset ring-accent' : '',
                  ].join(' ')}
                  aria-label={`Cena ${index + 1}: ${image.fileName}`}
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
