import { useProject } from '@/store/project'

/**
 * Moldura 9:16 a esquerda. Na v0.1 mostra a imagem da cena selecionada (ou a
 * primeira) enquadrada como sairia no video: cobrindo a tela inteira, sem barra
 * preta nunca. O @remotion/player toma este lugar na v0.2.
 */
export function PreviewFrame() {
  const images = useProject((s) => s.images)
  const selectedImageId = useProject((s) => s.selectedImageId)

  const current = images.find((image) => image.id === selectedImageId) ?? images[0]

  return (
    <div className="flex min-h-0 shrink-0 flex-col gap-3">
      <div className="relative aspect-[9/16] h-full overflow-hidden rounded-md border border-line bg-surface">
        {current ? (
          <img
            src={current.thumbnail}
            alt={current.fileName}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center text-[11px] text-ink-3">
            Solte imagens para ver o enquadramento
          </div>
        )}

        <span className="tnum absolute bottom-2 right-2 rounded-[6px] bg-black/60 px-1.5 py-0.5 text-[10px] text-white/70">
          1080 x 1920
        </span>
      </div>
    </div>
  )
}
