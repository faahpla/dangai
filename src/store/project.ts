import { create } from 'zustand'
import { classifyFile } from '@shared/channels'
import type {
  AutomountBlock,
  AutomountMode,
  ScriptBlock,
  LibraryIndex,
  MusicPick,
  Nickname,
  SceneDescription,
  UpdateStatus,
} from '@shared/channels'
import {
  CURVA_DA_ENTRADA_PADRAO,
  type CurvaDaEntrada,
  REGRAS_DA_LEGENDA_PADRAO,
  type RegrasDaLegenda,
  type CaptionPreset,
  type CurvaGuardada,
  type Bin,
  CAPTION_ANIMATION_DEFAULT,
  CAPTION_ANIMATION_FRAMES_DEFAULT,
  CAPTION_MARK_DEFAULT,
  CAPTION_SHADOW_DEFAULT,
  CAPTION_STROKE_DEFAULT,
  CAPTION_COLOR_DEFAULT,
  CAPTION_Y_DEFAULT,
  CAPTION_Y_MAX,
  CAPTION_Y_MIN,
  CAPTION_SCALE_DEFAULT,
  CAPTION_SCALE_MAX,
  CAPTION_SCALE_MIN,
  END_CARD_SEC_DEFAULT,
  HOOK_SEC_DEFAULT,
  MUSIC_GAIN_DB_DEFAULT,
  FORMATO_PADRAO,
} from '@shared/contract'
import type {
  AudioAnalysis,
  TrechoDeAudioSalvo,
  SobreposicaoSalva,
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
import type { CaptionBlock } from '@shared/contract'
import { type ProjectFile } from '@shared/project-file'
import { type Modulos } from '@shared/contract'
import { emitir, interceptarArquivos } from '@/modulos/ganchos'
import type { OrigemDosArquivos } from '@/modulos/api'
import { fatiaDaEscolhaDeCenas } from './projeto/escolha-de-cenas'
import { fatiaDasCenas } from './projeto/cenas'
import { fatiaDoVideoPronto } from './projeto/video-pronto'
import { fatiaDosCortes } from './projeto/cortes'
import { fatiaDasLegendas } from './projeto/legendas'
import { fatiaDoEstilo } from './projeto/estilo'
import { fatiaDasFaixas } from './projeto/faixas'
import { fatiaDaBiblioteca } from './projeto/biblioteca'
import { fatiaDoRender } from './projeto/render'
import { fatiaDoArquivo } from './projeto/arquivo'
import { fatiaDaFila } from './projeto/fila'
import { setInterimPlan } from './projeto/apoio'
import type { StoreApi } from 'zustand'

/** Estados da interface. Existem tres, e nao mais que tres. */
// As de apoio que o resto do app usa moram em ./projeto/apoio.
export { clipesEscolhidos, idsEscolhidos, formatTimecode } from './projeto/apoio'

/** O set e o get do store, para as fatias de ./projeto. */
export type SetProjeto = StoreApi<ProjectState>['setState']
export type GetProjeto = StoreApi<ProjectState>['getState']

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
   * TRANSCRICAO TRAVADA: os tempos das palavras ja sao os certos -- a voz
   * gerada (o Gerar recap) vem com eles -- e nenhuma reanalise roda o Whisper
   * por cima. Trocar o roteiro so casa o texto novo sobre estes tempos.
   * Trocar a NARRACAO destrava: os tempos eram da outra.
   */
  transcriptTravado: boolean
  /** Liga ou desliga a trava (marca a transcricao como alinhada). */
  travarTranscript: (travado: boolean) => void
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
  /** Abrir as Configuracoes ja numa secao (a de um modulo, por exemplo). */
  settingsSecao: string | null

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

  /**
   * OS DADOS DE MODULO do projeto (o Gerar recap), por id do modulo. O nucleo
   * so guarda e devolve: vai e volta do arquivo, entra no Ctrl+Z e no autosave.
   */
  modulos: Modulos
  /** Le o pedaco de um modulo. undefined = o modulo nao guardou nada aqui. */
  lerModulo: (id: string) => unknown
  /** Grava (ou, com undefined, apaga) o pedaco de um modulo. Um passo de Ctrl+Z. */
  gravarModulo: (id: string, dados: unknown) => void
  /**
   * Os campos da raiz do arquivo que este app NAO conhece -- de um app irmao
   * (o `studio` do AniRecap Studio) ou de uma versao futura. Nao sao editados:
   * voltam para o arquivo como vieram.
   */
  extrasDoProjeto: Record<string, unknown>

  phase: () => Phase
  /** `parte` nomeia uma parte do roteiro para este material. So a Biblioteca usa. */
  /**
   * Poe arquivos no projeto. `origem` diz que foi ele quem trouxe (soltou na
   * janela ou escolheu no dialogo): ai os modulos veem antes.
   */
  ingest: (paths: readonly string[], parte?: string, origem?: OrigemDosArquivos) => Promise<void>
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
  legendarVideoPronto: (caminho?: string, roteiro?: string | null) => Promise<void>
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
  /**
   * Um arquivo SO DE SOM (meme baixado com a miniatura grudada como capa) que
   * caiu numa faixa de video vai para uma faixa de AUDIO livre, no mesmo
   * ponto -- na de video ele nem tocava o som, e quebrava o render.
   */
  levarSomParaAudio: (path: string, at: number, corte?: { inicioSec: number; usarSec: number | null }) => Promise<boolean>
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
  /**
   * "Um botao que me leve exatamente para onde esta aquele clipe (episodio e
   * posicao na biblioteca)." Guarda o caminho e abre a Biblioteca, que poe o
   * anime e o episodio dele, rola ate o cartao e acende.
   */
  irParaClipe: string | null
  mostrarNaBiblioteca: (path: string) => Promise<void>
  /** A Biblioteca ja atendeu o pedido. */
  esquecerIrParaClipe: () => void
  /**
   * Mescla cenas seguidas de um episodio num clipe so (como o AnCut). Devolve
   * o recado para a tela, ou o erro.
   */
  mesclarCenas: (paths: readonly string[]) => Promise<{ ok: boolean; recado: string; path?: string }>
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
  /**
   * Troca o roteiro SEM perder as escolhas da Biblioteca: le os trechos novos
   * com o texto novo e so entao aplica tudo junto, com cada cena remapeada
   * para o trecho que cai no mesmo tempo. Um passo so de Ctrl+Z.
   */
  trocarRoteiro: (texto: string) => Promise<void>
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
  /**
   * A imagem cujo enquadramento esta sendo arrastado AGORA (ate o recorte novo
   * ficar pronto). So ela toca o original no preview -- ver focoAoVivo.
   */
  enquadrando: string | null
  /**
   * O ponto de entrada sendo ARRASTADO no "Trecho do clipe": o preview usa este
   * valor no lugar do salvo, para mudar junto com o dedo. Nao vai para o
   * projeto nem para o desfazer -- quem grava e o soltar (updateScene).
   */
  trechoAoVivo: { index: number; campo: 'sourceStart' | 'sourceStartB'; valor: number } | null
  definirTrechoAoVivo: (t: { index: number; campo: 'sourceStart' | 'sourceStartB'; valor: number } | null) => void
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
  openSettings: (open: boolean, secao?: string) => void
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
  transcriptTravado: false,

  travarTranscript: (travado) =>
    set((state) => ({
      transcriptTravado: travado,
      ...(travado && state.transcript && !state.transcript.alinhado
        ? { transcript: { ...state.transcript, alinhado: true } }
        : {}),
      projectDirty: true,
    })),
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
  enquadrando: null,
  trechoAoVivo: null,
  render: null,
  lastOutput: null,
  settingsOpen: false,
  settingsSecao: null,
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
  irParaClipe: null,
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
  modulos: {},
  extrasDoProjeto: {},

  lerModulo: (id) => get().modulos[id],

  gravarModulo: (id, dados) =>
    set((state) => {
      const { [id]: _antigo, ...resto } = state.modulos
      return { modulos: dados === undefined ? resto : { ...resto, [id]: dados }, projectDirty: true }
    }),

  phase: () => {
    const state = get()
    if (state.render && ['bundling', 'rendering', 'muxing'].includes(state.render.stage)) {
      return 'rendering'
    }
    return state.audio || state.images.length > 0 ? 'editing' : 'empty'
  },

  ingest: async (entrada, parte, origem) => {
    /*
     * O que ele TROUXE (soltou ou escolheu no dialogo) passa antes pelos
     * modulos: um episodio inteiro, por exemplo, vira "Gerar recap" e nao
     * chega aqui. Sem modulo ligado, nada muda.
     */
    const paths = origem ? await interceptarArquivos(entrada, origem) : entrada
    if (paths.length === 0) return
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
            ? 'Esses arquivos não servem. Solte um áudio (.mp3, .wav, .m4a), imagens (.png, .jpg, .webp) e o roteiro (.txt).'
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
        /*
         * So o roteiro mudou (a narracao continua): as escolhas vao junto,
         * remapeadas. Com uma narracao nova chegando na mesma leva, nao ha o
         * que preservar -- o tempo das escolhas era o do audio antigo.
         */
        if (audioPaths.length === 0 && get().audio && get().scriptBlocks) await get().trocarRoteiro(result.value)
        else set({ script: result.value, captionsEdited: false, scriptBlocks: null, blockClips: {}, blockWeights: {}, blockSplits: {}, blockCuts: {} })
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
      set({ busy: 'Analisando a narração...' })
      const anterior = get().audio?.path ?? null
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
          // Os tempos travados eram da narracao anterior.
          transcriptTravado: false,
          scriptBlocks: null,
          activeBlock: null,
          blockClips: {},
          blockWeights: {},
          blockSplits: {},
          blockCuts: {},
        })
        if (anterior !== null && anterior !== result.value.path) {
          emitir('narracaoTrocada', { anterior, nova: result.value.path })
        }
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

  ...fatiaDaEscolhaDeCenas(set, get),

  ...fatiaDasCenas(set, get),

  ...fatiaDoVideoPronto(set, get),

  ...fatiaDosCortes(set, get),

  ...fatiaDasLegendas(set, get),

  ...fatiaDoEstilo(set, get),

  ...fatiaDasFaixas(set, get),

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

  ...fatiaDaBiblioteca(set, get),

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

  ...fatiaDoRender(set, get),

  setBusy: (message) => set((state) => (state.busy === null && message === null ? state : { busy: message })),

  openSettings: (open, secao) => set({ settingsOpen: open, settingsSecao: open ? (secao ?? null) : null }),

  dismissError: () => set({ error: null }),

  reset: () =>
    set({
      audio: null,
      images: [],
      subtitlePath: null,
      plan: null,
      planOrigin: null,
      transcript: null,
      transcriptTravado: false,
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
      modulos: {},
      extrasDoProjeto: {},
    }),

  ...fatiaDoArquivo(set, get),

  ...fatiaDaFila(set, get),
}))

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
