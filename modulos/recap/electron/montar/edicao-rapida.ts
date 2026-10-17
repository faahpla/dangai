import { captionStyleSchema, type CaptionStyle } from '@shared/contract'
import {
  camadaDeCor,
  lookDaCor,
  presetsDeCorConferidos,
  faixasDaEdicaoRapida,
  naFaixaDaEdicaoRapida,
  personagensDaFrase,
  secoesParaSom,
  trilhasDoPlanoDeSom,
  type ConfigDaEdicaoRapida,
  type PlanoDeSom,
  type ResumoDaEdicaoRapida,
  type RostosDoLote,
} from '../../shared/edicao-rapida'
import type { EpisodeIndex } from '../../shared/episodio'
import type {
  ClipeDoRecap as SobreposicaoSalva,
  SecaoNoTempo as SecaoDoStudio,
  TrilhaDoRecap as TrechoDeAudioSalvo,
} from '../../shared/projeto-do-recap'
import type { Evento, Roteiro } from '../../shared/roteiro'
import { configDoRecap } from '../contexto'
import { registrarMusicaUsada } from '../som/musicas'
import { planejarSom } from '../som/planejar'
import { focosDosPedacos } from './foco'
import { chaveDoPedaco, type FocoDoPedaco, type PedacoDaMontagem } from './projeto'

/**
 * A EDICAO RAPIDA DENTRO DO "ABRIR NO EDITOR" (agente C, 14/10): o projeto ja
 * chega com SFX, musica, rosto pelo motor, a legenda no estilo salvo e (15/10)
 * a camada de cor no video inteiro.
 *
 * Mora fora do index.ts para a montagem de sempre continuar legivel: o index
 * so pergunta "com ou sem" e junta os pedacos. Cada parte e MELHOR ESFORCO --
 * falhou (motor fora, pasta de musica vazia, som ainda sem implementar), vira
 * aviso no resumo e o projeto sai do mesmo jeito. Erro aqui nunca impede o
 * Levi de abrir o que ele montou.
 *
 * Nada aqui grava em pasta de musica nem de SFX: o historico de "ja usada"
 * mora no userData (electron/services/som/musicas.ts).
 */

/**
 * O estilo de legenda salvo dele (settings.captionStyle), o mesmo que o Dangai
 * aplica num projeto novo (src/store/estilo-legenda.ts). null = nunca mexeu, ou
 * o JSON nao se le: o projeto fica no padrao de fabrica.
 *
 * [recap] O estilo e do nucleo: vem no pedido da montagem (a tela le das
 * Configuracoes publicas). O modulo nao le o settings do nucleo no main.
 */
export function estiloSalvo(cru: unknown): CaptionStyle | null {
  if (!cru || typeof cru !== 'object') return null
  const lido = captionStyleSchema.safeParse(cru)
  return lido.success ? lido.data : null
}

/**
 * Quem cada pedaco deve enquadrar: os personagens dos eventos que a frase
 * cita (personagensDaFrase), com os que o INDICE reconhece no plano daquele
 * pedaco na frente (pelo `conf` do motor/AnCut). Frase que nao cita ninguem:
 * lista vazia = o maior rosto. Por chaveDoPedaco.
 */
export function personagensDosPedacos(
  pedacos: readonly Pick<PedacoDaMontagem, 'fraseId' | 'planoId' | 'arquivo' | 'de'>[],
  roteiro: Pick<Roteiro, 'secoes'>,
  eventos: readonly Pick<Evento, 'id' | 'personagens'>[],
  indice: Pick<EpisodeIndex, 'planos'>,
): Map<string, string[]> {
  const frases = new Map(roteiro.secoes.flatMap((s) => s.frases).map((f) => [f.id, f]))
  const planos = new Map(indice.planos.map((p) => [p.id, p]))
  const saida = new Map<string, string[]>()
  for (const p of pedacos) {
    const frase = frases.get(p.fraseId)
    const citados = frase ? personagensDaFrase(frase, eventos) : []
    if (citados.length === 0) {
      saida.set(chaveDoPedaco(p), [])
      continue
    }
    const noPlano = new Map((planos.get(p.planoId)?.personagens ?? []).map((x) => [normalizar(x.nome), x.conf]))
    const ordenados = citados
      .map((nome, i) => ({ nome, i, conf: noPlano.get(normalizar(nome)) ?? -1 }))
      .sort((a, b) => b.conf - a.conf || a.i - b.i)
      .map((x) => x.nome.slice(0, 120))
      .slice(0, 20)
    saida.set(chaveDoPedaco(p), ordenados)
  }
  return saida
}

function normalizar(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * O ROSTO da Edicao rapida. No Studio era o lote do motor (YOLO de rosto de
 * anime, preferindo quem a frase cita). [recap] O motor chega na parte 4: ate
 * la, o detector ANTIGO do nucleo (o mesmo do Studio sem motor), e o resumo
 * diz "(antigo)". `personagens` fica no contrato para o motor.
 */
export async function rostosDaMontagem(
  pedacos: readonly PedacoDaMontagem[],
  _personagens: ReadonlyMap<string, string[]>,
  _episodioId: string,
  tetoMs?: number,
): Promise<{ focos: Map<string, FocoDoPedaco>; lote: RostosDoLote | null; avisos: string[] }> {
  try {
    return { focos: await focosDosPedacos(pedacos, tetoMs), lote: null, avisos: [] }
  } catch (err) {
    return { focos: new Map(), lote: null, avisos: [`Sem rosto: ${mensagem(err)}`] }
  }
}

/**
 * O SOM da Edicao rapida na montagem: planejarSom (agente A) com os cortes
 * dos blocos e as partes do roteiro, e o plano vira trilhas por papel
 * (trilhasDoPlanoDeSom). Projeto novo: nenhuma trilha dele, entao as faixas
 * comecam na 0 e seguem so pelos papeis que entram (musica, whoosh, impacto).
 * A narracao (vozPath) nivela cada SFX tambem pela voz daquele instante.
 */
export async function somDaMontagem(
  config: Pick<ConfigDaEdicaoRapida, 'sfx' | 'musica'>,
  e: { duracaoSec: number; cortes: readonly number[]; secoes: readonly SecaoDoStudio[]; vozPath?: string | null },
): Promise<{ trilhas: TrechoDeAudioSalvo[]; plano: PlanoDeSom | null; avisos: string[] }> {
  if (!config.sfx && !config.musica) return { trilhas: [], plano: null, avisos: [] }
  try {
    const plano = await planejarSom({
      sfx: config.sfx,
      musica: config.musica,
      duracaoSec: e.duracaoSec,
      cortes: [...new Set(e.cortes)].sort((a, b) => a - b),
      secoes: secoesParaSom({ studio: { secoes: e.secoes }, duracaoSec: e.duracaoSec }),
      evitarMusicas: [],
      musicaForcada: null,
      vozPath: e.vozPath ?? null,
    })
    // Projeto novo: so os papeis que entram ganham faixa (sem whoosh, o
    // impacto fica logo abaixo da musica).
    const trilhas = naFaixaDaEdicaoRapida(
      [],
      trilhasDoPlanoDeSom(plano, {
        duracaoSec: e.duracaoSec,
        faixas: faixasDaEdicaoRapida([]),
        prefixoId: `er-${Date.now().toString(36)}`,
      }),
    )
    // O main ja diz por que nao ha musica (pasta vazia, sumida, sem pasta).
    return { trilhas, plano, avisos: [...plano.avisos] }
  } catch (err) {
    return { trilhas: [], plano: null, avisos: [`Sem som: ${mensagem(err)}`] }
  }
}

/**
 * A COR da Edicao rapida na montagem: a camada de ajuste no video inteiro, na
 * faixa de video 1 (projeto novo: nenhum clipe dele), com o look das
 * Configuracoes -- o Anime vivo ou o preset de cor salvo (settings.presetsDeCor).
 * Ler as settings falhou: o Anime vivo, com aviso. Nunca impede a montagem.
 */
export function corDaMontagem(
  duracaoSec: number,
  presetsDoNucleo: readonly unknown[],
): {
  camada: SobreposicaoSalva | null
  nome: string | null
  /** O preset escolhido que nao existe mais (o resumo diz na linha da Cor). */
  sumiu: string | null
  avisos: string[]
} {
  if (!(duracaoSec > 0)) return { camada: null, nome: null, sumiu: null, avisos: [] }
  let corPreset: string | null = null
  let presets: ReturnType<typeof presetsDeCorConferidos> = []
  const avisos: string[] = []
  try {
    // [recap] O preset escolhido e do modulo; os presets de cor sao do nucleo (vem no pedido).
    corPreset = configDoRecap().edicaoRapidaPadrao.corPreset
    presets = presetsDeCorConferidos(presetsDoNucleo)
  } catch (err) {
    avisos.push(`Cor no Anime vivo (sem ler as Configuracoes: ${mensagem(err)})`)
  }
  const look = lookDaCor(corPreset, presets)
  const camada = camadaDeCor({ cor: look.cor, nome: look.nome, duracaoSec, faixa: 0, id: `er-cor-${Date.now().toString(36)}` })
  return { camada, nome: look.nome, sumiu: look.sumiu, avisos }
}

/**
 * Depois de GRAVAR o projeto: a musica entra no historico (sem repetir no
 * proximo short). Falhar so perde o "sem repetir" desta vez.
 */
export async function registrarAMusica(plano: PlanoDeSom | null, projetoPath: string): Promise<string[]> {
  if (!plano?.musica) return []
  try {
    await registrarMusicaUsada(plano.musica.arquivo, projetoPath)
    return []
  } catch (err) {
    return [`A musica nao entrou no historico: ${mensagem(err)}`]
  }
}

/** O recado do que a Edicao rapida fez (ProjetoMontado.edicaoRapida). */
export function resumoDaMontagem(e: {
  config: ConfigDaEdicaoRapida
  plano: PlanoDeSom | null
  lote: RostosDoLote | null
  focos: ReadonlyMap<string, FocoDoPedaco>
  pedacos: readonly Pick<PedacoDaMontagem, 'arquivo' | 'de'>[]
  /** O rosto da Edicao rapida rodou (os testes pulam rosto: ai o resumo diz null). */
  rostoRodou: boolean
  legenda: boolean
  /** O look da camada de cor posta. null/ausente = sem cor. */
  cor?: string | null
  /** O preset de cor escolhido que nao existe mais (entrou o Anime vivo). */
  corPresetSumiu?: string | null
  avisos: readonly string[]
}): ResumoDaEdicaoRapida {
  const sfx = e.plano?.sfx ?? []
  const total = new Set(e.pedacos.map((p) => chaveDoPedaco(p))).size
  return {
    config: e.config,
    whoosh: sfx.filter((s) => s.tipo === 'whoosh').length,
    impacto: sfx.filter((s) => s.tipo === 'impacto').length,
    musica: e.plano?.musica ? nomeDoCaminho(e.plano.musica.arquivo) : null,
    rostos: e.rostoRodou
      ? e.lote
        ? { comRosto: e.lote.comRosto, total: e.lote.total, fonte: e.lote.fonte }
        : { comRosto: [...e.focos.values()].filter((f) => f.focusAuto).length, total, fonte: 'lbp' }
      : null,
    legenda: e.legenda,
    cor: e.cor ?? null,
    corPresetSumiu: e.cor ? (e.corPresetSumiu ?? null) : null,
    avisos: [...new Set(e.avisos)],
  }
}

function nomeDoCaminho(caminho: string): string {
  const partes = caminho.split(/[\\/]/)
  return partes[partes.length - 1] ?? caminho
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
