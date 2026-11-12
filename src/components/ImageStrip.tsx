import { useRef } from 'react'
import { Reorder } from 'motion/react'
import { X } from 'lucide-react'
import { useProject } from '@/store/project'
import type { ImageAsset } from '@shared/contract'

/**
 * Fila de imagens na ordem do video. Arrastar reordena; a ordem daqui e a
 * verdade que o plano de cenas vai consumir.
 */
export function ImageStrip() {
  const images = useProject((s) => s.images)
  const reorderImages = useProject((s) => s.reorderImages)

  if (images.length === 0) return null

  return (
    <Reorder.Group
      axis="x"
      values={images}
      onReorder={reorderImages}
      as="ul"
      className="flex gap-2 overflow-x-auto pb-1"
    >
      {images.map((image, index) => (
        <Card key={image.id} image={image} index={index} />
      ))}
    </Reorder.Group>
  )
}

function Card({ image, index }: { image: ImageAsset; index: number }) {
  const selectedScene = useProject((s) => s.selectedScene)
  const selectedImageIndex = useProject((s) =>
    s.selectedScene === null ? null : (s.plan?.scenes[s.selectedScene]?.imageIndex ?? null),
  )
  const selectImage = useProject((s) => s.selectImage)
  const removeImage = useProject((s) => s.removeImage)
  const isSelected = selectedScene !== null && selectedImageIndex === index
  /*
   * ABRIR O BLOCO SO NO CLIQUE, NUNCA NO APERTAR. A fila mora na visao geral,
   * que so existe sem bloco escolhido: abrir o bloco no pointerdown (como era
   * quando a fila ficava sempre na tela) trocava a visao geral pelo bloco no
   * mesmo instante, e a fila sumia antes de o arraste comecar -- "clicou pra
   * arrastar e fechou" (ajk, 2.5.0). Soltar perto de onde apertou e clique;
   * longe, foi arraste.
   */
  const apertou = useRef<{ x: number; y: number } | null>(null)

  return (
    <Reorder.Item
      value={image}
      as="li"
      whileDrag={{ scale: 1.03, zIndex: 10 }}
      className="shrink-0 cursor-grab active:cursor-grabbing"
    >
      <div
        onPointerDown={(event) => {
          apertou.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerUp={(event) => {
          const de = apertou.current
          apertou.current = null
          if (de && Math.hypot(event.clientX - de.x, event.clientY - de.y) < 5) selectImage(image.id)
        }}
        className={[
          'lift group relative h-[104px] w-[59px] overflow-hidden rounded-sm border bg-elevated',
          isSelected ? 'border-accent' : 'border-line',
        ].join(' ')}
      >
        <img
          src={image.thumbnail}
          alt={image.fileName}
          className="h-full w-full object-cover"
          draggable={false}
        />

        <span className="tnum absolute left-1 top-1 rounded-[4px] bg-black/55 px-1 text-[10px] text-white/80">
          {index + 1}
        </span>

        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => removeImage(image.id)}
          aria-label={`Remover ${image.fileName}`}
          className="absolute right-1 top-1 grid size-[18px] place-items-center rounded-[5px] bg-black/55 text-ink-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-ink"
        >
          <X size={11} strokeWidth={1.5} />
        </button>
      </div>
    </Reorder.Item>
  )
}
