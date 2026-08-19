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

/**
 * Tamanho minimo para uma palavra do texto valer como INICIO de um nome.
 *
 * Ele encurta nome ao escrever: "Sylphie" onde a biblioteca tem "Sylphiette".
 * Cinco letras e nao quatro porque quatro letras casariam pedaco de palavra
 * comum portuguesa com nome proprio.
 *
 * Medido nos tres roteiros reais dele (~800 palavras, 96 personagens): ganha
 * "sylphie" e nao produz NENHUM falso positivo.
 */
const MIN_PREFIXO = 5

export interface ScriptIndex {
  /** palavra do nome -> personagem, so quando a palavra identifica UM */
  porPalavra: Map<string, string>
  /** todas as palavras de nome, para casar nome encurtado por prefixo */
  fichas: Map<string, Set<string>>
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

  return { porPalavra, fichas: candidatos, apelidos }
}

/** Nome encurtado -> personagem. Cabe em UM, ou nao casa. */
function porPrefixo(palavra: string, index: ScriptIndex): string | null {
  if (palavra.length < MIN_PREFIXO) return null
  const donos = new Set<string>()
  for (const [ficha, quem] of index.fichas) {
    if (ficha.length > palavra.length && ficha.startsWith(palavra)) {
      for (const p of quem) donos.add(p)
    }
  }
  return donos.size === 1 ? [...donos][0]! : null
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
    const dono = index.porPalavra.get(palavra) ?? porPrefixo(palavra, index)
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
 * Quanto tempo um bloco pode durar, e o minimo para ele existir.
 *
 * Num short a imagem tem que trocar. Um bloco de 40 segundos nao e uma cena
 * longa: e um clipe de 4s congelado por 36, porque nenhum clipe da biblioteca
 * dele chega perto disso -- as cenas do AnCut tem 3 a 10 segundos.
 */
const BLOCO_MAX_SEC = 6
const BLOCO_MIN_SEC = 1.6

/** Fecha frase. Reticencia nao fecha: ela costuma ser pausa no meio da fala. */
const FIM_DE_FRASE = /[.!?](["')\]]?)$/

/** Corte de respiro dentro da frase, para quebrar frase comprida demais. */
const PAUSA_INTERNA = /[,;:](["')\]]?)$/

export interface ScriptSentence {
  text: string
  start: number
  end: number
}

/**
 * Quebra a narracao em blocos, um por frase, com tempo medido.
 *
 * Sai das PALAVRAS e nao dos segmentos, e isso foi aprendido errando: os
 * segmentos do Whisper quebram por respiro, no meio da frase
 * ("...ficou completamente" / "zerada depois de..."), e nenhum deles termina em
 * ponto. Juntando segmento ate achar pontuacao, a narracao real do Kintay
 * (69s, 265 palavras) virou QUATRO blocos, um deles com 41 segundos -- e num
 * bloco de 41s nenhum clipe serve, entao a escolha degenerou.
 *
 * A palavra sabe o que o segmento nao sabe: quando o texto vem do roteiro dele,
 * a pontuacao e a que ele escreveu, exata.
 */
export function toSentences(
  words: readonly { text: string; start: number; end: number }[],
  maxSec: number = BLOCO_MAX_SEC,
  minSec: number = BLOCO_MIN_SEC,
): ScriptSentence[] {
  const limpas = words.filter((w) => w.text.trim().length > 0)
  if (limpas.length === 0) return []

  // 1. por pontuacao final
  const frases: (typeof limpas)[] = []
  let atual: typeof limpas = []
  for (const palavra of limpas) {
    atual = [...atual, palavra]
    if (FIM_DE_FRASE.test(palavra.text.trim())) {
      frases.push(atual)
      atual = []
    }
  }
  if (atual.length > 0) frases.push(atual)

  // 2. frase comprida demais quebra nas pausas internas
  const partidas = frases.flatMap((frase) => quebrar(frase, maxSec))

  /*
   * 3. sobra curta demais se junta a uma vizinha.
   *
   * Para TRAS quando cabe, para a FRENTE quando nao cabe. As duas direcoes
   * porque so a de tras deixava orfao: "E nem sentiu." dura meio segundo e vem
   * depois de um bloco de 5.9s -- juntar ali estouraria o teto, e o bloco
   * ficava sozinho com 0.5s, que na tela e um flash, nao um corte.
   */
  const blocos: (typeof limpas)[] = [...partidas]
  const dura = (b: (typeof limpas)[number][]): number => b[b.length - 1]!.end - b[0]!.start

  for (let i = 0; i < blocos.length; i++) {
    if (blocos.length === 1) break
    if (dura(blocos[i]!) >= minSec) continue

    const tras = i > 0 ? [...blocos[i - 1]!, ...blocos[i]!] : null
    const frente = i < blocos.length - 1 ? [...blocos[i]!, ...blocos[i + 1]!] : null
    const cabe = [tras, frente].filter((c): c is (typeof limpas)[number][] => c !== null && dura(c) <= maxSec)
    // Nenhuma das duas cabe: junta na menor mesmo assim. Um bloco um pouco
    // acima do teto e melhor que meio segundo de imagem.
    const escolha =
      cabe.length > 0
        ? cabe.reduce((a, b) => (dura(a) <= dura(b) ? a : b))
        : [tras, frente].filter((c) => c !== null).reduce((a, b) => (dura(a!) <= dura(b!) ? a : b))!

    if (escolha === tras) {
      blocos.splice(i - 1, 2, escolha)
      i -= 1
    } else {
      blocos.splice(i, 2, escolha)
      i -= 1
    }
  }

  return blocos.map((bloco) => ({
    text: bloco.map((w) => w.text.trim()).join(' '),
    start: bloco[0]!.start,
    end: bloco[bloco.length - 1]!.end,
  }))
}

/**
 * Parte uma frase comprida no respiro mais central.
 *
 * A virgula primeiro, porque ali a narracao ja pausa e o corte nao se ouve.
 * Sem virgula nenhuma, parte no meio das palavras: uma frase de doze segundos
 * sem pausa nenhuma ainda precisa trocar de imagem.
 */
function quebrar<T extends { start: number; end: number; text: string }>(
  frase: readonly T[],
  maxSec: number,
): T[][] {
  const dura = frase[frase.length - 1]!.end - frase[0]!.start
  if (dura <= maxSec || frase.length < 4) return [[...frase]]

  const meio = frase[0]!.start + dura / 2
  const candidatos = frase
    .map((palavra, i) => ({ i, palavra }))
    .slice(1, -1)
    .filter(({ palavra }) => PAUSA_INTERNA.test(palavra.text.trim()))

  const corte =
    candidatos.length > 0
      ? candidatos.reduce((a, b) =>
          Math.abs(a.palavra.end - meio) <= Math.abs(b.palavra.end - meio) ? a : b,
        ).i
      : Math.floor(frase.length / 2) - 1

  return [
    ...quebrar(frase.slice(0, corte + 1), maxSec),
    ...quebrar(frase.slice(corte + 1), maxSec),
  ]
}
