import { z } from 'zod'

/**
 * Schemas do dominio. Fonte unica de verdade: os tipos saem de z.infer, entao
 * um campo novo no schema aparece nos tres processos de uma vez.
 *
 * Valores de runtime (canais de IPC, extensoes, a interface da ponte) moram em
 * channels.ts, que nao depende de zod -- ver o comentario la.
 */

// ---------------------------------------------------------------- audio

export const audioAnalysisSchema = z.object({
  path: z.string(),
  fileName: z.string(),
  /** URL do servidor de midia local. Preview e render consomem esta mesma URL. */
  url: z.string(),
  durationSec: z.number().positive(),
  /** Picos normalizados 0..1, um por bucket, para desenhar o waveform. */
  peaks: z.array(z.number().min(0).max(1)),
})
export type AudioAnalysis = z.infer<typeof audioAnalysisSchema>

// ---------------------------------------------------------------- imagens

export const imageAssetSchema = z.object({
  id: z.string(),
  path: z.string(),
  fileName: z.string(),
  /** URL do servidor de midia local. */
  url: z.string(),
  /** Dimensoes ja orientadas pelo EXIF -- o que o olho ve, nao o que o arquivo diz. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** WEBP pequeno em data URL, so para a timeline e o strip. Sem recorte. */
  thumbnail: z.string(),
  /**
   * Que parte da imagem sobra no quadro 9:16, de 0 (esquerda/topo) a 1
   * (direita/base). 0.5 e o centro, que era o unico recorte possivel antes.
   *
   * Uma imagem 16:9 perde 68% da largura ao virar 9:16 -- escolher qual terco
   * fica visivel e a diferenca entre o personagem no quadro e fora dele.
   */
  focusX: z.number().min(0).max(1),
  focusY: z.number().min(0).max(1),
  /**
   * O enquadramento veio de um rosto detectado, e nao do centro nem da mao do
   * usuario.
   *
   * Existe para a interface poder DIZER que mexeu. Enquadrar 46 imagens em
   * silencio seria mudar o video sem avisar; marcado, o usuario sabe onde olhar
   * e desfaz num clique. Arrastar a janela limpa a marca -- dali em diante a
   * escolha e dele.
   */
  focusAuto: z.boolean().default(false),
  /**
   * Print ou clipe. Com default para projeto salvo antes dos clipes abrir igual.
   *
   * O nome do tipo continua ImageAsset de proposito: clipe nao e uma segunda
   * especie de midia com esteira propria, e uma imagem que se mexe. Mesma lista,
   * mesma ordem, mesmo bloco -- ver isVisual em channels.ts.
   */
  kind: z.enum(['image', 'video']).default('image'),
  /**
   * A qual parte do roteiro este material pertence, contando do zero.
   *
   * null quando o usuario soltou arquivos soltos -- que e o caso do recap, onde
   * o material ja vem em ordem cronologica e nao ha o que agrupar. So deixa de
   * ser null quando ele solta PASTAS: cada subpasta vira uma parte, e o
   * planejador passa a resolver cada parte separadamente.
   */
  section: z.number().int().nonnegative().nullable().default(null),
  /** Nome da pasta de onde veio. So para a interface conseguir dizer qual e. */
  sectionName: z.string().optional(),
  /**
   * Duracao do clipe em segundos. Ausente em print.
   *
   * Serve para uma coisa so, mas necessaria: saber se o clipe termina ANTES do
   * bloco. Quando termina, o ultimo frame congela ate o bloco fechar.
   */
  durationSec: z.number().positive().optional(),
})
export type ImageAsset = z.infer<typeof imageAssetSchema>

// ------------------------------------------------------------- transcricao

export const wordSchema = z.object({
  text: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  /**
   * Fecha um paragrafo do roteiro.
   *
   * Linha em branco e o sinal mais forte de troca de assunto que existe num
   * texto -- mais forte que qualquer pontuacao -- e some se so o texto corrido
   * atravessar. So o roteiro tem isso; transcricao nunca traz.
   */
  paragraph: z.boolean().optional(),
})
export type Word = z.infer<typeof wordSchema>

export const segmentSchema = z.object({
  text: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
})
export type Segment = z.infer<typeof segmentSchema>

export const transcriptSchema = z.object({
  /**
   * De onde veio o TEXTO. 'silence' nao tem texto -- so as pausas detectadas no
   * audio, que ainda servem para cortar em lugar natural. 'script' e o roteiro
   * do usuario com os tempos medidos por cima: texto sem erro nenhum.
   */
  source: z.enum(['srt', 'whisper', 'silence', 'script']),
  words: z.array(wordSchema),
  segments: z.array(segmentSchema),
  text: z.string(),
  /** Instantes bons para cortar, em segundos. Ja ordenados. */
  cutCandidates: z.array(z.number().nonnegative()),
})
export type Transcript = z.infer<typeof transcriptSchema>

// ------------------------------------------------------------ plano de cenas

/**
 * Contrato entre a IA e o render. A IA decide onde caem os cortes, o efeito e a
 * transicao -- nunca a ordem das imagens, que e sempre a do usuario.
 *
 * Na v0.2 este plano vem inteiro do fallback deterministico (divisao igual).
 */
export const KEN_BURNS_EFFECTS = [
  'zoom-in',
  'zoom-out',
  'pan-left',
  'pan-right',
  'pan-up',
  'pan-down',
] as const

/**
 * O que um bloco pode ter de movimento, incluindo nenhum.
 *
 * 'nenhum' fica FORA de KEN_BURNS_EFFECTS de proposito: aquela lista e o
 * rodizio automatico e o cardapio da IA, e nem um nem outro deve escolher
 * "parado" sozinho -- print parado num short e tempo morto.
 *
 * Ninguem comeca em 'nenhum': o clipe entra com movimento igual ao print, e a
 * escolha dele foi essa -- "ja deixa eles com algum movimento, qualquer coisa
 * eu altero ou removo manualmente depois o que eu nao gostar, e melhor do que
 * eu ficar colocando um por um". Desligar continua sendo um clique no card.
 */
export const SCENE_EFFECTS = ['nenhum', ...KEN_BURNS_EFFECTS] as const
export type SceneEffect = (typeof SCENE_EFFECTS)[number]

export const TRANSITIONS = ['cut', 'crossfade', 'slide-left', 'slide-right', 'whip-pan'] as const
export type Transition = (typeof TRANSITIONS)[number]

/**
 * Duracao de cada transicao em frames. A spec pede entre 120ms e 250ms; a
 * 23.976fps isso e 3 a 6 frames. Mais longo que isso arrasta e mata o ritmo do
 * short.
 *
 * Os valores foram recalculados quando o projeto passou de 30 para 23.976fps,
 * para a duracao em MILISSEGUNDOS continuar a mesma -- manter o numero de
 * frames teria deixado toda transicao 25% mais lenta.
 */
export const TRANSITION_FRAMES: Readonly<Record<Transition, number>> = {
  cut: 0,
  crossfade: 5, // 209ms
  'slide-left': 4, // 167ms
  'slide-right': 4,
  'whip-pan': 3, // 125ms
}

export const SFX_SOUNDS = ['whoosh', 'impact'] as const
export type SfxSound = (typeof SFX_SOUNDS)[number]

/**
 * Como o movimento se distribui ao longo da cena.
 *
 * O efeito diz PARA ONDE a camera vai e a intensidade diz QUANTO; a curva diz em
 * que ritmo. Sao as tres perguntas independentes de um Ken Burns, e ate agora a
 * terceira estava fixa no codigo: toda cena usava ease-in-out.
 *
 * Os nomes sao os padroes de easing porque a matematica e a mesma do CSS. O que
 * cada um faz, que e o que aparece na interface:
 *
 *   ease-in-out  comeca devagar, acelera, termina devagar -- assenta
 *   linear       velocidade constante -- num movimento lento fica melhor que o
 *                ease-in-out, que faz as pontas parecerem travadas
 *   ease-out     parte rapido e desacelera -- o movimento "pousa"
 *   ease-in      parte devagar e acelera -- cria tensao entrando no corte
 */
export const MOTION_CURVES = ['ease-in-out', 'linear', 'ease-out', 'ease-in'] as const
export const motionCurveSchema = z.enum(MOTION_CURVES)
export type MotionCurve = z.infer<typeof motionCurveSchema>

/** O que o app sempre fez. Manter como padrao nao muda nenhum video existente. */
export const MOTION_CURVE_DEFAULT: MotionCurve = 'ease-in-out'

/**
 * A curva do clipe: constante, e nao ease-in-out.
 *
 * Pedido dele -- "algum movimento em ritmo constante". E a curva certa para
 * este caso pelo motivo que ja estava escrito ali em cima: num movimento lento
 * o ease-in-out faz as pontas parecerem travadas, e o clipe ja tem o movimento
 * proprio da animacao brigando com o da camera.
 */
export const CLIP_MOTION_CURVE: MotionCurve = 'linear'

/**
 * Quanto o clipe se move. Um pouco menos que o print.
 *
 * O print e preparado para o render com 1.15x de folga (RENDER_HEADROOM), entao
 * o Ken Burns nele nao amplia nada. O clipe nao tem essa folga: um mp4 1920x1080
 * cobrindo 1080x1920 ja esta ampliado 1.78x so para caber na tela, e o zoom
 * entra POR CIMA disso.
 *
 * Comecou em 0.06 pela mesma preocupacao e ficou timido demais: medido no mp4,
 * um bloco de 3 segundos rendia 0.47/255 de diferenca contra o mesmo bloco
 * parado -- movimento que existe na matematica e nao se ve na tela. Em 0.10 a
 * diferenca fica visivel, e a ampliacao vai de 1.78x para 1.96x, que em anime
 * (cor chapada, pouca textura fina) nao se distingue de 1.78x.
 */
export const CLIP_INTENSITY = 0.1

export const sceneSchema = z.object({
  /** Indice na lista de imagens do usuario. */
  imageIndex: z.number().int().nonnegative(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  effect: z.enum(SCENE_EFFECTS),
  /** Quanto o Ken Burns se move. 0.10 a 0.15; acima disso fica tosco. */
  intensity: z.number().min(0.02).max(0.2),
  /**
   * Com default de proposito: projeto salvo antes da curva existir abre igual, e
   * a IA nao precisa escolher. O planner valida a saida dela contra este schema,
   * entao o campo ausente vira ease-in-out sozinho -- ritmo de camera e decisao
   * de gosto do Kintay, nao de modelo.
   */
  curve: motionCurveSchema.default(MOTION_CURVE_DEFAULT),
  /**
   * De que ponto do CLIPE este bloco parte, em segundos. 0 = do comeco.
   *
   * O clipe chega cortado do AnCut, mas o bloco quase nunca tem a mesma
   * duracao dele: uma cena de 6 segundos num bloco de 2 mostrava sempre os
   * dois PRIMEIROS segundos, e o que ele queria costuma estar no meio ou no
   * fim. Sem isto a unica saida era procurar outra cena.
   *
   * So faz sentido em clipe. Com default para projeto salvo antes disso abrir
   * igual, e para a IA nao precisar escolher.
   */
  sourceStart: z.number().nonnegative().default(0),
  transitionIn: z.enum(TRANSITIONS),
  reason: z.string().optional(),
})
export type Scene = z.infer<typeof sceneSchema>

/**
 * O plano nao carrega SFX.
 *
 * Ate a v1 a IA escolhia "um whoosh aqui, um impact ali". Isso virou uma
 * decisao posicional -- uma transicao sim, outra nao, rodando os arquivos que
 * o usuario tem na pasta -- e ela depende do que existe na pasta NA HORA do
 * render, nao de quando a analise rodou. Ver sfxCuesFor em shared/plan.
 */
export const scenePlanSchema = z.object({
  scenes: z.array(sceneSchema).min(1),
})
export type ScenePlan = z.infer<typeof scenePlanSchema>

/**
 * Como o plano foi obtido. Aparece na interface para o usuario saber.
 *
 * 'auto' e a montagem automatica: os cortes saem das FRASES da narracao, e nao
 * de uma distribuicao por cima delas -- cada bloco dura exatamente a frase que
 * escolheu o clipe dele. E o unico plano onde o corte e o conteudo vieram da
 * mesma decisao.
 */
export const PLAN_ORIGINS = ['auto', 'ai', 'sections', 'rhythm', 'silence', 'equal'] as const
export type PlanOrigin = (typeof PLAN_ORIGINS)[number]

export interface AnalysisResult {
  plan: ScenePlan
  origin: PlanOrigin
  transcript: Transcript | null
  /** Preenchido quando a IA foi tentada e nao deu -- a interface avisa, sem travar. */
  aiNote: string | null
  /** Como o roteiro se saiu, quando houve roteiro. */
  scriptNote: string | null
  /**
   * O que aconteceu com as partes, quando o usuario soltou pastas.
   *
   * Existe para o caso que NAO bate: tres pastas e quatro paragrafos. Ali o app
   * avisa em vez de chutar, porque num video de teoria a imagem errada nao passa
   * despercebida -- ela contradiz o que a narracao esta dizendo.
   */
  sectionNote: string | null
}

// ---------------------------------------------------------------- render

export const VIDEO_WIDTH = 1080
export const VIDEO_HEIGHT = 1920

/**
 * Folga de escala para o Ken Burns. A imagem preparada para o render tem 1.15x
 * o quadro final: com scale(1.15) a regiao visivel volta a ser exatamente 1080
 * pixels nativos, entao nao ha upscale visivel nem pixel desperdicado.
 *
 * Mora aqui e nao no servico de imagens porque a verificacao previa precisa do
 * MESMO numero para dizer a verdade sobre quanto uma imagem sera ampliada.
 */
export const RENDER_HEADROOM = 1.15
export const RENDER_WIDTH = Math.round(VIDEO_WIDTH * RENDER_HEADROOM)
export const RENDER_HEIGHT = Math.round(VIDEO_HEIGHT * RENDER_HEADROOM)

/**
 * 23.976 fps, o valor exato de 24000/1001 -- e nao o arredondado 23.976.
 *
 * Escrito como divisao de proposito: a diferenca entre 24000/1001 e 23.976 e de
 * um frame a cada ~40 minutos, o que nao importa num short, mas o valor exato e
 * o que o container guarda e o que evita o video ser lido como "23.98" por
 * alguns players.
 */
export const VIDEO_FPS = 24000 / 1001

/**
 * O que a composicao Remotion recebe. Preview e render usam o mesmo objeto.
 *
 * Nao existe `from` aqui: com transicoes as cenas se sobrepoem, e quem cuida do
 * encadeamento e o TransitionSeries. A duracao ja vem com a folga da
 * sobreposicao embutida -- ver toRenderProps.
 */
/** Um bloco de legenda: 2 a 4 palavras que aparecem juntas na tela. */
export const captionBlockSchema = z.object({
  from: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  words: z.array(
    z.object({
      text: z.string(),
      from: z.number().int().nonnegative(),
      durationInFrames: z.number().int().positive(),
    }),
  ),
})
export type CaptionBlock = z.infer<typeof captionBlockSchema>

/**
 * Qual palavra do bloco esta marcada neste frame.
 *
 * A regra e "a ultima palavra que ja comecou", e nao "a palavra cuja janela
 * contem este frame". A diferenca decide se o marcador pisca ou nao.
 *
 * Com a janela estrita, o marcador APAGAVA sempre que o frame caia fora de toda
 * palavra -- e isso acontecia o tempo todo: no respiro entre duas palavras,
 * antes da primeira (o bloco entra na tela um pouco antes da fala, porque
 * enforceMinimumDuration estica a janela para dentro do silencio vizinho) e
 * depois da ultima. Medido no projeto real: 188 de 2045 frames de legenda
 * ficavam sem nenhuma palavra marcada, metade dos blocos piscava, e 16 blocos
 * de uma palavra so ficavam brancos parte do tempo em que estavam na tela.
 *
 * Segurando, o marcador nunca apaga: entra na primeira palavra, anda quando a
 * proxima comeca, e fica na ultima ate o bloco sair. De quebra, deixa de
 * depender da DURACAO de cada palavra -- o numero menos confiavel que temos,
 * porque as palavras que o Whisper nao ouviu recebem duracao interpolada por
 * tamanho de texto, e um quarto delas ficava com dois frames ou menos.
 *
 * Mora em contract.ts, e nao em plan.ts, porque a composicao Remotion consome
 * esta funcao e o detector de bundle vencido so vigia src/remotion e este
 * arquivo -- ver bundleVencido em electron/services/render.ts.
 */
export function activeWordIndex(block: CaptionBlock, frame: number): number {
  let index = 0
  for (let i = 0; i < block.words.length; i++) {
    if (block.words[i]!.from > frame) break
    index = i
  }
  return index
}

/**
 * Um card de texto por cima do video.
 *
 * Gancho e final entram como SOBREPOSICAO, nunca como trecho extra: a narracao
 * e continua e os blocos ja estao distribuidos sobre ela, entao empurrar o
 * video para abrir espaco desalinharia tudo que vem depois. O texto aparece por
 * cima da imagem que ja estava ali, e a duracao do video nao muda.
 */
export const overlayCardSchema = z.object({
  text: z.string(),
  from: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  /** O gancho fica no alto para nao brigar com a legenda, que mora embaixo. */
  position: z.enum(['top', 'center']),
})
export type OverlayCard = z.infer<typeof overlayCardSchema>

/** Quanto tempo cada card fica na tela, por padrao. */
export const HOOK_SEC_DEFAULT = 2.5
export const END_CARD_SEC_DEFAULT = 3

/**
 * Cor do marcador de palavra.
 *
 * O corpo da legenda e sempre branco: sobre print de anime, que vai do preto ao
 * estourado, branco com contorno preto e a unica combinacao que se le em
 * qualquer fundo. Quem muda de cor e so a palavra sendo dita -- e ali a cor e
 * decisao de estilo do video, nao de legibilidade.
 *
 * Os cinco tons sao claros e saturados de proposito. Cor escura (azul-marinho,
 * vinho) se dissolve dentro do contorno preto de 6px, e o marcador sumiria
 * justamente no frame em que deveria chamar atencao.
 */
export const CAPTION_COLORS = ['rosa', 'amarelo', 'verde', 'vermelho', 'azul'] as const
export const captionColorSchema = z.enum(CAPTION_COLORS)
export type CaptionColor = z.infer<typeof captionColorSchema>

export const CAPTION_COLOR_HEX: Record<CaptionColor, string> = {
  rosa: '#FF3D81',
  amarelo: '#FFD60A',
  verde: '#34E06A',
  vermelho: '#FF3B30',
  azul: '#3DB8FF',
}

/** Rosa e o padrao: e a cor do app, e o video sai parecido com ele. */
export const CAPTION_COLOR_DEFAULT: CaptionColor = 'rosa'

/**
 * Altura da legenda, como fracao da altura do video medida a partir do rodape.
 *
 * Fracao e nao pixel de proposito: o valor fica preso ao enquadramento, nao a
 * resolucao, e continua valendo se um dia a composicao mudar de tamanho.
 *
 * O padrao e exatamente os 420px que o app sempre usou -- e ele nao e um numero
 * bonito escolhido a esmo. No TikTok e no Reels a faixa de baixo da tela fica
 * coberta pela interface do proprio aplicativo (usuario, legenda, botoes), e
 * legenda queimada ali simplesmente nao e lida. Descer daqui e uma escolha
 * consciente de quem sabe onde o video vai ser publicado.
 *
 * O teto para antes do meio da tela: acima disso a legenda briga com o card de
 * fechamento, que e centralizado.
 */
export const CAPTION_Y_DEFAULT = 420 / VIDEO_HEIGHT
export const CAPTION_Y_MIN = 0.08
export const CAPTION_Y_MAX = 0.55
export const captionYSchema = z
  .number()
  .min(CAPTION_Y_MIN)
  .max(CAPTION_Y_MAX)
  .default(CAPTION_Y_DEFAULT)

export const renderPropsSchema = z.object({
  scenes: z.array(
    z.object({
      url: z.string(),
      durationInFrames: z.number().int().positive(),
      effect: z.enum(SCENE_EFFECTS),
      intensity: z.number(),
      curve: motionCurveSchema.default(MOTION_CURVE_DEFAULT),
      /**
       * Print ou clipe. Com default para props antigas continuarem validas.
       *
       * O clipe entra como "uma imagem que se mexe": ocupa um bloco igual, na
       * mesma lista, e quem decide quanto tempo ele fica na tela continua sendo
       * a narracao. Se o clipe for mais longo, ele e cortado no fim do bloco.
       */
      kind: z.enum(['image', 'video']).default('image'),
      /**
       * Quantos frames o clipe tem de verdade. null em print, e tambem em clipe
       * que cobre o bloco inteiro.
       *
       * Quando o clipe acaba antes do bloco, o ultimo frame CONGELA ate o bloco
       * fechar. Foi a escolha do Kintay entre congelar, repetir em loop e cair
       * para preto: congelar e o que menos chama atencao.
       */
      sourceDurationInFrames: z.number().int().positive().nullable().default(null),
      /**
       * Quantos frames do clipe sao PULADOS antes de comecar.
       *
       * Vira `trimBefore` no OffthreadVideo. Com default para props antigas
       * continuarem validas -- e porque zero e o que o app sempre fez.
       */
      sourceStartFrames: z.number().int().nonnegative().default(0),
      transitionIn: z.enum(TRANSITIONS),
      /** Frames da transicao de entrada. 0 = corte seco. */
      transitionInFrames: z.number().int().nonnegative(),
    }),
  ),
  /** Vazio quando as legendas estao desligadas ou nao ha transcricao. */
  captions: z.array(captionBlockSchema).default([]),
  /** Cor do marcador de palavra. Com default para props antigas continuarem validas. */
  captionColor: captionColorSchema.default(CAPTION_COLOR_DEFAULT),
  /** Altura da legenda, fracao da tela a partir do rodape. */
  captionY: captionYSchema,
  /** Texto de abertura e de fechamento. Vazio quando o usuario nao pediu. */
  cards: z.array(overlayCardSchema).default([]),
})
export type RenderProps = z.infer<typeof renderPropsSchema>

/**
 * Um bloco de legenda e uma linha so. No maximo tres palavras e doze
 * caracteres -- mais que isso nao da tempo de ler num short.
 *
 * A unica excecao e a palavra que sozinha ja passa do limite: ela fica sozinha
 * na linha, porque quebrar palavra no meio e pior que uma linha comprida.
 */
export const CAPTION_MAX_WORDS = 3
export const CAPTION_MAX_CHARS = 12

/**
 * Pontuacao que fecha a linha.
 *
 * Depois de um ponto ou de uma virgula comeca outra ideia, e juntar as duas na
 * mesma legenda ("insana. Essa") faz o olho ler como uma frase so. A palavra
 * seguinte abre linha nova -- sozinha, ou acompanhada da que vem depois dela.
 */
export const CAPTION_BREAK_AFTER = '.,!?;:…'

/**
 * Tempo minimo que uma legenda fica na tela.
 *
 * Com duas palavras por linha as legendas ficam curtas, e as palavrinhas de
 * ligacao produzem blocos de 4 frames -- que na pratica piscam em vez de serem
 * lidas. Este piso e a diferenca entre uma legenda rapida e um flash.
 */
export const CAPTION_MIN_SEC = 0.45

/**
 * Quantos caracteres cabem numa linha no corpo padrao da legenda.
 *
 * Medido no render de verdade: a Komika Axis a 68px gasta ate ~46px por letra
 * em palavra portuguesa, e sobram 920px entre as margens. Acima disso a linha
 * passa da borda e as pontas somem da tela, entao a legenda encolhe a fonte
 * para caber inteira.
 *
 * Pela regra de montagem, uma linha so passa daqui quando e uma palavra unica
 * comprida demais para o limite -- a excecao que existe justamente porque
 * quebrar palavra no meio seria pior.
 */
export const CAPTION_CHARS_PER_LINE = 18

/**
 * Cama de musica: quantos dB abaixo do fundo de escala ela entra.
 *
 * -20 dB por padrao. Com a narracao normalizada em -14 LUFS e uma faixa
 * masterizada normal, isso poe a musica bem debaixo da voz -- presente no
 * silencio entre as frases, sem nunca disputar a palavra.
 *
 * Nao ha ducking automatico de proposito: a narracao do Kintay e corrida, sem
 * pausas, entao o compressor ficaria com o ganho fechado do inicio ao fim --
 * exatamente o mesmo resultado de um volume fixo mais baixo, com mais coisa
 * para dar errado.
 */
export const MUSIC_GAIN_DB_DEFAULT = -20
export const MUSIC_GAIN_DB_MIN = -34
export const MUSIC_GAIN_DB_MAX = -6

/** Fade de entrada e de saida da musica, em segundos. */
export const MUSIC_FADE_IN_SEC = 1.2
export const MUSIC_FADE_OUT_SEC = 2

// ----------------------------------------------------------- publicacao

/**
 * Titulo, descricao e hashtags para subir o video.
 *
 * Tres titulos e nao um: e a decisao de maior impacto do short, e escolher
 * entre opcoes e mais rapido e melhor do que pedir outro e esperar de novo.
 */
export const metadataSchema = z.object({
  titles: z.array(z.string()),
  description: z.string(),
  hashtags: z.array(z.string()),
})
export type Metadata = z.infer<typeof metadataSchema>

export const renderProgressSchema = z.object({
  /** 0..1 */
  progress: z.number().min(0).max(1),
  stage: z.enum(['bundling', 'rendering', 'muxing', 'done', 'cancelled', 'failed']),
  message: z.string().optional(),
  outputPath: z.string().optional(),
})
export type RenderProgress = z.infer<typeof renderProgressSchema>
