import { z } from 'zod'
import { COR_LINHA_1, COR_LINHA_2, corSchema } from './cor'
import { divisorEfetivo, divisorPadrao, divisorSchema, type DivisorDaThumb } from './divisores'

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
 * - a seta vermelha "a mao" saindo de perto do texto e apontando o rosto da
 *   imagem de cima;
 * - cor mais viva (saturacao e contraste leves);
 * - opcionais (30/10): o "Tamanho do texto" (70-150% do corpo, a largura util
 *   continua o teto de cada linha) e, com 2 imagens, um DIVISOR na emenda
 *   (divisores.ts), por cima das imagens e por baixo da seta e do texto.
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

export interface PainelDaThumb {
  y0: number
  y1: number
  /** Onde a cabeca deve ficar (y do quadro): dentro da area segura e fora do texto. */
  faixa: { de: number; ate: number }
}

export interface GeometriaDaThumb {
  linhas: LinhaNaThumb[]
  /** O bloco de texto (topo da 1a maiuscula ate a base da ultima), sem contorno. null = sem texto. */
  bloco: {
    topo: number
    base: number
    esquerda: number
    direita: number
  } | null
  /** A emenda das duas imagens (layout 'duas'). */
  emenda: number | null
  paineis: PainelDaThumb[]
}

/** Folga entre a cabeca e o texto (o contorno e a sombra ocupam ~25 px). */
const FOLGA_DO_TEXTO = 28
/** Faixa menor que isto (o texto arrastado para a ponta): vale a area segura inteira do painel. */
const FAIXA_MINIMA = 160

export function geometriaDaThumb(
  t: Pick<ThumbDoProjeto, 'layout' | 'linhas' | 'textoY'> & { fonte?: FonteDaThumb; tamanho?: number },
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
  // O "Tamanho do texto": as duas linhas juntas; o teto de cada uma continua a largura util.
  const tamanho = Math.max(TAMANHO_MINIMO, Math.min(TAMANHO_MAXIMO, t.tamanho ?? 1))
  const corpo = CORPO_PX * tamanho
  const textos = t.linhas.map((l) => l.trim().toLocaleUpperCase('pt-BR'))
  const linhas: LinhaNaThumb[] = []
  for (const [i, texto] of textos.entries()) {
    if (!texto) continue
    let px = corpo
    let m = tinta(texto, px)
    const total = m.largura + 2 * px * CONTORNO_POR_PX
    const noMaximo = total > maxLargura
    if (noMaximo) {
      // Palavra comprida ("ENCONTRO"): so esta linha encolhe, sem quebrar.
      // O contorno e a sombra encolhem junto (sao proporcionais ao corpo): a linha inteira cabe em LARGURA_UTIL.
      px = Math.max(CORPO_MINIMO, (px * maxLargura) / total)
      m = tinta(texto, px)
    }
    linhas.push({
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
    })
  }
  const centro = (t.textoY ?? textoYPadrao(t.layout)) * ALTURA
  let bloco: GeometriaDaThumb['bloco'] = null
  if (linhas.length > 0) {
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
    const maior = Math.max(...linhas.map((l) => l.largura))
    bloco = {
      topo: centro - altura / 2,
      base: centro + altura / 2,
      esquerda: (LARGURA - maior) / 2,
      direita: (LARGURA + maior) / 2,
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
      bloco,
      emenda: null,
      paineis: [
        {
          y0: 0,
          y1: ALTURA,
          faixa: faixa(seguraDe, Math.min(seguraAte, acima), 0, ALTURA),
        },
      ],
    }
  }
  // A emenda no meio do bloco: o texto cobre a costura (as refs).
  const emenda = Math.round(Math.max(ALTURA * 0.3, Math.min(ALTURA * 0.7, bloco ? (bloco.topo + bloco.base) / 2 : centro)))
  return {
    linhas,
    bloco,
    emenda,
    paineis: [
      {
        y0: 0,
        y1: emenda,
        faixa: faixa(seguraDe, Math.min(emenda, acima), 0, emenda),
      },
      {
        y0: emenda,
        y1: ALTURA,
        faixa: faixa(Math.max(emenda, abaixo), seguraAte, emenda, ALTURA),
      },
    ],
  }
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
      const oy = limitar((de + ate) / 2 - cy * s, PH - img.altura * s, 0)
      const ox = limitar(LARGURA / 2 - cx * s, LARGURA - img.largura * s, 0)
      const topo = oy + uniao.y1 * s
      const base = oy + uniao.y2 * s
      // Passar para o lado da faixa PROIBIDA pesa 3x passar para o lado do texto: sem caber, o
      // rosto de cima pode descer para tras do texto, o de baixo subir -- nunca entrar nas faixas do TikTok.
      const pesoDoTopo = lugar === 'baixo' ? 1 : 3
      const pesoDaBase = lugar === 'baixo' ? 3 : 1
      return { ox, oy, sobra: pesoDoTopo * Math.max(0, de - topo) + pesoDaBase * Math.max(0, base - ate) }
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
  painel: Pick<PainelDaThumb, 'y0' | 'y1'>,
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
  // So conta o rosto que aparece: pelo menos metade dele dentro do painel.
  const vx = Math.max(0, Math.min(rosto.x2, LARGURA) - Math.max(rosto.x1, 0))
  const vy = Math.max(0, Math.min(rosto.y2, painel.y1) - Math.max(rosto.y1, painel.y0))
  if (vx * vy < 0.5 * (rosto.x2 - rosto.x1) * (rosto.y2 - rosto.y1)) return null
  return {
    x1: Math.max(0, cab.x1),
    y1: Math.max(painel.y0, cab.y1),
    x2: Math.min(LARGURA, cab.x2),
    y2: Math.min(painel.y1, cab.y2),
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
  base: Ponto
  ponta: Ponto
  /** +1 = a curva estufa para a esquerda de quem vai da base a ponta (a seta.png dele); -1 = espelhada. */
  lado: 1 | -1
}

/**
 * A SETA AUTOMATICA (as refs), sempre GRANDE (nunca abaixo de SETA_MINIMA, o
 * tamanho da ref "PODER SUPREMO"), apontando a borda do rosto principal da
 * imagem de cima. Rosto muito a esquerda: tudo espelhado (sai da direita).
 * Sem rosto: aponta o meio da imagem de cima. Dois jeitos:
 *
 * - AO LADO (a ref "PODER SUPREMO"): com espaco livre ao lado da 1a linha,
 *   sai da beirada dela, perto da base, e sobe curvando ate o rosto;
 * - POR TRAS (a ref "CANCELOU ENCONTRO"): a 1a linha larga (140%, ou uma
 *   palavra comprida) nao deixa espaco -- em vez de encolher no canto, a seta
 *   nasce embaixo, do lado, abaixo do texto (o comeco da imagem de baixo), e
 *   sobe pela borda passando POR TRAS da letra da ponta (o texto e desenhado
 *   por cima) ate o rosto.
 *
 * Nos dois, a seta inteira (com o contorno) fica dentro do quadro e fora das
 * faixas proibidas do TikTok (0-13% e 87-100%): o que passa e empurrado para
 * dentro pela cauda.
 */
/** A seta automatica nunca fica mais curta que isto (a ref "PODER SUPREMO": ~330 px; as refs vao de 300 a 700). */
export const SETA_MINIMA = 340
/** Espaco livre (px) entre a beirada do quadro e o contorno da 1a linha para a seta sair AO LADO dela. */
export const ESPACO_PARA_A_SETA = 150
/** Por tras do texto: a ponta fica pelo menos isto acima das letras (a cabeca inteira aparece). */
const FOLGA_DA_CABECA = 90
/** A margem da seta ate a beirada do quadro. */
const MARGEM_DA_SETA = 12

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

/** Empurra a seta para dentro do quadro e para fora das faixas proibidas (a cauda anda; a ponta, so o que precisar). */
function setaDentroDoQuadro(s: SetaNoQuadro): SetaNoQuadro {
  const topo = ZONA_PROIBIDA_TOPO * ALTURA
  const fundo = ZONA_PROIBIDA_BASE * ALTURA
  let seta = { base: { ...s.base }, ponta: { ...s.ponta }, lado: s.lado }
  for (let i = 0; i < 8; i++) {
    const c = caixaDaSeta(seta)
    const dx = c.x1 < MARGEM_DA_SETA ? MARGEM_DA_SETA - c.x1 : c.x2 > LARGURA - MARGEM_DA_SETA ? LARGURA - MARGEM_DA_SETA - c.x2 : 0
    const dyBase = c.y2 > fundo ? fundo - c.y2 : 0
    const dyPonta = c.y1 < topo ? topo - c.y1 : 0
    if (Math.abs(dx) < 0.5 && Math.abs(dyBase) < 0.5 && Math.abs(dyPonta) < 0.5) break
    // A curva estufa no meio: empurrar a cauda inteira e a ponta pela metade tira a barriga da beirada.
    seta = {
      lado: seta.lado,
      base: { x: seta.base.x + dx * 1.1, y: seta.base.y + dyBase * 1.1 },
      ponta: { x: seta.ponta.x + dx * 0.5, y: seta.ponta.y + dyPonta * 1.1 },
    }
  }
  return seta
}

const comprimento = (s: { base: Ponto; ponta: Ponto }): number => Math.hypot(s.ponta.x - s.base.x, s.ponta.y - s.base.y)

export function setaSozinha(geo: GeometriaDaThumb, alvo: { x1: number; y1: number; x2: number; y2: number } | null): SetaNoQuadro | null {
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
  const cx = (rosto.x1 + rosto.x2) / 2
  const cy = (rosto.y1 + rosto.y2) / 2
  const lado: 1 | -1 = cx >= LARGURA * 0.4 ? 1 : -1
  const presa = (x: number): number => Math.max(60, Math.min(LARGURA - 60, x))
  // A ponta sempre acima do texto: a cabeca por baixo das letras some.
  const topoDoTexto = bloco.topo - 36
  const pontaPara = (base: Ponto): Ponto => {
    // Para na borda do rosto (no lado da base), com folga.
    const dx = cx - base.x
    const dy = cy - base.y
    const d = Math.hypot(dx, dy) || 1
    const raio = 0.5 * Math.min(rosto.x2 - rosto.x1, rosto.y2 - rosto.y1) + 26
    const p = { x: cx - (dx / d) * raio, y: cy - (dy / d) * raio }
    return p.y > topoDoTexto ? { x: p.x, y: topoDoTexto } : p
  }

  // 1) AO LADO da 1a linha, quando ha espaco livre ali.
  const livre = (LARGURA - l1.largura) / 2 - l1.contorno
  if (livre >= ESPACO_PARA_A_SETA) {
    const base = { x: presa(lado === 1 ? (LARGURA - l1.largura) / 2 - 50 : (LARGURA + l1.largura) / 2 + 50), y: l1.base - l1.cap * 0.45 }
    const ponta = pontaPara(base)
    // Curta demais (o rosto colado no texto): a cauda estica para tras (para baixo e para fora).
    const L = comprimento({ base, ponta }) || 1
    if (L < SETA_MINIMA) {
      const ux = (base.x - ponta.x) / L
      const uy = (base.y - ponta.y) / L
      base.x = presa(ponta.x + ux * SETA_MINIMA)
      base.y = Math.min(bloco.base, ponta.y + uy * SETA_MINIMA)
    }
    // A cauda nunca em cima de uma linha: sai para a beirada dela, por fora do contorno e da sombra.
    let emCima = false
    for (const l of geo.linhas) {
      const meia = l.largura / 2 + l.contorno + 18
      const topo = l.base - l.cap - l.contorno
      const fundo = l.base + l.desce + l.contorno + SOMBRA_Y * (l.px / CORPO_PX)
      if (base.y < topo || base.y > fundo) continue
      if (base.x > LARGURA / 2 - meia && base.x < LARGURA / 2 + meia) {
        base.x = LARGURA / 2 - lado * meia
        emCima = base.x < 60 || base.x > LARGURA - 60
      }
    }
    const seta = setaDentroDoQuadro({ base, ponta, lado })
    if (!emCima && comprimento(seta) >= SETA_MINIMA - 1) return seta
  }

  // 2) POR TRAS do texto (a ref "CANCELOU"): nasce embaixo, do lado, logo abaixo do texto, e sobe
  // pela borda passando atras da letra da ponta.
  const beiradaDoTexto = lado === 1 ? bloco.esquerda : bloco.direita
  const base = {
    x: lado === 1 ? Math.max(70, beiradaDoTexto - 20) : Math.min(LARGURA - 70, beiradaDoTexto + 20),
    y: Math.min(bloco.base + 0.1 * ALTURA, ZONA_PROIBIDA_BASE * ALTURA - 60),
  }
  // A ponta chega pelo LADO do rosto (como na ref), alta o bastante para a cabeca da seta ficar
  // inteira acima das letras.
  const ponta = {
    x: Math.max(60, Math.min(LARGURA - 60, lado === 1 ? rosto.x1 - 26 : rosto.x2 + 26)),
    y: Math.min(cy, bloco.topo - FOLGA_DA_CABECA),
  }
  let seta = setaDentroDoQuadro({ base, ponta, lado })
  // Ainda curta (o rosto baixo, colado no texto): a cauda desce mais, ate a faixa proibida.
  if (comprimento(seta) < SETA_MINIMA) {
    const falta = SETA_MINIMA - comprimento(seta)
    seta = setaDentroDoQuadro({ ...seta, base: { x: seta.base.x, y: seta.base.y + falta } })
  }
  return seta
}

/**
 * O CONTORNO DA SETA (a seta.png dele redesenhada, para ficar nitida grande):
 * um corpo curvo que nasce fino na cauda e engrossa ate o pescoco, e a
 * cabeca triangular na direcao da curva. Devolve o poligono (quadro 1080).
 */
export function contornoDaSeta(s: SetaNoQuadro): Ponto[] {
  const { base: B, ponta: P } = s
  const dx = P.x - B.x
  const dy = P.y - B.y
  const L = Math.max(1, Math.hypot(dx, dy))
  // A normal "esquerda de quem anda" na tela (y para baixo).
  const nx = dy / L
  const ny = -dx / L
  const C = {
    x: (B.x + P.x) / 2 + nx * s.lado * 0.3 * L,
    y: (B.y + P.y) / 2 + ny * s.lado * 0.3 * L,
  }
  const cabeca = limitar(0.3 * L, 60, 150)
  let ux = P.x - C.x
  let uy = P.y - C.y
  const un = Math.hypot(ux, uy) || 1
  ux /= un
  uy /= un
  const H = { x: P.x - ux * cabeca, y: P.y - uy * cabeca }
  const meiaLargura = cabeca * 0.3
  const N = 28
  const esquerda: Ponto[] = []
  const direita: Ponto[] = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const a = (1 - t) * (1 - t)
    const b = 2 * (1 - t) * t
    const c = t * t
    const x = a * B.x + b * C.x + c * H.x
    const y = a * B.y + b * C.y + c * H.y
    let tx = 2 * (1 - t) * (C.x - B.x) + 2 * t * (H.x - C.x)
    let ty = 2 * (1 - t) * (C.y - B.y) + 2 * t * (H.y - C.y)
    const tn = Math.hypot(tx, ty) || 1
    tx /= tn
    ty /= tn
    const w = meiaLargura * (0.06 + 0.94 * t ** 0.75)
    esquerda.push({ x: x + ty * w, y: y - tx * w })
    direita.push({ x: x - ty * w, y: y + tx * w })
  }
  const asa = cabeca * 0.62
  const px = uy
  const py = -ux
  return [...esquerda, { x: H.x + px * asa, y: H.y + py * asa }, { x: P.x, y: P.y }, { x: H.x - px * asa, y: H.y - py * asa }, ...direita.reverse()]
}

/** A largura do contorno preto da seta (a cabeca grande pede contorno grosso). */
export function contornoDaSetaPx(s: SetaNoQuadro): number {
  const L = Math.hypot(s.ponta.x - s.base.x, s.ponta.y - s.base.y)
  return limitar(0.3 * L, 60, 150) * 0.085
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
    const auto = setaSozinha(geo, alvo)
    const base = t.seta.base ?? auto?.base ?? null
    const ponta = t.seta.ponta ?? auto?.ponta ?? null
    if (base && ponta) {
      const lado: 1 | -1 = t.seta.base || t.seta.ponta ? (ponta.x >= base.x ? 1 : -1) : (auto?.lado ?? 1)
      seta = { base, ponta, lado }
    }
  }
  return { geo, enquadramentos, seta, avisos, rostos, divisor: geo.emenda === null ? null : divisorEfetivo(t) }
}
