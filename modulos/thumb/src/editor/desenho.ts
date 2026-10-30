import {
  ALTURA,
  AREA_SEGURA_BASE,
  AREA_SEGURA_TOPO,
  CORPO_PX,
  contornoDaSeta,
  contornoDaSetaPx,
  degradeDaCor,
  LARGURA,
  LOOK,
  SOMBRA_DESFOQUE,
  SOMBRA_Y,
  ZONA_PROIBIDA_BASE,
  ZONA_PROIBIDA_TOPO,
  type GeometriaDaThumb,
  type MedirTexto,
  type SetaNoQuadro,
  type ThumbDoProjeto,
} from '../../shared/thumb'
import { familiaDaFonte } from './fontes'

/**
 * [thumb] O DESENHO DA THUMBNAIL num canvas (o mesmo codigo na previa e no
 * PNG final; so a escala muda): as imagens com o "look" (saturacao e
 * contraste leves), a seta, as 2 linhas de texto (sombra, contorno por fora,
 * degrade vertical, esticada 1,11x) e, SO NA PREVIA, as guias da area segura
 * do TikTok (as faixas proibidas, as linhas de 16% e 84%, a emenda e as
 * caixas dos rostos).
 */

/** O que vai em cada painel: a imagem e o pedaco dela (px da propria imagem). */
export interface PainelPronto {
  fonte: CanvasImageSource
  sx: number
  sy: number
  sw: number
  sh: number
}

export interface GuiasDaPrevia {
  /** As faixas proibidas e as linhas da area segura. */
  zonas: boolean
  /** As caixas dos rostos (no quadro); `ruim` = numa faixa proibida. */
  rostos: { x1: number; y1: number; x2: number; y2: number; ruim: boolean }[]
  /** As pontas da seta para arrastar. */
  pontasDaSeta: boolean
}

export interface EntradaDoDesenho {
  thumb: Pick<ThumbDoProjeto, 'layout' | 'cores' | 'fonte'>
  geo: GeometriaDaThumb
  paineis: readonly (PainelPronto | null)[]
  seta: SetaNoQuadro | null
  /** Pixels do canvas por pixel do quadro 1080 (1 no PNG final). */
  escala: number
  guias?: GuiasDaPrevia | null
}

/**
 * O medidor do texto pelo proprio canvas (a fonte ja carregada): a caixa REAL
 * da tinta da linha (actualBoundingBox*), nao a caixa da linha da fonte -- cada
 * fonte tem ascendente e descendente diferentes, e a tinta e o que aparece.
 */
export function medidorDoCanvas(ctx: CanvasRenderingContext2D, fonte: ThumbDoProjeto['fonte']): MedirTexto {
  const familia = familiaDaFonte(fonte)
  return (texto, px) => {
    ctx.save()
    ctx.font = `${px}px "${familia}"`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    const m = ctx.measureText(texto)
    ctx.restore()
    const cap = m.actualBoundingBoxAscent
    return {
      largura: m.width,
      cap: cap > 0 ? cap : px * 0.7,
      desce: Math.max(0, m.actualBoundingBoxDescent),
      esquerda: m.actualBoundingBoxLeft,
      direita: m.actualBoundingBoxRight,
    }
  }
}

function caminhoDaSeta(ctx: CanvasRenderingContext2D, seta: SetaNoQuadro): void {
  const pontos = contornoDaSeta(seta)
  ctx.beginPath()
  pontos.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.closePath()
}

function desenharSeta(ctx: CanvasRenderingContext2D, seta: SetaNoQuadro, escala: number): void {
  const contorno = contornoDaSetaPx(seta)
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  // Sombra (a do texto, menor), depois o contorno por fora e o vermelho por cima.
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowOffsetY = 8 * escala
  ctx.shadowBlur = 14 * escala
  caminhoDaSeta(ctx, seta)
  ctx.lineWidth = contorno * 2
  ctx.strokeStyle = '#000'
  ctx.stroke()
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = '#000'
  ctx.fill()
  const g = ctx.createLinearGradient(seta.base.x, seta.base.y, seta.ponta.x, seta.ponta.y)
  g.addColorStop(0, '#ff3b30')
  g.addColorStop(0.55, '#ec0d0d')
  g.addColorStop(1, '#b80000')
  ctx.fillStyle = g
  caminhoDaSeta(ctx, seta)
  ctx.fill()
  ctx.restore()
}

function desenharTexto(ctx: CanvasRenderingContext2D, e: EntradaDoDesenho): void {
  const familia = familiaDaFonte(e.thumb.fonte)
  e.geo.linhas.forEach((l, i) => {
    const cor = e.thumb.cores[Math.min(i, 1)]!
    const relativo = l.px / CORPO_PX
    const capLocal = l.cap / l.esticada
    ctx.save()
    ctx.translate(l.x, l.base)
    ctx.scale(1, l.esticada)
    ctx.font = `${l.px}px "${familia}"`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.lineWidth = l.contorno * 2
    // 1) a sombra do PSD (preta, 100%, 13 px abaixo, desfoque 11,4): a forma inteira, com o contorno.
    ctx.shadowColor = 'rgba(0,0,0,1)'
    ctx.shadowOffsetY = SOMBRA_Y * relativo * e.escala
    // O shadowBlur do canvas e ~2x o desvio do gaussiano.
    ctx.shadowBlur = SOMBRA_DESFOQUE * 2 * relativo * e.escala
    ctx.strokeStyle = '#000'
    ctx.fillStyle = '#000'
    ctx.strokeText(l.texto, 0, 0)
    ctx.shadowColor = 'transparent'
    // 2) o contorno POR FORA: o traco largo, e o preenchimento por cima cobre a metade de dentro.
    ctx.strokeText(l.texto, 0, 0)
    // 3) o degrade vertical, do topo da maiuscula a base.
    const g = ctx.createLinearGradient(0, -capLocal, 0, 0)
    for (const p of degradeDaCor(cor)) g.addColorStop(p.em, p.cor)
    ctx.fillStyle = g
    ctx.fillText(l.texto, 0, 0)
    ctx.restore()
  })
}

function desenharGuias(ctx: CanvasRenderingContext2D, e: EntradaDoDesenho, g: GuiasDaPrevia): void {
  const px = 1 / e.escala
  ctx.save()
  if (g.zonas) {
    const topo = ZONA_PROIBIDA_TOPO * ALTURA
    const base = ZONA_PROIBIDA_BASE * ALTURA
    ctx.fillStyle = 'rgba(255, 45, 45, 0.22)'
    ctx.fillRect(0, 0, LARGURA, topo)
    ctx.fillRect(0, base, LARGURA, ALTURA - base)
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)'
    ctx.lineWidth = 2 * px
    ctx.beginPath()
    ctx.moveTo(0, topo)
    ctx.lineTo(LARGURA, topo)
    ctx.moveTo(0, base)
    ctx.lineTo(LARGURA, base)
    ctx.stroke()
    // A area segura (16-84%): tracejada, discreta.
    ctx.setLineDash([14 * px, 10 * px])
    ctx.strokeStyle = 'rgba(120, 255, 170, 0.75)'
    ctx.beginPath()
    ctx.moveTo(0, AREA_SEGURA_TOPO * ALTURA)
    ctx.lineTo(LARGURA, AREA_SEGURA_TOPO * ALTURA)
    ctx.moveTo(0, AREA_SEGURA_BASE * ALTURA)
    ctx.lineTo(LARGURA, AREA_SEGURA_BASE * ALTURA)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.font = `600 ${Math.round(13 * px)}px Inter, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('ZONA PROIBIDA - SO CENARIO', LARGURA / 2, topo / 2)
    ctx.fillText('ZONA PROIBIDA - SO CENARIO', LARGURA / 2, base + (ALTURA - base) / 2)
  }
  if (g.zonas && e.geo.emenda !== null && e.thumb.layout === 'duas') {
    ctx.setLineDash([8 * px, 8 * px])
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 1.5 * px
    ctx.beginPath()
    ctx.moveTo(0, e.geo.emenda)
    ctx.lineTo(LARGURA, e.geo.emenda)
    ctx.stroke()
    ctx.setLineDash([])
  }
  for (const r of g.rostos) {
    ctx.strokeStyle = r.ruim ? 'rgba(255, 70, 70, 1)' : 'rgba(255, 255, 255, 0.85)'
    ctx.lineWidth = 2.5 * px
    ctx.setLineDash(r.ruim ? [] : [10 * px, 6 * px])
    ctx.beginPath()
    ctx.roundRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1, 10 * px)
    ctx.stroke()
  }
  ctx.setLineDash([])
  if (g.pontasDaSeta && e.seta) {
    for (const p of [e.seta.base, e.seta.ponta]) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 7 * px, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.lineWidth = 2 * px
      ctx.strokeStyle = '#000'
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Desenha a thumb inteira no canvas (que tem LARGURA x ALTURA vezes `escala`). */
export function desenharThumb(ctx: CanvasRenderingContext2D, e: EntradaDoDesenho): void {
  ctx.save()
  ctx.setTransform(e.escala, 0, 0, e.escala, 0, 0)
  ctx.fillStyle = '#0b0b0d'
  ctx.fillRect(0, 0, LARGURA, ALTURA)
  e.geo.paineis.forEach((painel, i) => {
    const p = e.paineis[i]
    const altura = painel.y1 - painel.y0
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, painel.y0, LARGURA, altura)
    ctx.clip()
    if (p) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.filter = `saturate(${LOOK.saturacao}) contrast(${LOOK.contraste})`
      ctx.drawImage(p.fonte, p.sx, p.sy, p.sw, p.sh, 0, painel.y0, LARGURA, altura)
      ctx.filter = 'none'
    } else {
      const g = ctx.createLinearGradient(0, painel.y0, 0, painel.y1)
      g.addColorStop(0, '#1b1b20')
      g.addColorStop(1, '#101013')
      ctx.fillStyle = g
      ctx.fillRect(0, painel.y0, LARGURA, altura)
    }
    ctx.restore()
  })
  if (e.seta) desenharSeta(ctx, e.seta, e.escala)
  desenharTexto(ctx, e)
  if (e.guias) desenharGuias(ctx, e, e.guias)
  ctx.restore()
}
