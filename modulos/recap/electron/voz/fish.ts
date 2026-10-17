import { notaDaFalha } from '../voz-chaves'
import { velocidadeNativaEnviada, type ConfigFish } from '../../shared/voz'
import { settingsEnviados, type PedidoDeVoz } from './cache'
import { ErroDoProvedor, fetchPago, lerErroEleven, pagoSemVoz, type RespostaDoProvedor } from './eleven'
import { Cancelado } from './ffmpeg'

/**
 * Fish Audio: a voz propria dele, SEM tempo por palavra.
 *
 * Conferido na documentacao oficial em 14/10/2026
 * (docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech):
 *   - POST https://api.fish.audio/v1/tts, Authorization: Bearer, cabecalho
 *     `model` (s1, s2-pro, s2.1-pro = padrao, s2.1-pro-free, drama-3);
 *   - corpo JSON (msgpack so para `references` em linha): text, reference_id,
 *     format wav|pcm|mp3|opus, sample_rate, temperature, top_p, prosody
 *     { speed, volume, normalize_loudness }, latency, chunk_length...;
 *   - a resposta e o AUDIO (chunked), e a doc nao fala de tempo por palavra nem
 *     por caractere. Entao o tempo sai do alinhador do Dangai (wav2vec2 PT) com
 *     o texto do roteiro -- origemDoAlinhamento 'alinhador';
 *   - nao ha previous_text: regravar uma frase no Fish vai sem contexto.
 *
 * O prosody.speed e a velocidade NATIVA da config (0,7-1,2, como no
 * ElevenLabs). A 1,0 o corpo e o de antes do campo. O "acelerar" e do pos
 * (atempo), igual para as tres fontes.
 */

const FISH_API = 'https://api.fish.audio'
const TEMPO_LIMITE_MS = 180_000

/** O formato do Fish no padrao do motor ("wav_44100"): e o que entra na chave do cache. */
export function formatoFish(taxa: number): string {
  return `wav_${taxa}`
}

function taxaDoFormato(formato: string): number {
  const n = Number(formato.replace(/^wav_/, ''))
  return Number.isFinite(n) && n > 0 ? n : 44_100
}

export async function sintetizarFish(
  chave: string,
  pedido: PedidoDeVoz & { config: ConfigFish },
  formato: string,
  signal?: AbortSignal,
): Promise<RespostaDoProvedor> {
  const { config, texto } = pedido
  const corpo = {
    text: texto,
    reference_id: config.voiceId,
    format: 'wav',
    sample_rate: taxaDoFormato(formato),
    ...settingsEnviados(config),
    latency: 'normal',
    prosody: { speed: velocidadeNativaEnviada(config), volume: 0, normalize_loudness: true },
  }
  // O Cancelar so vale ate os cabecalhos: depois do 200 o audio (pago) tem que chegar ao cache (fetchPago).
  let chamada: Awaited<ReturnType<typeof fetchPago>>
  try {
    chamada = await fetchPago(
      `${FISH_API}/v1/tts`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${chave}`, model: config.modelId, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      },
      signal,
      TEMPO_LIMITE_MS,
    )
  } catch (err) {
    if (signal?.aborted) throw new Cancelado()
    const e = err as { name?: unknown; cause?: { code?: unknown } } | null
    const codigo = e?.name === 'TimeoutError' ? 'TIMEOUT' : typeof e?.cause?.code === 'string' ? e.cause.code : 'REDE'
    throw new ErroDoProvedor(notaDaFalha('fish', { status: null, codigo, mensagem: '' }, chave), null, false)
  }
  const { resposta, lerCorpo } = chamada
  if (!resposta.ok) {
    const texto = await lerCorpo((r) => r.text()).catch(() => '')
    const { codigo, mensagem } = lerErroEleven(texto)
    throw new ErroDoProvedor(notaDaFalha('fish', { status: resposta.status, codigo, mensagem }, chave), resposta.status, false)
  }
  let bytes: Buffer
  try {
    bytes = Buffer.from(await lerCorpo((r) => r.arrayBuffer()))
  } catch {
    // 200 com o corpo cortado no meio: pode ter sido cobrado.
    throw new ErroDoProvedor(pagoSemVoz('Fish Audio'), resposta.status, false)
  }
  if (bytes.length < 64) throw new ErroDoProvedor(pagoSemVoz('Fish Audio'), resposta.status, false)
  return { bytes, formato, alignment: null, normalizado: null, requestId: null, custo: null }
}

/** GET /wallet/self/api-credit (gratis): o saldo em dolar, como o Fish manda ("12.3400"). null = nao veio. */
export async function saldoFish(chave: string): Promise<string | null> {
  try {
    const r = await fetch(`${FISH_API}/wallet/self/api-credit`, {
      headers: { Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return null
    const credito = ((await r.json()) as { credit?: unknown }).credit
    return typeof credito === 'string' || typeof credito === 'number' ? String(credito).trim() || null : null
  } catch {
    return null
  }
}
