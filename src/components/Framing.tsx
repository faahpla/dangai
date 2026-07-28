import { useCallback, useRef } from 'react'
import { ScanFace } from 'lucide-react'
import { VIDEO_HEIGHT, VIDEO_WIDTH, type ImageAsset } from '@shared/contract'
import { useProject } from '@/store/project'

const TARGET_RATIO = VIDEO_WIDTH / VIDEO_HEIGHT

/**
 * Escolha do enquadramento: a imagem inteira com a janela 9:16 por cima, que se
 * arrasta ate o pedaco certo aparecer.
 *
 * Um print 16:9 perde 68% da largura ao virar 9:16. Sem este controle o app
 * sempre pegava o terco central -- que e onde o personagem menos costuma estar
 * num frame de anime.
 */
export function Framing({ image }: { image: ImageAsset }) {
  const setImageFocus = useProject((s) => s.setImageFocus)
  const commitImageFocus = useProject((s) => s.commitImageFocus)
  const boxRef = useRef<HTMLDivElement | null>(null)

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
        Esta imagem ja e 9:16. Nao sobra nada para enquadrar.
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
        <img src={image.thumbnail} alt="" className="h-full w-full" draggable={false} />

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
