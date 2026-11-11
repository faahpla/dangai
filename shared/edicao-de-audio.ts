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

/** A gravacao principal; as correcoes tem o id delas. */
export const FONTE_PRINCIPAL = 'principal'

/** Quantas faixas a etapa tem no maximo (A1 a A6). */
export const MAX_FAIXAS = 6

/*
 * AS FAIXAS (2.0): "que tal essa etapa funcionar com 2 tracks de audio ou mais?
 * assim como funciona no DaVinci... eu consigo ter um controle melhor sobre os
 * tempos". Cada trecho mora numa faixa, num lugar da linha do tempo (`em`), e o
 * que esta em faixas diferentes no mesmo instante toca junto. Vao entre trechos
 * e silencio.
 *
 * `em` e em segundos a 100%: a velocidade acelera a mistura inteira no fim, e a
 * tela so encolhe a vista (ver fatorDaVelocidade).
 */
export const trechoDaGravacaoSchema = z.object({
  /** O pedaco da gravacao DE ONDE ELE VEM (a principal ou uma correcao), em segundos dela. */
  de: z.number().nonnegative(),
  ate: z.number().nonnegative(),
  /** Volume so deste pedaco (o "organizar o audio na track"). */
  ganhoDb: z.number().min(-40).max(24).default(0),
  /** De qual gravacao: FONTE_PRINCIPAL ou o id de uma correcao. */
  fonte: z.string().default(FONTE_PRINCIPAL),
  /** Onde comeca na linha do tempo. Sem (projeto de antes das faixas): logo depois do anterior. */
  em: z.number().nonnegative().optional(),
  /** A faixa: 0 = A1. */
  faixa: z.number().int().min(0).max(MAX_FAIXAS - 1).default(0),
  /** Quem e quem na tela (a selecao). Sem: ganha um ao abrir. */
  id: z.string().optional(),
  /** Um efeito so deste trecho -- piada ou censura (ver EFEITOS_DO_TRECHO). Sem: o som dele. */
  efeito: z.enum(['bip', 'mudo', 'fina', 'grossa', 'robo', 'eco', 'radio', 'reverso']).nullable().optional(),
})
type TrechoLido = z.infer<typeof trechoDaGravacaoSchema>
export type EfeitoDoTrecho = NonNullable<TrechoLido['efeito']>

/*
 * OS EFEITOS DE UM TRECHO: "as vezes gosto de colocar uns efeitos no audio para
 * fazer piada ou censurar... quero continuar tendo essa liberdade so que aqui
 * no Dangai". Corta a palavra (C antes e depois), escolhe o trecho e o efeito.
 * Todos mantem o tamanho do trecho: o resto da linha nao anda. Como cada um
 * soa esta em electron/services/edicao-de-audio.ts (efeitoNoPedaco).
 */
export const EFEITOS_DO_TRECHO: readonly { id: EfeitoDoTrecho; nome: string; dica: string }[] = [
  { id: 'bip', nome: 'Bip', dica: 'Censura: um bipe no lugar da fala, no volume dela' },
  { id: 'mudo', nome: 'Silêncio', dica: 'Censura: o trecho fica mudo' },
  { id: 'fina', nome: 'Voz fina', dica: 'A voz de esquilo: mais aguda, no mesmo tempo' },
  { id: 'grossa', nome: 'Voz grossa', dica: 'A voz de monstro: mais grave, no mesmo tempo' },
  { id: 'robo', nome: 'Robô', dica: 'A voz de robô' },
  { id: 'eco', nome: 'Eco', dica: 'A voz ecoando, como num salão' },
  { id: 'radio', nome: 'Rádio', dica: 'A voz de rádio ou de telefone' },
  { id: 'reverso', nome: 'Ao contrário', dica: 'O trecho tocado de trás para a frente' },
]
export type TrechoDaGravacao = Omit<TrechoLido, 'em' | 'id'> & { em: number; id: string }
/** Um pedaco que ainda vai entrar na linha (a correcao inteira): sem lugar e sem id. */
export type PedacoNovo = Pick<TrechoDaGravacao, 'de' | 'ate' | 'ganhoDb' | 'fonte'>

/** De qual gravacao o trecho vem. Sem fonte (projeto de antes das correcoes): a principal. */
export const fonteDo = (x: { fonte?: string }): string => x.fonte ?? FONTE_PRINCIPAL

let contador = 0
/** Um id que nao se repete nesta sessao nem entre sessoes. */
export function novoId(): string {
  contador += 1
  return `t${Date.now().toString(36)}${contador.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Da lugar e id a quem nao tem. Projeto de antes das faixas: os trechos eram uma
 * fila (cada um logo depois do anterior), e e assim que abrem -- tudo na A1, sem
 * nenhum vao.
 */
export function posicionar(
  trechos: readonly (Omit<TrechoDaGravacao, 'em' | 'id' | 'faixa'> & { em?: number | undefined; id?: string | undefined; faixa?: number | undefined })[],
): TrechoDaGravacao[] {
  const emFila = trechos.some((x) => x.em === undefined)
  let t = 0
  return trechos.map((x) => {
    const em = emFila ? t : x.em!
    t += x.ate - x.de
    return { ...x, em, faixa: emFila ? 0 : (x.faixa ?? 0), id: x.id ?? novoId() }
  })
}

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

/** A velocidade cabe entre metade e o dobro. */
export const VELOCIDADE_MIN = 50
export const VELOCIDADE_MAX = 200
/** Os atalhos da tela: o normal e as que ele usa. */
export const VELOCIDADES_RAPIDAS = [100, 110, 115, 120] as const

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
  /**
   * A VELOCIDADE, em %: o "Change Clip Speed" do DaVinci com o Pitch Correction
   * ligado -- "acelerar o audio sem mudar o pitch". 100 = normal; ele usa 110,
   * 115 e 120. Entra depois dos cortes e antes de normalizar, so na narracao
   * final (o "Pronto"); na tela, o preview toca acelerado pelo proprio navegador.
   * Com default: cadeia salva antes disto (o "meu padrao") abre em 100.
   */
  velocidade: z.number().min(VELOCIDADE_MIN).max(VELOCIDADE_MAX).default(100),
  /** O "normalize audio levels": o volume final medido em LUFS. */
  normalizar: z.object({ ligado: z.boolean(), alvoLufs: z.number().min(-30).max(-6) }),
})
export type CadeiaDeAudio = z.infer<typeof cadeiaDeAudioSchema>

/**
 * OS TEMPOS DA NARRACAO QUE ESTA NO VIDEO: onde cada pedaco da gravacao caiu
 * no ultimo "Pronto", e a que velocidade. Guardados para o "Pronto" seguinte
 * saber para onde cada instante foi (ver ancorasEntreTempos) -- sem isso, voltar
 * ao Audio para tirar o Fresh Air jogava fora as cenas, as transicoes e a selecao.
 */
export const temposDaSaidaSchema = z.object({
  trechos: z.array(
    z.object({
      de: z.number(),
      ate: z.number(),
      em: z.number(),
      fonte: z.string().default(FONTE_PRINCIPAL),
      id: z.string().optional(),
    }),
  ),
  velocidade: z.number(),
})
export type TemposDaSaida = z.infer<typeof temposDaSaidaSchema>

const edicaoLidaSchema = z.object({
  /** A gravacao crua, como ele soltou. Nunca e alterada. */
  bruto: z.string(),
  duracaoBruta: z.number().nonnegative(),
  /** As regravacoes importadas. Projeto de antes delas abre sem nenhuma. */
  correcoes: z.array(correcaoSchema).default([]),
  trechos: z.array(trechoDaGravacaoSchema),
  cadeia: cadeiaDeAudioSchema,
  /** Onde o "Pronto" gravou a narracao final (ao lado da gravacao). */
  saida: z.string().nullable().default(null),
  /** Os tempos da narracao que o "Pronto" gravou em `saida`. Projeto de antes disto: null. */
  tempos: temposDaSaidaSchema.nullable().default(null),
})
export type EdicaoDeAudio = Omit<z.infer<typeof edicaoLidaSchema>, 'trechos'> & { trechos: TrechoDaGravacao[] }
/** Lida do arquivo: todo trecho sai com lugar, faixa e id (ver posicionar). */
export const edicaoDeAudioSchema = edicaoLidaSchema.transform((e): EdicaoDeAudio => ({ ...e, trechos: posicionar(e.trechos) }))

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
  velocidade: 100,
  normalizar: { ligado: true, alvoLufs: -14 },
}

/** O fator da velocidade (1,15 = 115%), ou 1 quando nao mexe. */
export function fatorDaVelocidade(cadeia: Pick<CadeiaDeAudio, 'velocidade'>): number {
  const v = cadeia.velocidade ?? 100
  return Math.abs(v - 100) < 0.005 ? 1 : v / 100
}

/** Menor pedaco que um corte deixa: menos que isto e um clique, nao um som. */
export const MENOR_TRECHO_SEC = 0.02

export function novaEdicao(bruto: string, duracaoBruta: number, cadeia: CadeiaDeAudio = CADEIA_PADRAO): EdicaoDeAudio {
  return {
    bruto,
    duracaoBruta,
    correcoes: [],
    trechos: [{ de: 0, ate: duracaoBruta, ganhoDb: 0, fonte: FONTE_PRINCIPAL, em: 0, faixa: 0, id: novoId() }],
    cadeia,
    saida: null,
    tempos: null,
  }
}

/** Os tempos que esta edicao daria no "Pronto" (so o que mexe no tempo: cortes, lugar, velocidade). */
export function temposDa(edicao: Pick<EdicaoDeAudio, 'trechos' | 'cadeia'>): TemposDaSaida {
  return {
    trechos: edicao.trechos.map((x) => ({ de: x.de, ate: x.ate, em: x.em, fonte: fonteDo(x), id: x.id })),
    velocidade: edicao.cadeia.velocidade ?? 100,
  }
}

/**
 * Os dois dao a narracao com os MESMOS tempos? Mudou so o som (Fresh Air, EQ,
 * volume de um trecho, efeito): cada palavra continua no mesmo instante, e nada
 * no video precisa andar. A faixa nao conta (trocar de faixa no mesmo lugar nao
 * muda o tempo).
 */
export function mesmosTempos(a: TemposDaSaida, b: TemposDaSaida): boolean {
  if (fatorDaVelocidade(a) !== fatorDaVelocidade(b)) return false
  const chave = (x: TemposDaSaida['trechos'][number]): string =>
    [x.fonte, Math.round(x.de * 1000), Math.round(x.ate * 1000), Math.round(x.em * 1000)].join('|')
  const ka = a.trechos.map(chave).sort()
  const kb = b.trechos.map(chave).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i])
}

/**
 * DE ONDE PARA ONDE cada instante da narracao velha foi na nova: os pares
 * (tempo velho, tempo novo) das pontas de cada pedaco da gravacao que esta nas
 * duas. Um instante da gravacao crua tem um lugar so em cada edicao; o tempo
 * final e o lugar dele na linha (a 100%) dividido pela velocidade. O que nao
 * casa (pedaco cortado, silencio) fica entre as ancoras, proporcional (ver
 * mapaDeTempo). O mesmo trecho (pelo id) vem primeiro: um pedaco duplicado
 * casa com o seu, e nao com a copia.
 */
export function ancorasEntreTempos(velhos: TemposDaSaida, novos: TemposDaSaida): [number, number][] {
  const fv = fatorDaVelocidade(velhos)
  const fn = fatorDaVelocidade(novos)
  const mesmos: [number, number][] = []
  const outros: [number, number][] = []
  for (const v of velhos.trechos) {
    for (const n of novos.trechos) {
      if (v.fonte !== n.fonte) continue
      const a = Math.max(v.de, n.de)
      const b = Math.min(v.ate, n.ate)
      if (b - a < MENOR_TRECHO_SEC) continue
      const lista = v.id !== undefined && v.id === n.id ? mesmos : outros
      for (const r of [a, b]) lista.push([(v.em + r - v.de) / fv, (n.em + r - n.de) / fn])
    }
  }
  return [...mesmos, ...outros]
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

/** Folga das contas de tempo: 0,5 ms (menos que uma amostra a 2 kHz; nenhum ouvido nota). */
const EPS = 0.0005

export const duracaoDo = (x: Pick<TrechoDaGravacao, 'de' | 'ate'>): number => x.ate - x.de
export const fimDo = (x: Pick<TrechoDaGravacao, 'de' | 'ate' | 'em'>): number => x.em + x.ate - x.de

/** Onde a linha do tempo termina (a 100%): o fim do ultimo trecho, de qualquer faixa. */
export function duracaoEditada(trechos: readonly Pick<TrechoDaGravacao, 'de' | 'ate' | 'em'>[]): number {
  return trechos.reduce((m, x) => Math.max(m, fimDo(x)), 0)
}

/** Na ordem do tempo (e da faixa, no mesmo instante). */
export function emOrdem<T extends Pick<TrechoDaGravacao, 'em' | 'faixa'>>(trechos: readonly T[]): T[] {
  return [...trechos].sort((a, b) => a.em - b.em || a.faixa - b.faixa)
}

/** Quantas faixas estao em uso (a mais alta + 1; no minimo 1). */
export function faixasUsadas(trechos: readonly Pick<TrechoDaGravacao, 'faixa'>[]): number {
  return trechos.reduce((m, x) => Math.max(m, x.faixa + 1), 1)
}

/** Os trechos debaixo do instante `t` (de uma faixa, ou de todas). */
export function sobAgulha(trechos: readonly TrechoDaGravacao[], t: number, faixa?: number): TrechoDaGravacao[] {
  return trechos.filter((x) => x.em - EPS <= t && t < fimDo(x) - EPS && (faixa === undefined || x.faixa === faixa))
}

/** Dois trechos da MESMA faixa por cima um do outro: a faixa e uma fila, como no DaVinci. */
export function sobrepoe(trechos: readonly TrechoDaGravacao[]): boolean {
  const porFaixa = new Map<number, TrechoDaGravacao[]>()
  for (const x of trechos) porFaixa.set(x.faixa, [...(porFaixa.get(x.faixa) ?? []), x])
  for (const lista of porFaixa.values()) {
    const fila = emOrdem(lista)
    for (let i = 1; i < fila.length; i++) if (fila[i]!.em < fimDo(fila[i - 1]!) - EPS) return true
  }
  return false
}

/**
 * Corta no instante `t` os trechos debaixo dele -- todos, ou so os de `ids`. A
 * segunda metade ganha id novo. Perto demais de uma ponta (menos de
 * MENOR_TRECHO_SEC), nao corta: o corte ja existe ali.
 */
export function cortarEm(trechos: readonly TrechoDaGravacao[], t: number, ids?: ReadonlySet<string>): TrechoDaGravacao[] {
  return trechos.flatMap((x) => {
    if (ids && !ids.has(x.id)) return [x]
    if (t <= x.em || t >= fimDo(x)) return [x]
    const meio = x.de + (t - x.em)
    if (meio - x.de < MENOR_TRECHO_SEC || x.ate - meio < MENOR_TRECHO_SEC) return [x]
    return [
      { ...x, ate: meio },
      { ...x, id: novoId(), de: meio, em: t },
    ]
  })
}

/**
 * FECHA O VAO [a, b): o que comeca em `b` ou depois anda para tras -- em TODAS
 * as faixas juntas, para a fala de uma nao escorregar para cima da outra. Anda
 * o quanto da: se numa faixa um trecho que fica parado ocupa parte do vao, o
 * resto para ali (nada passa por cima de nada).
 */
export function fecharBuraco(trechos: readonly TrechoDaGravacao[], a: number, b: number): TrechoDaGravacao[] {
  let passo = b - a
  if (passo < EPS) return [...trechos]
  const anda = (x: TrechoDaGravacao): boolean => x.em >= b - EPS
  for (const f of new Set(trechos.map((x) => x.faixa))) {
    const daFaixa = trechos.filter((x) => x.faixa === f)
    const andam = daFaixa.filter(anda)
    if (andam.length === 0) continue
    const primeiro = Math.min(...andam.map((x) => x.em))
    const limite = daFaixa.filter((x) => !anda(x)).reduce((m, x) => Math.max(m, fimDo(x)), 0)
    passo = Math.min(passo, primeiro - limite)
  }
  if (passo < EPS) return [...trechos]
  return trechos.map((x) => (anda(x) ? { ...x, em: Math.max(0, x.em - passo) } : x))
}

/** Abre espaco em `t`: o que comeca ali ou depois anda `largura` para a frente, em todas as faixas. */
export function abrirEspaco(trechos: readonly TrechoDaGravacao[], t: number, largura: number): TrechoDaGravacao[] {
  if (largura < EPS) return [...trechos]
  return trechos.map((x) => (x.em >= t - EPS ? { ...x, em: x.em + largura } : x))
}

/** Os intervalos juntos, sem sobreposicao, em ordem. */
function uniao(intervalos: readonly [number, number][]): [number, number][] {
  const fila = [...intervalos].sort((p, q) => p[0] - q[0])
  const saida: [number, number][] = []
  for (const [a, b] of fila) {
    const ultimo = saida[saida.length - 1]
    if (ultimo && a <= ultimo[1] + EPS) ultimo[1] = Math.max(ultimo[1], b)
    else saida.push([a, b])
  }
  return saida
}

/**
 * Tira os trechos `ids`. `fechar`: o vao que fica fecha (o Delete do DaVinci, o
 * ripple); sem, o vao fica (o Backspace).
 */
export function apagarTrechos(trechos: readonly TrechoDaGravacao[], ids: ReadonlySet<string>, fechar: boolean): TrechoDaGravacao[] {
  const saem = trechos.filter((x) => ids.has(x.id))
  let resto = trechos.filter((x) => !ids.has(x.id))
  if (!fechar) return resto
  // De tras para frente: fechar um vao nao mexe no lugar dos que vem antes.
  for (const [a, b] of uniao(saem.map((x): [number, number] => [x.em, fimDo(x)])).reverse()) resto = fecharBuraco(resto, a, b)
  return resto
}

/**
 * Apaga o intervalo [a, b) da linha do tempo, em todas as faixas, e fecha o vao
 * -- o que vem depois anda para tras. Sobra menor que MENOR_TRECHO_SEC sai junto.
 */
export function apagarIntervalo(trechos: readonly TrechoDaGravacao[], a: number, b: number, fechar = true): TrechoDaGravacao[] {
  const ini = Math.max(0, Math.min(a, b))
  const fim = Math.max(a, b)
  if (fim - ini < MENOR_TRECHO_SEC) return [...trechos]
  const resto: TrechoDaGravacao[] = []
  for (const x of trechos) {
    const xf = fimDo(x)
    if (xf <= ini + EPS || x.em >= fim - EPS) {
      resto.push(x)
      continue
    }
    if (x.em < ini) {
      const antes = { ...x, ate: x.de + (ini - x.em) }
      if (duracaoDo(antes) >= MENOR_TRECHO_SEC) resto.push(antes)
    }
    if (xf > fim) {
      const depois = { ...x, id: x.em < ini ? novoId() : x.id, de: x.de + (fim - x.em), em: fim }
      if (duracaoDo(depois) >= MENOR_TRECHO_SEC) resto.push(depois)
    }
  }
  return fechar ? fecharBuraco(resto, ini, fim) : resto
}

/**
 * Poe `novos` no instante `t` da faixa `faixa`, um depois do outro: o trecho
 * dessa faixa debaixo de `t` e cortado ali, e o que vem depois (em todas as
 * faixas) anda para a frente o tamanho deles.
 */
export function inserirEm(trechos: readonly TrechoDaGravacao[], t: number, faixa: number, novos: readonly PedacoNovo[]): TrechoDaGravacao[] {
  const debaixo = new Set(sobAgulha(trechos, t, faixa).map((x) => x.id))
  let r = cortarEm(trechos, t, debaixo)
  // Nao cortou (perto demais de uma ponta): entra na ponta mais perto, sem cair por cima.
  let onde = t
  const ainda = r.find((x) => x.faixa === faixa && x.em < onde - EPS && fimDo(x) > onde + EPS)
  if (ainda) onde = onde - ainda.em < fimDo(ainda) - onde ? ainda.em : fimDo(ainda)
  const largura = novos.reduce((s, n) => s + duracaoDo(n), 0)
  r = abrirEspaco(r, onde, largura)
  let em = onde
  for (const n of novos) {
    r.push({ ...n, em, faixa, id: novoId() })
    em += duracaoDo(n)
  }
  return r
}

/** O pedaco ruim [a, b) sai (de todas as faixas) e os `novos` entram no lugar, na faixa `faixa`. */
export function substituirIntervalo(
  trechos: readonly TrechoDaGravacao[],
  a: number,
  b: number,
  faixa: number,
  novos: readonly PedacoNovo[],
): TrechoDaGravacao[] {
  return inserirEm(apagarIntervalo(trechos, a, b), Math.min(a, b), faixa, novos)
}

/** A correcao inteira, como pedaco novo. */
export function trechoDaCorrecao(c: Correcao): PedacoNovo {
  return { de: 0, ate: c.duracao, ganhoDb: 0, fonte: c.id }
}

/**
 * MOVE os trechos `ids` `dt` segundos e `dFaixa` faixas. null quando nao cabe:
 * por cima de outro trecho na mesma faixa, antes do zero ou fora das faixas.
 */
export function moverTrechos(trechos: readonly TrechoDaGravacao[], ids: ReadonlySet<string>, dt: number, dFaixa: number): TrechoDaGravacao[] | null {
  const movidos = trechos.map((x) => (ids.has(x.id) ? { ...x, em: x.em + dt, faixa: x.faixa + dFaixa } : x))
  for (const x of movidos) {
    if (!ids.has(x.id)) continue
    if (x.em < -EPS || x.faixa < 0 || x.faixa >= MAX_FAIXAS) return null
  }
  if (sobrepoe(movidos)) return null
  return movidos.map((x) => (x.em < 0 ? { ...x, em: 0 } : x))
}

/**
 * MOVER ATE ONDE DA: tenta o `dt` pedido; se cai por cima de outro trecho,
 * encosta no vizinho (antes ou depois dele) -- o lugar valido mais perto do que
 * foi pedido. Assim arrastar ate um vizinho para colado nele, como no DaVinci.
 */
export function moverPerto(
  trechos: readonly TrechoDaGravacao[],
  ids: ReadonlySet<string>,
  dt: number,
  dFaixa: number,
): { trechos: TrechoDaGravacao[]; dt: number } | null {
  const vao = moverTrechos(trechos, ids, dt, dFaixa)
  if (vao) return { trechos: vao, dt }
  const indo = trechos.filter((x) => ids.has(x.id))
  const ficam = trechos.filter((x) => !ids.has(x.id))
  const candidatos = new Set<number>([-Math.min(...indo.map((x) => x.em))])
  for (const m of indo) {
    for (const s of ficam) {
      if (s.faixa !== m.faixa + dFaixa) continue
      candidatos.add(fimDo(s) - m.em)
      candidatos.add(s.em - fimDo(m))
    }
  }
  let melhor: { trechos: TrechoDaGravacao[]; dt: number } | null = null
  for (const c of [...candidatos].sort((p, q) => Math.abs(p - dt) - Math.abs(q - dt))) {
    const r = moverTrechos(trechos, ids, c, dFaixa)
    if (r) {
      melhor = { trechos: r, dt: c }
      break
    }
  }
  return melhor
}

/**
 * APARA uma ponta do trecho `id` ate o instante `t` -- arrastar a borda, como no
 * DaVinci. A ponta nao passa do vizinho da mesma faixa, nem do comeco/fim da
 * gravacao, e o trecho nunca fica menor que MENOR_TRECHO_SEC. O som nao anda: o
 * que estava em cada instante continua la.
 */
export function aparar(
  trechos: readonly TrechoDaGravacao[],
  id: string,
  lado: 'inicio' | 'fim',
  t: number,
  duracoes: Readonly<Record<string, number>>,
): TrechoDaGravacao[] {
  const x = trechos.find((y) => y.id === id)
  if (!x) return [...trechos]
  const vizinhos = trechos.filter((y) => y.faixa === x.faixa && y.id !== id)
  let novo: TrechoDaGravacao
  if (lado === 'inicio') {
    const antes = vizinhos.filter((y) => fimDo(y) <= x.em + EPS).reduce((m, y) => Math.max(m, fimDo(y)), 0)
    const minimo = Math.max(antes, x.em - x.de, 0)
    const maximo = fimDo(x) - MENOR_TRECHO_SEC
    const em = Math.min(maximo, Math.max(minimo, t))
    novo = { ...x, em, de: x.de + (em - x.em) }
  } else {
    const depois = vizinhos.filter((y) => y.em >= fimDo(x) - EPS).reduce((m, y) => Math.min(m, y.em), Infinity)
    const total = duracoes[fonteDo(x)] ?? Infinity
    const maximo = Math.min(depois, x.em + (total - x.de))
    const minimo = x.em + MENOR_TRECHO_SEC
    const fim = Math.min(maximo, Math.max(minimo, t))
    novo = { ...x, ate: x.de + (fim - x.em) }
  }
  return trechos.map((y) => (y.id === id ? novo : y))
}

export function ganhoDosTrechos(trechos: readonly TrechoDaGravacao[], ids: ReadonlySet<string>, ganhoDb: number): TrechoDaGravacao[] {
  return trechos.map((x) => (ids.has(x.id) ? { ...x, ganhoDb } : x))
}

export function efeitoDosTrechos(trechos: readonly TrechoDaGravacao[], ids: ReadonlySet<string>, efeito: EfeitoDoTrecho | null): TrechoDaGravacao[] {
  return trechos.map((x) => (ids.has(x.id) ? { ...x, efeito } : x))
}

/** A faixa `faixa` esta livre de `a` a `b`? */
function livre(trechos: readonly TrechoDaGravacao[], faixa: number, a: number, b: number): boolean {
  return !trechos.some((x) => x.faixa === faixa && x.em < b - EPS && fimDo(x) > a + EPS)
}

/**
 * POE SEM CORTAR NADA: `novos`, um depois do outro, a partir de `t`, na faixa
 * pedida -- como soltar um audio numa faixa do DaVinci. "Quando eu tento
 * importar um audio novo do drag e drop, eu nao consigo colocar na track que eu
 * quero, ele sempre vai na primeira e corta o processo." Nada anda e nada e
 * cortado: se a faixa pedida esta ocupada ali, vai para a proxima faixa livre
 * naquele instante; sem nenhuma, para o fim da faixa pedida.
 */
export function colocarEm(trechos: readonly TrechoDaGravacao[], t: number, faixa: number, novos: readonly PedacoNovo[]): TrechoDaGravacao[] {
  const largura = novos.reduce((s, n) => s + duracaoDo(n), 0)
  const inicio = Math.max(0, t)
  const ordem = [faixa, ...Array.from({ length: MAX_FAIXAS }, (_, i) => i).filter((f) => f !== faixa)]
  let onde: { em: number; faixa: number } | null = null
  for (const f of ordem) {
    if (livre(trechos, f, inicio, inicio + largura)) {
      onde = { em: inicio, faixa: f }
      break
    }
  }
  onde ??= { em: trechos.filter((x) => x.faixa === faixa).reduce((m, x) => Math.max(m, fimDo(x)), 0), faixa }
  const r = [...trechos]
  let em = onde.em
  for (const n of novos) {
    r.push({ ...n, em, faixa: onde.faixa, id: novoId() })
    em += duracaoDo(n)
  }
  return r
}

/**
 * A TECLA B: "la no DaVinci eu aperto a tecla b para cortar aonde ta a agulha e
 * juntar direto no ultimo corte" (o Ripple Trim Start to Playhead). Tira do
 * trecho `id` o pedaco do comeco dele ate a agulha `t`, e o que vem depois
 * chega para tras ate o corte -- em todas as faixas, como o Delete.
 */
export function puxarAteAgulha(trechos: readonly TrechoDaGravacao[], id: string, t: number): TrechoDaGravacao[] {
  const x = trechos.find((y) => y.id === id)
  if (!x || t < x.em + MENOR_TRECHO_SEC || t > fimDo(x) - MENOR_TRECHO_SEC) return [...trechos]
  const aparado = trechos.map((y) => (y.id === id ? { ...y, em: t, de: y.de + (t - y.em) } : y))
  return fecharBuraco(aparado, x.em, t)
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
 *
 * Trecho por trecho, na faixa dele: o que sobra de cada um fica emendado onde
 * ele comecava, e o vao que abre no fim dele fecha (ver fecharBuraco).
 */
export function cortarSilencios(
  trechos: readonly TrechoDaGravacao[],
  silencios: readonly { de: number; ate: number; fonte?: string }[],
  sobraSec: number = SILENCIOS_PADRAO.sobraSec,
  /** A duracao da gravacao, ou de cada fonte (com correcoes). */
  duracao?: number | Record<string, number>,
): { trechos: TrechoDaGravacao[]; cortados: number; segundos: number } {
  // O pedaco de cada silencio que sai, ja sem a sobra.
  const saem = silencios.flatMap((s, indice) => {
    const fonte = s.fonte ?? FONTE_PRINCIPAL
    const fim = typeof duracao === 'number' ? duracao : duracao?.[fonte]
    const de = s.de <= 0.001 ? s.de : s.de + sobraSec
    const ate = fim !== undefined && s.ate >= fim - 0.001 ? s.ate : s.ate - sobraSec
    return ate - de < MENOR_TRECHO_SEC ? [] : [{ de, ate, fonte, indice }]
  })
  const usados = new Set<number>()
  let segundos = 0
  let resultado = [...trechos]
  // De tras para frente: fechar o vao de um trecho nao mexe nos que vem antes.
  for (const original of emOrdem(trechos).reverse()) {
    const x = resultado.find((y) => y.id === original.id)
    if (!x) continue
    let ficam: { de: number; ate: number }[] = [{ de: x.de, ate: x.ate }]
    for (const s of saem) {
      if (s.fonte !== fonteDo(x)) continue
      const novo: { de: number; ate: number }[] = []
      for (const p of ficam) {
        const a = Math.max(s.de, p.de)
        const b = Math.min(s.ate, p.ate)
        if (b - a < MENOR_TRECHO_SEC) {
          novo.push(p)
          continue
        }
        usados.add(s.indice)
        if (a - p.de >= MENOR_TRECHO_SEC) novo.push({ de: p.de, ate: a })
        if (p.ate - b >= MENOR_TRECHO_SEC) novo.push({ de: b, ate: p.ate })
      }
      ficam = novo
    }
    const sobrou = ficam.reduce((s, p) => s + (p.ate - p.de), 0)
    if (ficam.length === 1 && Math.abs(sobrou - duracaoDo(x)) < EPS) continue
    let em = x.em
    const pedacos = ficam.map((p, i) => {
      const t: TrechoDaGravacao = { ...x, id: i === 0 ? x.id : novoId(), de: p.de, ate: p.ate, em }
      em += p.ate - p.de
      return t
    })
    segundos += duracaoDo(x) - sobrou
    resultado = fecharBuraco([...resultado.filter((y) => y.id !== x.id), ...pedacos], em, fimDo(x))
  }
  return { trechos: emOrdem(resultado), cortados: usados.size, segundos }
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
