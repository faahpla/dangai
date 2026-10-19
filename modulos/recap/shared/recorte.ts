import { medidasDo, type Formato } from '@shared/contract'

/**
 * [recap] O RECORTE 9:16 VISTO DE PERTO (19/10, 3a rodada do MRM E02): duas
 * cenas seguidas que, DEPOIS do recorte, mostram a mesma coisa parecem um jump
 * cut, mesmo vindo de planos diferentes -- o Lent com o papel em 0126 e 0129,
 * o Lent de perfil em 0285 e 0286 (no 16:9 a fadinha muda; no recorte, nao).
 *
 * Puro: quem le os keyframes e electron/montar/rostos-motor.ts (sharp); aqui
 * so a janela visivel e a conta da semelhanca.
 */

/**
 * (rodada 4) O QUADRO de um recorte: o formato do video ('short' 9:16, 'long'
 * 16:9) ou a METADE do grid -- cada metade da tela dividida do short, 1080x960
 * (9:8). A metade parte do arquivo original com `cover` (Scene.tsx, Metade):
 * sem a folga do Ken Burns do recorte pronto, a caixa e o que se ve.
 */
export type QuadroDoRecorte = Formato | 'metade'

/** As medidas do quadro: as do formato, ou as da metade do short (sem folga). */
export function medidasDoQuadro(q: QuadroDoRecorte): { width: number; height: number; renderWidth: number; renderHeight: number } {
  if (q !== 'metade') return medidasDo(q)
  const m = medidasDo('short')
  return { width: m.width, height: m.height / 2, renderWidth: m.width, renderHeight: m.height / 2 }
}

/**
 * A parte do quadro que a tela mostra, em fracao da largura: o centro e a
 * largura. A mesma conta do focoNoQuadro (montar/foco.ts) e do render: a caixa
 * do render (com a folga do Ken Burns) anda pelo focusX, e o que se ve e o
 * meio dela.
 */
export function janelaVisivel(focusX: number, largura: number, altura: number, formato: QuadroDoRecorte = 'short'): { centro: number; largura: number } {
  const m = medidasDoQuadro(formato)
  if (!(largura > 0) || !(altura > 0)) return { centro: 0.5, largura: 1 }
  const escala = Math.max(m.renderWidth / largura, m.renderHeight / altura)
  const caixa = Math.min(largura, m.renderWidth / escala)
  const visivel = Math.min(largura, m.width / escala)
  const f = Number.isFinite(focusX) ? Math.min(Math.max(focusX, 0), 1) : 0.5
  const x0 = f * (largura - caixa)
  return { centro: (x0 + caixa / 2) / largura, largura: visivel / largura }
}

/** O tamanho em que o recorte e comparado (9:16 de pe). */
export const RECORTE_LARGURA = 27
export const RECORTE_ALTURA = 48

/** O que se compara de um recorte: a luma (a forma) e o histograma de cor (8x8x8). */
export interface DescritorDoRecorte {
  luma: Float32Array
  cores: Float32Array
}

/** `rgb`: o recorte reduzido a RECORTE_LARGURA x RECORTE_ALTURA, 3 bytes por pixel. */
export function descritorDoRecorte(rgb: Uint8Array): DescritorDoRecorte {
  const n = RECORTE_LARGURA * RECORTE_ALTURA
  const luma = new Float32Array(n)
  const cores = new Float32Array(512)
  if (rgb.length < 3 * n) return { luma, cores }
  for (let i = 0; i < n; i++) {
    const r = rgb[3 * i]!
    const g = rgb[3 * i + 1]!
    const b = rgb[3 * i + 2]!
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b
    cores[(r >> 5) * 64 + (g >> 5) * 8 + (b >> 5)]! += 1 / n
  }
  return { luma, cores }
}

/**
 * A semelhanca de dois recortes, 0..1: a media da correlacao da luma (a mesma
 * forma no mesmo lugar; negativa conta 0) e da intersecao dos histogramas (as
 * mesmas cores). Medido no MRM E02 e no Nia E01: os dois pares do jump cut dao
 * 0,82 (0126 -> 0129) e 0,98 (0285 -> 0286); as outras 57 trocas de cena, no
 * maximo 0,69 (dois closes da fadinha).
 */
export function semelhancaDosRecortes(a: DescritorDoRecorte, b: DescritorDoRecorte): number {
  const n = Math.min(a.luma.length, b.luma.length)
  if (n === 0) return 0
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a.luma[i]!
    mb += b.luma[i]!
  }
  ma /= n
  mb /= n
  let s = 0
  let sa = 0
  let sb = 0
  for (let i = 0; i < n; i++) {
    const x = a.luma[i]! - ma
    const y = b.luma[i]! - mb
    s += x * y
    sa += x * x
    sb += y * y
  }
  // Duas imagens lisas (sem forma): a correlacao nao diz nada; vale so a cor.
  const forma = sa > 1e-6 && sb > 1e-6 ? s / Math.sqrt(sa * sb) : 0
  let cor = 0
  for (let i = 0; i < Math.min(a.cores.length, b.cores.length); i++) cor += Math.min(a.cores[i]!, b.cores[i]!)
  return 0.5 * Math.max(0, forma) + 0.5 * cor
}

/** Acima disto, as duas cenas seguidas sao "quase iguais" depois do recorte (o jump cut). */
export const RECORTE_IGUAL = 0.75
