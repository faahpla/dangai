import { z } from 'zod'
import { corSchema, degradeDaCor, hexParaRgb, hslParaHex, rgbParaHsl, type ParadaDoDegrade } from './cor'

/**
 * [thumb] OS DIVISORES (pedido do Levi, 30/10): no layout de 2 imagens, uma
 * faixa por cima da emenda -- as camadas sao imagens -> DIVISOR -> seta e
 * texto. Desligado por padrao (as thumbs de antes nao mudam).
 *
 * - "Rasgo com brilho" e "Rasgo": o rasgo dele (MEIO.png, o rasgo azul-marinho
 *   com o brilho azul em volta; MEIO2.png, o mesmo rasgo so preto);
 * - "Slash": o do Faah (Slash_Anime.png, faixa laranja com degrade, contorno
 *   preto e sombra);
 * - "Linha": uma linha reta desenhada aqui (sem PNG), com contorno discreto
 *   opcional.
 *
 * Os PNGs (1080x1920, o quadro inteiro) ficam em modulos/thumb/assets/divisores
 * e entram em alta: no PNG final, 1 px do arquivo = 1 px da thumb. A COR:
 * null = a original do PNG (intocado); escolhida, o recolorir abaixo muda so
 * o RGB -- o alpha (a forma, o brilho, a sombra) fica igual.
 *
 * Puro (sem DOM): o renderer passa os pixels do PNG (getImageData) e o teste
 * os do sharp.
 */

export const MODELOS_DE_DIVISOR = [
  { id: 'rasgo-brilho', nome: 'Rasgo com brilho' },
  { id: 'rasgo', nome: 'Rasgo' },
  { id: 'slash', nome: 'Slash' },
  { id: 'linha', nome: 'Linha' },
] as const
export type ModeloDeDivisor = (typeof MODELOS_DE_DIVISOR)[number]['id']
export type ModeloComPng = Exclude<ModeloDeDivisor, 'linha'>

export const divisorSchema = z.object({
  ligado: z.boolean(),
  modelo: z.enum(MODELOS_DE_DIVISOR.map((m) => m.id) as [ModeloDeDivisor, ...ModeloDeDivisor[]]),
  /** null = a cor original do modelo (o PNG como veio). */
  cor: corSchema.nullable(),
  /** So a Linha: o contorno escuro fino. */
  contorno: z.boolean(),
})
export type DivisorDaThumb = z.infer<typeof divisorSchema>

/** O padrao: desligado, o rasgo com brilho do Levi na cor original. */
export function divisorPadrao(): DivisorDaThumb {
  return { ligado: false, modelo: 'rasgo-brilho', cor: null, contorno: true }
}

/** Os arquivos de cada modelo (em modulos/thumb/assets/divisores). O rasgo com brilho usa o MEIO2 como a forma. */
export const PNG_DO_DIVISOR: Record<ModeloComPng, string> = {
  'rasgo-brilho': 'MEIO.png',
  rasgo: 'MEIO2.png',
  slash: 'Slash_Anime.png',
}
export const PNG_DA_FORMA_DO_RASGO = 'MEIO2.png'

/**
 * O CENTRO REAL DA FORMA em cada PNG (y no quadro 1920): a media dos pixels
 * opacos (alpha > 200), medida nos arquivos -- o brilho e a sombra nao contam.
 * O divisor e desenhado com este y em cima da emenda.
 */
export const CENTRO_DO_DIVISOR: Record<ModeloComPng, number> = {
  'rasgo-brilho': 1010,
  rasgo: 1010,
  slash: 974,
}

/** A faixa (y no PNG) onde o rasgo existe: o degrade da cor nova vai do topo dela a base. */
const RASGO_TOPO = 936
const RASGO_BASE = 1095

/** A linha: a espessura (px do quadro 1080) e o contorno por fora. */
export const ESPESSURA_DA_LINHA = 12
export const CONTORNO_DA_LINHA = 3

/** A cor que cada modelo tem sem escolher nenhuma (o seletor mostra esta). */
export const COR_ORIGINAL_DO_DIVISOR: Record<ModeloDeDivisor, string> = {
  'rasgo-brilho': '#000a26',
  rasgo: '#000000',
  slash: '#fd7a0c',
  linha: '#ffffff',
}

/** O divisor que entra no desenho: null = nao entra (desligado, ou 1 imagem). */
export function divisorEfetivo(t: { layout: 'uma' | 'duas'; divisor?: DivisorDaThumb | null }): DivisorDaThumb | null {
  const d = t.divisor
  if (!d || !d.ligado || t.layout !== 'duas') return null
  return d
}

// ------------------------------------------------------------- recolorir

/** Os pixels de um PNG (RGBA, linha a linha). */
export interface PixelsRgba {
  largura: number
  altura: number
  dados: Uint8ClampedArray | Uint8Array
}

type Rgb = [number, number, number]

/** A cor do degrade em `em` (0 = topo, 1 = base), interpolada em RGB. */
export function corNoDegrade(paradas: readonly ParadaDoDegrade[], em: number): Rgb {
  const p = [...paradas].sort((a, b) => a.em - b.em)
  const t = Math.max(0, Math.min(1, em))
  if (p.length === 0) return [255, 255, 255]
  if (t <= p[0]!.em) return hexParaRgb(p[0]!.cor)
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!
    const b = p[i]!
    if (t <= b.em) {
      const f = b.em > a.em ? (t - a.em) / (b.em - a.em) : 0
      const ca = hexParaRgb(a.cor)
      const cb = hexParaRgb(b.cor)
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f]
    }
  }
  return hexParaRgb(p[p.length - 1]!.cor)
}

/**
 * O tom do BRILHO do rasgo para uma cor: no original, o rasgo e escuro e o
 * brilho um azul vivo; com a cor escolhida, o brilho e a mesma cor, viva e de
 * luz media (le de longe sem virar mancha). Cor quase cinza (branco, preto):
 * ela mesma, um pouco mais clara.
 */
export function tomDoBrilho(hex: string): string {
  const [h, s, l] = rgbParaHsl(...hexParaRgb(hex))
  if (s < 0.12) return hslParaHex(h, s, Math.min(0.95, Math.max(0.3, l)))
  return hslParaHex(h, Math.min(1, s + 0.2), Math.max(0.4, Math.min(0.62, l)))
}

/** Os limites do degrade laranja do Slash, pela razao verde/vermelho (2% e 98% dos pixels laranja). */
const SLASH_RAZAO_ESCURA = 0.397
const SLASH_RAZAO_CLARA = 0.6245
/** O vermelho do laranja puro (o contorno e a sombra vao de 0 ate isto). */
const SLASH_VERMELHO = 253

/**
 * RECOLORE um divisor de PNG para `cor`, mudando so o RGB (o alpha sai igual,
 * pixel a pixel):
 *
 * - Rasgo: a forma vira o degrade da cor (o mesmo do texto: topo mais claro,
 *   base mais escura), do topo a base da faixa do rasgo;
 * - Rasgo com brilho: a forma igual a do Rasgo (o MEIO2 diz onde ela esta,
 *   `forma`) e o brilho em volta no tom vivo da cor (tomDoBrilho), misturados
 *   na borda pela cobertura da forma;
 * - Slash: cada pixel e "laranja vezes um escuro" (o contorno preto e a sombra
 *   sao o escuro = 0): o escuro fica, e o laranja vira o degrade da cor -- a
 *   posicao no degrade sai do proprio laranja (mais vermelho = topo da faixa,
 *   que fica o mais claro; mais amarelo = base, a mais escura).
 */
export function recolorirDivisor(modelo: ModeloComPng, cor: string, png: PixelsRgba, forma?: PixelsRgba | null): Uint8ClampedArray {
  const { largura, altura, dados } = png
  const saida = new Uint8ClampedArray(dados.length)
  saida.set(dados)
  const degrade = degradeDaCor(cor)
  // O degrade em 256 degraus (a conta por pixel fica barata).
  const tabela: Rgb[] = Array.from({ length: 256 }, (_, i) => corNoDegrade(degrade, i / 255))
  const brilho = hexParaRgb(tomDoBrilho(cor))
  const daFaixa = (y: number): Rgb => tabela[Math.round(Math.max(0, Math.min(1, (y - RASGO_TOPO) / (RASGO_BASE - RASGO_TOPO))) * 255)]!
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 4
      const a = dados[i + 3]!
      if (a === 0) continue
      let rgb: Rgb
      if (modelo === 'rasgo') {
        rgb = daFaixa(y)
      } else if (modelo === 'rasgo-brilho') {
        const w = forma && forma.largura === largura && forma.altura === altura ? forma.dados[i + 3]! / 255 : 0
        const f = daFaixa(y)
        rgb = [f[0] * w + brilho[0] * (1 - w), f[1] * w + brilho[1] * (1 - w), f[2] * w + brilho[2] * (1 - w)]
      } else {
        const r = dados[i]!
        const g = dados[i + 1]!
        const b = dados[i + 2]!
        const escuro = Math.min(1, Math.max(r, g, b) / SLASH_VERMELHO)
        if (escuro < 0.004) continue
        const razao = g / Math.max(1, r)
        const em = Math.max(0, Math.min(1, (razao - SLASH_RAZAO_ESCURA) / (SLASH_RAZAO_CLARA - SLASH_RAZAO_ESCURA)))
        const c = tabela[Math.round(em * 255)]!
        rgb = [c[0] * escuro, c[1] * escuro, c[2] * escuro]
      }
      saida[i] = rgb[0]
      saida[i + 1] = rgb[1]
      saida[i + 2] = rgb[2]
    }
  }
  return saida
}

