import { create } from 'zustand'
import { classifyFile } from '@shared/channels'
import type {
  AudioAnalysis,
  ImageAsset,
  PlanOrigin,
  RenderProgress,
  ScenePlan,
  Transcript,
} from '@shared/contract'
import { planEqualSplit, toRenderProps, totalFrames } from '@shared/plan'

/** Estados da interface. Existem tres, e nao mais que tres. */
export type Phase = 'empty' | 'editing' | 'rendering'

interface ProjectState {
  audio: AudioAnalysis | null
  images: ImageAsset[]
  subtitlePath: string | null
  /**
   * O plano vem do main e e a verdade unica. O renderer nao recalcula: se
   * recalculasse, o preview mostraria uma coisa e o render produziria outra.
   *
   * Fica sempre preenchido enquanto ha material -- divisao igual como valor
   * provisorio ate a analise voltar. Guardar o plano em vez de derivar num
   * seletor e o que evita loop infinito de render: seletor que monta objeto
   * novo a cada chamada nunca estabiliza no Zustand.
   */
  plan: ScenePlan | null
  planOrigin: PlanOrigin | null
  transcript: Transcript | null
  /** Aviso de quando a IA nao deu -- informativo, nao erro. */
  aiNote: string | null

  busy: string | null
  error: string | null
  playhead: number
  playing: boolean
  selectedImageId: string | null
  render: RenderProgress | null
  lastOutput: string | null
  settingsOpen: boolean

  phase: () => Phase
  ingest: (paths: readonly string[]) => Promise<void>
  analyze: () => Promise<void>
  reorderImages: (images: ImageAsset[]) => void
  removeImage: (id: string) => void
  selectImage: (id: string | null) => void
  setPlayhead: (seconds: number) => void
  togglePlay: () => void
  setPlaying: (playing: boolean) => void
  startRender: () => Promise<void>
  cancelRender: () => Promise<void>
  applyRenderProgress: (progress: RenderProgress) => void
  setBusy: (message: string | null) => void
  openSettings: (open: boolean) => void
  dismissError: () => void
  reset: () => void
}

type SetState = (partial: Partial<ProjectState>) => void

/**
 * Plano provisorio por divisao igual, aplicado no instante em que ha material.
 *
 * Serve para o preview e a timeline terem o que mostrar enquanto a analise
 * roda -- e, principalmente, para `plan` nunca precisar ser derivado dentro de
 * um seletor.
 */
function setInterimPlan(set: SetState, imageCount: number, durationSec: number): void {
  set({ plan: planEqualSplit(imageCount, durationSec), planOrigin: 'equal' })
}

export const useProject = create<ProjectState>((set, get) => ({
  audio: null,
  images: [],
  subtitlePath: null,
  plan: null,
  planOrigin: null,
  transcript: null,
  aiNote: null,
  busy: null,
  error: null,
  playhead: 0,
  playing: false,
  selectedImageId: null,
  render: null,
  lastOutput: null,
  settingsOpen: false,

  phase: () => {
    const state = get()
    if (state.render && ['bundling', 'rendering', 'muxing'].includes(state.render.stage)) {
      return 'rendering'
    }
    return state.audio || state.images.length > 0 ? 'editing' : 'empty'
  },

  ingest: async (paths) => {
    const audioPaths: string[] = []
    const imagePaths: string[] = []
    const subtitlePaths: string[] = []
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
          subtitlePaths.push(path)
          break
        default:
          ignored.push(path)
      }
    }

    if (audioPaths.length === 0 && imagePaths.length === 0 && subtitlePaths.length === 0) {
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

    const subtitlePath = subtitlePaths[0]
    if (subtitlePath) set({ subtitlePath })

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

    // Qualquer mudanca no material invalida o plano; refaz sozinho.
    const { audio, images } = get()
    if (audio && images.length > 0) {
      setInterimPlan(set, images.length, audio.durationSec)
      await get().analyze()
    }
  },

  analyze: async () => {
    const { audio, images, subtitlePath } = get()
    if (!audio || images.length === 0) return

    set({ busy: 'Analisando...', error: null })

    const result = await window.dangai.analyze({
      audioPath: audio.path,
      subtitlePath,
      images,
      durationSec: audio.durationSec,
    })

    if (result.ok) {
      set({
        plan: result.value.plan,
        planOrigin: result.value.origin,
        transcript: result.value.transcript,
        aiNote: result.value.aiNote,
        busy: null,
      })
    } else {
      // Nem a analise pode travar o app: mantem o plano provisorio em vez de
      // ficar sem nenhum.
      const { audio, images } = get()
      if (audio && images.length > 0) setInterimPlan(set, images.length, audio.durationSec)
      set({ error: result.error, busy: null })
    }
  },

  reorderImages: (images) => {
    set({ images })
    // A ordem mudou, entao o plano nao vale mais.
    const { audio } = get()
    if (audio && images.length > 0) setInterimPlan(set, images.length, audio.durationSec)
    void get().analyze()
  },

  removeImage: (id) => {
    set((state) => ({
      images: state.images.filter((image) => image.id !== id),
      selectedImageId: state.selectedImageId === id ? null : state.selectedImageId,
    }))
    const { audio, images } = get()
    if (audio && images.length > 0) setInterimPlan(set, images.length, audio.durationSec)
    void get().analyze()
  },

  selectImage: (id) => set({ selectedImageId: id }),

  setPlayhead: (seconds) =>
    set((state) => ({
      playhead: Math.min(Math.max(seconds, 0), state.audio?.durationSec ?? 0),
    })),

  togglePlay: () => set((state) => ({ playing: !state.playing })),

  setPlaying: (playing) => set({ playing }),

  startRender: async () => {
    const { audio, images, plan } = get()
    if (!audio || images.length === 0 || !plan) return

    set({
      playing: false,
      error: null,
      render: { progress: 0, stage: 'bundling', message: 'Preparando...' },
    })

    const result = await window.dangai.startRender({
      props: toRenderProps(plan, images),
      audioPath: audio.path,
      durationInFrames: totalFrames(audio.durationSec),
    })

    if (!result.ok) {
      set({ error: result.error, render: null })
      return
    }
    // value === null significa que o usuario cancelou. Nao e erro, e o evento
    // 'cancelled' ja limpou o estado -- so garantimos que nada ficou pendurado.
    if (result.value === null) {
      set({ render: null })
    }
  },

  cancelRender: async () => {
    await window.dangai.cancelRender()
  },

  applyRenderProgress: (progress) => {
    if (progress.stage === 'done') {
      set({ render: null, lastOutput: progress.outputPath ?? null, error: null })
      return
    }
    if (progress.stage === 'failed') {
      set({ render: null, error: progress.message ?? 'O render falhou.' })
      return
    }
    if (progress.stage === 'cancelled') {
      set({ render: null })
      return
    }

    // O Remotion ainda emite alguns eventos de progresso depois do cancelamento.
    // Sem esta guarda eles ressuscitam o estado e a timeline fica presa
    // preenchida pela metade, com o botao travado em "Cancelar".
    if (get().render === null) return

    set({ render: progress })
  },

  setBusy: (message) => set((state) => (state.busy === null && message === null ? state : { busy: message })),

  openSettings: (open) => set({ settingsOpen: open }),

  dismissError: () => set({ error: null }),

  reset: () =>
    set({
      audio: null,
      images: [],
      subtitlePath: null,
      plan: null,
      planOrigin: null,
      transcript: null,
      aiNote: null,
      busy: null,
      error: null,
      playhead: 0,
      playing: false,
      selectedImageId: null,
      render: null,
      lastOutput: null,
    }),
}))

/** mm:ss.cc — o formato de timecode usado em toda a interface. */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const minutes = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  const centis = Math.floor((safe % 1) * 100)
  return `${minutes}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}
