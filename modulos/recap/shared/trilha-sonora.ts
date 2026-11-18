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
  /**
   * Onde a musica comeca a SUMIR (o fade do fim, o silencio): o trecho nao passa
   * daqui. Ausente = o arquivo inteiro (o de antes). Ver fimUtilDaMusica.
   */
  fimUtilSec?: number
}

/** Abaixo do integrado da musica, um bloco ja e o fim sumindo (o fade, a cauda). */
export const QUEDA_DO_FIM_LU = 9

/**
 * ONDE A MUSICA COMECA A SUMIR (17/11). A Edicao rapida punha o trecho ate o
 * fim do arquivo, e o fim de uma faixa e o fade: no Nia S01E07 os ultimos 13 s
 * (de -12 para -45 LUFS) viraram um vazio de 0:20 a 0:32 no video, e logo depois
 * a faixa recomecava do segundo 0, que e mudo.
 *
 * `blocos` = loudness de cada bloco de 400 ms, passo de 100 ms (medir.ts). O
 * fim util e o fim do ULTIMO bloco a menos de QUEDA_DO_FIM_LU do integrado.
 * Sem blocos ou sem integrado: `fimSomSec` (o fim do som), senao o arquivo.
 */
export function fimUtilDaMusica(
  blocos: readonly number[] | null | undefined,
  lufsIntegrado: number | null,
  durationSec: number,
  fimSomSec?: number | null,
): number {
  const fimDoSom = typeof fimSomSec === 'number' && fimSomSec > 0 ? Math.min(fimSomSec, durationSec) : durationSec
  if (!blocos || blocos.length === 0 || lufsIntegrado === null || !Number.isFinite(lufsIntegrado)) return fimDoSom
  const limiar = lufsIntegrado - QUEDA_DO_FIM_LU
  for (let i = blocos.length - 1; i >= 0; i--) {
    const v = blocos[i]!
    if (Number.isFinite(v) && v >= limiar) return Math.min(fimDoSom, Math.round((i * 0.1 + 0.4) * 1000) / 1000)
  }
  return fimDoSom
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
export function inicioParaODrop(
  m: Pick<MusicaParaTrilha, 'entradas' | 'durationSec' | 'inicioSomSec' | 'fimUtilSec'>,
  trecho: Pick<TrechoDaTrilha, 'at' | 'ate' | 'drop'>,
): { inSec: number; entrada: EntradaDaMusica | null } {
  const antes = Math.max(trecho.drop - trecho.at, 0)
  const dura = trecho.ate - trecho.at
  const comeco = Math.max(m.inicioSomSec - 0.05, 0)
  // (17/11) O trecho nao entra no fim que some: "inteira" e caber ate o fim util.
  const fim = Math.min(m.fimUtilSec ?? m.durationSec, m.durationSec)
  const cabem = m.entradas.filter((e) => e.t - antes >= comeco)
  const inteiras = cabem.filter((e) => e.t - antes + dura <= fim)
  const melhor = [...inteiras].sort((a, b) => b.forca - a.forca || a.t - b.t)[0]
  if (melhor) return { inSec: Math.round((melhor.t - antes) * 1000) / 1000, entrada: melhor }
  // Nenhum drop deixa a musica inteira no trecho: o DROP NO RISER VALE MAIS que
  // nao dar a volta (18/11, Levi: "antes o climax da musica entrava junto com o
  // riser"). Tocar do comeco sem drop (17/11) tirava isso de toda faixa com
  // poucos segundos de folga. Ela repete, e a volta ja para no fim util e
  // recomeca no inicioSomSec (trilhasDoPlano), sem o vazio do Nia. Entre os
  // drops fortes (>= metade do mais forte), o MAIS CEDO: a volta fica mais curta.
  if (cabem.length === 0) return { inSec: comeco, entrada: null }
  const maisForte = Math.max(...cabem.map((e) => e.forca))
  const escolhido = [...cabem].filter((e) => e.forca >= maisForte * 0.5).sort((a, b) => a.t - b.t)[0]!
  return { inSec: Math.round((escolhido.t - antes) * 1000) / 1000, entrada: escolhido }
}
