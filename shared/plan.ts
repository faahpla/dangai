import {
  KEN_BURNS_EFFECTS,
  VIDEO_FPS,
  type ImageAsset,
  type RenderProps,
  type Scene,
  type ScenePlan,
} from './contract'

/**
 * Plano deterministico. Na v0.2 e a unica fonte de plano; a partir da v0.3 vira
 * o fallback de quando a API falha ou nao ha internet -- e continua sendo o que
 * garante que o app nunca trava por causa da IA.
 *
 * Vive em shared/ porque tanto o main (render) quanto o renderer (preview)
 * precisam chegar exatamente ao mesmo plano.
 */

/** Cena mais curta que isso nao da tempo de ler a imagem. */
export const MIN_SCENE_SEC = 1.2
/** Mais longa que isso a atencao cai num short. */
export const MAX_SCENE_SEC = 6

/**
 * Divide a duracao igualmente entre as imagens, alternando o efeito de Ken
 * Burns para nao repetir o mesmo movimento em cenas seguidas.
 */
export function planEqualSplit(imageCount: number, durationSec: number): ScenePlan {
  if (imageCount <= 0) {
    throw new Error('Sem imagens para montar o plano')
  }

  const per = durationSec / imageCount
  const scenes: Scene[] = Array.from({ length: imageCount }, (_, index) => ({
    imageIndex: index,
    start: index * per,
    end: index === imageCount - 1 ? durationSec : (index + 1) * per,
    effect: pickEffect(index),
    intensity: 0.12,
    transitionIn: 'cut' as const,
  }))

  return { scenes, sfxCues: [] }
}

/**
 * Alterna entre os efeitos de forma que duas cenas seguidas nunca tenham o
 * mesmo movimento. Determinístico de proposito: o mesmo projeto sempre da o
 * mesmo video.
 */
function pickEffect(index: number): Scene['effect'] {
  const effect = KEN_BURNS_EFFECTS[index % KEN_BURNS_EFFECTS.length]
  // KEN_BURNS_EFFECTS nunca e vazio, mas noUncheckedIndexedAccess exige a guarda.
  return effect ?? 'zoom-in'
}

/**
 * Converte o plano (em segundos) no que a composicao Remotion consome (em
 * frames). Esta e a unica traducao segundo->frame do app; fazer isso em dois
 * lugares e como o audio e a imagem saem de sincronia.
 */
export function toRenderProps(plan: ScenePlan, images: readonly ImageAsset[]): RenderProps {
  const scenes = plan.scenes.flatMap((scene) => {
    const image = images[scene.imageIndex]
    if (!image) return []

    const from = Math.round(scene.start * VIDEO_FPS)
    const durationInFrames = Math.max(Math.round((scene.end - scene.start) * VIDEO_FPS), 1)

    return [
      {
        url: image.url,
        from,
        durationInFrames,
        effect: scene.effect,
        intensity: scene.intensity,
        transitionIn: scene.transitionIn,
      },
    ]
  })

  return { scenes }
}

/** Total de frames da composicao, a partir da duracao do audio. */
export function totalFrames(durationSec: number): number {
  return Math.max(Math.ceil(durationSec * VIDEO_FPS), 1)
}
