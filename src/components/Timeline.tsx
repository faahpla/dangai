import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Film, Minus, Music, Plus, Volume2, X } from 'lucide-react'
import { classifyFile, isVisual } from '@shared/channels'
import { SFX_GAIN_MAX, SFX_GAIN_MIN, VIDEO_FPS, duracaoDoTrecho } from '@shared/contract'
import { useProject, formatTimecode } from '@/store/project'
import { Waveform } from './Waveform'
import { caminhosDoArraste } from './arrastar'

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
  const selecionados = useProject((s) => s.selecionados)
  const estenderSelecao = useProject((s) => s.estenderSelecao)
  const alternarSelecao = useProject((s) => s.alternarSelecao)
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

  /**
   * Leva a agulha ate ali E seleciona o bloco de baixo.
   *
   * A agulha em cima de um bloco e o painel mostrando outro era ler uma coisa e
   * editar outra. Passar a agulha ja e dizer "e deste que estou falando", entao
   * a selecao segue junto.
   *
   * So no ARRASTE A MAO, e nao durante o play: seguindo a reproducao, a selecao
   * trocaria dezenas de vezes por minuto e o painel de edicao remontaria os
   * <video> de enquadrar a cada bloco -- movimento na tela que ninguem pediu, em
   * cima de quem so queria assistir.
   *
   * Fora dos blocos (depois do ultimo) a selecao fica como esta: apagar a
   * escolha dele por arrastar a agulha um pouco alem do fim seria perder
   * trabalho por acidente.
   */
  const levarAgulha = useCallback(
    (clientX: number): void => {
      const seconds = timeAt(clientX)
      setPlayhead(seconds)
      const sob = scenes.findIndex((scene) => seconds >= scene.start && seconds < scene.end)
      if (sob !== -1) selectScene(sob)
    },
    [scenes, selectScene, setPlayhead, timeAt],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isRendering) return
      event.currentTarget.setPointerCapture(event.pointerId)
      levarAgulha(event.clientX)
    },
    [isRendering, levarAgulha],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isRendering || event.buttons !== 1) return
      if (dragging !== null) {
        moveBoundary(dragging, comSnap(timeAt(event.clientX), event.altKey))
        return
      }
      levarAgulha(event.clientX)
    },
    [isRendering, dragging, moveBoundary, levarAgulha, timeAt, comSnap],
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
              /*
               * Os tres gestos de selecao de qualquer editor.
               *
               * Shift pega o intervalo, Ctrl liga e desliga um avulso, e o
               * clique seco recomeca a selecao do zero. Sao os mesmos do
               * explorador de arquivos, entao ninguem precisa aprender.
               */
              if (event.shiftKey) estenderSelecao(index)
              else if (event.ctrlKey || event.metaKey) alternarSelecao(index)
              else selectScene(index)
            }}
            style={{ width: `${((scene.end - scene.start) / duration) * 100}%` }}
            className={[
              'pointer-events-auto group/bloco relative min-w-0 overflow-hidden border-r border-black/40 last:border-r-0',
              /*
               * A ANCORA tem anel mais grosso que os outros selecionados.
               *
               * Com cinco blocos marcados iguais, nada na tela diz qual deles o
               * painel da direita esta editando -- e o painel edita um so. O
               * anel de dois pixels e essa resposta.
               */
              selecionados.includes(index)
                ? selectedScene === index
                  ? 'ring-2 ring-inset ring-accent'
                  : 'ring-1 ring-inset ring-accent/60'
                : '',
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
    [
      scenes,
      images,
      duration,
      selectedScene,
      selecionados,
      dropAt,
      isRendering,
      selectScene,
      estenderSelecao,
      alternarSelecao,
      removeScene,
    ],
  )

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between px-1">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="tnum text-[15px] font-medium text-ink">{formatTimecode(playhead)}</span>
          <span className="tnum shrink-0 text-[11px] text-ink-3">
            {duration > 0 ? formatTimecode(duration) : '--:--'}
          </span>
          {/*
            A LEGENDA DE AGORA, por extenso.

            Na faixa ela cabe em quatro pixels e nao se le. Aqui ha largura de
            sobra, e o texto responde a outra pergunta: nao "onde ela cai", que
            e o trabalho da faixa, mas "o que esta escrito na tela neste
            instante" -- util ao parar a agulha em cima de um corte suspeito.
          */}
          <LegendaAtual />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] text-ink-3">
            {scenes.length === 0
              ? 'sem imagens'
              : selecionados.length > 1
                ? /*
                   * Com varios marcados, o numero que importa e QUANTOS -- e a
                   * conta que decide se vale colar ajustes de uma vez. O total
                   * continua atras dele para nao sumir a escala do video.
                   */
                  `${selecionados.length} de ${scenes.length} blocos`
                : `${scenes.length} ${scenes.length === 1 ? 'bloco' : 'blocos'}`}
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
          /*
           * Ctrl+roda ou ALT+roda ampliam. Sem nenhum dos dois, a roda rola.
           *
           * O Alt entrou a pedido dele, e nao briga com o Alt que desliga o
           * snap: aquele vale durante o ARRASTE de uma alca, e este na RODA.
           * Sao dois gestos que nao acontecem ao mesmo tempo.
           */
          if (!(event.ctrlKey || event.altKey) || isRendering) return
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
        {duration > 0 && <FaixaLegendas duration={duration} zoom={zoom} />}

        {/*
          A FAIXA DE SFX, embaixo da esteira e dentro do mesmo rolamento.
          Fica aqui e nao num painel para o som ser posicionado OLHANDO a onda
          da narracao -- e contra a fala que se decide onde um whoosh entra.
        */}
        {duration > 0 && !isRendering && (
          <FaixasDeVideo duration={duration} zoom={zoom} timeAt={timeAt} />
        )}
        {duration > 0 && !isRendering && (
          <FaixaSfx duration={duration} zoom={zoom} timeAt={timeAt} />
        )}
        {duration > 0 && !isRendering && (
          <FaixasDeAudio duration={duration} zoom={zoom} timeAt={timeAt} />
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
        const paths = caminhosDoArraste(event).filter((path) => classifyFile(path) === 'audio')
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
 * As legendas na linha do tempo.
 *
 * A PRIMEIRA VERSAO ESCREVIA O TEXTO DENTRO DE CADA BARRA, e foi um fracasso.
 * Legenda de filme e frase longa e esparsa; a daqui e o oposto -- duas palavras
 * e dez caracteres, por decisao dele, o que da mais de 150 blocos num audio de
 * 68s. Sem zoom, cada um mede uns 4 pixels: o texto virava sopa de letras
 * colada. Palavras dele: "ficou pessimo, nao da pra entender nada".
 *
 * O que esta faixa precisa responder e uma pergunta de RITMO, nao de leitura:
 * "a troca de imagem cai no meio da fala?". Isso se ve na forma -- onde cada
 * legenda comeca e acaba, contra a fronteira dos blocos logo acima. O texto so
 * aparece quando a barra e larga o bastante para caber de verdade, o que
 * acontece sozinho conforme ele amplia.
 *
 * Quem mostra o texto o tempo todo e o cabecalho, que tem largura de sobra.
 */
function FaixaLegendas({ duration, zoom }: { duration: number; zoom: number }) {
  const captions = useProject((s) => s.captions)
  const captionsEnabled = useProject((s) => s.captionsEnabled)
  const playhead = useProject((s) => s.playhead)

  const faixaRef = useRef<HTMLDivElement | null>(null)
  const [largura, setLargura] = useState(0)

  /*
   * A largura REAL da faixa, que muda com o zoom e com a janela.
   *
   * E ela que decide se o texto cabe, e por isso e medida em vez de estimada:
   * a faixa vive dentro do mesmo rolamento da esteira, e a conta de quanto o
   * zoom esticou o container nao e responsabilidade de quem desenha barra.
   */
  useEffect(() => {
    const alvo = faixaRef.current
    if (!alvo) return
    const medir = (): void => setLargura(alvo.clientWidth)
    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(alvo)
    return () => observer.disconnect()
  }, [])

  if (!captionsEnabled || captions.length === 0 || duration === 0) return null

  return (
    <div
      ref={faixaRef}
      /*
       * O MESMO ESTICAMENTO DA ESTEIRA, como a faixa de SFX ja fazia.
       *
       * Sem isto a faixa ficava em 100% da janela enquanto os blocos ocupavam
       * `zoom * 100%`: com zoom em 4,7x as legendas do video inteiro se
       * espremiam no primeiro quinto da tela, sem relacao nenhuma com o bloco
       * acima. E a coincidencia entre as duas faixas e o unico motivo desta
       * existir -- desalinhada, ela so atrapalha.
       */
      style={{ width: `${zoom * 100}%` }}
      className="relative mt-px h-[14px] min-w-full overflow-hidden border-t border-line bg-surface"
    >
      {captions.map((bloco, i) => {
        const inicio = bloco.from / VIDEO_FPS
        const fim = (bloco.from + bloco.durationInFrames) / VIDEO_FPS
        const atual = playhead >= inicio && playhead < fim
        const texto = bloco.words.map((w) => w.text).join(' ')

        /*
         * Sete pixels por caractere na fonte de 9px, com folga para o respiro
         * dos lados. Abaixo disso a palavra sai cortada no meio, que e pior do
         * que nao mostrar nada: barra lisa se le como ritmo, letra picotada se
         * le como defeito.
         */
        const larguraDaBarra = ((fim - inicio) / duration) * largura
        const cabe = larguraDaBarra > texto.length * 7

        return (
          <div
            key={`legenda-${bloco.from}-${i}`}
            style={{
              left: `${(inicio / duration) * 100}%`,
              width: `${((fim - inicio) / duration) * 100}%`,
            }}
            /*
             * A borda direita separa uma legenda da seguinte: elas se encostam
             * quase sempre, e sem o corte a faixa viraria uma barra continua
             * que nao diz nada sobre onde uma acaba e a outra comeca.
             */
            className={[
              'absolute inset-y-0 overflow-hidden border-r border-bg',
              cabe ? 'px-1 text-[9px] leading-[14px] whitespace-nowrap' : '',
              atual ? 'bg-accent text-white' : 'bg-line-strong text-ink-3',
            ].join(' ')}
            title={texto}
          >
            {cabe ? texto : null}
          </div>
        )
      })}
    </div>
  )
}

/**
 * O texto da legenda sob a agulha, no cabecalho.
 *
 * Componente proprio para nao arrastar a Timeline inteira a cada frame: ele
 * assina o playhead, e quem re-renderiza trinta vezes por segundo e so este
 * pedaco de texto.
 */
function LegendaAtual() {
  const captions = useProject((s) => s.captions)
  const captionsEnabled = useProject((s) => s.captionsEnabled)
  const playhead = useProject((s) => s.playhead)

  if (!captionsEnabled || captions.length === 0) return null

  const frame = playhead * VIDEO_FPS
  const bloco = captions.find(
    (c) => frame >= c.from && frame < c.from + c.durationInFrames,
  )
  if (!bloco) return null

  return (
    <span className="min-w-0 truncate text-[11px] text-ink-2" title="Legenda neste instante">
      {bloco.words.map((w) => w.text).join(' ')}
    </span>
  )
}

/** Altura de cada faixa de audio, em px. */
const ALTURA_DA_FAIXA = 30

/**
 * AS FAIXAS DE AUDIO: musica e o que mais ele quiser por baixo da narracao.
 *
 * "Quero adicionar track audio, para eu add minhas musicas no video." Cada
 * faixa aceita arquivo solto do Explorer ou arrastado das Power Bins. O trecho
 * anda no tempo E entre faixas (arrastando para cima ou para baixo), corta
 * pelas duas pontas -- a da esquerda escolhe de que ponto do arquivo ele parte
 * --, e o trecho escolhido abre volume e fades no canto da faixa.
 *
 * Sempre sobra uma faixa vazia embaixo: e onde se solta a proxima musica sem
 * disputar espaco com as que ja estao la.
 */
function FaixasDeAudio({
  duration,
  zoom,
  timeAt,
}: {
  duration: number
  zoom: number
  timeAt: (clientX: number) => number
}) {
  const trilhas = useProject((s) => s.trilhas)
  const addTrilhasAt = useProject((s) => s.addTrilhasAt)
  const moveTrilha = useProject((s) => s.moveTrilha)
  const cortarFim = useProject((s) => s.cortarFimDaTrilha)
  const cortarInicio = useProject((s) => s.cortarInicioDaTrilha)
  const ajustar = useProject((s) => s.ajustarTrilha)
  const remover = useProject((s) => s.removeTrilha)

  const caixa = useRef<HTMLDivElement | null>(null)
  const [gesto, setGesto] = useState<
    | { tipo: 'mover'; id: string; pega: number }
    | { tipo: 'fim'; id: string }
    | { tipo: 'inicio'; id: string }
    | null
  >(null)
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [sobre, setSobre] = useState<number | null>(null)

  const faixas = Math.max(...trilhas.map((t) => t.faixa + 1), 0) + 1
  const escolhido = trilhas.find((t) => t.id === selecionado) ?? null

  /** Em que faixa esta este ponto da tela. */
  const faixaEm = (clientY: number): number => {
    const r = caixa.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.min(Math.max(Math.floor((clientY - r.top) / ALTURA_DA_FAIXA), 0), faixas - 1)
  }

  return (
    <div
      ref={caixa}
      style={{ width: `${zoom * 100}%`, height: faixas * ALTURA_DA_FAIXA }}
      className="relative min-w-full"
      onDragOver={(event) => {
        event.preventDefault()
        setSobre(faixaEm(event.clientY))
      }}
      onDragLeave={() => setSobre(null)}
      onDrop={(event) => {
        setSobre(null)
        const paths = caminhosDoArraste(event).filter((p) => classifyFile(p) === 'audio')
        if (paths.length === 0) return
        // Sem isto o drop sobe ate a janela e o audio viraria narracao nova.
        event.preventDefault()
        event.stopPropagation()
        void addTrilhasAt(paths, timeAt(event.clientX), faixaEm(event.clientY))
      }}
      onPointerMove={(event) => {
        if (!gesto) return
        const t = trilhas.find((x) => x.id === gesto.id)
        if (!t) return
        if (gesto.tipo === 'mover') moveTrilha(t.id, timeAt(event.clientX) - gesto.pega, faixaEm(event.clientY))
        if (gesto.tipo === 'fim') cortarFim(t.id, timeAt(event.clientX) - t.at)
        if (gesto.tipo === 'inicio') cortarInicio(t.id, timeAt(event.clientX))
      }}
      onPointerUp={() => setGesto(null)}
      onPointerLeave={() => setGesto(null)}
    >
      {Array.from({ length: faixas }, (_, f) => (
        <div
          key={f}
          style={{ top: f * ALTURA_DA_FAIXA, height: ALTURA_DA_FAIXA }}
          className={['absolute inset-x-0 border-t border-line', sobre === f ? 'bg-accent-dim' : 'bg-surface'].join(' ')}
        >
          {!trilhas.some((t) => t.faixa === f) && (
            <span className="pointer-events-none absolute inset-0 flex items-center gap-1.5 px-2 text-[10px] text-ink-3">
              <Music size={10} strokeWidth={1.5} />
              {f === 0
                ? 'Faixa de audio: solte uma musica aqui (do Explorer ou das Bins).'
                : 'Solte aqui para uma faixa nova.'}
            </span>
          )}
        </div>
      ))}

      {trilhas.map((t) => {
        const toca = duracaoDoTrecho(t)
        const esquerda = (t.at / duration) * 100
        const largura = (toca / duration) * 100
        const ativo = gesto?.id === t.id || selecionado === t.id
        // A onda e do arquivo inteiro; aparece so o pedaco que toca.
        const ondaLargura = (t.durationSec / Math.max(toca, 0.01)) * 100
        const ondaDesloca = (t.inicioSec / Math.max(toca, 0.01)) * 100
        return (
          <div
            key={t.id}
            data-trilha={t.id}
            onPointerDown={(event) => {
              event.stopPropagation()
              event.currentTarget.setPointerCapture(event.pointerId)
              setGesto({ tipo: 'mover', id: t.id, pega: timeAt(event.clientX) - t.at })
              setSelecionado(t.id)
            }}
            style={{
              left: `${esquerda}%`,
              width: `${largura}%`,
              top: t.faixa * ALTURA_DA_FAIXA + 3,
              height: ALTURA_DA_FAIXA - 6,
            }}
            title={`${t.fileName} — entra em ${t.at.toFixed(2)}s, toca ${toca.toFixed(2)}s (a partir de ${t.inicioSec.toFixed(2)}s do arquivo), ${t.gainDb} dB`}
            className={[
              'group/trilha absolute cursor-grab overflow-hidden rounded-sm border',
              ativo ? 'border-accent bg-accent-dim' : 'border-line-strong bg-elevated',
            ].join(' ')}
          >
            {t.peaks.length > 0 && (
              <div
                className="pointer-events-none absolute inset-y-0 opacity-70"
                style={{ left: `${-ondaDesloca}%`, width: `${ondaLargura}%` }}
              >
                <Waveform peaks={t.peaks} className="block h-full w-full" />
              </div>
            )}
            {/* Os fades desenhados: a rampa de entrada e a de saida. */}
            {t.fadeInSec > 0 && (
              <span
                className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/60 to-transparent"
                style={{ width: `${Math.min(t.fadeInSec / toca, 0.5) * 100}%` }}
              />
            )}
            {t.fadeOutSec > 0 && (
              <span
                className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/60 to-transparent"
                style={{ width: `${Math.min(t.fadeOutSec / toca, 0.5) * 100}%` }}
              />
            )}
            <span className="pointer-events-none absolute left-1 top-0.5 max-w-full truncate text-[9px] text-ink drop-shadow">
              {t.fileName}
            </span>

            {/* As duas alcas de corte. Dois cliques devolvem o arquivo inteiro. */}
            <span
              data-alca="inicio"
              onPointerDown={(event) => {
                event.stopPropagation()
                event.currentTarget.setPointerCapture(event.pointerId)
                setGesto({ tipo: 'inicio', id: t.id })
                setSelecionado(t.id)
              }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                cortarInicio(t.id, t.at - t.inicioSec)
              }}
              title="Puxe para escolher de que ponto a musica entra"
              className="absolute inset-y-0 left-0 w-[7px] cursor-col-resize opacity-0 group-hover/trilha:opacity-100"
            >
              <span className="absolute inset-y-1 left-[2px] w-[2px] rounded-full bg-accent" />
            </span>
            <span
              data-alca="fim"
              onPointerDown={(event) => {
                event.stopPropagation()
                event.currentTarget.setPointerCapture(event.pointerId)
                setGesto({ tipo: 'fim', id: t.id })
                setSelecionado(t.id)
              }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                cortarFim(t.id, null)
              }}
              title="Puxe para cortar o fim; dois cliques devolvem ate o fim do arquivo"
              className="absolute inset-y-0 right-0 w-[7px] cursor-col-resize opacity-0 group-hover/trilha:opacity-100"
            >
              <span className="absolute inset-y-1 right-[2px] w-[2px] rounded-full bg-accent" />
            </span>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                remover(t.id)
                if (selecionado === t.id) setSelecionado(null)
              }}
              aria-label={`Tirar ${t.fileName}`}
              className="absolute right-2 top-0.5 z-10 grid size-[13px] place-items-center rounded-full border border-line bg-surface text-ink-3 opacity-0 hover:text-danger group-hover/trilha:opacity-100"
            >
              <X size={8} strokeWidth={2.5} />
            </button>
          </div>
        )
      })}

      {/*
        VOLUME E FADES do trecho escolhido, no canto da faixa dele -- sem painel
        a parte, para comparar com a fala sem tirar o olho da linha do tempo.
      */}
      {escolhido && (
        <div
          style={{ top: escolhido.faixa * ALTURA_DA_FAIXA + 3 }}
          className="absolute right-1 z-20 flex items-center gap-2 rounded-sm border border-line bg-surface px-1.5 py-0.5"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="max-w-[90px] truncate text-[10px] text-ink-3">{escolhido.fileName}</span>
          <ControleDaTrilha
            rotulo="Volume"
            valor={escolhido.gainDb}
            min={-40}
            max={12}
            passo={1}
            texto={`${escolhido.gainDb > 0 ? '+' : ''}${escolhido.gainDb} dB`}
            onChange={(v) => ajustar(escolhido.id, { gainDb: v })}
          />
          <ControleDaTrilha
            rotulo="Fade de entrada"
            valor={escolhido.fadeInSec}
            min={0}
            max={5}
            passo={0.1}
            texto={`${escolhido.fadeInSec.toFixed(1)}s`}
            onChange={(v) => ajustar(escolhido.id, { fadeInSec: v })}
          />
          <ControleDaTrilha
            rotulo="Fade de saida"
            valor={escolhido.fadeOutSec}
            min={0}
            max={5}
            passo={0.1}
            texto={`${escolhido.fadeOutSec.toFixed(1)}s`}
            onChange={(v) => ajustar(escolhido.id, { fadeOutSec: v })}
          />
          <button
            type="button"
            onClick={() => setSelecionado(null)}
            aria-label="Fechar os controles da trilha"
            className="text-ink-3 hover:text-ink"
          >
            <X size={9} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  )
}

function ControleDaTrilha({
  rotulo,
  valor,
  min,
  max,
  passo,
  texto,
  onChange,
}: {
  rotulo: string
  valor: number
  min: number
  max: number
  passo: number
  texto: string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-1" title={rotulo}>
      <span className="text-[9px] uppercase tracking-wide text-ink-3">
        {rotulo === 'Volume' ? 'vol' : rotulo === 'Fade de entrada' ? 'entra' : 'sai'}
      </span>
      <input
        type="range"
        aria-label={rotulo}
        min={min}
        max={max}
        step={passo}
        value={valor}
        onChange={(event) => onChange(Number(event.target.value))}
        className="dangai-range w-[60px]"
      />
      <span className="tnum w-[38px] text-right text-[10px] text-ink-2">{texto}</span>
    </label>
  )
}

/**
 * A FAIXA DE VIDEO: setas, circulos, emoji animado -- os .mov com fundo vazado
 * que ele faz no editor, e PNG.
 *
 * "Track de video tambem seria interessante, pra poder adicionar meus .mov."
 * Mesmo gesto das faixas de audio: solta do Explorer ou das Bins, arrasta no
 * tempo e entre faixas, corta pelas duas pontas. O trecho escolhido abre
 * posicao, escala e opacidade -- o resultado aparece no preview na hora. A
 * faixa de numero maior fica por cima no video.
 */
function FaixasDeVideo({
  duration,
  zoom,
  timeAt,
}: {
  duration: number
  zoom: number
  timeAt: (clientX: number) => number
}) {
  const itens = useProject((s) => s.sobreposicoes)
  const adicionar = useProject((s) => s.addSobreposicoesAt)
  const mover = useProject((s) => s.moveSobreposicao)
  const cortarFim = useProject((s) => s.cortarFimDaSobreposicao)
  const cortarInicio = useProject((s) => s.cortarInicioDaSobreposicao)
  const ajustar = useProject((s) => s.ajustarSobreposicao)
  const remover = useProject((s) => s.removeSobreposicao)

  const caixa = useRef<HTMLDivElement | null>(null)
  const [gesto, setGesto] = useState<
    | { tipo: 'mover'; id: string; pega: number }
    | { tipo: 'fim'; id: string }
    | { tipo: 'inicio'; id: string }
    | null
  >(null)
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [sobre, setSobre] = useState<number | null>(null)

  const faixas = Math.max(...itens.map((o) => o.faixa + 1), 0) + 1
  const escolhido = itens.find((o) => o.id === selecionado) ?? null

  // Na tela, a faixa de CIMA e a de numero maior -- a que fica por cima no video.
  const linhaDa = (faixa: number): number => faixas - 1 - faixa
  const faixaEm = (clientY: number): number => {
    const r = caixa.current?.getBoundingClientRect()
    if (!r) return 0
    const linha = Math.min(Math.max(Math.floor((clientY - r.top) / ALTURA_DA_FAIXA), 0), faixas - 1)
    return faixas - 1 - linha
  }

  return (
    <div
      ref={caixa}
      style={{ width: `${zoom * 100}%`, height: faixas * ALTURA_DA_FAIXA }}
      className="relative min-w-full"
      onDragOver={(event) => {
        event.preventDefault()
        setSobre(faixaEm(event.clientY))
      }}
      onDragLeave={() => setSobre(null)}
      onDrop={(event) => {
        setSobre(null)
        const paths = caminhosDoArraste(event).filter((p) => {
          const t = classifyFile(p)
          return t === 'video' || t === 'image'
        })
        if (paths.length === 0) return
        // Sem isto o drop sobe ate a janela e viraria material novo do video.
        event.preventDefault()
        event.stopPropagation()
        void adicionar(paths, timeAt(event.clientX), faixaEm(event.clientY))
      }}
      onPointerMove={(event) => {
        if (!gesto) return
        const o = itens.find((x) => x.id === gesto.id)
        if (!o) return
        if (gesto.tipo === 'mover') mover(o.id, timeAt(event.clientX) - gesto.pega, faixaEm(event.clientY))
        if (gesto.tipo === 'fim') cortarFim(o.id, timeAt(event.clientX) - o.at)
        if (gesto.tipo === 'inicio') cortarInicio(o.id, timeAt(event.clientX))
      }}
      onPointerUp={() => setGesto(null)}
      onPointerLeave={() => setGesto(null)}
    >
      {Array.from({ length: faixas }, (_, f) => (
        <div
          key={f}
          style={{ top: linhaDa(f) * ALTURA_DA_FAIXA, height: ALTURA_DA_FAIXA }}
          className={['absolute inset-x-0 border-t border-line', sobre === f ? 'bg-accent-dim' : 'bg-surface'].join(' ')}
        >
          {!itens.some((o) => o.faixa === f) && (
            <span className="pointer-events-none absolute inset-0 flex items-center gap-1.5 px-2 text-[10px] text-ink-3">
              <Film size={10} strokeWidth={1.5} />
              {f === 0
                ? 'Faixa de video: solte um .mov, .webm ou PNG aqui (setas, circulos...).'
                : 'Solte aqui para uma faixa de video nova, por cima das outras.'}
            </span>
          )}
        </div>
      ))}

      {itens.map((o) => {
        const toca = o.usarSec ?? o.durationSec - o.inicioSec
        const ativo = gesto?.id === o.id || selecionado === o.id
        return (
          <div
            key={o.id}
            data-sobreposicao={o.id}
            onPointerDown={(event) => {
              event.stopPropagation()
              event.currentTarget.setPointerCapture(event.pointerId)
              setGesto({ tipo: 'mover', id: o.id, pega: timeAt(event.clientX) - o.at })
              setSelecionado(o.id)
            }}
            style={{
              left: `${(o.at / duration) * 100}%`,
              width: `${(toca / duration) * 100}%`,
              top: linhaDa(o.faixa) * ALTURA_DA_FAIXA + 3,
              height: ALTURA_DA_FAIXA - 6,
            }}
            title={`${o.fileName} — entra em ${o.at.toFixed(2)}s, fica ${toca.toFixed(2)}s`}
            className={[
              'group/sobre absolute cursor-grab overflow-hidden rounded-sm border',
              ativo ? 'border-accent bg-accent-dim' : 'border-line-strong bg-elevated',
            ].join(' ')}
          >
            {o.tipo === 'image' && o.url && (
              <img src={o.url} alt="" draggable={false} className="pointer-events-none absolute inset-y-0 left-0 h-full opacity-60" />
            )}
            <span className="pointer-events-none absolute left-1 top-0.5 flex max-w-full items-center gap-1 truncate text-[9px] text-ink drop-shadow">
              <Film size={9} strokeWidth={1.5} />
              {o.fileName}
            </span>
            <span
              data-alca="inicio"
              onPointerDown={(event) => {
                event.stopPropagation()
                event.currentTarget.setPointerCapture(event.pointerId)
                setGesto({ tipo: 'inicio', id: o.id })
                setSelecionado(o.id)
              }}
              title="Puxe para mudar onde entra"
              className="absolute inset-y-0 left-0 w-[7px] cursor-col-resize opacity-0 group-hover/sobre:opacity-100"
            >
              <span className="absolute inset-y-1 left-[2px] w-[2px] rounded-full bg-accent" />
            </span>
            <span
              data-alca="fim"
              onPointerDown={(event) => {
                event.stopPropagation()
                event.currentTarget.setPointerCapture(event.pointerId)
                setGesto({ tipo: 'fim', id: o.id })
                setSelecionado(o.id)
              }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                cortarFim(o.id, null)
              }}
              title="Puxe para mudar quanto fica na tela"
              className="absolute inset-y-0 right-0 w-[7px] cursor-col-resize opacity-0 group-hover/sobre:opacity-100"
            >
              <span className="absolute inset-y-1 right-[2px] w-[2px] rounded-full bg-accent" />
            </span>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                remover(o.id)
                if (selecionado === o.id) setSelecionado(null)
              }}
              aria-label={`Tirar ${o.fileName}`}
              className="absolute right-2 top-0.5 z-10 grid size-[13px] place-items-center rounded-full border border-line bg-surface text-ink-3 opacity-0 hover:text-danger group-hover/sobre:opacity-100"
            >
              <X size={8} strokeWidth={2.5} />
            </button>
          </div>
        )
      })}

      {escolhido && (
        <div
          style={{ top: linhaDa(escolhido.faixa) * ALTURA_DA_FAIXA + 3 }}
          className="absolute right-1 z-20 flex items-center gap-2 rounded-sm border border-line bg-surface px-1.5 py-0.5"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="max-w-[80px] truncate text-[10px] text-ink-3">{escolhido.fileName}</span>
          <ControleDaSobreposicao rotulo="x" titulo="Posicao horizontal" valor={escolhido.x} min={-60} max={60} passo={1}
            texto={`${Math.round(escolhido.x)}%`} onChange={(v) => ajustar(escolhido.id, { x: v })} />
          <ControleDaSobreposicao rotulo="y" titulo="Posicao vertical" valor={escolhido.y} min={-60} max={60} passo={1}
            texto={`${Math.round(escolhido.y)}%`} onChange={(v) => ajustar(escolhido.id, { y: v })} />
          <ControleDaSobreposicao rotulo="tam" titulo="Escala" valor={escolhido.escala} min={0.1} max={3} passo={0.05}
            texto={`${Math.round(escolhido.escala * 100)}%`} onChange={(v) => ajustar(escolhido.id, { escala: v })} />
          <ControleDaSobreposicao rotulo="opac" titulo="Opacidade" valor={escolhido.opacidade} min={0} max={1} passo={0.05}
            texto={`${Math.round(escolhido.opacidade * 100)}%`} onChange={(v) => ajustar(escolhido.id, { opacidade: v })} />
          <button
            type="button"
            onClick={() => setSelecionado(null)}
            aria-label="Fechar os controles da sobreposicao"
            className="text-ink-3 hover:text-ink"
          >
            <X size={9} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  )
}

function ControleDaSobreposicao({
  rotulo,
  titulo,
  valor,
  min,
  max,
  passo,
  texto,
  onChange,
}: {
  rotulo: string
  titulo: string
  valor: number
  min: number
  max: number
  passo: number
  texto: string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-1" title={titulo}>
      <span className="text-[9px] uppercase tracking-wide text-ink-3">{rotulo}</span>
      <input
        type="range"
        aria-label={titulo}
        min={min}
        max={max}
        step={passo}
        value={valor}
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={() => onChange(titulo === 'Escala' || titulo === 'Opacidade' ? 1 : 0)}
        className="dangai-range w-[56px]"
      />
      <span className="tnum w-[32px] text-right text-[10px] text-ink-2">{texto}</span>
    </label>
  )
}
