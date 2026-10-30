/**
 * [thumb] AS BARRAS PRETAS do quadro (letterbox/pillarbox): cena "de cinema"
 * do anime vem com faixas pretas embutidas em cima e embaixo (o Black Clover
 * S02E04 tem ~15% de cada lado). Elas sao pixel da imagem, entao o painel
 * "coberto" mostrava uma faixa preta vazia. O quadro em cache sai sem elas
 * (electron/editor.ts): a previa, os rostos, o recorte do PNG e as
 * sugestoes usam so a parte com imagem.
 *
 * Conservador para nao comer cena escura: a linha so e barra se quase nada
 * passa de um cinza bem escuro, as duas barras do par existem (cima E baixo,
 * ou esquerda E direita), tem quase a mesma espessura, e juntas nao passam
 * de metade do quadro. Puro (o teste roda sem sharp).
 */

/** Pixel acima disto (0-255, cinza) nao e preto de barra. */
const CLARO = 40
/** A linha/coluna e barra com no maximo esta fracao de pixels claros (ruido do video, um logo pequeno). */
const CLAROS_NA_BARRA = 0.005
/** O cinza da barra varia no maximo isto (1% a 99%): o preto do letterbox e liso (medido: 5-15). */
const VARIACAO_NA_BARRA = 16
/** Cada barra do par tem pelo menos isto do lado (menos e borda de encode, nao letterbox). */
const BARRA_MINIMA = 0.02
/** As duas barras do par diferem no maximo isto (letterbox e simetrico; ceu escuro so em cima, nao). */
const DIFERENCA_MAXIMA = 0.03
/** As duas juntas no maximo isto do lado (mais que isso e quadro escuro, nao barra). */
const BARRAS_NO_MAXIMO = 0.5

export interface AreaUtil {
  x: number
  y: number
  largura: number
  altura: number
}

/**
 * A parte do quadro sem as barras pretas (px). `cinza` = 1 byte por pixel,
 * linha a linha. Sem barras (ou na duvida): o quadro inteiro.
 */
export function areaSemBarras(cinza: Uint8Array | Uint8ClampedArray, largura: number, altura: number): AreaUtil {
  const inteiro = { x: 0, y: 0, largura, altura }
  if (largura < 16 || altura < 16 || cinza.length < largura * altura) return inteiro
  // A barra e PRETA e LISA: quase nada claro e, tirando 1% de cada ponta, o cinza quase igual de
  // ponta a ponta (a vinheta escura e a cena noturna variam; o preto do letterbox, nao).
  const hist = new Uint32Array(256)
  const preta = (n: number, pixel: (k: number) => number): boolean => {
    hist.fill(0)
    for (let k = 0; k < n; k++) hist[pixel(k)]!++
    let claros = 0
    for (let v = CLARO + 1; v < 256; v++) claros += hist[v]!
    if (claros > n * CLAROS_NA_BARRA) return false
    const corte = n * 0.01
    let baixo = 0
    let soma = 0
    while (baixo < 255 && soma + hist[baixo]! <= corte) soma += hist[baixo++]!
    let alto = 255
    soma = 0
    while (alto > 0 && soma + hist[alto]! <= corte) soma += hist[alto--]!
    return alto - baixo <= VARIACAO_NA_BARRA
  }
  const linhaPreta = (y: number): boolean => preta(largura, (k) => cinza[y * largura + k]!)
  const colunaPreta = (x: number, y0: number, y1: number): boolean => preta(y1 - y0, (k) => cinza[(y0 + k) * largura + x]!)
  const par = (a: number, b: number, lado: number): boolean =>
    a >= lado * BARRA_MINIMA && b >= lado * BARRA_MINIMA && Math.abs(a - b) <= lado * DIFERENCA_MAXIMA && a + b <= lado * BARRAS_NO_MAXIMO

  let topo = 0
  while (topo < altura && linhaPreta(topo)) topo++
  let base = 0
  while (base < altura - topo && linhaPreta(altura - 1 - base)) base++
  const y0 = par(topo, base, altura) ? topo : 0
  const y1 = par(topo, base, altura) ? altura - base : altura

  let esquerda = 0
  while (esquerda < largura && colunaPreta(esquerda, y0, y1)) esquerda++
  let direita = 0
  while (direita < largura - esquerda && colunaPreta(largura - 1 - direita, y0, y1)) direita++
  const x0 = par(esquerda, direita, largura) ? esquerda : 0
  const x1 = par(esquerda, direita, largura) ? largura - direita : largura

  return { x: x0, y: y0, largura: x1 - x0, altura: y1 - y0 }
}
