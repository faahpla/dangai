import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Volume2, X } from 'lucide-react'
import { classifyFile, isVisual } from '@shared/channels'
import { SFX_GAIN_MAX, SFX_GAIN_MIN, VIDEO_FPS } from '@shared/contract'
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
  const removeScene = useProject((s) => s.removeScene)
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

  /*
   * ONDE A ALCA COLA.
   *
   * A montagem ja escolhe os cortes olhando `cutCandidates` -- as pausas e as
   * fronteiras de palavra que o transcribe achou --, e e isso que garante o
   * criterio de nenhuma troca de imagem cair no meio de uma palavra. No arraste
   * a mao essa inteligencia sumia: ele mirava no olho, contra um waveform.
   *
   * Os inicios de LEGENDA entram junto porque agora estao na tela, logo abaixo
   * dos blocos. Colar no que se ve e o minimo que se espera.
   */
  const transcript = useProject((s) => s.transcript)
  const captions = useProject((s) => s.captions)

  const alvosDeSnap = useMemo(() => {
    const alvos = [...(transcript?.cutCandidates ?? [])]
    for (const bloco of captions) alvos.push(bloco.from / VIDEO_FPS)
    return alvos.sort((a, b) => a - b)
  }, [transcript, captions])

  /**
   * Aproxima o instante do alvo mais perto, se houver um por perto.
   *
   * A tolerancia e de DOZE PIXELS, e nao de um tanto de segundos: com zoom em
   * 4,7x o mesmo intervalo de tempo ocupa cinco vezes mais tela, e uma
   * tolerancia fixa em segundos grudaria tudo de longe justamente quando ele
   * ampliou para ser preciso. Em pixels, o ima tem sempre o mesmo tamanho para
   * o olho -- e ampliar de fato refina a mira.
   *
   * `Alt` desliga: e a saida para quando ele quer exatamente o lugar que o ima
   * esta recusando.
   */
  const comSnap = useCallback(
    (seconds: number, ignorar: boolean): number => {
      const track = trackRef.current
      if (ignorar || !track || duration === 0 || alvosDeSnap.length === 0) return seconds

      const tolerancia = (12 / track.clientWidth) * duration
      let melhor = seconds
      let distancia = tolerancia

      for (const alvo of alvosDeSnap) {
        const dist = Math.abs(alvo - seconds)
        if (dist < distancia) {
          distancia = dist
          melhor = alvo
        }
      }
      return melhor
    },
    [alvosDeSnap, duration],
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
        moveBoundary(dragging, comSnap(timeAt(event.clientX), event.altKey))
        return
      }
      setPlayhead(timeAt(event.clientX))
    },
    [isRendering, dragging, moveBoundary, setPlayhead, timeAt, comSnap],
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

  /*
   * As tiras nao dependem do playhead -- mas eram refeitas junto com ele.
   *
   * O componente inteiro re-renderiza a cada frame que o video anda, porque e
   * o playhead que move a agulha. Sem este memo, os 44 blocos com miniatura,
   * numero e botao de excluir eram reconstruidos trinta vezes por segundo para
   * a agulha andar um pixel. Agora eles so se refazem quando muda algo que
   * realmente os descreve.
   */
  const tiras = useMemo(
    () =>
      scenes.map((scene, index) => {
        const image = images[scene.imageIndex]
        if (!image) return null


        /*
         * Div com role, e nao <button>: o X de excluir e um botao de
         * verdade e botao dentro de botao e HTML invalido -- o Chrome
         * "conserta" tirando um dos dois de dentro do outro, e o
         * resultado e um clique que as vezes some.
         */
        return (
          <div
            key={`${image.id}-${index}`}
            role="button"
            tabIndex={isRendering ? -1 : 0}
            onPointerDown={(event) => {
              if (isRendering) return
              event.stopPropagation()
              selectScene(index)
            }}
            style={{ width: `${((scene.end - scene.start) / duration) * 100}%` }}
            className={[
              'pointer-events-auto group/bloco relative min-w-0 overflow-hidden border-r border-black/40 last:border-r-0',
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

            {/*
              O Delete no bloco selecionado ja fazia isto, mas ninguem
              descobre um atalho que a tela nao mostra. Com uma cena so
              nao aparece: nao ha para onde jogar o tempo dela, e o
              removeScene recusaria em silencio.
            */}
            {!isRendering && scenes.length > 1 && (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  removeScene(index)
                }}
                title="Excluir este bloco (o tempo dele vai para o bloco anterior)"
                aria-label={`Excluir o bloco ${index + 1}`}
                className="absolute right-0.5 top-0.5 grid size-[15px] place-items-center rounded-sm bg-black/70 text-white/80 opacity-0 transition-opacity duration-150 hover:bg-danger hover:text-white group-hover/bloco:opacity-100 focus-visible:opacity-100"
              >
                <X size={10} strokeWidth={2} />
              </button>
            )}
          </div>
        )
      }),
    [scenes, images, duration, selectedScene, dropAt, isRendering, selectScene, removeScene],
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
              .filter((path) => path && isVisual(path))
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
              {tiras}
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
              /*
               * Nao ha mais alca travada.
               *
               * Ela existia porque `moveBoundary` recusava encolher um bloco
               * abaixo de 0,6s, e a recusa era calada -- entao a alca avisava
               * antes do gesto. Agora o arraste e livre: o piso vale so na
               * montagem, e no ajuste a mao sobra o limite de um frame, que
               * ninguem alcanca de proposito.
               */
              return (
                <div
                  key={`limite-${image?.id ?? index}-${index}`}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    setDragging(index)
                  }}
                  onPointerMove={(event) => {
                    if (dragging === index) moveBoundary(index, comSnap(timeAt(event.clientX), event.altKey))
                  }}
                  onPointerUp={stopDragging}
                  onPointerCancel={stopDragging}
                  style={{ left: `${(scene.start / duration) * 100}%` }}
                  /*
                   * A alca vive SO na faixa dos blocos, e nao na altura inteira.
                   *
                   * Ela cobria os 104px e, num video de 44 blocos, as 43 alcas
                   * de 10px ocupavam quase um terco da largura da linha do
                   * tempo -- puxar a agulha virava sorteio entre mover a agulha
                   * e esticar um bloco, e ele reclamou disso com estas palavras:
                   * "as vezes acabo aumentando o tamanho do bloco sem querer".
                   *
                   * Agora o waveform inteiro e da agulha e a faixa de baixo e
                   * dos blocos: um gesto por lugar, como em qualquer editor.
                   */
                  className="absolute bottom-0 h-[38px] -ml-[5px] w-[10px] cursor-col-resize"
                  aria-label={`Ajustar limite do bloco ${index + 1}`}
                >
                  {/*
                    O traco continua subindo pela altura toda -- ele so MOSTRA
                    onde o corte esta, e enxergar isso contra o waveform e o que
                    permite mirar. Sem eventos: quem pega e a caixa de baixo.
                  */}
                  <span
                    className={[
                      'pointer-events-none absolute -top-[66px] bottom-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150',
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

        {/*
          A FAIXA DE LEGENDAS, logo abaixo dos blocos.

          O app inteiro existe para casar roteiro, fala e imagem -- e ate aqui a
          legenda era a unica das tres que nao aparecia na linha do tempo. Para
          saber se uma troca de imagem caia no meio de uma frase, so
          renderizando ou abrindo o editor de legendas, que mostra o texto sem
          mostrar os blocos.

          Encostada nos blocos de proposito: e a coincidencia entre as duas
          faixas que se quer ler de relance.
        */}
        {duration > 0 && <FaixaLegendas duration={duration} />}

        {/*
          A FAIXA DE SFX, embaixo da esteira e dentro do mesmo rolamento.
          Fica aqui e nao num painel para o som ser posicionado OLHANDO a onda
          da narracao -- e contra a fala que se decide onde um whoosh entra.
        */}
        {duration > 0 && !isRendering && (
          <FaixaSfx duration={duration} zoom={zoom} timeAt={timeAt} />
        )}
      </div>
    </section>
  )
}

/**
 * Os SFX postos a mao, cada um um chip no instante dele.
 *
 * Arrastar arquivo de fora poe; arrastar o chip move; o x tira. Enquanto a
 * faixa estiver vazia vale o rodizio automatico de sempre, e a propria faixa
 * diz isso -- senao "sem som nenhum aqui" pareceria "sem som no video".
 */
function FaixaSfx({
  duration,
  zoom,
  timeAt,
}: {
  duration: number
  zoom: number
  timeAt: (clientX: number) => number
}) {
  const sfxManual = useProject((s) => s.sfxManual)
  const sfxEnabled = useProject((s) => s.sfxEnabled)
  const addSfxAt = useProject((s) => s.addSfxAt)
  const moveSfx = useProject((s) => s.moveSfx)
  const removeSfx = useProject((s) => s.removeSfx)
  const trimSfx = useProject((s) => s.trimSfx)
  const setSfxGain = useProject((s) => s.setSfxGain)
  const clearSfxManual = useProject((s) => s.clearSfxManual)

  const [arrastando, setArrastando] = useState<{ id: string; pega: number } | null>(null)
  const [cortandoId, setCortandoId] = useState<string | null>(null)
  // Qual som esta com o controle de volume aberto. Pegar um som ja o seleciona.
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const escolhido = sfxManual.find((s) => s.id === selecionado) ?? null
  const [sobre, setSobre] = useState(false)

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setSobre(true)
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={(event) => {
        setSobre(false)
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => window.dangai.pathForFile(file))
          .filter((path) => classifyFile(path) === 'audio')
        if (paths.length === 0) return
        // Sem isto o drop sobe ate a janela e o audio viraria narracao nova.
        event.preventDefault()
        event.stopPropagation()
        addSfxAt(paths, timeAt(event.clientX))
      }}
      onPointerMove={(event) => {
        // Desconta onde ele pegou: o som anda com o cursor, nao pula para ele.
        if (arrastando) moveSfx(arrastando.id, timeAt(event.clientX) - arrastando.pega)
        if (cortandoId) {
          const som = sfxManual.find((s) => s.id === cortandoId)
          if (som) trimSfx(cortandoId, timeAt(event.clientX) - som.at)
        }
      }}
      onPointerUp={() => {
        setArrastando(null)
        setCortandoId(null)
      }}
      onPointerLeave={() => {
        setArrastando(null)
        setCortandoId(null)
      }}
      style={{ width: `${zoom * 100}%` }}
      className={[
        'relative h-[30px] min-w-full border-t border-line',
        sobre ? 'bg-accent-dim' : 'bg-surface',
      ].join(' ')}
    >
      {sfxManual.length === 0 ? (
        <span className="pointer-events-none absolute inset-0 flex items-center px-2 text-[10px] text-ink-3">
          Solte um som aqui para posicionar na mao. Vazia, os SFX entram sozinhos
          a cada dois cortes.
        </span>
      ) : (
        <>
          {sfxManual.map((som) => {
            /*
             * A largura e a duracao DE VERDADE, sem piso.
             *
             * Tinha um minimo de 3% aqui e ele mentia: um som de 0,3s num video
             * de 77s aparecia com a largura de dois segundos, a onda esticava
             * para preencher, e nada correspondia ao audio.
             *
             * Som curto continua pegavel porque a AREA DE CLIQUE tem um minimo
             * proprio, invisivel, em volta do chip.
             */
            const toca = som.usarSec ?? som.durationSec
            const largura = (toca / duration) * 100
            const esquerda = (som.at / duration) * 100
            const cortado = som.usarSec !== null
            return (
              <div
                key={som.id}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  // Guarda ONDE dentro do chip ele pegou: sem isso o inicio do
                  // som pulava para debaixo do cursor no primeiro movimento.
                  setArrastando({ id: som.id, pega: timeAt(event.clientX) - som.at })
                  setSelecionado(som.id)
                }}
                style={{ left: `${esquerda}%`, width: `${largura}%` }}
                title={`${som.fileName} — entra em ${som.at.toFixed(2)}s, toca ${toca.toFixed(2)}s${
                  cortado ? ` de ${som.durationSec.toFixed(2)}s` : ''
                }${som.gainDb === 0 ? '' : `, ${som.gainDb > 0 ? '+' : ''}${som.gainDb} dB`}`}
                className={[
                  'group/sfx absolute top-1/2 h-[24px] -translate-y-1/2 rounded-sm border',
                  arrastando?.id === som.id || cortandoId === som.id || selecionado === som.id
                    ? 'border-accent bg-accent-dim'
                    : sfxEnabled
                      ? 'border-line-strong bg-elevated'
                      : 'border-line bg-elevated opacity-50',
                ].join(' ')}
              >
                {/* Alvo de clique com no minimo 14px, transbordando pelos lados. */}
                <span className="absolute -inset-x-[7px] inset-y-0 cursor-ew-resize" />

                {/*
                  A onda mostra o som INTEIRO, e a parte cortada fica apagada.
                  Assim ele ve o que esta deixando de fora em vez de so ver o
                  pedaco que sobrou.
                */}
                {som.peaks.length > 0 && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm">
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{ width: `${(som.durationSec / toca) * 100}%` }}
                    >
                      <Waveform peaks={som.peaks} className="block h-full w-full" />
                    </div>
                  </div>
                )}

                {/* Nome e controles so no hover, para a onda ficar limpa. */}
                <span className="pointer-events-none absolute inset-0 flex items-center gap-1 rounded-sm bg-surface/85 px-1 text-[10px] text-ink opacity-0 transition-opacity duration-150 group-hover/sfx:opacity-100">
                  <Volume2 size={9} strokeWidth={1.5} className="shrink-0" />
                  <span className="min-w-0 truncate">{som.fileName}</span>
                  {som.gainDb !== 0 && (
                    <span className="tnum shrink-0 text-accent">
                      {som.gainDb > 0 ? '+' : ''}
                      {som.gainDb}dB
                    </span>
                  )}
                </span>

                {/*
                  A ALCA DE CORTE, na borda direita. Puxar para a esquerda
                  encurta o pedaco que toca; um duplo clique devolve o som
                  inteiro, que e mais rapido do que puxar de volta ate o fim.
                */}
                <span
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    setCortandoId(som.id)
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    trimSfx(som.id, null)
                  }}
                  title="Puxe para cortar o som; dois cliques devolvem inteiro"
                  className="absolute inset-y-0 -right-1 w-[8px] cursor-col-resize rounded-r-sm opacity-0 group-hover/sfx:opacity-100"
                >
                  <span className="absolute inset-y-1 right-[3px] w-[2px] rounded-full bg-accent" />
                </span>

                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => removeSfx(som.id)}
                  aria-label={`Tirar ${som.fileName}`}
                  className="absolute -right-1 -top-1 z-10 grid size-[14px] place-items-center rounded-full border border-line bg-surface text-ink-3 opacity-0 hover:text-danger group-hover/sfx:opacity-100"
                >
                  <X size={8} strokeWidth={2.5} />
                </button>
              </div>
            )
          })}
          {/*
            O VOLUME do som escolhido, no espaco vazio da faixa.
            Nao cabe dentro de um chip de 24px de altura, e um painel a parte
            faria ele tirar o olho da linha do tempo justamente enquanto compara
            o som com a fala. Aqui fica ao lado, sem cobrir nada.
          */}
          {escolhido ? (
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-sm border border-line bg-surface px-1.5 py-0.5">
              <span className="max-w-[90px] truncate text-[10px] text-ink-3">
                {escolhido.fileName}
              </span>
              <input
                type="range"
                aria-label={`Volume de ${escolhido.fileName}`}
                min={SFX_GAIN_MIN}
                max={SFX_GAIN_MAX}
                step={1}
                value={escolhido.gainDb}
                onChange={(event) => setSfxGain(escolhido.id, Number(event.target.value))}
                onPointerDown={(event) => event.stopPropagation()}
                className="dangai-range w-[70px]"
              />
              <span className="tnum w-[42px] text-right text-[10px] text-ink-2">
                {escolhido.gainDb > 0 ? '+' : ''}
                {escolhido.gainDb} dB
              </span>
              <button
                type="button"
                onClick={() => setSelecionado(null)}
                aria-label="Fechar o volume"
                className="text-ink-3 hover:text-ink"
              >
                <X size={9} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={clearSfxManual}
              title="Tira todos e devolve o rodizio automatico"
              className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-ink-3 hover:text-ink-2"
            >
              limpar
            </button>
          )}
        </>
      )}
    </div>
  )
}

/**
 * As legendas na linha do tempo, uma barra por bloco de legenda.
 *
 * Nao e editavel, e de proposito: mesclar e dividir legenda tem tela propria,
 * com o texto grande e o contexto em volta. Aqui o trabalho e outro -- VER onde
 * cada uma cai contra os blocos de imagem. Uma troca de cena no meio de uma
 * frase e o tipo de defeito que nao aparece lendo o roteiro nem olhando a
 * esteira, so na coincidencia das duas coisas.
 *
 * Desligar as legendas apaga a faixa: sem elas no video, ela mentiria.
 */
function FaixaLegendas({ duration }: { duration: number }) {
  const captions = useProject((s) => s.captions)
  const captionsEnabled = useProject((s) => s.captionsEnabled)
  const playhead = useProject((s) => s.playhead)

  if (!captionsEnabled || captions.length === 0 || duration === 0) return null

  return (
    <div className="relative mt-px h-[18px] w-full overflow-hidden border-t border-line bg-surface">
      {captions.map((bloco, i) => {
        const inicio = bloco.from / VIDEO_FPS
        const fim = (bloco.from + bloco.durationInFrames) / VIDEO_FPS
        const atual = playhead >= inicio && playhead < fim
        const texto = bloco.words.map((w) => w.text).join(' ')

        return (
          <div
            key={`legenda-${bloco.from}-${i}`}
            style={{
              left: `${(inicio / duration) * 100}%`,
              width: `${((fim - inicio) / duration) * 100}%`,
            }}
            /*
             * A borda direita e o que separa uma legenda da seguinte quando as
             * duas se encostam -- e encostam quase sempre, porque a regra de
             * duas palavras produz blocos curtos e colados.
             */
            className={[
              'absolute inset-y-0 overflow-hidden border-r border-bg px-1 text-[9px] leading-[18px] whitespace-nowrap',
              atual ? 'bg-accent-dim text-ink' : 'bg-elevated text-ink-3',
            ].join(' ')}
            title={texto}
          >
            {texto}
          </div>
        )
      })}
    </div>
  )
}
