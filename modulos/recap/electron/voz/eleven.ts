import { notaDaFalha } from '../voz-chaves'
import { velocidadeNativaEnviada, type ConfigEleven } from '../../shared/voz'
import { settingsEnviados, type PedidoDeVoz } from './cache'
import { Cancelado } from './ffmpeg'
import { alinhamentoDe, type AlinhamentoDeCaracteres } from './palavras'

/**
 * ElevenLabs: o take com tempo por caractere.
 *
 * Conferido na documentacao oficial em 14/10/2026
 * (elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps e
 * .../cookbooks/text-to-speech/request-stitching):
 *   - POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=...,
 *     chave no cabecalho xi-api-key;
 *   - wav_8000..wav_48000 existem; "pcm_44100 e wav_44100 exigem o plano Pro ou
 *     acima". O motor pede wav_44100 e, recusado, cai para wav_24000 (e lembra
 *     por um dia em formatos.json, para nao bater na recusa a cada pedido);
 *   - resposta JSON: audio_base64, alignment (texto ORIGINAL) e
 *     normalized_alignment (texto normalizado), os dois podendo vir null;
 *   - cabecalhos: `request-id` (a costura, valida por 2 h) e `character-cost`
 *     (o que foi cobrado, em caracteres);
 *   - previous_text / next_text dao continuidade a um pedaco gerado sozinho, e
 *     sao IGNORADOS quando vai previous_request_ids / next_request_ids.
 *
 * POR QUE previous_text/next_text E NAO A COSTURA (request ids) AO REGRAVAR:
 * o take inteiro e UM pedido. A costura condiciona o audio novo no audio do
 * pedido anterior inteiro -- passar o id do take faria a frase do meio "vir
 * depois" do fim do roteiro. E o id vence em 2 h, o que tornaria o cache
 * imprevisivel. O texto vizinho e deterministico, vale para sempre e entra na
 * chave do cache.
 *
 * A velocidade NATIVA vai no voice_settings.speed (0,7-1,2: 1,5 deu 400
 * invalid_voice_settings em 15/10), e SO quando nao e 1: o pedido a 1,0 e o
 * de antes do campo, byte a byte (o padrao da API ja e 1). O "acelerar" e do
 * pos (atempo), de graca, e igual para as tres fontes.
 */

const ELEVEN_API = 'https://api.elevenlabs.io/v1'
/** Um roteiro de ~1.000 caracteres leva uns 10-20 s; folga para a rede. */
const TEMPO_LIMITE_MS = 180_000
/** O corpo de um 200 (~4,6 MB em base64 num take de 72 s): so um tempo limite longo, sem o Cancelar. */
const TEMPO_LIMITE_CORPO_MS = 600_000
const TEMPO_LIMITE_LEITURA_MS = 15_000

export const FORMATOS_ELEVEN = ['wav_44100', 'wav_24000'] as const

export class ErroDoProvedor extends Error {
  constructor(
    mensagem: string,
    readonly status: number | null,
    /** O plano nao deixa este output_format (quem chama tenta o seguinte). */
    readonly formatoRecusado: boolean,
  ) {
    super(mensagem)
    this.name = 'ErroDoProvedor'
  }
}

export interface RespostaDoProvedor {
  bytes: Buffer
  formato: string
  alignment: AlinhamentoDeCaracteres | null
  normalizado: AlinhamentoDeCaracteres | null
  requestId: string | null
  custo: number | null
}

function textoDe(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : ''
}

/** O erro nos formatos do ElevenLabs: { detail: { status, code?, message } } ou detail em lista (422). */
export function lerErroEleven(texto: string): { codigo: string; mensagem: string } {
  let json: unknown = null
  try {
    json = texto ? JSON.parse(texto) : null
  } catch {
    json = null
  }
  const corpo = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
  const detalhe = corpo['detail']
  let codigo = ''
  let mensagem = ''
  if (typeof detalhe === 'object' && detalhe !== null && !Array.isArray(detalhe)) {
    const d = detalhe as Record<string, unknown>
    codigo = textoDe(d['code']) || textoDe(d['status'])
    mensagem = textoDe(d['message'])
  } else if (typeof detalhe === 'string') {
    mensagem = detalhe
  } else if (Array.isArray(detalhe) && typeof detalhe[0] === 'object' && detalhe[0] !== null) {
    mensagem = textoDe((detalhe[0] as Record<string, unknown>)['msg'])
  }
  if (!codigo) codigo = textoDe(corpo['reason'])
  if (!mensagem) mensagem = textoDe(corpo['message']) || (json === null ? texto.slice(0, 200) : '')
  return { codigo, mensagem }
}

/** A recusa por plano do output_format (o texto da API cita o formato ou o plano). */
function recusaDeFormato(status: number, codigo: string, mensagem: string): boolean {
  if (status !== 400 && status !== 403 && status !== 422) return false
  const t = `${codigo} ${mensagem}`.toLowerCase()
  return /output_format|output format|format|tier|subscription|plan/.test(t)
}

/**
 * O fetch de um pedido PAGO, com o Cancelar valendo so ate os CABECALHOS.
 *
 * Depois de um 200 a voz ja foi cobrada: se o Cancelar (ou o tempo limite do
 * pedido) matasse a leitura do corpo, o audio pago se perdia antes do cache e o
 * "de novo" cobrava outra vez. Entao o sinal do Levi e solto assim que a
 * resposta chega, e o corpo so tem um tempo limite longo. `lerCorpo` le com
 * esse tempo; quem chama decide o que dizer se ele falhar num 200.
 */
export async function fetchPago(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  signal: AbortSignal | undefined,
  limiteMs: number,
): Promise<{ resposta: Response; lerCorpo: <T>(ler: (r: Response) => Promise<T>) => Promise<T> }> {
  const ctl = new AbortController()
  const desistir = (): void => ctl.abort()
  if (signal?.aborted) ctl.abort()
  signal?.addEventListener('abort', desistir, { once: true })
  let relogio = setTimeout(() => ctl.abort(new DOMException('Tempo esgotado', 'TimeoutError')), limiteMs)
  let resposta: Response
  try {
    resposta = await fetch(url, { ...init, signal: ctl.signal })
  } finally {
    signal?.removeEventListener('abort', desistir)
    clearTimeout(relogio)
  }
  const lerCorpo = async <T,>(ler: (r: Response) => Promise<T>): Promise<T> => {
    relogio = setTimeout(() => ctl.abort(new DOMException('Tempo esgotado', 'TimeoutError')), TEMPO_LIMITE_CORPO_MS)
    try {
      return await ler(resposta)
    } finally {
      clearTimeout(relogio)
    }
  }
  return { resposta, lerCorpo }
}

/** O recado de um 200 cujo corpo nao chegou: pode ter sido cobrado, entao nada de "tente de novo". */
export function pagoSemVoz(provedor: string): string {
  return `O ${provedor} pode ter cobrado, mas a voz nao chegou inteira. Confira o historico do ${provedor} antes de gerar de novo.`
}

/** Erro de rede/tempo -> nota para a tela (o Cancelar passa direto). */
function erroDeRede(err: unknown, signal: AbortSignal | undefined, chave: string): Error {
  if (signal?.aborted) return new Cancelado()
  const e = err as { name?: unknown; cause?: { code?: unknown } } | null
  const codigo = e?.name === 'TimeoutError' ? 'TIMEOUT' : typeof e?.cause?.code === 'string' ? e.cause.code : 'REDE'
  return new ErroDoProvedor(notaDaFalha('elevenlabs', { status: null, codigo, mensagem: '' }, chave), null, false)
}

/** UM pedido pago. Nao olha cache: quem chama (provedor.ts) cuida disso. */
export async function sintetizarEleven(
  chave: string,
  pedido: PedidoDeVoz & { config: ConfigEleven },
  formato: string,
  signal?: AbortSignal,
): Promise<RespostaDoProvedor> {
  const { config, texto, contexto } = pedido
  const nativa = velocidadeNativaEnviada(config)
  const corpo: Record<string, unknown> = {
    text: texto,
    model_id: config.modelId,
    voice_settings: nativa !== 1 ? { ...settingsEnviados(config), speed: nativa } : settingsEnviados(config),
  }
  if (contexto.anterior) corpo['previous_text'] = contexto.anterior
  if (contexto.seguinte) corpo['next_text'] = contexto.seguinte

  const url = `${ELEVEN_API}/text-to-speech/${encodeURIComponent(config.voiceId)}/with-timestamps?output_format=${encodeURIComponent(formato)}`
  let chamada: Awaited<ReturnType<typeof fetchPago>>
  try {
    chamada = await fetchPago(
      url,
      {
        method: 'POST',
        // A chave vai no cabecalho, nunca na URL: URL aparece em log e em erro.
        headers: { 'xi-api-key': chave, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(corpo),
      },
      signal,
      TEMPO_LIMITE_MS,
    )
  } catch (err) {
    throw erroDeRede(err, signal, chave)
  }
  const { resposta, lerCorpo } = chamada

  if (!resposta.ok) {
    // Recusa nao cobra: o corpo e so o motivo (e pode faltar).
    const motivo = await lerCorpo((r) => r.text()).catch(() => '')
    const { codigo, mensagem } = lerErroEleven(motivo)
    const recusado = recusaDeFormato(resposta.status, codigo, mensagem)
    throw new ErroDoProvedor(notaDaFalha('elevenlabs', { status: resposta.status, codigo, mensagem }, chave), resposta.status, recusado)
  }
  let json: Record<string, unknown>
  try {
    json = JSON.parse(await lerCorpo((r) => r.text())) as Record<string, unknown>
  } catch {
    // 200 com o corpo cortado no meio (rede, tempo) ou quebrado: o character-cost ja veio.
    throw new ErroDoProvedor(pagoSemVoz('ElevenLabs'), resposta.status, false)
  }
  const audio = typeof json['audio_base64'] === 'string' ? Buffer.from(json['audio_base64'], 'base64') : Buffer.alloc(0)
  if (audio.length === 0) throw new ErroDoProvedor(pagoSemVoz('ElevenLabs'), resposta.status, false)
  const custo = Number(resposta.headers.get('character-cost'))
  const requestId = resposta.headers.get('request-id')
  return {
    bytes: audio,
    formato,
    alignment: alinhamentoDe(json['alignment']),
    normalizado: alinhamentoDe(json['normalized_alignment']),
    requestId: requestId && requestId.length <= 128 ? requestId : null,
    custo: Number.isFinite(custo) && resposta.headers.has('character-cost') ? custo : null,
  }
}

export interface AssinaturaEleven {
  plano: string | null
  usados: number | null
  limite: number | null
  /** Plano que passa do limite e cobra a parte (payg, extensao ligada). */
  estica: boolean
}

/** GET /v1/user/subscription: gratis. null = nao deu para ler (a estimativa segue sem o saldo). */
export async function assinaturaEleven(chave: string): Promise<AssinaturaEleven | null> {
  try {
    const r = await fetch(`${ELEVEN_API}/user/subscription`, {
      headers: { 'xi-api-key': chave, Accept: 'application/json' },
      signal: AbortSignal.timeout(TEMPO_LIMITE_LEITURA_MS),
    })
    if (!r.ok) return null
    const a = (await r.json()) as Record<string, unknown>
    const numero = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
    const plano = textoDe(a['tier']) || null
    return {
      plano,
      usados: numero(a['character_count']),
      limite: numero(a['character_limit']),
      estica: plano === 'payg' || a['can_extend_character_limit'] === true,
    }
  } catch {
    return null
  }
}
