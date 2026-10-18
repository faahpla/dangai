import type { EpisodeIndex } from '../../shared/episodio'
import type { EventosDaIa, RoteiroDaIa, SecaoDaIa } from '../../shared/roteiro'
import { canonizar } from '@shared/nomes'

/**
 * O ELENCO do episodio, com a grafia que a LEGENDA usa, e o conserto dos nomes
 * que a IA devolve.
 *
 * Por que: o indice tem duas fontes de nome que nao batem. O falante do .ass
 * diz "Senku"; o reconhecimento do AnCut/Corte Cenas diz "Ishigami, Senkuu"
 * (grafia do MyAnimeList, com a vogal longa do romaji). No .srt sem falante
 * (o S04E24) so sobra o nome do reconhecimento. A narracao e a legenda do
 * short tem que usar o nome que o espectador le na tela do anime -- "Senku",
 * nunca "Senkuu" --, e a parte 4 casa personagem de evento com personagem de
 * cena: grafia diferente quebraria o casamento.
 *
 * Regra: o falante da legenda manda; o personagem do indice entra com a
 * palavra do nome dele que mais aparece nas falas (com a grafia das falas).
 */

/** Honorificos japoneses no fim do nome ("Why-man-chan", "Senku-san"). */
const HONORIFICO = /-(kun|chan|san|sama|senpai|sensei|dono|tan|chin|han)$/i

/** Palavras de titulo que nao identificam ninguem sozinhas ("Dr. Xeno" -> "Xeno"). */
const TITULOS = new Set(['dr', 'mr', 'mrs', 'ms', 'miss', 'sir', 'lady', 'lord'])

/** Nomes de "falante" que nao sao gente: placa, narrador generico. */
const NAO_E_PERSONAGEM = new Set(['text', 'sign', 'signs', 'note', 'title', 'caption', 'song', 'lyrics', 'op', 'ed'])

/** Sem acento, minusculas, so letra e numero: "Why-Man" == "why-man". */
function semAcento(palavra: string): string {
  return palavra
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Uma palavra de nome -> a forma de comparar com o que a IA escreve: a
 * estrita sem a vogal longa do romaji ("Senkuu" == "Senku", "Ukyou" == "Ukyo").
 * Frouxa de proposito, e por isso nunca usada contra o texto em ingles da
 * legenda ("You" viraria "Yo").
 */
export function formaDoNome(palavra: string): string {
  return semAcento(palavra).replace(/ou/g, 'o').replace(/uu/g, 'u').replace(/oo/g, 'o')
}

/**
 * "Senkuu" -> "Senku", "Ukyou" -> "Ukyo", na grafia (com maiuscula). So o "uu"
 * e o "ou" do FIM: "Louise" no meio da palavra fica como esta.
 */
function semVogalLongaNaGrafia(palavra: string): string {
  return palavra.replace(/uu/g, 'u').replace(/UU/g, 'U').replace(/ou$/, 'o').replace(/OU$/, 'O')
}

/** "Why-man-chan" -> "Why-man"; "Senku" fica. */
export function semHonorifico(nome: string): string {
  return nome.trim().replace(HONORIFICO, '').trim()
}

/** "Ishigami, Senkuu" -> ["Senkuu", "Ishigami"]; "Dr. Xeno" -> ["Xeno"]. Ordem: nome antes do sobrenome. */
function palavrasDoNome(nome: string): string[] {
  const virgula = nome.indexOf(',')
  const ordenado = virgula > 0 ? `${nome.slice(virgula + 1)} ${nome.slice(0, virgula)}` : nome
  return ordenado
    .split(/\s+/)
    .map((p) => p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((p) => p.length >= 2 && !TITULOS.has(semAcento(p)))
}

export interface Personagem {
  /** A grafia que vai para o prompt, para os eventos e para a narracao. */
  nome: string
  /** Falas com esse falante (so .ass com Name). */
  falas: number
  /** Cenas em que o reconhecimento o viu. */
  cenas: number
  /** Os nomes crus do indice que viraram este (para a parte 4 casar com as cenas). */
  doIndice: string[]
}

export interface Elenco {
  /** Do mais presente ao menos. */
  personagens: Personagem[]
  /** A legenda tem falante (.ass com Name). */
  comFalante: boolean
  /** forma de UMA palavra -> nome do elenco. So as que apontam para um personagem so. */
  porPalavra: ReadonlyMap<string, string>
}

/**
 * Palavras com inicial maiuscula no TEXTO das falas: forma estrita -> grafia ->
 * vezes. E a grafia que o espectador le na tela. Nome com hifen conta inteiro
 * ("Why-Man"; "Senku-chan" conta como "Senku").
 */
function grafiasNasFalas(indice: Pick<EpisodeIndex, 'cues'>): Map<string, Map<string, number>> {
  const mapa = new Map<string, Map<string, number>>()
  for (const cue of indice.cues) {
    if (cue.tipo !== 'fala') continue
    for (const palavra of cue.texto.match(/\p{Lu}[\p{L}\p{M}]*(?:-\p{L}[\p{L}\p{M}]*)*/gu) ?? []) {
      const base = semHonorifico(palavra)
      const forma = semAcento(base)
      if (forma.length < 2) continue
      const grafias = mapa.get(forma) ?? new Map<string, number>()
      grafias.set(base, (grafias.get(base) ?? 0) + 1)
      mapa.set(forma, grafias)
    }
  }
  return mapa
}

function maisUsada(grafias: ReadonlyMap<string, number> | undefined): [string, number] | null {
  let melhor: [string, number] | null = null
  for (const [g, n] of grafias ?? []) if (!melhor || n > melhor[1]) melhor = [g, n]
  return melhor
}

/**
 * O elenco do episodio: falantes da legenda + personagens reconhecidos nas
 * cenas, com a grafia da legenda. Puro (le so o indice).
 */
export function elencoDoEpisodio(indice: Pick<EpisodeIndex, 'cues' | 'planos'>): Elenco {
  const porForma = new Map<string, Personagem>()
  const nasFalas = grafiasNasFalas(indice)

  // 1) Falantes do .ass: sao eles que dizem QUEM esta no episodio. A grafia e
  // a do TEXTO quando ele escreve o mesmo nome (o Name vem "Why-man-chan", o
  // texto diz "Why-Man"); senao, a do Name mais usada.
  let comFalante = false
  const doName = new Map<string, Map<string, number>>()
  for (const cue of indice.cues) {
    if (cue.tipo !== 'fala' || !cue.falante) continue
    for (const cru of cue.falante.split(/\s*(?:&|\/|\+|;|\band\b)\s*/i)) {
      const nome = semHonorifico(cru)
      const forma = formaDoNome(nome)
      if (forma.length < 2 || NAO_E_PERSONAGEM.has(forma)) continue
      comFalante = true
      const p = porForma.get(forma) ?? { nome, falas: 0, cenas: 0, doIndice: [] }
      p.falas += 1
      porForma.set(forma, p)
      const grafias = doName.get(forma) ?? new Map<string, number>()
      grafias.set(nome, (grafias.get(nome) ?? 0) + 1)
      doName.set(forma, grafias)
    }
  }
  for (const [forma, p] of porForma) {
    const name = maisUsada(doName.get(forma))?.[0] ?? p.nome
    p.nome = maisUsada(nasFalas.get(semAcento(name)))?.[0] ?? name
  }

  // 2) Personagens do reconhecimento, ja unidos por grafia (canonizar).
  const contagem = new Map<string, number>()
  for (const plano of indice.planos) for (const p of plano.personagens) contagem.set(p.nome, (contagem.get(p.nome) ?? 0) + 1)
  const canonico = canonizar(contagem)
  const cenasPorNome = new Map<string, { cenas: number; crus: string[] }>()
  for (const [cru, n] of contagem) {
    const nome = canonico.get(cru) ?? cru
    const g = cenasPorNome.get(nome) ?? { cenas: 0, crus: [] }
    g.cenas += n
    g.crus.push(cru)
    cenasPorNome.set(nome, g)
  }

  for (const [nomeDoIndice, { cenas, crus }] of cenasPorNome) {
    const palavras = palavrasDoNome(nomeDoIndice)
    if (palavras.length === 0) continue
    // Ja e um falante? (por qualquer palavra do nome: "Asagiri, Gen" -> "Gen")
    const falante = palavras.map((p) => porForma.get(formaDoNome(p))).find((p) => p !== undefined)
    if (falante) {
      falante.cenas += cenas
      falante.doIndice.push(...crus)
      continue
    }
    // A palavra do nome que mais aparece no texto das falas, com a grafia de
    // la ("Senkuu" acha "Senku"; a vogal longa so cai nos dois jeitos estreitos
    // de semVogalLongaNaGrafia).
    let escolha: [string, number] | null = null
    for (const p of palavras) {
      for (const k of new Set([semAcento(p), semAcento(semVogalLongaNaGrafia(p))])) {
        const achada = maisUsada(nasFalas.get(k))
        if (achada && (!escolha || achada[1] > escolha[1])) escolha = achada
      }
    }
    // Sem a palavra nas falas: o primeiro nome, sem a vogal longa do
    // MyAnimeList, que legenda em ingles nao escreve ("Ukyou" -> "Ukyo").
    const nome = escolha?.[0] ?? semVogalLongaNaGrafia(palavras[0]!)
    const forma = formaDoNome(nome)
    const p = porForma.get(forma) ?? { nome, falas: 0, cenas: 0, doIndice: [] }
    p.cenas += cenas
    p.doIndice.push(...crus)
    porForma.set(forma, p)
  }

  const personagens = [...porForma.values()].sort((a, b) => b.falas + b.cenas - (a.falas + a.cenas) || a.nome.localeCompare(b.nome))

  // Cada palavra de cada nome (o do elenco e os crus do indice) aponta para o
  // personagem -- menos as que apontariam para dois (sobrenome de familia).
  const alvo = new Map<string, string | null>()
  const registrar = (forma: string, nome: string): void => {
    if (forma.length < 2) return
    const antes = alvo.get(forma)
    if (antes === undefined) alvo.set(forma, nome)
    else if (antes !== nome) alvo.set(forma, null)
  }
  for (const p of personagens) {
    registrar(formaDoNome(p.nome), p.nome)
    for (const cru of p.doIndice) for (const palavra of palavrasDoNome(cru)) registrar(formaDoNome(palavra), p.nome)
  }
  // O nome do elenco ganha da palavra ambigua: "Gen" e sempre o Gen.
  for (const p of personagens) alvo.set(formaDoNome(p.nome), p.nome)
  const porPalavra = new Map<string, string>()
  for (const [forma, nome] of alvo) if (nome) porPalavra.set(forma, nome)

  return { personagens, comFalante, porPalavra }
}

/**
 * Um nome que a IA escreveu (num evento) -> o nome do elenco. "Senkuu
 * Ishigami", "Ishigami" e "Senku-san" viram "Senku". Fora do elenco, fica como
 * veio (sem honorifico): pode ser alguem que so e citado nas falas.
 */
export function acertarNome(nome: string, elenco: Elenco): string {
  const limpo = semHonorifico(nome)
  const direto = elenco.porPalavra.get(formaDoNome(limpo))
  if (direto) return direto
  const achados = new Set<string>()
  for (const palavra of palavrasDoNome(limpo)) {
    const n = elenco.porPalavra.get(formaDoNome(palavra))
    if (n) achados.add(n)
  }
  return achados.size === 1 ? [...achados][0]! : limpo
}

/**
 * Conserta a grafia dos nomes do elenco dentro de um texto corrido: "Senkuu"
 * -> "Senku", "Senku-san" -> "Senku". So mexe em palavra com inicial
 * maiuscula cuja forma e EXATAMENTE a de um nome do elenco -- "Ishigami" (outra
 * palavra do nome) fica, e palavra comum do portugues nunca e tocada.
 */
export function acertarNomesNoTexto(texto: string, elenco: Elenco): string {
  const nomes = new Map<string, string>()
  for (const p of elenco.personagens) if (!/\s/.test(p.nome)) nomes.set(formaDoNome(p.nome), p.nome)
  if (nomes.size === 0) return texto
  return texto.replace(/\p{Lu}[\p{L}\p{M}'’-]*/gu, (palavra) => {
    const base = semHonorifico(palavra)
    const nome = nomes.get(formaDoNome(base))
    if (!nome) return palavra
    // "SENKU" de enfase e "Senkuu" viram "Senku"; o resto da palavra (hifen de
    // honorifico) sai junto.
    return base === nome && base === palavra ? palavra : nome
  })
}

/** Os nomes dos eventos da IA no elenco, e a grafia dentro do resumo. */
export function acertarNomesDosEventos(bruto: EventosDaIa, elenco: Elenco): EventosDaIa {
  return {
    eventos: bruto.eventos.map((ev) => ({
      ...ev,
      resumo: acertarNomesNoTexto(ev.resumo, elenco),
      personagens: ev.personagens.map((n) => acertarNome(n, elenco)),
    })),
  }
}

function acertarFrases<T extends SecaoDaIa['frases'][number]>(frases: readonly T[], elenco: Elenco): T[] {
  return frases.map((f) => ({
    ...f,
    texto: acertarNomesNoTexto(f.texto, elenco),
    intencaoVisual: acertarNomesNoTexto(f.intencaoVisual, elenco),
    textoDeTela: f.textoDeTela === null ? null : acertarNomesNoTexto(f.textoDeTela, elenco),
  }))
}

export function acertarNomesDoRoteiro(bruto: RoteiroDaIa, elenco: Elenco): RoteiroDaIa {
  return {
    ...bruto,
    secoes: bruto.secoes.map((s) => ({ ...s, frases: acertarFrases(s.frases, elenco) })),
    // [A4] Os titulos sugeridos tambem com o nome do elenco (o texto de thumb e caixa alta: fica).
    titulos: (bruto.titulos ?? []).map((t) => acertarNomesNoTexto(t, elenco)),
  }
}

export function acertarNomesDaSecao(bruto: SecaoDaIa, elenco: Elenco): SecaoDaIa {
  return { frases: acertarFrases(bruto.frases, elenco) }
}

/** Para a lista do prompt: os N mais presentes. */
export function nomesDoElenco(elenco: Elenco, maximo = 30): string[] {
  return elenco.personagens.slice(0, maximo).map((p) => p.nome)
}
