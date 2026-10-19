import { ajusteDeCorSchema, MOTION_CURVE_DEFAULT, type AjusteDeCor, type SobreposicaoSalva } from '@shared/contract'
import { tabelasDoAjuste } from '@shared/cor'
import { legibilidadeDoQuadro } from './visao'

/**
 * [recap] CLAREAR A CENA ESCURA (19/10, 3a rodada do MRM E02: o 0012 do f06, o
 * Lent de perfil na chuva no comeco de uma parte, e relevante e ilegivel).
 * Antes de trocar a cena, a montagem tenta CLAREAR a propria cena: uma camada
 * de ajuste do nucleo (a mesma da "cor" da Edicao rapida) so no tempo dela,
 * com a EXPOSICAO subindo em luz linear -- o preto continua preto (0 x 2^e =
 * 0) e o meio-tom aparece.
 *
 * Puro: a conta e a mesma do render (tabelasDoAjuste, a tabela por canal que o
 * feComponentTransfer aplica em sRGB), entao o que se mede aqui e o que sai.
 * Quem le o keyframe e poe a camada e electron/montar/clarear.ts.
 */

/** Os degraus de exposicao (stops), do mais leve ao mais forte. Para no primeiro que deixa legivel. */
export const EXPOSICOES_DE_CLAREAR: readonly number[] = [0.35, 0.7, 1, 1.3, 1.6]
/**
 * A cena clareia quando o RECORTE da tela fica abaixo disto. E acima do
 * LEGIVEL do casar (0,4, medido no quadro 16:9 inteiro): o recorte de um close
 * tem menos forma que o quadro todo -- o 0012 do MRM E02 (o Lent de perfil na
 * chuva) da 0,42 no recorte e 0,22 no quadro, e se le mal.
 */
export const LEGIVEL_PARA_CLAREAR = 0.5
/** A legibilidade que o degrau tem que alcancar (o 0012 chega a 0,78 com 0,7 stop). */
export const LEGIVEL_CLAREADO = 0.65
/** Sem lavar o preto: o p5 da luma sobe no maximo isto (0-255)... */
export const PRETO_SOBE_NO_MAXIMO = 12
/** ...e nunca passa disto. */
export const PRETO_TETO = 32
/** O clareado so entra quando ganha pelo menos isto de legibilidade. */
const GANHO_MINIMO = 0.1

/** A tabela do canal no valor v (0..1), com a interpolacao linear do feFuncX type="table". */
function naTabela(t: readonly number[], v: number): number {
  const k = Math.max(0, Math.min(1, v)) * (t.length - 1)
  const i = Math.min(t.length - 2, Math.floor(k))
  return t[i]! + (t[i + 1]! - t[i]!) * (k - i)
}

/** Os pixels RGB com o ajuste aplicado (so o tom: saturacao, vibrance e nitidez ficam de fora). */
export function aplicarAjuste(rgb: Uint8Array, a: AjusteDeCor): Uint8Array {
  const t = tabelasDoAjuste(a)
  const saida = new Uint8Array(rgb.length)
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    saida[i] = Math.round(255 * naTabela(t.r, rgb[i]! / 255))
    saida[i + 1] = Math.round(255 * naTabela(t.g, rgb[i + 1]! / 255))
    saida[i + 2] = Math.round(255 * naTabela(t.b, rgb[i + 2]! / 255))
  }
  return saida
}

/** O p5 da luma (o nivel do preto). */
export function pretoDoQuadro(rgb: Uint8Array): number {
  const ys: number[] = []
  for (let i = 0; i + 2 < rgb.length; i += 3) ys.push(0.299 * rgb[i]! + 0.587 * rgb[i + 1]! + 0.114 * rgb[i + 2]!)
  if (ys.length === 0) return 0
  ys.sort((x, y) => x - y)
  return ys[Math.floor(0.05 * (ys.length - 1))]!
}

/** O que clarear um quadro deu: o ajuste e a legibilidade antes e depois. */
export interface Clareado {
  ajuste: AjusteDeCor
  antes: number
  depois: number
}

/**
 * O ajuste que deixa o quadro legivel sem lavar o preto: o primeiro degrau de
 * EXPOSICOES_DE_CLAREAR que alcanca LEGIVEL_CLAREADO; se nenhum alcanca, o mais
 * forte que nao lava. null = o quadro ja e legivel, ou nenhum degrau ganha
 * GANHO_MINIMO. `rgb`: o quadro reduzido (LEITURA_LARGURA x LEITURA_ALTURA).
 */
export function clarearQuadro(rgb: Uint8Array, largura: number, altura: number, legivel = LEGIVEL_PARA_CLAREAR): Clareado | null {
  const antes = legibilidadeDoQuadro(rgb, largura, altura)
  if (antes >= legivel) return null
  const preto = pretoDoQuadro(rgb)
  let melhor: Clareado | null = null
  for (const exposicao of EXPOSICOES_DE_CLAREAR) {
    const ajuste = ajusteDeCorSchema.parse({ exposicao })
    const novo = aplicarAjuste(rgb, ajuste)
    const p = pretoDoQuadro(novo)
    if (p - preto > PRETO_SOBE_NO_MAXIMO || p > PRETO_TETO) break
    const depois = legibilidadeDoQuadro(novo, largura, altura)
    melhor = { ajuste, antes, depois }
    if (depois >= LEGIVEL_CLAREADO) break
  }
  return melhor && melhor.depois >= antes + GANHO_MINIMO ? melhor : null
}

/**
 * A camada que clareia UMA cena: a camada de ajuste do nucleo no tempo da cena
 * (`at`, `duracaoSec`), sem fade, com `papel: 'clarear'` e o nome da frase no
 * clipe ("Clarear: f06"). Ele edita ou apaga como qualquer camada.
 */
export function camadaDeClarear(e: {
  cor: AjusteDeCor
  at: number
  duracaoSec: number
  faixa: number
  id: string
  nome: string
}): SobreposicaoSalva & { papel: 'clarear' } {
  const usar = Math.max(Math.round(e.duracaoSec * 1000) / 1000, 0.05)
  return {
    id: e.id,
    path: '',
    fileName: `Clarear: ${e.nome}`.slice(0, 60),
    tipo: 'ajuste',
    faixa: e.faixa,
    at: Math.max(0, Math.round(e.at * 1000) / 1000),
    durationSec: Math.max(3600, usar),
    inicioSec: 0,
    usarSec: usar,
    x: 0,
    y: 0,
    escala: 1,
    opacidade: 1,
    aspecto: 16 / 9,
    rotacao: 0,
    efeito: 'nenhum',
    intensidade: 0.1,
    curva: MOTION_CURVE_DEFAULT,
    pontosDaCurva: null,
    cor: e.cor,
    espelhar: false,
    fadeInSec: 0,
    fadeOutSec: 0,
    papel: 'clarear',
  }
}
