import type { AnalysisResult, ImageAsset, Transcript } from '@shared/contract'
import { planWithoutAI, sanitize, snapToCandidates } from '@shared/plan'
import { parseSrt } from './srt'
import { transcribe } from './whisper'
import { detectSilences } from './silence'
import { planWithAI } from './planner'
import { getSettings } from './settings'

/**
 * A cadeia inteira: transcrever -> planejar -> sanear -> alinhar aos cortes
 * naturais.
 *
 * Cada degrau tem o degrau de baixo. O app nunca trava por causa da IA nem por
 * falta de internet; no pior caso perde a distribuicao inteligente das cenas e
 * entrega divisao igual, que ainda produz video valido.
 *
 *   texto:  .srt do usuario  ->  Whisper local     ->  (nenhum)
 *   plano:  Anthropic        ->  pausas naturais   ->  divisao igual
 */

export interface AnalyzeRequest {
  audioPath: string
  subtitlePath: string | null
  images: readonly ImageAsset[]
  durationSec: number
}

export type AnalyzeProgress = (message: string) => void

export async function analyze(
  request: AnalyzeRequest,
  onProgress: AnalyzeProgress,
): Promise<AnalysisResult> {
  const { audioPath, subtitlePath, images, durationSec } = request
  const settings = getSettings()

  // Os nomes dos arquivos viram vocabulario para o Whisper -- ver
  // buildVocabularyPrompt.
  const transcript = await getTranscript(
    audioPath,
    subtitlePath,
    images.map((image) => image.fileName),
    onProgress,
  )

  // --------------------------------------------------------------- degrau 1: IA
  if (settings.anthropicApiKey && transcript && transcript.text.length > 0) {
    try {
      onProgress('Distribuindo as cenas...')
      const raw = await planWithAI({
        apiKey: settings.anthropicApiKey,
        imageCount: images.length,
        durationSec,
        transcript,
        imageNames: images.map((image) => image.fileName),
      })

      // Mesmo vindo da IA, o plano passa pelo saneamento e pelo snap. As
      // garantias do produto nao dependem de o modelo ter obedecido.
      const clean = sanitize(raw, images.length, durationSec)
      const snapped = snapToCandidates(clean, transcript.cutCandidates, durationSec)

      return { plan: snapped, origin: 'ai', transcript, aiNote: null }
    } catch (err) {
      // Falha da IA nunca sobe: vira uma nota e o fallback assume.
      const note = err instanceof Error ? err.message : String(err)
      return withoutAI(images.length, durationSec, transcript, friendlyAiNote(note))
    }
  }

  // ------------------------------------------------- degrau 2 e 3: sem IA
  //
  // Nunca degradar em silencio. Se o usuario configurou a chave e mesmo assim
  // caiu no fallback, ele precisa saber o motivo e o que fazer -- senao fica
  // com um resultado pior sem explicacao nenhuma.
  return withoutAI(images.length, durationSec, transcript, whyNoAI(!!settings.anthropicApiKey, transcript))
}

function whyNoAI(hasKey: boolean, transcript: Transcript | null): string | null {
  if (!hasKey) {
    return 'Sem chave da API — cenas distribuidas pelas pausas da narracao.'
  }
  if (!transcript || transcript.text.length === 0) {
    return 'Sem transcricao da narracao — cenas distribuidas pelas pausas. Solte o .srt junto do audio, ou conecte a internet uma vez para o Dangai baixar o Whisper.'
  }
  return null
}

function withoutAI(
  imageCount: number,
  durationSec: number,
  transcript: Transcript | null,
  aiNote: string | null,
): AnalysisResult {
  const { plan, origin } = planWithoutAI(imageCount, durationSec, transcript)
  const snapped = transcript
    ? snapToCandidates(plan, transcript.cutCandidates, durationSec)
    : plan
  return { plan: snapped, origin, transcript, aiNote }
}

/**
 * .srt ganha do Whisper quando existe: os tempos ja foram conferidos pelo
 * usuario e o parse e instantaneo. Sem nenhum dos dois, ainda sobram as pausas.
 */
async function getTranscript(
  audioPath: string,
  subtitlePath: string | null,
  imageNames: readonly string[],
  onProgress: AnalyzeProgress,
): Promise<Transcript | null> {
  if (subtitlePath) {
    onProgress('Lendo a legenda...')
    try {
      return parseSrt(subtitlePath)
    } catch {
      // .srt ilegivel nao interrompe: tenta transcrever.
    }
  }

  try {
    const settings = getSettings()
    const fromWhisper = await transcribe(
      audioPath,
      settings.whisperModel,
      onProgress,
      imageNames,
    )
    if (fromWhisper) return fromWhisper
  } catch {
    // Whisper indisponivel ou falhou: sobra a deteccao de pausas.
  }

  onProgress('Procurando as pausas da narracao...')
  try {
    const silences = await detectSilences(audioPath)
    if (silences.length === 0) return null
    return {
      source: 'silence',
      words: [],
      segments: [],
      text: '',
      cutCandidates: silences,
    }
  } catch {
    return null
  }
}

/** Traduz a falha tecnica em algo que diga o que fazer. */
function friendlyAiNote(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('401') || lower.includes('authentication') || lower.includes('api key')) {
    return 'Chave da API recusada — confira em configuracoes. Cenas distribuidas pelas pausas.'
  }
  if (lower.includes('429') || lower.includes('rate')) {
    return 'Limite da API atingido. Cenas distribuidas pelas pausas da narracao.'
  }
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('enotfound')) {
    return 'Sem conexao com a API. Cenas distribuidas pelas pausas da narracao.'
  }
  return `A IA nao respondeu (${raw.slice(0, 60)}). Cenas distribuidas pelas pausas.`
}
