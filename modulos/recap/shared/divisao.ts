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
 *   (19/10, 4a rodada, a edicao do Levi no Nia E01: ele dividiu 4 de 18 frases,
 *   o app 14) DIVIDIR SO QUANDO GANHA: os motivos so fazem da frase uma
 *   CANDIDATA. Fora do gancho, ela divide se um pedaco depois do primeiro tem
 *   uma cena boa e DIFERENTE (ProvasDaDivisao.ganha, o casar mede) ou se a
 *   melhor cena unica congela (plano-curto). A sequencia do anime (o span de
 *   planos seguidos) toca inteira: nao e motivo. O limiar continua 3,0 s (4,0 s
 *   matava o gancho e as divisoes boas do Levi, f09 e f11).
 *
 * ONDE CORTAR (cortarFrase): no limite natural -- a palavra depois da virgula
 * ou o proprio conectivo ("mas", "e", "quando", "ate que", "enquanto", "so
 * que") --, o mais perto do meio pelo tempo das palavras do take; sem limite
 * natural, no meio pelo tempo, numa fronteira de palavra que nao deixa artigo
 * nem preposicao no fim do pedaco. (4a rodada) Cada pedaco tem pelo menos
 * PEDACO_MIN_DIVIDIR_SEC (o ritmo do Levi) e alguma coisa que se VE
 * (temImagem): "Tudo comecou" sozinho nao mostra nada e vai junto com o
 * seguinte -- se o unico limite natural deixa um pedaco assim, a frase fica
 * inteira (cortar no meio de "a pequena | Nia Liston" seria pior). So quando
 * a cena unica congelaria, o corte de SOCORRO aceita o "Minimo na tela" da
 * config (corteDaFrase marca `socorro`).
 */

export const LIMIAR_DE_DIVISAO_PADRAO_SEC = 3
/** Os limiares que a config oferece (pouco texto: quatro botoes). */
export const LIMIARES_DE_DIVISAO: readonly number[] = [2.5, 3, 3.5, 4]
const LIMIAR_MIN_SEC = 2
const LIMIAR_MAX_SEC = 6
/** Nenhum pedaco abaixo disto: pisca. */
export const PEDACO_MIN_SEC = 1
/**
 * (4a rodada) O pedaco minimo de uma frase DIVIDIDA pelo app (corteDaFrase): o
 * Levi nunca deixou pedaco abaixo de ~1,4 s no Nia E01, e com 1,3 s a regra
 * corta a f11 em "vira", como ele. O "Minimo na tela" maior da config manda;
 * o menor so vale no corte de socorro (a cena unica congelaria).
 */
export const PEDACO_MIN_DIVIDIR_SEC = 1.3

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

export type MotivoDaDivisao = 'longa' | 'duas-acoes' | 'dois-personagens' | 'plano-curto' | 'gancho'

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
  /** (E03) O corte do GANCHO (cortarOGancho): divide sempre, sem pedir motivo nem que um pedaco ganhe. */
  gancho?: true
  /**
   * (4a rodada) Corte de SOCORRO: nenhum corte deixa os pedacos com o ritmo
   * (PEDACO_MIN_DIVIDIR_SEC); este usa o "Minimo na tela" da config e so vale
   * quando a cena unica congelaria (ProvasDaDivisao.planoCurto).
   */
  socorro?: true
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
 * (4a rodada) Palavras que nao viram imagem: o que SEM_CONTEUDO ja diz, mais os
 * verbos de ligacao, de comeco e de pensamento ("Tudo comecou", "sem pensar
 * duas vezes"). Pronome de pessoa ("ela", "ele") vira: e alguem na tela.
 */
const NAO_SE_VE = new Set([
  ...FUNCIONAIS,
  'assim', 'agora', 'depois', 'antes', 'entao', 'ainda', 'logo', 'tambem', 'ja', 'la', 'aqui', 'ali', 'isso', 'isto',
  'aquilo', 'tudo', 'nada', 'algo', 'menos', 'mal', 'porque', 'pois', 'desde', 'apos', 'nem', 'sim', 'nao', 'mesmo',
  'mesma', 'porem', 'enquanto', 'contudo', 'todavia', 'ai', 'vez', 'vezes', 'duas', 'dois', 'tres', 'coisa', 'coisas',
  'comecou', 'comeca', 'comecaram', 'comecam', 'muda', 'mudou', 'mudam', 'mudaram', 'acontece', 'aconteceu',
  'foi', 'era', 'eram', 'sao', 'ser', 'estar', 'esta', 'estava', 'estavam', 'fica', 'ficou', 'parece', 'parecia',
  'pensar', 'pensa', 'pensou', 'pensando', 'sabe', 'sabia', 'acha', 'achou', 'acredita', 'quer', 'queria', 'pode',
  'podia', 'tem', 'tinha', 'teve', 'ha', 'havia', 'problema', 'verdade', 'jeito', 'forma', 'momento',
])

/** O pedaco mostra alguma coisa: um nome, uma coisa, uma acao, alguem ("Tudo comecou" nao). */
export function temImagem(tokens: readonly string[]): boolean {
  return tokens.some((t) => {
    const w = limpo(t)
    return w.length >= 2 && !NAO_SE_VE.has(w) && !/^\d+$/.test(w)
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

  // Os cortes possiveis: cada pedaco com o minimo de palavras e de segundos, dizendo alguma coisa
  // e (4a rodada) mostrando alguma coisa (temImagem).
  const valido = (cortes: readonly number[]): boolean => {
    const bordas = [0, ...cortes, tokens.length]
    for (let k = 0; k + 1 < bordas.length; k++) {
      const a = bordas[k]!
      const b = bordas[k + 1]!
      if (b - a < PEDACO_MIN_PALAVRAS || !temConteudo(tokens.slice(a, b)) || !temImagem(tokens.slice(a, b))) return false
      const de = t[a]!
      const ate = b < tokens.length ? t[b]! : total
      if (ate - de < minimoSec - 1e-6) return false
    }
    return true
  }
  /**
   * O corte so falha porque um pedaco nao mostra nada: cada pedaco tem as palavras e o conteudo,
   * e algum nao tem imagem (o tempo nao importa: ele iria junto com o seguinte de qualquer jeito).
   */
  const deixaPedacoSemImagem = (cortes: readonly number[]): boolean => {
    const bordas = [0, ...cortes, tokens.length]
    const pedacos = bordas.slice(0, -1).map((a, k) => tokens.slice(a, bordas[k + 1]!))
    return pedacos.every((p) => p.length >= PEDACO_MIN_PALAVRAS && temConteudo(p)) && pedacos.some((p) => !temImagem(p))
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
  const validos = possiveis.filter((c) => valido(c))
  // (4a rodada) O limite natural que so falha porque um pedaco nao mostra nada ("Tudo comecou | quando
  // a pequena Nia Liston estava morrendo"): o pedaco vai junto com o seguinte -- a frase fica inteira,
  // em vez de um corte no meio de "a pequena | Nia Liston".
  const natural = (c: readonly number[]): boolean => c.every((x) => (limites.get(x)?.forca ?? 0) >= FORCA_NATURAL)
  if (!validos.some(natural) && possiveis.some((c) => natural(c) && deixaPedacoSemImagem(c))) return null
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

// ------------------------------------------------------------- o gancho

/**
 * (E03) O GANCHO sai com 2 ou 3 cenas ("normalmente o hook sempre tem 2 ou 3
 * cenas", o Levi; as edicoes dele: Nia E03 f01 0302/0267/0275, Nia E01 f01
 * 0003/0033, MRM E02 f01 0006/0007): 3 acima disto, 2 abaixo.
 */
export const GANCHO_TRES_SEC = 3.2
/** Nenhum pedaco do gancho abaixo disto ("invadiu a mafia", 0,85 s no E03). */
export const GANCHO_PEDACO_MIN_SEC = 0.8
/** O adverbio que vai junto com o que vem depois ("so | pra arrumar briga"). */
const MODIFICADORES = new Set(['so', 'ate', 'logo', 'bem', 'mesmo', 'ainda', 'quase', 'nem'])
const ARTIGOS = new Set(['a', 'o', 'as', 'os', 'um', 'uma', 'essa', 'esse', 'esta', 'este', 'aquela', 'aquele', 'sua', 'seu'])
const PREPOSICOES = new Set(['por', 'pra', 'pro', 'para', 'sem', 'com', 'ate'])

/**
 * Quanto vale o pedaco comecar na palavra j do gancho: o comeco de uma palavra
 * de PESO -- o verbo de acao ("invadiu"), o objeto ou o sujeito pelo artigo
 * ("a mafia", "um segredo"), a oracao pela preposicao com verbo logo depois
 * ("por ser considerado", "so pra arrumar"). 0 = nada a favor.
 */
function pesoDoInicio(tokens: readonly string[], j: number): number {
  const w = limpo(tokens[j]!)
  const k = MODIFICADORES.has(w) && j + 1 < tokens.length ? j + 1 : j
  const cabeca = limpo(tokens[k]!)
  if (pareceVerbo(tokens[k]!)) return 1.5
  // A oracao reduzida: a preposicao com o verbo (infinitivo tambem: "pra arrumar", "por ser") logo depois.
  if (PREPOSICOES.has(cabeca) && tokens.slice(k + 1, k + 3).some((x) => pareceVerbo(x) || /^[a-z]{2,}(?:ar|er|ir)$/.test(limpo(x)))) return 1
  if (ARTIGOS.has(cabeca) && k + 1 < tokens.length && temConteudo([tokens[k + 1]!])) return 1
  return 0
}

/**
 * O corte do GANCHO em `n` pedacos (2 ou 3): no comeco das palavras de peso
 * (pesoDoInicio, mais a forca do limite natural; com 3, os dois cortes nelas),
 * equilibrado pelo tempo, cada
 * pedaco com GANCHO_PEDACO_MIN_SEC, duas palavras e conteudo, nunca deixando
 * artigo, preposicao ou adverbio no fim de um pedaco ("Mano... essa
 * garotinha | invadiu a mafia | so pra arrumar briga", o corte do Levi no E03).
 * null = nenhum corte cabe.
 */
export function cortarOGancho(frase: Pick<Frase, 'id' | 'texto'>, take: Pick<TakeDaVoz, 'trechos' | 'palavras'> | null, n: 2 | 3): CorteDaFrase | null {
  const tokens = palavrasDaFrase(frase.texto)
  const d = duracaoDaFrase(frase, take)
  const total = d.duracao
  if (tokens.length < n * PEDACO_MIN_PALAVRAS || total < n * GANCHO_PEDACO_MIN_SEC) return null
  const t = tokens.map((_, i) => (i === 0 ? 0 : inicioDaPalavra(i, frase, take, d)))
  const limites = new Map(limitesNaturais(tokens).map((l) => [l.palavra, l]))
  const valido = (cortes: readonly number[]): boolean => {
    const bordas = [0, ...cortes, tokens.length]
    for (let k = 0; k + 1 < bordas.length; k++) {
      const a = bordas[k]!
      const b = bordas[k + 1]!
      if (b - a < PEDACO_MIN_PALAVRAS || !temConteudo(tokens.slice(a, b))) return false
      if (b < tokens.length && FUNCIONAIS.has(limpo(tokens[b - 1]!))) return false
      if ((b < tokens.length ? t[b]! : total) - t[a]! < GANCHO_PEDACO_MIN_SEC - 1e-6) return false
    }
    return true
  }
  const nota = (cortes: readonly number[]): number =>
    cortes.reduce((v, c, k) => v + pesoDoInicio(tokens, c) + (limites.get(c)?.forca ?? 0) - (4 * Math.abs(t[c]! - ((k + 1) / n) * total)) / total, 0)
  const possiveis: number[][] = []
  if (n === 2) for (let j = 1; j < tokens.length; j++) possiveis.push([j])
  else for (let a = 1; a < tokens.length; a++) for (let b = a + 1; b < tokens.length; b++) possiveis.push([a, b])
  // Tres pedacos so com os dois cortes em palavras de peso ("Essa garotinha | de quatro anos | guarda..."
  // do Nia E01 nao: fica "Essa garotinha de quatro anos | guarda um segredo bizarro").
  const dePeso = (c: number): boolean => pesoDoInicio(tokens, c) > 0 || (limites.get(c)?.forca ?? 0) >= FORCA_NATURAL
  const cortes = possiveis
    .filter((c) => valido(c) && (n === 2 || c.every(dePeso)))
    .map((c) => ({ c, v: nota(c) }))
    .sort((x, y) => y.v - x.v)[0]?.c
  if (!cortes) return null
  const bordas = [0, ...cortes, tokens.length]
  const pedacos: PedacoDaFrase[] = bordas.slice(0, -1).map((a, k) => {
    const b = bordas[k + 1]!
    return { palavraInicio: a, texto: tokens.slice(a, b).join(' '), inicio: t[a]!, fim: b < tokens.length ? t[b]! : total }
  })
  const natural = cortes.every((c) => (limites.get(c)?.forca ?? 0) >= FORCA_NATURAL)
  return { pedacos, natural, duasAcoes: natural && cortes.every((c) => !!limites.get(c)?.acoes), gancho: true }
}

// ------------------------------------------------------------- a decisao

/** O que so o casar sabe da frase (o elenco e a fita da frase inteira). */
export interface ProvasDaDivisao {
  /** As pessoas que um texto cita (as fichas do elenco do episodio): o motivo 'dois-personagens'. */
  citados?: (texto: string) => readonly string[]
  /**
   * A melhor cena unica da frase congela o ultimo quadro (mais curta que a frase
   * alem do congelamento que nao se ve). (4a rodada) A sequencia do anime (o span
   * de planos seguidos, a montagem original) toca inteira: nao e plano curto.
   */
  planoCurto?: boolean
  /** (4a rodada) A frase e o gancho: la a frase longa divide pelos motivos, como sempre (o Levi dividiu as duas do Nia E01). */
  gancho?: boolean
  /** (E03) A frase e a 1a do roteiro: o corte do gancho (cortarOGancho), 2 ou 3 cenas sempre. */
  abreOVideo?: boolean
  /**
   * (5a rodada) A frase nao tem evento (a janela herdada: o "Comenta ai" do
   * fim): nao ha momento a respeitar, e o corte de socorro (o "Minimo na tela"
   * da config) vale -- o final-171 abria o f24 do MRM E02 em 1,17 s + 1,88 s.
   */
  semMomento?: boolean
  /**
   * (4a rodada) Um pedaco depois do primeiro GANHA: a melhor cena dele e boa
   * (relevancia propria: a palavra dita, a etiqueta, a pessoa, a acao) e
   * diferente da do primeiro (outro plano, que nao e o seguinte da mesma
   * sequencia). Ausente = nao se mediu (divide pelos motivos, como antes).
   */
  ganha?: boolean
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
  /** (E03) A frase e o GANCHO (a 1a do roteiro): 2 ou 3 cenas sempre que couber (cortarOGancho). */
  gancho = false,
): CorteDaFrase | null {
  if (!opcoes.ligada) return null
  const d = duracaoDaFrase(frase, take).duracao
  if (gancho) {
    const doGancho = (d > GANCHO_TRES_SEC ? cortarOGancho(frase, take, 3) : null) ?? cortarOGancho(frase, take, 2)
    if (doGancho) return doGancho
  }
  if (frase.citacaoCueId || ASPAS.test(frase.texto)) return null
  const limiar = limiarDeDivisao(opcoes.limiarSec)
  const daConfig = opcoes.minimoSec === undefined ? PEDACO_MIN_SEC : minimoNaTela(opcoes.minimoSec)
  const ritmo = Math.max(PEDACO_MIN_DIVIDIR_SEC, daConfig)
  const cortar = (minimo: number): CorteDaFrase | null => {
    const tres = d > FATOR_TRES_CENAS * limiar ? cortarFrase(frase, take, 3, minimo) : null
    return tres ?? cortarFrase(frase, take, 2, minimo)
  }
  const doRitmo = cortar(ritmo)
  if (doRitmo || daConfig >= ritmo) return doRitmo
  // (4a rodada) Nenhum corte com o ritmo: o de socorro, com o minimo da config (so com a cena unica congelando).
  const socorro = cortar(daConfig)
  return socorro ? { ...socorro, socorro: true } : null
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
  const corte = corteDaFrase(frase, take, opcoes, provas.gancho === true && provas.abreOVideo === true)
  if (!corte) return null
  // (E03) O gancho divide sempre (2 ou 3 cenas): sem motivo, sem pedir que um pedaco ganhe.
  if (corte.gancho) return { ...corte, motivos: ['gancho'] }
  // (4a rodada) O corte de socorro (pedaco abaixo do ritmo) so quando a cena unica congelaria.
  if (corte.socorro && !provas.planoCurto && !provas.semMomento) return null
  const d = duracaoDaFrase(frase, take).duracao
  const motivos: MotivoDaDivisao[] = []
  if (d > limiarDeDivisao(opcoes.limiarSec) + 1e-6) motivos.push('longa')
  if (corte.duasAcoes) motivos.push('duas-acoes')
  if (corte.natural && provas.citados && doisPersonagens(corte, provas.citados)) motivos.push('dois-personagens')
  if (provas.planoCurto) motivos.push('plano-curto')
  // Tres pedacos so na frase longa (o corte em 3 so sai dela, mas o motivo confere).
  if (corte.pedacos.length > 2 && !motivos.includes('longa')) return null
  if (motivos.length === 0) return null
  // (4a rodada) Fora do gancho, os motivos so fazem candidata: divide quando um pedaco ganha (ou a cena unica congela).
  if (provas.ganha === false && !provas.gancho && !provas.planoCurto) return null
  return { ...corte, motivos }
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
