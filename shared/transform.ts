import { POSICAO_LIVRE, type MotionCurve } from './contract'

/** A curva desenhada: o cubic-bezier [x1, y1, x2, y2] (o Y pode passar de 0..1). */
export type CurvaLivre = [number, number, number, number]

/**
 * O TRANSFORM ANIMADO de um clipe da faixa de video -- e da camada de ajuste.
 *
 * "Coloca uma opcao de transform na adjustment layer, pra eu poder animar o que
 * eu quiser." Sem quadros-chave, valem os valores fixos do clipe (x, y, escala,
 * rotacao), como sempre. Com um ou mais, eles mandam: antes do primeiro vale o
 * primeiro, depois do ultimo vale o ultimo, e entre dois a passagem segue a
 * curva escolhida.
 *
 * O tempo de cada chave e em segundos A PARTIR DO INICIO DO CLIPE: arrastar o
 * clipe na faixa leva a animacao junto.
 */
export interface Transform2D {
  x: number
  y: number
  escala: number
  rotacao: number
}

export interface ChaveDeTransform extends Transform2D {
  t: number
  /** A curva da passagem desta chave para a proxima. Sem: a do clipe. */
  curva?: CurvaLivre | undefined
}

/** Os quatro ritmos, os mesmos cubicos do Remotion (Easing.cubic). */
export function curvaNoTempo(curva: MotionCurve, p: number): number {
  const t = Math.min(Math.max(p, 0), 1)
  switch (curva) {
    case 'linear':
      return t
    case 'ease-in':
      return t * t * t
    case 'ease-out':
      return 1 - (1 - t) ** 3
    case 'ease-in-out':
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
  }
}

/**
 * O cubic-bezier do CSS no progresso p (0..1): acha o parametro em que o X da
 * curva vale p (Newton, com bisseccao de reserva) e devolve o Y dali. O Y pode
 * passar de 0..1 -- e o "passa do ponto e volta".
 */
export function bezierNoTempo(c: CurvaLivre, p: number): number {
  const t = Math.min(Math.max(p, 0), 1)
  const [x1, y1, x2, y2] = c
  const ax = 1 + 3 * x1 - 3 * x2
  const bx = 3 * x2 - 6 * x1
  const cx = 3 * x1
  const ay = 1 + 3 * y1 - 3 * y2
  const by = 3 * y2 - 6 * y1
  const cy = 3 * y1
  const xDe = (s: number): number => ((ax * s + bx) * s + cx) * s
  let s = t
  for (let i = 0; i < 8; i++) {
    const erro = xDe(s) - t
    if (Math.abs(erro) < 1e-6) return ((ay * s + by) * s + cy) * s
    const d = (3 * ax * s + 2 * bx) * s + cx
    if (Math.abs(d) < 1e-6) break
    s -= erro / d
  }
  let lo = 0
  let hi = 1
  s = t
  for (let i = 0; i < 40; i++) {
    const x = xDe(s)
    if (Math.abs(x - t) < 1e-6) break
    if (x < t) lo = s
    else hi = s
    s = (lo + hi) / 2
  }
  return ((ay * s + by) * s + cy) * s
}

const so = (c: Transform2D): Transform2D => ({ x: c.x, y: c.y, escala: c.escala, rotacao: c.rotacao })

export function ordenadas(chaves: readonly ChaveDeTransform[]): ChaveDeTransform[] {
  return [...chaves].sort((a, b) => a.t - b.t)
}

/** O transform no instante `t` (segundos desde o inicio do clipe). */
export function transformNoTempo(
  base: Transform2D,
  chaves: readonly ChaveDeTransform[] | null | undefined,
  t: number,
  curva: MotionCurve,
  /** A curva desenhada do clipe: ganha do ritmo pronto. A da chave ganha das duas. */
  pontos?: CurvaLivre | null,
): Transform2D {
  if (!chaves || chaves.length === 0) return so(base)
  const cs = ordenadas(chaves)
  const primeira = cs[0]!
  const ultima = cs[cs.length - 1]!
  if (t <= primeira.t) return so(primeira)
  if (t >= ultima.t) return so(ultima)
  let i = 0
  while (i < cs.length - 2 && cs[i + 1]!.t <= t) i++
  const a = cs[i]!
  const b = cs[i + 1]!
  const p = (t - a.t) / Math.max(b.t - a.t, 1e-6)
  const desenho = a.curva ?? pontos
  const e = desenho ? bezierNoTempo(desenho, p) : curvaNoTempo(curva, p)
  const lerp = (u: number, v: number): number => u + (v - u) * e
  return {
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    // O zoom anda em proporcao: de 1x a 2x passa por 1,41x no meio, e nao
    // por 1,5x -- o olho le a mudanca de tamanho como constante.
    escala: Math.exp(lerp(Math.log(a.escala), Math.log(b.escala))),
    rotacao: lerp(a.rotacao, b.rotacao),
  }
}

/** O indice da chave que cai em `t` (dentro de `tolerancia`), ou -1. */
export function chaveEm(chaves: readonly ChaveDeTransform[] | null | undefined, t: number, tolerancia: number): number {
  if (!chaves) return -1
  let melhor = -1
  for (const [i, c] of chaves.entries()) {
    if (Math.abs(c.t - t) <= tolerancia && (melhor < 0 || Math.abs(c.t - t) < Math.abs(chaves[melhor]!.t - t))) melhor = i
  }
  return melhor
}

/** Grava `valores` numa chave em `t`: substitui a que ja esta ali, ou cria. */
export function gravarChave(
  chaves: readonly ChaveDeTransform[],
  t: number,
  valores: Partial<Transform2D>,
  base: Transform2D,
  tolerancia: number,
): ChaveDeTransform[] {
  const i = chaveEm(chaves, t, tolerancia)
  if (i >= 0) return ordenadas(chaves.map((c, j) => (j === i ? { ...c, ...valores } : c)))
  return ordenadas([...chaves, { ...base, ...valores, t: Math.max(0, t) }])
}

/**
 * TROCAR O PONTO DE GIRO sem mexer no que se ve.
 *
 * O CSS faz p' = pivo + T + A(p - pivo), com A = giro x escala x espelho.
 * Mudar o pivo de `de` para `para` mantendo a imagem no lugar pede
 * T' = T + (A - I)(para - de). As posicoes vem em % do quadro (W x H), como o
 * translate do Remotion; o pivo em fracao (0..1) do quadro.
 */
export function compensarPivo(
  v: Transform2D,
  de: { x: number; y: number },
  para: { x: number; y: number },
  W: number,
  H: number,
  espelhar: boolean,
): { x: number; y: number } {
  const dx = (para.x - de.x) * W
  const dy = (para.y - de.y) * H
  const r = (v.rotacao * Math.PI) / 180
  const mx = (espelhar ? -dx : dx) * v.escala
  const my = dy * v.escala
  const ax = mx * Math.cos(r) - my * Math.sin(r)
  const ay = mx * Math.sin(r) + my * Math.cos(r)
  const limita = (n: number): number => Math.round(Math.min(Math.max(n, -POSICAO_LIVRE), POSICAO_LIVRE) * 10) / 10
  return { x: limita(v.x + ((ax - dx) / W) * 100), y: limita(v.y + ((ay - dy) / H) * 100) }
}

/**
 * O clipe comecou `delta` segundos depois (a borda esquerda foi puxada): as
 * chaves andam junto para continuar no MESMO ponto da linha do tempo. O que
 * ficou antes do novo comeco vira uma chave so, no zero, com o valor dali.
 */
export function deslocarChaves(
  chaves: readonly ChaveDeTransform[],
  delta: number,
  curva: MotionCurve,
  pontos?: CurvaLivre | null,
): ChaveDeTransform[] {
  const movidas = ordenadas(chaves.map((c) => ({ ...c, t: c.t - delta })))
  if (movidas.length === 0 || movidas[0]!.t >= 0) return movidas
  const noZero = transformNoTempo(movidas[0]!, movidas, 0, curva, pontos)
  // A chave que fica no zero leva a curva da passagem em que ele caiu.
  const antes = [...movidas].reverse().find((c) => c.t <= 0)
  return [{ ...noZero, t: 0, ...(antes?.curva ? { curva: antes.curva } : {}) }, ...movidas.filter((c) => c.t > 0)]
}
