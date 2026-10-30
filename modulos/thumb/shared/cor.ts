import { z } from 'zod'

/**
 * [thumb] AS CORES DA THUMB (o texto e os divisores usam as mesmas): as
 * prontas, o degrade vertical de cada uma e as contas de cor. Puro. Fora de
 * thumb.ts para os divisores (divisores.ts) usarem sem importar a thumb
 * inteira; thumb.ts reexporta tudo.
 */

/** Um ponto do degrade: 0 = topo da letra, 1 = base. */
export interface ParadaDoDegrade {
  em: number
  cor: string
}

/**
 * As cores prontas. Branco e roxo com os degrades EXATOS do PSD dele (de
 * baixo para cima: 231 -> 243 em 19% -> 255; 125,0,229 -> 166,84,242 em 70%
 * -> 207,168,255); o amarelo segue a mesma ideia (base mais quente, topo mais
 * claro). As outras saem da conta (degradeDaCor).
 */
export const CORES_DA_THUMB: readonly {
  id: string
  nome: string
  cor: string
  degrade?: readonly ParadaDoDegrade[]
}[] = [
  {
    id: 'branco',
    nome: 'Branco',
    cor: '#ffffff',
    degrade: [
      { em: 0, cor: '#ffffff' },
      { em: 0.81, cor: '#f3f3f3' },
      { em: 1, cor: '#e7e7e7' },
    ],
  },
  {
    id: 'amarelo',
    nome: 'Amarelo',
    cor: '#fffd00',
    degrade: [
      { em: 0, cor: '#ffff8a' },
      { em: 0.35, cor: '#fffd00' },
      { em: 1, cor: '#ffd200' },
    ],
  },
  {
    id: 'roxo',
    nome: 'Roxo',
    cor: '#a654f2',
    degrade: [
      { em: 0, cor: '#cfa8ff' },
      { em: 0.3, cor: '#a654f2' },
      { em: 1, cor: '#7d00e5' },
    ],
  },
  { id: 'vermelho', nome: 'Vermelho', cor: '#ff2b2b' },
  { id: 'laranja', nome: 'Laranja', cor: '#ff8a00' },
  { id: 'verde', nome: 'Verde', cor: '#39f05a' },
  { id: 'azul', nome: 'Azul', cor: '#2fb4ff' },
  { id: 'rosa', nome: 'Rosa', cor: '#ff3d81' },
]
export const COR_LINHA_1 = '#ffffff'
export const COR_LINHA_2 = '#fffd00'

export const corSchema = z.string().regex(/^#[0-9a-f]{6}$/i)

export function hexParaRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbParaHex(r: number, g: number, b: number): string {
  const c = (v: number): string =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function rgbParaHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [h * 60, s, l]
}

export function hslParaHex(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return rgbParaHex(f(0) * 255, f(8) * 255, f(4) * 255)
}

/**
 * O degrade vertical de uma cor: a pronta usa o dela; a escolhida a mao segue
 * a conta do roxo do PSD (topo ~19 pontos de luz acima e saturado, a cor
 * pura a 30% do topo, a base ~19 pontos abaixo). Cor quase cinza escurece
 * menos na base (o branco: 255 -> 231).
 */
export function degradeDaCor(hex: string): ParadaDoDegrade[] {
  const cor = corSchema.safeParse(hex).success ? hex.toLowerCase() : COR_LINHA_1
  const pronta = CORES_DA_THUMB.find((c) => c.cor === cor && c.degrade)
  if (pronta?.degrade) return pronta.degrade.map((p) => ({ ...p }))
  const [h, s, l] = rgbParaHsl(...hexParaRgb(cor))
  const desce = 0.09 + 0.1 * s
  return [
    {
      em: 0,
      cor: hslParaHex(h, Math.min(1, s + 0.15), Math.min(0.97, l + 0.19)),
    },
    { em: 0.3, cor },
    {
      em: 1,
      cor: hslParaHex(h, Math.min(1, s + 0.1), Math.max(0.05, l - desce)),
    },
  ]
}
