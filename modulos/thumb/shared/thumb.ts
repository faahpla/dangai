import { z } from 'zod'
import { COR_LINHA_1, COR_LINHA_2, corSchema } from './cor'
import { divisorEfetivo, divisorPadrao, divisorSchema, INCLINACAO_MAXIMA, type DivisorDaThumb } from './divisores'

export * from './cor'
export * from './divisores'

/**
 * [thumb] O EDITOR DE THUMBNAIL (pedido do Levi, 30/10), em comum: a aba
 * "Thumbnail" da tela "Video pronto" do recap e o modulo Thumbnail (a tela
 * cheia, solta ou de um projeto) usam ESTE preset e estas contas. A capa
 * 1080x1920 do short, sempre no MESMO estilo (o das refs dele, "PODER
 * SUPREMO" e "CANCELOU ENCONTRO"):
 *
 * - uma imagem cheia, ou duas (cima e baixo, emenda horizontal) com o texto
 *   na emenda;
 * - 2 linhas em caixa alta, centralizadas, Luckiest Guy esticada na vertical
 *   (1,11x), a 1a branca e a 2a amarela por padrao, com degrade vertical,
 *   contorno preto grosso por fora e sombra preta desfocada (as medidas do
 *   PSD dele); a linha que nao cabe na largura encolhe sozinha (so ela);
 * - a seta vermelha (a seta.png dele, so escala, giro e espelho) saindo de
 *   perto do texto e apontando o rosto da imagem de cima;
 * - opcional (31/10): a "Rotacao" do bloco de texto (-15 a 15 graus);
 * - cor mais viva (saturacao e contraste leves);
 * - opcionais (30/10): o "Tamanho do texto" (70-150% do corpo, a largura util
 *   continua o teto de cada linha) e, com 2 imagens, um DIVISOR na emenda
 *   (divisores.ts), por cima das imagens e por baixo da seta e do texto;
 * - opcional (31/10): a "Inclinacao" da emenda (e do divisor), -15 a 15 graus:
 *   a emenda vira uma reta inclinada pelo meio dela (CorteDaEmenda).
 *
 * A REGRA FIXA DA AREA SEGURA DO TIKTOK (o Levi insistiu): 0-13% e 87-100% da
 * altura sao proibidos para cabeca e rosto (so cenario); os personagens ficam
 * em 16-84% (os 3% a mais sao a folga para nao encostar). O enquadramento
 * automatico (enquadrarSozinho) poe a cabeca dentro disso e fora do texto; os
 * avisos (avisosDaAreaSegura) acusam o rosto que ele arrastou para la. Sem
 * rosto achado (sem o motor de personagens), o meio da imagem.
 *
 * Puro (sem disco, sem electron, sem DOM): roda igual no main, no renderer e
 * nos testes. Quem desenha e src/editor/desenho.ts; quem tira quadro, acha
 * rosto, amplia e grava e electron/editor.ts. O recap reexporta tudo isto em
 * modulos/recap/shared/thumb.ts (a direcao e recap -> thumb, nunca o
 * contrario).
 */

export const LARGURA = 1080
export const ALTURA = 1920

/** As faixas da regra (fracao da altura). */
export const ZONA_PROIBIDA_TOPO = 0.13
export const ZONA_PROIBIDA_BASE = 0.87
export const AREA_SEGURA_TOPO = 0.16
export const AREA_SEGURA_BASE = 0.84
/** A folga a mais para o personagem nao encostar nos limites (16%+3% e 84%-3%). */
export const FOLGA_DA_AREA = 0.03

// ------------------------------------------------------------------ o texto

/** O corpo da letra na horizontal (o PSD: ~182 px no quadro de 1080). */
export const CORPO_PX = 182
/** A esticada vertical do PSD (202 / 182): a letra fica mais alta que larga. */
export const ESTICADA_Y = 1.11
/**
 * Abaixo disto de corpo (px no quadro de 1080) a linha que encolheu fica
 * pequena para ler numa thumb no celular (a letra com ~78 px de altura, 4%
 * da tela): o editor avisa "Texto longo: fica pequeno". As refs usam 182.
 */
export const CORPO_LEGIVEL = 100
/** A faixa do "Tamanho do texto" (fracao do corpo do preset). */
export const TAMANHO_MINIMO = 0.7
export const TAMANHO_MAXIMO = 1.5
/**
 * A "Rotacao" do bloco de texto (graus, a conta do canvas: negativo = sobe
 * para a direita, como a ref "FALTOU EXPLICAR!" do Faah, uns -5). As duas
 * linhas giram juntas em volta do meio do bloco; a sombra continua caindo
 * para baixo na tela (o canvas nao gira o deslocamento da sombra, como o
 * Photoshop).
 */
export const ROTACAO_MAXIMA = 15
/** O piso do encolher (40 letras de Luckiest Guy ainda cabem). */
const CORPO_MINIMO = 24
/** A linha (com o contorno) nunca passa disto: a que passa encolhe sozinha. */
export const LARGURA_UTIL = 0.86
/** O contorno por fora, proporcional ao corpo (12 px nos 182 das refs). */
export const CONTORNO_POR_PX = 12 / 182
/** A sombra do PSD: preta, 100%, 13 px para baixo, desfoque gaussiano de 11,4. */
export const SOMBRA_Y = 13
export const SOMBRA_DESFOQUE = 11.446
/** As duas linhas quase encostam (os contornos se tocam), como nas refs: o vao e 10% da altura da letra da linha menor. */
export const VAO_ENTRE_LINHAS = 0.1
/** Cor mais viva, sem estourar (o "look" das refs). */
export const LOOK = { saturacao: 1.22, contraste: 1.1 } as const

export const FONTES_DA_THUMB = [
  { id: 'luckiest', nome: 'Luckiest Guy', familia: 'Thumb Luckiest Guy' },
  { id: 'bangers', nome: 'Bangers', familia: 'Thumb Bangers' },
  { id: 'anton', nome: 'Anton', familia: 'Thumb Anton' },
  { id: 'komika', nome: 'Komika Axis', familia: 'Thumb Komika Axis' },
] as const
export type FonteDaThumb = (typeof FONTES_DA_THUMB)[number]['id']
export const FONTE_PADRAO: FonteDaThumb = 'luckiest'

/**
 * O texto de thumb do roteiro ("FUSAO DEMONIACA") em 2 linhas: a quebra que
 * deixa as duas mais parecidas no tamanho. Uma palavra so = linha 2 vazia.
 */
export function partirEmDuasLinhas(texto: string): [string, string] {
  const palavras = texto.trim().toLocaleUpperCase('pt-BR').split(/\s+/).filter(Boolean)
  if (palavras.length === 0) return ['', '']
  if (palavras.length === 1) return [palavras[0]!, '']
  let melhor: [string, string] = [palavras[0]!, palavras.slice(1).join(' ')]
  let diferenca = Infinity
  for (let i = 1; i < palavras.length; i++) {
    const a = palavras.slice(0, i).join(' ')
    const b = palavras.slice(i).join(' ')
    const d = Math.abs(a.length - b.length)
    if (d < diferenca) {
      diferenca = d
      melhor = [a, b]
    }
  }
  return melhor
}

// ------------------------------------------------------------- o projeto

/** Um rosto achado na imagem, em fracao dela (canto de cima a esquerda, largura, altura). */
export const rostoDaThumbSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  conf: z.number().min(0).max(1).default(1),
})
export type RostoDaThumb = z.infer<typeof rostoDaThumbSchema>

/**
 * Quanto a imagem cresce alem de COBRIR o painel (1 = cobre) e o ponto da
 * imagem (fracao) que fica no meio do painel. null = o automatico.
 */
export const enquadramentoSchema = z.object({
  zoom: z.number().min(1).max(4),
  cx: z.number().min(0).max(1),
  cy: z.number().min(0).max(1),
})
export type Enquadramento = z.infer<typeof enquadramentoSchema>

export const ORIGENS_DA_IMAGEM = ['cena', 'video', 'arquivo'] as const

/**
 * Uma imagem da thumb: de onde veio (uma cena do video, um quadro do video
 * pronto, um arquivo dele), o instante no arquivo, o tamanho do quadro, os
 * rostos (guardados: reabrir nao roda o detector de novo) e o enquadramento.
 */
export const imagemDaThumbSchema = z.object({
  origem: z.enum(ORIGENS_DA_IMAGEM),
  arquivo: z.string().min(1).max(1024),
  t: z.number().nonnegative(),
  largura: z.number().int().positive(),
  altura: z.number().int().positive(),
  /** null = ainda nao procurou (ou o detector nao respondeu). */
  rostos: z.array(rostoDaThumbSchema).nullable(),
  enquadramento: enquadramentoSchema.nullable(),
  /** A cena e do gancho (a 1a frase do roteiro). */
  gancho: z.boolean().optional(),
  /**
   * O trecho da CENA de onde o quadro saiu, em segundos dentro do arquivo
   * (sugestao ou quadro do video): o "Quadro dentro da cena" anda so nele.
   * Sem isto (imagem do PC, thumb antiga), a barra nao aparece.
   */
  trecho: z.object({ de: z.number().nonnegative(), ate: z.number().nonnegative() }).optional(),
})
export type ImagemDaThumb = z.infer<typeof imagemDaThumbSchema>

const pontoSchema = z.object({ x: z.number(), y: z.number() })
export type Ponto = z.infer<typeof pontoSchema>

/**
 * A thumb guardada (`modulos.recap.thumb` no recap, `modulos.thumb.thumb` no
 * modulo): tudo que ele mexeu, para reabrir a tela e continuar.
 * `textoY` = o meio do bloco de texto (fracao da altura); null = o padrao do
 * layout. A seta: `base`/`ponta` no quadro 1080x1920; null = a automatica.
 */
export const thumbDoProjetoSchema = z.object({
  versao: z.literal(1),
  layout: z.enum(['uma', 'duas']),
  linhas: z.tuple([z.string().max(60), z.string().max(60)]),
  cores: z.tuple([corSchema, corSchema]),
  fonte: z.enum(FONTES_DA_THUMB.map((f) => f.id) as [FonteDaThumb, ...FonteDaThumb[]]),
  textoY: z.number().min(0.2).max(0.8).nullable(),
  seta: z.object({
    ligada: z.boolean(),
    base: pontoSchema.nullable(),
    ponta: pontoSchema.nullable(),
  }),
  /** [a de cima (ou a unica), a de baixo]. */
  imagens: z.tuple([imagemDaThumbSchema.nullable(), imagemDaThumbSchema.nullable()]),
  /** O ultimo PNG salvo (so para mostrar). */
  salvoEm: z.string().max(1024).nullable().optional(),
  /**
   * "Tamanho do texto": o corpo das duas linhas em fracao do preset (1 = os
   * 182 px das refs). A largura util continua o teto de cada linha. Ausente
   * (thumb de antes) = 1.
   */
  tamanho: z.number().min(TAMANHO_MINIMO).max(TAMANHO_MAXIMO).default(1),
  /** O divisor na emenda (divisores.ts). Ausente (thumb de antes) = desligado. */
  divisor: divisorSchema.default(divisorPadrao),
  /** A "Rotacao" do bloco de texto (graus, ROTACAO_MAXIMA). Ausente (thumb de antes) = 0. */
  rotacao: z.number().min(-ROTACAO_MAXIMA).max(ROTACAO_MAXIMA).default(0),
})
export type ThumbDoProjeto = z.infer<typeof thumbDoProjetoSchema>

/** A thumb guardada no projeto (null = nao tem, ou nao passa: a tela comeca do padrao). */
export function thumbDoProjeto(cru: unknown): ThumbDoProjeto | null {
  const lido = thumbDoProjetoSchema.safeParse(cru)
  return lido.success ? lido.data : null
}

export function thumbPadrao(textoDeThumb: string | null): ThumbDoProjeto {
  return {
    versao: 1,
    layout: 'duas',
    linhas: partirEmDuasLinhas(textoDeThumb ?? ''),
    cores: [COR_LINHA_1, COR_LINHA_2],
    fonte: FONTE_PADRAO,
    textoY: null,
    seta: { ligada: true, base: null, ponta: null },
    imagens: [null, null],
    salvoEm: null,
    tamanho: 1,
    divisor: divisorPadrao(),
    rotacao: 0,
  }
}

/**
 * O meio do bloco de texto quando ele nao mexeu. Duas imagens: 52% (as refs).
 * Uma imagem: a ref "PODER SUPREMO" tem 46%, mas o quadro 16:9 do episodio
 * cobrindo 1080x1920 fica 4x maior e o close passa da metade da tela -- a 46%
 * o texto tapava a boca e quase os olhos (Black Clover S02E04); 55% deixa o
 * rosto inteiro em cima.
 */
export function textoYPadrao(layout: ThumbDoProjeto['layout']): number {
  return layout === 'uma' ? 0.55 : 0.515
}

// ------------------------------------------------------------ a geometria

/**
 * O que so quem tem a fonte carregada sabe medir, num corpo: a caixa REAL das
 * letras desenhadas (a tinta, nao a caixa da linha da fonte), com a origem a
 * esquerda na linha de base. `cap` = quanto a tinta sobe; `desce` = quanto
 * desce (o "Q", o "J" e a sobra do "O"); `esquerda`/`direita` = ate onde vai
 * para cada lado da origem. Sem os opcionais (o teste): a largura do avanco,
 * nada abaixo da base.
 */
export type MedirTexto = (texto: string, px: number) => { largura: number; cap: number; desce?: number; esquerda?: number; direita?: number }

/**
 * O AJUSTE FINO DE CADA FONTE: a esticada vertical do PSD (1,11) e da Luckiest
 * Guy, a das refs; Bangers e Anton ja sao altas e estreitas e a Komika Axis
 * inclinada -- esticadas, ficavam desproporcionais. A posicao nao precisa de
 * ajuste: o empilhar e o centralizar vem da tinta medida (MedirTexto).
 */
export const AJUSTE_DA_FONTE: Record<FonteDaThumb, { esticada: number }> = {
  luckiest: { esticada: ESTICADA_Y },
  bangers: { esticada: 1 },
  anton: { esticada: 1 },
  komika: { esticada: 1 },
}

export interface LinhaNaThumb {
  /** Qual das duas linhas do editor (a vazia nao entra na geometria). */
  linha: 0 | 1
  texto: string
  /** O corpo (horizontal) depois de caber na largura. */
  px: number
  /** A linha bateu na largura util (o corpo pedido nao coube e ela encolheu ate caber). */
  noMaximo: boolean
  /** A largura da TINTA (as letras desenhadas), sem o contorno. */
  largura: number
  /** Quanto a tinta sobe da linha de base, JA esticada. */
  cap: number
  /** Quanto a tinta desce da linha de base, ja esticada (0 nas maiusculas retas). */
  desce: number
  /** A linha de base (y do quadro). */
  base: number
  /** A origem do texto alinhado a esquerda (x do quadro): a tinta fica centrada na largura. */
  x: number
  /** A esticada vertical desta fonte (AJUSTE_DA_FONTE). */
  esticada: number
  contorno: number
}

/**
 * A EMENDA INCLINADA: a reta y = y + (x - LARGURA/2) * tan, que passa pelo
 * meio da emenda reta. A imagem de cima acaba nela e a de baixo comeca nela.
 */
export interface CorteDaEmenda {
  y: number
  tan: number
}

/** O y da emenda no x (a reta inclinada; reta = o y dela). */
export function emendaNoX(corte: CorteDaEmenda, x: number): number {
  return corte.y + (x - LARGURA / 2) * corte.tan
}

export interface PainelDaThumb {
  /**
   * O retangulo do painel (y do quadro). Com a emenda inclinada, e a caixa da
   * regiao dele (um trapezio): a imagem cobre a caixa inteira (o zoom minimo e
   * o arrastar contam a ponta que desce ate a emenda), e o desenho recorta a
   * regiao (regiaoDoPainel).
   */
  y0: number
  y1: number
  /** Qual painel: a unica imagem, a de cima ou a de baixo. */
  lugar: 'unica' | 'cima' | 'baixo'
  /** A emenda (2 imagens): a de cima acaba nela, a de baixo comeca nela. null = 1 imagem. */
  corte: CorteDaEmenda | null
  /** Onde a cabeca deve ficar (y do quadro): dentro da area segura e fora do texto. */
  faixa: { de: number; ate: number }
}

export interface GeometriaDaThumb {
  linhas: LinhaNaThumb[]
  /**
   * A rotacao do bloco (graus, negativo = sobe para a direita) e o meio dele
   * (o pivo): as linhas acima estao no referencial do bloco RETO; na tela, giram
   * em volta do pivo (paraATela).
   */
  rotacao: number
  pivo: Ponto
  /**
   * O bloco de texto (topo da 1a maiuscula ate a base da ultima), sem contorno.
   * Girado: a caixa (alinhada a tela) do bloco girado. null = sem texto.
   */
  bloco: {
    topo: number
    base: number
    esquerda: number
    direita: number
  } | null
  /** A emenda das duas imagens (layout 'duas'): o y no meio do quadro (inclinada, a reta passa por ele). */
  emenda: number | null
  /** A inclinacao da emenda (graus, a conta do canvas; 0 = reta, e sempre 0 com 1 imagem). */
  inclinacao: number
  paineis: PainelDaThumb[]
}

/** Gira um ponto em volta do pivo (graus, a conta do canvas: y para baixo, positivo = horario). */
export function girar(p: Ponto, pivo: Ponto, graus: number): Ponto {
  if (graus === 0) return { x: p.x, y: p.y }
  const a = (graus * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const dx = p.x - pivo.x
  const dy = p.y - pivo.y
  return { x: pivo.x + dx * c - dy * s, y: pivo.y + dx * s + dy * c }
}

/** Os 4 cantos da tinta de uma linha (com `folga` em volta), no referencial do bloco reto. */
function cantosDaLinha(l: Pick<LinhaNaThumb, 'largura' | 'cap' | 'desce' | 'base'>, folga: number): Ponto[] {
  const x1 = LARGURA / 2 - l.largura / 2 - folga
  const x2 = LARGURA / 2 + l.largura / 2 + folga
  const y1 = l.base - l.cap - folga
  const y2 = l.base + l.desce + folga
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ]
}

/** Um ponto da tela no referencial do bloco reto (o contrario de girar o bloco). */
export function paraOBloco(geo: Pick<GeometriaDaThumb, 'rotacao' | 'pivo'>, p: Ponto): Ponto {
  return girar(p, geo.pivo, -geo.rotacao)
}

/** Um ponto do referencial do bloco reto na tela (girado com o bloco). */
export function paraATela(geo: Pick<GeometriaDaThumb, 'rotacao' | 'pivo'>, p: Ponto): Ponto {
  return girar(p, geo.pivo, geo.rotacao)
}

/** O ponto da tela cai na tinta de alguma linha (girada), com o contorno e mais `folga`. */
export function pontoNoTexto(geo: Pick<GeometriaDaThumb, 'rotacao' | 'pivo' | 'linhas'>, p: Ponto, folga = 0): boolean {
  const q = paraOBloco(geo, p)
  return geo.linhas.some((l) => {
    const f = l.contorno + folga
    return Math.abs(q.x - LARGURA / 2) <= l.largura / 2 + f && q.y >= l.base - l.cap - f && q.y <= l.base + l.desce + f
  })
}

/** Folga entre a cabeca e o texto (o contorno e a sombra ocupam ~25 px). */
const FOLGA_DO_TEXTO = 28
/** Faixa menor que isto (o texto arrastado para a ponta): vale a area segura inteira do painel. */
const FAIXA_MINIMA = 160

export function geometriaDaThumb(
  t: Pick<ThumbDoProjeto, 'layout' | 'linhas' | 'textoY'> & {
    fonte?: FonteDaThumb
    tamanho?: number
    rotacao?: number
    divisor?: { inclinacao?: number } | null
  },
  medir: MedirTexto,
): GeometriaDaThumb {
  const maxLargura = LARGURA * LARGURA_UTIL
  const esticada = AJUSTE_DA_FONTE[t.fonte ?? FONTE_PADRAO]?.esticada ?? ESTICADA_Y
  /** A tinta da linha: a largura, os lados e a altura (para cima e para baixo da base). */
  const tinta = (texto: string, px: number) => {
    const m = medir(texto, px)
    const esquerda = m.esquerda ?? 0
    const direita = m.direita ?? m.largura
    return { largura: Math.max(1, esquerda + direita), esquerda, direita, cap: m.cap > 0 ? m.cap : px * 0.7, desce: Math.max(0, m.desce ?? 0) }
  }
  const linhaEm = (i: number, texto: string, px: number, noMaximo: boolean): LinhaNaThumb => {
    const m = tinta(texto, px)
    return {
      linha: i === 0 ? 0 : 1,
      texto,
      px,
      noMaximo,
      largura: m.largura,
      cap: m.cap * esticada,
      desce: m.desce * esticada,
      base: 0,
      // A tinta centrada na largura (a Komika inclinada e a sobra de cada letra nao puxam para um lado).
      x: LARGURA / 2 - (m.direita - m.esquerda) / 2,
      esticada,
      contorno: px * CONTORNO_POR_PX,
    }
  }
  // O "Tamanho do texto": as duas linhas juntas; o teto de cada uma continua a largura util.
  const tamanho = Math.max(TAMANHO_MINIMO, Math.min(TAMANHO_MAXIMO, t.tamanho ?? 1))
  const graus = Math.max(-ROTACAO_MAXIMA, Math.min(ROTACAO_MAXIMA, t.rotacao ?? 0))
  const corpo = CORPO_PX * tamanho
  const textos = t.linhas.map((l) => l.trim().toLocaleUpperCase('pt-BR'))
  let linhas: LinhaNaThumb[] = []
  for (const [i, texto] of textos.entries()) {
    if (!texto) continue
    let px = corpo
    const m = tinta(texto, px)
    const total = m.largura + 2 * px * CONTORNO_POR_PX
    const noMaximo = total > maxLargura
    // Palavra comprida ("ENCONTRO"): so esta linha encolhe, sem quebrar.
    // O contorno e a sombra encolhem junto (sao proporcionais ao corpo): a linha inteira cabe em LARGURA_UTIL.
    if (noMaximo) px = Math.max(CORPO_MINIMO, (px * maxLargura) / total)
    linhas.push(linhaEm(i, texto, px, noMaximo))
  }
  const centro = (t.textoY ?? textoYPadrao(t.layout)) * ALTURA
  const pivo = { x: LARGURA / 2, y: centro }
  /** Empilha as linhas na altura (a base de cada uma); devolve a altura do bloco. */
  const empilhar = (): number => {
    if (linhas.length === 0) return 0
    // Cada linha na altura REAL dela (depois de encolher para caber): o vao e o "quase encostado" das
    // refs proporcional a linha MENOR, e nunca menor que o contorno mais grosso -- o contorno de uma
    // encosta nas letras da outra, sem invadir. As duas grandes: o vao das refs, igual a antes.
    const menor = Math.min(...linhas.map((l) => l.cap))
    const contornoMaior = Math.max(...linhas.map((l) => l.contorno))
    const vao = linhas.length > 1 ? Math.max(menor * VAO_ENTRE_LINHAS, contornoMaior) : 0
    // Empilhadas pela TINTA: o fundo das letras de uma, o vao, o topo das letras da outra -- o mesmo
    // espaco com qualquer fonte, e o bloco das letras no meio da altura do slider.
    const altura = linhas.reduce((s, l) => s + l.cap + l.desce, 0) + vao * (linhas.length - 1)
    let y = centro - altura / 2
    for (const l of linhas) {
      l.base = y + l.cap
      y = l.base + l.desce + vao
    }
    return altura
  }
  let altura = empilhar()
  if (graus !== 0 && linhas.length > 0) {
    // GIRADO, a linha (com o contorno) ainda cabe na largura util: a ponta de cima de um lado e a de baixo
    // do outro passam da largura reta. A que passa encolhe (so ela) ate caber; as alturas se refazem.
    const meia = maxLargura / 2
    for (let volta = 0; volta < 12; volta++) {
      let mexeu = false
      linhas = linhas.map((l) => {
        const lado = Math.max(...cantosDaLinha(l, l.contorno).map((p) => Math.abs(girar(p, pivo, graus).x - pivo.x)))
        if (lado <= meia + 0.25) return l
        mexeu = true
        const px = Math.max(CORPO_MINIMO, l.px * (meia / lado) * 0.999)
        return { ...linhaEm(l.linha, l.texto, px, true), base: l.base }
      })
      if (!mexeu) break
      altura = empilhar()
    }
  }
  let bloco: GeometriaDaThumb['bloco'] = null
  if (linhas.length > 0) {
    const maior = Math.max(...linhas.map((l) => l.largura))
    bloco = {
      topo: centro - altura / 2,
      base: centro + altura / 2,
      esquerda: (LARGURA - maior) / 2,
      direita: (LARGURA + maior) / 2,
    }
    if (graus !== 0) {
      // A caixa do bloco girado (a tinta, sem o contorno): o rosto, a seta e as faixas a respeitam inteira.
      const cantos = linhas.flatMap((l) => cantosDaLinha(l, 0).map((p) => girar(p, pivo, graus)))
      bloco = {
        topo: Math.min(...cantos.map((p) => p.y)),
        base: Math.max(...cantos.map((p) => p.y)),
        esquerda: Math.min(...cantos.map((p) => p.x)),
        direita: Math.max(...cantos.map((p) => p.x)),
      }
    }
  }
  // O automatico mira a area segura com a folga (19%-81%); o aviso so acusa as faixas proibidas.
  const seguraDe = (AREA_SEGURA_TOPO + FOLGA_DA_AREA) * ALTURA
  const seguraAte = (AREA_SEGURA_BASE - FOLGA_DA_AREA) * ALTURA
  const acima = bloco ? bloco.topo - FOLGA_DO_TEXTO : centro
  const abaixo = bloco ? bloco.base + FOLGA_DO_TEXTO + SOMBRA_Y : centro
  const faixa = (de: number, ate: number, y0: number, y1: number): PainelDaThumb['faixa'] =>
    ate - de >= FAIXA_MINIMA ? { de, ate } : { de: Math.max(seguraDe, y0), ate: Math.min(seguraAte, y1) }
  if (t.layout === 'uma') {
    return {
      linhas,
      rotacao: graus,
      pivo,
      bloco,
      emenda: null,
      inclinacao: 0,
      paineis: [
        {
          y0: 0,
          y1: ALTURA,
          lugar: 'unica',
          corte: null,
          faixa: faixa(seguraDe, Math.min(seguraAte, acima), 0, ALTURA),
        },
      ],
    }
  }
  // A emenda no meio do bloco (o pivo, girado ou nao): o texto cobre a costura (as refs).
  const emenda = Math.round(Math.max(ALTURA * 0.3, Math.min(ALTURA * 0.7, centro)))
  // Inclinada, a reta passa pelo meio dela: a caixa de cada painel vai ate a ponta mais funda da emenda
  // (a de cima desce ate o lado mais baixo, a de baixo sobe ate o mais alto). Reta: os paineis de antes.
  const inclinacao = Math.max(-INCLINACAO_MAXIMA, Math.min(INCLINACAO_MAXIMA, t.divisor?.inclinacao ?? 0))
  const corte: CorteDaEmenda = { y: emenda, tan: inclinacao === 0 ? 0 : Math.tan((inclinacao * Math.PI) / 180) }
  const meia = (Math.abs(corte.tan) * LARGURA) / 2
  const fundo = Math.ceil(emenda + meia)
  const alto = Math.floor(emenda - meia)
  return {
    linhas,
    rotacao: graus,
    pivo,
    bloco,
    emenda,
    inclinacao,
    paineis: [
      {
        y0: 0,
        y1: fundo,
        lugar: 'cima',
        corte,
        // A faixa vai ate a ponta mais funda da emenda; no x do rosto, o enquadramento confere a reta.
        faixa: faixa(seguraDe, Math.min(fundo, acima), 0, fundo),
      },
      {
        y0: alto,
        y1: ALTURA,
        lugar: 'baixo',
        corte,
        faixa: faixa(Math.max(alto, abaixo), seguraAte, alto, ALTURA),
      },
    ],
  }
}

/**
 * A REGIAO de um painel no quadro (o poligono que o desenho recorta): 1 imagem,
 * o quadro inteiro; 2, acima da emenda (a de cima) ou abaixo dela (a de baixo).
 */
export function regiaoDoPainel(painel: Pick<PainelDaThumb, 'y0' | 'y1' | 'lugar' | 'corte'>): Ponto[] {
  const c = painel.corte
  if (!c || painel.lugar === 'unica') {
    return [
      { x: 0, y: painel.y0 },
      { x: LARGURA, y: painel.y0 },
      { x: LARGURA, y: painel.y1 },
      { x: 0, y: painel.y1 },
    ]
  }
  const esq = emendaNoX(c, 0)
  const dir = emendaNoX(c, LARGURA)
  return painel.lugar === 'cima'
    ? [
        { x: 0, y: 0 },
        { x: LARGURA, y: 0 },
        { x: LARGURA, y: dir },
        { x: 0, y: esq },
      ]
    : [
        { x: 0, y: esq },
        { x: LARGURA, y: dir },
        { x: LARGURA, y: ALTURA },
        { x: 0, y: ALTURA },
      ]
}

/** Em que painel cai um ponto do quadro (2 imagens: de que lado da emenda inclinada). */
export function painelNoPonto(geo: Pick<GeometriaDaThumb, 'paineis'>, p: Ponto): 0 | 1 {
  const c = geo.paineis[1]?.corte
  if (!c) return 0
  return p.y >= emendaNoX(c, p.x) ? 1 : 0
}

// ------------------------------------------------------- o enquadramento

/** O retangulo da imagem (px dela) que aparece no painel, e a escala (px do quadro por px da imagem). */
export interface RecorteDaImagem {
  sx: number
  sy: number
  sw: number
  sh: number
  escala: number
}

function limitar(v: number, de: number, ate: number): number {
  return Math.max(de, Math.min(ate, v))
}

export function escalaQueCobre(painel: Pick<PainelDaThumb, 'y0' | 'y1'>, img: { largura: number; altura: number }): number {
  return Math.max(LARGURA / img.largura, (painel.y1 - painel.y0) / img.altura)
}

/** O pedaco da imagem que o painel mostra com este enquadramento (sempre cobrindo o painel). */
export function recorteDaImagem(painel: Pick<PainelDaThumb, 'y0' | 'y1'>, img: { largura: number; altura: number }, e: Enquadramento | null): RecorteDaImagem {
  const enq = e ?? { zoom: 1, cx: 0.5, cy: 0.5 }
  const escala = escalaQueCobre(painel, img) * limitar(enq.zoom, 1, 4)
  const sw = Math.min(img.largura, LARGURA / escala)
  const sh = Math.min(img.altura, (painel.y1 - painel.y0) / escala)
  const sx = limitar(enq.cx * img.largura - sw / 2, 0, img.largura - sw)
  const sy = limitar(enq.cy * img.altura - sh / 2, 0, img.altura - sh)
  return { sx, sy, sw, sh, escala }
}

/** O enquadramento que de fato aparece (o centro preso para a imagem cobrir o painel). */
export function enquadramentoPreso(painel: Pick<PainelDaThumb, 'y0' | 'y1'>, img: { largura: number; altura: number }, e: Enquadramento): Enquadramento {
  const r = recorteDaImagem(painel, img, e)
  return {
    zoom: limitar(e.zoom, 1, 4),
    cx: (r.sx + r.sw / 2) / img.largura,
    cy: (r.sy + r.sh / 2) / img.altura,
  }
}

/**
 * A CABECA a partir do rosto do detector (a caixa do YOLO de anime vai da
 * franja ao queixo): o alto da cabeca fica ~25% da altura dela acima. O
 * cabelo espetado (os chifres do Asta) passa disso e pode encostar na faixa;
 * o cranio e o rosto, nao. Medido no Black Clover S02E04: com 45% (o cabelo
 * inteiro) nenhum close cabia entre 16% e o texto.
 */
export function cabecaDoRosto(r: RostoDaThumb): {
  x1: number
  y1: number
  x2: number
  y2: number
} {
  return {
    x1: r.x - 0.1 * r.w,
    y1: r.y - 0.25 * r.h,
    x2: r.x + 1.1 * r.w,
    y2: r.y + 1.02 * r.h,
  }
}

/** Os rostos que contam: o maior e quem tem pelo menos 45% da largura dele (o figurante pequeno fica de fora). */
export function rostosPrincipais(rostos: readonly RostoDaThumb[] | null): RostoDaThumb[] {
  const lista = (rostos ?? []).filter((r) => r.conf >= 0.3).sort((a, b) => b.w * b.h - a.w * a.h)
  const maior = lista[0]
  return maior ? lista.filter((r) => r.w >= maior.w * 0.45) : []
}

/** A cabeca ocupa no maximo isto da faixa no automatico (o personagem inteiro, nao um close forcado). */
const CABECA_NA_FAIXA = 0.55
/** O automatico amplia no maximo isto alem de cobrir por gosto; para caber na faixa, ate ZOOM_PARA_CABER. */
const ZOOM_POR_GOSTO = 1.6
const ZOOM_PARA_CABER = 3

type Caixa = { x1: number; y1: number; x2: number; y2: number }

/**
 * O que PRECISA caber na faixa, do mais ao menos exigente: a cabeca inteira
 * (do alto do cranio ao queixo) e, se nao couber de jeito nenhum (o close de
 * um quadro 16:9 num painel de 1080), o essencial -- na metade de cima, do
 * cranio ao nariz (o texto pode cobrir o queixo, nunca os olhos); na de
 * baixo, da testa ao queixo (o cabelo pode passar por tras do texto).
 */
function caixasParaCaber(r: RostoDaThumb, lugar: 'cima' | 'baixo' | 'unica'): Caixa[] {
  const inteira = cabecaDoRosto(r)
  const essencial =
    lugar === 'baixo'
      ? { x1: r.x, y1: r.y + 0.05 * r.h, x2: r.x + r.w, y2: r.y + r.h }
      : { x1: r.x, y1: r.y - 0.2 * r.h, x2: r.x + r.w, y2: r.y + 0.7 * r.h }
  return [inteira, essencial]
}

/**
 * O ENQUADRAMENTO AUTOMATICO de uma imagem num painel: a(s) cabeca(s)
 * principais dentro da faixa do painel (area segura com a folga de 3%, fora
 * do texto), no meio dela, e centradas na horizontal. Uma imagem 16:9
 * cobrindo o painel quase nao tem folga na vertical: amplia o minimo que deixa
 * a cabeca caber (ate 3x), e um pouco mais quando o rosto e pequeno demais
 * (ate 1,6x). A cabeca inteira nao cabe: o essencial (caixasParaCaber). Sem
 * rosto, o meio da imagem.
 */
export function enquadrarSozinho(
  painel: PainelDaThumb,
  img: { largura: number; altura: number },
  rostos: readonly RostoDaThumb[] | null,
  lugar: 'cima' | 'baixo' | 'unica' = 'cima',
): Enquadramento {
  const principais = rostosPrincipais(rostos)
  if (principais.length === 0) return { zoom: 1, cx: 0.5, cy: 0.5 }
  const PH = painel.y1 - painel.y0
  const cobre = escalaQueCobre(painel, img)
  const de = painel.faixa.de - painel.y0
  const ate = painel.faixa.ate - painel.y0
  const alturaDaFaixa = Math.max(1, ate - de)
  const emPx = (c: Caixa): Caixa => ({ x1: c.x1 * img.largura, y1: c.y1 * img.altura, x2: c.x2 * img.largura, y2: c.y2 * img.altura })
  const unir = (cs: Caixa[]): Caixa => ({
    x1: Math.min(...cs.map((c) => c.x1)),
    y1: Math.min(...cs.map((c) => c.y1)),
    x2: Math.max(...cs.map((c) => c.x2)),
    y2: Math.max(...cs.map((c) => c.y2)),
  })
  const tentar = (nivel: number): { s: number; ox: number; oy: number; sobra: number } => {
    let uniao = unir(principais.map((r) => emPx(caixasParaCaber(r, lugar)[nivel]!)))
    // Os rostos que nao cabem juntos na largura: fica so o maior.
    if ((uniao.x2 - uniao.x1) * cobre > LARGURA * 0.94) uniao = emPx(caixasParaCaber(principais[0]!, lugar)[nivel]!)
    const alturaDaCabeca = Math.max(1, uniao.y2 - uniao.y1)
    const larguraDaCabeca = Math.max(1, uniao.x2 - uniao.x1)
    // Por gosto: a cabeca pequena cresce ate CABECA_NA_FAIXA da faixa (sem passar da largura).
    // So na cabeca inteira: no essencial, ampliar por gosto empurra o queixo para tras do texto.
    let s0 = nivel === 0 ? limitar((alturaDaFaixa * CABECA_NA_FAIXA) / alturaDaCabeca, cobre, cobre * ZOOM_POR_GOSTO) : cobre
    s0 = Math.max(cobre, Math.min(s0, (LARGURA * 0.92) / larguraDaCabeca))
    const posicionar = (s: number): { ox: number; oy: number; sobra: number } => {
      const cy = (uniao.y1 + uniao.y2) / 2
      const cx = (uniao.x1 + uniao.x2) / 2
      const ox = limitar(LARGURA / 2 - cx * s, LARGURA - img.largura * s, 0)
      // A EMENDA INCLINADA no x do rosto (nao a reta): a cabeca de cima acima dela nas duas beiradas da
      // cabeca, a de baixo abaixo dela.
      let deX = de
      let ateX = ate
      const c = painel.corte
      if (c && c.tan !== 0 && lugar !== 'unica') {
        const ya = emendaNoX(c, ox + uniao.x1 * s) - painel.y0
        const yb = emendaNoX(c, ox + uniao.x2 * s) - painel.y0
        if (lugar === 'cima') ateX = Math.min(ate, ya, yb)
        else deX = Math.max(de, ya, yb)
      }
      const oy = limitar((deX + ateX) / 2 - cy * s, PH - img.altura * s, 0)
      const topo = oy + uniao.y1 * s
      const base = oy + uniao.y2 * s
      // Passar para o lado da faixa PROIBIDA pesa 3x passar para o lado do texto: sem caber, o
      // rosto de cima pode descer para tras do texto, o de baixo subir -- nunca entrar nas faixas do TikTok.
      const pesoDoTopo = lugar === 'baixo' ? 1 : 3
      const pesoDaBase = lugar === 'baixo' ? 3 : 1
      return { ox, oy, sobra: pesoDoTopo * Math.max(0, deX - topo) + pesoDaBase * Math.max(0, base - ateX) }
    }
    let melhor = { s: s0, ...posicionar(s0) }
    for (let s = s0; s <= cobre * ZOOM_PARA_CABER && melhor.sobra > 0.5; s *= 1.03) {
      const p = posicionar(s)
      if (p.sobra < melhor.sobra - 0.5) melhor = { s, ...p }
    }
    return melhor
  }
  const inteira = tentar(0)
  const melhor = inteira.sobra <= 0.5 ? inteira : tentar(1)
  return {
    zoom: limitar(melhor.s / cobre, 1, 4),
    cx: limitar((LARGURA / 2 - melhor.ox) / melhor.s / img.largura, 0, 1),
    cy: limitar((PH / 2 - melhor.oy) / melhor.s / img.altura, 0, 1),
  }
}

/** Um rosto da imagem no quadro 1080x1920 (a cabeca inteira), recortado ao painel. null = fora do painel. */
export function cabecaNoQuadro(
  painel: Pick<PainelDaThumb, 'y0' | 'y1'> & Partial<Pick<PainelDaThumb, 'lugar' | 'corte'>>,
  img: { largura: number; altura: number },
  e: Enquadramento | null,
  r: RostoDaThumb,
): {
  x1: number
  y1: number
  x2: number
  y2: number
  rosto: { x1: number; y1: number; x2: number; y2: number }
} | null {
  const rec = recorteDaImagem(painel, img, e)
  const para = (c: { x1: number; y1: number; x2: number; y2: number }) => ({
    x1: (c.x1 * img.largura - rec.sx) * rec.escala,
    y1: painel.y0 + (c.y1 * img.altura - rec.sy) * rec.escala,
    x2: (c.x2 * img.largura - rec.sx) * rec.escala,
    y2: painel.y0 + (c.y2 * img.altura - rec.sy) * rec.escala,
  })
  const cab = para(cabecaDoRosto(r))
  const rosto = para({ x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h })
  // O pedaco do painel que aparece no x do rosto: com a emenda inclinada, a de cima acaba nela e a de
  // baixo comeca nela (reta: o proprio painel).
  let topo = painel.y0
  let fim = painel.y1
  if (painel.corte && painel.lugar && painel.lugar !== 'unica') {
    const y = emendaNoX(painel.corte, (rosto.x1 + rosto.x2) / 2)
    if (painel.lugar === 'cima') fim = Math.min(fim, y)
    else topo = Math.max(topo, y)
  }
  // So conta o rosto que aparece: pelo menos metade dele dentro do painel.
  const vx = Math.max(0, Math.min(rosto.x2, LARGURA) - Math.max(rosto.x1, 0))
  const vy = Math.max(0, Math.min(rosto.y2, fim) - Math.max(rosto.y1, topo))
  if (vx * vy < 0.5 * (rosto.x2 - rosto.x1) * (rosto.y2 - rosto.y1)) return null
  return {
    x1: Math.max(0, cab.x1),
    y1: Math.max(topo, cab.y1),
    x2: Math.min(LARGURA, cab.x2),
    y2: Math.min(fim, cab.y2),
    rosto,
  }
}

export interface AvisoDaArea {
  painel: number
  tipo: 'topo' | 'base' | 'texto'
  texto: string
}

/**
 * Os avisos da regra: cabeca (rosto + cabelo) de um personagem principal nas
 * faixas proibidas (0-13% e 87-100%), ou o rosto atras do texto. Um aviso
 * por painel e tipo.
 */
export function avisosDaAreaSegura(t: Pick<ThumbDoProjeto, 'layout' | 'imagens'>, geo: GeometriaDaThumb): AvisoDaArea[] {
  const avisos: AvisoDaArea[] = []
  const nomes = t.layout === 'uma' ? ['Imagem'] : ['Imagem de cima', 'Imagem de baixo']
  geo.paineis.forEach((painel, i) => {
    const img = t.imagens[i]
    if (!img) return
    const tipos = new Set<AvisoDaArea['tipo']>()
    for (const r of rostosPrincipais(img.rostos)) {
      const c = cabecaNoQuadro(painel, img, img.enquadramento, r)
      if (!c) continue
      if (c.y1 < ZONA_PROIBIDA_TOPO * ALTURA) tipos.add('topo')
      if (c.y2 > ZONA_PROIBIDA_BASE * ALTURA) tipos.add('base')
      const b = geo.bloco
      if (b) {
        // Os olhos: a faixa de 20% a 60% da caixa do rosto. O queixo atras do texto e aceito.
        const h = c.rosto.y2 - c.rosto.y1
        const olhos = { y1: c.rosto.y1 + 0.2 * h, y2: c.rosto.y1 + 0.6 * h }
        const ix = Math.max(0, Math.min(c.rosto.x2, b.direita) - Math.max(c.rosto.x1, b.esquerda))
        const iy = Math.max(0, Math.min(olhos.y2, b.base) - Math.max(olhos.y1, b.topo))
        if (ix * iy > 0.35 * (c.rosto.x2 - c.rosto.x1) * (olhos.y2 - olhos.y1)) tipos.add('texto')
      }
    }
    const nome = nomes[i] ?? 'A imagem'
    if (tipos.has('topo'))
      avisos.push({
        painel: i,
        tipo: 'topo',
        texto: `${nome}: cabeca na faixa proibida de cima (0-13%).`,
      })
    if (tipos.has('base'))
      avisos.push({
        painel: i,
        tipo: 'base',
        texto: `${nome}: rosto na faixa proibida de baixo (87-100%).`,
      })
    if (tipos.has('texto'))
      avisos.push({
        painel: i,
        tipo: 'texto',
        texto: `${nome}: o texto cobre os olhos. Mova a imagem ou a altura do texto.`,
      })
  })
  return avisos
}

// ---------------------------------------------------------------- a seta

export interface SetaNoQuadro {
  /** A ponta da cauda. */
  base: Ponto
  /** A ponta da cabeca. */
  ponta: Ponto
  /** +1 = a seta.png como e (a curva estufa para a esquerda de quem vai da cauda a ponta); -1 = espelhada. */
  lado: 1 | -1
}

/**
 * A SETA PADRAO (a `seta.png` do Levi, 360x360 -- a mesma das refs dele e do
 * Faah) VETORIZADA: o contorno do vermelho, no referencial da CORDA (a cauda em
 * (0,0), a ponta da cabeca em (1,0); y para a "direita" de quem vai da cauda a
 * ponta, na tela). Corpo curvo grosso que afina na cauda e cabeca larga; o
 * contorno preto e um traco por fora (CONTORNO_DA_SETA) com cantos redondos.
 * Conferido sobrepondo a png (scratchpad seta/build.py, 31/10): a silhueta com
 * o contorno bate em 98,7% (IoU), a borda a no maximo ~1,3 px da png.
 *
 * A FORMA NUNCA MUDA: na tela, so escala uniforme, rotacao e espelho (a
 * similaridade que leva a cauda a `base` e a ponta a `ponta`; `lado` -1
 * espelha). Arrastar as bolinhas muda posicao, tamanho e giro, nunca a curva.
 */
export const SETA_PADRAO_SVG =
  'M 1 0 L 0.83178 -0.22623 L 0.79924 -0.13612 C 0.66612 -0.18961 0.53348 -0.19626 0.38452 -0.16595 C 0.25961 -0.14053 0.09076 -0.07517 -0.00321 -0.00321 L 0.00321 0.00321 C 0.2467 -0.06725 0.53737 -0.08977 0.75552 0.02462 L 0.72898 0.11778 Z'

export type PassoDaSeta = { tipo: 'M' | 'L'; p: Ponto } | { tipo: 'C'; c1: Ponto; c2: Ponto; p: Ponto }

/** O SETA_PADRAO_SVG em passos (o canvas e os testes nao leem SVG). */
export const FORMA_DA_SETA: readonly PassoDaSeta[] = [
  { tipo: 'M', p: { x: 1, y: 0 } },
  { tipo: 'L', p: { x: 0.83178, y: -0.22623 } },
  { tipo: 'L', p: { x: 0.79924, y: -0.13612 } },
  { tipo: 'C', c1: { x: 0.66612, y: -0.18961 }, c2: { x: 0.53348, y: -0.19626 }, p: { x: 0.38452, y: -0.16595 } },
  { tipo: 'C', c1: { x: 0.25961, y: -0.14053 }, c2: { x: 0.09076, y: -0.07517 }, p: { x: -0.00321, y: -0.00321 } },
  { tipo: 'L', p: { x: 0.00321, y: 0.00321 } },
  { tipo: 'C', c1: { x: 0.2467, y: -0.06725 }, c2: { x: 0.53737, y: -0.08977 }, p: { x: 0.75552, y: 0.02462 } },
  { tipo: 'L', p: { x: 0.72898, y: 0.11778 } },
]

/** O contorno preto da png (6,8 px numa corda de 324): fracao da corda. */
export const CONTORNO_DA_SETA = 0.02107

/**
 * O degrade da png (linear, medido: o vermelho puro em cima a esquerda e o
 * escuro na cabeca, embaixo), no referencial da corda: `de` = #ff0000, `ate` =
 * #960000 (fora deles, a cor da ponta).
 */
export const DEGRADE_DA_SETA = {
  de: { x: 0.44026, y: -0.2145 },
  ate: { x: 0.50855, y: 0.27414 },
  cores: ['#ff0000', '#960000'] as const,
}

/** A cabeca aponta 13,9 graus "para a direita" da corda (a png): e ESTA direcao que mira o rosto. */
const ANGULO_DA_CABECA = (13.869 * Math.PI) / 180

/** A cabeca (a ponta, as asas, o pescoco e o meio): o que nunca fica atras do texto nem fora do quadro. */
const CABECA_DA_SETA: readonly Ponto[] = [
  { x: 1, y: 0 },
  { x: 0.83178, y: -0.22623 },
  { x: 0.79924, y: -0.13612 },
  { x: 0.75552, y: 0.02462 },
  { x: 0.72898, y: 0.11778 },
  { x: 0.85, y: -0.04 },
]

/** O ponto do referencial da corda na tela (a similaridade da seta). */
function naTela(s: SetaNoQuadro, p: Ponto): Ponto {
  const dx = s.ponta.x - s.base.x
  const dy = s.ponta.y - s.base.y
  return { x: s.base.x + p.x * dx - s.lado * p.y * dy, y: s.base.y + p.x * dy + s.lado * p.y * dx }
}

/** Os passos da seta na tela (a FORMA_DA_SETA levada pela similaridade). */
export function caminhoDaSeta(s: SetaNoQuadro): PassoDaSeta[] {
  return FORMA_DA_SETA.map((passo) =>
    passo.tipo === 'C' ? { tipo: 'C', c1: naTela(s, passo.c1), c2: naTela(s, passo.c2), p: naTela(s, passo.p) } : { tipo: passo.tipo, p: naTela(s, passo.p) },
  )
}

/** O degrade na tela (o comeco e o fim). */
export function degradeDaSeta(s: SetaNoQuadro): { de: Ponto; ate: Ponto } {
  return { de: naTela(s, DEGRADE_DA_SETA.de), ate: naTela(s, DEGRADE_DA_SETA.ate) }
}

/** Pontos por curva no poligono da seta. */
const PONTOS_POR_CURVA = 10

/**
 * O CONTORNO DA SETA como poligono (o vermelho, sem o traco preto), no quadro
 * 1080: as curvas viram PONTOS_POR_CURVA retas. Para a caixa, os testes e as
 * contas; quem desenha usa caminhoDaSeta (as curvas de verdade).
 */
export function contornoDaSeta(s: SetaNoQuadro): Ponto[] {
  const pontos: Ponto[] = []
  let atual: Ponto = { x: 0, y: 0 }
  for (const passo of caminhoDaSeta(s)) {
    if (passo.tipo !== 'C') {
      pontos.push(passo.p)
      atual = passo.p
      continue
    }
    for (let i = 1; i <= PONTOS_POR_CURVA; i++) {
      const t = i / PONTOS_POR_CURVA
      const a = (1 - t) ** 3
      const b = 3 * (1 - t) ** 2 * t
      const c = 3 * (1 - t) * t * t
      const d = t ** 3
      pontos.push({
        x: a * atual.x + b * passo.c1.x + c * passo.c2.x + d * passo.p.x,
        y: a * atual.y + b * passo.c1.y + c * passo.c2.y + d * passo.p.y,
      })
    }
    atual = passo.p
  }
  return pontos
}

/** A largura do contorno preto da seta (proporcional ao tamanho, como na png). */
export function contornoDaSetaPx(s: SetaNoQuadro): number {
  return CONTORNO_DA_SETA * Math.hypot(s.ponta.x - s.base.x, s.ponta.y - s.base.y)
}

/**
 * A SETA AUTOMATICA (as refs): a seta padrao, sempre GRANDE (a corda nunca
 * abaixo de SETA_MINIMA, o tamanho da ref "PODER SUPREMO"; e no maximo
 * SETA_MAXIMA), com a CABECA MIRANDO o meio do rosto principal da imagem de
 * cima e a ponta parando na borda dele. Rosto muito a esquerda: espelhada (sai
 * da direita). Sem rosto: mira o meio da imagem de cima. Tres jeitos, nesta
 * ordem:
 *
 * - AO LADO (a ref "PODER SUPREMO"): com espaco livre ao lado da 1a linha, a
 *   cauda sai da beirada dela, perto da base, e o corpo inteiro fica fora do
 *   texto (girado ou nao);
 * - POR CIMA (a ref "FALTOU EXPLICAR!" do Faah): a 1a linha larga nao deixa
 *   espaco ao lado -- a cauda fica logo acima da ponta dela e a seta inteira a
 *   vista, entre o texto e o rosto;
 * - POR TRAS (a ref "CANCELOU ENCONTRO"): nem em cima cabe (o close colado no
 *   texto) -- a cauda nasce embaixo, do lado, abaixo do texto, e o corpo sobe
 *   pela borda passando POR TRAS da letra da ponta (o texto e desenhado por
 *   cima; so a beirada se esconde).
 *
 * Nos dois: a seta inteira (com o contorno) dentro do quadro e fora das faixas
 * proibidas do TikTok, a cabeca inteira acima do texto e fora dele, e sem
 * cobrir o rosto. A procura: o giro em volta do rosto e o tamanho; ganha a
 * que deixa a cauda mais perto do lugar do jeito, com o giro mais perto o da
 * png e a menor.
 */
/** A corda (cauda a ponta) automatica nunca fica mais curta que isto (a ref "PODER SUPREMO": ~330 px; as refs vao de 300 a 700). */
export const SETA_MINIMA = 340
/** Nem mais comprida que isto: a forma cresce inteira (nao estica), e mais que isso engole a imagem. */
export const SETA_MAXIMA = 600
/** Espaco livre (px) entre a beirada do quadro e o contorno da 1a linha para a seta sair AO LADO dela. */
export const ESPACO_PARA_A_SETA = 150
/** A margem da seta ate a beirada do quadro. */
const MARGEM_DA_SETA = 12
/** A folga entre a ponta e a borda do rosto. */
const FOLGA_DO_ROSTO = 26
/** A ponta fica pelo menos isto acima do texto (a caixa dele). */
const FOLGA_ACIMA_DO_TEXTO = 20

/** O retangulo que a seta ocupa (o poligono com o contorno preto). */
export function caixaDaSeta(s: SetaNoQuadro): { x1: number; y1: number; x2: number; y2: number } {
  const pontos = contornoDaSeta(s)
  const c = contornoDaSetaPx(s)
  return {
    x1: Math.min(...pontos.map((p) => p.x)) - c,
    y1: Math.min(...pontos.map((p) => p.y)) - c,
    x2: Math.max(...pontos.map((p) => p.x)) + c,
    y2: Math.max(...pontos.map((p) => p.y)) + c,
  }
}

/** O ponto dentro do poligono (par-impar). */
function dentroDoPoligono(p: Ponto, poli: readonly Ponto[]): boolean {
  let dentro = false
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const a = poli[i]!
    const b = poli[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro
  }
  return dentro
}

/** Quanto do rosto (fracao, numa grade 9x9) a seta cobre. */
export function rostoCobertoPelaSeta(s: SetaNoQuadro, r: { x1: number; y1: number; x2: number; y2: number }): number {
  const poli = contornoDaSeta(s)
  let cobertos = 0
  for (let i = 0; i < 9; i++)
    for (let j = 0; j < 9; j++) {
      const p = { x: r.x1 + ((i + 0.5) / 9) * (r.x2 - r.x1), y: r.y1 + ((j + 0.5) / 9) * (r.y2 - r.y1) }
      if (dentroDoPoligono(p, poli)) cobertos += 1
    }
  return cobertos / 81
}

/** A cabeca da seta na tela (os pontos que nunca ficam atras do texto). */
export function cabecaDaSeta(s: SetaNoQuadro): Ponto[] {
  return CABECA_DA_SETA.map((p) => naTela(s, p))
}

/** A seta com a cabeca mirando o ponto `alvo` (angulo `mira` da cabeca), a ponta a `raio` dele e a corda `L`. */
function setaMirando(alvo: Ponto, raio: number, mira: number, L: number, lado: 1 | -1): SetaNoQuadro {
  const ponta = { x: alvo.x - raio * Math.cos(mira), y: alvo.y - raio * Math.sin(mira) }
  const corda = mira - lado * ANGULO_DA_CABECA
  return { base: { x: ponta.x - L * Math.cos(corda), y: ponta.y - L * Math.sin(corda) }, ponta, lado }
}

/** O angulo da cabeca na png (lado +1) e espelhada (-1): a mira "natural". */
function miraNatural(lado: 1 | -1): number {
  const corda = Math.atan2(-186.65, 264.35)
  const cabeca = corda + ANGULO_DA_CABECA
  return lado === 1 ? cabeca : Math.PI - cabeca
}

/** A diferenca entre dois angulos (rad, 0..pi). */
function entreAngulos(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI)
  return d > Math.PI ? 2 * Math.PI - d : d
}

type JeitoDaSeta = 'lado' | 'tras'

/** A linha do meio do corpo (da cauda ao meio da cabeca), no referencial da corda. */
const MEIO_DA_SETA: readonly Ponto[] = [
  { x: 0, y: 0 },
  { x: 0.073, y: -0.033 },
  { x: 0.148, y: -0.06 },
  { x: 0.225, y: -0.082 },
  { x: 0.304, y: -0.099 },
  { x: 0.383, y: -0.111 },
  { x: 0.464, y: -0.116 },
  { x: 0.545, y: -0.114 },
  { x: 0.625, y: -0.104 },
  { x: 0.703, y: -0.084 },
  { x: 0.777, y: -0.056 },
  { x: 0.85, y: -0.04 },
]
/** Por tras do texto: no maximo isto da linha do meio escondido (a ref "CANCELOU": a cauda e a cabeca aparecem). */
const ESCONDIDO_MAXIMO = 0.6
/** Por tras do texto: o que se esconde fica a no maximo isto da beirada do texto (atras da 1a letra, nao do meio). */
const ATRAS_DA_BEIRADA = 280

type Caixa2 = { x1: number; y1: number; x2: number; y2: number }

/**
 * A seta cabe na regra do jeito: no quadro, fora das faixas, a cabeca acima e
 * fora do texto, sem cobrir o rosto; AO LADO, o corpo inteiro fora do texto;
 * POR TRAS, a cauda abaixo do texto e o que se esconde so perto da beirada.
 */
function setaBoa(s: SetaNoQuadro, geo: GeometriaDaThumb, rosto: Caixa2, jeito: JeitoDaSeta): boolean {
  const bloco = geo.bloco!
  const c = caixaDaSeta(s)
  if (c.x1 < MARGEM_DA_SETA || c.x2 > LARGURA - MARGEM_DA_SETA) return false
  if (c.y1 < ZONA_PROIBIDA_TOPO * ALTURA || c.y2 > ZONA_PROIBIDA_BASE * ALTURA) return false
  if (s.ponta.y > bloco.topo - FOLGA_ACIMA_DO_TEXTO) return false
  // A cabeca aponta para cima ou de lado, nunca para baixo (as refs: a seta SOBE ate o rosto).
  if (Math.sin(direcaoDaCabeca(s)) > Math.sin((10 * Math.PI) / 180)) return false
  const contorno = contornoDaSetaPx(s)
  if (cabecaDaSeta(s).some((p) => pontoNoTexto(geo, p, contorno + 8))) return false
  if (jeito === 'lado') {
    // Ao lado: o corpo inteiro fora do texto (o poligono e a linha do meio dele).
    if (contornoDaSeta(s).some((p) => pontoNoTexto(geo, p, contorno))) return false
    if (MEIO_DA_SETA.some((p) => pontoNoTexto(geo, naTela(s, p), contorno))) return false
  } else {
    if (s.base.y < bloco.base || pontoNoTexto(geo, s.base, contorno)) return false
    const escondidos = MEIO_DA_SETA.map((p) => naTela(s, p)).filter((p) => pontoNoTexto(geo, p))
    if (escondidos.length > ESCONDIDO_MAXIMO * MEIO_DA_SETA.length) return false
    // So atras da letra da ponta: perto da beirada do texto do lado da cauda (no referencial do bloco).
    for (const p of escondidos) {
      const q = paraOBloco(geo, p)
      const l = geo.linhas.reduce((m, x) => (Math.abs(q.y - (x.base - x.cap / 2)) < Math.abs(q.y - (m.base - m.cap / 2)) ? x : m))
      const beirada = s.lado === 1 ? LARGURA / 2 - l.largura / 2 : LARGURA / 2 + l.largura / 2
      if (Math.abs(q.x - beirada) > ATRAS_DA_BEIRADA) return false
    }
  }
  return rostoCobertoPelaSeta(s, rosto) <= 0.03
}

/** A direcao da cabeca (rad, na tela). */
function direcaoDaCabeca(s: SetaNoQuadro): number {
  return Math.atan2(s.ponta.y - s.base.y, s.ponta.x - s.base.x) + s.lado * ANGULO_DA_CABECA
}

/**
 * A cabeca mira o rosto: o erro (graus) entre a direcao da cabeca e o meio dele, a distancia da ponta a
 * caixa e se a reta da cabeca ACERTA a caixa (o close grande: mirar a beirada dele ja e apontar o rosto).
 */
function miraNoRosto(s: SetaNoQuadro, F: Ponto, rosto: Caixa2): { erro: number; folga: number; acerta: boolean } {
  const cabeca = direcaoDaCabeca(s)
  const erro = (entreAngulos(cabeca, Math.atan2(F.y - s.ponta.y, F.x - s.ponta.x)) * 180) / Math.PI
  const fx = Math.max(rosto.x1 - s.ponta.x, 0, s.ponta.x - rosto.x2)
  const fy = Math.max(rosto.y1 - s.ponta.y, 0, s.ponta.y - rosto.y2)
  // A reta da ponta na direcao da cabeca cruza a caixa (encolhida 15%: nao vale raspar o canto)?
  const ex = 0.15 * (rosto.x2 - rosto.x1)
  const ey = 0.15 * (rosto.y2 - rosto.y1)
  const d = { x: Math.cos(cabeca), y: Math.sin(cabeca) }
  let t0 = 0
  let t1 = 400
  for (const [o, v, a, b] of [
    [s.ponta.x, d.x, rosto.x1 + ex, rosto.x2 - ex],
    [s.ponta.y, d.y, rosto.y1 + ey, rosto.y2 - ey],
  ] as const) {
    if (Math.abs(v) < 1e-9) {
      if (o < a || o > b) t1 = -1
      continue
    }
    const ta = (a - o) / v
    const tb = (b - o) / v
    t0 = Math.max(t0, Math.min(ta, tb))
    t1 = Math.min(t1, Math.max(ta, tb))
  }
  return { erro, folga: Math.hypot(fx, fy), acerta: t0 <= t1 }
}

export function setaSozinha(geo: GeometriaDaThumb, alvo: Caixa2 | null): SetaNoQuadro | null {
  const l1 = geo.linhas[0]
  if (!l1 || !geo.bloco) return null
  const bloco = geo.bloco
  const painel = geo.paineis[0]!
  const rosto = alvo ?? {
    x1: LARGURA / 2 - 60,
    y1: (painel.faixa.de + painel.faixa.ate) / 2 - 60,
    x2: LARGURA / 2 + 60,
    y2: (painel.faixa.de + painel.faixa.ate) / 2 + 60,
  }
  const F = { x: (rosto.x1 + rosto.x2) / 2, y: (rosto.y1 + rosto.y2) / 2 }
  const raio = 0.5 * Math.min(rosto.x2 - rosto.x1, rosto.y2 - rosto.y1) + FOLGA_DO_ROSTO
  const ladoDoRosto: 1 | -1 = F.x >= LARGURA * 0.4 ? 1 : -1
  const presa = (x: number): number => Math.max(60, Math.min(LARGURA - 60, x))
  const primeira = (lista: { s: SetaNoQuadro; nota: number }[], regra: (s: SetaNoQuadro) => boolean): SetaNoQuadro | null => {
    lista.sort((x, y) => x.nota - y.nota)
    return lista.find((c) => regra(c.s))?.s ?? null
  }

  /**
   * AO LADO: a cauda quer a beirada da 1a linha, perto da base (girada com o bloco); a cabeca mira o meio
   * do rosto, a ponta na borda dele. Procura o giro em volta do rosto e o tamanho.
   */
  const aoLado = (lado: 1 | -1, regra: (s: SetaNoQuadro) => boolean, acima = false): SetaNoQuadro | null => {
    const natural = miraNatural(lado)
    const a = paraATela(
      geo,
      acima
        ? { x: presa(lado === 1 ? (LARGURA - l1.largura) / 2 + 40 : (LARGURA + l1.largura) / 2 - 40), y: l1.base - l1.cap - l1.contorno - 60 }
        : { x: presa(lado === 1 ? (LARGURA - l1.largura) / 2 - 50 : (LARGURA + l1.largura) / 2 + 50), y: l1.base - l1.cap * 0.45 },
    )
    const lista: { s: SetaNoQuadro; nota: number }[] = []
    for (let g = -75; g <= 75; g += 2.5) {
      const mira = natural + (lado * g * Math.PI) / 180
      for (let L = SETA_MINIMA; L <= SETA_MAXIMA; L += 20) {
        const s = setaMirando(F, raio, mira, L, lado)
        lista.push({ s, nota: Math.hypot(s.base.x - a.x, s.base.y - a.y) + 3 * Math.abs(g) + 0.15 * (L - SETA_MINIMA) })
      }
    }
    return primeira(lista, regra)
  }

  /**
   * POR TRAS (a ref "CANCELOU"): a cauda embaixo do texto, do lado, e a seta sobe pela beirada; a cabeca sai
   * acima das letras mirando o rosto (pode chegar pelo lado dele). Procura a cauda perto do lugar, o giro da
   * corda e o tamanho; ganha a que mira melhor, com a ponta mais perto do rosto.
   */
  const porTras = (lado: 1 | -1, regra: (s: SetaNoQuadro) => boolean): SetaNoQuadro | null => {
    const a = {
      x: lado === 1 ? Math.max(70, bloco.esquerda - 20) : Math.min(LARGURA - 70, bloco.direita + 20),
      y: Math.min(bloco.base + 0.06 * ALTURA, ZONA_PROIBIDA_BASE * ALTURA - 60),
    }
    const lista: { s: SetaNoQuadro; nota: number }[] = []
    for (const dx of [-40, 0, 40, 80])
      for (const dy of [-120, -80, -40, 0, 40, 80]) {
        const base = { x: a.x + lado * dx, y: a.y + dy }
        for (let g = -160; g <= -20; g += 2.5) {
          // A corda sobe (g negativo); espelhada, para o outro lado.
          const corda = lado === 1 ? (g * Math.PI) / 180 : Math.PI - (g * Math.PI) / 180
          for (let L = SETA_MINIMA; L <= SETA_MAXIMA; L += 20) {
            const s: SetaNoQuadro = { base, ponta: { x: base.x + L * Math.cos(corda), y: base.y + L * Math.sin(corda) }, lado }
            const m = miraNoRosto(s, F, rosto)
            if ((m.erro > 25 && !m.acerta) || m.folga < 8 || m.folga > 90) continue
            lista.push({ s, nota: Math.hypot(dx, dy) + 2 * m.erro + 1.5 * Math.max(0, m.folga - FOLGA_DO_ROSTO) + 0.15 * (L - SETA_MINIMA) })
          }
        }
      }
    return primeira(lista, regra)
  }

  // A 1a linha deixa espaco ao lado: AO LADO; senao (ou nao coube), POR CIMA do texto (a cauda logo acima da
  // ponta da 1a linha, como na ref do Faah: a seta inteira a vista); sem espaco acima (o close colado no texto,
  // a ref "CANCELOU"), POR TRAS; e o outro lado por ultimo.
  const livre = (LARGURA - l1.largura) / 2 - l1.contorno
  const outro = -ladoDoRosto as 1 | -1
  const tentativas: ['lado' | 'tras' | 'acima', 1 | -1][] = []
  for (const lado of [ladoDoRosto, outro]) {
    if (livre >= ESPACO_PARA_A_SETA) tentativas.push(['lado', lado])
    tentativas.push(['acima', lado], ['tras', lado])
  }
  for (const [jeito, lado] of tentativas) {
    const regra = (c: SetaNoQuadro): boolean => setaBoa(c, geo, rosto, jeito === 'tras' ? 'tras' : 'lado')
    const s = jeito === 'tras' ? porTras(lado, regra) : aoLado(lado, regra, jeito === 'acima')
    if (s) return s
  }
  // Nada cabe na regra inteira (o rosto enorme, colado no texto): ao menos no quadro e fora das faixas.
  const noQuadro = (c: SetaNoQuadro): boolean => {
    const k = caixaDaSeta(c)
    return k.x1 >= MARGEM_DA_SETA && k.x2 <= LARGURA - MARGEM_DA_SETA && k.y1 >= ZONA_PROIBIDA_TOPO * ALTURA && k.y2 <= ZONA_PROIBIDA_BASE * ALTURA
  }
  return aoLado(ladoDoRosto, noQuadro) ?? setaMirando(F, raio, miraNatural(ladoDoRosto), SETA_MINIMA, ladoDoRosto)
}

// ----------------------------------------------------------- as sugestoes

/** Uma imagem candidata a thumb (um keyframe de uma cena que entrou no video). */
export interface CandidatoDaThumb {
  chave: string
  /** O plano (cena do episodio); null = cena sem indice (a mesma cena repete por arquivo). */
  plano: string
  /** A ordem da cena no video (0 = a 1a). */
  ordem: number
  gancho: boolean
  rostos: readonly RostoDaThumb[] | null
  beleza: number | null
  nitidez: number | null
  /** As etiquetas do plano dizem expressao forte (grito, choro, raiva, susto...). */
  expressao: boolean
  /** O quadro cai no trecho que o video mostra. */
  noTrecho: boolean
}

/** As etiquetas do WD-Tagger que dizem "expressao forte" (normalizadas: minusculas, sem sublinhado). */
export const TAGS_DE_EXPRESSAO = new Set([
  'open mouth',
  'screaming',
  'shouting',
  'angry',
  'crying',
  'tears',
  'crying with eyes open',
  'surprised',
  'wide-eyed',
  'shaded face',
  'clenched teeth',
  'teeth',
  'sharp teeth',
  'smirk',
  'evil smile',
  'grin',
  'glowing eyes',
  'blush',
  'sweat',
  'nervous sweating',
  'constricted pupils',
  'shocked',
  'scared',
  'v-shaped eyebrows',
  'furrowed brow',
  'determined',
])

function zDe(valores: readonly (number | null)[]): (v: number | null) => number {
  const xs = valores.filter((v): v is number => v !== null && Number.isFinite(v))
  if (xs.length < 2) return () => 0
  const media = xs.reduce((s, x) => s + x, 0) / xs.length
  const desvio = Math.sqrt(xs.reduce((s, x) => s + (x - media) ** 2, 0) / xs.length) || 1
  return (v) => (v === null ? 0 : limitar((v - media) / desvio, -2, 2))
}

/** A largura (fracao) do maior rosto do candidato; 0 = sem rosto. */
export function maiorRosto(rostos: readonly RostoDaThumb[] | null): number {
  return Math.max(0, ...(rostos ?? []).filter((r) => r.conf >= 0.3).map((r) => r.w))
}

/**
 * A nota de cada candidato: ter rosto pesa mais, depois o CLOSE (rosto de 6%
 * a 28% da largura do quadro), a expressao forte, a beleza e a nitidez
 * (medidas do passo 4, em desvios do conjunto) e o quadro estar no trecho
 * que o video mostra.
 */
export function notasDosCandidatos(cands: readonly CandidatoDaThumb[]): number[] {
  const zb = zDe(cands.map((c) => c.beleza))
  const zn = zDe(cands.map((c) => (c.nitidez === null ? null : Math.log1p(Math.max(0, c.nitidez)))))
  return cands.map((c) => {
    const w = maiorRosto(c.rostos)
    const close = limitar((w - 0.06) / 0.22, 0, 1)
    return (
      (w > 0 ? 2 : 0) +
      1.5 * close +
      (c.expressao ? 0.6 : 0) +
      0.5 * zb(c.beleza) +
      0.35 * zn(c.nitidez === null ? null : Math.log1p(Math.max(0, c.nitidez))) +
      (c.noTrecho ? 0.3 : 0)
    )
  })
}

/**
 * AS SUGESTOES (~8): as cenas do GANCHO sempre entram, primeiro e na ordem do
 * video (o melhor quadro de cada uma, regra do Levi); o resto das vagas e o
 * melhor quadro de cada outra cena, da maior nota para a menor. Uma cena so
 * uma vez.
 */
export function escolherSugestoes(cands: readonly CandidatoDaThumb[], vagas = 8): { candidato: CandidatoDaThumb; nota: number }[] {
  const notas = notasDosCandidatos(cands)
  const porPlano = new Map<string, { candidato: CandidatoDaThumb; nota: number }[]>()
  cands.forEach((c, i) => porPlano.set(c.plano, [...(porPlano.get(c.plano) ?? []), { candidato: c, nota: notas[i]! }]))
  const todos = [...porPlano.values()].map((lista) => {
    // A cena que aparece no gancho (e de novo depois) vale como do gancho, pelo quadro do gancho.
    const doGancho = lista.filter((x) => x.candidato.gancho)
    const valem = doGancho.length > 0 ? doGancho : lista
    return [...valem].sort((a, b) => b.nota - a.nota)[0]!
  })
  const gancho = todos.filter((x) => x.candidato.gancho).sort((a, b) => a.candidato.ordem - b.candidato.ordem)
  const resto = todos.filter((x) => !x.candidato.gancho).sort((a, b) => b.nota - a.nota || a.candidato.ordem - b.candidato.ordem)
  return [...gancho, ...resto.slice(0, Math.max(0, vagas - gancho.length))]
}

/**
 * O padrao inicial: em cima, a cena do gancho com o rosto mais forte (o
 * maior close; sem rosto, a de maior nota); embaixo, a melhor das outras.
 */
export function imagensPadrao<T extends { candidato: CandidatoDaThumb; nota: number }>(sugestoes: readonly T[]): [T | null, T | null] {
  const forca = (x: T): number => maiorRosto(x.candidato.rostos) * 10 + x.nota * 0.01
  const gancho = sugestoes.filter((s) => s.candidato.gancho)
  // O close que nao cabe no meio painel (o rosto passa de ~metade da altura do quadro) fica para depois.
  const cabe = (x: T, ate: number): boolean => alturaDoMaiorRosto(x.candidato.rostos) <= ate
  const porForca = (lista: readonly T[]): T[] => [...lista].sort((a, b) => forca(b) - forca(a))
  const cimaDe = gancho.length > 0 ? gancho : sugestoes
  const cima = porForca(cimaDe).find((x) => cabe(x, 0.55)) ?? porForca(cimaDe)[0] ?? null
  const outros = sugestoes.filter((s) => s !== cima)
  const naoGancho = outros.filter((s) => !s.candidato.gancho)
  const baixo = naoGancho.find((x) => maiorRosto(x.candidato.rostos) > 0 && cabe(x, 0.45)) ?? naoGancho[0] ?? outros[0] ?? null
  return [cima, baixo]
}

/** A altura (fracao do quadro) do maior rosto; 0 = sem rosto. */
export function alturaDoMaiorRosto(rostos: readonly RostoDaThumb[] | null): number {
  const r = rostosPrincipais(rostos)[0]
  return r ? r.h : 0
}

// ------------------------------------------------------------ o contrato

/** Um trecho de cena que entrou no video (o renderer manda, a partir do plano do projeto). */
export const cenaDoVideoSchema = z.object({
  arquivo: z.string().min(1).max(1024),
  /** O trecho mostrado, em segundos DENTRO do arquivo. */
  de: z.number().nonnegative(),
  ate: z.number().nonnegative(),
  ordem: z.number().int().nonnegative(),
  gancho: z.boolean(),
})
export type CenaDoVideo = z.infer<typeof cenaDoVideoSchema>

export interface SugestaoDaThumb {
  arquivo: string
  t: number
  largura: number
  altura: number
  rostos: RostoDaThumb[] | null
  gancho: boolean
  nota: number
  /** A cena no video (0 = a 1a): a tela mostra o instante dela. */
  ordem: number
  /** A miniatura (JPEG pequeno) para a grade. */
  miniatura: Uint8Array
  /** O trecho da cena no arquivo (o "Quadro dentro da cena" anda nele). */
  trecho?: { de: number; ate: number }
  /** "Cena 0360 - 0:01" */
  rotulo: string
}

export interface SugestoesDaThumb {
  sugestoes: SugestaoDaThumb[]
  /** Quem achou os rostos ('motor' = o YOLO de anime; 'antigo' = o detector do nucleo; null = nenhum). */
  detector: 'motor' | 'antigo' | null
}

export const pedidoDeQuadroSchema = z.object({
  arquivo: z.string().min(1).max(1024),
  t: z.number().nonnegative(),
})
export type PedidoDeQuadro = z.infer<typeof pedidoDeQuadroSchema>

/** O quadro tirado (em cache no perfil): os bytes para a previa e o tamanho de verdade. */
export interface QuadroDaThumb {
  largura: number
  altura: number
  /** A imagem para a previa (JPEG, no maximo 2048 de lado). */
  previa: Uint8Array
  /** Quadros por segundo do video (as setas andam 1 quadro). Ausente = imagem, ou nao deu para ler. */
  fps?: number
}

export interface RostosDoQuadro {
  rostos: RostoDaThumb[]
  detector: 'motor' | 'antigo' | null
}

/** O pedaco de uma imagem que vai para um painel do PNG final (px do quadro original). */
export const pedidoDeRecorteSchema = z.object({
  arquivo: z.string().min(1).max(1024),
  t: z.number().nonnegative(),
  sx: z.number().nonnegative(),
  sy: z.number().nonnegative(),
  sw: z.number().positive(),
  sh: z.number().positive(),
  largura: z.number().int().min(16).max(LARGURA),
  altura: z.number().int().min(16).max(ALTURA),
})
export type PedidoDeRecorte = z.infer<typeof pedidoDeRecorteSchema>

export interface RecorteDaThumb {
  /** PNG do tamanho pedido. */
  png: Uint8Array
  /** Passou pelo upscale (realesr-animevideov3) antes de reduzir. */
  ampliado: boolean
  ms: number
}

export const pedidoDeSalvarSchema = z.object({
  /** O video pronto: o PNG vai ao lado, `<video>-thumb.png`. */
  video: z.string().min(1).max(1024),
  png: z.instanceof(Uint8Array),
  /** 'perguntar' = nao sobrescreve (devolve `existe`); 'substituir'; 'novo' = `-thumb-2.png`... */
  modo: z.enum(['perguntar', 'substituir', 'novo']),
})
export type PedidoDeSalvar = z.infer<typeof pedidoDeSalvarSchema>

export type ResultadoDoSalvar = { salvo: string } | { existe: string }

/**
 * O trecho em que o "Quadro dentro da cena" anda: o da cena, alargado para
 * conter o instante escolhido (o keyframe a 75% de um plano curto pode cair
 * um pouco fora do trecho mostrado). null = sem cena (imagem do PC).
 */
export function trechoDoQuadro(img: Pick<ImagemDaThumb, 'origem' | 't' | 'trecho'>): { de: number; ate: number } | null {
  if (img.origem === 'arquivo' || !img.trecho) return null
  const de = Math.min(img.trecho.de, img.t)
  const ate = Math.max(img.trecho.ate, img.t)
  return ate - de > 0.05 ? { de, ate } : null
}

/** `X-short.mp4` -> `X-short-thumb.png`; `n` > 1 -> `X-short-thumb-2.png`. */
export function nomeDaThumb(video: string, n = 1): string {
  const barra = Math.max(video.lastIndexOf('/'), video.lastIndexOf('\\'))
  const pasta = video.slice(0, barra + 1)
  const nome = video.slice(barra + 1)
  const ponto = nome.lastIndexOf('.')
  const base = ponto > 0 ? nome.slice(0, ponto) : nome
  return `${pasta}${base}-thumb${n > 1 ? `-${n}` : ''}.png`
}

// ------------------------------------------------------------ tudo junto

export interface RostoNaPrevia {
  painel: number
  x1: number
  y1: number
  x2: number
  y2: number
  /** A cabeca entrou numa faixa proibida. */
  ruim: boolean
}

export interface ThumbEfetiva {
  geo: GeometriaDaThumb
  /** O enquadramento que aparece em cada painel (o dele, preso; ou o automatico). */
  enquadramentos: (Enquadramento | null)[]
  seta: SetaNoQuadro | null
  avisos: AvisoDaArea[]
  rostos: RostoNaPrevia[]
  /** O divisor que entra na emenda (null = desligado, ou 1 imagem). */
  divisor: DivisorDaThumb | null
}

/**
 * A thumb como aparece: a geometria, o enquadramento de cada painel (null no
 * projeto = o automatico, recalculado com os rostos), a seta (a dele ou a
 * automatica) e os avisos da area segura. A previa e o PNG final usam isto.
 */
export function thumbEfetiva(t: ThumbDoProjeto, medir: MedirTexto): ThumbEfetiva {
  const geo = geometriaDaThumb(t, medir)
  const enquadramentos = geo.paineis.map((painel, i) => {
    const img = t.imagens[i]
    if (!img) return null
    return img.enquadramento
      ? enquadramentoPreso(painel, img, img.enquadramento)
      : enquadrarSozinho(painel, img, img.rostos, t.layout === 'uma' ? 'unica' : i === 0 ? 'cima' : 'baixo')
  })
  const imagens = t.imagens.map((img, i) => (img ? { ...img, enquadramento: enquadramentos[i] ?? null } : null)) as ThumbDoProjeto['imagens']
  const avisos = avisosDaAreaSegura({ layout: t.layout, imagens }, geo)
  const rostos: RostoNaPrevia[] = []
  let alvo: { x1: number; y1: number; x2: number; y2: number } | null = null
  geo.paineis.forEach((painel, i) => {
    const img = imagens[i]
    if (!img) return
    for (const r of rostosPrincipais(img.rostos)) {
      const c = cabecaNoQuadro(painel, img, img.enquadramento, r)
      if (!c) continue
      if (i === 0 && !alvo) alvo = c.rosto
      rostos.push({
        painel: i,
        x1: c.x1,
        y1: c.y1,
        x2: c.x2,
        y2: c.y2,
        ruim: c.y1 < ZONA_PROIBIDA_TOPO * ALTURA || c.y2 > ZONA_PROIBIDA_BASE * ALTURA,
      })
    }
  })
  let seta: SetaNoQuadro | null = null
  if (t.seta.ligada && geo.linhas.length > 0) {
    // A automatica so quando falta uma ponta (a procura custa; arrastando, as duas sao dele).
    const auto = t.seta.base && t.seta.ponta ? null : setaSozinha(geo, alvo)
    const base = t.seta.base ?? auto?.base ?? null
    const ponta = t.seta.ponta ?? auto?.ponta ?? null
    if (base && ponta) {
      const lado: 1 | -1 = t.seta.base || t.seta.ponta ? (ponta.x >= base.x ? 1 : -1) : (auto?.lado ?? 1)
      seta = { base, ponta, lado }
    }
  }
  return { geo, enquadramentos, seta, avisos, rostos, divisor: geo.emenda === null ? null : divisorEfetivo(t) }
}
