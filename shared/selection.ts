import type { LibraryClip } from './channels'
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

  const usados = new Set<string>()
  /** Onde o recap parou, para a proxima cena nao voltar no tempo. */
  let ultimo: LibraryClip | null = null

  const saida: SelectionBlock[] = []

  for (const linha of lines) {
    const querem = linha.matches.map((m) => m.character)
    const precisa = Math.max(linha.end - linha.start, 0.1)

    const pontuados: SelectionCandidate[] = []
    for (const clip of acervo) {
      if (usados.has(clip.id)) continue
      const p = pontuar(clip, querem, precisa, options.mode, ultimo)
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
): Nota | null {
  let score = 0
  const porques: string[] = []

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
     * Frase que nao nomeia ninguem pede plano SEM personagem identificado --
     * paisagem, plano aberto, detalhe. Sao quase dois tercos da biblioteca, que
     * de outro modo nunca seriam usados por nada.
     */
    if (clip.characters.length > 0) return null
    score += 40
    porques.push('plano sem personagem')
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
