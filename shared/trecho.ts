import type { Word } from './contract'

/**
 * Como o tempo de um trecho se reparte entre as cenas dele.
 *
 * Mora aqui, e nao no componente nem no store, porque a mesma conta precisa
 * rodar em DOIS lugares: a pintura das palavras na coluna do roteiro e a
 * montagem do plano. Enquanto eram duas contas parecidas elas divergiram --
 * a pintura dividia em partes iguais enquanto o video ja respeitava o peso, e
 * a cor mostrava uma coisa enquanto o mp4 fazia outra.
 */

/**
 * Uma posicao do trecho que ocupa tempo.
 *
 * Duas cenas UNIDAS (tela dividida) sao um slot so: elas tocam ao mesmo tempo,
 * entao o par nao ganha tempo extra nem peso proprio.
 */
export interface Slot {
  /** Um caminho em tela cheia, dois quando ele uniu as cenas. */
  paths: string[]
  peso: number
}

export interface Span {
  start: number
  end: number
}

/** Junta as cenas marcadas em slots, respeitando as unioes. */
export function slotsDoTrecho(
  cenas: readonly string[],
  pesos: readonly number[] | undefined,
  unidas: readonly number[] | undefined,
): Slot[] {
  const uniao = new Set(unidas ?? [])
  const slots: Slot[] = []
  for (let j = 0; j < cenas.length; j++) {
    const peso = pesos?.[j] ?? 1
    if (uniao.has(j) && j + 1 < cenas.length) {
      slots.push({ paths: [cenas[j]!, cenas[j + 1]!], peso })
      j += 1
    } else {
      slots.push({ paths: [cenas[j]!], peso })
    }
  }
  return slots
}

/** As palavras da narracao que caem dentro deste trecho. */
export function palavrasDoTrecho(
  palavras: readonly Word[],
  start: number,
  end: number,
): Word[] {
  return palavras.filter((w) => w.start >= start && w.start < end)
}

/**
 * Onde cada fronteira cai, em indice de PALAVRA, quando ninguem puxou nada.
 *
 * E a divisao proporcional de sempre -- peso sobre a soma dos pesos -- so que
 * arredondada para a palavra mais proxima. Serve de ponto de partida quando ele
 * puxa a primeira fronteira de um trecho: sem isso o primeiro arraste
 * reposicionaria TODAS as fronteiras de uma vez.
 */
export function cortesAutomaticos(
  slots: readonly Slot[],
  palavras: readonly Word[],
  start: number,
  end: number,
): number[] {
  const soma = slots.reduce((a, s) => a + s.peso, 0)
  const duracao = end - start
  const cortes: number[] = []
  let acumulado = 0
  for (let k = 0; k < slots.length - 1; k++) {
    acumulado += slots[k]!.peso
    const instante = start + (duracao * acumulado) / soma
    cortes.push(palavraNoInstante(palavras, instante))
  }
  return prender(cortes, slots.length, palavras.length)
}

/** A primeira palavra que comeca em `instante` ou depois dele. */
function palavraNoInstante(palavras: readonly Word[], instante: number): number {
  const i = palavras.findIndex((w) => w.start >= instante)
  return i < 0 ? palavras.length : i
}

/**
 * Poe os cortes em ordem e garante ao menos UMA palavra por slot.
 *
 * Sem isto, puxar uma fronteira por cima da vizinha produziria um bloco de
 * duracao zero -- que no video e um piscar de um frame, e no plano vira uma
 * cena que comeca depois de terminar.
 */
export function prender(cortes: readonly number[], slots: number, total: number): number[] {
  const presos: number[] = []
  for (let k = 0; k < slots - 1; k++) {
    const minimo = k + 1
    // Reserva uma palavra para cada slot que ainda vem depois deste corte.
    const maximo = total - (slots - 1 - k)
    const anterior = k === 0 ? 0 : presos[k - 1]!
    const valor = cortes[k] ?? minimo
    presos.push(Math.min(Math.max(valor, anterior + 1, minimo), Math.max(maximo, minimo)))
  }
  return presos
}

/**
 * Ate onde UMA fronteira pode ir sem empurrar as vizinhas.
 *
 * Puxar a fronteira 1 para a direita nao pode arrastar a 2 junto: ele pediu
 * "uma palavra antes" de UMA cena, e um ajuste de uma palavra que reorganiza o
 * trecho inteiro e o oposto disso. Entao a fronteira PARA uma palavra antes da
 * seguinte, em vez de empurra-la.
 */
export function limitesDaFronteira(
  cortes: readonly number[],
  fronteira: number,
  slots: number,
  total: number,
): { min: number; max: number } {
  const anterior = fronteira === 0 ? 0 : (cortes[fronteira - 1] ?? fronteira)
  const seguinte =
    fronteira === slots - 2 ? total : (cortes[fronteira + 1] ?? total - (slots - 2 - fronteira))
  return { min: anterior + 1, max: Math.max(seguinte - 1, anterior + 1) }
}

/**
 * Quantos slots cabem num trecho, dado que cada um precisa de uma palavra.
 *
 * Trecho de cinco palavras com seis cenas nao tem como ser cortado por palavra.
 * Nesse caso a divisao continua sendo a proporcional, que nao tem esse piso.
 */
export function cabeCortePorPalavra(slots: number, palavras: number): boolean {
  return palavras >= slots && slots > 1
}

/**
 * O tempo de cada slot dentro do trecho.
 *
 * Com `cortes`, cada fronteira cai no COMECO de uma palavra -- que e o instante
 * que o espectador ouve junto com o corte. Sem `cortes` (ou sem transcricao),
 * vale a divisao proporcional ao peso, que e o que o app sempre fez.
 */
export function spansDoTrecho(
  start: number,
  end: number,
  slots: readonly Slot[],
  palavras: readonly Word[],
  cortes: readonly number[] | null,
): Span[] {
  if (slots.length === 0) return []

  if (cortes && cabeCortePorPalavra(slots.length, palavras.length)) {
    const presos = prender(cortes, slots.length, palavras.length)
    const spans: Span[] = []
    let cursor = start
    for (let k = 0; k < slots.length; k++) {
      const fim = k === slots.length - 1 ? end : (palavras[presos[k]!]?.start ?? end)
      spans.push({ start: cursor, end: Math.max(fim, cursor) })
      cursor = Math.max(fim, cursor)
    }
    return spans
  }

  const soma = slots.reduce((a, s) => a + s.peso, 0)
  const duracao = end - start
  const spans: Span[] = []
  let cursor = start
  for (const slot of slots) {
    const fatia = (duracao * slot.peso) / soma
    spans.push({ start: cursor, end: cursor + fatia })
    cursor += fatia
  }
  return spans
}

/**
 * A qual slot cada palavra pertence.
 *
 * Pelo COMECO da palavra, e nao pelo meio: e o comeco que o espectador ouve
 * junto com o corte, e uma palavra que atravessa a fronteira aparece pintada na
 * cena em que ela entrou -- que e onde ela vai ser vista.
 */
export function palavrasPorSlot(palavras: readonly Word[], spans: readonly Span[]): number[] {
  return palavras.map((palavra) => {
    const i = spans.findIndex((s) => palavra.start < s.end)
    return i < 0 ? spans.length - 1 : i
  })
}
