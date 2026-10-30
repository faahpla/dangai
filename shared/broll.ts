import type { LibraryClip } from './channels'
import { normalizarTexto, readLine, readScript, type ScriptIndex } from './script-reader'

/**
 * O B-ROLL: o bloco de notas que ele escreve junto do roteiro, dizendo de que
 * EPISODIO sai o material de cada parte do video.
 *
 *   1. Episodio 50 -- DEATH & STRAWBERRY (4a parte, episodio 10)
 *      - Cobre a abertura sobre o ultimo episodio, o salto de dez anos...
 *      - Cenas principais: reencontro dos personagens, Kazui, Aizen no Muken...
 *
 * Duas coisas saem dele, e nenhuma usa modelo:
 *
 *   1. os episodios -- o numero bate com a pasta do AnCut (Episodio 50 =
 *      S01E50), e o acervo de 54 mil cenas vira o de cinco episodios;
 *   2. qual FRASE do roteiro cada item cobre -- pelas palavras que os dois
 *      dividem ("Still Silver", "Almighty", "Muken").
 *
 * E PREFERENCIA, nunca trava: no video do Bleach que ele ja tinha feito, 46 das
 * 62 cenas vieram dos episodios da lista; as outras, das aberturas (9) e de
 * episodios fora dela (7). A cena de fora continua a um clique.
 */

/** Onde procurar: o episodio, e a temporada quando o B-roll diz qual. */
export interface AlvoDoBroll {
  /** null = "Episodio 50", sem temporada: vale o 50 de qualquer uma. */
  temporada: number | null
  episodio: number
}

export interface ItemDoBroll {
  /** A linha do episodio como ele escreveu, sem a marcacao de lista. */
  titulo: string
  /**
   * Mais de um quando o B-roll da as duas contas: "Episodio 50 (4a parte,
   * episodio 10)". A biblioteca dele numera de um jeito por anime -- Bleach
   * pelo numero corrido (S01E50), Re:Zero por temporada (S04E09) --, entao as
   * duas valem, e e a pasta que existe que decide.
   */
  alvos: AlvoDoBroll[]
  /** O resto do item: o que ele cobre do roteiro e as cenas. E o que casa com as frases. */
  texto: string
}

const NUMERO = '(\\d{1,4})'
const TEMPORADA = '(?:temporada|parte|season|cour)'
const EPISODIO = '(?:epis[oó]dios?|eps?\\.?)'

/** Lista, numeracao e negrito antes do texto: "1. ", "**", "- ", "### ". */
const MARCA_DE_LISTA = /^[\s#>*_•·\-–—]*(?:\(?\d{1,2}[.)\]:]\s+|\d{1,2}\s*[-–—]\s+)?[\s*_]*/

const CABECA_EPISODIO = new RegExp(`^${EPISODIO}\\s*${NUMERO}`, 'i')
const CABECA_SXE = new RegExp(`^[st]\\s*(\\d{1,2})\\s*[:.\\-– ]?\\s*e(?:p\\.?)?\\s*${NUMERO}\\b`, 'i')
const CABECA_TEMPORADA = new RegExp(
  `^(?:(\\d{1,2})\\s*[ªaº°]?\\s*${TEMPORADA}|${TEMPORADA}\\s*(\\d{1,2}))\\s*[,:\\-–—]?\\s*${EPISODIO}\\s*${NUMERO}`,
  'i',
)

/** As outras contas na mesma linha: "(4a parte, episodio 10)", "S04E10". */
const OUTRA_CONTA = [
  new RegExp(`(\\d{1,2})\\s*[ªaº°]?\\s*${TEMPORADA}\\s*[,:\\-–—]?\\s*${EPISODIO}\\s*${NUMERO}`, 'gi'),
  new RegExp(`${TEMPORADA}\\s*(\\d{1,2})\\s*[,:\\-–—]?\\s*${EPISODIO}\\s*${NUMERO}`, 'gi'),
  /\b[st](\d{1,2})\s*e(\d{1,4})\b/gi,
]

/**
 * "47 e 48", "47, 48", "47 a 49" depois do numero da cabeca.
 *
 * O numero seguinte so conta se nao for de temporada: em "Episodio 50, 4a parte"
 * o 4 e da parte, e em "Episodio 50 -- 4a parte" o traco nao e intervalo.
 */
function maisEpisodios(resto: string, primeiro: number): number[] {
  const saida = [primeiro]
  let ultimo = primeiro
  let cauda = resto
  for (;;) {
    const m = /^\s*(,|e|&|\/|a|at[eé]|-|–|—)\s*(\d{1,4})(?!\d|\s*[ªº°]|\s*(?:a\s+)?(?:temporada|parte|season|cour))/i.exec(cauda)
    if (!m) break
    const n = Number(m[2])
    const intervalo = /^(a|at[eé]|-|–|—)$/i.test(m[1]!)
    if (intervalo) {
      // Traco que nao sobe nao e intervalo ("50 - 4"): para aqui.
      if (n <= ultimo || n - ultimo > 12) break
      for (let e = ultimo + 1; e <= n; e++) saida.push(e)
    } else {
      saida.push(n)
    }
    ultimo = n
    cauda = cauda.slice(m[0].length)
  }
  return saida
}

/** "| Geral 34": o numero corrido, ao lado do da temporada. */
const GERAL = /\bgeral\s*(\d{1,4})\b/gi

/**
 * Os alvos da linha, ou null quando ela nao e uma cabeca de episodio.
 *
 * `temporadaDoTrecho` vem de uma linha de secao mais acima ("Cyberpunk:
 * Edgerunners 2 -- 2a temporada"): "Episodio 4" embaixo dela e o 4 DA 2a.
 */
function cabeca(linha: string, temporadaDoTrecho: number | null = null): AlvoDoBroll[] | null {
  const limpa = linha.replace(MARCA_DE_LISTA, '')
  let alvos: AlvoDoBroll[] | null = null

  const t = CABECA_TEMPORADA.exec(limpa)
  const sxe = CABECA_SXE.exec(limpa)
  const ep = CABECA_EPISODIO.exec(limpa)
  if (t) alvos = [{ temporada: Number(t[1] ?? t[2]), episodio: Number(t[3]) }]
  else if (sxe) alvos = [{ temporada: Number(sxe[1]), episodio: Number(sxe[2]) }]
  else if (ep) {
    const resto = limpa.slice(ep[0].length)
    alvos = maisEpisodios(resto, Number(ep[1])).map((episodio) => ({ temporada: temporadaDoTrecho, episodio }))
  }
  if (!alvos) return null

  const juntar = (outro: AlvoDoBroll): void => {
    if (!alvos!.some((a) => a.temporada === outro.temporada && a.episodio === outro.episodio)) alvos!.push(outro)
  }
  for (const re of OUTRA_CONTA) {
    re.lastIndex = 0
    for (const m of limpa.matchAll(re)) juntar({ temporada: Number(m[1]), episodio: Number(m[2]) })
  }
  for (const m of limpa.matchAll(GERAL)) juntar({ temporada: null, episodio: Number(m[1]) })
  return alvos
}

/**
 * Uma linha de SECAO, que diz a temporada dos episodios de baixo: termina em
 * "2a temporada" / "temporada 2" / "season 2". So temporada: "4a parte" e
 * contagem de cour, e a biblioteca dele numera Bleach pelo numero corrido.
 */
function secaoDeTemporada(linha: string): number | null {
  const limpa = semMarcacao(linha)
  if (limpa.length > 80) return null
  const m = /(?:(\d{1,2})\s*[ªaº°]?\s*(?:temporada|season)|(?:temporada|season)\s*(\d{1,2}))\s*:?\s*$/i.exec(limpa)
  return m ? Number(m[1] ?? m[2]) : null
}

/** Negrito e sublinhado do markdown fora: o texto fica como ele leria. */
function semMarcacao(linha: string): string {
  return linha.replace(MARCA_DE_LISTA, '').replace(/\*\*|__|`/g, '').trim()
}

/** Os itens do B-roll, na ordem em que ele escreveu. Vazio quando o texto nao e um. */
export function lerBroll(texto: string): ItemDoBroll[] {
  const itens: ItemDoBroll[] = []
  let atual: { titulo: string; alvos: AlvoDoBroll[]; linhas: string[] } | null = null
  const fechar = (): void => {
    if (!atual) return
    const titulo = atual.titulo
    // O titulo entra no texto sem a parte do numero: "DEATH & STRAWBERRY".
    const nome = titulo.replace(new RegExp(`^.*?${NUMERO}\\s*[-–—:]*`, 'i'), '')
    itens.push({ titulo, alvos: atual.alvos, texto: [nome, ...atual.linhas].join('\n').trim() })
  }
  let temporadaDoTrecho: number | null = null
  for (const linha of texto.split(/\r?\n/)) {
    if (linha.trim() === '') continue
    const alvos = cabeca(linha, temporadaDoTrecho)
    if (alvos && atual && atual.linhas.length === 0 && alvos.some((a) => atual!.alvos.some((b) => b.episodio === a.episodio))) {
      /*
       * Duas cabecas seguidas do MESMO numero sao um episodio contado de dois
       * jeitos:
       *   2a temporada -- Episodio 9 | Geral 34
       *   Episodio 34 -- Love Love Love...
       * Numeros diferentes ("Episodio 3" / "Episodio 7", lista sem descricao)
       * continuam dois itens.
       */
      for (const a of alvos) {
        if (!atual.alvos.some((b) => b.temporada === a.temporada && b.episodio === a.episodio)) atual.alvos.push(a)
      }
      atual.titulo = `${atual.titulo} · ${semMarcacao(linha)}`
    } else if (alvos) {
      fechar()
      atual = { titulo: semMarcacao(linha), alvos, linhas: [] }
    } else if (secaoDeTemporada(linha) !== null) {
      fechar()
      atual = null
      temporadaDoTrecho = secaoDeTemporada(linha)
    } else if (atual) {
      atual.linhas.push(semMarcacao(linha))
    }
  }
  fechar()
  return itens
}

/**
 * Este .txt e um B-roll, e nao o roteiro?
 *
 * Os dois chegam juntos e com a mesma extensao. O B-roll e uma LISTA: cabecas de
 * episodio e topicos ("Cobre:", "Cena principal:"). O roteiro e prosa, e uma
 * frase dele que comece por "Episodio 5 foi onde..." nao basta para virar
 * B-roll -- precisam ser duas cabecas, e ou a lista e metade do texto, ou ha
 * pelo menos dois topicos de B-roll. O nome do arquivo ("Broll 2.txt") resolve
 * sozinho.
 *
 * Medido nos cinco B-rolls dele (10/2026): os formatos variam muito -- com e
 * sem numero, com secao de temporada, com descricao corrida entre os topicos.
 */
export function pareceBroll(texto: string, nomeDoArquivo = ''): boolean {
  const itens = lerBroll(texto)
  if (itens.length === 0) return false
  if (/b[\s_-]?roll/i.test(nomeDoArquivo)) return true
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '')
  const topicos = linhas.filter((l) => /^(cobre\b|cenas? (principa|essencia)|cenas?\s*:)/i.test(semMarcacao(l))).length
  const delista = linhas.filter((l) => cabeca(l) !== null || secaoDeTemporada(l) !== null || /^\s*[•·*\-–—]/.test(l)).length
  return itens.length >= 2 && (topicos >= 2 || (delista + topicos) / linhas.length >= 0.5)
}

/** "Episódio 50", "S04E10": o nome curto do item, para a tela. */
export function rotuloDoItem(item: ItemDoBroll): string {
  const a = item.alvos[0]
  if (!a) return item.titulo
  return a.temporada === null ? `Episódio ${a.episodio}` : `S${dois(a.temporada)}E${dois(a.episodio)}`
}

function dois(n: number): string {
  return String(n).padStart(2, '0')
}

/** "5 episódios: 50, 49, 40, 47, 48". */
export function resumoDoBroll(itens: readonly ItemDoBroll[]): string {
  const nomes = [...new Set(itens.map((i) => rotuloDoItem(i).replace(/^Episódio /, '')))]
  return `${nomes.length} ${nomes.length === 1 ? 'episódio' : 'episódios'}: ${nomes.join(', ')}`
}

/**
 * A cena e de um desses episodios?
 *
 * So vale cena de PASTA DE EPISODIO (S01E48). As aberturas do AnCut moram em
 * pastas como "S01-OP2", e o shots.json delas diz episodio 2 -- sem esta trava,
 * "Episodio 2" no B-roll puxaria a abertura junto.
 */
export function clipeNoAlvo(
  clip: Pick<LibraryClip, 'season' | 'episode' | 'path'>,
  alvos: readonly AlvoDoBroll[],
): boolean {
  // O numero primeiro: sao 54 mil cenas, e quase nenhuma passa dele.
  if (!alvos.some((a) => a.episodio === clip.episode && (a.temporada === null || a.temporada === clip.season))) {
    return false
  }
  const pasta = clip.path.split(/[\\/]/).slice(-3, -2)[0] ?? ''
  return /S\d+E\d+/i.test(pasta)
}

/*
 * Palavras que todo B-roll usa e nao dizem nada sobre QUAL parte do roteiro o
 * item cobre: "Cobre a pergunta sobre...", "Cena principal:".
 */
const VAZIAS = new Set([
  'a', 'as', 'ao', 'aos', 'e', 'o', 'os', 'da', 'das', 'do', 'dos', 'de', 'em', 'na', 'nas', 'no', 'nos',
  'um', 'uma', 'uns', 'umas', 'por', 'para', 'pra', 'com', 'sem', 'que', 'se', 'ja', 'mas', 'mais', 'muito',
  'como', 'quando', 'onde', 'ele', 'ela', 'eles', 'elas', 'eu', 'voce', 'seu', 'sua', 'seus', 'suas', 'dele',
  'dela', 'isso', 'isto', 'esse', 'essa', 'este', 'esta', 'ser', 'sao', 'era', 'foi', 'estava', 'tem', 'ter',
  'ate', 'so', 'tambem', 'depois', 'antes', 'entao', 'porque', 'pelo', 'pela', 'nao', 'sim', 'aqui', 'ali',
  'cobre', 'cena', 'cenas', 'principal', 'principais', 'episodio', 'episodios', 'parte', 'temporada', 'sobre',
  'material', 'ilustrar', 'mostra', 'mostrar', 'momento', 'exatamente', 'mencionada', 'roteiro', 'melhor',
  'junto', 'aos', 'ajuda', 'contextualizar', 'video', 'trecho', 'final', 'inicio',
  // "Cobre a pergunta sobre a flecha": o gancho do roteiro tambem fala em
  // "perguntas", e casava o titulo do video com esse item.
  'pergunta', 'perguntas', 'abertura', 'encerramento', 'essencial', 'essenciais', 'cobre:',
])

/**
 * ONDE o item entra, quando o B-roll diz: "Cobre a abertura...", "O episodio
 * essencial para o encerramento", "para a parte final". Medido nos cinco dele:
 * quatro dizem isso de pelo menos um item.
 */
const DE_ABERTURA = /\bcobre:?\s*(a\s+)?abertura\b|\bpara a abertura\b|\b(in[ií]cio|abertura) do (v[ií]deo|roteiro)\b|\bgancho\b/i
// "PARA o encerramento": "encerramento com Number One" e o ED do anime, nao o fim do video.
const DE_ENCERRAMENTO =
  /\bpara (o|a) (encerramento|parte final|final|fechamento|conclus[aã]o)\b|\b(final|encerramento|fim) do (v[ií]deo|roteiro)\b/i

/**
 * Quanto a pista de lugar vale numa frase do comeco ou do fim. Um pouco mais
 * que uma TROCA: o gancho de uma frase so, sem palavra nenhuma da lista, vai
 * para o item da abertura -- foi o que ele escreveu --, mas uma palavra rara de
 * outro item ainda ganha dela.
 */
const PISTA_DE_LUGAR = 1.6

/**
 * As fichas de um texto: palavras cortadas e, com o indice, os personagens.
 *
 * O corte em seis letras e um radical de pobre que basta aqui: "sobrevivencia"
 * e "sobreviveu" viram "sobrev", "flechas" vira "flecha". O personagem vira uma
 * ficha so ("@Ishida, Uryuu"), venha como "Uryu", "Ishida" ou apelido -- o B-roll
 * e o roteiro nem sempre chamam do mesmo jeito.
 */
function fichas(texto: string, personagens: readonly string[]): Set<string> {
  const saida = new Set<string>()
  for (const cru of normalizarTexto(texto).split(/[^a-z0-9]+/)) {
    if (cru.length < 4 || VAZIAS.has(cru) || /^\d+$/.test(cru)) continue
    const sem = cru.length > 4 && cru.endsWith('s') ? cru.slice(0, -1) : cru
    saida.add(sem.length > 6 ? sem.slice(0, 6) : sem)
  }
  for (const p of personagens) saida.add(`@${p}`)
  return saida
}

/**
 * Quanto custa MUDAR de item entre uma frase e a seguinte.
 *
 * O item cobre um pedaco corrido do roteiro: a pergunta traz a palavra ("a
 * flecha de Still Silver") e as frases que desenvolvem ("Ele era um Quincy
 * mestico, e mesmo assim ficou de pe.") nao trazem nenhuma. Sem custo de troca,
 * essa frase do meio ia para qualquer vizinho; com ele, fica no assunto em
 * curso ate aparecer prova de outro. Uma palavra rara (~1,8) paga a troca; uma
 * palavra que esta em varios itens (~1) sozinha nao.
 */
const TROCA = 1.5

/**
 * O que vale uma frase ficar SEM item. Um trecho comprido sem nenhuma palavra
 * da lista (o gancho do comeco, um desvio) sai de todos; uma frase so, no meio
 * de um assunto, nao.
 */
const SEM_ITEM = 0.5

/**
 * Qual item do B-roll cada frase cobre, ou null.
 *
 * Por palavra em comum, com peso para a RARA: palavra que esta em um item so
 * ("Muken") diz muito; a que esta em todos ("Ichigo") quase nada. Depois, o
 * melhor CAMINHO pelo roteiro (Viterbi): somar o que cada frase casou,
 * descontando TROCA a cada mudanca de assunto.
 *
 * `grupos`, quando vem, junta os trechos da mesma frase antes de casar: a
 * Biblioteca corta a frase na virgula, e "em vez de encontrar as memorias
 * dele," sozinho nao diz nada.
 */
export function casarFrasesComBroll(
  frases: readonly string[],
  itens: readonly ItemDoBroll[],
  indice?: ScriptIndex,
  grupos?: readonly number[],
): (number | null)[] {
  if (itens.length === 0 || frases.length === 0) return frases.map(() => null)

  // Trechos da mesma frase viram um texto so; no fim, cada trecho herda a frase.
  const chaves = grupos && grupos.length === frases.length ? grupos : frases.map((_, i) => i)
  const ordem = [...new Set(chaves)]
  const textos = ordem.map((g) => frases.filter((_, i) => chaves[i] === g).join(' '))

  const quem = indice ? readScript(textos, indice).map((l) => l.matches.map((m) => m.character)) : textos.map(() => [])
  const daFrase = textos.map((t, i) => fichas(t, quem[i]!))
  const doItem = itens.map((item) => fichas(item.texto, indice ? readLine(item.texto, indice).map((m) => m.character) : []))

  const emQuantos = new Map<string, number>()
  for (const f of doItem) for (const p of f) emQuantos.set(p, (emQuantos.get(p) ?? 0) + 1)
  const peso = (p: string): number => Math.log(1 + itens.length / (emQuantos.get(p) ?? itens.length))

  // A abertura sao as primeiras frases (~12%), o encerramento as ultimas (~15%).
  const n = daFrase.length
  const noComeco = Math.max(1, Math.round(n * 0.12))
  const noFim = Math.max(1, Math.round(n * 0.15))
  const cru = daFrase.map((f, i) =>
    doItem.map((d, k) => {
      let s = 0
      for (const p of f) if (d.has(p)) s += peso(p)
      if (i < noComeco && DE_ABERTURA.test(itens[k]!.texto)) s += PISTA_DE_LUGAR
      if (i >= n - noFim && DE_ENCERRAMENTO.test(itens[k]!.texto)) s += PISTA_DE_LUGAR
      return s
    }),
  )

  // Estados: um por item, e o ultimo e "sem item".
  const K = itens.length
  const ganho = (i: number, k: number): number => (k === K ? SEM_ITEM : cru[i]![k]!)
  let nota = Array.from({ length: K + 1 }, (_, k) => ganho(0, k))
  const veio: number[][] = []
  for (let i = 1; i < cru.length; i++) {
    const de: number[] = []
    const nova = Array.from({ length: K + 1 }, (_, k) => {
      /*
       * Empate entre ficar e trocar: TROCA AQUI, o mais tarde possivel. A frase
       * sem palavra nenhuma entre dois assuntos ("Ele era um Quincy mestico")
       * desenvolve o assunto de ANTES -- o novo chega com a pergunta dele.
       */
      let melhor = k
      let valor = nota[k]!
      for (let j = 0; j <= K; j++) {
        if (j === k) continue
        const v = nota[j]! - TROCA
        if (v > valor + 1e-9 || (melhor === k && Math.abs(v - valor) <= 1e-9)) {
          valor = v
          melhor = j
        }
      }
      de.push(melhor)
      return valor + ganho(i, k)
    })
    veio.push(de)
    nota = nova
  }
  let fim = 0
  for (let k = 1; k <= K; k++) if (nota[k]! > nota[fim]!) fim = k
  const escolha: (number | null)[] = new Array(cru.length)
  for (let i = cru.length - 1; i >= 0; i--) {
    escolha[i] = fim === K ? null : fim
    if (i > 0) fim = veio[i - 1]![fim]!
  }

  const porGrupo = new Map(ordem.map((g, i) => [g, escolha[i] ?? null]))
  return chaves.map((g) => porGrupo.get(g) ?? null)
}

/** O que o B-roll pede para UMA frase: e o que a escolha de cena recebe. */
export interface PreferenciaDoBroll {
  /** O item que cobre esta frase, quando algum cobre. */
  item: ItemDoBroll | null
  /** Os episodios do B-roll inteiro. */
  todos: readonly AlvoDoBroll[]
  /** Quem o item cita: vale para frase que nao nomeia ninguem ("E a flecha?"). */
  personagens: readonly string[]
}

/** Uma preferencia por frase, na mesma ordem. Vazio quando nao ha B-roll. */
export function preferenciasDoBroll(
  frases: readonly string[],
  itens: readonly ItemDoBroll[],
  indice?: ScriptIndex,
  grupos?: readonly number[],
): (PreferenciaDoBroll | null)[] {
  if (itens.length === 0) return frases.map(() => null)
  const todos = itens.flatMap((i) => i.alvos)
  const quem = itens.map((i) => (indice ? [...new Set(readLine(i.texto, indice).map((m) => m.character))] : []))
  return casarFrasesComBroll(frases, itens, indice, grupos).map((k) => ({
    item: k === null ? null : itens[k]!,
    todos,
    personagens: k === null ? [] : quem[k]!,
  }))
}

/**
 * Os episodios do B-roll que a biblioteca NAO tem.
 *
 * E o aviso mais util que o B-roll permite: "o episodio 47 nao esta cortado no
 * AnCut". Sem ele, a montagem escolheria em silencio cenas de outro lugar.
 */
export function episodiosQueFaltam(
  itens: readonly ItemDoBroll[],
  clips: readonly Pick<LibraryClip, 'season' | 'episode' | 'path' | 'anime'>[],
  series: readonly string[],
): ItemDoBroll[] {
  const acervo = series.length > 0 ? clips.filter((c) => series.includes(c.anime)) : clips
  return itens.filter((item) => !acervo.some((c) => clipeNoAlvo(c, item.alvos)))
}

/**
 * "Episodio 4" sem temporada, num anime que tem duas: qual delas?
 *
 * Os B-rolls do Cyberpunk 2 dizem so "Episodio 4", e a biblioteca tem S01E04 e
 * S02E04. Decide quem o B-roll cita: cada personagem que so existe numa das
 * temporadas e um voto nela. Medido nos B-rolls dele: Talia, Avida, Kiril e
 * Roman votam na 2a; David Martinez, citado de passagem, vota na 1a -- 4 a 1.
 * Sem diferenca, fica como estava (vale o episodio de qualquer temporada).
 */
export function resolverTemporadas(
  itens: readonly ItemDoBroll[],
  clips: readonly Pick<LibraryClip, 'season' | 'episode' | 'path' | 'anime' | 'characters'>[],
  series: readonly string[],
  indice?: ScriptIndex,
): ItemDoBroll[] {
  const semTemporada = itens.some((i) => i.alvos.some((a) => a.temporada === null))
  if (!indice || !semTemporada) return [...itens]
  const citados = new Set(itens.flatMap((i) => readLine(`${i.titulo}\n${i.texto}`, indice).map((m) => m.character)))
  if (citados.size === 0) return [...itens]

  const acervo = series.length > 0 ? clips.filter((c) => series.includes(c.anime)) : clips
  /** episodio -> as temporadas em que ele existe como pasta de episodio */
  const temporadasDo = new Map<number, Set<number>>()
  /** personagem citado -> as temporadas em que ele aparece */
  const ondeAparece = new Map<string, Set<number>>()
  for (const c of acervo) {
    const pasta = c.path.split(/[\\/]/).slice(-3, -2)[0] ?? ''
    if (!/S\d+E\d+/i.test(pasta)) continue
    const ts = temporadasDo.get(c.episode) ?? new Set<number>()
    ts.add(c.season)
    temporadasDo.set(c.episode, ts)
    for (const p of c.characters) {
      if (!citados.has(p)) continue
      const onde = ondeAparece.get(p) ?? new Set<number>()
      onde.add(c.season)
      ondeAparece.set(p, onde)
    }
  }
  const votos = (temporadas: readonly number[]): Map<number, number> => {
    const v = new Map(temporadas.map((t) => [t, 0]))
    for (const onde of ondeAparece.values()) {
      const delas = temporadas.filter((t) => onde.has(t))
      if (delas.length === 1) v.set(delas[0]!, v.get(delas[0]!)! + 1)
    }
    return v
  }

  return itens.map((item) => ({
    ...item,
    alvos: item.alvos.map((a) => {
      if (a.temporada !== null) return a
      const ts = [...(temporadasDo.get(a.episodio) ?? [])]
      if (ts.length < 2) return a
      const ranking = [...votos(ts)].sort((x, y) => y[1] - x[1])
      const [primeira, segunda] = ranking
      if (!primeira || primeira[1] === 0 || primeira[1] === segunda?.[1]) return a
      return { temporada: primeira[0], episodio: a.episodio }
    }),
  }))
}
