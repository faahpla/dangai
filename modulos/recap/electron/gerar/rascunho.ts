import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EpisodeIndex } from '../../shared/episodio'
import {
  ALVO_PADRAO,
  aplicarEdicao,
  desmarcarAprovado,
  idDoRascunho,
  lerRascunho,
  marcarAprovado,
  RASCUNHO_VERSAO,
  rascunhoDoRecapSchema,
  resumirRascunho,
  roteiroAtual,
  voltarParaVersao,
  type RascunhoAberto,
  type RascunhoDoRecap,
  type ResumoDoRascunho,
  type Roteiro,
} from '../../shared/roteiro'
import { abrirIndicePorId, type IndiceAberto } from '../episodio/abrir-indice'
import { gravarJsonAtomico, pastaDoPerfil } from '../episodio/perfil'
import { tituloDoEpisodio } from './prompts'
import { aprenderDoAprovado } from './estilo'

/**
 * O RASCUNHO DO RECAP no disco: <userData>/recaps/<id>.json.
 *
 * - le com lerRascunho (zod) e grava com gravarJsonAtomico (temporario +
 *   rename): nunca meio arquivo;
 * - as transicoes sao as funcoes puras de shared/roteiro.ts; aqui so le,
 *   aplica, grava e devolve o rascunho inteiro;
 * - o indice vem de abrirIndicePorId, que acha pelo id e corrige os caminhos
 *   quando a biblioteca mudou de lugar; `indicePath` e so a dica;
 * - um rascunho por episodio por enquanto: abrirRascunho reabre o mais recente
 *   (atualizadoEm) daquele episodioId, ou cria um vazio. Com `novo` cria um
 *   vazio mesmo havendo outro: as falas do episodio mudaram (eventosOrfaos), e
 *   eventos novos num rascunho velho fariam as versoes antigas citarem outro
 *   evento com o mesmo id. O antigo fica no disco como estava;
 * - nunca escreve fora de <userData>/recaps.
 *
 * CONCORRENCIA: cada operacao e ler -> aplicar -> gravar SEM await no meio. O
 * main roda um evento por vez, entao duas chamadas (o autosave da tela e um
 * "Outra versao" que volta da IA) nunca intercalam leitura e escrita: quem
 * chega depois le o que o outro gravou. A geracao (eventos.ts, roteiro.ts) faz
 * o mesmo -- a chamada lenta vem antes, e o rascunho e relido na hora de gravar.
 */

/** Onde os rascunhos moram. O cache de IA fica em <esta pasta>/cache. */
export function pastaDosRascunhos(): string {
  return join(pastaDoPerfil(), 'recaps')
}

/** O formato de idDoRascunho: e ele que vira nome de arquivo. */
const ID_VALIDO = /^rc_[0-9a-z_]+$/

function arquivoDoRascunho(rascunhoId: string): string {
  if (!ID_VALIDO.test(rascunhoId)) throw new Error('Rascunho invalido.')
  return join(pastaDosRascunhos(), `${rascunhoId}.json`)
}

function agora(): string {
  return new Date().toISOString()
}

/** Le e confere <id>.json. Lanca com mensagem para a tela quando nao existe ou nao confere. */
export function lerRascunhoDoDisco(rascunhoId: string): RascunhoDoRecap {
  const arquivo = arquivoDoRascunho(rascunhoId)
  if (!existsSync(arquivo)) throw new Error('Esse rascunho nao existe mais. Abra o episodio de novo.')
  let cru: unknown
  try {
    cru = JSON.parse(readFileSync(arquivo, 'utf8'))
  } catch {
    throw new Error('O rascunho nao abre (arquivo quebrado).')
  }
  try {
    return lerRascunho(cru)
  } catch {
    throw new Error('O rascunho nao abre (formato desconhecido).')
  }
}

/** Grava atomico (passa pelo zod antes: um rascunho que nao confere nunca vai para o disco). */
export function gravarRascunho(rascunho: RascunhoDoRecap): void {
  const conferido = rascunhoDoRecapSchema.parse(rascunho)
  gravarJsonAtomico(arquivoDoRascunho(conferido.id), conferido)
}

/** Todos os rascunhos que abrem. Os quebrados ficam de fora (e no log). */
function todosOsRascunhos(): RascunhoDoRecap[] {
  const pasta = pastaDosRascunhos()
  let nomes: string[] = []
  try {
    nomes = readdirSync(pasta).filter((n) => n.endsWith('.json') && ID_VALIDO.test(n.slice(0, -5)))
  } catch {
    return []
  }
  const lidos: RascunhoDoRecap[] = []
  for (const nome of nomes) {
    try {
      lidos.push(lerRascunho(JSON.parse(readFileSync(join(pasta, nome), 'utf8'))))
    } catch {
      console.warn(`[gerar:rascunho] ${nome} nao abre: ficou de fora da lista`)
    }
  }
  return lidos.sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm))
}

/**
 * O indice do rascunho (caminhos corrigidos). Erro com mensagem para a tela
 * quando o episodio sumiu.
 */
export function indiceDoRascunho(r: Pick<RascunhoDoRecap, 'episodioId' | 'indicePath'>): IndiceAberto {
  return abrirIndicePorId(r.episodioId, r.indicePath)
}

/**
 * O rascunho mais recente do episodio, ou um novo vazio, mais o indice
 * (caminhos corrigidos). `novo` = um vazio mesmo havendo outro.
 */
export async function abrirRascunho(episodioId: string, novo = false): Promise<RascunhoAberto> {
  const anterior = todosOsRascunhos().find((r) => r.episodioId === episodioId) ?? null
  const existente = novo ? null : anterior
  const aberto = abrirIndicePorId(episodioId, anterior?.indicePath ?? null)
  const avisos: string[] = []
  if (aberto.movido) avisos.push('A biblioteca mudou de lugar: caminhos corrigidos.')

  let rascunho: RascunhoDoRecap
  if (!existente) {
    const quando = agora()
    rascunho = {
      versao: RASCUNHO_VERSAO,
      id: idDoRascunho(episodioId, Date.now()),
      episodioId,
      indicePath: aberto.caminho,
      titulo: tituloDoEpisodio(aberto.indice),
      alvoSec: ALVO_PADRAO,
      eventos: [],
      eventosMeta: null,
      roteiros: [],
      atual: null,
      aprovado: false,
      aprovadoEm: null,
      criadoEm: quando,
      atualizadoEm: quando,
      voz: null,
      cenas: null,
      revisoes: [],
    }
    gravarRascunho(rascunho)
  } else {
    rascunho = existente
    // So a dica muda (o indice saiu do lugar): atualizadoEm fica, nao e edicao.
    if (rascunho.indicePath !== aberto.caminho) {
      rascunho = { ...rascunho, indicePath: aberto.caminho }
      gravarRascunho(rascunho)
    }
  }

  // Eventos de falas que mudaram (eventosOrfaos): quem confere e a tela, com o
  // indice do passo 1 (que pode ter sido relido depois deste), e ela oferece o
  // rascunho novo.
  return { rascunho, indice: aberto.indice, avisos }
}

/** Todos os <id>.json que conferem, o mais recente primeiro. Os que nao abrem ficam de fora. */
export async function listarRascunhos(): Promise<ResumoDoRascunho[]> {
  return todosOsRascunhos().map(resumirRascunho)
}

/** aplicarEdicao + gravar (so quando mudou). */
export async function salvarRoteiro(rascunhoId: string, roteiro: Roteiro): Promise<RascunhoDoRecap> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const editado = aplicarEdicao(r, roteiro, agora())
  if (editado !== r) gravarRascunho(editado)
  return editado
}

/** voltarParaVersao + gravar. */
export async function escolherVersao(rascunhoId: string, versao: number): Promise<RascunhoDoRecap> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const escolhido = voltarParaVersao(r, versao, agora())
  if (escolhido !== r) gravarRascunho(escolhido)
  return escolhido
}

/** O indice para conferir citacao, sem travar a aprovacao se o episodio sumiu do disco. */
function indiceParaConferir(r: RascunhoDoRecap): EpisodeIndex | undefined {
  try {
    return indiceDoRascunho(r).indice
  } catch {
    return undefined
  }
}

/** aplicarEdicao + marcarAprovado (com o indice, para conferir a citacao) + gravar. */
export async function aprovarRoteiro(rascunhoId: string, roteiro: Roteiro): Promise<RascunhoDoRecap> {
  const r = lerRascunhoDoDisco(rascunhoId)
  if (!roteiroAtual(r)) throw new Error('Nao ha roteiro para aprovar.')
  const quando = agora()
  const editado = aplicarEdicao(r, roteiro, quando)
  const aprovado = marcarAprovado(editado, quando, indiceParaConferir(editado))
  gravarRascunho(aprovado)
  // "Aprender com as minhas edicoes" (estilo.ts): extra, nunca derruba a aprovacao.
  aprenderDoAprovado(aprovado)
  return aprovado
}

/** desmarcarAprovado + gravar. */
export async function desaprovarRoteiro(rascunhoId: string): Promise<RascunhoDoRecap> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const desfeito = desmarcarAprovado(r, agora())
  if (desfeito !== r) gravarRascunho(desfeito)
  return desfeito
}
