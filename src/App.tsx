import { useEffect } from 'react'
import { useProject } from '@/store/project'
import { useFileDrop } from '@/hooks/useFileDrop'
import { Dropzone } from '@/components/Dropzone'
import { Timeline } from '@/components/Timeline'
import { ImageStrip } from '@/components/ImageStrip'
import { Preview } from '@/components/Preview'
import { RenderBar } from '@/components/RenderBar'
import { StatusBar } from '@/components/StatusBar'
import { VIDEO_FPS } from '@shared/contract'

export function App() {
  const isDragging = useFileDrop()
  const phase = useProject((s) => s.phase())
  const removeImage = useProject((s) => s.removeImage)
  const selectedImageId = useProject((s) => s.selectedImageId)
  const applyRenderProgress = useProject((s) => s.applyRenderProgress)

  // Progresso do render vindo do main.
  useEffect(() => window.dangai.onRenderProgress(applyRenderProgress), [applyRenderProgress])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useProject.getState()
      const rendering = store.phase() === 'rendering'

      switch (event.key) {
        case ' ':
          if (rendering) return
          event.preventDefault()
          store.togglePlay()
          break
        case 'ArrowLeft':
          if (rendering) return
          event.preventDefault()
          store.setPlayhead(store.playhead - 1 / VIDEO_FPS)
          break
        case 'ArrowRight':
          if (rendering) return
          event.preventDefault()
          store.setPlayhead(store.playhead + 1 / VIDEO_FPS)
          break
        case 'Delete':
        case 'Backspace':
          if (rendering || !selectedImageId) return
          event.preventDefault()
          removeImage(selectedImageId)
          break
        case 'r':
          if (!event.ctrlKey && !event.metaKey) return
          event.preventDefault()
          if (!rendering) void store.startRender()
          break
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
        <main className="enter flex-1 p-6">
          <Dropzone isDragging={isDragging} />
        </main>
      ) : (
        <main className="enter flex min-h-0 flex-1 flex-col gap-5 p-6">
          <div className="flex min-h-0 flex-1 gap-6">
            <Preview />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <ImageStrip />
            </div>
          </div>

          <RenderBar />
          <Timeline />
        </main>
      )}

      <StatusBar isDragging={isDragging} />
    </div>
  )
}
