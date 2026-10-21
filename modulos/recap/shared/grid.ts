import { buildCaptions } from '@shared/legendas'
import { REGRAS_DA_LEGENDA_PADRAO, type RegrasDaLegenda, type Transcript } from '@shared/contract'
import type { EpisodeIndex, Plano } from './episodio'
import type { PapelDaSecao, Roteiro } from './roteiro'
import { hashDoTexto, palavrasDaFrase, type TakeDaVoz } from './voz'
import {
  duracaoDaFrase,
  inicioDaPalavra,
  temGrid,
  temposDasCenas,
  TOLERANCIA_DE_DURACAO_SEC,
  type CandidatoDeCena,
  type CenaDaFrase,
  type EscolhaDaFrase,
} from './cenas'
import { limitesNaturais, pareceVerbo } from './divisao'
import { medidasDoQuadro } from './recorte'

/**
 * [recap] O GRID (rodada 4, pedido do Levi em 19/10): "no estilo Kiumaz,
 * quando DUAS cenas sao boas para a mesma frase, ele poe as duas empilhadas,
 * uma em cima e outra embaixo, em vez de escolher uma". O nucleo ja desenha
 * a tela dividida (Scene.imageIndexB, cada metade em 1080x960); aqui mora a
 * DECISAO, um passo separado DEPOIS da escolha das cenas (o casar nao sabe
 * que o grid existe). Puro: o servico (electron/cenas/grid.ts) junta os
 * sinais e grava; a montagem le `cenas[k].baixo`.
 *
 * O GATILHO (comparacao do Nia E01, _capturas/compara-nia, secao 3):
 *   - as duas cenas tem nota perto (NOTA_PERTO, na mesma escala) e sao cenas
 *     DIFERENTES: outro plano, outro visual (o CLIP dos keyframes: acao e
 *     reacao, ou pessoas diferentes), do mesmo momento do episodio;
 *     reforco quando a frase cita duas pessoas;
 *   - (polimento, o Levi) pessoas DIFERENTES em cada metade, nenhuma em
 *     comum (o MRM E02 f21, o Lent e o Lent; o f12, o Guy nas duas); cada
 *     metade com o seu sujeito legivel, rosto visivel ou o personagem inteiro
 *     e claro, nunca de costas ou sem rosto; bonus para rostos de pessoas
 *     diferentes (o Nia E01 f07, a criada e a Nia) ou rosto + o outro citado
 *     em acao (o MRM E02 f07, o Lent e a fadinha voando): avaliarPar;
 *   - cada metade e UM plano que cobre o bloco inteiro desde o comeco dela,
 *     sem congelar; o bloco tem pelo menos GRID_MIN_SEC;
 *   - comeca e termina na fronteira de um bloco de LEGENDA; o comeco da frase
 *     pode ficar em tela cheia, e o grid entra na palavra do 2o sujeito ou do
 *     conectivo;
 *   - no maximo GRIDS_POR_MINUTO a cada 60 s, nunca seguidas, com pelo menos
 *     TELA_CHEIA_ENTRE_SEC de tela cheia entre elas;
 *   - nunca no GANCHO inteiro (rodada 5: o Nia E01 f02, aos 3,5 s), na
 *     ultima frase, no climax nem em frase com texto de tela; nunca com plano
 *     vetado (close extremo, o anime ja dividindo o quadro, creditos: o
 *     servico diz);
 *   - (rodada 5) a cena que o casar EMENDOU em dois planos tambem vira grid:
 *     os dois planos ao mesmo tempo, ou a 1a parte cheia e o grid no corte da
 *     emenda, com o 2o plano ou uma das primeiras cenas da fita (o Nia E01
 *     f07: a criada cheia, depois a criada sorrindo e a Nia; o MRM E02 f07: o
 *     Lent com o papel, depois o Lent e a fadinha voando). A metade que nao
 *     cobre congela no fim ate CONGELA_MAX_SEC.
 * A ORDEM: em CIMA o que a frase fala primeiro (sujeito/acao), embaixo o que
 * vem depois (reacao/consequencia) -- pelas pessoas citadas, pelo pedaco da
 * frase, e sem isso pela nota (a cena do momento da frase).
 *
 * A frase travada (ele escolheu ou mexeu) e a "Tela cheia" dele nunca ganham
 * grid automatico; o "Grid" do passo 4 poe na mao: ele escolhe a cena de
 * cima e a de baixo (o grid na mao, no fim deste arquivo; a sugestao do app
 * entra embaixo enquanto ele nao escolhe).
 */

// ------------------------------------------------------------------ config

/** "Grid" nas Configuracoes > Cenas. */
export const MODOS_DO_GRID = ['desligado', 'automatico'] as const
export type ModoDoGrid = (typeof MODOS_DO_GRID)[number]
export const MODO_DO_GRID_PADRAO: ModoDoGrid = 'automatico'

/** O modo salvo, conferido (lixo: o padrao). */
export function modoDoGrid(x: unknown): ModoDoGrid {
  return (MODOS_DO_GRID as readonly unknown[]).includes(x) ? (x as ModoDoGrid) : MODO_DO_GRID_PADRAO
}

// ---------------------------------------------------------------- as regras

/** O bloco do grid dura pelo menos isto (s). */
export const GRID_MIN_SEC = 2
/** No maximo tantos grids automaticos a cada 60 s de video. */
export const GRIDS_POR_MINUTO = 3
/** Tela cheia entre dois grids, no minimo (s): nunca seguidas. */
export const TELA_CHEIA_ENTRE_SEC = 5
/**
 * A outra metade vale ate tanto abaixo da cena que o casar escolheu: 4 pontos
 * (a comparacao do Nia E01, notas de 40 a 48), ou 9% da nota quando a escala
 * do episodio e maior (o MRM E02 vai ate 88: 4 pontos ali e um fio de cabelo).
 */
export const NOTA_PERTO = 4
export const NOTA_PERTO_FRACAO = 0.09
/** As duas metades valem pelo menos isto (cena fraca nao vira metade). */
export const NOTA_MIN = 25
/** A cena em tela cheia antes do grid (a frase que comeca cheia) fica pelo menos isto. */
export const PREFIXO_MIN_SEC = 1
/**
 * As duas metades sao do mesmo momento do episodio: no maximo isto entre elas
 * (s). Causa e efeito longe nao; o mesmo confronto, sim (o MRM E02, f12: o Guy
 * humilhando o Lent e o grupo indo embora, 48 s depois).
 */
export const PERTO_NO_EPISODIO_SEC = 60
/**
 * O rosto legivel na metade: pelo menos isto da altura do quadro (a metade
 * mostra a altura inteira do 16:9; 0,2 = ~190 px de rosto). Os pares que o
 * Levi aprovou tem closes (a criada 0,66 e a Nia 0,63 no Nia E01 f07; o Lent
 * 0,60 no MRM E02 f07). Abaixo disto, rosto pequeno num plano aberto: a Nia na
 * cama ao longe (0055, 0,06), o mordomo de longe com a criada de costas
 * (0130, 0,13-0,19). O personagem inteiro sem rosto grande so vale citado e
 * reconhecido (legivel: 'personagem', a fadinha voando no 0105).
 */
export const ROSTO_LEGIVEL = 0.2
/** O bonus do par bom: rostos de pessoas diferentes, ou rosto + o outro citado em acao. */
export const BONUS_DO_PAR = 3
/** O rosto entra na conta de quem e quem (e de quem cabe na janela) com pelo menos isto da altura. */
export const ROSTO_PARA_IDENTIDADE = 0.08
/**
 * Dois recortes de rosto com o CLIP acima disto sao a mesma pessoa. No Nia E01
 * a mesma pessoa deu de 0,79 a 0,93 e pessoas diferentes ate 0,82 (a criada x
 * a Nia, 0,79; o Neal x a Nia, 0,80): o CLIP sozinho nao separa, e por isso a
 * cor do cabelo do etiquetador entra junto (mesmoRosto).
 */
export const MESMO_ROSTO = 0.88

/** As cores de cabelo parecidas que o etiquetador troca entre um plano e outro, numa familia so. */
const FAMILIAS_DO_CABELO: Record<string, string> = {
  'grey hair': 'cinza',
  'white hair': 'cinza',
  'silver hair': 'cinza',
  'black hair': 'escuro',
  'dark green hair': 'escuro',
  'green hair': 'escuro',
  'brown hair': 'castanho',
  'light brown hair': 'castanho',
  'blonde hair': 'loiro',
  'orange hair': 'ruivo',
  'red hair': 'ruivo',
  'pink hair': 'rosa',
  'purple hair': 'roxo',
  'light purple hair': 'roxo',
  'blue hair': 'azul',
  'light blue hair': 'azul',
  'dark blue hair': 'azul',
  'aqua hair': 'azul',
}

/** A familia de uma etiqueta de cor de cabelo ("grey hair" -> "cinza"); null = nao e cor de cabelo. */
export function familiaDoCabelo(etiqueta: string): string | null {
  return FAMILIAS_DO_CABELO[etiqueta.trim().toLowerCase()] ?? null
}
/** A metade (1080x960) mostra esta fracao da largura do 16:9 (63%). */
export const JANELA_DA_METADE = (() => {
  const m = medidasDoQuadro('metade')
  return m.width / m.height / (16 / 9)
})()
/**
 * A metade que nao cobre o bloco congela no ultimo quadro ate isto: o limite
 * do video inteiro (SEGURAR_EM_VEZ_DE_RELANCE_SEC do encaixe, que importa este
 * arquivo; por isso o numero, e nao o import).
 */
export const CONGELA_MAX_SEC = 0.5
/** Na emenda, a outra metade vem das primeiras tantas cenas da fita (as que o casar achou boas). */
export const FITA_DA_EMENDA = 4
/** No grid na mao, o bloco pode ser mais curto, ate isto. */
export const GRID_NA_MAO_MIN_SEC = 1
/** Folga da cobertura: menos que um quadro parado nao se ve. */
const FOLGA_SEC = TOLERANCIA_DE_DURACAO_SEC

/** O limite de grids automaticos do video: GRIDS_POR_MINUTO por minuto, arredondado (pelo menos 1). */
export function limiteDeGrids(duracaoSec: number): number {
  if (!(duracaoSec > 0)) return 0
  return Math.max(1, Math.round((GRIDS_POR_MINUTO * duracaoSec) / 60))
}

// ------------------------------------------------------------- as metades

/** O plano do indice que a metade usa (a metade e sempre UM plano). */
function planoDe(planos: ReadonlyMap<string, Plano>, c: Pick<CandidatoDeCena, 'planoIds'>): Plano | null {
  return planos.get(c.planoIds[0] ?? '') ?? null
}

/**
 * Uma METADE: um plano so do candidato, comecando em `comeco` (segundos do
 * .mkv) ou o mais perto dele que ainda cobre `dura` segundos sem congelar.
 * null = nenhum plano do candidato cobre o bloco sozinho (posto a mao: o primeiro).
 */
export function metadeDoCandidato(
  c: CandidatoDeCena,
  dura: number,
  planos: ReadonlyMap<string, Plano>,
  comeco: number = c.inSec,
  entradas?: ReadonlyMap<string, number>,
): CandidatoDeCena | null {
  // (20/10) Posto a mao ('usuario'), a metade e o plano DELE (o primeiro): o grid nao
  // troca o 0217 de 0,75 s pelo 0218 do "completar". Nao cobre = esta cena nao vira grid.
  const ids = c.origem === 'usuario' ? c.planoIds.slice(0, 1) : c.planoIds
  for (const id of ids) {
    const p = planos.get(id)
    if (!p) continue
    // (rodada 5) Nunca antes da entrada do plano que abre com clarao ou borrao.
    const piso = Math.max(p.start, Math.min(entradas?.get(id) ?? p.start, p.end))
    const inicio = Math.min(Math.max(comeco, piso), p.end)
    const de = p.end - inicio >= dura - FOLGA_SEC ? inicio : p.end - dura
    if (de < piso - 1e-6) continue
    return { ...c, planoIds: [p.id], inSec: de, outSec: Math.min(p.end, de + Math.max(dura, FOLGA_SEC)), keyframe: p.keyframe }
  }
  return null
}

/**
 * O ENCAIXE de uma metade na duracao da cena (o encaixarEscolha chama para as
 * duas metades do grid): um plano so, o comeco escolhido fica e so recua o
 * necessario para cobrir; sem emenda (as duas metades nunca cortam no meio do
 * bloco). `falta` = os segundos que ficam parados no ultimo quadro.
 */
export function encaixarMetade(
  c: CandidatoDeCena,
  precisa: number,
  planos: readonly Plano[] | ReadonlyMap<string, Plano>,
): { candidato: CandidatoDeCena; falta: number } {
  const mapa = planos instanceof Map ? planos : new Map((planos as readonly Plano[]).map((p) => [p.id, p]))
  const p = planoDe(mapa, c)
  if (!p) return { candidato: c, falta: 0 }
  const dura = Math.max(precisa, FOLGA_SEC)
  let de = Math.min(Math.max(c.inSec, p.start), p.end)
  if (p.end - de < dura) de = Math.max(p.start, p.end - dura)
  const ate = Math.max(Math.min(p.end, de + dura), de + FOLGA_SEC)
  return {
    candidato: { ...c, planoIds: [p.id], inSec: de, outSec: ate, keyframe: p.keyframe },
    falta: Math.max(0, dura - (p.end - de)),
  }
}

// -------------------------------------------------------------- as legendas

/**
 * As palavras do take em que um bloco de LEGENDA comeca (indice global em
 * take.palavras), pelo agrupamento do nucleo (buildCaptions) com as regras
 * dadas. O grid so entra e sai nessas palavras.
 */
export function iniciosDosBlocos(take: Pick<TakeDaVoz, 'palavras'>, regras: RegrasDaLegenda = REGRAS_DA_LEGENDA_PADRAO): Set<number> {
  const words = take.palavras.map((p) => ({ text: p.texto, start: p.start, end: Math.max(p.end, p.start) }))
  const transcript: Transcript = { source: 'script', words, segments: [], text: '', cutCandidates: [] }
  const saida = new Set<number>()
  let i = 0
  for (const bloco of buildCaptions(transcript, regras)) {
    saida.add(i)
    i += bloco.words.length
  }
  saida.add(take.palavras.length)
  return saida
}

// ------------------------------------------------------------ onde entra

/** Pessoa: artigo + papel ("a garota", "o artesao", "os pais"), o 2o sujeito da frase. */
const PAPEIS_DE_GENTE = new Set([
  'garota', 'garoto', 'menina', 'menino', 'moca', 'rapaz', 'mulher', 'homem', 'criada', 'empregada', 'mordomo',
  'pai', 'mae', 'pais', 'filho', 'filha', 'irmao', 'irma', 'irmaos', 'artesao', 'ferreiro', 'guerreiro', 'mestre',
  'rei', 'rainha', 'principe', 'princesa', 'nobre', 'velho', 'velha', 'cara', 'sujeito', 'grupo', 'trio', 'dupla',
  'fada', 'fadinha', 'inimigo', 'inimiga', 'monstro', 'chefe', 'lider', 'amigo', 'amiga', 'parceiro', 'parceira',
  'heroi', 'heroina', 'vila', 'vilao', 'equipe', 'time', 'professor', 'professora', 'aluno', 'aluna', 'bruxa', 'mago',
])
const ARTIGOS = new Set(['a', 'o', 'as', 'os'])
const PRONOMES = new Set(['ele', 'ela', 'eles', 'elas'])

function limpo(token: string): string {
  return token
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[^a-z0-9-]/g, '')
}

/**
 * Onde o grid pode ENTRAR no meio de uma cena: o limite natural da frase
 * (virgula, "mas", "quando", "e" com verbo: limitesNaturais) e o 2o sujeito
 * depois do 1o verbo ("A criada percebe como | a garota voltou...", "| ela
 * vira", um nome citado). Indices em palavrasDaFrase.
 */
export function entradasNaturais(texto: string, citados: readonly number[] = []): number[] {
  const tokens = palavrasDaFrase(texto)
  const saida = new Set<number>()
  for (const l of limitesNaturais(tokens)) if (l.forca >= 1) saida.add(l.palavra)
  const primeiroVerbo = tokens.findIndex((t) => pareceVerbo(t))
  if (primeiroVerbo >= 0) {
    for (let j = primeiroVerbo + 1; j < tokens.length; j++) {
      const w = limpo(tokens[j]!)
      const seguinte = limpo(tokens[j + 1] ?? '')
      if (PRONOMES.has(w) || (ARTIGOS.has(w) && PAPEIS_DE_GENTE.has(seguinte)) || citados.includes(j)) saida.add(j)
    }
  }
  return [...saida].filter((j) => j > 0 && j < tokens.length).sort((a, b) => a - b)
}

/** O conectivo de SEQUENCIA ("e depois", "entao"): causa e efeito no tempo nao viram grid de uma frase so. */
const SEQUENCIA = new Set(['e', 'depois', 'entao', 'ate', 'apos', 'logo'])

// ------------------------------------------------------------- a entrada

/** Quem a frase cita e onde (a ordem cima/baixo) e quem cada plano mostra. */
/** Um rosto do detector: o centro, a largura e a altura, em fracao do quadro 16:9. */
export interface RostoDoPlano {
  cx: number
  cy: number
  w: number
  h: number
}

export interface QuemNoGrid {
  /** fraseId -> as pessoas citadas, cada uma na palavra em que aparece (palavrasDaFrase). */
  citados: ReadonlyMap<string, readonly { palavra: number; quem: string }[]>
  /** As pessoas (as mesmas chaves de `citados`) que o plano mostra (rosto ou fala). */
  noPlano: (planoId: string) => ReadonlySet<string>
  /** So as de ROSTO reconhecido no plano (sem a fala). Ausente = as de noPlano. */
  peloRosto?: (planoId: string) => ReadonlySet<string>
}

export interface EntradaDoGrid {
  roteiro: Pick<Roteiro, 'secoes'>
  /** O take aprovado. Sem take (estimativa) nao ha grid automatico: o tempo nao e o de verdade. */
  take: Pick<TakeDaVoz, 'trechos' | 'palavras' | 'duracao'> | null
  indice: Pick<EpisodeIndex, 'planos'>
  /** As escolhas JA ENCAIXADAS no take, na ordem do roteiro. */
  escolhas: readonly EscolhaDaFrase[]
  modo: ModoDoGrid
  /** Plano -> por que nao serve de metade (ASCII: "close extremo", "o anime ja divide"). */
  vetados?: ReadonlyMap<string, string>
  /** As duas metades mostram a MESMA cena (o CLIP dos keyframes). Ausente = so o mesmo plano. */
  mesmaCena?: (a: string, b: string) => boolean
  quem?: QuemNoGrid
  /**
   * Os ROSTOS que o detector do motor achou em cada instante que olhou no
   * plano (a cabeca de costas nao conta), na ordem dos instantes (25, 50 e 75%
   * do plano, os keyframes _0, _1 e _2). Lista vazia = nenhum rosto naquele
   * instante; null = o instante nao abriu. Plano fora do mapa, ou sem o mapa:
   * nao se sabe (o automatico recusa).
   */
  rostos?: ReadonlyMap<string, readonly (readonly RostoDoPlano[] | null)[]>
  /**
   * (sem reconhecimento) O vetor CLIP do recorte de cada rosto do instante de
   * referencia do plano (referenciaDosRostos), na mesma ordem.
   */
  vetoresDosRostos?: ReadonlyMap<string, readonly ArrayLike<number>[]>
  /**
   * (sem reconhecimento) As CORES DE CABELO que o etiquetador ve no plano
   * (familiaDoCabelo: "grey hair" e "white hair" sao a mesma). Ausente = nao
   * se sabe.
   */
  cabelos?: ReadonlyMap<string, ReadonlySet<string>>
  /** Os planos que o etiquetador marca "de costas" (from behind). */
  deCostas?: ReadonlySet<string>
  /**
   * (rodada 5) A ENTRADA de cada plano que abre com clarao ou borrao (o
   * segundo do .mkv em que ele fica bom, entradasDosPlanos): a metade nunca
   * comeca antes.
   */
  entradas?: ReadonlyMap<string, number>
  /** As regras da legenda (os blocos). Ausente = as de fabrica do nucleo. */
  regras?: RegrasDaLegenda
  /** O minimo na tela (config Cenas): o pedaco em tela cheia antes do grid. */
  minimoSec?: number
}

export interface SaidaDoGrid {
  escolhas: EscolhaDaFrase[]
  /** As frases com grid automatico agora, na ordem do roteiro. */
  postos: string[]
  /** As frases que mudaram (a cena de antes voltou, ou o grid entrou): o servico encaixa de novo. */
  mudadas: string[]
  /** A melhor opcao de cada frase que podia ter grid, antes do limite e do espaco (a medicao le). */
  candidatas: { fraseId: string; como: OpcaoDoGrid['como']; nota: number; planos: [string, string]; de: number; ate: number }[]
  avisos: string[]
}

/** Uma opcao de grid numa frase: as cenas novas, onde fica e quanto vale. */
interface OpcaoDoGrid {
  fraseId: string
  cenas: CenaDaFrase[]
  /** O bloco do grid, em segundos do take. */
  de: number
  ate: number
  /** Os planos das duas metades. */
  planos: [string, string]
  nota: number
  /** A cena inteira, no meio da cena, antes do corte do casar, ou os dois pedacos juntos. */
  como: 'cena' | 'meio' | 'antes' | 'pedacos' | 'emenda'
}

interface FraseNoGrid {
  fraseId: string
  texto: string
  papel: PapelDaSecao
  posicao: number
  escolha: EscolhaDaFrase
  /** Inicio do trecho da frase no take (s). */
  offset: number
  /** A 1a palavra da frase em take.palavras. */
  primeiraPalavra: number
  /** A frase tem texto de tela no roteiro: o grid fica de fora (a proposta, 19/10). */
  temTextoDeTela: boolean
}

// ----------------------------------------------------------- utilidades

/** O grid automatico volta para as cenas de antes (para ser decidido de novo). */
export function semGridAutomatico(e: EscolhaDaFrase): EscolhaDaFrase {
  if (!e.grid) return e
  if (e.grid.origem !== 'auto' || e.travada) {
    // Grid sem metade nenhuma (alguem trocou as cenas por baixo): a marca sai.
    if (!temGrid(e)) {
      const sem = { ...e }
      delete sem.grid
      return sem
    }
    return e
  }
  const sem: EscolhaDaFrase = { ...e, cenas: temGrid(e) ? e.grid.antes.map((c) => semMetade(c)) : e.cenas }
  delete sem.grid
  return sem
}

function semMetade(c: CenaDaFrase): CenaDaFrase {
  if (!c.baixo) return c
  const sem = { ...c }
  delete sem.baixo
  return sem
}

/** Todos os planos que as cenas do video usam (as duas metades do grid tambem). */
function planosUsados(escolhas: readonly EscolhaDaFrase[], fora?: string): Set<string> {
  const usados = new Set<string>()
  for (const e of escolhas) {
    if (e.fraseId === fora) continue
    for (const c of e.cenas) for (const id of [...c.candidato.planoIds, ...(c.baixo?.planoIds ?? [])]) usados.add(id)
  }
  return usados
}

function frasesNoGrid(e: Pick<EntradaDoGrid, 'roteiro' | 'take' | 'escolhas'>): FraseNoGrid[] {
  const porId = new Map(e.escolhas.map((x) => [x.fraseId, x]))
  const trechos = new Map((e.take?.trechos ?? []).map((t) => [t.fraseId, t]))
  const primeira = new Map<string, number>()
  ;(e.take?.palavras ?? []).forEach((p, i) => {
    if (!primeira.has(p.fraseId)) primeira.set(p.fraseId, i)
  })
  const saida: FraseNoGrid[] = []
  let posicao = 0
  for (const secao of e.roteiro.secoes) {
    for (const f of secao.frases) {
      const escolha = porId.get(f.id)
      const t = trechos.get(f.id)
      if (escolha && t && t.hashTexto === hashDoTexto(f.texto)) {
        saida.push({
          fraseId: f.id,
          texto: f.texto,
          papel: secao.papel,
          posicao,
          escolha,
          offset: t.offset,
          primeiraPalavra: primeira.get(f.id) ?? -1,
          temTextoDeTela: !!f.textoDeTela?.trim(),
        })
      }
      posicao++
    }
  }
  return saida
}

function totalDeFrases(roteiro: Pick<Roteiro, 'secoes'>): number {
  return roteiro.secoes.reduce((n, s) => n + s.frases.length, 0)
}

/** O candidato e uma sugestao do casar com nota de verdade (a escolhida a mao vem com nota 0). */
function comNota(c: Pick<CandidatoDeCena, 'nota' | 'origem'>): boolean {
  return c.origem !== 'usuario' && c.nota > 0
}

// --------------------------------------------------------------- as opcoes

interface ContextoDaFrase {
  f: FraseNoGrid
  planos: ReadonlyMap<string, Plano>
  e: EntradaDoGrid
  blocos: ReadonlySet<number>
  /** Planos de outras frases (a metade nunca repete um plano do video). */
  usadosFora: ReadonlySet<string>
  forcado: boolean
}

/** O plano serve de metade: nao vetado. */
function vetado(ctx: ContextoDaFrase, c: Pick<CandidatoDeCena, 'planoIds'>): boolean {
  return c.planoIds.some((id) => ctx.e.vetados?.has(id))
}

function mesmaCenaVisual(ctx: ContextoDaFrase, a: string, b: string): boolean {
  return a === b || (ctx.e.mesmaCena?.(a, b) ?? false)
}

/** Quem a frase cita, na ordem do texto, uma vez cada. */
function citadosEmOrdem(ctx: ContextoDaFrase): string[] {
  const saida: string[] = []
  for (const c of [...(ctx.e.quem?.citados.get(ctx.f.fraseId) ?? [])].sort((a, b) => a.palavra - b.palavra)) {
    if (!saida.includes(c.quem)) saida.push(c.quem)
  }
  return saida
}

/** As pessoas que o indice reconhece no plano pelo ROSTO (sem quem.peloRosto: noPlano). */
function reconhecidos(ctx: ContextoDaFrase, planoId: string): ReadonlySet<string> {
  const q = ctx.e.quem
  if (!q) return new Set()
  return q.peloRosto?.(planoId) ?? q.noPlano(planoId)
}

/**
 * O INSTANTE DE REFERENCIA de um plano (o do maior rosto) e os rostos dele que
 * contam para quem e quem e para a janela (pelo menos ROSTO_PARA_IDENTIDADE da
 * altura), na ordem do detector. O servico recorta estes mesmos rostos para o
 * CLIP (vetoresDosRostos). null = nenhum instante olhado.
 */
export function referenciaDosRostos(instantes: readonly (readonly RostoDoPlano[] | null)[]): { instante: number; rostos: RostoDoPlano[] } | null {
  if (!instantes.some((rs) => rs !== null)) return null
  let melhor = { instante: instantes.findIndex((rs) => rs !== null), rostos: [] as RostoDoPlano[] }
  let maior = 0
  for (const [i, rs] of instantes.entries()) {
    const vistos = (rs ?? []).filter((r) => r.h >= ROSTO_PARA_IDENTIDADE - 1e-9)
    const h = Math.max(0, ...vistos.map((r) => r.h))
    if (h > maior) {
      maior = h
      melhor = { instante: i, rostos: vistos }
    }
  }
  return melhor
}

function rostosDeReferencia(ctx: ContextoDaFrase, planoId: string): RostoDoPlano[] | null {
  const instantes = ctx.e.rostos?.get(planoId)
  return instantes ? (referenciaDosRostos(instantes)?.rostos ?? null) : null
}

/**
 * Quantos rostos cabem na janela de 9:8 da metade (63% da largura do 16:9),
 * centrada no maior rosto do instante de referencia. null = sem o detector.
 */
function rostosNaJanela(ctx: ContextoDaFrase, planoId: string): number | null {
  const rs = rostosDeReferencia(ctx, planoId)
  if (!rs) return null
  if (rs.length === 0) return 0
  const maior = [...rs].sort((a, b) => b.h - a.h)[0]!
  const centro = Math.min(Math.max(maior.cx, JANELA_DA_METADE / 2), 1 - JANELA_DA_METADE / 2)
  return rs.filter((r) => Math.abs(r.cx - centro) <= JANELA_DA_METADE / 2).length
}

/**
 * Quem (reconhecido) a metade MOSTRA. A montagem enquadra cada metade em quem
 * a FRASE cita, na ordem (porFrase na Edicao rapida): em cima o 1o citado que
 * o plano tem, embaixo o 2o (a lista girada). Com um rosto so na janela, e so
 * ele: no MRM E02 f07 a fadinha tambem esta no 0096, mas na ponta, fora da
 * janela que enquadra o Lent. Com dois rostos ou mais na janela (o 0102: o
 * Lent e a fadinha lado a lado), todos os reconhecidos do plano. Sem citado
 * da frase no plano: todos os reconhecidos.
 */
function quemAMetadeMostra(ctx: ContextoDaFrase, planoId: string, lado: 'cima' | 'baixo'): ReadonlySet<string> {
  const noPlano = reconhecidos(ctx, planoId)
  if (noPlano.size === 0 || (rostosNaJanela(ctx, planoId) ?? 0) >= 2) return noPlano
  const citados = citadosEmOrdem(ctx)
  const lista = lado === 'cima' ? citados : [...citados.slice(1), ...citados.slice(0, 1)]
  const enquadrado = lista.find((p) => noPlano.has(p))
  return enquadrado !== undefined ? new Set([enquadrado]) : noPlano
}

/**
 * (a) Alguma pessoa reconhecida nas DUAS metades: o grid bom junta pessoas
 * diferentes (o MRM E02 f21, o Lent e o Lent; o f12, o Guy indo embora e o Guy
 * do lado do Lent caido).
 */
function pessoaEmComum(ctx: ContextoDaFrase, cima: string, baixo: string): boolean {
  const b = quemAMetadeMostra(ctx, baixo, 'baixo')
  return [...quemAMetadeMostra(ctx, cima, 'cima')].some((p) => b.has(p))
}

/**
 * (a, sem identidade) Uma pessoa de uma metade PARECE estar na outra. O Nia E01
 * nao tem reconhecimento (0 de 432 planos) e a f11 tinha a Nia nas duas
 * metades. Dois sinais, e basta um:
 *   - a mesma cor de cabelo nos dois planos (o etiquetador: a Nia e cinza, a
 *     criada castanha, o Neal loiro);
 *   - um rosto com o CLIP do recorte acima de MESMO_ROSTO (vetoresDosRostos).
 * null = nao se sabe (rosto sem vetor): no automatico, recusa.
 */
function mesmoRosto(ctx: ContextoDaFrase, cima: string, baixo: string): boolean | null {
  const ca = ctx.e.cabelos?.get(cima)
  const cb = ctx.e.cabelos?.get(baixo)
  if (ca && cb && [...ca].some((c) => cb.has(c))) return true
  const vetores = (id: string): readonly ArrayLike<number>[] | null => {
    const rs = rostosDeReferencia(ctx, id)
    if (!rs) return null
    if (rs.length === 0) return []
    const vs = ctx.e.vetoresDosRostos?.get(id)
    return vs && vs.length >= rs.length ? vs : null
  }
  const a = vetores(cima)
  const b = vetores(baixo)
  if (!a || !b) return null
  return a.some((x) => b.some((y) => cosseno(x, y) >= MESMO_ROSTO))
}

function cosseno(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let p = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    p += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na > 0 && nb > 0 ? p / Math.sqrt(na * nb) : 0
}

/**
 * (b) A metade mostra o seu sujeito LEGIVEL?
 *   - 'rosto': o detector do motor acha um rosto de pelo menos ROSTO_LEGIVEL
 *     da altura do quadro em 2 dos 3 instantes do plano (a cabeca de costas
 *     nao conta), e a metade ABRE com ele: o 1o instante que ela toca tem o
 *     rosto (o 0315 do Nia E01 sobe do vestido ate o rosto da Nia: a metade
 *     passava o 1o segundo no vestido);
 *   - 'personagem': sem esse rosto, o personagem inteiro e claro: o indice
 *     reconhece no plano quem a frase cita, o detector ve o rosto dele em
 *     algum instante (pequeno que seja) e o etiquetador nao diz "de costas"
 *     (a fadinha voando no 0105 do MRM E02);
 *   - 'nao': de costas ou sem rosto (o Guy e a bruxa indo embora, 0199);
 *   - null: o detector nao olhou o plano: nao se sabe (o automatico recusa).
 */
function legivel(ctx: ContextoDaFrase, metade: Pick<CandidatoDeCena, 'planoIds' | 'inSec' | 'outSec'>): 'rosto' | 'personagem' | 'nao' | null {
  const planoId = metade.planoIds[0]!
  const instantes = ctx.e.rostos?.get(planoId) ?? []
  const olhados = instantes.filter((rs): rs is readonly RostoDoPlano[] => rs !== null)
  if (olhados.length === 0) return null
  const legivelNo = (rs: readonly RostoDoPlano[]): boolean => rs.some((r) => r.h >= ROSTO_LEGIVEL - 1e-9)
  const comRosto = olhados.filter(legivelNo).length
  if (comRosto >= Math.min(2, olhados.length)) {
    // O 1o instante olhado dentro do trecho que a metade toca (os instantes: 25, 50 e 75% do plano).
    const p = ctx.planos.get(planoId)
    const primeiro = p
      ? instantes.find((rs, i) => {
          const t = p.start + ((i + 1) / (instantes.length + 1)) * (p.end - p.start)
          return rs !== null && t >= metade.inSec - 1e-6 && t <= metade.outSec + 1e-6
        })
      : undefined
    if (!primeiro || legivelNo(primeiro)) return 'rosto'
  }
  if (ctx.e.deCostas?.has(planoId) || !olhados.some((rs) => rs.length > 0)) return 'nao'
  const noPlano = reconhecidos(ctx, planoId)
  return citadosEmOrdem(ctx).some((p) => noPlano.has(p)) ? 'personagem' : 'nao'
}

/**
 * O par do grid AUTOMATICO: null = recusado; senao o bonus. Falha FECHADO:
 *   - (a) pessoa reconhecida em comum nas duas metades; sem reconhecimento
 *     num dos dois planos, o rosto de um parecido com o da outra (mesmoRosto),
 *     e rosto sem vetor (nao se sabe) tambem recusa;
 *   - (b) metade sem rosto legivel, de costas, ou que o detector nao olhou.
 * O bonus (BONUS_DO_PAR): as duas com rosto visivel (pessoas diferentes: o
 * Nia E01 f07, a criada sorrindo e a Nia) ou rosto + o outro citado em acao
 * (o MRM E02 f07, o close do Lent e a fadinha voando). O grid na mao nao passa
 * por aqui: continua livre.
 */
function avaliarPar(ctx: ContextoDaFrase, metadeDeCima: CandidatoDeCena, metadeDeBaixo: CandidatoDeCena): { bonus: number } | null {
  const cima = metadeDeCima.planoIds[0]!
  const baixo = metadeDeBaixo.planoIds[0]!
  if (pessoaEmComum(ctx, cima, baixo)) return null
  if (reconhecidos(ctx, cima).size === 0 || reconhecidos(ctx, baixo).size === 0) {
    if (mesmoRosto(ctx, cima, baixo) !== false) return null
  }
  const lc = legivel(ctx, metadeDeCima)
  const lb = legivel(ctx, metadeDeBaixo)
  if (lc === 'nao' || lb === 'nao' || lc === null || lb === null) return null
  if (lc === 'rosto' && lb === 'rosto') return { bonus: BONUS_DO_PAR }
  const emAcao = lc === 'personagem' && lb === 'rosto' ? 'cima' : lc === 'rosto' && lb === 'personagem' ? 'baixo' : null
  if (emAcao) {
    const citados = citadosEmOrdem(ctx)
    const mostra = quemAMetadeMostra(ctx, emAcao === 'cima' ? cima : baixo, emAcao)
    if ([...mostra].some((p) => citados.includes(p))) return { bonus: BONUS_DO_PAR }
  }
  return { bonus: 0 }
}

/** A palavra j da frase e o comeco de um bloco de legenda (o fim da frase tambem conta). */
function naFronteira(ctx: ContextoDaFrase, j: number): boolean {
  if (ctx.forcado) return true
  const n = palavrasDaFrase(ctx.f.texto).length
  if (j >= n) return ctx.blocos.has(ctx.f.primeiraPalavra + n) || ctx.f.primeiraPalavra + n >= (ctx.e.take?.palavras.length ?? 0)
  return ctx.blocos.has(ctx.f.primeiraPalavra + j)
}

/** As cenas que podem fazer par numa cena da frase: a fita e a fita da frase inteira, sem repetir plano. */
function parceiras(ctx: ContextoDaFrase): CandidatoDeCena[] {
  const x = ctx.f.escolha
  const vistos = new Set<string>()
  const lista: CandidatoDeCena[] = []
  for (const c of [...x.fita, ...(x.inteira ?? [])]) {
    const id = c.planoIds[0]
    if (!id || vistos.has(id)) continue
    vistos.add(id)
    lista.push(c)
  }
  // Na frase dividida, a melhor do outro pedaco tambem serve: as duas na tela ao mesmo
  // tempo e justamente acao e reacao. Quem segura e a nota na mesma escala (notasDoPar).
  return lista
}

/** Onde cada metade entra na ordem da frase: a 1a palavra em que a frase cita alguem que o plano mostra. */
function ordemPelasPessoas(ctx: ContextoDaFrase, planoId: string, de: number, ate: number): number {
  const q = ctx.e.quem
  if (!q) return Infinity
  const noPlano = q.noPlano(planoId)
  let melhor = Infinity
  for (const c of q.citados.get(ctx.f.fraseId) ?? []) {
    if (c.palavra >= de && c.palavra < ate && noPlano.has(c.quem)) melhor = Math.min(melhor, c.palavra)
  }
  return melhor
}

/** Cima e baixo: quem a frase fala primeiro; sem pessoas, a de nota maior (o momento); depois a que vem antes no episodio. */
function emOrdem(ctx: ContextoDaFrase, a: CandidatoDeCena, b: CandidatoDeCena, palavras: [number, number]): [CandidatoDeCena, CandidatoDeCena] {
  const oa = ordemPelasPessoas(ctx, a.planoIds[0]!, palavras[0], palavras[1])
  const ob = ordemPelasPessoas(ctx, b.planoIds[0]!, palavras[0], palavras[1])
  if (oa !== ob) return oa < ob ? [a, b] : [b, a]
  if (comNota(a) && comNota(b) && Math.abs(a.nota - b.nota) > 1e-6) return a.nota > b.nota ? [a, b] : [b, a]
  return a.inSec <= b.inSec ? [a, b] : [b, a]
}

/** A frase cita duas pessoas ou mais: o reforco do gatilho. */
function citaDuas(ctx: ContextoDaFrase): boolean {
  return new Set((ctx.e.quem?.citados.get(ctx.f.fraseId) ?? []).map((c) => c.quem)).size >= 2
}

/**
 * As notas de dois candidatos da frase NA MESMA ESCALA. Na frase que o casar
 * dividiu, a fita mistura os pedacos (cada um pontuado com as palavras dele);
 * a da frase inteira (`inteira`) e uma conta so -- e e nela que as duas sao
 * comparadas (o Nia E01: 0111/0112 39,8 e 0110 36,1 na inteira; 52,5 e 36,0
 * na fita dos pedacos). Sem as duas la, as da fita. null = sem nota de verdade.
 */
function notasDoPar(ctx: ContextoDaFrase, a: CandidatoDeCena, b: CandidatoDeCena): [number, number] | null {
  const x = ctx.f.escolha
  const naLista = (lista: readonly CandidatoDeCena[] | undefined, c: CandidatoDeCena): number | null => {
    const id = c.planoIds[0]
    const achado = id ? lista?.find((o) => o.planoIds.includes(id)) : undefined
    return achado && comNota(achado) ? achado.nota : null
  }
  const ia = naLista(x.inteira, a)
  const ib = naLista(x.inteira, b)
  if (ia !== null && ib !== null) return [ia, ib]
  const fa = naLista(x.fita, a) ?? (comNota(a) ? a.nota : null)
  const fb = naLista(x.fita, b) ?? (comNota(b) ? b.nota : null)
  return fa !== null && fb !== null ? [fa, fb] : null
}

/** As duas metades sao do mesmo momento do episodio (PERTO_NO_EPISODIO_SEC). */
function mesmoMomento(a: Pick<CandidatoDeCena, 'inSec' | 'outSec'>, b: Pick<CandidatoDeCena, 'inSec' | 'outSec'>): boolean {
  return Math.abs((a.inSec + a.outSec) / 2 - (b.inSec + b.outSec) / 2) <= PERTO_NO_EPISODIO_SEC
}

/**
 * A melhor parceira de `x` (a metade que ja esta na cena; `origem` = o
 * candidato de onde ela saiu, para a nota) num bloco de `dura` segundos.
 * `nota` = a media das duas na mesma escala (notasDoPar) mais o bonus do par
 * (avaliarPar, so no automatico). `xEmCima`: a metade `x` fica em cima (o grid
 * que entra no meio da cena); senao a ordem e a de emOrdem.
 */
function melhorParceira(
  ctx: ContextoDaFrase,
  k: number,
  x: CandidatoDeCena,
  dura: number,
  origem: CandidatoDeCena = x,
  xEmCima = false,
): ParDoGrid | null {
  const idX = x.planoIds[0]!
  const n = palavrasDaFrase(ctx.f.texto).length
  let melhor: ParDoGrid | null = null
  for (const c of parceiras(ctx)) {
    if (vetado(ctx, c)) continue
    const metade = metadeDoCandidato(c, dura, ctx.planos, c.inSec, ctx.e.entradas)
    if (!metade) continue
    const id = metade.planoIds[0]!
    if (mesmaCenaVisual(ctx, id, idX) || ctx.usadosFora.has(id)) continue
    if (ctx.f.escolha.cenas.some((o) => o.candidato.planoIds.includes(id) || o.baixo?.planoIds.includes(id))) continue
    const notas = notasDoPar(ctx, origem, c) ?? [comNota(origem) ? origem.nota : 0, comNota(c) ? c.nota : 0]
    if (!ctx.forcado) {
      if (!comNota(c) || !mesmoMomento(x, metade)) continue
      const perto = Math.max(NOTA_PERTO, NOTA_PERTO_FRACAO * notas[0])
      if (Math.min(notas[0], notas[1]) < NOTA_MIN || notas[1] < notas[0] - perto) continue
    }
    let bonus = 0
    if (!ctx.forcado) {
      const [a, b] = xEmCima ? [x, metade] : emOrdem(ctx, x, metade, [0, n])
      const par = avaliarPar(ctx, a, b)
      if (!par) continue
      bonus = par.bonus
    }
    const nota = (notas[0] + notas[1]) / 2 + bonus
    if (!melhor || nota > melhor.nota) melhor = { metade, nota, notas, bonus }
  }
  return melhor
}

/** A parceira achada: a metade, a nota de escolha, as duas notas na mesma escala e o bonus do par. */
interface ParDoGrid {
  metade: CandidatoDeCena
  nota: number
  notas: [number, number]
  bonus: number
}

/** A nota de uma opcao: a media das duas metades, menos a distancia entre elas, mais o reforco. */
function notaDoPar(ctx: ContextoDaFrase, [a, b]: readonly [number, number], extra = 0): number {
  return (a + b) / 2 - 0.25 * Math.abs(a - b) + (citaDuas(ctx) ? 3 : 0) + extra
}

function opcoesDaFrase(ctx: ContextoDaFrase): OpcaoDoGrid[] {
  const { f } = ctx
  const x = f.escolha
  const take = ctx.e.take
  if (!take || x.cenas.length === 0) return []
  const frase = { id: f.fraseId, texto: f.texto }
  const tempos = temposDasCenas(x, frase, take)
  const n = palavrasDaFrase(f.texto).length
  // Um quadro de folga: 1,99 s no take e o bloco de 2 s da regra (a f07 do Nia E01).
  const minimo = (ctx.forcado ? GRID_NA_MAO_MIN_SEC : GRID_MIN_SEC) - TOLERANCIA_DE_DURACAO_SEC
  const prefixoMin = Math.max(PREFIXO_MIN_SEC, ctx.e.minimoSec ?? 0)
  const opcoes: OpcaoDoGrid[] = []
  const d = duracaoDaFrase(frase, take)
  const citadosNaFrase = (ctx.e.quem?.citados.get(f.fraseId) ?? []).map((c) => c.palavra)
  const entradas = entradasNaturais(f.texto, citadosNaFrase)

  for (const [k, cena] of x.cenas.entries()) {
    const t = tempos[k]
    if (!t || cena.baixo) continue
    const p0 = cena.palavraInicio
    const p1 = x.cenas[k + 1]?.palavraInicio ?? n
    if (!naFronteira(ctx, p1)) continue
    const nX = comNota(cena.candidato) ? cena.candidato.nota : null

    // 1. A cena inteira vira grid.
    const dura = t.fim - t.inicio
    if (dura >= minimo - 1e-6 && naFronteira(ctx, p0)) {
      const metade = metadeDoCandidato(cena.candidato, dura, ctx.planos, cena.candidato.inSec, ctx.e.entradas)
      const cima = metade && !vetado(ctx, metade) ? metade : null
      const par = cima && (nX === null || nX >= NOTA_MIN || ctx.forcado) ? melhorParceira(ctx, k, cima, dura, cena.candidato) : null
      if (cima && par) {
        const [a, b] = emOrdem(ctx, cima, par.metade, [0, n])
        const cenas = x.cenas.map((c, j) => (j === k ? { candidato: a, palavraInicio: c.palavraInicio, baixo: b } : c))
        // A cena emendada (o episodio cortando no meio dela) vira um plano so com o par: ganha um pouco.
        const extra = cena.candidato.planoIds.length > 1 ? 1 : 0
        opcoes.push({
          fraseId: f.fraseId,
          cenas,
          de: f.offset + t.inicio,
          ate: f.offset + t.fim,
          planos: [a.planoIds[0]!, b.planoIds[0]!],
          nota: notaDoPar(ctx, par.notas, extra + par.bonus),
          como: 'cena',
        })
      }
    }

    // 4. O grid entra ANTES do corte do casar: no 2o sujeito ou no conectivo que caiu
    //    dentro da cena de antes ("A criada percebe como | a garota voltou...", o casar
    //    cortou em "voltou"). A cena deste pedaco sobe para a palavra e ganha o par.
    if (k >= 1 && !x.cenas[k - 1]!.baixo) {
      const antes = x.cenas[k - 1]!
      const ta = tempos[k - 1]!
      for (const w of entradas) {
        if (w <= antes.palavraInicio || w >= p0 || !naFronteira(ctx, w)) continue
        const tw = Math.min(t.inicio, Math.max(ta.inicio, inicioDaPalavra(w, frase, take, d)))
        const prefixo = tw - ta.inicio
        const bloco = t.fim - tw
        if (prefixo < prefixoMin - 1e-6 || bloco < minimo - 1e-6) continue
        const metade = metadeDoCandidato(cena.candidato, bloco, ctx.planos, cena.candidato.inSec, ctx.e.entradas)
        const cima = metade && !vetado(ctx, metade) ? metade : null
        const par = cima && (nX === null || nX >= NOTA_MIN || ctx.forcado) ? melhorParceira(ctx, k, cima, bloco, cena.candidato) : null
        if (!cima || !par) continue
        const [a, b] = emOrdem(ctx, cima, par.metade, [0, n])
        opcoes.push({
          fraseId: f.fraseId,
          cenas: x.cenas.map((c, j) => (j === k ? { candidato: a, palavraInicio: w, baixo: b } : c)),
          de: f.offset + tw,
          ate: f.offset + t.fim,
          planos: [a.planoIds[0]!, b.planoIds[0]!],
          nota: notaDoPar(ctx, par.notas, -0.5 + par.bonus),
          como: 'antes',
        })
      }
    }

    // 2. A cena comeca cheia e o grid entra no meio dela (o 2o sujeito, o conectivo).
    for (const w of entradas) {
      if (w <= p0 || w >= p1 || !naFronteira(ctx, w)) continue
      const tw = Math.min(t.fim, Math.max(t.inicio, inicioDaPalavra(w, frase, take, d)))
      const prefixo = tw - t.inicio
      const resto = t.fim - tw
      if (prefixo < prefixoMin - 1e-6 || resto < minimo - 1e-6) continue
      // Em cima, a cena de antes continua (o plano dela que toca nesse instante).
      const cima = continuacao(cena.candidato, prefixo, resto, ctx.planos, ctx.e.entradas)
      if (!cima || vetado(ctx, cima)) continue
      const par = nX === null || nX >= NOTA_MIN || ctx.forcado ? melhorParceira(ctx, k, cima, resto, cena.candidato, true) : null
      if (!par) continue
      const cenas: CenaDaFrase[] = []
      for (const [j, c] of x.cenas.entries()) {
        if (j !== k) {
          cenas.push(c)
          continue
        }
        cenas.push(c)
        cenas.push({ candidato: cima, palavraInicio: w, baixo: par.metade })
      }
      opcoes.push({
        fraseId: f.fraseId,
        cenas,
        de: f.offset + tw,
        ate: f.offset + t.fim,
        planos: [cima.planoIds[0]!, par.metade.planoIds[0]!],
        // Entrar no meio corta a cena de antes: vale um pouco menos que o grid da cena inteira.
        nota: notaDoPar(ctx, par.notas, -1 + par.bonus),
        como: 'meio',
      })
    }
  }

  // 3. A frase dividida em 2 cenas (acao e reacao) vira um grid so, as duas ao mesmo tempo.
  if (x.cenas.length === 2 && !x.cenas.some((c) => c.baixo)) {
    const [c0, c1] = x.cenas as [CenaDaFrase, CenaDaFrase]
    const tokens = palavrasDaFrase(f.texto)
    // O corte no conectivo ("| e sobreviveu") ou logo depois dele ("e | sobreviveu").
    const conectivos = [tokens[c1.palavraInicio], tokens[c1.palavraInicio - 1]].map((t) => limpo(t ?? ''))
    const dura = d.duracao
    const sequencia = conectivos.some((w) => SEQUENCIA.has(w)) && !ctx.forcado
    if (!sequencia && dura >= minimo - 1e-6) {
      const cima = metadeDoCandidato(c0.candidato, dura, ctx.planos, c0.candidato.inSec, ctx.e.entradas)
      const baixo = metadeDoCandidato(c1.candidato, dura, ctx.planos, c1.candidato.inSec, ctx.e.entradas)
      const n0 = comNota(c0.candidato) ? c0.candidato.nota : null
      const n1 = comNota(c1.candidato) ? c1.candidato.nota : null
      // Cada uma foi a melhor do pedaco dela: as duas fortes e do mesmo momento bastam.
      const fortes = ctx.forcado || ((n0 ?? 0) >= NOTA_MIN && (n1 ?? 0) >= NOTA_MIN && mesmoMomento(c0.candidato, c1.candidato))
      const livres = cima !== null && baixo !== null && !vetado(ctx, cima) && !vetado(ctx, baixo)
      const diferentes = cima !== null && baixo !== null && !mesmaCenaVisual(ctx, cima.planoIds[0]!, baixo.planoIds[0]!)
      // Pessoa em comum ou metade sem rosto tambem nao vira grid aqui (so na mao).
      const par = cima !== null && baixo !== null && !ctx.forcado ? avaliarPar(ctx, cima, baixo) : { bonus: 0 }
      if (cima && baixo && livres && fortes && diferentes && par) {
        opcoes.push({
          fraseId: f.fraseId,
          cenas: [{ candidato: cima, palavraInicio: 0, baixo }],
          de: f.offset,
          ate: f.offset + dura,
          planos: [cima.planoIds[0]!, baixo.planoIds[0]!],
          nota: notaDoPar(ctx, [n0 ?? 0, n1 ?? 0], 1 + par.bonus),
          como: 'pedacos',
        })
      }
    }
  }
  // 5. (rodada 5) A EMENDA: a cena que o casar emendou em dois planos (o episodio corta no meio
  //    dela) tambem vira grid. Cada metade e um plano so; a que nao cobre congela no fim ate
  //    CONGELA_MAX_SEC (recuando o comeco no proprio plano antes disso), ou desiste.
  for (const [k, cena] of x.cenas.entries()) {
    const t = tempos[k]
    if (!t || cena.baixo || cena.candidato.planoIds.length < 2) continue
    const [idA, idB] = cena.candidato.planoIds as [string, string]
    const pA = ctx.planos.get(idA)
    const pB = ctx.planos.get(idB)
    if (!pA || !pB) continue
    const n0 = comNota(cena.candidato) ? cena.candidato.nota : 0
    if (!ctx.forcado && n0 < NOTA_MIN) continue
    const soA: CandidatoDeCena = { ...cena.candidato, planoIds: [idA], outSec: pA.end, keyframe: pA.keyframe }
    const soB: CandidatoDeCena = { ...cena.candidato, planoIds: [idB], inSec: pB.start, outSec: pB.end, keyframe: pB.keyframe }
    const p0 = cena.palavraInicio
    const p1 = x.cenas[k + 1]?.palavraInicio ?? n
    if (!naFronteira(ctx, p1)) continue

    // 5a. Os dois planos da emenda ao mesmo tempo, na cena inteira.
    const dura = t.fim - t.inicio
    if (dura >= minimo - 1e-6 && naFronteira(ctx, p0)) {
      const a = metadeQueCongela(soA, dura, ctx.planos, cena.candidato.inSec, ctx.e.entradas)
      const b = metadeQueCongela(soB, dura, ctx.planos, pB.start, ctx.e.entradas)
      const par = a && b ? parDaEmenda(ctx, k, a, b, n) : null
      if (par) {
        opcoes.push({
          fraseId: f.fraseId,
          cenas: x.cenas.map((c, j) => (j === k ? { candidato: par.cima, palavraInicio: c.palavraInicio, baixo: par.baixo } : c)),
          de: f.offset + t.inicio,
          ate: f.offset + t.fim,
          planos: [par.cima.planoIds[0]!, par.baixo.planoIds[0]!],
          nota: notaDoPar(ctx, [n0, n0], 1 + par.bonus),
          como: 'emenda',
        })
      }
    }

    // 5b. A 1a parte cheia (o 1o plano) e o grid no CORTE da emenda, numa fronteira de legenda:
    //     a entrada natural (o 2o sujeito, o conectivo) ate CONGELA_MAX_SEC depois do corte (o 1o
    //     plano segura o resto), senao a ultima fronteira antes dele. As metades: o 2o plano e as
    //     primeiras cenas da fita (FITA_DA_EMENDA), plano a plano.
    const corte = t.inicio + Math.max(0, pA.end - cena.candidato.inSec)
    let w: number | null = null
    let tw = 0
    let natural = false
    for (let j = p0 + 1; j < p1; j++) {
      const tj = Math.min(t.fim, Math.max(t.inicio, inicioDaPalavra(j, frase, take, d)))
      const ehNatural = entradas.includes(j)
      if (tj > corte + (ehNatural ? CONGELA_MAX_SEC : TOLERANCIA_DE_DURACAO_SEC)) continue
      if (!naFronteira(ctx, j) || tj - t.inicio < prefixoMin - 1e-6 || t.fim - tj < minimo - 1e-6) continue
      // A natural ganha da que nao e; entre iguais, a mais perto do corte (a ultima).
      if (w === null || ehNatural || !natural) {
        w = j
        tw = tj
        natural = ehNatural
      }
    }
    if (w === null) continue
    const bloco = t.fim - tw
    const pool: { c: CandidatoDeCena; nota: number }[] = [{ c: soB, nota: n0 }]
    for (const c of x.fita.slice(0, FITA_DA_EMENDA)) {
      const nota = comNota(c) ? c.nota : 0
      for (const [i, id] of c.planoIds.entries()) {
        const p = ctx.planos.get(id)
        if (!p || id === idA || pool.some((o) => o.c.planoIds[0] === id)) continue
        pool.push({ c: { ...c, planoIds: [id], inSec: i === 0 ? c.inSec : p.start, outSec: p.end, keyframe: p.keyframe }, nota })
      }
    }
    let melhor: { par: NonNullable<ReturnType<typeof parDaEmenda>>; nota: number } | null = null
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const [oi, oj] = [pool[i]!, pool[j]!]
        if (!ctx.forcado && Math.min(oi.nota, oj.nota) < NOTA_MIN) continue
        const a = metadeQueCongela(oi.c, bloco, ctx.planos, oi.c.inSec, ctx.e.entradas)
        const b = metadeQueCongela(oj.c, bloco, ctx.planos, oj.c.inSec, ctx.e.entradas)
        const par = a && b ? parDaEmenda(ctx, k, a, b, n) : null
        if (!par) continue
        // Entrar fora de uma entrada natural vale menos (como o grid no meio da cena).
        const nota = notaDoPar(ctx, [oi.nota, oj.nota], (natural ? -0.5 : -1.5) + par.bonus)
        if (!melhor || nota > melhor.nota) melhor = { par, nota }
      }
    }
    if (!melhor) continue
    const { par, nota } = melhor
    opcoes.push({
      fraseId: f.fraseId,
      cenas: x.cenas.flatMap((c, j) => (j === k ? [{ candidato: soA, palavraInicio: c.palavraInicio }, { candidato: par.cima, palavraInicio: w!, baixo: par.baixo }] : [c])),
      de: f.offset + tw,
      ate: f.offset + t.fim,
      planos: [par.cima.planoIds[0]!, par.baixo.planoIds[0]!],
      nota,
      como: 'emenda',
    })
  }
  return opcoes
}

/**
 * (rodada 5) A metade de um plano so que pode CONGELAR no fim ate CONGELA_MAX_SEC:
 * comeca em `comeco` (ou recua no proprio plano para cobrir o bloco, o trecho
 * vizinho); faltando mais que isso, null (desiste).
 */
function metadeQueCongela(
  c: CandidatoDeCena,
  dura: number,
  planos: ReadonlyMap<string, Plano>,
  comeco: number,
  entradas?: ReadonlyMap<string, number>,
): CandidatoDeCena | null {
  const p = planos.get(c.planoIds[0] ?? '')
  if (!p) return null
  // O plano que abre com clarao ou borrao comeca depois dele e cobre o bloco inteiro: o encaixe da
  // metade (encaixarMetade) recuaria para dentro do borrao para nao congelar.
  const entrada = entradas?.get(p.id)
  const temEntrada = entrada !== undefined && entrada > p.start
  const piso = temEntrada ? Math.min(entrada, p.end) : p.start
  const inicio = Math.min(Math.max(comeco, piso), p.end)
  let de: number
  if (p.end - inicio >= dura - FOLGA_SEC) de = inicio
  else if (temEntrada) {
    if (p.end - piso < dura - FOLGA_SEC) return null
    de = p.end - dura
  } else de = Math.max(p.start, p.end - dura)
  if (dura - (p.end - de) > CONGELA_MAX_SEC + 1e-6) return null
  return { ...c, planoIds: [p.id], inSec: de, outSec: Math.min(p.end, de + Math.max(dura, FOLGA_SEC)), keyframe: p.keyframe }
}

/**
 * (rodada 5) Um par de metades da emenda: as regras de sempre (veto, a mesma
 * cena, plano de outra frase ou de outra cena desta, o mesmo momento e, no
 * automatico, avaliarPar), na ordem de emOrdem. null = nao serve.
 */
function parDaEmenda(
  ctx: ContextoDaFrase,
  k: number,
  a: CandidatoDeCena,
  b: CandidatoDeCena,
  n: number,
): { cima: CandidatoDeCena; baixo: CandidatoDeCena; bonus: number } | null {
  const ia = a.planoIds[0]!
  const ib = b.planoIds[0]!
  if (ia === ib || mesmaCenaVisual(ctx, ia, ib)) return null
  const deOutraCena = (id: string): boolean =>
    ctx.f.escolha.cenas.some((o, j) => j !== k && (o.candidato.planoIds.includes(id) || o.baixo?.planoIds.includes(id) === true))
  if (ctx.forcado) {
    const [cima, baixo] = emOrdem(ctx, a, b, [0, n])
    return deOutraCena(ia) || deOutraCena(ib) ? null : { cima, baixo, bonus: 0 }
  }
  if (vetado(ctx, a) || vetado(ctx, b) || ctx.usadosFora.has(ia) || ctx.usadosFora.has(ib) || deOutraCena(ia) || deOutraCena(ib)) return null
  if (!mesmoMomento(a, b)) return null
  const [cima, baixo] = emOrdem(ctx, a, b, [0, n])
  const par = avaliarPar(ctx, cima, baixo)
  return par ? { cima, baixo, bonus: par.bonus } : null
}

/**
 * A cena `c` depois de `prefixo` segundos: o plano dela que toca nesse
 * instante, como metade de `resto` segundos, sem voltar no tempo (no maximo
 * meio segundo, o que o olho nao pega). null = nao cobre.
 */
function continuacao(
  c: CandidatoDeCena,
  prefixo: number,
  resto: number,
  planos: ReadonlyMap<string, Plano>,
  entradas?: ReadonlyMap<string, number>,
): CandidatoDeCena | null {
  let cursor = c.inSec
  let falta = prefixo
  for (const id of c.planoIds) {
    const p = planos.get(id)
    if (!p) continue
    const de = Math.max(cursor, p.start)
    const tem = p.end - de
    if (tem > falta + 1e-6) {
      const agora = de + falta
      const metade = metadeDoCandidato({ ...c, planoIds: [p.id] }, resto, planos, agora, entradas)
      if (!metade || metade.inSec < agora - 0.5) return null
      return metade
    }
    falta -= Math.max(0, tem)
    cursor = p.end
  }
  return null
}

// --------------------------------------------------------- o passo inteiro

/**
 * O PASSO DO GRID sobre todas as escolhas (depois do casar e do encaixe). Os
 * grids automaticos de antes voltam as cenas deles e sao decididos de novo
 * (idempotente); os da mao e as frases travadas ficam como estao.
 */
export function gridsAutomaticos(e: EntradaDoGrid): SaidaDoGrid {
  const avisos: string[] = []
  const base = e.escolhas.map((x) => semGridAutomatico(x))
  const mudadas = new Set(base.filter((x, i) => x !== e.escolhas[i]).map((x) => x.fraseId))
  const candidatas: SaidaDoGrid['candidatas'] = []
  const fim = (escolhas: EscolhaDaFrase[], postos: string[]): SaidaDoGrid => ({ escolhas, postos, mudadas: [...mudadas], candidatas, avisos })
  if (e.modo === 'desligado' || !e.take) return fim(base, [])

  const total = totalDeFrases(e.roteiro)
  const frases = frasesNoGrid({ ...e, escolhas: base })
  const planos = new Map(e.indice.planos.map((p) => [p.id, p]))
  const blocos = iniciosDosBlocos(e.take, e.regras)
  const limite = limiteDeGrids(e.take.duracao)

  // Os grids que ja estao (na mao, ou nas frases travadas): contam no limite e no espaco.
  const tempos = (f: FraseNoGrid): { de: number; ate: number }[] => {
    const t = temposDasCenas(f.escolha, { id: f.fraseId, texto: f.texto }, e.take)
    return f.escolha.cenas.flatMap((c, k) => (c.baixo && t[k] ? [{ de: f.offset + t[k]!.inicio, ate: f.offset + t[k]!.fim }] : []))
  }
  const ocupados = frases.flatMap(tempos)

  const opcoes: OpcaoDoGrid[] = []
  for (const f of frases) {
    const x = f.escolha
    // Nunca no gancho inteiro (nao so a 1a frase), na ultima frase, no climax nem em frase com texto de tela.
    if (f.posicao === 0 || f.posicao === total - 1 || f.papel === 'gancho' || f.papel === 'climax' || f.temTextoDeTela) continue
    if (x.travada || x.telaCheia || x.grid || temGrid(x)) continue
    const ctx: ContextoDaFrase = { f, planos, e, blocos, usadosFora: planosUsados(base, f.fraseId), forcado: false }
    const daFrase = opcoesDaFrase(ctx).sort((a, b) => b.nota - a.nota)
    if (daFrase[0]) opcoes.push(daFrase[0])
  }
  for (const o of opcoes) candidatas.push({ fraseId: o.fraseId, como: o.como, nota: Math.round(o.nota * 10) / 10, planos: o.planos, de: o.de, ate: o.ate })

  // Os melhores primeiro, ate o limite, sempre com tela cheia entre eles.
  opcoes.sort((a, b) => b.nota - a.nota || a.de - b.de)
  const aceitas: OpcaoDoGrid[] = []
  const metadesUsadas = new Set<string>()
  for (const o of opcoes) {
    if (aceitas.length + ocupados.length >= limite) break
    const perto = [...ocupados, ...aceitas].some((g) => o.de < g.ate + TELA_CHEIA_ENTRE_SEC - 1e-6 && g.de < o.ate + TELA_CHEIA_ENTRE_SEC - 1e-6)
    if (perto || o.planos.some((id) => metadesUsadas.has(id))) continue
    aceitas.push(o)
    for (const id of o.planos) metadesUsadas.add(id)
  }

  const porFrase = new Map(aceitas.map((o) => [o.fraseId, o]))
  const escolhas = base.map((x) => {
    const o = porFrase.get(x.fraseId)
    if (!o) return x
    mudadas.add(x.fraseId)
    return { ...x, cenas: o.cenas, grid: { origem: 'auto' as const, antes: x.cenas } }
  })
  const postos = frases.filter((f) => porFrase.has(f.fraseId)).map((f) => f.fraseId)
  for (const o of aceitas) avisos.push(`${o.fraseId}: grid ${o.planos[0]} / ${o.planos[1]}`)
  return fim(escolhas, postos)
}

/**
 * "GRID" no passo 4: a frase ganha o grid NA MAO (a melhor opcao, sem o
 * limite do video nem a nota perto), com a cena dele como uma das metades.
 * Erro em ASCII quando nenhuma outra cena serve.
 */
export function ligarGrid(e: EntradaDoGrid, fraseId: string): { escolha: EscolhaDaFrase } | { erro: string } {
  if (!e.take) return { erro: 'O grid precisa da voz aprovada.' }
  const frases = frasesNoGrid(e)
  const f = frases.find((x) => x.fraseId === fraseId)
  if (!f) return { erro: 'Essa frase nao tem voz ou cena.' }
  const x = f.escolha
  if (temGrid(x)) return { escolha: x }
  const ctx: ContextoDaFrase = {
    f,
    planos: new Map(e.indice.planos.map((p) => [p.id, p])),
    e,
    blocos: iniciosDosBlocos(e.take, e.regras),
    usadosFora: planosUsados(e.escolhas, fraseId),
    forcado: true,
  }
  const opcoes = opcoesDaFrase(ctx).sort((a, b) => b.nota - a.nota)
  const melhor = opcoes[0]
  if (!melhor) return { erro: 'Nenhuma outra cena boa e longa o bastante para o grid nesta frase.' }
  const escolha: EscolhaDaFrase = { ...x, cenas: melhor.cenas, grid: { origem: 'mao', antes: x.cenas }, travada: true }
  delete escolha.telaCheia
  return { escolha }
}

/** "TELA CHEIA" no passo 4: as cenas de antes do grid voltam, e o automatico nao poe mais nesta frase. */
export function desligarGrid(x: EscolhaDaFrase): EscolhaDaFrase {
  const cenas = x.grid && temGrid(x) ? x.grid.antes.map((c) => semMetade(c)) : x.cenas.map((c) => semMetade(c))
  const saida: EscolhaDaFrase = { ...x, cenas, telaCheia: true, travada: true }
  delete saida.grid
  return saida
}

// ------------------------------------------------------------ o grid na mao

/*
 * (20/10) O GRID NA MAO do passo 4, do jeito que o Levi pediu: "Grid" na
 * frase, a cena de CIMA na esquerda (ja feita se a frase tem uma cena so) e a
 * de BAIXO na grade da direita; na esquerda, inverter (cima <-> baixo) e
 * tirar a de baixo. A cena que ele pos em cima ou embaixo e 'usuario' (posto
 * a mao): o encaixe nunca a troca (encaixarMetade, o plano dele; falta ate
 * SEGURAR_EM_VEZ_DE_RELANCE_SEC congela, mais que isso e "Cena curta") e o
 * grid automatico nunca mexe na frase (grid 'mao' + travada). A sugestao do
 * app (sugestaoDeBaixo) entra embaixo com a origem dela (nao 'usuario'): a
 * tela diz "sugestao do app" e o proximo clique na grade troca.
 */

/** O aviso do "Grid" na mao quando nenhuma cena da fita serve de sugestao: ele escolhe na grade. */
export const SEM_SUGESTAO_DE_BAIXO = 'sem sugestao de baixo'

/** O candidato que ele pos: origem 'usuario' (o encaixe nunca troca o plano dele). */
function daMao(c: CandidatoDeCena): CandidatoDeCena {
  return c.origem === 'usuario' ? c : { ...c, origem: 'usuario' }
}

/** A marca do grid na mao, guardando as cenas de antes do primeiro grid (o "Tela cheia" volta a elas). */
function naMao(x: EscolhaDaFrase, cenas: CenaDaFrase[]): EscolhaDaFrase {
  const saida: EscolhaDaFrase = { ...x, cenas, grid: { origem: 'mao', antes: x.grid?.antes ?? x.cenas.map((c) => semMetade(c)) }, travada: true }
  delete saida.telaCheia
  return saida
}

/**
 * A metade de CIMA da cena k: a cena dele (um plano so). A sugestao do casar
 * emendada vira o plano dela que cobre a cena (metadeDoCandidato); a posta a
 * mao, o plano dele mesmo que congele (o encaixe avisa).
 */
export function metadeDeCima(
  cena: Pick<CenaDaFrase, 'candidato'>,
  dura: number,
  planos: ReadonlyMap<string, Plano>,
  entradas?: ReadonlyMap<string, number>,
): CandidatoDeCena {
  const c = cena.candidato
  const coberta = metadeDoCandidato(c, dura, planos, c.inSec, entradas)
  return daMao(coberta ?? encaixarMetade({ ...c, planoIds: c.planoIds.slice(0, 1) }, dura, planos).candidato)
}

/**
 * A metade de BAIXO que ele clicou: o plano dele (o primeiro do candidato),
 * desde o comeco que ele viu, 'usuario'.
 */
export function metadeDeBaixoDele(c: CandidatoDeCena, dura: number, planos: ReadonlyMap<string, Plano>): CandidatoDeCena {
  const p = planos.get(c.planoIds[0] ?? '')
  const um = p ? { ...c, planoIds: [p.id], inSec: Math.min(Math.max(c.inSec, p.start), p.end), outSec: p.end, keyframe: p.keyframe } : c
  return daMao(encaixarMetade(um, dura, planos).candidato)
}

/**
 * A SUGESTAO DO APP para a metade de baixo da cena k, com a cena dele em
 * cima: a melhor parceira da fita (a mesma conta do "Grid" de antes, sem o
 * limite do video). null em `baixo` = nenhuma serve (ele escolhe na grade).
 */
export function sugestaoDeBaixo(
  e: EntradaDoGrid,
  fraseId: string,
  k: number,
): { cima: CandidatoDeCena; baixo: CandidatoDeCena | null } | { erro: string } {
  if (!e.take) return { erro: 'O grid precisa da voz aprovada.' }
  const f = frasesNoGrid(e).find((x) => x.fraseId === fraseId)
  if (!f) return { erro: 'Essa frase nao tem voz ou cena.' }
  const cena = f.escolha.cenas[k]
  if (!cena) return { erro: 'Essa cena nao esta mais na frase.' }
  const planos = new Map(e.indice.planos.map((p) => [p.id, p]))
  const t = temposDasCenas(f.escolha, { id: f.fraseId, texto: f.texto }, e.take)[k]
  const dura = t ? t.fim - t.inicio : 0
  const cima = metadeDeCima(cena, dura, planos, e.entradas)
  const ctx: ContextoDaFrase = {
    f,
    planos,
    e,
    blocos: iniciosDosBlocos(e.take, e.regras),
    usadosFora: planosUsados(e.escolhas, fraseId),
    forcado: true,
  }
  const par = melhorParceira(ctx, k, cima, dura, cena.candidato, true)
  return { cima, baixo: par ? { ...par.metade, origem: par.metade.origem === 'usuario' ? 'sugestao' : par.metade.origem } : null }
}

/** A cena k com `cima` e `baixo` (o grid na mao). */
export function comGridNaMao(x: EscolhaDaFrase, k: number, cima: CandidatoDeCena, baixo: CandidatoDeCena): EscolhaDaFrase {
  if (!x.cenas[k]) return x
  return naMao(
    x,
    x.cenas.map((c, j) => (j === k ? { ...c, candidato: cima, baixo } : c)),
  )
}

/** Inverter: a de cima vai para baixo e a de baixo para cima (as duas ficam dele). */
export function inverterMetades(x: EscolhaDaFrase, k: number): EscolhaDaFrase | null {
  const c = x.cenas[k]
  if (!c?.baixo) return null
  return naMao(
    x,
    x.cenas.map((o, j) => (j === k ? { ...o, candidato: daMao(c.baixo!), baixo: daMao(c.candidato) } : o)),
  )
}

/**
 * Tirar a de baixo: a cena k volta a tela cheia, com a cena de cima (a de
 * antes do grid quando era ela, inteira). Sem grid nenhum na frase, a frase
 * fica em "Tela cheia" (o automatico nao poe mais).
 */
export function tirarMetadeDeBaixo(x: EscolhaDaFrase, k: number): EscolhaDaFrase | null {
  const c = x.cenas[k]
  if (!c?.baixo) return null
  const id = c.candidato.planoIds[0] ?? ''
  const deAntes = x.grid?.antes.find((a) => a.candidato.planoIds.includes(id))
  const cheia = semMetade({ ...c, candidato: deAntes ? deAntes.candidato : c.candidato })
  const cenas = x.cenas.map((o, j) => (j === k ? cheia : o))
  if (cenas.some((o) => o.baixo)) return naMao(x, cenas)
  const saida: EscolhaDaFrase = { ...x, cenas, telaCheia: true, travada: true }
  delete saida.grid
  return saida
}
