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
import { palavrasDaFrase, type PalavraComTempo } from '../../shared/voz'
import {
  apelidosDoIndice,
  citadosNoTexto,
  comOGrupo,
  elencoDoEpisodio,
  falantesDe,
  fichasFortes,
  mesmoNome,
  generosDoRoteiro,
  prepararPlanos,
  protagonistaDoRoteiro,
  quemOMomentoCita,
  type Citado,
  type Elenco,
} from '../cenas/casar'

export { protagonistaDoRoteiro, quemOMomentoCita }
import type {
  ClipeDoRecap as SobreposicaoSalva,
  SecaoNoTempo as SecaoDoStudio,
  TrilhaDoRecap as TrechoDeAudioSalvo,
} from '../../shared/projeto-do-recap'
import type { Evento, Roteiro } from '../../shared/roteiro'
import { configDoRecap } from '../contexto'
import { registrarMusicaUsada } from '../som/musicas'
import { planejarSom } from '../som/planejar'
import { focosDosPedacos, trechosParaFocar } from './foco'
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
 * (4a rodada) O texto que SOA ENQUANTO o pedaco toca: as palavras da frase no
 * take com o meio em [inicio, fim). null = sem palavras com tempo (ou nenhuma
 * no pedaco): vale o texto da cena.
 */
export function textoDoMomento(
  p: { fraseId: string; inicio?: number; fim?: number },
  palavras: readonly Pick<PalavraComTempo, 'texto' | 'start' | 'end' | 'fraseId'>[],
): string | null {
  if (p.inicio === undefined || p.fim === undefined || palavras.length === 0) return null
  const ditas = palavras.filter((w) => {
    if (w.fraseId !== p.fraseId) return false
    const meio = (w.start + w.end) / 2
    return meio >= p.inicio! - 1e-6 && meio < p.fim!
  })
  return ditas.length > 0 ? ditas.map((w) => w.texto).join(' ') : null
}

/**
 * QUEM CADA PEDACO DEVE ENQUADRAR (19/10, reescrito com o teste real do MRM
 * E02: a fadinha saia do quadro em "junto da fadinha MP" e "Ela ativou...", e
 * "O Guy" mostrava a Misa). A ordem de preferencia de cada pedaco:
 *   1. quem o TEXTO DO PEDACO cita ("a fadinha MP" -> Empee, pelo apelido da
 *      legenda: apelidosDoIndice), na ordem em que aparece;
 *   2. sem nome, o sujeito herdado ("Ela ativou..." -> a MP da frase de antes),
 *      a mesma regra C4 do casar (quemOMomentoCita);
 *   3. quem FALA no trecho do episodio que o pedaco mostra (a legenda);
 *   4. quem o resto da frase cita e os personagens dos eventos da frase.
 * Antes era so (4), na ordem da confianca do indice no plano. Os nomes saem com
 * a grafia do ROSTO no indice ("MP" -> "Empee", "Senku" -> "Ishigami,
 * Senkuu"), que e a do elenco do motor; sem rosto, como vieram.
 *
 * (4a rodada, a edicao do Levi no Nia E01) Com as `palavras` do take, cada
 * pedaco cita quem e dito ENQUANTO ele toca (numa cena de 3 planos, "O artesao
 * faz uma demonstracao, mas Nia acha o golpe fraco": o artesao nos dois
 * primeiros, a Nia no ultimo), pela retomada ("ela", "a garota", "nela"; sem
 * sujeito antes, a protagonista) e pelo papel: "o artesao", "a criada", "um
 * homem" sao OUTRA pessoa -- o pedaco fica com os outros do evento e quem
 * fala, nunca com o sujeito de antes (quemOMomentoCita).
 */
export function nomesDaMontagem(
  pedacos: readonly (Pick<PedacoDaMontagem, 'fraseId' | 'cena' | 'planoId' | 'arquivo' | 'de' | 'ate'> & Partial<Pick<PedacoDaMontagem, 'inicio' | 'fim'>>)[],
  roteiro: Pick<Roteiro, 'secoes'>,
  eventos: readonly Pick<Evento, 'id' | 'personagens'>[],
  indice: Pick<EpisodeIndex, 'planos' | 'cues' | 'exclusoes'>,
  escolhas: readonly Pick<EscolhaDaFrase, 'fraseId' | 'cenas'>[],
  /** (4a rodada) As palavras do take com tempo (TakeDaVoz.palavras). Vazio = o texto da cena inteira. */
  palavras: readonly Pick<PalavraComTempo, 'texto' | 'start' | 'end' | 'fraseId'>[] = [],
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

  const frases = roteiro.secoes.flatMap((sec) => sec.frases)
  const porFrase = new Map<string, string[]>()
  const restoDaFrase = new Map<string, string[]>()
  /** (4a rodada) Os personagens dos eventos da frase (com o nome do rosto): os "outros" de um papel. */
  const doEventoDaFrase = new Map<string, string[]>()
  /** (4a rodada) O sujeito ANTES de cada frase (o da frase de antes): o comeco da cadeia dos pedacos. */
  const sujeitoAntes = new Map<string, Citado[]>()
  /** (4a rodada) O texto de cada cena (pelas palavras de inicio), quando o pedaco nao tem palavras com tempo. */
  const textoDaCena = new Map<string, string[]>()
  /** (3a rodada) Quem a intencao visual da frase poe na tela ("Lent olhando o numero no pergaminho"). */
  const intencaoDaFrase = new Map<string, string[]>()
  const escolhaDe = new Map(escolhas.map((e) => [e.fraseId, e]))
  // (4a rodada) A protagonista: a retomada sem sujeito antes ("Essa garotinha...", a 1a frase).
  const protagonista = protagonistaDoRoteiro(frases.map((f) => f.texto), elencoDoEp)
  // (E03) O genero pelo artigo ("a Nia"): "a garota" depois do Anzel e a protagonista.
  const generos = generosDoRoteiro(frases.map((f) => f.texto), elencoDoEp)
  // O sujeito para a frase seguinte e o da frase INTEIRA (como o casar): "O poder do Lent ... junto da
  // fadinha MP. E ... ele descobre" -- o "ele" e o Lent, o 1o citado, nao o ultimo pedaco.
  let sujeito: Citado[] = []
  for (const frase of frases) {
    const doEvento = personagensDaFrase(frase, eventos).map(resolver)
    const tokens = palavrasDaFrase(frase.texto)
    const inicios = (escolhaDe.get(frase.id)?.cenas ?? []).map((c) => c.palavraInicio)
    const cortes = inicios.length > 0 ? inicios : [0]
    // (3a rodada) "o trio", "os parceiros": os rostos do grupo entram depois de quem o texto cita.
    const daFrase = quemOMomentoCita(frase.texto, sujeito, protagonista, elencoDoEp, generos).citados
    sujeitoAntes.set(frase.id, sujeito)
    textoDaCena.set(frase.id, cortes.map((p0, k) => tokens.slice(p0, cortes[k + 1] ?? tokens.length).join(' ')))
    sujeito = daFrase
    const resto = [...daFrase.map(doCitado), ...doEvento]
    porFrase.set(frase.id, unicos(resto))
    restoDaFrase.set(frase.id, resto)
    doEventoDaFrase.set(frase.id, doEvento)
    intencaoDaFrase.set(frase.id, citadosNoTexto(frase.intencaoVisual ?? '', elencoDoEp).map(doCitado))
  }

  // (4a rodada) Quem cada pedaco cita: o momento dele, na ordem em que tocam (a cadeia do sujeito).
  const ordem = new Map(frases.map((f, i) => [f.id, i]))
  const emOrdem = [...pedacos].sort((a, b) => (ordem.get(a.fraseId) ?? 0) - (ordem.get(b.fraseId) ?? 0) || a.cena - b.cena || (a.inicio ?? 0) - (b.inicio ?? 0))
  type Momento = { citados: Citado[]; outro: boolean; excluir: Citado[] }
  const momentoDe = new Map<(typeof pedacos)[number], Momento>()
  let fraseAtual: string | null = null
  let sujeitoK: Citado[] = []
  let anterior: Momento | null = null
  for (const p of emOrdem) {
    if (p.fraseId !== fraseAtual) {
      fraseAtual = p.fraseId
      sujeitoK = sujeitoAntes.get(p.fraseId) ?? []
      anterior = null
    }
    const texto = textoDoMomento(p, palavras) ?? textoDaCena.get(p.fraseId)?.[p.cena] ?? ''
    const m = quemOMomentoCita(texto, sujeitoK, protagonista, elencoDoEp, generos)
    // Sem ninguem no momento, no meio da frase: a oracao continua (o momento de antes).
    const este: Momento = !m.referente && anterior ? anterior : { citados: m.citados, outro: m.outro, excluir: [...sujeitoK, ...(protagonista ? [protagonista] : [])] }
    momentoDe.set(p, este)
    anterior = este
    if (!m.outro && m.citados.length > 0) sujeitoK = m.citados
  }

  const porPedaco = new Map<string, string[]>()
  for (const p of pedacos) {
    const m = momentoDe.get(p) ?? { citados: [], outro: false, excluir: [] }
    const proprios = m.citados.map(doCitado)
    const quemFala = falante(p)
    if (m.outro) {
      // Um PAPEL ("O artesao faz", "A criada percebe"): os outros do evento e quem fala, nunca o sujeito
      // de antes nem a protagonista -- sem citado, o recorte fica com o maior rosto visivel.
      const deFora = m.excluir.map((c) => c.ficha)
      const ehDeFora = (n: string): boolean => {
        const f = fichasFortes(n, elencoDoEp.proprios)
        return f.length > 0 && deFora.some((x) => mesmoNome(f, [x]))
      }
      const outros = (doEventoDaFrase.get(p.fraseId) ?? []).filter((n) => !ehDeFora(n))
      porPedaco.set(chaveDoPedaco(p), unicos([...proprios, ...outros, ...(quemFala && !ehDeFora(quemFala) ? [quemFala] : [])]))
      continue
    }
    const resto = restoDaFrase.get(p.fraseId) ?? []
    // Quem fala desempata entre os citados do pedaco (os dois nao cabem: o que fala); sem citado,
    // so entra no fim (o personagem do evento vem antes: o "ele" sem antecedente e o protagonista).
    const fala = quemFala ? fichasFortes(quemFala, elencoDoEp.proprios) : []
    const falaCitado = fala.length > 0 && proprios.some((n) => mesmoNome(fichasFortes(n, elencoDoEp.proprios), fala))
    // (3a rodada) Ninguem que o pedaco cita esta no plano ("A taxa consome a regeneracao do trio" sobre
    // o Lent e a fadinha explicando): quem FALA no plano vem primeiro -- o recorte mira quem explica, e
    // nao o maior rosto.
    const doPlano = planos.get(p.planoId)?.personagens.map((x) => fichasFortes(x.nome, elencoDoEp.proprios)) ?? []
    const noPlano = (n: string): boolean => {
      const f = fichasFortes(n, elencoDoEp.proprios)
      return f.length > 0 && doPlano.some((x) => mesmoNome(x, f))
    }
    // Antes de quem fala, quem a intencao visual da frase poe na tela, se esta no plano ("Lent olhando o
    // numero gigantesco no pergaminho": o Lent, mesmo com a fadinha falando).
    const daIntencao = (intencaoDaFrase.get(p.fraseId) ?? []).filter(noPlano)
    const ninguem = !proprios.some(noPlano)
    const explica = ninguem && (daIntencao.length > 0 || (!!quemFala && noPlano(quemFala)))
    const nomes = falaCitado
      ? [quemFala!, ...proprios, ...resto]
      : explica
        ? [...daIntencao, ...(quemFala && noPlano(quemFala) ? [quemFala] : []), ...proprios, ...resto]
        : [...proprios, ...resto, ...(quemFala ? [quemFala] : [])]
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
  /**
   * (rodada 4) Quem cada FRASE cita, na ordem (NomesDaMontagem.porFrase): as
   * metades do grid enquadram por ela -- em cima o que a frase fala primeiro,
   * como a ordem das metades (shared/grid.ts), e nao o que o pedaco cita.
   */
  porFrase?: ReadonlyMap<string, string[]>,
): Promise<{ focos: Map<string, FocoDoPedaco>; lote: RostosDoLote | null; avisos: string[] }> {
  const unicos = new Map<string, PedidoDeRosto>()
  const pedir = (arquivo: string, de: number, dura: number, nomes: string[], metade: boolean): void => {
    const chave = chaveDoPedidoDeRosto(arquivo, de, metade)
    if (unicos.has(chave)) return
    // O trecho que o bloco TOCA do mp4: de `de` ate `de` + o tempo do bloco.
    unicos.set(chave, { chave, arquivo, de, ate: de + dura, personagens: nomes, ...(metade ? { metade: true } : {}) })
  }
  for (const p of pedacos) {
    const dura = Math.max(p.fim - p.inicio, 0)
    const nomes = personagens.get(chaveDoPedaco(p)) ?? []
    if (p.baixo) {
      // (rodada 4) O grid: as duas metades, cada uma na janela dela (9:8). Em cima, quem
      // a frase cita primeiro; embaixo, o mesmo elenco com o primeiro por ultimo.
      const daFrase = porFrase?.get(p.fraseId) ?? nomes
      pedir(p.arquivo, p.de, dura, daFrase, true)
      pedir(p.baixo.arquivo, p.baixo.de, dura, [...daFrase.slice(1), ...daFrase.slice(0, 1)], true)
    } else {
      pedir(p.arquivo, p.de, dura, nomes, false)
    }
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
    const focos = await focosDosPedacos(trechosParaFocar(pedacos), tetoMs).catch(() => new Map<string, FocoDoPedaco>())
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
  e: {
    duracaoSec: number
    cortes: readonly number[]
    secoes: readonly SecaoDoStudio[]
    vozPath?: string | null
    /** A fala no tempo do video: o som do tema (espada, soco...) da virada. */
    palavras?: readonly { t: number; texto: string }[]
  },
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
      palavras: (e.palavras ?? []).slice(0, 50000).map((p) => ({ t: Math.max(p.t, 0), texto: p.texto.slice(0, 200) })),
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
    riser: sfx.filter((s) => s.tipo === 'riser').length,
    tema: sfx.filter((s) => s.tipo === 'tema').length,
    musica: e.plano?.musica ? nomeDoCaminho(e.plano.musica.arquivo) : null,
    musicas: (e.plano?.musicas ?? []).map((m) => `${nomeDoCaminho(m.arquivo).replace(/\.[^.]+$/, '')}${m.clima ? ` (${m.clima})` : ''}`),
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
