import { z } from 'zod'
import { metadataSchema, type Metadata } from '@shared/contract'
import { gerarJson } from './llm'

/**
 * Titulo, descricao e hashtags a partir do roteiro.
 *
 * Roda no main pelo mesmo motivo do planner: a chave nunca chega no renderer, e
 * o unico dado que sai da maquina e o TEXTO -- nem audio, nem imagem, nem o
 * video pronto.
 *
 * O app ja tem o roteiro inteiro na mao, entao isto custa uma chamada e poupa o
 * trabalho manual que hoje acontece depois de cada render.
 */

/**
 * Contrato de saida, fechado e sem default -- saida estruturada exige isso, e
 * `.default()` nao tem como ser expresso em JSON Schema.
 *
 * Exportado para o teste conferir o JSON Schema que vai para o Gemini.
 */
export const aiMetadataSchema = z.object({
  titles: z.array(z.string()),
  description: z.string(),
  hashtags: z.array(z.string()),
})

export interface MetadataRequest {
  /** Roteiro escrito, ou o texto transcrito quando nao ha roteiro. */
  texto: string
}

export async function generateMetadata(request: MetadataRequest): Promise<Metadata> {
  const texto = request.texto.trim()
  if (texto.length < 40) {
    throw new Error(
      'Nao ha roteiro suficiente para gerar os textos. Cole o roteiro ou deixe a transcricao terminar.',
    )
  }

  // A chave e o provedor vem das configuracoes, pelo llm.ts. Aqui a nota vai
  // direto para a interface: ninguem traduz o erro depois.
  const resposta = await gerarJson({
    schema: aiMetadataSchema,
    etapa: 'textos',
    maxTokens: 2048,
    sistema:
      'Voce escreve o titulo, a descricao e as hashtags de um short de recap de anime, ' +
      'em portugues do Brasil, para YouTube Shorts e TikTok. Escreve como quem fala com ' +
      'a comunidade de anime, sem soar como anuncio.',
    prompt: buildPrompt(texto),
  })
  if (!resposta.ok) throw new Error(resposta.nota)

  const parsed = metadataSchema.safeParse(resposta.valor)
  if (!parsed.success) {
    throw new Error(`Textos invalidos: ${parsed.error.issues[0]?.message ?? 'formato inesperado'}`)
  }

  return sanitize(parsed.data)
}

/** Exportado para o teste conferir o prompt sem gastar chamada de API. */
export function buildPrompt(texto: string): string {
  return [
    'Este e o roteiro narrado do video:',
    '',
    texto,
    '',
    'Escreva:',
    '- titles: exatamente 3 titulos diferentes entre si, cada um com no maximo 70 caracteres.',
    '  Sem prometer nada que o roteiro nao entrega. Sem "VOCE NAO VAI ACREDITAR".',
    '  Use o nome do anime e dos personagens quando o roteiro citar.',
    '- description: 2 a 3 frases dizendo o que acontece no video, terminando com um convite',
    '  curto para seguir o canal. Sem emoji em excesso: no maximo um.',
    '- hashtags: de 5 a 8 palavras-chave, minusculas, sem o caractere #, sem espacos dentro',
    '  de cada uma, comecando pelas mais especificas (anime, personagem) e terminando nas',
    '  genericas (recap, shorts).',
  ].join('\n')
}

/**
 * Apara o que o modelo costuma exagerar, em vez de pedir de novo.
 *
 * Uma segunda chamada custaria tempo e dinheiro para corrigir coisas que dao
 * para arrumar aqui sem perder nada.
 */
function sanitize(raw: Metadata): Metadata {
  return {
    titles: raw.titles
      .map((titulo) => titulo.trim())
      .filter((titulo) => titulo.length > 0)
      .slice(0, 3),
    description: raw.description.trim(),
    hashtags: raw.hashtags
      .map((tag) => tag.trim().replace(/^#+/, '').replace(/\s+/g, ''))
      .filter((tag) => tag.length > 0)
      .slice(0, 8),
  }
}
