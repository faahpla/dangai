import { create } from 'zustand'
import { classifyFile } from '@shared/channels'
import type { UpdateStatus } from '@shared/channels'
import { KEN_BURNS_EFFECTS } from '@shared/contract'
import type {
  AudioAnalysis,
  ImageAsset,
  PlanOrigin,
  RenderProgress,
  Scene,
  ScenePlan,
  Transcript,
} from '@shared/contract'
import {
  buildCaptions,
  MIN_SCENE_SEC,
  planEqualSplit,
  sfxCuesFor,
  toRenderProps,
  totalFrames,
} from '@shared/plan'
import type { CaptionBlock } from '@shared/contract'

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
  /**
   * Blocos de legenda derivados da transcricao, guardados prontos.
   *
   * Guardados e nao derivados num seletor pelo mesmo motivo do plano: seletor
   * que monta array novo a cada chamada nao estabiliza no Zustand e leva a
   * render infinito.
   */
  captions: CaptionBlock[]
  /** Aviso de quando a IA nao deu -- informativo, nao erro. */
  aiNote: string | null
  /**
   * O roteiro escrito. Quando existe, o texto das legendas vem dele e os tempos
   * continuam vindo da narracao -- ver shared/align.ts.
   */
  script: string | null
  /** Como o roteiro se saiu no casamento com o audio. */
  scriptNote: string | null
  scriptOpen: boolean
  /** Ligado quando o usuario mexe nas legendas: a analise para de sobrescrever. */
  captionsEdited: boolean
  captionsOpen: boolean

  busy: string | null
  error: string | null
  playhead: number
  playing: boolean
  /**
   * Bloco selecionado, por posicao na linha do tempo.
   *
   * E o indice da CENA e nao o da imagem: desde que uma imagem pode ocupar
   * varios blocos seguidos, os dois deixaram de ser a mesma coisa. Guardar o id
   * da imagem selecionaria todos os blocos dela de uma vez.
   */
  selectedScene: number | null
  render: RenderProgress | null
  lastOutput: string | null
  settingsOpen: boolean

  /** Ligado quando o usuario mexe no plano: a analise para de sobrescrever. */
  planEdited: boolean
  sfxEnabled: boolean
  /** Arquivos de som disponiveis na pasta de SFX. */
  sfxFiles: string[]
  /** Andamento da atualizacao do app. null enquanto nada foi dito. */
  update: UpdateStatus | null
  appVersion: string
  captionsEnabled: boolean
  paletteOpen: boolean

  phase: () => Phase
  ingest: (paths: readonly string[]) => Promise<void>
  /** Troca efeito, transicao ou intensidade de uma cena. */
  updateScene: (index: number, patch: Partial<Pick<Scene, 'effect' | 'transitionIn' | 'intensity'>>) => void
  /** Move a fronteira entre a cena index-1 e a cena index. */
  moveBoundary: (index: number, seconds: number) => void
  toggleSfx: () => void
  /** Recarrega a lista de sons. Chamada na abertura e ao voltar das settings. */
  refreshSfx: () => Promise<void>
  setUpdate: (status: UpdateStatus) => void
  setAppVersion: (version: string) => void
  toggleCaptions: () => void
  setScript: (script: string | null) => Promise<void>
  openScript: (open: boolean) => void
  openCaptions: (open: boolean) => void
  /** Junta blocos vizinhos num so. Os indices precisam ser consecutivos. */
  mergeCaptions: (indices: readonly number[]) => void
  /** Quebra um bloco antes da palavra indicada. */
  splitCaption: (index: number, wordIndex: number) => void
  /** Reescreve o texto de uma palavra sem mexer no tempo. */
  editCaptionWord: (index: number, wordIndex: number, text: string) => void
  resetCaptions: () => void
  openPalette: (open: boolean) => void
  analyze: () => Promise<void>
  reorderImages: (images: ImageAsset[]) => void
  removeImage: (id: string) => void
  /**
   * Importa imagens e as encaixa num INSTANTE da linha do tempo.
   *
   * Cair no comeco de um bloco entra antes dele; cair no meio parte o bloco. E
   * o que substitui a antiga divisao: mais ritmo se resolve com mais imagem no
   * ponto onde falta, nao repetindo a que ja estava la.
   */
  insertImages: (paths: readonly string[], seconds: number) => Promise<void>
  /** Tira um bloco da linha do tempo, junto com a imagem dele. */
  removeScene: (index: number) => void
  /** Move o enquadramento 9:16 sobre a imagem. Instantaneo, so no estado. */
  setImageFocus: (id: string, focusX: number, focusY: number) => void
  /** Confirma o enquadramento: pede o novo recorte ao main e troca a URL. */
  commitImageFocus: (id: string) => Promise<void>
  selectScene: (index: number | null) => void
  /** Seleciona o primeiro bloco que usa esta imagem. */
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
  set({
    plan: planEqualSplit(imageCount, durationSec),
    planOrigin: 'equal',
    selectedScene: null,
  })
}

export const useProject = create<ProjectState>((set, get) => ({
  audio: null,
  images: [],
  subtitlePath: null,
  plan: null,
  planOrigin: null,
  transcript: null,
  captions: [],
  aiNote: null,
  script: null,
  scriptNote: null,
  scriptOpen: false,
  captionsEdited: false,
  captionsOpen: false,
  busy: null,
  error: null,
  playhead: 0,
  playing: false,
  selectedScene: null,
  render: null,
  lastOutput: null,
  settingsOpen: false,
  planEdited: false,
  sfxEnabled: true,
  sfxFiles: [],
  update: null,
  appVersion: '',
  captionsEnabled: false,
  paletteOpen: false,

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
    const scriptPaths: string[] = []
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
        case 'script':
          scriptPaths.push(path)
          break
        default:
          ignored.push(path)
      }
    }

    if (
      audioPaths.length === 0 &&
      imagePaths.length === 0 &&
      subtitlePaths.length === 0 &&
      scriptPaths.length === 0
    ) {
      set({
        error:
          ignored.length > 0
            ? 'Esses arquivos nao servem. Solte um audio (.mp3, .wav, .m4a), imagens (.png, .jpg, .webp) e o roteiro (.txt).'
            : 'Nada para importar.',
      })
      return
    }

    set({ error: null })

    // O roteiro entra antes da analise: ele muda o texto das legendas, entao
    // precisa estar no estado quando a analise rodar la embaixo.
    const scriptPath = scriptPaths[0]
    if (scriptPath) {
      const result = await window.dangai.readScript(scriptPath)
      if (result.ok) set({ script: result.value, captionsEdited: false })
      else set({ error: result.error })
    }

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

    const { audio, images } = get()
    if (!audio || images.length === 0) return

    // Material novo invalida o plano; roteiro sozinho nao mexe nos cortes,
    // entao nao pode jogar fora o que ja esta montado.
    if (imagePaths.length > 0 || audioPath) {
      setInterimPlan(set, images.length, audio.durationSec)
    }
    await get().analyze()
  },

  analyze: async () => {
    const { audio, images, subtitlePath, script } = get()
    if (!audio || images.length === 0) return

    set({ busy: 'Analisando...', error: null })

    const result = await window.dangai.analyze({
      audioPath: audio.path,
      subtitlePath,
      images,
      durationSec: audio.durationSec,
      script,
    })

    if (result.ok) {
      const state = get()

      /*
       * Trabalho manual sobrevive a uma reanalise. O plano so e preservado se
       * ainda servir: se o numero de imagens mudou, as cenas editadas nao
       * correspondem mais a nada e o plano novo e o unico correto.
       */
      const keepPlan = state.planEdited && state.plan?.scenes.length === images.length

      set({
        plan: keepPlan ? state.plan : result.value.plan,
        planOrigin: keepPlan ? state.planOrigin : result.value.origin,
        transcript: result.value.transcript,
        captions: state.captionsEdited
          ? state.captions
          : buildCaptions(result.value.transcript),
        aiNote: result.value.aiNote,
        scriptNote: result.value.scriptNote,
        planEdited: keepPlan,
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
      selectedScene: null,
    }))
    const { audio, images } = get()
    if (audio && images.length > 0) setInterimPlan(set, images.length, audio.durationSec)
    void get().analyze()
  },

  /**
   * Importa imagens e as encaixa no meio da fila.
   *
   * O tempo das novas sai do bloco onde elas entraram, e nao de toda a linha do
   * tempo: inserir uma imagem no minuto tres nao pode empurrar tudo que ja
   * estava ajustado antes dela.
   */
  insertImages: async (paths, seconds) => {
    if (paths.length === 0) return

    set({ busy: `Lendo ${paths.length} ${paths.length === 1 ? 'imagem' : 'imagens'}...`, error: null })
    const result = await window.dangai.importImages(paths)
    if (!result.ok) {
      set({ error: result.error, busy: null })
      return
    }

    const novas = result.value
    const { images, plan, audio } = get()

    // Sem plano ainda: entra no fim e a analise monta tudo do zero.
    if (!plan || !audio || plan.scenes.length === 0) {
      const proximas = [...images, ...novas]
      set({ images: proximas, busy: null })
      if (audio && proximas.length > 0) {
        setInterimPlan(set, proximas.length, audio.durationSec)
        await get().analyze()
      }
      return
    }

    /*
     * A insercao e por TEMPO e nao por indice: assim o mesmo caminho serve para
     * "antes deste bloco" (o instante em que ele comeca), "no meio dele" e para
     * o arraste na linha do tempo, que cai onde o ponteiro estiver.
     *
     * Cair exatamente no comeco de um bloco significa entrar ANTES dele; cair
     * no meio significa parti-lo, com a imagem nova ficando com a metade da
     * direita. Nos dois casos o tempo sai so deste bloco -- nada antes ou
     * depois dele se mexe.
     */
    const ultimo = plan.scenes[plan.scenes.length - 1]!
    const t = Math.min(Math.max(seconds, 0), ultimo.end - 1e-6)
    const h = Math.max(
      plan.scenes.findIndex((scene) => t >= scene.start && t < scene.end),
      0,
    )
    const anfitriao = plan.scenes[h]!
    const n = novas.length
    const total = anfitriao.end - anfitriao.start
    const antesDele = t <= anfitriao.start + 1e-6

    let corte: number
    let at: number

    if (antesDele) {
      // Entra na frente: o anfitriao recua e cede a cabeca do proprio intervalo.
      corte = anfitriao.start + (total * n) / (n + 1)
      at = h
    } else {
      at = h + 1
      // Aperta o corte para os dois lados continuarem visiveis. Se o bloco e
      // curto demais para isso, reparte por igual e o minimo nao se aplica.
      corte =
        total >= (n + 1) * MIN_SCENE_SEC
          ? Math.min(Math.max(t, anfitriao.start + MIN_SCENE_SEC), anfitriao.end - n * MIN_SCENE_SEC)
          : anfitriao.start + total / (n + 1)
    }

    const inicio = antesDele ? anfitriao.start : corte
    const fim = antesDele ? corte : anfitriao.end
    const passo = (fim - inicio) / n

    const inseridas: Scene[] = novas.map((_, i) => ({
      imageIndex: at + i,
      start: inicio + i * passo,
      end: i === n - 1 ? fim : inicio + (i + 1) * passo,
      effect: KEN_BURNS_EFFECTS[(at + i) % KEN_BURNS_EFFECTS.length] ?? 'zoom-in',
      intensity: 0.12,
      transitionIn: 'cut' as const,
    }))

    const reindexar = (scene: Scene): Scene => ({
      ...scene,
      imageIndex: scene.imageIndex >= at ? scene.imageIndex + n : scene.imageIndex,
    })

    const scenes = antesDele
      ? [
          ...plan.scenes.slice(0, h).map(reindexar),
          ...inseridas,
          { ...reindexar(anfitriao), start: corte },
          ...plan.scenes.slice(h + 1).map(reindexar),
        ]
      : [
          ...plan.scenes.slice(0, h).map(reindexar),
          { ...reindexar(anfitriao), end: corte },
          ...inseridas,
          ...plan.scenes.slice(h + 1).map(reindexar),
        ]

    set({
      images: [...images.slice(0, at), ...novas, ...images.slice(at)],
      plan: { ...plan, scenes },
      planEdited: true,
      selectedScene: antesDele ? h : h + 1,
      busy: null,
    })
  },

  /**
   * Tira um bloco da linha do tempo, junto com a imagem dele. O tempo vai para
   * o vizinho, senao sobraria um buraco preto no meio do video.
   */
  removeScene: (index) => {
    const { plan, images } = get()
    const scene = plan?.scenes[index]
    if (!plan || !scene || plan.scenes.length < 2) return

    const scenes = plan.scenes
      .filter((_, i) => i !== index)
      .map((other) => ({
        ...other,
        // Reindexa: todo indice acima do removido desce um.
        imageIndex: other.imageIndex > scene.imageIndex ? other.imageIndex - 1 : other.imageIndex,
      }))

    const previous = scenes[index - 1]
    const next = scenes[index]
    if (previous) previous.end = scene.end
    else if (next) next.start = scene.start

    set({
      images: images.filter((_, i) => i !== scene.imageIndex),
      plan: { ...plan, scenes },
      planEdited: true,
      selectedScene: null,
    })
  },

  setImageFocus: (id, focusX, focusY) => {
    set((state) => ({
      images: state.images.map((image) =>
        image.id === id
          ? { ...image, focusX: clamp01(focusX), focusY: clamp01(focusY) }
          : image,
      ),
    }))
  },

  /*
   * O recorte real acontece no main, com sharp, e custa alguns centesimos --
   * caro demais para rodar a cada pixel arrastado. Enquanto o usuario arrasta,
   * so o retangulo do painel se move; a imagem do preview so e refeita quando
   * ele solta.
   */
  commitImageFocus: async (id) => {
    const image = get().images.find((item) => item.id === id)
    if (!image) return

    const result = await window.dangai.reframeImage({
      id: image.id,
      path: image.path,
      focusX: image.focusX,
      focusY: image.focusY,
    })

    if (!result.ok) {
      set({ error: result.error })
      return
    }

    // A imagem pode ter sido removida ou o foco ter mudado de novo enquanto o
    // recorte rodava; so aplica se ainda for o mesmo enquadramento.
    const current = get().images.find((item) => item.id === id)
    if (!current || current.focusX !== image.focusX || current.focusY !== image.focusY) return

    set((state) => ({
      images: state.images.map((item) =>
        item.id === id ? { ...item, url: result.value } : item,
      ),
    }))
  },

  updateScene: (index, patch) => {
    const { plan } = get()
    if (!plan) return
    const scenes = plan.scenes.map((scene, i) => (i === index ? { ...scene, ...patch } : scene))
    set({ plan: { ...plan, scenes }, planEdited: true })
  },

  /**
   * Move a fronteira entre duas cenas, respeitando o minimo dos dois lados.
   *
   * So as duas cenas vizinhas mudam -- arrastar um limite nao pode empurrar o
   * resto da timeline em cascata, senao um ajuste pequeno reorganiza o video
   * inteiro.
   */
  moveBoundary: (index, seconds) => {
    const { plan } = get()
    if (!plan || index <= 0 || index >= plan.scenes.length) return

    const previous = plan.scenes[index - 1]!
    const next = plan.scenes[index]!

    const min = previous.start + MIN_SCENE_SEC
    const max = next.end - MIN_SCENE_SEC
    if (max <= min) return

    const clamped = Math.min(Math.max(seconds, min), max)

    const scenes = plan.scenes.map((scene, i) => {
      if (i === index - 1) return { ...scene, end: clamped }
      if (i === index) return { ...scene, start: clamped }
      return scene
    })

    set({ plan: { ...plan, scenes }, planEdited: true })
  },

  setScript: async (script) => {
    const clean = script?.trim() ? script : null
    // Roteiro novo refaz as legendas do zero: manter as antigas seria misturar
    // texto de duas fontes.
    set({ script: clean, captionsEdited: false, scriptNote: null })
    await get().analyze()
  },

  openScript: (open) => set({ scriptOpen: open }),

  openCaptions: (open) => set({ captionsOpen: open }),

  /**
   * Junta blocos vizinhos. O bloco resultante vai do inicio do primeiro ao fim
   * do ultimo e carrega todas as palavras, cada uma com o proprio tempo -- o
   * realce palavra a palavra continua funcionando depois da mesclagem.
   */
  mergeCaptions: (indices) => {
    const ordered = [...new Set(indices)].sort((a, b) => a - b)
    if (ordered.length < 2) return

    const { captions } = get()
    const first = ordered[0]!
    const last = ordered.at(-1)!
    if (first < 0 || last >= captions.length) return
    // Mesclar blocos separados deixaria um buraco de tempo dentro do bloco.
    if (last - first + 1 !== ordered.length) return

    const group = captions.slice(first, last + 1)
    const merged: CaptionBlock = {
      from: group[0]!.from,
      durationInFrames: Math.max(
        group.at(-1)!.from + group.at(-1)!.durationInFrames - group[0]!.from,
        1,
      ),
      words: group.flatMap((block) => block.words),
    }

    set({
      captions: [...captions.slice(0, first), merged, ...captions.slice(last + 1)],
      captionsEdited: true,
    })
  },

  /**
   * Quebra um bloco em dois, com a palavra indicada abrindo o segundo. Os
   * tempos vem das proprias palavras, entao nenhuma legenda passa a aparecer
   * fora do momento em que e dita.
   */
  splitCaption: (index, wordIndex) => {
    const { captions } = get()
    const block = captions[index]
    if (!block) return
    if (wordIndex <= 0 || wordIndex >= block.words.length) return

    const head = block.words.slice(0, wordIndex)
    const tail = block.words.slice(wordIndex)
    const cut = tail[0]!.from

    const first: CaptionBlock = {
      from: block.from,
      durationInFrames: Math.max(cut - block.from, 1),
      words: head,
    }
    const second: CaptionBlock = {
      from: cut,
      durationInFrames: Math.max(block.from + block.durationInFrames - cut, 1),
      words: tail,
    }

    set({
      captions: [...captions.slice(0, index), first, second, ...captions.slice(index + 1)],
      captionsEdited: true,
    })
  },

  editCaptionWord: (index, wordIndex, text) => {
    const { captions } = get()
    const block = captions[index]
    if (!block || !block.words[wordIndex]) return

    const words = block.words.map((word, i) => (i === wordIndex ? { ...word, text } : word))
    set({
      captions: captions.map((item, i) => (i === index ? { ...item, words } : item)),
      captionsEdited: true,
    })
  },

  resetCaptions: () => {
    set({ captions: buildCaptions(get().transcript), captionsEdited: false })
  },

  toggleSfx: () => set((state) => ({ sfxEnabled: !state.sfxEnabled })),

  refreshSfx: async () => {
    const result = await window.dangai.listSfx()
    if (result.ok) set({ sfxFiles: result.value })
  },

  setUpdate: (status) => set({ update: status }),

  setAppVersion: (version) => set({ appVersion: version }),

  toggleCaptions: () => set((state) => ({ captionsEnabled: !state.captionsEnabled })),

  openPalette: (open) => set({ paletteOpen: open }),

  selectScene: (index) => set({ selectedScene: index }),

  selectImage: (id) => {
    const { images, plan } = get()
    const imageIndex = images.findIndex((image) => image.id === id)
    if (imageIndex < 0 || !plan) {
      set({ selectedScene: null })
      return
    }
    const scene = plan.scenes.findIndex((item) => item.imageIndex === imageIndex)
    set({ selectedScene: scene >= 0 ? scene : null })
  },

  setPlayhead: (seconds) =>
    set((state) => ({
      playhead: Math.min(Math.max(seconds, 0), state.audio?.durationSec ?? 0),
    })),

  togglePlay: () => set((state) => ({ playing: !state.playing })),

  setPlaying: (playing) => set({ playing }),

  startRender: async () => {
    const { audio, images, plan, sfxEnabled, sfxFiles, captionsEnabled, captions } = get()
    if (!audio || images.length === 0 || !plan) return

    set({
      playing: false,
      error: null,
      render: { progress: 0, stage: 'bundling', message: 'Preparando...' },
    })

    const result = await window.dangai.startRender({
      props: toRenderProps(plan, images, captionsEnabled ? captions : []),
      audioPath: audio.path,
      durationInFrames: totalFrames(audio.durationSec),
      // Os cues sao montados aqui e nao guardados no plano: eles dependem dos
      // arquivos que estao na pasta AGORA, e o usuario pode ter acabado de
      // trocar os sons sem refazer a analise.
      sfxCues: sfxEnabled ? sfxCuesFor(plan.scenes, sfxFiles) : [],
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
      captions: [],
      aiNote: null,
      script: null,
      scriptNote: null,
      scriptOpen: false,
      captionsEdited: false,
      captionsOpen: false,
      busy: null,
      error: null,
      playhead: 0,
      playing: false,
      selectedScene: null,
      render: null,
      lastOutput: null,
      planEdited: false,
    }),
}))

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.5
}

/** mm:ss.cc — o formato de timecode usado em toda a interface. */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const minutes = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  const centis = Math.floor((safe % 1) * 100)
  return `${minutes}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}
