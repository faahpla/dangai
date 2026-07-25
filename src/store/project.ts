import { create } from 'zustand'
import { classifyFile } from '@shared/channels'
import type { AudioAnalysis, ImageAsset } from '@shared/contract'

/** Estados da interface. Existem tres, e nesta fase apenas dois sao alcancaveis. */
export type Phase = 'empty' | 'editing' | 'rendering'

interface ProjectState {
  audio: AudioAnalysis | null
  images: ImageAsset[]
  /** Mensagem de progresso. Nenhum carregamento acontece sem isto preenchido. */
  busy: string | null
  error: string | null
  /** Posicao do playhead em segundos. */
  playhead: number
  selectedImageId: string | null

  phase: () => Phase
  ingest: (paths: readonly string[]) => Promise<void>
  reorderImages: (images: ImageAsset[]) => void
  removeImage: (id: string) => void
  selectImage: (id: string | null) => void
  setPlayhead: (seconds: number) => void
  dismissError: () => void
  reset: () => void
}

export const useProject = create<ProjectState>((set, get) => ({
  audio: null,
  images: [],
  busy: null,
  error: null,
  playhead: 0,
  selectedImageId: null,

  phase: () => (get().audio || get().images.length > 0 ? 'editing' : 'empty'),

  ingest: async (paths) => {
    const audioPaths: string[] = []
    const imagePaths: string[] = []
    const ignored: string[] = []

    for (const path of paths) {
      switch (classifyFile(path)) {
        case 'audio':
          audioPaths.push(path)
          break
        case 'image':
          imagePaths.push(path)
          break
        case 'subtitle':
          // .srt e aceito no drop mas so passa a ser usado na v0.3.
          break
        default:
          ignored.push(path)
      }
    }

    if (audioPaths.length === 0 && imagePaths.length === 0) {
      set({
        error:
          ignored.length > 0
            ? 'Esses arquivos nao servem. Solte um audio (.mp3, .wav, .m4a) e imagens (.png, .jpg, .webp).'
            : 'Nada para importar.',
      })
      return
    }

    set({ error: null })

    if (imagePaths.length > 0) {
      set({ busy: `Lendo ${imagePaths.length} ${imagePaths.length === 1 ? 'imagem' : 'imagens'}...` })
      const result = await window.dangai.importImages(imagePaths)
      if (result.ok) {
        // A ordem em que o usuario solta e a ordem do video.
        set((state) => ({ images: [...state.images, ...result.value] }))
      } else {
        set({ error: result.error })
      }
    }

    const audioPath = audioPaths[0]
    if (audioPath) {
      set({ busy: 'Analisando a narracao...' })
      const result = await window.dangai.analyzeAudio(audioPath)
      if (result.ok) {
        set({ audio: result.value, playhead: 0 })
      } else {
        set({ error: result.error })
      }
    }

    set({ busy: null })
  },

  reorderImages: (images) => set({ images }),

  removeImage: (id) =>
    set((state) => ({
      images: state.images.filter((image) => image.id !== id),
      selectedImageId: state.selectedImageId === id ? null : state.selectedImageId,
    })),

  selectImage: (id) => set({ selectedImageId: id }),

  setPlayhead: (seconds) =>
    set((state) => ({
      playhead: Math.min(Math.max(seconds, 0), state.audio?.durationSec ?? 0),
    })),

  dismissError: () => set({ error: null }),

  reset: () =>
    set({ audio: null, images: [], busy: null, error: null, playhead: 0, selectedImageId: null }),
}))

/** mm:ss.cc — o formato de timecode usado em toda a interface. */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const minutes = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  const centis = Math.floor((safe % 1) * 100)
  return `${minutes}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}
