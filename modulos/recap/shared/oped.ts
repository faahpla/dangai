import type {
  Capitulo,
  Cue,
  Exclusao,
  ExclusaoSugerida,
  MotivoDaExclusao,
  OrigemDaExclusao,
} from './episodio'

/**
 * Onde estao a abertura e o encerramento (OP/ED) -- a SUGESTAO, pura.
 *
 * O Studio nunca decide sozinho: tudo aqui sai com `confirmada: false` e um
 * `porque` em ASCII, e a regua da interface mostra para o usuario confirmar,
 * mexer ou apagar. Por isso a regra prefere errar pouco a acertar tudo: no
 * maximo UMA sugestao por motivo (uma abertura, um encerramento, uma previa),
 * a da fonte mais confiavel, com as outras fontes que concordam citadas no
 * porque.
 *
 * As fontes, da mais forte para a mais fraca:
 * 1. capitulo: o arquivo diz ("Intro", "Opening", "Credits", "Preview"). A
 *    Netflix, a Crunchyroll e a Erai marcam assim; a SubsPlease nao marca nada;
 * 2. estilo: um bloco de cues de musica (estilo OP/ED/Song, karaoke, notas
 *    musicais) -- a letra da abertura traduzida;
 * 3. vao: um trecho de 45 s ou mais sem FALA (placa e musica nao contam) no
 *    comeco ou no fim. E o caminho principal nos SubsPlease, que nao tem
 *    capitulo nem letra de abertura;
 * 4. serie: o que o usuario confirmou em outro episodio da mesma serie. A
 *    abertura muda de lugar com o tamanho do prologo, o encerramento costuma
 *    ficar a mesma distancia do fim -- por isso o ED da serie e medido a
 *    partir do fim;
 * 5. skip_ranges: o "pular inicio/fim" que o Corte Cenas guarda por anime.
 *    Cobre o prologo junto com a abertura, entao fica por ultimo.
 *
 * Tempo: tudo na base do episodio (segundos de reproducao), como o resto do
 * indice.
 */

/** Um vao de fala a partir deste tamanho e candidato a OP/ED (medido: OP de TV tem ~90 s). */
export const VAO_MINIMO_SEC = 45

/** O "pular inicio/fim" do Corte Cenas para este anime (skip_ranges.json). */
export interface SkipRangesDoAnime {
  head: number
  tail: number
}

/** O que o usuario confirmou num episodio da mesma serie. */
export interface MarcacaoDaSerie {
  /** 'S04E36': aparece no porque. */
  episodio: string
  duracaoSec: number
  exclusoes: Pick<Exclusao, 'start' | 'end' | 'motivo'>[]
}

export interface EntradaDaSugestao {
  duracaoSec: number
  capitulos: readonly Capitulo[]
  cues: readonly Cue[]
  skipRanges?: SkipRangesDoAnime | null
  serie?: MarcacaoDaSerie | null
  /** Marcacoes ja confirmadas: sugestao que cai em cima delas nao volta. */
  confirmadas?: readonly Exclusao[]
}

// -------------------------------------------------------------------- formatos

/** 107.5 -> "1:47"; 3723 -> "1:02:03". */
export function formatarTempo(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** 89.4 -> "1m29s"; 40 -> "40s". */
export function formatarDuracao(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`
}

/** "de 1:47 a 3:14" */
function trecho(start: number, end: number): string {
  return `${formatarTempo(start)} a ${formatarTempo(end)}`
}

/** Para o porque: so ASCII, como o resto da interface. */
function ascii(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .trim()
}

// ------------------------------------------------------------------- candidatos

interface Candidato {
  start: number
  end: number
  motivo: MotivoDaExclusao
  origem: OrigemDaExclusao
  porque: string
  /** Frase curta para citar quando outra fonte mais forte ganha. */
  apoio: string
}

const PESO: Record<OrigemDaExclusao, number> = {
  usuario: 9,
  capitulo: 5,
  audio: 4,
  estilo: 4,
  vao: 3,
  serie: 2,
  skip_ranges: 1,
}

/** O motivo de um capitulo pelo titulo. null = capitulo de historia. */
export function motivoDoCapitulo(titulo: string, inicio: number, duracaoSec: number): MotivoDaExclusao | null {
  const t = ascii(titulo).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!t) return null
  if (/\b(preview|next episode|next time|next ep|yokoku|proximo episodio|avant premiere)\b/.test(t)) return 'preview'
  if (/^(nc ?)?(op|opening|intro|abertura|ouverture|generique|title sequence)( |\d|$)/.test(t)) return 'op'
  if (/^(nc ?)?(ed|ending|outro|encerramento)( |\d|$)/.test(t)) return 'ed'
  if (/^(end )?(credits|creditos|ending credits|staff)( |$)/.test(t)) {
    // "Credits" no fim e o encerramento; no comeco, so creditos de abertura.
    return inicio > duracaoSec * 0.5 ? 'ed' : 'creditos'
  }
  return null
}

function doCapitulos(capitulos: readonly Capitulo[], duracaoSec: number): Candidato[] {
  const saida: Candidato[] = []
  for (const cap of capitulos) {
    const motivo = motivoDoCapitulo(cap.titulo, cap.start, duracaoSec)
    if (!motivo) continue
    const start = Math.max(0, cap.start)
    const end = Math.min(duracaoSec, cap.end)
    const tam = end - start
    // Capitulo de 3 s chamado "Intro" e marcador perdido; de 6 min, e o
    // episodio inteiro mal etiquetado. Nenhum dos dois e abertura.
    if (tam < 10 || tam > 240) continue
    saida.push({
      start,
      end,
      motivo,
      origem: 'capitulo',
      porque: `Capitulo "${ascii(cap.titulo)}" do arquivo (${trecho(start, end)})`,
      apoio: `capitulo "${ascii(cap.titulo)}"`,
    })
  }
  return saida
}

/** Fala de verdade: a base dos vaos. Placa e musica nao interrompem um vao. */
function falas(cues: readonly Cue[]): Cue[] {
  return cues.filter((c) => c.tipo === 'fala').sort((a, b) => a.start - b.start)
}

/** Trechos sem fala de VAO_MINIMO_SEC para cima, do comeco ao fim do episodio. */
export function vaosDeFala(cues: readonly Cue[], duracaoSec: number, minimo = VAO_MINIMO_SEC): { start: number; end: number }[] {
  const lista = falas(cues)
  const vaos: { start: number; end: number }[] = []
  let fim = 0
  for (const cue of lista) {
    if (cue.start - fim >= minimo) vaos.push({ start: fim, end: cue.start })
    fim = Math.max(fim, cue.end)
  }
  if (lista.length > 0 && duracaoSec - fim >= minimo) vaos.push({ start: fim, end: duracaoSec })
  return vaos
}

/** Onde a abertura costuma estar: comeca nos primeiros ~7 min (30% num episodio curto). */
function zonaDaAbertura(duracaoSec: number): number {
  return Math.min(duracaoSec * 0.3, 420)
}

/** Onde o encerramento costuma estar: termina nos ultimos ~7 min (30% num curto). */
function zonaDoEncerramento(duracaoSec: number): number {
  return Math.max(duracaoSec * 0.7, duracaoSec - 420)
}

function dosVaos(cues: readonly Cue[], duracaoSec: number): Candidato[] {
  // Sem fala nenhuma (legenda so de placas, ou sem legenda): nao ha vao que
  // signifique alguma coisa.
  if (!cues.some((c) => c.tipo === 'fala')) return []
  const vaos = vaosDeFala(cues, duracaoSec)
  const saida: Candidato[] = []

  // A abertura: o PRIMEIRO vao que comeca na zona. Pegar o maior errava no
  // Dr. Stone S4E37, que tem 2m15s de montagem sem fala aos 9:33 -- maior que
  // a abertura (1m39s aos 2:20), e no meio do episodio.
  const op = vaos.find((v) => v.start <= zonaDaAbertura(duracaoSec))
  if (op) {
    const onde = op.start < 1 ? 'no comeco' : 'perto do comeco'
    saida.push({
      start: op.start,
      end: op.end,
      motivo: 'op',
      origem: 'vao',
      porque: `${formatarDuracao(op.end - op.start)} sem fala ${onde} (${trecho(op.start, op.end)})`,
      apoio: `${formatarDuracao(op.end - op.start)} sem fala`,
    })
  }

  // O encerramento: o ULTIMO vao que termina na zona -- depois dele so sobra
  // a previa ou a cena pos-creditos.
  const ed = [...vaos].reverse().find((v) => v.end >= zonaDoEncerramento(duracaoSec) && v !== op)
  if (ed) {
    const onde = ed.end > duracaoSec - 1 ? 'no fim' : 'perto do fim'
    saida.push({
      start: ed.start,
      end: ed.end,
      motivo: 'ed',
      origem: 'vao',
      porque: `${formatarDuracao(ed.end - ed.start)} sem fala ${onde} (${trecho(ed.start, ed.end)})`,
      apoio: `${formatarDuracao(ed.end - ed.start)} sem fala`,
    })
  }
  return saida
}

/**
 * Blocos de musica: cues 'musica' coladas (ate 15 s entre uma e outra), com 3
 * linhas ou mais e 20 s ou mais. O trecho sugerido vai ate a fala de antes e a
 * de depois -- a letra comeca alguns segundos depois da abertura e acaba antes
 * dela --, a nao ser que esse vao seja longo demais para ser so a musica.
 */
function dosEstilos(cues: readonly Cue[], duracaoSec: number): Candidato[] {
  const musicas = cues.filter((c) => c.tipo === 'musica').sort((a, b) => a.start - b.start)
  const blocos: Cue[][] = []
  for (const cue of musicas) {
    const atual = blocos[blocos.length - 1]
    const ultimo = atual?.[atual.length - 1]
    if (atual && ultimo && cue.start - ultimo.end <= 15) atual.push(cue)
    else blocos.push([cue])
  }

  const lista = falas(cues)
  const saida: Candidato[] = []
  for (const bloco of blocos) {
    const ms = bloco[0]!.start
    const me = Math.max(...bloco.map((c) => c.end))
    if (bloco.length < 3 || me - ms < 20) continue
    const centro = (ms + me) / 2
    const motivo: MotivoDaExclusao | null =
      centro < duracaoSec * 0.4 ? 'op' : centro > duracaoSec * 0.6 ? 'ed' : null
    // Musica no meio do episodio e insert song: faz parte da historia.
    if (!motivo) continue

    const antes = lista.filter((c) => c.end <= ms + 1).reduce((m, c) => Math.max(m, c.end), 0)
    const depois = lista.filter((c) => c.start >= me - 1).reduce((m, c) => Math.min(m, c.start), duracaoSec)
    const [start, end] =
      depois - antes <= 150 ? [antes, depois] : [Math.max(antes, ms - 10), Math.min(depois, me + 10)]
    const estilo = bloco.find((c) => c.estilo)?.estilo
    const deQue = estilo ? `estilo "${ascii(estilo)}"` : 'notas musicais'
    saida.push({
      start,
      end,
      motivo,
      origem: 'estilo',
      porque: `${bloco.length} linhas de musica (${deQue}) de ${trecho(ms, me)}`,
      apoio: `${bloco.length} linhas de musica`,
    })
  }
  return saida
}

function doSkipRanges(skip: SkipRangesDoAnime, duracaoSec: number): Candidato[] {
  const saida: Candidato[] = []
  if (skip.head > 0) {
    const end = Math.min(skip.head, duracaoSec)
    saida.push({
      start: 0,
      end,
      motivo: 'op',
      origem: 'skip_ranges',
      porque: `O Corte Cenas pula os primeiros ${formatarDuracao(end)} deste anime`,
      apoio: 'pulo do Corte Cenas',
    })
  }
  if (skip.tail > 0) {
    const start = Math.max(0, duracaoSec - skip.tail)
    saida.push({
      start,
      end: duracaoSec,
      motivo: 'ed',
      origem: 'skip_ranges',
      porque: `O Corte Cenas pula os ultimos ${formatarDuracao(duracaoSec - start)} deste anime`,
      apoio: 'pulo do Corte Cenas',
    })
  }
  return saida
}

function daSerie(serie: MarcacaoDaSerie, duracaoSec: number): Candidato[] {
  const saida: Candidato[] = []
  for (const ex of serie.exclusoes) {
    // Encerramento e previa ficam a mesma distancia do FIM em todo episodio;
    // a abertura fica a mesma distancia do comeco (quando o prologo e igual).
    const doFim = ex.motivo === 'ed' || ex.motivo === 'preview' || ex.start > serie.duracaoSec * 0.6
    const start = doFim ? duracaoSec - (serie.duracaoSec - ex.start) : ex.start
    const end = doFim ? duracaoSec - (serie.duracaoSec - ex.end) : ex.end
    const s = Math.max(0, start)
    const e = Math.min(duracaoSec, end)
    if (e - s < 5) continue
    saida.push({
      start: s,
      end: e,
      motivo: ex.motivo,
      origem: 'serie',
      porque: `Mesmo lugar do confirmado no ${ascii(serie.episodio)} (${trecho(s, e)})`,
      apoio: `confirmado no ${ascii(serie.episodio)}`,
    })
  }
  return saida
}

// --------------------------------------------------------------------- juntar

/** Quanto de `a` esta dentro de `b`, sobre o menor dos dois. 1 = um contem o outro. */
function sobreposicao(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const dentro = Math.min(a.end, b.end) - Math.max(a.start, b.start)
  const menor = Math.min(a.end - a.start, b.end - b.start)
  return menor > 0 ? Math.max(0, dentro) / menor : 0
}

/** OP com OP, ED com ED (creditos do fim contam como ED). */
function mesmaFamilia(a: MotivoDaExclusao, b: MotivoDaExclusao): boolean {
  const familia = (m: MotivoDaExclusao): string => (m === 'creditos' ? 'ed' : m)
  return familia(a) === familia(b)
}

/**
 * Todas as fontes -> no maximo uma sugestao por motivo.
 *
 * Por motivo, ganha o grupo que tem a fonte mais forte; quem concorda com ele
 * (sobreposicao de metade ou mais) entra no porque como apoio. Quem discorda
 * fica de fora: mostrar duas aberturas em lugares diferentes so faz o usuario
 * apagar uma.
 */
export function sugerirOpEd(entrada: EntradaDaSugestao): ExclusaoSugerida[] {
  const { duracaoSec } = entrada
  if (!(duracaoSec > 0)) return []

  const candidatos: Candidato[] = [
    ...doCapitulos(entrada.capitulos, duracaoSec),
    ...dosEstilos(entrada.cues, duracaoSec),
    ...dosVaos(entrada.cues, duracaoSec),
    ...(entrada.serie ? daSerie(entrada.serie, duracaoSec) : []),
    ...(entrada.skipRanges ? doSkipRanges(entrada.skipRanges, duracaoSec) : []),
  ]
    .map((c) => ({ ...c, start: r2(Math.max(0, c.start)), end: r2(Math.min(duracaoSec, c.end)) }))
    .filter((c) => c.end - c.start >= 5)

  const confirmadas = entrada.confirmadas ?? []
  const livres = candidatos.filter(
    (c) => !confirmadas.some((x) => mesmaFamilia(x.motivo, c.motivo) && sobreposicao(c, x) >= 0.5),
  )

  const saida: ExclusaoSugerida[] = []
  const motivos: MotivoDaExclusao[] = ['op', 'ed', 'preview', 'creditos']
  for (const motivo of motivos) {
    const daqui = livres
      .filter((c) => c.motivo === motivo)
      .sort((a, b) => PESO[b.origem] - PESO[a.origem] || a.start - b.start)
    const vencedor = daqui[0]
    if (!vencedor) continue
    // Creditos que ja cabem no encerramento sugerido nao viram uma segunda faixa.
    if (motivo === 'creditos' && saida.some((s) => s.motivo === 'ed' && sobreposicao(s, vencedor) >= 0.5)) continue
    const apoios = [
      ...new Set(
        livres
          .filter((c) => c !== vencedor && c.origem !== vencedor.origem && mesmaFamilia(c.motivo, motivo))
          .filter((c) => sobreposicao(c, vencedor) >= 0.5)
          .map((c) => c.apoio),
      ),
    ]
    saida.push({
      start: vencedor.start,
      end: vencedor.end,
      motivo,
      origem: vencedor.origem,
      confirmada: false,
      porque: apoios.length > 0 ? `${vencedor.porque}; bate com: ${apoios.join(', ')}` : vencedor.porque,
    })
  }
  return saida.sort((a, b) => a.start - b.start)
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}
