import { useEffect, useMemo, useRef, useState } from 'react'
import { Film, ImagePlus, Library as LibraryIcon, LocateFixed, Pause, Play, RefreshCcw, Scissors } from 'lucide-react'
import { isVisual, type TiraDaCena } from '@shared/channels'
import { VIDEO_FPS, type ImageAsset, type Scene } from '@shared/contract'
import { useProject, formatTimecode } from '@/store/project'
import { Chip, Field } from './painel'

/**
 * A coluna estreita: QUAL CENA e esta, e de onde ela parte.
 *
 * Trocar por outra, buscar na biblioteca, o ponto de entrada do clipe, inserir
 * imagem em volta. O que o bloco FAZ -- enquadramento, giro, movimento, curva,
 * transicao -- mora no painel largo do meio, em SceneEdit.
 *
 * A divisao e dele, depois de montar um video inteiro rolando esta coluna:
 * "ficar scrollando e ruim pq eu acabo confundindo sliders de intensidade com
 * trecho do clipe". Os dois sliders passaram a viver em telas diferentes.
 */
/**
 * As outras cinco cenas que serviam neste bloco.
 *
 * So aparece no projeto que veio da montagem automatica -- e ali ela e o que
 * torna a proposta revisavel. Sem a fita, discordar de uma escolha voltaria a
 * ser uma busca na biblioteca inteira, e revisar 20 blocos assim custa mais que
 * ter montado na mao.
 *
 * A razao aparece escrita ("Kisuke Urahara, so ele em cena, cobre o bloco")
 * porque ele precisa saber se confia: um motivo fraco e o aviso de que este e
 * um bloco para olhar com atencao.
 */
function Fita({ index }: { index: number }) {
  const blocos = useProject((s) => s.automountBlocks)
  const swapCandidate = useProject((s) => s.swapCandidate)
  const busy = useProject((s) => s.busy)

  if (!blocos) return null

  /*
   * O indice na TIMELINE nao e o indice no roteiro: bloco que ficou sem cena
   * nao virou imagem. Andar pelos blocos uteis e o que liga os dois.
   */
  let restante = index
  const bloco = blocos.find((b) => b.candidates.length > 0 && restante-- === 0)
  const posicao = blocos.indexOf(bloco!)
  if (!bloco || bloco.candidates.length < 2) return null

  return (
    <Field label={`Trocar a cena (${bloco.candidates.length - 1} opcoes)`}>
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] leading-relaxed text-ink-3">{bloco.candidates[0]!.reason}</p>
        <div className="flex flex-wrap gap-1">
          {bloco.candidates.slice(1).map((candidato, i) => (
            <button
              key={candidato.path}
              type="button"
              disabled={busy !== null}
              onClick={() => void swapCandidate(posicao, i + 1)}
              title={`${candidato.label} -- ${candidato.reason}`}
              className="overflow-hidden rounded-sm border border-line transition-colors duration-150 hover:border-accent disabled:opacity-40"
            >
              <img src={candidato.thumbUrl} alt={candidato.label} className="h-[38px] w-[68px] object-cover" />
            </button>
          ))}
        </div>
      </div>
    </Field>
  )
}

export function SceneCard() {
  const images = useProject((s) => s.images)
  const plan = useProject((s) => s.plan)
  const index = useProject((s) => s.selectedScene)
  const updateScene = useProject((s) => s.updateScene)
  const applyCurveToAll = useProject((s) => s.applyCurveToAll)
  const insertImages = useProject((s) => s.insertImages)
  const abrirBiblioteca = useProject((s) => s.openLibraryToReplace)
  const mostrarNaBiblioteca = useProject((s) => s.mostrarNaBiblioteca)
  // So clipe que veio da biblioteca tem lugar nela para onde ir.
  const library = useProject((s) => s.library)
  const caminhosDaBiblioteca = useMemo(() => new Set((library?.clips ?? []).map((c) => c.path)), [library])
  const naBiblioteca = (p: string | undefined): boolean => p !== undefined && caminhosDaBiblioteca.has(p)

  const scene = index === null ? undefined : plan?.scenes[index]
  const image = scene ? images[scene.imageIndex] : undefined
  const imageB =
    scene && scene.imageIndexB !== null ? images[scene.imageIndexB] : undefined

  if (index === null || !scene || !image) return null

  const total = plan?.scenes.length ?? 0

  // O botao de aplicar em todos so aparece quando ha o que aplicar -- se o
  // video inteiro ja usa esta curva, ele nao faria nada.
  // Compara o DESENHO junto: com a curva na mao, "todos iguais" so e verdade se
  // os quatro numeros baterem -- senao o botao sumiria com o desenho por
  // espalhar, so porque o preset por baixo coincidia.
  const mesmaCurvaEmTodas =
    plan?.scenes.every(
      (s) =>
        s.curve === scene.curve &&
        JSON.stringify(s.curvePoints ?? null) === JSON.stringify(scene.curvePoints ?? null),
    ) ?? true

  const inserir = async (seconds: number): Promise<void> => {
    const picked = await window.dangai.pickFiles()
    if (!picked.ok) return
    const imagens = picked.value.filter((path) => isVisual(path))
    if (imagens.length > 0) await insertImages(imagens, seconds)
  }

  return (
    <aside className="enter flex w-full min-w-0 flex-col gap-5 overflow-y-auto pr-1">
      <header className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink">
          Bloco {index + 1} <span className="text-ink-3">de {total}</span>
        </span>
        <span className="tnum text-[11px] text-ink-3">
          {(scene.end - scene.start).toFixed(1)}s
        </span>
      </header>

      <Fita index={index} />

      <PontoDeEntrada
        index={index}
        scene={scene}
        image={image}
        label={imageB ? 'Trecho do clipe de cima' : 'Trecho do clipe'}
      />

      {image.kind === 'video' && <Inverter index={index} metade="cima" invertido={image.invertido === true} />}

      <Field label={imageB ? 'Trocar a cena de cima' : 'Trocar por outra cena'}>
        {/*
          A fita resolve o caso comum -- discordar e pegar outra das seis. Esta
          porta e para o caso MUITO especifico, quando ele sabe exatamente qual
          cena quer e ela nao esta entre as seis. Fica fora da Fita de proposito:
          vale para qualquer bloco, inclusive nos projetos que nao vieram da
          montagem automatica.
        */}
        <Chip active={false} onClick={() => void abrirBiblioteca(index, 'cima')}>
          <LibraryIcon size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
          Buscar na biblioteca
        </Chip>
        {naBiblioteca(image.path) && (
          <Chip active={false} onClick={() => void mostrarNaBiblioteca(image.path)}>
            <LocateFixed size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            Ver este clipe na biblioteca
          </Chip>
        )}
      </Field>

      {/*
        A METADE DE BAIXO, com os mesmos controles da de cima.

        Fica logo abaixo dela e nao numa aba separada: as duas cenas estao na
        tela ao mesmo tempo, e escolher uma olhando a outra e o que o bloco
        dividido pede. O enquadramento e o movimento das duas ja moram no painel
        do meio, entao aqui fica o que faltava -- de onde o clipe parte e qual
        cena e.
      */}
      {imageB && (
        <>
          <PontoDeEntrada
            index={index}
            scene={scene}
            image={imageB}
            campo="sourceStartB"
            label="Trecho do clipe de baixo"
          />

          {imageB.kind === 'video' && (
            <Inverter index={index} metade="baixo" invertido={imageB.invertido === true} />
          )}

          <Field label="Trocar a cena de baixo">
            <Chip active={false} onClick={() => void abrirBiblioteca(index, 'baixo')}>
              <LibraryIcon size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
              Buscar na biblioteca
            </Chip>
            {naBiblioteca(imageB.path) && (
              <Chip active={false} onClick={() => void mostrarNaBiblioteca(imageB.path)}>
                <LocateFixed size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
                Ver este clipe na biblioteca
              </Chip>
            )}
            <p className="flex items-baseline gap-1.5 text-[11px] leading-relaxed text-ink-3">
              {imageB.kind === 'video' && (
                <span className="flex items-center gap-1 text-accent">
                  <Film size={11} strokeWidth={1.5} />
                  clipe
                </span>
              )}
              <span className="min-w-0 truncate">{imageB.fileName}</span>
            </p>
          </Field>
        </>
      )}

      <Field label="Entra em">
        <span className="tnum text-[13px] text-ink-2">{formatTimecode(scene.start)}</span>
      </Field>

      <Field label="Inserir imagem">
        <div className="flex flex-col gap-1.5">
          <Chip active={false} onClick={() => void inserir(scene.start)}>
            <ImagePlus size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            Antes deste bloco
          </Chip>
          <Chip active={false} onClick={() => void inserir((scene.start + scene.end) / 2)}>
            <Scissors size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            No meio, cortando ao meio
          </Chip>
          <Chip active={false} onClick={() => void inserir(scene.end)}>
            <ImagePlus size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            Depois deste bloco
          </Chip>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-3">
          O tempo sai deste bloco, entao o resto da linha do tempo nao se mexe. Arrastar imagens
          direto na timeline faz o mesmo.
        </p>
      </Field>

      <p className="flex items-baseline gap-1.5 text-[11px] leading-relaxed text-ink-3">
        {/* Miniatura de clipe e miniatura de print sao a mesma coisa na tela.
            Sem esta marca nao da para saber qual bloco e qual. */}
        {image.kind === 'video' && (
          <span className="flex items-center gap-1 text-accent">
            <Film size={11} strokeWidth={1.5} />
            clipe
          </span>
        )}
        <span className="min-w-0 truncate">{image.fileName}</span>
      </p>
    </aside>
  )
}

/**
 * De que ponto do clipe este bloco parte.
 *
 * O clipe chega cortado do AnCut, mas o bloco quase nunca tem a duracao dele:
 * uma cena de 6 segundos num bloco de 2 mostrava sempre os dois PRIMEIROS
 * segundos. Palavras dele: "a parte q eu quero e la pro final ou no meio, por
 * padrao ele ta so no inicio certo?". Antes disso a unica saida era procurar
 * outra cena.
 *
 * O SLIDER VARRE O CLIPE INTEIRO, e nao so a parte que cabe no bloco.
 *
 * Ate aqui ele ia de zero ate `duracao do clipe - duracao do bloco`, para
 * garantir que o bloco nunca ficasse sem imagem. A intencao era boa e o
 * resultado, medido no projeto dele (Mushoku S03E13, 37 cenas), era outro:
 *
 *   cena 3   bloco 1,03s   clipe 1,31s   o slider alcancava 22% do clipe
 *   cena 4   bloco 0,84s   clipe 4,50s   alcancava 81%
 *   cena 1   bloco 1,11s   clipe 0,81s   NAO APARECIA
 *
 * Os clipes do AnCut sao curtos -- 0,65s a 4,5s neste episodio -- entao o
 * quanto do clipe dava para alcancar mudava de cena para cena sem nada
 * explicar, e em 2 de 12 cenas o controle sumia. Palavras dele: "o slider nao
 * condiz com o clipe inteiro". Nao condizia mesmo.
 *
 * Agora ele alcanca o clipe todo. Passar do ponto em que o bloco deixa de ser
 * coberto nao quebra nada -- o render ja congela o ultimo frame nesse caso, e
 * sempre congelou. O que faltava era DIZER: o rodape avisa quantos segundos
 * congelam, e o aviso aparece tambem quando o clipe ja e mais curto que o
 * bloco, que antes congelava calado.
 *
 * Serve as DUAS metades da tela dividida. Ate a v1.27 a de baixo partia sempre
 * do zero e nao tinha controle nenhum -- "eu tenho um acesso muito limitado a
 * cena debaixo". Numa tela dividida as duas dividem a atencao por igual, e nao
 * ha motivo para uma ter menos controle que a outra.
 */
function PontoDeEntrada({
  index,
  scene,
  image,
  campo = 'sourceStart',
  label = 'Trecho do clipe',
}: {
  index: number
  scene: Scene
  image: ImageAsset
  campo?: 'sourceStart' | 'sourceStartB'
  label?: string
}) {
  const updateScene = useProject((s) => s.updateScene)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const definirTrechoAoVivo = useProject((s) => s.definirTrechoAoVivo)
  const ultimoAoVivo = useRef(0)
  const pendenteAoVivo = useRef<number | null>(null)
  const quadroRef = useRef<HTMLVideoElement | null>(null)
  const trilhoRef = useRef<HTMLDivElement | null>(null)
  const [larguraDoTrilho, setLarguraDoTrilho] = useState(0)
  const [tira, setTira] = useState<TiraDaCena | null>(null)
  /** O ponto de entrada enquanto ele arrasta -- so vai para o bloco ao soltar. */
  const [rascunho, setRascunho] = useState<number | null>(null)
  const [tocando, setTocando] = useState(false)

  const bloco = scene.end - scene.start
  const total = image.durationSec ?? 0
  /*
   * Ate onde o ponto de entrada pode ir: o clipe inteiro menos um frame.
   *
   * Um frame, e nao zero: comecar exatamente no fim deixaria o bloco sem
   * imagem nenhuma para congelar.
   */
  const ultimo = Math.max(total - 1 / VIDEO_FPS, 0)
  const salvo = Math.min(scene[campo] ?? 0, ultimo)
  const inicio = rascunho ?? salvo
  /** Quanto do bloco fica sem clipe, e portanto com a imagem parada no ultimo frame. */
  const parada = Math.max(inicio + bloco - total, 0)
  // A tira do clipe que o bloco TOCA (o invertido, se estiver invertido).
  const fonte = image.invertido && image.caminhoInvertido ? image.caminhoInvertido : image.path

  useEffect(() => {
    if (image.kind !== 'video') return
    let vivo = true
    void window.dangai.libraryClipStrip(fonte).then((r) => {
      if (vivo && r.ok) setTira(r.value)
    })
    return () => {
      vivo = false
    }
  }, [fonte, image.kind])

  useEffect(() => {
    const alvo = trilhoRef.current
    if (!alvo) return
    const medir = (): void => setLarguraDoTrilho(alvo.clientWidth)
    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(alvo)
    return () => observer.disconnect()
  }, [image.kind])

  /*
   * O VISOR SEGUE O PONTO SEM FILA. Atribuir currentTime a cada pixel do
   * arraste empilhava buscas, e o visor "ficava travando" no meio delas. Aqui
   * so se pede a proxima quando a anterior termina, sempre para o ponto MAIS
   * RECENTE -- o visor pula os intermediarios em vez de percorre-los.
   */
  const pedido = useRef<number | null>(null)
  const buscando = useRef(false)
  const buscar = (t: number): void => {
    const v = quadroRef.current
    if (!v) return
    pedido.current = t
    if (buscando.current) return
    buscando.current = true
    v.currentTime = t
  }
  const aoBuscar = (): void => {
    buscando.current = false
    const v = quadroRef.current
    if (v && pedido.current !== null && Math.abs(v.currentTime - pedido.current) > 0.02) buscar(pedido.current)
  }
  useEffect(() => {
    if (rascunho === null && !tocando) buscar(salvo)
    // So quando o ponto SALVO muda (outro bloco, desfazer).
  }, [salvo])

  // ▶: toca so o trecho do bloco no visor, em loop.
  useEffect(() => {
    const v = quadroRef.current
    if (!v) return
    if (!tocando) {
      v.pause()
      return
    }
    v.currentTime = inicio
    void v.play().catch(() => setTocando(false))
    const fim = Math.min(inicio + bloco, total)
    let quadro = 0
    const vigiar = (): void => {
      if (v.currentTime >= fim - 0.02) v.currentTime = inicio
      quadro = requestAnimationFrame(vigiar)
    }
    quadro = requestAnimationFrame(vigiar)
    return () => {
      cancelAnimationFrame(quadro)
      v.pause()
    }
  }, [tocando, inicio, bloco, total])

  if (image.kind !== 'video' || ultimo <= 0.05) return null

  const aoTempo = (clientX: number): number => {
    const r = trilhoRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return 0
    return ((clientX - r.left) / r.width) * total
  }
  const prender = (t: number): number => Math.min(Math.max(t, 0), ultimo)
  const confirmar = (t: number): void => {
    setRascunho(null)
    updateScene(index, { [campo]: Math.round(t * 1000) / 1000 })
    definirTrechoAoVivo(null)
    // O preview vai para o comeco do bloco: e ali que o ponto novo se ve.
    setPlayhead(scene.start)
  }

  /*
   * ARRASTAR A JANELA (ou clicar fora dela para leva-la ate ali).
   *
   * O PREVIEW ACOMPANHA, mas sem gravar nada no bloco ate soltar: o ponto do
   * dedo vai para um valor temporario que so o preview le (trechoAoVivo), no
   * maximo ~12 vezes por segundo, com a agulha parada no comeco do bloco -- o
   * quadro que aparece e exatamente onde o bloco vai comecar. Gravar no bloco
   * a cada pixel (historico, autosave) e levar a agulha junto era o que fazia
   * "bugar tudo na preview".
   */
  const mandarAoVivo = (t: number): void => {
    pendenteAoVivo.current = t
    const agora = performance.now()
    const espera = 80 - (agora - ultimoAoVivo.current)
    const enviar = (): void => {
      if (pendenteAoVivo.current === null) return
      ultimoAoVivo.current = performance.now()
      definirTrechoAoVivo({ index, campo, valor: pendenteAoVivo.current })
      pendenteAoVivo.current = null
    }
    if (espera <= 0) enviar()
    else setTimeout(enviar, espera)
  }
  const comecar = (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    setTocando(false)
    // Um quadro dentro do bloco: no corte exato a emenda ainda pode estar na tela.
    setPlayhead(scene.start + Math.min(1 / VIDEO_FPS, bloco / 2))
    const t0 = aoTempo(event.clientX)
    const dentro = t0 >= inicio && t0 <= inicio + Math.min(bloco, total)
    const pega = dentro ? t0 - inicio : Math.min(bloco, total) / 2
    let atual = prender(t0 - pega)
    setRascunho(atual)
    buscar(atual)
    mandarAoVivo(atual)
    const mover = (e: PointerEvent): void => {
      atual = prender(aoTempo(e.clientX) - pega)
      setRascunho(atual)
      buscar(atual)
      mandarAoVivo(atual)
    }
    const soltar = (): void => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', soltar)
      pendenteAoVivo.current = null
      confirmar(atual)
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', soltar)
  }

  /*
   * A TIRA: quadros do clipe inteiro, lado a lado, cada um no instante do
   * meio do pedaco que ocupa -- entao a posicao na tira e a posicao no clipe.
   */
  const QUADRO_W = 52
  const nQuadros = tira && larguraDoTrilho > 0 ? Math.max(1, Math.ceil(larguraDoTrilho / QUADRO_W)) : 0
  const posicaoNaTira = (k: number): string => {
    if (!tira) return '0 0'
    const x = tira.colunas > 1 ? ((k % tira.colunas) / (tira.colunas - 1)) * 100 : 0
    const y = tira.linhas > 1 ? (Math.floor(k / tira.colunas) / (tira.linhas - 1)) * 100 : 0
    return `${x}% ${y}%`
  }
  const esq = (inicio / total) * 100
  const larg = (Math.min(bloco, total - inicio) / total) * 100

  return (
    <Field label={label}>
      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <video
            ref={quadroRef}
            src={image.url}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={() => buscar(inicio)}
            onSeeked={aoBuscar}
            className="h-[104px] w-full rounded-sm border border-line bg-black object-contain"
          />
          <button
            type="button"
            onClick={() => setTocando((v) => !v)}
            title={tocando ? 'Parar' : 'Tocar so este trecho, em loop'}
            aria-label={tocando ? 'Parar o trecho' : 'Tocar o trecho'}
            className="absolute bottom-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-black/70 text-white hover:bg-accent"
          >
            {tocando ? <Pause size={11} strokeWidth={2.25} /> : <Play size={11} strokeWidth={2.25} className="ml-px" />}
          </button>
        </div>

        <div
          ref={trilhoRef}
          role="slider"
          tabIndex={0}
          aria-label="De que ponto do clipe este bloco comeca"
          aria-valuemin={0}
          aria-valuemax={ultimo}
          aria-valuenow={inicio}
          onPointerDown={comecar}
          onKeyDown={(event) => {
            // Setas: um quadro; com Shift, dez.
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            event.stopPropagation()
            const passo = (event.shiftKey ? 10 : 1) / VIDEO_FPS
            confirmar(prender(salvo + (event.key === 'ArrowRight' ? passo : -passo)))
          }}
          title="Arraste a janela (ou clique na tira) para escolher o trecho do clipe que o bloco mostra. Setas: 1 quadro."
          className="relative h-[40px] w-full cursor-grab touch-none select-none overflow-hidden rounded-sm border border-line bg-elevated focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent active:cursor-grabbing"
        >
          {tira &&
            Array.from({ length: nQuadros }, (_, i) => {
              const meio = ((i + 0.5) * QUADRO_W) / Math.max(larguraDoTrilho, 1)
              const k = Math.min(tira.quadros - 1, Math.max(0, Math.round(meio * (tira.quadros - 1))))
              return (
                <div
                  key={i}
                  className="absolute inset-y-0"
                  style={{
                    left: i * QUADRO_W,
                    width: QUADRO_W,
                    backgroundImage: `url(${tira.url})`,
                    backgroundSize: `${tira.colunas * 100}% ${tira.linhas * 100}%`,
                    backgroundPosition: posicaoNaTira(k),
                  }}
                />
              )
            })}
          {/* Fora do trecho: escurecido. */}
          <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/60" style={{ width: `${esq}%` }} />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 bg-black/60"
            style={{ width: `${Math.max(0, 100 - esq - larg)}%` }}
          />
          {/* A janela: o que o bloco mostra. */}
          <div
            className="pointer-events-none absolute inset-y-0 rounded-[3px] border-2 border-accent shadow-[0_0_10px_rgba(255,62,128,0.45)]"
            style={{ left: `${esq}%`, width: `${larg}%` }}
          />
        </div>

        <span className="tnum text-[11px] text-ink-2">
          {inicio.toFixed(1)}s – {Math.min(inicio + bloco, total).toFixed(1)}s
          <span className="text-ink-3"> de {total.toFixed(1)}s</span>
          {parada > 0.05 && (
            <span
              className="text-accent"
              title="O bloco dura mais que o resto do clipe a partir daqui: nesse fim a imagem fica parada no ultimo quadro. Puxe a janela para a esquerda para encurtar isso."
            >
              {' '}
              · imagem parada {parada.toFixed(1)}s no fim
            </span>
          )}
        </span>
      </div>
    </Field>
  )
}

/**
 * Tocar o clipe de tras para frente.
 *
 * "Uma opcao onde eu clico e ele faz um reverse do clipe para eu poder usar
 * invertido." Um clique liga, outro desliga. O bloco continua mostrando o
 * mesmo momento do clipe, so que ao contrario -- o ponto de entrada acompanha.
 */
function Inverter({
  index,
  metade,
  invertido,
}: {
  index: number
  metade: 'cima' | 'baixo'
  invertido: boolean
}) {
  const inverterClipe = useProject((s) => s.inverterClipe)
  const busy = useProject((s) => s.busy)
  return (
    <Chip active={invertido} onClick={() => busy === null && void inverterClipe(index, metade)}>
      <RefreshCcw size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
      {invertido ? 'Tocando invertido' : 'Inverter clipe'}
      {metade === 'baixo' ? ' (baixo)' : ''}
    </Chip>
  )
}
