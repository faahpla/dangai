import { z } from 'zod'

/**
 * A TRILHA SONORA da Edicao rapida (01/11, pedido do Levi): a musica sabe ser
 * usada.
 *
 * - A musica 1 comeca no TRECHO CALMO antes de um ponto de entrada dela (o
 *   "drop", achado pela onda: electron/som/entradas.ts) e o drop cai em cima
 *   do corte gancho > contexto, junto com o pico do riser.
 * - A cada MUDANCA DE CLIMA do roteiro (acao, epica, sentimental, romance,
 *   suspense, comedia, calma) entra outra musica daquele clima, ja no drop
 *   dela, com o riser curto e o impacto (ou o "tape stop" / "record scratch",
 *   se a pasta tiver, quando o clima cai para algo calmo).
 * - O clima da MUSICA: a subpasta ("acao/", "sentimental/"...) ou, solta, o
 *   palpite da IA pelo nome. O da PARTE do roteiro: a IA le a fala; sem IA,
 *   palavras-chave; sem nada, o papel da parte.
 *
 * Funcoes puras: rodam igual no main e nos testes.
 */

export const CLIMAS = ['acao', 'epica', 'sentimental', 'romance', 'suspense', 'comedia', 'calma'] as const
export const climaSchema = z.enum(CLIMAS)
export type Clima = z.infer<typeof climaSchema>

export const ROTULO_DO_CLIMA: Record<Clima, string> = {
  acao: 'acao',
  epica: 'epica',
  sentimental: 'sentimental',
  romance: 'romance',
  suspense: 'suspense',
  comedia: 'comedia',
  calma: 'calma',
}

/** Os climas calmos: cair num deles e "derrubar" o clima (tape stop, se houver). */
export const CLIMAS_CALMOS: ReadonlySet<Clima> = new Set(['sentimental', 'romance', 'calma'])

/** Sem musica do clima pedido, os vizinhos (na ordem) antes de qualquer uma. */
export const VIZINHOS_DO_CLIMA: Record<Clima, readonly Clima[]> = {
  acao: ['epica', 'suspense'],
  epica: ['acao', 'sentimental'],
  sentimental: ['calma', 'romance', 'epica'],
  romance: ['sentimental', 'calma'],
  suspense: ['acao', 'calma'],
  comedia: ['calma', 'acao'],
  calma: ['sentimental', 'romance'],
}

const NOMES_DE_PASTA: readonly [RegExp, Clima][] = [
  [/^(acao|action|luta|fight|batalha|battle|hype)$/, 'acao'],
  [/^(epica?|epic|epico|heroic[ao]?|hero)$/, 'epica'],
  [/^(sentimental|triste|sad|emocional|emotional|drama)$/, 'sentimental'],
  [/^(romance|romantic[ao]?|amor|love)$/, 'romance'],
  [/^(suspense|tens[ao]+|tense|misterio|mystery|dark|sombri[ao])$/, 'suspense'],
  [/^(comedia|engracad[ao]|funny|comedy|meme)$/, 'comedia'],
  [/^(calma|calm|chill|lofi|tranquil[ao]|relax)$/, 'calma'],
]

/** O clima pelo nome de uma PASTA ("Acao", "épica", "sad"). null = a pasta nao diz. */
export function climaDaPasta(pasta: string): Clima | null {
  const nome = semAcento(pasta).trim()
  for (const [re, clima] of NOMES_DE_PASTA) if (re.test(nome)) return clima
  return null
}

const PALAVRAS_DO_CLIMA: readonly [Clima, RegExp][] = [
  [
    'acao',
    /\b(luta\w*|batalha\w*|ataca\w*|ataque\w*|golpe\w*|combate\w*|inimig\w*|derrot\w*|explo\w*|soco\w*|espada\w*|fight\w*|battle\w*|attack\w*)\b/g,
  ],
  [
    'epica',
    /\b(lenda\w*|lendari\w*|destino|despert\w*|supremo|invencivel|rei|deus\w*|heroi\w*|vitoria|poder maximo|transforma\w*|legend\w*|destiny|awaken\w*)\b/g,
  ],
  [
    'sentimental',
    /\b(morte|morreu|morrer|chor\w*|lagrima\w*|perd(a|eu)|sozinh\w*|triste\w*|adeus|sacrifici\w*|saudade|lembranca\w*|passado|died|death|cry\w*|tears?)\b/g,
  ],
  ['romance', /\b(amor|apaixon\w*|beij\w*|namor\w*|casal|ciume\w*|declara\w*|love|kiss\w*|crush)\b/g],
  [
    'suspense',
    /\b(misteri\w*|segredo\w*|suspeit\w*|estranh\w*|sombra\w*|desapare\w*|traid\w*|traic\w*|ninguem sabia|escondid\w*|mystery|secret\w*)\b/g,
  ],
  ['comedia', /\b(engracad\w*|piada\w*|vergonha|idiota\w*|pervertid\w*|desastrad\w*|hilari\w*|zoeira|funny|joke\w*)\b/g],
]

/** O clima pela FALA de uma parte (palavras-chave; a IA faz melhor). null = nada claro. */
export function climaPelaFala(texto: string): Clima | null {
  const fala = semAcento(texto)
  let melhor: { clima: Clima; n: number } | null = null
  for (const [clima, re] of PALAVRAS_DO_CLIMA) {
    const n = (fala.match(re) ?? []).length
    if (n > 0 && (!melhor || n > melhor.n)) melhor = { clima, n }
  }
  return melhor?.clima ?? null
}

/** Sem IA e sem palavra-chave: o papel da parte. */
export function climaPeloPapel(papel: string | null): Clima {
  switch (papel) {
    case 'gancho':
    case 'contexto':
      return 'suspense'
    case 'climax':
      return 'epica'
    case 'virada':
      return 'acao'
    case 'fechamento':
      return 'calma'
    default:
      return 'acao'
  }
}

export function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

// ------------------------------------------------------------- os trechos

/** Uma parte do video com o clima dela (secoesParaSom + o clima). */
export interface ParteComClima {
  inicio: number
  fim: number
  papel: string | null
  clima: Clima
}

/** Um trecho da trilha: uma musica de `at` ate `ate`, com o drop em `drop`. */
export interface TrechoDaTrilha {
  at: number
  ate: number
  /** O instante do video onde o DROP da musica cai (a saida do gancho, ou o comeco da troca). */
  drop: number
  clima: Clima
}

export interface RegrasDaTrilha {
  /** Trecho mais curto que isto se junta ao vizinho: musica que troca a cada 4 s cansa. */
  trechoMinSec: number
  /** Teto de musicas num video. */
  maximoDeMusicas: number
}

export const REGRAS_DA_TRILHA_PADRAO: RegrasDaTrilha = { trechoMinSec: 8, maximoDeMusicas: 4 }

/**
 * Os trechos da trilha. `partes` em ordem; `saidaDoGancho` = o corte da
 * virada gancho > contexto (o pico do riser), null = sem gancho.
 *
 * - O gancho nao tem clima proprio: ele toca o trecho CALMO antes do drop da
 *   musica da parte seguinte (o drop cai na saida do gancho).
 * - Partes vizinhas do mesmo clima sao um trecho so.
 * - Trecho mais curto que trechoMinSec se junta ao anterior (o primeiro, ao
 *   seguinte); no maximo maximoDeMusicas trechos (os mais curtos se juntam).
 * - `trocas` = o `at` de cada trecho depois do primeiro (onde a musica troca).
 */
export function trechosDaTrilha(
  partes: readonly ParteComClima[],
  saidaDoGancho: number | null,
  duracaoSec: number,
  grudar: (t: number) => number = (t) => t,
  regras: RegrasDaTrilha = REGRAS_DA_TRILHA_PADRAO,
): TrechoDaTrilha[] {
  if (!(duracaoSec > 0)) return []
  const ordenadas = [...partes].filter((p) => Number.isFinite(p.inicio)).sort((a, b) => a.inicio - b.inicio)
  const semGancho = ordenadas.filter((p) => p.papel !== 'gancho')
  const base = semGancho.length > 0 ? semGancho : ordenadas
  if (base.length === 0) return [{ at: 0, ate: duracaoSec, drop: saidaDoGancho ?? 0, clima: 'acao' }]

  let trechos: { at: number; clima: Clima }[] = []
  for (const p of base) {
    const at = trechos.length === 0 ? 0 : grudar(p.inicio)
    const ultimo = trechos[trechos.length - 1]
    if (ultimo && ultimo.clima === p.clima) continue
    trechos.push({ at, clima: p.clima })
  }
  const fim = (k: number): number => trechos[k + 1]?.at ?? duracaoSec
  const comeco = (k: number): number => (k === 0 ? (saidaDoGancho ?? 0) : trechos[k]!.at)
  // Junta o mais curto ate todos passarem do minimo e caberem no teto.
  for (let volta = 0; volta < 50 && trechos.length > 1; volta++) {
    let menor = -1
    let dur = Number.POSITIVE_INFINITY
    trechos.forEach((_, k) => {
      const d = fim(k) - comeco(k)
      if (d < dur) {
        dur = d
        menor = k
      }
    })
    if (dur >= regras.trechoMinSec && trechos.length <= regras.maximoDeMusicas) break
    if (menor <= 0) trechos.splice(1, 1)
    else trechos.splice(menor, 1)
    // Dois vizinhos do mesmo clima depois de juntar: um so.
    trechos = trechos.filter((t, k) => k === 0 || t.clima !== trechos[k - 1]!.clima)
  }
  return trechos.map((t, k) => ({
    at: t.at,
    ate: fim(k),
    drop: k === 0 ? Math.min(saidaDoGancho ?? 0, fim(k)) : t.at,
    clima: t.clima,
  }))
}

// --------------------------------------------------------- a musica certa

/** Um ponto de entrada (drop) da musica: onde a energia e o grave sobem de uma vez. */
export interface EntradaDaMusica {
  /** Segundo do arquivo. */
  t: number
  /** Quanto sobe (dB, energia + metade do grave): maior = drop mais forte. */
  forca: number
}

export interface MusicaParaTrilha {
  path: string
  fileName: string
  clima: Clima | null
  durationSec: number
  entradas: readonly EntradaDaMusica[]
  /** Comeco do som no arquivo (pula silencio). */
  inicioSomSec: number
}

/**
 * A musica do clima, sem repetir: `ordem` ja vem do "sem repetir" (a primeira
 * e a da vez). Prefere o clima exato, depois os vizinhos, depois qualquer uma;
 * nunca uma que ja esta no video (`usadas`), se der.
 */
export function musicaDoClima<T extends Pick<MusicaParaTrilha, 'path' | 'clima'>>(
  clima: Clima,
  ordem: readonly T[],
  usadas: ReadonlySet<string>,
): T | null {
  const livres = ordem.filter((m) => !usadas.has(m.path))
  const lista = livres.length > 0 ? livres : ordem
  for (const c of [clima, ...VIZINHOS_DO_CLIMA[clima]]) {
    const achou = lista.find((m) => m.clima === c)
    if (achou) return achou
  }
  return lista.find((m) => m.clima === null) ?? lista[0] ?? null
}

/**
 * O ponto do ARQUIVO que toca no `at` do trecho, para o drop cair em
 * `drop`: precisa de (drop - at) segundos de musica antes da entrada (o
 * trecho calmo do gancho). Escolhe a entrada mais FORTE que cabe, preferindo
 * as que deixam o trecho inteiro tocar sem dar a volta no arquivo. Sem
 * entrada que caiba: o comeco do som.
 */
export function inicioParaODrop(m: Pick<MusicaParaTrilha, 'entradas' | 'durationSec' | 'inicioSomSec'>, trecho: Pick<TrechoDaTrilha, 'at' | 'ate' | 'drop'>): { inSec: number; entrada: EntradaDaMusica | null } {
  const antes = Math.max(trecho.drop - trecho.at, 0)
  const dura = trecho.ate - trecho.at
  const cabem = m.entradas.filter((e) => e.t - antes >= Math.max(m.inicioSomSec - 0.05, 0))
  const inteiras = cabem.filter((e) => e.t - antes + dura <= m.durationSec)
  const melhor = [...(inteiras.length > 0 ? inteiras : cabem)].sort((a, b) => b.forca - a.forca || a.t - b.t)[0]
  if (!melhor) return { inSec: Math.max(m.inicioSomSec - 0.05, 0), entrada: null }
  return { inSec: Math.round((melhor.t - antes) * 1000) / 1000, entrada: melhor }
}
