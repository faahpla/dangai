import { alignScript, tokenizeScript } from '@shared/align'
import type { Word } from '@shared/contract'
import type { FraseParaNarrar, PalavraComTempo, TrechoDaFrase } from '../../shared/voz'
import { fronteiraPeloSom, type Energia } from './pos'

/**
 * CARACTERES -> PALAVRAS DO ROTEIRO, e palavras -> trechos por frase.
 *
 * Funcoes puras (sem disco, sem rede): o motor chama, o teste confere.
 *
 * A regra dura de shared/voz.ts: o TEXTO de cada palavra e o do roteiro
 * (tokenizeScript de cada frase). O provedor e o alinhador so dao o tempo.
 * Tres caminhos, do melhor para o pior (TakeDaVoz.origemDoAlinhamento):
 *
 *   'provedor'    o `alignment` do ElevenLabs bate caractere a caractere com o
 *                 texto mandado: cada palavra pega o tempo das proprias letras
 *                 pela faixa de caractere da frase. Nada e adivinhado;
 *   'normalizado' so o normalized_alignment serve ("37" virou "trinta e
 *                 sete", "Dr." virou "Doutor"): as palavras dele sao casadas
 *                 com as do roteiro por alignScript (Needleman-Wunsch do
 *                 Dangai), e o que nao casa recebe o tempo do vao entre as
 *                 vizinhas;
 *   'alinhador'   wav2vec2 com as palavras do roteiro (palavrasDoAlinhador),
 *                 ou o Whisper casado por alignScript (palavrasPeloRoteiro).
 */

/** O alignment por caractere do ElevenLabs (alignment ou normalized_alignment). */
export interface AlinhamentoDeCaracteres {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

/** Confere o formato que veio da rede. null = ausente ou quebrado (listas de tamanhos diferentes, numero invalido). */
export function alinhamentoDe(cru: unknown): AlinhamentoDeCaracteres | null {
  if (typeof cru !== 'object' || cru === null) return null
  const a = cru as Record<string, unknown>
  const chars = a['characters']
  const ini = a['character_start_times_seconds']
  const fim = a['character_end_times_seconds']
  if (!Array.isArray(chars) || !Array.isArray(ini) || !Array.isArray(fim)) return null
  if (chars.length === 0 || chars.length !== ini.length || chars.length !== fim.length) return null
  if (!chars.every((c) => typeof c === 'string')) return null
  const numero = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x) && x >= 0
  if (!ini.every(numero) || !fim.every(numero)) return null
  return {
    characters: chars as string[],
    character_start_times_seconds: ini as number[],
    character_end_times_seconds: fim as number[],
  }
}

/** Letra ou digito: o que SOA. Pontuacao e espaco nao. */
const SOA = /[\p{L}\p{N}]/u

/** A chave de comparacao do align.ts (sem acento, sem pontuacao, minuscula). */
function chaveDaPalavra(token: string): string {
  return token
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Porte do _alignment_to_words do AniRecap (core/captions.py): varre os
 * caracteres e quebra palavra em espaco, tab e quebra de linha.
 *
 * Uma diferenca de proposito: o tempo da palavra sai das LETRAS e DIGITOS.
 * O ElevenLabs as vezes estica o ponto final por cima da pausa inteira
 * ("tempo." com o "." durando 400 ms); contando o ponto, a palavra "terminaria"
 * no fim da pausa e o corte de pausa nao a veria. Palavra sem letra nenhuma
 * fica com o tempo de todos os caracteres dela.
 */
export function palavrasDosCaracteres(a: AlinhamentoDeCaracteres): Word[] {
  const palavras: Word[] = []
  let texto = ''
  let iniQualquer = Number.NaN
  let fimQualquer = Number.NaN
  let iniLetra = Number.NaN
  let fimLetra = Number.NaN
  const fechar = (): void => {
    if (texto.trim()) {
      const start = Number.isNaN(iniLetra) ? iniQualquer : iniLetra
      const end = Number.isNaN(fimLetra) ? fimQualquer : fimLetra
      palavras.push({ text: texto.trim(), start, end: Math.max(start, end) })
    }
    texto = ''
    iniQualquer = fimQualquer = iniLetra = fimLetra = Number.NaN
  }
  for (let i = 0; i < a.characters.length; i++) {
    const c = a.characters[i]!
    if (/^\s+$/.test(c)) {
      fechar()
      continue
    }
    const s = a.character_start_times_seconds[i]!
    const e = a.character_end_times_seconds[i]!
    if (!texto) iniQualquer = s
    texto += c
    fimQualquer = e
    if (SOA.test(c)) {
      if (Number.isNaN(iniLetra)) iniLetra = s
      fimLetra = e
    }
  }
  fechar()
  return palavras
}

/** Um token do roteiro com a faixa [de, ate) dele dentro do texto da frase (unidades de string). */
export interface TokenComFaixa {
  texto: string
  de: number
  ate: number
}

/**
 * Os tokens de tokenizeScript(texto) com onde cada um esta no texto. Mesma
 * regra do Dangai: [marcacao] e (marcacao) saem, token sem letra/digito sai.
 * A marcacao vira espaco do MESMO tamanho, para os indices nao andarem. null
 * = a lista nao bateu com a do tokenizeScript (nao deveria; quem chama cai no
 * caminho por palavra).
 */
export function tokensComFaixa(texto: string): TokenComFaixa[] | null {
  const branco = (m: string): string => ' '.repeat(m.length)
  const mascarado = texto.replace(/\[[^\]]*\]/g, branco).replace(/\([^)]*\)/g, branco)
  const tokens: TokenComFaixa[] = []
  for (const m of mascarado.matchAll(/\S+/g)) {
    const t = m[0]
    if (chaveDaPalavra(t).length === 0) continue
    tokens.push({ texto: t, de: m.index, ate: m.index + t.length })
  }
  const esperado = tokenizeScript(texto)
  if (tokens.length !== esperado.length || tokens.some((t, i) => t.texto !== esperado[i])) return null
  return tokens
}

export interface PalavrasCasadas {
  palavras: PalavraComTempo[]
  /** Palavras com tempo MEDIDO (o resto foi interpolado entre as vizinhas). */
  ancoradas: number
  total: number
}

/**
 * O mapa unidade de string do `texto` -> elemento de `characters`, olhando so
 * o que NAO e espaco: o provedor pode devolver a linha em branco entre secoes
 * como um espaco (ou sem ela) e o resto igualzinho. Token nunca tem espaco
 * dentro, entao nenhuma palavra depende do espaco. null = os caracteres
 * visiveis nao sao os do texto.
 */
function mapaDosCaracteres(a: AlinhamentoDeCaracteres, texto: string): (number | undefined)[] | null {
  const doTexto: number[] = []
  for (let u = 0; u < texto.length; u++) if (!/\s/.test(texto[u]!)) doTexto.push(u)
  const doAlinhamento: { k: number; c: string }[] = []
  for (const [k, c] of a.characters.entries()) {
    for (let j = 0; j < c.length; j++) if (!/\s/.test(c[j]!)) doAlinhamento.push({ k, c: c[j]! })
  }
  if (doTexto.length !== doAlinhamento.length) return null
  const mapa: (number | undefined)[] = new Array(texto.length)
  for (const [i, u] of doTexto.entries()) {
    if (texto[u] !== doAlinhamento[i]!.c) return null
    mapa[u] = doAlinhamento[i]!.k
  }
  return mapa
}

/**
 * Caminho 'provedor': o `alignment` e o texto mandado, igualzinho (fora o
 * espaco, ver mapaDosCaracteres). Cada token de cada frase pega o tempo das
 * proprias letras. null = o alignment nao e deste texto (quem chama tenta o
 * normalizado).
 *
 * `characters` pode trazer um elemento com mais de uma unidade de string
 * (emoji): o mapa unidade -> caractere cuida disso.
 */
export function palavrasPeloTexto(
  a: AlinhamentoDeCaracteres,
  texto: string,
  frases: readonly Pick<FraseParaNarrar, 'fraseId' | 'texto' | 'de'>[],
): PalavrasCasadas | null {
  const caractereDaUnidade = mapaDosCaracteres(a, texto)
  if (!caractereDaUnidade) return null

  const palavras: PalavraComTempo[] = []
  for (const f of frases) {
    const tokens = tokensComFaixa(f.texto)
    if (!tokens) return null
    for (const t of tokens) {
      let ini = Number.NaN
      let fim = Number.NaN
      let iniQ = Number.NaN
      let fimQ = Number.NaN
      for (let u = f.de + t.de; u < f.de + t.ate; u++) {
        const k = caractereDaUnidade[u]
        if (k === undefined) return null
        const s = a.character_start_times_seconds[k]!
        const e = a.character_end_times_seconds[k]!
        if (Number.isNaN(iniQ)) iniQ = s
        fimQ = e
        if (SOA.test(a.characters[k]!)) {
          if (Number.isNaN(ini)) ini = s
          fim = e
        }
      }
      const start = Number.isNaN(ini) ? iniQ : ini
      const end = Number.isNaN(fim) ? fimQ : fim
      if (Number.isNaN(start)) return null
      palavras.push({ texto: t.texto, start, end: Math.max(start, end), fraseId: f.fraseId })
    }
  }
  return { palavras: arrumarPalavras(palavras), ancoradas: palavras.length, total: palavras.length }
}

/**
 * Caminho por palavra medida (o normalizado do ElevenLabs, ou o Whisper): as
 * palavras do roteiro casadas com as medidas por alignScript. null = menos da
 * metade casou (o audio nao e deste texto) ou a contagem nao fechou.
 */
export function palavrasPeloRoteiro(
  medidas: readonly Word[],
  frases: readonly Pick<FraseParaNarrar, 'fraseId' | 'palavras'>[],
): PalavrasCasadas | null {
  const tokens = frases.flatMap((f) => f.palavras.map((p) => ({ texto: p, fraseId: f.fraseId })))
  if (tokens.length === 0 || medidas.length === 0) return null
  const casado = alignScript(tokens.map((t) => t.texto).join(' '), medidas)
  if (!casado || casado.words.length !== tokens.length) return null
  if (casado.words.some((w) => !Number.isFinite(w.start) || !Number.isFinite(w.end))) return null
  const palavras = casado.words.map((w, i) => ({
    texto: tokens[i]!.texto,
    start: w.start,
    end: w.end,
    fraseId: tokens[i]!.fraseId,
  }))
  return { palavras: arrumarPalavras(palavras), ancoradas: casado.anchored, total: casado.total }
}

/** Caminho 'alinhador': um tempo por token, na ordem (alinharAoAudio). */
export function palavrasDoAlinhador(
  tempos: readonly { start: number; end: number; score: number }[],
  frases: readonly Pick<FraseParaNarrar, 'fraseId' | 'palavras'>[],
): PalavrasCasadas | null {
  const tokens = frases.flatMap((f) => f.palavras.map((p) => ({ texto: p, fraseId: f.fraseId })))
  if (tempos.length !== tokens.length) return null
  const palavras = tokens.map((t, i) => ({ texto: t.texto, start: tempos[i]!.start, end: tempos[i]!.end, fraseId: t.fraseId }))
  return { palavras: arrumarPalavras(palavras), ancoradas: tempos.filter((t) => t.score > 0).length, total: tokens.length }
}

/**
 * Deixa as palavras em ordem e sem sobreposicao: inicio nunca volta, fim nunca
 * antes do inicio, e uma palavra termina no maximo onde a seguinte comeca. E o
 * que garante que a fronteira de frase (meio do vao) nunca corta palavra.
 */
export function arrumarPalavras(palavras: readonly PalavraComTempo[]): PalavraComTempo[] {
  const saida = palavras.map((p) => ({ ...p, start: Math.max(0, p.start), end: Math.max(0, p.end) }))
  for (let i = 0; i < saida.length; i++) {
    const p = saida[i]!
    if (i > 0 && p.start < saida[i - 1]!.start) p.start = saida[i - 1]!.start
    if (p.end < p.start) p.end = p.start
  }
  for (let i = 0; i < saida.length - 1; i++) {
    const p = saida[i]!
    const prox = saida[i + 1]!
    if (p.end > prox.start) p.end = Math.max(p.start, prox.start)
  }
  return saida
}

/** O que um trecho guarda da frase (o texto falado quando foi gravado). */
export type FraseDoTrecho = Pick<FraseParaNarrar, 'fraseId' | 'texto' | 'hash'>

/**
 * Fronteiras de frase em AMOSTRAS: 0, o meio da pausa entre a ultima palavra de
 * uma frase e a primeira da seguinte, ..., o fim do arquivo. Em amostras para a
 * soma dos trechos fechar exata com o arquivo.
 *
 * Com a `energia` do audio, "o meio da pausa" e o meio do maior trecho CALADO
 * do vao (fronteiraPeloSom), nao o meio aritmetico: um erro do alinhamento nao
 * joga mais a fronteira para dentro da fala. As frases cujo vao antes delas nao
 * tem quadro calado nenhum vao para `semPausa`.
 */
export function fronteirasPelasPalavras(
  palavras: readonly PalavraComTempo[],
  fraseIds: readonly string[],
  amostras: number,
  taxa: number,
  energia?: Energia,
  semPausa?: string[],
): number[] {
  const limites = new Map<string, { ini: number; fim: number }>()
  for (const p of palavras) {
    const l = limites.get(p.fraseId)
    if (!l) limites.set(p.fraseId, { ini: p.start, fim: p.end })
    else l.fim = Math.max(l.fim, p.end)
  }
  const fronteiras = [0]
  for (let i = 0; i < fraseIds.length - 1; i++) {
    const anterior = fronteiras.at(-1)!
    const a = limites.get(fraseIds[i]!)
    const fimA = a ? a.fim : anterior / taxa
    // A proxima frase sem palavra (so pontuacao): fica com o resto ate a seguinte que tem.
    let iniB = fimA
    let proxima: string | null = null
    for (let j = i + 1; j < fraseIds.length; j++) {
      const b = limites.get(fraseIds[j]!)
      if (b) {
        iniB = b.ini
        proxima = fraseIds[j]!
        break
      }
    }
    let meio = (fimA + Math.max(fimA, iniB)) / 2
    if (energia && a && proxima) {
      const f = fronteiraPeloSom(energia, fimA, iniB)
      meio = f.t
      if (!f.calado) semPausa?.push(proxima)
    }
    fronteiras.push(Math.min(amostras, Math.max(anterior, Math.round(meio * taxa))))
  }
  fronteiras.push(amostras)
  return fronteiras
}

/** Trechos a partir das fronteiras em amostras. */
export function trechosDasFronteiras(
  frases: readonly FraseDoTrecho[],
  fronteiras: readonly number[],
  taxa: number,
): TrechoDaFrase[] {
  return frases.map((f, i) => ({
    fraseId: f.fraseId,
    offset: fronteiras[i]! / taxa,
    duracao: (fronteiras[i + 1]! - fronteiras[i]!) / taxa,
    hashTexto: f.hash,
    texto: f.texto,
  }))
}

/** Os trechos de um audio pelas palavras dele (fronteira no meio da pausa; com `energia`, no meio do silencio). */
export function trechosPelasPalavras(
  palavras: readonly PalavraComTempo[],
  frases: readonly FraseDoTrecho[],
  amostras: number,
  taxa: number,
  energia?: Energia,
  semPausa?: string[],
): TrechoDaFrase[] {
  const fronteiras = fronteirasPelasPalavras(
    palavras,
    frases.map((f) => f.fraseId),
    amostras,
    taxa,
    energia,
    semPausa,
  )
  return trechosDasFronteiras(frases, fronteiras, taxa)
}

/** Nomes proprios do roteiro (palavra com maiuscula), para enviesar o Whisper. */
export function nomesDoRoteiro(frases: readonly Pick<FraseParaNarrar, 'palavras'>[]): string[] {
  const nomes = new Set<string>()
  for (const f of frases) {
    for (const [i, p] of f.palavras.entries()) {
      const limpo = p.replace(/[^\p{L}\p{N}-]/gu, '')
      if (i > 0 && limpo.length >= 3 && /^\p{Lu}/u.test(limpo)) nomes.add(limpo)
    }
  }
  return [...nomes].slice(0, 40)
}
