/**
 * ACERTAR OS TEMPOS DEPOIS QUE A NARRACAO MUDOU DE RITMO.
 *
 * O caso do ajk (11/11): editou o audio, deu "Pronto", depois voltou, acelerou
 * para 115% e deu "Pronto" de novo -- e a sincronia aproveitou as palavras da
 * narracao ANTERIOR (a 100%). As frases, e com elas as cenas, ficaram nos tempos
 * do audio velho: "as cenas estao corretas, mas esta tudo atrasado, o audio esta
 * la na frente". O atraso cresce ao longo do video, o sinal de ritmo diferente.
 *
 * O conserto nao relê o roteiro (perderia as juncoes de trechos que ele fez):
 * ouve a narracao de agora, casa PALAVRA COM PALAVRA a transcricao velha com a
 * nova (o roteiro e o mesmo) e leva cada tempo do jeito velho para o novo. Os
 * trechos, as cenas escolhidas, as juncoes e os cortes dentro de cada trecho (que
 * sao por palavra) continuam os mesmos -- so os instantes mudam.
 */

export interface PalavraComTempo {
  text: string
  start: number
  end: number
}

/** A palavra sem acento, caixa e pontuacao: "Noelle," e "noelle" sao a mesma. */
const normal = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')

/** Onde a fala termina (a ultima palavra). */
export function fimDaFala(palavras: readonly PalavraComTempo[]): number {
  return palavras.reduce((m, p) => Math.max(m, p.end), 0)
}

/**
 * Os tempos das palavras sao de OUTRA narracao? A fala nao cabe no audio: a
 * ultima palavra termina depois do fim dele (com meio segundo de folga).
 * Acelerar ou cortar deixa o audio mais curto que as palavras velhas.
 */
export function temposDeOutraNarracao(palavras: readonly PalavraComTempo[] | undefined, duracaoDoAudio: number): boolean {
  if (!palavras || palavras.length === 0 || duracaoDoAudio <= 0) return false
  return fimDaFala(palavras) > duracaoDoAudio + 0.5
}

/**
 * Os pares (tempo velho, tempo novo) das palavras que batem, na ordem. Mesma
 * quantidade e mesmo texto: palavra i com palavra i. Senao, a maior sequencia
 * em comum pelo texto (o roteiro e o mesmo; o Whisper pode ter juntado ou
 * partido uma palavra aqui e ali).
 */
export function ancorasDasPalavras(velhas: readonly PalavraComTempo[], novas: readonly PalavraComTempo[]): [number, number][] {
  const a = velhas.map((p) => normal(p.text))
  const b = novas.map((p) => normal(p.text))
  let pares: [number, number][]
  if (a.length === b.length && a.every((x, i) => x === b[i])) {
    pares = a.map((_, i): [number, number] => [i, i])
  } else {
    // A maior subsequencia em comum (programacao dinamica; ~300 palavras por video).
    const n = a.length
    const m = b.length
    const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[i]![j] = a[i] !== '' && a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!)
      }
    }
    pares = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[i] !== '' && a[i] === b[j]) {
        pares.push([i, j])
        i++
        j++
      } else if (t[i + 1]![j]! >= t[i]![j + 1]!) i++
      else j++
    }
  }
  const ancoras: [number, number][] = []
  for (const [i, j] of pares) {
    ancoras.push([velhas[i]!.start, novas[j]!.start])
    ancoras.push([velhas[i]!.end, novas[j]!.end])
  }
  return ancoras
}

/**
 * O MAPA DO TEMPO: de um instante da narracao velha para o mesmo ponto da fala
 * na nova. Reta entre as palavras casadas (dentro de uma palavra, ou numa
 * pausa, o tempo anda proporcional); antes da primeira e depois da ultima, na
 * mesma proporcao das pontas. Nunca volta: o que vinha antes continua antes. Pode
 * ficar PARADO (um pedaco que foi cortado da narracao nova cai todo num instante
 * so); esticar a reta por cima dele empurraria o resto para o lugar errado.
 */
export function mapaDeTempo(ancoras: readonly [number, number][], fimVelho: number, fimNovo: number): (t: number) => number {
  const pontos: [number, number][] = [[0, 0]]
  for (const [v, n] of [...ancoras].sort((p, q) => p[0] - q[0])) {
    const ultimo = pontos[pontos.length - 1]!
    if (v > ultimo[0] + 1e-6 && n >= ultimo[1] - 1e-9) pontos.push([v, n])
  }
  const ultimo = pontos[pontos.length - 1]!
  if (fimVelho > ultimo[0] + 1e-6 && fimNovo >= ultimo[1] - 1e-9) pontos.push([fimVelho, fimNovo])
  const proporcao = fimVelho > 0 ? fimNovo / fimVelho : 1
  return (t: number): number => {
    if (t <= 0) return 0
    for (let k = 1; k < pontos.length; k++) {
      const [v0, n0] = pontos[k - 1]!
      const [v1, n1] = pontos[k]!
      if (t <= v1) return n0 + ((t - v0) / (v1 - v0)) * (n1 - n0)
    }
    const [v, n] = pontos[pontos.length - 1]!
    return n + (t - v) * proporcao
  }
}

/** Um trecho (e os pedacos dele, se for uma juncao) nos tempos novos. */
export function trechoNosTemposNovos<T extends { start: number; end: number; partes?: { start: number; end: number }[] | undefined }>(
  trecho: T,
  mapa: (t: number) => number,
): T {
  return {
    ...trecho,
    start: mapa(trecho.start),
    end: mapa(trecho.end),
    ...(trecho.partes ? { partes: trecho.partes.map((p) => ({ ...p, start: mapa(p.start), end: mapa(p.end) })) } : {}),
  }
}

/**
 * A TRANSCRICAO levada para os tempos novos, sem ouvir de novo: as mesmas
 * palavras, na mesma ordem (os cortes dentro dos trechos sao posicoes de
 * palavra e continuam valendo), so que nos instantes da narracao nova.
 */
export function transcricaoNosTemposNovos<
  T extends {
    words: { start: number; end: number }[]
    segments: { start: number; end: number }[]
    cutCandidates: number[]
  },
>(transcricao: T, mapa: (t: number) => number): T {
  const par = <P extends { start: number; end: number }>(p: P): P => {
    const start = mapa(p.start)
    return { ...p, start, end: Math.max(start, mapa(p.end)) }
  }
  return {
    ...transcricao,
    words: transcricao.words.map(par),
    segments: transcricao.segments.map(par),
    cutCandidates: [...new Set(transcricao.cutCandidates.map((c) => Math.round(mapa(c) * 1000) / 1000))].sort((a, b) => a - b),
  }
}

/** As legendas que ele editou, em quadros, levadas para os tempos novos. */
export function legendasNosTemposNovos<B extends { from: number; durationInFrames: number; words: { from: number; durationInFrames: number }[] }>(
  blocos: readonly B[],
  mapa: (t: number) => number,
  fps: number,
): B[] {
  const q = (f: number): number => Math.max(0, Math.round(mapa(f / fps) * fps))
  const durar = (de: number, quadros: number): number => Math.max(1, q(de + quadros) - q(de))
  return blocos.map((b) => ({
    ...b,
    from: q(b.from),
    durationInFrames: durar(b.from, b.durationInFrames),
    words: b.words.map((w) => ({ ...w, from: q(w.from), durationInFrames: durar(w.from, w.durationInFrames) })),
  }))
}
