import type { ContextoDoModulo } from '../../../electron/modulos'
import { CANAIS as C } from '../shared/canais'
import {
  decisaoDaDescobertaSchema,
  pedidoDaDescobertaSchema,
  pedidoDeElencoSchema,
  type BuscaDeAnime,
  type DecisaoDaDescoberta,
  type ElencoEscolhido,
  type PedidoDeElenco,
  type EstadoDaDescoberta,
  type EventoDaDescoberta,
  type PedidoDaDescoberta,
  type ResultadoDaDescoberta,
} from '../shared/descoberta'
import {
  pedidoDeAnaliseSchema,
  pedidoDeCorteSchema,
  type CorteParado,
  type EstadoDoCorte,
  type PedidoDeAnalise,
  type PedidoDeCorte,
  type StatusDoMotor,
} from '../shared/episodio'
import { cancelarDescoberta, confirmarDescoberta, descobertaAtual, iniciarDescoberta, salvarDecisao, type AvisosDaDescoberta } from './descoberta'
import { buscarAnime, escolherAnime } from './descoberta/elenco'
import { cancelarCorte, corteParadoDoEpisodio, estadoDoCorte, iniciarCorte } from './episodio/corte-fundo'
import { analisarEpisodio, cancelarAnalise, statusDoMotor } from './motor'
import { registrarIpcDoMotorRuntime } from './motor-runtime/ipc'

/**
 * [recap] Os canais do MOTOR (parte 4): os mesmos handlers do ipc.ts do Studio
 * (statusDoMotor, analisar, o corte em segundo plano, o Reconhecer na mao e o
 * runtime), com o nome novo e pelo `ctx` do nucleo. O que vem do renderer
 * passa pelo zod AQUI: vira linha de comando do motor e pasta no disco.
 */
export function registrarCanaisDoMotor(ctx: ContextoDoModulo): void {
  registrarIpcDoMotorRuntime(ctx)

  ctx.handle<[], StatusDoMotor>(C.statusDoMotor, () => statusDoMotor())

  ctx.handle<[PedidoDeAnalise], string>(C.analisarEpisodio, async (pedido) =>
    analisarEpisodio(pedidoDeAnaliseSchema.parse(pedido), {
      progresso: (p) => ctx.enviar(C.analiseProgresso, p),
      fim: (f) => ctx.enviar(C.analiseFim, f),
    }),
  )

  ctx.handle<[string], null>(C.cancelarAnalise, async (jobId) => {
    await cancelarAnalise(String(jobId))
    return null
  })

  // O passo 1 sem esperar o corte: o corte (e os personagens) por tras.
  ctx.handle<[PedidoDeCorte], EstadoDoCorte>(C.iniciarCorte, async (pedido) =>
    iniciarCorte(pedidoDeCorteSchema.parse(pedido), (evento) => ctx.enviar(C.corteProgresso, evento)),
  )
  ctx.handle<[string], EstadoDoCorte | null>(C.estadoDoCorte, async (episodioId) => estadoDoCorte(idDoEpisodio(episodioId)))
  // O2: o .mkv reaberto com o corte pela metade volta onde estava.
  ctx.handle<[string], CorteParado | null>(C.corteParado, async (episodioId) => corteParadoDoEpisodio(idDoEpisodio(episodioId)))
  ctx.handle<[string], boolean>(C.cancelarCorte, async (episodioId) => cancelarCorte(idDoEpisodio(episodioId)))

  // Reconhecer na mao. O fim leva o indice novo pelos DOIS canais: o do corte e o da descoberta.
  const avisos: AvisosDaDescoberta = {
    descoberta: (evento) => ctx.enviar(C.descobertaProgresso, evento),
    corte: (evento) => ctx.enviar(C.corteProgresso, evento),
  }
  ctx.handle<[PedidoDaDescoberta], EstadoDaDescoberta>(C.iniciarDescoberta, async (pedido) =>
    iniciarDescoberta(pedidoDaDescobertaSchema.parse(pedido), avisos),
  )
  // O2: com o app reaberto, os grupos voltam do disco (com a decisao gravada) e avisam pelos canais de sempre.
  ctx.handle<[string], EventoDaDescoberta | null>(C.descobertaAtual, async (episodioId) => descobertaAtual(idDoEpisodio(episodioId), avisos))
  ctx.handle<[string, DecisaoDaDescoberta], boolean>(C.salvarDecisao, async (episodioId, decisao) =>
    salvarDecisao(idDoEpisodio(episodioId), decisaoDaDescobertaSchema.parse(decisao)),
  )
  ctx.handle<[string, DecisaoDaDescoberta], ResultadoDaDescoberta>(C.confirmarDescoberta, async (jobId, decisao) =>
    confirmarDescoberta(idDoJob(jobId), decisaoDaDescobertaSchema.parse(decisao)),
  )
  ctx.handle<[string, boolean?], boolean>(C.cancelarDescoberta, async (jobId, manterDecisao) =>
    cancelarDescoberta(idDoJob(jobId), manterDecisao === true),
  )

  // A1: "Buscar elenco". O termo vira argumento do motor: string curta, sem controle.
  ctx.handle<[string], BuscaDeAnime>(C.buscarAnime, async (termo) =>
    buscarAnime(typeof termo === 'string' ? termo.replace(/[\u0000-\u001f\u007f]/g, ' ') : ''),
  )
  ctx.handle<[PedidoDeElenco], ElencoEscolhido>(C.escolherAnime, async (pedido) => escolherAnime(pedidoDeElencoSchema.parse(pedido)))
}

/** 'ep_' + 40 hex, como o EpisodeIndex.id. Qualquer outra coisa e recusada. */
function idDoEpisodio(valor: unknown): string {
  if (typeof valor !== 'string' || !/^ep_[0-9a-f]{40}$/.test(valor)) throw new Error('Episodio invalido.')
  return valor
}

/** O id de job do motor.ts ('job_' + base36 + '_' + 6 hex). Vira nome de pasta dos recortes. */
function idDoJob(valor: unknown): string {
  if (typeof valor !== 'string' || !/^job_[0-9a-z]{1,16}_[0-9a-f]{6}$/.test(valor)) throw new Error('Descoberta invalida.')
  return valor
}
