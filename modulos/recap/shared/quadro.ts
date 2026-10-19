/**
 * [recap] O QUE SE VE DE PERTO num plano (19/10, 4a rodada, a edicao do Levi no
 * Nia E01): as contas puras dos vetos do recorte 9:16 e da acao. Quem le os
 * quadros e o servico (electron/cenas/quadros.ts: o ffmpeg tira os do comeco e
 * os do meio de cada plano; o sharp le os keyframes); quem usa e o casar.
 *
 *   - o COMECO RUIM: o plano abre no preto, no flash ou no borrao (o 0318 do
 *     Nia, o golpe que o Levi usou na f15, tem ~10 quadros de clarao antes de
 *     assentar; o 0323, cabelo borrado na frente da camera). O corte esta
 *     certo: o plano so abre com efeito, e a ENTRADA vai para depois dele (o
 *     casar); vetado so o plano que e efeito ate o fim ou fica curto demais;
 *   - o MOVIMENTO no meio do plano (o golpe com os destrocos voando): a
 *     diferenca media entre quadros seguidos, com a luz media de cada um tirada
 *     (o flash que so muda a luz nao conta);
 *   - o QUADRO QUE O ANIME JA DIVIDE: a linha fina (escura ou clara) e
 *     inclinada que corta o quadro de cima a baixo (o 0193: a Lynette de um
 *     lado, o Neal do outro). A linha reta em pe fica de fora de proposito: e
 *     batente de porta, cerca, pilar, moldura (no Nia, 13 de 14 achados).
 */

/** O tamanho dos quadros que o ffmpeg tira (cinza): o comeco e o meio do plano. */
export const QUADRO_LARGURA = 64
export const QUADRO_ALTURA = 36
/**
 * O passo entre os quadros do comeco (12 por segundo, ate ABERTURA_SEC): a
 * entrada pula o efeito, entao o fim dele precisa de precisao (com 2,4 por
 * segundo, os ~10 quadros de clarao do 0318 viravam 0,83 s).
 */
export const ABERTURA_PASSO_SEC = 1 / 12
export const ABERTURA_SEC = 1.75
/** O tamanho em que o servico le o keyframe para a linha de divisao (cinza). */
export const DIVISAO_LARGURA = 256
export const DIVISAO_ALTURA = 144

/** A luz media (0-255) de um quadro em cinza. */
export function luzDoCinza(cinza: Uint8Array): number {
  if (cinza.length === 0) return 0
  let s = 0
  for (const v of cinza) s += v
  return s / cinza.length
}

/** A nitidez de um quadro em cinza: a variancia do Laplaciano (baixa = borrado). */
export function nitidezDoCinza(cinza: Uint8Array, largura: number, altura: number): number {
  const vs: number[] = []
  for (let l = 1; l < altura - 1; l++) {
    for (let c = 1; c < largura - 1; c++) {
      const i = l * largura + c
      vs.push(4 * cinza[i]! - cinza[i - 1]! - cinza[i + 1]! - cinza[i - largura]! - cinza[i + largura]!)
    }
  }
  if (vs.length === 0) return 0
  const m = vs.reduce((a, b) => a + b, 0) / vs.length
  return vs.reduce((a, b) => a + (b - m) ** 2, 0) / vs.length
}

/** Um quadro medido: a luz media e a nitidez. */
export interface QuadroMedido {
  luz: number
  nit: number
}

/** Mais escuro que isto (com o meio do plano aceso) e o preto da transicao. */
const PRETO = 25
const ACESO = 45
/** Mais claro que isto (com o meio do plano mais escuro) e o flash. */
const FLASH = 225
const FLASH_MEIO = 190
/** A luz do comeco longe assim da do meio: outra imagem (o resto da transicao). */
const SALTO_DE_LUZ = 70
/** Abaixo desta fracao da nitidez do meio (com o meio nitido) e o borrao. */
const BORRAO = 0.3
const MEIO_NITIDO = 300

/**
 * Quantos segundos do comeco do plano sao RUINS (preto, flash ou borrao), pelos
 * quadros do comeco (de ABERTURA_PASSO_SEC em ABERTURA_PASSO_SEC) contra o do
 * meio. 0 = o plano abre bem. O fim e o primeiro quadro bom seguido de outro
 * bom (o clarao que pisca nao acaba no 1o quadro claro); nenhum, o trecho
 * medido inteiro.
 */
export function aberturaRuim(comeco: readonly QuadroMedido[], meio: QuadroMedido | null, passo = ABERTURA_PASSO_SEC): number {
  if (!meio || comeco.length === 0) return 0
  const ruim = (a: QuadroMedido): boolean =>
    (a.luz < PRETO && meio.luz > ACESO) ||
    (a.luz > FLASH && meio.luz < FLASH_MEIO) ||
    Math.abs(a.luz - meio.luz) > SALTO_DE_LUZ ||
    (meio.nit > MEIO_NITIDO && a.nit < BORRAO * meio.nit)
  if (!ruim(comeco[0]!)) return 0
  const k = comeco.findIndex((a, i) => !ruim(a) && (i === comeco.length - 1 || !ruim(comeco[i + 1]!)))
  return (k < 0 ? comeco.length : k) * passo
}

/**
 * O MOVIMENTO entre dois quadros seguidos (cinza, mesmo tamanho): a diferenca
 * media por pixel com a luz media de cada um tirada -- o flash que clareia a
 * tela inteira nao e movimento; os destrocos voando sao.
 */
export function movimentoEntre(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  const ma = luzDoCinza(a.subarray(0, n))
  const mb = luzDoCinza(b.subarray(0, n))
  let s = 0
  for (let i = 0; i < n; i++) s += Math.abs(a[i]! - ma - (b[i]! - mb))
  return s / n
}

/** O quanto a linha e mais escura (ou mais clara) que os dois lados, em niveis de cinza. */
const LINHA_PROFUNDA = 14
/** A linha cobre pelo menos esta fracao das linhas do quadro... */
export const DIVISAO_FORCA = 0.95
/** ...e e inclinada pelo menos isto (da largura, entre o alto e o pe do quadro). */
export const DIVISAO_INCLINACAO = 0.1

/**
 * A LINHA DE DIVISAO de um quadro (cinza, DIVISAO_LARGURA x DIVISAO_ALTURA): a
 * linha reta mais continua de cima a baixo feita de pixels de vale (mais escuros
 * que os vizinhos a 2 px dos dois lados) ou de crista (mais claros), com ate
 * meia largura de inclinacao. `forca` = a fracao das linhas do quadro em que
 * ela passa; `inclinacao` = o deslocamento entre o alto e o pe (fracao da
 * largura). So conta a inclinada (DIVISAO_INCLINACAO): em pe e arquitetura.
 */
export function linhaDeDivisao(cinza: Uint8Array, largura: number, altura: number): { forca: number; inclinacao: number } {
  const nada = { forca: 0, inclinacao: 0 }
  if (largura < 16 || altura < 16 || cinza.length < largura * altura) return nada
  // Pixel de vale ou crista, alargado 1 px para os lados (a diagonal anda entre colunas).
  const marca = new Uint8Array(largura * altura)
  for (let l = 0; l < altura; l++) {
    for (let c = 2; c < largura - 2; c++) {
      const i = l * largura + c
      const a = cinza[i - 2]!
      const b = cinza[i]!
      const d = cinza[i + 2]!
      if (b < Math.min(a, d) - LINHA_PROFUNDA || b > Math.max(a, d) + LINHA_PROFUNDA) {
        marca[i] = 1
        marca[i - 1] = 1
        marca[i + 1] = 1
      }
    }
  }
  const faixa = Math.max(1, Math.floor(altura / 8))
  const colunas = (de: number, ate: number): number[] => {
    const saida: number[] = []
    for (let c = Math.ceil(largura * 0.1); c < largura * 0.9; c++) {
      for (let l = de; l < ate; l++) {
        if (marca[l * largura + c]) {
          saida.push(c)
          break
        }
      }
    }
    return saida
  }
  const alto = colunas(0, faixa)
  const pe = colunas(altura - faixa, altura)
  let melhor = nada
  const minimo = Math.ceil(DIVISAO_INCLINACAO * largura)
  const falhasMax = Math.floor((1 - DIVISAO_FORCA) * altura)
  for (const x0 of alto) {
    for (const x1 of pe) {
      const dx = Math.abs(x1 - x0)
      if (dx < minimo || dx > largura * 0.5) continue
      let falhas = 0
      for (let l = 0; l < altura && falhas <= falhasMax; l++) {
        const x = Math.round(x0 + ((x1 - x0) * l) / (altura - 1))
        if (!marca[l * largura + x]) falhas += 1
      }
      const forca = 1 - falhas / altura
      if (forca > melhor.forca) melhor = { forca, inclinacao: dx / largura }
    }
  }
  return melhor
}

/** O plano que o anime ja divide: a linha inclinada em pelo menos 2 dos keyframes. */
export function planoDividido(linhas: readonly ({ forca: number; inclinacao: number } | null)[]): boolean {
  return linhas.filter((l) => !!l && l.forca >= DIVISAO_FORCA && l.inclinacao >= DIVISAO_INCLINACAO).length >= 2
}
