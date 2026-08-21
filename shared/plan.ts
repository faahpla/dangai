import { boundariesFrom, pickCuts } from './rhythm'
import {
  CAPTION_BREAK_AFTER,
  CAPTION_COLOR_DEFAULT,
  CAPTION_Y_DEFAULT,
  CAPTION_MAX_CHARS,
  CAPTION_MAX_WORDS,
  CAPTION_MIN_SEC,
  KEN_BURNS_EFFECTS,
  MOTION_CURVE_DEFAULT,
  TRANSITION_FRAMES,
  VIDEO_FPS,
  type CaptionBlock,
  type CaptionColor,
  type ImageAsset,
  type OverlayCard,
  type RenderProps,
  type Scene,
  type ScenePlan,
  type Transcript,
  type Word,
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

/**
 * Piso absoluto de um bloco.
 *
 * Baixo de proposito: o tamanho do bloco e livre, decidido pela conta
 * "duracao do audio / numero de imagens" e depois pelo arraste do usuario.
 * Este numero so existe para nenhum bloco virar um piscar.
 */
export const MIN_SCENE_SEC = 0.6
/** Mais longa que isso a atencao cai num short. Vale como dica para a IA. */
export const MAX_SCENE_SEC = 6
/** Quanto um corte pode andar para cair numa pausa natural. */
export const SNAP_TOLERANCE_SEC = 0.4

/*
 * UMA IMAGEM, UM BLOCO. Sem excecao.
 *
 * Houve uma versao que repartia sozinha as cenas longas em blocos de ~2s para
 * dar mais ritmo. Estava errado: quem importa 46 imagens espera 46 blocos, e
 * receber 63 significa nao reconhecer mais o proprio material na linha do
 * tempo. Ritmo se resolve importando mais imagens, nao multiplicando as que
 * existem -- e agora da para inserir imagem exatamente onde falta.
 */

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
    curve: MOTION_CURVE_DEFAULT,
    // Todo bloco novo parte do comeco do clipe; mover e escolha dele.
    sourceStart: 0,
    transitionIn: index === 0 ? ('cut' as const) : ('cut' as const),
  }))

  return { scenes }
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
    curve: MOTION_CURVE_DEFAULT,
    // Todo bloco novo parte do comeco do clipe; mover e escolha dele.
    sourceStart: 0,
    transitionIn: 'cut' as const,
  }))

  return sanitize({ scenes }, imageCount, durationSec)
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
  imageCount: number,
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

  // imageCount vem de fora e nao de scenes.length: os dois so coincidem
  // enquanto ha exatamente uma cena por imagem, e a reparticao em blocos
  // quebrou essa igualdade.
  return sanitize({ ...plan, scenes }, imageCount, durationSec)
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
          curve: MOTION_CURVE_DEFAULT,
          // Todo bloco novo parte do comeco do clipe; mover e escolha dele.
          sourceStart: 0,
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
export interface CardText {
  /** Texto do gancho. Vazio nao gera card. */
  hook: string
  hookSec: number
  /** Texto do fechamento. Vazio nao gera card. */
  end: string
  endSec: number
}

export function toRenderProps(
  plan: ScenePlan,
  images: readonly ImageAsset[],
  captions: readonly CaptionBlock[] = [],
  cardText: CardText | null = null,
  captionColor: CaptionColor = CAPTION_COLOR_DEFAULT,
  captionY: number = CAPTION_Y_DEFAULT,
  /**
   * Duracao da narracao, que e quem manda no tamanho do video.
   *
   * Existe porque o render monta a composicao com o tempo do AUDIO enquanto a
   * esteira de imagens era montada com o fim da ULTIMA CENA -- duas fontes de
   * verdade para o mesmo numero. Quando discordavam, o final do video ficava sem
   * imagem nenhuma e o card de fechamento disparava cedo, porque ele e colocado
   * contra o fim da esteira.
   *
   * Discordar e facil: basta o plano nao alcancar o fim da narracao, ou uma cena
   * ser descartada por apontar para imagem que nao existe mais -- e esse
   * descarte e silencioso. Medido: um plano de 9s com narracao de 12s deixava 72
   * frames, 3 segundos inteiros, sem nada.
   *
   * Ausente, cai no comportamento antigo: os testes de plano que nao conhecem o
   * audio continuam valendo.
   */
  durationSec?: number,
): RenderProps {
  const usable = plan.scenes.filter((scene) => images[scene.imageIndex])
  if (usable.length === 0) {
    return { scenes: [], captions: [], cards: [], captionColor, captionY }
  }

  // A ultima cena estica ate o fim da narracao. Congelar o ultimo quadro por
  // alguns segundos e ruim; tela preta com a pessoa ainda falando e pior.
  const fim = Math.max(durationSec ?? usable.at(-1)!.end, usable.at(-1)!.end)

  /**
   * Fronteiras em frames, calculadas a partir dos inicios absolutos em vez de
   * somar duracoes uma a uma -- somar acumula erro de arredondamento e o video
   * termina alguns frames fora do audio.
   */
  const bounds = [
    ...usable.map((scene) => Math.round(scene.start * VIDEO_FPS)),
    totalFrames(fim),
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

    const durationInFrames = Math.max(base + padding, 1)

    /*
     * So informa a duracao do clipe quando ela e MENOR que o bloco.
     *
     * Clipe que cobre o bloco inteiro nao precisa de congelamento nenhum -- e o
     * caso normal, ja que ele chega cortado. Mandar null ali deixa o Scene com
     * um caminho a menos para errar.
     */
    /*
     * De onde o clipe parte, e quanto dele ainda resta a partir dali.
     *
     * O deslocamento entra ANTES da conta do congelamento: um clipe de 6s
     * comecando no segundo 5 tem 1 segundo de sobra, nao 6. Sem descontar,
     * um bloco de 2s acharia que esta coberto e o video ficaria preto no fim.
     *
     * Fica preso ao que existe: pedir para comecar depois do fim do clipe
     * deixaria a tela preta, entao o valor cai para "o ultimo instante em que
     * ainda ha imagem".
     */
    const totalFonte =
      image.kind === 'video' && image.durationSec !== undefined
        ? Math.floor(image.durationSec * VIDEO_FPS)
        : null

    const inicioFonte =
      totalFonte === null
        ? 0
        : clamp(Math.round((scene.sourceStart ?? 0) * VIDEO_FPS), 0, Math.max(totalFonte - 1, 0))

    const sourceFrames = totalFonte === null ? null : totalFonte - inicioFonte

    return {
      url: image.url,
      durationInFrames,
      effect: scene.effect,
      intensity: scene.intensity,
      curve: scene.curve,
      kind: image.kind,
      sourceDurationInFrames:
        sourceFrames !== null && sourceFrames < durationInFrames ? Math.max(sourceFrames, 1) : null,
      sourceStartFrames: inicioFonte,
      transitionIn: scene.transitionIn,
      transitionInFrames: incoming,
    }
  })

  return {
    scenes,
    captions: untieWordStarts(captions),
    cards: buildCards(cardText, bounds.at(-1)!),
    captionColor,
    captionY,
  }
}

/**
 * Garante que, dentro de um bloco, duas palavras nunca comecem no mesmo frame.
 *
 * Isso acontece de verdade: no projeto real do Kintay, quatro blocos tinham
 * palavrinhas de ligacao ("e", "a", "o") empatadas -- as que o Whisper nao ouviu
 * e receberam tempo interpolado por tamanho de texto, que num frame de 42ms
 * arredonda para o mesmo lugar. O marcador so pode estar em uma palavra por
 * frame, entao a empatada nunca chegava a ser marcada.
 *
 * A correcao mora AQUI, e nao no buildCaptions, de proposito. Os projetos ja
 * salvos guardam os tempos como o Whisper mediu e nao sao reconstruidos ao
 * abrir; consertando na traducao para frames, eles se beneficiam sem que nada
 * no disco precise ser reescrito. O arquivo continua guardando a medida
 * honesta, e quem resolve o que a taxa de frames consegue mostrar e a exibicao.
 *
 * O empurrao respeita o fim do bloco: cada palavra deixa pelo menos um frame
 * para cada uma que vem depois dela.
 */
function untieWordStarts(blocks: readonly CaptionBlock[]): CaptionBlock[] {
  return blocks.map((block) => {
    const end = block.from + block.durationInFrames
    const total = block.words.length

    let anterior = -1
    let mudou = false

    const words = block.words.map((word, index) => {
      // Teto: as (total - 1 - index) palavras seguintes precisam de um frame
      // cada. Nunca abaixo do inicio do bloco -- com bloco curto demais para o
      // numero de palavras, e melhor empatar do que sair da janela.
      const teto = Math.max(end - (total - index), block.from)
      const from = Math.min(Math.max(word.from, anterior + 1), teto)
      anterior = from
      if (from !== word.from) mudou = true
      return from === word.from ? word : { ...word, from }
    })

    return mudou ? { ...block, words } : block
  })
}

/**
 * Gancho no comeco e fechamento no fim, em frames.
 *
 * O total do video nao entra na conta por acaso: os cards sao recortados dentro
 * dele. Um fechamento mais longo que o video inteiro vira o video inteiro, e
 * nao um video mais longo -- ver overlayCardSchema.
 */
function buildCards(texto: CardText | null, totalFrames: number): OverlayCard[] {
  if (!texto || totalFrames <= 0) return []

  const cards: OverlayCard[] = []

  const hook = texto.hook.trim()
  if (hook.length > 0) {
    cards.push({
      text: hook,
      from: 0,
      durationInFrames: Math.max(
        Math.min(Math.round(texto.hookSec * VIDEO_FPS), totalFrames),
        1,
      ),
      // No alto: embaixo mora a legenda, e os dois juntos se atropelariam
      // justamente nos segundos que decidem se a pessoa continua vendo.
      position: 'top',
    })
  }

  const end = texto.end.trim()
  if (end.length > 0) {
    const duracao = Math.max(Math.min(Math.round(texto.endSec * VIDEO_FPS), totalFrames), 1)
    cards.push({
      text: end,
      from: Math.max(totalFrames - duracao, 0),
      durationInFrames: duracao,
      position: 'center',
    })
  }

  return cards
}

/**
 * Agrupa as palavras da transcricao em blocos de legenda.
 *
 * Cada bloco e uma linha: no maximo duas palavras e doze caracteres. Uma
 * palavra que sozinha ja estoura os doze caracteres fica sozinha -- quebrar
 * palavra no meio seria pior que a linha comprida.
 *
 * Um bloco tambem quebra quando ha uma pausa grande entre palavras: ler uma
 * legenda que atravessa um silencio longo desconecta o texto da fala.
 */
export function buildCaptions(transcript: Transcript | null): CaptionBlock[] {
  if (!transcript || transcript.words.length === 0) return []

  const blocks: CaptionBlock[] = []
  let current: Word[] = []

  const flush = (): void => {
    if (current.length === 0) return

    const first = current[0]!
    const last = current.at(-1)!
    const from = Math.round(first.start * VIDEO_FPS)
    const to = Math.round(last.end * VIDEO_FPS)

    blocks.push({
      from,
      durationInFrames: Math.max(to - from, 1),
      words: current.map((word) => {
        const wordFrom = Math.round(word.start * VIDEO_FPS)
        const wordTo = Math.round(word.end * VIDEO_FPS)
        return {
          text: word.text,
          from: wordFrom,
          durationInFrames: Math.max(wordTo - wordFrom, 1),
        }
      }),
    })
    current = []
  }

  for (const word of transcript.words) {
    const previous = current.at(-1)
    const gap = previous ? word.start - previous.end : 0

    // Comprimento da linha se esta palavra entrar, contando o espaco.
    const chars = current.reduce((sum, w) => sum + w.text.length + 1, 0) + word.text.length

    const cheio = current.length >= CAPTION_MAX_WORDS
    // As duas checagens exigem a linha ja ocupada: com a linha vazia, quebrar
    // aqui deixaria um bloco sem palavra nenhuma e jogaria a palavra longa para
    // a proxima volta, onde o problema se repetiria para sempre.
    const largo = current.length > 0 && chars > CAPTION_MAX_CHARS
    const pausou = current.length > 0 && gap > 0.45
    // Pontuacao fecha a linha: a palavra seguinte comeca outra ideia e nao pode
    // dividir legenda com o fim da anterior.
    const pontuou = previous !== undefined && endsSentence(previous.text)

    if (cheio || largo || pausou || pontuou) flush()
    current.push(word)
  }
  flush()

  enforceMinimumDuration(blocks)
  return blocks
}

/**
 * A palavra termina fechando uma ideia?
 *
 * Ignora aspas e parenteses no fim para enxergar a pontuacao de verdade: em
 * `disse."` quem fecha a frase e o ponto, nao a aspa.
 */
function endsSentence(text: string): boolean {
  const bare = text.replace(/["'”’)\]}»]+$/u, '')
  const last = bare.at(-1)
  return last !== undefined && CAPTION_BREAK_AFTER.includes(last)
}

/**
 * Estica os blocos curtos demais para o piso de leitura.
 *
 * Primeiro ocupa o silencio vizinho, que nao custa nada a ninguem: entre um
 * bloco e outro quase sempre sobra tempo de tela vazia. So se ainda faltar e
 * que toma emprestado de um vizinho que tenha folga acima do proprio piso.
 *
 * Os tempos das PALAVRAS nao mudam -- o realce continua caindo exatamente na
 * hora em que cada uma e dita. O que estica e so a janela de exibicao do bloco.
 */
function enforceMinimumDuration(blocks: CaptionBlock[]): void {
  const minimum = Math.round(CAPTION_MIN_SEC * VIDEO_FPS)

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    let deficit = minimum - block.durationInFrames
    if (deficit <= 0) continue

    // Silencio depois: o limite e o inicio do proximo bloco.
    const next = blocks[i + 1]
    const roomAfter = next ? next.from - (block.from + block.durationInFrames) : deficit
    const takeAfter = Math.min(deficit, Math.max(roomAfter, 0))
    block.durationInFrames += takeAfter
    deficit -= takeAfter
    if (deficit <= 0) continue

    // Silencio antes: o limite e o fim do bloco anterior, ou o comeco do video.
    const previous = blocks[i - 1]
    const floor = previous ? previous.from + previous.durationInFrames : 0
    const takeBefore = Math.min(deficit, Math.max(block.from - floor, 0))
    block.from -= takeBefore
    block.durationInFrames += takeBefore
    deficit -= takeBefore
    if (deficit <= 0) continue

    // Sem silencio sobrando: pede emprestado ao vizinho que tiver folga acima
    // do proprio piso. Encurtar um bloco confortavel e melhor que deixar outro
    // piscando.
    if (next) {
      const borrowed = Math.min(deficit, Math.max(next.durationInFrames - minimum, 0))
      next.from += borrowed
      next.durationInFrames -= borrowed
      block.durationInFrames += borrowed
      deficit -= borrowed
    }
    if (deficit > 0 && previous) {
      const borrowed = Math.min(deficit, Math.max(previous.durationInFrames - minimum, 0))
      previous.durationInFrames -= borrowed
      block.from -= borrowed
      block.durationInFrames += borrowed
    }
  }

  for (const block of blocks) clampWordsToBlock(block)
}

/**
 * Prende as palavras a janela do proprio bloco.
 *
 * Emprestar tempo mexe nas bordas do bloco, e uma palavra pode acabar do lado
 * de fora: dita antes de a legenda aparecer, ou depois de ela sair. O realce
 * rosa compara frames absolutos, entao essa palavra simplesmente nunca ficaria
 * rosa -- a legenda apareceria inteira em branco enquanto e falada.
 *
 * Grampeando, a palavra que comecou cedo demais ja entra realcada e a que
 * terminaria tarde demais fica realcada ate o bloco sair.
 */
function clampWordsToBlock(block: CaptionBlock): void {
  const end = block.from + block.durationInFrames

  block.words = block.words.map((word) => {
    const from = Math.min(Math.max(word.from, block.from), end - 1)
    const to = Math.min(Math.max(word.from + word.durationInFrames, from + 1), end)
    return { ...word, from, durationInFrames: to - from }
  })
}

/**
 * Onde tocam os SFX e qual arquivo toca em cada ponto.
 *
 * Uma transicao sim, outra nao: som em todo corte vira ruido de fundo e o
 * ouvido para de registrar. Alternando, cada whoosh volta a marcar alguma
 * coisa.
 *
 * Os arquivos entram em rodizio pela pasta, na ordem em que ela lista. Repetir
 * o mesmo som a cada troca soa mecanico depois do terceiro.
 */
export function sfxCuesFor(
  scenes: readonly Scene[],
  files: readonly string[],
): { at: number; sound: string }[] {
  if (files.length === 0 || scenes.length < 2) return []

  const cues: { at: number; sound: string }[] = []

  // Comeca no primeiro corte e pula de dois em dois.
  for (let index = 1; index < scenes.length; index += 2) {
    const sound = files[cues.length % files.length]
    if (sound === undefined) break
    cues.push({ at: scenes[index]!.start, sound })
  }

  return cues
}

/** Total de frames da composicao, a partir da duracao do audio. */
export function totalFrames(durationSec: number): number {
  return Math.max(Math.ceil(durationSec * VIDEO_FPS), 1)
}

/**
 * Monta o plano a partir dos cortes escolhidos pela pontuacao da narracao.
 *
 * Ver shared/rhythm.ts: um ponto final e o fim de uma ideia, e e ali que o olho
 * aceita ver outra imagem.
 */
export function planByRhythm(
  imageCount: number,
  durationSec: number,
  words: readonly Word[],
): ScenePlan | null {
  if (imageCount < 2 || words.length < 2) return null

  const cortes = pickCuts(boundariesFrom(words), imageCount - 1, durationSec)
  if (!cortes) return null

  const bounds = [0, ...cortes, durationSec]
  const scenes: Scene[] = Array.from({ length: imageCount }, (_, index) => ({
    imageIndex: index,
    start: bounds[index]!,
    end: bounds[index + 1]!,
    effect: pickEffect(index),
    intensity: 0.12,
    curve: MOTION_CURVE_DEFAULT,
    // Todo bloco novo parte do comeco do clipe; mover e escolha dele.
    sourceStart: 0,
    transitionIn: 'cut' as const,
  }))

  return sanitize({ scenes }, imageCount, durationSec)
}

/**
 * Onde cada parte do roteiro termina, em segundos.
 *
 * A parte vem da LINHA EM BRANCO do roteiro colado, que o alinhamento ja marca
 * palavra por palavra (`paragraph`). Nao e um conceito novo: o ritmo ja dava
 * peso extra a esse ponto para escolher cortes. Aqui ele deixa de ser uma dica
 * e passa a ser uma fronteira dura.
 *
 * A ultima parte nao entra -- ela termina junto com o audio, e quem chama sabe
 * disso. Palavra sem tempo medido (NaN) e ignorada: ela existe quando o Whisper
 * nao ouviu aquele trecho, e usar um NaN como fronteira quebraria o plano todo.
 */
export function paragraphEnds(words: readonly Word[]): number[] {
  const ends: number[] = []
  for (let i = 0; i < words.length - 1; i++) {
    const word = words[i]!
    if (!word.paragraph) continue
    if (!Number.isFinite(word.end)) continue
    ends.push(word.end)
  }
  return ends
}

/**
 * Um plano em que cada parte do roteiro so recebe o material da sua pasta.
 *
 * A diferenca para o planByRhythm nao esta no algoritmo -- e o mesmo -- e sim no
 * escopo: em vez de escolher n-1 cortes ao longo do audio inteiro, escolhe os
 * cortes DENTRO de cada parte, e as fronteiras entre partes ficam fixas.
 *
 * O caso de hoje (arquivo solto, sem pasta) e o caso particular de "uma parte
 * so" -- por isso nao existe motor novo aqui para dar problema diferente.
 *
 * Devolve null quando a conta nao fecha: numero de partes diferente do numero
 * de pastas, parte sem material, ou audio curto demais para os blocos pedidos.
 * Quem chama avisa o usuario; nada aqui chuta.
 */
export function planBySections(
  sectionCounts: readonly number[],
  durationSec: number,
  words: readonly Word[],
): ScenePlan | null {
  if (sectionCounts.length === 0) return null
  if (sectionCounts.some((count) => count < 1)) return null

  const ends = paragraphEnds(words)
  if (ends.length + 1 !== sectionCounts.length) return null

  const bounds = [0, ...ends, durationSec]
  // Fronteira fora de ordem significa roteiro desalinhado do audio; melhor cair
  // fora e deixar o caminho antigo assumir do que montar um plano torto.
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i]! <= bounds[i - 1]!) return null
  }

  const scenes: Scene[] = []
  for (let s = 0; s < sectionCounts.length; s++) {
    const inicio = bounds[s]!
    const fim = bounds[s + 1]!
    const duracao = fim - inicio
    const quantos = sectionCounts[s]!

    if (duracao < MIN_SCENE_SEC * quantos) return null

    // Cortes internos da parte, medidos a partir do zero dela e devolvidos ao
    // tempo absoluto no fim -- o pickCuts raciocina sempre em 0..duracao.
    const locais = words
      .filter((w) => Number.isFinite(w.start) && w.start >= inicio && w.end <= fim)
      .map((w) => ({ ...w, start: w.start - inicio, end: w.end - inicio }))

    const cortes =
      quantos === 1 ? [] : pickCuts(boundariesFrom(locais), quantos - 1, duracao)
    if (!cortes) return null

    const dentro = [0, ...cortes, duracao]
    for (let i = 0; i < quantos; i++) {
      const index = scenes.length
      scenes.push({
        imageIndex: index,
        start: inicio + dentro[i]!,
        end: inicio + dentro[i + 1]!,
        effect: pickEffect(index),
        intensity: 0.12,
        curve: MOTION_CURVE_DEFAULT,
        // Todo bloco novo parte do comeco do clipe; mover e escolha dele.
        sourceStart: 0,
        transitionIn: 'cut' as const,
      })
    }
  }

  return sanitize({ scenes }, scenes.length, durationSec)
}

/** Plano de melhor esforco sem IA. Usado pelo fallback e pelo preview inicial. */
export function planWithoutAI(
  imageCount: number,
  durationSec: number,
  transcript: Transcript | null,
): { plan: ScenePlan; origin: 'rhythm' | 'silence' | 'equal' } {
  // Com texto cronometrado, a pontuacao manda: ela sabe onde uma ideia acaba,
  // coisa que o silencio de uma narracao corrida nunca vai dizer.
  if (transcript && transcript.words.length >= 2) {
    const porRitmo = planByRhythm(imageCount, durationSec, transcript.words)
    if (porRitmo) return { plan: porRitmo, origin: 'rhythm' }
  }

  if (transcript && transcript.cutCandidates.length >= imageCount - 1) {
    return {
      plan: planFromCandidates(imageCount, durationSec, transcript.cutCandidates),
      origin: 'silence',
    }
  }
  return { plan: planEqualSplit(imageCount, durationSec), origin: 'equal' }
}
