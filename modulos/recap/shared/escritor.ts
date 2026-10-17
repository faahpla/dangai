/**
 * [recap] QUEM ESCREVE O ROTEIRO: o Gemini gratis (o provedor padrao do
 * nucleo, como sempre) ou, pago e so para ESCREVER, o Claude Sonnet ou o
 * Gemini Pro. Os eventos (a leitura do episodio), o religar e a revisao
 * continuam no provedor padrao.
 *
 * Pagar SEMPRE passa pela pergunta de custo (como a da voz): o main calcula a
 * estimativa pelo prompt de verdade e devolve `PerguntaDeCusto` em vez de
 * chamar; so o pedido que volta com `custoAceito` gasta, e nunca mais que
 * isso. O mesmo pedido (mesmo hash) sai do cache, de graca.
 *
 * Os precos sao por 1 milhao de tokens (US$), os do pedido do Levi em
 * 17/10/2026. A estimativa e de bolso: tokens = caracteres / 3,5; a saida e
 * o roteiro em JSON (~70 tokens por frase) e, no Gemini Pro, o pensamento.
 */

export const ESCRITORES_IDS = ['gemini', 'claude', 'gemini-pro'] as const
export type Escritor = (typeof ESCRITORES_IDS)[number]

export interface DadosDoEscritor {
  rotulo: string
  /** null = o provedor padrao do nucleo (sem forcar nada). */
  provedor: 'gemini' | 'anthropic' | null
  /** O modelo forcado. null = o das Configuracoes (o Gemini Pro le o da config do modulo). */
  modelo: string | null
  /** US$ por 1M tokens de entrada e de saida. 0 = gratis. */
  entrada: number
  saida: number
  /** Tokens de pensamento a mais por chamada (cobrados como saida). */
  pensamento: number
}

export const MODELO_CLAUDE_ESCRITOR = 'claude-sonnet-5-5'
/** O pro "atual" do Google, pelo apelido; da para trocar na config do modulo. */
export const MODELO_GEMINI_PRO_PADRAO = 'gemini-pro-latest'

export const ESCRITORES: Record<Escritor, DadosDoEscritor> = {
  gemini: { rotulo: 'Gemini (gratis)', provedor: null, modelo: null, entrada: 0, saida: 0, pensamento: 0 },
  claude: { rotulo: 'Claude Sonnet', provedor: 'anthropic', modelo: MODELO_CLAUDE_ESCRITOR, entrada: 2, saida: 10, pensamento: 0 },
  'gemini-pro': { rotulo: 'Gemini Pro', provedor: 'gemini', modelo: null, entrada: 2, saida: 12, pensamento: 4000 },
}

/** Cotacao fixa para o R$ da pergunta (so a ordem de grandeza). */
export const REAIS_POR_DOLAR = 5.4

/** Saida de uma chamada de roteiro: ~70 tokens por frase (texto, ids, intencao visual) + o JSON. */
export function tokensDeSaida(frases: number): number {
  return Math.round(frases * 70 + 300)
}

export interface EstimativaDoEscritor {
  escritor: Escritor
  rotulo: string
  modelo: string
  tokensDeEntrada: number
  tokensDeSaida: number
  /** Uma chamada. */
  usd: number
  brl: number
  /** O teto aceito: ate 2 chamadas (a segunda so se o tamanho ou o gancho sair errado). */
  usdMaximo: number
}

export function estimarCusto(
  escritor: Escritor,
  modelo: string,
  caracteresDeEntrada: number,
  saida: number,
  chamadas = 2,
): EstimativaDoEscritor {
  const d = ESCRITORES[escritor]
  const entrada = Math.ceil(caracteresDeEntrada / 3.5)
  const saidaTotal = saida + d.pensamento
  const usd = (entrada * d.entrada + saidaTotal * d.saida) / 1_000_000
  return {
    escritor,
    rotulo: d.rotulo,
    modelo,
    tokensDeEntrada: entrada,
    tokensDeSaida: saidaTotal,
    usd,
    brl: usd * REAIS_POR_DOLAR,
    usdMaximo: usd * chamadas,
  }
}

/** "US$ 0,07 - R$ 0,38" (centavos com 2 casas; abaixo de 1 centavo, "< US$ 0,01"). */
export function textoDoCusto(usd: number): string {
  if (usd < 0.005) return '< US$ 0,01'
  const f = (v: number): string => v.toFixed(2).replace('.', ',')
  return `US$ ${f(usd)} · R$ ${f(usd * REAIS_POR_DOLAR)}`
}

/**
 * O main parou ANTES de pagar: a tela pergunta. Volta como resposta (e nao
 * erro) para atravessar o IPC com tipo, como a parada no reserva.
 */
export interface PerguntaDeCusto {
  motivo: 'custo'
  estimativa: EstimativaDoEscritor
}

export function ehPerguntaDeCusto(x: object): x is PerguntaDeCusto {
  return (x as { motivo?: unknown }).motivo === 'custo'
}
