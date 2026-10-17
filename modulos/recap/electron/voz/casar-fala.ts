/**
 * O QUE FOI DITO x O ROTEIRO (V1, "Cortar erros" no audio importado).
 *
 * Funcoes puras (sem disco, sem audio): o teste confere com fixture.
 *
 * O Whisper ouve o que foi dito; o roteiro diz o que devia ser dito. Um
 * alinhamento de sequencias (Needleman-Wunsch com custo afim de lacuna, o
 * Gotoh) casa as duas listas de palavras normalizadas. O que o Whisper ouviu
 * e nao tem par no roteiro (a "sobra") e candidato a erro:
 *   - custo afim: abrir uma lacuna custa caro, estender custa pouco. Uma frase
 *     lida duas vezes vira UM bloco de sobra, e nao palavras soltas espalhadas;
 *   - empate: o caminho de volta prefere CASAR o mais tarde possivel, entao a
 *     sobra cai na leitura de ANTES e fica a ultima (a boa costuma ser a
 *     segunda);
 *   - nome e acento: sem acento, minuscula, e "perto" vale (ate 2 letras de
 *     diferenca, ou um comeca com o outro: "why" e "Why-Man").
 *
 * Um bloco de sobra so vira candidato quando as duas pontas sao palavras do
 * roteiro bem ouvidas (iguais ou perto). Encostado numa TROCA (o Whisper ouviu
 * outra palavra no lugar) ou numa FALTA (nao ouviu), e o Whisper errando o
 * texto -- "37" ouvido "trinta e sete", "Why-Man" ouvido "why man" -- e nao
 * erro de quem leu. Na duvida, nao corta.
 */

/** Pontos do casamento. */
const IGUAL = 3
const PERTO = 2
const TROCA = -1
/** Lacuna afim: abrir caro, estender barato (um bloco so). */
const ABRE = -3
const ESTENDE = -1
/** Mais que isto de sobra no audio inteiro: o casamento nao e confiavel (outro texto, Whisper perdido). */
const SOBRA_MAXIMA = 0.4
/** Uma sobra parecida com o roteiro em volta (LCS/tamanho) e repeticao. */
const PARECIDA = 0.5

/** Hesitacoes que o Whisper escreve ("E e e.", "Hum", "Ahn"). */
const HESITACAO = /^(e+|eh+|e+h|a+h+|ah+n*|a+|hu+m+|hm+|mm+|u+h+|u+m+|ahn|uhum|ne)$/

export type Semelhanca = 'igual' | 'perto' | 'troca'

export type PassoDoCasamento =
  | { tipo: 'casou'; i: number; j: number; como: Semelhanca }
  /** Palavra ouvida sem par no roteiro. */
  | { tipo: 'sobra'; j: number }
  /** Palavra do roteiro que o Whisper nao ouviu. */
  | { tipo: 'falta'; i: number }

/** A chave de comparacao: sem acento, sem pontuacao, minuscula (como o align.ts). */
export function chaveDaFala(token: string): string {
  return token
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function distanciaAte(a: string, b: string, teto: number): number {
  if (Math.abs(a.length - b.length) > teto) return teto + 1
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const atual = [i]
    let menor = i
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(anterior[j]! + 1, atual[j - 1]! + 1, anterior[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      menor = Math.min(menor, atual[j]!)
    }
    if (menor > teto) return teto + 1
    anterior = atual
  }
  return anterior[b.length]!
}

/** Quao parecidas sao duas chaves. Curtas (< 3 letras) so valem iguais. */
export function semelhanca(a: string, b: string): Semelhanca {
  if (a === b) return 'igual'
  const menor = Math.min(a.length, b.length)
  if (menor < 3) return 'troca'
  // Nome cortado pelo Whisper ("why" / "whyman", "yuzu" / "yuzuriha").
  if (a.startsWith(b) || b.startsWith(a)) return 'perto'
  return distanciaAte(a, b, 2) <= 2 ? 'perto' : 'troca'
}

const PONTOS: Record<Semelhanca, number> = { igual: IGUAL, perto: PERTO, troca: TROCA }

/**
 * O alinhamento (Gotoh): `roteiro` e `ouvido` ja em chaves (chaveDaFala).
 * Devolve os passos em ordem. Empates: casar antes de sobrar ou faltar, na
 * volta (a sobra fica o mais cedo possivel = a ultima leitura fica).
 */
export function casarFalaComRoteiro(roteiro: readonly string[], ouvido: readonly string[]): PassoDoCasamento[] {
  const n = roteiro.length
  const m = ouvido.length
  const cols = m + 1
  const NADA = -1e9
  // M: termina casando; X: termina em sobra (ouvido sem par); Y: termina em falta.
  const M = new Float64Array((n + 1) * cols).fill(NADA)
  const X = new Float64Array((n + 1) * cols).fill(NADA)
  const Y = new Float64Array((n + 1) * cols).fill(NADA)
  const at = (i: number, j: number): number => i * cols + j
  M[at(0, 0)] = 0
  for (let j = 1; j <= m; j++) X[at(0, j)] = ABRE + (j - 1) * ESTENDE
  for (let i = 1; i <= n; i++) Y[at(i, 0)] = ABRE + (i - 1) * ESTENDE
  const como = (i: number, j: number): Semelhanca => semelhanca(roteiro[i - 1]!, ouvido[j - 1]!)
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = at(i - 1, j - 1)
      M[at(i, j)] = Math.max(M[d]!, X[d]!, Y[d]!) + PONTOS[como(i, j)]
      const e = at(i, j - 1)
      X[at(i, j)] = Math.max(M[e]! + ABRE, X[e]! + ESTENDE, Y[e]! + ABRE)
      const c = at(i - 1, j)
      Y[at(i, j)] = Math.max(M[c]! + ABRE, Y[c]! + ESTENDE, X[c]! + ABRE)
    }
  }
  // A volta. Preferencia nos empates: M, depois Y, depois X.
  const passos: PassoDoCasamento[] = []
  let i = n
  let j = m
  const melhor = (k: number): 'M' | 'X' | 'Y' => {
    const v = Math.max(M[k]!, X[k]!, Y[k]!)
    return M[k] === v ? 'M' : Y[k] === v ? 'Y' : 'X'
  }
  let estado = melhor(at(n, m))
  while (i > 0 || j > 0) {
    if (estado === 'M' && i > 0 && j > 0) {
      passos.push({ tipo: 'casou', i: i - 1, j: j - 1, como: como(i, j) })
      i--
      j--
      estado = i === 0 && j === 0 ? 'M' : melhor(at(i, j))
      continue
    }
    if (estado === 'X' && j > 0) {
      passos.push({ tipo: 'sobra', j: j - 1 })
      const e = at(i, j - 1)
      const deM = M[e]! + ABRE
      const deX = X[e]! + ESTENDE
      const deY = Y[e]! + ABRE
      const v = Math.max(deM, deX, deY)
      j--
      estado = deM === v ? 'M' : deY === v ? 'Y' : 'X'
      if (i === 0) estado = 'X'
      continue
    }
    // Y (ou a borda: so sobra roteiro)
    if (i > 0) {
      passos.push({ tipo: 'falta', i: i - 1 })
      const c = at(i - 1, j)
      const deM = M[c]! + ABRE
      const deY = Y[c]! + ESTENDE
      const deX = X[c]! + ABRE
      const v = Math.max(deM, deY, deX)
      i--
      estado = deM === v ? 'M' : deY === v ? 'Y' : 'X'
      if (j === 0) estado = 'Y'
      continue
    }
    // So sobra ouvido (i === 0).
    passos.push({ tipo: 'sobra', j: j - 1 })
    j--
  }
  return passos.reverse()
}

/** Para a repeticao vale so o quase igual (uma letra de diferenca em palavra de 4+): "casa" nao repete "para". */
function quaseIgual(a: string, b: string): boolean {
  return a === b || (Math.min(a.length, b.length) >= 4 && distanciaAte(a, b, 1) <= 1)
}

/** Maior subsequencia comum (em palavras), para dizer se a sobra repete o roteiro em volta. */
function lcs(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  let anterior = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const atual = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      atual[j] = quaseIgual(a[i - 1]!, b[j - 1]!) ? anterior[j - 1]! + 1 : Math.max(anterior[j]!, atual[j - 1]!)
    }
    anterior = atual
  }
  return anterior[b.length]!
}

/** Um bloco de fala fora do roteiro, ainda sem tempo fino. */
export interface CandidatoDeErro {
  /** Indices das palavras ouvidas (Whisper), em ordem, seguidas. */
  ouvidas: number[]
  /** O token do roteiro que vem logo depois (roteiro.length = no fim). A sobra fica ANTES dele. */
  antesDe: number
  tipo: 'repeticao' | 'hesitacao' | 'sobra'
}

export interface ResultadoDoCasamento {
  candidatos: CandidatoDeErro[]
  /** Fala fora do roteiro demais: nada foi marcado (o casamento nao e confiavel). */
  desconfiado: boolean
}

/**
 * Os blocos de sobra que sao ERRO de quem leu. `roteiro` e `ouvido` sao os
 * textos (tokens) como vieram; a comparacao e pelas chaves.
 */
export function acharCandidatos(roteiro: readonly string[], ouvido: readonly string[]): ResultadoDoCasamento {
  const r = roteiro.map(chaveDaFala)
  const o = ouvido.map(chaveDaFala)
  if (r.length === 0 || o.length === 0) return { candidatos: [], desconfiado: false }
  const passos = casarFalaComRoteiro(r, o)
  const sobras = passos.filter((p) => p.tipo === 'sobra').length
  if (sobras / o.length > SOBRA_MAXIMA) return { candidatos: [], desconfiado: true }

  const candidatos: CandidatoDeErro[] = []
  /** O passo e uma palavra do roteiro bem ouvida (ancora). */
  const ancora = (p: PassoDoCasamento | undefined): boolean => p?.tipo === 'casou' && p.como !== 'troca'
  let k = 0
  while (k < passos.length) {
    if (passos[k]!.tipo !== 'sobra') {
      k++
      continue
    }
    const ini = k
    while (k < passos.length && passos[k]!.tipo === 'sobra') k++
    const bloco = passos.slice(ini, k) as Extract<PassoDoCasamento, { tipo: 'sobra' }>[]
    const antes = passos[ini - 1]
    const depois = passos[k]
    // As duas pontas: ancora, ou a borda do audio.
    if ((antes && !ancora(antes)) || (depois && !ancora(depois))) continue
    if (!antes && !depois) continue
    const js = bloco.map((p) => p.j)
    const chaves = js.map((j) => o[j]!).filter((c) => c.length > 0)
    if (chaves.length === 0) continue
    // Palavra partida pelo Whisper ("yuzu" + "riha"): a sobra colada na vizinha da a palavra do roteiro.
    if (chaves.length <= 2) {
      const junto = chaves.join('')
      const partida = (p: PassoDoCasamento | undefined, ladoAntes: boolean): boolean => {
        if (p?.tipo !== 'casou') return false
        const colado = ladoAntes ? o[p.j]! + junto : junto + o[p.j]!
        return distanciaAte(colado, r[p.i]!, 1) <= 1
      }
      if (partida(antes, true) || partida(depois, false)) continue
    }
    const antesDe = depois && depois.tipo === 'casou' ? depois.i : r.length
    // O roteiro em volta: a leitura que fica (depois) e a de antes.
    const janela = chaves.length + 2
    const seguinte = r.slice(antesDe, antesDe + janela)
    const anterior = r.slice(Math.max(0, antesDe - janela), antesDe)
    const parecida = Math.max(lcs(chaves, seguinte), lcs(chaves, anterior)) / chaves.length
    const tipo: CandidatoDeErro['tipo'] = chaves.every((c) => HESITACAO.test(c))
      ? 'hesitacao'
      : parecida >= PARECIDA
        ? 'repeticao'
        : 'sobra'
    candidatos.push({ ouvidas: js, antesDe, tipo })
  }
  return { candidatos, desconfiado: false }
}

/**
 * A SEQUENCIA FALADA: os tokens do roteiro com as palavras de cada candidato
 * no lugar onde foram ditas. E o que o wav2vec2 alinha quando ha erro: com a
 * leitura de antes escrita, ele nao espalha o roteiro pelas duas leituras.
 * `doRoteiro[k]` = indice do token do roteiro (ou -1, palavra de erro) e
 * `doCandidato[k]` = indice do candidato (ou -1).
 */
export function sequenciaFalada(
  roteiro: readonly string[],
  ouvido: readonly string[],
  candidatos: readonly CandidatoDeErro[],
): { tokens: string[]; doRoteiro: number[]; doCandidato: number[] } {
  const tokens: string[] = []
  const doRoteiro: number[] = []
  const doCandidato: number[] = []
  const porPosicao = new Map<number, number[]>()
  for (const [c, cand] of candidatos.entries()) {
    const l = porPosicao.get(cand.antesDe)
    if (l) l.push(c)
    else porPosicao.set(cand.antesDe, [c])
  }
  const porCandidatos = (pos: number): void => {
    for (const c of porPosicao.get(pos) ?? []) {
      for (const j of candidatos[c]!.ouvidas) {
        tokens.push(ouvido[j]!)
        doRoteiro.push(-1)
        doCandidato.push(c)
      }
    }
  }
  for (let i = 0; i < roteiro.length; i++) {
    porCandidatos(i)
    tokens.push(roteiro[i]!)
    doRoteiro.push(i)
    doCandidato.push(-1)
  }
  porCandidatos(roteiro.length)
  return { tokens, doRoteiro, doCandidato }
}
