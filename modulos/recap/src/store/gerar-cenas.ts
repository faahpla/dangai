import { useMemo } from 'react'
import { create } from 'zustand'
import { statusDoCorte, temPlanos, type EpisodeIndex, type EstadoDoCorte } from '../../shared/episodio'
import { roteiroAtual, type Frase, type RascunhoDoRecap, type Roteiro } from '../../shared/roteiro'
import { hashDoTexto, podeIrParaCenas, takeAtual, type AudioDoTake, type TakeDaVoz } from '../../shared/voz'
import {
  FITA_MAX,
  aplicarEscolhas,
  cenasDoRascunho,
  AVISO_LONGE_DO_MOMENTO,
  duracaoDaFrase,
  escolhaDaFrase,
  escolhasDesatualizadas,
  escolhasForaDoIndice,
  frasesDoRoteiro,
  juntarEmUma,
  palavrasNaFrase,
  temposDasCenas,
  type CandidatoDeCena,
  type CandidatosDaFrase,
  type EscolhaDaFrase,
  type EstadoDasCenas,
} from '../../shared/cenas'
import { encaixarEscolha, planoExcluido, PREFIXO_CENA_CURTA_DELE, SUFIXO_METADE_DO_GRID } from '../../shared/encaixe'
import {
  comGridNaMao,
  inverterMetades,
  metadeDeBaixoDele,
  metadeDeCima,
  SEM_SUGESTAO_DE_BAIXO,
  tirarMetadeDeBaixo,
  type ModoDoGrid,
} from '../../shared/grid'
import { aplicarMesclas, type PlanoNoMesclado } from '../../shared/mesclas'
import { useGerar } from './gerar'
import { useRoteiro } from './gerar-roteiro'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { pedidoDaMontagem, useEdicaoRapida } from './edicao-rapida'

/**
 * O ASSISTENTE "GERAR RECAP", passo 4 (Cenas). Dono: agente C.
 *
 * Store propria, como a dos outros passos: nada daqui entra no undo nem no
 * projeto aberto. O que vale mora no RASCUNHO DO RECAP (`cenas`, shared/cenas.ts),
 * e o rascunho na memoria e UM SO, o da store do roteiro (gerar-roteiro.ts):
 * toda chamada do passo 4 devolve o rascunho inteiro e ele entra la
 * (trocarRascunho), como a voz faz.
 *
 * Aqui mora:
 *   - o DISPARO EM SEGUNDO PLANO (escutarCenas): roteiro aprovado + planos no
 *     indice = sugerirCenas, de graca, mesmo com o assistente fechado; voz
 *     aprovada + encaixe velho (outro take, frase regravada, sugestao nova) =
 *     encaixarNaVoz. Quem diz o que ficou velho e escolhasDesatualizadas,
 *     nunca uma flag solta;
 *   - o que a tela de Cenas mexe: a frase aberta, a cena alvo, os filtros da
 *     grade, as miniaturas e os videos publicados;
 *   - as escolhas PENDENTES: o clique encaixa na hora (encaixarEscolha, puro),
 *     marca `travada` e grava sozinho logo depois (salvarCenas). Enquanto a
 *     gravacao nao volta, a tela mostra a pendente por cima da do disco -- uma
 *     resposta que chega atrasada nunca apaga um clique mais novo;
 *   - o "Abrir no editor": montarProjeto + openProject + fechar o assistente.
 *
 * As chamadas ao main deste passo vao numa fila so (gravar, sugerir, encaixar,
 * montar): o main le -> aplica -> grava, e a ordem dos pedidos e a ordem das
 * gravacoes.
 */

// ------------------------------------------------------------------ tipos

/** As faixas de duracao da grade (as da Biblioteca, mais "cobre a frase"). Filtro da tela, sem ir ao main. */
export type FaixaDeDuracao = 'qualquer' | 'cobre' | 'ate2' | '2a5' | 'mais5'

export interface FiltrosNaTela {
  /** Nome cru do personagem (o do indice). null = todos. */
  personagem: string | null
  busca: string
  /** "Perto deste momento" a partir deste plano. null = do momento da frase. */
  vizinhasDe: string | null
  /** Duracao da cena (vizinhas e resto do episodio; a fita fica inteira). */
  duracao: FaixaDeDuracao
}

/** A cena passa na faixa de duracao. `frase` = os segundos da frase (para "cobre a frase"). */
export function passaNaDuracao(c: Pick<CandidatoDeCena, 'inSec' | 'outSec'>, faixa: FaixaDeDuracao, frase: number): boolean {
  const d = c.outSec - c.inSec
  switch (faixa) {
    case 'qualquer':
      return true
    case 'cobre':
      return d >= frase - 0.05
    case 'ate2':
      return d <= 2
    case '2a5':
      return d >= 2 && d <= 5
    case 'mais5':
      return d > 5
  }
}

export interface GradeNaTela {
  /** De que frase/filtro/sugestao ela fala (muda = pedir outra). */
  chave: string
  valor: CandidatosDaFrase | null
  carregando: boolean
  erro: string | null
}

/** O que o player grande toca. */
export interface PreviaNoTocador {
  fraseId: string
  /**
   * null = a frase como esta (as cenas escolhidas). Um candidato = a frase com
   * ele no lugar da cena alvo: o que o clique faria, ja no tempo da voz.
   */
  candidato: CandidatoDeCena | null
  /** Comecar tocando (Espaco, abrir pelo cartao). */
  tocar: boolean
}

export type Confirmacao = 'sem-cena' | 'nao-salvo'

interface EstadoDasCenasNaTela {
  /** O rascunho a que as pendentes e a frase aberta pertencem. */
  rascunhoId: string | null
  fraseAtiva: string | null
  /** Qual cena da frase aberta o clique troca (0 = a primeira). */
  cenaAlvo: number
  filtros: FiltrosNaTela
  grade: GradeNaTela | null
  /** Os ultimos personagens que a grade trouxe (os chips nao piscam ao trocar de frase). */
  personagens: { nome: string; cenas: number }[]
  /** Miniatura do keyframe por id de plano. null = sem keyframe. Ausente = nao pedida. */
  miniaturas: Record<string, string | null>
  episodioDasMiniaturas: string | null
  /** URL publicada de cada mp4 (libraryClipUrl), por caminho. */
  videos: Record<string, string>
  /** O audio publicado do take, por `${rascunhoId}:${takeId}`. */
  audios: Record<string, AudioDoTake>
  /** O corte em segundo plano do episodio do rascunho (onCorteProgresso). null = nao se sabe. */
  corte: EstadoDoCorte | null
  /** De que episodio e o `corte` (e o `indiceDoCorte`). */
  episodioDoCorte: string | null
  /** O indice com planos que o fim do corte trouxe (se o passo 1 ainda nao tiver o dele). */
  indiceDoCorte: EpisodeIndex | null
  /**
   * [recap] Os planos que o Dangai mesclou depois do indice (shared/mesclas.ts):
   * planoId -> o mesclado e o ponto dentro dele. O main le o disco; a tela so
   * aplica. null = ainda nao lido.
   */
  mesclas: { episodioId: string; mapa: Record<string, PlanoNoMesclado> } | null
  /** Le de novo as mesclas do episodio (ao entrar no passo 4 e quando a Biblioteca fecha). */
  carregarMesclas: () => Promise<void>
  /** Escolhas da tela que o disco ainda nao tem, por fraseId. */
  pendentes: Record<string, EscolhaDaFrase>
  salvando: boolean
  /** Um sugerirCenas no ar: 'auto' (segundo plano), 'todas' ou o id da frase. */
  sugerindo: string | null
  /** (rodada 4) O "Grid" / "Tela cheia" de uma frase no ar: o id dela. */
  gridando: string | null
  /** (20/10) O grid na mao em andamento (o "Grid" da frase ate ele escolher a de baixo). */
  gridNaMao: GridNaMao | null
  encaixando: boolean
  montando: boolean
  /** O que a montagem esta fazendo agora (do main: "Rostos, sons e musica..."). null = sem recado. */
  etapaDaMontagem: string | null
  /** O "Abrir no editor" esperando o segundo clique. */
  confirmando: Confirmacao | null
  previa: PreviaNoTocador | null
  erro: string | null
  recado: string | null
  /** Recados do main da ultima sugestao/encaixe (o tooltip do rodape). */
  avisos: string[]

  /** O passo abriu: frase inicial e o estado do corte, se ainda nao ha planos. */
  entrar: () => void
  escolherFrase: (fraseId: string) => void
  /** +1 / -1: a frase seguinte / anterior (setas). */
  andarFrase: (passo: 1 | -1) => void
  definirCenaAlvo: (k: number) => void
  definirFiltros: (patch: Partial<FiltrosNaTela>) => void
  carregarGrade: () => Promise<void>
  /** Clique no cartao: troca a cena alvo (o mesmo cartao de novo tira a cena). */
  trocarCena: (candidato: CandidatoDeCena, fraseId?: string) => void
  /** Shift/Ctrl+clique: mais uma cena na frase, comecando no meio do ultimo pedaco. */
  adicionarCena: (candidato: CandidatoDeCena, fraseId?: string) => void
  removerCena: (fraseId: string, k: number) => void
  /** "Completar" a cena k que ficou curta: emenda o plano seguinte do episodio (a pedido dele). */
  completarCena: (fraseId: string, k: number) => void
  /** Nova ordem das cenas (indices antigos). Os cortes ficam nas mesmas palavras. */
  reordenarCenas: (fraseId: string, ordem: readonly number[]) => void
  /** A barrinha rosa: a cena k (>= 1) passa a comecar na palavra `palavra`. */
  moverCorte: (fraseId: string, k: number, palavra: number) => void
  /** "Juntar em 1": a frase que o casar dividiu volta a uma cena (a melhor para a frase inteira). */
  juntarCenas: (fraseId: string) => void
  /** O cadeado da frase: travada, "Sugerir de novo" (todas) nao mexe nela. */
  travar: (fraseId: string, travada: boolean) => void
  /** "Sugerir de novo": uma frase (mesmo travada) ou, com null, todas as nao travadas. */
  sugerirDeNovo: (fraseId: string | null) => Promise<void>
  /**
   * (rodada 4) "Grid" (ligar) ou "Tela cheia" na frase: o main escolhe a outra
   * metade (a cena dele fica como uma das duas) e grava; a frase fica travada.
   */
  alternarGrid: (fraseId: string, ligar: boolean) => Promise<void>
  /**
   * (20/10) O "Grid" da frase, NA MAO: com mais de uma cena, ele escolhe na
   * esquerda a de cima (escolherCima); com uma, ela ja e a de cima. Depois o
   * clique na grade poe a de baixo (porEmbaixo). A sugestao do app entra
   * embaixo enquanto isso (quem nao quer escolher tem o grid de um clique).
   */
  pedirGrid: (fraseId: string) => void
  escolherCima: (k: number) => void
  /** O clique na grade com o grid na mao em andamento: a cena vai embaixo. */
  porEmbaixo: (candidato: CandidatoDeCena) => void
  /** O clique na metade de baixo, na esquerda: o proximo clique na grade troca so ela. */
  trocarDeBaixo: (fraseId: string, k: number) => void
  /** Inverter: a de cima vai para baixo e a de baixo para cima. */
  inverterGrid: (fraseId: string, k: number) => void
  /** Tirar a de baixo: a cena k volta a tela cheia. */
  tirarDeBaixo: (fraseId: string, k: number) => void
  /** "Manter a sugestao": a de baixo que o app pos fica (passa a ser dele). */
  manterSugestao: () => void
  /** Esc: o grid na mao para e a frase volta a como estava antes do "Grid". */
  cancelarGrid: () => void
  pedirMiniaturas: (episodioId: string, planoIds: readonly string[]) => void
  publicarVideo: (arquivo: string) => Promise<string | null>
  carregarAudio: (rascunhoId: string, takeId: string) => Promise<void>
  abrirPrevia: (previa: Omit<PreviaNoTocador, 'tocar'> & { tocar?: boolean }) => void
  fecharPrevia: () => void
  /** "Abrir no editor". `mesmoAssim` = o segundo clique da confirmacao. */
  abrirNoEditor: (mesmoAssim?: boolean) => Promise<void>
  desistirDeAbrir: () => void
  limparErro: () => void
  limparRecado: () => void
}

/**
 * (20/10) O grid na mao em andamento: 'cima' = ele escolhe na esquerda a
 * cena que fica em cima; 'baixo' = o proximo clique na grade (ou no player)
 * vai embaixo da cena `cena`. `antes` = a escolha de antes (o Esc volta a
 * ela); `buscando` = a sugestao do app ainda no main.
 */
export interface GridNaMao {
  fraseId: string
  etapa: 'cima' | 'baixo'
  cena: number
  antes: EscolhaDaFrase | null
  buscando: boolean
}

// ------------------------------------------------------------- constantes

/**
 * O hash que diz "esta escolha ficou velha, sugira de novo": nunca bate com
 * hashDoTexto de texto nenhum (64 bits zerados), entao escolhasDesatualizadas
 * poe a frase em `textoMudou` e o sugerirCenas a refaz (se nao travada). E a
 * regra do contrato -- o velho e dito pelo hash --, sem flag nova.
 */
const HASH_VELHO = '0000000000000000'

/** Espera depois do ultimo clique antes de gravar (cliques seguidos viram uma gravacao). */
const ESPERA_DA_GRAVACAO_MS = 400
/** O main publica ate 200 miniaturas por pedido. */
const MINIATURAS_POR_PEDIDO = 200
/** Espera curta para juntar os pedidos de miniatura de uma rolagem num pedido so. */
const ESPERA_DAS_MINIATURAS_MS = 40

const FILTROS_LIMPOS: FiltrosNaTela = { personagem: null, busca: '', vizinhasDe: null, duracao: 'qualquer' }

const LIMPO = {
  fraseAtiva: null,
  cenaAlvo: 0,
  filtros: FILTROS_LIMPOS,
  grade: null,
  pendentes: {},
  salvando: false,
  sugerindo: null,
  gridando: null,
  gridNaMao: null,
  encaixando: false,
  montando: false,
  etapaDaMontagem: null,
  confirmando: null,
  previa: null,
  erro: null,
  recado: null,
  avisos: [],
} satisfies Partial<EstadoDasCenasNaTela>

// ------------------------------------------------------------ puras (tela)

/** A mesma cena para a tela: o mesmo primeiro plano (o encaixe muda a janela e pode emendar o seguinte). */
export function mesmaCena(a: Pick<CandidatoDeCena, 'planoIds'>, b: Pick<CandidatoDeCena, 'planoIds'>): boolean {
  return a.planoIds[0] !== undefined && a.planoIds[0] === b.planoIds[0]
}

/** As escolhas como a tela mostra: as do disco com as pendentes por cima, na ordem do roteiro. */
export function cenasNaTela(
  r: Pick<RascunhoDoRecap, 'cenas'>,
  roteiro: Pick<Roteiro, 'secoes'>,
  pendentes: Readonly<Record<string, EscolhaDaFrase>>,
): EstadoDasCenas {
  const base = cenasDoRascunho(r)
  const novas = Object.values(pendentes)
  return novas.length === 0 ? base : aplicarEscolhas(base, novas, roteiro)
}

/** Os recados de cada frase (o ponto, o icone e o tooltip da coluna da esquerda). */
export interface AvisosDaFrase {
  semCena: boolean
  /**
   * Planos desta frase cujo TRECHO cruza o de outra cena (desta ou de outra
   * frase): o mesmo pedaco de video duas vezes. Plano longo usado por duas
   * frases em trechos diferentes nao conta (o casar faz isso de proposito).
   */
  repetidos: string[]
  /** As frases com que ela divide o trecho (o tooltip diz onde olhar). */
  repetidaCom: string[]
  /** Alguma cena emendou o plano seguinte (a frase e mais longa que o plano). */
  emendada: boolean
  /** A duracao e estimada (sem trecho do take para este texto). */
  estimada: boolean
  /** A escolha foi feita sobre outro texto e esta travada: conferir. */
  textoMudou: boolean
}

export function avisosDasFrases(
  roteiro: Pick<Roteiro, 'secoes'>,
  cenas: Pick<EstadoDasCenas, 'escolhas'>,
  take: Pick<TakeDaVoz, 'trechos' | 'palavras'> | null,
): Map<string, AvisosDaFrase> {
  // O trecho que cada cena mostra de verdade: da entrada ate o tempo dela na frase.
  const trechos: { plano: string; de: number; ate: number; fraseId: string; k: number }[] = []
  for (const f of frasesDoRoteiro(roteiro)) {
    const e = escolhaDaFrase(cenas, f.id)
    if (!e) continue
    const tempos = temposDasCenas(e, f, take)
    for (const [k, c] of e.cenas.entries()) {
      const t = tempos[k]
      // (rodada 4) As duas metades do grid mostram trecho de verdade: as duas contam.
      for (const cand of c.baixo ? [c.candidato, c.baixo] : [c.candidato]) {
        const de = cand.inSec
        const ate = Math.max(de + 0.05, Math.min(cand.outSec, de + (t ? t.fim - t.inicio : 0)))
        for (const id of cand.planoIds) trechos.push({ plano: id, de, ate, fraseId: f.id, k })
      }
    }
  }
  const saida = new Map<string, AvisosDaFrase>()
  for (const f of frasesDoRoteiro(roteiro)) {
    const e = escolhaDaFrase(cenas, f.id)
    const repetidos = new Set<string>()
    const repetidaCom = new Set<string>()
    for (const t of trechos.filter((x) => x.fraseId === f.id)) {
      for (const o of trechos) {
        if (o === t || o.plano !== t.plano || (o.fraseId === t.fraseId && o.k === t.k)) continue
        if (Math.min(o.ate, t.ate) - Math.max(o.de, t.de) <= 0.05) continue
        repetidos.add(t.plano)
        if (o.fraseId !== f.id) repetidaCom.add(o.fraseId)
      }
    }
    saida.set(f.id, {
      semCena: !e || e.cenas.length === 0,
      repetidos: [...repetidos],
      repetidaCom: [...repetidaCom],
      emendada: e ? e.cenas.some((c) => c.candidato.planoIds.length > 1) : false,
      estimada: !duracaoDaFrase(f, take).real,
      textoMudou: e !== null && e.travada && e.hashTexto !== hashDoTexto(f.texto),
    })
  }
  return saida
}

/** "12 de 14 frases com cena · 1 repetida": o resumo do rodape. */
export function resumoDasCenas(avisos: ReadonlyMap<string, AvisosDaFrase>): { total: number; semCena: number; repetidas: number } {
  let semCena = 0
  let repetidas = 0
  for (const a of avisos.values()) {
    if (a.semCena) semCena += 1
    if (a.repetidos.length > 0) repetidas += 1
  }
  return { total: avisos.size, semCena, repetidas }
}

// ------------------------------------------------------------- o indice

/**
 * O indice das cenas: o do passo 1 quando e o mesmo episodio e ja tem os
 * planos; senao o que o fim do corte trouxe; senao o que veio com o rascunho.
 * Sem planos em nenhum, o primeiro que for deste episodio (o passo 4 espera).
 *
 * Corte REFEITO ("Analisar de novo no Studio"): o passo 1 tem o indice novo,
 * ainda sem planos, e o do rascunho ou do corte anterior ainda tem os velhos
 * -- cujos mp4 podem nem existir mais. Enquanto o corte deste episodio nao
 * acabar, vale o do passo 1: o passo 4 espera, em vez de mostrar cenas velhas.
 */
function escolherIndice(
  episodioId: string | null,
  doPasso1: EpisodeIndex | null,
  doCorte: EpisodeIndex | null,
  doRascunho: EpisodeIndex | null,
): EpisodeIndex | null {
  if (!episodioId) return null
  if (doPasso1 && doPasso1.id === episodioId && !temPlanos(doPasso1) && statusDoCorte(doPasso1) !== 'pronto') return doPasso1
  const deste = [doPasso1, doCorte, doRascunho].filter((i): i is EpisodeIndex => i !== null && i.id === episodioId)
  return deste.find(temPlanos) ?? deste[0] ?? null
}

/** [recap] O indice com os planos mesclados pelo Dangai apontando o mesclado (a mesma copia enquanto nada muda). */
const comMesclasCache = new WeakMap<EpisodeIndex, { mesclas: unknown; indice: EpisodeIndex }>()
function comMesclas(indice: EpisodeIndex | null, mesclas: EstadoDasCenasNaTela['mesclas']): EpisodeIndex | null {
  if (!indice || !mesclas || mesclas.episodioId !== indice.id) return indice
  const guardado = comMesclasCache.get(indice)
  if (guardado && guardado.mesclas === mesclas) return guardado.indice
  const feito = aplicarMesclas(indice, mesclas.mapa)
  comMesclasCache.set(indice, { mesclas, indice: feito })
  return feito
}

export function indiceDasCenas(): EpisodeIndex | null {
  const r = useRoteiro.getState()
  const indice = escolherIndice(r.rascunho?.episodioId ?? null, useGerar.getState().indice, useCenas.getState().indiceDoCorte, r.indice)
  return comMesclas(indice, useCenas.getState().mesclas)
}

export function useIndiceDasCenas(): EpisodeIndex | null {
  const episodioId = useRoteiro((s) => s.rascunho?.episodioId ?? null)
  const doRascunho = useRoteiro((s) => s.indice)
  const doPasso1 = useGerar((s) => s.indice)
  const doCorte = useCenas((s) => s.indiceDoCorte)
  const mesclas = useCenas((s) => s.mesclas)
  return useMemo(
    () => comMesclas(escolherIndice(episodioId, doPasso1, doCorte, doRascunho), mesclas),
    [episodioId, doPasso1, doCorte, doRascunho, mesclas],
  )
}

// ------------------------------------------------------------- a fila

let fila: Promise<unknown> = Promise.resolve()
/** Poe a tarefa no fim da fila. Uma tarefa nunca chama naFila (esperaria por si mesma). */
function naFila<T>(tarefa: () => Promise<T>): Promise<T> {
  const vez = fila.then(tarefa, tarefa)
  fila = vez.catch(() => undefined)
  return vez
}

let relogioDaGravacao: ReturnType<typeof setTimeout> | null = null

/** O rascunho na tela ainda e este (ele nao trocou de episodio no meio). */
function ainda(id: string): boolean {
  return useRoteiro.getState().rascunho?.id === id
}

/**
 * Poe o rascunho que o main devolveu na store do roteiro, que e a dona dele.
 * So o MESMO rascunho, e so se nao for mais velho que o da tela (respostas
 * cruzadas chegam fora de ordem). A tela do roteiro (`tela`) nao muda.
 */
function trocarRascunho(novo: RascunhoDoRecap): void {
  const atual = useRoteiro.getState().rascunho
  if (!atual || atual.id !== novo.id) return
  if (atual.atualizadoEm > novo.atualizadoEm) return
  useRoteiro.setState({ rascunho: novo })
}

/** O que a frase precisa para ser encaixada na tela. null = sem rascunho, roteiro ou frase. */
interface ContextoDaFrase {
  rascunho: RascunhoDoRecap
  roteiro: Roteiro
  frase: Frase
  take: TakeDaVoz | null
  indice: EpisodeIndex
  cenas: EstadoDasCenas
}

function contextoDaFrase(fraseId: string): ContextoDaFrase | null {
  const rascunho = useRoteiro.getState().rascunho
  const roteiro = rascunho ? roteiroAtual(rascunho) : null
  const indice = indiceDasCenas()
  if (!rascunho || !roteiro || !indice) return null
  const frase = frasesDoRoteiro(roteiro).find((f) => f.id === fraseId)
  if (!frase) return null
  return {
    rascunho,
    roteiro,
    frase,
    take: takeAtual(rascunho),
    indice,
    cenas: cenasNaTela(rascunho, roteiro, useCenas.getState().pendentes),
  }
}

// Miniaturas: pedidas em lote (uma rolagem = um pedido), uma vez por plano e episodio.
const miniaturasPedidas = new Set<string>()
let miniaturasNaFila: { episodioId: string; ids: string[] } | null = null
let relogioDasMiniaturas: ReturnType<typeof setTimeout> | null = null
/** Publicacoes de video no ar (o mesmo arquivo pedido por dois cartoes vira um pedido). */
const videosNoAr = new Map<string, Promise<string | null>>()
const audiosNoAr = new Set<string>()

/** Cache da grade por chave (voltar a uma frase e instantaneo). Zera com o rascunho. */
const gradesVistas = new Map<string, CandidatosDaFrase>()

/**
 * Grava as pendentes. SO DENTRO DA FILA. Frase que saiu do roteiro (ele
 * voltou e apagou) e descartada: o salvarCenas recusaria a lista inteira.
 * false = falhou (o erro ja esta na tela) ou o rascunho mudou.
 */
async function gravarPendentes(): Promise<boolean> {
  if (relogioDaGravacao) {
    clearTimeout(relogioDaGravacao)
    relogioDaGravacao = null
  }
  const id = useCenas.getState().rascunhoId
  if (!id || !ainda(id)) return false
  const rascunho = useRoteiro.getState().rascunho
  const roteiro = rascunho ? roteiroAtual(rascunho) : null
  if (!roteiro) return false
  const noRoteiro = new Set(frasesDoRoteiro(roteiro).map((f) => f.id))
  const todas = useCenas.getState().pendentes
  const enviadas = Object.values(todas).filter((e) => noRoteiro.has(e.fraseId))
  if (enviadas.length !== Object.keys(todas).length) {
    useCenas.setState({ pendentes: Object.fromEntries(enviadas.map((e) => [e.fraseId, e])) })
  }
  if (enviadas.length === 0) return true
  useCenas.setState({ salvando: true })
  const r = await ponte.salvarCenas(id, enviadas)
  if (useCenas.getState().rascunhoId !== id) return false
  if (!r.ok) {
    useCenas.setState({ salvando: false, erro: r.error })
    return false
  }
  trocarRascunho(r.value.rascunho)
  // Sai da pendente so o que foi gravado e nao mudou depois (o clique de agora continua por cima).
  const pendentes = { ...useCenas.getState().pendentes }
  for (const e of enviadas) if (pendentes[e.fraseId] === e) delete pendentes[e.fraseId]
  useCenas.setState({ salvando: false, pendentes })
  return true
}

/** O autosave: cliques seguidos viram uma gravacao so. */
function agendarGravacao(): void {
  if (relogioDaGravacao) clearTimeout(relogioDaGravacao)
  relogioDaGravacao = setTimeout(() => {
    relogioDaGravacao = null
    void naFila(gravarPendentes).finally(agendarConferencia)
  }, ESPERA_DA_GRAVACAO_MS)
}

export const useCenas = create<EstadoDasCenasNaTela>((set, get) => {
  /**
   * Muda a escolha da frase na tela: aplica `mudar`, carimba o texto de agora
   * e `travada` (ele escolheu), encaixa na voz na hora e agenda a gravacao.
   */
  const mudarEscolha = (
    fraseId: string,
    mudar: (atual: EscolhaDaFrase | null, ctx: ContextoDaFrase) => EscolhaDaFrase | null,
  ): void => {
    const ctx = contextoDaFrase(fraseId)
    if (!ctx) return
    const atual = escolhaDaFrase(ctx.cenas, fraseId)
    const nova = mudar(atual, ctx)
    if (!nova) return
    // "Longe do momento" falava da cena SUGERIDA: a escolhida a mao nao herda.
    const marcada: EscolhaDaFrase = {
      ...nova,
      travada: true,
      hashTexto: hashDoTexto(ctx.frase.texto),
      avisos: nova.avisos.filter((a) => a !== AVISO_LONGE_DO_MOMENTO),
    }
    const { escolha, avisos } = encaixarEscolha(marcada, { indice: ctx.indice, frase: ctx.frase, take: ctx.take })
    // (20/10) A cena posta a mao que nao cobre o pedaco fica (o fim congela): o recado diz, ele decide.
    const curta = avisos.map((a) => a.slice(a.indexOf(': ') + 2)).find((a) => a.startsWith(PREFIXO_CENA_CURTA_DELE))
    const recadoAntes = get().recado
    const recado = curta
      ? curta.endsWith(SUFIXO_METADE_DO_GRID)
        ? `Cena curta: ${curta.slice(PREFIXO_CENA_CURTA_DELE.length)}. O fim fica parado; troque a cena ou volte a Tela cheia.`
        : `Cena curta: ${curta.slice(PREFIXO_CENA_CURTA_DELE.length)}. O fim fica parado; "completar" na cena emenda o plano seguinte.`
      : recadoAntes?.startsWith('Cena curta: ')
        ? null
        : recadoAntes
    set({ pendentes: { ...get().pendentes, [fraseId]: escolha }, confirmando: null, recado })
    agendarGravacao()
  }

  /** O candidato que ele clicou: posto a mao (o encaixe nunca o troca pelo vizinho). */
  const dele = (c: CandidatoDeCena): CandidatoDeCena => (c.origem === 'usuario' ? c : { ...c, origem: 'usuario' })

  /** A escolha nova de uma frase que ainda nao tinha: a fita e a da grade, se for dela. */
  const escolhaVazia = (ctx: ContextoDaFrase): EscolhaDaFrase => {
    const grade = get().grade?.valor
    return {
      fraseId: ctx.frase.id,
      cenas: [],
      fita: grade && grade.fraseId === ctx.frase.id ? grade.sugestoes.slice(0, FITA_MAX) : [],
      confianca: 0,
      travada: true,
      hashTexto: hashDoTexto(ctx.frase.texto),
      duracao: duracaoDaFrase(ctx.frase, ctx.take).duracao,
      avisos: [],
    }
  }

  const fraseDoClique = (fraseId?: string): string | null => fraseId ?? get().fraseAtiva

  const pedirMiniaturasAgora = async (): Promise<void> => {
    const lote = miniaturasNaFila
    miniaturasNaFila = null
    if (!lote) return
    for (let i = 0; i < lote.ids.length; i += MINIATURAS_POR_PEDIDO) {
      const pedaco = lote.ids.slice(i, i + MINIATURAS_POR_PEDIDO)
      const r = await ponte.miniaturasDasCenas(lote.episodioId, pedaco)
      // A miniatura e apoio: falhar deixa o quadro vazio, sem recado.
      if (!r.ok) {
        for (const id of pedaco) miniaturasPedidas.delete(`${lote.episodioId}|${id}`)
        continue
      }
      if (get().episodioDasMiniaturas !== lote.episodioId) return
      set({ miniaturas: { ...get().miniaturas, ...r.value } })
    }
  }

  return {
    rascunhoId: null,
    ...LIMPO,
    personagens: [],
    miniaturas: {},
    episodioDasMiniaturas: null,
    videos: {},
    audios: {},
    corte: null,
    episodioDoCorte: null,
    indiceDoCorte: null,
    mesclas: null,

    carregarMesclas: async () => {
      const episodioId = useRoteiro.getState().rascunho?.episodioId ?? null
      if (!episodioId) return
      const r = await ponte.mesclasDoEpisodio(episodioId)
      if (!r.ok || useRoteiro.getState().rascunho?.episodioId !== episodioId) return
      const antes = get().mesclas
      // Igual ao que ja estava: nada muda (o indice da tela fica o mesmo objeto).
      if (antes && antes.episodioId === episodioId && JSON.stringify(antes.mapa) === JSON.stringify(r.value)) return
      set({ mesclas: { episodioId, mapa: r.value } })
    },

    entrar: () => {
      sincronizarRascunho()
      const rascunho = useRoteiro.getState().rascunho
      const roteiro = rascunho ? roteiroAtual(rascunho) : null
      if (!rascunho || !roteiro) return
      const frases = frasesDoRoteiro(roteiro)
      const ativa = get().fraseAtiva
      if (!ativa || !frases.some((f) => f.id === ativa)) {
        // Abre na primeira frase sem cena (o que falta fazer); sem nenhuma, na primeira.
        const cenas = cenasNaTela(rascunho, roteiro, get().pendentes)
        const sem = frases.find((f) => (escolhaDaFrase(cenas, f.id)?.cenas.length ?? 0) === 0)
        set({ fraseAtiva: (sem ?? frases[0])?.id ?? null, cenaAlvo: 0 })
      }
      set({ recado: null, confirmando: null })
      // (rodada 4) O modo do grid da config: mudou desde o ultimo encaixe = o grid roda de novo.
      void ponte.lerConfig().then((c) => {
        if (c.ok) avisarModoDoGrid(c.value.cenas.grid)
      })
      // O2: o app fechou no meio do "Abrir no editor": o rodape avisa (uma vez).
      const rascunhoId = rascunho.id
      void ponte.montagemInterrompida(rascunhoId).then((r) => {
        if (r.ok && r.value && useRoteiro.getState().rascunho?.id === rascunhoId && !get().montando) {
          set({ recado: 'O Abrir no editor parou no meio: o app fechou. Abra de novo.' })
        }
      })
      // Entrar no passo e um pedido explicito: o automatico que falhou antes tenta de novo, uma vez.
      ultimaSugestao = null
      ultimoEncaixe = null
      agendarConferencia()
      // Sem planos ainda: o estado do corte vem do main (os eventos seguem pelo escutarCenas).
      const indice = indiceDasCenas()
      if (indice && !temPlanos(indice)) {
        const episodioId = rascunho.episodioId
        void ponte.estadoDoCorte(episodioId).then((r) => {
          if (r.ok && useRoteiro.getState().rascunho?.episodioId === episodioId) set({ corte: r.value, episodioDoCorte: episodioId })
        })
      }
    },

    escolherFrase: (fraseId) => {
      if (get().fraseAtiva === fraseId) return
      const previa = get().previa
      set({
        fraseAtiva: fraseId,
        cenaAlvo: 0,
        // O grid na mao e da frase aberta: trocar de frase para (o que ja foi feito fica).
        gridNaMao: null,
        filtros: { ...get().filtros, vizinhasDe: null },
        // O player aberto segue a frase (setas para cima e para baixo dentro dele).
        ...(previa ? { previa: { fraseId, candidato: null, tocar: previa.tocar } } : {}),
      })
    },

    andarFrase: (passo) => {
      const rascunho = useRoteiro.getState().rascunho
      const roteiro = rascunho ? roteiroAtual(rascunho) : null
      if (!roteiro) return
      const frases = frasesDoRoteiro(roteiro)
      const i = frases.findIndex((f) => f.id === get().fraseAtiva)
      const alvo = frases[Math.min(frases.length - 1, Math.max(0, i + passo))]
      if (alvo) get().escolherFrase(alvo.id)
    },

    definirCenaAlvo: (k) => set({ cenaAlvo: Math.max(0, k) }),

    definirFiltros: (patch) => set({ filtros: { ...get().filtros, ...patch } }),

    carregarGrade: async () => {
      const { rascunhoId, fraseAtiva, filtros } = get()
      const rascunho = useRoteiro.getState().rascunho
      if (!rascunhoId || !fraseAtiva || !rascunho || rascunho.id !== rascunhoId) return
      const busca = filtros.busca.trim()
      // A sugestao gravada muda a fita (e o que esta "na fita" sai das vizinhas): pede de novo.
      const fita = escolhaDaFrase(cenasDoRascunho(rascunho), fraseAtiva)?.fita.map((c) => c.planoIds.join('+')).join(',') ?? ''
      const chave = [rascunhoId, fraseAtiva, filtros.personagem ?? '', busca, filtros.vizinhasDe ?? '', fita].join('|')
      const atual = get().grade
      if (atual?.chave === chave && (atual.valor || atual.carregando)) return
      const vista = gradesVistas.get(chave)
      if (vista) {
        set({ grade: { chave, valor: vista, carregando: false, erro: null } })
        return
      }
      // Enquanto a nova chega, a anterior fica na tela (sem piscar a grade vazia).
      set({ grade: { chave, valor: atual?.valor ?? null, carregando: true, erro: null } })
      const r = await ponte.candidatosDaFrase(rascunhoId, fraseAtiva, {
        personagem: filtros.personagem,
        busca: busca || null,
        vizinhasDe: filtros.vizinhasDe,
      })
      if (r.ok) gradesVistas.set(chave, r.value)
      if (get().grade?.chave !== chave) return
      if (!r.ok) {
        set({ grade: { chave, valor: null, carregando: false, erro: r.error } })
        return
      }
      // A lista e do EPISODIO (a mesma em toda frase): vazia tambem vale -- senao
      // o episodio sem personagens mostrava os chips do anterior.
      set({ grade: { chave, valor: r.value, carregando: false, erro: null }, personagens: r.value.personagens })
    },

    trocarCena: (candidato, fraseId) => {
      const id = fraseDoClique(fraseId)
      if (!id) return
      if (get().gridNaMao?.fraseId === id) return get().porEmbaixo(candidato)
      mudarEscolha(id, (atual, ctx) => {
        const base = atual ?? escolhaVazia(ctx)
        // (rodada 4) O cartao da metade de baixo do grid, de novo: sai so ela (a cena fica cheia).
        const deBaixo = base.cenas.findIndex((c) => c.baixo !== undefined && mesmaCena(c.baixo, candidato))
        if (deBaixo >= 0) {
          const cenas = base.cenas.map((c, k) => {
            if (k !== deBaixo) return c
            const cheia = { ...c }
            delete cheia.baixo
            return cheia
          })
          return { ...base, cenas }
        }
        const ja = base.cenas.findIndex((c) => mesmaCena(c.candidato, candidato))
        // O mesmo cartao de novo tira a cena (como a selecao do Dangai: "clique para tirar").
        if (ja >= 0) {
          const cenas = base.cenas.filter((_, k) => k !== ja).map((c, k) => (k === 0 ? { ...c, palavraInicio: 0 } : c))
          set({ cenaAlvo: Math.max(0, Math.min(get().cenaAlvo, cenas.length - 1)) })
          return { ...base, cenas }
        }
        if (base.cenas.length === 0) return { ...base, cenas: [{ candidato: dele(candidato), palavraInicio: 0 }] }
        const alvo = Math.min(get().cenaAlvo, base.cenas.length - 1)
        return { ...base, cenas: base.cenas.map((c, k) => (k === alvo ? { ...c, candidato: dele(candidato) } : c)) }
      })
    },

    adicionarCena: (candidato, fraseId) => {
      const id = fraseDoClique(fraseId)
      if (!id) return
      if (get().gridNaMao?.fraseId === id) return get().porEmbaixo(candidato)
      mudarEscolha(id, (atual, ctx) => {
        const base = atual ?? escolhaVazia(ctx)
        if (base.cenas.length === 0) return { ...base, cenas: [{ candidato: dele(candidato), palavraInicio: 0 }] }
        if (base.cenas.some((c) => mesmaCena(c.candidato, candidato))) return null
        // A nova entra no meio do ultimo pedaco; a barrinha rosa ajusta a palavra.
        const n = palavrasNaFrase(ctx.frase.texto)
        const ultima = base.cenas[base.cenas.length - 1]!.palavraInicio
        if (n - ultima < 2) {
          set({ recado: 'Frase curta para mais uma cena.' })
          return null
        }
        const palavraInicio = ultima + Math.floor((n - ultima) / 2)
        set({ cenaAlvo: base.cenas.length })
        return { ...base, cenas: [...base.cenas, { candidato: dele(candidato), palavraInicio }] }
      })
    },

    completarCena: (fraseId, k) => {
      mudarEscolha(fraseId, (atual, ctx) => {
        const cena = atual?.cenas[k]
        if (!atual || !cena || cena.baixo) return null
        const planos = ctx.indice.planos
        const ultimo = cena.candidato.planoIds[cena.candidato.planoIds.length - 1]
        const i = planos.findIndex((p) => p.id === ultimo)
        const seguinte = i >= 0 ? planos[i + 1] : undefined
        if (!seguinte || planoExcluido(seguinte, ctx.indice.exclusoes)) {
          set({ recado: 'Sem plano seguinte para completar esta cena.' })
          return null
        }
        const candidato: CandidatoDeCena = {
          ...dele(cena.candidato),
          planoIds: [...cena.candidato.planoIds, seguinte.id],
          outSec: seguinte.end,
        }
        return { ...atual, cenas: atual.cenas.map((c, j) => (j === k ? { ...c, candidato } : c)) }
      })
    },

    removerCena: (fraseId, k) => {
      mudarEscolha(fraseId, (atual) => {
        if (!atual || !atual.cenas[k]) return null
        const cenas = atual.cenas.filter((_, i) => i !== k).map((c, i) => (i === 0 ? { ...c, palavraInicio: 0 } : c))
        set({ cenaAlvo: Math.max(0, Math.min(get().cenaAlvo, cenas.length - 1)) })
        return { ...atual, cenas }
      })
    },

    reordenarCenas: (fraseId, ordem) => {
      mudarEscolha(fraseId, (atual) => {
        if (!atual || ordem.length !== atual.cenas.length) return null
        // Os cortes sao das PALAVRAS: as cenas trocam de lugar, as palavras de inicio ficam.
        // A metade de baixo do grid anda junto com a de cima (o par e da cena).
        const cenas = ordem.map((de, k) => {
          const { baixo } = atual.cenas[de]!
          return { candidato: atual.cenas[de]!.candidato, palavraInicio: atual.cenas[k]!.palavraInicio, ...(baixo ? { baixo } : {}) }
        })
        if (cenas.every((c, k) => c.candidato === atual.cenas[k]!.candidato)) return null
        const alvo = ordem.indexOf(get().cenaAlvo)
        set({ cenaAlvo: alvo >= 0 ? alvo : 0 })
        return { ...atual, cenas }
      })
    },

    moverCorte: (fraseId, k, palavra) => {
      mudarEscolha(fraseId, (atual, ctx) => {
        if (!atual || k < 1 || !atual.cenas[k]) return null
        const n = palavrasNaFrase(ctx.frase.texto)
        const minimo = atual.cenas[k - 1]!.palavraInicio + 1
        const maximo = (atual.cenas[k + 1]?.palavraInicio ?? n) - 1
        const alvo = Math.min(maximo, Math.max(minimo, palavra))
        if (alvo === atual.cenas[k]!.palavraInicio || maximo < minimo) return null
        return { ...atual, cenas: atual.cenas.map((c, i) => (i === k ? { ...c, palavraInicio: alvo } : c)) }
      })
    },

    juntarCenas: (fraseId) => {
      mudarEscolha(fraseId, (atual) => {
        const junta = atual ? juntarEmUma(atual) : null
        if (junta) set({ cenaAlvo: 0 })
        return junta
      })
    },

    travar: (fraseId, travada) => {
      const ctx = contextoDaFrase(fraseId)
      const atual = ctx ? escolhaDaFrase(ctx.cenas, fraseId) : null
      if (!atual || atual.travada === travada) return
      // So o cadeado muda: as cenas e o encaixe ficam como estao.
      set({ pendentes: { ...get().pendentes, [fraseId]: { ...atual, travada } }, confirmando: null })
      agendarGravacao()
    },

    sugerirDeNovo: async (fraseId) => {
      const id = get().rascunhoId
      const rascunho = useRoteiro.getState().rascunho
      const roteiro = rascunho ? roteiroAtual(rascunho) : null
      const noAr = get().sugerindo
      // O automatico no ar nao barra: os dois vao pela mesma fila.
      if (!id || !rascunho || !roteiro || rascunho.id !== id || (noAr !== null && noAr !== 'auto')) return
      const cenas = cenasNaTela(rascunho, roteiro, get().pendentes)
      // Marca como velhas (HASH_VELHO): a frase pedida mesmo travada; em "todas", so as nao travadas.
      const velhas = cenas.escolhas
        .filter((e) => (fraseId ? e.fraseId === fraseId : !e.travada))
        .map((e) => ({ ...e, travada: false, hashTexto: HASH_VELHO }))
      const semEscolha = frasesDoRoteiro(roteiro).some((f) => !escolhaDaFrase(cenas, f.id))
      if (velhas.length === 0 && !semEscolha && !fraseId) {
        set({ recado: 'Todas as frases foram escolhidas por voce.' })
        return
      }
      const pendentes = { ...get().pendentes }
      for (const e of velhas) pendentes[e.fraseId] = e
      set({ pendentes, sugerindo: fraseId ?? 'todas', erro: null, recado: null, confirmando: null })
      const ok = await naFila(async () => {
        if (!(await gravarPendentes())) return false
        const r = await ponte.sugerirCenas(id)
        if (!ainda(id)) return false
        if (!r.ok) {
          set({ erro: r.error })
          return false
        }
        trocarRascunho(r.value.rascunho)
        gradesVistas.clear()
        set({ avisos: r.value.avisos })
        return encaixarSePreciso(id)
      })
      if (get().rascunhoId === id) set({ sugerindo: null, ...(ok && !fraseId ? { recado: 'Sugestoes refeitas.' } : {}) })
      agendarConferencia()
    },

    alternarGrid: async (fraseId, ligar) => {
      const id = get().rascunhoId
      const rascunho = useRoteiro.getState().rascunho
      if (!id || !rascunho || rascunho.id !== id || get().gridando || get().montando) return
      // (20/10) "Tela cheia" tambem encerra o grid na mao em andamento.
      const naMao = get().gridNaMao?.fraseId === fraseId ? null : get().gridNaMao
      set({ gridando: fraseId, gridNaMao: naMao, erro: null, recado: null, confirmando: null })
      await naFila(async () => {
        if (!(await gravarPendentes())) return
        const r = await ponte.gridDaFrase(id, fraseId, ligar)
        if (!ainda(id)) return
        if (!r.ok) {
          set({ erro: r.error })
          return
        }
        trocarRascunho(r.value.rascunho)
      })
      if (get().rascunhoId === id) set({ gridando: null })
      agendarConferencia()
    },

    pedirGrid: (fraseId) => {
      const ctx = contextoDaFrase(fraseId)
      if (!ctx || get().montando) return
      const atual = escolhaDaFrase(ctx.cenas, fraseId)
      if (!atual || atual.cenas.length === 0) {
        set({ recado: 'Escolha uma cena nesta frase antes do grid.' })
        return
      }
      set({ gridNaMao: { fraseId, etapa: 'cima', cena: 0, antes: atual, buscando: false }, recado: null, confirmando: null })
      // Uma cena so: ela ja e a de cima.
      if (atual.cenas.length === 1) get().escolherCima(0)
    },

    escolherCima: (k) => {
      const g = get().gridNaMao
      if (!g || g.etapa !== 'cima') return
      const id = get().rascunhoId
      set({ gridNaMao: { ...g, etapa: 'baixo', cena: k, buscando: id !== null }, cenaAlvo: k })
      if (!id) return
      // A sugestao do app vai embaixo enquanto ele nao escolhe (o grid de um clique continua).
      const vale = (): boolean => {
        const x = get().gridNaMao
        return x !== null && x.fraseId === g.fraseId && x.etapa === 'baixo' && x.cena === k
      }
      void naFila(async () => {
        if (!(await gravarPendentes()) || !vale()) {
          if (vale()) set({ gridNaMao: { ...get().gridNaMao!, buscando: false } })
          return
        }
        const r = await ponte.gridDaFrase(id, g.fraseId, true, k)
        if (!ainda(id)) return
        if (r.ok) trocarRascunho(r.value.rascunho)
        if (!vale()) return
        // Sem sugestao que sirva (ou sem voz ainda): nada muda, ele escolhe na grade.
        set({ gridNaMao: { ...get().gridNaMao!, buscando: false } })
        if (!r.ok) set({ recado: r.error })
        else if (r.value.avisos.includes(SEM_SUGESTAO_DE_BAIXO)) set({ recado: null })
      })
    },

    porEmbaixo: (candidato) => {
      const g = get().gridNaMao
      if (!g) return
      if (g.etapa === 'cima') {
        set({ recado: 'Primeiro clique, na esquerda, na cena que fica em cima.' })
        return
      }
      let feito = false
      mudarEscolha(g.fraseId, (atual, ctx) => {
        const cena = atual?.cenas[g.cena]
        if (!atual || !cena) return null
        if (cena.candidato.planoIds[0] === candidato.planoIds[0]) {
          set({ recado: 'Essa cena ja esta em cima. Clique em outra.' })
          return null
        }
        const planos = new Map(ctx.indice.planos.map((p) => [p.id, p]))
        const t = temposDasCenas(atual, ctx.frase, ctx.take)[g.cena]
        const dura = t ? t.fim - t.inicio : 0
        feito = true
        return comGridNaMao(atual, g.cena, metadeDeCima(cena, dura, planos), metadeDeBaixoDele(candidato, dura, planos))
      })
      if (feito) set({ gridNaMao: null })
    },

    trocarDeBaixo: (fraseId, k) => {
      const ctx = contextoDaFrase(fraseId)
      const atual = ctx ? escolhaDaFrase(ctx.cenas, fraseId) : null
      if (!atual?.cenas[k]?.baixo) return
      set({ gridNaMao: { fraseId, etapa: 'baixo', cena: k, antes: atual, buscando: false }, cenaAlvo: k, recado: null })
    },

    inverterGrid: (fraseId, k) => {
      mudarEscolha(fraseId, (atual) => (atual ? inverterMetades(atual, k) : null))
      if (get().gridNaMao?.fraseId === fraseId) set({ gridNaMao: null })
    },

    tirarDeBaixo: (fraseId, k) => {
      mudarEscolha(fraseId, (atual) => (atual ? tirarMetadeDeBaixo(atual, k) : null))
      if (get().gridNaMao?.fraseId === fraseId) set({ gridNaMao: null })
    },

    manterSugestao: () => {
      const g = get().gridNaMao
      if (!g) return
      set({ gridNaMao: null })
      mudarEscolha(g.fraseId, (atual) => {
        const cena = atual?.cenas[g.cena]
        if (!atual || !cena?.baixo || cena.baixo.origem === 'usuario') return null
        return comGridNaMao(atual, g.cena, dele(cena.candidato), dele(cena.baixo))
      })
    },

    cancelarGrid: () => {
      const g = get().gridNaMao
      if (!g) return
      set({ gridNaMao: null, recado: null })
      const ctx = contextoDaFrase(g.fraseId)
      const atual = ctx ? escolhaDaFrase(ctx.cenas, g.fraseId) : null
      // Com a sugestao ainda no main, a de antes vai para as pendentes do mesmo jeito: ela chega e nao vale.
      if (!g.antes || !atual || (!g.buscando && JSON.stringify(atual) === JSON.stringify(g.antes))) return
      // Volta exatamente ao de antes do "Grid" (a sugestao do app que entrou sai).
      set({ pendentes: { ...get().pendentes, [g.fraseId]: g.antes }, confirmando: null })
      agendarGravacao()
    },

    pedirMiniaturas: (episodioId, planoIds) => {
      if (get().episodioDasMiniaturas !== episodioId) {
        miniaturasPedidas.clear()
        miniaturasNaFila = null
        set({ episodioDasMiniaturas: episodioId, miniaturas: {} })
      }
      const ja = get().miniaturas
      const novos = [...new Set(planoIds)].filter((p) => !(p in ja) && !miniaturasPedidas.has(`${episodioId}|${p}`))
      if (novos.length === 0) return
      for (const p of novos) miniaturasPedidas.add(`${episodioId}|${p}`)
      miniaturasNaFila = { episodioId, ids: [...(miniaturasNaFila?.ids ?? []), ...novos] }
      if (relogioDasMiniaturas) return
      relogioDasMiniaturas = setTimeout(() => {
        relogioDasMiniaturas = null
        void pedirMiniaturasAgora()
      }, ESPERA_DAS_MINIATURAS_MS)
    },

    publicarVideo: (arquivo) => {
      const pronta = get().videos[arquivo]
      if (pronta) return Promise.resolve(pronta)
      const noAr = videosNoAr.get(arquivo)
      if (noAr) return noAr
      const pedido = window.dangai.libraryClipUrl(arquivo).then((r) => {
        videosNoAr.delete(arquivo)
        if (!r.ok) return null
        set({ videos: { ...get().videos, [arquivo]: r.value } })
        return r.value
      })
      videosNoAr.set(arquivo, pedido)
      return pedido
    },

    carregarAudio: async (rascunhoId, takeId) => {
      const chave = `${rascunhoId}:${takeId}`
      if (get().audios[chave] || audiosNoAr.has(chave)) return
      audiosNoAr.add(chave)
      const r = await ponte.urlDoAudio(rascunhoId, takeId)
      audiosNoAr.delete(chave)
      if (r.ok) set({ audios: { ...get().audios, [chave]: r.value } })
    },

    abrirPrevia: (previa) => {
      // O player toca a frase ABERTA (a grade, a fita e as setas sao dela).
      if (previa.fraseId !== get().fraseAtiva) get().escolherFrase(previa.fraseId)
      set({ previa: { fraseId: previa.fraseId, candidato: previa.candidato, tocar: previa.tocar ?? true } })
    },
    fecharPrevia: () => set({ previa: null }),

    abrirNoEditor: async (mesmoAssim = false) => {
      const id = get().rascunhoId
      const rascunho = useRoteiro.getState().rascunho
      const roteiro = rascunho ? roteiroAtual(rascunho) : null
      if (!id || !rascunho || !roteiro || rascunho.id !== id || get().montando) return
      if (!podeIrParaCenas(rascunho, roteiro)) {
        set({ erro: 'Aprove a voz antes.' })
        return
      }
      const cenas = cenasNaTela(rascunho, roteiro, get().pendentes)
      const avisos = avisosDasFrases(roteiro, cenas, takeAtual(rascunho))
      const semCena = resumoDasCenas(avisos).semCena
      const confirmado = mesmoAssim ? get().confirmando : null
      // Duas perguntas possiveis, uma de cada vez: frase sem cena e projeto aberto por salvar.
      if (semCena > 0 && confirmado === null) {
        set({ confirmando: 'sem-cena' })
        return
      }
      // "Nao salvo" so com projeto de verdade aberto: o "Limpar" da tela inicial deixa o
      // flag ligado sem narracao nenhuma (e sem narracao nao ha o que salvar).
      const projeto = nucleo()
      if (projeto.ler().projectDirty && projeto.paraArquivo() !== null && confirmado !== 'nao-salvo') {
        set({ confirmando: 'nao-salvo' })
        return
      }
      set({ confirmando: null, montando: true, etapaDaMontagem: null, erro: null, recado: null })
      // O rodape diz o que esta rodando (a Edicao rapida leva ~20 s).
      const pararDeOuvir = ponte.onMontarProgresso((e) => {
        if (e.rascunhoId === id && get().montando) set({ etapaDaMontagem: e.texto })
      })
      const montado = await naFila(async () => {
        if (!(await gravarPendentes())) return null
        if (!(await encaixarSePreciso(id))) return null
        // A caixinha "Edicao rapida" do rodape: o projeto ja chega com som, rosto e legenda.
        const r = await ponte.montarProjeto(id, await pedidoDaMontagem())
        if (!r.ok) {
          set({ erro: r.error })
          return null
        }
        return r.value
      }).finally(pararDeOuvir)
      if (!montado || !ainda(id)) {
        set({ montando: false, etapaDaMontagem: null })
        return
      }
      set({ etapaDaMontagem: 'Abrindo no editor...' })
      // [recap] O caminho normal do nucleo (o mesmo do "Abrir projeto").
      await nucleo().abrirProjeto(montado.projetoPath)
      set({ montando: false, etapaDaMontagem: null, avisos: montado.avisos })
      // O abrirProjeto poe a falha no erro do editor e nao devolve nada: abriu = o caminho e o dele.
      if (nucleo().ler().projectPath !== montado.projetoPath) {
        set({ erro: nucleo().ler().error ?? 'Nao deu para abrir o projeto.' })
        return
      }
      // A voz e a do take alinhado: a transcricao fica travada (o arquivo ja
      // nasce com `transcriptTravado`; isto so cobre um nucleo que nao leu).
      if (!nucleo().ler().transcriptTravado) nucleo().travarTranscript(true)
      useGerar.getState().fechar()
      // O que a Edicao rapida fez aparece no botao dela, na barra do editor.
      if (montado.edicaoRapida) useEdicaoRapida.getState().mostrarResumo(montado.edicaoRapida, 'montagem')
    },

    desistirDeAbrir: () => set({ confirmando: null }),
    limparErro: () => set({ erro: null }),
    limparRecado: () => set({ recado: null }),
  }
})

// --------------------------------------------- encaixe e sugestao (fila)

/**
 * O encaixe esta velho para o take de agora: outro take, duracao mudou, ou
 * sugestao depois do ultimo encaixe. (rodada 4) Tambem quando o grid nunca
 * rodou neste rascunho, ou rodou num modo que a config nao tem mais: o passo
 * do grid mora no fim do encaixe.
 */
function encaixeAtrasado(roteiro: Roteiro, take: TakeDaVoz | null, cenas: EstadoDasCenas): boolean {
  if (cenas.escolhas.length === 0) return false
  const d = escolhasDesatualizadas(roteiro, take, cenas)
  const gridVelho = take !== null && (!cenas.grid || (modoDoGridAtual !== null && cenas.grid.modo !== modoDoGridAtual))
  return (
    d.encaixeVelho ||
    d.duracaoMudou.length > 0 ||
    cenas.encaixadoEm === null ||
    (cenas.sugeridasEm !== null && cenas.sugeridasEm > cenas.encaixadoEm) ||
    gridVelho
  )
}

/** (rodada 4) O modo do grid da config (null = ainda nao lido): o encaixe refaz o grid quando muda. */
let modoDoGridAtual: ModoDoGrid | null = null

/** A config mudou o grid (ou foi lida ao entrar no passo 4): o grid do rascunho aberto e refeito. */
export function avisarModoDoGrid(modo: ModoDoGrid): void {
  if (modoDoGridAtual === modo) return
  modoDoGridAtual = modo
  ultimoEncaixe = null
  agendarConferencia()
}

/**
 * encaixarNaVoz quando a voz esta aprovada e o encaixe ficou velho. SO DENTRO
 * DA FILA. false = falhou (o erro ja esta na tela).
 */
async function encaixarSePreciso(id: string): Promise<boolean> {
  const rascunho = useRoteiro.getState().rascunho
  const roteiro = rascunho ? roteiroAtual(rascunho) : null
  if (!rascunho || !roteiro || rascunho.id !== id) return false
  if (!podeIrParaCenas(rascunho, roteiro)) return true
  if (!encaixeAtrasado(roteiro, takeAtual(rascunho), cenasDoRascunho(rascunho))) return true
  useCenas.setState({ encaixando: true })
  const r = await ponte.encaixarNaVoz(id)
  if (useCenas.getState().rascunhoId === id) useCenas.setState({ encaixando: false })
  if (!ainda(id)) return false
  if (!r.ok) {
    useCenas.setState({ erro: r.error })
    return false
  }
  trocarRascunho(r.value.rascunho)
  if (r.value.avisos.length > 0) useCenas.setState({ avisos: r.value.avisos })
  return true
}

/**
 * O rascunho da store do roteiro trocou (outro episodio): o que era do
 * anterior sai. Pendentes do anterior ainda vao para o disco dele.
 */
function sincronizarRascunho(): void {
  const r = useRoteiro.getState().rascunho
  const id = r?.id ?? null
  const s = useCenas.getState()
  if (s.rascunhoId === id) return
  const anterior = s.rascunhoId
  const sobras = Object.values(s.pendentes)
  if (anterior && sobras.length > 0) void naFila(() => ponte.salvarCenas(anterior, sobras))
  if (relogioDaGravacao) {
    clearTimeout(relogioDaGravacao)
    relogioDaGravacao = null
  }
  gradesVistas.clear()
  useCenas.setState({
    rascunhoId: id,
    ...LIMPO,
    // Os chips sao do episodio do rascunho: trocar de rascunho comeca sem eles.
    personagens: [],
    // O corte e do episodio, nao do rascunho: so cai quando o episodio muda.
    ...(r && s.episodioDoCorte === r.episodioId ? {} : { corte: null, episodioDoCorte: null, indiceDoCorte: null }),
  })
}

// --------------------------------------------------------- segundo plano

/** O ultimo pedido automatico de cada tipo: o mesmo estado nunca pede duas vezes (falhou = o botao assume). */
let ultimaSugestao: string | null = null
let ultimoEncaixe: string | null = null
let conferindo: ReturnType<typeof setTimeout> | null = null

/**
 * O disparo em segundo plano. Sugere quando o roteiro esta aprovado, os
 * planos existem e alguma frase esta sem escolha (ou mudou e nao esta
 * travada); encaixa quando a voz esta aprovada e o encaixe ficou velho.
 */
function conferir(): void {
  conferindo = null
  const roteiroNaTela = useRoteiro.getState()
  const rascunho = roteiroNaTela.rascunho
  sincronizarRascunho()
  if (!rascunho) return
  const roteiro = roteiroAtual(rascunho)
  if (!roteiro || !rascunho.aprovado || roteiroNaTela.sujo || roteiroNaTela.aprovando) return
  const s = useCenas.getState()
  if (s.sugerindo || s.encaixando || s.montando) return
  const indice = indiceDasCenas()
  if (!indice || indice.id !== rascunho.episodioId || !temPlanos(indice)) return
  const take = takeAtual(rascunho)
  const cenas = cenasNaTela(rascunho, roteiro, s.pendentes)
  const d = escolhasDesatualizadas(roteiro, take, cenas)
  // Corte refeito: escolha com plano que o indice novo nao tem (o main refaz, mesmo travada).
  const foraDoIndice = escolhasForaDoIndice(cenas, indice.planos)
  // Sugeridas pela estimativa antes da voz: com a voz aprovada, o casar refaz no tempo real (o main confere igual).
  const pelaVoz = podeIrParaCenas(rascunho, roteiro) ? d.antesDaVoz : []
  const refazer = [...new Set([...d.semEscolha, ...d.textoMudou.filter((id) => !escolhaDaFrase(cenas, id)?.travada), ...foraDoIndice, ...pelaVoz])]
  const id = rascunho.id
  if (refazer.length > 0 || d.orfas.length > 0) {
    const chave = [id, roteiro.versao, indice.planos.length, refazer.join(','), d.orfas.join(',')].join('|')
    if (chave === ultimaSugestao) return
    ultimaSugestao = chave
    useCenas.setState({ sugerindo: 'auto' })
    void naFila(async () => {
      if (!(await gravarPendentes())) return
      const r = await ponte.sugerirCenas(id)
      if (!ainda(id)) return
      if (!r.ok) {
        useCenas.setState({ erro: r.error })
        return
      }
      trocarRascunho(r.value.rascunho)
      gradesVistas.clear()
      if (r.value.avisos.length > 0) useCenas.setState({ avisos: r.value.avisos })
      await encaixarSePreciso(id)
    }).finally(() => {
      if (useCenas.getState().sugerindo === 'auto') useCenas.setState({ sugerindo: null })
      agendarConferencia()
    })
    return
  }
  if (!podeIrParaCenas(rascunho, roteiro) || Object.keys(s.pendentes).length > 0) return
  const salvas = cenasDoRascunho(rascunho)
  if (!encaixeAtrasado(roteiro, take, salvas)) return
  const chave = [id, take?.id ?? '', salvas.sugeridasEm ?? '', d.duracaoMudou.join(',')].join('|')
  if (chave === ultimoEncaixe) return
  ultimoEncaixe = chave
  void naFila(() => encaixarSePreciso(id)).finally(agendarConferencia)
}

function agendarConferencia(): void {
  if (conferindo) return
  conferindo = setTimeout(conferir, 0)
}

/**
 * Liga o segundo plano do passo 4: acompanha o rascunho (roteiro aprovado,
 * voz, take), o indice (os planos chegando) e o corte do episodio. Monta com
 * o app (GerarRecap), como as escutas dos outros passos: sugere mesmo com o
 * assistente fechado. Devolve a funcao que desliga.
 */
export function escutarCenas(): () => void {
  const tirarRoteiro = useRoteiro.subscribe((s, antes) => {
    if (s.rascunho !== antes.rascunho || s.sujo !== antes.sujo || s.aprovando !== antes.aprovando || s.indice !== antes.indice) {
      agendarConferencia()
    }
  })
  const tirarGerar = useGerar.subscribe((s, antes) => {
    if (s.indice !== antes.indice || s.passo !== antes.passo) agendarConferencia()
  })
  const tirarCorte = ponte.onCorteProgresso((ev) => {
    const episodioId = useRoteiro.getState().rascunho?.episodioId ?? useGerar.getState().indice?.id ?? null
    if (ev.episodioId !== episodioId) return
    // Um corte novo comecou: o indice que o corte anterior trouxe ficou velho.
    const comecou = ev.estado.status === 'cortando' && !ev.indice
    useCenas.setState({
      corte: ev.estado,
      episodioDoCorte: ev.episodioId,
      ...(ev.indice ? { indiceDoCorte: ev.indice } : comecou ? { indiceDoCorte: null } : {}),
    })
    if (ev.indice) {
      // Indice novo (fim do corte, Reconhecer na mao): as grades guardadas tem os personagens de antes.
      gradesVistas.clear()
      const grade = useCenas.getState().grade
      if (grade) {
        useCenas.setState({ grade: { ...grade, chave: '' } })
        void useCenas.getState().carregarGrade()
      }
      agendarConferencia()
    }
  })
  agendarConferencia()
  /*
   * O2: fechar o app com a ultima escolha ainda no relogio do autosave (ou na
   * fila): grava JA, direto, fora da fila -- como o passo 2 (gerar-roteiro.ts).
   * Gravar duas vezes a mesma escolha nao muda nada; perder o ultimo clique, sim.
   */
  const antesDeFechar = (): void => {
    if (relogioDaGravacao) {
      clearTimeout(relogioDaGravacao)
      relogioDaGravacao = null
    }
    const s = useCenas.getState()
    const rascunho = useRoteiro.getState().rascunho
    const roteiro = rascunho ? roteiroAtual(rascunho) : null
    if (!s.rascunhoId || !rascunho || rascunho.id !== s.rascunhoId || !roteiro) return
    const noRoteiro = new Set(frasesDoRoteiro(roteiro).map((f) => f.id))
    const enviadas = Object.values(s.pendentes).filter((e) => noRoteiro.has(e.fraseId))
    if (enviadas.length > 0) void ponte.salvarCenas(s.rascunhoId, enviadas)
  }
  window.addEventListener('beforeunload', antesDeFechar)
  return () => {
    tirarRoteiro()
    tirarGerar()
    tirarCorte()
    window.removeEventListener('beforeunload', antesDeFechar)
    if (conferindo) clearTimeout(conferindo)
    conferindo = null
  }
}

// Em dev, alcancavel pelo console e pelo teste por CDP, como o roteiroStore.
if (import.meta.env.DEV) Reflect.set(window, 'cenasStore', useCenas)
