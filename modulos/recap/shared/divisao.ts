import type { Frase } from './roteiro'
import { palavrasDaFrase, type TakeDaVoz } from './voz'
import { duracaoDaFrase, inicioDaPalavra } from './cenas'

/**
 * [recap] DUAS CENAS NUMA FRASE (pedido do Levi, 18/10): "algumas partes as
 * frases permitiam usar 2 cenas e na automatica escolheu usar so uma". Num
 * short, um corte a cada ~1,5-2,5 s segura a atencao; frase longa ou com dois
 * momentos ("Quando o Lent implorou pra ficar, o Guy asfixiou o rapaz") ganha
 * 2 cenas -- raramente 3, so em frase muito longa.
 *
 * Puro: o casar (electron/cenas/casar.ts) decide e escolhe cada pedaco com as
 * palavras dele; o servico (electron/cenas/index.ts) le os pedacos antes para
 * medir o sentido de cada um; a tela so mostra (varias cenas na frase e a
 * barrinha rosa no corte).
 *
 * AS REGRAS (dividirFrase):
 *   nunca: a opcao desligada; frase com fala citada (citacaoCueId, aspas) -- a
 *     citacao fica no plano dela; corte que deixa um pedaco com menos de
 *     PEDACO_MIN_SEC ou de PEDACO_MIN_PALAVRAS;
 *   divide quando ha um motivo:
 *     a. 'longa': a frase dura mais que o limiar (3,0 s) no take REAL, com o
 *        acelerar ja aplicado (sem take, a estimativa pelas palavras);
 *     b. 'duas-acoes': o corte natural separa duas oracoes com verbo ("," +
 *        verbo novo, " e " entre oracoes, "mas", "quando...,", "ate que",
 *        "enquanto");
 *     c. 'dois-personagens': o corte natural separa duas pessoas (uma de cada
 *        lado, nenhuma dos dois);
 *     d. 'plano-curto': a melhor cena unica e mais curta que a frase (ia
 *        congelar o ultimo quadro ou emendar o plano seguinte).
 *   tres cenas: so acima de FATOR_TRES_CENAS vezes o limiar.
 *
 * ONDE CORTAR (cortarFrase): no limite natural -- a palavra depois da virgula
 * ou o proprio conectivo ("mas", "e", "quando", "ate que", "enquanto", "so
 * que") --, o mais perto do meio pelo tempo das palavras do take; sem limite
 * natural, no meio pelo tempo, numa fronteira de palavra que nao deixa artigo
 * nem preposicao no fim do pedaco.
 */

export const LIMIAR_DE_DIVISAO_PADRAO_SEC = 3
/** Os limiares que a config oferece (pouco texto: quatro botoes). */
export const LIMIARES_DE_DIVISAO: readonly number[] = [2.5, 3, 3.5, 4]
const LIMIAR_MIN_SEC = 2
const LIMIAR_MAX_SEC = 6
/** Nenhum pedaco abaixo disto: pisca. */
export const PEDACO_MIN_SEC = 1

/**
 * O MINIMO NA TELA de cada cena automatica (19/10, MRM E02: 7 cenas de 0,6-0,8 s,
 * 5 seguidas perto dos 42 s): o pedaco da frase dividida, o plano de uma
 * emenda e o plano de um span nunca ficam abaixo disto. A config "Cenas"
 * troca (quatro botoes); a escolha feita a mao fica como ele quis.
 */
export const MINIMO_NA_TELA_PADRAO_SEC = 1
export const MINIMOS_NA_TELA: readonly number[] = [0.8, 1, 1.2, 1.5]
/** Nunca 3 cenas seguidas abaixo disto (a rajada de cortes curtos). */
export const RAJADA_SEC = 1.2

/** O minimo salvo, conferido (fora da faixa ou lixo: o padrao). */
export function minimoNaTela(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0.5 && x <= 2 ? x : MINIMO_NA_TELA_PADRAO_SEC
}
/** Nem abaixo disto de palavras ("Depois," sozinho nao e um momento). */
export const PEDACO_MIN_PALAVRAS = 2
/** Tres cenas so quando a frase passa deste tanto de vezes o limiar (7,5 s com 3,0). */
export const FATOR_TRES_CENAS = 2.5

export type MotivoDaDivisao = 'longa' | 'duas-acoes' | 'dois-personagens' | 'plano-curto'

export interface OpcoesDaDivisao {
  /** "Ate 2 cenas por frase" (config Cenas). */
  ligada: boolean
  /** Acima disto (s, no take) a frase e 'longa'. */
  limiarSec: number
  /** Nenhum pedaco abaixo disto (o "Minimo na tela" da config Cenas). Ausente = PEDACO_MIN_SEC. */
  minimoSec?: number
}

export const DIVISAO_PADRAO: OpcoesDaDivisao = { ligada: true, limiarSec: LIMIAR_DE_DIVISAO_PADRAO_SEC }

/** O limiar salvo, conferido (fora da faixa ou lixo: o padrao). */
export function limiarDeDivisao(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= LIMIAR_MIN_SEC && x <= LIMIAR_MAX_SEC ? x : LIMIAR_DE_DIVISAO_PADRAO_SEC
}

/** Um pedaco da frase: a palavra em que comeca, o texto e o tempo (relativo ao inicio do trecho). */
export interface PedacoDaFrase {
  palavraInicio: number
  texto: string
  inicio: number
  fim: number
}

export interface CorteDaFrase {
  pedacos: PedacoDaFrase[]
  /** Todos os cortes cairam num limite natural (virgula, conectivo). */
  natural: boolean
  /** Os cortes separam oracoes com verbo dos dois lados. */
  duasAcoes: boolean
}

export interface DivisaoDaFrase extends CorteDaFrase {
  motivos: MotivoDaDivisao[]
}

/** O id do pedaco k da frase (as chaves dos sinais de cada pedaco: o sentido do texto dele). */
export function idDoPedaco(fraseId: string, k: number): string {
  return `${fraseId}/${k + 1}`
}

// ------------------------------------------------------------ as palavras

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '')
}

/** O token sem pontuacao, minusculo e sem acento ("Depois," -> "depois"). */
function limpo(token: string): string {
  return semAcento(token.toLowerCase()).replace(/[^a-z0-9-]/g, '')
}

/** Termina o pedaco mal: artigo, preposicao, conjuncao, possessivo ("a | menina", "de | armas"). */
const FUNCIONAIS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'nas', 'nos',
  'num', 'numa', 'pra', 'pro', 'pras', 'pros', 'para', 'por', 'pelo', 'pela', 'pelos', 'pelas', 'com', 'sem', 'que',
  'e', 'ou', 'mas', 'se', 'ao', 'aos', 'seu', 'sua', 'seus', 'suas', 'meu', 'minha', 'esse', 'essa', 'este', 'esta',
  'aquele', 'aquela', 'lhe', 'sobre', 'entre', 'ate', 'quando', 'onde', 'como', 'muito', 'mais', 'tao', 'bem', 'so',
  // o adverbio fica com o verbo dele ("ele quase | esgotou" nao)
  'quase', 'nao', 'nunca', 'sempre', 'ja', 'ainda', 'logo', 'tambem',
])

/** Formas de verbo comuns na narracao que o fim da palavra nao denuncia (presente, irregulares). */
const VERBOS = new Set([
  'podia', 'queria', 'sabia', 'fazia', 'devia', 'parecia', 'conseguia', 'vivia', 'dizia', 'ia', 'via', 'altera',
  'foi', 'era', 'eram', 'sao', 'tem', 'tinha', 'teve', 'faz', 'fez', 'vai', 've', 'viu', 'deu', 'diz', 'disse', 'quer',
  'quis', 'pode', 'sabe', 'soube', 'fica', 'estava', 'esteve', 'chega', 'vira', 'sai', 'cai', 'leva', 'acha', 'pega',
  'manda', 'mata', 'ri', 'volta', 'nota', 'percebe', 'decide', 'ensina', 'visita', 'parte', 'reclama', 'abre', 'ataca',
  'luta', 'tenta', 'consegue', 'comeca', 'termina', 'descobre', 'aparece', 'surge', 'explica', 'revela', 'sobrevive',
  'acorda', 'morre', 'nasce', 'cresce', 'ganha', 'perde', 'entra', 'corre', 'grita', 'chora', 'olha', 'segura', 'joga',
  'usa', 'cria', 'destroi', 'salva', 'encontra', 'procura', 'enfrenta', 'vence', 'derrota', 'implora', 'agarra',
  'asfixia', 'expulsa', 'anuncia', 'zomba', 'muda', 'precisa', 'deixa', 'chama', 'mostra', 'pede', 'recebe',
  'oferece', 'aceita', 'recusa', 'promete', 'lembra', 'esquece', 'sente', 'pensa', 'acredita', 'ama', 'odeia',
  'protege', 'ajuda', 'treina', 'foge', 'persegue', 'prende', 'solta', 'abraca', 'beija', 'sorri', 'desmaia',
  'levanta', 'sobe', 'desce', 'anda', 'voa', 'dorme', 'come', 'bebe', 'passa', 'fecha', 'quebra', 'corta', 'explode',
  'brilha', 'some', 'vem', 'traz', 'trouxe', 'pos', 'poe', 'guarda', 'esconde', 'confessa', 'admite', 'avisa',
  'ameaca', 'empresta', 'cobra', 'devolve', 'compra', 'vende', 'paga', 'ouve', 'escuta', 'responde', 'pergunta',
  'conhece', 'reconhece', 'transforma', 'controla', 'domina', 'invade', 'aposta', 'propoe', 'sugere', 'afirma',
  'garante', 'impede', 'evita', 'resolve', 'estuda', 'constroi', 'monta', 'funda', 'celebra', 'casa', 'vive',
])

/** Terminam como verbo mas nao sao ("quando", "homem", "lindo"). */
const NAO_VERBOS = new Set([
  'quando', 'bando', 'comando', 'brando', 'nefando', 'tremendo', 'horrendo', 'estupendo', 'remendo', 'adendo',
  'lindo', 'findo', 'infindo', 'homem', 'ordem', 'nuvem', 'jovem', 'alguem', 'ninguem', 'tambem', 'alem', 'porem',
  'refem', 'armazem', 'harem', 'chapeu', 'museu', 'trofeu', 'europeu', 'judeu', 'pigmeu', 'brava', 'oitava', 'nada',
])

/** O token parece um verbo conjugado (heuristica: o fim da palavra e uma lista curta). */
export function pareceVerbo(token: string): boolean {
  const baixa = token.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '')
  // Com acento, antes de tirar: "e" sem acento e a conjuncao, "da" e a preposicao.
  if (['é', 'está', 'estão', 'vão', 'dá', 'dão', 'vê', 'têm', 'pôs', 'pôde', 'tá'].includes(baixa)) return true
  const w = semAcento(baixa)
  if (w.length < 2 || NAO_VERBOS.has(w)) return false
  if (VERBOS.has(w)) return true
  if (w.length < 4) return false
  if (/(aram|eram|iram|avam|ariam|eriam|iriam|iam|ando|endo|indo|ou|eu|iu|ava|am)$/.test(w)) return true
  return /em$/.test(w) && !/gem$/.test(w)
}

function temVerbo(tokens: readonly string[]): boolean {
  return tokens.some(pareceVerbo)
}

/** Palavras que nao dizem nada que se veja: adverbio de ligacao, pronome, conectivo ("Mesmo assim,"). */
const SEM_CONTEUDO = new Set([
  ...FUNCIONAIS,
  'assim', 'agora', 'depois', 'antes', 'entao', 'ainda', 'logo', 'tambem', 'ja', 'la', 'aqui', 'ali', 'isso', 'isto',
  'aquilo', 'tudo', 'nada', 'menos', 'mal', 'porque', 'pois', 'desde', 'apos', 'ele', 'ela', 'eles', 'elas', 'dele',
  'dela', 'deles', 'delas', 'nem', 'sim', 'nao', 'mesmo', 'mesma', 'porem', 'enquanto', 'contudo', 'todavia', 'ai',
])

/** O pedaco diz alguma coisa: pelo menos uma palavra de conteudo (nome, verbo, coisa). */
function temConteudo(tokens: readonly string[]): boolean {
  return tokens.some((t) => {
    const w = limpo(t)
    return w.length >= 3 && !SEM_CONTEUDO.has(w)
  })
}

/**
 * Onde uma oracao ou um sintagma comeca: verbo, artigo, preposicao, pronome,
 * conectivo. O corte no meio pelo tempo prefere estas palavras (o pedaco 2
 * comeca inteiro: "...visitou a sala especial | onde o projeto acontece", e
 * nao "a sala | especial").
 */
const ABREM_SINTAGMA = new Set([
  ...FUNCIONAIS,
  'ele', 'ela', 'eles', 'elas', 'se', 'alguem', 'ninguem', 'todos', 'todas', 'cada', 'outro', 'outra', 'onde',
  'porque', 'enquanto', 'depois', 'antes', 'ainda', 'tambem', 'ja', 'nunca', 'sempre',
])
function abreSintagma(token: string): boolean {
  return ABREM_SINTAGMA.has(limpo(token)) || pareceVerbo(token)
}

/** Conectivos que abrem uma oracao nova no meio da frase. */
const CONECTIVOS = new Set(['mas', 'porem', 'enquanto', 'entao', 'contudo', 'todavia'])
const CONECTIVOS_DUPLOS: readonly (readonly [string, string])[] = [
  ['ate', 'que'],
  ['so', 'que'],
  ['depois', 'que'],
  ['assim', 'que'],
  ['antes', 'que'],
  ['ja', 'que'],
]

/** Um lugar em que a frase se divide sozinha: a palavra onde o pedaco seguinte comeca. */
interface LimiteNatural {
  palavra: number
  /** 3 conectivo forte, 2,5 virgula, 2 "quando", 1 "e" com verbo logo depois, 0,5 "e" entre nomes. */
  forca: number
  /** Verbo dos dois lados (duas acoes). */
  acoes: boolean
}

export function limitesNaturais(tokens: readonly string[]): LimiteNatural[] {
  const norm = tokens.map(limpo)
  const saida: LimiteNatural[] = []
  for (let j = 1; j < tokens.length; j++) {
    const w = norm[j]!
    const virgula = /[,;:–—]$/.test(tokens[j - 1]!) || /^[–—]/.test(tokens[j]!)
    const duplo = CONECTIVOS_DUPLOS.some(([a, b]) => w === a && norm[j + 1] === b)
    let forca = 0
    if (CONECTIVOS.has(w) || duplo) forca = 3
    else if (virgula) forca = 2.5
    else if (w === 'quando') forca = 2
    else if (w === 'e') forca = temVerbo(tokens.slice(j + 1, j + 5)) ? 1 : 0.5
    else continue
    const acoes = temVerbo(tokens.slice(0, j)) && temVerbo(tokens.slice(j))
    saida.push({ palavra: j, forca, acoes })
  }
  return saida
}

// ------------------------------------------------------------- o corte

/** A partir desta forca o limite conta como natural (o "e" entre dois nomes nao conta). */
const FORCA_NATURAL = 1

/**
 * Onde cortar a frase em `n` pedacos (2 ou 3), pelos tempos das palavras no
 * take (sem take, as palavras repartidas por igual). null = nenhum corte deixa
 * cada pedaco com o minimo de tempo e de palavras.
 */
export function cortarFrase(
  frase: Pick<Frase, 'id' | 'texto'>,
  take: Pick<TakeDaVoz, 'trechos' | 'palavras'> | null,
  n: 2 | 3 = 2,
  minimoSec: number = PEDACO_MIN_SEC,
): CorteDaFrase | null {
  const tokens = palavrasDaFrase(frase.texto)
  const d = duracaoDaFrase(frase, take)
  if (tokens.length < n * PEDACO_MIN_PALAVRAS || d.duracao < n * minimoSec) return null
  const t = tokens.map((_, i) => (i === 0 ? 0 : inicioDaPalavra(i, frase, take, d)))
  const limites = new Map(limitesNaturais(tokens).map((l) => [l.palavra, l]))
  const total = d.duracao

  // Os cortes possiveis: cada pedaco com o minimo de palavras e de segundos, e dizendo alguma coisa.
  const valido = (cortes: readonly number[]): boolean => {
    const bordas = [0, ...cortes, tokens.length]
    for (let k = 0; k + 1 < bordas.length; k++) {
      const a = bordas[k]!
      const b = bordas[k + 1]!
      if (b - a < PEDACO_MIN_PALAVRAS || !temConteudo(tokens.slice(a, b))) return false
      const de = t[a]!
      const ate = b < tokens.length ? t[b]! : total
      if (ate - de < minimoSec - 1e-6) return false
    }
    return true
  }
  // Natural: a forca do limite (mais meio ponto com verbo dos dois lados), menos o desequilibrio pelo tempo.
  const nota = (cortes: readonly number[]): { valor: number; natural: boolean; acoes: boolean } => {
    let valor = 0
    let natural = true
    let acoes = true
    cortes.forEach((c, k) => {
      const l = limites.get(c)
      const ideal = ((k + 1) / n) * total
      valor -= (4 * Math.abs(t[c]! - ideal)) / total
      if (l && l.forca >= FORCA_NATURAL) valor += l.forca + (l.acoes ? 0.5 : 0)
      else natural = false
      if (!l?.acoes) acoes = false
    })
    return { valor, natural, acoes }
  }

  const possiveis: number[][] = []
  if (n === 2) for (let j = 1; j < tokens.length; j++) possiveis.push([j])
  else for (let a = 1; a < tokens.length; a++) for (let b = a + 1; b < tokens.length; b++) possiveis.push([a, b])
  const validos = possiveis.filter(valido)
  if (validos.length === 0) return null

  // 1o: so cortes naturais, o de melhor nota.
  let melhor: { cortes: number[]; natural: boolean; acoes: boolean } | null = null
  let maior = -Infinity
  for (const c of validos) {
    const x = nota(c)
    if (x.natural && x.valor > maior) {
      maior = x.valor
      melhor = { cortes: c, natural: true, acoes: x.acoes }
    }
  }
  // Sem limite natural: o meio pelo tempo, de preferencia onde um sintagma comeca (verbo, artigo,
  // preposicao), e nunca deixando artigo/preposicao no fim de um pedaco.
  if (!melhor) {
    const desvio = (c: readonly number[]): number => c.reduce((s, x, k) => s + Math.abs(t[x]! - ((k + 1) / n) * total), 0)
    const semFuncional = validos.filter((c) => c.every((x) => !FUNCIONAIS.has(limpo(tokens[x - 1]!))))
    const abrindo = semFuncional.filter((c) => c.every((x) => abreSintagma(tokens[x]!)))
    const lista = abrindo.length > 0 ? abrindo : semFuncional.length > 0 ? semFuncional : validos
    const c = [...lista].sort((a, b) => desvio(a) - desvio(b))[0]!
    melhor = { cortes: c, natural: false, acoes: false }
  }

  const bordas = [0, ...melhor.cortes, tokens.length]
  const pedacos: PedacoDaFrase[] = []
  for (let k = 0; k + 1 < bordas.length; k++) {
    const a = bordas[k]!
    const b = bordas[k + 1]!
    pedacos.push({
      palavraInicio: a,
      texto: tokens.slice(a, b).join(' '),
      inicio: t[a]!,
      fim: b < tokens.length ? t[b]! : total,
    })
  }
  return { pedacos, natural: melhor.natural, duasAcoes: melhor.natural && melhor.acoes }
}

// ------------------------------------------------------------- a decisao

/** O que so o casar sabe da frase (o elenco e a fita da frase inteira). */
export interface ProvasDaDivisao {
  /** As pessoas que um texto cita (as fichas do elenco do episodio): o motivo 'dois-personagens'. */
  citados?: (texto: string) => readonly string[]
  /** A melhor cena unica da frase e mais curta que ela (congela o ultimo quadro ou emenda o plano seguinte). */
  planoCurto?: boolean
}

/** A frase traz uma fala entre aspas: a citacao fica no plano dela. */
const ASPAS = /["“”«»]/

/**
 * O corte que a frase teria SE fosse dividida (2 pedacos; 3 se ela passa de
 * FATOR_TRES_CENAS vezes o limiar). null = nunca se divide (opcao desligada,
 * citacao, curta demais para dois pedacos). O servico mede o sentido destes
 * pedacos antes de chamar o casar.
 */
export function corteDaFrase(
  frase: Pick<Frase, 'id' | 'texto' | 'citacaoCueId'>,
  take: Pick<TakeDaVoz, 'trechos' | 'palavras'> | null,
  opcoes: OpcoesDaDivisao,
): CorteDaFrase | null {
  if (!opcoes.ligada || frase.citacaoCueId || ASPAS.test(frase.texto)) return null
  const d = duracaoDaFrase(frase, take).duracao
  const limiar = limiarDeDivisao(opcoes.limiarSec)
  const minimo = opcoes.minimoSec === undefined ? PEDACO_MIN_SEC : minimoNaTela(opcoes.minimoSec)
  const tres = d > FATOR_TRES_CENAS * limiar ? cortarFrase(frase, take, 3, minimo) : null
  return tres ?? cortarFrase(frase, take, 2, minimo)
}

/**
 * Divide a frase? O corte e os motivos (a ordem das regras no topo do
 * arquivo), ou null: fica uma cena so.
 */
export function dividirFrase(
  frase: Pick<Frase, 'id' | 'texto' | 'citacaoCueId'>,
  take: Pick<TakeDaVoz, 'trechos' | 'palavras'> | null,
  opcoes: OpcoesDaDivisao,
  provas: ProvasDaDivisao = {},
): DivisaoDaFrase | null {
  const corte = corteDaFrase(frase, take, opcoes)
  if (!corte) return null
  const d = duracaoDaFrase(frase, take).duracao
  const motivos: MotivoDaDivisao[] = []
  if (d > limiarDeDivisao(opcoes.limiarSec) + 1e-6) motivos.push('longa')
  if (corte.duasAcoes) motivos.push('duas-acoes')
  if (corte.natural && provas.citados && doisPersonagens(corte, provas.citados)) motivos.push('dois-personagens')
  if (provas.planoCurto) motivos.push('plano-curto')
  // Tres pedacos so na frase longa (o corte em 3 so sai dela, mas o motivo confere).
  if (corte.pedacos.length > 2 && !motivos.includes('longa')) return null
  return motivos.length > 0 ? { ...corte, motivos } : null
}

/** Pedacos vizinhos citam pessoas diferentes: cada um alguem, e ninguem dos dois. */
function doisPersonagens(corte: CorteDaFrase, citados: (texto: string) => readonly string[]): boolean {
  const quem = corte.pedacos.map((p) => new Set(citados(p.texto)))
  for (let k = 0; k + 1 < quem.length; k++) {
    const a = quem[k]!
    const b = quem[k + 1]!
    if (a.size > 0 && b.size > 0 && ![...a].some((x) => b.has(x))) return true
  }
  return false
}
