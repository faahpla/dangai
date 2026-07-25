import {
  KEN_BURNS_EFFECTS,
  TRANSITION_FRAMES,
  VIDEO_FPS,
  type ImageAsset,
  type RenderProps,
  type Scene,
  type ScenePlan,
  type Transcript,
} from './contract'

/**
 * Tudo que transforma "n imagens + duracao" em um plano de cenas.
 *
 * Vive em shared/ porque o main (render) e o renderer (preview) precisam chegar
 * exatamente ao mesmo plano -- se divergirem, o preview mente.
 *
 * A ordem das imagens NUNCA muda aqui. Ela e do usuario; o plano decide apenas
 * onde caem os cortes, qual efeito e qual transicao.
 */

/** Cena mais curta que isso nao da tempo de ler a imagem. */
export const MIN_SCENE_SEC = 1.2
/** Mais longa que isso a atencao cai num short. */
export const MAX_SCENE_SEC = 6
/** Quanto um corte pode andar para cair numa pausa natural. */
export const SNAP_TOLERANCE_SEC = 0.4

// ------------------------------------------------------------------ fallback

/**
 * Divide a duracao igualmente entre as imagens. Ultimo recurso: sem transcricao,
 * sem silencios, sem IA. Sempre produz um video valido.
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
    transitionIn: index === 0 ? ('cut' as const) : ('cut' as const),
  }))

  return { scenes, sfxCues: [] }
}

/**
 * Distribui as imagens pelas pausas naturais da narracao.
 *
 * Escolhe, entre os instantes candidatos, os n-1 que deixam as cenas mais
 * proximas do tamanho ideal. E o fallback que roda quando a IA nao esta
 * disponivel mas existe transcricao ou deteccao de silencio -- bem melhor que
 * divisao igual, e sem depender de rede.
 */
export function planFromCandidates(
  imageCount: number,
  durationSec: number,
  candidates: readonly number[],
): ScenePlan {
  const cutsNeeded = imageCount - 1
  if (cutsNeeded === 0) return planEqualSplit(imageCount, durationSec)

  const usable = candidates
    .filter((t) => t > MIN_SCENE_SEC && t < durationSec - MIN_SCENE_SEC)
    .sort((a, b) => a - b)

  if (usable.length < cutsNeeded) return planEqualSplit(imageCount, durationSec)

  // Para cada corte ideal (divisao igual), pega o candidato livre mais proximo.
  const ideal = Array.from({ length: cutsNeeded }, (_, i) => ((i + 1) * durationSec) / imageCount)
  const taken = new Set<number>()
  const chosen: number[] = []

  for (const target of ideal) {
    let best = -1
    let bestDistance = Infinity
    for (let i = 0; i < usable.length; i++) {
      if (taken.has(i)) continue
      const distance = Math.abs(usable[i]! - target)
      if (distance < bestDistance) {
        bestDistance = distance
        best = i
      }
    }
    if (best === -1) return planEqualSplit(imageCount, durationSec)
    taken.add(best)
    chosen.push(usable[best]!)
  }

  chosen.sort((a, b) => a - b)

  const bounds = [0, ...chosen, durationSec]
  const scenes: Scene[] = Array.from({ length: imageCount }, (_, index) => ({
    imageIndex: index,
    start: bounds[index]!,
    end: bounds[index + 1]!,
    effect: pickEffect(index),
    intensity: 0.12,
    transitionIn: 'cut' as const,
  }))

  // Um whoosh no primeiro corte, mesmo sem IA. O impact "no gancho" depende de
  // entender o conteudo, entao esse fica so para o caminho com IA.
  const firstCut = chosen[0]
  return sanitize(
    { scenes, sfxCues: firstCut === undefined ? [] : [{ at: firstCut, sound: 'whoosh' }] },
    imageCount,
    durationSec,
  )
}

// -------------------------------------------------------------------- snap

/**
 * Move cada corte para o instante natural mais proximo, dentro da tolerancia.
 *
 * Isto e o que garante o criterio "nenhuma troca de imagem cai no meio de uma
 * palavra". Nao da para delegar isso a IA: ela devolve numeros arbitrarios como
 * 3.4 ou 7.13, e acertar a fronteira entre palavras por acaso e sorte. A regra
 * precisa ser deterministica e rodar DEPOIS de qualquer plano, venha ele da IA
 * ou do fallback.
 */
export function snapToCandidates(
  plan: ScenePlan,
  candidates: readonly number[],
  durationSec: number,
): ScenePlan {
  if (candidates.length === 0 || plan.scenes.length < 2) return plan

  const sorted = [...candidates].sort((a, b) => a - b)
  const scenes = plan.scenes.map((scene) => ({ ...scene }))

  for (let i = 1; i < scenes.length; i++) {
    const cut = scenes[i]!.start
    const snapped = nearest(sorted, cut)
    if (snapped === null || Math.abs(snapped - cut) > SNAP_TOLERANCE_SEC) continue

    // So aceita se as duas cenas vizinhas continuarem com tamanho utilizavel.
    const previousLength = snapped - scenes[i - 1]!.start
    const nextLength = scenes[i]!.end - snapped
    if (previousLength < MIN_SCENE_SEC || nextLength < MIN_SCENE_SEC) continue

    scenes[i - 1]!.end = snapped
    scenes[i]!.start = snapped
  }

  return sanitize({ ...plan, scenes }, scenes.length, durationSec)
}

function nearest(sorted: readonly number[], target: number): number | null {
  if (sorted.length === 0) return null
  let low = 0
  let high = sorted.length - 1
  let best = sorted[0]!

  while (low <= high) {
    const mid = (low + high) >> 1
    const value = sorted[mid]!
    if (Math.abs(value - target) < Math.abs(best - target)) best = value
    if (value < target) low = mid + 1
    else if (value > target) high = mid - 1
    else return value
  }
  return best
}

// ---------------------------------------------------------------- saneamento

/**
 * Deixa qualquer plano utilizavel, venha da IA ou do fallback.
 *
 * A IA erra de formas previsiveis: cena de 0.4s, buraco entre duas cenas,
 * ultima cena que nao chega no fim do audio, indice de imagem repetido. Nada
 * disso pode chegar no render, e nenhuma dessas garantias deve depender de o
 * modelo ter obedecido o prompt.
 */
export function sanitize(plan: ScenePlan, imageCount: number, durationSec: number): ScenePlan {
  // Audio curto demais para caber o minimo por cena: divisao igual e a unica
  // saida honesta, e forcar o minimo aqui so produziria tempos absurdos.
  if (imageCount * MIN_SCENE_SEC > durationSec) {
    return planEqualSplit(imageCount, durationSec)
  }

  // Uma cena por imagem, na ordem do usuario. Se a IA devolveu indice repetido,
  // faltando ou fora de ordem, a contagem de imagens manda.
  const base: Scene[] = Array.from({ length: imageCount }, (_, index) => {
    const found = plan.scenes.find((scene) => scene.imageIndex === index)
    return found
      ? { ...found, imageIndex: index }
      : {
          imageIndex: index,
          start: (index * durationSec) / imageCount,
          end: ((index + 1) * durationSec) / imageCount,
          effect: pickEffect(index),
          intensity: 0.12,
          transitionIn: 'cut' as const,
        }
  })

  // Fronteiras contiguas a partir dos inicios: sem buraco, sem sobreposicao,
  // comecando em 0 e terminando exatamente na duracao do audio.
  const starts = base.map((scene, index) => (index === 0 ? 0 : clamp(scene.start, 0, durationSec)))

  // Empurra para frente o que ficou curto demais...
  for (let i = 1; i < starts.length; i++) {
    const minimum = starts[i - 1]! + MIN_SCENE_SEC
    if (starts[i]! < minimum) starts[i] = minimum
  }
  // ...e comprime de tras para frente se isso estourou o fim.
  for (let i = starts.length - 1; i > 0; i--) {
    const maximum = (i === starts.length - 1 ? durationSec : starts[i + 1]!) - MIN_SCENE_SEC
    if (starts[i]! > maximum) starts[i] = maximum
  }

  const scenes: Scene[] = base.map((scene, index) => {
    const start = starts[index]!
    const end = index === base.length - 1 ? durationSec : starts[index + 1]!
    return {
      ...scene,
      start,
      end: Math.max(end, start + 1 / VIDEO_FPS),
      intensity: clamp(scene.intensity, 0.02, 0.15),
      // A primeira cena nao tem de onde transicionar.
      transitionIn: index === 0 ? 'cut' : scene.transitionIn,
    }
  })

  return { ...plan, scenes: avoidRepeatedEffects(scenes) }
}

/** Duas cenas seguidas nunca com o mesmo movimento. */
function avoidRepeatedEffects(scenes: readonly Scene[]): Scene[] {
  const result = scenes.map((scene) => ({ ...scene }))
  for (let i = 1; i < result.length; i++) {
    if (result[i]!.effect !== result[i - 1]!.effect) continue
    const alternative = KEN_BURNS_EFFECTS.find(
      (effect) => effect !== result[i - 1]!.effect && effect !== result[i + 1]?.effect,
    )
    if (alternative) result[i]!.effect = alternative
  }
  return result
}

function pickEffect(index: number): Scene['effect'] {
  return KEN_BURNS_EFFECTS[index % KEN_BURNS_EFFECTS.length] ?? 'zoom-in'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// ------------------------------------------------------------------ candidatos

/**
 * Instantes bons para cortar, tirados da transcricao.
 *
 * Fronteira de frase vale mais que intervalo entre palavras, entao as duas
 * entram -- o snap escolhe a mais proxima. O meio do intervalo e melhor que a
 * borda: cortar exatamente no fim da palavra ainda soa apertado.
 */
export function cutCandidatesFrom(words: readonly { start: number; end: number }[],
  segments: readonly { start: number; end: number }[]): number[] {
  const candidates: number[] = []

  for (let i = 1; i < words.length; i++) {
    const gap = words[i]!.start - words[i - 1]!.end
    if (gap > 0.08) candidates.push((words[i - 1]!.end + words[i]!.start) / 2)
  }

  for (const segment of segments) {
    candidates.push(segment.start)
    candidates.push(segment.end)
  }

  return [...new Set(candidates.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b)
}

// ------------------------------------------------------------------- render

/**
 * Converte o plano (em segundos) no que a composicao Remotion consome (em
 * frames). Esta e a unica traducao segundo->frame do app; fazer isso em dois
 * lugares e como o audio e a imagem saem de sincronia.
 */
export function toRenderProps(plan: ScenePlan, images: readonly ImageAsset[]): RenderProps {
  const usable = plan.scenes.filter((scene) => images[scene.imageIndex])
  if (usable.length === 0) return { scenes: [] }

  const durationSec = usable.at(-1)!.end

  /**
   * Fronteiras em frames, calculadas a partir dos inicios absolutos em vez de
   * somar duracoes uma a uma -- somar acumula erro de arredondamento e o video
   * termina alguns frames fora do audio.
   */
  const bounds = [
    ...usable.map((scene) => Math.round(scene.start * VIDEO_FPS)),
    Math.round(durationSec * VIDEO_FPS),
  ]

  const transitionFrames = usable.map((scene, index) =>
    index === 0 ? 0 : TRANSITION_FRAMES[scene.transitionIn],
  )

  /**
   * Compensacao da sobreposicao.
   *
   * O TransitionSeries encurta o total: uma transicao de T frames faz as duas
   * cenas se sobreporem por T, entao o video sairia T mais curto por transicao
   * e perderia o sincronismo com a narracao.
   *
   * A correcao e devolver esses T frames distribuidos entre as duas cenas
   * vizinhas -- metade para cada. Isso mantem o total exato E coloca o meio da
   * transicao exatamente no instante planejado do corte, que e onde o olho
   * espera que a troca aconteca.
   */
  const scenes = usable.map((scene, index) => {
    const image = images[scene.imageIndex]!
    const base = bounds[index + 1]! - bounds[index]!

    const incoming = transitionFrames[index] ?? 0
    const outgoing = transitionFrames[index + 1] ?? 0

    // floor na entrada e ceil na saida: as duas metades somam T exato, sem
    // sobrar nem faltar frame.
    const padding = Math.floor(incoming / 2) + Math.ceil(outgoing / 2)

    return {
      url: image.url,
      durationInFrames: Math.max(base + padding, 1),
      effect: scene.effect,
      intensity: scene.intensity,
      transitionIn: scene.transitionIn,
      transitionInFrames: incoming,
    }
  })

  return { scenes }
}

/** Total de frames da composicao, a partir da duracao do audio. */
export function totalFrames(durationSec: number): number {
  return Math.max(Math.ceil(durationSec * VIDEO_FPS), 1)
}

/** Plano de melhor esforco sem IA. Usado pelo fallback e pelo preview inicial. */
export function planWithoutAI(
  imageCount: number,
  durationSec: number,
  transcript: Transcript | null,
): { plan: ScenePlan; origin: 'silence' | 'equal' } {
  if (transcript && transcript.cutCandidates.length >= imageCount - 1) {
    return {
      plan: planFromCandidates(imageCount, durationSec, transcript.cutCandidates),
      origin: 'silence',
    }
  }
  return { plan: planEqualSplit(imageCount, durationSec), origin: 'equal' }
}
