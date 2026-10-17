import type { FraseParaNarrar } from '../../shared/voz'
import { alinharAoAudio, type Alinhamento } from '../alinhador'
import { getSettings } from '../settings'
import { transcribe } from '../whisper'
import { Cancelado } from './ffmpeg'
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
  opcoes: { whisper: boolean; signal?: AbortSignal; avisar: (mensagem: string) => void },
): Promise<ResultadoDoAlinhador> {
  const avisos: string[] = []
  const tokens = frases.flatMap((f) => f.palavras)
  if (tokens.length === 0) throw new Error('O roteiro nao tem palavras para alinhar.')

  let peloWhisper: PalavrasCasadas | null = null
  let whisperOuviu = false
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
        peloWhisper = palavrasPeloRoteiro(t.words, frases)
      }
    } catch (err) {
      if (err instanceof Cancelado) throw err
      avisos.push('O Whisper nao rodou: so o alinhador decidiu os tempos.')
    }
  }

  opcoes.avisar(`Alinhando ${tokens.length} palavras...`)
  let forcado: Alinhamento | null = null
  try {
    // [recap] Idem no alinhador do nucleo: sem signal, o correrContra solta a espera.
    forcado = await correrContra(alinharAoAudio(caminhoWav, paraOModelo(tokens), opcoes.avisar), opcoes.signal)
  } catch (err) {
    if (err instanceof Cancelado) throw err
    avisos.push(`Sincronia fina indisponivel (${(err instanceof Error ? err.message : String(err)).slice(0, 80)}).`)
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
  if (veredito === 'forcado' && pelaIa && forcado) return { casadas: pelaIa, score: forcado.score, avisos }
  if (veredito === 'recusar') throw new Error('Esse audio nao parece ser a narracao deste roteiro. Confira o arquivo.')
  if (peloWhisper) {
    /*
     * Os tempos do whisper.cpp erram por centenas de ms neste material (t4: 624
     * ms em media, 1,9 s no pior). O take sai (o montarTake ainda encosta cada
     * palavra no som), mas com score 0 quando o wav2vec2 nem rodou: a qualidade
     * fica FRACA e o "Aprovar voz" pede confirmacao.
     */
    avisos.push('A sincronia fina nao reconheceu o roteiro: tempos do Whisper, grossos. Confira antes de aprovar.')
    return { casadas: peloWhisper, score: forcado?.score ?? 0, avisos }
  }
  if (pelaIa && forcado) {
    avisos.push('O audio nao parece ser este roteiro (confianca baixa). Confira as palavras.')
    return { casadas: pelaIa, score: forcado.score, avisos }
  }
  throw new Error('Nao deu para achar as palavras do roteiro neste audio.')
}
