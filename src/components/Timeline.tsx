import { useCallback, useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { classifyFile } from '@shared/channels'
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

/** Ampliacao maxima. Acima disto o waveform vira risco e nao ajuda mais. */
const MAX_ZOOM = 24

export function Timeline() {
  const audio = useProject((s) => s.audio)
  const images = useProject((s) => s.images)
  const playhead = useProject((s) => s.playhead)

  const selectedScene = useProject((s) => s.selectedScene)
  const render = useProject((s) => s.render)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const selectScene = useProject((s) => s.selectScene)
  const insertImages = useProject((s) => s.insertImages)
  const moveBoundary = useProject((s) => s.moveBoundary)
  const scenes = useProject((s) => s.plan)?.scenes ?? []

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  /** Indice da fronteira sendo arrastada, ou null. */
  const [dragging, setDragging] = useState<number | null>(null)
  /** 1 = o audio inteiro cabe na tela. */
  const [zoom, setZoom] = useState(1)
  /** Bloco sob o cursor durante um arraste de arquivos. */
  const [dropAt, setDropAt] = useState<number | null>(null)

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

  /** Qual bloco esta sob o ponteiro, para saber onde a imagem entra. */
  const sceneAt = useCallback(
    (clientX: number): number => {
      const seconds = timeAt(clientX)
      const found = scenes.findIndex((scene) => seconds >= scene.start && seconds < scene.end)
      return found === -1 ? scenes.length : found
    },
    [scenes, timeAt],
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

  /*
   * Com zoom, a agulha sai da vista enquanto o video toca. Trazer a faixa junto
   * -- e so quando ela realmente saiu -- evita que a timeline fique correndo
   * sob o cursor enquanto o usuario mexe em outra coisa.
   */
  useEffect(() => {
    const scroll = scrollRef.current
    const track = trackRef.current
    if (!scroll || !track || zoom === 1 || duration === 0) return

    const x = progress * track.clientWidth
    const margem = scroll.clientWidth * 0.15
    if (x < scroll.scrollLeft + margem || x > scroll.scrollLeft + scroll.clientWidth - margem) {
      // Atribuicao direta, e nao scrollTo com behavior 'smooth': medido neste
      // Chromium, o rolar suave simplesmente nao acontece -- a chamada retorna
      // e o scrollLeft fica onde estava. Instantaneo funciona e, num playhead
      // que corre, e o que se quer de qualquer forma.
      scroll.scrollLeft = Math.max(x - scroll.clientWidth / 2, 0)
    }
  }, [progress, zoom, duration])

  /** Amplia mantendo sob o cursor o mesmo instante que estava la. */
  const zoomAt = useCallback((next: number, clientX?: number) => {
    const scroll = scrollRef.current
    const track = trackRef.current
    const alvo = Math.min(Math.max(next, 1), MAX_ZOOM)

    if (scroll && track) {
      const ancora = clientX ?? scroll.getBoundingClientRect().left + scroll.clientWidth / 2
      const dentro = ancora - track.getBoundingClientRect().left
      const fracao = dentro / track.clientWidth
      const larguraNova = scroll.clientWidth * alvo

      requestAnimationFrame(() => {
        scroll.scrollLeft = fracao * larguraNova - (ancora - scroll.getBoundingClientRect().left)
      })
    }

    setZoom(alvo)
  }, [])

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between px-1">
        <div className="flex items-baseline gap-3">
          <span className="tnum text-[15px] font-medium text-ink">{formatTimecode(playhead)}</span>
          <span className="tnum text-[11px] text-ink-3">
            {duration > 0 ? formatTimecode(duration) : '--:--'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] text-ink-3">
            {scenes.length > 0
              ? `${scenes.length} ${scenes.length === 1 ? 'bloco' : 'blocos'}`
              : 'sem imagens'}
          </span>

          {duration > 0 && !isRendering && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => zoomAt(zoom / 1.6)}
                disabled={zoom <= 1}
                aria-label="Afastar"
                className="grid size-[22px] place-items-center rounded-sm text-ink-3 hover:text-ink disabled:opacity-30"
              >
                <Minus size={12} strokeWidth={1.5} />
              </button>
              <span className="tnum w-9 text-center text-[11px] text-ink-3">
                {zoom.toFixed(1)}x
              </span>
              <button
                type="button"
                onClick={() => zoomAt(zoom * 1.6)}
                disabled={zoom >= MAX_ZOOM}
                aria-label="Aproximar"
                className="grid size-[22px] place-items-center rounded-sm text-ink-3 hover:text-ink disabled:opacity-30"
              >
                <Plus size={12} strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        // overflow-x-auto e nao scroll: sem zoom nao aparece barra nenhuma.
        className="overflow-x-auto overflow-y-hidden rounded-md border border-line bg-surface"
        onWheel={(event) => {
          // Ctrl+roda amplia, como em qualquer editor. Sem Ctrl a roda rola.
          if (!event.ctrlKey || isRendering) return
          event.preventDefault()
          zoomAt(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX)
        }}
      >
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onDragOver={(event) => {
            if (isRendering || scenes.length === 0) return
            event.preventDefault()
            setDropAt(sceneAt(event.clientX))
          }}
          onDragLeave={() => setDropAt(null)}
          onDrop={(event) => {
            setDropAt(null)
            if (isRendering || scenes.length === 0) return
            const paths = Array.from(event.dataTransfer.files)
              .map((file) => window.dangai.pathForFile(file))
              .filter((path) => path && classifyFile(path) === 'image')
            if (paths.length === 0) return

            // Sem isto o drop sobe ate a janela e as imagens iriam para o fim
            // da fila em vez de entrarem aqui.
            event.preventDefault()
            event.stopPropagation()
            void insertImages(paths, timeAt(event.clientX))
          }}
          style={{ width: `${zoom * 100}%` }}
          className={[
            // overflow-hidden aqui, e nao no pai: as alcas de arraste e o ponto
            // da agulha passam alguns pixels da borda, e sem clipar isso a
            // faixa ganhava barra de rolagem mesmo sem zoom nenhum.
            'group relative h-[104px] min-w-full overflow-hidden',
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
                    style={{ width: `${((scene.end - scene.start) / duration) * 100}%` }}
                    className={[
                      'pointer-events-auto relative min-w-0 overflow-hidden border-r border-black/40 last:border-r-0',
                      selectedScene === index ? 'ring-1 ring-inset ring-accent' : '',
                      dropAt === index ? 'ring-1 ring-inset ring-accent' : '',
                    ].join(' ')}
                    title={image.fileName}
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

          {/* Onde a imagem arrastada vai cair. */}
          {dropAt !== null && scenes[dropAt] && duration > 0 && (
            <div
              className="pointer-events-none absolute inset-y-0 w-[2px] bg-accent"
              style={{ left: `${(scenes[dropAt].start / duration) * 100}%` }}
            />
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
                  key={`limite-${image?.id ?? index}-${index}`}
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
                  aria-label={`Ajustar limite do bloco ${index + 1}`}
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
      </div>
    </section>
  )
}
