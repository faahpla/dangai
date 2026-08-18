import type { Nickname } from './channels'

/**
 * Quem esta em cada frase do roteiro.
 *
 * Nao usa modelo de linguagem, e isso foi MEDIDO, nao suposto. Contra o roteiro
 * de teoria real do Kintay (Tensura, 17 frases) e o de recap real (Bleach TYBW,
 * 21 frases), com os personagens de verdade da biblioteca dele:
 *
 *                                 teoria            recap
 *   so nome escrito ..........  9/16, 0 errado   13/20, 0 errado
 *   + arrasto de pronome ..... 14/16, 2 errados  16/20, 1 errado
 *   + apelidos cadastrados ... 16/16, 1 errado   18/20, 1 errado
 *   qwen2.5:7b local ......... pior que todos, e errado perigoso
 *
 * O 7B perdeu nome que estava ESCRITO na frase, variou de resposta entre
 * rodadas com temperatura 0, e afirmou que "uma Lorde Demonio" era a Chloe
 * quando e a Luminous -- o que poria a personagem errada em meia duzia de
 * blocos. Num video de teoria imagem que contradiz a narracao e pior que imagem
 * nenhuma.
 *
 * O que ficou de fora tambem foi medido. Duas variantes do arrasto perderam:
 *
 *   arrastar sempre que a frase nao nomeia ninguem ... +1 acerto, +3 errados
 *   somar quem entra a quem estava na frase anterior . +1 acerto, +10 errados
 *
 * Por isso o arrasto exige pronome e SUBSTITUI quem estava em cena.
 */

/** Como o nome do personagem apareceu na frase. */
export type ScriptMatchKind = 'name' | 'nickname' | 'carry'

export interface ScriptMatch {
  character: string
  kind: ScriptMatchKind
}

export interface ScriptLine {
  /** Ordem de confianca: nome escrito antes de apelido, apelido antes de arrasto. */
  matches: ScriptMatch[]
}

/**
 * Palavra de nome com menos de 4 letras nao conta.
 *
 * Personagem de anime tem nome curto que colide com palavra portuguesa comum --
 * "Rei", "Ura", "Sei". Com 3 letras a regra achava personagem em frase que nao
 * falava de ninguem, e trazer o personagem errado e o unico erro que nao da
 * para consertar olhando o video pronto.
 */
const MIN_FICHA = 4

/**
 * Pronome que herda quem estava em cena.
 *
 * Sem "o", "a", "isso": artigo aparece em toda frase e o arrasto pegaria o
 * roteiro inteiro.
 */
const PRONOMES = /\b(ele|ela|eles|elas|dele|dela|deles|delas|nele|nela|lhe|lhes|seu|sua|seus|suas)\b/

/** Sem acento, sem caixa. Mesmo tratamento da busca da Biblioteca. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function fichas(nome: string): string[] {
  return normalizarTexto(nome)
    .split(/[^a-z0-9]+/)
    .filter((f) => f.length > 0)
}

export interface ScriptIndex {
  /** palavra do nome -> personagem, so quando a palavra identifica UM */
  porPalavra: Map<string, string>
  /** apelidos do mais longo para o mais curto, ja normalizados */
  apelidos: { termo: string; character: string }[]
}

/**
 * Prepara o indice uma vez, para nao remontar a cada frase.
 *
 * `characters` sao os nomes JA unificados da biblioteca -- a unificacao acontece
 * em electron/services/library.ts, e sem ela "Rimuru" e "Tempest, Rimuru"
 * chegariam aqui como duas pessoas.
 */
export function buildScriptIndex(
  characters: readonly string[],
  nicknames: readonly Nickname[],
): ScriptIndex {
  const candidatos = new Map<string, Set<string>>()
  for (const personagem of characters) {
    for (const ficha of fichas(personagem)) {
      if (ficha.length < MIN_FICHA) continue
      const alvo = candidatos.get(ficha) ?? new Set<string>()
      alvo.add(personagem)
      candidatos.set(ficha, alvo)
    }
  }

  const porPalavra = new Map<string, string>()
  for (const [ficha, donos] of candidatos) {
    // Palavra ambigua fica de fora em vez de chutar: "Greyrat" cabe em quatro
    // Greyrats, e escolher um deles seria inventar.
    if (donos.size === 1) porPalavra.set(ficha, [...donos][0]!)
  }

  /*
   * O mais longo primeiro, e o que casa e RISCADO do texto.
   *
   * Medido no recap: ele cadastrou "quincy" para o Askin e "rei quincy" para o
   * Yhwach. Casando ingenuamente, "o Rei Quincy" acionava os dois e o Askin
   * aparecia em duas frases que eram so do Yhwach -- 3 erros em vez de 1. Com o
   * mais longo ganhando e consumindo o trecho, o erro voltou a 1.
   */
  const apelidos = nicknames
    .map((n) => ({ termo: normalizarTexto(n.term).trim(), character: n.character }))
    .filter((n) => n.termo.length > 0)
    .sort((a, b) => b.termo.length - a.termo.length)

  return { porPalavra, apelidos }
}

/** Quem a frase nomeia por escrito ou por apelido. Vazio quando ninguem. */
export function readLine(frase: string, index: ScriptIndex): ScriptMatch[] {
  const texto = normalizarTexto(frase)
  const saida: ScriptMatch[] = []
  const vistos = new Set<string>()

  const guardar = (character: string, kind: ScriptMatchKind): void => {
    if (vistos.has(character)) return
    vistos.add(character)
    saida.push({ character, kind })
  }

  for (const palavra of texto.split(/[^a-z0-9]+/)) {
    const dono = index.porPalavra.get(palavra)
    if (dono) guardar(dono, 'name')
  }

  let restante = texto
  for (const apelido of index.apelidos) {
    if (!restante.includes(apelido.termo)) continue
    restante = restante.split(apelido.termo).join(' ')
    guardar(apelido.character, 'nickname')
  }

  return saida
}

/**
 * O roteiro inteiro, frase por frase, com o arrasto de pronome aplicado.
 *
 * Frase que nomeia alguem define quem esta em cena. Frase que nao nomeia
 * ninguem mas usa pronome herda a cena anterior. Frase que nao nomeia nem usa
 * pronome fica vazia de proposito -- e ali que entra o print solto ou a escolha
 * dele.
 */
export function readScript(frases: readonly string[], index: ScriptIndex): ScriptLine[] {
  const saida: ScriptLine[] = []
  let emCena: string[] = []

  for (const frase of frases) {
    const achados = readLine(frase, index)
    if (achados.length > 0) {
      emCena = achados.map((m) => m.character)
      saida.push({ matches: achados })
    } else if (PRONOMES.test(normalizarTexto(frase))) {
      saida.push({ matches: emCena.map((character) => ({ character, kind: 'carry' as const })) })
    } else {
      saida.push({ matches: [] })
    }
  }

  return saida
}

/**
 * Quebra a narracao em frases, mantendo o intervalo de tempo de cada uma.
 *
 * Os segmentos que o Whisper devolve nao sao frases: ele corta por respiro, e
 * uma frase costuma vir partida em dois ou tres. Juntar por pontuacao final e o
 * que faz "quem esta em cena" valer pelo que a frase diz, e nao por onde o
 * narrador respirou.
 */
export interface ScriptSentence {
  text: string
  start: number
  end: number
}

export function toSentences(
  segments: readonly { text: string; start: number; end: number }[],
): ScriptSentence[] {
  const saida: ScriptSentence[] = []
  let atual: ScriptSentence | null = null

  for (const segmento of segments) {
    const texto = segmento.text.trim()
    if (texto.length === 0) continue

    if (atual === null) {
      atual = { text: texto, start: segmento.start, end: segmento.end }
    } else {
      atual.text += ' ' + texto
      atual.end = segmento.end
    }

    // Reticencias no meio da fala nao fecham frase; ponto, exclamacao,
    // interrogacao e dois-pontos fecham.
    if (/[.!?:](["')\]]|\.\.\.)?$/.test(texto) && !texto.endsWith('...')) {
      saida.push(atual)
      atual = null
    }
  }

  if (atual !== null) saida.push(atual)
  return saida
}
