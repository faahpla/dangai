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
  /** RMS por bucket, nos mesmos buckets dos picos. Mostra a dinamica da musica. */
  rms: z.array(z.number().min(0).max(1)).optional(),
})
export type AudioAnalysis = z.infer<typeof audioAnalysisSchema>

// ---------------------------------------------------------------- imagens

export const imageAssetSchema = z.object({
  id: z.string(),
  path: z.string(),
  fileName: z.string(),
  /** URL do servidor de midia local. Ja com o recorte 9:16 aplicado. */
  url: z.string(),
  /**
   * O arquivo ORIGINAL servido, sem o recorte 9:16.
   *
   * So a tela dividida usa: cada metade ocupa 1080x960 e faz o proprio corte, e
   * partir do recorte 9:16 cortaria duas vezes -- sobraria a faixa central de
   * um quadro que ja e estreito. null em print, que nao entra em divisao.
   *
   * Com default para projeto salvo antes disto continuar abrindo.
   */
  urlSource: z.string().nullable().default(null),
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
  /**
   * O clipe toca de tras para frente. A cena usa uma COPIA invertida gerada
   * pelo main (ver electron/services/inverter); `path` continua sendo o
   * original, que e por onde a Biblioteca e a remontagem reconhecem o clipe.
   */
  invertido: z.boolean().optional(),
  /** O arquivo invertido, quando `invertido`. E dele que o upscale e o reenquadrar partem. */
  caminhoInvertido: z.string().optional(),
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
  /**
   * Os tempos das palavras vieram do ALINHAMENTO FORCADO (o mesmo modelo do
   * LegendAI), e nao da estimativa do Whisper. Quem ja tem isto nao precisa
   * alinhar de novo -- a Biblioteca reaproveita a transcricao ao abrir.
   * Transcricao salva antes disto existir nao tem o campo.
   */
  alinhado: z.boolean().optional(),
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

/**
 * O whip-pan tem os DOIS sentidos, como o slide sempre teve.
 *
 * Ate 10/09 existia um so, preso na esquerda -- entao emendar duas cenas com
 * chicote para a direita era impossivel, e nao por decisao nenhuma: o valor
 * antigo simplesmente nao dizia o lado.
 *
 * `whip-pan` sem sentido continua no enum de proposito. Projeto salvo antes
 * disto guarda esse valor, e tira-lo faria o arquivo nao abrir mais. Ele nao
 * aparece na tela e vale como esquerda, que era o que ele fazia.
 */
/**
 * Um enquadramento de camera: o que se ve do quadro num instante.
 *
 * O teto de 3x nao e arbitrario. Uma imagem de anime em 1080x1920 ampliada
 * alem disso ja mostra o pixel, e o que era um close vira um borrao -- o
 * mesmo motivo pelo qual o Ken Burns nunca passou de 1.15 de escala.
 */

export const CAMERA_SCALE_MAX = 3
export const cameraFrameSchema = z.object({
  scale: z.number().min(1).max(CAMERA_SCALE_MAX),
  /** Deslocamento em % da imagem, a partir do centro. */
  x: z.number().min(-50).max(50),
  y: z.number().min(-50).max(50),
})
export type CameraFrame = z.infer<typeof cameraFrameSchema>

/**
 * Uma chave no MEIO do caminho da camera.
 *
 * As duas pontas (`from` e `to`) descrevem uma reta, e reta nao segue ninguem:
 * um personagem que anda para a direita e volta passa por lugares que nenhuma
 * combinacao de duas chaves alcanca. Cada chave aqui e uma curva a mais que o
 * caminho pode fazer.
 *
 * `t` e a fracao do BLOCO, nao segundo: o bloco muda de duracao quando a
 * narracao e refeita, e um caminho medido em segundos apontaria para fora dele.
 */
export const cameraKeySchema = cameraFrameSchema.extend({
  t: z.number().min(0).max(1),
})
export type CameraKey = z.infer<typeof cameraKeySchema>

export const TRANSITIONS = [
  'cut',
  'crossfade',
  'slide-left',
  'slide-right',
  'whip-pan-left',
  'whip-pan-right',
  'whip-pan',
] as const
export type Transition = (typeof TRANSITIONS)[number]

/** O que a tela oferece. Sem o `whip-pan` antigo, que so existe para abrir projeto velho. */
export const TRANSITIONS_NA_TELA = [
  'cut',
  'crossfade',
  'slide-left',
  'slide-right',
  'whip-pan-left',
  'whip-pan-right',
] as const satisfies readonly Transition[]

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
  'whip-pan-left': 3, // 125ms
  'whip-pan-right': 3,
  // O valor antigo, que so chega de projeto salvo. Mesma duracao de sempre.
  'whip-pan': 3,
}

/**
 * Quarto de volta que o bloco leva antes de entrar no quadro.
 *
 * Existe porque nem todo material chega em pe: clipe gravado deitado, print de
 * celular que veio girado, quadro de manga que so faz sentido de lado. Ate
 * agora a unica saida era corrigir fora do app e importar de novo.
 *
 * Sao os quatro angulos retos e mais nenhum. Girar sete graus e correcao de
 * foto, nao montagem -- e um angulo torto deixaria canto vazio no quadro, que e
 * exatamente a tarja preta que o resto do app existe para evitar.
 */
export const ROTATIONS = [0, 90, 180, 270] as const
export const rotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
])
export type Rotation = (typeof ROTATIONS)[number]

/**
 * Como a legenda entra na tela.
 *
 * 'nenhuma' e o padrao: o bloco aparece parado, e foi assim o app inteiro ate
 * aqui. 'elastica' e a entrada com escala e repique -- ela chama atencao, e por
 * isso e uma escolha por video e nunca o padrao.
 */
/**
 * Onde a cor da legenda e aplicada.
 *
 * 'palavra' e o padrao e o que o app sempre fez: o texto sai branco e SO a
 * palavra sendo dita ganha cor, acompanhando a narracao. 'tudo' pinta a legenda
 * inteira da cor escolhida e nao marca palavra nenhuma -- e o estilo de quem
 * quer a legenda como um bloco so, sem o karaoke.
 *
 * Um nao substitui o outro: sao dois visuais, e a escolha e por video.
 */
/**
 * A sombra projetada do texto da legenda.
 *
 * Sao tres numeros e nao uma string de CSS: assim o projeto salvo guarda algo
 * que da para validar, e a interface tem o que mostrar num controle.
 *
 * Vira DUAS camadas na tela -- uma curta e fechada, que desenha a borda da
 * sombra, e uma longa e aberta, que espalha. Uma sombra so ou fica dura demais
 * ou some sobre fundo claro. Os controles mexem na primeira e a segunda
 * acompanha em proporcao, para os dois nunca sairem de sintonia.
 *
 * Opacidade zero apaga a sombra por inteiro: e o jeito de desligar sem um
 * interruptor separado dizendo a mesma coisa.
 */
export const captionShadowSchema = z.object({
  /** Quanto a sombra desce, em pixels do quadro 1080x1920. */
  distancia: z.number().min(0).max(24),
  desfoque: z.number().min(0).max(40),
  opacidade: z.number().min(0).max(1),
})
export type CaptionShadow = z.infer<typeof captionShadowSchema>

/**
 * O que ele ajustou no olho e mandou virar padrao em 07/09.
 *
 * Sombra dura e colada: opacidade cheia, tres pixels de queda e desfoque
 * NENHUM. E o contorno solido que o traco de anime pede -- desfoque espalha e
 * suja a linha, que era o que os valores antigos (4/6/55%) faziam.
 *
 * Continua tudo configuravel; isto e so o ponto de partida de todo video novo.
 */
export const CAPTION_SHADOW_DEFAULT: CaptionShadow = {
  distancia: 3,
  desfoque: 0,
  opacidade: 1,
}

/**
 * As duas camadas da sombra, prontas para o CSS.
 *
 * Uma definicao so, usada pelo render e pelo preview -- que sao o mesmo
 * componente, mas a conta tambem serve para qualquer lugar que precise mostrar
 * a sombra fora dele.
 */
export function sombraCss({ distancia, desfoque, opacidade }: CaptionShadow): string | undefined {
  if (opacidade <= 0) return undefined
  const espalhada = `0 ${(distancia * 2.5).toFixed(1)}px ${(desfoque * 3.6).toFixed(1)}px rgba(0,0,0,${(opacidade * 0.8).toFixed(3)})`
  return `0 ${distancia.toFixed(1)}px ${desfoque.toFixed(1)}px rgba(0,0,0,${opacidade.toFixed(3)}), ${espalhada}`
}

/**
 * A espessura do contorno preto da legenda, em pixels do quadro do render.
 *
 * Era fixo em 6px desde a v1. Pedido dele em 08/09, pelo mesmo motivo da
 * sombra: o contorno e o que separa a letra da cena, e quanto ele pesa e
 * decisao de estilo -- traco fino em cena clara some, traco grosso em fonte
 * estreita come o miolo da letra.
 *
 * Zero desliga o contorno. Nesse caso so a sombra separa a letra do fundo.
 */
/**
 * Limites do que ele pode fazer com um SFX na faixa.
 *
 * O ganho e RELATIVO ao nivel padrao (-12 dB sob a voz): zero e o de sempre.
 * O teto de +6 existe para um som nao passar por cima da narracao, que e o
 * nivel de referencia do video.
 */
export const SFX_GAIN_MIN = -24
export const SFX_GAIN_MAX = 6
/** Pedaco minimo de um som cortado. Abaixo disso nao da tempo de ouvir. */
export const SFX_MINIMO_SEC = 0.05

export const CAPTION_STROKE_MIN = 0
export const CAPTION_STROKE_MAX = 16
export const CAPTION_STROKE_DEFAULT = 6
export const captionStrokeSchema = z
  .number()
  .min(CAPTION_STROKE_MIN)
  .max(CAPTION_STROKE_MAX)

export const CAPTION_MARKS = ['palavra', 'tudo'] as const
export const captionMarkSchema = z.enum(CAPTION_MARKS)
export type CaptionMark = z.infer<typeof captionMarkSchema>
export const CAPTION_MARK_DEFAULT: CaptionMark = 'palavra'

/**
 * Quantos frames a entrada elastica leva para assentar.
 *
 * Vira `durationInFrames` da mola do Remotion, que estica ou comprime a curva
 * inteira sem mudar o formato dela -- o repique continua sendo o mesmo repique,
 * so mais rapido ou mais lento.
 *
 * O padrao e 6 e nao 9: a primeira versao ficou lenta demais para short, dito
 * por ele depois de ver rodando.
 */
export const CAPTION_ANIMATION_FRAMES_MIN = 3
export const CAPTION_ANIMATION_FRAMES_MAX = 30
export const CAPTION_ANIMATION_FRAMES_DEFAULT = 6
export const captionAnimationFramesSchema = z
  .number()
  .int()
  .min(CAPTION_ANIMATION_FRAMES_MIN)
  .max(CAPTION_ANIMATION_FRAMES_MAX)

/**
 * O nome da familia CSS de uma fonte, a partir do nome do ARQUIVO.
 *
 * Uma definicao so, usada pelo main e pela tela: se os dois derivassem o nome
 * por conta propria, bastaria um divergir para o CSS pedir uma familia que o
 * FontFace nunca registrou -- e a legenda sairia na fonte reserva sem erro
 * nenhum aparecendo.
 */
export function familiaDaFonte(nomeDoArquivo: string): string {
  return nomeDoArquivo.replace(/\.[^.]+$/, '')
}

/**
 * A curva da entrada elastica: a ESCALA da legenda ao longo da entrada.
 *
 * "Quero ter mais controle sobre essa animacao elastica, um grafico de curvas
 * configuravel." Cada ponto e (t, escala): t vai de 0 (a legenda aparece) a 1
 * (fim da entrada), e a escala 1 e o tamanho normal. O primeiro ponto fica em
 * t = 0 e o ultimo em t = 1 com escala 1 -- a entrada sempre termina no
 * tamanho da legenda.
 *
 * Interpolada em cubica MONOTONICA: picos e vales caem exatamente nos pontos
 * que ele arrastou, e a curva nunca passa deles por conta propria.
 */
export const pontoDaEntradaSchema = z.object({
  t: z.number().min(0).max(1),
  v: z.number().min(0).max(2),
})
export const curvaDaEntradaSchema = z.array(pontoDaEntradaSchema).min(2).max(10)
export type CurvaDaEntrada = z.infer<typeof curvaDaEntradaSchema>

/**
 * O padrao e a mola de antes, amostrada: spring(damping 9, massa 0,5, rigidez
 * 130) indo de 0,6 a 1, com o pico de 1,048 a 40% da entrada. Medido: no maximo
 * 0,6% de diferenca para a mola em qualquer quadro -- quem nunca mexeu na curva
 * continua vendo a mesma entrada.
 */
export const CURVA_DA_ENTRADA_PADRAO: CurvaDaEntrada = [
  { t: 0, v: 0.6 },
  { t: 0.05, v: 0.637 },
  { t: 0.15, v: 0.816 },
  { t: 0.25, v: 0.973 },
  { t: 0.4, v: 1.048 },
  { t: 0.6, v: 1.012 },
  { t: 0.8, v: 0.994 },
  { t: 1, v: 1 },
]

/** A escala no instante t (0..1) da entrada. */
export function escalaDaEntrada(curva: CurvaDaEntrada, t: number): number {
  const pts = [...curva].sort((a, b) => a.t - b.t)
  if (t <= pts[0]!.t) return pts[0]!.v
  if (t >= pts.at(-1)!.t) return pts.at(-1)!.v
  const n = pts.length
  // Fritsch-Carlson: inclinacoes que nao criam extremos entre os pontos.
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1]!.v - pts[i]!.v) / Math.max(pts[i + 1]!.t - pts[i]!.t, 1e-9))
  const m: number[] = [d[0]!]
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2)
  m.push(d[n - 2]!)
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i]! / d[i]!
    const b = m[i + 1]! / d[i]!
    const h = a * a + b * b
    if (h > 9) {
      const k = 3 / Math.sqrt(h)
      m[i] = k * a * d[i]!
      m[i + 1] = k * b * d[i]!
    }
  }
  let i = 0
  while (t > pts[i + 1]!.t) i++
  const p0 = pts[i]!
  const p1 = pts[i + 1]!
  const h = p1.t - p0.t
  const s = (t - p0.t) / h
  const s2 = s * s
  const s3 = s2 * s
  return (
    (2 * s3 - 3 * s2 + 1) * p0.v +
    (s3 - 2 * s2 + s) * h * m[i]! +
    (-2 * s3 + 3 * s2) * p1.v +
    (s3 - s2) * h * m[i + 1]!
  )
}

/** Uma curva da entrada guardada com nome: "deixa eu desenhar uma propria e salvar um preset". */
export const curvaGuardadaSchema = z.object({
  nome: z.string().trim().min(1).max(30),
  curva: curvaDaEntradaSchema,
})
export type CurvaGuardada = z.infer<typeof curvaGuardadaSchema>

export const CAPTION_ANIMATIONS = ['nenhuma', 'elastica'] as const
export const captionAnimationSchema = z.enum(CAPTION_ANIMATIONS)
export type CaptionAnimation = z.infer<typeof captionAnimationSchema>
export const CAPTION_ANIMATION_DEFAULT: CaptionAnimation = 'nenhuma'

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
 * A curva desenhada a mao: os dois pontos de controle de uma bezier cubica.
 *
 * Pedido dele em 27/08 -- "um grafico de curvas para eu ter liberdade de mexer
 * no movimento de cada imagem". Os quatro presets continuam sendo o padrao e
 * continuam saindo prontos da montagem: isto e uma SAIDA para o bloco em que
 * eles nao servem, nunca o caminho normal.
 *
 * A ordem e a mesma do cubic-bezier do CSS: [x1, y1, x2, y2].
 *
 * Os quatro numeros ficam presos entre 0 e 1, inclusive os do eixo Y -- onde o
 * CSS deixaria passar. Y fora da faixa e overshoot: a curva ultrapassa o fim do
 * movimento e volta. Isso empurraria o pan alem da folga de borda que o
 * motionFor reserva, e a tarja preta entraria no quadro. No grafico, a caixa E
 * o limite: nao ha como arrastar para fora.
 */
export const curvePointsSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
])
export type CurvePoints = z.infer<typeof curvePointsSchema>

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

/** O caminho da camera livre: duas pontas e as chaves do meio. */
export const caminhoDaCameraSchema = z.object({
      from: cameraFrameSchema,
      to: cameraFrameSchema,
      /**
       * A camera enquadra o arquivo ORIGINAL, e nao o recorte 9:16.
       *
       * Ate a v1.27 ela so enxergava o recorte, e os dois tercos laterais de um
       * clipe 16:9 eram inalcancaveis -- um personagem na ponta direita nao
       * existia no arquivo que o render abria. Falso nas cameras desenhadas
       * antes disto: o numero delas vale no quadro recortado, e trocar a fonte
       * por baixo mudaria o enquadramento de um video ja pronto.
       */
      source: z.boolean().default(false),
      /**
       * As chaves do meio do caminho, em ordem de .
       *
       * Vazio e o normal: a camera vai da primeira ponta a segunda em linha
       * reta, como sempre foi. O rastreador enche esta lista, e ai o caminho
       * passa a acompanhar o que se mexe em vez de cortar reto por cima dele.
       */
      keys: z.array(cameraKeySchema).default([]),
    })
export type CaminhoDaCameraSalvo = z.infer<typeof caminhoDaCameraSchema>

export const sceneSchema = z.object({
  /** Indice na lista de imagens do usuario. */
  imageIndex: z.number().int().nonnegative(),
  /**
   * A segunda cena, quando o bloco e TELA DIVIDIDA.
   *
   * null e o caso normal: uma cena ocupa o quadro inteiro. Com um indice aqui,
   * as duas tocam ao mesmo tempo -- `imageIndex` em cima, esta embaixo --, cada
   * metade com o proprio enquadramento. E um bloco so: a duracao, o peso e a
   * transicao continuam sendo do bloco, nao de cada metade.
   *
   * Com default para plano salvo antes disto continuar abrindo.
   */
  imageIndexB: z.number().int().nonnegative().nullable().default(null),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  effect: z.enum(SCENE_EFFECTS),
  /** Quanto o Ken Burns se move. 0.10 a 0.15; acima disso fica tosco. */
  intensity: z.number().min(0.02).max(0.2),
  /**
   * O movimento da metade DE BAIXO, na tela dividida.
   *
   * `null` quer dizer "segue a de cima" -- e nao "parado". E isso que faz o
   * projeto antigo abrir ja com movimento nas duas metades: ate 10/09 a divisao
   * simplesmente nao tinha Ken Burns, por uma decisao que dizia que duas
   * imagens se mexendo no mesmo quadro cansam o olho. Ele discordou depois de
   * usar, e agora quem decide isso e ele, metade por metade.
   *
   * Preenchido, vale o que esta aqui -- inclusive 'nenhum', que e como se deixa
   * a de baixo parada com a de cima andando.
   *
   * `intensityB` segue a mesma regra: null usa a intensidade do bloco.
   */
  effectB: z.enum(SCENE_EFFECTS).nullable().default(null),
  intensityB: z.number().min(0.02).max(0.2).nullable().default(null),
  /**
   * Com default de proposito: projeto salvo antes da curva existir abre igual, e
   * a IA nao precisa escolher. O planner valida a saida dela contra este schema,
   * entao o campo ausente vira ease-in-out sozinho -- ritmo de camera e decisao
   * de gosto do Kintay, nao de modelo.
   */
  curve: motionCurveSchema.default(MOTION_CURVE_DEFAULT),
  /**
   * A curva desenhada a mao. null = vale o preset em `curve`.
   *
   * Nasce null em todo bloco, e a montagem automatica nunca preenche: o ritmo
   * de camera continua saindo pronto como sempre saiu, e desenhar e uma escolha
   * dele, bloco a bloco.
   */
  curvePoints: curvePointsSchema.nullable().default(null),
  /**
   * CAMERA LIVRE: o enquadramento no comeco e no fim do bloco.
   *
   * Os presets de Ken Burns produzem movimentos que sempre partem ou chegam ao
   * centro -- um zoom out abre a partir do meio da imagem, e ponto. Isso nao
   * cobre o caso que ele descreveu: abrir a partir do ROSTO de um personagem
   * que esta no alto e fora do eixo, e terminar no enquadramento normal.
   *
   * Preenchido, manda no lugar de `effect` e `intensity`: o movimento vira a
   * interpolacao entre os dois quadros, com a curva do bloco no meio. O formato
   * e o mesmo que `motionFor` ja devolvia, entao o Scene so troca de onde vem o
   * numero, nao o que faz com ele.
   *
   * `scale` 1 e a imagem preenchendo o quadro; acima disso ela e ampliada e se
   * ve um pedaco. `x` e `y` deslocam em porcento, e sao limitados pela propria
   * escala -- passar do limite poria borda preta no quadro.
   *
   * null e o normal, e mantem os presets mandando.
   */
  camera: caminhoDaCameraSchema.nullable().default(null),
  /**
   * A camera livre da metade de BAIXO da tela dividida. Na divisao, `camera`
   * vale para a metade de cima.
   *
   * "Opcao de camera livre na tela dividida." Cada metade e um quadro proprio
   * (1080x960), e enquadra o arquivo original com o aspecto dela.
   */
  cameraB: caminhoDaCameraSchema.nullable().optional(),
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
  /**
   * O mesmo, para a metade DE BAIXO da tela dividida.
   *
   * Ate a v1.27 ela partia sempre do zero, sem controle nenhum: a de cima podia
   * entrar no segundo que interessava e a de baixo mostrava obrigatoriamente o
   * comeco do arquivo. Numa tela dividida as duas cenas dividem a atencao por
   * igual, e nao ha motivo para uma ter menos controle que a outra.
   *
   * Com default para plano salvo antes disto abrir igual.
   */
  sourceStartB: z.number().nonnegative().default(0),
  /**
   * Zoom FIXO do bloco, como o "Scale" dos editores: 1 = como o enquadramento
   * deixou, 2 = o dobro. Nao anda com o tempo -- quem anda e o Ken Burns ou a
   * camera livre, e este multiplica o que eles fizerem.
   *
   * "Uma funcao onde eu posso dar zoom no clipe todo, como o Scale dos
   * editores, pra eu nao precisar ficar dando zoom pela camera livre e
   * animando." O centro do zoom e o enquadramento que ele ja arrasta.
   *
   * Com default para plano salvo antes disto abrir igual.
   */
  escala: z.number().min(1).max(4).optional(),
  /** O mesmo, para a metade de baixo da tela dividida. */
  escalaB: z.number().min(1).max(4).optional(),
  /** Espelhado na horizontal ("flip"). Opcional: plano antigo abre sem. */
  espelhar: z.boolean().optional(),
  /** O mesmo, para a metade de baixo. */
  espelharB: z.boolean().optional(),
  /**
   * Quantos graus o bloco gira, no sentido horario. 0 = como o arquivo veio.
   *
   * Com default para plano salvo antes disto abrir igual, e para a IA nao
   * precisar escolher: girar e correcao do material, e so quem esta olhando
   * sabe que o clipe chegou deitado.
   */
  rotation: rotationSchema.default(0),
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

/**
 * Os dois formatos de video.
 *
 * 'short' e o de sempre: 1080x1920, o 9:16 vertical. 'long' e o horizontal,
 * 1920x1080 -- escolhido por PROJETO, e nao por sessao, porque reabrir um
 * projeto horizontal em 9:16 recortaria tudo que ja foi enquadrado.
 *
 * As medidas sairam de constantes de modulo para uma funcao de proposito:
 * enquanto foram constantes, cada arquivo que as importava assumia 9:16 em
 * silencio. Tirando-as, o compilador aponta todo lugar que precisa saber qual
 * e o formato -- que e a unica forma de nao esquecer nenhum.
 */
export const FORMATOS = ['short', 'long'] as const
export type Formato = (typeof FORMATOS)[number]
export const FORMATO_PADRAO: Formato = 'short'

/** O que cada formato mede, e o que o render prepara com a folga do Ken Burns. */
export function medidasDo(formato: Formato): {
  width: number
  height: number
  renderWidth: number
  renderHeight: number
} {
  const width = formato === 'long' ? 1920 : 1080
  const height = formato === 'long' ? 1080 : 1920
  return {
    width,
    height,
    renderWidth: Math.round(width * RENDER_HEADROOM),
    renderHeight: Math.round(height * RENDER_HEADROOM),
  }
}

/**
 * Folga de escala para o Ken Burns. A imagem preparada para o render tem 1.15x
 * o quadro final: com scale(1.15) a regiao visivel volta a ser exatamente 1080
 * pixels nativos, entao nao ha upscale visivel nem pixel desperdicado.
 *
 * Mora aqui e nao no servico de imagens porque a verificacao previa precisa do
 * MESMO numero para dizer a verdade sobre quanto uma imagem sera ampliada.
 */
export const RENDER_HEADROOM = 1.15


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
export const CAPTION_COLORS = ['rosa', 'amarelo', 'verde', 'vermelho', 'azul', 'branco'] as const
/**
 * Uma das seis prontas, ou QUALQUER cor em hexadecimal (#RRGGBB).
 *
 * "Opcao de hexadecimal nas cores das legendas." As seis continuam valendo
 * pelo nome -- projeto e preset antigos abrem igual --, e a cor livre entra
 * como o proprio codigo.
 */
export const captionColorSchema = z.union([
  z.enum(CAPTION_COLORS),
  z.string().regex(/^#[0-9a-fA-F]{6}$/),
])
export type CaptionColor = z.infer<typeof captionColorSchema>

/** O hexadecimal de verdade de uma cor de legenda, pronta ou livre. */
export function corDaLegenda(cor: CaptionColor): string {
  return cor.startsWith('#')
    ? cor.toUpperCase()
    : CAPTION_COLOR_HEX[cor as (typeof CAPTION_COLORS)[number]]
}

export const CAPTION_COLOR_HEX: Record<(typeof CAPTION_COLORS)[number], string> = {
  rosa: '#FF3D81',
  amarelo: '#FFD60A',
  verde: '#34E06A',
  vermelho: '#FF3B30',
  azul: '#3DB8FF',
  /*
   * Branco existe para o texto INTEIRO de uma cor.
   *
   * Como marcador de palavra ele nao marca nada -- a palavra dita fica igual as
   * outras --, e e justamente por isso que ele entra: e o jeito de ter legenda
   * sem cor nenhuma, que ate agora nao dava.
   */
  branco: '#FFFFFF',
}

/** Rosa e o padrao: e a cor do app, e o video sai parecido com ele. */
export const CAPTION_COLOR_DEFAULT: CaptionColor = 'rosa'

/**
 * Altura da legenda, como fracao da altura do video medida a partir do rodape.
 *
 * Fracao e nao pixel de proposito: o valor fica preso ao enquadramento, nao a
 * resolucao, e continua valendo se um dia a composicao mudar de tamanho.
 *
 * O padrao e 0,355 -- uns 682px do rodape. Nao e conta: e a altura que ele
 * ajustou no olho e mandou virar padrao em 07/09. Ate ali eram 420px, escolhidos
 * por caberem acima da interface do TikTok e do Reels; a altura nova respeita a
 * mesma faixa com folga bem maior.
 *
 * O piso continua existindo pelo motivo de sempre: no TikTok e no Reels a faixa
 * de baixo da tela fica coberta pela interface do proprio aplicativo (usuario,
 * legenda, botoes), e legenda queimada ali simplesmente nao e lida.
 *
 * O teto para antes do meio da tela: acima disso a legenda briga com o card de
 * fechamento, que e centralizado.
 */
export const CAPTION_Y_DEFAULT = 0.355
export const CAPTION_Y_MIN = 0.08
export const CAPTION_Y_MAX = 0.55
export const captionYSchema = z
  .number()
  .min(CAPTION_Y_MIN)
  .max(CAPTION_Y_MAX)
  .default(CAPTION_Y_DEFAULT)

/**
 * Tamanho da legenda, como multiplicador do corpo padrao.
 *
 * O corpo ja encolhe sozinho quando a linha nao cabe na largura da tela, e isso
 * continua valendo por cima deste numero -- legenda que sai pela borda nao se
 * le, e nenhuma escolha de tamanho justifica perder a ponta da palavra. O que
 * este ajuste faz e mover o ponto de partida: quem quer a legenda mais discreta
 * ou mais gritante que o padrao pede aqui.
 *
 * Os limites existem para o ajuste nao virar defeito. Abaixo de 0,7 a legenda
 * fica menor que a interface que o TikTok desenha por cima do video; acima de
 * 1,5 duas palavras de dez caracteres ja nao cabem na largura de um short, e o
 * ajuste automatico desfaria o aumento na mesma hora.
 */
export const CAPTION_SCALE_DEFAULT = 1
export const CAPTION_SCALE_MIN = 0.7
export const CAPTION_SCALE_MAX = 1.5
export const captionScaleSchema = z
  .number()
  .min(CAPTION_SCALE_MIN)
  .max(CAPTION_SCALE_MAX)
  .default(CAPTION_SCALE_DEFAULT)

/**
 * O estilo de legenda guardado como PADRAO, fora de qualquer projeto.
 *
 * Todo campo e opcional e o schema tem `.catch()` em cada um: este objeto vem
 * de um JSON no disco que sobrevive a atualizacao do app, entao um valor que
 * deixou de existir numa versao nova nao pode impedir o resto de ser aplicado.
 * Um campo estranho cai no padrao dele; os outros continuam valendo.
 *
 * A fonte vai pelo NOME do arquivo, como no projeto: a URL e desta sessao e
 * nao vale amanha.
 */
/**
 * As regras de como a narracao vira legenda -- as do LegendAI, como opcoes.
 *
 * "Tem opcoes que eu queria ter, que tem no LegendAI." Os padroes sao os que
 * ele usa LA (settings.json do LegendAI em 30/09/2026), menos palavras por
 * legenda: essa ele ja tinha escolhido aqui (duas, desde 07/09) e fica.
 *
 * O que o LegendAI faz e o Dangai nao fazia, e que pesa na sensacao de
 * "sincronizado": ADIANTAR um fio (40 ms -- o olho le o texto como "na hora"
 * quando ele chega um pouco antes do som) e FECHAR OS VAOS curtos entre uma
 * legenda e a seguinte, em vez de piscar tela vazia no meio da frase.
 */
export const regrasDaLegendaSchema = z.object({
  /** Quantas palavras dividem a mesma legenda (se couberem nos caracteres). */
  palavras: z.number().int().min(1).max(4),
  /** Teto de caracteres. Palavra maior que isso fica sozinha, inteira. */
  caracteres: z.number().int().min(4).max(30),
  /** Tempo minimo na tela, em segundos. */
  minimo: z.number().min(0).max(2),
  /** Tempo maximo na tela, em segundos. */
  maximo: z.number().min(0.5).max(10),
  /** Quanto a legenda entra ANTES da palavra, em segundos. */
  adiantar: z.number().min(0).max(0.3),
  /** Vao ate este tamanho (s) e fechado: a legenda fica ate a proxima. 0 desliga. */
  fecharVaos: z.number().min(0).max(2),
})
export type RegrasDaLegenda = z.infer<typeof regrasDaLegendaSchema>

export const REGRAS_DA_LEGENDA_PADRAO: RegrasDaLegenda = {
  palavras: 2,
  caracteres: 10,
  minimo: 0.45,
  maximo: 2,
  adiantar: 0.04,
  fecharVaos: 0.5,
}

export const captionStyleSchema = z.object({
  regras: regrasDaLegendaSchema.catch(REGRAS_DA_LEGENDA_PADRAO).optional(),
  color: captionColorSchema.catch(CAPTION_COLOR_DEFAULT).optional(),
  y: captionYSchema.catch(CAPTION_Y_DEFAULT).optional(),
  scale: captionScaleSchema.catch(CAPTION_SCALE_DEFAULT).optional(),
  fontNome: z.string().catch('').optional(),
  animation: captionAnimationSchema.catch(CAPTION_ANIMATION_DEFAULT).optional(),
  animationFrames: captionAnimationFramesSchema.catch(CAPTION_ANIMATION_FRAMES_DEFAULT).optional(),
  animationCurve: curvaDaEntradaSchema.catch(CURVA_DA_ENTRADA_PADRAO).optional(),
  mark: captionMarkSchema.catch(CAPTION_MARK_DEFAULT).optional(),
  shadow: captionShadowSchema.catch(CAPTION_SHADOW_DEFAULT).optional(),
  stroke: captionStrokeSchema.catch(CAPTION_STROKE_DEFAULT).optional(),
})
export type CaptionStyle = z.infer<typeof captionStyleSchema>

/**
 * Um estilo de legenda guardado com NOME.
 *
 * "Poder salvar preset de estilo." O ultimo estilo ja virava o padrao do
 * proximo video; isto e o passo seguinte -- varios estilos, cada um com nome,
 * a um clique. Usa o mesmo captionStyleSchema, com .catch em cada campo: um
 * preset guardado numa versao antiga abre com o que ainda servir.
 */
export const captionPresetSchema = z.object({
  nome: z.string().trim().min(1).max(40),
  estilo: captionStyleSchema,
})
export type CaptionPreset = z.infer<typeof captionPresetSchema>

/**
 * Uma POWER BIN: uma colecao de arquivos que ele arrasta para a linha do tempo.
 *
 * "Uma funcao tipo as Power Bins do DaVinci, nessas bins eu colocaria todos os
 * meus SFX, e seria mais facil de fazer o drag and drop onde eu quero." Mora
 * nas configuracoes, e nao no projeto: e o acervo DELE, que serve a todo video.
 *
 * Uma bin junta arquivos soltos (`arquivos`) e, se quiser, uma PASTA inteira
 * (`pasta`), que e relida ao abrir -- largar um som novo na pasta ja o poe na
 * bin, sem passo nenhum.
 */
export const binSchema = z.object({
  id: z.string(),
  nome: z.string().trim().min(1).max(40),
  pasta: z.string().nullable().default(null),
  arquivos: z.array(z.string()).default([]),
})
export type Bin = z.infer<typeof binSchema>

/**
 * Uma SOBREPOSICAO na faixa de video: o .mov com fundo transparente que ele
 * faz no editor (seta, circulo, emoji animado), ou uma imagem PNG.
 *
 * "Track de video tambem, pra poder adicionar meus .mov que eu faco no editor,
 * coisas pra auxiliar no visual, tipo setas." Fica POR CIMA das cenas e por
 * baixo das legendas. `x` e `y` deslocam do centro em porcento do quadro,
 * `escala` 1 e o tamanho em que o arquivo cobre o quadro (contain).
 *
 * O arquivo que toca e uma copia preparada pelo main (ver
 * electron/services/sobreposicao): .mov vira WebM VP9 com transparencia, que e
 * o que o preview e o render sabem desenhar com fundo vazado.
 */
/*
 * A CAMADA DE AJUSTE: a "adjustment layer" dos editores. Um clipe na faixa de
 * video que nao tem arquivo -- ele corrige a cor de tudo que esta EMBAIXO dele
 * (as cenas e as faixas de video de numero menor), no trecho que ocupa.
 *
 * Os numeros vao de -1 a 1 com 0 = nada, exceto a exposicao (em stops) e a
 * nitidez (0 a 1). As curvas sao pontos de 0 a 1 por canal; a reta de (0,0) a
 * (1,1) e a curva que nao mexe em nada.
 */
export const pontoDeCurvaDeCorSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
export type PontoDeCurvaDeCor = z.infer<typeof pontoDeCurvaDeCorSchema>
export const CURVA_DE_COR_RETA: readonly PontoDeCurvaDeCor[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
]
const curvaDeCorSchema = z
  .array(pontoDeCurvaDeCorSchema)
  .min(2)
  .max(16)
  .default(() => CURVA_DE_COR_RETA.map((p) => ({ ...p })))
const umLado = z.number().min(-1).max(1).default(0)
export const ajusteDeCorSchema = z.object({
  exposicao: z.number().min(-3).max(3).default(0),
  brilho: umLado,
  contraste: umLado,
  realces: umLado,
  sombras: umLado,
  brancos: umLado,
  pretos: umLado,
  temperatura: umLado,
  tint: umLado,
  saturacao: umLado,
  vibrance: umLado,
  nitidez: z.number().min(0).max(1).default(0),
  curvas: z
    .object({ mestre: curvaDeCorSchema, r: curvaDeCorSchema, g: curvaDeCorSchema, b: curvaDeCorSchema })
    .default(() => ({
      mestre: CURVA_DE_COR_RETA.map((p) => ({ ...p })),
      r: CURVA_DE_COR_RETA.map((p) => ({ ...p })),
      g: CURVA_DE_COR_RETA.map((p) => ({ ...p })),
      b: CURVA_DE_COR_RETA.map((p) => ({ ...p })),
    })),
  /** Quanto do ajuste vale: 1 = inteiro, 0 = nada (mistura com o original). */
  intensidade: z.number().min(0).max(1).default(1),
})
export type AjusteDeCor = z.infer<typeof ajusteDeCorSchema>

/**
 * Quanto do clipe aparece neste quadro, de 0 a 1: sobe no fade de entrada e
 * desce no de saida. `quadro` conta do comeco do clipe. As duas rampas nunca
 * passam da metade do clipe -- um fade maior que o clipe cruzaria o outro.
 */
export function rampaDoFade(quadro: number, duracao: number, entra: number, sai: number): number {
  const e = Math.min(entra, duracao / 2)
  const s = Math.min(sai, duracao / 2)
  let v = 1
  if (e > 0 && quadro < e) v = Math.max(0, quadro / e)
  if (s > 0 && quadro > duracao - s) v = Math.min(v, Math.max(0, (duracao - quadro) / s))
  return v
}
export const AJUSTE_DE_COR_PADRAO: AjusteDeCor = ajusteDeCorSchema.parse({})

export const sobreposicaoSchema = z.object({
  id: z.string(),
  path: z.string(),
  fileName: z.string(),
  /** 'ajuste' = camada de ajuste: sem arquivo, so o `cor`. */
  tipo: z.enum(['video', 'image', 'ajuste']),
  faixa: z.number().int().nonnegative(),
  at: z.number().nonnegative(),
  /** Duracao do arquivo. Imagem nao tem: vale `usarSec`. */
  durationSec: z.number().positive(),
  inicioSec: z.number().nonnegative().default(0),
  usarSec: z.number().positive().nullable().default(null),
  x: z.number().min(-100).max(100).default(0),
  y: z.number().min(-100).max(100).default(0),
  escala: z.number().min(0.05).max(4).default(1),
  opacidade: z.number().min(0).max(1).default(1),
  /** Aspecto do arquivo, para a miniatura da faixa. */
  aspecto: z.number().positive().default(16 / 9),
  /** Giro em graus, em volta do centro. */
  rotacao: z.number().min(-180).max(180).default(0),
  /*
   * O MOVIMENTO dos blocos, agora tambem no clipe da faixa: "quero poder ativar
   * as opcoes de movimento que temos no clipe". Mesmo efeito, intensidade e
   * ritmo; com default, projeto antigo abre parado como estava.
   */
  efeito: z.enum(SCENE_EFFECTS).default('nenhum'),
  intensidade: z.number().min(0.02).max(0.6).default(0.1),
  curva: motionCurveSchema.default(MOTION_CURVE_DEFAULT),
  pontosDaCurva: curvePointsSchema.nullable().default(null),
  /** So na camada de ajuste. */
  cor: ajusteDeCorSchema.optional(),
  /** Espelhado na horizontal. */
  espelhar: z.boolean().default(false),
  /**
   * Fade de entrada e de saida, em segundos: a opacidade (ou, na camada de
   * ajuste, a intensidade) sobe e desce nessas pontas.
   */
  fadeInSec: z.number().min(0).max(10).default(0),
  fadeOutSec: z.number().min(0).max(10).default(0),
})
export type SobreposicaoSalva = z.infer<typeof sobreposicaoSchema>

export const renderPropsSchema = z.object({
  /**
   * O quadro em que este video e montado.
   *
   * Viaja NAS PROPS, e nao num estado do processo: aqui errar significa gravar
   * o video inteiro no formato errado, e vale carregar o dado junto com o que
   * ele descreve.
   */
  formato: z.enum(FORMATOS).default(FORMATO_PADRAO),
  scenes: z.array(
    z.object({
      url: z.string(),
      durationInFrames: z.number().int().positive(),
      effect: z.enum(SCENE_EFFECTS),
      intensity: z.number(),
      curve: motionCurveSchema.default(MOTION_CURVE_DEFAULT),
      /** A curva desenhada a mao; null usa o preset. Default para props antigas valerem. */
      curvePoints: curvePointsSchema.nullable().default(null),
      /**
       * Camera livre: os enquadramentos do comeco e do fim.
       *
       * Preenchida, manda no lugar de `effect` e `intensity`. Com default para
       * props antigas continuarem validas.
       */
      camera: z
        .object({
          from: cameraFrameSchema,
          to: cameraFrameSchema,
      /**
       * A camera enquadra o arquivo ORIGINAL, e nao o recorte 9:16.
       *
       * Ate a v1.27 ela so enxergava o recorte, e os dois tercos laterais de um
       * clipe 16:9 eram inalcancaveis -- um personagem na ponta direita nao
       * existia no arquivo que o render abria. Falso nas cameras desenhadas
       * antes disto: o numero delas vale no quadro recortado, e trocar a fonte
       * por baixo mudaria o enquadramento de um video ja pronto.
       */
      source: z.boolean().default(false),
      /**
       * As chaves do meio do caminho, em ordem de .
       *
       * Vazio e o normal: a camera vai da primeira ponta a segunda em linha
       * reta, como sempre foi. O rastreador enche esta lista, e ai o caminho
       * passa a acompanhar o que se mexe em vez de cortar reto por cima dele.
       */
      keys: z.array(cameraKeySchema).default([]),
        })
        .nullable()
        .default(null),
      /**
       * O aspecto do arquivo que `url` aponta, quando a camera parte do
       * ORIGINAL. null quer dizer "ja e 9:16", que e o caso de sempre.
       *
       * Vai junto porque a conta da camera precisa saber quanta largura sobra
       * do lado de fora do quadro, e so quem montou o plano tem essa medida.
       */
      sourceAspect: z.number().positive().nullable().default(null),
      /**
       * Print ou clipe. Com default para props antigas continuarem validas.
       *
       * O clipe entra como "uma imagem que se mexe": ocupa um bloco igual, na
       * mesma lista, e quem decide quanto tempo ele fica na tela continua sendo
       * a narracao. Se o clipe for mais longo, ele e cortado no fim do bloco.
       */
      kind: z.enum(['image', 'video']).default('image'),
      /**
       * A miniatura do clipe, usada SO no preview e so como cama.
       *
       * No player, o <video> do clipe nasce na hora da troca de bloco: ele
       * ainda precisa carregar, procurar o ponto de entrada e decodificar antes
       * de pintar, e ate la o que aparece e o fundo preto. E o piscar que so
       * existe no preview -- o render nao tem isso, porque la o frame vem do
       * compositor, pronto.
       *
       * Esta miniatura e a mesma que a linha do tempo ja mostra, entao ela ja
       * esta em cache e pinta na hora. Fica atras do clipe: enquanto ele nao
       * vem, o olho ve a cena certa em baixa resolucao em vez de um buraco.
       *
       * Com default null para props antigas continuarem validas.
       */
      thumbnail: z.string().nullable().default(null),
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
      /** Graus de giro do bloco. Com default para props antigas continuarem validas. */
      rotation: rotationSchema.default(0),
      /** Zoom fixo do bloco (o "Scale"). Com default para props antigas continuarem validas. */
      escala: z.number().min(1).max(4).default(1),
      /** Espelhado na horizontal. */
      espelhar: z.boolean().default(false),
      /**
       * A metade de BAIXO, quando o bloco e tela dividida. null = tela cheia.
       *
       * Cada metade traz a propria fonte e o proprio enquadramento: no quadro
       * dividido cada uma ocupa 1080x960, e o recorte 9:16 que o app faz para
       * tela cheia cortaria duas vezes. Por isso a divisao usa o arquivo
       * ORIGINAL do clipe e enquadra por CSS, com o foco que o app ja tem.
       */
      abaixo: z
        .object({
          url: z.string(),
          kind: z.enum(['image', 'video']).default('video'),
          focusX: z.number().min(0).max(1).default(0.5),
          focusY: z.number().min(0).max(1).default(0.5),
          sourceDurationInFrames: z.number().int().positive().nullable().default(null),
          sourceStartFrames: z.number().int().nonnegative().default(0),
          /**
           * O movimento desta metade, ja resolvido.
           *
           * Aqui nao ha `null`: quem decide se a de baixo segue a de cima ou
           * tem movimento proprio e o plano, e o Remotion so recebe o resultado.
           * Com default para props antigas continuarem validas -- e o default e
           * 'nenhum' porque props antigas vem de quando a divisao nao se mexia.
           */
          effect: z.enum(SCENE_EFFECTS).default('nenhum'),
          intensity: z.number().min(0.02).max(0.2).default(0.12),
          escala: z.number().min(1).max(4).default(1),
          espelhar: z.boolean().default(false),
          /** Camera livre desta metade. Preenchida, manda no lugar do efeito. */
          camera: caminhoDaCameraSchema.nullable().default(null),
          /** Aspecto do arquivo desta metade -- a conta da camera precisa dele. */
          aspecto: z.number().positive().nullable().default(null),
        })
        .nullable()
        .default(null),
      /** O enquadramento da metade de CIMA. So usado quando `abaixo` existe. */
      focusX: z.number().min(0).max(1).default(0.5),
      focusY: z.number().min(0).max(1).default(0.5),
      /** O arquivo original, sem o recorte 9:16. Usado so na tela dividida. */
      urlSource: z.string().nullable().default(null),
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
  /** Multiplicador do corpo da legenda. Default para props antigas valerem. */
  captionScale: captionScaleSchema.default(CAPTION_SCALE_DEFAULT),
  /**
   * A fonte das legendas, quando ele escolheu uma das que largou na pasta.
   *
   * null = a embutida (Komika Axis), que e o que o app sempre fez. A URL vem
   * junto porque o Chrome do render nao enxerga as fontes do Windows: ele busca
   * o arquivo pelo mesmo servidor local que serve os clipes.
   */
  captionFont: z
    .object({ family: z.string(), url: z.string() })
    .nullable()
    .default(null),
  /**
   * Como cada bloco de legenda ENTRA na tela.
   *
   * 'nenhuma' e o padrao e continua sendo: a legenda aparece no lugar, sem
   * chamar atencao para si. 'elastica' e a entrada com escala e repique, que ele
   * pediu para poder ligar quando quiser -- nunca por padrao.
   */
  captionAnimation: captionAnimationSchema.default(CAPTION_ANIMATION_DEFAULT),
  /** Quantos frames a entrada elastica leva. So vale com a animacao ligada. */
  captionAnimationFrames: captionAnimationFramesSchema.default(
    CAPTION_ANIMATION_FRAMES_DEFAULT,
  ),
  /** A curva da entrada elastica. Com default = a mola de antes, para props antigas. */
  captionAnimationCurve: curvaDaEntradaSchema.default(CURVA_DA_ENTRADA_PADRAO),
  /**
   * As sobreposicoes da faixa de video, ja em quadros e com a URL que toca.
   * Por cima das cenas, por baixo das legendas. Default para props antigas.
   */
  sobreposicoes: z
    .array(
      z.object({
        url: z.string(),
        tipo: z.enum(['video', 'image', 'ajuste']),
        from: z.number().int().nonnegative(),
        durationInFrames: z.number().int().positive(),
        inicioFrames: z.number().int().nonnegative(),
        x: z.number(),
        y: z.number(),
        escala: z.number().positive(),
        opacidade: z.number().min(0).max(1),
        /** Faixa: a de numero maior fica por cima. */
        faixa: z.number().int().nonnegative(),
        rotacao: z.number().default(0),
        efeito: z.enum(SCENE_EFFECTS).default('nenhum'),
        intensidade: z.number().default(0.1),
        curva: motionCurveSchema.default(MOTION_CURVE_DEFAULT),
        pontosDaCurva: curvePointsSchema.nullable().default(null),
        cor: ajusteDeCorSchema.optional(),
        espelhar: z.boolean().default(false),
        fadeInFrames: z.number().int().nonnegative().default(0),
        fadeOutFrames: z.number().int().nonnegative().default(0),
      }),
    )
    .default([]),
  /** Cor so na palavra dita, ou na legenda inteira. */
  captionMark: captionMarkSchema.default(CAPTION_MARK_DEFAULT),
  /** A sombra projetada do texto. Opacidade zero = sem sombra. */
  captionShadow: captionShadowSchema.default(CAPTION_SHADOW_DEFAULT),
  /** Espessura do contorno preto. Zero = sem contorno. */
  captionStroke: captionStrokeSchema.default(CAPTION_STROKE_DEFAULT),
  /** Texto de abertura e de fechamento. Vazio quando o usuario nao pediu. */
  cards: z.array(overlayCardSchema).default([]),
})
export type RenderProps = z.infer<typeof renderPropsSchema>

/**
 * Um bloco de legenda e uma linha so. No maximo DUAS palavras e dez
 * caracteres -- mais que isso nao da tempo de ler num short.
 *
 * Eram tres ate 07/09, e ele pediu duas depois de ver rodando: com tres, linhas
 * como "ate quem leu" batiam exatamente nos doze caracteres e passavam rapido
 * demais para o olho pegar as tres.
 *
 * O teto de caracteres desceu de doze para dez em 10/09. Doze ainda deixava
 * passar a linha cheia que ele nao consegue ler no tempo que ela fica na tela.
 *
 * A unica excecao e a palavra que sozinha ja passa do limite: ela fica sozinha
 * na linha, porque quebrar palavra no meio e pior que uma linha comprida.
 */
export const CAPTION_MAX_WORDS = 2
export const CAPTION_MAX_CHARS = 10

/**
 * Pontuacao que fecha a linha.
 *
 * Depois de um ponto ou de uma virgula comeca outra ideia, e juntar as duas na
 * mesma legenda ("insana. Essa") faz o olho ler como uma frase so. A palavra
 * seguinte abre linha nova -- sozinha, ou acompanhada da que vem depois dela.
 */
export const CAPTION_BREAK_AFTER = '.,!?;:…'

/**
 * Palavras que NAO PODEM FECHAR uma linha: elas se prendem ao que vem depois.
 *
 * Artigo separado do substantivo e o que ele apontou -- "e a" numa linha e
 * "defesa" na seguinte le como duas metades de nada. O olho ja espera o
 * substantivo quando le o artigo, e a quebra ali custa uma releitura.
 *
 * Vale para preposicao e contracao pelo mesmo motivo e com a mesma forca: "de"
 * sozinho no fim da linha e tao truncado quanto "a". Sao todas palavras que
 * abrem sintagma, nunca fecham.
 *
 * O que NAO entra: adverbio, verbo e substantivo, por menores que sejam. "ja",
 * "vai", "ele" e "nao" fecham linha sem soar cortados, e tirar a chance de
 * fechar linha neles so produziria mais linha de uma palavra.
 */
export const CAPTION_NAO_FECHA_LINHA: readonly string[] = [
  // artigos
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  // preposicoes simples
  'de', 'em', 'por', 'com', 'sem', 'sob', 'sobre', 'para', 'pra', 'pro',
  'entre', 'ate', 'até', 'desde', 'apos', 'após', 'contra', 'durante', 'perante',
  // contracoes de preposicao com artigo
  'do', 'da', 'dos', 'das', 'dum', 'duma', 'duns', 'dumas',
  'no', 'na', 'nos', 'nas', 'num', 'numa', 'nuns', 'numas',
  'ao', 'aos', 'à', 'às', 'pelo', 'pela', 'pelos', 'pelas',
  // conjuncoes que abrem o que vem depois
  'e', 'ou', 'nem', 'mas', 'que', 'se', 'como', 'quando',
]

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

/**
 * Um trecho numa FAIXA DE AUDIO da linha do tempo -- musica, ambiente, o que
 * ele quiser por por baixo da narracao, onde quiser.
 *
 * "Quero adicionar track audio, para eu add minhas musicas no video." A cama
 * de musica de antes (uma faixa so, em loop, o video inteiro) continua; isto e
 * o resto: varios trechos, varias faixas, cada um com o seu pedaco do arquivo,
 * o seu volume e os seus fades.
 *
 * O volume aqui e ABSOLUTO (dB sobre o arquivo), e nao relativo ao nivel dos
 * SFX: musica e outra coisa, e nasce em -20 dB, o mesmo da cama de musica.
 */
export const trechoDeAudioSchema = z.object({
  id: z.string(),
  path: z.string(),
  fileName: z.string(),
  /** Faixa, de 0 em diante. Faixas sao criadas conforme ele usa. */
  faixa: z.number().int().nonnegative(),
  /** Onde o trecho entra no video, em segundos. */
  at: z.number().nonnegative(),
  /** Duracao do ARQUIVO inteiro. */
  durationSec: z.number().positive(),
  /** De que ponto do arquivo o trecho parte. */
  inicioSec: z.number().nonnegative().default(0),
  /** Quanto toca, em segundos. null = ate o fim do arquivo. */
  usarSec: z.number().positive().nullable().default(null),
  gainDb: z.number().min(-40).max(12).default(MUSIC_GAIN_DB_DEFAULT),
  fadeInSec: z.number().min(0).max(10).default(0.5),
  fadeOutSec: z.number().min(0).max(10).default(1),
  peaks: z.array(z.number().min(0).max(1)).default([]),
  rms: z.array(z.number().min(0).max(1)).default([]),
})
export type TrechoDeAudioSalvo = z.infer<typeof trechoDeAudioSchema>

/** Quanto o trecho toca de fato: o pedaco escolhido, ou ate o fim do arquivo. */
export function duracaoDoTrecho(t: { durationSec: number; inicioSec: number; usarSec: number | null }): number {
  return Math.max(0, t.usarSec ?? t.durationSec - t.inicioSec)
}
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
