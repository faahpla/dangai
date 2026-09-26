import { useCallback, useEffect, useRef } from 'react'
import { ScanFace } from 'lucide-react'
import { medidasDo, type Formato, type ImageAsset } from '@shared/contract'
import { useProject } from '@/store/project'

/**
 * A proporcao do quadro em que esta imagem vai cair.
 *
 * Era constante, e com isso a janela de enquadrar desenhava 9:16 mesmo num
 * projeto horizontal -- mostrando ao usuario um recorte que o render nao faria.
 */
function proporcaoDoQuadro(formato: Formato): number {
  const { width, height } = medidasDo(formato)
  return width / height
}

/**
 * Escolha do enquadramento: a imagem inteira com a janela 9:16 por cima, que se
 * arrasta ate o pedaco certo aparecer.
 *
 * Um print 16:9 perde 68% da largura ao virar 9:16. Sem este controle o app
 * sempre pegava o terco central -- que e onde o personagem menos costuma estar
 * num frame de anime.
 */
/**
 * Onde este bloco cai na linha do tempo, e de que ponto do clipe ele parte.
 *
 * E o que deixa a caixa mostrar o quadro que o preview esta mostrando. Sem
 * isto ela so tem a miniatura -- que sai do MEIO do clipe e raramente e o
 * instante em que ele esta enquadrando.
 */
export interface TrechoNaTimeline {
  inicio: number
  fim: number
  /** `sourceStart` da metade de cima, `sourceStartB` da de baixo. */
  entrada: number
}

export function Framing({ image, trecho }: { image: ImageAsset; trecho?: TrechoNaTimeline }) {
  const setImageFocus = useProject((s) => s.setImageFocus)
  const commitImageFocus = useProject((s) => s.commitImageFocus)
  const formato = useProject((s) => s.formato)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const TARGET_RATIO = proporcaoDoQuadro(formato)

  const ratio = image.width / image.height
  // Fracao da imagem que sobra dentro do quadro vertical. Um dos dois eixos e
  // sempre 1: o corte acontece so no lado que sobra.
  const cropWidth = ratio > TARGET_RATIO ? TARGET_RATIO / ratio : 1
  const cropHeight = ratio > TARGET_RATIO ? 1 : ratio / TARGET_RATIO

  const slackX = 1 - cropWidth
  const slackY = 1 - cropHeight
  const adjustable = slackX > 0.001 || slackY > 0.001

  const focusFromPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const box = boxRef.current
      if (!box) return

      const rect = box.getBoundingClientRect()
      // O ponteiro marca o centro do recorte; a conta desconta meia janela e
      // normaliza pela folga que existe naquele eixo.
      const x = (event.clientX - rect.left) / rect.width
      const y = (event.clientY - rect.top) / rect.height

      setImageFocus(
        image.id,
        slackX > 0 ? (x - cropWidth / 2) / slackX : 0.5,
        slackY > 0 ? (y - cropHeight / 2) / slackY : 0.5,
      )
    },
    [image.id, cropWidth, cropHeight, slackX, slackY, setImageFocus],
  )

  if (!adjustable) {
    return (
      <p className="text-[11px] leading-relaxed text-ink-3">
        {image.kind === 'video' ? 'Este clipe' : 'Esta imagem'} ja tem o formato do video. Nao
        sobra nada para enquadrar.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={boxRef}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          focusFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) focusFromPointer(event)
        }}
        onPointerUp={() => void commitImageFocus(image.id)}
        onPointerCancel={() => void commitImageFocus(image.id)}
        style={{ aspectRatio: `${image.width} / ${image.height}` }}
        className="relative w-full cursor-move select-none overflow-hidden rounded-sm border border-line bg-black"
      >
        {/*
          O QUADRO DA AGULHA, e nao a miniatura.

          A miniatura sai do meio do clipe e fica parada. Enquadrar olhando para
          ela era enquadrar outro instante: no clipe dele o personagem estava
          do lado direito na miniatura e do esquerdo no quadro que o preview
          mostrava -- "quero que o negocio pra eu centralizar manualmente
          acompanhe o preview".

          Usa o arquivo ORIGINAL (`urlSource`), e nao o recortado: a caixa e a
          fonte inteira com a janela por cima, e o recortado ja e so a janela.
        */}
        {image.kind === 'video' && image.urlSource && trecho ? (
          <QuadroDaAgulha src={image.urlSource} trecho={trecho} />
        ) : (
          <img src={image.thumbnail} alt="" className="h-full w-full" draggable={false} />
        )}

        {/* O que fica de fora escurece; o que entra no video fica limpo. */}
        <div
          style={{
            left: `${image.focusX * slackX * 100}%`,
            top: `${image.focusY * slackY * 100}%`,
            width: `${cropWidth * 100}%`,
            height: `${cropHeight * 100}%`,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.62)',
          }}
          className="pointer-events-none absolute border border-accent"
        />
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setImageFocus(image.id, 0.5, 0.5)
            void commitImageFocus(image.id)
          }}
          className="text-[11px] text-ink-3 transition-colors duration-150 hover:text-ink-2"
        >
          Centralizar
        </button>

        {/* Dizer que mexeu importa mais que ter mexido: sem isto o usuario
            descobriria o enquadramento novo so no video pronto. */}
        {image.focusAuto && (
          <span
            title="O app achou um rosto e enquadrou por ele. Arraste para assumir o controle."
            className="flex items-center gap-1 text-[11px] text-accent"
          >
            <ScanFace size={11} strokeWidth={1.5} />
            pelo rosto
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Um <video> que anda junto com a agulha, dentro do trecho deste bloco.
 *
 * PARADO, o quadro e exato: e parado que ele enquadra, e errar o instante ali
 * e mostrar outro quadro. TOCANDO, o video toca por conta propria e so e
 * reposicionado quando se afasta mais de 150ms -- buscar a cada quadro num
 * arquivo em resolucao cheia engasga, e o que ele precisa ver durante a
 * reproducao e o movimento, nao o quadro exato.
 *
 * Fora do trecho a caixa para na borda dele (o primeiro ou o ultimo quadro que
 * o bloco usa), porque e so esse pedaco do clipe que o enquadramento afeta.
 */
function QuadroDaAgulha({ src, trecho }: { src: string; trecho: TrechoNaTimeline }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const playhead = useProject((s) => s.playhead)
  const playing = useProject((s) => s.playing)

  const duracao = Math.max(trecho.fim - trecho.inicio, 0)
  const noTrecho = playhead >= trecho.inicio && playhead < trecho.fim
  const alvo = trecho.entrada + Math.min(Math.max(playhead - trecho.inicio, 0), duracao)

  // O video pode terminar de carregar depois que a agulha ja se moveu.
  const alvoAtual = useRef(alvo)
  alvoAtual.current = alvo

  const posicionar = useCallback((video: HTMLVideoElement, t: number, folga: number) => {
    // Um quadro antes do fim: pedir o instante exato do fim deixa a tela preta.
    const limite = Number.isFinite(video.duration) ? Math.max(video.duration - 0.05, 0) : t
    const destino = Math.min(t, limite)
    if (Math.abs(video.currentTime - destino) > folga) video.currentTime = destino
  }, [])

  useEffect(() => {
    const video = ref.current
    if (!video) return
    if (playing && noTrecho) {
      posicionar(video, alvo, 0.15)
      if (video.paused) void video.play().catch(() => undefined)
    } else {
      if (!video.paused) video.pause()
      posicionar(video, alvo, 0.01)
    }
  }, [alvo, playing, noTrecho, posicionar])

  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload="auto"
      onLoadedMetadata={(event) => posicionar(event.currentTarget, alvoAtual.current, 0.01)}
      // object-fill, como a <img>: a caixa ja tem a proporcao da fonte, e a
      // janela rosa e medida contra ela -- qualquer outro encaixe a desalinharia.
      className="pointer-events-none h-full w-full object-fill"
    />
  )
}
