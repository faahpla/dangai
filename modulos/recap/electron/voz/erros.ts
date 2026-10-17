import type { PalavraComTempo, TrechoDeErro } from '../../shared/voz'
import type { CandidatoDeErro } from './casar-fala'
import { maiorTrechoCalado, quadrosDeFala, type Corte, type Energia } from './pos'

/**
 * CORTAR ERROS (V1): do candidato (casar-fala.ts) com o tempo fino do wav2vec2
 * ao pedaco que sai do audio.
 *
 * O corte comeca e termina num quadro CALADO, como o corte de pausa: no meio
 * do maior silencio entre a palavra do roteiro de antes e o erro, e no meio do
 * maior silencio entre o erro e a palavra do roteiro de depois. Entre duas
 * palavras emendadas ("comecou quando, quando") quase nunca ha quadro abaixo
 * do limiar da pausa (o chao de ruido + 6 dB); ali vale o quadro QUIETO, 30 dB
 * abaixo da fala (a oclusao do "q", do "p", do "t"), e a rampa de 4 ms do pos
 * cuida da emenda. Sem nenhum dos dois, nao corta. Nunca passa
 * por palavra do roteiro (as pontas ficam entre o fim do som da de antes e o
 * comeco do som da de depois). Sobra metade de cada pausa: a emenda soa como
 * uma pausa so.
 *
 * Nao corta (e fica na lista, com o motivo):
 *   - 'incerto': o wav2vec2 nao achou bem as palavras do erro (o Whisper pode
 *     ter ouvido coisa que nao foi dita);
 *   - 'longo': sobra de mais de SOBRA_LONGA_SEC que nao repete o roteiro. Pode
 *     ser a leitura CERTA com o Whisper ouvindo errado;
 *   - 'sem-silencio': fala emendada, sem quadro calado numa das pontas.
 * Trecho sem fala nenhuma no tempo dele (o Whisper inventando no silencio)
 * nem entra na lista: o corte de pausa ja cuida do silencio.
 */

/** O erro ouvido, com o tempo do wav2vec2 no bruto (o que o cache guarda). */
export interface ErroOuvido {
  falado: string
  tipo: CandidatoDeErro['tipo']
  /** Do primeiro ao ultimo token do erro (wav2vec2), no bruto. */
  start: number
  end: number
  /** Confianca media do wav2vec2 nos tokens do erro. */
  score: number
  /** O indice (no roteiro inteiro) da palavra que vem logo depois. */
  antesDe: number
}

/** Abaixo disto o wav2vec2 nao achou o erro no som (medido nos testes de 17/10). */
export const SCORE_DO_ERRO = 0.3
/** Sobra (sem repetir o roteiro) maior que isto fica, com aviso. */
export const SOBRA_LONGA_SEC = 4
/** Um erro tem fala de verdade com pelo menos isto de quadros no nivel da fala. */
const FALA_MINIMA_QUADROS = 3
/** Corte menor que isto nao vale a emenda. */
const CORTE_MINIMO_SEC = 0.04

/** Quanto abaixo da fala (p90) um quadro e QUIETO o bastante para emendar entre palavras. */
const QUIETO_ABAIXO_DA_FALA_DB = 30

function quadroDe(e: Energia, t: number): number {
  return Math.floor((t * e.taxa) / e.amostrasPorQuadro)
}
function quadroAte(e: Energia, t: number): number {
  return Math.min(e.db.length, Math.ceil((t * e.taxa) / e.amostrasPorQuadro))
}
function tempoDoQuadro(e: Energia, q: number): number {
  return (q * e.amostrasPorQuadro) / e.taxa
}
/** O teto do quadro QUIETO deste audio. */
function tetoQuieto(e: Energia): number {
  return Math.max(e.limiar, e.fala - QUIETO_ABAIXO_DA_FALA_DB)
}

/**
 * O lugar da emenda em [a, b]: o meio do maior trecho calado (como o corte de
 * pausa); sem nenhum, o meio do maior trecho QUIETO. null = nem isso.
 */
function pontoDaEmenda(e: Energia, a: number, b: number): number | null {
  if (b <= a) return null
  const calado = maiorTrechoCalado(e, a, b)
  if (calado) return (calado.de + calado.ate) / 2
  const teto = tetoQuieto(e)
  const q1 = quadroAte(e, b)
  let melhor: { de: number; ate: number } | null = null
  let q = Math.max(0, quadroDe(e, a))
  while (q < q1) {
    if (e.db[q]! > teto) {
      q++
      continue
    }
    const de = q
    while (q < q1 && e.db[q]! <= teto) q++
    if (!melhor || q - de > melhor.ate - melhor.de) melhor = { de, ate: q }
  }
  if (!melhor) return null
  return Math.min(b, Math.max(a, (tempoDoQuadro(e, melhor.de) + tempoDoQuadro(e, melhor.ate)) / 2))
}

/**
 * A FALA DO ERRO dentro do vao [a, b] entre as duas palavras do roteiro: da
 * primeira a ultima ilha de som (acima do quieto) com pelo menos
 * FALA_MINIMA_QUADROS no nivel da fala. Respiracao e estalo nao contam. null =
 * nenhuma fala no vao (o Whisper inventou no silencio).
 *
 * E o SOM que diz onde o erro esta, nao o wav2vec2: o 1o token de um erro
 * depois de uma pausa as vezes comeca dentro do rabo da palavra de antes.
 */
function falaNoVao(e: Energia, a: number, b: number): { de: number; ate: number } | null {
  const teto = tetoQuieto(e)
  const fala = Math.max(e.limiar, e.fala - 20)
  const q1 = quadroAte(e, b)
  let primeira = -1
  let ultima = -1
  let q = Math.max(0, quadroDe(e, a))
  while (q < q1) {
    if (e.db[q]! <= teto) {
      q++
      continue
    }
    const ini = q
    let falando = 0
    while (q < q1 && e.db[q]! > teto) {
      if (e.db[q]! > fala) falando++
      q++
    }
    if (falando >= FALA_MINIMA_QUADROS) {
      if (primeira < 0) primeira = ini
      ultima = q
    }
  }
  return primeira < 0 ? null : { de: Math.max(a, tempoDoQuadro(e, primeira)), ate: Math.min(b, tempoDoQuadro(e, ultima)) }
}

/** Anda de `t` para a direita enquanto o som esta acima do quieto (o rabo da palavra), ate `limite`. */
function fimDoRabo(e: Energia, t: number, limite: number): number {
  const teto = tetoQuieto(e)
  let q = quadroDe(e, t)
  const qLimite = quadroAte(e, limite)
  while (q < qLimite && e.db[q]! > teto) q++
  return Math.min(limite, Math.max(t, tempoDoQuadro(e, q)))
}

/** Anda de `t` para a esquerda enquanto o som esta acima do quieto (o ataque da palavra), ate `limite`. */
function comecoDoAtaque(e: Energia, t: number, limite: number): number {
  const teto = tetoQuieto(e)
  let q = quadroAte(e, t) - 1
  const qLimite = quadroDe(e, limite)
  while (q >= qLimite && q >= 0 && e.db[q]! > teto) q--
  return Math.max(limite, Math.min(t, tempoDoQuadro(e, q + 1)))
}

/**
 * Os trechos fora do roteiro com o corte de cada um. `palavras` = as do
 * roteiro no bruto, na ordem dos tokens (a mesma do `antesDe`), ja encostadas
 * no som.
 *
 * Entre a palavra do roteiro de antes (P) e a de depois (Q) so ha o erro (o
 * casamento so marca sobra entre duas palavras bem ouvidas). Entao:
 *   1. o vao = do fim do rabo de P ao comeco do ataque de Q (som acima do quieto);
 *   2. a fala do erro = da 1a a ultima ilha de fala do vao;
 *   3. o corte = da emenda entre P e o erro a emenda entre o erro e Q.
 */
export function trechosDosErros(
  erros: readonly ErroOuvido[],
  palavras: readonly Pick<PalavraComTempo, 'start' | 'end'>[],
  e: Energia,
  duracao: number,
): TrechoDeErro[] {
  const saida: TrechoDeErro[] = []
  for (const erro of erros) {
    const antes = erro.antesDe > 0 ? palavras[erro.antesDe - 1] : undefined
    const depois = palavras[erro.antesDe]
    const limiteA = antes ? antes.end : 0
    const limiteB = depois ? depois.start : duracao
    if (limiteB <= limiteA) continue
    const s0 = Math.min(limiteB, Math.max(limiteA, erro.start))
    const s1 = Math.min(limiteB, Math.max(s0, erro.end))
    // O rabo de P e o ataque de Q andam no maximo ate o meio do erro (o wav2vec2 erra a ponta, nao o meio).
    const meio = (s0 + s1) / 2
    const a = antes ? fimDoRabo(e, antes.end, Math.max(antes.end, meio)) : 0
    const b = depois ? comecoDoAtaque(e, depois.start, Math.min(depois.start, Math.max(a, meio))) : duracao
    const fala = falaNoVao(e, a, b)
    if (!fala) {
      // Fala emendada em P ou Q (nem o meio do erro ficou de fora): se o wav2vec2 achou fala ali, fica na lista.
      if (quadrosDeFala(e, s0, s1) >= FALA_MINIMA_QUADROS) {
        saida.push({ de: s0, ate: s1, falado: erro.falado.slice(0, 300), tipo: erro.tipo, corte: null, motivo: 'sem-silencio' })
      }
      // Sem fala nenhuma: o Whisper inventou no silencio (o corte de pausa cuida dele).
      continue
    }
    const base = { de: fala.de, ate: fala.ate, falado: erro.falado.slice(0, 300), tipo: erro.tipo }
    if (erro.score < SCORE_DO_ERRO) {
      saida.push({ ...base, corte: null, motivo: 'incerto' })
      continue
    }
    if (erro.tipo === 'sobra' && fala.ate - fala.de > SOBRA_LONGA_SEC) {
      saida.push({ ...base, corte: null, motivo: 'longo' })
      continue
    }
    // As emendas: no comeco/fim do arquivo, a propria ponta.
    const de = antes ? pontoDaEmenda(e, limiteA, fala.de) : 0
    const ate = depois ? pontoDaEmenda(e, fala.ate, limiteB) : duracao
    if (de === null || ate === null || ate - de < CORTE_MINIMO_SEC) {
      saida.push({ ...base, corte: null, motivo: 'sem-silencio' })
      continue
    }
    saida.push({ ...base, corte: { de, ate }, motivo: null })
  }
  return saida
}

/** Os cortes (amostras) dos trechos que saem. */
export function cortesDosErros(trechos: readonly TrechoDeErro[], taxa: number, amostras: number): Corte[] {
  return trechos
    .filter((t) => t.corte)
    .map((t) => ({ de: Math.max(0, Math.round(t.corte!.de * taxa)), ate: Math.min(amostras, Math.round(t.corte!.ate * taxa)) }))
    .filter((c) => c.ate > c.de)
}

/** Os recados do take (ASCII, curtos), so com o corte ligado. */
export function avisosDosErros(trechos: readonly TrechoDeErro[]): string[] {
  const avisos: string[] = []
  const longos = trechos.filter((t) => t.motivo === 'longo')
  if (longos.length > 0) {
    const n = longos.length
    avisos.push(
      `${n} ${n === 1 ? 'trecho longo' : 'trechos longos'} fora do roteiro ${n === 1 ? 'ficou' : 'ficaram'}: pode ser o Whisper ouvindo errado. Confira.`,
    )
  }
  const emendados = trechos.filter((t) => t.motivo === 'sem-silencio').length
  if (emendados > 0) {
    avisos.push(`${emendados} ${emendados === 1 ? 'erro ficou' : 'erros ficaram'} sem corte: fala emendada, sem silencio na borda.`)
  }
  return avisos
}
