import { dialog } from 'electron'
import { existsSync } from 'node:fs'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { CANAIS as C } from '../shared/canais'
import type { ConfigDoRecapNaTela } from '../shared/config'
import {
  indexarEpisodioArgsSchema,
  indexarFalasArgsSchema,
  listaDeExclusoesSchema,
  palpiteDoEpisodioSchema,
  type EpisodeIndex,
  type EpisodioEncontrado,
  type Exclusao,
  type IndexarEpisodioArgs,
  type IndexarFalasArgs,
  type PalpiteDoEpisodio,
  type SondaDoEpisodio,
} from '../shared/episodio'
import {
  pedidoDeReligarSchema,
  pedidoDeRoteiroSchema,
  roteiroSchema,
  type EventosGerados,
  type PedidoDeReligar,
  type PedidoDeRoteiro,
  type ProgressoDoRoteiro,
  type RascunhoAberto,
  type RascunhoDoRecap,
  type ResumoDoRascunho,
  type Roteiro,
  type RoteiroGerado,
  type RoteiroReligado,
} from '../shared/roteiro'
import type { RitmoDaVoz } from '../shared/ritmo'
import { configDaVozSchema } from '../shared/voz'
import { configNaTela } from './config'
import { indexarFalas } from './episodio/falas'
import { indexarEpisodio, salvarExclusoes } from './episodio/indice'
import { procurarEpisodio } from './episodio/procurar'
import { sondarEpisodio } from './episodio/sondar'
import { gerarEventos } from './gerar/eventos'
import { miniaturasDasCenas } from './gerar/miniaturas'
import {
  abrirRascunho,
  aprovarRoteiro,
  desaprovarRoteiro,
  escolherVersao,
  listarRascunhos,
  salvarRoteiro,
} from './gerar/rascunho'
import { religarRoteiro } from './gerar/religar'
import { cancelarRoteiro, gerarRoteiro } from './gerar/roteiro'
import { ritmoDe, ritmoPeloId } from './voz/ritmo'

/**
 * [recap] OS CANAIS DO MODULO no main, os mesmos handlers do ipc.ts do Studio
 * (passos 1 e 2) com o nome novo (`recap:<area>:<acao>`). O que vem do
 * renderer passa pelo zod AQUI: vira arquivo no disco e pedido a IA.
 *
 * O corte das cenas, o motor e a voz chegam nas partes seguintes.
 */
export function registrarCanais(ctx: ContextoDoModulo): void {
  // ------------------------------------------------------------ configuracao

  ctx.handle<[], ConfigDoRecapNaTela>(C.lerConfig, async () => configNaTela(ctx.config().modulo))

  ctx.handle<[unknown], ConfigDoRecapNaTela>(C.salvarConfig, async (patch) => configNaTela(ctx.salvarConfig(patch)))

  ctx.handle<[], string | null>(C.escolherBiblioteca, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Biblioteca do recap',
      properties: ['openDirectory', 'createDirectory'],
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]!
  })

  // ------------------------------------------------------- passo 1 (Episodio)

  ctx.handle<[], string | null>(C.escolherEpisodio, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Escolher o episodio',
      properties: ['openFile'],
      filters: [{ name: 'Episodio', extensions: ['mkv', 'mp4', 'm4v', 'webm', 'mov'] }],
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]!
  })

  ctx.handle<[string], SondaDoEpisodio>(C.sondarEpisodio, async (path) => {
    if (typeof path !== 'string' || !existsSync(path)) throw new Error('Esse arquivo nao esta mais no disco.')
    return sondarEpisodio(path)
  })

  ctx.handle<[string, PalpiteDoEpisodio], EpisodioEncontrado[]>(C.procurarEpisodio, async (path, palpite) =>
    procurarEpisodio(path, palpiteDoEpisodioSchema.parse(palpite)),
  )

  const avisarIndexar = (mensagem: string): void => ctx.enviar(C.indexarProgresso, mensagem)

  ctx.handle<[IndexarEpisodioArgs], EpisodeIndex>(C.indexarEpisodio, async (args) =>
    indexarEpisodio(indexarEpisodioArgsSchema.parse(args), avisarIndexar),
  )

  ctx.handle<[IndexarFalasArgs], EpisodeIndex>(C.indexarFalas, async (args) =>
    indexarFalas(indexarFalasArgsSchema.parse(args), avisarIndexar),
  )

  ctx.handle<[string, Exclusao[]], EpisodeIndex>(C.salvarExclusoes, async (indiceId, exclusoes) =>
    salvarExclusoes(String(indiceId), listaDeExclusoesSchema.parse(exclusoes)),
  )

  // -------------------------------------------------------- passo 2 (Roteiro)
  // Ids viram texto conferido aqui: o rascunhoId vira nome de arquivo no main.

  const progressoDoRoteiro = (p: ProgressoDoRoteiro): void => ctx.enviar(C.roteiroProgresso, p)

  ctx.handle<[string, boolean], RascunhoAberto>(C.abrirRascunho, async (episodioId, novo) =>
    abrirRascunho(idDoEpisodio(episodioId), novo === true),
  )

  ctx.handle<[], ResumoDoRascunho[]>(C.listarRascunhos, () => listarRascunhos())

  ctx.handle<[string], EventosGerados>(C.gerarEventos, async (rascunhoId) =>
    gerarEventos(idDoRascunho(rascunhoId), progressoDoRoteiro),
  )

  ctx.handle<[string, PedidoDeRoteiro], RoteiroGerado>(C.gerarRoteiro, async (rascunhoId, pedido) =>
    gerarRoteiro(idDoRascunho(rascunhoId), pedidoDeRoteiroSchema.parse(pedido), progressoDoRoteiro),
  )

  ctx.handle<[string, string], boolean>(C.cancelarRoteiro, async (rascunhoId, pedidoId) =>
    cancelarRoteiro(idDoRascunho(rascunhoId), String(pedidoId).slice(0, 64)),
  )

  ctx.handle<[string, Roteiro], RascunhoDoRecap>(C.salvarRoteiro, async (rascunhoId, roteiro) =>
    salvarRoteiro(idDoRascunho(rascunhoId), roteiroSchema.parse(roteiro)),
  )

  ctx.handle<[string, number], RascunhoDoRecap>(C.escolherVersao, async (rascunhoId, versao) => {
    if (!Number.isInteger(versao) || versao < 1) throw new Error('Versao invalida.')
    return escolherVersao(idDoRascunho(rascunhoId), versao)
  })

  ctx.handle<[string, Roteiro], RascunhoDoRecap>(C.aprovarRoteiro, async (rascunhoId, roteiro) =>
    aprovarRoteiro(idDoRascunho(rascunhoId), roteiroSchema.parse(roteiro)),
  )

  ctx.handle<[string], RascunhoDoRecap>(C.desaprovarRoteiro, async (rascunhoId) =>
    desaprovarRoteiro(idDoRascunho(rascunhoId)),
  )

  ctx.handle<[string, PedidoDeReligar], RoteiroReligado>(C.religarRoteiro, async (rascunhoId, pedido) =>
    religarRoteiro(idDoRascunho(rascunhoId), pedidoDeReligarSchema.parse(pedido), progressoDoRoteiro),
  )

  ctx.handle<[string, string[]], Record<string, string | null>>(C.miniaturasDasCenas, async (episodioId, planoIds) => {
    if (!Array.isArray(planoIds) || planoIds.some((id) => typeof id !== 'string')) {
      throw new Error('Lista de cenas invalida.')
    }
    return miniaturasDasCenas(idDoEpisodio(episodioId), planoIds)
  })

  // Com a config: o ritmo DELA (a previsao do passo 3). Sem: o do rascunho
  // (o take atual; sem take, o inicial calibrado -- o "~Xs" do roteiro).
  ctx.handle<[string | null, unknown?], RitmoDaVoz>(C.ritmoDaVoz, async (rascunhoId, config) =>
    config
      ? ritmoDe(configDaVozSchema.parse(config))
      : ritmoPeloId(rascunhoId === null ? null : idDoRascunho(rascunhoId)),
  )
}

/** O id de episodio do indice ('ep_' + sha1). Vira nome de pasta e de arquivo. */
function idDoEpisodio(valor: unknown): string {
  if (typeof valor !== 'string' || !/^ep_[0-9a-f]{40}$/.test(valor)) throw new Error('Episodio invalido.')
  return valor
}

/** O id do rascunho ('rc_...'). Vira nome de arquivo no main. */
function idDoRascunho(valor: unknown): string {
  if (typeof valor !== 'string' || !/^rc_[0-9a-z_]+$/.test(valor)) throw new Error('Rascunho invalido.')
  return valor
}
