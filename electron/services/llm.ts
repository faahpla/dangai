import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { TesteDoGemini } from '@shared/channels'
import { getSettings, type Settings } from './settings'

/**
 * Ponto unico de IA estruturada: entra um pedido com schema zod, sai um objeto
 * conferido -- do Gemini ou da Anthropic.
 *
 * O Gemini e o padrao porque tem cota gratis (Google AI Studio). A Anthropic
 * continua no padrao que o planner e o metadata ja tinham (messages.parse +
 * zodOutputFormat), agora com o modelo de settings.
 *
 * Roda no main pelo mesmo motivo de sempre: a chave nunca chega no renderer, e
 * o que sai da maquina e so o texto do pedido.
 *
 * Erro nunca vira excecao daqui para fora: vira `{ ok: false, nota }`, com a
 * nota pronta para a interface. Quem chama decide se cai no fallback (planner)
 * ou mostra a nota (metadata).
 *
 * O Gemini vai por REST com o fetch do Node, sem SDK: sao duas rotas
 * (generateContent e models) e o SDK do Google seria dependencia nova so para
 * isso.
 */

export type Provedor = 'gemini' | 'anthropic'

export interface PedidoJson<S extends z.ZodType> {
  /** Fechado e sem default: saida estruturada exige isso nos dois provedores. */
  schema: S
  sistema: string
  prompt: string
  /** Nome curto da etapa ("plano", "textos"), so para o log. */
  etapa: string
  /** Forca um provedor, sem cair no outro. Sem isto vale o de settings. */
  provedor?: Provedor
  /**
   * Forca o MODELO (so junto com `provedor`): o escritor pago do modulo recap
   * escreve o roteiro no Claude Sonnet ou no Gemini Pro sem trocar o modelo
   * das Configuracoes. Vale como escolhido a mao: sem troca automatica nem
   * reserva -- o erro dele vira a nota. Sem isto vale o de settings.
   */
  modelo?: string
  /** Teto de saida na Anthropic -- o max_tokens que cada servico ja usava. */
  maxTokens?: number
  /**
   * Quanto esperar a resposta do Gemini, em ms. Sem isto, TEMPO_LIMITE_MS. Um
   * pedido que le muito texto e escreve 3-4 mil tokens passa disso: medido em
   * 13/10/2026, o gemini-3.8-flash do free tier levou 176 s.
   */
  tempoLimiteMs?: number
  /**
   * false = no automatico do Gemini, quando so sobram modelos RESERVA (lite,
   * nano: ehModeloReserva), NAO chama o reserva: devolve `motivo: 'so-reserva'`
   * e quem pediu pergunta ao usuario. O texto do lite sai bem pior, e cota
   * gasta nele nao volta.
   *
   * Padrao true: o planner e o metadata continuam descendo ate o reserva como
   * sempre (para eles, reserva e melhor que nada). Modelo escolhido a mao nas
   * configuracoes nao e afetado: foi escolha dele.
   */
  permitirReserva?: boolean
  /**
   * IMAGENS junto do prompt (o juiz de cenas do modulo recap olha os
   * keyframes). Vao antes do texto, na ordem dada. Os dois provedores aceitam
   * jpeg, png e webp em base64.
   */
  imagens?: readonly ImagemDoPedido[]
}

export interface ImagemDoPedido {
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
  /** O arquivo em base64, sem o prefixo `data:`. */
  base64: string
}

/**
 * Quanto o pedido gastou, como o provedor contou -- para o custo de verdade.
 * `saida` inclui o pensamento do Gemini (cobrado como saida).
 */
export interface UsoDeTokens {
  entrada: number
  saida: number
}

/** Falha comum: a nota pronta e o erro tecnico. */
export interface FalhaDeIa {
  ok: false
  /** Ausente na falha comum; 'so-reserva' em SoReserva. */
  motivo?: undefined
  /** Pronta para a interface, em portugues. */
  nota: string
  /**
   * O erro tecnico, com o codigo HTTP quando houver. O friendlyAiNote do
   * transcribe.ts traduz por palavra-chave ('401', '429', 'fetch', 'api
   * key'), e continua funcionando com isto nos dois provedores.
   */
  bruto: string
  provedor: Provedor | null
}

/**
 * So sobraram modelos reserva e o pedido veio com `permitirReserva: false`:
 * nenhuma chamada foi feita ao reserva. Tem `nota` e `bruto` como a falha
 * comum, para quem nao trata o caso continuar funcionando.
 */
export interface SoReserva {
  ok: false
  motivo: 'so-reserva'
  nota: string
  bruto: string
  provedor: 'gemini'
  /** O reserva que o automatico usaria ("gemini-3.5-flash-lite"). */
  reserva: string
  /** Date.now() de quando o primeiro modelo bom volta (cota do dia ou fim da lotacao). */
  renovaEm: number
  /** true = os bons acabaram a cota do dia; false = estao lotados/lentos, voltam em minutos. */
  porCota: boolean
}

export type RespostaJson<T> =
  | { ok: true; valor: T; provedor: Provedor; modelo: string; uso?: UsoDeTokens }
  | FalhaDeIa
  | SoReserva

/**
 * Falha de IA para quem precisa lancar (o planner, cujo chamador espera
 * excecao).
 *
 * `message` fica com o erro tecnico e `nota` com o texto para a interface: o
 * friendlyAiNote do transcribe.ts ainda le a mensagem tecnica.
 */
export class ErroDeIa extends Error {
  readonly nota: string

  constructor(nota: string, bruto: string) {
    super(bruto)
    this.name = 'ErroDeIa'
    this.nota = nota
  }
}

export const SEM_CHAVE =
  'Sem chave de IA. Abra as configuracoes (Ctrl+,) e cole a do Gemini (gratis) ou a da Anthropic.'

/** O automatico rodou a lista e nenhum modelo gratis atendeu. */
export const SEM_MODELO_LIVRE =
  'Nenhum modelo gratis do Gemini atendeu agora (sem cota ou lotado). Tente de novo em alguns minutos.'

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Ultimo recurso do automatico, quando nem a lista de modelos veio (rede, chave).
 * NAO e preferencia: o Google tira modelos do ar para quem chega agora (o
 * gemini-2.5-flash ainda aparece na lista, mas da 404 "no longer
 * available to new users"), entao o automatico escolhe pela lista.
 */
export const GEMINI_PADRAO = 'gemini-2.5-flash'

/**
 * Modelos que deram 404 nesta sessao. A lista do Google continua mostrando
 * modelo aposentado, e sem isto o automatico escolheria o mesmo de novo.
 */
const aposentados = new Set<string>()

/**
 * Modelos que deram 503 ("high demand") ha pouco, e ate quando evitar. Modelo
 * recem-lancado vive lotado; o automatico vai no proximo da lista em vez de
 * deixar a analise sem IA. Passa sozinho: e lotacao, nao aposentadoria.
 *
 * O 429 da cota do DIA entra aqui tambem, ate a cota renovar: a cota gratis e
 * por modelo (medido em 13/10/2026: o gemini-3.8-flash esgotou os 20 do dia e
 * o 3.7-flash, o 3-flash-preview e o 3.5-flash-lite continuaram respondendo).
 */
const lotados = new Map<string, { ate: number; porCota: boolean }>()
const LOTADO_POR_MS = 5 * 60_000

/**
 * Quanto falta para a cota gratis do dia renovar: meia-noite no horario do
 * Pacifico (o que a nota diz). Minimo de 1 min, para um relogio torto nao
 * marcar o modelo como livre na hora.
 */
export function msAteRenovarACota(agora = Date.now()): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(agora))
  const n = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value ?? 0)
  const passou = (((n('hour') % 24) * 60 + n('minute')) * 60 + n('second')) * 1000
  return Math.max(60_000, 86_400_000 - passou)
}

/** Esquece aposentados, lotados e o automatico. So os testes usam. */
export function esquecerModelos(): void {
  aposentados.clear()
  lotados.clear()
  automatico = null
}

function indisponivel(id: string): boolean {
  if (aposentados.has(id)) return true
  const marca = lotados.get(id)
  if (marca === undefined) return false
  if (Date.now() < marca.ate) return true
  lotados.delete(id)
  return false
}

/**
 * A resposta de "so sobrou reserva": quando o primeiro modelo BOM volta, pelo
 * que esta sessao ja sabe (a marca de cada um em `lotados`). Sem marca nenhuma
 * (a lista nem tinha modelo bom), vale a renovacao da cota do dia.
 */
function paradaNoReserva(reserva: string, agora = Date.now()): SoReserva {
  let volta: { ate: number; porCota: boolean } | null = null
  for (const [id, marca] of lotados) {
    if (ehModeloReserva(id) || marca.ate <= agora) continue
    if (!volta || marca.ate < volta.ate) volta = marca
  }
  const renovaEm = volta?.ate ?? agora + msAteRenovarACota(agora)
  const porCota = volta?.porCota ?? true
  return {
    ok: false,
    motivo: 'so-reserva',
    nota: porCota
      ? `Os modelos bons do Gemini acabaram a cota de hoje (renova a meia-noite do Pacifico, 4h ou 5h em Brasilia). So o ${reserva} esta livre.`
      : `Os modelos bons do Gemini estao lotados agora. So o ${reserva} esta livre.`,
    bruto: `so reserva livre (${reserva}); bom volta em ${Math.round((renovaEm - agora) / 60_000)} min`,
    provedor: 'gemini',
    reserva,
    renovaEm,
    porCota,
  }
}

/** O 404 de modelo aposentado as vezes diz qual usar: "use models/gemini-X". */
export function sucessorSugerido(mensagem: string): string | null {
  const achou = /use\s+(?:models\/)?(gemini-[\w.-]*\w)/i.exec(mensagem)
  return achou ? achou[1]! : null
}

/** Retentativas depois da primeira chamada, so para erro passageiro. */
const MAX_RETENTATIVAS = 2

/**
 * Espera maxima antes de uma retentativa. O Google as vezes pede minutos; ai
 * nao e soluco, e quem esta esperando a analise prefere a nota e o fallback.
 */
const ESPERA_MAXIMA_MS = 60_000

/** Um plano de 30 cenas leva segundos; dois minutos e conexao pendurada. */
const TEMPO_LIMITE_MS = 120_000

// ------------------------------------------------------------------ escolha

/**
 * Qual provedor atende: o preferido, se tiver chave; senao o outro, se tiver;
 * senao nenhum (e quem chama cai no fallback de sempre).
 *
 * Quem so tem a chave da Anthropic -- todo usuario de antes do Gemini --
 * continua na Anthropic sem mexer em nada, mesmo com o Gemini como padrao.
 */
export function escolherProvedor(
  settings: Pick<Settings, 'iaProvedor' | 'geminiApiKey' | 'anthropicApiKey'>,
  forcado?: Provedor,
): Provedor | null {
  const temChave: Record<Provedor, boolean> = {
    gemini: settings.geminiApiKey.length > 0,
    anthropic: settings.anthropicApiKey.length > 0,
  }
  if (forcado) return temChave[forcado] ? forcado : null
  const preferido = settings.iaProvedor
  if (temChave[preferido]) return preferido
  const outro: Provedor = preferido === 'gemini' ? 'anthropic' : 'gemini'
  return temChave[outro] ? outro : null
}

/** Ha alguma IA configurada? Para avisar antes de montar o pedido. */
export function iaDisponivel(): boolean {
  return escolherProvedor(getSettings()) !== null
}

export async function gerarJson<S extends z.ZodType>(
  pedido: PedidoJson<S>,
): Promise<RespostaJson<z.infer<S>>> {
  const settings = getSettings()
  const provedor = escolherProvedor(settings, pedido.provedor)
  if (!provedor) return { ok: false, nota: SEM_CHAVE, bruto: 'sem chave de IA', provedor: null }

  // O modelo forcado so vale com o provedor forcado: um id do Claude nunca vai para o Google.
  const forcado = pedido.provedor && pedido.modelo?.trim() ? pedido.modelo.trim() : ''
  let resposta: RespostaJson<z.infer<S>>
  try {
    resposta =
      provedor === 'gemini'
        ? await viaGemini(pedido, settings.geminiApiKey, forcado || settings.geminiModelo)
        : await viaAnthropic(pedido, settings.anthropicApiKey, forcado || settings.anthropicModelo)
  } catch (err) {
    // Rede de seguranca: um schema que o zod nao converte, por exemplo. O
    // contrato daqui e nunca lancar.
    const bruto = err instanceof Error ? err.message : String(err)
    resposta = falha(`A IA nao respondeu (${bruto.slice(0, 60)}).`, bruto, provedor)
  }
  if (!resposta.ok) console.warn(`[llm:${pedido.etapa}] ${provedor}: ${resposta.bruto}`)
  return resposta
}

function falha(nota: string, bruto: string, provedor: Provedor | null): FalhaDeIa {
  return { ok: false, nota, bruto, provedor }
}

// ---------------------------------------------------------------- anthropic

async function viaAnthropic<S extends z.ZodType>(
  pedido: PedidoJson<S>,
  chave: string,
  modelo: string,
): Promise<RespostaJson<z.infer<S>>> {
  try {
    const client = new Anthropic({ apiKey: chave, maxRetries: 1 })
    const message = await client.messages.parse({
      model: modelo,
      max_tokens: pedido.maxTokens ?? 4096,
      output_config: { format: zodOutputFormat(pedido.schema) },
      system: pedido.sistema,
      messages: [
        {
          role: 'user',
          content: pedido.imagens?.length
            ? [
                ...pedido.imagens.map((i) => ({
                  type: 'image' as const,
                  source: { type: 'base64' as const, media_type: i.mime, data: i.base64 },
                })),
                { type: 'text' as const, text: pedido.prompt },
              ]
            : pedido.prompt,
        },
      ],
    })

    const output = message.parsed_output
    if (output === null || output === undefined) {
      return falha('A IA nao devolveu a resposta.', 'parsed_output vazio', 'anthropic')
    }
    const uso = message.usage
      ? { entrada: message.usage.input_tokens ?? 0, saida: message.usage.output_tokens ?? 0 }
      : undefined
    return { ok: true, valor: output, provedor: 'anthropic', modelo, ...(uso ? { uso } : {}) }
  } catch (err) {
    const bruto = err instanceof Error ? err.message : String(err)
    return falha(notaDaAnthropic(err, bruto, modelo), bruto, 'anthropic')
  }
}

function notaDaAnthropic(err: unknown, bruto: string, modelo: string): string {
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Sem conexao com a Anthropic. Confira a internet e tente de novo.'
  }
  const status = err instanceof Anthropic.APIError ? err.status : undefined
  if (status === 401) return 'Chave da Anthropic recusada. Confira em configuracoes (Ctrl+,).'
  if (status === 404) return `O modelo ${modelo} nao existe na Anthropic. Confira em configuracoes.`
  if (status === 429) return 'Limite da Anthropic atingido. Espere um pouco e tente de novo.'
  if (typeof status === 'number' && status >= 500) {
    return 'A Anthropic esta instavel agora. Tente de novo em alguns minutos.'
  }
  return `A IA nao respondeu (${bruto.slice(0, 60)}).`
}

// ------------------------------------------------------------------- gemini

/** O que importa de uma resposta de erro do Google. */
export interface ErroGemini {
  /** HTTP; null quando nem chegou no servidor. */
  status: number | null
  /** O motivo do Google (API_KEY_INVALID, RESOURCE_EXHAUSTED...) ou o de rede. */
  codigo: string
  mensagem: string
  /** Cota por dia: nao volta com espera nenhuma. */
  cotaDoDia: boolean
  /** O modelo nao tem cota gratis nenhuma ("limit: 0"). */
  semCotaGratis: boolean
  /** Quanto o Google pediu para esperar (RetryInfo), em ms. */
  esperaMs: number | null
}

type Chamada = { ok: true; json: unknown } | { ok: false; erro: ErroGemini }

/**
 * Os dois jeitos de pedir JSON com schema no generateContent.
 *
 * `responseJsonSchema` (com responseMimeType) e o que funciona do Gemini 2.5
 * em diante e o que a doc descreve palavra por palavra. A revisao 20261012 da
 * API o marca como obsoleto em favor de `responseFormat.text`, que e o mesmo
 * schema em outro lugar. Comeca pelo primeiro e, se o Google recusar o campo,
 * passa para o outro e lembra qual serviu.
 */
type FormatoJson = 'responseJsonSchema' | 'responseFormat'
let formatoQueServe: FormatoJson = 'responseJsonSchema'

/** O modelo que o automatico escolheu, por chave. Uma lista por sessao basta. */
let automatico: { chave: string; modelo: string } | null = null

async function viaGemini<S extends z.ZodType>(
  pedido: PedidoJson<S>,
  chave: string,
  modeloConfigurado: string,
): Promise<RespostaJson<z.infer<S>>> {
  const schema = schemaParaGemini(pedido.schema)
  // So o automatico desce ate o reserva; o escolhido a mao fica como esta.
  const soBons = pedido.permitirReserva === false && !modeloConfigurado
  const inicial = modeloConfigurado || (await modeloAutomatico(chave, soBons))
  if (typeof inicial !== 'string') return paradaNoReserva(inicial.reserva)
  let modelo = inicial
  let formato = formatoQueServe
  let trocouFormato = false
  /*
   * Os casos reais: aposentado (404) -> sucessor lotado (503) -> outro; e, em
   * 13/10/2026, cota do dia no 3.8 e no 3.7 (429) -> 3.6 e 3.5 lotados (503)
   * -> 2.5 aposentado (404) -> omni sem cota gratis (429) -> o 3.5-flash-lite
   * respondeu (seis trocas, ~30 s ao todo). Cada troca que falha e rapida;
   * desistir antes deixa sem IA. Oito da folga.
   */
  let trocasDeModelo = 0
  const MAX_TROCAS_DE_MODELO = 8

  for (;;) {
    const chamada = await chamarComRetentativa(
      chave,
      `models/${modelo}:generateContent`,
      corpoDoPedido(pedido, schema, formato),
      pedido.tempoLimiteMs,
    )
    if (chamada.ok) {
      formatoQueServe = formato
      return lerResposta(chamada.json, pedido.schema, modelo)
    }

    const erro = chamada.erro
    if (!trocouFormato && formatoRecusado(erro)) {
      formato = formato === 'responseJsonSchema' ? 'responseFormat' : 'responseJsonSchema'
      trocouFormato = true
      continue
    }
    // O automatico caiu num modelo que saiu do ar (404), que esta lotado
    // mesmo depois das retentativas (503) ou cuja cota gratis acabou (429 do
    // dia, ou "limit: 0"): marca, e vai no sucessor que o proprio Google
    // sugere ou no proximo da lista. Modelo escolhido a mao nao troca: o erro
    // dele vira a nota.
    const aposentou = erro.status === 404
    const lotou = erro.status === 503
    const esgotou = erro.status === 429 && (erro.cotaDoDia || erro.semCotaGratis)
    if ((aposentou || lotou || esgotou) && !modeloConfigurado) {
      if (aposentou) aposentados.add(modelo)
      else {
        lotados.set(
          modelo,
          esgotou
            ? { ate: Date.now() + msAteRenovarACota(), porCota: true }
            : { ate: Date.now() + LOTADO_POR_MS, porCota: false },
        )
      }
      automatico = null
      if (trocasDeModelo < MAX_TROCAS_DE_MODELO) {
        const sugerido = aposentou ? sucessorSugerido(erro.mensagem) : null
        const sugeridoServe = sugerido !== null && !indisponivel(sugerido) && !(soBons && ehModeloReserva(sugerido))
        const lista = sugeridoServe ? null : await escolherDaLista(chave, soBons)
        const outro = sugeridoServe ? sugerido : (lista?.modelo ?? null)
        trocasDeModelo += 1
        if (outro && outro !== modelo) {
          console.warn(`[llm] gemini: ${modelo} deu ${erro.status}, indo no ${outro}`)
          modelo = outro
          automatico = { chave, modelo }
          continue
        }
        // So sobrou reserva e este pedido nao aceita reserva: para ANTES de
        // chamar o reserva, e quem pediu pergunta ao usuario.
        if (lista?.reserva) return paradaNoReserva(lista.reserva)
      }
      // Rodou a lista e nenhum atendeu. A nota do 404 e a do "limit: 0" mandam
      // escolher outro modelo -- nao servem para quem ja esta no automatico. A
      // de lotado e a da cota do dia continuam certas.
      const notaServe = lotou || (erro.cotaDoDia && !erro.semCotaGratis)
      if (trocasDeModelo > 0 && !notaServe) {
        return falha(SEM_MODELO_LIVRE, brutoDoGemini(erro), 'gemini')
      }
    }
    // Demorou demais no automatico: o "Tente de novo" vai em outro modelo. Sem
    // trocar agora, que seriam mais minutos de espera na mesma chamada.
    if (erro.codigo === 'TIMEOUT' && !modeloConfigurado) {
      lotados.set(modelo, { ate: Date.now() + LOTADO_POR_MS, porCota: false })
      automatico = null
    }
    return falha(notaDoGemini(erro, modelo), brutoDoGemini(erro), 'gemini')
  }
}

function corpoDoPedido(
  pedido: PedidoJson<z.ZodType>,
  schema: unknown,
  formato: FormatoJson,
): unknown {
  return {
    systemInstruction: { parts: [{ text: pedido.sistema }] },
    contents: [
      {
        role: 'user',
        parts: [
          ...(pedido.imagens ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } })),
          { text: pedido.prompt },
        ],
      },
    ],
    // Sem temperature e sem maxOutputTokens: o padrao de cada modelo serve, e
    // nos 2.5 o pensamento conta no teto -- um teto baixo cortaria o JSON.
    generationConfig:
      formato === 'responseJsonSchema'
        ? { responseMimeType: 'application/json', responseJsonSchema: schema }
        : { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } } },
  }
}

/** O 400 diz que o campo do formato nao existe (ou nao vale para o modelo)? */
function formatoRecusado(erro: ErroGemini): boolean {
  return (
    erro.status === 400 &&
    /unknown name|cannot find field|not supported|unsupported/i.test(erro.mensagem) &&
    /response_?json_?schema|response_?format|json schema/i.test(erro.mensagem)
  )
}

const FIM_RECUSADO = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'LANGUAGE',
])

function lerResposta<S extends z.ZodType>(
  json: unknown,
  schema: S,
  modelo: string,
): RespostaJson<z.infer<S>> {
  const corpo = json as {
    candidates?: {
      content?: { parts?: { text?: unknown; thought?: unknown }[] }
      finishReason?: unknown
    }[]
    promptFeedback?: { blockReason?: unknown }
    usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; thoughtsTokenCount?: unknown }
  }
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const meta = corpo?.usageMetadata
  const uso = meta
    ? { entrada: n(meta.promptTokenCount), saida: n(meta.candidatesTokenCount) + n(meta.thoughtsTokenCount) }
    : undefined

  const bloqueio = corpo?.promptFeedback?.blockReason
  if (typeof bloqueio === 'string') {
    return falha('O Gemini recusou o pedido pelo filtro de seguranca.', `blockReason ${bloqueio}`, 'gemini')
  }

  const candidato = corpo?.candidates?.[0]
  const fim = typeof candidato?.finishReason === 'string' ? candidato.finishReason : ''
  // Partes de pensamento (thought) nao sao a resposta: so o texto final entra.
  const texto = (candidato?.content?.parts ?? [])
    .filter((parte) => parte.thought !== true && typeof parte.text === 'string')
    .map((parte) => parte.text as string)
    .join('')

  const cortada = 'A resposta do Gemini veio cortada no meio. Tente de novo.'
  if (!texto) {
    if (fim === 'MAX_TOKENS') return falha(cortada, 'finishReason MAX_TOKENS', 'gemini')
    if (FIM_RECUSADO.has(fim)) {
      return falha('O Gemini recusou o pedido pelo filtro de seguranca.', `finishReason ${fim}`, 'gemini')
    }
    return falha('O Gemini nao devolveu a resposta.', `sem texto (finishReason ${fim || '?'})`, 'gemini')
  }

  let dados: unknown
  try {
    dados = JSON.parse(texto)
  } catch {
    return fim === 'MAX_TOKENS'
      ? falha(cortada, 'JSON incompleto (finishReason MAX_TOKENS)', 'gemini')
      : falha('O Gemini devolveu um formato inesperado.', `JSON invalido: ${texto.slice(0, 80)}`, 'gemini')
  }

  // O schema da API guia o modelo; o zod e quem garante. Minimo e maximo, por
  // exemplo, o Gemini trata como dica.
  const conferido = schema.safeParse(dados)
  if (!conferido.success) {
    return falha(
      'O Gemini devolveu um formato inesperado.',
      `fora do schema: ${conferido.error.issues[0]?.message ?? 'formato inesperado'}`,
      'gemini',
    )
  }
  return { ok: true, valor: conferido.data, provedor: 'gemini', modelo, ...(uso ? { uso } : {}) }
}

async function chamarComRetentativa(
  chave: string,
  caminho: string,
  corpo?: unknown,
  tempoLimiteMs = TEMPO_LIMITE_MS,
): Promise<Chamada> {
  for (let tentativa = 0; ; tentativa++) {
    const chamada = await chamarGemini(chave, caminho, corpo, tempoLimiteMs)
    if (chamada.ok) return chamada
    const espera = esperaParaRetentar(chamada.erro, tentativa)
    if (espera === null) return chamada
    await new Promise((resolve) => setTimeout(resolve, espera))
  }
}

/**
 * Quanto esperar antes de tentar de novo, ou null para desistir ja.
 *
 * So erro passageiro volta: 429 de cota por minuto e 5xx. Cota do dia, chave
 * errada e pedido invalido dariam o mesmo erro na segunda vez.
 */
export function esperaParaRetentar(erro: ErroGemini, tentativa: number): number | null {
  if (tentativa >= MAX_RETENTATIVAS) return null
  const porMinuto = erro.status === 429 && !erro.cotaDoDia && !erro.semCotaGratis
  const instavel = erro.status !== null && erro.status >= 500
  if (!porMinuto && !instavel) return null

  // Sem pedido do Google: 2 s, depois 6 s, com folga aleatoria para duas
  // chamadas nao baterem juntas de novo.
  const espera = erro.esperaMs !== null ? erro.esperaMs + 250 : 2000 * 3 ** tentativa + Math.random() * 500
  return espera > ESPERA_MAXIMA_MS ? null : espera
}

async function chamarGemini(
  chave: string,
  caminho: string,
  corpo?: unknown,
  tempoLimiteMs = TEMPO_LIMITE_MS,
): Promise<Chamada> {
  let resposta: Response
  try {
    resposta = await fetch(`${GEMINI_API}/${caminho}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      // A chave vai no cabecalho e nao na URL: URL aparece em log e em erro.
      headers:
        corpo === undefined
          ? { 'x-goog-api-key': chave }
          : { 'x-goog-api-key': chave, 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(tempoLimiteMs),
    })
  } catch (err) {
    return { ok: false, erro: erroDeRede(err) }
  }

  const texto = await resposta.text().catch(() => '')
  let json: unknown = null
  try {
    json = texto ? JSON.parse(texto) : null
  } catch {
    json = null
  }

  if (!resposta.ok) return { ok: false, erro: erroDoGoogle(resposta.status, json, texto) }
  if (json === null) {
    return {
      ok: false,
      erro: {
        status: resposta.status,
        codigo: 'SEM_JSON',
        mensagem: texto.slice(0, 200),
        cotaDoDia: false,
        semCotaGratis: false,
        esperaMs: null,
      },
    }
  }
  return { ok: true, json }
}

function erroDeRede(err: unknown): ErroGemini {
  const e = err as { name?: unknown; cause?: { code?: unknown } } | null
  const codigo =
    e?.name === 'TimeoutError'
      ? 'TIMEOUT'
      : typeof e?.cause?.code === 'string'
        ? e.cause.code
        : 'REDE'
  return {
    status: null,
    codigo,
    // "fetch" de proposito: e a palavra que o friendlyAiNote reconhece.
    mensagem: `fetch failed (${codigo})`,
    cotaDoDia: false,
    semCotaGratis: false,
    esperaMs: null,
  }
}

/**
 * Le o erro no formato do Google: `{ error: { code, message, status, details } }`.
 *
 * A cota estourada vem como 429 RESOURCE_EXHAUSTED nos dois casos -- por minuto
 * e por dia. Quem separa e o `quotaId` do QuotaFailure ("...PerDay..." contra
 * "...PerMinute..."), e o RetryInfo diz quanto esperar.
 */
export function erroDoGoogle(status: number, json: unknown, texto: string): ErroGemini {
  const erro = (json as { error?: Record<string, unknown> } | null)?.error
  const mensagem = typeof erro?.['message'] === 'string' ? erro['message'] : texto.slice(0, 300)
  let codigo = typeof erro?.['status'] === 'string' ? erro['status'] : `HTTP_${status}`
  let cotaDoDia = false
  let esperaMs: number | null = null

  const detalhes = Array.isArray(erro?.['details']) ? (erro['details'] as unknown[]) : []
  for (const item of detalhes) {
    if (typeof item !== 'object' || item === null) continue
    const detalhe = item as Record<string, unknown>
    const tipo = String(detalhe['@type'] ?? '')
    if (tipo.endsWith('google.rpc.QuotaFailure') && Array.isArray(detalhe['violations'])) {
      for (const violacao of detalhe['violations'] as Record<string, unknown>[]) {
        const id = `${String(violacao?.['quotaId'] ?? '')} ${String(violacao?.['quotaMetric'] ?? '')}`
        if (/per_?day/i.test(id)) cotaDoDia = true
      }
    }
    if (tipo.endsWith('google.rpc.RetryInfo')) esperaMs = duracaoEmMs(detalhe['retryDelay'])
    if (tipo.endsWith('google.rpc.ErrorInfo') && typeof detalhe['reason'] === 'string') {
      codigo = detalhe['reason']
    }
  }
  // Sem detalhes estruturados, o texto ainda conta.
  if (!cotaDoDia && status === 429 && /per ?day|daily/i.test(mensagem)) cotaDoDia = true

  return {
    status,
    codigo,
    mensagem,
    cotaDoDia,
    semCotaGratis: status === 429 && /limit:\s*0(?![\d.])/.test(mensagem),
    esperaMs,
  }
}

/** "37s", "1.5s" ou { seconds, nanos } -> ms. */
function duracaoEmMs(raw: unknown): number | null {
  if (typeof raw === 'string') {
    const m = /^(\d+(?:\.\d+)?)s$/.exec(raw.trim())
    return m ? Math.round(Number(m[1]) * 1000) : null
  }
  if (typeof raw === 'object' && raw !== null) {
    const { seconds, nanos } = raw as { seconds?: unknown; nanos?: unknown }
    const s = Number(seconds ?? 0)
    const n = Number(nanos ?? 0)
    return Number.isFinite(s) && Number.isFinite(n) ? Math.round(s * 1000 + n / 1e6) : null
  }
  return null
}

/** O texto para a interface, no tom do friendlyAiNote: o que houve e o que fazer. */
export function notaDoGemini(erro: ErroGemini, modelo: string): string {
  if (erro.status === null) {
    return erro.codigo === 'TIMEOUT'
      ? 'O Gemini demorou demais para responder. Tente de novo.'
      : 'Sem conexao com o Gemini. Confira a internet e tente de novo.'
  }
  if (erro.status === 429) {
    if (erro.semCotaGratis) {
      return `O modelo ${modelo} nao tem cota gratis. Escolha outro em configuracoes (Ctrl+,) ou deixe no automatico.`
    }
    if (erro.cotaDoDia) {
      return (
        'A cota gratis do Gemini acabou por hoje; ela renova a meia-noite (horario do Pacifico, ' +
        '4h ou 5h em Brasilia). Ate la, use a chave da Anthropic ou tente mais tarde.'
      )
    }
    return 'Muitos pedidos ao Gemini em pouco tempo. Espere um minuto e tente de novo.'
  }
  if (erro.status === 401 || erro.codigo === 'API_KEY_INVALID' || /api key not valid/i.test(erro.mensagem)) {
    return 'Chave do Gemini recusada. Confira em configuracoes (Ctrl+,).'
  }
  if (erro.status === 403) {
    return 'A chave do Gemini nao tem permissao para isto. Gere outra em aistudio.google.com/apikey.'
  }
  if (erro.status === 404) {
    const sucessor = sucessorSugerido(erro.mensagem)
    if (/no longer available/i.test(erro.mensagem)) {
      return `O Google aposentou o ${modelo || 'modelo escolhido'} para chaves novas.${sucessor ? ` Ele indica o ${sucessor}.` : ''} Escolha outro em configuracoes ou deixe no automatico.`
    }
    return `O modelo ${modelo || 'escolhido'} nao existe no Gemini. Escolha outro em configuracoes ou deixe no automatico.`
  }
  if (erro.status >= 500) return 'O Gemini esta instavel agora. Tente de novo em alguns minutos.'
  if (/location is not supported/i.test(erro.mensagem)) {
    return 'O Gemini nao atende a regiao desta conexao.'
  }
  return `O Gemini recusou o pedido (${erro.mensagem.slice(0, 80)}).`
}

/** Com o codigo HTTP na frente: e por ele que o friendlyAiNote reconhece. */
function brutoDoGemini(erro: ErroGemini): string {
  return `Gemini ${erro.status ?? 'sem resposta'} ${erro.codigo}: ${erro.mensagem}`.slice(0, 300)
}

// ----------------------------------------------------------------- schema

/**
 * As palavras do JSON Schema que o Gemini aceita, tiradas da doc do campo
 * (`_responseJsonSchema` no discovery da v1beta, revisao 20261012). O resto o
 * Google ignora ou recusa com 400 -- `$schema`, que o zod poe sempre, entre
 * elas.
 */
const PALAVRAS_DO_GEMINI = new Set([
  '$id',
  '$defs',
  '$ref',
  '$anchor',
  'type',
  'format',
  'title',
  'description',
  'enum',
  'items',
  'prefixItems',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'anyOf',
  'oneOf',
  'properties',
  'additionalProperties',
  'required',
  'propertyOrdering',
])

/** Os `format` que a doc lista para string. Um desconhecido vira 400. */
const FORMATOS_DO_GEMINI = new Set(['date-time', 'date', 'time'])

/** z.toJSONSchema + limpeza: o schema exatamente como vai no pedido. */
export function schemaParaGemini(schema: z.ZodType): Record<string, unknown> {
  return limparSchema(z.toJSONSchema(schema)) as Record<string, unknown>
}

/**
 * Deixa so o que o Gemini aceita, sem mudar o que o schema quer dizer.
 *
 * O que sai daqui e so dica para o modelo: a resposta passa pelo zod de novo
 * em lerResposta. Por isso perder um `minLength` nao abre buraco -- so tira do
 * modelo uma pista que ele nao saberia usar.
 */
export function limparSchema(no: unknown): unknown {
  if (typeof no !== 'object' || no === null || Array.isArray(no)) return no
  const entrada = no as Record<string, unknown>

  // Com $ref, a doc proibe qualquer outra chave que nao comece com $.
  if (typeof entrada['$ref'] === 'string') {
    const so: Record<string, unknown> = {}
    for (const [chave, valor] of Object.entries(entrada)) {
      if (chave === '$defs') so[chave] = limparMapa(valor)
      else if (chave.startsWith('$') && PALAVRAS_DO_GEMINI.has(chave)) so[chave] = valor
    }
    return so
  }

  const saida: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(entrada)) {
    switch (chave) {
      case 'properties':
      case '$defs':
        saida[chave] = limparMapa(valor)
        break
      case 'items':
      case 'additionalProperties':
        saida[chave] = limparSchema(valor)
        break
      case 'prefixItems':
      case 'anyOf':
      case 'oneOf':
        saida[chave] = Array.isArray(valor) ? valor.map(limparSchema) : valor
        break
      case 'const':
        // Nao esta na lista; enum de um valor so diz a mesma coisa.
        if (typeof valor === 'string' || typeof valor === 'number') saida['enum'] = [valor]
        break
      case 'exclusiveMinimum':
      case 'exclusiveMaximum': {
        // Vira o limite inclusivo: o modelo chega perto, e o zod barra o igual.
        const limite = chave === 'exclusiveMinimum' ? 'minimum' : 'maximum'
        if (typeof valor === 'number' && saida[limite] === undefined) saida[limite] = valor
        break
      }
      default:
        if (PALAVRAS_DO_GEMINI.has(chave)) saida[chave] = valor
    }
  }

  // enum so de string e numero, diz a doc.
  const lista = saida['enum']
  if (Array.isArray(lista) && !lista.every((v) => typeof v === 'string' || typeof v === 'number')) {
    delete saida['enum']
  }
  if (typeof saida['format'] === 'string' && !FORMATOS_DO_GEMINI.has(saida['format'])) {
    delete saida['format']
  }
  // O zod poe a faixa de "inteiro seguro" em todo .int(): nao diz nada ao
  // modelo e e numero grande demais para o Google conferir.
  if (saida['minimum'] === -Number.MAX_SAFE_INTEGER) delete saida['minimum']
  if (saida['maximum'] === Number.MAX_SAFE_INTEGER) delete saida['maximum']
  return saida
}

function limparMapa(mapa: unknown): unknown {
  if (typeof mapa !== 'object' || mapa === null || Array.isArray(mapa)) return mapa
  const saida: Record<string, unknown> = {}
  for (const [nome, sub] of Object.entries(mapa)) saida[nome] = limparSchema(sub)
  return saida
}

// ------------------------------------------------------------------ modelos

/**
 * Modelo "reserva": lite, nano, mini, tiny ou de N bilhoes ("-8b").
 *
 * Cabe na cota gratis quando os bons acabaram, mas escreve bem pior -- lista de
 * fatos no lugar de texto. O automatico so cai nele por ultimo, e um pedido com
 * `permitirReserva: false` para antes e devolve `so-reserva` para perguntar.
 *
 * A palavra tem que vir separada por hifen/ponto: "gemini" tem "mini" dentro.
 */
export function ehModeloReserva(modelo: string): boolean {
  return /(?:^|[-_./])(?:lite|nano|mini|tiny|\d+b)(?=$|[-_./])/i.test(modelo)
}

/** O que aparece na lista mas nao escreve JSON de texto. */
const NAO_E_TEXTO =
  /(tts|image|imagen|embedding|aqa|live|audio|veo|lyria|robotics|computer-use|learnlm)/i

function versaoDe(id: string): number {
  const m = /gemini-(\d+(?:\.\d+)?)/.exec(id)
  return m ? Number(m[1]) : 0
}

/** Preview, experimental, apelido "latest" ou com data no fim: muda sem aviso. */
function instavel(id: string): boolean {
  return /(preview|exp|latest|-\d{3,}$|-\d{2}-\d{2})/i.test(id)
}

/** Os modelos Gemini de texto, do mais novo para o mais velho, estaveis antes. */
export function modelosDeTexto(ids: readonly string[]): string[] {
  return ids
    .filter((id) => id.startsWith('gemini') && !NAO_E_TEXTO.test(id))
    .sort(
      (a, b) =>
        versaoDe(b) - versaoDe(a) || Number(instavel(a)) - Number(instavel(b)) || a.localeCompare(b),
    )
}

/**
 * O modelo do automatico: o melhor "flash" estavel e cheio (nao reserva: lite,
 * nano...), do mais novo; senao qualquer Gemini de texto. Os que ja deram 404
 * nesta sessao, e os lotados ou sem cota, ficam de fora.
 *
 * "Flash" porque e a familia da cota gratis, e e rapido o bastante para a
 * analise nao parecer travada. Nao ha preferencia fixa por versao: o Google
 * aposenta modelo para chave nova antes de tira-lo da lista.
 *
 * `soBons`: o reserva nem entra. null = nao ha modelo BOM livre agora.
 */
export function melhorFlash(ids: readonly string[], soBons = false): string | null {
  const texto = modelosDeTexto(ids.filter((id) => !indisponivel(id) && !(soBons && ehModeloReserva(id))))
  const flashes = texto
    .filter((id) => id.includes('flash'))
    .sort(
      (a, b) =>
        Number(instavel(a)) - Number(instavel(b)) ||
        Number(ehModeloReserva(a)) - Number(ehModeloReserva(b)) ||
        versaoDe(b) - versaoDe(a) ||
        a.length - b.length,
    )
  return flashes[0] ?? texto[0] ?? null
}

/**
 * Os ids que a chave enxerga e que aceitam generateContent.
 *
 * Lanca ErroDeIa com a nota pronta: listar e o primeiro contato com a chave, e
 * a falha aqui quase sempre e a chave ou a rede.
 */
/**
 * Os modelos de TEXTO que a chave de agora alcanca, para quem quer escolher
 * um (o modulo recap escolhe o Gemini Pro sozinho). Sem chave: lista vazia.
 */
export async function listarModelos(provedor: Provedor): Promise<string[]> {
  const s = getSettings()
  if (provedor === 'gemini') {
    return s.geminiApiKey ? modelosDeTexto(await listarModelosGemini(s.geminiApiKey)) : []
  }
  if (!s.anthropicApiKey) return []
  const client = new Anthropic({ apiKey: s.anthropicApiKey, maxRetries: 1 })
  const ids: string[] = []
  for await (const m of client.models.list()) ids.push(m.id)
  return ids
}

export async function listarModelosGemini(chave: string): Promise<string[]> {
  const ids: string[] = []
  let pagina = ''
  // Dez paginas de mil e muito mais do que o Google tem; o teto so impede laco
  // infinito se a API devolver o mesmo token para sempre.
  for (let i = 0; i < 10; i++) {
    const consulta = pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''
    const chamada = await chamarComRetentativa(chave, `models?pageSize=1000${consulta}`)
    if (!chamada.ok) throw new ErroDeIa(notaDoGemini(chamada.erro, ''), brutoDoGemini(chamada.erro))

    const corpo = chamada.json as {
      models?: { name?: unknown; supportedGenerationMethods?: unknown }[]
      nextPageToken?: unknown
    }
    for (const modelo of corpo.models ?? []) {
      if (typeof modelo?.name !== 'string') continue
      const metodos = modelo.supportedGenerationMethods
      if (!Array.isArray(metodos) || !metodos.includes('generateContent')) continue
      ids.push(modelo.name.replace(/^models\//, ''))
    }
    if (typeof corpo.nextPageToken !== 'string' || !corpo.nextPageToken) break
    pagina = corpo.nextPageToken
  }
  return ids
}

/**
 * O proximo modelo pela lista, para quando o atual falhou: so da lista, nunca
 * o padrao fixo (que pode ser justamente o aposentado). null = sem lista (rede,
 * chave).
 *
 * `modelo` e o melhor que o pedido aceita (null = nenhum). Com `soBons` e
 * nenhum bom livre, `reserva` diz qual reserva o automatico usaria -- e o
 * sinal de parar e perguntar, em vez de chamar.
 */
async function escolherDaLista(
  chave: string,
  soBons: boolean,
): Promise<{ modelo: string | null; reserva: string | null } | null> {
  let ids: string[]
  try {
    ids = await listarModelosGemini(chave)
  } catch {
    return null
  }
  const modelo = melhorFlash(ids, soBons)
  return { modelo, reserva: soBons && !modelo ? melhorFlash(ids) : null }
}

/**
 * O modelo do automatico, lembrado por chave. Com `soBons`, um reserva
 * lembrado nao serve: a lista e lida de novo (um bom pode ter voltado da
 * lotacao) e, se so houver reserva, volta `{ reserva }` sem chamar ninguem.
 */
async function modeloAutomatico(chave: string, soBons = false): Promise<string | { reserva: string }> {
  if (automatico?.chave === chave && !(soBons && ehModeloReserva(automatico.modelo))) return automatico.modelo
  const lista = await escolherDaLista(chave, soBons)
  // Sem lista (rede, chave), vai no padrao: o erro de verdade aparece na
  // chamada, com a nota certa.
  if (!lista) return GEMINI_PADRAO
  if (!lista.modelo && lista.reserva) return { reserva: lista.reserva }
  const modelo = lista.modelo ?? GEMINI_PADRAO
  automatico = { chave, modelo }
  return modelo
}

/**
 * O botao "Testar" das configuracoes: lista os modelos e faz uma chamada
 * minima, com schema, pelo mesmo caminho do planner.
 *
 * Listar ja prova a chave. A chamada prova o resto -- cota, modelo e o formato
 * de JSON -- e quando ela falha a chave continua valida: volta como aviso, nao
 * como erro. Erro (lancado, com a nota na mensagem) e so quando nem listar deu.
 */
/*
 * O teste roda no PROPRIO campo da chave, nas Configuracoes: o "Confira em
 * configuracoes (Ctrl+,)" da nota mandava para a tela em que ele ja estava.
 * Os erros que nascem fora (plano, textos) continuam com ele.
 */
function notaDoTeste(nota: string): string {
  return nota.replace(/\s*Confira em configuracoes \(Ctrl\+,\)\.$/, '')
}

export async function testarGemini(chave: string, modeloConfigurado: string): Promise<TesteDoGemini> {
  let ids: string[]
  try {
    ids = await listarModelosGemini(chave)
  } catch (err) {
    throw new Error(notaDoTeste(err instanceof ErroDeIa ? err.nota : String(err)))
  }

  if (!modeloConfigurado) automatico = { chave, modelo: melhorFlash(ids) || GEMINI_PADRAO }

  // Passa o configurado (ou vazio), e nao o modelo ja escolhido: no automatico
  // o viaGemini precisa poder trocar de modelo se o escolhido estiver aposentado.
  const resposta = await viaGemini(
    {
      schema: z.object({ ok: z.boolean() }),
      sistema: 'Responda so com o JSON pedido.',
      prompt: 'Devolva ok = true.',
      etapa: 'teste',
    },
    chave,
    modeloConfigurado,
  )
  if (!resposta.ok) {
    console.warn(`[llm:teste] gemini (${modeloConfigurado || automatico?.modelo || '?'}): ${resposta.bruto}`)
  }
  const modelo = resposta.ok
    ? resposta.modelo
    : modeloConfigurado || automatico?.modelo || GEMINI_PADRAO
  return {
    modelos: modelosDeTexto(ids.filter((id) => !aposentados.has(id))),
    modelo,
    aviso: resposta.ok ? null : resposta.nota,
  }
}
