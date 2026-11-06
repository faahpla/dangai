import { z } from 'zod'

/*
 * A ETAPA DE AUDIO: a gravacao crua vira a narracao do video sem sair do
 * Dangai. "A unica coisa que me prende a outro software e o processo que eu
 * tenho para editar o audio." O processo dele, na ordem: cortar silencios e
 * organizar na track, tirar ruido, EQ e compressor, Fresh Air, normalizar --
 * e no DaVinci ainda o AI Voice Isolation e o AI Dialogue Leveler.
 *
 * NADA E DESTRUTIVO. A gravacao fica como esta; o que se guarda e a LISTA do
 * que fica (os trechos, em segundos do arquivo bruto) e a cadeia de efeitos. O
 * audio final sai disto, quantas vezes for preciso (electron/services/
 * edicao-de-audio.ts). Este arquivo e so conta: sem disco e sem ffmpeg.
 */

/** Um pedaco da gravacao que fica, em segundos do arquivo BRUTO. */
/** A gravacao principal; as correcoes tem o id delas. */
export const FONTE_PRINCIPAL = 'principal'

/** Um pedaco que fica, em segundos da gravacao DE ONDE ELE VEM (a principal ou uma correcao). */
export const trechoDaGravacaoSchema = z.object({
  de: z.number().nonnegative(),
  ate: z.number().nonnegative(),
  /** Volume so deste pedaco (o "organizar o audio na track"). */
  ganhoDb: z.number().min(-40).max(24).default(0),
  /** De qual gravacao: FONTE_PRINCIPAL ou o id de uma correcao. */
  fonte: z.string().default(FONTE_PRINCIPAL),
})
export type TrechoDaGravacao = z.infer<typeof trechoDaGravacaoSchema>

/** De qual gravacao o trecho vem. Sem fonte (projeto de antes das correcoes): a principal. */
export const fonteDo = (x: { fonte?: string }): string => x.fonte ?? FONTE_PRINCIPAL

/**
 * UMA CORRECAO: um pedaco regravado depois, em outro arquivo. "Existem situacoes
 * em que eu preciso regravar uma parte especifica, porque so identifiquei o
 * problema na hora da edicao." Entra na mesma linha, no lugar do pedaco ruim.
 */
export const correcaoSchema = z.object({
  id: z.string(),
  caminho: z.string(),
  nome: z.string(),
  duracao: z.number().nonnegative(),
})
export type Correcao = z.infer<typeof correcaoSchema>

export const bandaDeEqSchema = z.object({
  freqHz: z.number().min(20).max(20000),
  ganhoDb: z.number().min(-24).max(24),
  /** Largura: 0,7 e larga, 4 e estreita. */
  q: z.number().min(0.1).max(10),
})
export type BandaDeEq = z.infer<typeof bandaDeEqSchema>

/** Um plugin VST3 instalado na maquina (o Fresh Air, da Slate Digital). */
export const pluginDaCadeiaSchema = z.object({
  id: z.string(),
  ligado: z.boolean(),
  caminho: z.string(),
  nome: z.string(),
  /** O estado inteiro do plugin, como ele mesmo guarda (base64). */
  estado: z.string().nullable(),
  /** Os botoes, para mostrar sem abrir o plugin. */
  parametros: z.record(z.string(), z.number()),
})
export type PluginDaCadeia = z.infer<typeof pluginDaCadeiaSchema>

export const cadeiaDeAudioSchema = z.object({
  /** O "AI Voice Isolation": tira ruido e ambiente (DeepFilterNet). */
  isolarVoz: z.object({ ligado: z.boolean(), quantidade: z.number().min(0).max(100) }),
  /** O "AI Dialogue Leveler": a fala num volume so. */
  nivelar: z.object({
    ligado: z.boolean(),
    abaixarAlto: z.boolean(),
    levantarBaixo: z.boolean(),
    abaixarFundo: z.boolean(),
    ganhoDeSaidaDb: z.number().min(-12).max(12),
  }),
  eq: z.object({
    ligado: z.boolean(),
    /** Corta o grave abaixo disto (ronco, pancada no microfone). 0 = sem corte. */
    corteGraveHz: z.number().min(0).max(400),
    bandas: z.array(bandaDeEqSchema).max(6),
  }),
  compressor: z.object({
    ligado: z.boolean(),
    limiarDb: z.number().min(-60).max(0),
    razao: z.number().min(1).max(20),
    ataqueMs: z.number().min(0.1).max(200),
    soltarMs: z.number().min(5).max(2000),
    ganhoDb: z.number().min(0).max(24),
  }),
  plugins: z.array(pluginDaCadeiaSchema).max(8),
  /** O "normalize audio levels": o volume final medido em LUFS. */
  normalizar: z.object({ ligado: z.boolean(), alvoLufs: z.number().min(-30).max(-6) }),
})
export type CadeiaDeAudio = z.infer<typeof cadeiaDeAudioSchema>

export const edicaoDeAudioSchema = z.object({
  /** A gravacao crua, como ele soltou. Nunca e alterada. */
  bruto: z.string(),
  duracaoBruta: z.number().nonnegative(),
  /** As regravacoes importadas. Projeto de antes delas abre sem nenhuma. */
  correcoes: z.array(correcaoSchema).default([]),
  trechos: z.array(trechoDaGravacaoSchema),
  cadeia: cadeiaDeAudioSchema,
  /** Onde o "Pronto" gravou a narracao final (ao lado da gravacao). */
  saida: z.string().nullable().default(null),
})
export type EdicaoDeAudio = z.infer<typeof edicaoDeAudioSchema>

/**
 * A cadeia de partida, o processo dele: tudo ligado menos os botoes que so ele
 * sabe (as bandas do EQ ficam em 0 dB, o Fresh Air entra quando ele escolher).
 * O nivelador sai como o print do DaVinci: as tres caixas e +2 dB.
 */
export const CADEIA_PADRAO: CadeiaDeAudio = {
  isolarVoz: { ligado: true, quantidade: 100 },
  nivelar: { ligado: true, abaixarAlto: true, levantarBaixo: true, abaixarFundo: true, ganhoDeSaidaDb: 2 },
  eq: {
    ligado: true,
    corteGraveHz: 80,
    bandas: [
      { freqHz: 250, ganhoDb: 0, q: 1 },
      { freqHz: 3000, ganhoDb: 0, q: 1 },
      { freqHz: 9000, ganhoDb: 0, q: 0.8 },
    ],
  },
  compressor: { ligado: true, limiarDb: -20, razao: 3, ataqueMs: 10, soltarMs: 150, ganhoDb: 3 },
  plugins: [],
  // O mesmo alvo do render (LUFS_DA_NARRACAO): la o loudnorm vira quase nada.
  normalizar: { ligado: true, alvoLufs: -14 },
}

/** Menor pedaco que um corte deixa: menos que isto e um clique, nao um som. */
export const MENOR_TRECHO_SEC = 0.02

export function novaEdicao(bruto: string, duracaoBruta: number, cadeia: CadeiaDeAudio = CADEIA_PADRAO): EdicaoDeAudio {
  return {
    bruto,
    duracaoBruta,
    correcoes: [],
    trechos: [{ de: 0, ate: duracaoBruta, ganhoDb: 0, fonte: FONTE_PRINCIPAL }],
    cadeia,
    saida: null,
  }
}

/** O arquivo de uma fonte: a gravacao principal ou a correcao com esse id. */
export function caminhoDaFonte(edicao: Pick<EdicaoDeAudio, 'bruto' | 'correcoes'>, fonte: string): string | null {
  if (fonte === FONTE_PRINCIPAL) return edicao.bruto
  return edicao.correcoes.find((c) => c.id === fonte)?.caminho ?? null
}

/** Quanto dura cada fonte (para os silencios nas pontas). */
export function duracoesDasFontes(edicao: Pick<EdicaoDeAudio, 'duracaoBruta' | 'correcoes'>): Record<string, number> {
  return Object.fromEntries([[FONTE_PRINCIPAL, edicao.duracaoBruta], ...edicao.correcoes.map((c) => [c.id, c.duracao])])
}

export function duracaoEditada(trechos: readonly TrechoDaGravacao[]): number {
  return trechos.reduce((t, x) => t + (x.ate - x.de), 0)
}

/** Onde cada trecho comeca na linha do tempo EDITADA. */
export function iniciosEditados(trechos: readonly TrechoDaGravacao[]): number[] {
  const inicios: number[] = []
  let t = 0
  for (const x of trechos) {
    inicios.push(t)
    t += x.ate - x.de
  }
  return inicios
}

/** O instante editado `t` cai em qual trecho, e em que segundo da gravacao. */
export function noBruto(
  trechos: readonly TrechoDaGravacao[],
  t: number,
): { indice: number; bruto: number } | null {
  let inicio = 0
  for (const [indice, x] of trechos.entries()) {
    const dur = x.ate - x.de
    if (t < inicio + dur || indice === trechos.length - 1) {
      return { indice, bruto: x.de + Math.min(Math.max(t - inicio, 0), dur) }
    }
    inicio += dur
  }
  return null
}

/** O segundo da gravacao `b` aparece em que instante editado (null = cortado). */
export function noEditado(
  trechos: readonly TrechoDaGravacao[],
  b: number,
  fonte: string = FONTE_PRINCIPAL,
): number | null {
  let inicio = 0
  for (const x of trechos) {
    if (fonteDo(x) === fonte && b >= x.de && b <= x.ate) return inicio + (b - x.de)
    inicio += x.ate - x.de
  }
  return null
}

/**
 * Corta no instante editado `t`: o trecho de baixo vira dois. Perto demais de
 * uma ponta (menos de MENOR_TRECHO_SEC), nao corta -- o corte ja existe ali.
 */
export function cortarEm(trechos: readonly TrechoDaGravacao[], t: number): TrechoDaGravacao[] {
  const onde = noBruto(trechos, t)
  if (!onde) return [...trechos]
  const x = trechos[onde.indice]!
  if (onde.bruto - x.de < MENOR_TRECHO_SEC || x.ate - onde.bruto < MENOR_TRECHO_SEC) return [...trechos]
  return [
    ...trechos.slice(0, onde.indice),
    { ...x, ate: onde.bruto },
    { ...x, de: onde.bruto },
    ...trechos.slice(onde.indice + 1),
  ]
}

/**
 * Apaga o intervalo editado [a, b) e fecha o buraco -- o que vem depois anda
 * para tras, como "ripple delete" num editor.
 */
export function apagarIntervalo(trechos: readonly TrechoDaGravacao[], a: number, b: number): TrechoDaGravacao[] {
  const ini = Math.max(0, Math.min(a, b))
  const fim = Math.max(a, b)
  if (fim - ini < MENOR_TRECHO_SEC) return [...trechos]
  const resultado: TrechoDaGravacao[] = []
  let inicio = 0
  for (const x of trechos) {
    const dur = x.ate - x.de
    const ia = inicio
    const ib = inicio + dur
    inicio = ib
    // O pedaco do trecho antes de `ini` e o depois de `fim` ficam.
    if (ini > ia) resultado.push({ ...x, ate: x.de + Math.min(dur, ini - ia) })
    if (fim < ib) resultado.push({ ...x, de: x.de + Math.max(0, fim - ia) })
  }
  return resultado.filter((x) => x.ate - x.de >= MENOR_TRECHO_SEC)
}

/**
 * Poe `novos` no instante editado `t`: corta ali e encaixa entre as duas
 * metades. O que vinha depois anda para a frente.
 */
export function inserirEm(
  trechos: readonly TrechoDaGravacao[],
  t: number,
  novos: readonly TrechoDaGravacao[],
): TrechoDaGravacao[] {
  const cortados = cortarEm(trechos, t)
  const inicios = iniciosEditados(cortados)
  // O primeiro trecho que comeca no instante (ou depois): os novos entram antes dele.
  let i = inicios.findIndex((ini) => ini >= t - MENOR_TRECHO_SEC / 2)
  if (i < 0) i = cortados.length
  return [...cortados.slice(0, i), ...novos, ...cortados.slice(i)]
}

/** O pedaco ruim [a, b) sai e a correcao entra no lugar -- um gesto so. */
export function substituirIntervalo(
  trechos: readonly TrechoDaGravacao[],
  a: number,
  b: number,
  novos: readonly TrechoDaGravacao[],
): TrechoDaGravacao[] {
  return inserirEm(apagarIntervalo(trechos, a, b), Math.min(a, b), novos)
}

/** A correcao inteira, como trecho. */
export function trechoDaCorrecao(c: Correcao): TrechoDaGravacao {
  return { de: 0, ate: c.duracao, ganhoDb: 0, fonte: c.id }
}

export function apagarTrecho(trechos: readonly TrechoDaGravacao[], indice: number): TrechoDaGravacao[] {
  return trechos.filter((_, i) => i !== indice)
}

export function ganhoDoTrecho(trechos: readonly TrechoDaGravacao[], indice: number, ganhoDb: number): TrechoDaGravacao[] {
  return trechos.map((x, i) => (i === indice ? { ...x, ganhoDb } : x))
}

export interface OpcoesDosSilencios {
  /** Quanto abaixo da fala conta como silencio, em dB (maior = so o silencio fundo). */
  abaixoDaFalaDb: number
  /** Pausa mais curta que isto fica como esta: e o ritmo da fala, nao um silencio. */
  minimoSec: number
  /** Quanto da pausa sobra de cada lado depois do corte. */
  sobraSec: number
}

export const SILENCIOS_PADRAO: OpcoesDosSilencios = { abaixoDaFalaDb: 30, minimoSec: 0.45, sobraSec: 0.12 }

/**
 * Os silencios de um sinal, pelo RMS de janelas iguais (`passoSec` cada).
 *
 * O limiar e RELATIVO a fala: a fala e o percentil 90 das janelas, e silencio
 * e o que fica `abaixoDaFalaDb` abaixo dela. Um limiar fixo em -40 dB pegava a
 * gravacao baixinha inteira como silencio, e nenhum na gravacao com ruido.
 */
export function silenciosDoSinal(
  rmsDb: readonly number[],
  passoSec: number,
  opcoes: OpcoesDosSilencios = SILENCIOS_PADRAO,
): { de: number; ate: number }[] {
  if (rmsDb.length === 0) return []
  const ordenados = [...rmsDb].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (ordenados.length === 0) return []
  const fala = ordenados[Math.floor(ordenados.length * 0.9)]!
  const limiar = fala - opcoes.abaixoDaFalaDb
  const silencios: { de: number; ate: number }[] = []
  let comeco: number | null = null
  for (let i = 0; i <= rmsDb.length; i++) {
    const quieto = i < rmsDb.length && !(rmsDb[i]! > limiar)
    if (quieto && comeco === null) comeco = i
    if (!quieto && comeco !== null) {
      if ((i - comeco) * passoSec >= opcoes.minimoSec) silencios.push({ de: comeco * passoSec, ate: i * passoSec })
      comeco = null
    }
  }
  return silencios
}

/**
 * Tira o meio de cada silencio (em segundos da GRAVACAO), deixando `sobraSec`
 * de cada lado -- a pausa encolhe para um respiro em vez de sumir. No comeco e
 * no fim da gravacao so sobra o lado da fala: o silencio antes da primeira
 * palavra sai, menos os `sobraSec` que protegem o ataque dela.
 */
export function cortarSilencios(
  trechos: readonly TrechoDaGravacao[],
  silencios: readonly { de: number; ate: number; fonte?: string }[],
  sobraSec: number = SILENCIOS_PADRAO.sobraSec,
  /** A duracao da gravacao, ou de cada fonte (com correcoes). */
  duracao?: number | Record<string, number>,
): { trechos: TrechoDaGravacao[]; cortados: number; segundos: number } {
  let resultado = [...trechos]
  let cortados = 0
  const antes = duracaoEditada(trechos)
  for (const s of silencios) {
    const fonte = s.fonte ?? FONTE_PRINCIPAL
    const fim = typeof duracao === 'number' ? duracao : duracao?.[fonte]
    const naPonta0 = s.de <= 0.001
    const naPontaFim = fim !== undefined && s.ate >= fim - 0.001
    const de = naPonta0 ? s.de : s.de + sobraSec
    const ate = naPontaFim ? s.ate : s.ate - sobraSec
    if (ate - de < MENOR_TRECHO_SEC) continue
    const novo: TrechoDaGravacao[] = []
    let mexeu = false
    for (const x of resultado) {
      // So o pedaco do silencio que cai dentro deste trecho -- e da mesma gravacao -- sai.
      if (fonteDo(x) !== fonte) {
        novo.push(x)
        continue
      }
      const a = Math.max(de, x.de)
      const b = Math.min(ate, x.ate)
      if (b - a < MENOR_TRECHO_SEC) {
        novo.push(x)
        continue
      }
      mexeu = true
      if (a - x.de >= MENOR_TRECHO_SEC) novo.push({ ...x, ate: a })
      if (x.ate - b >= MENOR_TRECHO_SEC) novo.push({ ...x, de: b })
    }
    if (mexeu) cortados += 1
    resultado = novo
  }
  return { trechos: resultado, cortados, segundos: antes - duracaoEditada(resultado) }
}

const linear = (db: number): number => 10 ** (db / 20)
const n = (x: number, casas = 4): string => String(Math.round(x * 10 ** casas) / 10 ** casas)

/**
 * Os filtros do ffmpeg para o MEIO da cadeia, na ordem dele: nivelar, EQ e
 * compressor. A IA de limpeza vem antes (programa proprio), o Fresh Air e a
 * normalizacao depois (ver electron/services/edicao-de-audio.ts). null = nada a
 * fazer aqui.
 *
 * NIVELAR (o Dialogue Leveler): "abaixar o fundo" e um gate suave -- o
 * respiro e o ambiente descem, nao somem --, e "levantar o baixo"/"abaixar o
 * alto" sao o dynaudnorm, que mede a fala em janelas de 1/4 de segundo e leva
 * cada uma para perto do mesmo nivel. Sem "levantar", o ganho maximo e 1 (nada
 * sobe); sem "abaixar", o alvo e o teto (nada desce).
 */
export function filtrosDaCadeia(cadeia: CadeiaDeAudio): string | null {
  const f: string[] = []
  const { nivelar, eq, compressor } = cadeia
  if (nivelar.ligado) {
    if (nivelar.abaixarFundo) f.push('agate=threshold=0.012:range=0.25:ratio=2.5:attack=5:release=250')
    if (nivelar.levantarBaixo || nivelar.abaixarAlto) {
      const maximo = nivelar.levantarBaixo ? 8 : 1
      const alvo = nivelar.abaixarAlto ? 0.5 : 0.95
      f.push(`dynaudnorm=f=250:g=15:p=${alvo}:m=${maximo}:t=0.01`)
    }
    if (nivelar.ganhoDeSaidaDb !== 0) f.push(`volume=${n(nivelar.ganhoDeSaidaDb, 2)}dB`)
  }
  if (eq.ligado) {
    if (eq.corteGraveHz > 0) f.push(`highpass=f=${n(eq.corteGraveHz, 1)}:poles=2`)
    for (const b of eq.bandas) {
      if (b.ganhoDb !== 0) f.push(`equalizer=f=${n(b.freqHz, 1)}:t=q:w=${n(b.q, 3)}:g=${n(b.ganhoDb, 2)}`)
    }
  }
  if (compressor.ligado) {
    f.push(
      `acompressor=threshold=${n(linear(compressor.limiarDb), 6)}:ratio=${n(compressor.razao, 2)}` +
        `:attack=${n(compressor.ataqueMs, 2)}:release=${n(compressor.soltarMs, 1)}:makeup=${n(linear(compressor.ganhoDb), 4)}`,
    )
  }
  return f.length > 0 ? f.join(',') : null
}

/**
 * Quanto a IA tira, do "Amount" (0-100) para o limite de atenuacao dela, em dB.
 * 100 e sem limite (tudo que ela acha que e ruido sai); abaixo disso o ruido
 * so desce ate o limite, e a voz soa menos processada.
 */
export function limiteDaIa(quantidade: number): number {
  if (quantidade >= 100) return 100
  return Math.round((quantidade / 100) * 40 * 10) / 10
}
