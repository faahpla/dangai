import { useEffect } from 'react'
import { useProject } from '@/store/project'
import { useFileDrop } from '@/hooks/useFileDrop'
import { Dropzone } from '@/components/Dropzone'
import { Timeline } from '@/components/Timeline'
import { ImageStrip } from '@/components/ImageStrip'
import { SceneCard } from '@/components/SceneCard'
import { Preview } from '@/components/Preview'
import { RenderBar } from '@/components/RenderBar'
import { StatusBar } from '@/components/StatusBar'
import { Settings } from '@/components/Settings'
import { Script } from '@/components/Script'
import { CaptionEditor } from '@/components/CaptionEditor'
import { CommandPalette } from '@/components/CommandPalette'
import { VIDEO_FPS } from '@shared/contract'

export function App() {
  const isDragging = useFileDrop()
  const phase = useProject((s) => s.phase())
  const removeScene = useProject((s) => s.removeScene)
  const selectedScene = useProject((s) => s.selectedScene)
  const applyRenderProgress = useProject((s) => s.applyRenderProgress)
  const setBusy = useProject((s) => s.setBusy)
  const captionsOpen = useProject((s) => s.captionsOpen)
  const refreshSfx = useProject((s) => s.refreshSfx)
  const setUpdate = useProject((s) => s.setUpdate)
  const setAppVersion = useProject((s) => s.setAppVersion)

  // Progresso do render vindo do main.
  useEffect(() => window.dangai.onRenderProgress(applyRenderProgress), [applyRenderProgress])

  // Lista de SFX na abertura: ela define quantos sons entram no video.
  useEffect(() => void refreshSfx(), [refreshSfx])

  // Atualizacao do app: o main avisa, a barra de status mostra.
  useEffect(() => window.dangai.onUpdateStatus(setUpdate), [setUpdate])
  useEffect(() => {
    void window.dangai.appVersion().then((r) => {
      if (r.ok) setAppVersion(r.value)
    })
  }, [setAppVersion])

  // Andamento da analise: Whisper e a chamada da IA levam tempo e nenhum
  // carregamento pode ficar sem sinal visivel.
  useEffect(() => window.dangai.onAnalyzeProgress((message) => setBusy(message)), [setBusy])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useProject.getState()
      const rendering = store.phase() === 'rendering'

      // A paleta e os modais tratam o proprio teclado; enquanto abertos, os
      // atalhos globais ficam quietos para nao disparar por baixo.
      if (store.paletteOpen || store.settingsOpen || store.scriptOpen) {
        if ((event.key === 'k' || event.key === 'K') && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          store.openPalette(false)
        }
        return
      }

      switch (event.key) {
        case 'k':
        case 'K':
          if (!event.ctrlKey && !event.metaKey) return
          event.preventDefault()
          store.openPalette(true)
          break
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
          if (rendering || selectedScene === null) return
          event.preventDefault()
          removeScene(selectedScene)
          break
        case 'r':
          if (!event.ctrlKey && !event.metaKey) return
          event.preventDefault()
          if (!rendering) void store.startRender()
          break
        case ',':
          if (!event.ctrlKey && !event.metaKey) return
          event.preventDefault()
          store.openSettings(!store.settingsOpen)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedScene, removeScene])

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
              {/*
                O editor de legendas divide a coluna com a fila de imagens em
                vez de virar uma tela: com o preview do lado, da para ver o
                efeito de cada mesclagem sem trocar de contexto.
              */}
              {captionsOpen && <CaptionEditor />}
            </div>
            <SceneCard />
          </div>

          <RenderBar />
          <Timeline />
        </main>
      )}

      <StatusBar isDragging={isDragging} />
      <Settings />
      <Script />
      <CommandPalette />
    </div>
  )
}
