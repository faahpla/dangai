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

export const sceneSchema = z.object({
  /** Indice na lista de imagens do usuario. */
  imageIndex: z.number().int().nonnegative(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  effect: z.enum(KEN_BURNS_EFFECTS),
  /** Quanto o Ken Burns se move. 0.10 a 0.15; acima disso fica tosco. */
  intensity: z.number().min(0.02).max(0.2),
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

/** Como o plano foi obtido. Aparece na interface para o usuario saber. */
export const PLAN_ORIGINS = ['ai', 'rhythm', 'silence', 'equal'] as const
export type PlanOrigin = (typeof PLAN_ORIGINS)[number]

export interface AnalysisResult {
  plan: ScenePlan
  origin: PlanOrigin
  transcript: Transcript | null
  /** Preenchido quando a IA foi tentada e nao deu -- a interface avisa, sem travar. */
  aiNote: string | null
  /** Como o roteiro se saiu, quando houve roteiro. */
  scriptNote: string | null
}

// ---------------------------------------------------------------- render

export const VIDEO_WIDTH = 1080
export const VIDEO_HEIGHT = 1920

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

export const renderPropsSchema = z.object({
  scenes: z.array(
    z.object({
      url: z.string(),
      durationInFrames: z.number().int().positive(),
      effect: z.enum(KEN_BURNS_EFFECTS),
      intensity: z.number(),
      transitionIn: z.enum(TRANSITIONS),
      /** Frames da transicao de entrada. 0 = corte seco. */
      transitionInFrames: z.number().int().nonnegative(),
    }),
  ),
  /** Vazio quando as legendas estao desligadas ou nao ha transcricao. */
  captions: z.array(captionBlockSchema).default([]),
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

export const renderProgressSchema = z.object({
  /** 0..1 */
  progress: z.number().min(0).max(1),
  stage: z.enum(['bundling', 'rendering', 'muxing', 'done', 'cancelled', 'failed']),
  message: z.string().optional(),
  outputPath: z.string().optional(),
})
export type RenderProgress = z.infer<typeof renderProgressSchema>
