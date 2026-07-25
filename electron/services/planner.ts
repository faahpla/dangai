import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import {
  KEN_BURNS_EFFECTS,
  TRANSITIONS,
  scenePlanSchema,
  type ScenePlan,
  type Transcript,
} from '@shared/contract'
import { MAX_SCENE_SEC, MIN_SCENE_SEC } from '@shared/plan'

/**
 * Chamada a Anthropic que decide onde caem os cortes.
 *
 * O que a IA decide: os instantes de corte, o efeito de cada cena e a
 * transicao. O que ela NAO decide: a ordem das imagens -- essa e do usuario.
 *
 * Roda no processo main. A chave nunca chega no renderer, e o unico dado que
 * sai da maquina e o texto da transcricao: nem audio, nem imagem.
 */

const MODEL = 'claude-sonnet-5'

/**
 * O contrato de saida da IA, separado do schema de dominio de proposito.
 *
 * Aqui tudo e obrigatorio e sem default: saida estruturada exige schema
 * fechado, e `.default()` nao tem como ser expresso em JSON Schema. Os defaults
 * e o saneamento vem depois, em shared/plan.
 *
 * Com output_config, a API GARANTE JSON valido neste formato -- por isso o
 * prompt nao precisa implorar por "responda so JSON, sem markdown". A classe de
 * erro que aquilo tentava evitar deixa de existir.
 */
const aiPlanSchema = z.object({
  scenes: z.array(
    z.object({
      imageIndex: z.number().int().min(0),
      start: z.number().min(0),
      end: z.number().min(0),
      effect: z.enum(KEN_BURNS_EFFECTS),
      intensity: z.number().min(0.08).max(0.15),
      transitionIn: z.enum(TRANSITIONS),
      reason: z.string(),
    }),
  ),
})

export interface PlanRequest {
  apiKey: string
  imageCount: number
  durationSec: number
  transcript: Transcript
  imageNames: readonly string[]
}

export async function planWithAI(request: PlanRequest): Promise<ScenePlan> {
  const client = new Anthropic({ apiKey: request.apiKey, maxRetries: 1 })

  const message = await client.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    output_config: { format: zodOutputFormat(aiPlanSchema) },
    system:
      'Voce monta o plano de cortes de um short de recap de anime, em portugues do Brasil. ' +
      'Decide APENAS onde cada imagem entra no tempo, o movimento de camera e a transicao. ' +
      'A ordem das imagens e fixa e foi escolhida pelo usuario: a imagem 0 aparece primeiro, ' +
      'depois a 1, e assim por diante. Nunca reordene.',
    messages: [{ role: 'user', content: buildPrompt(request) }],
  })

  const output = message.parsed_output
  if (!output) {
    throw new Error('A IA nao devolveu um plano.')
  }

  // Revalida contra o schema de dominio. O da IA garante o formato; este
  // garante as regras do app.
  const parsed = scenePlanSchema.safeParse(output)
  if (!parsed.success) {
    throw new Error(`Plano invalido: ${parsed.error.issues[0]?.message ?? 'formato inesperado'}`)
  }
  return parsed.data
}

/** Exportado para o teste conferir o prompt sem gastar chamada de API. */
export function buildPrompt(request: PlanRequest): string {
  const { transcript, imageCount, durationSec, imageNames } = request

  // Manda as falas com tempo: e o que permite casar conteudo com imagem.
  const lines = transcript.segments
    .map((segment) => `[${segment.start.toFixed(2)}-${segment.end.toFixed(2)}] ${segment.text}`)
    .join('\n')

  const images = imageNames.map((name, index) => `${index}: ${name}`).join('\n')

  return [
    `A narracao dura ${durationSec.toFixed(2)} segundos e tem ${imageCount} imagens.`,
    '',
    'Narracao com tempos:',
    lines,
    '',
    'Imagens, na ordem em que devem aparecer:',
    images,
    '',
    'Monte o plano seguindo estas regras:',
    `- Exatamente ${imageCount} cenas, uma por imagem, com imageIndex indo de 0 a ${imageCount - 1} em ordem crescente.`,
    '- A primeira cena comeca em 0 e a ultima termina exatamente na duracao da narracao.',
    '- As cenas sao contiguas: o end de uma e o start da seguinte.',
    `- Cada cena entre ${MIN_SCENE_SEC} e ${MAX_SCENE_SEC} segundos.`,
    '- Corte onde a narracao muda de assunto, nunca no meio de uma frase.',
    '- Troque o movimento entre cenas seguidas; nao repita o mesmo duas vezes seguidas.',
    '- transitionIn da primeira cena e sempre "cut". Prefira "cut" na maioria; use os outros com parcimonia.',
    '- Em reason, escreva 3 a 6 palavras dizendo por que o corte cai ali.',
  ].join('\n')
}
