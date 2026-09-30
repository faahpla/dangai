/**
 * Alinhamento forcado: onde cada palavra DO ROTEIRO soa no audio.
 *
 * "Essa legenda do Dangai e muito bugada em comparacao com a do LegendAI. Eu
 * sinto ela muito atrasada, ela nao sincroniza perfeitamente."
 *
 * Os tempos vinham do whisper.cpp -- estimados a partir do texto que ele mesmo
 * transcreveu, colados um no outro, e depois casados com o roteiro. Medido no
 * projeto dele (Lye x Ram, 246 palavras) contra o LegendAI: 131 ms de erro
 * mediano, 308 ms no p90, 516 ms no pior caso, e o erro CRESCIA ao longo do
 * audio (57 ms no primeiro terco, 163 ms no ultimo).
 *
 * O LegendAI nao transcreve: ele pega o roteiro pronto e pergunta a um modelo
 * de fonemas (wav2vec2) em que quadro cada letra aparece. E o que mora aqui --
 * a MESMA conta do WhisperX 3.8 (whisperx/alignment.py), portada linha a linha
 * para que o Dangai e o LegendAI deem o mesmo tempo para a mesma palavra. O
 * modelo roda no main, pelo onnxruntime; esta parte e so aritmetica sobre a
 * saida dele, e por isso vive em shared/ e tem teste.
 */

/** O vocabulario do modelo: caractere -> coluna da emissao. */
export type Vocabulario = Readonly<Record<string, number>>

export interface TempoDaPalavra {
  start: number
  end: number
  /** Confianca media das letras (0..1). */
  score: number
}

/**
 * Alinha as palavras do roteiro a emissao do modelo.
 *
 * `emissao` e log_softmax, quadro a quadro: `quadros` linhas de `classes`
 * colunas. `segundosPorQuadro` converte o indice do quadro em tempo.
 *
 * Devolve um tempo por palavra, na ordem. `null` so quando nao houve como
 * alinhar nada -- quem chama cai no que tinha antes.
 */
export function alinharPalavras(
  palavras: readonly string[],
  emissaoBruta: Float32Array,
  quadros: number,
  classes: number,
  vocab: Vocabulario,
  segundosPorQuadro: number,
): TempoDaPalavra[] | null {
  /*
   * O texto e o do roteiro, com um espaco entre palavras -- como o LegendAI
   * monta o segmento unico ("tokens" separados por espaco).
   *
   * Cada letra minuscula que o modelo conhece vira a propria coluna. Espaco
   * vira "|", o separador de palavra do wav2vec2. O resto -- pontuacao,
   * digito, simbolo -- vira CURINGA: uma coluna nova com a melhor nota nao
   * branca daquele quadro. E o comportamento do WhisperX 3.8, e o motivo de
   * copia-lo em vez de simplesmente descartar a pontuacao e que ele muda onde
   * a palavra termina; descartar daria tempos diferentes dos do LegendAI.
   */
  const texto = palavras.join(' ')
  const letras: string[] = []
  const palavraDaLetra: number[] = []
  let palavra = 0
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!.toLowerCase()
    if (c === ' ') {
      letras.push('|')
      palavraDaLetra.push(-1)
      palavra++
      continue
    }
    letras.push(c)
    palavraDaLetra.push(palavra)
  }
  if (letras.length === 0 || quadros === 0) return null

  const branco = vocab['<pad>'] ?? vocab['[pad]'] ?? 0
  const temCuringa = letras.some((c) => vocab[c] === undefined)
  const colunas = temCuringa ? classes + 1 : classes
  const curinga = classes

  // A emissao estendida com a coluna do curinga, quando ha curinga.
  let emissao = emissaoBruta
  if (temCuringa) {
    emissao = new Float32Array(quadros * colunas)
    for (let t = 0; t < quadros; t++) {
      let melhor = -Infinity
      for (let k = 0; k < classes; k++) {
        const v = emissaoBruta[t * classes + k]!
        emissao[t * colunas + k] = v
        if (k !== branco && v > melhor) melhor = v
      }
      emissao[t * colunas + curinga] = melhor
    }
  }
  const tokens = letras.map((c) => vocab[c] ?? curinga)
  const n = tokens.length
  if (n > quadros) return null // mais letras que quadros: nao ha caminho

  /*
   * A trelica (get_trellis). Linha t+1, coluna j: a melhor nota de ter emitido
   * as j primeiras letras nos t primeiros quadros. Ficar custa um branco;
   * avancar custa a letra seguinte.
   *
   * Float64: as notas somam milhares de log-probabilidades, e a decisao do
   * caminho de volta compara duas somas quase iguais. Em float32 um empate
   * arredondado para o lado errado desloca a letra um quadro.
   */
  const larg = n + 1
  const trelica = new Float64Array((quadros + 1) * larg)
  trelica[0] = 0
  for (let t = 0; t < quadros; t++) {
    trelica[(t + 1) * larg] = trelica[t * larg]! + emissao[t * colunas + branco]!
  }
  for (let j = 1; j <= n; j++) trelica[j] = -Infinity
  // A trapaca do tutorial do torchaudio: as ultimas linhas nao podem terminar
  // sem ter emitido nada.
  for (let t = quadros + 1 - n; t <= quadros; t++) trelica[t * larg] = Infinity

  for (let t = 0; t < quadros; t++) {
    const base = t * larg
    const prox = (t + 1) * larg
    const eBranco = emissao[t * colunas + branco]!
    for (let j = 1; j <= n; j++) {
      const ficar = trelica[base + j]! + eBranco
      const mudar = trelica[base + j - 1]! + emissao[t * colunas + tokens[j - 1]!]!
      trelica[prox + j] = ficar > mudar ? ficar : mudar
    }
  }

  // Caminho de volta (backtrack), a partir do melhor quadro final.
  let j = n
  let tInicio = 0
  let melhorFim = -Infinity
  for (let t = 0; t <= quadros; t++) {
    const v = trelica[t * larg + j]!
    if (v > melhorFim) {
      melhorFim = v
      tInicio = t
    }
  }

  const caminhoToken: number[] = []
  const caminhoTempo: number[] = []
  const caminhoProb: number[] = []
  let completou = false
  for (let t = tInicio; t > 0; t--) {
    const ficar = trelica[(t - 1) * larg + j]! + emissao[(t - 1) * colunas + branco]!
    const mudar = trelica[(t - 1) * larg + j - 1]! + emissao[(t - 1) * colunas + tokens[j - 1]!]!
    const mudou = mudar > ficar
    caminhoToken.push(j - 1)
    caminhoTempo.push(t - 1)
    caminhoProb.push(Math.exp(emissao[(t - 1) * colunas + (mudou ? tokens[j - 1]! : branco)]!))
    if (mudou) {
      j--
      if (j === 0) {
        completou = true
        break
      }
    }
  }
  if (!completou) return null
  caminhoToken.reverse()
  caminhoTempo.reverse()
  caminhoProb.reverse()

  // merge_repeats: cada letra ocupa do quadro em que surgiu ate a seguinte.
  const inicioDaLetra = new Array<number>(n).fill(NaN)
  const fimDaLetra = new Array<number>(n).fill(NaN)
  const notaDaLetra = new Array<number>(n).fill(NaN)
  for (let a = 0; a < caminhoToken.length; ) {
    let b = a
    let soma = 0
    while (b < caminhoToken.length && caminhoToken[b] === caminhoToken[a]) {
      soma += caminhoProb[b]!
      b++
    }
    const k = caminhoToken[a]!
    inicioDaLetra[k] = caminhoTempo[a]!
    fimDaLetra[k] = caminhoTempo[b - 1]! + 1
    notaDaLetra[k] = soma / (b - a)
    a = b
  }

  /*
   * Palavra = da primeira a ultima letra dela, sem o espaco. O WhisperX
   * arredonda cada letra a milissegundos ANTES de tirar o minimo e o maximo;
   * repetido aqui para bater ate o ultimo digito.
   */
  const ms = (x: number): number => Math.round(x * 1000) / 1000
  const tempos: (TempoDaPalavra | null)[] = palavras.map(() => null)
  const notas: number[][] = palavras.map(() => [])
  for (let k = 0; k < n; k++) {
    const p = palavraDaLetra[k]!
    if (p < 0 || Number.isNaN(inicioDaLetra[k]!)) continue
    const ini = ms(inicioDaLetra[k]! * segundosPorQuadro)
    const fim = ms(fimDaLetra[k]! * segundosPorQuadro)
    const atual = tempos[p]
    tempos[p] = atual
      ? { start: Math.min(atual.start, ini), end: Math.max(atual.end, fim), score: 0 }
      : { start: ini, end: fim, score: 0 }
    notas[p]!.push(notaDaLetra[k]!)
  }

  if (tempos.every((t) => t === null)) return null
  for (const [i, t] of tempos.entries()) {
    if (t) t.score = notas[i]!.reduce((a, b) => a + b, 0) / notas[i]!.length
  }
  return preencherBuracos(tempos)
}

/**
 * Palavra sem letra alinhada herda o tempo por interpolacao linear entre as
 * vizinhas -- o `interpolate_nans` do WhisperX. Na pratica nao acontece com
 * roteiro normal (toda palavra tem ao menos uma letra ou um curinga), mas uma
 * palavra vazia nao pode derrubar o resto.
 */
function preencherBuracos(tempos: readonly (TempoDaPalavra | null)[]): TempoDaPalavra[] {
  const conhecidos = tempos.flatMap((t, i) => (t ? [i] : []))
  return tempos.map((t, i) => {
    if (t) return t
    const antes = conhecidos.filter((k) => k < i).at(-1)
    const depois = conhecidos.find((k) => k > i)
    if (antes === undefined) return { ...tempos[depois!]!, score: 0 }
    if (depois === undefined) return { ...tempos[antes]!, score: 0 }
    const a = tempos[antes]!
    const b = tempos[depois]!
    const f = (i - antes) / (depois - antes)
    return { start: a.start + (b.start - a.start) * f, end: a.end + (b.end - a.end) * f, score: 0 }
  })
}
