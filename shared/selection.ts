import type { LibraryClip, SceneDescription } from './channels'
import type { ScriptLine } from './script-reader'

/**
 * Escolher o clipe de cada bloco do roteiro.
 *
 * Depois que o leitor diz QUEM esta em cada frase, falta dizer QUAL cena
 * mostrar. Nao ha modelo aqui tambem: a decisao e um casamento entre o que a
 * frase pede (personagem, duracao, ordem) e o que a biblioteca tem.
 *
 * A saida nao e uma escolha, e uma FITA de candidatos com o primeiro ja
 * aplicado. Isso e deliberado: num video de teoria a imagem errada contradiz a
 * narracao, e o custo de trocar tem que ser uma seta, nao uma busca.
 */

/**
 * Recap ou teoria. Muda uma coisa so, mas ela e decisiva.
 *
 * No RECAP o video reconta um episodio, entao a cena tem que andar para a
 * frente: mostrar o soco depois da reacao ao soco estraga a leitura mesmo com o
 * personagem certo. No modo teoria a ordem e a do argumento -- ele mistura
 * temporadas e series de proposito -- e cobrar cronologia so tiraria material
 * bom da frente.
 */
export type SelectionMode = 'recap' | 'theory'

export interface SelectionCandidate {
  clip: LibraryClip
  score: number
  /** Por que este entrou. A interface mostra, para ele saber se confia. */
  reason: string
}

export interface SelectionBlock {
  start: number
  end: number
  text: string
  /** Quem o leitor achou nesta frase, na ordem de confianca dele. */
  characters: string[]
  /** O primeiro e o aplicado; o resto e a fita. Vazio quando nao havia material. */
  candidates: SelectionCandidate[]
}

export interface SelectionOptions {
  mode: SelectionMode
  /** Quantos candidatos por bloco. 6 cabe numa fita sem rolagem. */
  fita?: number
  /**
   * Limita a biblioteca a estas series. Ausente = deduz do proprio roteiro.
   *
   * Deduzir da certo porque nome de personagem nao colide entre as series dele
   * -- medido: nas 7 series, 96 personagens, ZERO palavra de nome aparece em
   * duas. Por isso o leitor pode indexar a biblioteca inteira sem perder nada,
   * e nao ha um seletor de serie a mais entre ele e o video.
   */
  series?: readonly string[]
  /**
   * O que cada cena mostra, por id: emocao, acao, cenario, plano.
   *
   * Sem isso a pontuacao so tem personagem para olhar -- e o AnCut so etiquetou
   * personagem em 34% do acervo dele (medido: 6.594 de 19.495 cenas). Nos
   * outros dois tercos a escolha era as cegas, que e por que a montagem
   * automatica "nao identificava nada do que o roteiro fala".
   */
  descriptions?: Record<string, SceneDescription>
}

/** Quantos candidatos a fita mostra. */
export const FITA_PADRAO = 6

/**
 * Clipe curto demais nao serve nem congelando.
 *
 * Quando o clipe acaba antes do bloco o ultimo frame congela (ver
 * sourceDurationInFrames). Congelar meio segundo passa; congelar quatro
 * segundos vira um print, e ai era melhor ter escolhido outro clipe.
 */
const CONGELAMENTO_TOLERAVEL_SEC = 1.5

export function selectClips(
  lines: readonly (ScriptLine & { text: string; start: number; end: number })[],
  clips: readonly LibraryClip[],
  options: SelectionOptions,
): SelectionBlock[] {
  const fita = options.fita ?? FITA_PADRAO
  const series = options.series ?? inferirSeries(lines, clips)
  const acervo = series.length > 0 ? clips.filter((c) => series.includes(c.anime)) : clips
  const descricoes = options.descriptions ?? {}

  const usados = new Set<string>()
  /** Onde o recap parou, para a proxima cena nao voltar no tempo. */
  let ultimo: LibraryClip | null = null

  const saida: SelectionBlock[] = []

  for (const linha of lines) {
    const querem = linha.matches.map((m) => m.character)
    const precisa = Math.max(linha.end - linha.start, 0.1)
    // As palavras da frase saem UMA vez por bloco, nao uma por clipe: sao
    // ~19 mil clipes por bloco no acervo dele.
    const frase = palavrasUteis(linha.text)

    const pontuados: SelectionCandidate[] = []
    for (const clip of acervo) {
      if (usados.has(clip.id)) continue
      const p = pontuar(clip, querem, precisa, options.mode, ultimo, frase, descricoes[clip.id])
      if (p === null) continue
      pontuados.push({ clip, score: p.score, reason: p.reason })
    }

    pontuados.sort((a, b) => b.score - a.score || desempate(a.clip, b.clip))
    const candidatos = pontuados.slice(0, fita)

    /*
     * So o ESCOLHIDO e marcado como usado. Os outros cinco continuam livres
     * para o proximo bloco -- se reservassemos a fita inteira, seis blocos
     * seguidos gastariam 36 clipes e os ultimos ficariam sem nada.
     */
    const escolhido = candidatos[0]
    if (escolhido) {
      usados.add(escolhido.clip.id)
      if (options.mode === 'recap') ultimo = escolhido.clip
    }

    saida.push({
      start: linha.start,
      end: linha.end,
      text: linha.text,
      characters: querem,
      candidates: candidatos,
    })
  }

  return saida
}

/*
 * Palavras que aparecem em toda frase e nao dizem nada sobre imagem.
 *
 * Sem essa lista "de" e "que" casariam com metade da biblioteca e a pontuacao
 * viraria ruido.
 */
const VAZIAS = new Set([
  'a', 'as', 'ao', 'aos', 'e', 'o', 'os', 'da', 'das', 'do', 'dos', 'de', 'em', 'na', 'nas',
  'no', 'nos', 'um', 'uma', 'uns', 'umas', 'por', 'para', 'com', 'sem', 'que', 'se', 'ja',
  'mas', 'mais', 'muito', 'como', 'quando', 'onde', 'ele', 'ela', 'eles', 'elas', 'eu', 'voce',
  'seu', 'sua', 'seus', 'suas', 'meu', 'minha', 'isso', 'isto', 'aquilo', 'esse', 'essa',
  'este', 'esta', 'ser', 'sao', 'era', 'foi', 'esta', 'estava', 'tem', 'ter', 'ate', 'so',
  'tambem', 'depois', 'antes', 'entao', 'porque', 'pelo', 'pela', 'nao', 'sim', 'aqui', 'ali',
])

/** Acento fora e minusculas: o roteiro escreve "tensao", o modelo devolve "tensão". */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * As palavras de um texto que valem para casar imagem.
 *
 * Corta plural e alguns finais para "batalhas" achar "batalha" e "guerreiros"
 * achar "guerreiro". Nao e um radicalizador de verdade -- e o suficiente para
 * o que o modelo devolve, que sao poucas palavras por campo.
 */
function palavrasUteis(texto: string): Set<string> {
  const fora = new Set<string>()
  for (const cru of normalizar(texto).split(/[^a-z0-9]+/)) {
    if (cru.length < 4 || VAZIAS.has(cru)) continue
    fora.add(cru)
    if (cru.endsWith('s') && cru.length > 4) fora.add(cru.slice(0, -1))
  }
  return fora
}

/**
 * Quanto o que a cena mostra conversa com o que a frase diz.
 *
 * Medido em 100 cenas do acervo dele: EMOCAO e um vocabulario pequeno e
 * repetido (28 palavras em 100 cenas, 78% nas dez mais comuns), entao casar
 * emocao vale muito. ACAO e CENARIO sao frases quase-duplicadas -- "olhando
 * para frente", "olhando com furia" -- 80 formas diferentes em 100 cenas; por
 * isso o casamento e PALAVRA A PALAVRA e nao frase inteira, senao nunca bateria.
 */
function casarDescricao(frase: Set<string>, descricao: SceneDescription): Nota | null {
  if (frase.size === 0) return null
  let score = 0
  const porques: string[] = []
  /*
   * Casar com a frase, em qualquer campo, ja vale por si.
   *
   * Sem esta base o casamento perdia para uma cena que nao casou nada: um
   * unico acerto de cenario dava 12 e a cena sem personagem levava 40 so por
   * nao ter dado nenhum. Premiar ausencia de informacao era o erro.
   */
  const BASE = 25

  const emocao = palavrasUteis(descricao.emocao)
  for (const palavra of emocao) {
    if (frase.has(palavra)) {
      score += 30
      porques.push(descricao.emocao)
      break
    }
  }

  // Ate duas palavras por campo: uma cena que casa "batalha" e "guerreiro" diz
  // mais que uma que casa so "batalha", mas somar sem teto deixaria uma
  // descricao comprida ganhar de um personagem certo.
  for (const [campo, peso] of [
    [descricao.acao, 18],
    [descricao.cenario, 12],
  ] as const) {
    let batidas = 0
    for (const palavra of palavrasUteis(campo)) {
      if (frase.has(palavra) && batidas < 2) {
        score += peso
        batidas++
      }
    }
    if (batidas > 0) porques.push(campo)
  }

  return score > 0 ? { score: score + BASE, reason: porques.join(', ') } : null
}

interface Nota {
  score: number
  reason: string
}

function pontuar(
  clip: LibraryClip,
  querem: readonly string[],
  precisa: number,
  mode: SelectionMode,
  ultimo: LibraryClip | null,
  frase: Set<string>,
  descricao: SceneDescription | undefined,
): Nota | null {
  let score = 0
  const porques: string[] = []

  const casou = descricao ? casarDescricao(frase, descricao) : null

  if (querem.length > 0) {
    const tem = querem.filter((p) => clip.characters.includes(p))
    if (tem.length === 0) return null // personagem errado nao entra na fita

    /*
     * Peso alto e proposital: entre um clipe com o personagem certo e um clipe
     * bonito, o certo ganha sempre. Errar o personagem e o unico erro que o
     * espectador percebe sem saber editar.
     */
    score += tem.length * 100
    porques.push(tem.join(' e '))

    // Cena so dele vale mais que cena com meia duzia de gente: num bloco de tres
    // segundos o olho nao acha quem a narracao esta citando.
    if (clip.characters.length === tem.length) {
      score += 25
      porques.push('so ele em cena')
    } else {
      score -= (clip.characters.length - tem.length) * 8
    }
  } else {
    /*
     * Frase que nao nomeia ninguem.
     *
     * Antes isto rejeitava todo clipe COM personagem, na premissa de que as
     * cenas sem personagem eram paisagem e plano aberto. A premissa era falsa:
     * o AnCut so etiquetou 34% do acervo, e lendo as outras acha-se Ichigo,
     * Akaza e Rudeus nelas. A regra dura, somada a de cima, fazia a montagem
     * alternar entre dois baldes e deixava a maior parte da biblioteca
     * invisivel -- era isso, mais que a qualidade das etiquetas, que fazia a
     * montagem automatica "nao identificar nada do que o roteiro fala".
     *
     * Agora: sem descricao para consultar, mantem-se o comportamento antigo,
     * que ao menos era previsivel. Com descricao, o que a cena MOSTRA decide, e
     * cena sem personagem so ganha uma preferencia -- nao um veto.
     */
    if (!casou) {
      if (clip.characters.length > 0) return null
      // Desempate, nao argumento: cena que nao casou nada com a frase nao pode
      // ganhar de cena que casou, so por lhe faltar etiqueta de personagem.
      score += 15
      porques.push('plano sem personagem')
    } else if (clip.characters.length === 0) {
      score += 20
    }
  }

  if (casou) {
    score += casou.score
    porques.push(casou.reason)
  }

  const sobra = clip.duration - precisa
  if (sobra >= 0) {
    // Cobre o bloco. Sobrar muito nao e problema (o clipe e cortado), mas o que
    // sobra justo aproveita a cena inteira -- ate 3s de folga ganha.
    score += 30 - Math.min(sobra, 15) * 1.5
    porques.push('cobre o bloco')
  } else if (-sobra <= CONGELAMENTO_TOLERAVEL_SEC) {
    score += 10 + sobra * 5
    porques.push('congela ' + (-sobra).toFixed(1) + 's no fim')
  } else {
    return null // curto demais: viraria print
  }

  if (mode === 'recap' && ultimo) {
    /*
     * Andar para a frente no mesmo episodio e o que faz o recap se ler como
     * recap. Voltar nao e proibido -- as vezes a narracao volta mesmo -- mas
     * perde para qualquer cena equivalente que siga em frente.
     */
    if (clip.season === ultimo.season && clip.episode === ultimo.episode) {
      if (clip.start > ultimo.start) {
        score += 35
        porques.push('segue de onde parou')
      } else {
        score -= 30
      }
    } else if (
      clip.season > ultimo.season ||
      (clip.season === ultimo.season && clip.episode > ultimo.episode)
    ) {
      score += 15
      porques.push('episodio seguinte')
    } else {
      score -= 20
    }
  }

  return { score, reason: porques.join(', ') }
}

/**
 * De que serie e este video, olhando so os personagens que o roteiro cita.
 *
 * Isto existe por causa do bloco que NAO cita ninguem. Ele pede plano sem
 * personagem, e sem esta trava o candidato melhor pontuado poderia ser uma
 * paisagem de Avatar no meio de um recap de Bleach -- plano sem personagem e
 * plano sem personagem em qualquer serie, e nada no texto denunciaria.
 *
 * Sai vazio quando o roteiro nao cita ninguem em lugar nenhum, e ai a
 * biblioteca inteira vale mesmo: nao ha o que contradizer.
 */
function inferirSeries(
  lines: readonly (ScriptLine & { text: string; start: number; end: number })[],
  clips: readonly LibraryClip[],
): string[] {
  const citados = new Set(lines.flatMap((l) => l.matches.map((m) => m.character)))
  if (citados.size === 0) return []
  const series = new Set<string>()
  for (const clip of clips) {
    if (clip.characters.some((c) => citados.has(c))) series.add(clip.anime)
  }
  return [...series]
}

/** Empate: a cena mais cedo primeiro, para a saida nao depender da ordem do disco. */
function desempate(a: LibraryClip, b: LibraryClip): number {
  return a.season - b.season || a.episode - b.episode || a.start - b.start || a.id.localeCompare(b.id)
}
