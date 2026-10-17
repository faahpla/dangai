import { z } from 'zod'
import { ehModeloReserva, type EtapaDoRoteiro, type ParadoNoReserva } from '../../shared/roteiro'
import type { PedidoJson, RespostaJson } from '../../../../electron/services/llm'
import { contexto } from '../contexto'
import { modeloEscolhido } from '../settings'
import { chaveDoCache, gravarNoCache, lerDoCache } from './cache'

/**
 * A chamada de IA do passo 2: o gerarJson do nucleo (`ctx.ia`) atras do cache
 * (cache.ts).
 *
 * O llm.ts nunca lanca e devolve a nota pronta; aqui so entra o cache e a
 * medida de tempo (para o log e para o teste real dizer quanto cada chamada
 * levou). A chave da API nunca passa por aqui: o nucleo escolhe e chama.
 *
 * Duas regras do cache, cada uma saida de um botao que travou:
 * - so entra no cache o que o passo ACEITOU (`guardar`, chamado por quem
 *   montou e validou). Antes toda resposta que passava no schema frouxo era
 *   gravada, e quando as duas tentativas saiam invalidas o "Tente de novo" lia
 *   as mesmas duas do cache e falhava igual, para sempre, sem chamar a IA;
 * - pedido de OUTRA tomada ("Outra versao", "Refazer esta parte") nao LE o
 *   cache (`lerCache: false`), so grava: com o mesmo prompt (a IA repetiu um
 *   gancho, ou voltou-se para a mesma base com a mesma instrucao) ele devolvia
 *   o texto que o Levi acabou de recusar.
 *
 * E a regra do reserva: com `permitirReserva: false` (o padrao dos eventos e
 * do roteiro), resposta guardada de um modelo reserva tambem nao e lida -- um
 * modelo bom pode estar livre agora. Se nao estiver, o llm.ts devolve
 * 'so-reserva' e, aceito o reserva, o cache volta a valer (sem gastar cota).
 */

export type RespostaDoPasso<T> =
  | {
      ok: true
      valor: T
      provedor: string
      modelo: string
      doCache: boolean
      ms: number
      /** Grava a resposta no cache. Chame quando o passo aceitou o valor; do cache, nao faz nada. */
      guardar: () => void
    }
  | { ok: false; motivo?: undefined; nota: string; bruto: string; ms: number }
  | {
      /** So sobrou modelo reserva e o pedido nao aceitava: ninguem foi chamado. */
      ok: false
      motivo: 'so-reserva'
      nota: string
      bruto: string
      ms: number
      reserva: string
      renovaEm: number
      porCota: boolean
    }

/** Opcoes do passo, alem do pedido do llm.ts. */
export interface OpcoesDoCache {
  /** false = pedido de outra tomada: chama a IA mesmo com resposta guardada. Padrao true. */
  lerCache?: boolean
}

type Chamada = <S extends z.ZodType>(pedido: PedidoJson<S>) => Promise<RespostaJson<z.infer<S>>>

let falsa: Chamada | null = null
const chamar: Chamada = (pedido) => (falsa ?? contexto().ia.gerarJson)(pedido)

/**
 * Quanto esperar cada resposta. O passo 2 manda o episodio inteiro e recebe
 * 3-4 mil tokens: medido em 13/10/2026 no free tier, o gemini-3.8-flash (o
 * automatico) gera ~25 tokens/s e levou 176 s nos eventos -- o teto padrao do
 * llm.ts (2 min, pensado para o planner) cortava a resposta no meio.
 */
export const TEMPO_LIMITE_DO_PASSO_MS = 300_000

/**
 * So os testes usam: troca o gerarJson por uma IA falsa (sem rede, sem cota).
 * Devolve a funcao que desfaz.
 */
export function trocarIaParaTeste(ia: Chamada): () => void {
  falsa = ia
  return () => {
    falsa = null
  }
}

/** Quem vai responder, para a mensagem de andamento ("Pedindo ... ao Gemini"). */
export function nomeDoProvedor(forcado?: 'gemini' | 'anthropic'): string {
  const p = contexto().ia.provedor(forcado)
  return p === 'anthropic' ? 'Claude' : 'Gemini'
}

/**
 * A chave do cache de um pedido. O modelo pedido e o forcado (escritor pago)
 * ou o das Configuracoes: sem modelo forcado, a chave e a de sempre. Sem
 * provedor nao ha cache a consultar (o gerarJson devolve a nota de "sem chave").
 */
function chaveDoPedido(pedido: PedidoJson<z.ZodType>): string | null {
  const provedor = contexto().ia.provedor(pedido.provedor)
  if (!provedor) return null
  return chaveDoCache({
    etapa: pedido.etapa,
    provedor,
    modeloPedido: (pedido.provedor && pedido.modelo?.trim()) || modeloEscolhido(provedor),
    sistema: pedido.sistema,
    prompt: pedido.prompt,
    schema: z.toJSONSchema(pedido.schema),
  })
}

/** O pedido ja tem resposta valida no cache (o escritor pago nao pergunta o custo: sai de graca). */
export function estaNoCache(pedido: PedidoJson<z.ZodType>): boolean {
  const chave = chaveDoPedido(pedido)
  const guardada = chave ? lerDoCache<unknown>(chave) : null
  return guardada !== null && pedido.schema.safeParse(guardada.valor).success
}

export async function gerarComCache<S extends z.ZodType>(
  pedido: PedidoJson<S>,
  opcoes: OpcoesDoCache = {},
): Promise<RespostaDoPasso<z.infer<S>>> {
  const inicio = Date.now()
  const chave = chaveDoPedido(pedido)

  if (chave && opcoes.lerCache !== false) {
    const guardada = lerDoCache<unknown>(chave)
    const conferida = guardada ? pedido.schema.safeParse(guardada.valor) : null
    const reservaRecusado = pedido.permitirReserva === false && guardada !== null && ehModeloReserva(guardada.modelo)
    if (guardada && conferida?.success && !reservaRecusado) {
      return {
        ok: true,
        valor: conferida.data,
        provedor: guardada.provedor,
        modelo: guardada.modelo,
        doCache: true,
        ms: Date.now() - inicio,
        guardar: () => undefined,
      }
    }
  }

  const resposta = await chamar({ tempoLimiteMs: TEMPO_LIMITE_DO_PASSO_MS, ...pedido })
  const ms = Date.now() - inicio
  if (!resposta.ok) {
    if (resposta.motivo === 'so-reserva') {
      const { nota, bruto, reserva, renovaEm, porCota } = resposta
      console.log(`[gerar:${pedido.etapa}] parou: so o reserva ${reserva} esta livre`)
      return { ok: false, motivo: 'so-reserva', nota, bruto, ms, reserva, renovaEm, porCota }
    }
    return { ok: false, nota: resposta.nota, bruto: resposta.bruto, ms }
  }
  console.log(`[gerar:${pedido.etapa}] ${resposta.provedor} ${resposta.modelo} ${(ms / 1000).toFixed(1)} s`)
  let guardou = false
  const guardar = (): void => {
    if (!chave || guardou) return
    guardou = true
    gravarNoCache(chave, {
      valor: resposta.valor,
      modelo: resposta.modelo,
      provedor: resposta.provedor,
      criadoEm: new Date().toISOString(),
    })
  }
  return { ok: true, valor: resposta.valor, provedor: resposta.provedor, modelo: resposta.modelo, doCache: false, ms, guardar }
}

/** A parada do llm.ts ("so sobrou reserva") no formato da tela, com a etapa onde parou. */
export function paradaDoPasso(
  resposta: { reserva: string; renovaEm: number; porCota: boolean },
  etapa: EtapaDoRoteiro,
): ParadoNoReserva {
  return { motivo: 'so-reserva', etapa, renovaEm: resposta.renovaEm, porCota: resposta.porCota, reserva: resposta.reserva }
}
