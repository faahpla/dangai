import type { AjusteDeCor, PontoDeCurvaDeCor } from './contract'

/**
 * A MATEMATICA DA CAMADA DE AJUSTE, sem nada de tela.
 *
 * Tudo que e TOM -- exposicao, brilho, contraste, realces, sombras, brancos,
 * pretos, temperatura, tint e as curvas -- vira uma tabela por canal (R, G e
 * B): o valor que entra vira o valor que sai. A tabela vai inteira para um
 * `feComponentTransfer` do SVG, que o Chrome aplica no quadro do preview e no
 * render igualmente. Uma tabela so, em vez de um filtro por controle: e o que
 * mantem o preview leve com tudo ligado.
 *
 * Saturacao, vibrance e nitidez nao cabem numa tabela (dependem dos tres
 * canais juntos, ou dos vizinhos do pixel) e viram primitivas proprias -- ver
 * src/remotion/Ajuste.tsx.
 */

/** Quantos pontos tem a tabela de cada canal. O SVG interpola entre eles. */
export const PONTOS_DA_TABELA = 96

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const paraLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const paraSrgb = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

/**
 * Interpolacao cubica MONOTONA (Fritsch-Carlson) pelos pontos da curva.
 *
 * Monotona porque e o que um editor de curvas promete: entre dois pontos a
 * linha nao faz barriga alem deles. Uma spline comum, com pontos perto um do
 * outro, passava do teto e invertia o tom -- o branco virava cinza.
 */
export function curvaInterpolada(pontos: readonly PontoDeCurvaDeCor[]): (x: number) => number {
  const ps = [...pontos].sort((a, b) => a.x - b.x).filter((p, i, a) => i === 0 || p.x - a[i - 1]!.x > 1e-4)
  if (ps.length < 2) return (x) => x
  const n = ps.length
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((ps[i + 1]!.y - ps[i]!.y) / (ps[i + 1]!.x - ps[i]!.x))
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
      const t = 3 / Math.sqrt(h)
      m[i] = t * a * d[i]!
      m[i + 1] = t * b * d[i]!
    }
  }
  return (x) => {
    if (x <= ps[0]!.x) return ps[0]!.y
    if (x >= ps[n - 1]!.x) return ps[n - 1]!.y
    let i = 0
    while (i < n - 2 && x > ps[i + 1]!.x) i++
    const p0 = ps[i]!
    const p1 = ps[i + 1]!
    const h = p1.x - p0.x
    const t = (x - p0.x) / h
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * p0.y +
      (t3 - 2 * t2 + t) * h * m[i]! +
      (-2 * t3 + 3 * t2) * p1.y +
      (t3 - t2) * h * m[i + 1]!
    )
  }
}

/** Uma curva que nao mexe: so os dois cantos, na diagonal. */
export function ehReta(pontos: readonly PontoDeCurvaDeCor[]): boolean {
  return pontos.every((p) => Math.abs(p.x - p.y) < 1e-3)
}

/**
 * O tom de um canal, de 0 a 1 para 0 a 1, com tudo o que nao depende dos
 * outros canais. `ganho` e o balanco de branco daquele canal (temperatura e
 * tint), aplicado em luz linear junto com a exposicao.
 */
function tom(a: AjusteDeCor, ganho: number, x: number): number {
  // Exposicao e balanco de branco em LUZ LINEAR: um stop dobra a luz, e nao o
  // numero do pixel -- e o que faz a exposicao clarear sem lavar as sombras.
  let v = paraSrgb(clamp01(paraLinear(x) * 2 ** a.exposicao * ganho))
  // Brilho mexe no meio sem tocar nas pontas: preto continua preto.
  v = v ** (2 ** -a.brilho)
  // Contraste: curva em S (ou o contrario) em volta do meio.
  const s = v * v * (3 - 2 * v)
  v = v + a.contraste * (s - v)
  // Sombras e realces: uma lombada em cada lado do meio-tom.
  const lombadaSombra = (v * (1 - v) ** 2) / 0.1481
  const lombadaRealce = (v * v * (1 - v)) / 0.1481
  v = v + 0.25 * (a.sombras * lombadaSombra + a.realces * lombadaRealce)
  // Brancos e pretos: as pontas.
  v = v + 0.25 * a.brancos * v ** 3 + 0.25 * a.pretos * (1 - v) ** 3
  return clamp01(v)
}

/** As tres tabelas (R, G, B), prontas para o `tableValues` do SVG. */
export function tabelasDoAjuste(a: AjusteDeCor): { r: number[]; g: number[]; b: number[] } {
  const mestre = curvaInterpolada(a.curvas.mestre)
  const porCanal = { r: curvaInterpolada(a.curvas.r), g: curvaInterpolada(a.curvas.g), b: curvaInterpolada(a.curvas.b) }
  // Temperatura: quente puxa o vermelho e tira o azul. Tint: positivo e magenta.
  const ganhos = {
    r: 1 + 0.22 * a.temperatura + 0.06 * a.tint,
    g: 1 - 0.14 * a.tint,
    b: 1 - 0.22 * a.temperatura + 0.06 * a.tint,
  }
  const fazer = (canal: 'r' | 'g' | 'b'): number[] =>
    Array.from({ length: PONTOS_DA_TABELA }, (_, i) => {
      const x = i / (PONTOS_DA_TABELA - 1)
      return clamp01(porCanal[canal](clamp01(mestre(tom(a, ganhos[canal], x)))))
    })
  return { r: fazer('r'), g: fazer('g'), b: fazer('b') }
}

/** O ajuste nao mexe em nada? Ai nem vale montar o filtro. */
export function ajusteNeutro(a: AjusteDeCor): boolean {
  const zeros: (keyof AjusteDeCor)[] = [
    'exposicao', 'brilho', 'contraste', 'realces', 'sombras', 'brancos', 'pretos',
    'temperatura', 'tint', 'saturacao', 'vibrance', 'nitidez',
  ]
  return (
    a.intensidade === 0 ||
    (zeros.every((k) => a[k] === 0) &&
      ehReta(a.curvas.mestre) &&
      ehReta(a.curvas.r) &&
      ehReta(a.curvas.g) &&
      ehReta(a.curvas.b))
  )
}
