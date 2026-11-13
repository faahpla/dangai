import {
  ALTURA,
  AREA_SEGURA_BASE,
  AREA_SEGURA_TOPO,
  CORPO_PX,
  CONTORNO_DA_LINHA,
  caixaDaSeta,
  caminhoDaSeta,
  contornoDaSetaPx,
  degradeDaLinha,
  degradeDaSeta,
  desenhoDaSeta,
  emendaNoX,
  ESPESSURA_DA_LINHA,
  esticadaDoDivisor,
  LARGURA,
  ESTILO,
  LOOK,
  ZONA_PROIBIDA_BASE,
  ZONA_PROIBIDA_TOPO,
  regiaoDoPainel,
  type GeometriaDaThumb,
  type MedirTexto,
  type SetaNoQuadro,
  type ThumbDoProjeto,
} from '../../shared/thumb'
import { familiaDaThumb } from './fontes'
import { imagemDaSeta } from './setas'

/**
 * [thumb] O DESENHO DA THUMBNAIL num canvas (o mesmo codigo na previa e no
 * PNG final; so a escala muda): as imagens com o "look" (saturacao e
 * contraste leves) -- com a emenda inclinada, a de baixo recortada pela reta
 * por cima da de cima --, o DIVISOR na emenda (por cima das imagens, por baixo
 * da seta e do texto; inclinado, girado e esticado de borda a borda), a seta (a seta.png vetorizada, so escala, giro e espelho),
 * as 2 linhas de texto (sombra, contorno por fora, degrade vertical, esticada
 * 1,11x, o bloco girado pela "Rotacao") e, SO NA PREVIA, as guias da area segura
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
  /** (13/11) A seta livre: uma moldura tracejada em volta dela (sem bolinhas), para ele ver o que arrasta. */
  molduraDaSeta?: boolean
}

/**
 * O divisor pronto para desenhar (src/editor/divisores.ts prepara): o PNG do
 * quadro inteiro (ja recolorido) com o centro da forma posto na emenda, ou a
 * linha desenhada aqui.
 */
export type DivisorPronto =
  | {
      tipo: 'imagem'
      fonte: CanvasImageSource
      largura: number
      altura: number
      centro: number
      /** As linhas do PNG em que a forma existe (FAIXA_DO_DIVISOR): inclinado, so elas sao desenhadas. Ausente = o PNG inteiro. */
      faixa?: { de: number; ate: number }
    }
  | { tipo: 'linha'; cor: string; contorno: boolean }

export interface EntradaDoDesenho {
  thumb: Pick<ThumbDoProjeto, 'layout' | 'cores' | 'fonte'> &
    Partial<Pick<ThumbDoProjeto, 'fontePc' | 'estilo' | 'degrades' | 'contorno' | 'sombra'>>
  geo: GeometriaDaThumb
  paineis: readonly (PainelPronto | null)[]
  seta: SetaNoQuadro | null
  /** O divisor na emenda (null/ausente = sem). */
  divisor?: DivisorPronto | null
  /** Pixels do canvas por pixel do quadro 1080 (1 no PNG final). */
  escala: number
  /** (05/11) O `url(#id)` do filtro da cor das imagens (filtro-de-cor.ts); null/ausente = sem. */
  filtroDeCor?: string | null
  guias?: GuiasDaPrevia | null
}

/**
 * O medidor do texto pelo proprio canvas (a fonte ja carregada): a caixa REAL
 * da tinta da linha (actualBoundingBox*), nao a caixa da linha da fonte -- cada
 * fonte tem ascendente e descendente diferentes, e a tinta e o que aparece.
 */
export function medidorDoCanvas(
  ctx: CanvasRenderingContext2D,
  fonte: ThumbDoProjeto['fonte'] | (Pick<ThumbDoProjeto, 'fonte'> & { fontePc?: ThumbDoProjeto['fontePc'] }),
): MedirTexto {
  const familia = familiaDaThumb(typeof fonte === 'string' ? { fonte } : fonte)
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

function tracarSeta(ctx: CanvasRenderingContext2D, seta: SetaNoQuadro): void {
  ctx.beginPath()
  for (const passo of caminhoDaSeta(seta)) {
    if (passo.tipo === 'C') ctx.bezierCurveTo(passo.c1.x, passo.c1.y, passo.c2.x, passo.c2.y, passo.p.x, passo.p.y)
    else if (passo.tipo === 'M') ctx.moveTo(passo.p.x, passo.p.y)
    else ctx.lineTo(passo.p.x, passo.p.y)
  }
  ctx.closePath()
}

/** A seta padrao (a seta.png vetorizada): a sombra, o contorno preto por fora e o degrade da png. */
function desenharSeta(ctx: CanvasRenderingContext2D, seta: SetaNoQuadro, escala: number): void {
  const desenho = desenhoDaSeta(seta)
  const img = desenho.imagem ? imagemDaSeta(seta) : null
  if (desenho.imagem && img) {
    // A SETA QUE E O PNG (a do AJK): o arquivo inteiro (com a sombra dele) pela similaridade que leva a
    // cauda e a ponta do PNG a base e a ponta da seta; `lado` -1 espelha.
    const c = desenho.imagem.cauda
    const pp = desenho.imagem.ponta
    const dx = pp.x - c.x
    const dy = pp.y - c.y
    const L2 = dx * dx + dy * dy
    const Dx = seta.ponta.x - seta.base.x
    const Dy = seta.ponta.y - seta.base.y
    const l = seta.lado
    // (u, v) do PNG = A (p - c); a tela = base + u D + l v perp(D), perp(D) = (-Dy, Dx).
    const a = (Dx * dx - l * Dy * -dy) / L2
    const b = (Dy * dx + l * Dx * -dy) / L2
    const cc = (Dx * dy - l * Dy * dx) / L2
    const d = (Dy * dy + l * Dx * dx) / L2
    ctx.save()
    ctx.transform(a, b, cc, d, seta.base.x - a * c.x - cc * c.y, seta.base.y - b * c.x - d * c.y)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0)
    ctx.restore()
    return
  }
  const contorno = contornoDaSetaPx(seta)
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  // Sombra (a do texto, menor), depois o contorno por fora e o vermelho por cima.
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowOffsetY = 8 * escala
  ctx.shadowBlur = 14 * escala
  tracarSeta(ctx, seta)
  if (contorno > 0.05) {
    ctx.lineWidth = contorno * 2
    ctx.strokeStyle = '#000'
    ctx.stroke()
  }
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = '#000'
  ctx.fill()
  const d = degradeDaSeta(seta)
  const g = ctx.createLinearGradient(d.de.x, d.de.y, d.ate.x, d.ate.y)
  const cores = desenhoDaSeta(seta).degrade.cores
  g.addColorStop(0, cores[0])
  g.addColorStop(1, cores[1])
  ctx.fillStyle = g
  tracarSeta(ctx, seta)
  ctx.fill()
  ctx.restore()
}

/**
 * A meia espessura (px do quadro) da forma do divisor em volta da emenda: o
 * quanto ele sobe e desce do centro (a esticada inclinada conta as quinas).
 */
export function meiaEspessuraDoDivisor(d: DivisorPronto): number {
  if (d.tipo === 'linha') return ESPESSURA_DA_LINHA / 2 + (d.contorno ? CONTORNO_DA_LINHA : 0)
  const k = LARGURA / d.largura
  const f = d.faixa ?? { de: 0, ate: d.altura - 1 }
  return Math.max(d.centro - f.de, f.ate + 1 - d.centro) * k
}

function desenharDivisor(ctx: CanvasRenderingContext2D, d: DivisorPronto, emenda: number, graus: number): void {
  ctx.save()
  if (graus !== 0) {
    // INCLINADO: gira em volta do meio da emenda e estica SO na largura (a espessura fica), o bastante para
    // as quinas da faixa passarem das bordas do quadro (esticadaDoDivisor).
    const estica = esticadaDoDivisor(graus, meiaEspessuraDoDivisor(d), LARGURA)
    ctx.translate(LARGURA / 2, emenda)
    ctx.rotate((graus * Math.PI) / 180)
    if (d.tipo === 'imagem') {
      ctx.scale(estica, 1)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      const k = LARGURA / d.largura
      const f = d.faixa ?? { de: 0, ate: d.altura - 1 }
      const linhas = f.ate + 1 - f.de
      ctx.drawImage(d.fonte, 0, f.de, d.largura, linhas, -LARGURA / 2, (f.de - d.centro) * k, LARGURA, linhas * k)
    } else {
      const largura = LARGURA * estica
      if (d.contorno) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)'
        ctx.fillRect(-largura / 2, -ESPESSURA_DA_LINHA / 2 - CONTORNO_DA_LINHA, largura, ESPESSURA_DA_LINHA + 2 * CONTORNO_DA_LINHA)
      }
      ctx.fillStyle = d.cor
      ctx.fillRect(-largura / 2, -ESPESSURA_DA_LINHA / 2, largura, ESPESSURA_DA_LINHA)
    }
    ctx.restore()
    return
  }
  if (d.tipo === 'imagem') {
    // O PNG e do quadro inteiro (1080x1920): 1 px dele = 1 px da thumb, so deslocado para a forma cair na emenda.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(d.fonte, 0, emenda - d.centro, LARGURA, (d.altura * LARGURA) / d.largura)
  } else {
    const y = emenda - ESPESSURA_DA_LINHA / 2
    if (d.contorno) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)'
      ctx.fillRect(0, y - CONTORNO_DA_LINHA, LARGURA, ESPESSURA_DA_LINHA + 2 * CONTORNO_DA_LINHA)
    }
    ctx.fillStyle = d.cor
    ctx.fillRect(0, y, LARGURA, ESPESSURA_DA_LINHA)
  }
  ctx.restore()
}

function desenharTexto(ctx: CanvasRenderingContext2D, e: EntradaDoDesenho): void {
  const familia = familiaDaThumb(e.thumb)
  const estilo = ESTILO[e.thumb.estilo ?? 'kizuni']
  const corDoContorno = e.thumb.contorno?.cor ?? '#000000'
  const { pivo, rotacao } = e.geo
  e.geo.linhas.forEach((l) => {
    const relativo = l.px / CORPO_PX
    const capLocal = l.cap / l.esticada
    ctx.save()
    // A "Rotacao": o bloco inteiro gira em volta do meio dele (o contorno e o degrade giram junto). A sombra
    // NAO: o deslocamento e o desfoque da sombra do canvas ficam fora da transformacao, entao ela continua
    // caindo para baixo na tela (o Photoshop).
    if (rotacao !== 0) {
      ctx.translate(pivo.x, pivo.y)
      ctx.rotate((rotacao * Math.PI) / 180)
      ctx.translate(-pivo.x, -pivo.y)
    }
    ctx.translate(l.x, l.base)
    ctx.scale(1, l.esticada)
    ctx.font = `${l.px}px "${familia}"`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    // Sem contorno (0 px): o canvas ignora lineWidth 0, entao a sombra sai do preenchimento.
    const comContorno = l.contorno > 0.05
    if (comContorno) ctx.lineWidth = l.contorno * 2
    // 1) a sombra do estilo (preta, 100%; o Kizuni 13 px abaixo com desfoque 11,4, o Faah 6 e 2,2): a forma
    // inteira, com o contorno. A "Sombra" (13/11) multiplica a distancia e o desfoque; 0 = sem.
    const fatorDaSombra = e.thumb.sombra ?? 1
    ctx.shadowColor = fatorDaSombra > 0.001 ? 'rgba(0,0,0,1)' : 'transparent'
    ctx.shadowOffsetY = estilo.sombraY * fatorDaSombra * relativo * e.escala
    // O shadowBlur do canvas e ~2x o desvio do gaussiano.
    ctx.shadowBlur = estilo.sombraDesfoque * 2 * fatorDaSombra * relativo * e.escala
    ctx.strokeStyle = corDoContorno
    ctx.fillStyle = corDoContorno
    if (comContorno) ctx.strokeText(l.texto, 0, 0)
    else ctx.fillText(l.texto, 0, 0)
    ctx.shadowColor = 'transparent'
    // 2) o contorno POR FORA: o traco largo, e o preenchimento por cima cobre a metade de dentro.
    if (comContorno) ctx.strokeText(l.texto, 0, 0)
    // 3) o degrade vertical, do topo da maiuscula a base.
    const g = ctx.createLinearGradient(0, -capLocal, 0, 0)
    for (const p of degradeDaLinha(e.thumb, l.linha)) g.addColorStop(p.em, p.cor)
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
  const corte = e.geo.paineis[1]?.corte
  if (g.zonas && e.geo.emenda !== null && e.thumb.layout === 'duas' && corte) {
    ctx.setLineDash([8 * px, 8 * px])
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 1.5 * px
    ctx.beginPath()
    ctx.moveTo(0, emendaNoX(corte, 0))
    ctx.lineTo(LARGURA, emendaNoX(corte, LARGURA))
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
  if (g.molduraDaSeta && e.seta) {
    const c = caixaDaSeta(e.seta)
    ctx.setLineDash([10 * px, 7 * px])
    ctx.lineWidth = 2 * px
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.strokeRect(c.x1, c.y1, c.x2 - c.x1, c.y2 - c.y1)
    ctx.setLineDash([])
  }
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
    if (painel.lugar === 'baixo' && painel.corte && (painel.corte.tan !== 0 || painel.corte.meio)) {
      // A EMENDA INCLINADA: a de cima cobre a caixa dela inteira (ate a ponta mais funda da emenda) e a de
      // baixo, desenhada depois, so abaixo da reta -- a borda suavizada cai sobre a de cima, nunca sobre o
      // fundo (sem fresta). Reta: os dois retangulos de antes.
      const regiao = regiaoDoPainel(painel)
      ctx.moveTo(regiao[0]!.x, regiao[0]!.y)
      for (const q of regiao.slice(1)) ctx.lineTo(q.x, q.y)
      ctx.closePath()
    } else ctx.rect(0, painel.y0, LARGURA, altura)
    ctx.clip()
    if (p) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      // A cor dele (o ajuste da camada de ajuste) primeiro, depois o look da thumb.
      ctx.filter = `${e.filtroDeCor ? `${e.filtroDeCor} ` : ''}saturate(${LOOK.saturacao}) contrast(${LOOK.contraste})`
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
  // As camadas: imagens -> divisor -> seta e texto.
  if (e.divisor && e.geo.emenda !== null && e.thumb.layout === 'duas') desenharDivisor(ctx, e.divisor, e.geo.emenda, e.geo.inclinacao)
  if (e.seta) desenharSeta(ctx, e.seta, e.escala)
  desenharTexto(ctx, e)
  if (e.guias) desenharGuias(ctx, e, e.guias)
  ctx.restore()
}
