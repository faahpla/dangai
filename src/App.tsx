import { useEffect } from 'react'
import { useProject } from '@/store/project'
import { useFileDrop } from '@/hooks/useFileDrop'
import { Dropzone } from '@/components/Dropzone'
import { Timeline } from '@/components/Timeline'
import { ImageStrip } from '@/components/ImageStrip'
import { PreviewFrame } from '@/components/PreviewFrame'
import { StatusBar } from '@/components/StatusBar'

export function App() {
  const isDragging = useFileDrop()
  const phase = useProject((s) => s.phase())
  const removeImage = useProject((s) => s.removeImage)
  const selectedImageId = useProject((s) => s.selectedImageId)

  // Delete remove a cena selecionada.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedImageId) {
        event.preventDefault()
        removeImage(selectedImageId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedImageId, removeImage])

  return (
    <div className="flex h-full flex-col bg-bg">
      {/*
       * A troca de estado usa keyframes CSS (utility `enter`), nao motion. O
       * conteudo principal nunca fica dependendo de JS para se tornar visivel --
       * ver o comentario da keyframe em index.css.
       */}
      {phase === 'empty' ? (
        <main key="empty" className="enter flex-1 p-6">
          <Dropzone isDragging={isDragging} />
        </main>
      ) : (
        <main key="editing" className="enter flex min-h-0 flex-1 flex-col gap-6 p-6">
          <div className="flex min-h-0 flex-1 gap-6">
            <PreviewFrame />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <ImageStrip />
            </div>
          </div>

          <Timeline />
        </main>
      )}

      <StatusBar isDragging={isDragging} />
    </div>
  )
}
