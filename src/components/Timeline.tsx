import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Columns2, Lock, LockOpen, Magnet, Minus, Plus, SlidersHorizontal, SquareDashedMousePointer, Volume2, X } from 'lucide-react'
import { classifyFile, isVisual } from '@shared/channels'
import { AJUSTE_DE_COR_PADRAO, SFX_GAIN_MAX, SFX_GAIN_MIN, VIDEO_FPS, duracaoDoTrecho } from '@shared/contract'
import { clipesEscolhidos, idsEscolhidos, useProject, formatTimecode } from '@/store/project'
import { alturaDaFaixa, useAlturas, useFerramenta, useIma } from '@/store/layout'
import { useShallow } from 'zustand/react/shallow'
import { dicaDoAtalho } from '@/store/atalhos'
import { carregarOnda, useOndas } from '@/store/ondas'
import { Waveform } from './Waveform'
import { caminhosDoArraste } from './arrastar'
import { CABECALHO, Cabecalho, ColunaDosCabecalhos, ControleDoClipe, GrupoDeFaixas, Linha, alinhar, type Ima } from './Faixas'
import { EditorDaEmenda, IconeDaTransicao } from './EditorDeTransicao'
import {
  aplicarNaEmenda,
  ehArrasteDeTransicao,
  lerEmenda,
  segundosDaEmenda,
  TRANSITION_LABEL,
  transicaoDoArraste,
} from '@/store/transicoes'

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
  const addSobreposicoesAt = useProject((s) => s.addSobreposicoesAt)
  const moveSobreposicao = useProject((s) => s.moveSobreposicao)
  const cortarInicioDaSobreposicao = useProject((s) => s.cortarInicioDaSobreposicao)
  const cortarFimDaSobreposicao = useProject((s) => s.cortarFimDaSobreposicao)
  const removeSobreposicao = useProject((s) => s.removeSobreposicao)
  const addTrilhasAt = useProject((s) => s.addTrilhasAt)
  const moveTrilha = useProject((s) => s.moveTrilha)
  const cortarInicioDaTrilha = useProject((s) => s.cortarInicioDaTrilha)
  const cortarFimDaTrilha = useProject((s) => s.cortarFimDaTrilha)
  const removeTrilha = useProject((s) => s.removeTrilha)

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

  /*
   * A LARGURA DO CONTEUDO, em px: a da janela menos o cabecalho das faixas,
   * vezes o zoom. Medida, e nao em porcento, porque o cabecalho fixo a
   * esquerda tira uma fatia que o porcento nao sabe descontar.
   */
  const [larguraVisivel, setLarguraVisivel] = useState(800)
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const medir = (): void => setLarguraVisivel(Math.max(scroll.clientWidth, 100))
    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [])
  const largura = larguraVisivel * zoom

  /*
   * O IMA, como o do DaVinci: arrastar e cortar clipe gruda nos CORTES DOS
   * BLOCOS, na agulha e nas bordas dos outros clipes. Ligado por padrao, e a
   * escolha fica lembrada nesta maquina.
   */
  const imaLigado = useIma((s) => s.ligado)
  const alternarIma = useIma((s) => s.alternar)
  const [linhaDoIma, setLinhaDoIma] = useState<number | null>(null)
  const trilhas = useProject((s) => s.trilhas)
  const sobreposicoes = useProject((s) => s.sobreposicoes)
  const cenasTrancadas = useProject((s) => s.cenasTrancadas)
  // As ondas finas (100 por segundo) da narracao e de cada arquivo das faixas.
  const ondas = useOndas((s) => s.ondas)
  useEffect(() => {
    if (audio?.path) carregarOnda(audio.path)
    for (const t of trilhas) carregarOnda(t.path)
  }, [audio?.path, trilhas])
  /*
   * A ALTURA DA FAIXA DE CENAS acompanha o Shift+roda e a borda do cabecalho,
   * como as outras. A tira dos blocos fica com 38 px enquanto couber; numa
   * faixa baixa ela encolhe junto e a onda fica com o resto.
   */
  const alturas = useAlturas()
  const alturaCenas = alturaDaFaixa(alturas, 'cenas')
  const alturaTira = Math.min(44, Math.round(alturaCenas * 0.5))
  const alternarTrancaDasCenas = useProject((s) => s.alternarTrancaDasCenas)
  const sfxManual = useProject((s) => s.sfxManual)
  const ima: Ima = useMemo(
    () => ({
      ligado: imaLigado,
      tolerancia: duration > 0 ? (10 / Math.max(largura, 1)) * duration : 0,
      alvos: (ignorar) => {
        // O fim do video tambem: e onde a camada de ajuste costuma terminar.
        const alvos = [0, duration, playhead, ...scenes.map((c) => c.start)]
        for (const t of trilhas) if (t.id !== ignorar) alvos.push(t.at, t.at + duracaoDoTrecho(t))
        for (const o of sobreposicoes) {
          if (o.id !== ignorar) alvos.push(o.at, o.at + (o.usarSec ?? o.durationSec - o.inicioSec))
        }
        for (const som of sfxManual) if (som.id !== ignorar) alvos.push(som.at)
        return alvos
      },
      mostrar: setLinhaDoIma,
    }),
    [imaLigado, duration, largura, playhead, scenes, trilhas, sobreposicoes, sfxManual],
  )


  const timeAt = useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track || duration === 0) return 0
      const rect = track.getBoundingClientRect()
      return ((clientX - rect.left) / rect.width) * duration
    },
    [duration],
  )

  /*
   * A EMENDA MAIS PERTO do ponteiro: 0 e o comeco do video, n o fim, e as do
   * meio os cortes. E onde o botao direito abre o editor de transicao e onde
   * a transicao arrastada cai -- clicar dentro de um bloco vale a ponta dele
   * mais proxima, entao ninguem precisa mirar no corte de 1px.
   */
  const emendaEm = useCallback(
    (clientX: number): number => {
      const t = timeAt(clientX)
      const tempos = [0, ...scenes.slice(1).map((s) => s.start), duration]
      let melhor = 0
      for (let e = 1; e < tempos.length; e++) {
        if (Math.abs(tempos[e]! - t) < Math.abs(tempos[melhor]! - t)) melhor = e
      }
      return melhor
    },
    [scenes, timeAt, duration],
  )
  const [editorDaEmenda, setEditorDaEmenda] = useState<{ emenda: number; x: number; y: number } | null>(null)
  const fecharEditorDaEmenda = useCallback(() => setEditorDaEmenda(null), [])
  const [emendaAlvo, setEmendaAlvo] = useState<number | null>(null)

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
  /*
   * A AGULHA TAMBEM GRUDA. "Deixa a agulha com snap tambem." Com o ima ligado,
   * ela cola nos cortes dos blocos, no comeco das legendas e nas bordas dos
   * clipes das faixas -- a mesma tolerancia de 10 px dos clipes. Alt solta.
   */
  const alvosDaAgulha = useMemo(() => {
    const alvos = [0, duration, ...scenes.map((c) => c.start)]
    for (const bloco of captions) alvos.push(bloco.from / VIDEO_FPS)
    for (const t of trilhas) alvos.push(t.at, t.at + duracaoDoTrecho(t))
    for (const o of sobreposicoes) alvos.push(o.at, o.at + (o.usarSec ?? o.durationSec - o.inicioSec))
    return alvos
  }, [duration, scenes, captions, trilhas, sobreposicoes])

  const levarAgulha = useCallback(
    (clientX: number, livre = false): void => {
      let seconds = timeAt(clientX)
      if (imaLigado && !livre) {
        let dist = ima.tolerancia
        let melhor: number | null = null
        for (const alvo of alvosDaAgulha) {
          const d = Math.abs(alvo - seconds)
          if (d < dist) {
            dist = d
            melhor = alvo
          }
        }
        if (melhor !== null) seconds = melhor
        setLinhaDoIma(melhor)
      }
      setPlayhead(seconds)
      const sob = scenes.findIndex((scene) => seconds >= scene.start && seconds < scene.end)
      if (sob !== -1) selectScene(sob)
    },
    [scenes, selectScene, setPlayhead, timeAt, imaLigado, ima.tolerancia, alvosDaAgulha],
  )

  /*
   * A AGULHA EM QUALQUER FAIXA. "Eu quero que a agulha funcione na timeline
   * inteira, e nao apenas nos blocos." Clicar no vazio de qualquer faixa leva a
   * agulha ate ali, e arrastar a leva junto -- ouvido na janela, para o gesto
   * nao morrer ao passar por cima de um clipe.
   */
  const arrastarAgulha = useCallback(
    (event: React.PointerEvent) => {
      if (isRendering) return
      levarAgulha(event.clientX, event.altKey)
      const mover = (e: PointerEvent): void => levarAgulha(e.clientX, e.altKey)
      const fim = (): void => {
        setLinhaDoIma(null)
        window.removeEventListener('pointermove', mover)
        window.removeEventListener('pointerup', fim)
      }
      window.addEventListener('pointermove', mover)
      window.addEventListener('pointerup', fim)
    },
    [isRendering, levarAgulha],
  )

  /*
   * O CLIQUE NO VAZIO DE UMA FAIXA depende da ferramenta. Agulha: tira a
   * selecao e leva a agulha. Selecao (V): abre o LACO -- "clicar numa area da
   * timeline vazia e arrastar para selecionar a quantidade de coisas que eu
   * quiser". Shift soma ao que ja estava escolhido.
   */
  const ferramenta = useFerramenta((s) => s.ferramenta)
  const conteudoRef = useRef<HTMLDivElement | null>(null)
  const [coluna, setColuna] = useState<HTMLDivElement | null>(null)
  const colunaInterna = useRef<HTMLDivElement | null>(null)
  const [versaoDaColuna, setVersaoDaColuna] = useState(0)
  // A coluna dos cabecalhos anda junto com a rolagem vertical das faixas.
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const seguir = (): void => {
      if (colunaInterna.current) colunaInterna.current.style.transform = `translateY(${-scroll.scrollTop}px)`
    }
    seguir()
    scroll.addEventListener('scroll', seguir, { passive: true })
    return () => scroll.removeEventListener('scroll', seguir)
  }, [])
  // Faixa nova ou excluida muda a altura: cada linha remede onde esta.
  useEffect(() => {
    const conteudo = conteudoRef.current
    if (!conteudo) return
    const observador = new ResizeObserver(() => setVersaoDaColuna((v) => v + 1))
    observador.observe(conteudo)
    return () => observador.disconnect()
  }, [])
  const [laco, setLaco] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const selecionarClipe = useProject((s) => s.selecionarClipe)
  const ajustarSobreposicao = useProject((s) => s.ajustarSobreposicao)
  const ajustarTrilha = useProject((s) => s.ajustarTrilha)
  const definirSelecaoDeClipes = useProject((s) => s.definirSelecaoDeClipes)
  const aoClicarNoVazio = useCallback(
    (event: React.PointerEvent) => {
      if (ferramenta !== 'selecao') {
        selecionarClipe(null)
        arrastarAgulha(event)
        return
      }
      const conteudo = conteudoRef.current
      if (!conteudo) return
      const antes = event.shiftKey ? clipesEscolhidos(useProject.getState()) : []
      const x0 = event.clientX
      const y0 = event.clientY
      const local = (x: number, y: number): { x: number; y: number } => {
        const r = conteudo.getBoundingClientRect()
        return { x: x - r.left, y: y - r.top }
      }
      const a = local(x0, y0)
      let andou = false
      const mover = (e: PointerEvent): void => {
        if (!andou && Math.hypot(e.clientX - x0, e.clientY - y0) < 4) return
        andou = true
        const b = local(e.clientX, e.clientY)
        setLaco({ x0: a.x, y0: a.y, x1: b.x, y1: b.y })
        const esq = Math.min(x0, e.clientX)
        const dir = Math.max(x0, e.clientX)
        const cima = Math.min(y0, e.clientY)
        const baixo = Math.max(y0, e.clientY)
        const pegos: { tipo: 'video' | 'audio'; id: string }[] = [...antes]
        for (const el of conteudo.querySelectorAll<HTMLElement>('[data-clipe]')) {
          const r = el.getBoundingClientRect()
          if (r.right < esq || r.left > dir || r.bottom < cima || r.top > baixo) continue
          const tipo = el.dataset['tipo'] === 'audio' ? 'audio' : 'video'
          const id = el.dataset['clipe'] ?? ''
          if (!pegos.some((p) => p.tipo === tipo && p.id === id)) pegos.push({ tipo, id })
        }
        definirSelecaoDeClipes(pegos)
      }
      const fim = (): void => {
        window.removeEventListener('pointermove', mover)
        window.removeEventListener('pointerup', fim)
        setLaco(null)
        // Clique sem arrastar: so limpa a selecao, como no editor.
        if (!andou && !event.shiftKey) definirSelecaoDeClipes([])
      }
      window.addEventListener('pointermove', mover)
      window.addEventListener('pointerup', fim)
    },
    [ferramenta, selecionarClipe, arrastarAgulha, definirSelecaoDeClipes],
  )

  /*
   * O BOTAO DO MEIO ARRASTA A VISTA, como no DaVinci: "clico nele, seguro e
   * arrasto pra onde eu quero". Ouvido no proprio container e parando ali: o
   * clique do meio nao chega aos clipes nem a agulha, e o auto-scroll do
   * navegador (aquela bolinha) nao aparece.
   */
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 1) return
      e.preventDefault()
      e.stopPropagation()
      const x0 = e.clientX
      const y0 = e.clientY
      const sl = scroll.scrollLeft
      const st = scroll.scrollTop
      scroll.setPointerCapture(e.pointerId)
      scroll.style.cursor = 'grabbing'
      const mover = (m: PointerEvent): void => {
        scroll.scrollLeft = sl - (m.clientX - x0)
        scroll.scrollTop = st - (m.clientY - y0)
      }
      const fim = (): void => {
        scroll.style.cursor = ''
        scroll.removeEventListener('pointermove', mover)
        scroll.removeEventListener('pointerup', fim)
        scroll.removeEventListener('pointercancel', fim)
      }
      scroll.addEventListener('pointermove', mover)
      scroll.addEventListener('pointerup', fim)
      scroll.addEventListener('pointercancel', fim)
    }
    const semAutoScroll = (e: MouseEvent): void => {
      if (e.button === 1) e.preventDefault()
    }
    scroll.addEventListener('pointerdown', onDown)
    scroll.addEventListener('mousedown', semAutoScroll)
    scroll.addEventListener('auxclick', semAutoScroll)
    return () => {
      scroll.removeEventListener('pointerdown', onDown)
      scroll.removeEventListener('mousedown', semAutoScroll)
      scroll.removeEventListener('auxclick', semAutoScroll)
    }
  }, [])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isRendering) return
      event.currentTarget.setPointerCapture(event.pointerId)
      levarAgulha(event.clientX, event.altKey)
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
      levarAgulha(event.clientX, event.altKey)
    },
    [isRendering, dragging, moveBoundary, levarAgulha, timeAt, comSnap],
  )

  const stopDragging = useCallback(() => {
    setDragging(null)
    setLinhaDoIma(null)
  }, [])

  /*
   * Com zoom, a agulha sai da vista enquanto o video toca. Trazer a faixa junto
   * -- e so quando ela realmente saiu -- evita que a timeline fique correndo
   * sob o cursor enquanto o usuario mexe em outra coisa.
   */
  useEffect(() => {
    const scroll = scrollRef.current
    const track = trackRef.current
    // So TOCANDO: parado, quem manda na vista e ele. Seguir a agulha tambem no
    // zoom fazia a vista pular para ela no meio do Alt+roda, longe do cursor.
    if (!scroll || !track || zoom === 1 || duration === 0 || !useProject.getState().playing) return
    // Logo depois de um zoom quem manda e a ancora dele (ver zoomAt).
    if (performance.now() - ultimoZoom.current < 500) return

    const x = progress * track.clientWidth
    const margem = scroll.clientWidth * 0.15
    if (x < scroll.scrollLeft + margem || x > scroll.scrollLeft + scroll.clientWidth - margem) {
      // Atribuicao direta, e nao scrollTo com behavior 'smooth': medido neste
      // Chromium, o rolar suave simplesmente nao acontece -- a chamada retorna
      // e o scrollLeft fica onde estava. Instantaneo funciona e, num playhead
      // que corre, e o que se quer de qualquer forma.
      scroll.scrollLeft = Math.max(x - scroll.clientWidth / 2, 0)
    }
  }, [progress, duration])

  /*
   * O ZOOM ANCORADO NO CURSOR, sem tremer.
   *
   * "Quando eu seguro Alt e uso scroll pra dar zoom ele ta meio lagado e
   * bugado." Eram tres coisas: o rolar da vista era acertado num
   * requestAnimationFrame que podia rodar ANTES de o React desenhar a largura
   * nova (o navegador cortava o scrollLeft e a vista pulava); cada evento da
   * roda partia do zoom do ultimo render, e nao do ultimo pedido; e o efeito de
   * seguir a agulha puxava a vista para ela. Agora o zoom pedido mora numa ref,
   * a roda junta os eventos de um quadro num pedido so, e o scrollLeft e
   * acertado num layout effect -- depois da largura nova e antes de pintar.
   */
  const zoomPedido = useRef(1)
  const ancoraDoZoom = useRef<{ fracao: number; x: number } | null>(null)
  /*
   * "A timeline comecou a tremer pra caramba do nada, quando dei ou tirei o
   * zoom." TOCANDO, cada tique da roda ancorava a vista no CURSOR, e no quadro
   * seguinte o "seguir a agulha" (mais abaixo) puxava a vista de volta para a
   * agulha -- as duas regras se revezando a cada quadro. Agora, tocando, o zoom
   * ancora na propria agulha, e o seguir espera o gesto acabar.
   */
  const ultimoZoom = useRef(0)
  const zoomAt = useCallback((next: number, clientX?: number) => {
    const scroll = scrollRef.current
    const track = trackRef.current
    let alvo = Math.min(Math.max(next, 1), MAX_ZOOM)
    // Quase 1 e 1: um zoom de 1,001 deixava a faixa um pixel mais larga que a
    // vista, e a barra de rolagem piscava.
    if (alvo < 1.003) alvo = 1
    // No teto ou no chao nada muda, e uma ancora guardada ficaria velha.
    if (Math.abs(alvo - zoomPedido.current) < 1e-6) return
    ultimoZoom.current = performance.now()
    if (scroll && track) {
      const estado = useProject.getState()
      const r = track.getBoundingClientRect()
      const naAgulha =
        estado.playing && estado.audio && estado.audio.durationSec > 0
          ? r.left + (estado.playhead / estado.audio.durationSec) * r.width
          : null
      const ancora = naAgulha ?? clientX ?? scroll.getBoundingClientRect().left + scroll.clientWidth / 2
      ancoraDoZoom.current = {
        fracao: Math.min(Math.max((ancora - r.left) / r.width, 0), 1),
        // clientLeft desconta a borda: sem ele, cada passo da roda errava 1 px,
        // e o erro crescia junto com o zoom.
        x: ancora - scroll.getBoundingClientRect().left - scroll.clientLeft,
      }
    }
    zoomPedido.current = alvo
    setZoom(alvo)
  }, [])

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const a = ancoraDoZoom.current
    ancoraDoZoom.current = null
    if (!scroll || !a) return
    scroll.scrollLeft = Math.max(0, a.fracao * largura - a.x)
  }, [largura])

  // A roda nativa, NAO passiva: so assim o preventDefault segura o rolar
  // (e o zoom da pagina no Ctrl) do navegador. Um pedido por quadro.
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    let fator = 1
    let x = 0
    let quadro = 0
    const onWheel = (event: WheelEvent): void => {
      /*
       * SHIFT+RODA muda a altura das faixas, todas de uma vez, como no
       * DaVinci/Premiere: roda para cima estica, para baixo encolhe. Sem o
       * preventDefault o navegador usaria o Shift para rolar na horizontal.
       */
      if (event.shiftKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY || event.deltaX
        useAlturas.getState().escalar(Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.0012))
        return
      }
      if (!(event.ctrlKey || event.altKey) || useProject.getState().render !== null) return
      event.preventDefault()
      const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY
      fator *= Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.0015)
      x = event.clientX
      if (quadro) return
      quadro = requestAnimationFrame(() => {
        quadro = 0
        const f = fator
        fator = 1
        zoomAt(zoomPedido.current * f, x)
      })
    }
    scroll.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      scroll.removeEventListener('wheel', onWheel)
      if (quadro) cancelAnimationFrame(quadro)
    }
  }, [zoomAt])

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
            /*
             * O BLOCO COMO CARTAO: "um design melhor e mais moderno". Um vao de
             * 1px entre os blocos (o padding), cantos redondos, borda interna
             * clara, a imagem acesa no escolhido e um degrade embaixo com o
             * numero numa pilula. Selos pequenos dizem o que nao se ve na
             * miniatura: tela dividida e transicao de entrada.
             */
            className="pointer-events-auto group/bloco relative min-w-0 px-px"
            title={image.fileName}
            aria-label={`Bloco ${index + 1}: ${image.fileName}`}
          >
            <div
              className={[
                'relative h-full overflow-hidden rounded-[5px] bg-elevated transition-shadow duration-150',
                /*
                 * A ANCORA tem anel mais grosso que os outros selecionados: com
                 * cinco marcados iguais, nada diria qual o painel esta editando.
                 */
                selecionados.includes(index)
                  ? selectedScene === index
                    ? 'ring-2 ring-inset ring-accent shadow-[0_0_12px_rgba(255,62,128,0.35)]'
                    : 'ring-2 ring-inset ring-accent/55'
                  : dropAt === index
                    ? 'ring-2 ring-inset ring-accent'
                    : 'ring-1 ring-inset ring-white/10 group-hover/bloco:ring-white/30',
              ].join(' ')}
            >
              <img
                src={image.thumbnail}
                alt=""
                className={[
                  'h-full w-full object-cover transition-opacity duration-150',
                  selecionados.includes(index) ? 'opacity-100' : 'opacity-75 group-hover/bloco:opacity-95',
                ].join(' ')}
                draggable={false}
              />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
              <span className="tnum pointer-events-none absolute bottom-0.5 left-0.5 rounded-[3px] bg-black/55 px-1 text-[9px] font-semibold leading-[13px] text-white/90">
                {index + 1}
              </span>
              <span className="pointer-events-none absolute right-0.5 bottom-0.5 flex gap-0.5">
                {scene.imageIndexB !== null && (
                  <span title="Tela dividida" className="grid size-[13px] place-items-center rounded-[3px] bg-black/55 text-white/85">
                    <Columns2 size={8} strokeWidth={2.25} className="rotate-90" />
                  </span>
                )}
              </span>
            </div>

            {/*
              O Delete no bloco selecionado ja fazia isto, mas ninguem
              descobre um atalho que a tela nao mostra. Com uma cena so
              nao aparece: nao ha para onde jogar o tempo dela, e o
              removeScene recusaria em silencio.
            */}
            {!isRendering && !cenasTrancadas && scenes.length > 1 && (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  removeScene(index)
                }}
                title="Excluir este bloco (o tempo dele vai para o bloco anterior)"
                aria-label={`Excluir o bloco ${index + 1}`}
                className="absolute right-1 top-1 grid size-[15px] place-items-center rounded-[4px] bg-black/70 text-white/80 opacity-0 transition-opacity duration-150 hover:bg-danger hover:text-white group-hover/bloco:opacity-100 focus-visible:opacity-100"
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
      cenasTrancadas,
    ],
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
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

        {/*
          OS CONTROLES DO CLIPE ESCOLHIDO moram na barra, e nao dentro da faixa:
          "quando eu der zoom eu quero que essas configuracoes de volume
          acompanhem o zoom e fiquem visiveis". Aqui eles ficam sempre a vista,
          com qualquer zoom e qualquer rolagem.
        */}
        <ControlesDoEscolhido />

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

          {duration > 0 && !isRendering && <BotaoDaFerramenta />}
          {duration > 0 && !isRendering && <BotaoDeAjuste />}
          {duration > 0 && !isRendering && (
            <button
              type="button"
              onClick={alternarIma}
              aria-pressed={imaLigado}
              title={
                imaLigado
                  ? `Ima ligado: clipes e agulha grudam nos cortes dos blocos, nas legendas e nas bordas dos clipes. Alt solta.${dicaDoAtalho('ima') ? ` (${dicaDoAtalho('ima')})` : ''}`
                  : `Ima desligado: clipes e agulha andam livres${dicaDoAtalho('ima') ? ` (${dicaDoAtalho('ima')})` : ''}`
              }
              className={[
                'grid size-[24px] place-items-center rounded-sm border',
                imaLigado ? 'border-accent bg-accent-dim text-ink' : 'border-line text-ink-3 hover:text-ink',
              ].join(' ')}
            >
              <Magnet size={13} strokeWidth={1.75} />
            </button>
          )}

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

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-line bg-surface">
      {/*
        A COLUNA DOS CABECALHOS, fora da area que rola: nada passa por baixo
        dela, nem com zoom. Ela so acompanha a rolagem VERTICAL (ver o efeito
        que copia o scrollTop), e a roda em cima dela rola as faixas.
      */}
      <div
        className="relative shrink-0 overflow-hidden border-r border-line bg-elevated"
        style={{ width: CABECALHO }}
        onWheel={(event) => {
          const scroll = scrollRef.current
          if (event.shiftKey && !event.ctrlKey && !event.altKey) {
            const delta = event.deltaY || event.deltaX
            useAlturas.getState().escalar(Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.0012))
            return
          }
          if (scroll && !event.ctrlKey && !event.altKey) scroll.scrollTop += event.deltaY
        }}
      >
        <div
          ref={(el) => {
            colunaInterna.current = el
            setColuna(el)
          }}
          className="absolute inset-x-0 top-0"
        />
      </div>
      <div
        ref={scrollRef}
        // Rola nos dois eixos: na horizontal com o zoom, na vertical quando as
        // faixas passam do teto. Ctrl+roda ou Alt+roda ampliam (ouvido numa
        // roda nao passiva, mais acima).
        className="relative min-h-0 min-w-0 flex-1 overflow-auto"
        /*
         * O VAO DA BARRA VERTICAL SEMPRE RESERVADO: a largura das faixas sai da
         * largura desta caixa, e a barra que aparece e some mudava essa largura
         * -- que mudava a horizontal, que mudava a altura, que trazia a
         * vertical de volta. Com o vao fixo a largura nao depende dela.
         */
        style={{ scrollbarGutter: 'stable' }}
      >
        <ColunaDosCabecalhos.Provider value={{ coluna, versao: versaoDaColuna }}>
        <div ref={conteudoRef} className="relative" style={{ width: largura }}>
        {/*
          Sem fixar no topo: com as faixas de video em cima das cenas, o bloco
          fixo passava de 200 px e cobria as faixas de audio numa linha do tempo
          baixa. Tudo rola junto, como no editor.
        */}
        <div style={{ width: largura }}>
        {/*
          AS FAIXAS DE VIDEO EM CIMA DAS CENAS, as de audio embaixo: "assim e
          melhor pra mexer no workflow". E a ordem do que se ve -- a faixa de
          cima cobre a de baixo, e as cenas sao o fundo de tudo.
        */}
        {duration > 0 && !isRendering && (
            <GrupoDeFaixas
              tipo="video"
              faixasMinimas={2}
              altura={40}
              largura={largura}
              duration={duration}
              timeAt={timeAt}
              ima={ima}
              clipes={sobreposicoes.map((o) => ({
                id: o.id,
                faixa: o.faixa,
                at: o.at,
                toca: o.usarSec ?? o.durationSec - o.inicioSec,
                nome: o.fileName,
                imagem: o.tipo === 'image' ? o.url : undefined,
                ajuste: o.tipo === 'ajuste',
                fadeInSec: o.fadeInSec ?? 0,
                fadeOutSec: o.fadeOutSec ?? 0,
              }))}
              aceita={(p) => {
                const t = classifyFile(p)
                return t === 'video' || t === 'image'
              }}
              onSoltar={(paths, at, faixa) => void addSobreposicoesAt(paths, at, faixa)}
              onMover={moveSobreposicao}
              onCortarInicio={cortarInicioDaSobreposicao}
              onCortarFim={cortarFimDaSobreposicao}
              onRemover={removeSobreposicao}
              onVazio={aoClicarNoVazio}
              onFade={(id, qual, seg) =>
                ajustarSobreposicao(id, qual === 'entra' ? { fadeInSec: seg } : { fadeOutSec: seg })
              }
            />
        )}
        <Linha
          largura={largura}
          altura={alturaCenas}
          onAltura={(h) => alturas.definir('cenas', h)}
          onAlturaPadrao={() => alturas.voltar('cenas')}
          cabecalho={
            <Cabecalho
              nome="Cenas"
              detalhe={cenasTrancadas ? 'trancada' : audio ? 'narracao' : undefined}
              extra={
                <button
                  type="button"
                  onClick={alternarTrancaDasCenas}
                  aria-pressed={cenasTrancadas}
                  aria-label={cenasTrancadas ? 'Destrancar a faixa de cenas' : 'Trancar a faixa de cenas'}
                  title={
                    cenasTrancadas
                      ? 'Faixa trancada: os cortes nao se mexem, o C nao corta bloco e nada entra ou sai por aqui. Clique para destrancar.'
                      : 'Trancar a faixa de cenas: protege os cortes enquanto voce mexe nas outras faixas'
                  }
                  className={[
                    'grid size-[18px] shrink-0 place-items-center rounded-[3px] border',
                    cenasTrancadas ? 'border-accent bg-accent-dim text-ink' : 'border-line text-ink-3 hover:text-ink',
                  ].join(' ')}
                >
                  {cenasTrancadas ? <Lock size={10} strokeWidth={2} /> : <LockOpen size={10} strokeWidth={2} />}
                </button>
              }
            />
          }
        >
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onContextMenu={(event) => {
            // Botao direito no corte (ou dentro do bloco): o editor da
            // transicao da emenda mais perto.
            event.preventDefault()
            if (isRendering || scenes.length === 0 || duration === 0) return
            setEditorDaEmenda({ emenda: emendaEm(event.clientX), x: event.clientX, y: event.clientY })
          }}
          onDragOver={(event) => {
            if (isRendering || scenes.length === 0) return
            event.preventDefault()
            if (ehArrasteDeTransicao(event)) {
              event.dataTransfer.dropEffect = 'copy'
              setEmendaAlvo(emendaEm(event.clientX))
              return
            }
            setDropAt(sceneAt(event.clientX))
          }}
          onDragLeave={() => {
            setDropAt(null)
            setEmendaAlvo(null)
          }}
          onDrop={(event) => {
            setDropAt(null)
            setEmendaAlvo(null)
            if (isRendering || scenes.length === 0) return
            const transicao = transicaoDoArraste(event)
            if (transicao) {
              event.preventDefault()
              event.stopPropagation()
              aplicarNaEmenda(emendaEm(event.clientX), transicao.tipo, transicao.ajuste)
              return
            }
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
          style={{ width: '100%', height: alturaCenas }}
          className={[
            // overflow-hidden aqui, e nao no pai: as alcas de arraste e o ponto
            // da agulha passam alguns pixels da borda, e sem clipar isso a
            // faixa ganhava barra de rolagem mesmo sem zoom nenhum.
            'group relative overflow-hidden',
            isRendering ? 'cursor-default' : 'cursor-ew-resize',
          ].join(' ')}
        >
          {/* A onda mora ACIMA dos blocos: inteira, e nao com a metade de baixo tapada por eles. */}
          <div className="pointer-events-none absolute inset-x-0 top-0" style={{ bottom: alturaTira }}>
            {audio ? (
              <Waveform
                peaks={ondas[audio.path]?.peaks ?? audio.peaks}
                rms={ondas[audio.path]?.rms}
                cor="rgba(255, 255, 255, 0.13)"
                corRms="rgba(255, 255, 255, 0.26)"
                className="block h-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] text-ink-3">
                Solte a narracao para ver o waveform
              </div>
            )}
          </div>

          {duration > 0 && scenes.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex pb-0.5" style={{ height: alturaTira }}>
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
            !cenasTrancadas &&
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
                  style={{ left: `${(scene.start / duration) * 100}%`, height: alturaTira }}
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
                  className="absolute bottom-0 -ml-[5px] w-[10px] cursor-col-resize"
                  aria-label={`Ajustar limite do bloco ${index + 1}`}
                >
                  {/*
                    O traco continua subindo pela altura toda -- ele so MOSTRA
                    onde o corte esta, e enxergar isso contra o waveform e o que
                    permite mirar. Sem eventos: quem pega e a caixa de baixo.
                  */}
                  <span
                    style={{ top: -(alturaCenas - alturaTira) }}
                    className={[
                      'pointer-events-none absolute bottom-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150',
                      dragging === index ? 'bg-accent' : 'bg-transparent group-hover:bg-line-strong',
                    ].join(' ')}
                  />
                </div>
              )
            })}

          {/*
            AS TRANSICOES NAS EMENDAS: uma caixa sobre o corte, da largura do
            tempo que a transicao dura (como no Premiere). Fica meio acima da
            tira dos blocos, para nao tapar a alca de arrastar o corte. Clique
            abre o editor.
          */}
          {duration > 0 &&
            !isRendering &&
            scenes.length > 0 &&
            Array.from({ length: scenes.length + 1 }, (_, e) => {
              const emenda = lerEmenda(scenes, e, duration)
              if (!emenda || emenda.tipo === 'cut') return null
              const larguraPx = Math.max(18, (segundosDaEmenda(emenda) / duration) * largura)
              const pos = (emenda.em / duration) * 100
              return (
                <button
                  key={`emenda-${e}`}
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => setEditorDaEmenda({ emenda: e, x: event.clientX, y: event.clientY })}
                  title={`${TRANSITION_LABEL[emenda.tipo]} (${segundosDaEmenda(emenda).toFixed(2)}s) -- clique para ajustar`}
                  aria-label={`Transicao ${TRANSITION_LABEL[emenda.tipo]} na emenda ${e}`}
                  className="absolute z-[3] flex h-[16px] items-center justify-center gap-0.5 overflow-hidden rounded-[4px] border border-accent/70 bg-[linear-gradient(90deg,rgba(255,62,128,0.15),rgba(255,62,128,0.55),rgba(255,62,128,0.15))] text-white shadow-[0_1px_6px_rgba(0,0,0,0.5)] backdrop-blur-[2px] transition-colors hover:border-accent hover:bg-accent/60"
                  style={{
                    left: e === scenes.length ? undefined : `${pos}%`,
                    right: e === scenes.length ? 0 : undefined,
                    width: larguraPx,
                    bottom: alturaTira - 9,
                    transform: e === 0 || e === scenes.length ? undefined : 'translateX(-50%)',
                  }}
                >
                  <IconeDaTransicao tipo={emenda.tipo} size={10} />
                </button>
              )
            })}

          {/* A emenda onde a transicao arrastada vai cair. */}
          {emendaAlvo !== null && duration > 0 && (
            <div
              className="pointer-events-none absolute inset-y-0 z-[4] w-[3px] -translate-x-1/2 rounded-full bg-accent shadow-[0_0_12px_rgba(255,62,128,0.9)]"
              style={{
                left: `${((emendaAlvo === 0 ? 0 : emendaAlvo >= scenes.length ? duration : scenes[emendaAlvo]!.start) / duration) * 100}%`,
              }}
            />
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
        </Linha>
        {editorDaEmenda && (
          <EditorDaEmenda
            emenda={editorDaEmenda.emenda}
            x={editorDaEmenda.x}
            y={editorDaEmenda.y}
            onFechar={fecharEditorDaEmenda}
          />
        )}

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
        {duration > 0 && (
          <Linha
            largura={largura}
            altura={alturaDaFaixa(alturas, 'legendas')}
            onAltura={(h) => alturas.definir('legendas', h)}
            onAlturaPadrao={() => alturas.voltar('legendas')}
            cabecalho={
              <Cabecalho nome="Legendas" detalhe={captions.length > 0 ? `${captions.length} blocos` : undefined} />
            }
          >
            <div className="h-full" onPointerDown={arrastarAgulha}>
              <FaixaLegendas duration={duration} />
            </div>
          </Linha>
        )}
        </div>

        {/*
          AS FAIXAS, no jeito do DaVinci: video em cima (V2 sobre V1), SFX, e
          as de audio embaixo. Ver Faixas.tsx.
        */}
        {duration > 0 && !isRendering && (
          <>
            <GrupoDeFaixas
              tipo="audio"
              faixasMinimas={3}
              altura={52}
              largura={largura}
              duration={duration}
              timeAt={timeAt}
              ima={ima}
              clipes={trilhas.map((t) => ({
                id: t.id,
                faixa: t.faixa,
                at: t.at,
                toca: duracaoDoTrecho(t),
                nome: t.fileName,
                // A onda fina do arquivo, quando ja chegou; ate la, a curta do projeto.
                peaks: ondas[t.path]?.peaks ?? t.peaks,
                rms: ondas[t.path]?.rms ?? t.rms,
                arquivoSec: t.durationSec,
                inicioSec: t.inicioSec,
                fadeInSec: t.fadeInSec,
                fadeOutSec: t.fadeOutSec,
              }))}
              aceita={(p) => classifyFile(p) === 'audio'}
              onSoltar={(paths, at, faixa) => void addTrilhasAt(paths, at, faixa)}
              onMover={moveTrilha}
              onCortarInicio={cortarInicioDaTrilha}
              onCortarFim={cortarFimDaTrilha}
              onRemover={removeTrilha}
              onVazio={aoClicarNoVazio}
              onFade={(id, qual, seg) =>
                ajustarTrilha(id, qual === 'entra' ? { fadeInSec: seg } : { fadeOutSec: seg })
              }
            />
          </>
        )}

        {/* A agulha, de cima a baixo, por todas as faixas. */}
        {duration > 0 && !isRendering && (
          <div
            // Abaixo dos cabecalhos (z-30): com zoom, a agulha passava POR CIMA
            // da coluna V1/A1 quando ficava atras dela.
            className="pointer-events-none absolute inset-y-0 z-[25] w-px bg-accent"
            style={{ left: progress * largura }}
          />
        )}
        {/* O laco da ferramenta de selecao. */}
        {laco && (
          <div
            className="pointer-events-none absolute z-50 border border-accent bg-accent/10"
            style={{
              left: Math.min(laco.x0, laco.x1),
              top: Math.min(laco.y0, laco.y1),
              width: Math.abs(laco.x1 - laco.x0),
              height: Math.abs(laco.y1 - laco.y0),
            }}
          />
        )}
        {/* Onde o ima grudou: uma linha de cima a baixo. */}
        {linhaDoIma !== null && duration > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 z-[26] w-px bg-[#ffd60a]"
            style={{ left: (linhaDoIma / duration) * largura }}
          />
        )}
        </div>
        </ColunaDosCabecalhos.Provider>
      </div>
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
  timeAt,
  ima,
}: {
  duration: number
  zoom: number
  timeAt: (clientX: number) => number
  ima: Ima
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
        // O SFX tambem gruda no ima: o comeco do som no corte do bloco.
        if (arrastando) {
          const { t, grudou } = alinhar(timeAt(event.clientX) - arrastando.pega, ima, arrastando.id)
          ima.mostrar(grudou ? t : null)
          moveSfx(arrastando.id, t)
        }
        if (cortandoId) {
          const som = sfxManual.find((s) => s.id === cortandoId)
          if (som) trimSfx(cortandoId, timeAt(event.clientX) - som.at)
        }
      }}
      onPointerUp={() => {
        setArrastando(null)
        setCortandoId(null)
        ima.mostrar(null)
      }}
      onPointerLeave={() => {
        setArrastando(null)
        setCortandoId(null)
        ima.mostrar(null)
      }}
      style={{ width: '100%' }}
      className={[
        'relative h-full',
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
function FaixaLegendas({ duration }: { duration: number }) {
  const captions = useProject((s) => s.captions)
  const captionsEnabled = useProject((s) => s.captionsEnabled)
  const playhead = useProject((s) => s.playhead)
  const openCaptions = useProject((s) => s.openCaptions)
  const visivel = captionsEnabled && captions.length > 0 && duration > 0

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
    // A faixa so existe com legenda: medir de novo quando ela aparece.
  }, [visivel])

  /*
   * AS PILULAS (v1.61, "melhora a aparencia daquilo"): cada legenda vira uma
   * pilula arredondada com respiro dos dois lados, o texto aparece cortado com
   * reticencias assim que houver ~3 letras de espaco (antes era tudo ou nada),
   * e tracinhos marcam onde cada palavra entra -- o ritmo da fala dentro do
   * bloco. Feitas uma vez por mudanca de legenda ou de zoom; a agulha so move
   * o destaque, que e uma pilula a parte por cima.
   */
  const pilulas = useMemo(() => {
    if (duration === 0) return null
    return captions.map((bloco, i) => {
      const inicio = bloco.from / VIDEO_FPS
      const fim = (bloco.from + bloco.durationInFrames) / VIDEO_FPS
      const larguraDaBarra = ((fim - inicio) / duration) * largura
      const texto = bloco.words.map((w) => w.text).join(' ')
      // Texto so quando cabe ao menos a primeira palavra inteira: "P..." e
      // "a.." poluiam mais do que diziam.
      const cabe = larguraDaBarra >= (bloco.words[0]?.text.length ?? 0) * 6 + 16
      return (
        <div
          key={`legenda-${bloco.from}-${i}`}
          className="absolute inset-y-[3px] px-px"
          style={{ left: `${(inicio / duration) * 100}%`, width: `${((fim - inicio) / duration) * 100}%` }}
          title={texto}
          onDoubleClick={() => openCaptions(true)}
        >
          <div className="relative flex h-full items-center overflow-hidden rounded-[4px] border border-white/[0.07] bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.04))] transition-colors hover:border-white/25">
            {cabe && (
              <span className="truncate px-1.5 text-[10px] font-medium leading-none text-ink-2">{texto}</span>
            )}
            {larguraDaBarra > 40 &&
              bloco.words.slice(1).map((w, k) => (
                <span
                  key={k}
                  className="pointer-events-none absolute bottom-0 h-[3px] w-px bg-white/25"
                  style={{ left: `${((w.from - bloco.from) / bloco.durationInFrames) * 100}%` }}
                />
              ))}
          </div>
        </div>
      )
    })
  }, [captions, duration, largura, openCaptions])

  if (!visivel) return null

  const frame = playhead * VIDEO_FPS
  const atual = captions.find((c) => frame >= c.from && frame < c.from + c.durationInFrames)

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
      style={{ width: '100%' }}
      className="relative h-full overflow-hidden bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,0.018)_6px_7px)]"
      title="Dois cliques numa legenda abrem o editor de legendas"
    >
      {pilulas}
      {atual && (
        <div
          className="pointer-events-none absolute inset-y-[2px] px-px"
          style={{
            left: `${(atual.from / VIDEO_FPS / duration) * 100}%`,
            width: `${(atual.durationInFrames / VIDEO_FPS / duration) * 100}%`,
          }}
        >
          <div className="flex h-full items-center overflow-hidden rounded-[4px] border border-accent bg-accent shadow-[0_0_10px_rgba(255,62,128,0.55)]">
            {(atual.durationInFrames / VIDEO_FPS / duration) * largura >= (atual.words[0]?.text.length ?? 0) * 6 + 16 && (
              <span className="truncate px-1.5 text-[10px] font-semibold leading-none text-white">
                {atual.words.map((w) => w.text).join(' ')}
              </span>
            )}
          </div>
        </div>
      )}
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


/** Volume e fades do trecho de audio escolhido. */
function ControlesDaTrilha({ id }: { id: string }) {
  const t = useProject((s) => s.trilhas.find((x) => x.id === id))
  const ajustarUm = useProject((s) => s.ajustarTrilha)
  // Com varios escolhidos, o controle vale para TODOS: "selecionar 2 ou mais
  // audios para configura-los juntos (volume e etc.)". Mostra o valor do principal.
  const alvos = useProject(useShallow((s) => idsEscolhidos(s, 'audio')))
  const ajustar = (_id: string, patch: Parameters<typeof ajustarUm>[1]): void => {
    for (const alvo of alvos.length > 0 ? alvos : [id]) ajustarUm(alvo, patch)
  }
  if (!t) return null
  return (
    <>
      <span className="max-w-[90px] truncate text-[10px] text-ink-3">
        {alvos.length > 1 ? `${alvos.length} audios` : t.fileName}
      </span>
      <ControleDoClipe rotulo="vol" titulo="Volume" valor={t.gainDb} min={-40} max={12} passo={1} padrao={0}
        texto={`${t.gainDb > 0 ? '+' : ''}${t.gainDb} dB`} onChange={(v) => ajustar(id, { gainDb: v })} />
      {/* Os volumes de sempre num clique; o slider continua para o resto. */}
      <div className="flex items-center gap-0.5">
        {[-3, -5, -10, -15, -20, -25].map((db) => (
          <button
            key={db}
            type="button"
            onClick={() => ajustar(id, { gainDb: db })}
            title={`Volume em ${db} dB`}
            className={[
              'tnum h-[18px] rounded-[3px] border px-1 text-[10px]',
              t.gainDb === db ? 'border-accent bg-accent-dim text-ink' : 'border-line text-ink-3 hover:text-ink',
            ].join(' ')}
          >
            {db}
          </button>
        ))}
      </div>
      <ControleDoClipe rotulo="entra" titulo="Fade de entrada" valor={t.fadeInSec} min={0} max={Math.max(0.1, Math.round(duracaoDoTrecho(t) * 10) / 10)} passo={0.1} padrao={0}
        texto={`${t.fadeInSec.toFixed(1)}s`} onChange={(v) => ajustar(id, { fadeInSec: v })} />
      <ControleDoClipe rotulo="sai" titulo="Fade de saida" valor={t.fadeOutSec} min={0} max={Math.max(0.1, Math.round(duracaoDoTrecho(t) * 10) / 10)} passo={0.1} padrao={0}
        texto={`${t.fadeOutSec.toFixed(1)}s`} onChange={(v) => ajustar(id, { fadeOutSec: v })} />
    </>
  )
}

/** Posicao, escala e opacidade da sobreposicao escolhida. */
function ControlesDaSobreposicao({ id }: { id: string }) {
  const o = useProject((s) => s.sobreposicoes.find((x) => x.id === id))
  const ajustarUm = useProject((s) => s.ajustarSobreposicao)
  const sobreposicoes = useProject((s) => s.sobreposicoes)
  const escolhidos = useProject(useShallow((s) => idsEscolhidos(s, 'video')))
  if (!o) return null
  // Os alvos sao os escolhidos do MESMO tipo do principal: mexer na posicao
  // de uma seta nao deve empurrar uma camada de ajuste junto.
  const alvos = escolhidos.filter((x) => (sobreposicoes.find((y) => y.id === x)?.tipo === 'ajuste') === (o.tipo === 'ajuste'))
  const ajustar = (_id: string, patch: Parameters<typeof ajustarUm>[1]): void => {
    for (const alvo of alvos.length > 0 ? alvos : [id]) ajustarUm(alvo, patch)
  }
  const fades = (
    <>
      <ControleDoClipe rotulo="entra" titulo="Fade de entrada" valor={o.fadeInSec ?? 0} min={0} max={Math.max(0.1, Math.round((o.usarSec ?? o.durationSec - o.inicioSec) * 10) / 10)} passo={0.1} padrao={0}
        texto={`${(o.fadeInSec ?? 0).toFixed(1)}s`} onChange={(v) => ajustar(id, { fadeInSec: v })} />
      <ControleDoClipe rotulo="sai" titulo="Fade de saida" valor={o.fadeOutSec ?? 0} min={0} max={Math.max(0.1, Math.round((o.usarSec ?? o.durationSec - o.inicioSec) * 10) / 10)} passo={0.1} padrao={0}
        texto={`${(o.fadeOutSec ?? 0).toFixed(1)}s`} onChange={(v) => ajustar(id, { fadeOutSec: v })} />
    </>
  )
  if (o.tipo === 'ajuste') {
    const cor = o.cor ?? AJUSTE_DE_COR_PADRAO
    return (
      <>
        <span className="max-w-[110px] truncate text-[10px] text-ink-3">
          {alvos.length > 1 ? `${alvos.length} camadas` : 'Camada de ajuste'}
        </span>
        <ControleDoClipe rotulo="intens" titulo="Quanto do ajuste vale" valor={cor.intensidade} min={0} max={1}
          passo={0.05} padrao={1} texto={`${Math.round(cor.intensidade * 100)}%`}
          onChange={(v) => {
            for (const alvo of alvos.length > 0 ? alvos : [id]) {
              const c = sobreposicoes.find((y) => y.id === alvo)?.cor ?? AJUSTE_DE_COR_PADRAO
              ajustarUm(alvo, { cor: { ...c, intensidade: v } })
            }
          }} />
        {fades}
      </>
    )
  }
  return (
    <>
      <span className="max-w-[80px] truncate text-[10px] text-ink-3">
        {alvos.length > 1 ? `${alvos.length} clipes` : o.fileName}
      </span>
      <ControleDoClipe rotulo="x" titulo="Posicao horizontal" valor={o.x} min={-60} max={60} passo={1} padrao={0}
        texto={`${Math.round(o.x)}%`} onChange={(v) => ajustar(id, { x: v })} />
      <ControleDoClipe rotulo="y" titulo="Posicao vertical" valor={o.y} min={-60} max={60} passo={1} padrao={0}
        texto={`${Math.round(o.y)}%`} onChange={(v) => ajustar(id, { y: v })} />
      <ControleDoClipe rotulo="tam" titulo="Escala" valor={o.escala} min={0.1} max={3} passo={0.05} padrao={1}
        texto={`${Math.round(o.escala * 100)}%`} onChange={(v) => ajustar(id, { escala: v })} />
      <ControleDoClipe rotulo="rot" titulo="Rotacao" valor={o.rotacao} min={-180} max={180} passo={1} padrao={0}
        texto={`${Math.round(o.rotacao)}°`} onChange={(v) => ajustar(id, { rotacao: v })} />
      <ControleDoClipe rotulo="opac" titulo="Opacidade" valor={o.opacidade} min={0} max={1} passo={0.05} padrao={1}
        texto={`${Math.round(o.opacidade * 100)}%`} onChange={(v) => ajustar(id, { opacidade: v })} />
      {fades}
    </>
  )
}

/** O painel do clipe escolhido, na barra da linha do tempo. */
function ControlesDoEscolhido() {
  const escolhido = useProject((s) => s.clipeSelecionado)
  const selecionar = useProject((s) => s.selecionarClipe)
  if (!escolhido) return null
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-sm border border-line bg-surface px-2 py-0.5">
      {escolhido.tipo === 'audio' ? (
        <ControlesDaTrilha id={escolhido.id} />
      ) : (
        <ControlesDaSobreposicao id={escolhido.id} />
      )}
      <button
        type="button"
        onClick={() => selecionar(null)}
        aria-label="Fechar os controles do clipe"
        className="text-ink-3 hover:text-ink"
      >
        <X size={9} strokeWidth={2} />
      </button>
    </div>
  )
}

/**
 * A CAMADA DE AJUSTE, no clique: entra na agulha, cobrindo o bloco dela, na
 * faixa de video mais baixa que estiver livre ali -- e de la ela corrige tudo o
 * que estiver embaixo. Arrastar para outra faixa muda o que ela pega.
 */
function BotaoDeAjuste() {
  const add = useProject((s) => s.addCamadaDeAjuste)
  return (
    <button
      type="button"
      onClick={() => {
        const { sobreposicoes, playhead, plan } = useProject.getState()
        const bloco = plan?.scenes.find((c) => playhead >= c.start && playhead < c.end)
        const at = bloco ? bloco.start : playhead
        const fim = bloco ? bloco.end : playhead + 5
        let faixa = 0
        while (
          sobreposicoes.some(
            (o) => o.faixa === faixa && at < o.at + (o.usarSec ?? o.durationSec - o.inicioSec) - 1e-6 && fim > o.at + 1e-6,
          )
        )
          faixa += 1
        add(faixa)
      }}
      title="Camada de ajuste: correcao de cor (curvas, exposicao, contraste, saturacao...) de tudo o que estiver embaixo dela"
      className="flex h-[24px] items-center gap-1.5 rounded-sm border border-line px-2 text-[11px] text-ink-3 hover:text-ink"
    >
      <SlidersHorizontal size={12} strokeWidth={1.5} />
      Ajuste
    </button>
  )
}

/**
 * A FERRAMENTA DE SELECAO (V), como no DaVinci: ligada, clicar e arrastar no
 * vazio das faixas abre um laco que escolhe os clipes que tocar. Desligada, o
 * mesmo gesto leva a agulha.
 */
function BotaoDaFerramenta() {
  const ferramenta = useFerramenta((s) => s.ferramenta)
  const alternar = useFerramenta((s) => s.alternar)
  const dica = dicaDoAtalho('ferramentaSelecao')
  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={ferramenta === 'selecao'}
      title={
        ferramenta === 'selecao'
          ? `Ferramenta de selecao: arraste no vazio das faixas para escolher varios clipes${dica ? ` (${dica})` : ''}`
          : `Ferramenta de selecao${dica ? ` (${dica})` : ''}: arrastar no vazio escolhe varios clipes`
      }
      className={[
        'flex h-[24px] items-center gap-1.5 rounded-sm border px-2 text-[11px]',
        ferramenta === 'selecao' ? 'border-accent bg-accent-dim text-ink' : 'border-line text-ink-3 hover:text-ink',
      ].join(' ')}
    >
      <SquareDashedMousePointer size={12} strokeWidth={1.5} />
      Selecao
    </button>
  )
}
