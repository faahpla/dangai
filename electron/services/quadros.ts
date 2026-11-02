/**
 * Acha os QUADRINHOS de uma pagina de manga, sem modelo nenhum.
 *
 * O que separa um quadrinho do outro e a sarjeta: o branco entre eles, que
 * sempre chega na borda da pagina. Entao o fundo e o branco LIGADO A BORDA
 * (inundado a partir dela), e cada pedaco que sobra e um quadrinho. Isso pega
 * tambem o corte inclinado das paginas de luta, que uma busca por linhas e
 * colunas brancas nao pegaria -- ali os quadrinhos se sobrepoem no retangulo,
 * e o recorte pinta de branco o que e do vizinho (ver `recortarQuadro`).
 *
 * Medido no capitulo de Bleach que ele mandou (11/2026, 68 paginas coloridas
 * de 687x1080): ~270 quadrinhos em 6s, certos nas paginas em grade e nas
 * inclinadas. Erro tipico: balao ou espada atravessando a sarjeta junta dois
 * quadrinhos num so -- a pagina inteira continua a mao para esse caso.
 *
 * Funcao pura sobre os pixels crus (RGB ou RGBA): quem le o arquivo e o sharp,
 * do lado de quem chama. Assim da para testar sem disco.
 */

/** Um quadrinho achado, em pixels da pagina. */
export interface Quadro {
  x: number
  y: number
  largura: number
  altura: number
  /** O rotulo dele no mapa (`rotulos`), para o recorte pintar o vizinho. */
  rotulo: number
}

export interface PaginaLida {
  /** Na ordem de leitura do manga: de cima para baixo, da direita para a esquerda. */
  quadros: Quadro[]
  /** Pagina de um quadro so (capa, splash, pagina dupla): nao vale recortar. */
  inteira: boolean
  /** Rotulo de cada pixel: 0 = fundo; os dos quadros estao em `quadros`. */
  rotulos: Int32Array
}

/** Claro o bastante para ser papel: as tres cores acima disto. */
const CLARO = 230
/** Menor quadro, em fracao da area da pagina: abaixo e texto solto, onomatopeia, sujeira. */
const MINIMO = 0.02
/** Um quadro que ocupa isto da pagina e a pagina inteira. */
const PAGINA_INTEIRA = 0.8
/** Quanto do alto da pagina dois quadros podem diferir e ainda estar na mesma faixa. */
const MESMA_FAIXA = 0.04

export function acharQuadros(pixels: Uint8Array, largura: number, altura: number, canais: number): PaginaLida {
  const W = largura
  const H = altura
  const N = W * H
  const claro = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const o = i * canais
    claro[i] = Math.min(pixels[o]!, pixels[o + 1]!, pixels[o + 2]!) >= CLARO ? 1 : 0
  }

  // O fundo: o claro que chega na borda. Fila em vez de recursao -- uma pagina
  // inteira de branco estouraria a pilha.
  const fundo = new Uint8Array(N)
  const fila = new Int32Array(N)
  let ini = 0
  let fim = 0
  const semear = (i: number): void => {
    if (claro[i] && !fundo[i]) {
      fundo[i] = 1
      fila[fim++] = i
    }
  }
  for (let x = 0; x < W; x++) {
    semear(x)
    semear((H - 1) * W + x)
  }
  for (let y = 0; y < H; y++) {
    semear(y * W)
    semear(y * W + W - 1)
  }
  while (ini < fim) {
    const i = fila[ini++]!
    const x = i % W
    if (x > 0) semear(i - 1)
    if (x < W - 1) semear(i + 1)
    if (i >= W) semear(i - W)
    if (i < N - W) semear(i + W)
  }

  // O resto, em pedacos ligados (vizinhanca de 4: com 8, uma sarjeta fina na
  // diagonal deixaria dois quadros se tocarem pela quina).
  const rotulos = new Int32Array(N)
  const achados: (Quadro & { area: number })[] = []
  for (let s = 0; s < N; s++) {
    if (fundo[s] || rotulos[s]) continue
    const rotulo = achados.length + 1
    let x0 = W
    let y0 = H
    let x1 = 0
    let y1 = 0
    let area = 0
    ini = 0
    fim = 0
    rotulos[s] = rotulo
    fila[fim++] = s
    while (ini < fim) {
      const i = fila[ini++]!
      const x = i % W
      const y = (i - x) / W
      area++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      const vizinhos = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < N - W ? i + W : -1]
      for (const j of vizinhos) {
        if (j >= 0 && !fundo[j] && !rotulos[j]) {
          rotulos[j] = rotulo
          fila[fim++] = j
        }
      }
    }
    achados.push({ x: x0, y: y0, largura: x1 - x0 + 1, altura: y1 - y0 + 1, rotulo, area })
  }

  const quadros = achados
    .filter((q) => q.area >= MINIMO * N)
    .sort((a, b) =>
      Math.abs(a.y - b.y) < H * MESMA_FAIXA ? b.x + b.largura - (a.x + a.largura) : a.y - b.y,
    )
    .map(({ area: _area, ...q }) => q)

  const inteira = quadros.length <= 1 || quadros.some((q) => q.largura * q.altura >= PAGINA_INTEIRA * N)
  return { quadros: inteira ? [] : quadros, inteira, rotulos }
}

/**
 * Os pixels de um quadro, em RGB, com o que e de OUTRO quadro pintado de
 * branco.
 *
 * Num corte inclinado o retangulo do quadro pega pedacos dos vizinhos; pintados
 * de branco, eles viram a sarjeta que ja eram na pagina. O fundo fica como
 * esta (ja e quase branco), e o texto solto que nao virou quadro tambem: ele
 * costuma ser a fala de quem esta no quadro.
 */
export function recortarQuadro(
  pixels: Uint8Array,
  largura: number,
  canais: number,
  pagina: PaginaLida,
  quadro: Quadro,
): Uint8Array {
  const dosQuadros = new Set(pagina.quadros.map((q) => q.rotulo))
  const saida = new Uint8Array(quadro.largura * quadro.altura * 3)
  for (let y = 0; y < quadro.altura; y++) {
    for (let x = 0; x < quadro.largura; x++) {
      const i = (quadro.y + y) * largura + quadro.x + x
      const o = (y * quadro.largura + x) * 3
      const r = pagina.rotulos[i]!
      const vizinho = r !== 0 && r !== quadro.rotulo && dosQuadros.has(r)
      saida[o] = vizinho ? 255 : pixels[i * canais]!
      saida[o + 1] = vizinho ? 255 : pixels[i * canais + 1]!
      saida[o + 2] = vizinho ? 255 : pixels[i * canais + 2]!
    }
  }
  return saida
}
