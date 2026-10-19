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
 *   - cada metade e UM plano que cobre o bloco inteiro desde o comeco dela,
 *     sem congelar; o bloco tem pelo menos GRID_MIN_SEC;
 *   - comeca e termina na fronteira de um bloco de LEGENDA; o comeco da frase
 *     pode ficar em tela cheia, e o grid entra na palavra do 2o sujeito ou do
 *     conectivo;
 *   - no maximo GRIDS_POR_MINUTO a cada 60 s, nunca seguidas, com pelo menos
 *     TELA_CHEIA_ENTRE_SEC de tela cheia entre elas;
 *   - nunca na 1a nem na ultima frase, nem no climax; nunca com plano vetado
 *     (close extremo, o anime ja dividindo o quadro, creditos: o servico diz).
 * A ORDEM: em CIMA o que a frase fala primeiro (sujeito/acao), embaixo o que
 * vem depois (reacao/consequencia) -- pelas pessoas citadas, pelo pedaco da
 * frase, e sem isso pela nota (a cena do momento da frase).
 *
 * A frase travada (ele escolheu ou mexeu) e a "Tela cheia" dele nunca ganham
 * grid automatico; o "Grid" do passo 4 (ligarGrid) poe na mao, com a cena
 * dele como uma das metades.
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
 * null = nenhum plano do candidato cobre o bloco sozinho.
 */
export function metadeDoCandidato(
  c: CandidatoDeCena,
  dura: number,
  planos: ReadonlyMap<string, Plano>,
  comeco: number = c.inSec,
): CandidatoDeCena | null {
  for (const id of c.planoIds) {
    const p = planos.get(id)
    if (!p) continue
    const inicio = Math.min(Math.max(comeco, p.start), p.end)
    const de = p.end - inicio >= dura - FOLGA_SEC ? inicio : p.end - dura
    if (de < p.start - 1e-6) continue
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
export interface QuemNoGrid {
  /** fraseId -> as pessoas citadas, cada uma na palavra em que aparece (palavrasDaFrase). */
  citados: ReadonlyMap<string, readonly { palavra: number; quem: string }[]>
  /** As pessoas (as mesmas chaves de `citados`) que o plano mostra (rosto ou fala). */
  noPlano: (planoId: string) => ReadonlySet<string>
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
  como: 'cena' | 'meio' | 'antes' | 'pedacos'
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
        saida.push({ fraseId: f.id, texto: f.texto, papel: secao.papel, posicao, escolha, offset: t.offset, primeiraPalavra: primeira.get(f.id) ?? -1 })
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
 * `nota` = a media das duas na mesma escala (notasDoPar).
 */
function melhorParceira(
  ctx: ContextoDaFrase,
  k: number,
  x: CandidatoDeCena,
  dura: number,
  origem: CandidatoDeCena = x,
): { metade: CandidatoDeCena; nota: number; notas: [number, number] } | null {
  const idX = x.planoIds[0]!
  let melhor: { metade: CandidatoDeCena; nota: number; notas: [number, number] } | null = null
  for (const c of parceiras(ctx)) {
    if (vetado(ctx, c)) continue
    const metade = metadeDoCandidato(c, dura, ctx.planos)
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
    const nota = (notas[0] + notas[1]) / 2
    if (!melhor || nota > melhor.nota) melhor = { metade, nota, notas }
  }
  return melhor
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
      const metade = metadeDoCandidato(cena.candidato, dura, ctx.planos)
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
          nota: notaDoPar(ctx, par.notas, extra),
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
        const metade = metadeDoCandidato(cena.candidato, bloco, ctx.planos)
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
          nota: notaDoPar(ctx, par.notas, -0.5),
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
      const cima = continuacao(cena.candidato, prefixo, resto, ctx.planos)
      if (!cima || vetado(ctx, cima)) continue
      const par = nX === null || nX >= NOTA_MIN || ctx.forcado ? melhorParceira(ctx, k, cima, resto, cena.candidato) : null
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
        nota: notaDoPar(ctx, par.notas, -1),
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
      const cima = metadeDoCandidato(c0.candidato, dura, ctx.planos)
      const baixo = metadeDoCandidato(c1.candidato, dura, ctx.planos)
      const n0 = comNota(c0.candidato) ? c0.candidato.nota : null
      const n1 = comNota(c1.candidato) ? c1.candidato.nota : null
      // Cada uma foi a melhor do pedaco dela: as duas fortes e do mesmo momento bastam.
      const fortes = ctx.forcado || ((n0 ?? 0) >= NOTA_MIN && (n1 ?? 0) >= NOTA_MIN && mesmoMomento(c0.candidato, c1.candidato))
      const livres = cima !== null && baixo !== null && !vetado(ctx, cima) && !vetado(ctx, baixo)
      const diferentes = cima !== null && baixo !== null && !mesmaCenaVisual(ctx, cima.planoIds[0]!, baixo.planoIds[0]!)
      if (cima && baixo && livres && fortes && diferentes) {
        opcoes.push({
          fraseId: f.fraseId,
          cenas: [{ candidato: cima, palavraInicio: 0, baixo }],
          de: f.offset,
          ate: f.offset + dura,
          planos: [cima.planoIds[0]!, baixo.planoIds[0]!],
          nota: notaDoPar(ctx, [n0 ?? 0, n1 ?? 0], 1),
          como: 'pedacos',
        })
      }
    }
  }
  return opcoes
}

/**
 * A cena `c` depois de `prefixo` segundos: o plano dela que toca nesse
 * instante, como metade de `resto` segundos, sem voltar no tempo (no maximo
 * meio segundo, o que o olho nao pega). null = nao cobre.
 */
function continuacao(c: CandidatoDeCena, prefixo: number, resto: number, planos: ReadonlyMap<string, Plano>): CandidatoDeCena | null {
  let cursor = c.inSec
  let falta = prefixo
  for (const id of c.planoIds) {
    const p = planos.get(id)
    if (!p) continue
    const de = Math.max(cursor, p.start)
    const tem = p.end - de
    if (tem > falta + 1e-6) {
      const agora = de + falta
      const metade = metadeDoCandidato({ ...c, planoIds: [p.id] }, resto, planos, agora)
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
    if (f.posicao === 0 || f.posicao === total - 1 || f.papel === 'climax') continue
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
