import { create } from 'zustand'
import { classifyFile } from '@shared/channels'
import type {
  AutomountBlock,
  AutomountMode,
  ScriptBlock,
  LibraryIndex,
  MusicPick,
  Nickname,
  UpdateStatus,
} from '@shared/channels'
import {
  CAPTION_COLOR_DEFAULT,
  CAPTION_Y_DEFAULT,
  CAPTION_Y_MAX,
  CAPTION_Y_MIN,
  END_CARD_SEC_DEFAULT,
  HOOK_SEC_DEFAULT,
  CLIP_INTENSITY,
  CLIP_MOTION_CURVE,
  KEN_BURNS_EFFECTS,
  MOTION_CURVE_DEFAULT,
  MUSIC_GAIN_DB_DEFAULT,
  MUSIC_GAIN_DB_MAX,
  MUSIC_GAIN_DB_MIN,
} from '@shared/contract'
import type {
  AudioAnalysis,
  CaptionColor,
  ImageAsset,
  MotionCurve,
  Metadata,
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
import { PROJECT_FILE_VERSION, type ProjectFile } from '@shared/project-file'
import { semSujar } from './quiet'

/** Estados da interface. Existem tres, e nao mais que tres. */
export type Phase = 'empty' | 'editing' | 'rendering'

/** Um projeto na fila de render. */
export interface QueueItem {
  path: string
  fileName: string
  status: 'pendente' | 'renderizando' | 'pronto' | 'falhou'
  /** MP4 gerado, quando deu certo. */
  output: string | null
  /** Por que falhou. A fila continua nos outros mesmo assim. */
  error: string | null
}

export interface ProjectState {
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
  /** O que aconteceu com as pastas, quando o usuario soltou pastas. */
  sectionNote: string | null
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
  /**
   * Texto do gancho e do fechamento, e por quantos segundos cada um fica.
   *
   * Vazio significa "sem card". Os segundos ficam guardados mesmo com o texto
   * vazio para o usuario nao ter que reajustar toda vez que apagar e reescrever.
   */
  hookText: string
  hookSec: number
  endText: string
  endSec: number
  /** Titulo, descricao e hashtags gerados. null enquanto nao foram pedidos. */
  metadata: Metadata | null
  /** Cama de musica por baixo da narracao. null quando nao ha nenhuma. */
  music: MusicPick | null
  /** Quantos dB abaixo do fundo de escala a musica entra. Sempre negativo. */
  musicGainDb: number
  sfxEnabled: boolean
  /** Arquivos de som disponiveis na pasta de SFX. */
  sfxFiles: string[]
  /** Andamento da atualizacao do app. null enquanto nada foi dito. */
  update: UpdateStatus | null
  appVersion: string
  captionsEnabled: boolean
  /** Cor do marcador de palavra na legenda queimada. */
  captionColor: CaptionColor
  /** Altura da legenda na tela, fracao a partir do rodape. */
  captionY: number
  paletteOpen: boolean

  /**
   * Biblioteca de cenas do AnCut.
   *
   * Mora na store e nao no componente porque a varredura custa uma leitura de
   * disco e o indice inteiro passa pela ponte: reler isso a cada vez que a tela
   * abre seria jogar fora trabalho ja feito.
   */
  libraryOpen: boolean
  library: LibraryIndex | null
  /** Texto de andamento da varredura, ou null. */
  libraryBusy: string | null
  libraryError: string | null

  /**
   * Como ele chama cada personagem quando escreve o roteiro, por serie.
   *
   * Mora no estado global e nao na tela porque o leitor de roteiro vai precisar
   * disto na hora de montar o video -- muito depois de a Biblioteca ter fechado.
   */
  nicknames: Record<string, Nickname[]>
  nicknamesBusy: boolean

  /**
   * A proposta da montagem automatica, bloco a bloco.
   *
   * Fica no estado depois de aplicada porque a FITA de candidatos e o que faz a
   * proposta ser revisavel: sem ela, trocar uma cena de que ele nao gostou
   * voltaria a ser uma busca na biblioteca inteira. null quando o projeto nao
   * veio da montagem automatica.
   */
  automountBlocks: AutomountBlock[] | null
  automountMode: AutomountMode | null
  /** Serie escolhida para a proxima montagem. null = deduzir do roteiro. */
  automountSeries: string | null

  /**
   * O roteiro quebrado em frases, com o tempo de cada uma.
   *
   * Existe para a Biblioteca poder mostrar ONDE cada cena marcada vai cair.
   * Antes disso a escolha dele era uma fila sem destino: ele marcava as cenas e
   * quem decidia o momento de cada uma era a distribuicao automatica -- nas
   * palavras dele, "hoje e meio aleatorio ne?!".
   */
  scriptBlocks: ScriptBlock[] | null
  scriptBlocksBusy: string | null
  /** Qual frase esta recebendo cenas agora. */
  activeBlock: number | null
  /** frase -> caminhos das cenas dela, na ordem em que ele marcou. */
  blockClips: Record<number, string[]>

  /**
   * Projetos esperando para renderizar, um atras do outro.
   *
   * A fila abre cada projeto de verdade e usa exatamente o mesmo caminho de
   * render do botao -- por isso um video da fila sai identico ao mesmo video
   * renderizado a mao. E o motivo de a fila morar aqui e nao no main.
   */
  queue: QueueItem[]
  queueRunning: boolean

  /** Caminho do .dangai aberto. null enquanto o projeto nunca foi salvo. */
  projectPath: string | null
  /** Ha edicao que ainda nao foi para o arquivo do usuario. */
  projectDirty: boolean
  /** Sobrou trabalho da ultima sessao. So consultado no estado vazio. */
  hasAutosave: boolean

  phase: () => Phase
  /** `parte` nomeia uma parte do roteiro para este material. So a Biblioteca usa. */
  ingest: (paths: readonly string[], parte?: string) => Promise<void>
  /** Troca efeito, transicao, intensidade ou curva de uma cena. */
  updateScene: (
    index: number,
    patch: Partial<Pick<Scene, 'effect' | 'transitionIn' | 'intensity' | 'curve'>>,
  ) => void
  /** Joga a curva de uma cena em todas as outras. */
  applyCurveToAll: (curve: MotionCurve) => void
  /** Move a fronteira entre a cena index-1 e a cena index. */
  moveBoundary: (index: number, seconds: number) => void
  toggleSfx: () => void
  /** Texto e duracao dos cards de abertura e fechamento. */
  setCard: (qual: 'hook' | 'end', patch: { text?: string; seconds?: number }) => void
  /** Pede titulo, descricao e hashtags a partir do roteiro. */
  generateMetadata: () => Promise<void>
  /** Abre o dialogo e passa a usar a faixa escolhida como cama. */
  pickMusic: () => Promise<void>
  clearMusic: () => void
  setMusicGain: (db: number) => void
  /** Recarrega a lista de sons. Chamada na abertura e ao voltar das settings. */
  refreshSfx: () => Promise<void>
  setUpdate: (status: UpdateStatus) => void
  setAppVersion: (version: string) => void
  toggleCaptions: () => void
  setCaptionColor: (color: CaptionColor) => void
  setCaptionY: (y: number) => void
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
  /** Abre a biblioteca. A primeira abertura varre sozinha. */
  openLibrary: (open: boolean) => Promise<void>
  /** Rele a biblioteca: episodio novo entra, episodio conhecido sai do cache. */
  syncLibrary: () => Promise<void>
  /** Andamento vindo do main durante a varredura. */
  setLibraryBusy: (mensagem: string | null) => void
  loadNicknames: () => Promise<void>
  /** Grava a lista inteira de uma serie. Lista vazia apaga a serie. */
  saveNicknames: (series: string, list: readonly Nickname[]) => Promise<void>
  /**
   * Manda as cenas escolhidas para o projeto, pela mesma porta do drop.
   *
   * `parte` preenchido transforma a leva numa parte do roteiro -- e o que a
   * pasta faz no arraste, com um botao no lugar do gesto.
   */
  addFromLibrary: (paths: readonly string[], parte?: string) => Promise<void>
  /**
   * Monta o video sozinho a partir da narracao que ja esta carregada.
   *
   * Nao substitui o caminho manual: e um segundo gesto no mesmo estado vazio.
   * Depois de montar, tudo continua editavel do jeito de sempre.
   */
  automount: (mode: AutomountMode, series: string | null) => Promise<void>
  /** Troca a cena de um bloco por outro candidato da fita. */
  swapCandidate: (blockIndex: number, candidateIndex: number) => Promise<void>
  setAutomountSeries: (series: string | null) => void
  /** Le a narracao e quebra em frases. Chamada quando a Biblioteca abre. */
  loadScriptBlocks: () => Promise<void>
  setActiveBlock: (index: number | null) => void
  /** Marca ou desmarca uma cena na frase aberta. */
  toggleBlockClip: (path: string) => void
  /** Joga o roteiro montado no projeto: cada frase dividida entre as cenas dela. */
  applyBlockClips: () => Promise<void>
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
  /** Resolve com o caminho do MP4, ou null se cancelou ou falhou. */
  startRender: () => Promise<string | null>
  cancelRender: () => Promise<void>
  /** Poe projetos salvos na fila. */
  enqueue: (paths: readonly string[]) => void
  removeFromQueue: (path: string) => void
  clearQueue: () => void
  /** Renderiza a fila inteira, um projeto de cada vez. */
  runQueue: () => Promise<void>
  stopQueue: () => void
  applyRenderProgress: (progress: RenderProgress) => void
  setBusy: (message: string | null) => void
  openSettings: (open: boolean) => void
  dismissError: () => void
  reset: () => void

  /** Grava o projeto. `comoNovo` forca o dialogo de "salvar como". */
  saveProject: (comoNovo?: boolean) => Promise<void>
  /** Abre um .dangai. Sem caminho, pergunta qual. */
  openProject: (path?: string) => Promise<void>
  /** Monta o conteudo do arquivo a partir do estado atual. */
  toProjectFile: () => ProjectFile | null
  /** Verifica se sobrou trabalho da sessao anterior. */
  checkAutosave: () => Promise<void>
  /** Retoma o autosave da sessao anterior. */
  restoreAutosave: () => Promise<void>
  /** Descarta o autosave e comeca do zero. */
  discardAutosave: () => Promise<void>
  markSaved: (path: string | null) => void
}

type SetState = (partial: Partial<ProjectState>) => void

/**
 * Plano provisorio por divisao igual, aplicado no instante em que ha material.
 *
 * Serve para o preview e a timeline terem o que mostrar enquanto a analise
 * roda -- e, principalmente, para `plan` nunca precisar ser derivado dentro de
 * um seletor.
 */
/**
 * O plano em que cada bloco dura exatamente a frase que escolheu o clipe dele.
 *
 * E o unico plano do app onde o corte e o conteudo vieram da mesma decisao: nos
 * outros as imagens sao distribuidas POR CIMA de uma narracao que ja existia.
 * Por isso os tempos vem dos blocos e nao passam por redistribuicao.
 *
 * O fim do ultimo bloco e esticado ate a narracao acabar. Sem isso o video
 * terminaria na ultima frase transcrita e cortaria o respiro final -- foi
 * exatamente o defeito que ele achou testando a v1.6.
 */
function planoDosBlocos(
  blocos: readonly AutomountBlock[],
  durationSec: number,
): ScenePlan {
  const scenes: Scene[] = blocos.map((bloco, index) => ({
    imageIndex: index,
    start: index === 0 ? 0 : bloco.start,
    end: index === blocos.length - 1 ? Math.max(bloco.end, durationSec) : bloco.end,
    /*
     * Clipe tambem entra com movimento, em ritmo constante.
     *
     * Tudo que sai daqui e clipe, entao o rodizio de efeito e o mesmo do print
     * -- o que muda e a curva e a intensidade. Remover o movimento de um bloco
     * especifico continua sendo um clique no card da cena.
     */
    effect: KEN_BURNS_EFFECTS[index % KEN_BURNS_EFFECTS.length]!,
    intensity: CLIP_INTENSITY,
    curve: CLIP_MOTION_CURVE,
    transitionIn: 'cut',
  }))
  return { scenes }
}

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
  sectionNote: null,
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
  hookText: '',
  hookSec: HOOK_SEC_DEFAULT,
  endText: '',
  endSec: END_CARD_SEC_DEFAULT,
  metadata: null,
  music: null,
  musicGainDb: MUSIC_GAIN_DB_DEFAULT,
  sfxEnabled: true,
  sfxFiles: [],
  update: null,
  appVersion: '',
  captionsEnabled: false,
  captionColor: CAPTION_COLOR_DEFAULT,
  captionY: CAPTION_Y_DEFAULT,
  paletteOpen: false,
  libraryOpen: false,
  library: null,
  automountBlocks: null,
  automountMode: null,
  automountSeries: null,
  scriptBlocks: null,
  scriptBlocksBusy: null,
  activeBlock: null,
  blockClips: {},
  libraryBusy: null,
  libraryError: null,
  nicknames: {},
  nicknamesBusy: false,
  queue: [],
  queueRunning: false,
  projectPath: null,
  projectDirty: false,
  hasAutosave: false,

  phase: () => {
    const state = get()
    if (state.render && ['bundling', 'rendering', 'muxing'].includes(state.render.stage)) {
      return 'rendering'
    }
    return state.audio || state.images.length > 0 ? 'editing' : 'empty'
  },

  ingest: async (paths, parte) => {
    const audioPaths: string[] = []
    const imagePaths: string[] = []
    /** A parte de cada arquivo visual, na mesma ordem de imagePaths. */
    const imageSections: ({ index: number; name: string } | null)[] = []
    const subtitlePaths: string[] = []
    const scriptPaths: string[] = []
    const projectPaths: string[] = []
    const ignored: string[] = []

    /*
     * Pasta vira PARTE do roteiro; arquivo continua arquivo.
     *
     * O renderer so recebe caminho como texto e nao pode olhar o disco, entao
     * quem resolve isso e o main. Antes disso pasta era simplesmente ignorada no
     * drop -- por isso nada do caminho antigo muda de comportamento aqui.
     *
     * Quando o main nao consegue responder, o `for` abaixo assume sozinho: o
     * caminho de arquivo solto nao depende disto para nada.
     */
    const expandido = await window.dangai.expandDrop(paths)
    const expansao = expandido.ok ? expandido.value : { files: [], sections: [] }

    /*
     * As partes novas continuam a numeracao das que ja estao no projeto.
     *
     * Sem isto uma segunda entrada de material recomecaria do zero e as partes
     * se fundiriam duas a duas -- o material da parte 1 de agora cairia junto
     * com o da parte 1 de antes, e a distribuicao sairia errada sem avisar.
     */
    const jaUsadas = get()
      .images.map((image) => image.section)
      .filter((s): s is number => s !== null)
    const base = jaUsadas.length > 0 ? Math.max(...jaUsadas) + 1 : 0

    expansao.sections.forEach((section, index) => {
      for (const file of section.files) {
        imagePaths.push(file)
        imageSections.push({ index: base + index, name: section.name })
      }
    })

    // Material sem pasta so vira parte quando alguem pediu por nome -- e a
    // Biblioteca, que nao tem pasta para oferecer como gesto.
    const daLeva = parte ? { index: base + expansao.sections.length, name: parte } : null
    for (const file of expansao.files) {
      imagePaths.push(file)
      imageSections.push(daLeva)
    }

    for (const path of paths) {
      switch (classifyFile(path)) {
        case 'audio':
          audioPaths.push(path)
          break
        case 'image':
        // Clipe entra na MESMA lista dos prints, na ordem em que foi solto.
        // Ele nao e uma segunda esteira: e um bloco como qualquer outro, e a
        // narracao continua mandando na duracao.
        case 'video':
          // Ja veio pela expansao acima -- que resolve pasta E arquivo solto.
          // So entra aqui se o main nao respondeu, e ai nao ha o que duplicar.
          if (!expandido.ok) {
            imagePaths.push(path)
            imageSections.push(null)
          }
          break
        case 'subtitle':
          subtitlePaths.push(path)
          break
        case 'script':
          scriptPaths.push(path)
          break
        case 'project':
          projectPaths.push(path)
          break
        default:
          ignored.push(path)
      }
    }

    /*
     * Projeto salvo tem caminho proprio: soltar UM abre; soltar VARIOS enfileira.
     *
     * A regra sai do que a acao quer dizer. Ninguem solta cinco projetos para
     * abrir cinco -- so cabe um na tela. Soltar cinco quer dizer "renderize
     * esses".
     */
    if (projectPaths.length > 0) {
      set({ error: null })
      if (projectPaths.length === 1 && paths.length === 1) {
        await get().openProject(projectPaths[0]!)
      } else {
        get().enqueue(projectPaths)
      }
      return
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
      // Roteiro novo muda onde cada frase comeca e acaba: o que estava lido
      // deixa de valer.
      if (result.ok) {
        set({ script: result.value, captionsEdited: false, scriptBlocks: null, blockClips: {} })
      }
      else set({ error: result.error })
    }

    if (imagePaths.length > 0) {
      set({ busy: `Lendo ${imagePaths.length} ${imagePaths.length === 1 ? 'imagem' : 'imagens'}...` })
      const temParte = imageSections.some((s) => s !== null)
      const result = await window.dangai.importImages(
        imagePaths,
        undefined,
        temParte ? imageSections : undefined,
      )
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
        /*
         * Narracao nova zera o roteiro lido e o que ele marcou nele.
         *
         * Os tempos das frases sao medidos NAQUELE audio -- mantidos, apontariam
         * para instantes que nao existem mais, e as cenas marcadas cairiam em
         * lugar nenhum sem nada na tela dizendo por que.
         */
        set({
          audio: result.value,
          playhead: 0,
          scriptBlocks: null,
          activeBlock: null,
          blockClips: {},
        })
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

  automount: async (mode, series) => {
    const { audio, subtitlePath, script } = get()
    if (!audio) {
      set({ error: 'Carregue a narracao antes de montar sozinho.' })
      return
    }

    set({ busy: 'Montando...', error: null })

    const proposta = await window.dangai.automount({
      audioPath: audio.path,
      subtitlePath,
      script,
      mode,
      series,
    })
    if (!proposta.ok) {
      set({ busy: null, error: proposta.error })
      return
    }

    const { blocks, note, scriptNote, transcript } = proposta.value
    const uteis = blocks.filter((b) => b.candidates.length > 0)
    if (uteis.length === 0) {
      set({
        busy: null,
        error:
          series
            ? `Nao ha cena de "${series}" para nenhum bloco desta narracao.`
            : 'A biblioteca nao tem cena para nenhum bloco desta narracao. Confira a pasta das cenas nas configuracoes.',
      })
      return
    }

    set({ busy: `Trazendo ${uteis.length} cenas...` })
    const importadas = await window.dangai.importImages(uteis.map((b) => b.candidates[0]!.path))
    if (!importadas.ok) {
      set({ busy: null, error: importadas.error })
      return
    }

    set({
      images: importadas.value,
      plan: planoDosBlocos(uteis, audio.durationSec),
      planOrigin: 'auto',
      /*
       * Marcado como editado de proposito. O plano da montagem automatica sai
       * das FRASES da narracao; qualquer reanalise o substituiria por uma
       * distribuicao por cima, e a cena deixaria de casar com a frase que a
       * escolheu.
       */
      planEdited: true,
      automountBlocks: blocks,
      automountMode: mode,
      /*
       * A transcricao vem junto da proposta, e nao de uma segunda analise.
       *
       * Transcrever de novo custaria outra passada de Whisper pelo mesmo audio
       * E daria um texto PIOR: so a passada da montagem leva os nomes da
       * biblioteca como vocabulario. Medido: com vocabulario sai "ichigo", sem
       * sai "Ischigo" -- e a legenda contradiria o corte que aquele mesmo nome
       * decidiu.
       */
      transcript,
      captions: buildCaptions(transcript),
      captionsEdited: false,
      scriptNote,
      sectionNote: note,
      aiNote: null,
      selectedScene: null,
      busy: null,
    })
  },

  setAutomountSeries: (series) => set({ automountSeries: series }),

  loadScriptBlocks: async () => {
    const { audio, subtitlePath, script, scriptBlocks, scriptBlocksBusy } = get()
    // Ja lido, ou lendo: transcrever de novo custaria outra passada de Whisper
    // pelo mesmo audio para chegar no mesmo texto.
    if (!audio || scriptBlocks || scriptBlocksBusy) return

    set({ scriptBlocksBusy: 'Ouvindo a narracao...' })
    const r = await window.dangai.scriptBlocks({
      audioPath: audio.path,
      subtitlePath,
      script,
    })
    if (!r.ok) {
      set({ scriptBlocksBusy: null, libraryError: r.error })
      return
    }
    set({
      scriptBlocks: r.value.blocks,
      // A transcricao vem junto e fica: as legendas saem dela sem outra passada.
      transcript: r.value.transcript,
      captions: get().captionsEdited ? get().captions : buildCaptions(r.value.transcript),
      scriptNote: r.value.scriptNote,
      activeBlock: r.value.blocks.length > 0 ? 0 : null,
      scriptBlocksBusy: null,
    })
  },

  setActiveBlock: (index) => set({ activeBlock: index }),

  toggleBlockClip: (path) => {
    const { activeBlock, blockClips } = get()
    if (activeBlock === null) return
    const atuais = blockClips[activeBlock] ?? []
    /*
     * A ordem e a de MARCACAO, nao a da grade.
     *
     * Dentro de uma frase a ordem e a do argumento dele -- a grade so sabe a
     * ordem do episodio, que em video de teoria nao quer dizer nada.
     */
    const proximos = atuais.includes(path)
      ? atuais.filter((p) => p !== path)
      : [...atuais, path]
    set({ blockClips: { ...blockClips, [activeBlock]: proximos } })
  },

  applyBlockClips: async () => {
    const { scriptBlocks, blockClips, audio } = get()
    if (!scriptBlocks || !audio) return

    /*
     * Cada frase se divide igualmente entre as cenas que ELE marcou nela.
     *
     * Igualmente e nao por pausa: dentro de uma frase nao ha pontuacao para
     * consultar, e inventar um ritmo aqui seria decidir por ele exatamente onde
     * ele acabou de pedir para decidir. Frase sem cena nenhuma nao vira bloco --
     * o tempo dela e absorvido pela cena anterior, que so fica mais longa.
     */
    const caminhos: string[] = []
    const spans: { start: number; end: number }[] = []
    for (const [i, frase] of scriptBlocks.entries()) {
      const cenas = blockClips[i] ?? []
      if (cenas.length === 0) continue
      const passo = (frase.end - frase.start) / cenas.length
      for (const [j, path] of cenas.entries()) {
        caminhos.push(path)
        spans.push({ start: frase.start + j * passo, end: frase.start + (j + 1) * passo })
      }
    }

    if (caminhos.length === 0) {
      set({ libraryError: 'Marque pelo menos uma cena em alguma frase.' })
      return
    }

    set({ busy: `Trazendo ${caminhos.length} cenas...`, libraryError: null })
    const importadas = await window.dangai.importImages(caminhos)
    if (!importadas.ok) {
      set({ busy: null, error: importadas.error })
      return
    }

    /*
     * As cenas se costuram: cada uma comeca onde a anterior acabou.
     *
     * Frase sem cena nenhuma deixaria um VAO -- e vao no plano e tela preta no
     * video. Costurando, o tempo da frase pulada e absorvido pela cena que vem
     * antes dela, que so fica um pouco mais longa. O primeiro bloco comeca em
     * zero e o ultimo fecha com a narracao, pelo mesmo motivo nas pontas.
     */
    const blocos = spans.map((s, i) => ({
      start: i === 0 ? 0 : spans[i - 1]!.end,
      end: i === spans.length - 1 ? Math.max(s.end, audio.durationSec) : s.end,
      text: '',
      characters: [],
      candidates: [],
    }))

    set({
      images: importadas.value,
      plan: planoDosBlocos(blocos, audio.durationSec),
      planOrigin: 'auto',
      // O plano saiu das frases dele; reanalisar o trocaria por distribuicao.
      planEdited: true,
      automountBlocks: null,
      libraryOpen: false,
      selectedScene: null,
      busy: null,
      projectDirty: true,
    })
  },

  swapCandidate: async (blockIndex, candidateIndex) => {
    const { automountBlocks, images } = get()
    const bloco = automountBlocks?.[blockIndex]
    const escolhido = bloco?.candidates[candidateIndex]
    if (!automountBlocks || !bloco || !escolhido) return

    /*
     * O indice na TIMELINE nao e o indice no roteiro: bloco sem cena nao virou
     * imagem. Contar quantos blocos uteis vieram antes e o que liga os dois.
     */
    const posicao = automountBlocks
      .slice(0, blockIndex)
      .filter((b) => b.candidates.length > 0).length
    if (!images[posicao]) return

    set({ busy: 'Trocando a cena...', error: null })
    const importada = await window.dangai.importImages([escolhido.path])
    if (!importada.ok || !importada.value[0]) {
      set({ busy: null, error: importada.ok ? 'Nao deu para abrir essa cena.' : importada.error })
      return
    }

    // A fita passa a comecar pelo escolhido, para o proximo clique na seta
    // continuar de onde ele parou em vez de voltar ao comeco.
    const reordenada = [
      escolhido,
      ...bloco.candidates.filter((_c, i) => i !== candidateIndex),
    ]

    set((state) => ({
      images: state.images.map((img, i) => (i === posicao ? importada.value[0]! : img)),
      automountBlocks: state.automountBlocks!.map((b: AutomountBlock, i: number) =>
        i === blockIndex ? { ...b, candidates: reordenada } : b,
      ),
      busy: null,
      projectDirty: true,
    }))
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
        sectionNote: result.value.sectionNote,
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
      // Herda a curva do bloco que cedeu o tempo, e nao o padrao: quem ja
      // ajustou o ritmo do video inteiro nao quer o bloco novo destoando.
      curve: anfitriao.curve,
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
          ? // Mexeu na mao, a marca de automatico sai: dali em diante o
            // enquadramento e escolha dele, e a interface para de dizer que foi
            // o detector que pos ali.
            { ...image, focusX: clamp01(focusX), focusY: clamp01(focusY), focusAuto: false }
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
   * A mesma curva em todas as cenas.
   *
   * Existe porque o projeto real dele tem 46 blocos: escolher o ritmo de camera
   * um a um seria 46 idas ao painel para uma decisao que quase sempre e do video
   * inteiro, nao de um bloco.
   */
  applyCurveToAll: (curve) => {
    const { plan } = get()
    if (!plan) return
    set({
      plan: { ...plan, scenes: plan.scenes.map((scene) => ({ ...scene, curve })) },
      planEdited: true,
    })
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

  setCard: (qual, patch) => {
    // Um card nao pode ser mais curto que o proprio fade de entrada e saida.
    const segundos = patch.seconds === undefined ? undefined : Math.min(Math.max(patch.seconds, 0.5), 10)
    if (qual === 'hook') {
      set({
        ...(patch.text !== undefined ? { hookText: patch.text } : {}),
        ...(segundos !== undefined ? { hookSec: segundos } : {}),
      })
    } else {
      set({
        ...(patch.text !== undefined ? { endText: patch.text } : {}),
        ...(segundos !== undefined ? { endSec: segundos } : {}),
      })
    }
  },

  /*
   * O roteiro escrito e a melhor fonte; a transcricao serve de plano B.
   *
   * Ler do texto e nao do video e o que mantem a promessa da spec: so o texto
   * sai da maquina, nunca o audio nem as imagens.
   */
  generateMetadata: async () => {
    const { script, transcript } = get()
    const texto = script?.trim() || transcript?.text?.trim() || ''

    if (texto.length < 40) {
      set({ error: 'Cole o roteiro para eu escrever o titulo e a descricao.' })
      return
    }

    set({ busy: 'Escrevendo titulo e descricao...', error: null })
    const result = await window.dangai.generateMetadata(texto)

    if (!result.ok) {
      set({ error: result.error, busy: null })
      return
    }
    set({ metadata: result.value, busy: null })
  },

  pickMusic: async () => {
    const result = await window.dangai.pickMusic()
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    // null = fechou o dialogo sem escolher. Nao mexe na faixa que ja havia.
    if (result.value === null) return
    set({ music: result.value })
  },

  clearMusic: () => set({ music: null }),

  setMusicGain: (db) =>
    set({
      musicGainDb: Math.min(Math.max(Math.round(db), MUSIC_GAIN_DB_MIN), MUSIC_GAIN_DB_MAX),
    }),

  refreshSfx: async () => {
    const result = await window.dangai.listSfx()
    if (result.ok) set({ sfxFiles: result.value })
  },

  setUpdate: (status) => set({ update: status }),

  setAppVersion: (version) => set({ appVersion: version }),

  toggleCaptions: () => set((state) => ({ captionsEnabled: !state.captionsEnabled })),

  setCaptionColor: (color) => set({ captionColor: color }),

  // Grampeia aqui e nao so na interface: a store tambem e chamada pelo Ctrl+K e
  // pela restauracao de projeto, e um valor fora da faixa jogaria a legenda para
  // fora da tela ou para cima do card de fechamento.
  setCaptionY: (y) => set({ captionY: Math.min(Math.max(y, CAPTION_Y_MIN), CAPTION_Y_MAX) }),

  openPalette: (open) => set({ paletteOpen: open }),

  /*
   * Abrir varre so na primeira vez. Depois disso o indice fica no estado e a
   * tela abre instantanea -- reler seria pagar de novo por uma resposta que nao
   * mudou, e o botao "Sincronizar" existe justamente para quando ela mudou.
   */
  openLibrary: async (open) => {
    set({ libraryOpen: open })
    if (!open) return
    // Os apelidos vem junto: sao poucos bytes e a tela precisa deles para dizer
    // quantos cada serie tem.
    await Promise.all([get().library ? Promise.resolve() : get().syncLibrary(), get().loadNicknames()])
  },

  loadNicknames: async () => {
    const result = await window.dangai.readNicknames()
    if (result.ok) set({ nicknames: result.value })
  },

  saveNicknames: async (series, list) => {
    set({ nicknamesBusy: true })
    const result = await window.dangai.saveNicknames(series, list)
    if (result.ok) set({ nicknames: result.value, nicknamesBusy: false })
    else set({ libraryError: result.error, nicknamesBusy: false })
  },

  // So substitui um andamento que ainda existe: a mensagem final do main pode
  // chegar depois de a varredura ter terminado e ressuscitaria o "carregando".
  setLibraryBusy: (mensagem) =>
    set((state) => (state.libraryBusy === null ? state : { libraryBusy: mensagem })),

  syncLibrary: async () => {
    set({ libraryBusy: 'Lendo a biblioteca...', libraryError: null })
    const result = await window.dangai.scanLibrary()
    if (result.ok) {
      set({ library: result.value, libraryBusy: null })
    } else {
      set({ libraryError: result.error, libraryBusy: null })
    }
  },

  /*
   * A biblioteca entrega CAMINHO, e caminho e exatamente o que o drop entrega.
   * Por isso ela reusa o ingest inteiro em vez de ter porta propria: o clipe que
   * veio da busca e o clipe que veio do Explorer sao a mesma coisa daqui para a
   * frente, com a mesma analise e o mesmo render.
   */
  /*
   * Adicionar uma PARTE deixa a biblioteca aberta; adicionar solto fecha.
   *
   * Sai do que cada acao quer dizer. Quem monta partes vai montar a proxima
   * agora, e fechar a tela a cada leva transformaria um video de cinco partes
   * em cinco reaberturas. Quem adiciona solto terminou de escolher.
   */
  addFromLibrary: async (paths, parte) => {
    if (paths.length === 0) return
    if (!parte) set({ libraryOpen: false })
    await get().ingest(paths, parte)
  },

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
    const {
      audio, images, plan, sfxEnabled, sfxFiles, captionsEnabled, captions, captionColor,
      captionY, music, musicGainDb,
    } = get()
    if (!audio || images.length === 0 || !plan) return null

    set({
      playing: false,
      error: null,
      render: { progress: 0, stage: 'bundling', message: 'Preparando...' },
    })

    const { hookText, hookSec, endText, endSec } = get()

    const result = await window.dangai.startRender({
      props: toRenderProps(
        plan,
        images,
        captionsEnabled ? captions : [],
        { hook: hookText, hookSec, end: endText, endSec },
        captionColor,
        captionY,
        // O MESMO numero que vai na composicao logo abaixo. Eram duas contas
        // separadas, e quando discordavam o fim do video ficava sem imagem.
        audio.durationSec,
      ),
      audioPath: audio.path,
      durationInFrames: totalFrames(audio.durationSec),
      // Os cues sao montados aqui e nao guardados no plano: eles dependem dos
      // arquivos que estao na pasta AGORA, e o usuario pode ter acabado de
      // trocar os sons sem refazer a analise.
      sfxCues: sfxEnabled ? sfxCuesFor(plan.scenes, sfxFiles) : [],
      music: music ? { path: music.path, gainDb: musicGainDb } : null,
    })

    if (!result.ok) {
      set({ error: result.error, render: null })
      return null
    }
    // value === null significa que o usuario cancelou. Nao e erro, e o evento
    // 'cancelled' ja limpou o estado -- so garantimos que nada ficou pendurado.
    if (result.value === null) {
      set({ render: null })
      return null
    }
    return result.value
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
      sectionNote: null,
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
      automountBlocks: null,
      automountMode: null,
      automountSeries: null,
      scriptBlocks: null,
      scriptBlocksBusy: null,
      activeBlock: null,
      blockClips: {},
      music: null,
      musicGainDb: MUSIC_GAIN_DB_DEFAULT,
      hookText: '',
      hookSec: HOOK_SEC_DEFAULT,
      endText: '',
      endSec: END_CARD_SEC_DEFAULT,
      metadata: null,
      projectPath: null,
      projectDirty: false,
    }),

  // ------------------------------------------------------------------ projeto

  toProjectFile: () => {
    const state = get()
    if (!state.audio) return null

    // `rel` sai null daqui: quem sabe para onde o arquivo esta indo e o main,
    // que recalcula todos na hora de gravar. "Salvar como" em outra pasta
    // reescreve os caminhos relativos sem o renderer participar.
    return {
      version: PROJECT_FILE_VERSION,
      savedAt: new Date().toISOString(),
      audio: { path: state.audio.path, rel: null, fileName: state.audio.fileName },
      images: state.images.map((image) => ({
        path: image.path,
        rel: null,
        fileName: image.fileName,
        focusX: image.focusX,
        focusY: image.focusY,
        focusAuto: image.focusAuto,
        section: image.section,
        sectionName: image.sectionName,
      })),
      script: state.script,
      subtitle: state.subtitlePath
        ? {
            path: state.subtitlePath,
            rel: null,
            fileName: state.subtitlePath.split(/[\\/]/).pop() ?? '',
          }
        : null,
      plan: state.plan,
      planOrigin: state.planOrigin,
      planEdited: state.planEdited,
      transcript: state.transcript,
      captions: state.captions,
      captionsEdited: state.captionsEdited,
      captionsEnabled: state.captionsEnabled,
      captionColor: state.captionColor,
      captionY: state.captionY,
      sfxEnabled: state.sfxEnabled,
      music: state.music
        ? { path: state.music.path, rel: null, fileName: state.music.fileName }
        : null,
      musicGainDb: state.musicGainDb,
      hookText: state.hookText,
      hookSec: state.hookSec,
      endText: state.endText,
      endSec: state.endSec,
      metadata: state.metadata,
    }
  },

  saveProject: async (comoNovo) => {
    const state = get()
    const file = state.toProjectFile()
    if (!file || !state.audio) {
      set({ error: 'Nao ha projeto para salvar. Solte a narracao e as imagens primeiro.' })
      return
    }

    const result = await window.dangai.saveProject({
      path: comoNovo ? null : state.projectPath,
      file,
      suggestedName: state.audio.fileName.replace(/\.[^.]+$/, ''),
    })

    if (!result.ok) {
      set({ error: result.error })
      return
    }
    // null = fechou o dialogo. Cancelar nao e erro e nao vira mensagem.
    if (result.value === null) return

    get().markSaved(result.value)
  },

  openProject: async (path) => {
    const result = await window.dangai.openProject(path ?? null)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    if (result.value === null) return

    await applyProjectFile(set, result.value.file, result.value.path, false)
  },

  checkAutosave: async () => {
    const result = await window.dangai.readAutosave()
    set({ hasAutosave: result.ok && result.value !== null })
  },

  restoreAutosave: async () => {
    const result = await window.dangai.readAutosave()
    if (!result.ok) {
      set({ error: result.error, hasAutosave: false })
      return
    }
    if (result.value === null) {
      set({ hasAutosave: false })
      return
    }

    // Sujo de proposito: o autosave e, por definicao, mais novo que o ultimo
    // save de verdade. Marcar limpo faria o app dizer que nao ha nada a gravar
    // justamente sobre o trabalho que quase se perdeu.
    await applyProjectFile(set, result.value.file, result.value.path, true)
  },

  discardAutosave: async () => {
    await window.dangai.clearAutosave()
    set({ hasAutosave: false })
  },

  markSaved: (path) => set({ projectPath: path, projectDirty: false, hasAutosave: false }),

  // --------------------------------------------------------------------- fila

  enqueue: (paths) => {
    const existentes = new Set(get().queue.map((item) => item.path))
    const novos: QueueItem[] = paths
      .filter((path) => !existentes.has(path))
      .map((path) => ({
        path,
        fileName: path.split(/[\\/]/).pop()?.replace(/\.dangai$/i, '') ?? path,
        status: 'pendente' as const,
        output: null,
        error: null,
      }))

    if (novos.length === 0) return
    set((state) => ({ queue: [...state.queue, ...novos] }))
  },

  removeFromQueue: (path) =>
    set((state) => ({ queue: state.queue.filter((item) => item.path !== path) })),

  clearQueue: () => set({ queue: [] }),

  stopQueue: () => set({ queueRunning: false }),

  /**
   * Renderiza a fila abrindo cada projeto de verdade.
   *
   * Parece indireto e e de proposito: abrir e renderizar pelo mesmo caminho da
   * interface garante que um video da fila saia identico ao mesmo video
   * renderizado a mao. Um segundo caminho de montagem no main seria outra
   * implementacao para manter em dia -- e o dia em que as duas divergissem, o
   * usuario descobriria pelo arquivo errado.
   *
   * Um projeto que falha nao para a fila: os outros continuam, e o erro fica
   * registrado no item. Quem deixou cinco projetos rodando de madrugada quer
   * quatro videos e um aviso, nao zero videos.
   */
  runQueue: async () => {
    if (get().queueRunning) return
    if (get().queue.every((item) => item.status !== 'pendente')) return

    // A fila abre outro projeto por cima deste. Trabalho nao salvo morreria ai.
    if (get().projectDirty && get().audio) {
      set({ error: 'Salve o projeto aberto antes de rodar a fila (Ctrl+S).' })
      return
    }

    set({ queueRunning: true, error: null })

    const marcar = (path: string, patch: Partial<QueueItem>): void => {
      set((state) => ({
        queue: state.queue.map((item) => (item.path === path ? { ...item, ...patch } : item)),
      }))
    }

    while (get().queueRunning) {
      const proximo = get().queue.find((item) => item.status === 'pendente')
      if (!proximo) break

      marcar(proximo.path, { status: 'renderizando', error: null })

      await get().openProject(proximo.path)
      const erroAoAbrir = get().error
      if (erroAoAbrir) {
        marcar(proximo.path, { status: 'falhou', error: erroAoAbrir })
        set({ error: null })
        continue
      }

      const saida = await get().startRender()
      if (saida) {
        marcar(proximo.path, { status: 'pronto', output: saida })
      } else {
        marcar(proximo.path, {
          status: 'falhou',
          error: get().error ?? 'O render nao terminou.',
        })
        set({ error: null })
      }
    }

    set({ queueRunning: false })
  },
}))

/**
 * Reconstroi o estado a partir de um arquivo de projeto.
 *
 * Miniatura, recorte e URL nao vem do arquivo -- sao refeitos a partir dos
 * originais no disco. Por isso abrir custa quase o mesmo que importar, e por
 * isso o .dangai fica em kilobytes em vez de dezenas de megabytes.
 */
async function applyProjectFile(
  set: SetState,
  file: ProjectFile,
  path: string | null,
  sujo: boolean,
): Promise<void> {
  await semSujar(async () => {
    set({ busy: 'Abrindo projeto...', error: null })

    const audio = await window.dangai.analyzeAudio(file.audio.path)
    if (!audio.ok) {
      set({ error: audio.error, busy: null })
      return
    }

    const images = await window.dangai.importImages(
      file.images.map((image) => image.path),
      file.images.map((image) => ({
        focusX: image.focusX,
        focusY: image.focusY,
        focusAuto: image.focusAuto,
      })),
      // As partes voltam junto. Projeto salvo antes disto existir nao tem o
      // campo, o schema devolve null, e o `undefined` abaixo desliga o caminho
      // das partes exatamente como era antes.
      file.images.some((image) => image.section !== null)
        ? file.images.map((image) =>
            image.section === null
              ? null
              : { index: image.section, name: image.sectionName ?? `Parte ${image.section + 1}` },
          )
        : undefined,
    )
    if (!images.ok) {
      set({ error: images.error, busy: null })
      return
    }

    /*
     * A musica precisa de URL nova: o .dangai guarda o caminho, mas a URL do
     * servidor local carrega um id sorteado que morre com a sessao.
     *
     * Faixa que sumiu do disco nao impede o projeto de abrir -- o main ja
     * devolve `music: null` nesse caso, e o campo aparece vazio na interface.
     */
    let music: MusicPick | null = null
    if (file.music) {
      const carregada = await window.dangai.loadMusic(file.music.path)
      if (carregada.ok) music = carregada.value
    }

    set({
      audio: audio.value,
      images: images.value,
      music,
      musicGainDb: file.musicGainDb,
      hookText: file.hookText,
      hookSec: file.hookSec,
      endText: file.endText,
      endSec: file.endSec,
      metadata: file.metadata,
      script: file.script,
      subtitlePath: file.subtitle?.path ?? null,
      plan: file.plan,
      planOrigin: file.planOrigin,
      planEdited: file.planEdited,
      transcript: file.transcript,
      captions: file.captions,
      captionsEdited: file.captionsEdited,
      captionsEnabled: file.captionsEnabled,
      captionColor: file.captionColor,
      captionY: file.captionY,
      sfxEnabled: file.sfxEnabled,

      // Nada de estado de sessao atravessa a abertura: o render anterior nao e
      // deste projeto, e um erro antigo na barra confundiria com falha ao abrir.
      playhead: 0,
      playing: false,
      selectedScene: null,
      render: null,
      lastOutput: null,
      aiNote: null,
      // O aviso do roteiro sai da analise, que nao roda de novo aqui. Manter o
      // texto antigo seria afirmar um resultado que esta sessao nao mediu.
      scriptNote: null,
      busy: null,

      projectPath: path,
      projectDirty: sujo,
      hasAutosave: false,
    })
  })
}

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
