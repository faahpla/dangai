import { captionStyleSchema, type CaptionStyle } from '@shared/contract'
import {
  camadaDeCor,
  chaveDoPedidoDeRosto,
  lookDaCor,
  presetsDeCorConferidos,
  faixasDaEdicaoRapida,
  naFaixaDaEdicaoRapida,
  personagensDaFrase,
  secoesParaSom,
  trilhasDoPlanoDeSom,
  type ConfigDaEdicaoRapida,
  type PedidoDeRosto,
  type PlanoDeSom,
  type ResumoDaEdicaoRapida,
  type RostosDoLote,
} from '../../shared/edicao-rapida'
import type { EpisodeIndex } from '../../shared/episodio'
import type { EscolhaDaFrase } from '../../shared/cenas'
import { palavrasDaFrase } from '../../shared/voz'
import {
  apelidosDoIndice,
  citadosNoTexto,
  elencoDoEpisodio,
  falantesDe,
  fichasFortes,
  mesmoNome,
  prepararPlanos,
  sujeitoHerdado,
  type Citado,
} from '../cenas/casar'
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
import { rostosDosPedacos } from './rostos-motor'

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

/** O que a montagem sabe de QUEM cada pedaco mostra (nomesDaMontagem). */
export interface NomesDaMontagem {
  /** chaveDoPedaco -> quem o pedaco cita, em ordem de preferencia (com o nome do rosto no indice). */
  porPedaco: Map<string, string[]>
  /** fraseId -> quem a frase cita, na mesma ordem (`studio.secoes`: a Edicao rapida do editor le). */
  porFrase: Map<string, string[]>
  /** Quem o roteiro cita no video inteiro (o conjunto fechado do motor, com o elenco principal). */
  elenco: string[]
}

/** Quantos nomes por pedaco (o pedido de rosto aceita 20). */
const NOMES_MAX = 20

/**
 * QUEM CADA PEDACO DEVE ENQUADRAR (19/10, reescrito com o teste real do MRM
 * E02: a fadinha saia do quadro em "junto da fadinha MP" e "Ela ativou...", e
 * "O Guy" mostrava a Misa). A ordem de preferencia de cada pedaco:
 *   1. quem o TEXTO DO PEDACO cita ("a fadinha MP" -> Empee, pelo apelido da
 *      legenda: apelidosDoIndice), na ordem em que aparece;
 *   2. sem nome, o sujeito herdado ("Ela ativou..." -> a MP da frase de antes),
 *      a mesma regra C4 do casar (sujeitoHerdado);
 *   3. quem FALA no trecho do episodio que o pedaco mostra (a legenda);
 *   4. quem o resto da frase cita e os personagens dos eventos da frase.
 * Antes era so (4), na ordem da confianca do indice no plano. Os nomes saem com
 * a grafia do ROSTO no indice ("MP" -> "Empee", "Senku" -> "Ishigami,
 * Senkuu"), que e a do elenco do motor; sem rosto, como vieram.
 */
export function nomesDaMontagem(
  pedacos: readonly Pick<PedacoDaMontagem, 'fraseId' | 'cena' | 'planoId' | 'arquivo' | 'de' | 'ate'>[],
  roteiro: Pick<Roteiro, 'secoes'>,
  eventos: readonly Pick<Evento, 'id' | 'personagens'>[],
  indice: Pick<EpisodeIndex, 'planos' | 'cues' | 'exclusoes'>,
  escolhas: readonly Pick<EscolhaDaFrase, 'fraseId' | 'cenas'>[],
): NomesDaMontagem {
  const todos = prepararPlanos(indice)
  const elencoDoEp = elencoDoEpisodio(todos, indice, eventos)
  const apelidos = apelidosDoIndice(indice)
  // Os rostos do indice, do que mais aparece ao que menos (o nome que o motor conhece).
  const contagem = new Map<string, number>()
  for (const p of indice.planos) for (const x of p.personagens) contagem.set(x.nome, (contagem.get(x.nome) ?? 0) + 1)
  const rostos = [...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => ({ nome: n, fichas: fichasFortes(n, elencoDoEp.proprios) }))
  const doRosto = (fichas: readonly string[]): string | null => (fichas.length > 0 ? (rostos.find((r) => mesmoNome(r.fichas, fichas))?.nome ?? null) : null)
  const resolver = (nome: string): string => {
    const limpo = nome.trim()
    const apelido = apelidos.get(limpo)
    if (apelido) return apelido
    return doRosto(fichasFortes(limpo, elencoDoEp.proprios)) ?? limpo
  }
  const doCitado = (c: Citado): string => doRosto([c.ficha]) ?? c.rotulo
  const unicos = (nomes: readonly string[]): string[] => {
    const saida: string[] = []
    for (const n of nomes) {
      const f = fichasFortes(n, elencoDoEp.proprios)
      if (!n.trim() || saida.some((x) => x === n || (f.length > 0 && mesmoNome(fichasFortes(x, elencoDoEp.proprios), f)))) continue
      saida.push(n.slice(0, 120))
    }
    return saida.slice(0, NOMES_MAX)
  }

  // Quem fala no trecho do episodio que o pedaco mostra (a fala que mais cobre o trecho).
  const planos = new Map(indice.planos.map((p) => [p.id, p]))
  const falante = (p: Pick<PedacoDaMontagem, 'planoId' | 'de' | 'ate'>): string | null => {
    const plano = planos.get(p.planoId)
    if (!plano) return null
    const base = plano.inicioNoArquivo ?? 0
    const de = plano.start + (p.de - base)
    const ate = plano.start + (p.ate - base)
    let melhor: { nome: string; cobre: number } | null = null
    for (const c of indice.cues) {
      if (c.tipo !== 'fala' || !c.falante) continue
      const cobre = Math.min(ate, c.end) - Math.max(de, c.start)
      if (cobre > 0.1 && (!melhor || cobre > melhor.cobre)) melhor = { nome: falantesDe(c.falante)[0] ?? c.falante, cobre }
    }
    return melhor ? resolver(melhor.nome) : null
  }

  const porFrase = new Map<string, string[]>()
  const porPedacoDaFrase = new Map<string, string[][]>()
  const restoDaFrase = new Map<string, string[]>()
  const escolhaDe = new Map(escolhas.map((e) => [e.fraseId, e]))
  // O sujeito para a frase seguinte e o da frase INTEIRA (como o casar): "O poder do Lent ... junto da
  // fadinha MP. E ... ele descobre" -- o "ele" e o Lent, o 1o citado, nao o ultimo pedaco.
  let sujeito: Citado[] = []
  for (const frase of roteiro.secoes.flatMap((sec) => sec.frases)) {
    const doEvento = personagensDaFrase(frase, eventos).map(resolver)
    const tokens = palavrasDaFrase(frase.texto)
    const inicios = (escolhaDe.get(frase.id)?.cenas ?? []).map((c) => c.palavraInicio)
    const cortes = inicios.length > 0 ? inicios : [0]
    const ditosNaFrase = citadosNoTexto(frase.texto, elencoDoEp)
    const daFrase = ditosNaFrase.length > 0 ? ditosNaFrase : sujeitoHerdado(frase.texto, sujeito)
    let sujeitoK = sujeito
    const pedacosDaFrase = cortes.map((p0, k) => {
      const texto = tokens.slice(p0, cortes[k + 1] ?? tokens.length).join(' ')
      const ditos = citadosNoTexto(texto, elencoDoEp)
      const citados = ditos.length > 0 ? ditos : sujeitoHerdado(texto, sujeitoK)
      if (citados.length > 0) sujeitoK = citados
      return citados.map(doCitado)
    })
    sujeito = daFrase
    const resto = [...daFrase.map(doCitado), ...doEvento]
    porFrase.set(frase.id, unicos(resto))
    porPedacoDaFrase.set(frase.id, pedacosDaFrase)
    restoDaFrase.set(frase.id, resto)
  }

  const porPedaco = new Map<string, string[]>()
  for (const p of pedacos) {
    const proprios = porPedacoDaFrase.get(p.fraseId)?.[p.cena] ?? []
    const resto = restoDaFrase.get(p.fraseId) ?? []
    const quemFala = falante(p)
    // Quem fala desempata entre os citados do pedaco (os dois nao cabem: o que fala); sem citado,
    // so entra no fim (o personagem do evento vem antes: o "ele" sem antecedente e o protagonista).
    const fala = quemFala ? fichasFortes(quemFala, elencoDoEp.proprios) : []
    const falaCitado = fala.length > 0 && proprios.some((n) => mesmoNome(fichasFortes(n, elencoDoEp.proprios), fala))
    const nomes = falaCitado ? [quemFala!, ...proprios, ...resto] : [...proprios, ...resto, ...(quemFala ? [quemFala] : [])]
    porPedaco.set(chaveDoPedaco(p), unicos(nomes))
  }
  const elenco = unicos([...porFrase.values()].flat())
  return { porPedaco, porFrase, elenco }
}

/**
 * O ROSTO da Edicao rapida: o lote inteiro pelo rostosDosPedacos (o motor,
 * YOLO de rosto de anime preferindo quem a frase cita; sem motor, ele mesmo
 * cai no detector antigo do nucleo). Se ate o lote lancar, cai aqui no
 * focosDosPedacos de sempre -- o projeto nunca sai pior que a montagem sem a
 * Edicao rapida. [recap] Parte 4: o mesmo do Studio.
 */
export async function rostosDaMontagem(
  pedacos: readonly PedacoDaMontagem[],
  personagens: ReadonlyMap<string, string[]>,
  episodioId: string,
  tetoMs?: number,
  /** Quem o roteiro cita no video inteiro (NomesDaMontagem.elenco). */
  elenco: readonly string[] = [],
): Promise<{ focos: Map<string, FocoDoPedaco>; lote: RostosDoLote | null; avisos: string[] }> {
  const unicos = new Map<string, PedidoDeRosto>()
  for (const p of pedacos) {
    const chave = chaveDoPedaco(p)
    if (unicos.has(chave)) continue
    unicos.set(chave, {
      chave: chaveDoPedidoDeRosto(p.arquivo, p.de),
      arquivo: p.arquivo,
      de: p.de,
      // O trecho que o bloco TOCA do mp4: de `de` ate `de` + o tempo do bloco.
      ate: p.de + Math.max(p.fim - p.inicio, 0),
      personagens: personagens.get(chave) ?? [],
    })
  }
  const pedidos = [...unicos.values()]
  try {
    const lote = await rostosDosPedacos({
      pedidos,
      formato: 'short',
      episodioId: /^ep_[0-9a-f]{40}$/.test(episodioId) ? episodioId : null,
      tetoMs: tetoMs ?? 120_000,
      motor: true,
      elenco: elenco.map((n) => n.slice(0, 120)).slice(0, 40),
    })
    const focos = new Map<string, FocoDoPedaco>()
    for (const f of lote.focos) {
      if (f.fonte === null) continue
      focos.set(f.chave, { focusX: f.focusX, focusY: f.focusY, focusAuto: f.focusAuto })
    }
    return { focos, lote, avisos: lote.avisos }
  } catch (err) {
    const focos = await focosDosPedacos(pedacos, tetoMs).catch(() => new Map<string, FocoDoPedaco>())
    return { focos, lote: null, avisos: [`Rosto pelo detector antigo: ${mensagem(err)}`] }
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
