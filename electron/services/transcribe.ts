import type { AnalysisResult, ImageAsset, ScenePlan, Transcript } from '@shared/contract'
import {
  paragraphEnds,
  planBySections,
  planWithoutAI,
  sanitize,
  snapToCandidates,
} from '@shared/plan'
import { transcriptFromScript } from '@shared/align'
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
  /** Roteiro escrito pelo usuario. Vira a fonte do texto das legendas. */
  script: string | null
}

export type AnalyzeProgress = (message: string) => void

export async function analyze(
  request: AnalyzeRequest,
  onProgress: AnalyzeProgress,
): Promise<AnalysisResult> {
  const resultado = await analisar(request, onProgress)
  return { ...resultado, plan: semMovimentoEmClipe(resultado.plan, request.images) }
}

/**
 * Clipe nasce parado; print nasce com movimento.
 *
 * Mover uma imagem que ja se move some com o movimento proprio do clipe e
 * costuma dar enjoo -- por isso o padrao. Mas agora e so o PADRAO: o usuario
 * liga o movimento no clipe que quiser pelo card da cena, e a escolha dele
 * sobrevive porque editar o plano impede a redistribuicao automatica.
 *
 * Fica aqui, numa passada so no fim, e nao dentro de cada planejador: sao cinco
 * origens de plano (partes, IA, pontuacao, pausas, divisao igual) e a regra e a
 * mesma para todas.
 */
function semMovimentoEmClipe(plan: ScenePlan, images: readonly ImageAsset[]): ScenePlan {
  return {
    ...plan,
    scenes: plan.scenes.map((scene) =>
      images[scene.imageIndex]?.kind === 'video' ? { ...scene, effect: 'nenhum' as const } : scene,
    ),
  }
}

async function analisar(
  request: AnalyzeRequest,
  onProgress: AnalyzeProgress,
): Promise<AnalysisResult> {
  const { audioPath, subtitlePath, images, durationSec, script } = request
  const settings = getSettings()

  // Os nomes dos arquivos viram vocabulario para o Whisper -- ver
  // buildVocabularyPrompt.
  const measured = await getTranscript(
    audioPath,
    subtitlePath,
    images.map((image) => image.fileName),
    onProgress,
  )

  const { transcript, scriptNote } = applyScript(script, measured, onProgress)

  // -------------------------------------------------- degrau 0: partes do roteiro
  //
  // Vem ANTES da IA de proposito. Quando o usuario soltou pastas, ele ja disse
  // qual material pertence a qual parte -- e uma decisao dele, explicita, que
  // nenhum modelo tem porque revisar. A IA continua no caminho de sempre para
  // quem solta arquivo solto.
  const porPartes = planFromSections(images, durationSec, transcript)
  if (porPartes.plan) {
    const snapped = transcript
      ? snapToCandidates(porPartes.plan, transcript.cutCandidates, durationSec, images.length)
      : porPartes.plan
    return {
      plan: snapped,
      origin: 'sections',
      transcript,
      aiNote: null,
      scriptNote,
      sectionNote: porPartes.note,
    }
  }

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
      const snapped = snapToCandidates(
        clean,
        transcript.cutCandidates,
        durationSec,
        images.length,
      )

      return {
        plan: snapped,
        origin: 'ai',
        transcript,
        aiNote: null,
        scriptNote,
        sectionNote: porPartes.note,
      }
    } catch (err) {
      // Falha da IA nunca sobe: vira uma nota e o fallback assume.
      const note = err instanceof Error ? err.message : String(err)
      return withoutAI(
        images.length,
        durationSec,
        transcript,
        friendlyAiNote(note),
        scriptNote,
        porPartes.note,
      )
    }
  }

  // ------------------------------------------------- degrau 2 e 3: sem IA
  //
  // Nunca degradar em silencio. Se o usuario configurou a chave e mesmo assim
  // caiu no fallback, ele precisa saber o motivo e o que fazer -- senao fica
  // com um resultado pior sem explicacao nenhuma.
  return withoutAI(
    images.length,
    durationSec,
    transcript,
    whyNoAI(!!settings.anthropicApiKey, transcript),
    scriptNote,
    porPartes.note,
  )
}

/**
 * Troca o texto medido pelo texto do roteiro, mantendo os tempos.
 *
 * Se o roteiro nao casar com o audio (roteiro de outro episodio, ou colado pela
 * metade), fica com a transcricao original e avisa. Silenciosamente usar um
 * roteiro errado produziria legendas confiantes e completamente fora.
 */
function applyScript(
  script: string | null,
  measured: Transcript | null,
  onProgress: AnalyzeProgress,
): { transcript: Transcript | null; scriptNote: string | null } {
  const trimmed = script?.trim()
  if (!trimmed) return { transcript: measured, scriptNote: null }

  if (!measured || measured.words.length === 0) {
    return {
      transcript: measured,
      scriptNote:
        'Roteiro recebido, mas sem tempos para casar. E preciso o Whisper ou um .srt para saber quando cada palavra e dita.',
    }
  }

  onProgress('Casando o roteiro com a narracao...')
  const aligned = transcriptFromScript(trimmed, measured)

  if (!aligned) {
    return {
      transcript: measured,
      scriptNote:
        'Esse roteiro nao bate com essa narracao — legendas mantidas pela transcricao. Confira se e o texto deste audio.',
    }
  }

  const pct = Math.round((aligned.anchored / aligned.total) * 100)
  return {
    transcript: aligned.transcript,
    scriptNote: `Legendas do roteiro — ${pct}% das palavras com tempo medido.`,
  }
}

/**
 * Tenta montar o plano por partes, e explica em portugues quando nao da.
 *
 * A explicacao nao e cortesia: marcar as partes e um pedido explicito do
 * usuario, e ignorar esse pedido em silencio faria o video sair com o material
 * na parte errada sem ninguem perceber. Num video de teoria isso e pior que nao
 * ter imagem -- a imagem passa a contradizer a narracao.
 *
 * A parte pode ter vindo de duas maneiras, e as mensagens daqui nao citam
 * nenhuma das duas: soltando pastas na janela, ou marcando levas na Biblioteca.
 * Falar em "pasta" para quem usou a Biblioteca mandaria arrumar algo que ele
 * nem abriu.
 */
function planFromSections(
  images: readonly ImageAsset[],
  durationSec: number,
  transcript: Transcript | null,
): { plan: ScenePlan | null; note: string | null } {
  const seccionadas = images.filter((image) => image.section !== null)
  if (seccionadas.length === 0) return { plan: null, note: null }

  if (seccionadas.length !== images.length) {
    return {
      plan: null,
      note: 'Ha material com parte e material solto no mesmo projeto. Cenas distribuidas como de costume — deixe tudo em partes para o app respeita-las.',
    }
  }

  // Conta quanto material caiu em cada parte, na ordem em que foram criadas.
  const contagem: number[] = []
  for (const image of seccionadas) {
    const s = image.section!
    contagem[s] = (contagem[s] ?? 0) + 1
  }
  if (contagem.some((c) => c === undefined)) {
    return { plan: null, note: 'Uma das partes ficou sem material. Cenas distribuidas como de costume.' }
  }

  if (!transcript || transcript.words.length < 2) {
    return {
      plan: null,
      note: 'Sem roteiro cronometrado, o app nao sabe onde cada parte comeca. Cole o roteiro com uma linha em branco entre as partes.',
    }
  }

  const partesDoRoteiro = paragraphEnds(transcript.words).length + 1
  if (partesDoRoteiro !== contagem.length) {
    return {
      plan: null,
      note: `Seu roteiro tem ${partesDoRoteiro} ${partesDoRoteiro === 1 ? 'parte' : 'partes'} e o material esta em ${contagem.length}. Separe as partes do roteiro com uma linha em branco, ou ajuste o material.`,
    }
  }

  const plan = planBySections(contagem, durationSec, transcript.words)
  if (!plan) {
    return {
      plan: null,
      note: 'As partes batem, mas nao cabe tanto material no tempo de cada uma. Cenas distribuidas como de costume.',
    }
  }

  return {
    plan,
    note: `${contagem.length} partes, cada uma com o seu material.`,
  }
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
  scriptNote: string | null,
  /** Por que as pastas nao foram respeitadas, quando havia pastas. */
  sectionNote: string | null = null,
): AnalysisResult {
  const { plan, origin } = planWithoutAI(imageCount, durationSec, transcript)
  const snapped = transcript
    ? snapToCandidates(plan, transcript.cutCandidates, durationSec, imageCount)
    : plan
  return { plan: snapped, origin, transcript, aiNote, scriptNote, sectionNote }
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
