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
 * Tres segundos e teto DURO, e e o numero dele: "NO MAXIMO 3s e olhe la, pq
 * isso ja e demais". Num short a imagem parada por cinco segundos ja perdeu o
 * espectador -- quem edita isso todo dia sabe o ritmo melhor que qualquer
 * regra que eu inventasse.
 *
 * Por isso juntar sobra curta NUNCA estoura o teto: um bloco de 0,9s e pior
 * que o ideal, mas um de 3,5s quebra a regra que ele deu.
 */
const BLOCO_MAX_SEC = 3
const BLOCO_MIN_SEC = 1

/**
 * Fecha frase.
 *
 * Reticencia NAO fecha: "Gaste tudo... e desapareca." e uma frase so, e ali as
 * reticencias sao a pausa dramatica dela. Cortar no meio poria uma imagem nova
 * bem no suspense.
 */
const FIM_DE_FRASE = /(^|[^.])[.!?](["')\]]?)$/

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

  // 2. frase comprida demais quebra nas pausas internas, sem perder de vista
  //    de QUAL frase cada pedaco veio
  const partidas = frases.flatMap((frase, iFrase) =>
    quebrar(frase, maxSec).map((parte) => ({ parte, frase: iFrase })),
  )

  /*
   * 3. sobra curta demais se junta a uma vizinha.
   *
   * Para TRAS quando cabe, para a FRENTE quando nao cabe. As duas direcoes
   * porque so a de tras deixava orfao: "E nem sentiu." dura meio segundo e vem
   * depois de um bloco de 5.9s -- juntar ali estouraria o teto, e o bloco
   * ficava sozinho com 0.5s, que na tela e um flash, nao um corte.
   */
  const blocos = [...partidas]
  const dura = (b: (typeof limpas)[number][]): number => b[b.length - 1]!.end - b[0]!.start

  for (let i = 0; i < blocos.length; i++) {
    if (dura(blocos[i]!.parte) >= minSec) continue

    /*
     * So junta pedaco da MESMA frase.
     *
     * Atravessar um ponto final juntaria duas ideias num bloco so, que e
     * exatamente o que a pontuacao esta dizendo para nao fazer -- "E nao e
     * teoria de fa." e "Nos episodios recentes..." sao dois assuntos. O preco e
     * que uma frase curtissima fica um bloco curtissimo, e esse preco e a regra
     * dele: a pontuacao manda.
     */
    const mesma = (j: number): boolean => blocos[j]?.frase === blocos[i]!.frase
    const tras = i > 0 && mesma(i - 1) ? [...blocos[i - 1]!.parte, ...blocos[i]!.parte] : null
    const frente =
      i < blocos.length - 1 && mesma(i + 1) ? [...blocos[i]!.parte, ...blocos[i + 1]!.parte] : null

    const cabe = [tras, frente].filter(
      (c): c is (typeof limpas)[number][] => c !== null && dura(c) <= maxSec,
    )
    // Nenhuma das duas cabe no teto: o bloco curto fica curto. O teto e dele e
    // e duro -- estourar para arredondar seria trocar a regra dele pela minha.
    if (cabe.length === 0) continue
    const escolha = cabe.reduce((a, b) => (dura(a) <= dura(b) ? a : b))

    const inicio = escolha === tras ? i - 1 : i
    blocos.splice(inicio, 2, { parte: escolha, frase: blocos[i]!.frase })
    i = inicio - 1
  }

  return blocos.map(({ parte }) => ({
    text: parte.map((w) => w.text.trim()).join(' '),
    start: parte[0]!.start,
    end: parte[parte.length - 1]!.end,
  }))
}

/**
 * Parte uma frase comprida no respiro mais central.
 *
 * A pontuacao manda, sempre: primeiro o ponto (que ja separou as frases), aqui
 * a virgula, o ponto-e-virgula e os dois-pontos. Ali a narracao ja pausa e o
 * corte nao se ouve.
 *
 * Sem pontuacao nenhuma, parte no meio das palavras -- uma frase de nove
 * segundos corrida ainda precisa trocar de imagem tres vezes, e nao ha
 * pontuacao que ajude.
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

// ------------------------------------------------------------- trechos

/**
 * Onde um TRECHO termina: qualquer pontuacao, inclusive reticencia.
 *
 * Mais fino que FIM_DE_FRASE de proposito. A frase e a unidade da IDEIA; o
 * trecho e a unidade do CORTE, e sao coisas diferentes. Palavras dele:
 * "eu quero ter a possibilidade de selecionar a linha inteira antes de qualquer
 * pontuacao, virgula ou qualquer coisa do genero".
 *
 * Reticencia entra na lista por escolha dele. Ela nao fecha a FRASE -- "morrer
 * e voltar… ela decide" continua uma ideia so -- mas fecha o trecho, porque
 * pausa dramatica costuma ser um bom lugar para a imagem trocar.
 *
 * As DUAS formas contam. "..." ja fechava por terminar em ponto, mas o roteiro
 * dele sai do editor com “…”, o caractere unico U+2026 -- medido no Resumo
 * S4EP02: quatro reticencias, todas U+2026, nenhuma com tres pontos. Sem ele
 * na lista, "morrer e voltar… ela decide que quer experimentar todas as mortes
 * dele." virava um trecho so de cinco segundos.
 */
const FIM_DE_TRECHO = /[.!?,;:…](["')\]]?)$/

/** Um pedaco de frase que ele pode marcar sozinho. */
export interface ScriptPiece {
  text: string
  start: number
  end: number
  /** A qual frase este trecho pertence, contando do zero. */
  sentence: number
}

/**
 * Quebra a narracao em TRECHOS, e diz de qual frase cada um veio.
 *
 * Devolve a lista achatada, e nao a arvore: tudo que ja existe -- o que ele
 * marcou, a pintura, a divisao do tempo, o plano montado -- trabalha com uma
 * lista de blocos, e o numero da frase e o suficiente para a tela agrupar de
 * volta. Trocar a lista por arvore obrigaria a reescrever quatro coisas que
 * funcionam para ganhar nada.
 *
 * Trecho que ele deixar vazio nao vira bloco: o tempo dele e absorvido pela
 * cena anterior. E o que deixa marcar so onde ele quer que a imagem troque.
 */
export function toPieces(
  words: readonly { text: string; start: number; end: number }[],
): ScriptPiece[] {
  const limpas = words.filter((w) => w.text.trim().length > 0)
  if (limpas.length === 0) return []

  const saida: ScriptPiece[] = []
  let atual: typeof limpas = []
  let frase = 0

  const fechar = (): void => {
    if (atual.length === 0) return
    saida.push({
      text: atual.map((w) => w.text.trim()).join(' '),
      start: atual[0]!.start,
      end: atual[atual.length - 1]!.end,
      sentence: frase,
    })
    atual = []
  }

  for (const palavra of limpas) {
    atual = [...atual, palavra]
    const texto = palavra.text.trim()
    if (!FIM_DE_TRECHO.test(texto)) continue

    // A frase so avanca no ponto final -- a virgula fecha o trecho e continua
    // na mesma ideia.
    const fechaFrase = FIM_DE_FRASE.test(texto)
    fechar()
    if (fechaFrase) frase += 1
  }
  fechar()

  return saida
}
