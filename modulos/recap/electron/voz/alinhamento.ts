import type { Word } from '@shared/contract'
import type { FraseParaNarrar } from '../../shared/voz'
import { alinharAoAudio, type Alinhamento } from '../alinhador'
import { getSettings } from '../settings'
import { transcribe } from '../whisper'
import { acharCandidatos, chaveDaFala, sequenciaFalada, type CandidatoDeErro } from './casar-fala'
import type { ErroOuvido } from './erros'
import { mensagemDoTrechoQueFalta, trechoQueFalta } from './falta-no-audio'
import { Cancelado } from './ffmpeg'
import { quadrosDeFala, type Energia } from './pos'
import {
  nomesDoRoteiro,
  palavrasDoAlinhador,
  palavrasPeloRoteiro,
  type PalavrasCasadas,
} from './palavras'

/**
 * O caminho 'alinhador': o tempo das palavras DO ROTEIRO num audio que nao
 * trouxe tempo (Fish Audio, audio importado, ou o ElevenLabs sem alignment).
 *
 * E a regra do Dangai (transcribe.ts applyScript/sincronizar): o texto vem do
 * roteiro, o audio so da os tempos.
 *   - Whisper local (so no importado): diz se o audio e MESMO deste roteiro
 *     (alignScript casa >= 50% das palavras) e serve de reserva;
 *   - wav2vec2 PT (alinhador.ts, o mesmo modelo do LegendAI): o tempo fino de
 *     cada palavra. Abaixo de 0,35 de confianca o texto nao e o do audio.
 * No TTS (Fish) o texto e o roteiro por construcao: vai direto ao wav2vec2.
 */

/** O limite do LegendAI (transcribe.ts sincronizar). */
const SCORE_MINIMO = 0.35
/** Acima disto o wav2vec2 sozinho basta, mesmo com o Whisper discordando (ver alinharPeloAudio). */
const SCORE_SEGURO = 0.6

export interface ResultadoDoAlinhador {
  casadas: PalavrasCasadas
  /** Confianca media do wav2vec2 (null = so Whisper). */
  score: number | null
  avisos: string[]
  /** A fala fora do roteiro (V1, so com `erros` nas opcoes). Vazio sem confianca. */
  erros: ErroOuvido[]
}

/** Um erro so entra no alinhamento com fala no tempo que o Whisper deu (folga dos tempos grossos dele). */
const FOLGA_DO_WHISPER_SEC = 0.3

/**
 * Os candidatos com fala de verdade perto do tempo que o Whisper deu: o
 * Whisper inventa frase no silencio ("Obrigado.", legenda de site) e isso nao
 * pode ir ao wav2vec2 como se tivesse sido dito.
 */
function comFalaPerto(candidatos: readonly CandidatoDeErro[], ouvidas: readonly Word[], e: Energia): CandidatoDeErro[] {
  return candidatos.filter((c) => {
    const a = ouvidas[c.ouvidas[0]!]!.start - FOLGA_DO_WHISPER_SEC
    const b = ouvidas[c.ouvidas.at(-1)!]!.end + FOLGA_DO_WHISPER_SEC
    return quadrosDeFala(e, Math.max(0, a), b) >= 3
  })
}

/** A media das notas > 0 (a mesma conta do alinharAoAudio). */
function mediaDasNotas(tempos: readonly { score: number }[]): number {
  const comNota = tempos.filter((t) => t.score > 0)
  return comNota.reduce((a, t) => a + t.score, 0) / Math.max(comNota.length, 1)
}

/**
 * O que o wav2vec2 LE de cada token: so letras e digitos ("tempo." -> "tempo",
 * "Why-Man" -> "WhyMan", "Dr." -> "Dr").
 *
 * No alinhar.ts do Dangai a pontuacao vira CURINGA, e o merge_repeats da ao
 * curinga os quadros brancos que vem depois dele: a ultima palavra da frase
 * ("tempo.", "todos?") terminava no fim da PAUSA, so quando o modelo emitia o
 * "|" da fala seguinte. Medido no t4 (importado): 'tempo.' cobrindo 1,25 s de
 * silencio, a frase seguinte acendendo 500 ms tarde, a fronteira de frase em
 * plena fala e a pausa escondida do corte. Sem a pontuacao, nenhuma palavra
 * cobre silencio e o pior erro cai de 498/1.705 ms para 122/76 ms.
 *
 * O texto da palavra continua o do roteiro (palavrasDoAlinhador): so o tempo
 * sai do modelo. O alinhar.ts fica intocado (o Dangai e o LegendAI seguem
 * iguais); a limpeza e daqui.
 */
export function paraOModelo(tokens: readonly string[]): string[] {
  return tokens.map((t) => t.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '') || t)
}

/** A promessa ou o Cancelar, o que vier primeiro (o processo e morto por quem recebe o signal). */
export function correrContra<T>(promessa: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promessa
  if (signal.aborted) return Promise.reject(new Cancelado())
  return new Promise<T>((resolve, reject) => {
    const desistir = (): void => reject(new Cancelado())
    signal.addEventListener('abort', desistir, { once: true })
    promessa.then(
      (v) => {
        signal.removeEventListener('abort', desistir)
        resolve(v)
      },
      (e: unknown) => {
        signal.removeEventListener('abort', desistir)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

/**
 * A decisao do alinharPeloAudio, pura (testada em scripts/teste/v-audio-que-nao-bate.ts).
 * 'forcado' = tempos do wav2vec2; 'recusar' = nao e o audio deste roteiro;
 * 'seguir' = cai nos caminhos de reserva (Whisper grosso, ou wav2vec2 fraco com aviso).
 */
export function vereditoDoAlinhamento(s: {
  temForcado: boolean
  confianca: number
  whisperNega: boolean
  temPeloWhisper: boolean
  comWhisper: boolean
}): 'forcado' | 'recusar' | 'seguir' {
  if (s.temForcado && s.confianca >= SCORE_MINIMO && !(s.comWhisper && s.whisperNega && s.confianca < SCORE_SEGURO)) {
    return 'forcado'
  }
  if (s.whisperNega || (s.comWhisper && !s.temPeloWhisper && s.confianca < SCORE_MINIMO)) return 'recusar'
  return 'seguir'
}

export async function alinharPeloAudio(
  caminhoWav: string,
  frases: readonly Pick<FraseParaNarrar, 'fraseId' | 'palavras'>[],
  opcoes: {
    whisper: boolean
    signal?: AbortSignal
    avisar: (mensagem: string) => void
    /** V1: procurar a fala fora do roteiro (so o importado, que tem o Whisper). A energia do audio. */
    erros?: { energia: Energia }
  },
): Promise<ResultadoDoAlinhador> {
  const avisos: string[] = []
  const tokens = frases.flatMap((f) => f.palavras)
  if (tokens.length === 0) throw new Error('O roteiro nao tem palavras para alinhar.')

  let peloWhisper: PalavrasCasadas | null = null
  let whisperOuviu = false
  let ouvidas: Word[] = []
  let todasOuvidas: Word[] = []
  let candidatos: CandidatoDeErro[] = []
  if (opcoes.whisper) {
    opcoes.avisar('Ouvindo o audio (Whisper local)...')
    try {
      // [recap] O Whisper do nucleo nao aceita o signal (o do Studio aceitava): o
      // Cancelar solta a espera na hora, e a transcricao termina sozinha por tras.
      const t = await correrContra(
        transcribe(caminhoWav, getSettings().whisperModel, opcoes.avisar, nomesDoRoteiro(frases)),
        opcoes.signal,
      )
      if (t && t.words.length > 0) {
        whisperOuviu = true
        todasOuvidas = t.words
        peloWhisper = palavrasPeloRoteiro(t.words, frases)
        if (opcoes.erros && peloWhisper) {
          // V1: o que o Whisper ouviu contra o roteiro (casar-fala.ts). So palavra com letra.
          ouvidas = t.words.filter((w) => chaveDaFala(w.text).length > 0)
          const achados = acharCandidatos(tokens, ouvidas.map((w) => w.text))
          if (achados.desconfiado) avisos.push('Muita fala fora do roteiro: nenhum erro foi cortado. Confira o audio.')
          candidatos = comFalaPerto(achados.candidatos, ouvidas, opcoes.erros.energia)
        }
      }
    } catch (err) {
      if (err instanceof Cancelado) throw err
      avisos.push('O Whisper nao rodou: so o alinhador decidiu os tempos.')
    }
  }

  /*
   * O AUDIO SEM UM PEDACO DO ROTEIRO (falta-no-audio.ts): recusa antes do
   * wav2vec2, que espremeria o roteiro inteiro no som que existe. So no
   * importado (que tem a energia do audio) e com o Whisper tendo ouvido fala.
   */
  if (opcoes.erros && todasOuvidas.length > 0) {
    const e = opcoes.erros.energia
    const segundos = (quadros: number): number => (quadros * e.amostrasPorQuadro) / e.taxa
    const falta = trechoQueFalta(
      tokens,
      todasOuvidas.filter((w) => chaveDaFala(w.text).length > 0),
      (a, b) => segundos(quadrosDeFala(e, a, b)),
      segundos(e.db.length),
    )
    if (falta) throw new Error(mensagemDoTrechoQueFalta(tokens, falta))
  }

  /*
   * Com erro ouvido (V1), o wav2vec2 alinha a SEQUENCIA FALADA: o roteiro com
   * as palavras de cada erro no lugar onde foram ditas. Sem elas, ele espalhava
   * as palavras do roteiro pelas duas leituras de uma frase repetida. Sem erro,
   * os tokens sao os do roteiro, como sempre.
   */
  const falada = candidatos.length > 0 ? sequenciaFalada(tokens, ouvidas.map((w) => w.text), candidatos) : null
  const paraAlinhar = falada ? falada.tokens : tokens
  opcoes.avisar(`Alinhando ${paraAlinhar.length} palavras...`)
  let forcado: Alinhamento | null = null
  try {
    // [recap] Idem no alinhador do nucleo: sem signal, o correrContra solta a espera.
    forcado = await correrContra(alinharAoAudio(caminhoWav, paraOModelo(paraAlinhar), opcoes.avisar), opcoes.signal)
  } catch (err) {
    if (err instanceof Cancelado) throw err
    avisos.push(`Sincronia fina indisponivel (${(err instanceof Error ? err.message : String(err)).slice(0, 80)}).`)
  }
  let erros: ErroOuvido[] = []
  if (forcado && falada) {
    // Separa: os tempos do roteiro seguem como sempre; os do erro viram ErroOuvido.
    const doRoteiro = forcado.tempos.filter((_, k) => falada.doRoteiro[k]! >= 0)
    erros = candidatos.map((c, ci) => {
      const seus = forcado!.tempos.filter((_, k) => falada.doCandidato[k] === ci)
      return {
        falado: c.ouvidas.map((j) => ouvidas[j]!.text).join(' '),
        tipo: c.tipo,
        start: Math.min(...seus.map((t) => t.start)),
        end: Math.max(...seus.map((t) => t.end)),
        score: seus.reduce((a, t) => a + t.score, 0) / Math.max(seus.length, 1),
        antesDe: c.antesDe,
      }
    })
    forcado = { tempos: doRoteiro, score: mediaDasNotas(doRoteiro) }
  }
  const pelaIa = forcado ? palavrasDoAlinhador(forcado.tempos, frases) : null
  const confianca = forcado?.score ?? 0
  // O Whisper ouviu fala, mas nem metade das palavras e do roteiro.
  const whisperNega = whisperOuviu && !peloWhisper

  /*
   * AUDIO QUE NAO E O DO ROTEIRO (v0.1.1, achado por um usuario: importou um
   * audio nada a ver e o take saiu "aceito com aviso"). Com o Whisper (audio
   * importado), dois sinais decidem juntos:
   *   - o wav2vec2 forca o texto no som e SEMPRE devolve tempos; a confianca
   *     media e que diz se o som era esse texto (>= 0,35 no LegendAI);
   *   - o Whisper ouve o que foi dito sem saber do roteiro.
   * Confianca alta (>= 0,6) vale sozinha: o Whisper erra nome e girias. Entre
   * 0,35 e 0,6, o Whisper tem que concordar. Abaixo de 0,35 sem o Whisper
   * concordar, recusa (antes passava com um aviso que ninguem le). Sem o
   * Whisper (TTS, onde o texto e o roteiro por construcao) fica como era.
   */
  const veredito = vereditoDoAlinhamento({
    temForcado: pelaIa !== null && forcado !== null,
    confianca,
    whisperNega,
    temPeloWhisper: peloWhisper !== null,
    comWhisper: opcoes.whisper,
  })
  if (veredito === 'forcado' && pelaIa && forcado) return { casadas: pelaIa, score: forcado.score, avisos, erros }
  if (veredito === 'recusar') throw new Error('Esse audio nao parece ser a narracao deste roteiro. Confira o arquivo.')
  if (peloWhisper) {
    /*
     * Os tempos do whisper.cpp erram por centenas de ms neste material (t4: 624
     * ms em media, 1,9 s no pior). O take sai (o montarTake ainda encosta cada
     * palavra no som), mas com score 0 quando o wav2vec2 nem rodou: a qualidade
     * fica FRACA e o "Aprovar voz" pede confirmacao.
     */
    avisos.push('A sincronia fina nao reconheceu o roteiro: tempos do Whisper, grossos. Confira antes de aprovar.')
    // Sem a sincronia fina, nenhum erro e cortado (nao ha borda confiavel).
    return { casadas: peloWhisper, score: forcado?.score ?? 0, avisos, erros: [] }
  }
  if (pelaIa && forcado) {
    avisos.push('O audio nao parece ser este roteiro (confianca baixa). Confira as palavras.')
    return { casadas: pelaIa, score: forcado.score, avisos, erros: [] }
  }
  throw new Error('Nao deu para achar as palavras do roteiro neste audio.')
}
