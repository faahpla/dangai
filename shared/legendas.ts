import {
  CAPTION_BREAK_AFTER,
  CAPTION_NAO_FECHA_LINHA,
  REGRAS_DA_LEGENDA_PADRAO,
  VIDEO_FPS,
  type CaptionBlock,
  type RegrasDaLegenda,
  type Transcript,
  type Word,
} from './contract'

/**
 * Como a narracao vira legenda: o agrupamento do Dangai, o tempo do LegendAI.
 *
 * O AGRUPAMENTO e o que ele foi afinando aqui desde agosto: duas palavras e dez
 * caracteres por linha, pontuacao fecha a linha, pausa longa fecha a linha, e
 * artigo/preposicao nunca fecham -- descem junto com o que apresentam. Os dois
 * tetos viraram opcao; as regras do portugues continuam valendo sempre.
 *
 * O TEMPO e o Legend Engine do LegendAI (legendai/engine.py), portado com uma
 * excecao so: a legenda NUNCA recua para dentro do silencio anterior para
 * alcancar a duracao minima. No Dangai isso ja pos legenda 0,29 s antes da
 * palavra, e ele desligou as legendas por causa disso (07/09). O que ela pode
 * e ADIANTAR o fio configurado -- 40 ms, os mesmos do LegendAI dele.
 *
 * Tudo aqui trabalha em SEGUNDOS e so vira quadro no fim, preso a grade de
 * 30 fps: arredondar no meio do caminho soma erro de meio quadro em cada etapa.
 */

interface Grupo {
  words: Word[]
  start: number
  end: number
}

export function buildCaptions(
  transcript: Transcript | null,
  regras: RegrasDaLegenda = REGRAS_DA_LEGENDA_PADRAO,
): CaptionBlock[] {
  if (!transcript || transcript.words.length === 0) return []
  const grupos = agrupar(transcript.words, regras)
  resgatarPiscadas(grupos, regras)
  cronometrar(grupos, regras)
  return grupos.map(paraQuadros)
}

/**
 * Os tempos novos para legendas que ELE ja editou.
 *
 * Mesclar, dividir e corrigir texto sao decisoes dele, e ressincronizar nao
 * pode desfaze-las: o agrupamento fica exatamente como esta, e so os tempos
 * mudam. `palavras` e a sequencia das palavras das legendas, na ordem, cada uma
 * com o tempo medido.
 */
export function retemporizar(
  blocos: readonly CaptionBlock[],
  palavras: readonly Word[],
  regras: RegrasDaLegenda = REGRAS_DA_LEGENDA_PADRAO,
): CaptionBlock[] {
  let k = 0
  const grupos: Grupo[] = []
  for (const bloco of blocos) {
    const words = bloco.words.map((w) => ({ ...palavras[k++]!, text: w.text }))
    if (words.length === 0) continue
    grupos.push({ words, start: words[0]!.start, end: words.at(-1)!.end })
  }
  cronometrar(grupos, regras)
  return grupos.map(paraQuadros)
}

// ---------------------------------------------------------------- agrupamento

/**
 * A palavra se prende a que vem DEPOIS dela?
 *
 * Artigo, preposicao, contracao e as conjuncoes que abrem oracao. Compara sem
 * a pontuacao e sem caixa: "A" no comeco da frase e artigo igual, e "da," com
 * virgula ja fecha a linha pela regra da pontuacao, antes de chegar aqui.
 */
export function ehLigante(text: string): boolean {
  const limpa = text
    // NFC: um "a" com acento combinante e um "à" sao a mesma palavra, e o
    // Whisper devolve ora uma forma ora a outra.
    .normalize('NFC')
    .toLowerCase()
    .replace(/^[«"'“‘([{]+/u, '')
    .replace(/[."'”’)\]}»,!?;:…]+$/u, '')
  return CAPTION_NAO_FECHA_LINHA.includes(limpa)
}

/**
 * A palavra termina fechando uma ideia?
 *
 * Ignora aspas e parenteses no fim para enxergar a pontuacao de verdade: em
 * `disse."` quem fecha a frase e o ponto, nao a aspa.
 */
function fechaIdeia(text: string): boolean {
  const bare = text.replace(/["'”’)\]}»]+$/u, '')
  const last = bare.at(-1)
  return last !== undefined && CAPTION_BREAK_AFTER.includes(last)
}

/** Pausa que sempre fecha a linha: ler atraves de um silencio longo desconecta o texto da fala. */
const PAUSA_QUE_QUEBRA = 0.45

function agrupar(palavras: readonly Word[], r: RegrasDaLegenda): Grupo[] {
  const grupos: Grupo[] = []
  let atual: Word[] = []
  const fechar = (): void => {
    if (atual.length === 0) return
    grupos.push({ words: atual, start: atual[0]!.start, end: atual.at(-1)!.end })
    atual = []
  }

  for (const [i, word] of palavras.entries()) {
    const anterior = atual.at(-1)
    const vao = anterior ? word.start - anterior.end : 0
    // Comprimento da linha se esta palavra entrar, contando o espaco.
    const chars = atual.reduce((soma, w) => soma + w.text.length + 1, 0) + word.text.length

    const cheio = atual.length >= r.palavras
    // As duas checagens exigem a linha ja ocupada: com a linha vazia, quebrar
    // aqui deixaria um bloco sem palavra nenhuma.
    const largo = atual.length > 0 && chars > r.caracteres
    const pausou = atual.length > 0 && vao > PAUSA_QUE_QUEBRA
    // Pontuacao fecha a linha: a palavra seguinte comeca outra ideia.
    const pontuou = anterior !== undefined && fechaIdeia(anterior.text)

    /*
     * A linha nao fecha em artigo -- QUANDO O PAR CABE.
     *
     * Esta palavra fecharia a linha, mas ela se prende a seguinte -- entao a
     * quebra vem ANTES dela, e ela sobe junto com o que apresenta.
     *
     * O TETO DE CARACTERES NAO SE QUEBRA POR ISTO. Na v1.45 o artigo descia
     * mesmo passando do teto, e saiu "DESDE RECEM-NASCIDO," -- 19 caracteres
     * com o limite em 10. Palavras dele: "a excecao do limite serve apenas para
     * palavras individuais que sao naturalmente maiores, e para palavras
     * compostas". Nao cabendo, cada uma fica na sua linha.
     */
    const proxima = palavras[i + 1]
    const fecharia = atual.length > 0 && atual.length + 1 >= r.palavras
    const prendeNaProxima =
      fecharia &&
      ehLigante(word.text) &&
      !fechaIdeia(word.text) &&
      proxima !== undefined &&
      proxima.start - word.end <= PAUSA_QUE_QUEBRA &&
      word.text.length + 1 + proxima.text.length <= r.caracteres

    if (cheio || largo || pausou || pontuou || prendeNaProxima) fechar()
    atual.push(word)
  }
  fechar()

  absorverLigantesSozinhas(grupos, r.caracteres)
  return grupos
}

/**
 * Artigo sozinho numa legenda desce para a legenda do substantivo.
 *
 * Com uma palavra por legenda o agrupamento acima nao tem como segurar o
 * artigo -- a linha ja fecha em uma. Grupo feito so de ligantes se junta ao
 * SEGUINTE ("dos | guardas" vira "dos guardas"). So no fim do texto, sem
 * seguinte, ele recua para o anterior.
 *
 * SO SE COUBER no teto de caracteres -- a mesma regra de cima: "desde" e
 * "recem-nascido," ficam cada um na sua linha, porque juntos dariam 19.
 *
 * Nao atravessa pontuacao nem pausa: "de," fecha a propria linha pela regra da
 * pontuacao, e o que vem depois de uma pausa longa ja e outra fala.
 */
function absorverLigantesSozinhas(grupos: Grupo[], caracteres: number): void {
  const cabe = (a: Grupo, b: Grupo): boolean =>
    [...a.words, ...b.words].map((w) => w.text).join(' ').length <= caracteres
  let i = 0
  while (i < grupos.length) {
    const g = grupos[i]!
    const soLigantes = g.words.every((w) => ehLigante(w.text))
    const ultima = g.words.at(-1)!
    if (!soLigantes || fechaIdeia(ultima.text)) {
      i++
      continue
    }
    const seguinte = grupos[i + 1]
    if (seguinte && seguinte.start - g.end <= PAUSA_QUE_QUEBRA && cabe(g, seguinte)) {
      seguinte.words = [...g.words, ...seguinte.words]
      seguinte.start = g.start
      grupos.splice(i, 1)
      continue // o grupo unido pode, ele mesmo, ser so de ligantes
    }
    const anterior = grupos[i - 1]
    if (!seguinte && anterior && !fechaIdeia(anterior.words.at(-1)!.text) && cabe(anterior, g)) {
      anterior.words = [...anterior.words, ...g.words]
      anterior.end = g.end
      grupos.splice(i, 1)
      continue
    }
    i++
  }
}

/**
 * Junta o grupo que ia PISCAR com o vizinho.
 *
 * "para" sozinha dura os 0,13 s que se leva para dizer "para": tres quadros na
 * tela nao sao lidos como legenda rapida, e sim como legenda fora de hora. O
 * resgate respeita os mesmos tetos do agrupamento e o ponto final continua
 * sendo parede. Tenta o vizinho de TRAS primeiro ("suficiente para"), a nao
 * ser que o orfao comece em artigo -- esse pertence ao que vem depois.
 */
function resgatarPiscadas(grupos: Grupo[], r: RegrasDaLegenda): void {
  // Metade do piso: pega so o que realmente pisca, e nao costura o video
  // inteiro em pares.
  const pisca = r.minimo * 0.5
  const cabeJunto = (a: Grupo, b: Grupo): boolean => {
    if (fechaIdeia(a.words.at(-1)!.text)) return false
    if (a.words.length + b.words.length > r.palavras) return false
    return [...a.words, ...b.words].map((w) => w.text).join(' ').length <= r.caracteres
  }

  for (let i = 0; i < grupos.length; i++) {
    const g = grupos[i]!
    if (g.end - g.start >= pisca) continue
    const anterior = grupos[i - 1]
    const proximo = grupos[i + 1]
    const puxaParaFrente = ehLigante(g.words[0]!.text) && proximo !== undefined && cabeJunto(g, proximo)

    if (!puxaParaFrente && anterior && cabeJunto(anterior, g)) {
      anterior.words = [...anterior.words, ...g.words]
      anterior.end = g.end
      grupos.splice(i, 1)
      i -= 1
      continue
    }
    if (proximo && cabeJunto(g, proximo)) {
      g.words = [...g.words, ...proximo.words]
      g.end = proximo.end
      grupos.splice(i + 1, 1)
    }
  }
}

// ---------------------------------------------------------------------- tempo

/**
 * A janela de cada legenda na tela. A ordem e a do Legend Engine: sobreposicao,
 * minimo, maximo, margem, sobreposicao de novo, vaos, grade de quadros.
 */
function cronometrar(grupos: Grupo[], r: RegrasDaLegenda): void {
  corrigirSobreposicao(grupos)
  garantirMinimo(grupos, r.minimo)
  for (const g of grupos) {
    if (g.end - g.start > r.maximo) g.end = g.start + r.maximo
  }
  adiantar(grupos, r.adiantar)
  corrigirSobreposicao(grupos)
  if (r.fecharVaos > 0) {
    for (let i = 0; i + 1 < grupos.length; i++) {
      const vao = grupos[i + 1]!.start - grupos[i]!.end
      if (vao > 0 && vao <= r.fecharVaos) grupos[i]!.end = grupos[i + 1]!.start
    }
  }
  prenderNaGrade(grupos)
}

function corrigirSobreposicao(grupos: Grupo[]): void {
  for (let i = 1; i < grupos.length; i++) {
    const a = grupos[i - 1]!
    const b = grupos[i]!
    if (b.start < a.end) b.start = a.end
    if (b.end < b.start) b.end = b.start
  }
}

/**
 * Estica o que ficou curto demais para ser lido, so para dentro do SILENCIO
 * depois dele.
 *
 * Nem para tras (ver o topo deste arquivo) nem por emprestimo do seguinte. O
 * emprestimo -- que o LegendAI faz e o Dangai fazia -- empurra o INICIO da
 * legenda seguinte para depois da palavra dela: medido na narracao do Lye, ate
 * 267 ms de atraso. Era um atraso de verdade, fabricado por esta regra, e e
 * exatamente a queixa ("sinto ela muito atrasada"). Legenda rapida e menos
 * ruim que legenda fora de hora; e o que ficaria curto demais o resgate de
 * piscadas ja juntou com o vizinho antes de chegar aqui.
 */
function garantirMinimo(grupos: Grupo[], minimo: number): void {
  for (let i = 0; i < grupos.length; i++) {
    const g = grupos[i]!
    const falta = minimo - (g.end - g.start)
    if (falta <= 1e-9) continue
    const seguinte = grupos[i + 1]
    const livre = seguinte ? Math.max(seguinte.start - g.end, 0) : falta
    g.end += Math.min(falta, livre)
  }
}

/**
 * A legenda entra um fio ANTES da palavra.
 *
 * No maximo metade do silencio antes dela -- a outra metade e da legenda de
 * tras --, e a primeira nao passa do zero.
 */
function adiantar(grupos: Grupo[], quanto: number): void {
  if (quanto <= 0) return
  for (let i = 0; i < grupos.length; i++) {
    const g = grupos[i]!
    const vao = i === 0 ? g.start : g.start - grupos[i - 1]!.end
    g.start -= Math.min(quanto, Math.max(i === 0 ? vao : vao / 2, 0))
  }
}

/**
 * Tempos sobre a grade de 30 fps, com ao menos um quadro cada, e legendas
 * encostadas continuando encostadas depois do arredondamento.
 */
function prenderNaGrade(grupos: Grupo[]): void {
  const passo = 1 / VIDEO_FPS
  for (const g of grupos) {
    g.start = Math.round(g.start * VIDEO_FPS) / VIDEO_FPS
    g.end = Math.round(g.end * VIDEO_FPS) / VIDEO_FPS
  }
  for (let i = 0; i < grupos.length; i++) {
    const g = grupos[i]!
    if (g.end <= g.start) g.end = g.start + passo
    const seguinte = grupos[i + 1]
    if (seguinte && seguinte.start < g.end) seguinte.start = g.end
  }
}

/**
 * O grupo vira bloco em quadros. As palavras ficam presas a janela do bloco:
 * o realce compara quadros absolutos, e uma palavra de fora nunca acenderia.
 */
function paraQuadros(g: Grupo): CaptionBlock {
  const from = Math.max(Math.round(g.start * VIDEO_FPS), 0)
  const fim = Math.max(Math.round(g.end * VIDEO_FPS), from + 1)
  return {
    from,
    durationInFrames: fim - from,
    words: g.words.map((w) => {
      const a = Math.min(Math.max(Math.round(w.start * VIDEO_FPS), from), fim - 1)
      const b = Math.min(Math.max(Math.round(w.end * VIDEO_FPS), a + 1), fim)
      return { text: w.text, from: a, durationInFrames: b - a }
    }),
  }
}
