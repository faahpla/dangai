import { useCallback, useRef } from 'react'
import { useProject, formatTimecode } from '@/store/project'
import { Waveform } from './Waveform'

/**
 * O elemento assinatura. Uma faixa horizontal unica: waveform em cinza ao
 * fundo, tiras de cena com miniatura por cima, playhead rosa de 1px com um
 * ponto no topo.
 *
 * Nesta fase as tiras dividem a duracao igualmente entre as imagens. A divisao
 * real por conteudo entra na v0.3; o desenho e o mesmo.
 */
export function Timeline() {
  const audio = useProject((s) => s.audio)
  const images = useProject((s) => s.images)
  const playhead = useProject((s) => s.playhead)
  const selectedImageId = useProject((s) => s.selectedImageId)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const selectImage = useProject((s) => s.selectImage)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const duration = audio?.durationSec ?? 0
  const progress = duration > 0 ? playhead / duration : 0

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track || duration === 0) return
      const rect = track.getBoundingClientRect()
      const ratio = (clientX - rect.left) / rect.width
      setPlayhead(ratio * duration)
    },
    [duration, setPlayhead],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      seekFromEvent(event.clientX)
    },
    [seekFromEvent],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.buttons !== 1) return
      seekFromEvent(event.clientX)
    },
    [seekFromEvent],
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
        className="group relative h-[104px] cursor-ew-resize overflow-hidden rounded-md border border-line bg-surface"
      >
        {/* waveform ao fundo */}
        <div className="pointer-events-none absolute inset-0">
          {audio ? (
            <Waveform peaks={audio.peaks} className="block h-full w-full" />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-ink-3">
              Solte a narracao para ver o waveform
            </div>
          )}
        </div>

        {/* tiras de cena por cima */}
        {duration > 0 && images.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[38px]">
            {images.map((image, index) => (
              <button
                key={image.id}
                type="button"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  selectImage(image.id)
                }}
                style={{ width: `${100 / images.length}%` }}
                className={[
                  'pointer-events-auto relative min-w-0 overflow-hidden border-r border-black/40 last:border-r-0',
                  'transition-[box-shadow] duration-200',
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
            ))}
          </div>
        )}

        {/* preenchimento do render entra aqui na v0.2 */}

        {/* playhead */}
        {duration > 0 && (
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
