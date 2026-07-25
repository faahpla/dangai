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
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** WEBP pequeno em data URL, so para a timeline e o strip. */
  thumbnail: z.string(),
})
export type ImageAsset = z.infer<typeof imageAssetSchema>

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

export const scenePlanSchema = z.object({
  scenes: z.array(sceneSchema).min(1),
  sfxCues: z
    .array(z.object({ at: z.number().nonnegative(), sound: z.string() }))
    .default([]),
})
export type ScenePlan = z.infer<typeof scenePlanSchema>

// ---------------------------------------------------------------- render

export const VIDEO_WIDTH = 1080
export const VIDEO_HEIGHT = 1920
export const VIDEO_FPS = 30

/** O que a composicao Remotion recebe. Preview e render usam o mesmo objeto. */
export const renderPropsSchema = z.object({
  scenes: z.array(
    z.object({
      url: z.string(),
      /** Frame inicial dentro da composicao. */
      from: z.number().int().nonnegative(),
      durationInFrames: z.number().int().positive(),
      effect: z.enum(KEN_BURNS_EFFECTS),
      intensity: z.number(),
      transitionIn: z.enum(TRANSITIONS),
    }),
  ),
})
export type RenderProps = z.infer<typeof renderPropsSchema>

export const renderProgressSchema = z.object({
  /** 0..1 */
  progress: z.number().min(0).max(1),
  stage: z.enum(['bundling', 'rendering', 'muxing', 'done', 'cancelled', 'failed']),
  message: z.string().optional(),
  outputPath: z.string().optional(),
})
export type RenderProgress = z.infer<typeof renderProgressSchema>
