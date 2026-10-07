import { create } from 'zustand'
import { classifyFile } from '@shared/channels'
import type {
  AutomountBlock,
  AutomountMode,
  LibraryClip,
  ScriptBlock,
  LibraryIndex,
  MusicPick,
  Nickname,
  SceneDescription,
  UpdateStatus,
} from '@shared/channels'
import {
  CURVA_DA_ENTRADA_PADRAO,
  curvaDaEntradaSchema,
  type CurvaDaEntrada,
  REGRAS_DA_LEGENDA_PADRAO,
  regrasDaLegendaSchema,
  duracaoDoTrecho,
  type RegrasDaLegenda,
  type CaptionPreset,
  type CurvaGuardada,
  type Bin,
  CAPTION_ANIMATION_DEFAULT,
  CAPTION_ANIMATION_FRAMES_DEFAULT,
  CAPTION_ANIMATION_FRAMES_MAX,
  CAPTION_ANIMATION_FRAMES_MIN,
  CAPTION_MARK_DEFAULT,
  CAPTION_SHADOW_DEFAULT,
  CAPTION_STROKE_DEFAULT,
  CAPTION_STROKE_MAX,
  CAPTION_STROKE_MIN,
  SFX_GAIN_MAX,
  SFX_GAIN_MIN,
  SFX_MINIMO_SEC,
  VIDEO_FPS,
  CAPTION_COLOR_DEFAULT,
  familiaDaFonte,
  CAPTION_Y_DEFAULT,
  CAPTION_Y_MAX,
  CAPTION_Y_MIN,
  CAPTION_SCALE_DEFAULT,
  CAPTION_SCALE_MAX,
  CAPTION_SCALE_MIN,
  END_CARD_SEC_DEFAULT,
  HOOK_SEC_DEFAULT,
  CLIP_INTENSITY,
  CLIP_MOTION_CURVE,
  KEN_BURNS_EFFECTS,
  MOTION_CURVE_DEFAULT,
  AJUSTE_DE_COR_PADRAO,
  MUSIC_GAIN_DB_DEFAULT,
  MUSIC_FADE_IN_SEC,
  MUSIC_FADE_OUT_SEC,
  MUSIC_GAIN_DB_MAX,
  MUSIC_GAIN_DB_MIN,
  FORMATO_PADRAO,
  medidasDo,
} from '@shared/contract'
import type {
  AudioAnalysis,
  TrechoDeAudioSalvo,
  SobreposicaoSalva,
  Word,
  Formato,
  CaptionAnimation,
  CaptionColor,
  CaptionMark,
  CaptionShadow,
  CurvePoints,
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
  alvoDoRastreio,
  chavesDoCaminho,
  enquadrar,
  fonteDaCamera,
  janelaDaCamera,
} from '@shared/camera'
import {
  buildCaptions,
  cutCandidatesFrom,
  imagemDaMetade,
  reordenarBlocos,
  MIN_SCENE_SEC,
  planEqualSplit,
  sfxCuesFor,
  toRenderProps,
  totalFrames,
} from '@shared/plan'
import type { CaptionBlock } from '@shared/contract'
import { PROJECT_FILE_VERSION, type ProjectFile } from '@shared/project-file'
import { herdarAjustes, reaproveitar } from '@shared/remontar'
import { retemporizar } from '@shared/legendas'
import { abrirEspaco, removerCena, repararMetadesDeBaixo } from '@shared/indices'
import {
  juntarComOProximo,
  separarTrecho as separarPedacos,
  tirarDaFita,
  type MarcacoesDosTrechos,
} from '@shared/juntar'
import {
  cabeCortePorPalavra,
  cortesAutomaticos,
  limitesDaFronteira,
  palavrasDoTrecho,
  prender,
  slotsDoTrecho,
  spansDoTrecho,
} from '@shared/trecho'
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
  /**
   * Vertical ou horizontal, escolhido ao criar o projeto.
   *
   * Decide o QUADRO, e o quadro decide quase tudo depois: o recorte das
   * imagens, a geometria da camera, o tamanho da composicao e se ha legenda.
   */
  formato: Formato
  selectedScene: number | null
  /**
   * TODOS os blocos selecionados, incluindo a ancora.
   *
   * A ancora (`selectedScene`) continua sendo quem o painel edita: um painel que
   * tentasse mostrar cinco blocos de uma vez nao mostraria nenhum. Esta lista e
   * para as acoes em LOTE -- colar ajustes, espalhar a curva -- e e ela que a
   * timeline destaca.
   *
   * Vazia quando nao ha nada selecionado. Toda operacao que mexe na ESTRUTURA
   * do plano a esvazia: dividir, apagar ou inserir bloco desloca os indices, e
   * uma selecao velha passaria a apontar para os blocos errados -- colar
   * ajustes em cima deles seria estragar trabalho sem ninguem ver.
   */
  selecionados: number[]
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
  /**
   * A fonte escolhida para as legendas, das que ele largou na pasta.
   *
   * null = a embutida, que e o padrao e o que o app sempre fez. Guarda o NOME
   * do arquivo junto com a URL: o nome e o que sobrevive no projeto salvo, a
   * URL morre com a sessao que a criou.
   */
  captionFont: { nome: string; url: string } | null
  /** As fontes disponiveis na pasta. Lida na abertura e ao voltar das settings. */
  fontes: { nome: string; url: string }[]
  /** Como a legenda entra na tela. 'nenhuma' e o padrao. */
  captionAnimation: CaptionAnimation
  /** Quantos frames a entrada elastica leva. Menos = mais rapida. */
  captionAnimationFrames: number
  /** A curva da entrada elastica (escala ao longo da entrada). Ver CURVA_DA_ENTRADA_PADRAO. */
  captionAnimationCurve: CurvaDaEntrada
  /** Cor so na palavra dita ('palavra', o padrao) ou na legenda toda ('tudo'). */
  captionMark: CaptionMark
  /** A sombra projetada do texto. Opacidade zero = sem sombra. */
  captionShadow: CaptionShadow
  /** Espessura do contorno preto da legenda. Zero = sem contorno. */
  captionStroke: number
  /**
   * Como a narracao vira legenda: palavras e caracteres por linha, duracao,
   * adiantar e fechar vaos -- as opcoes do LegendAI. Ver @shared/legendas.
   */
  captionRules: RegrasDaLegenda
  /** Os estilos de legenda guardados com nome. Moram nas configuracoes. */
  captionPresets: CaptionPreset[]
  /** As curvas da entrada guardadas com nome. Moram nas configuracoes. */
  curvasDeEntrada: CurvaGuardada[]
  /** As Power Bins. Moram nas configuracoes; ver @/store/bins. */
  bins: Bin[]
  /** O painel das bins no lugar do painel do bloco. */
  binsOpen: boolean
  openBins: (open: boolean) => void
  /** O upscale de um MP4 pronto em andamento. null = nenhum. */
  videoPronto: { feitos: number; total: number; nome: string } | null
  /** O ultimo MP4 pronto melhorado, para a barra oferecer abrir a pasta. */
  videoProntoSaida: string | null
  /**
   * Os SFX que ELE posicionou na faixa da linha do tempo.
   *
   * Vazio = vale a regra automatica de sempre (um corte sim, outro nao,
   * rodando os arquivos da pasta). Com um som aqui, a regra automatica sai de
   * cena inteira: misturar "a cada dois cortes" com sons postos a mao daria um
   * resultado que ninguem consegue prever olhando a tela.
   *
   * Guarda o CAMINHO e nao o nome: ele arrasta de onde quiser, sem precisar
   * mover o arquivo para a pasta do app.
   */
  /**
   * Os trechos das FAIXAS DE AUDIO (musica e afins), cada um na faixa dele.
   * Ver trechoDeAudioSchema. A URL e do servidor local, reposta ao abrir.
   */
  trilhas: (TrechoDeAudioSalvo & { url: string })[]
  /**
   * A FAIXA DE VIDEO: setas, circulos, .mov com fundo vazado, PNG. Ver
   * sobreposicaoSchema. A URL e do arquivo preparado pelo main, reposta ao abrir.
   */
  sobreposicoes: (SobreposicaoSalva & { url: string })[]
  /**
   * As faixas MUTADAS, como o "M" do DaVinci: o que esta nelas some do preview
   * e do render, sem sair do projeto.
   */
  faixasMudas: { video: number[]; audio: number[] }
  /**
   * A FAIXA DE CENAS TRANCADA, como o cadeado do editor: arrastar cortes,
   * cortar no C, excluir e inserir bloco pela linha do tempo ficam parados.
   * Selecionar, levar a agulha e editar o bloco continuam.
   */
  cenasTrancadas: boolean
  alternarTrancaDasCenas: () => void
  /** O clipe de faixa escolhido -- e nele que o C corta, em vez de no bloco. */
  clipeSelecionado: { tipo: 'video' | 'audio'; id: string } | null
  /**
   * Os OUTROS clipes escolhidos junto com o principal (Ctrl+clique, ou o laco
   * da ferramenta de selecao). O principal e o que o inspetor mostra; os
   * controles valem para todos do mesmo tipo.
   */
  outrosClipes: { tipo: 'video' | 'audio'; id: string }[]
  sfxManual: {
    id: string
    path: string
    fileName: string
    at: number
    /** Duracao do som, para o chip ter a LARGURA do tempo que ele ocupa. */
    durationSec: number
    /** Picos para desenhar a onda dentro do chip. */
    peaks: number[]
    /** URL do servidor local. Morre com a sessao; e reposta ao abrir o projeto. */
    url: string
    /**
     * Quanto do som TOCA, em segundos. null = o arquivo inteiro.
     *
     * Existe porque som longo atravessava a faixa e ficava por cima dos outros
     * -- "se arrasto outro pra onde eu quero fica por debaixo e eu nao consigo
     * ver". Cortando, cada som ocupa so o que vai ser ouvido.
     */
    usarSec: number | null
    /**
     * Ganho em dB SOBRE o nivel padrao dos SFX (que ja e -12 dB sob a voz).
     *
     * Zero e o de sempre; -5 e "esse aqui mais baixo", que foi como ele pediu.
     */
    gainDb: number
  }[]
  /**
   * As curvas de movimento que ele guardou.
   *
   * Moram nas CONFIGURACOES e nao no projeto: um ritmo que ele gostou vale para
   * os proximos videos, e guardar no projeto o obrigaria a redesenhar em cada
   * um. Por isso nao entram no documento nem no desfazer.
   */
  curvePresets: { nome: string; pontos: CurvePoints }[]
  /**
   * Melhorar a imagem das cenas antes de renderizar.
   *
   * Desligado por padrao: custa minutos. Medido na 3060 dele, ~236ms por quadro
   * -- perto de 6 minutos num video de um minuto.
   */
  upscale: boolean
  /** Altura da legenda na tela, fracao a partir do rodape. */
  captionY: number
  /** Multiplicador do corpo da legenda. 1 e o tamanho de sempre. */
  captionScale: number
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
   * Ids das cenas favoritadas.
   *
   * Mora na store e nao na tela da Biblioteca porque a tela nao desmonta ao
   * fechar -- e porque relê-los do disco a cada abertura seria jogar fora uma
   * leitura ja feita. O anime esta dentro do proprio id, entao filtrar
   * "favoritos de Tensura" e cruzar esta lista com o filtro de anime que ja
   * existe, sem uma segunda lista por serie para manter em dia.
   */
  favorites: string[]

  /**
   * O que aparece em cada cena, por id.
   *
   * Sao dois tercos da biblioteca dele que nao tem personagem nenhum -- e sem
   * isto elas so eram alcancaveis rolando a grade. Mora na store porque a busca
   * consulta a cada tecla e reler do disco a cada abertura seria trabalho
   * jogado fora.
   */
  tags: Record<string, string[]>
  taggerBusy: boolean
  /** O que cada cena mostra: emocao, acao, cenario, plano. */
  descriptions: Record<string, SceneDescription>
  describeBusy: boolean

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
   * Qual bloco da timeline esta esperando uma cena escolhida na Biblioteca.
   *
   * A fita de candidatos resolve o caso comum -- discordar da escolha e pegar
   * outra das seis. Nao resolve o caso MUITO especifico, quando ele sabe
   * exatamente qual cena quer e ela nao esta entre as seis. Ai ele abre a
   * Biblioteca inteira, com busca, e a proxima que clicar entra neste bloco.
   */
  replaceTarget: AlvoDaTroca | null

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
  /*
   * Quanto cada cena marcada pesa dentro do trecho, na ordem da fita.
   *
   * Ausente ou 1 = todas iguais, que e o comportamento de sempre. Existe
   * porque dividir sempre em partes iguais decidia o RITMO por ele: tres cenas
   * num trecho de 3s davam 1s cada, mesmo quando uma delas era a que importava.
   */
  blockWeights: Record<number, number[]>
  /*
   * Posicoes da fita que estao UNIDAS com a seguinte, em tela dividida.
   *
   * Guardado por posicao, como o peso. A posicao 0 na lista quer dizer que a
   * cena 1 e a cena 2 daquele trecho tocam juntas -- uma em cima, uma embaixo
   * -- e ocupam um slot so.
   */
  blockSplits: Record<number, number[]>
  /**
   * Onde ele PUXOU cada fronteira do trecho, em indice de palavra.
   *
   * Ausente = as fronteiras saem da divisao proporcional ao peso, que e o que
   * o app sempre fez. Presente = ele arrastou, e a fronteira cai no comeco de
   * uma palavra escolhida -- "esse clipe comeca em 'como'".
   *
   * Por palavra e nao por segundo porque e assim que ele pensa o corte
   * ("quero que comece uma palavra antes") e porque um corte no meio de uma
   * palavra e sempre errado num recap: o espectador ouve uma palavra so em
   * cima de duas imagens.
   *
   * O array tem uma entrada por FRONTEIRA -- um trecho com tres slots tem
   * duas. Se o numero de slots muda (ele marca outra cena, repete, une), o
   * tamanho deixa de bater e os cortes daquele trecho sao descartados: seriam
   * fronteiras de uma divisao que nao existe mais.
   */
  blockCuts: Record<number, number[]>

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
    patch: Partial<
      Pick<
        Scene,
        | 'effect'
        | 'transitionIn'
        | 'intensity'
        | 'curve'
        | 'sourceStart'
        | 'rotation'
        | 'curvePoints'
        // O movimento proprio da metade de baixo, na tela dividida.
        | 'effectB'
        | 'intensityB'
        // As duas pontas da camera livre.
        | 'camera'
        // O zoom fixo ("Scale") de cada metade.
        | 'escala'
        | 'escalaB'
        // A camera livre da metade de baixo da tela dividida.
        | 'cameraB'
        // O flip horizontal de cada metade.
        | 'espelhar'
        | 'espelharB'
        // Para onde o zoom fixo aponta, em cada metade.
        | 'escalaOrigem'
        | 'escalaOrigemB'
        // O ajuste da transicao de entrada, e a saida do video (ultimo bloco).
        | 'transicao'
        | 'transitionOut'
        | 'transicaoSaida'
      >
    >,
  ) => void
  /** Liga ou desliga o tocar de tras para frente do clipe de uma metade do bloco. */
  inverterClipe: (sceneIndex: number, metade: 'cima' | 'baixo') => Promise<void>
  /** Escolhe um MP4 pronto e passa pelo upscale, fora de qualquer projeto. */
  melhorarVideoPronto: () => Promise<void>
  /**
   * Abre um video PRONTO como projeto: a fala dele vira a narracao, a imagem
   * vira um bloco so, e dali da para legendar, cortar, por transicao, zoom...
   */
  legendarVideoPronto: (caminho?: string) => Promise<void>
  cancelarVideoPronto: () => Promise<void>
  setVideoProntoProgresso: (p: { feitos: number; total: number; nome: string }) => void
  /** Joga a curva de uma cena em todas as outras. */
  /**
   * Joga o ritmo de uma cena em todas. `pontos` leva junto a curva desenhada --
   * sem isso, "usar em todos" espalharia o preset e deixaria o desenho para tras.
   */
  applyCurveToAll: (curve: MotionCurve, pontos?: CurvePoints | null) => void
  /** Move a fronteira entre a cena index-1 e a cena index. */
  moveBoundary: (index: number, seconds: number) => void
  /** Parte em dois o bloco sob a agulha, as duas metades com a mesma imagem. */
  splitSceneAtPlayhead: () => void
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
  /** Recarrega a lista de fontes da pasta. */
  refreshFontes: () => Promise<void>
  /** Escolhe a fonte da legenda pelo nome do arquivo. null volta a embutida. */
  setCaptionFont: (nome: string | null) => void
  /** Abre a pasta de fontes no explorador, para ele largar os arquivos dele. */
  openFontesDir: () => Promise<void>
  setCaptionAnimation: (animation: CaptionAnimation) => void
  setCaptionAnimationFrames: (frames: number) => void
  setCaptionAnimationCurve: (curva: CurvaDaEntrada) => void
  setCaptionMark: (mark: CaptionMark) => void
  /** Ajusta um dos tres numeros da sombra. */
  setCaptionShadow: (patch: Partial<CaptionShadow>) => void
  setCaptionStroke: (px: number) => void
  /** Poe um som na faixa, no instante onde ele soltou. */
  addSfxAt: (paths: readonly string[], seconds: number) => Promise<void>
  /** Reencontra as URLs dos sons ao abrir um projeto. */
  refreshSfxManual: () => Promise<void>
  /** Poe arquivos de audio numa faixa, a partir de `seconds`. */
  addTrilhasAt: (paths: readonly string[], seconds: number, faixa: number) => Promise<void>
  /** Move o trecho no tempo e, se pedir, para outra faixa. */
  moveTrilha: (id: string, at: number, faixa?: number) => void
  /** Corta pelo FIM: quanto toca, em segundos. null devolve ate o fim do arquivo. */
  cortarFimDaTrilha: (id: string, toca: number | null) => void
  /** Corta pelo COMECO: o trecho passa a entrar em `at`, comendo o inicio do arquivo. */
  cortarInicioDaTrilha: (id: string, at: number) => void
  ajustarTrilha: (id: string, patch: Partial<Pick<TrechoDeAudioSalvo, 'gainDb' | 'fadeInSec' | 'fadeOutSec'>>) => void
  removeTrilha: (id: string) => void
  refreshTrilhas: () => Promise<void>
  /** Poe arquivos (video ou imagem) numa faixa de video, a partir de `seconds`. */
  addSobreposicoesAt: (paths: readonly string[], seconds: number, faixa: number) => Promise<void>
  moveSobreposicao: (id: string, at: number, faixa?: number) => void
  cortarFimDaSobreposicao: (id: string, toca: number | null) => void
  cortarInicioDaSobreposicao: (id: string, at: number) => void
  ajustarSobreposicao: (
    id: string,
    patch: Partial<Omit<SobreposicaoSalva, 'id' | 'path' | 'tipo'>>,
  ) => void
  removeSobreposicao: (id: string) => void
  refreshSobreposicoes: () => Promise<void>
  /**
   * Leva o sistema ANTIGO de som para as faixas de audio: os SFX postos a mao
   * e a cama de musica viram clipes. Roda ao abrir o projeto.
   */
  migrarSonsAntigos: () => Promise<void>
  /**
   * Refaz as legendas que ele NAO editou, pelas regras de agora. O projeto
   * guarda as legendas prontas; sem isto, uma regra corrigida (como o teto de
   * caracteres) so valeria para projeto novo.
   */
  refazerLegendasNaoEditadas: () => void
  alternarMudo: (tipo: 'video' | 'audio', faixa: number) => void
  selecionarClipe: (clipe: { tipo: 'video' | 'audio'; id: string } | null) => void
  /** Uma copia do clipe no mesmo lugar e na mesma faixa (o Alt+arrastar). Devolve o id novo. */
  duplicarClipe: (tipo: 'video' | 'audio', id: string) => string | null
  /** O clipe copiado pelo Ctrl+C, para o Ctrl+V. */
  clipeCopiado: { tipo: 'video' | 'audio'; id: string }[] | null
  /** Liga ou desliga um clipe na selecao (Ctrl/Shift+clique). */
  alternarClipeNaSelecao: (clipe: { tipo: 'video' | 'audio'; id: string }) => void
  /** A selecao inteira de uma vez (o laco). O primeiro vira o principal. */
  definirSelecaoDeClipes: (clipes: readonly { tipo: 'video' | 'audio'; id: string }[]) => void
  /** Tira da linha do tempo todos os clipes escolhidos. */
  removerClipesEscolhidos: () => boolean
  copiarClipe: () => boolean
  /** Cola o clipe copiado na agulha: na faixa dele se couber, senao na primeira livre. */
  colarClipe: () => boolean
  /** Tira a faixa: os clipes dela saem e as de cima descem uma. */
  removerFaixa: (tipo: 'video' | 'audio', faixa: number) => void
  /** Uma camada de ajuste (cor) na faixa de video, na agulha. */
  addCamadaDeAjuste: (faixa: number) => void
  /**
   * O C sobre um clipe de faixa: parte o clipe escolhido em dois, na agulha.
   * false quando nao ha clipe escolhido sob a agulha -- ai o C corta o bloco.
   */
  cortarClipeNaAgulha: () => boolean
  /** Arrasta um som ja posto para outro instante. */
  moveSfx: (id: string, seconds: number) => void
  /** Corta o som: quanto dele toca. null devolve o arquivo inteiro. */
  trimSfx: (id: string, seconds: number | null) => void
  /** Volume deste som, em dB sobre o padrao. */
  setSfxGain: (id: string, gainDb: number) => void
  removeSfx: (id: string) => void
  /** Tira todos e devolve o rodizio automatico. */
  clearSfxManual: () => void
  /** Le as curvas guardadas nas configuracoes. */
  loadCurvePresets: () => Promise<void>
  /** Guarda a curva atual com um nome automatico. */
  saveCurvePreset: (pontos: CurvePoints) => Promise<void>
  removeCurvePreset: (nome: string) => Promise<void>
  toggleUpscale: () => void
  setCaptionY: (y: number) => void
  setCaptionScale: (scale: number) => void
  setScript: (script: string | null) => Promise<void>
  openScript: (open: boolean) => void
  openCaptions: (open: boolean) => void
  /** Junta blocos vizinhos num so. Os indices precisam ser consecutivos. */
  mergeCaptions: (indices: readonly number[]) => void
  /** Quebra um bloco antes da palavra indicada. */
  splitCaption: (index: number, wordIndex: number) => void
  /** Reescreve o texto de uma palavra sem mexer no tempo. */
  editCaptionWord: (index: number, wordIndex: number, text: string) => void
  /** Reescreve o texto do bloco inteiro. Mesmo numero de palavras mantem os tempos. */
  editCaptionText: (index: number, text: string) => void
  resetCaptions: () => void
  /** Muda as regras e refaz as legendas (as editadas so ganham tempo novo). */
  setCaptionRules: (patch: Partial<RegrasDaLegenda>) => void
  /** Mede de novo, pelo alinhamento forcado, onde cada palavra soa. */
  ressincronizarLegendas: () => Promise<void>
  openPalette: (open: boolean) => void
  /** Abre a biblioteca. A primeira abertura varre sozinha. */
  openLibrary: (open: boolean) => Promise<void>
  /** Rele a biblioteca: episodio novo entra, episodio conhecido sai do cache. */
  syncLibrary: () => Promise<void>
  /** Andamento vindo do main durante a varredura. */
  setLibraryBusy: (mensagem: string | null) => void
  loadNicknames: () => Promise<void>
  /** Le os favoritos do disco. Chamada junto da varredura. */
  loadFavorites: () => Promise<void>
  /** Le as etiquetas ja guardadas. */
  loadTags: () => Promise<void>
  loadDescriptions: () => Promise<void>
  /** Le as cenas de UM anime. null le o acervo inteiro, que leva horas. */
  describeLibrary: (anime: string | null) => Promise<void>
  /** Etiqueta as cenas que ainda nao tem etiqueta. */
  tagLibrary: () => Promise<void>
  /** Liga ou desliga o favorito de uma cena. */
  toggleFavorite: (id: string) => Promise<void>
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
  /** Abre a Biblioteca para escolher a cena de um bloco especifico. */
  openLibraryToReplace: (sceneIndex: number, metade?: MetadeDaCena) => Promise<void>
  /** Troca a cena de um bloco por um caminho vindo da Biblioteca. */
  replaceSceneWith: (path: string) => Promise<void>
  /** Le a narracao e quebra em frases. Chamada quando a Biblioteca abre. */
  loadScriptBlocks: () => Promise<void>
  setActiveBlock: (index: number | null) => void
  /**
   * Volta a Biblioteca, no trecho do bloco atual, para consertar a selecao e
   * remontar. A remontagem preserva os ajustes dos blocos cuja cena nao mudou.
   */
  voltarParaSelecao: () => Promise<void>
  /** Marca ou desmarca uma cena na frase aberta. */
  toggleBlockClip: (path: string) => void
  /**
   * As cenas marcadas na Biblioteca SEM roteiro, por id, na ordem de clique.
   *
   * Vive aqui e nao dentro do componente porque precisa ser salva: fechar a
   * Biblioteca ou salvar o projeto no meio da escolha jogava fora um trabalho
   * que leva a tarde inteira. A ordem e o conteudo -- e ela que decide a
   * sequencia em que as cenas entram no video.
   */
  escolhidos: string[]
  /** Marca ou desmarca uma cena. Marcar poe no FIM da fila. */
  alternarEscolhido: (id: string) => void
  /** Tira uma cena da fila sem precisar acha-la na grade de novo. */
  removerEscolhido: (id: string) => void
  /** Esvazia a fila. */
  limparEscolhidos: () => void
  /**
   * Junta o trecho com o seguinte -- para quando a pontuacao corta curto demais
   * para caber um clipe. As cenas dos dois somam. Ver @shared/juntar.
   */
  juntarTrechos: (blockIndex: number) => void
  /** Desfaz uma juncao: o trecho volta a ser os pedacos que o formaram. */
  separarTrecho: (blockIndex: number) => void
  /** Troca a ordem das cenas dentro de uma frase. */
  reorderBlockClips: (blockIndex: number, paths: readonly string[]) => void
  /** Quanto tempo uma cena da fita ganha em relacao as outras: 1, 2 ou 3. */
  setBlockWeight: (blockIndex: number, posicao: number, peso: number) => void
  /** Tira UMA cena da fita, pela posicao. Ver `tirarDaFita`. */
  removeBlockClip: (blockIndex: number, posicao: number) => void
  /** Poe outra copia da cena logo depois dela, no mesmo trecho. */
  duplicateBlockClip: (blockIndex: number, posicao: number) => void
  /** Une esta cena com a proxima em tela dividida, ou desfaz a uniao. */
  toggleBlockSplit: (blockIndex: number, posicao: number) => void
  /**
   * Puxa uma fronteira do trecho para outra palavra.
   *
   * So a fronteira arrastada se move: o slot antes dela encolhe e o de depois
   * cresce, e as outras fronteiras ficam onde estao. Empurrar tudo em cascata
   * faria um ajuste de uma palavra reorganizar o trecho inteiro.
   */
  setBlockCut: (blockIndex: number, fronteira: number, palavra: number) => void
  /** Devolve o trecho a divisao proporcional. */
  clearBlockCuts: (blockIndex: number) => void
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
  /**
   * Troca o formato do projeto e avisa o main.
   *
   * O main faz o recorte, o upscale e a deteccao de rosto, e os tres precisam
   * do quadro. Ele nunca adivinha: quem sabe e a tela, e e ela que conta.
   */
  definirFormato: (formato: Formato) => Promise<void>
  selectScene: (index: number | null) => void
  /** Shift+clique: seleciona tudo entre a ancora e este bloco. */
  estenderSelecao: (index: number) => void
  /** Ctrl+clique: poe ou tira este bloco da selecao. */
  alternarSelecao: (index: number) => void
  /**
   * Os ajustes copiados de um bloco, prontos para colar em outros.
   *
   * Movimento, ritmo, giro e transicao -- o COMO o bloco se comporta. Fica fora
   * o que descreve o material em si: qual imagem e, de que ponto do clipe ela
   * parte, e a camera livre.
   *
   * A CAMERA nao viaja de proposito. Um caminho de camera e desenhado contra o
   * conteudo daquele clipe -- e mais ainda quando saiu do rastreador, que seguiu
   * um alvo especifico. Colado noutro clipe ele enquadraria o nada, com cara de
   * defeito. Quem quiser o mesmo movimento generico tem os presets.
   */
  ajustesCopiados: AjustesDeBloco | null
  /** Guarda os ajustes deste bloco. */
  copiarAjustes: (index: number) => void
  /** Aplica os ajustes guardados nestes blocos. */
  colarAjustes: (indices: readonly number[]) => void
  /** Seleciona o primeiro bloco que usa esta imagem. */
  selectImage: (id: string | null) => void
  setPlayhead: (seconds: number) => void
  togglePlay: () => void
  setPlaying: (playing: boolean) => void
  /** Resolve com o caminho do MP4, ou null se cancelou ou falhou. */
  startRender: () => Promise<string | null>
  cancelRender: () => Promise<void>
  /** Interrompe a leitura da narracao e devolve a tela ao usuario. */
  cancelAnalyze: () => Promise<void>
  /**
   * Aponta as duas pontas da camera para o rosto, no comeco e no fim do bloco.
   *
   * Devolve o que conseguiu, para a tela poder dizer -- "nenhum" e um resultado
   * legitimo e frequente: o detector e frontal e nao dispara em perfil, nuca
   * nem plano aberto.
   */
  seguirRosto: (index: number) => Promise<'ambos' | 'um' | 'nenhum'>
  /**
   * Segue o que estiver DENTRO do retangulo inicial ao longo do bloco.
   *
   * Devolve ate que fracao do bloco a perseguicao se sustentou, ou null quando
   * nao houve o que seguir -- o numero importa, porque um caminho que morre na
   * metade ainda serve para a primeira metade.
   */
  rastrear: (index: number) => Promise<number | null>
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
  /*
   * Quais imagens cada bloco usa, por posicao na lista importada.
   *
   * Sem isto o bloco N usava sempre a imagem N -- verdade enquanto cada bloco
   * tinha uma cena so. Com tela dividida um bloco consome DUAS imagens, e as
   * contas deixam de bater a partir do primeiro par: os ultimos blocos
   * apontariam para imagem que nao existe.
   */
  pares?: readonly (readonly number[])[],
): ScenePlan {
  const scenes: Scene[] = blocos.map((bloco, index) => ({
    imageIndex: pares?.[index]?.[0] ?? index,
    imageIndexB: pares?.[index]?.[1] ?? null,
    start: index === 0 ? 0 : bloco.start,
    end: index === blocos.length - 1 ? Math.max(bloco.end, durationSec) : bloco.end,
    /*
     * Clipe tambem entra com movimento, em ritmo constante.
     *
     * Tudo que sai daqui e clipe, entao o rodizio de efeito e o mesmo do print
     * -- o que muda e a curva e a intensidade. Remover o movimento de um bloco
     * especifico continua sendo um clique no card da cena.
     */
    /*
     * TELA DIVIDIDA NASCE COM AS METADES INDO PARA LADOS OPOSTOS.
     *
     * Cima para a esquerda, baixo para a direita. Duas metades andando para o
     * mesmo lado leem como uma imagem so escorregando; indo em sentidos
     * contrarios, cada uma se afirma como uma cena, e a divisao ganha a
     * tensao que e o motivo de existir dela -- reacao em cima, causa embaixo.
     *
     * E so o PONTO DE PARTIDA. Os dois controles ficam no card do bloco, e
     * trocar qualquer um deles nao traz este padrao de volta.
     */
    effect: pares?.[index]?.[1] !== undefined
      ? ('pan-left' as const)
      : KEN_BURNS_EFFECTS[index % KEN_BURNS_EFFECTS.length]!,
    intensity: CLIP_INTENSITY,
    effectB: pares?.[index]?.[1] !== undefined ? ('pan-right' as const) : null,
    intensityB: null,
    curve: CLIP_MOTION_CURVE,
    // Parte do comeco do clipe. Mover o ponto de entrada e escolha dele, no
    // card da cena.
    sourceStart: 0,
    sourceStartB: 0,
    curvePoints: null,
    // Camera livre so quando ele desenhar as pontas.
    camera: null,
    rotation: 0,
    transitionIn: 'cut',
  }))
  return { scenes }
}

/**
 * Poe a cena escolhida na mao a frente da fita daquele bloco.
 *
 * O indice na TIMELINE nao e o indice no roteiro: bloco que ficou sem cena nao
 * virou imagem. Contar quantos blocos uteis vieram antes e o que liga os dois
 * -- a mesma conta que a fita e o swapCandidate ja fazem.
 */
function substituirNaFita(
  blocos: readonly AutomountBlock[],
  posicaoNaTimeline: number,
  path: string,
  clip: LibraryClip | undefined,
): AutomountBlock[] {
  let restante = posicaoNaTimeline
  const alvo = blocos.findIndex((b) => b.candidates.length > 0 && restante-- === 0)
  if (alvo < 0) return [...blocos]

  const escolhida = {
    path,
    thumbUrl: clip?.thumbUrl ?? '',
    label: clip ? `${clip.anime} S${clip.season}E${clip.episode} #${clip.shot}` : 'Cena escolhida',
    durationSec: clip?.duration ?? 0,
    reason: 'escolhida por voce na biblioteca',
  }
  return blocos.map((b, i) =>
    i === alvo
      ? { ...b, candidates: [escolhida, ...b.candidates.filter((c) => c.path !== path)] }
      : b,
  )
}

/**
 * Menos picos para o chip do SFX.
 *
 * O analisador devolve milhares, feitos para uma faixa de 1400 pixels. O chip
 * tem algumas dezenas -- guardar o resto so engordaria o arquivo do projeto
 * sem mudar um pixel na tela.
 */
/** A selecao inteira de clipes de faixa: o principal primeiro. */
export function clipesEscolhidos(state: {
  clipeSelecionado: { tipo: 'video' | 'audio'; id: string } | null
  outrosClipes: readonly { tipo: 'video' | 'audio'; id: string }[]
}): { tipo: 'video' | 'audio'; id: string }[] {
  return state.clipeSelecionado ? [state.clipeSelecionado, ...state.outrosClipes] : []
}

/** Os ids escolhidos de um tipo -- os alvos de um controle que vale para todos. */
export function idsEscolhidos(
  state: Parameters<typeof clipesEscolhidos>[0],
  tipo: 'video' | 'audio',
): string[] {
  return clipesEscolhidos(state)
    .filter((c) => c.tipo === tipo)
    .map((c) => c.id)
}

/**
 * A onda de um trecho de audio das faixas: 1000 buckets, com tres casas.
 *
 * Eram 120 para a musica inteira -- numa faixa de 2:30, uma barra a cada 1,2s,
 * e esticada no clipe virava um pente de dentes iguais. Mil da uns 150 ms numa
 * musica longa, e com tres casas o projeto salvo nao incha.
 */
function ondaDoTrecho(a: { peaks: readonly number[]; rms?: readonly number[] }): { peaks: number[]; rms: number[] } {
  const casas = (v: number): number => Math.round(v * 1000) / 1000
  return {
    peaks: reduzirPicos(a.peaks, 1000).map(casas),
    rms: a.rms && a.rms.length > 0 ? reduzirPicos(a.rms, 1000).map(casas) : [],
  }
}

function reduzirPicos(peaks: readonly number[], quantos = 40): number[] {
  if (peaks.length <= quantos) return [...peaks]
  const passo = peaks.length / quantos
  return Array.from({ length: quantos }, (_, i) => {
    let maior = 0
    for (let j = Math.floor(i * passo); j < Math.floor((i + 1) * passo); j++) {
      maior = Math.max(maior, peaks[j] ?? 0)
    }
    return maior
  })
}

/**
 * As palavras das legendas, na ordem, cada uma com o tempo MEDIDO.
 *
 * As legendas editadas carregam o texto dele, a transcricao carrega os tempos.
 * Quase sempre as duas tem o mesmo numero de palavras (mesclar e dividir nao
 * mudam isso), e a correspondencia e uma a uma. Se ele reescreveu um bloco com
 * mais ou menos palavras, cada palavra da legenda pega a da transcricao na
 * mesma POSICAO RELATIVA -- aproximado, mas nunca fora do trecho certo por
 * mais que o bloco reescrito.
 */
function palavrasDasLegendas(captions: readonly CaptionBlock[], transcript: Transcript | null): Word[] {
  const texto = captions.flatMap((b) => b.words.map((w) => w.text))
  const medidas = transcript?.words ?? []
  if (medidas.length === 0) {
    return captions.flatMap((b) =>
      b.words.map((w) => ({ text: w.text, start: w.from / VIDEO_FPS, end: (w.from + w.durationInFrames) / VIDEO_FPS })),
    )
  }
  return texto.map((t, k) => {
    const i =
      texto.length === medidas.length
        ? k
        : Math.min(Math.floor((k * medidas.length) / texto.length), medidas.length - 1)
    return { text: t, start: medidas[i]!.start, end: medidas[i]!.end }
  })
}

function setInterimPlan(set: SetState, imageCount: number, durationSec: number): void {
  set({
    plan: planEqualSplit(imageCount, durationSec),
    planOrigin: 'equal',
    selectedScene: null,
    selecionados: [],
  })
}

/**
 * A leitura do roteiro em andamento, se houver.
 *
 * Fora do estado de proposito: e justamente quando o estado e zerado no meio
 * de uma leitura que a tranca precisa continuar valendo.
 */
let lendoRoteiro: Promise<unknown> | null = null

/** Qual das duas cenas de um bloco dividido. */
export type MetadeDaCena = 'cima' | 'baixo'

/** O bloco e a metade que a Biblioteca vai substituir. */
export interface AlvoDaTroca {
  scene: number
  metade: MetadeDaCena
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
  formato: FORMATO_PADRAO,
  selectedScene: null,
  selecionados: [],
  ajustesCopiados: null,
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
  /*
   * SFX NASCE DESLIGADO, e quem quiser liga.
   *
   * Ele entrava sozinho a cada dois cortes, entao um video so ficava pronto
   * depois de alguem se lembrar de desligar -- e esquecer produz um efeito no
   * video final, nao a ausencia de um. Som que entra sem ninguem pedir tem que
   * ser escolha, nao descoberta.
   *
   * Projeto ja salvo abre com o que ele guardou: quem ligou continua com o som.
   */
  sfxEnabled: false,
  sfxFiles: [],
  update: null,
  appVersion: '',
  captionsEnabled: false,
  captionColor: CAPTION_COLOR_DEFAULT,
  captionFont: null,
  fontes: [],
  captionAnimation: CAPTION_ANIMATION_DEFAULT,
  captionAnimationFrames: CAPTION_ANIMATION_FRAMES_DEFAULT,
  captionAnimationCurve: CURVA_DA_ENTRADA_PADRAO,
  captionMark: CAPTION_MARK_DEFAULT,
  captionShadow: CAPTION_SHADOW_DEFAULT,
  captionStroke: CAPTION_STROKE_DEFAULT,
  captionRules: REGRAS_DA_LEGENDA_PADRAO,
  captionPresets: [],
  curvasDeEntrada: [],
  bins: [],
  binsOpen: false,
  openBins: (open) => set(open ? { binsOpen: true, captionsOpen: false } : { binsOpen: false }),
  videoPronto: null,
  videoProntoSaida: null,
  sfxManual: [],
  trilhas: [],
  sobreposicoes: [],
  faixasMudas: { video: [], audio: [] },
  cenasTrancadas: false,
  clipeSelecionado: null,
  outrosClipes: [],
  curvePresets: [],
  upscale: false,
  captionY: CAPTION_Y_DEFAULT,
  captionScale: CAPTION_SCALE_DEFAULT,
  paletteOpen: false,
  libraryOpen: false,
  library: null,
  automountBlocks: null,
  automountMode: null,
  automountSeries: null,
  replaceTarget: null,
  scriptBlocks: null,
  scriptBlocksBusy: null,
  activeBlock: null,
  blockClips: {},
  blockWeights: {},
  blockSplits: {},
  blockCuts: {},
  escolhidos: [],
  libraryBusy: null,
  libraryError: null,
  nicknames: {},
  favorites: [],
  tags: {},
  taggerBusy: false,
  descriptions: {},
  describeBusy: false,
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
        set({ script: result.value, captionsEdited: false, scriptBlocks: null, blockClips: {}, blockWeights: {}, blockSplits: {}, blockCuts: {} })
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
          blockWeights: {},
          blockSplits: {},
          blockCuts: {},
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
      captions: buildCaptions(transcript, get().captionRules),
      captionsEdited: false,
      scriptNote,
      sectionNote: note,
      aiNote: null,
      selectedScene: null,
      selecionados: [],
      busy: null,
    })
  },

  setAutomountSeries: (series) => set({ automountSeries: series }),

  openLibraryToReplace: async (sceneIndex, metade = 'cima') => {
    set({ replaceTarget: { scene: sceneIndex, metade } })
    await get().openLibrary(true)
  },

  replaceSceneWith: async (path) => {
    const { replaceTarget, images, library } = get()
    const alvo =
      replaceTarget === null
        ? null
        : imagemDaMetade(get().plan, replaceTarget.scene, replaceTarget.metade)
    if (alvo === null || !images[alvo]) return

    set({ busy: 'Trocando a cena...', error: null, libraryOpen: false })
    const importada = await window.dangai.importImages([path])
    if (!importada.ok || !importada.value[0]) {
      set({ busy: null, replaceTarget: null, error: importada.ok ? 'Nao deu para abrir essa cena.' : importada.error })
      return
    }

    /*
     * A fita da montagem automatica passa a comecar pela escolha DELE.
     *
     * Sem isto a fita seguiria anunciando o candidato que o app tinha
     * escolhido, e o card diria uma coisa enquanto a timeline mostra outra. O
     * motivo vira "escolhida por voce" porque e a verdade -- nenhuma regra
     * levou a esta cena.
     */
    const clip = library?.clips.find((c) => c.path === path)

    /*
     * A TROCA VALE PARA A SELECAO TAMBEM.
     *
     * Sem isto, voltar a selecao e remontar desfaria a troca em silencio: a
     * selecao continuaria com a cena velha, e a remontagem a traria de volta.
     * O trecho e o que contem o bloco -- e, se a mesma cena estiver em mais de
     * um, o mais perto no tempo.
     */
    const caminhoVelho = images[alvo]!.path
    const cenaTrocada = get().plan?.scenes[replaceTarget!.scene]
    const { scriptBlocks, blockClips } = get()
    let selecao = blockClips
    if (scriptBlocks && cenaTrocada) {
      let melhor = -1
      let distancia = Number.POSITIVE_INFINITY
      for (const [chave, fita] of Object.entries(blockClips)) {
        const bloco = scriptBlocks[Number(chave)]
        if (!bloco || !fita.includes(caminhoVelho)) continue
        /*
         * A frase que CONTEM o bloco ganha de qualquer outra. So "a mais perto
         * pelo comeco" errava quando o mesmo clipe estava tambem na frase
         * seguinte: o segundo bloco de uma frase comeca mais perto da proxima
         * frase do que da propria, e a troca ia parar na fita errada.
         */
        const contem = cenaTrocada.start >= bloco.start - 0.01 && cenaTrocada.start < bloco.end
        const d = contem ? -1 : Math.abs(bloco.start - cenaTrocada.start)
        if (d < distancia) {
          distancia = d
          melhor = Number(chave)
        }
      }
      if (melhor >= 0) {
        const fita = [...blockClips[melhor]!]
        fita[fita.indexOf(caminhoVelho)] = path
        selecao = { ...blockClips, [melhor]: fita }
      }
    }

    set((state) => ({
      images: state.images.map((img, i) => (i === alvo ? importada.value[0]! : img)),
      blockClips: selecao,
      automountBlocks: state.automountBlocks
        ? substituirNaFita(state.automountBlocks, alvo, path, clip)
        : null,
      busy: null,
      replaceTarget: null,
      selectedScene: replaceTarget!.scene,
      selecionados: [],
      projectDirty: true,
    }))
  },

  loadScriptBlocks: async () => {
    const { audio, subtitlePath, script, scriptBlocks, scriptBlocksBusy, transcript } = get()
    // Ja lido, ou lendo: transcrever de novo custaria outra passada de Whisper
    // pelo mesmo audio para chegar no mesmo texto.
    if (!audio || scriptBlocks || scriptBlocksBusy) return

    /*
     * O estado sozinho nao tranca, porque ele pode ser zerado POR BAIXO.
     *
     * `clearProject` limpa `scriptBlocks` e `scriptBlocksBusy` juntos, e
     * importar outra narracao faz o mesmo. Acontecendo isso no meio de uma
     * leitura, a tranca abre com a leitura ainda correndo e o proximo render
     * pede outra -- e cada pedido subia um Whisper proprio, com o modelo
     * inteiro na memoria. A promessa viva mora FORA do estado exatamente para
     * nao ser apagada junto com ele.
     */
    if (lendoRoteiro) return

    set({ scriptBlocksBusy: 'Ouvindo a narracao...' })
    const pedido = window.dangai.scriptBlocks({
      audioPath: audio.path,
      subtitlePath,
      script,
      /*
       * A transcricao da importacao vai junto.
       *
       * Sem ela, o main mandava o Whisper passar de novo pelo mesmo audio para
       * chegar ao mesmo texto -- e a Biblioteca ficava minutos "ouvindo a
       * narracao" que ela ja tinha ouvido.
       */
      transcript,
    })

    lendoRoteiro = pedido
    let r
    try {
      r = await pedido
    } finally {
      lendoRoteiro = null
    }

    /*
     * A narracao ainda e a MESMA?
     *
     * A leitura leva minutos, e nesse tempo o usuario pode ter limpado o
     * projeto ou solto outro audio. Sem esta conferencia o resultado antigo
     * cairia por cima -- trechos medidos num audio que nao esta mais ali,
     * apontando para instantes que nao existem.
     */
    if (get().audio !== audio) {
      // Limpa ao sair: importar outra narracao zera `scriptBlocks` mas NAO o
      // `scriptBlocksBusy`, e deixar o antigo pendurado fecharia a tranca para
      // sempre -- a Biblioteca nunca leria o roteiro novo.
      set({ scriptBlocksBusy: null, busy: null })
      return
    }

    /*
     * `busy` tambem tem que ser limpo, e nao so o `scriptBlocksBusy`.
     *
     * O main transmite o andamento desta leitura pelo canal de analise, e o
     * App joga toda mensagem desse canal no `busy` geral. Como quem clareia o
     * `busy` e sempre a acao que o ACENDEU, e esta acendia so o proprio
     * estado, a ultima mensagem ficava pendurada para sempre -- e a cortina da
     * Biblioteca, que olha o `busy`, cobria a tela inteira com "Casando o
     * roteiro com a narracao..." depois de a leitura ja ter dado certo.
     */
    if (!r.ok) {
      set({ scriptBlocksBusy: null, busy: null, libraryError: r.error })
      return
    }
    set({
      scriptBlocks: r.value.blocks,
      // A transcricao vem junto e fica: as legendas saem dela sem outra passada.
      transcript: r.value.transcript,
      captions: get().captionsEdited ? get().captions : buildCaptions(r.value.transcript, get().captionRules),
      scriptNote: r.value.scriptNote,
      activeBlock: r.value.blocks.length > 0 ? 0 : null,
      scriptBlocksBusy: null,
      busy: null,
    })
  },

  setActiveBlock: (index) => set({ activeBlock: index }),

  voltarParaSelecao: async () => {
    /*
     * Abre a Biblioteca JA NO TRECHO do bloco em que ele esta.
     *
     * Ele volta porque alguma cena deu errado, e quase sempre esta parado em
     * cima dela na timeline. Abrir no primeiro trecho o faria procurar de novo,
     * entre ~40, a frase que ele ja estava olhando.
     */
    const { plan, selectedScene, playhead, scriptBlocks } = get()
    const cena = selectedScene === null ? null : plan?.scenes[selectedScene]
    const instante = cena ? cena.start + 0.01 : playhead
    if (scriptBlocks && scriptBlocks.length > 0) {
      let trecho = 0
      for (const [i, bloco] of scriptBlocks.entries()) {
        if (bloco.start <= instante) trecho = i
        else break
      }
      set({ activeBlock: trecho })
    }
    await get().openLibrary(true)
  },

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
    /*
     * Mexer na fita zera os pesos DAQUELE trecho.
     *
     * O peso e por POSICAO na fita. Tirar a cena do meio faria o peso dela
     * escorregar para a vizinha em silencio, e o video sairia com o ritmo
     * trocado sem ninguem ter pedido.
     */
    const { [activeBlock]: _fora, ...outrosPesos } = get().blockWeights
    const { [activeBlock]: _foraSplit, ...outrasUnioes } = get().blockSplits
    // A fronteira puxada tambem e por posicao: mudar o numero de cenas a
    // transforma numa fronteira de uma divisao que nao existe mais.
    const { [activeBlock]: _foraCorte, ...outrosCortes } = get().blockCuts
    set({
      blockClips: { ...blockClips, [activeBlock]: proximos },
      blockWeights: outrosPesos,
      blockSplits: outrasUnioes,
      blockCuts: outrosCortes,
      /*
       * Marcar cena AGORA suja o projeto.
       *
       * Nao sujava antes, e estava certo: a marcacao nao ia para o arquivo,
       * entao nao havia o que salvar. Agora que ela vai, nao sujar seria pior
       * que o problema original -- ele fecharia o app sem nenhuma pergunta e
       * perderia a tarde de marcacao achando que nada tinha mudado.
       */
      projectDirty: true,
    })
  },

  /*
   * Marcar poe no FIM da fila, sempre.
   *
   * E o que faz a ordem ser a de clique e nao a da grade -- em video de teoria
   * a ordem e a do argumento, que nenhuma ordenacao do acervo conhece.
   */
  alternarEscolhido: (id) =>
    set((state) => ({
      escolhidos: state.escolhidos.includes(id)
        ? state.escolhidos.filter((x) => x !== id)
        : [...state.escolhidos, id],
      // Suja o projeto: a fila vai para o arquivo, e fechar sem aviso depois
      // de marcar quarenta cenas seria perder tudo em silencio.
      projectDirty: true,
    })),

  /*
   * Tirar da fila sem voltar na grade.
   *
   * Desmarcar so existia clicando no cartao de novo -- e achar de novo um
   * cartao entre milhares, depois de ter mudado de filtro, e uma busca. Ele
   * pediu exatamente isso: "quero a opcao de remover um clipe selecionado, nao
   * so tendo que clicar manualmente no clipe novamente".
   */
  removerEscolhido: (id) =>
    set((state) => ({
      escolhidos: state.escolhidos.filter((x) => x !== id),
      projectDirty: true,
    })),

  limparEscolhidos: () => set({ escolhidos: [], projectDirty: true }),

  juntarTrechos: (blockIndex) => aplicarMarcacoes(set, get, (m) => juntarComOProximo(m, blockIndex)),

  separarTrecho: (blockIndex) => aplicarMarcacoes(set, get, (m) => separarPedacos(m, blockIndex)),

  reorderBlockClips: (blockIndex, paths) => {
    /*
     * Sem isto, errar a ordem custava desmarcar e remarcar tudo.
     *
     * Dentro de uma frase a ordem e a do argumento dele, nao a do episodio --
     * nenhuma ordenacao automatica sabe qual imagem vem primeiro em "comprime
     * uma nuvem carregada". Por isso ela precisa ser arrastavel, e nao apenas a
     * ordem em que ele calhou de clicar.
     */
    set((state) => {
      // Reordenar tambem invalida o peso por posicao, pelo mesmo motivo.
      const { [blockIndex]: _fora, ...outros } = state.blockWeights
      const { [blockIndex]: _foraSplit, ...semUniao } = state.blockSplits
      const { [blockIndex]: _foraCorte, ...semCortes } = state.blockCuts
      return {
        blockClips: { ...state.blockClips, [blockIndex]: [...paths] },
        blockWeights: outros,
        blockSplits: semUniao,
        blockCuts: semCortes,
        // A ordem vai para o .dangai: reordenar sem sujar seria perder a ordem
        // nova no proximo fechar, sem pergunta nenhuma.
        projectDirty: true,
      }
    })
  },

  toggleBlockSplit: (blockIndex, posicao) => {
    /*
     * Une a cena com a SEGUINTE, e as duas passam a ocupar um slot so.
     *
     * Em recap ele quer, as vezes, mostrar duas cenas ao mesmo tempo -- reacao
     * em cima, o que causou embaixo. O par nao ganha tempo extra: ele divide o
     * trecho como uma cena unica dividiria, e o peso continua sendo do par.
     *
     * Uniao encadeada nao existe: unir 1-2 e 2-3 daria tres cenas num quadro
     * partido em dois. Por isso unir a posicao 1 desfaz qualquer uniao que a 0
     * tivesse com ela.
     */
    set((state) => {
      const cenas = state.blockClips[blockIndex] ?? []
      if (posicao < 0 || posicao + 1 >= cenas.length) return {}
      const atuais = state.blockSplits[blockIndex] ?? []
      const proximos = atuais.includes(posicao)
        ? atuais.filter((i) => i !== posicao)
        : [...atuais.filter((i) => i !== posicao - 1 && i !== posicao + 1), posicao].sort((a, b) => a - b)
      // Unir junta dois slots num so: as fronteiras puxadas eram de outra
      // divisao e nao querem dizer mais nada.
      const { [blockIndex]: _foraCorte, ...semCortes } = state.blockCuts
      return {
        blockSplits: { ...state.blockSplits, [blockIndex]: proximos },
        blockCuts: semCortes,
        projectDirty: true,
      }
    })
  },

  duplicateBlockClip: (blockIndex, posicao) => {
    /*
     * Repetir a mesma cena e legitimo, e ate agora nao dava.
     *
     * O clique no cartao ALTERNA -- e assim que ele desmarca --, entao clicar
     * de novo numa cena ja marcada tirava a cena em vez de repetir. A repeticao
     * ganha um gesto proprio, na fita, onde a ordem ja e visivel: a copia entra
     * logo depois da original.
     *
     * Palavras dele: "em alguns momentos e cabivel eu colocar a mesma cena
     * novamente e hj eu nao posso fazer isso".
     */
    set((state) => {
      const atuais = state.blockClips[blockIndex] ?? []
      const alvo = atuais[posicao]
      if (alvo === undefined) return {}
      const proximos = [...atuais.slice(0, posicao + 1), alvo, ...atuais.slice(posicao + 1)]
      // A fita mudou de tamanho: o peso e por POSICAO e nao sobrevive a isso.
      const { [blockIndex]: _fora, ...outrosPesos } = state.blockWeights
      const { [blockIndex]: _foraSplit, ...semUniao } = state.blockSplits
      const { [blockIndex]: _foraCorte, ...semCortes } = state.blockCuts
      return {
        blockClips: { ...state.blockClips, [blockIndex]: proximos },
        blockWeights: outrosPesos,
        blockSplits: semUniao,
        blockCuts: semCortes,
        projectDirty: true,
      }
    })
  },

  setBlockWeight: (blockIndex, posicao, peso) => {
    /*
     * Tres niveis, 1x a 3x, escolhidos por menos e mais.
     *
     * Era um ciclo num "1x" de 9 pixels, e ele nao tinha como saber o que
     * aquilo era: "o que significa aquele 1x em cima do bloco?". Agora a fita
     * mostra os SEGUNDOS que a cena ganha, com menos e mais do lado -- o peso
     * continua existindo, mas como mecanismo, e nao como a coisa que ele le.
     *
     * Continua curto de proposito: a decisao e "esta aqui importa mais", e o
     * ajuste fino ja existe na linha do tempo, depois de montado.
     */
    set((state) => {
      const quantas = (state.blockClips[blockIndex] ?? []).length
      if (posicao < 0 || posicao >= quantas) return {}
      const atuais = state.blockWeights[blockIndex] ?? []
      const pesos = Array.from({ length: quantas }, (_, i) => atuais[i] ?? 1)
      pesos[posicao] = Math.min(Math.max(Math.round(peso), 1), 3)
      /*
       * Mexer no peso devolve o trecho a divisao proporcional.
       *
       * Peso e fronteira puxada sao dois jeitos de dizer onde a cena comeca, e
       * a puxada ganha. Sem isto, clicar no 2x com o trecho ja puxado nao faria
       * absolutamente nada e pareceria botao quebrado.
       */
      const { [blockIndex]: _foraCorte, ...semCortes } = state.blockCuts
      return {
        blockWeights: { ...state.blockWeights, [blockIndex]: pesos },
        blockCuts: semCortes,
        projectDirty: true,
      }
    })
  },

  removeBlockClip: (blockIndex, posicao) => {
    /*
     * Tirar uma cena direto da fita, e nao so desmarcando o cartao na grade.
     *
     * "Eu nao tenho como clicar pra remover um bloco." Desmarcar existia so na
     * grade da Biblioteca -- achar de novo o cartao entre milhares, depois de
     * ter trocado de filtro, so para tirar uma cena que esta bem ali na fita.
     */
    set((state) => {
      const r = tirarDaFita(
        state.blockClips[blockIndex] ?? [],
        state.blockWeights[blockIndex],
        state.blockSplits[blockIndex],
        posicao,
      )
      if (!r) return {}
      const { [blockIndex]: _foraCorte, ...semCortes } = state.blockCuts
      return {
        blockClips: { ...state.blockClips, [blockIndex]: r.cenas },
        blockWeights: { ...state.blockWeights, [blockIndex]: r.pesos },
        blockSplits: { ...state.blockSplits, [blockIndex]: r.unioes },
        blockCuts: semCortes,
        projectDirty: true,
      }
    })
  },

  setBlockCut: (blockIndex, fronteira, palavra) => {
    set((state) => {
      const cenas = state.blockClips[blockIndex] ?? []
      const bloco = state.scriptBlocks?.[blockIndex]
      if (!bloco || cenas.length === 0) return {}

      const slots = slotsDoTrecho(cenas, state.blockWeights[blockIndex], state.blockSplits[blockIndex])
      const palavras = palavrasDoTrecho(state.transcript?.words ?? [], bloco.start, bloco.end)
      if (!cabeCortePorPalavra(slots.length, palavras.length)) return {}
      if (fronteira < 0 || fronteira >= slots.length - 1) return {}

      /*
       * O primeiro arraste congela TODAS as fronteiras onde elas ja estavam.
       *
       * Sem isso, puxar a segunda fronteira faria a primeira -- ate entao
       * proporcional -- se recalcular junto, e o trecho se reorganizaria
       * inteiro a cada arraste.
       */
      const atuais =
        state.blockCuts[blockIndex]?.length === slots.length - 1
          ? state.blockCuts[blockIndex]!
          : cortesAutomaticos(slots, palavras, bloco.start, bloco.end)

      /*
       * A fronteira PARA na vizinha em vez de empurra-la.
       *
       * Sem este limite, arrastar a primeira ate o fim levava a segunda junto e
       * o trecho inteiro se reorganizava -- o oposto de "uma palavra antes".
       */
      const { min, max } = limitesDaFronteira(atuais, fronteira, slots.length, palavras.length)
      const preso = Math.min(Math.max(palavra, min), max)
      const proximos = prender(
        atuais.map((v, k) => (k === fronteira ? preso : v)),
        slots.length,
        palavras.length,
      )
      return { blockCuts: { ...state.blockCuts, [blockIndex]: proximos }, projectDirty: true }
    })
  },

  clearBlockCuts: (blockIndex) => {
    set((state) => {
      if (!state.blockCuts[blockIndex]) return {}
      const { [blockIndex]: _fora, ...resto } = state.blockCuts
      return { blockCuts: resto, projectDirty: true }
    })
  },

  applyBlockClips: async () => {
    const { scriptBlocks, blockClips, blockWeights, blockSplits, blockCuts, transcript, audio } =
      get()
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
    // Para cada slot, os indices em `caminhos` das suas imagens: um so em tela
    // cheia, dois quando ele uniu as cenas.
    const pares: number[][] = []
    const spans: { start: number; end: number }[] = []
    for (const [i, frase] of scriptBlocks.entries()) {
      const cenas = blockClips[i] ?? []
      if (cenas.length === 0) continue

      /*
       * A conta de como o trecho se reparte mora em @shared/trecho, e nao aqui.
       *
       * Ela roda em dois lugares -- aqui e na pintura das palavras da coluna do
       * roteiro. Enquanto eram duas contas parecidas elas DIVERGIRAM: a pintura
       * dividia em partes iguais enquanto o video ja respeitava o peso, e a cor
       * mostrava uma coisa enquanto o mp4 fazia outra.
       */
      const slots = slotsDoTrecho(cenas, blockWeights[i], blockSplits[i])
      const palavras = palavrasDoTrecho(transcript?.words ?? [], frase.start, frase.end)
      const cortes = blockCuts[i]?.length === slots.length - 1 ? blockCuts[i]! : null
      const doTrecho = spansDoTrecho(frase.start, frase.end, slots, palavras, cortes)

      for (const [k, slot] of slots.entries()) {
        pares.push(
          slot.paths.map((path) => {
            caminhos.push(path)
            return caminhos.length - 1
          }),
        )
        spans.push(doTrecho[k]!)
      }
    }

    if (caminhos.length === 0) {
      set({ libraryError: 'Marque pelo menos uma cena em algum trecho.' })
      return
    }

    /*
     * Marca que sobrou de um roteiro ANTERIOR nao entra em silencio.
     *
     * blockClips e indexado por posicao do trecho. Se o roteiro foi relido e
     * encurtou, os indices que passam do fim nao viram bloco nenhum -- e o que
     * ele marcou simplesmente nao aparece no video. Melhor dizer.
     */
    const perdidas = Object.entries(blockClips).filter(
      ([chave, cenas]) => cenas.length > 0 && Number(chave) >= scriptBlocks.length,
    )
    if (perdidas.length > 0) {
      set({
        libraryError:
          `${perdidas.length} ${perdidas.length === 1 ? 'trecho marcado nao existe' : 'trechos marcados nao existem'} ` +
          'mais no roteiro -- ele mudou depois que voce marcou. Limpe e marque de novo.',
      })
      return
    }

    /*
     * REAPROVEITA os clipes que ja estao no projeto, e so importa os novos.
     *
     * Remontar reimportava tudo: o enquadramento que ele arrastou voltava ao
     * rosto detectado, o cache do upscale era pago de novo, e o bloco novo nao
     * tinha como saber qual velho ele era. Com o mesmo asset de volta, as tres
     * coisas se resolvem -- ver @shared/remontar.
     */
    const { images: imagensVelhas, plan: planoVelho } = get()
    const reusadas = reaproveitar(caminhos, imagensVelhas)
    const faltam = caminhos.filter((_, i) => reusadas[i] === null)

    set({
      busy:
        faltam.length === 0
          ? 'Remontando...'
          : `Trazendo ${faltam.length} ${faltam.length === 1 ? 'cena' : 'cenas'}...`,
      libraryError: null,
    })
    let novas: ImageAsset[] = []
    if (faltam.length > 0) {
      const importadas = await window.dangai.importImages(faltam)
      if (!importadas.ok) {
        set({ busy: null, error: importadas.error })
        return
      }
      novas = importadas.value
    }
    let proxima = 0
    const imagens = reusadas.map((img) => img ?? novas[proxima++]!)

    /*
     * As cenas se costuram, e a EMENDA CAI NO COMECO DA FALA SEGUINTE.
     *
     * Vao no plano e tela preta no video, entao alguem tem que ficar com a
     * pausa entre uma frase e outra. Ate aqui quem ficava era a cena NOVA: ela
     * comecava onde a anterior tinha acabado, ou seja, no silencio, antes de a
     * frase dela comecar. Era isso que fazia "o clipe nao iniciar aonde estava
     * marcado pelo roteiro" -- a Biblioteca prometia a cena casada com a frase,
     * e o video trocava a imagem antes de a frase comecar.
     *
     * MEDIDO no projeto dele (Ram x Lye, 42 trechos, 272 palavras): 1,98s de
     * pausa somada em 41 emendas, mediana 0,030s, nove emendas acima de 0,10s
     * e a maior com 0,240s -- quase seis frames de imagem nova em cima do
     * silencio da frase anterior.
     *
     * Agora quem segura a pausa e a cena ANTERIOR, que so fica um pouco mais
     * longa. A imagem troca quando a fala troca, que e onde o olho espera. O
     * mesmo vale para frase sem cena nenhuma: o tempo dela inteiro e absorvido
     * por quem vem antes. As pontas seguem presas ao zero e ao fim da narracao.
     */
    const blocos = spans.map((s, i) => ({
      start: i === 0 ? 0 : s.start,
      end:
        i === spans.length - 1
          ? Math.max(s.end, audio.durationSec)
          : spans[i + 1]!.start,
      text: '',
      characters: [],
      candidates: [],
    }))

    /*
     * Cada bloco herda os ajustes do bloco que ja mostrava o MESMO clipe:
     * camera, efeito, curva, trecho do clipe, giro. Voltar a selecao para
     * consertar UMA cena nao pode custar o trabalho feito em todas as outras.
     */
    const { plan } = herdarAjustes(
      planoDosBlocos(blocos, audio.durationSec, pares),
      imagens,
      planoVelho,
      imagensVelhas,
    )

    set({
      images: imagens,
      plan,
      planOrigin: 'auto',
      // O plano saiu das frases dele; reanalisar o trocaria por distribuicao.
      planEdited: true,
      automountBlocks: null,
      libraryOpen: false,
      selectedScene: null,
      selecionados: [],
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
      /*
       * "Ainda serve" conta as IMAGENS que o plano usa, e nao as cenas: tela
       * dividida usa duas num bloco so. Comparar cenas com imagens jogava fora
       * todo plano com tela dividida na primeira reanalise.
       */
      const usadas = state.plan?.scenes.reduce((n, c) => n + (c.imageIndexB === null ? 1 : 2), 0)
      const keepPlan = state.planEdited && usadas === images.length

      set({
        plan: keepPlan ? state.plan : result.value.plan,
        // Trocando o plano, a selecao passa a apontar para blocos que nao sao
        // mais os mesmos -- e colar ajustes neles estragaria trabalho calado.
        ...(keepPlan ? {} : { selectedScene: null, selecionados: [] }),
        planOrigin: keepPlan ? state.planOrigin : result.value.origin,
        transcript: result.value.transcript,
        captions: state.captionsEdited
          ? state.captions
          : buildCaptions(result.value.transcript, state.captionRules),
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

  /**
   * Arrastar na tira reordena os BLOCOS, sem refazer o plano.
   *
   * Duas coisas erradas moravam aqui, e as duas apareciam no mesmo gesto:
   *
   *  - o plano era TROCADO por fatias iguais (`setInterimPlan`). Camera,
   *    movimento, trecho do clipe, transicao: tudo o que ele tinha ajustado ia
   *    embora num arraste -- "ele joga para um lugar aleatorio";
   *  - e cada troca de posicao disparava `analyze()`, que roda transcricao e
   *    planejamento no main. O `onReorder` do motion avisa a CADA posicao
   *    trocada, e nao no fim do gesto: arrastar por cinco lugares eram cinco
   *    analises empilhadas. "Congela tudo".
   *
   * A conta mora em shared/plan, onde da para conferi-la sem a interface junto.
   * Nada e reanalisado: a ordem nova e a verdade, e nao uma sugestao a refazer.
   */
  reorderImages: (novas) => {
    const { images: antes, plan } = get()
    if (!plan) {
      set({ images: novas })
      return
    }

    const feito = reordenarBlocos(
      plan,
      antes.map((img) => img.id),
      novas.map((img) => img.id),
    )
    if (!feito) {
      // Lista que nao e permutacao da atual: mexe so na tira.
      set({ images: novas })
      return
    }

    set({
      images: novas,
      plan: feito.plan,
      // So conta como edicao quando os blocos REALMENTE andaram: reapontar
      // referencia nao muda o video, e nao deve impedir uma reanalise futura.
      ...(feito.moveuBlocos ? { planEdited: true } : {}),
    })
  },

  removeImage: (id) => {
    set((state) => ({
      images: state.images.filter((image) => image.id !== id),
      selectedScene: null,
      selecionados: [],
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
  alternarTrancaDasCenas: () =>
    set((state) => ({
      cenasTrancadas: !state.cenasTrancadas,
      // O aviso de "trancada" sai junto com a tranca.
      error: state.error?.startsWith('A faixa de cenas esta trancada') ? null : state.error,
      projectDirty: true,
    })),

  insertImages: async (paths, seconds) => {
    if (get().cenasTrancadas) {
      set({ error: 'A faixa de cenas esta trancada. Clique no cadeado da faixa Cenas para mexer nos cortes.' })
      return
    }
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
      // Tela cheia: a divisao e escolha dele, feita na fita da Biblioteca.
      imageIndexB: null,
      start: inicio + i * passo,
      end: i === n - 1 ? fim : inicio + (i + 1) * passo,
      effect: KEN_BURNS_EFFECTS[(at + i) % KEN_BURNS_EFFECTS.length] ?? 'zoom-in',
      intensity: 0.12,
      // A metade de baixo segue a de cima ate ele separar as duas.
      effectB: null,
      intensityB: null,
      // Comeca no inicio do clipe, como todo bloco novo.
      sourceStart: 0,
      sourceStartB: 0,
      // Herda a curva do bloco que cedeu o tempo, e nao o padrao: quem ja
      // ajustou o ritmo do video inteiro nao quer o bloco novo destoando.
      curve: anfitriao.curve,
      curvePoints: null,
      // Camera livre so quando ele desenhar as pontas.
      camera: null,
      rotation: 0 as const,
      transitionIn: 'cut' as const,
    }))

    // Os dois indices andam -- ver @shared/indices.
    const reindexar = (scene: Scene): Scene => abrirEspaco(scene, at, n)

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
      selecionados: [],
      busy: null,
    })
  },

  /**
   * Tira um bloco da linha do tempo, junto com a imagem dele. O tempo vai para
   * o vizinho, senao sobraria um buraco preto no meio do video.
   */
  removeScene: (index) => {
    if (get().cenasTrancadas) {
      set({ error: 'A faixa de cenas esta trancada. Clique no cadeado da faixa Cenas para mexer nos cortes.' })
      return
    }
    const { plan, images } = get()
    if (!plan) return
    // Tela dividida leva as duas imagens, e os dois indices de todo mundo
    // descem -- ver @shared/indices.
    const feito = removerCena(plan, images, index)
    if (!feito) return

    set({
      images: feito.images,
      plan: feito.plan,
      planEdited: true,
      selectedScene: null,
      selecionados: [],
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
      // Invertido: recorta a copia invertida, na chave dela no cache.
      id: image.invertido ? `${image.id}-inv` : image.id,
      path: image.invertido && image.caminhoInvertido ? image.caminhoInvertido : image.path,
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

  inverterClipe: async (sceneIndex, metade) => {
    const { plan, images } = get()
    const cena = plan?.scenes[sceneIndex]
    const alvo = imagemDaMetade(plan, sceneIndex, metade)
    const asset = alvo === null ? undefined : images[alvo]
    if (!cena || !asset || asset.kind !== 'video') return

    const invertido = !asset.invertido
    set({ busy: invertido ? 'Invertendo o clipe...' : 'Desinvertendo o clipe...', error: null })
    const r = await window.dangai.inverterClipe(asset, invertido)
    if (!r.ok) {
      set({ busy: null, error: r.error })
      return
    }

    /*
     * O MESMO TRECHO, tocando ao contrario.
     *
     * O bloco mostrava [s, s+d] do clipe. No arquivo invertido esses quadros
     * moram em [D-s-d, D-s] -- entao o ponto de entrada vira D-s-d, e o bloco
     * continua mostrando o momento que ele tinha escolhido, so que de tras
     * para frente. Vale nos dois sentidos: inverter de novo volta para s.
     */
    const total = asset.durationSec ?? 0
    const d = cena.end - cena.start
    const campo = metade === 'baixo' ? 'sourceStartB' : 'sourceStart'
    const s0 = (metade === 'baixo' ? cena.sourceStartB : cena.sourceStart) ?? 0
    const novoInicio = Math.max(0, total - s0 - d)

    const atual = get()
    set({
      images: atual.images.map((img, i) => (i === alvo ? r.value : img)),
      plan: atual.plan
        ? {
            ...atual.plan,
            scenes: atual.plan.scenes.map((c, i) => (i === sceneIndex ? { ...c, [campo]: novoInicio } : c)),
          }
        : atual.plan,
      planEdited: true,
      busy: null,
      projectDirty: true,
    })
  },

  /*
   * O VIDEO PRONTO: "importar um video pronto so pra fazer a legenda ou algum
   * ajuste como corte e etc".
   *
   * O mesmo arquivo entra duas vezes: como NARRACAO (o audio dele, que manda
   * no tempo, e de onde o Whisper tira as legendas) e como o clipe de UM bloco
   * do comeco ao fim, sem movimento. Como o bloco toca o clipe desde o zero, o
   * que se ve continua batendo com o que se ouve. Cortar (C) parte o bloco e a
   * segunda metade continua de onde a primeira parou -- dai cada pedaco ganha
   * zoom, transicao, cor, SFX como qualquer bloco. O formato segue o video:
   * deitado abre como Long form, em pe como Short.
   */
  legendarVideoPronto: async (caminhoDado) => {
    let caminho = caminhoDado ?? null
    if (!caminho) {
      const escolha = await window.dangai.escolherVideo()
      if (!escolha.ok) {
        set({ error: escolha.error })
        return
      }
      caminho = escolha.value
    }
    if (!caminho) return

    set({ busy: 'Lendo o video...', error: null })
    const sonda = await window.dangai.sondarVideo(caminho)
    if (!sonda.ok) {
      set({ busy: null, error: sonda.error })
      return
    }
    if (!sonda.value.temAudio) {
      set({ busy: null, error: 'Esse video nao tem audio: nao ha fala para legendar nem para mandar no tempo.' })
      return
    }

    // Antes de importar: o recorte do clipe sai no quadro do formato.
    await get().definirFormato(sonda.value.width > sonda.value.height ? 'long' : 'short')

    set({ busy: 'Preparando o video...' })
    const importado = await window.dangai.importImages([caminho])
    if (!importado.ok || importado.value.length === 0) {
      set({ busy: null, error: importado.ok ? 'Nao deu para abrir esse video.' : importado.error })
      return
    }

    set({ busy: 'Lendo o audio do video...' })
    const audio = await window.dangai.analyzeAudio(caminho)
    if (!audio.ok) {
      set({ busy: null, error: audio.error })
      return
    }

    const duracao = audio.value.durationSec
    const plano = planEqualSplit(1, duracao)
    set({
      images: importado.value,
      audio: audio.value,
      playhead: 0,
      // Legenda ligada mesmo no Long form: e para isso que ele trouxe o video.
      captionsEnabled: true,
      plan: {
        ...plano,
        scenes: plano.scenes.map((cena) => ({
          ...cena,
          effect: 'nenhum' as const,
          sourceStart: 0,
          transitionIn: 'cut' as const,
        })),
      },
      planOrigin: 'equal',
      // Editado: a analise abaixo traz as legendas sem redistribuir o bloco.
      planEdited: true,
      selectedScene: null,
      selecionados: [],
      busy: null,
    })
    await get().analyze()
  },

  melhorarVideoPronto: async () => {
    if (get().videoPronto) return
    set({ error: null, videoProntoSaida: null })
    const r = await window.dangai.upscaleVideoPronto()
    set({ videoPronto: null })
    if (!r.ok) {
      set({ error: `O upscale do video falhou: ${r.error}` })
      return
    }
    // null: fechou o dialogo ou cancelou. Nada a dizer.
    if (r.value) set({ videoProntoSaida: r.value })
  },

  cancelarVideoPronto: async () => {
    await window.dangai.cancelarUpscale()
  },

  setVideoProntoProgresso: (p) => set({ videoPronto: p }),

  /**
   * A mesma curva em todas as cenas.
   *
   * Existe porque o projeto real dele tem 46 blocos: escolher o ritmo de camera
   * um a um seria 46 idas ao painel para uma decisao que quase sempre e do video
   * inteiro, nao de um bloco.
   */
  applyCurveToAll: (curve, pontos) => {
    const { plan } = get()
    if (!plan) return
    set({
      plan: {
        ...plan,
        scenes: plan.scenes.map((scene) => ({ ...scene, curve, curvePoints: pontos ?? null })),
      },
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
    if (get().cenasTrancadas) return
    const { plan } = get()
    if (!plan || index <= 0 || index >= plan.scenes.length) return

    const previous = plan.scenes[index - 1]!
    const next = plan.scenes[index]!

    /*
     * O ARRASTE E LIVRE. O piso de 0,6s vale na MONTAGEM, nao aqui.
     *
     * `MIN_SCENE_SEC` existe para nenhum bloco NASCER piscando, e nisso ele
     * continua mandando: e o planner, o snap e o sanitize que o respeitam. Mas
     * ele tambem barrava o ajuste a mao, e a fronteira entre dois blocos curtos
     * simplesmente nao andava -- ele arrastava e nada acontecia. Palavras dele:
     * "nao quero ser barrado quando quero expandir ou diminuir um clipe".
     *
     * Sobra o unico limite que nao e gosto e sim aritmetica: um bloco nao pode
     * ter duracao zero nem negativa, senao ele some do video e leva junto o
     * proprio meio de ser recuperado. Um frame de cada lado basta para isso, e
     * um frame e curto o suficiente para nao atrapalhar ninguem.
     */
    const umFrame = 1 / VIDEO_FPS
    const min = previous.start + umFrame
    const max = next.end - umFrame
    if (max <= min) return

    const clamped = Math.min(Math.max(seconds, min), max)

    const scenes = plan.scenes.map((scene, i) => {
      if (i === index - 1) return { ...scene, end: clamped }
      if (i === index) return { ...scene, start: clamped }
      return scene
    })

    set({ plan: { ...plan, scenes }, planEdited: true })
  },

  /**
   * Parte em dois o bloco que esta sob a agulha.
   *
   * UMA IMAGEM, UM BLOCO -- inclusive aqui. A regra vale contra o app repartir
   * sozinho, e quem aperta C esta pedindo o bloco a mais. Mas o bloco novo ganha
   * a PROPRIA entrada na lista de imagens, uma copia da que ele partiu, em vez
   * de as duas metades dividirem a mesma.
   *
   * Foi assim que a primeira versao errou. Ela deixava as duas metades com o
   * mesmo `imageIndex`, e o app inteiro conta com a igualdade "cena i usa imagem
   * i": `openLibraryToReplace` guarda o indice da CENA e depois escreve em
   * `images[indice]`. Depois de um corte, mandar trocar a segunda metade
   * trocava o clipe do bloco SEGUINTE -- que foi exatamente o que ele viu.
   *
   * Duplicar a imagem conserta isso na raiz, e de quebra faz o corte sobreviver
   * ao `sanitize`, que reconstroi o plano contando uma cena por imagem.
   */
  splitSceneAtPlayhead: () => {
    if (get().cenasTrancadas) {
      set({ error: 'A faixa de cenas esta trancada. Clique no cadeado da faixa Cenas para mexer nos cortes.' })
      return
    }
    const { plan, playhead, images } = get()
    if (!plan) return

    const index = plan.scenes.findIndex(
      (scene) => playhead > scene.start && playhead < scene.end,
    )
    if (index === -1) return

    const scene = plan.scenes[index]!
    /*
     * O CORTE TAMBEM E LIVRE, pelo mesmo motivo do arraste.
     *
     * Exigia 0,6s de cada lado, com o argumento de que as metades precisavam
     * nascer utilizaveis. Mas quem aperta C escolheu o ponto, e o bloco curto
     * que sai dali pode ser esticado na linha do tempo -- que agora tambem nao
     * barra ninguem. A regra so atrapalhava quem queria um quadro isolado no
     * fim de um bloco.
     *
     * Fica o limite aritmetico: um frame de cada lado, senao o corte produziria
     * um bloco de duracao zero, que some do video.
     */
    const umFrame = 1 / VIDEO_FPS
    if (playhead - scene.start < umFrame) return
    if (scene.end - playhead < umFrame) return

    const original = images[scene.imageIndex]
    if (!original) return
    const originalB = scene.imageIndexB === null ? undefined : images[scene.imageIndexB]

    /*
     * Tela dividida ganha copia das DUAS metades.
     *
     * Copiar so a de cima deixava as duas metades do corte com a mesma imagem
     * de baixo -- e trocar a de baixo de uma trocava a da outra, o mesmo
     * defeito que a copia existe para evitar.
     *
     * As copias entram logo DEPOIS da original: na fita da Biblioteca as
     * imagens aparecem na ordem dos blocos, e mandar a copia para o fim da
     * lista poria na tela uma ordem que nao existe na linha do tempo.
     */
    const sufixo = `+corte${Math.round(playhead * 1000)}`
    const copias = [
      { ...original, id: `${original.id}${sufixo}` },
      ...(originalB ? [{ ...originalB, id: `${originalB.id}${sufixo}` }] : []),
    ]
    const at = Math.max(scene.imageIndex, scene.imageIndexB ?? -1) + 1
    const reindexar = (alvo: Scene): Scene => abrirEspaco(alvo, at, copias.length)
    const andou = playhead - scene.start

    const scenes = [
      ...plan.scenes.slice(0, index).map(reindexar),
      { ...reindexar(scene), end: playhead },
      {
        ...reindexar(scene),
        imageIndex: at,
        imageIndexB: originalB ? at + 1 : null,
        start: playhead,
        /*
         * O clipe CONTINUA de onde parou, em vez de rebobinar.
         *
         * Um print ignora este campo. Num clipe, herdar o sourceStart do bloco
         * inteiro faria a segunda metade repetir o mesmo trecho que a primeira
         * acabou de mostrar -- que e o oposto de cortar. Vale para as duas
         * metades da tela dividida.
         */
        sourceStart: scene.sourceStart + andou,
        sourceStartB: (scene.sourceStartB ?? 0) + andou,
        // Corte seco entre as metades: uma transicao aqui inventaria um efeito
        // que ele nao pediu, bem no ponto onde ele mandou cortar.
        transitionIn: 'cut' as const,
      },
      ...plan.scenes.slice(index + 1).map(reindexar),
    ]

    set({
      images: [...images.slice(0, at), ...copias, ...images.slice(at)],
      plan: { ...plan, scenes },
      planEdited: true,
      // A segunda metade fica selecionada: quem corta costuma querer mexer
      // justamente no pedaco novo.
      selectedScene: index + 1,
      selecionados: [],
    })
  },

  setScript: async (script) => {
    const clean = script?.trim() ? script : null
    // Roteiro novo refaz as legendas do zero: manter as antigas seria misturar
    // texto de duas fontes.
    set({ script: clean, captionsEdited: false, scriptNote: null })
    await get().analyze()
  },

  openScript: (open) => set({ scriptOpen: open }),

  openCaptions: (open) => set(open ? { captionsOpen: true, binsOpen: false } : { captionsOpen: false }),

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

  editCaptionText: (index, text) => {
    const { captions } = get()
    const block = captions[index]
    const tokens = text.trim().split(/\s+/).filter((t) => t.length > 0)
    if (!block || tokens.length === 0) return

    /*
     * Mesmo numero de palavras: so o texto muda, cada palavra no seu tempo.
     * Numero diferente: nao ha como saber qual palavra nova e qual velha, e o
     * tempo do bloco e repartido pelo tamanho de cada uma -- a mesma conta do
     * dividir do LegendAI. O bloco nao sai do lugar em nenhum dos casos.
     */
    let words: CaptionBlock['words']
    if (tokens.length === block.words.length) {
      words = block.words.map((w, i) => ({ ...w, text: tokens[i]! }))
    } else {
      const pesos = tokens.map((t) => Math.max(t.length, 1))
      const soma = pesos.reduce((a, b) => a + b, 0)
      const fim = block.from + block.durationInFrames
      let cursor = block.from
      let acumulado = 0
      words = tokens.map((t, i) => {
        acumulado += pesos[i]!
        const ate = i === tokens.length - 1 ? fim : Math.round(block.from + (block.durationInFrames * acumulado) / soma)
        const from = Math.min(cursor, fim - 1)
        const to = Math.max(Math.min(ate, fim), from + 1)
        cursor = to
        return { text: t, from, durationInFrames: to - from }
      })
    }
    set({
      captions: captions.map((item, i) => (i === index ? { ...item, words } : item)),
      captionsEdited: true,
    })
  },

  resetCaptions: () => {
    set({ captions: buildCaptions(get().transcript, get().captionRules), captionsEdited: false })
  },

  setCaptionRules: (patch) => {
    const parsed = regrasDaLegendaSchema.safeParse({ ...get().captionRules, ...patch })
    if (!parsed.success) return
    const regras = parsed.data
    const { transcript, captions, captionsEdited } = get()
    /*
     * Legenda editada NAO e refeita: mesclar e dividir sao decisoes dele. Ela
     * so ganha os tempos pelas regras novas -- adiantar, fechar vaos, duracao.
     */
    const novas = !captionsEdited
      ? buildCaptions(transcript, regras)
      : retemporizar(captions, palavrasDasLegendas(captions, transcript), regras)
    set({ captionRules: regras, captions: novas })
  },

  ressincronizarLegendas: async () => {
    const { audio, transcript } = get()
    if (!audio || !transcript || transcript.words.length === 0) return
    set({ busy: 'Sincronizando as legendas com a narracao...', error: null })
    const r = await window.dangai.sincronizarLegendas(
      audio.path,
      transcript.words.map((w) => w.text),
    )
    if (!r.ok) {
      set({ busy: null, error: `Nao deu para sincronizar: ${r.error}` })
      return
    }
    // O mesmo limite do LegendAI: abaixo disto o texto nao e o que se ouve.
    if (r.value.score < 0.35) {
      set({
        busy: null,
        error: 'A sincronia nao reconheceu o texto na narracao. Confira se o roteiro e deste audio.',
      })
      return
    }
    const words = transcript.words.map((w, i) => ({
      ...w,
      start: r.value.tempos[i]!.start,
      end: Math.max(r.value.tempos[i]!.end, r.value.tempos[i]!.start),
    }))
    const novo = {
      ...transcript,
      words,
      cutCandidates: cutCandidatesFrom(words, transcript.segments),
      alinhado: true,
    }
    const { captions, captionsEdited, captionRules } = get()
    set({
      transcript: novo,
      captions: captionsEdited
        ? retemporizar(captions, palavrasDasLegendas(captions, novo), captionRules)
        : buildCaptions(novo, captionRules),
      busy: null,
      projectDirty: true,
    })
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

  refreshFontes: async () => {
    const r = await window.dangai.listFontes()
    if (!r.ok) return
    const fontes = r.value
    /*
     * A fonte escolhida some quando o arquivo some.
     *
     * Ele pode apagar da pasta entre uma sessao e outra. Manter a escolha
     * apontando para um arquivo que nao existe faria o render cair na fonte
     * reserva sem dizer por que.
     */
    const escolhida = get().captionFont
    const aindaExiste = escolhida && fontes.find((f) => f.nome === escolhida.nome)
    set({ fontes, captionFont: aindaExiste ?? null })
  },

  setCaptionFont: (nome) => {
    if (nome === null) {
      set({ captionFont: null })
      return
    }
    const achada = get().fontes.find((f) => f.nome === nome)
    if (achada) set({ captionFont: achada })
  },

  openFontesDir: async () => {
    await window.dangai.openFontesDir()
  },

  setCaptionAnimation: (animation) => set({ captionAnimation: animation }),

  setCaptionAnimationFrames: (frames) =>
    set({
      captionAnimationFrames: Math.min(
        Math.max(Math.round(frames), CAPTION_ANIMATION_FRAMES_MIN),
        CAPTION_ANIMATION_FRAMES_MAX,
      ),
    }),

  setCaptionAnimationCurve: (curva) => {
    /*
     * Ordenada, presa as pontas e conferida pelo schema: o primeiro ponto fica
     * em t = 0 e o ultimo em t = 1 com escala 1 -- a entrada sempre termina no
     * tamanho da legenda, por mais que ele arraste.
     */
    const pts = [...curva].sort((a, b) => a.t - b.t)
    if (pts.length < 2) return
    pts[0] = { ...pts[0]!, t: 0 }
    // A alca de chegada do fim continua dele: e ela que faz o pouso suave.
    pts[pts.length - 1] = { ...pts[pts.length - 1]!, t: 1, v: 1 }
    const ok = curvaDaEntradaSchema.safeParse(pts)
    if (ok.success) set({ captionAnimationCurve: ok.data })
  },

  setCaptionMark: (mark) => set({ captionMark: mark }),

  setCaptionShadow: (patch) =>
    set((state) => ({ captionShadow: { ...state.captionShadow, ...patch } })),

  setCaptionStroke: (px) =>
    set({
      captionStroke: Math.min(Math.max(Math.round(px), CAPTION_STROKE_MIN), CAPTION_STROKE_MAX),
    }),

  addSfxAt: async (paths, seconds) => {
    const audios = paths.filter((p) => classifyFile(p) === 'audio')
    if (audios.length === 0) return

    /*
     * Analisa o som para saber quanto ele DURA e como e a onda dele.
     *
     * Sem isso o chip era um retangulo de tamanho fixo, e ele nao tinha como
     * saber onde estava pondo -- palavras dele: "como eu vou saber onde estou
     * pondo se o sfx nao tem waveform". A mesma analise devolve a URL do
     * servidor local, que e o que faz o som TOCAR no preview.
     */
    for (const [i, path] of audios.entries()) {
      const r = await window.dangai.analyzeAudio(path)
      if (!r.ok) {
        set({ error: r.error })
        continue
      }
      set((state) => ({
        sfxManual: [
          ...state.sfxManual,
          {
            id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
            path,
            fileName: r.value.fileName,
            // Soltar dois de uma vez espalha, para nao empilharem no mesmo ponto.
            at: Math.max(0, seconds + i * 0.25),
            durationSec: r.value.durationSec,
            peaks: reduzirPicos(r.value.peaks),
            url: r.value.url,
            usarSec: null,
            gainDb: 0,
          },
        ],
        projectDirty: true,
      }))
    }
  },

  addTrilhasAt: async (paths, seconds, faixa) => {
    const audios = paths.filter((p) => classifyFile(p) === 'audio')
    let cursor = Math.max(0, seconds)
    for (const [i, path] of audios.entries()) {
      const r = await window.dangai.analyzeAudio(path)
      if (!r.ok) {
        set({ error: r.error })
        continue
      }
      const trecho = {
        id: `trilha-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        path,
        fileName: r.value.fileName,
        faixa,
        at: cursor,
        durationSec: r.value.durationSec,
        inicioSec: 0,
        usarSec: null,
        // Entra em 0 dB, como o arquivo veio: "todo audio importado ta vindo
        // -20 dB". O volume de musica de fundo e um dos atalhos do controle.
        gainDb: 0,
        // Sem fade: "quero eles por padrao, e o fade eu adiciono quando quiser".
        fadeInSec: 0,
        fadeOutSec: 0,
        ...ondaDoTrecho(r.value),
        url: r.value.url,
      }
      // Soltar varios de uma vez enfileira na mesma faixa, um depois do outro.
      cursor += r.value.durationSec
      set((state) => ({ trilhas: [...state.trilhas, trecho], projectDirty: true }))
    }
  },

  moveTrilha: (id, at, faixa) =>
    set((state) => ({
      trilhas: state.trilhas.map((t) =>
        t.id === id ? { ...t, at: Math.max(0, at), faixa: faixa === undefined ? t.faixa : Math.max(0, faixa) } : t,
      ),
      projectDirty: true,
    })),

  cortarFimDaTrilha: (id, toca) =>
    set((state) => ({
      trilhas: state.trilhas.map((t) => {
        if (t.id !== id) return t
        if (toca === null) return { ...t, usarSec: null }
        const max = t.durationSec - t.inicioSec
        return { ...t, usarSec: Math.min(Math.max(toca, 0.1), max) }
      }),
      projectDirty: true,
    })),

  cortarInicioDaTrilha: (id, at) =>
    set((state) => ({
      trilhas: state.trilhas.map((t) => {
        if (t.id !== id) return t
        /*
         * Puxar a borda ESQUERDA: o fim fica onde estava, e o trecho passa a
         * entrar mais tarde (comendo o comeco do arquivo) ou mais cedo
         * (devolvendo o que tinha sido comido). Nao volta antes do comeco do
         * arquivo nem passa do proprio fim.
         */
        const fim = t.at + duracaoDoTrecho(t)
        const novoAt = Math.min(Math.max(at, t.at - t.inicioSec, 0), fim - 0.1)
        const delta = novoAt - t.at
        return { ...t, at: novoAt, inicioSec: t.inicioSec + delta, usarSec: fim - novoAt }
      }),
      projectDirty: true,
    })),

  ajustarTrilha: (id, patch) =>
    set((state) => ({
      trilhas: state.trilhas.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      projectDirty: true,
    })),

  removeTrilha: (id) =>
    set((state) => ({ trilhas: state.trilhas.filter((t) => t.id !== id), projectDirty: true })),

  refreshTrilhas: async () => {
    const atuais = get().trilhas
    if (atuais.length === 0) return
    const repostos = await Promise.all(
      atuais.map(async (t) => {
        const r = await window.dangai.analyzeAudio(t.path)
        // A onda tambem e refeita: projeto salvo com a onda antiga (120 barras,
        // sem RMS) abre com a nova.
        return r.ok ? { ...t, url: r.value.url, ...ondaDoTrecho(r.value) } : t
      }),
    )
    set({ trilhas: repostos })
  },

  addSobreposicoesAt: async (paths, seconds, faixa) => {
    const visuais = paths.filter((p) => {
      const t = classifyFile(p)
      return t === 'video' || t === 'image'
    })
    let cursor = Math.max(0, seconds)
    for (const [i, path] of visuais.entries()) {
      set({ busy: 'Preparando o video para a faixa...' })
      const r = await window.dangai.prepararSobreposicao(path)
      set({ busy: null })
      if (!r.ok) {
        set({ error: r.error })
        continue
      }
      const imagem = r.value.tipo === 'image'
      const nova = {
        id: `sobre-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        path,
        fileName: path.split(/[\\/]/).pop() ?? path,
        tipo: r.value.tipo,
        faixa,
        at: cursor,
        durationSec: r.value.durationSec,
        inicioSec: 0,
        // Imagem nasce com 3 s na tela; video, inteiro.
        usarSec: imagem ? 3 : null,
        x: 0,
        y: 0,
        escala: 1,
        opacidade: 1,
        aspecto: r.value.aspecto,
        espelhar: false,
        fadeInSec: 0,
        fadeOutSec: 0,
        rotacao: 0,
        efeito: 'nenhum' as const,
        intensidade: 0.1,
        curva: MOTION_CURVE_DEFAULT,
        pontosDaCurva: null,
        url: r.value.url,
      }
      cursor += imagem ? 3 : r.value.durationSec
      set((state) => ({ sobreposicoes: [...state.sobreposicoes, nova], projectDirty: true }))
    }
  },

  moveSobreposicao: (id, at, faixa) =>
    set((state) => ({
      sobreposicoes: state.sobreposicoes.map((o) =>
        o.id === id ? { ...o, at: Math.max(0, at), faixa: faixa === undefined ? o.faixa : Math.max(0, faixa) } : o,
      ),
      projectDirty: true,
    })),

  cortarFimDaSobreposicao: (id, toca) =>
    set((state) => ({
      sobreposicoes: state.sobreposicoes.map((o) => {
        if (o.id !== id) return o
        if (toca === null) return { ...o, usarSec: o.tipo === 'video' ? null : 3 }
        return { ...o, usarSec: Math.min(Math.max(toca, 0.1), o.durationSec - o.inicioSec) }
      }),
      projectDirty: true,
    })),

  cortarInicioDaSobreposicao: (id, at) =>
    set((state) => ({
      sobreposicoes: state.sobreposicoes.map((o) => {
        if (o.id !== id) return o
        const toca = o.usarSec ?? o.durationSec - o.inicioSec
        const fim = o.at + toca
        // Imagem nao tem "comeco do arquivo": a borda esquerda so move a entrada.
        const piso = o.tipo !== 'video' ? 0 : Math.max(o.at - o.inicioSec, 0)
        const novoAt = Math.min(Math.max(at, piso), fim - 0.1)
        const delta = novoAt - o.at
        return {
          ...o,
          at: novoAt,
          inicioSec: o.tipo !== 'video' ? 0 : o.inicioSec + delta,
          usarSec: fim - novoAt,
        }
      }),
      projectDirty: true,
    })),

  ajustarSobreposicao: (id, patch) =>
    set((state) => ({
      sobreposicoes: state.sobreposicoes.map((o) => (o.id === id ? { ...o, ...patch } : o)),
      projectDirty: true,
    })),

  removeSobreposicao: (id) =>
    set((state) => ({ sobreposicoes: state.sobreposicoes.filter((o) => o.id !== id), projectDirty: true })),

  refreshSobreposicoes: async () => {
    const atuais = get().sobreposicoes
    if (atuais.length === 0) return
    const repostos = await Promise.all(
      atuais.map(async (o) => {
        // A camada de ajuste nao tem arquivo: e so um filtro sobre o que esta embaixo.
        if (o.tipo === 'ajuste') return o
        const r = await window.dangai.prepararSobreposicao(o.path)
        return r.ok ? { ...o, url: r.value.url } : o
      }),
    )
    set({ sobreposicoes: repostos })
  },

  alternarMudo: (tipo, faixa) =>
    set((state) => {
      const atuais = state.faixasMudas[tipo]
      const proximos = atuais.includes(faixa) ? atuais.filter((f) => f !== faixa) : [...atuais, faixa]
      return { faixasMudas: { ...state.faixasMudas, [tipo]: proximos }, projectDirty: true }
    }),

  selecionarClipe: (clipe) => set({ clipeSelecionado: clipe, outrosClipes: [] }),

  alternarClipeNaSelecao: (clipe) =>
    set((state) => {
      const todos = clipesEscolhidos(state)
      const ja = todos.some((c) => c.tipo === clipe.tipo && c.id === clipe.id)
      const lista = ja ? todos.filter((c) => !(c.tipo === clipe.tipo && c.id === clipe.id)) : [clipe, ...todos]
      return { clipeSelecionado: lista[0] ?? null, outrosClipes: lista.slice(1) }
    }),

  definirSelecaoDeClipes: (clipes) => set({ clipeSelecionado: clipes[0] ?? null, outrosClipes: clipes.slice(1) }),

  removerClipesEscolhidos: () => {
    const todos = clipesEscolhidos(get())
    if (todos.length === 0) return false
    const audio = new Set(todos.filter((c) => c.tipo === 'audio').map((c) => c.id))
    const video = new Set(todos.filter((c) => c.tipo === 'video').map((c) => c.id))
    set((state) => ({
      trilhas: state.trilhas.filter((t) => !audio.has(t.id)),
      sobreposicoes: state.sobreposicoes.filter((o) => !video.has(o.id)),
      clipeSelecionado: null,
      outrosClipes: [],
      projectDirty: true,
    }))
    return true
  },

  duplicarClipe: (tipo, id) => {
    const novoId = `${id.replace(/-d\d+$/, '')}-d${Date.now()}`
    if (tipo === 'audio') {
      const t = get().trilhas.find((x) => x.id === id)
      if (!t) return null
      set((state) => ({ trilhas: [...state.trilhas, { ...t, id: novoId }], projectDirty: true }))
    } else {
      const o = get().sobreposicoes.find((x) => x.id === id)
      if (!o) return null
      set((state) => ({ sobreposicoes: [...state.sobreposicoes, { ...o, id: novoId }], projectDirty: true }))
    }
    return novoId
  },

  clipeCopiado: null,

  copiarClipe: () => {
    const todos = clipesEscolhidos(get())
    if (todos.length === 0) return false
    set({ clipeCopiado: todos })
    return true
  },

  /*
   * COLAR: o grupo copiado entra na agulha, cada clipe na mesma distancia dos
   * outros que tinha, e na faixa dele se couber -- senao na primeira livre
   * acima. Os colados viram a selecao.
   */
  colarClipe: () => {
    const copiados = get().clipeCopiado
    if (!copiados || copiados.length === 0) return false
    const { playhead } = get()
    type Ocupa = { id: string; faixa: number; at: number; fim: number }
    const ocupacao = (tipo: 'video' | 'audio'): Ocupa[] =>
      tipo === 'audio'
        ? get().trilhas.map((t) => ({ id: t.id, faixa: t.faixa, at: t.at, fim: t.at + duracaoDoTrecho(t) }))
        : get().sobreposicoes.map((o) => ({ id: o.id, faixa: o.faixa, at: o.at, fim: o.at + (o.usarSec ?? o.durationSec - o.inicioSec) }))
    const originais: { c: (typeof copiados)[number]; o: Ocupa }[] = []
    for (const c of copiados) {
      const o = ocupacao(c.tipo).find((x) => x.id === c.id)
      if (o) originais.push({ c, o })
    }
    if (originais.length === 0) return false
    const inicio = Math.min(...originais.map((x) => x.o.at))
    const colados: { tipo: 'video' | 'audio'; id: string }[] = []
    for (const { c, o } of originais) {
      const at = Math.max(0, playhead + (o.at - inicio))
      const dur = o.fim - o.at
      const lista = ocupacao(c.tipo)
      const livre = (faixa: number): boolean =>
        lista.every((x) => x.faixa !== faixa || at + dur <= x.at + 1e-6 || at >= x.fim - 1e-6)
      // A faixa dele primeiro; senao as de cima; senao uma nova, acima de todas.
      const maior = Math.max(...lista.map((x) => x.faixa))
      let faixa = o.faixa
      while (!livre(faixa) && faixa <= maior) faixa += 1
      const novoId = get().duplicarClipe(c.tipo, c.id)
      if (!novoId) continue
      if (c.tipo === 'audio') get().moveTrilha(novoId, at, faixa)
      else get().moveSobreposicao(novoId, at, faixa)
      colados.push({ tipo: c.tipo, id: novoId })
    }
    set({ clipeSelecionado: colados[0] ?? null, outrosClipes: colados.slice(1) })
    return colados.length > 0
  },

  removerFaixa: (tipo, faixa) =>
    set((state) => {
      const desce = <T extends { faixa: number }>(lista: readonly T[]): T[] =>
        lista.filter((x) => x.faixa !== faixa).map((x) => (x.faixa > faixa ? { ...x, faixa: x.faixa - 1 } : x))
      const mudas = state.faixasMudas[tipo].filter((f) => f !== faixa).map((f) => (f > faixa ? f - 1 : f))
      const sumiu =
        state.clipeSelecionado?.tipo === tipo &&
        (tipo === 'audio' ? state.trilhas : state.sobreposicoes).some(
          (x) => x.id === state.clipeSelecionado?.id && x.faixa === faixa,
        )
      return {
        ...(tipo === 'audio' ? { trilhas: desce(state.trilhas) } : { sobreposicoes: desce(state.sobreposicoes) }),
        faixasMudas: { ...state.faixasMudas, [tipo]: mudas },
        clipeSelecionado: sumiu ? null : state.clipeSelecionado,
        outrosClipes: [],
        projectDirty: true,
      }
    }),

  addCamadaDeAjuste: (faixa) => {
    const { playhead, plan, audio } = get()
    // Nasce cobrindo o bloco da agulha -- o caso de "corrigir esta cena" --, ou
    // 5 s quando a agulha nao esta sobre bloco nenhum.
    const bloco = plan?.scenes.find((c) => playhead >= c.start && playhead < c.end)
    const at = bloco ? bloco.start : Math.max(0, playhead)
    const fimDoVideo = audio?.durationSec ?? at + 5
    const dur = Math.max(0.2, Math.min(bloco ? bloco.end - bloco.start : 5, fimDoVideo - at))
    const nova = {
      id: `ajuste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: '',
      fileName: 'Camada de ajuste',
      tipo: 'ajuste' as const,
      faixa,
      at,
      durationSec: 3600,
      inicioSec: 0,
      usarSec: dur,
      x: 0,
      y: 0,
      escala: 1,
      opacidade: 1,
      aspecto: 16 / 9,
      rotacao: 0,
      efeito: 'nenhum' as const,
      intensidade: 0.1,
      curva: MOTION_CURVE_DEFAULT,
      pontosDaCurva: null,
      cor: AJUSTE_DE_COR_PADRAO,
      espelhar: false,
      fadeInSec: 0,
      fadeOutSec: 0,
      url: '',
    }
    set((state) => ({
      sobreposicoes: [...state.sobreposicoes, nova],
      clipeSelecionado: { tipo: 'video', id: nova.id },
      outrosClipes: [],
      projectDirty: true,
    }))
  },

  cortarClipeNaAgulha: () => {
    const { clipeSelecionado, playhead } = get()
    if (!clipeSelecionado) return false
    const novoId = (id: string): string => `${id}-c${Math.round(playhead * 1000)}`

    /*
     * O CORTE DE EDITOR: a primeira metade fica com o comeco, a segunda
     * continua do ponto exato do arquivo onde a primeira parou -- nada repete,
     * nada pula. O fade de saida fica so na segunda, e o de entrada so na
     * primeira: a emenda no meio e seca, como num editor.
     */
    if (clipeSelecionado.tipo === 'audio') {
      const t = get().trilhas.find((x) => x.id === clipeSelecionado.id)
      if (!t) return false
      const toca = duracaoDoTrecho(t)
      const local = playhead - t.at
      if (local <= 0.05 || local >= toca - 0.05) return false
      const primeira = { ...t, usarSec: local, fadeOutSec: 0 }
      const segunda = {
        ...t,
        id: novoId(t.id),
        at: playhead,
        inicioSec: t.inicioSec + local,
        usarSec: toca - local,
        fadeInSec: 0,
      }
      set((state) => ({
        trilhas: state.trilhas.flatMap((x) => (x.id === t.id ? [primeira, segunda] : [x])),
        clipeSelecionado: { tipo: 'audio', id: segunda.id },
        outrosClipes: [],
        projectDirty: true,
      }))
      return true
    }

    const o = get().sobreposicoes.find((x) => x.id === clipeSelecionado.id)
    if (!o) return false
    const toca = o.usarSec ?? o.durationSec - o.inicioSec
    const local = playhead - o.at
    if (local <= 0.05 || local >= toca - 0.05) return false
    const primeira = { ...o, usarSec: local }
    const segunda = {
      ...o,
      id: novoId(o.id),
      at: playhead,
      // Imagem nao tem "ponto do arquivo": as duas metades sao a mesma imagem.
      inicioSec: o.tipo !== 'video' ? 0 : o.inicioSec + local,
      usarSec: toca - local,
    }
    set((state) => ({
      sobreposicoes: state.sobreposicoes.flatMap((x) => (x.id === o.id ? [primeira, segunda] : [x])),
      clipeSelecionado: { tipo: 'video', id: segunda.id },
      outrosClipes: [],
      projectDirty: true,
    }))
    return true
  },

  refazerLegendasNaoEditadas: () => {
    const { captionsEdited, transcript, captionRules } = get()
    if (captionsEdited || !transcript || transcript.words.length === 0) return
    set({ captions: buildCaptions(transcript, captionRules) })
  },

  migrarSonsAntigos: async () => {
    const { sfxManual, music, musicGainDb, audio, trilhas } = get()
    if (sfxManual.length === 0 && !music) return

    /*
     * "Pode tirar essa track de SFX e deixar so as de audio, que eu vou usar
     * os SFX por la. Os botoes de SFX e Musica pode tirar tambem, esse sistema
     * vai ser inutil a partir de agora."
     *
     * Tirar so a tela deixaria os projetos antigos com SFX e musica que nada
     * mostra e nada desliga. Entao o que eles tinham vira CLIPE, nas faixas de
     * audio, no mesmo volume: o SFX era mixado a -12 dB mais o ajuste dele, e
     * a cama de musica, no ganho dela, com os mesmos fades.
     */
    const novas: typeof trilhas = []
    let proximaFaixa = Math.max(...trilhas.map((t) => t.faixa + 1), 0)
    const ocupado = new Map<number, { at: number; fim: number }[]>()
    const caber = (at: number, fim: number, primeira: number): number => {
      for (let f = primeira; ; f++) {
        const lista = ocupado.get(f) ?? []
        if (lista.every((o) => fim <= o.at || at >= o.fim)) {
          lista.push({ at, fim })
          ocupado.set(f, lista)
          return f
        }
      }
    }

    const faixaDosSfx = proximaFaixa
    for (const som of [...sfxManual].sort((a, b) => a.at - b.at)) {
      const toca = som.usarSec ?? som.durationSec
      const faixa = caber(som.at, som.at + toca, faixaDosSfx)
      novas.push({
        id: `sfx-${som.id}`,
        path: som.path,
        fileName: som.fileName,
        faixa,
        at: som.at,
        durationSec: som.durationSec,
        inicioSec: 0,
        usarSec: som.usarSec,
        gainDb: Math.round(-12 + som.gainDb),
        fadeInSec: 0,
        fadeOutSec: som.usarSec !== null ? 0.03 : 0,
        peaks: som.peaks,
        rms: [],
        url: som.url,
      })
    }
    proximaFaixa = Math.max(proximaFaixa, ...novas.map((t) => t.faixa + 1))

    if (music && audio) {
      const r = await window.dangai.analyzeAudio(music.path)
      if (r.ok && r.value.durationSec > 0) {
        // A cama repetia a musica ate o fim: vira um clipe por volta.
        const total = audio.durationSec
        let at = 0
        let volta = 0
        while (at < total - 0.05) {
          const toca = Math.min(r.value.durationSec, total - at)
          novas.push({
            id: `musica-${Date.now()}-${volta}`,
            path: music.path,
            fileName: r.value.fileName,
            faixa: proximaFaixa,
            at,
            durationSec: r.value.durationSec,
            inicioSec: 0,
            usarSec: toca < r.value.durationSec ? toca : null,
            gainDb: Math.round(musicGainDb),
            fadeInSec: at === 0 ? MUSIC_FADE_IN_SEC : 0,
            fadeOutSec: at + toca >= total - 0.05 ? MUSIC_FADE_OUT_SEC : 0,
            ...ondaDoTrecho(r.value),
            url: r.value.url,
          })
          at += toca
          volta += 1
        }
      }
    }

    set((state) => ({
      trilhas: [...state.trilhas, ...novas],
      sfxManual: [],
      music: null,
      projectDirty: true,
    }))
  },

  refreshSfxManual: async () => {
    const atuais = get().sfxManual
    if (atuais.length === 0) return
    const repostos = await Promise.all(
      atuais.map(async (som) => {
        const r = await window.dangai.analyzeAudio(som.path)
        return r.ok ? { ...som, url: r.value.url } : som
      }),
    )
    set({ sfxManual: repostos })
  },

  moveSfx: (id, seconds) =>
    set((state) => ({
      sfxManual: state.sfxManual.map((s) => (s.id === id ? { ...s, at: Math.max(0, seconds) } : s)),
      projectDirty: true,
    })),

  trimSfx: (id, seconds) =>
    set((state) => ({
      sfxManual: state.sfxManual.map((som) =>
        som.id === id
          ? {
              ...som,
              /*
               * O corte nao passa do arquivo nem fica curto demais para ouvir.
               * Puxar a alca ate o comeco deixaria um som de duracao zero, que
               * no video e silencio com um chip ocupando espaco.
               */
              usarSec:
                seconds === null
                  ? null
                  : Math.min(Math.max(seconds, SFX_MINIMO_SEC), som.durationSec),
            }
          : som,
      ),
      projectDirty: true,
    })),

  setSfxGain: (id, gainDb) =>
    set((state) => ({
      sfxManual: state.sfxManual.map((som) =>
        som.id === id
          ? { ...som, gainDb: Math.min(Math.max(Math.round(gainDb), SFX_GAIN_MIN), SFX_GAIN_MAX) }
          : som,
      ),
      projectDirty: true,
    })),

  removeSfx: (id) =>
    set((state) => ({
      sfxManual: state.sfxManual.filter((s) => s.id !== id),
      projectDirty: true,
    })),

  clearSfxManual: () => set({ sfxManual: [], projectDirty: true }),

  loadCurvePresets: async () => {
    const r = await window.dangai.getSettings()
    if (r.ok) set({ curvePresets: r.value.curvePresets })
  },

  saveCurvePreset: async (pontos) => {
    const atuais = get().curvePresets
    /*
     * Nome automatico, e nao um campo de texto.
     *
     * Batizar cada curva no meio do ajuste quebra o ritmo do trabalho, e um
     * modal para isso brigaria com a regra de nao ter modal. "Minha 1, 2, 3"
     * e feio mas basta: o que identifica uma curva na lista e o desenho dela
     * na cabeca dele, nao o nome.
     */
    let n = atuais.length + 1
    while (atuais.some((c) => c.nome === `Minha ${n}`)) n += 1
    const proximas = [...atuais, { nome: `Minha ${n}`, pontos }]
    set({ curvePresets: proximas })
    await window.dangai.saveSettings({ curvePresets: proximas })
  },

  removeCurvePreset: async (nome) => {
    const proximas = get().curvePresets.filter((c) => c.nome !== nome)
    set({ curvePresets: proximas })
    await window.dangai.saveSettings({ curvePresets: proximas })
  },

  toggleUpscale: () => set((state) => ({ upscale: !state.upscale })),

  // Grampeia aqui e nao so na interface: a store tambem e chamada pelo Ctrl+K e
  // pela restauracao de projeto, e um valor fora da faixa jogaria a legenda para
  // fora da tela ou para cima do card de fechamento.
  setCaptionY: (y) => set({ captionY: Math.min(Math.max(y, CAPTION_Y_MIN), CAPTION_Y_MAX) }),

  // Preso na faixa pelo mesmo motivo da altura: o valor tambem chega pela
  // restauracao de projeto, e fora da faixa o ajuste automatico o desfaria.
  setCaptionScale: (scale) =>
    set({ captionScale: Math.min(Math.max(scale, CAPTION_SCALE_MIN), CAPTION_SCALE_MAX) }),

  openPalette: (open) => set({ paletteOpen: open }),

  /*
   * Abrir varre so na primeira vez. Depois disso o indice fica no estado e a
   * tela abre instantanea -- reler seria pagar de novo por uma resposta que nao
   * mudou, e o botao "Sincronizar" existe justamente para quando ela mudou.
   */
  openLibrary: async (open) => {
    // Fechar cancela a substituicao: sair da tela e desistir da pergunta.
    set(open ? { libraryOpen: true } : { libraryOpen: false, replaceTarget: null })
    if (!open) return
    // Os apelidos vem junto: sao poucos bytes e a tela precisa deles para dizer
    // quantos cada serie tem.
    await Promise.all([
      get().library ? Promise.resolve() : get().syncLibrary(),
      get().loadNicknames(),
      get().loadFavorites(),
      get().loadTags(),
      get().loadDescriptions(),
    ])
  },

  loadNicknames: async () => {
    const result = await window.dangai.readNicknames()
    if (result.ok) set({ nicknames: result.value })
  },

  loadFavorites: async () => {
    const result = await window.dangai.readFavorites()
    if (result.ok) set({ favorites: result.value })
  },

  loadTags: async () => {
    const result = await window.dangai.readTags()
    if (result.ok) set({ tags: result.value })
  },

  loadDescriptions: async () => {
    const result = await window.dangai.readDescriptions()
    if (result.ok) set({ descriptions: result.value })
  },

  describeLibrary: async (anime) => {
    if (get().describeBusy) return
    /*
     * Um anime por vez, e nunca sozinho.
     *
     * Sao ~4,9s por cena: um episodio leva meia hora e o acervo inteiro passa
     * de 24. Por isso o botao le o anime aberto, e nao tudo -- ele consegue
     * trabalhar no mesmo dia em vez de esperar uma noite antes do primeiro uso.
     */
    set({ describeBusy: true, libraryError: null, libraryBusy: 'Preparando o leitor de cenas...' })
    const result = await window.dangai.describeLibrary(anime)
    if (result.ok) set({ descriptions: result.value, describeBusy: false, libraryBusy: null })
    else set({ libraryError: result.error, describeBusy: false, libraryBusy: null })
  },

  tagLibrary: async () => {
    if (get().taggerBusy) return
    /*
     * `libraryBusy` comeca preenchido de proposito.
     *
     * setLibraryBusy so substitui um andamento que JA existe -- guarda que
     * existe para a mensagem final da varredura nao ressuscitar o "carregando".
     * Sem semear aqui, os treze minutos de etiquetagem passariam em silencio e
     * a tela pareceria travada.
     */
    set({ taggerBusy: true, libraryError: null, libraryBusy: 'Preparando o etiquetador...' })
    const result = await window.dangai.tagLibrary()
    if (result.ok) set({ tags: result.value, taggerBusy: false, libraryBusy: null })
    else set({ libraryError: result.error, taggerBusy: false, libraryBusy: null })
  },

  toggleFavorite: async (id) => {
    /*
     * A tela muda ANTES do disco responder.
     *
     * Favoritar e um gesto de garimpo: ele passa por dezenas de cenas marcando
     * as boas, e uma estrela que so acende depois do ida-e-volta do IPC faz
     * cada clique parecer que nao pegou. O disco confirma logo atras, e se
     * falhar a lista volta ao que o main disse que e verdade.
     */
    const antes = get().favorites
    set({
      favorites: antes.includes(id) ? antes.filter((x) => x !== id) : [...antes, id],
    })
    const result = await window.dangai.toggleFavorite(id)
    if (result.ok) set({ favorites: result.value })
    else set({ favorites: antes, libraryError: result.error })
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

  copiarAjustes: (index) => {
    const cena = get().plan?.scenes[index]
    if (!cena) return
    set({
      ajustesCopiados: {
        effect: cena.effect,
        intensity: cena.intensity,
        effectB: cena.effectB ?? null,
        intensityB: cena.intensityB ?? null,
        curve: cena.curve,
        curvePoints: cena.curvePoints ?? null,
        rotation: cena.rotation ?? 0,
        transitionIn: cena.transitionIn,
        transicao: cena.transicao,
      },
    })
  },

  colarAjustes: (indices) => {
    const { plan, ajustesCopiados } = get()
    if (!plan || !ajustesCopiados) return

    /*
     * Filtra contra o plano de AGORA.
     *
     * A selecao e esvaziada a cada mudanca de estrutura, mas filtrar aqui custa
     * uma linha e fecha a porta de vez: colar num indice que nao existe mais
     * seria estragar um bloco que ninguem escolheu, em silencio.
     */
    const alvos = new Set(indices.filter((i) => i >= 0 && i < plan.scenes.length))
    if (alvos.size === 0) return

    const scenes = plan.scenes.map((cena, i) =>
      alvos.has(i) ? { ...cena, ...ajustesCopiados } : cena,
    )
    set({ plan: { ...plan, scenes }, planEdited: true })
  },

  definirFormato: async (formato) => {
    // Horizontal ja entra sem legenda: e o que ele pediu, e evita gerar um
    // video com as regras de short num quadro que nao e o delas.
    set(formato === 'long' ? { formato, captionsEnabled: false } : { formato })
    await window.dangai.setFormato(formato)
  },

  selectScene: (index) =>
    // Escolher um BLOCO tira a escolha de clipe: o C volta a cortar o bloco.
    set({ selectedScene: index, selecionados: index === null ? [] : [index], clipeSelecionado: null, outrosClipes: [] }),

  /**
   * Shift+clique: o intervalo inteiro entre a ancora e o bloco clicado.
   *
   * Sem ancora, vale como um clique simples -- nao ha de onde medir o intervalo,
   * e recusar o clique deixaria o usuario sem entender por que nada aconteceu.
   *
   * A ancora NAO se move: e dela que o proximo Shift+clique mede, e e ela que o
   * painel edita. Mover a ancora a cada Shift faria o intervalo escorregar a
   * cada tentativa de corrigi-lo.
   */
  estenderSelecao: (index) => {
    const { selectedScene } = get()
    if (selectedScene === null) {
      set({ selectedScene: index, selecionados: [index] })
      return
    }
    const de = Math.min(selectedScene, index)
    const ate = Math.max(selectedScene, index)
    const faixa: number[] = []
    for (let i = de; i <= ate; i++) faixa.push(i)
    set({ selecionados: faixa })
  },

  /**
   * Ctrl+clique: liga ou desliga um bloco, sem mexer no resto.
   *
   * Tirando a ancora da selecao, a ancora passa a ser o primeiro que sobrou --
   * o painel precisa estar editando algo que ainda esta selecionado, senao ele
   * mostra um bloco que a timeline nao destaca mais.
   */
  alternarSelecao: (index) => {
    const { selecionados, selectedScene } = get()
    const tinha = selecionados.includes(index)
    const nova = tinha
      ? selecionados.filter((i) => i !== index)
      : [...selecionados, index].sort((a, b) => a - b)

    if (nova.length === 0) {
      set({ selecionados: [], selectedScene: null })
      return
    }
    const ancora = selectedScene !== null && nova.includes(selectedScene) ? selectedScene : nova[0]!
    set({ selecionados: nova, selectedScene: ancora })
  },

  selectImage: (id) => {
    const { images, plan } = get()
    const imageIndex = images.findIndex((image) => image.id === id)
    if (imageIndex < 0 || !plan) {
      set({ selectedScene: null, selecionados: [] })
      return
    }
    const scene = plan.scenes.findIndex((item) => item.imageIndex === imageIndex)
    set({
      selectedScene: scene >= 0 ? scene : null,
      selecionados: scene >= 0 ? [scene] : [],
    })
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
      captionY, captionScale, music, musicGainDb,
    } = get()
    if (!audio || images.length === 0 || !plan) return null

    /*
     * Bloco que aponta para imagem inexistente some do video EM SILENCIO.
     *
     * toRenderProps descarta essas cenas -- e precisa descartar, senao o render
     * quebraria --, mas ate agora ninguem era avisado: o video saia com a
     * duracao certa e um pedaco a menos de conteudo, que e exatamente o
     * sintoma de "cortou os ultimos blocos". Se o plano e a esteira
     * discordarem, e melhor recusar e dizer do que entregar um video errado
     * sem avisar.
     */
    // A metade de baixo conta igual: bloco dividido com uma das duas faltando
    // sairia com meia tela preta, e em silencio.
    const orfas = plan.scenes.filter(
      (scene) => !images[scene.imageIndex] || (scene.imageIndexB !== null && !images[scene.imageIndexB]),
    )
    if (orfas.length > 0) {
      set({
        error:
          `${orfas.length} ${orfas.length === 1 ? 'bloco aponta' : 'blocos apontam'} para uma cena ` +
          'que nao esta mais no projeto, e sairiam do video sem aviso. ' +
          'Monte de novo antes de renderizar.',
      })
      return null
    }

    set({
      playing: false,
      error: null,
      render: { progress: 0, stage: 'bundling', message: 'Preparando...' },
    })

    const { hookText, hookSec, endText, endSec } = get()

    /*
     * O upscale acontece AQUI, antes de montar as props.
     *
     * As cenas melhoradas saem com as mesmas medidas do recorte de sempre, e a
     * unica coisa que muda e a `url` de cada asset. Assim nada depois deste
     * ponto -- nem as props, nem o Remotion, nem a mixagem -- precisa saber que
     * o upscale existiu.
     *
     * So as cenas que o video USA: o plano pode apontar para 40 de 200 imagens
     * importadas, e melhorar as outras 160 seria pagar por nada.
     *
     * Falhando, o render segue sem upscale em vez de morrer. Perder a melhoria
     * e chato; perder o render inteiro depois de esperar por ele e pior.
     */
    let imagens = images
    if (get().upscale) {
      const usadas = new Set<number>()
      /*
       * Ate que segundo de cada clipe o video chega.
       *
       * O bloco toca de `sourceStart` por `end - start` segundos; depois disso
       * o clipe continua existindo mas ninguem ve. Melhorar so ate ali corta um
       * bom pedaco da espera -- as cenas da biblioteca quase sempre sobram.
       *
       * A mesma cena pode aparecer duas vezes com pontos de entrada diferentes,
       * entao vale o MAIOR alcance entre os blocos que a usam.
       */
      const limites: Record<string, number> = {}
      const alcancar = (
        indice: number,
        cena: (typeof plan.scenes)[number],
        /*
         * A METADE DE BAIXO PARTE DE OUTRO PONTO.
         *
         * Ela usa `sourceStartB`, e este calculo usava `sourceStart` para as
         * duas. Numa tela dividida em que a de baixo entrava mais adiante no
         * clipe, o arquivo melhorado era cortado antes do trecho que ela toca
         * -- e o render acabava o video no meio do bloco, congelando o ultimo
         * quadro sem nada avisar.
         */
        inicio: number,
      ): void => {
        usadas.add(indice)
        const id = images[indice]?.id
        if (!id) return
        const ate = inicio + (cena.end - cena.start)
        limites[id] = Math.max(limites[id] ?? 0, ate)
      }
      for (const cena of plan.scenes) {
        alcancar(cena.imageIndex, cena, cena.sourceStart ?? 0)
        if (cena.imageIndexB !== null) alcancar(cena.imageIndexB, cena, cena.sourceStartB ?? 0)
      }
      const alvos = images
        .filter((_, i) => usadas.has(i))
        // Invertido melhora a COPIA invertida: e ela que a cena toca.
        .map((img) => (img.invertido && img.caminhoInvertido ? { ...img, path: img.caminhoInvertido } : img))
      const melhoradas = await window.dangai.upscaleAssets(alvos, limites)
      // Cancelado no meio: o render para aqui, sem seguir sem o upscale.
      if (melhoradas.ok && melhoradas.value === null) {
        set({ render: null })
        return null
      }
      if (melhoradas.ok && melhoradas.value) {
        const mapa = melhoradas.value
        imagens = images.map((img) =>
          mapa[img.id] ? { ...img, url: mapa[img.id]! } : img,
        )
      } else if (!melhoradas.ok) {
        set({ error: `O upscale falhou (${melhoradas.error}); renderizando sem ele.` })
      }
    }

    const result = await window.dangai.startRender({
      props: toRenderProps(
        plan,
        imagens,
        captionsEnabled ? captions : [],
        { hook: hookText, hookSec, end: endText, endSec },
        captionColor,
        captionY,
        // O MESMO numero que vai na composicao logo abaixo. Eram duas contas
        // separadas, e quando discordavam o fim do video ficava sem imagem.
        audio.durationSec,
        {
          font: get().captionFont?.url ? {
            family: familiaDaFonte(get().captionFont!.nome),
            url: get().captionFont!.url,
          }
        : null,
          animation: get().captionAnimation,
          animationFrames: get().captionAnimationFrames,
          animationCurve: get().captionAnimationCurve,
          mark: get().captionMark,
          shadow: get().captionShadow,
          stroke: get().captionStroke,
          scale: get().captionScale,
        },
        get().formato,
        get().sobreposicoes.filter((o) => !get().faixasMudas.video.includes(o.faixa)),
      ),
      audioPath: audio.path,
      durationInFrames: totalFrames(audio.durationSec),
      // Os cues sao montados aqui e nao guardados no plano: eles dependem dos
      // arquivos que estao na pasta AGORA, e o usuario pode ter acabado de
      // trocar os sons sem refazer a analise.
      /*
       * Os postos a mao mandam. So quando nao ha nenhum e que o rodizio
       * automatico entra -- ver o comentario de `sfxManual` no estado.
       */
      /*
       * O rodizio automatico de SFX e a cama de musica sairam: o som do video e
       * o das faixas de audio. Projeto antigo ja chega aqui migrado -- ver
       * migrarSonsAntigos.
       */
      sfxCues: [],
      music: null,
      trilhas: get()
        .trilhas.filter((t) => !get().faixasMudas.audio.includes(t.faixa))
        .map((t) => ({
        path: t.path,
        at: t.at,
        inicioSec: t.inicioSec,
        duracaoSec: duracaoDoTrecho(t),
        gainDb: t.gainDb,
        fadeInSec: t.fadeInSec,
        fadeOutSec: t.fadeOutSec,
      })),
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

  seguirRosto: async (index) => {
    const { plan, images } = get()
    const cena = plan?.scenes[index]
    const image = cena ? images[cena.imageIndex] : undefined
    if (!cena?.camera || !image) return 'nenhum'

    /*
     * Os mesmos dois instantes que os quadros de enquadrar mostram.
     *
     * Se aqui fosse outro par, o botao encheria as pontas com um rosto que a
     * tela nao esta mostrando -- e o usuario veria o retangulo pular para um
     * lugar sem relacao com a imagem na frente dele.
     */
    const inicio = cena.sourceStart ?? 0
    const fim = inicio + (cena.end - cena.start)

    set({ busy: 'Procurando o rosto...', error: null })
    const r = await window.dangai.faceAt(image.path, [inicio, fim])
    set({ busy: null })
    if (!r.ok) {
      set({ error: r.error })
      return 'nenhum'
    }

    const [noComeco, noFim] = r.value
    if (!noComeco && !noFim) return 'nenhum'

    /*
     * O rosto de UMA ponta serve para as duas.
     *
     * Achar so no comeco e o caso comum -- o personagem vira de perfil no meio
     * do corte e o detector para de responder. Repetir o que se achou deixa a
     * camera parada e certa, em vez de deixar a outra ponta no centro, que e
     * quase sempre o lugar errado.
     */
    const quadro = medidasDo(get().formato)
    const aspectoDoQuadro = quadro.width / quadro.height
    const aspecto = fonteDaCamera(image, cena.camera, aspectoDoQuadro).aspecto
    const de = noComeco ?? noFim!
    const ate = noFim ?? noComeco!

    get().updateScene(index, {
      camera: {
        ...cena.camera,
        // A escala de cada ponta e mantida: ela e a aproximacao que ele
        // escolheu, e mexer nela seria mudar duas coisas num pedido so.
        from: enquadrar(de.centroX, de.centroY, cena.camera.from.scale, aspecto, aspectoDoQuadro),
        to: enquadrar(ate.centroX, ate.centroY, cena.camera.to.scale, aspecto, aspectoDoQuadro),
      },
    })
    return noComeco && noFim ? 'ambos' : 'um'
  },

  rastrear: async (index) => {
    const { plan, images } = get()
    const cena = plan?.scenes[index]
    const image = cena ? images[cena.imageIndex] : undefined
    if (!cena?.camera || !image || image.kind !== 'video') return null

    /*
     * O ALVO E O PROPRIO RETANGULO INICIAL.
     *
     * Nao ha uma segunda ferramenta de selecao: ele ja arrasta esse retangulo
     * para escolher o que aparece, e "o que aparece no comeco" e exatamente o
     * que ele quer continuar vendo. Uma caixa separada seria um segundo jeito de
     * dizer a mesma coisa, com a chance de os dois discordarem.
     */
    const medidasQ = medidasDo(get().formato)
    const aspectoQ = medidasQ.width / medidasQ.height
    const fonte = fonteDaCamera(image, cena.camera, aspectoQ)
    const janela = janelaDaCamera(cena.camera.from, fonte.aspecto, aspectoQ)
    const alvo = alvoDoRastreio(janela, image.width, image.height)

    const inicio = cena.sourceStart ?? 0
    const duracao = cena.end - cena.start

    set({ busy: 'Seguindo o alvo...', error: null })
    const r = await window.dangai.trackBox(image.path, inicio, duracao, alvo)
    set({ busy: null })
    if (!r.ok) {
      set({ error: r.error })
      return null
    }

    const caminho = chavesDoCaminho(
      r.value.caminho,
      cena.camera.from,
      cena.camera.to,
      fonte.aspecto,
      aspectoQ,
    )
    if (!caminho) return null

    get().updateScene(index, { camera: { ...cena.camera, ...caminho } })
    return r.value.ateOnde
  },

  cancelAnalyze: async () => {
    await window.dangai.cancelAnalyze()
    /*
     * A tela e devolvida AQUI, e nao quando o main responder.
     *
     * Quem cancela quer a tela de volta agora. A leitura interrompida ainda vai
     * resolver com erro la atras, e a conferencia de que a narracao continua a
     * mesma cuida de nao deixar nada cair por cima depois.
     */
    set({ busy: null, scriptBlocksBusy: null, libraryBusy: null })
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
      selecionados: [],
      render: null,
      lastOutput: null,
      planEdited: false,
      automountBlocks: null,
      automountMode: null,
      automountSeries: null,
      replaceTarget: null,
      scriptBlocks: null,
      scriptBlocksBusy: null,
      activeBlock: null,
      blockClips: {},
      /*
       * Peso e uniao morrem junto com as marcacoes.
       *
       * Sao indexados por posicao do trecho, entao sobreviver a um "limpar"
       * significaria o proximo roteiro nascer com o 2x e a tela dividida do
       * roteiro anterior em trechos que nada tem a ver.
       */
      blockWeights: {},
      blockSplits: {},
      blockCuts: {},
      // A fila do uso sem roteiro some pelo mesmo motivo: sao cenas escolhidas
      // para ESTE video, e nada nelas quer dizer algo no proximo.
      escolhidos: [],
      /*
       * A faixa de SFX tambem esvazia.
       *
       * Sao sons posicionados contra ESTA narracao; sobreviver a um "limpar"
       * significaria o proximo video comecando com efeitos em instantes que
       * nao querem dizer nada nele.
       */
      sfxManual: [],
      trilhas: [],
      sobreposicoes: [],
      faixasMudas: { video: [], audio: [] },
      cenasTrancadas: false,
      clipeSelecionado: null,
      outrosClipes: [],
      // Volta ao padrao junto com o resto: sem isto, ter ligado o SFX num
      // projeto o traria ligado para o proximo, que e justamente o som
      // entrando sem ninguem pedir.
      // Projeto novo comeca no vertical, e a escolha aparece de novo.
      formato: FORMATO_PADRAO,
      sfxEnabled: false,
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
      formato: state.formato,
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
        invertido: image.invertido === true,
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
      // So o nome: a URL e desta sessao e nao vale nada na proxima abertura.
      captionFont: state.captionFont?.nome ?? '',
      captionAnimation: state.captionAnimation,
      captionAnimationFrames: state.captionAnimationFrames,
      captionAnimationCurve: state.captionAnimationCurve,
      captionMark: state.captionMark,
      captionShadow: state.captionShadow,
      captionStroke: state.captionStroke,
      // A URL fica de fora: ela e desta sessao e nao vale nada amanha.
      sfxManual: state.sfxManual.map(({ url: _fora, ...resto }) => resto),
      trilhas: state.trilhas.map(({ url: _fora, ...resto }) => resto),
      sobreposicoes: state.sobreposicoes.map(({ url: _fora, ...resto }) => resto),
      faixasMudas: state.faixasMudas,
      cenasTrancadas: state.cenasTrancadas,
      captionY: state.captionY,
      captionScale: state.captionScale,
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
      /*
       * A ESCOLHA EM ANDAMENTO na Biblioteca.
       *
       * As frases vao junto de proposito: `porBloco` e indexado por posicao da
       * frase, e as frases nascem de uma passada do Whisper que NAO roda de
       * novo ao abrir o projeto. Salvar os indices sem elas seria salvar
       * ponteiros para o vazio.
       */
      biblioteca: {
        escolhidos: state.escolhidos,
        blocos: state.scriptBlocks,
        porBloco: state.blockClips,
        pesos: state.blockWeights,
        unioes: state.blockSplits,
        cortes: state.blockCuts,
        ativo: state.activeBlock,
      },
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
    get().refazerLegendasNaoEditadas()
    // O projeto guarda so o NOME da fonte; e esta leitura que reencontra a URL
    // dela na pasta -- ou derruba a escolha, se o arquivo nao estiver mais la.
    await get().refreshFontes()
    await get().refreshSfxManual()
    await get().refreshTrilhas()
    await get().refreshSobreposicoes()
    await get().migrarSonsAntigos()
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
    get().refazerLegendasNaoEditadas()
    // Mesmo motivo do openProject: a fonte volta pelo nome e precisa da URL.
    await get().refreshFontes()
    await get().refreshSfxManual()
    await get().refreshTrilhas()
    await get().refreshSobreposicoes()
    await get().migrarSonsAntigos()
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

    /*
     * O MAIN PRECISA SABER O FORMATO ANTES das imagens entrarem.
     *
     * O recorte acontece la, na importacao: avisar depois faria o projeto
     * horizontal reabrir com todo o material recortado em 9:16 -- e o usuario
     * so descobriria olhando o preview.
     */
    await window.dangai.setFormato(file.formato)

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
     * Clipe invertido volta invertido. A copia invertida mora num cache por
     * arquivo, entao reabrir acha a que ja existe; so o recorte 9:16 e refeito.
     * Clipe que nao da para inverter mais (sumiu do disco) volta para frente,
     * em vez de impedir o projeto de abrir.
     */
    for (const [i, salva] of file.images.entries()) {
      const asset = images.value[i]
      if (!salva.invertido || !asset || asset.kind !== 'video') continue
      const r = await window.dangai.inverterClipe(asset, true)
      if (r.ok) images.value[i] = r.value
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
      formato: file.formato,
      // Conserta a metade de baixo que versoes anteriores desalinharam --
      // ver @shared/indices.
      plan: file.plan ? repararMetadesDeBaixo(file.plan, images.value.length).plan : file.plan,
      planOrigin: file.planOrigin,
      planEdited: file.planEdited,
      transcript: file.transcript,
      captions: file.captions,
      captionsEdited: file.captionsEdited,
      captionsEnabled: file.captionsEnabled,
      captionColor: file.captionColor,
      /*
       * A fonte volta pelo nome, e a URL e reencontrada.
       *
       * `refreshFontes` roda logo depois de abrir e resolve o par nome->URL; se
       * o arquivo nao estiver mais na pasta, ela derruba a escolha para a fonte
       * embutida em vez de deixar uma URL morta no projeto.
       */
      captionFont: file.captionFont ? { nome: file.captionFont, url: '' } : null,
      captionAnimation: file.captionAnimation,
      captionAnimationFrames: file.captionAnimationFrames,
      captionAnimationCurve: file.captionAnimationCurve,
      captionMark: file.captionMark,
      captionShadow: file.captionShadow,
      captionStroke: file.captionStroke,
      // Sem URL ainda; `refreshSfxManual` a repoe logo depois de abrir.
      sfxManual: file.sfxManual.map((s) => ({ ...s, url: '' })),
      trilhas: file.trilhas.map((t) => ({ ...t, url: '' })),
      sobreposicoes: file.sobreposicoes.map((o) => ({ ...o, url: '' })),
      faixasMudas: file.faixasMudas,
      cenasTrancadas: file.cenasTrancadas ?? false,
      captionY: file.captionY,
      captionScale: file.captionScale,
      sfxEnabled: file.sfxEnabled,

      // Nada de estado de sessao atravessa a abertura: o render anterior nao e
      // deste projeto, e um erro antigo na barra confundiria com falha ao abrir.
      playhead: 0,
      playing: false,
      selectedScene: null,
      selecionados: [],
      render: null,
      lastOutput: null,
      aiNote: null,

      /*
       * A ESCOLHA DA BIBLIOTECA VOLTA COMO ESTAVA -- com a ordem.
       *
       * E a unica coisa aqui que nao e estado de sessao: as outras linhas
       * deste bloco zeram de proposito, porque o render anterior e o erro
       * anterior nao sao deste projeto. A selecao E deste projeto, e e o
       * trabalho mais longo que ele faz no app.
       *
       * As frases voltam do arquivo em vez de serem recalculadas. Recalcular
       * pediria outra passada do Whisper ao abrir, e -- pior -- uma passada
       * que devolvesse uma frase a mais ou a menos deslocaria TODAS as
       * marcacoes em silencio, porque elas sao indexadas por posicao.
       */
      escolhidos: file.biblioteca.escolhidos,
      scriptBlocks: file.biblioteca.blocos,
      blockClips: file.biblioteca.porBloco,
      blockWeights: file.biblioteca.pesos,
      blockSplits: file.biblioteca.unioes,
      blockCuts: file.biblioteca.cortes,
      activeBlock: file.biblioteca.ativo,
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

/**
 * Aplica uma mudanca de trechos (juntar, separar) as cinco marcacoes de uma vez.
 *
 * As cinco andam juntas porque sao indexadas pela mesma coisa -- a posicao do
 * trecho. Trocar so as cenas e esquecer o peso deixaria um "2x" colado na
 * frase errada.
 */
function aplicarMarcacoes(
  set: SetState,
  get: () => ProjectState,
  mudar: (m: MarcacoesDosTrechos) => MarcacoesDosTrechos | null,
): void {
  const s = get()
  if (!s.scriptBlocks) return
  const r = mudar({
    blocos: s.scriptBlocks,
    porBloco: s.blockClips,
    pesos: s.blockWeights,
    unioes: s.blockSplits,
    cortes: s.blockCuts,
    ativo: s.activeBlock,
  })
  if (!r) return
  set({
    scriptBlocks: r.blocos,
    blockClips: r.porBloco,
    blockWeights: r.pesos,
    blockSplits: r.unioes,
    blockCuts: r.cortes,
    activeBlock: r.ativo,
    // Os trechos vao para o .dangai: juntar sem sujar seria perder a juncao
    // no proximo fechar, sem pergunta nenhuma.
    projectDirty: true,
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

/**
 * O que viaja num "copiar ajustes".
 *
 * So o COMO o bloco se comporta. O que descreve o material -- qual imagem,
 * de que ponto do clipe ela parte, o enquadramento da camera -- fica onde
 * esta, porque nao quer dizer nada num clipe diferente.
 */
export interface AjustesDeBloco {
  effect: Scene['effect']
  intensity: Scene['intensity']
  effectB: Scene['effectB']
  intensityB: Scene['intensityB']
  curve: Scene['curve']
  curvePoints: Scene['curvePoints']
  rotation: Scene['rotation']
  transitionIn: Scene['transitionIn']
  transicao: Scene['transicao']
}
