import { apelidosDoElenco, nomeDoPersonagem, partesDoNome } from '../../shared/apelidos'
import type { Cue, EpisodeIndex, Plano } from '../../shared/episodio'
import { cuesDoEvento, momentoDaFrase, type Evento, type Frase } from '../../shared/roteiro'
import { hashDoTexto, type TakeDaVoz } from '../../shared/voz'
import {
  CAMADAS_PADRAO,
  forcaDoDesvio,
  mediaEDesvio,
  normalizarTag,
  produtoInterno,
  tagEmPortugues,
  tagUtil,
  type CamadasDoCasar,
  type QuadroDaVisao,
  type SinaisDoCasar,
} from '../../shared/visao'
import {
  AVISO_LONGE_DO_MOMENTO,
  AVISO_TRECHO_SEM_CENAS,
  duracaoDaFrase,
  FITA_MAX,
  PORQUE_MAX,
  temposDasCenas,
  type CandidatoDeCena,
  type EscolhaDaFrase,
} from '../../shared/cenas'
import { FOLGA_SEM_EMENDA_SEC } from '../../shared/encaixe'
import {
  corteDaFrase,
  dividirFrase,
  idDoPedaco,
  type CorteDaFrase,
  type MotivoDaDivisao,
  type OpcoesDaDivisao,
} from '../../shared/divisao'

/**
 * O CASAR v0 (PLANO.md, "Escolha de cenas", F1): para cada frase do roteiro
 * aprovado, a fita de ate 6 cenas do episodio, cada uma com a nota e o porque,
 * e a primeira colocada. De graca: so o indice (planos, cues, falantes,
 * rostos), os eventos e o take. Nenhum tempo vem de LLM.
 *
 * Puro (nada de node:fs nem electron): roda igual no main e num teste, e pode
 * ir para shared/casar.ts quando o renderer (a IA editora da F3) precisar.
 *
 * As camadas, nesta ordem, e nenhuma desfaz a anterior:
 *   1. JANELA pela ancora: os eventos da frase dao [t0, t1]; a citacao (ou a
 *      cue do momento) da o instante. Sem as duas (roteiro antigo), a ancora
 *      sai das palavras: o evento cujo resumo mais bate e, nele, a fala que
 *      diz o que a frase pede ("estimada"). Candidatos = planos que cruzam
 *      [t0-8 s, t1+8 s]; com menos de 8, abre para +-20 s, depois para os
 *      eventos vizinhos, depois para mais longe. Frase sem evento herda a
 *      janela da vizinha (confianca baixa). Trecho que o indice nao cobre
 *      (nenhuma cena nele): a ancora vai para a cena mais perto, com aviso.
 *   2. EXCLUSOES duras: OP/ED/previa/manual (a parte do plano que encosta
 *      numa exclusao e cortada fora da janela; plano que fica quase todo
 *      dentro sai -- salvo plano com fala na borda de um VAO, que e da
 *      historia e so e aparado), plano < 0,6 s, plano com cue de placa
 *      (texto de tela em japones) e trecho ja mostrado por outra frase --
 *      este ultimo so volta quando nao ha alternativa nenhuma, com aviso.
 *      Plano LONGO (2x a frase) ja usado ainda serve no trecho livre.
 *   3. NOTA explicavel: cada termo vira um "porque" (o cartao mostra ate 4):
 *      perto do instante / dentro do evento, fala citada, personagem citado
 *      pelo rosto e/ou como falante (nome unido: "Senku" = "Ishigami,
 *      Senkuu"), so ele ou com extras, intencao visual (quem, paisagem, grupo,
 *      falando), o que a legenda do plano diz ("lua" -> "Moon"), cronologia e
 *      variedade. Personagem ausente penaliza, NUNCA veta: a precisao do
 *      reconhecimento ficou entre 0,27 e 0,45 no benchmark do motor.
 *   4. DURACAO: a da frase no take (duracaoDaFrase), senao a estimativa. Plano
 *      mais curto que a frase concorre de dois jeitos: sozinho (congela o fim)
 *      e num span com os planos SEGUINTES (a montagem original do episodio);
 *      o que faltar alem de 1,5 s penaliza.
 *   5. ATRIBUICAO em ordem, gulosa: cada frase leva a melhor da fita e o
 *      trecho dela sai das proximas (sem repeticao). A cronologia (seguir em
 *      frente), a continuidade e a variedade pesam pouco: so desempatam
 *      dentro da janela. Depois, a TROCA LOCAL: frase que pegou o plano do
 *      momento da seguinte tenta outra, e fica se a soma das duas melhorar.
 *   6. ATE 2 CENAS POR FRASE (18/10): a frase longa ou com dois momentos vira
 *      um item por pedaco (shared/divisao.ts decide e corta; casarFrases).
 */

// ------------------------------------------------------------------ pesos

/**
 * Os pesos, juntos, para ajustar contra o olho (o teste v-cenas-casar imprime
 * o top-3 de cada frase com os keyframes). Escala livre: a nota so compara
 * candidatos da MESMA frase.
 */
export const PESOS = {
  /** Plano que contem o instante da frase (citacao / cue do momento). Cai com a distancia. */
  centroForte: 26,
  /** Sem citacao nem cue do momento a ancora e so o comeco do evento: vale menos, e o evento inteiro mais. */
  centroFraco: 10,
  /** Ancora estimada pelas palavras da frase (ancoraPelasPalavras): entre a forte e a fraca. */
  centroEstimado: 18,
  /** Segundos em que o centro cai a ~37%. */
  quedaForte: 5,
  quedaEstimada: 8,
  quedaFraca: 20,
  /** Fracao do plano dentro do(s) evento(s) citado(s). */
  janelaForte: 14,
  janelaEstimada: 20,
  janelaFraca: 26,
  /** Janela herdada da frase vizinha: centro e janela valem esta fracao. */
  herdada: 0.6,
  citada: 30,
  /** Personagem citado no texto: rosto (x conf) e falante da legenda. */
  rosto: 20,
  /** Falante num plano sem rosto reconhecido: provavelmente e ele na tela. */
  falante: 13,
  /** Falante com OUTRO rosto reconhecido: plano de reacao (ou rosto errado). Vale menos. */
  falanteComOutroRosto: 8,
  rostoEFalante: 28,
  ausente: -10,
  pessoaTeto: 40,
  pessoaPiso: -20,
  /** Personagem so da intencao visual ("close no Senku"). */
  intencao: 8,
  intencaoAusente: -3,
  intencaoTeto: 16,
  /** Conceito da frase dito na legenda do plano ("lua" -> "Moon"). */
  palavra: 5,
  palavraTeto: 10,
  /** Sem citacao nem cue do momento, a fala do plano e o melhor sinal que sobra: vale mais. */
  palavraSemAncora: 10,
  palavraTetoSemAncora: 20,
  soEle: 10,
  extra: -3,
  extrasPiso: -9,
  falando: 5,
  paisagem: 8,
  /** Sem rosto, mas com alguem falando: pode ser paisagem com voz, ou gente sem rosto reconhecido. */
  paisagemComFala: 4,
  paisagemComRosto: -4,
  grupo: 6,
  emFrente: 5,
  volta: -10,
  continua: 4,
  /** O mesmo plano da frase anterior, em outro momento: corte seco dentro da mesma tomada. */
  mesmoPlano: -20,
  /** Outro trecho de um plano longo que outra frase ja mostra: o mesmo enquadramento duas vezes no short. */
  reuso: -12,
  repeteRosto: -6,
  /** Dois closes seguidos da mesma pessoa (uma pessoa so na tela). */
  repeteRostoSeguido: -4,
  /** Span que abre com um relance (< RELANCE_SEC) do primeiro plano. */
  relance: -6,
  cobre: 3,
  /** Por segundo que falta ate 1,5 s (o congelamento que o Dangai tolera). */
  congela: -2,
  /** Base + por segundo alem de 1,5 s. */
  curtaBase: -3,
  curtaPorSeg: -5,
  curtaPiso: -25,
  /** Por plano a mais no span. */
  emenda: -2,
  repetida: -30,
  // ---- lote 2 das ideias (C1-C4, C7). Escala da nota de sempre; ajustados contra o olho
  // (Nia Liston E01 e Dr. Stone S4-37, folhas em _capturas/ideias-lote2).
  /** C2: o plano se destaca no CLIP da `visualEn` (forca 0..1 pelo desvio, ver forcaDoDesvio). */
  imagem: 12,
  /** C1: as falas em volta do plano dizem o que a frase diz (forca 0..1 pelo desvio). */
  sentido: 6,
  /** C1 na ancora: uma fala muito parecida (forca 1) vale isto na conta da ancoraPelasPalavras (1 = basta). */
  sentidoNaAncora: 1.2,
  /** C3: etiquetas da frase no plano, pela confianca (posicao na lista) e pela raridade no episodio. */
  tags: 9,
  /** C4: frase que cita alguem, com candidatos bastantes com o rosto dele: plano sem o rosto vai para o fim. */
  semCitado: -22,
  /** C4: as duas pessoas citadas no mesmo plano. */
  juntos: 8,
  /** C4: frase com duas pessoas, plano so com a MESMA da frase anterior / com a outra. */
  alternaMesmo: -3,
  alternaOutro: 3,
  /** C7: todos os quadros da janela borrados ou apagados (transicao, nevoa, quadro escuro sem nada). */
  borrado: -10,
  /**
   * Com ancora FORTE (a fala do momento ou a citada, que o roteirista escolheu)
   * o que se ve so desempata: imagem, sentido e etiqueta valem esta fracao. O
   * plano vizinho parecido tirava a fala certa (Nia f08: a perna da criada no
   * lugar das armas escondidas).
   */
  vistoComAncoraForte: 0.15,
} as const

/** C4: com pelo menos tantos candidatos com o rosto citado, o rosto vira regra (os outros vao para o fim). */
const FORTE_MIN = 3
/** C1 sem evento ("Meu roteiro"): uma fala com este desvio vira a ancora da frase. */
const SENTIDO_ANCORA_SEM_EVENTO = 2.2
/** C1: segundos em volta do plano em que uma fala ainda e "dele" (com peso menor). */
const SENTIDO_PERTO_SEC = 2
/** C7: o trecho escolhido dentro do plano longo so sai do comeco quando ganha pelo menos isto (desvios). */
const MELHOR_TRECHO_GANHO = 0.6
/** C7: nitidez (log) este tanto de desvios abaixo da media do episodio... */
const BORRADO_DESVIO = -1.3
/** ...e a beleza este tanto abaixo: o quadro borrado ou apagado (nada para ver). */
const FEIO_DESVIO = -1.2

/** Plano mais curto que isto nunca e sugerido (pisca). */
export const PLANO_MIN_SEC = 0.6
/** Quantos planos, no maximo, um span emenda. */
export const SPAN_MAX = 3
/** Abaixo disto de candidatos (planos-base livres) a janela abre um nivel. */
const CANDIDATOS_MIN = 8
/** O que falta da frase que ainda passa como congelamento do ultimo quadro. */
const CONGELA_SEC = 1.5
/** Encostar menos que isto numa exclusao so apara a janela; mais (ou >30% do plano) tira o plano. */
const ENCOSTA_SEC = 0.35
/** Cue de placa que cobre mais que isto do plano: o plano mostra texto em japones. */
const PLACA_SEC = 0.3
/** Folga entre dois trechos do mesmo plano usados por frases diferentes. */
const MARGEM_DO_TRECHO_SEC = 1
/** Plano ja usado so serve a outra frase se tiver pelo menos este tanto de vezes a duracao dela. */
const PLANO_LONGO_FATOR = 2
/** Plano que abre escuro (sem ancora dentro): a janela pula ate este tanto do comeco, se sobrar. */
const ESCURO_PULA_SEC = 2.5
/** Pedaco do primeiro plano de um span mais curto que isto e um relance. */
const RELANCE_SEC = 1
/** A troca local so vale quando a soma das duas frases melhora pelo menos isto. */
const TROCA_MINIMA = 1

// ------------------------------------------------------------------- nomes

/**
 * Fichas que nao identificam ninguem sozinhas: "Dr. Xeno" nao pode casar com o
 * "Dr. Stone" do roteiro, nem "Why-Man A" com "Scientist A".
 */
const FICHAS_FRACAS = new Set([
  'dr', 'doctor', 'doutor', 'man', 'chan', 'kun', 'san', 'sama', 'senpai', 'sensei', 'scientist', 'cientista',
  'guy', 'the', 'of', 'and', 'mr', 'mrs', 'ms', 'miss', 'sir', 'lord', 'lady', 'king', 'queen', 'young', 'old',
  'little', 'big', 'boy', 'girl', 'woman', 'soldier', 'voice', 'narrator', 'narrador', 'all', 'todos',
  'crowd', 'multidao', 'kids', 'kid', 'villager', 'villagers', 'men', 'women', 'others', 'outros', 'unknown',
  'ele', 'ela', 'eles', 'elas', 'que', 'com', 'para', 'uma', 'mas', 'por', 'dos', 'das', 'nos', 'nas',
])

/** A vogal longa do romaji ("Senkuu" == "Senku", "Ukyou" == "Ukyo"): a mesma regra do nomes.ts. */
function semVogalLonga(f: string): string {
  return f.replace(/ou/g, 'o').replace(/uu/g, 'u').replace(/oo/g, 'o')
}

/** Sem acento, minusculas; hifen dentro do nome junta ("Why-Man" -> "whyman"). */
export function fichasDe(nome: string): string[] {
  return nome
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/([a-z0-9])-(?=[a-z0-9])/g, '$1')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(semVogalLonga)
}

/**
 * As fichas que identificam a pessoa (3+ letras, nao genericas). `proprios`:
 * as palavras fracas que NESTE episodio sao o nome de um rosto (o "Guy" do
 * Magic Repo Man), ver nomesPropriosFracos.
 */
export function fichasFortes(nome: string, proprios?: ReadonlySet<string>): string[] {
  return fichasDe(nome).filter((f) => f.length >= 3 && (!FICHAS_FRACAS.has(f) || !!proprios?.has(f)) && !/^\d+$/.test(f))
}

/**
 * Os rostos reconhecidos cujo nome INTEIRO e uma palavra fraca ("Guy", o rival
 * do Lent no Magic Repo Man): neste episodio a palavra e um nome, e "o Guy" no
 * roteiro e ele. Onde nenhum rosto tem esse nome, o rotulo continua generico
 * (o falante "Guy", figurante do Dr. Stone S4 - 37).
 */
export function nomesPropriosFracos(indice: Pick<EpisodeIndex, 'planos'>): Set<string> {
  const saida = new Set<string>()
  for (const p of indice.planos) {
    for (const x of p.personagens) {
      const f = fichasDe(x.nome)
      if (f.length === 1 && f[0]!.length >= 3 && FICHAS_FRACAS.has(f[0]!)) saida.add(f[0]!)
    }
  }
  return saida
}

/** Falas com rosto na tela que um falante precisa ter para virar apelido de um rosto. */
const APELIDO_FALAS_MIN = 8
/** Fracao dessas falas em que o rosto aparece no plano. */
const APELIDO_FRACAO_MIN = 0.6
/** Um rosto entra no elenco principal do episodio a partir de tantos planos. */
const ELENCO_PRINCIPAL_PLANOS_MIN = 3

/**
 * O APELIDO PELA LEGENDA (19/10), o complemento da sigla soletrada
 * (shared/apelidos.ts): o falante que nenhum rosto chama pelo nome e o rosto
 * que nenhum falante chama -- quando a fala dele cai quase sempre
 * (APELIDO_FRACAO_MIN) num plano com esse rosto, e a mesma pessoa, mesmo sem
 * a soletracao bater. No MRM E02, 93% das 151 falas da "MP" com rosto na tela
 * tem a "Empee". Medido no Dr. Stone S4-37 e no MRM E01: nenhum apelido falso
 * (o "Why-man-chan" tem 4 falas com rosto; os outros falantes ja tem rosto com
 * o nome deles).
 *
 * Devolve falante -> nome do rosto. So le o indice.
 */
export function apelidosPelaLegenda(indice: Pick<EpisodeIndex, 'planos' | 'cues'>): Map<string, string> {
  const contagem = new Map<string, number>()
  for (const p of indice.planos) for (const x of p.personagens) contagem.set(x.nome, (contagem.get(x.nome) ?? 0) + 1)
  const rostos = [...contagem.keys()].filter((n) => (contagem.get(n) ?? 0) >= ELENCO_PRINCIPAL_PLANOS_MIN)
  if (rostos.length === 0) return new Map()
  const fichasDoNome = (n: string): string[] => fichasDe(n).filter((f) => f.length >= 2)
  const mesmo = (a: string, b: string): boolean => mesmoNome(fichasDoNome(a), fichasDoNome(b))
  const planos = [...indice.planos].sort((a, b) => a.start - b.start)
  const planoEm = (t: number): Plano | undefined => {
    let lo = 0
    let hi = planos.length - 1
    while (lo <= hi) {
      const m = (lo + hi) >> 1
      const p = planos[m]!
      if (t < p.start) hi = m - 1
      else if (t >= p.end) lo = m + 1
      else return p
    }
    return undefined
  }
  // Por falante: quantas falas caem num plano com rosto, e com cada rosto.
  const porFalante = new Map<string, { comRosto: number; com: Map<string, number> }>()
  for (const c of indice.cues) {
    if (!c.falante || c.tipo !== 'fala') continue
    const p = planoEm((c.start + c.end) / 2)
    if (!p || p.personagens.length === 0) continue
    for (const f of falantesDe(c.falante)) {
      const e = porFalante.get(f) ?? { comRosto: 0, com: new Map<string, number>() }
      e.comRosto += 1
      for (const n of new Set(p.personagens.map((x) => x.nome))) e.com.set(n, (e.com.get(n) ?? 0) + 1)
      porFalante.set(f, e)
    }
  }
  const falantes = [...porFalante.keys()]
  // Rosto com falante de mesmo nome ja tem dono; falante com rosto de mesmo nome nao precisa de apelido.
  const livres = new Set(rostos.filter((r) => !falantes.some((f) => mesmo(f, r))))
  const saida = new Map<string, string>()
  const orfaos = falantes
    .filter((f) => !rostos.some((r) => mesmo(f, r)) && (porFalante.get(f)?.comRosto ?? 0) >= APELIDO_FALAS_MIN)
    .sort((a, b) => (porFalante.get(b)?.comRosto ?? 0) - (porFalante.get(a)?.comRosto ?? 0))
  for (const f of orfaos) {
    const e = porFalante.get(f)!
    const opcoes = [...e.com.entries()].filter(([n]) => livres.has(n)).sort((a, b) => b[1] - a[1])
    const [nome, n] = opcoes[0] ?? []
    if (!nome || n === undefined || n / e.comRosto < APELIDO_FRACAO_MIN) continue
    // O segundo rosto livre nao pode estar perto: a fala seria de qualquer um dos dois.
    if ((opcoes[1]?.[1] ?? 0) > n / 2) continue
    saida.set(f, nome)
    livres.delete(nome)
  }
  return saida
}

/** As pessoas que mais aparecem no episodio (pelo rosto), da que mais aparece para a que menos. */
export function elencoPrincipal(indice: Pick<EpisodeIndex, 'planos'>, maximo = 8): string[] {
  const contagem = new Map<string, number>()
  for (const p of indice.planos) for (const x of new Set(p.personagens.map((y) => y.nome))) contagem.set(x, (contagem.get(x) ?? 0) + 1)
  return [...contagem.entries()]
    .filter(([, n]) => n >= ELENCO_PRINCIPAL_PLANOS_MIN)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maximo)
    .map(([n]) => n)
}

/** A ficha do texto bate com a do nome: igual, ou comeco de uma longa ("whyman" em "whymanchan"). */
function bate(doTexto: string, doNome: string): boolean {
  return doTexto === doNome || (doTexto.length >= 5 && doNome.startsWith(doTexto))
}

/**
 * Os dois nomes sao a mesma pessoa: as fichas fortes do menor cabem no maior
 * ("Senku" em "Ishigami, Senkuu"; "Why-Man A" e "Why-Man D"). "Ishigami,
 * Byakuya" nao cabe em "Ishigami, Senkuu": pai e filho ficam separados.
 */
export function mesmoNome(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const [menor, maior] = a.length <= b.length ? [a, b] : [b, a]
  return menor.every((x) => maior.some((y) => bate(x, y) || bate(y, x)))
}

/** ASCII para o cartao ("François" -> "Francois"). */
function ascii(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '').replace(/[^\x20-\x7e]/g, '')
}

/** "Max; Carlos" sao dois falantes. A virgula fica: "Ishigami, Senkuu" e um nome so. */
export function falantesDe(nome: string): string[] {
  return nome
    .split(/;|\/|&|\s+e\s+|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Os APELIDOS do episodio (shared/apelidos.ts): "MP" e "MP<U+30FB>Yggdrasil" na
 * legenda sao o rosto "Empee" do reconhecimento. Os rostos sao o nome que
 * fica; os falantes (e os personagens dos eventos) se juntam a eles.
 */
export function apelidosDoIndice(
  indice: Pick<EpisodeIndex, 'planos' | 'cues'>,
  eventos: readonly Pick<Evento, 'personagens'>[] = [],
): Map<string, string> {
  const rostos = indice.planos.flatMap((p) => p.personagens.map((x) => x.nome))
  const outros = [
    ...indice.cues.flatMap((c) => (c.falante ? falantesDe(c.falante) : [])),
    ...indice.planos.flatMap((p) => p.falantes.flatMap(falantesDe)),
    ...eventos.flatMap((e) => e.personagens),
  ]
  const saida = apelidosDoElenco(rostos, outros)
  // (19/10) E quem a legenda diz: o falante que quase sempre fala no plano de um rosto (apelidosPelaLegenda).
  for (const [falante, rosto] of apelidosPelaLegenda(indice)) if (!saida.has(falante)) saida.set(falante, rosto)
  return saida
}

interface NomeDoPlano {
  nome: string
  fichas: string[]
  conf: number
}

/** O que o casar precisa de um plano, calculado uma vez por episodio. */
export interface PlanoDoCasar {
  plano: Plano
  /** Posicao no indice (planos consecutivos = posicoes seguidas). */
  pos: number
  /** A parte do plano fora das exclusoes. null = o plano esta em OP/ED/previa. */
  util: { de: number; ate: number } | null
  /** Por que o plano nunca e SUGERIDO (a grade ainda mostra os que tem `util`). */
  fora: 'exclusao' | 'curto' | 'placa' | null
  rostos: NomeDoPlano[]
  falas: NomeDoPlano[]
  /**
   * As pessoas na tela (fichas de cada uma), para a variedade: os rostos, ou
   * o falante unico quando nao ha rosto reconhecido. Vazio = nao se sabe.
   */
  gente: string[][]
  /** A `gente` veio de rosto reconhecido (e nao so de quem fala, que pode ser voz de fora). */
  genteDoRosto: boolean
  /** Alguem fala no plano (cue de fala que cruza mais de 0,2 s). */
  temFala: boolean
  /** As palavras das falas do plano (minusculas, sem acento), para a ponte PT -> EN. */
  palavrasDitas: string[]
}

/**
 * A parte do plano fora das exclusoes: aparada quando so encosta (corte de
 * plano e marca de OP raramente caem no mesmo quadro), null quando cai dentro.
 *
 * Exclusao achada pelo VAO de fala (origem 'vao') comeca no fim da ultima fala
 * e termina no comeco da primeira -- mas a musica e os creditos so entram no
 * CORTE seguinte. Plano com fala ali e da historia (no S4 - 37 o close do Senku
 * sorrindo, "This is exhilarating!", atravessa 0,85 s da ED): e aparado na
 * borda, nunca descartado.
 */
function parteUtil(
  p: Pick<Plano, 'start' | 'end'>,
  exclusoes: readonly { start: number; end: number; origem?: string }[],
  temFala: boolean,
): { de: number; ate: number } | null {
  let de = p.start
  let ate = p.end
  const dur = p.end - p.start
  for (const e of exclusoes) {
    const sobra = Math.min(ate, e.end) - Math.max(de, e.start)
    if (sobra <= 0) continue
    const daHistoria = temFala && e.origem === 'vao'
    if (!daHistoria && (sobra > ENCOSTA_SEC || sobra > dur * 0.3)) return null
    // Encosta (ou e borda de vao com fala): apara do lado em que a exclusao esta.
    if (e.start <= de) de = Math.max(de, e.end)
    else ate = Math.min(ate, e.start)
  }
  return ate - de > 0.05 ? { de, ate } : null
}

/** As pessoas distintas de uma lista de nomes (fichas), sem repetir a mesma pessoa. */
function pessoasDistintas(nomes: readonly NomeDoPlano[]): string[][] {
  const saida: string[][] = []
  for (const n of nomes) if (n.fichas.length > 0 && !saida.some((g) => mesmoNome(g, n.fichas))) saida.push(n.fichas)
  return saida
}

/** A mesma gente na tela (mesmas pessoas, nem mais nem menos). Vazio = nao se sabe. */
function mesmaGente(a: readonly string[][], b: readonly string[][]): boolean {
  return a.length > 0 && a.length === b.length && a.every((x) => b.some((y) => mesmoNome(x, y)))
}

/** Os planos do episodio com o que o casar usa: parte util, motivo de fora, rostos e falantes. */
export function prepararPlanos(indice: Pick<EpisodeIndex, 'planos' | 'cues' | 'exclusoes'>): PlanoDoCasar[] {
  const cuePorId = new Map(indice.cues.map((c) => [c.id, c]))
  const proprios = nomesPropriosFracos(indice)
  // A fala do "MP" e do rosto "Empee": as fichas do falante sao as do personagem.
  const apelidos = apelidosDoIndice(indice)
  return indice.planos.map((plano, pos) => {
    const temFala = plano.cueIds.some((id) => {
      const c = cuePorId.get(id)
      return c?.tipo === 'fala' && Math.min(c.end, plano.end) - Math.max(c.start, plano.start) > 0.2
    })
    const util = parteUtil(plano, indice.exclusoes, temFala)
    const temPlaca = plano.cueIds.some((id) => {
      const c = cuePorId.get(id)
      return c?.tipo === 'placa' && Math.min(c.end, plano.end) - Math.max(c.start, plano.start) > PLACA_SEC
    })
    const fora: PlanoDoCasar['fora'] = !util
      ? 'exclusao'
      : util.ate - util.de < PLANO_MIN_SEC
        ? 'curto'
        : temPlaca
          ? 'placa'
          : null
    const rostos = plano.personagens.map((x) => ({ nome: x.nome, fichas: fichasFortes(x.nome, proprios), conf: x.conf }))
    const falas = plano.falantes
      .flatMap(falantesDe)
      .map((nome) => ({ nome, fichas: fichasFortes(nomeDoPersonagem(nome, apelidos), proprios), conf: 1 }))
    // Quem esta na tela para a variedade: os rostos; sem rosto reconhecido, o
    // falante unico do plano (o close do Gen sem rosto reconhecido ainda e o Gen).
    // Figurante sem nome forte ("Scientist A") conta como mais uma pessoa: o
    // plano dos cientistas em volta do Gen nao e um close do Gen.
    const deRosto = pessoasDistintas(rostos)
    const deFala = pessoasDistintas(falas)
    const gente = deRosto.length > 0 ? deRosto : falas.length === 1 && deFala.length === 1 ? deFala : []
    // O nome de quem fala entra: "Scientist E" diz "cientista" mesmo sem a palavra na fala.
    const palavrasDitas = [
      ...new Set([...plano.cueIds.flatMap((id) => palavrasSimples(cuePorId.get(id)?.texto ?? '')), ...plano.falantes.flatMap(palavrasSimples)]),
    ]
    return { plano, pos, util, fora, rostos, falas, gente, genteDoRosto: deRosto.length > 0, temFala, palavrasDitas }
  })
}

/** Uma pessoa citada numa frase: a ficha e a palavra como esta no texto. */
export interface Citado {
  ficha: string
  /** A palavra do roteiro, ASCII ("Senku", "Why-Man"). */
  rotulo: string
}

/** Todas as fichas fortes que existem no episodio (rostos, falantes, eventos), e em quais nomes. */
export interface Elenco {
  /** ficha -> nomes crus que a contem. */
  nomesDaFicha: Map<string, Set<string>>
  /** As palavras fracas que sao nome de rosto neste episodio (nomesPropriosFracos). */
  proprios: ReadonlySet<string>
  /** Ficha de um apelido -> a ficha do personagem ("mp" e "yggdrasil" -> "empee"). */
  apelidos?: ReadonlyMap<string, string>
}

export function elencoDoEpisodio(planos: readonly PlanoDoCasar[], indice: Pick<EpisodeIndex, 'cues'>, eventos: readonly Pick<Evento, 'personagens'>[]): Elenco {
  const nomes = new Set<string>()
  for (const p of planos) {
    for (const r of p.rostos) nomes.add(r.nome)
    for (const f of p.falas) nomes.add(f.nome)
  }
  for (const c of indice.cues) if (c.falante) for (const f of falantesDe(c.falante)) nomes.add(f)
  for (const e of eventos) for (const n of e.personagens) nomes.add(n)
  // Os nomes de rosto que sao palavra fraca ("Guy"): as fichas dos rostos ja vem com eles.
  const proprios = new Set(planos.flatMap((p) => p.rostos.flatMap((r) => r.fichas.filter((f) => FICHAS_FRACAS.has(f)))))
  // O apelido vira o personagem: "MP" -> "Empee" (a sigla soletrada), "MP<U+30FB>Yggdrasil" tambem.
  const rostos = new Set(planos.flatMap((p) => p.rostos.map((r) => r.nome)))
  const apelidos = apelidosDoElenco(rostos, [...nomes].filter((n) => !rostos.has(n)))
  // (19/10) E o apelido pela legenda (a fala dele cai no plano do rosto), sem a soletracao bater.
  for (const [falante, rosto] of apelidosPelaLegenda({ planos: planos.map((p) => p.plano), cues: indice.cues })) {
    if (!apelidos.has(falante)) apelidos.set(falante, rosto)
  }
  const nomesDaFicha = new Map<string, Set<string>>()
  for (const nome of nomes) {
    const dono = nomeDoPersonagem(nome, apelidos)
    for (const f of fichasFortes(dono, proprios)) {
      const s = nomesDaFicha.get(f) ?? new Set<string>()
      s.add(dono)
      nomesDaFicha.set(f, s)
    }
  }
  // Cada palavra do apelido (ate a sigla curta "MP") aponta a ficha do personagem.
  const fichaDoApelido = new Map<string, string>()
  for (const [cru, dono] of apelidos) {
    const principal = fichasFortes(dono, proprios)[0]
    if (!principal) continue
    for (const parte of partesDoNome(cru)) {
      const f = fichasDe(parte)
      if (f.length === 1 && f[0] !== principal) fichaDoApelido.set(f[0]!, principal)
    }
  }
  return { nomesDaFicha, proprios, apelidos: fichaDoApelido }
}

/**
 * Quem o texto cita, pelo elenco do episodio: "o Senku" -> senku (bate com
 * "Ishigami, Senkuu" e com o falante "Senku"). Duas fichas do mesmo nome
 * ("Senku Ishigami" no texto) contam uma vez so -- sai a que serve a mais de
 * uma pessoa ("Ishigami" tambem e o Byakuya).
 */
export function citadosNoTexto(texto: string, elenco: Elenco): Citado[] {
  const palavras = texto.match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []
  const achados: Citado[] = []
  for (const palavra of palavras) {
    const fichas = fichasDe(palavra)
    if (fichas.length !== 1) continue
    // "a fadinha MP": o apelido vira a ficha do personagem ("empee").
    const f = elenco.apelidos?.get(fichas[0]!) ?? fichas[0]!
    if (f.length < 3 || (FICHAS_FRACAS.has(f) && !elenco.proprios.has(f))) continue
    const conhecida = elenco.nomesDaFicha.has(f) || [...elenco.nomesDaFicha.keys()].some((k) => bate(f, k))
    if (!conhecida || achados.some((a) => a.ficha === f)) continue
    achados.push({ ficha: f, rotulo: ascii(palavra) })
  }
  const nomesDe = (f: string): Set<string> => {
    const s = new Set<string>()
    for (const [k, nomes] of elenco.nomesDaFicha) if (bate(f, k)) for (const n of nomes) s.add(n)
    return s
  }
  // A ficha e de mais de uma pessoa ("Ishigami": Senku e Byakuya).
  const ambigua = (f: string): boolean => {
    const nomes = [...nomesDe(f)].map((n) => fichasFortes(n, elenco.proprios))
    return nomes.some((a, i) => nomes.some((b, j) => j > i && !mesmoNome(a, b)))
  }
  // Mesma pessoa citada por duas fichas ("Senku Ishigami"): as duas aparecem
  // juntas num nome. Sai a ambigua; nenhuma ambigua, sai a que veio depois.
  return achados.filter((a) =>
    !achados.some((b) => {
      if (b === a) return false
      const na = nomesDe(a.ficha)
      const nb = nomesDe(b.ficha)
      if (![...na].some((n) => nb.has(n))) return false
      const aa = ambigua(a.ficha)
      const ab = ambigua(b.ficha)
      return aa !== ab ? aa : achados.indexOf(a) > achados.indexOf(b)
    }),
  )
}

/** A pessoa esta no plano: pelo rosto (conf) e/ou como falante. */
function presenca(c: Citado, p: PlanoDoCasar): { rosto: number | null; fala: boolean } {
  const r = p.rostos.filter((x) => x.fichas.some((f) => bate(c.ficha, f)))
  const fala = p.falas.some((x) => x.fichas.some((f) => bate(c.ficha, f)))
  return { rosto: r.length > 0 ? Math.max(...r.map((x) => x.conf)) : null, fala }
}

// ---------------------------------------------------------- intencao visual

const PALAVRAS_PAISAGEM = new Set([
  'paisagem', 'cenario', 'cidade', 'cidades', 'horizonte', 'ceu', 'vista', 'panorama', 'predio', 'predios',
  'mundo', 'natureza', 'floresta', 'mar', 'oceano', 'espaco', 'lua', 'planeta', 'estrelas', 'noite',
  'reconstruido', 'reconstruida', 'construcao', 'construcoes', 'ruinas', 'mapa',
])
const PALAVRAS_GRUPO = new Set([
  'equipe', 'pessoal', 'todos', 'grupo', 'reunidos', 'reunida', 'reunido', 'cientistas', 'galera', 'turma',
  'aliados', 'lideres', 'dupla', 'juntos', 'multidao', 'festa', 'banquete',
])
const PALAVRAS_FALANDO = new Set([
  'falando', 'conversando', 'explicando', 'diz', 'dizendo', 'fala', 'responde', 'respondendo', 'discutindo',
  'gritando', 'grita', 'pergunta', 'perguntando', 'comenta', 'comentando', 'conversa', 'explica', 'anuncia',
  'anunciando', 'gesticulando', 'alerta', 'alertando', 'propoe', 'propondo',
])

/**
 * A PONTE entre o roteiro (PT) e a legenda (quase sempre EN): substantivos que
 * costumam ser DITOS quando aparecem ("All the way to the Moon" no plano da
 * lua). E a "descricao do plano" que o v0 tem, enquanto o juiz visual (F2) nao
 * ve a imagem. Mapa curto e FIXO de proposito: o TAGS_PT invertido trazia
 * "tempo" -> winter e "navio" -> knife. Cada lista ja traz as formas que a
 * legenda usa (plural, verbo).
 */
const PONTE_PT_EN: Readonly<Record<string, readonly string[]>> = {
  lua: ['moon', 'moons', 'lunar'],
  sol: ['sun', 'sunrise', 'sunset'],
  ceu: ['sky', 'skies'],
  estrela: ['star', 'stars'],
  estrelas: ['star', 'stars'],
  espaco: ['space', 'outer'],
  foguete: ['rocket', 'rockets'],
  nave: ['ship', 'spaceship', 'rocket', 'spacecraft'],
  espaconave: ['spaceship', 'rocket', 'spacecraft', 'ship'],
  planeta: ['planet', 'earth'],
  terra: ['earth', 'planet'],
  mundo: ['world'],
  cidade: ['city', 'town'],
  mar: ['sea', 'ocean'],
  oceano: ['ocean', 'sea'],
  navio: ['ship', 'boat', 'vessel'],
  barco: ['boat', 'ship'],
  aviao: ['plane', 'airplane', 'aircraft'],
  porto: ['port', 'harbor', 'dock'],
  ponte: ['bridge'],
  floresta: ['forest', 'woods', 'jungle'],
  montanha: ['mountain', 'mountains'],
  ilha: ['island'],
  laboratorio: ['lab', 'laboratory'],
  maquina: ['machine'],
  ciencia: ['science', 'scientific'],
  cientista: ['scientist', 'scientists'],
  cientistas: ['scientist', 'scientists'],
  frasco: ['bottle', 'flask', 'vial', 'bottles', 'flasks', 'vials'],
  fluido: ['fluid', 'formula'],
  pedra: ['stone', 'rock'],
  estatua: ['statue', 'statues'],
  estatuas: ['statue', 'statues'],
  petrificacao: ['petrification', 'petrified', 'petrify', 'stone'],
  petrificado: ['petrified', 'petrification', 'stone'],
  morte: ['death', 'dead', 'die', 'died', 'dying'],
  morto: ['dead', 'death', 'died'],
  vida: ['life', 'alive', 'living'],
  eterna: ['eternal', 'forever', 'immortal'],
  imortalidade: ['immortality', 'immortal', 'eternal'],
  casamento: ['wedding', 'married', 'marry', 'marriage'],
  festa: ['party', 'celebration', 'celebrate'],
  banquete: ['feast', 'banquet'],
  bolo: ['cake'],
  guerra: ['war'],
  arma: ['weapon', 'weapons', 'gun', 'guns'],
  fogo: ['fire', 'flames'],
  sangue: ['blood', 'bleeding'],
  mapa: ['map', 'roadmap'],
  segredo: ['secret'],
  passado: ['past'],
  ano: ['year', 'years'],
  anos: ['years', 'year'],
  futuro: ['future'],
  humanidade: ['humanity', 'mankind', 'humans', 'human'],
  dispositivo: ['device'],
  empresa: ['company', 'business'],
  feixe: ['beam', 'beams'],
  ataque: ['attack', 'attacks'],
  radio: ['radio'],
  comunicador: ['communicator', 'radio', 'transmitter'],
  sinal: ['signal', 'signals'],
  ouro: ['gold'],
  sopa: ['soup'],
  comida: ['food', 'eat', 'meal'],
}

function palavrasSimples(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Os conceitos da frase que a legenda poderia dizer: as palavras do roteiro e
 * da intencao que estao na ponte (com as formas em ingles) -- e a propria
 * palavra, para legenda em portugues.
 */
function conceitosDaFrase(palavras: readonly string[]): { pt: string; formas: Set<string> }[] {
  const vistos = new Set<string>()
  const saida: { pt: string; formas: Set<string> }[] = []
  for (const w of palavras) {
    const en = PONTE_PT_EN[w]
    if (!en || vistos.has(w)) continue
    vistos.add(w)
    saida.push({ pt: w, formas: new Set([w, ...en]) })
  }
  return saida
}

// --------------------------------------------------- o que se ve (lote 2)

/**
 * O que o lote 2 sabe do episodio, calculado uma vez: as falas perto de cada
 * plano (C1), a raridade de cada etiqueta (C3) e a qualidade de cada quadro
 * (C7). Sem sinal nenhum, tudo vazio e o casar fica como era.
 */
export interface VisaoDoEpisodio {
  camadas: CamadasDoCasar
  sinais: SinaisDoCasar
  /** C1: as falas perto de cada plano: peso 1 dentro, 0,6 ate SENTIDO_PERTO_SEC. */
  cuesPerto: Map<string, { id: string; peso: number }[]>
  /** C3: o idf de cada etiqueta, 0..1 (rara = 1). */
  idf: Map<string, number>
  /** C7: a qualidade (desvios de beleza + nitidez) e o borrado de cada quadro, por arquivo. */
  qualidade: Map<string, { q: number; borrado: boolean }>
  /** C7: os planos apagados (todos os quadros borrados e feios: nevoa, lustre no escuro). */
  apagados: Set<string>
}

export function prepararVisao(
  todos: readonly PlanoDoCasar[],
  indice: Pick<EpisodeIndex, 'cues'>,
  sinais: SinaisDoCasar = {},
  camadas: Partial<CamadasDoCasar> = {},
): VisaoDoEpisodio {
  const c: CamadasDoCasar = { ...CAMADAS_PADRAO, ...camadas }
  const cuesPerto = new Map<string, { id: string; peso: number }[]>()
  if (c.sentido && sinais.sentidoDaCue && sinais.sentidoDaCue.size > 0) {
    const cues = [...indice.cues].sort((a, b) => a.start - b.start)
    for (const p of todos) {
      const lista: { id: string; peso: number }[] = []
      for (const q of cues) {
        if (q.start > p.plano.end + SENTIDO_PERTO_SEC) break
        if (q.end < p.plano.start - SENTIDO_PERTO_SEC) continue
        const dentro = Math.min(q.end, p.plano.end) - Math.max(q.start, p.plano.start) > 0.1
        lista.push({ id: q.id, peso: dentro ? 1 : 0.6 })
      }
      if (lista.length > 0) cuesPerto.set(p.plano.id, lista)
    }
  }
  const idf = new Map<string, number>()
  if (c.tags && sinais.tagsDoPlano && sinais.tagsDoPlano.size > 0) {
    const df = new Map<string, number>()
    for (const tags of sinais.tagsDoPlano.values()) for (const t of new Set(tags.map(normalizarTag))) df.set(t, (df.get(t) ?? 0) + 1)
    const n = sinais.tagsDoPlano.size
    for (const [t, k] of df) idf.set(t, Math.log((n + 1) / (k + 1)) / Math.log(n + 1))
  }
  const qualidade = new Map<string, { q: number; borrado: boolean }>()
  if (c.melhorQuadro && sinais.quadros && sinais.quadros.size > 0) {
    const todosQ = [...sinais.quadros.values()].flat()
    const belezas = todosQ.flatMap((q) => (q.beleza === null ? [] : [q.beleza]))
    const nitidez = todosQ.flatMap((q) => (q.nitidez === null ? [] : [Math.log1p(q.nitidez)]))
    const b = mediaEDesvio(belezas)
    const n = mediaEDesvio(nitidez)
    for (const q of todosQ) {
      const zb = q.beleza === null ? 0 : (q.beleza - b.media) / b.desvio
      const zn = q.nitidez === null ? 0 : (Math.log1p(q.nitidez) - n.media) / n.desvio
      // Borrado de verdade = sem nitidez E feio: o CG liso (a Terra, o ceu do S4-37) tem pouca
      // nitidez mas boa nota de beleza; a nevoa e o lustre no escuro (Nia 0052) tem as duas baixas.
      qualidade.set(q.arquivo, {
        q: zb + 0.7 * Math.max(-2, Math.min(2, zn)),
        borrado: q.nitidez !== null && q.beleza !== null && zn < BORRADO_DESVIO && zb < FEIO_DESVIO,
      })
    }
  }
  const apagados = new Set<string>()
  for (const [id, qs] of sinais.quadros ?? []) if (qs.length > 0 && qs.every((q) => qualidade.get(q.arquivo)?.borrado)) apagados.add(id)
  return { camadas: c, sinais, cuesPerto, idf, qualidade, apagados }
}

/**
 * C7: a fala do momento dita sobre um plano APAGADO (o lustre no escuro do
 * Nia E01, 0052, com a voz do homem por cima): o momento vale para os planos
 * vizinhos tambem -- o centro vira o trecho dos apagados em volta da ancora.
 * null = o centro e o ponto, como antes.
 */
export function centroAmpliado(
  ponto: number | null,
  todos: readonly PlanoDoCasar[],
  v: VisaoDoEpisodio | null,
): Intervalo | null {
  if (ponto === null || !v || v.apagados.size === 0) return null
  const k = todos.findIndex((p) => ponto >= p.plano.start && ponto < p.plano.end)
  if (k < 0 || !v.apagados.has(todos[k]!.plano.id)) return null
  let a = k
  let b = k
  while (a > 0 && v.apagados.has(todos[a - 1]!.plano.id)) a--
  while (b + 1 < todos.length && v.apagados.has(todos[b + 1]!.plano.id)) b++
  return { de: todos[a]!.plano.start, ate: todos[b]!.plano.end }
}

/** O que a frase pede, medido em cada plano (forca 0..1). null = a camada nao tem sinal para esta frase. */
export interface SinaisDaFrase {
  imagem: Map<string, number> | null
  sentido: Map<string, number> | null
  /** cueId -> desvio do sentido da frase contra todas as falas (a ancora le). */
  zDaCue: Map<string, number> | null
  /** As etiquetas pedidas pela frase (normalizadas, sem as fracas). */
  tags: string[]
}

const SEM_SINAIS: SinaisDaFrase = { imagem: null, sentido: null, zDaCue: null, tags: [] }

export function sinaisDaFrase(fraseId: string, todos: readonly PlanoDoCasar[], v: VisaoDoEpisodio | null): SinaisDaFrase {
  if (!v) return SEM_SINAIS
  const { sinais, camadas } = v
  const validos = todos.filter((p) => p.util && !p.fora)
  let imagem: Map<string, number> | null = null
  const vi = camadas.imagem ? sinais.imagemDaFrase?.get(fraseId) : undefined
  if (vi && sinais.quadros) {
    const crus = new Map<string, number>()
    for (const p of validos) {
      const qs = sinais.quadros.get(p.plano.id)?.filter((q) => q.vetor) ?? []
      if (qs.length > 0) crus.set(p.plano.id, Math.max(...qs.map((q) => produtoInterno(vi, q.vetor!))))
    }
    if (crus.size >= 8) {
      const { media, desvio } = mediaEDesvio([...crus.values()])
      imagem = new Map([...crus].map(([id, x]) => [id, forcaDoDesvio((x - media) / desvio)]))
    }
  }
  let sentido: Map<string, number> | null = null
  let zDaCue: Map<string, number> | null = null
  const vs = camadas.sentido ? sinais.sentidoDaFrase?.get(fraseId) : undefined
  if (vs && sinais.sentidoDaCue && sinais.sentidoDaCue.size >= 8) {
    const crus = [...sinais.sentidoDaCue].map(([id, vc]) => [id, produtoInterno(vs, vc)] as const)
    const { media, desvio } = mediaEDesvio(crus.map(([, x]) => x))
    zDaCue = new Map(crus.map(([id, x]) => [id, (x - media) / desvio]))
    sentido = new Map()
    for (const p of validos) {
      const perto = v.cuesPerto.get(p.plano.id)
      if (!perto) continue
      const f = Math.max(...perto.map((c) => forcaDoDesvio(zDaCue!.get(c.id) ?? -9) * c.peso))
      if (f > 0) sentido.set(p.plano.id, f)
    }
  }
  const tags = camadas.tags && v.idf.size > 0 ? [...new Set((sinais.tagsDaFrase?.get(fraseId) ?? []).map(normalizarTag))].filter(tagUtil) : []
  return { imagem, sentido, zDaCue, tags }
}

/**
 * C3: as etiquetas da frase no plano. Cada uma vale pela confianca (a posicao
 * na lista do WD-Tagger, das 20 mais confiantes: a 1a vale 1, a 20a 0,5) vezes
 * a raridade no episodio (idf): "1girl" em toda cena nao diz nada.
 */
function tagsNoPlano(p: PlanoDoCasar, pedidas: readonly string[], v: VisaoDoEpisodio): { forca: number; melhor: string | null } {
  const doPlano = v.sinais.tagsDoPlano?.get(p.plano.id)
  if (!doPlano || pedidas.length === 0) return { forca: 0, melhor: null }
  const lista = doPlano.map(normalizarTag)
  let soma = 0
  let melhor: string | null = null
  let maior = 0
  for (const t of pedidas) {
    const r = lista.indexOf(t)
    if (r < 0) continue
    const x = (1 - (0.5 * r) / 20) * (v.idf.get(t) ?? 0)
    soma += x
    if (x > maior) {
      maior = x
      melhor = t
    }
  }
  return { forca: Math.min(1, soma / 0.8), melhor }
}

/** C7: os quadros do plano que caem em [de, ate] (segundos do .mkv). */
function quadrosNaJanela(p: PlanoDoCasar, de: number, ate: number, v: VisaoDoEpisodio | null): QuadroDaVisao[] {
  const qs = v?.sinais.quadros?.get(p.plano.id) ?? []
  const dur = p.plano.end - p.plano.start
  return qs.filter((q) => {
    const t = p.plano.start + q.pos * dur
    return t >= de - 0.05 && t <= ate + 0.05
  })
}

/** C7: o quadro mais bonito e nitido da janela (a miniatura do candidato). null = sem medida. */
function melhorQuadroDaJanela(planos: readonly PlanoDoCasar[], inSec: number, fim: number, v: VisaoDoEpisodio | null): string | null {
  if (!v || v.qualidade.size === 0) return null
  let melhor: string | null = null
  let maior = -Infinity
  for (const p of planos) {
    for (const q of quadrosNaJanela(p, inSec, fim, v)) {
      const x = v.qualidade.get(q.arquivo)
      if (x && x.q > maior) {
        maior = x.q
        melhor = q.arquivo
      }
    }
  }
  return melhor
}

// ------------------------------------------------------------------- janela

export interface Intervalo {
  de: number
  ate: number
}

/** De que pedaco do episodio a frase fala. */
export interface JanelaDaFrase {
  /** [t0, t1] de cada evento citado que existe. Vazio = sem evento (nem herdado). */
  intervalos: Intervalo[]
  /** O instante da frase: meio da citacao / cue do momento / primeira cue do evento. */
  ancora: number | null
  /** A cue da ancora, para a janela comecar no instante em que ela e dita. */
  cueAncora: Pick<Cue, 'id' | 'start' | 'end'> | null
  /** A ancora veio da citacao ou da cue do momento (e nao do comeco do evento). */
  forte: boolean
  /**
   * Sem citacao nem cue do momento (roteiro de antes do campo), a ancora saiu
   * das PALAVRAS: o evento cujo resumo mais bate com a frase e, nele, a fala
   * que diz o que a frase pede ("lua" -> "Moon"). Vale entre a forte e a fraca.
   */
  estimada: boolean
  /**
   * Nenhuma cena do indice cruza o trecho (o Corte Cenas do S4 - 37 so cobre de
   * 1:28 a 22:30): a ancora vira o ponto mais perto do trecho que TEM cena.
   */
  semCenas: boolean
  /** Ids dos eventos que deram a janela. */
  eventoIds: string[]
  /** A frase nao cita evento: a janela e da frase vizinha. */
  herdada: boolean
}

const SEM_JANELA: JanelaDaFrase = {
  intervalos: [],
  ancora: null,
  cueAncora: null,
  forte: false,
  estimada: false,
  semCenas: false,
  eventoIds: [],
  herdada: false,
}

/** Palavras que nao dizem de que momento a frase fala (a conta da ancora pelas palavras). */
const PALAVRAS_VAZIAS = new Set([
  'que', 'com', 'para', 'pra', 'uma', 'umas', 'uns', 'mas', 'por', 'dos', 'das', 'nos', 'nas', 'ele', 'ela', 'eles',
  'elas', 'seu', 'sua', 'seus', 'suas', 'num', 'numa', 'pelo', 'pela', 'pelos', 'pelas', 'ate', 'sem', 'sao', 'foi',
  'era', 'tem', 'ter', 'vai', 'vao', 'ser', 'esta', 'este', 'isso', 'isto', 'esse', 'essa', 'como', 'mais', 'muito',
  'quando', 'onde', 'entao', 'tambem', 'ainda', 'depois', 'antes', 'agora', 'todo', 'toda', 'todos', 'todas', 'outro',
  'outra', 'cada', 'qual', 'quem', 'porque', 'sobre', 'entre', 'desde', 'apos', 'mesmo', 'mesma', 'nao', 'sim', 'dele',
  'dela', 'deles', 'delas', 'lhe', 'lhes', 'nem', 'pois', 'logo', 'bem', 'tudo', 'nada', 'aqui', 'ali', 'lado',
  'the', 'and', 'you', 'that', 'this', 'with', 'for', 'are', 'was', 'have', 'what', 'just', 'not', 'but',
])

/** As fichas de conteudo de um texto (sem acento, hifen junto, 3+ letras, sem palavra vazia). */
function fichasDeConteudo(texto: string): string[] {
  return [...new Set(fichasDe(texto).filter((f) => f.length >= 3 && !PALAVRAS_VAZIAS.has(f) && !/^\d+$/.test(f)))]
}

/** Quantas fichas de `a` batem com alguma de `b` ("eterna" com "eternamente"). */
function emComum(a: readonly string[], b: readonly string[]): number {
  return a.filter((x) => b.some((y) => bate(x, y) || bate(y, x))).length
}

/**
 * A ancora pelas palavras, para frase sem citacao nem cue do momento: o evento
 * citado cujo resumo (e personagens) mais tem em comum com a frase e a
 * intencao; nele, a fala que diz os conceitos da frase (ponte PT -> EN), cita
 * quem a frase cita ou repete as palavras dela (legenda em PT). Empate fica com
 * o primeiro evento e a primeira fala. null = nenhuma fala diz nada da frase.
 */
function ancoraPelasPalavras(
  frase: Pick<Frase, 'texto' | 'intencaoVisual'>,
  citados: readonly Evento[],
  indice: Pick<EpisodeIndex, 'cues' | 'exclusoes'>,
  elenco: Elenco | null,
  zDaCue: ReadonlyMap<string, number> | null = null,
): { evento: Evento; cue: Cue | null } {
  const textoTodo = `${frase.texto} ${frase.intencaoVisual}`
  const daFrase = fichasDeConteudo(textoTodo)
  // C1: a fala que diz o que a frase diz (o sentido, PT x EN) soma ate PESOS.sentidoNaAncora.
  const sentidoDa = (c: Pick<Cue, 'id'>): number => (zDaCue ? PESOS.sentidoNaAncora * forcaDoDesvio(zDaCue.get(c.id) ?? -9) : 0)
  let evento = citados[0]!
  let melhor = -1
  for (const e of citados) {
    // O sentido so desempata (vale menos que uma palavra em comum).
    const sentido = zDaCue ? 0.9 * Math.max(0, ...cuesDoEvento(e, indice).map(sentidoDa)) / PESOS.sentidoNaAncora : 0
    const n = emComum(daFrase, fichasDeConteudo(`${e.resumo} ${e.personagens.join(' ')}`)) + sentido
    if (n > melhor) {
      melhor = n
      evento = e
    }
  }
  // O conceito que a INTENCAO tambem pede (o que a tela mostra) vale mais;
  // nome dito e palavra repetida valem meio: "We should thank Whyman" cita
  // quem a frase cita, mas "All the way to the Moon" e a Lua que ela pede.
  const conceitos = conceitosDaFrase(palavrasSimples(textoTodo))
  const naIntencao = new Set(conceitosDaFrase(palavrasSimples(frase.intencaoVisual)).map((k) => k.pt))
  const pessoas = elenco ? citadosNoTexto(frase.texto, elenco) : []
  // O nome ja conta como pessoa: fora da conta das palavras repetidas.
  const semNomes = daFrase.filter((w) => !pessoas.some((p) => bate(p.ficha, w) || bate(w, p.ficha)))
  let cue: Cue | null = null
  let nota = 0
  for (const c of cuesDoEvento(evento, indice)) {
    const ditas = new Set(palavrasSimples(c.texto))
    const fichas = fichasDe(`${c.texto} ${c.falante ?? ''}`)
    const n =
      conceitos.reduce((s, k) => s + ([...k.formas].some((f) => ditas.has(f)) ? (naIntencao.has(k.pt) ? 1.5 : 1) : 0), 0) +
      0.5 * pessoas.filter((p) => fichas.some((f) => bate(p.ficha, f))).length +
      0.5 * Math.min(2, emComum(semNomes, fichasDeConteudo(c.texto))) +
      sentidoDa(c)
    if (n > nota) {
      nota = n
      cue = c
    }
  }
  // So um nome dito nao basta para dizer o instante.
  return { evento, cue: nota >= 1 ? cue : null }
}

function janelaPropria(
  frase: Pick<Frase, 'eventoIds' | 'citacaoCueId' | 'cueDoMomento'> & Partial<Pick<Frase, 'texto' | 'intencaoVisual'>>,
  eventos: readonly Evento[],
  indice: Pick<EpisodeIndex, 'cues' | 'planos' | 'exclusoes'>,
  planos: readonly PlanoDoCasar[],
  elenco: Elenco | null,
  zDaCue: ReadonlyMap<string, number> | null = null,
): JanelaDaFrase | null {
  const porId = new Map(eventos.map((e) => [e.id, e]))
  const citados = frase.eventoIds.map((id) => porId.get(id)).filter((e): e is Evento => e !== undefined)
  if (citados.length === 0) return zDaCue ? janelaPeloSentido(zDaCue, indice, planos) : null
  const m = momentoDaFrase(frase, eventos, indice)
  const cuePorId = new Map(indice.cues.map((c) => [c.id, c]))
  let cue = m ? (cuePorId.get(m.cueId) ?? null) : null
  let ancora = m?.t ?? null
  const forte = !!cue && (cue.id === frase.citacaoCueId || cue.id === frase.cueDoMomento)
  let estimada = false
  if (!forte && frase.texto !== undefined) {
    const achada = ancoraPelasPalavras({ texto: frase.texto, intencaoVisual: frase.intencaoVisual ?? '' }, citados, indice, elenco, zDaCue)
    if (achada.cue) {
      cue = achada.cue
      ancora = (achada.cue.start + achada.cue.end) / 2
      estimada = true
    } else {
      // Nenhuma fala diz nada da frase: fica o comeco do evento que mais bate.
      const primeira = cuesDoEvento(achada.evento, indice)[0]
      if (primeira) {
        cue = primeira
        ancora = (primeira.start + primeira.end) / 2
      }
    }
  }
  const intervalos = citados.map((e) => {
    // O trecho das cues de verdade (o t0/t1 gravado e o mesmo; a conta protege evento antigo).
    const cues = cuesDoEvento(e, indice)
    const de = cues.length > 0 ? Math.min(...cues.map((c) => c.start)) : e.t0
    const ate = cues.length > 0 ? Math.max(...cues.map((c) => c.end)) : e.t1
    return { de: Math.min(de, e.t0), ate: Math.max(ate, e.t1) }
  })
  const base: JanelaDaFrase = {
    intervalos,
    ancora: ancora ?? intervalos[0]!.de,
    cueAncora: cue ? { id: cue.id, start: cue.start, end: cue.end } : null,
    forte,
    estimada,
    semCenas: false,
    eventoIds: citados.map((e) => e.id),
    herdada: false,
  }
  return comCenasPerto(base, planos)
}

/**
 * C1 sem evento (frase de ligacao, "Meu roteiro"): a fala do episodio que diz
 * o que a frase diz, se ela se destaca muito (SENTIDO_ANCORA_SEM_EVENTO
 * desvios), vira a ancora -- estimada, nunca forte. null = herda a vizinha,
 * como antes.
 */
function janelaPeloSentido(
  zDaCue: ReadonlyMap<string, number>,
  indice: Pick<EpisodeIndex, 'cues' | 'exclusoes'>,
  planos: readonly PlanoDoCasar[],
): JanelaDaFrase | null {
  let melhor: Cue | null = null
  let maior = SENTIDO_ANCORA_SEM_EVENTO
  for (const c of indice.cues) {
    if (c.tipo !== 'fala') continue
    if (indice.exclusoes.some((e) => c.start < e.end && c.end > e.start)) continue
    const z = zDaCue.get(c.id) ?? -9
    if (z > maior) {
      maior = z
      melhor = c
    }
  }
  if (!melhor) return null
  const base: JanelaDaFrase = {
    intervalos: [{ de: melhor.start - 8, ate: melhor.end + 8 }],
    ancora: (melhor.start + melhor.end) / 2,
    cueAncora: { id: melhor.id, start: melhor.start, end: melhor.end },
    forte: false,
    estimada: true,
    semCenas: false,
    eventoIds: [],
    herdada: false,
  }
  return comCenasPerto(base, planos)
}

/**
 * O indice nao tem cena nenhuma no trecho: a ancora vai para o ponto mais
 * perto que tem cena (o fim do corte, quando o trecho e o epilogo).
 */
function comCenasPerto(base: JanelaDaFrase, planos: readonly PlanoDoCasar[]): JanelaDaFrase {
  const perto = base.intervalos.map((i) => ({ de: i.de - 8, ate: i.ate + 8 }))
  if (planos.length > 0 && !planos.some((p) => p.util && cruza(p.plano, perto))) {
    const t = base.ancora!
    let melhor: number | null = null
    let menor = Infinity
    for (const p of planos) {
      if (!p.util || p.fora) continue
      const ponto = Math.min(Math.max(t, p.util.de), p.util.ate)
      const d = Math.abs(ponto - t)
      if (d < menor) {
        menor = d
        melhor = ponto
      }
    }
    if (melhor !== null) return { ...base, ancora: melhor, cueAncora: null, forte: false, estimada: false, semCenas: true }
  }
  return base
}

/**
 * A janela de cada frase, na ordem. Frase sem evento herda a da vizinha (a de
 * antes; na primeira, a de depois), marcada como herdada.
 */
export function janelasDasFrases(
  frases: readonly (Pick<Frase, 'id' | 'eventoIds' | 'citacaoCueId' | 'cueDoMomento'> & Partial<Pick<Frase, 'texto' | 'intencaoVisual'>>)[],
  eventos: readonly Evento[],
  indice: Pick<EpisodeIndex, 'cues' | 'planos' | 'exclusoes'>,
  planos: readonly PlanoDoCasar[] = prepararPlanos(indice),
  /** C1: o desvio do sentido de cada fala para a frase (fraseId). Ausente = so as palavras, como antes. */
  zDasCues: (fraseId: string) => ReadonlyMap<string, number> | null = () => null,
): JanelaDaFrase[] {
  const elenco = elencoDoEpisodio(planos, indice, eventos)
  const proprias = frases.map((f) => janelaPropria(f, eventos, indice, planos, elenco, zDasCues(f.id)))
  return proprias.map((j, i) => {
    if (j) return j
    for (let d = 1; d < frases.length; d++) {
      const viz = proprias[i - d] ?? proprias[i + d]
      if (viz) return { ...viz, herdada: true }
    }
    return SEM_JANELA
  })
}

/**
 * Os niveis de abertura da janela: +-8 s do evento, +-20 s, + os eventos
 * vizinhos, +-60 s, +-180 s e o episodio inteiro.
 */
function niveisDaJanela(j: JanelaDaFrase, eventos: readonly Evento[]): Intervalo[][] {
  const tudo: Intervalo[] = [{ de: -Infinity, ate: Infinity }]
  if (j.intervalos.length === 0) return [tudo]
  const abrir = (folga: number, base: readonly Intervalo[] = j.intervalos): Intervalo[] =>
    base.map((i) => ({ de: i.de - folga, ate: i.ate + folga }))
  const ordem = [...eventos].sort((a, b) => a.t0 - b.t0)
  const vizinhos: Intervalo[] = []
  for (const id of j.eventoIds) {
    const k = ordem.findIndex((e) => e.id === id)
    for (const v of [ordem[k - 1], ordem[k + 1]]) if (v) vizinhos.push({ de: v.t0, ate: v.t1 })
  }
  return [abrir(8), abrir(20), [...abrir(20), ...abrir(8, vizinhos)], abrir(60), abrir(180), tudo]
}

function cruza(p: Pick<Plano, 'start' | 'end'>, intervalos: readonly Intervalo[]): boolean {
  return intervalos.some((i) => p.end > i.de && p.start < i.ate)
}

function distancia(de: number, ate: number, t: number): number {
  return t < de ? de - t : t > ate ? t - ate : 0
}

// -------------------------------------------------------------- candidatos

/** Um termo da nota: o valor e o rotulo curto que pode ir para o "porque". */
export interface Termo {
  chave: string
  valor: number
  rotulo: string
}

export interface CandidatoPontuado {
  candidato: CandidatoDeCena
  planos: PlanoDoCasar[]
  termos: Termo[]
  /** Usa plano de outra frase (so quando nao havia alternativa). */
  repetido: boolean
  /** O que falta da frase depois do fim da janela (s). 0 = cobre. */
  falta: number
}

/** O que a frase sabe na hora de pontuar. */
interface ContextoDaFrase {
  frase: Pick<Frase, 'id' | 'texto' | 'intencaoVisual' | 'citacaoCueId'>
  janela: JanelaDaFrase
  /** Segundos que a frase dura (take ou estimativa). */
  duracao: number
  citados: Citado[]
  /** Pessoas da intencao visual que o texto nao citou. */
  daIntencao: Citado[]
  pedePaisagem: boolean
  pedeGrupo: boolean
  pedeFala: boolean
  /** Conceitos da frase e da intencao, com as formas que a legenda usaria (PONTE_PT_EN + o proprio PT). */
  conceitos: { pt: string; formas: Set<string> }[]
  /** As cenas escolhidas das frases anteriores (a ultima por ultimo). */
  anteriores: CenaAnterior[]
  cueCitada: Pick<Cue, 'start' | 'end'> | null
  /** Planos cujo primeiro quadro e escuro (keyframe _0): a janela comeca mais tarde se sobrar plano. */
  abremEscuro: ReadonlySet<string>
  /** Lote 2: o que se ve do episodio (null = nada medido) e o que a frase pede nos planos. */
  visao: VisaoDoEpisodio | null
  sinais: SinaisDaFrase
  /** C7: o centro ampliado quando a ancora cai num plano apagado (centroAmpliado). null = o ponto. */
  centro: Intervalo | null
}

/** O que a frase de antes mostrou: a cronologia, a continuidade e a variedade olham. */
interface CenaAnterior {
  planoIds: string[]
  inSec: number
  /** Onde a imagem da frase acaba de verdade: inSec + a duracao da frase (ou o fim da janela). */
  fimReal: number
  ultimoPos: number
  /** A imagem foi ate o fim do ultimo plano: o plano seguinte e o corte original do episodio. */
  chegouAoFim: boolean
  gente: string[][]
  genteDoRosto: boolean
}

interface JanelaMontada {
  planos: PlanoDoCasar[]
  inSec: number
  outSec: number
}

/**
 * As partes de `util` fora dos trechos ja mostrados por outras frases (com
 * MARGEM_DO_TRECHO_SEC de cada lado: dois trechos colados do mesmo plano
 * viram um corte seco no meio da mesma tomada).
 */
function partesLivres(util: Intervalo, usados: readonly Intervalo[]): Intervalo[] {
  let partes: Intervalo[] = [{ de: util.de, ate: util.ate }]
  for (const u of usados) {
    const a = u.de - MARGEM_DO_TRECHO_SEC
    const b = u.ate + MARGEM_DO_TRECHO_SEC
    partes = partes.flatMap((x) => {
      if (b <= x.de || a >= x.ate) return [x]
      const resto: Intervalo[] = []
      if (a > x.de) resto.push({ de: x.de, ate: a })
      if (b < x.ate) resto.push({ de: b, ate: x.ate })
      return resto
    })
  }
  return partes
}

/**
 * Onde, no plano `p`, a frase ainda pode ficar: o plano inteiro se ninguem
 * usou; plano LONGO (PLANO_LONGO_FATOR vezes a frase) ja usado por outra
 * frase, as partes livres que cabem a frase inteira (a tomada de 27 s do
 * S4 - 37 serve a duas frases, cada uma no seu momento); senao nada.
 */
function partesParaAFrase(p: PlanoDoCasar, ocupacao: Ocupacao, d: number): { seg: Intervalo; inteiro: boolean }[] {
  const util = p.util!
  const usados = ocupacao.get(p.plano.id)
  if (!usados || usados.length === 0) return [{ seg: util, inteiro: true }]
  if (util.ate - util.de < PLANO_LONGO_FATOR * d) return []
  return partesLivres(util, usados)
    .filter((x) => x.ate - x.de >= d)
    .map((seg) => ({ seg, inteiro: false }))
}

/**
 * Os candidatos que comecam no plano `p`, dentro da parte `seg` dele. Parte
 * que cobre a frase: um so, com a janela comecando na fala da ancora se ela
 * cai dentro (plano que abre escuro e nao tem ancora: um pouco depois do
 * escuro). Plano mais curto: o span com os planos SEGUINTES enquanto a frase
 * nao couber (ate SPAN_MAX) E o plano sozinho -- congelar meio segundo num
 * plano certo e melhor que emendar um errado; a nota decide. Parte de plano
 * dividido com outra frase nunca emenda.
 */
function montarJanelas(
  p: PlanoDoCasar,
  seg: Intervalo,
  inteiro: boolean,
  todos: readonly PlanoDoCasar[],
  ctx: ContextoDaFrase,
  livre: (q: PlanoDoCasar) => boolean,
): JanelaMontada[] {
  const util = seg
  const d = ctx.duracao
  const cue = ctx.janela.cueAncora
  const ancoraDentro = cue !== null && cue.start > util.de + 0.3 && cue.start < util.ate - 0.3 ? cue.start - 0.15 : null
  if (util.ate - util.de >= d) {
    const sobra = util.ate - util.de - d
    const escuro = ancoraDentro === null && util.de <= p.plano.start + 0.05 && ctx.abremEscuro.has(p.plano.id)
    const inSec =
      ancoraDentro !== null
        ? Math.max(util.de, Math.min(ancoraDentro, util.ate - d))
        : escuro
          ? util.de + Math.min(sobra, ESCURO_PULA_SEC)
          : melhorComeco(p, util, d, ctx.visao)
    return [{ planos: [p], inSec, outSec: util.ate }]
  }
  if (!inteiro) return []
  const planos = [p]
  let fim = util.ate
  while (fim - util.de < d - 0.05 && planos.length < SPAN_MAX) {
    const ult = planos[planos.length - 1]!
    const prox = todos[ult.pos + 1]
    if (!prox || !prox.util || prox.fora || !livre(prox)) break
    // Emenda so o que e continuo no episodio: nada aparado entre os dois.
    if (ult.util!.ate < ult.plano.end - 0.01 || prox.util.de > prox.plano.start + 0.01) break
    if (prox.plano.start - ult.plano.end > 0.1) break
    planos.push(prox)
    fim = prox.util.ate
  }
  const span = { planos, inSec: util.de, outSec: fim }
  return planos.length > 1 ? [span, { planos: [p], inSec: util.de, outSec: util.ate }] : [span]
}

/**
 * C7: o comeco do trecho num plano que sobra (sem ancora dentro). Os
 * candidatos sao o comeco do plano (a montagem original) e cada keyframe um
 * pouco antes do meio da janela; vale o de quadros mais bonitos e nitidos,
 * fugindo de quadro borrado (transicao, movimento). Sair do comeco exige
 * ganhar MELHOR_TRECHO_GANHO: na duvida, fica o corte original.
 */
function melhorComeco(p: PlanoDoCasar, util: Intervalo, d: number, v: VisaoDoEpisodio | null): number {
  if (!v || v.qualidade.size === 0 || util.ate - util.de - d < 0.8) return util.de
  const qs = v.sinais.quadros?.get(p.plano.id) ?? []
  if (qs.length === 0) return util.de
  const dur = p.plano.end - p.plano.start
  const nota = (inSec: number): number | null => {
    const dentro = quadrosNaJanela(p, inSec, inSec + d, v).flatMap((q) => {
      const x = v.qualidade.get(q.arquivo)
      return x ? [x] : []
    })
    if (dentro.length === 0) return null
    return dentro.reduce((s, x) => s + x.q, 0) / dentro.length - (dentro.some((x) => x.borrado) ? 1.5 : 0)
  }
  let melhor = util.de
  let maior = -Infinity
  for (const q of qs) {
    const t = p.plano.start + q.pos * dur
    const inSec = Math.max(util.de, Math.min(t - 0.3 * d, util.ate - d))
    const x = nota(inSec)
    if (x !== null && x > maior) {
      maior = x
      melhor = inSec
    }
  }
  const doComeco = nota(util.de)
  return doComeco !== null && maior < doComeco + MELHOR_TRECHO_GANHO ? util.de : melhor
}

/** Os trechos ja mostrados de cada plano, por id (segundos do .mkv). */
type Ocupacao = Map<string, Intervalo[]>

/** Marca o trecho que a cena mostra de verdade em cada plano dela. */
function ocupar(ocupacao: Ocupacao, c: Pick<CandidatoDeCena, 'planoIds' | 'inSec' | 'outSec'>, duracao: number): void {
  const trecho = { de: c.inSec, ate: Math.max(c.inSec + 0.05, Math.min(c.outSec, c.inSec + duracao)) }
  for (const id of c.planoIds) ocupacao.set(id, [...(ocupacao.get(id) ?? []), trecho])
}

/** A janela cruza um trecho ja mostrado (com a margem) num dos planos dela. */
function sobrepoe(ocupacao: Ocupacao, planoIds: readonly string[], de: number, ate: number): boolean {
  return planoIds.some((id) => (ocupacao.get(id) ?? []).some((u) => ate > u.de - MARGEM_DO_TRECHO_SEC + 1e-6 && de < u.ate + MARGEM_DO_TRECHO_SEC - 1e-6))
}

function pontuar(
  planos: PlanoDoCasar[],
  inSec: number,
  outSec: number,
  ctx: ContextoDaFrase,
  repetido: boolean,
  reusado = false,
): { termos: Termo[]; falta: number } {
  const termos: Termo[] = []
  const add = (chave: string, valor: number, rotulo: string): void => {
    if (Math.abs(valor) >= 0.05) termos.push({ chave, valor, rotulo })
  }
  const j = ctx.janela
  const primeiro = planos[0]!
  const ultimo = planos[planos.length - 1]!
  const de = primeiro.plano.start
  const ate = ultimo.plano.end
  const fator = j.herdada ? PESOS.herdada : 1
  // O que a tela mostra de fato: da entrada ate a duracao da frase.
  const fimReal = Math.min(outSec, inSec + ctx.duracao)

  // 1. Janela e centro. O centro e o INICIO da fala da ancora: o plano em que
  // ela comeca mostra quem fala naquele instante (o meio da cue cai, numa fala
  // longa, no plano seguinte, que ja e reacao).
  if (j.ancora !== null) {
    const ponto = j.cueAncora ? j.cueAncora.start + 0.2 : j.ancora
    // C7: momento dito sobre um plano apagado -- os vizinhos tambem estao "no momento".
    const c = ctx.centro
    const dist = c ? Math.max(0, c.de - ate, de - c.ate) : distancia(de, ate, ponto)
    const nivel = j.forte ? 'forte' : j.estimada ? 'estimada' : 'fraca'
    const peso = { forte: PESOS.centroForte, estimada: PESOS.centroEstimado, fraca: PESOS.centroFraco }[nivel]
    const queda = { forte: PESOS.quedaForte, estimada: PESOS.quedaEstimada, fraca: PESOS.quedaFraca }[nivel]
    // O plano apagado em que a fala cai nao leva o centro: o momento e dos vizinhos (centroAmpliado).
    const apagado = !!c && planos.every((q) => ctx.visao?.apagados.has(q.plano.id))
    const centro = apagado ? 0 : peso * Math.exp(-dist / queda) * fator
    const dentro = j.intervalos.reduce((s, i) => s + Math.max(0, Math.min(ate, i.ate) - Math.max(de, i.de)), 0)
    const fracao = Math.min(1, dentro / Math.max(0.01, ate - de))
    const janela = { forte: PESOS.janelaForte, estimada: PESOS.janelaEstimada, fraca: PESOS.janelaFraca }[nivel] * fracao * fator
    const rotulo = j.herdada
      ? 'perto da vizinha'
      : j.semCenas
        ? 'perto do trecho'
        : dist === 0 && (j.forte || j.estimada)
          ? 'no momento'
          : fracao > 0.5
            ? 'no evento'
            : 'perto do evento'
    add('janela', centro + janela, rotulo)
  }
  // Marca (valor 0): o porque abre com "sem evento" e a tela sabe que e da vizinha.
  if (j.herdada) termos.push({ chave: 'herdada', valor: 0, rotulo: 'sem evento' })

  // 2. Fala citada dentro da janela.
  if (ctx.cueCitada) {
    const c = ctx.cueCitada
    const sobra = Math.min(outSec, c.end) - Math.max(inSec, c.start)
    if (sobra >= Math.min(0.5, (c.end - c.start) * 0.5)) add('citada', PESOS.citada, 'fala citada')
  }

  // 3. Pessoas citadas no texto. A presenca vale pela fracao do tempo da tela
  // em que a pessoa aparece: num span, o relance do Xeno no primeiro plano nao
  // vale o span inteiro.
  const rostosDoSpan = planos.flatMap((p) => p.rostos)
  const tempoNoPlano = (q: PlanoDoCasar): number => Math.max(0, Math.min(q.plano.end, fimReal) - Math.max(q.plano.start, inSec))
  const tempoTotal = Math.max(0.01, planos.reduce((s, q) => s + tempoNoPlano(q), 0))
  const presencaNoSpan = (c: Citado): { rosto: number | null; fala: boolean; fracao: number } => {
    let rosto: number | null = null
    let fala = false
    let tempo = 0
    for (const p of planos) {
      const x = presenca(c, p)
      if (x.rosto !== null) rosto = Math.max(rosto ?? 0, x.rosto)
      fala ||= x.fala
      if (x.rosto !== null || x.fala) tempo += tempoNoPlano(p)
    }
    return { rosto, fala, fracao: planos.length === 1 ? 1 : Math.min(1, tempo / tempoTotal) }
  }
  // Ausente so com duas negacoes e um rosto de OUTRA pessoa com certeza: sem
  // rosto nenhum (ou com rosto duvidoso, troca provavel do reconhecimento) nao
  // se sabe -- a precisao do motor ficou entre 0,27 e 0,45.
  const outroRostoCerto = (c: Citado): boolean => rostosDoSpan.some((r) => r.conf >= 0.9 && !r.fichas.some((f) => bate(c.ficha, f)))
  // Trecho sem cenas: a intencao ("Senku olhando o horizonte") e o que sobra
  // para escolher a cena -- a pessoa dela vale como a do texto.
  const pessoas = j.semCenas ? [...ctx.citados, ...ctx.daIntencao] : ctx.citados
  const daIntencao = j.semCenas ? [] : ctx.daIntencao
  if (pessoas.length > 0) {
    let soma = 0
    const presentes: Termo[] = []
    const ausentes: Termo[] = []
    for (const c of pessoas) {
      const x = presencaNoSpan(c)
      // Meio valor garantido: a pessoa no plano certo de um span ainda conta.
      const f = 0.5 + 0.5 * x.fracao
      if (x.rosto !== null && x.fala) presentes.push({ chave: 'pessoa', valor: PESOS.rostoEFalante * f, rotulo: c.rotulo })
      else if (x.rosto !== null) presentes.push({ chave: 'pessoa', valor: PESOS.rosto * Math.max(0.6, x.rosto) * f, rotulo: c.rotulo })
      else if (x.fala) {
        const valor = rostosDoSpan.length > 0 ? PESOS.falanteComOutroRosto : PESOS.falante
        presentes.push({ chave: 'pessoa', valor: valor * f, rotulo: `${c.rotulo} fala` })
      } else if (outroRostoCerto(c)) ausentes.push({ chave: 'ausente', valor: PESOS.ausente, rotulo: `sem ${c.rotulo}` })
    }
    for (const t of presentes) {
      const v = Math.min(t.valor, PESOS.pessoaTeto - soma)
      soma += v
      add(t.chave, v, t.rotulo)
    }
    let neg = 0
    for (const t of ausentes) {
      const v = Math.max(t.valor, PESOS.pessoaPiso - neg)
      neg += v
      add(t.chave, v, t.rotulo)
    }
    // So ele / extras: pelos rostos (falante pode estar fora de quadro).
    if (rostosDoSpan.length > 0) {
      const deFora = new Set(
        rostosDoSpan.filter((r) => !pessoas.some((c) => r.fichas.some((f) => bate(c.ficha, f)))).map((r) => r.fichas.join(' ') || r.nome),
      )
      const algumCitado = rostosDoSpan.some((r) => pessoas.some((c) => r.fichas.some((f) => bate(c.ficha, f))))
      if (deFora.size === 0 && algumCitado) add('so', PESOS.soEle, pessoas.length > 1 ? 'so eles' : 'so ele')
      else if (deFora.size > 0) add('extras', Math.max(PESOS.extrasPiso, PESOS.extra * deFora.size), `+${deFora.size} em cena`)
    }
  }

  // 4. Intencao visual: pessoas que so ela cita, paisagem, grupo, falando.
  if (daIntencao.length > 0) {
    let soma = 0
    for (const c of daIntencao) {
      const x = presencaNoSpan(c)
      if (x.rosto !== null || x.fala) {
        const v = Math.min(PESOS.intencao * (0.5 + 0.5 * x.fracao), PESOS.intencaoTeto - soma)
        soma += v
        add('intencao', v, x.rosto !== null ? c.rotulo : `${c.rotulo} fala`)
      } else if (outroRostoCerto(c)) add('intencao', PESOS.intencaoAusente, `sem ${c.rotulo}`)
    }
  }
  // Paisagem: sem rosto reconhecido. Sem fala nenhuma vale inteira; com fala,
  // metade (a voz de fundo sobre um plano de cidade e o normal -- o porto do
  // S4 - 37 tem a Francois falando --, mas tambem pode ser gente sem rosto
  // reconhecido conversando).
  if (ctx.pedePaisagem) {
    if (rostosDoSpan.length === 0) {
      const comFala = planos.some((p) => p.temFala)
      add('paisagem', comFala ? PESOS.paisagemComFala : PESOS.paisagem, 'paisagem')
    } else add('paisagem', PESOS.paisagemComRosto, 'tem rosto')
  }
  if (ctx.pedeGrupo) {
    const gente = new Set([...rostosDoSpan.map((r) => r.fichas.join(' ') || r.nome), ...planos.flatMap((p) => p.falas.map((f) => f.fichas.join(' ') || f.nome))])
    if (gente.size >= 2) add('grupo', PESOS.grupo, 'grupo')
  }
  // O que a legenda do plano diz bate com o que a frase/intencao pede ("lua" ->
  // "Moon"). Sem ancora forte, e o melhor sinal que sobra: vale mais.
  if (ctx.conceitos.length > 0) {
    const ditas = new Set(planos.flatMap((p) => p.palavrasDitas))
    const forte = j.forte && !j.semCenas
    const cada = forte ? PESOS.palavra : PESOS.palavraSemAncora
    const teto = forte ? PESOS.palavraTeto : PESOS.palavraTetoSemAncora
    let soma = 0
    for (const c of ctx.conceitos) {
      if (soma >= teto) break
      if ([...c.formas].some((f) => ditas.has(f))) {
        soma += cada
        add('palavra', cada, `"${c.pt}" na fala`)
      }
    }
  }
  if (ctx.pedeFala) {
    const quem = [...ctx.citados, ...ctx.daIntencao]
    const falando = planos.some((p) => p.falas.some((f) => quem.some((c) => f.fichas.some((x) => bate(c.ficha, x)))))
    if (falando) add('falando', PESOS.falando, 'falando')
  }

  // 4b. Lote 2: o que se ve. Num span, cada plano vale pelo tempo dele na tela.
  const v = ctx.visao
  if (v) {
    const media = (forca: (q: PlanoDoCasar) => number): number =>
      planos.reduce((s, q) => s + forca(q) * tempoNoPlano(q), 0) / tempoTotal
    const sf = ctx.sinais
    const k = j.forte && !j.semCenas ? PESOS.vistoComAncoraForte : 1
    if (sf.imagem) add('imagem', k * PESOS.imagem * media((q) => sf.imagem!.get(q.plano.id) ?? 0), 'parecido')
    if (sf.sentido) add('sentido', k * PESOS.sentido * media((q) => sf.sentido!.get(q.plano.id) ?? 0), 'mesma ideia')
    if (sf.tags.length > 0) {
      let melhor: string | null = null
      const f = media((q) => {
        const x = tagsNoPlano(q, sf.tags, v)
        if (x.melhor && !melhor) melhor = x.melhor
        return x.forca
      })
      if (melhor) add('tag', k * PESOS.tags * f, tagEmPortugues(melhor))
    }
    // C4: as duas pessoas citadas no mesmo plano (pelo rosto).
    if (v.camadas.personagemForte && ctx.citados.length >= 2) {
      const comRosto = ctx.citados.filter((c) => rostosDoSpan.some((r) => r.fichas.some((f) => bate(c.ficha, f))))
      if (comRosto.length >= 2) add('juntos', PESOS.juntos, `${comRosto[0]!.rotulo} + ${comRosto[1]!.rotulo}`)
    }
    // C7: a janela inteira em quadro borrado.
    if (v.qualidade.size > 0) {
      const qs = planos.flatMap((q) => quadrosNaJanela(q, inSec, fimReal, v)).flatMap((q) => v.qualidade.get(q.arquivo) ?? [])
      if (qs.length > 0 && qs.every((x) => x.borrado)) add('borrado', PESOS.borrado, 'borrado')
    }
  }

  // 5. Cronologia, continuidade e variedade (desempate).
  for (const t of termosDaSequencia(planos, inSec, fimReal, ctx, ctx.anteriores, reusado)) termos.push(t)

  // 6. Duracao.
  const cobre = outSec - inSec
  const falta = Math.max(0, ctx.duracao - cobre)
  if (falta <= 0.05) add('duracao', PESOS.cobre, 'cobre a frase')
  else if (falta <= CONGELA_SEC) add('duracao', PESOS.congela * falta, 'congela')
  else add('duracao', Math.max(PESOS.curtaPiso, PESOS.curtaBase + PESOS.curtaPorSeg * (falta - CONGELA_SEC)), 'curta')
  if (planos.length > 1) {
    add('emenda', PESOS.emenda * (planos.length - 1), 'emendada')
    // Span que abre com um relance do primeiro plano: o olho so ve o segundo.
    if (primeiro.plano.end - inSec < RELANCE_SEC) add('relance', PESOS.relance, 'relance')
  }
  if (repetido) add('repetida', PESOS.repetida, 'repetida')
  return { termos, falta: falta <= 0.05 ? 0 : falta }
}

/**
 * Cronologia, continuidade e variedade: o que depende das cenas das frases de
 * ANTES. No guloso entra na nota de cada candidato; na conta do roteiro
 * inteiro (C5), na passagem de uma frase para a outra. Trecho sem cenas: a
 * frase nao esta "em frente" de nada (o momento dela nao tem cena), entao
 * seguir em frente e continuar o plano anterior nao contam.
 */
function termosDaSequencia(
  planos: readonly PlanoDoCasar[],
  inSec: number,
  fimReal: number,
  ctx: Pick<ContextoDaFrase, 'janela' | 'citados' | 'visao'>,
  anteriores: readonly CenaAnterior[],
  reusado: boolean,
  /**
   * C5: a ancora da frase de ANTES. Com ela, "a frase vai em frente" compara
   * as ancoras (a ordem da historia), e nao a cena escolhida antes: na conta do
   * roteiro inteiro, escolher cedo na anterior "liberava" o bonus da seguinte.
   * Ausente = o guloso de sempre.
   */
  ancoraAnterior?: number | null,
): Termo[] {
  const termos: Termo[] = []
  const add = (chave: string, valor: number, rotulo: string): void => {
    if (Math.abs(valor) >= 0.05) termos.push({ chave, valor, rotulo })
  }
  const j = ctx.janela
  const primeiro = planos[0]!
  const ant = anteriores[anteriores.length - 1]
  if (ant) {
    const fraseVaiEmFrente =
      j.ancora === null || (ancoraAnterior !== undefined && ancoraAnterior !== null ? j.ancora >= ancoraAnterior - 2 : j.ancora >= ant.inSec - 2)
    if (fraseVaiEmFrente) {
      if (inSec >= ant.fimReal - 0.05) {
        if (!j.semCenas) add('cronologia', PESOS.emFrente, 'em frente')
      } else if (fimReal <= ant.inSec + 0.05) add('cronologia', PESOS.volta, 'volta no tempo')
    }
    const mesmoPlano = planos.some((p) => ant.planoIds.includes(p.plano.id))
    const colado = mesmoPlano && Math.abs(inSec - ant.fimReal) <= 0.5
    if (mesmoPlano && !colado) add('mesmoPlano', PESOS.mesmoPlano, 'mesmo plano')
    else if (reusado && !mesmoPlano) add('reuso', PESOS.reuso, 'plano ja usado')
    // Continua = o corte original do episodio: a anterior foi ate o fim do
    // plano dela e esta abre o plano seguinte (ou segue colada na mesma tomada).
    const abreOPlano = inSec <= primeiro.util!.de + 1
    if (!j.semCenas && (colado || (primeiro.pos === ant.ultimoPos + 1 && ant.chegouAoFim && abreOPlano))) {
      add('continua', PESOS.continua, 'continua')
    }
    // Variedade: a mesma gente seguida. Quem so FALA pode ser voz de fora
    // (a Francois sobre o porto): conta so com um rosto reconhecido no meio.
    const ant2 = anteriores[anteriores.length - 2]
    if (mesmaGente(primeiro.gente, ant.gente)) {
      const tres = !!ant2 && mesmaGente(primeiro.gente, ant2.gente)
      if (tres && (primeiro.genteDoRosto || ant.genteDoRosto || ant2.genteDoRosto)) add('variedade', PESOS.repeteRosto, 'repete rosto')
      else if (primeiro.gente.length === 1 && !colado && (primeiro.genteDoRosto || ant.genteDoRosto)) {
        add('variedade', PESOS.repeteRostoSeguido, 'repete rosto')
      }
    }
    // C4: frase com duas pessoas que mostra uma so: alternar com a anterior.
    if (ctx.visao?.camadas.personagemForte && ctx.citados.length >= 2) {
      const soUm = (gente: readonly string[][]): string | null => {
        const quem = ctx.citados.filter((c) => gente.some((g) => g.some((f) => bate(c.ficha, f))))
        return quem.length === 1 ? quem[0]!.ficha : null
      }
      const agora = primeiro.genteDoRosto ? soUm(primeiro.gente) : null
      const antes = ant.genteDoRosto ? soUm(ant.gente) : null
      if (agora && antes) add('alterna', agora === antes ? PESOS.alternaMesmo : PESOS.alternaOutro, 'alterna')
    }
  }
  return termos
}

/**
 * O "porque" do cartao (ate 4 termos): so os motivos A FAVOR, do maior ao
 * menor. O que pesa contra ("sem Senku", "volta no tempo") lia como motivo no
 * mesmo estilo; o que importa disso vira aviso da frase ("Cena curta").
 */
export function porqueDosTermos(termos: readonly Termo[]): string[] {
  const vistos = new Set<string>()
  const unico = (t: Termo): boolean => {
    if (vistos.has(t.rotulo)) return false
    vistos.add(t.rotulo)
    return true
  }
  const pos = [...termos].filter((t) => t.valor > 0 && t.chave !== 'herdada').sort((a, b) => b.valor - a.valor)
  const herdada = termos.some((t) => t.chave === 'herdada')
  // O primeiro e o "por que" curto da dica (1-2 palavras: "Nia + soco", "fala citada").
  const curto = porqueCurto(pos)
  const saida: string[] = curto ? [curto] : []
  if (herdada) saida.push('sem evento')
  for (const t of pos) {
    if (saida.length >= PORQUE_MAX) break
    if (unico(t) && t.rotulo !== curto) saida.push(t.rotulo)
  }
  return saida.map((r) => ascii(r).slice(0, 32)).filter(Boolean).slice(0, PORQUE_MAX)
}

/** O que a tela mostra no rotulo curto, em ordem de forca do argumento. */
const CHAVES_DO_QUE_SE_VE = ['tag', 'imagem', 'sentido', 'palavra', 'falando', 'paisagem', 'grupo']

/**
 * O "por que" de 1-2 palavras (lote 2, a dica da sugestao): a fala citada
 * ganha; senao quem esta na tela + o que se ve ("Nia + soco", "Senku +
 * parecido"); senao so um dos dois; senao o motivo mais forte ("no momento").
 */
export function porqueCurto(positivos: readonly Termo[]): string | null {
  if (positivos.some((t) => t.chave === 'citada')) return 'fala citada'
  const juntos = positivos.find((t) => t.chave === 'juntos')
  const pessoa = juntos ?? positivos.find((t) => t.chave === 'pessoa')
  const quem = pessoa ? pessoa.rotulo.replace(/ fala$/, '') : null
  const oQue = positivos.filter((t) => CHAVES_DO_QUE_SE_VE.includes(t.chave) && t.valor >= 2).sort((a, b) => b.valor - a.valor)[0]
  const rotuloDoQue = oQue ? oQue.rotulo.replace(/^"(.+)" na fala$/, '$1') : null
  if (quem && rotuloDoQue && !juntos) return `${quem} + ${rotuloDoQue}`
  if (quem) return quem
  if (rotuloDoQue) return rotuloDoQue
  return positivos[0]?.rotulo ?? null
}

function arred(n: number, casas = 3): number {
  const f = 10 ** casas
  return Math.round(n * f) / f
}

/**
 * A fita de uma frase: os candidatos de cada nivel da janela, pontuados, os
 * melhores primeiro, sem dois candidatos dividindo plano. Abre a janela
 * enquanto faltar candidato; sem nada livre no episodio, aceita trecho ja
 * mostrado (repetido, com aviso). Plano longo ja usado por outra frase entra
 * pela parte livre dele (partesParaAFrase).
 */
function fitaDaFrase(
  todos: readonly PlanoDoCasar[],
  ctx: ContextoDaFrase,
  eventos: readonly Evento[],
  ocupacao: Ocupacao,
  episodioId: string,
  /** Quantos candidatos (a fita guarda FITA_MAX; a conta do roteiro inteiro pede mais). */
  max: number = FITA_MAX,
): CandidatoPontuado[] {
  const niveis = niveisDaJanela(ctx.janela, eventos)
  const forte = !!ctx.visao?.camadas.personagemForte && ctx.citados.length > 0
  const temCitado = (planos: readonly PlanoDoCasar[]): boolean =>
    planos.some((q) => q.rostos.some((r) => ctx.citados.some((c) => r.fichas.some((f) => bate(c.ficha, f)))))
  const tentar = (permitirUsados: boolean): CandidatoPontuado[] => {
    // Emendar so plano que ninguem usou (span e a montagem original, inteira).
    const livre = (q: PlanoDoCasar): boolean => permitirUsados || (ocupacao.get(q.plano.id)?.length ?? 0) === 0
    const partes = (p: PlanoDoCasar): { seg: Intervalo; inteiro: boolean }[] =>
      permitirUsados ? [{ seg: p.util!, inteiro: true }] : partesParaAFrase(p, ocupacao, ctx.duracao)
    let melhor: CandidatoPontuado[] = []
    for (const [n, nivel] of niveis.entries()) {
      const base = todos
        .filter((p) => p.util && !p.fora && cruza(p.plano, nivel))
        .map((p) => ({ p, partes: partes(p) }))
        .filter((x) => x.partes.length > 0)
      const ultimo = n === niveis.length - 1
      if (base.length < CANDIDATOS_MIN && !ultimo) continue
      const janelas = base.flatMap(({ p, partes: ps }) => ps.flatMap(({ seg, inteiro }) => montarJanelas(p, seg, inteiro, todos, ctx, livre)))
      const pontuados = janelas.map((w) => {
        const fimReal = Math.min(w.outSec, w.inSec + ctx.duracao)
        const repetido = sobrepoe(ocupacao, w.planos.map((q) => q.plano.id), w.inSec, fimReal)
        const reusado = !repetido && w.planos.some((q) => (ocupacao.get(q.plano.id)?.length ?? 0) > 0)
        const { termos, falta } = pontuar(w.planos, w.inSec, w.outSec, ctx, repetido, reusado)
        const candidato: CandidatoDeCena = {
          planoIds: w.planos.map((q) => q.plano.id),
          episodioId,
          inSec: arred(w.inSec),
          outSec: arred(w.outSec),
          nota: 0,
          porque: [],
          origem: 'sugestao',
          // C7: a miniatura e o quadro mais bonito e nitido da janela.
          keyframe: melhorQuadroDaJanela(w.planos, w.inSec, fimReal, ctx.visao) ?? w.planos[0]!.plano.keyframe,
        }
        return { candidato, planos: w.planos, termos, repetido, falta }
      })
      // C4: com candidatos bastantes com o rosto de quem a frase cita, o rosto
      // vira regra -- os outros vao para o fim da fita (nao somem: sem o
      // rosto certo ainda pode ser o melhor que ha). Com poucos, so a nota de sempre.
      if (forte) {
        const comRosto = new Set(pontuados.filter((c) => temCitado(c.planos)).map((c) => c.candidato.planoIds[0]))
        if (comRosto.size >= FORTE_MIN) {
          for (const c of pontuados) if (!temCitado(c.planos)) c.termos.push({ chave: 'forte', valor: PESOS.semCitado, rotulo: 'sem citado' })
        }
      }
      for (const c of pontuados) {
        c.candidato.nota = arred(c.termos.reduce((s, t) => s + t.valor, 0), 2)
        c.candidato.porque = porqueDosTermos(c.termos)
      }
      pontuados.sort((a, b) => b.candidato.nota - a.candidato.nota || a.candidato.inSec - b.candidato.inSec)
      const fita: CandidatoPontuado[] = []
      const ocupados = new Set<string>()
      for (const c of pontuados) {
        if (c.candidato.planoIds.some((id) => ocupados.has(id))) continue
        fita.push(c)
        for (const id of c.candidato.planoIds) ocupados.add(id)
        if (fita.length >= max) break
      }
      melhor = fita
      if (fita.length >= max || ultimo) break
    }
    return melhor
  }
  const fita = tentar(false)
  return fita.length > 0 ? fita : tentar(true)
}

// ------------------------------------------------------------------- casar

/** Uma frase do roteiro na ordem da narracao (as secoes ja achatadas). */
export type FraseDoCasar = Pick<Frase, 'id' | 'texto' | 'eventoIds' | 'citacaoCueId' | 'cueDoMomento' | 'intencaoVisual'>

export interface EntradaDoCasar {
  indice: Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'>
  eventos: readonly Evento[]
  /** TODAS as frases do roteiro, na ordem (a cronologia olha a anterior). */
  frases: readonly FraseDoCasar[]
  /** takeAtual do rascunho. null = estimativa pelas palavras. */
  take: Pick<TakeDaVoz, 'trechos' | 'palavras'> | null
  /** As escolhas que FICAM (travadas, ou em dia): os trechos delas nao se repetem. */
  fixas: ReadonlyMap<string, EscolhaDaFrase>
  /** As frases a sugerir agora. As outras so dao contexto. */
  refazer: ReadonlySet<string>
  /**
   * Planos cujo primeiro quadro e escuro (keyframe _0; ver luzDosKeyframes no
   * servico): a janela comeca um pouco depois quando o plano sobra. Ausente =
   * nenhum (o casar e puro, quem le os JPGs e o servico).
   */
  abremEscuro?: ReadonlySet<string>
  /** Lote 2: o que o motor e o etiquetador mediram (ausente = so as regras). */
  sinais?: SinaisDoCasar
  /** Lote 2: as camadas ligadas. Ausente = CAMADAS_PADRAO. */
  camadas?: Partial<CamadasDoCasar>
  /**
   * Ate 2 cenas por frase (shared/divisao.ts): a frase longa ou com dois
   * momentos ganha uma cena por pedaco. Ausente ou desligada = uma cena por
   * frase, como antes. O sentido de cada pedaco vem em `sinais.sentidoDaFrase`
   * pela chave idDoPedaco (o servico mede); sem ele, o pedaco fica sem C1.
   */
  divisao?: OpcoesDaDivisao | null
}

/** Um pedaco de uma frase dividida, como o casar o escolheu. */
export interface PedacoCasado {
  texto: string
  palavraInicio: number
  /** Segundos do pedaco no take (ou na estimativa). */
  duracao: number
  janela: JanelaDaFrase
  /** A fita pontuada do pedaco: a escolhida primeiro. */
  fita: CandidatoPontuado[]
}

export interface FraseCasada {
  escolha: EscolhaDaFrase
  /** A fita pontuada inteira, com os termos (o teste e a depuracao leem). Dividida: a do 1o pedaco. */
  fita: CandidatoPontuado[]
  janela: JanelaDaFrase
  avisos: string[]
  /** A frase foi dividida: os pedacos e por que (o teste e a medicao leem). */
  pedacos?: PedacoCasado[]
  motivos?: MotivoDaDivisao[]
}

export interface ResultadoDoCasar {
  /** So as frases de `refazer`, na ordem do roteiro. */
  casadas: FraseCasada[]
  /** Recados ASCII ("f07: cena repetida"). */
  avisos: string[]
  /** Ate 2 cenas: as frases que a regra dividia mas a guarda deixou com uma (metade fraca). A medicao le. */
  guarda?: string[]
}

/** 0..1: quao ancorada esta a 1a (nota) e quanto ela ganha da 2a (margem). */
function confiancaDaFita(fita: readonly CandidatoPontuado[], janela: JanelaDaFrase, longe: boolean): number {
  const n1 = fita[0]?.candidato.nota ?? 0
  const n2 = fita[1]?.candidato.nota ?? 0
  if (fita.length === 0) return 0
  const absoluta = Math.max(0, Math.min(1, n1 / 70))
  const margem = Math.max(0, Math.min(1, (n1 - n2) / 12))
  let c = 0.6 * absoluta + 0.4 * margem
  if (janela.herdada || janela.intervalos.length === 0) c = Math.min(c, 0.25)
  if (longe || janela.semCenas) c = Math.min(c, 0.3)
  if (fita[0]?.repetido) c = Math.min(c, 0.1)
  return arred(c, 2)
}

/** Mais que isto do evento: a cena nao e do momento da frase (o trecho nao tem cena, ou ja foi usado). */
const LONGE_SEC = 20

/** O recado da frase cujo trecho o indice nao cobre (o casar e a tela de Cenas mostram). */
export { AVISO_TRECHO_SEM_CENAS }

function longeDoEvento(c: Pick<CandidatoDeCena, 'inSec' | 'outSec'>, janela: JanelaDaFrase): boolean {
  if (janela.intervalos.length === 0) return false
  return janela.intervalos.every((i) => Math.max(i.de - c.outSec, c.inSec - i.ate) > LONGE_SEC)
}

/** O que o casar carrega de uma frase para a seguinte: os trechos ja mostrados e as cenas de antes. */
interface EstadoDoCasar {
  ocupacao: Ocupacao
  anteriores: CenaAnterior[]
}

function copiarEstado(s: EstadoDoCasar): EstadoDoCasar {
  return { ocupacao: new Map([...s.ocupacao].map(([k, v]) => [k, [...v]])), anteriores: [...s.anteriores] }
}

/**
 * Casa as frases de `refazer`, em ordem, gulosamente: cada uma leva a melhor
 * da fita, e o trecho que ela mostra fica ocupado para as seguintes (um plano
 * LONGO ainda serve a outra frase no trecho livre). As `fixas` ja ocupam os
 * trechos delas desde o comeco.
 *
 * Depois, a TROCA LOCAL: quando a frase pegou o plano do MOMENTO da seguinte
 * (o 0270 do S4 - 37, uma tomada de 27 s com as duas falas), tenta a anterior
 * sem ele e refaz dali em diante; fica a troca so se a soma das duas melhorar.
 *
 * ATE 2 CENAS POR FRASE (`divisao`, shared/divisao.ts): a frase que dividirFrase
 * divide vira um item por pedaco, cada um pontuado com as PROPRIAS palavras,
 * pessoas e sentido (a intencao, a imagem e as etiquetas da frase vao para o
 * pedaco que elas descrevem; a fala do momento fica com o primeiro, e os
 * seguintes acham o deles pelas palavras, depois dele). Dentro da frase vale
 * a ordem do episodio, sem plano repetido, cada pedaco coberto pelo proprio
 * plano e sem o plano do momento da frase seguinte. Pedaco sem saida boa
 * (forcado, repetido ou longe do momento) desfaz a divisao daquela frase (a
 * guarda, `ResultadoDoCasar.guarda`).
 */
export function casarFrases(e: EntradaDoCasar): ResultadoDoCasar {
  const todos = prepararPlanos(e.indice)
  const porId = new Map(todos.map((p) => [p.plano.id, p]))
  const elenco = elencoDoEpisodio(todos, e.indice, e.eventos)
  const fraseDe = new Map(e.frases.map((f) => [f.id, f]))
  // Os pedacos possiveis de cada frase a refazer: o corte (dividir ou nao, so mais adiante).
  const divisao = e.divisao?.ligada ? e.divisao : null
  const cortes = new Map<number, CorteDaFrase>()
  if (divisao) {
    for (const [i, f] of e.frases.entries()) {
      if (!e.refazer.has(f.id)) continue
      const c = corteDaFrase(f, e.take, divisao)
      if (c) cortes.set(i, c)
    }
  }
  // A imagem (C2) e as etiquetas (C3) da frase vao para o pedaco que a intencao descreve.
  const intencaoDe = new Map([...cortes].map(([i, c]) => [i, pedacoDaIntencao(e.frases[i]!.intencaoVisual, c, elenco)]))
  const visao = prepararVisao(todos, e.indice, sinaisComPedacos(e.sinais ?? {}, e.frases, cortes, intencaoDe), e.camadas ?? {})
  const sinaisPorFrase = new Map(e.frases.map((f) => [f.id, sinaisDaFrase(f.id, todos, visao)]))
  const janelas = janelasDasFrases(e.frases, e.eventos, e.indice, todos, (id) => sinaisPorFrase.get(id)?.zDaCue ?? null)
  const cuePorId = new Map(e.indice.cues.map((c) => [c.id, c]))
  const abremEscuro = e.abremEscuro ?? new Set<string>()

  const lembrar = (s: EstadoDoCasar, c: Pick<CandidatoDeCena, 'planoIds' | 'inSec' | 'outSec'>, duracao: number): void => {
    s.anteriores.push(cenaAnterior(porId, c, duracao))
  }

  const inicial: EstadoDoCasar = { ocupacao: new Map(), anteriores: [] }
  for (const [fraseId, esc] of e.fixas) {
    if (e.refazer.has(fraseId)) continue
    for (const c of cenasDaFixa(esc, fraseDe.get(fraseId), e.take)) ocupar(inicial.ocupacao, c.candidato, c.duracao)
  }

  // O que nao muda com as escolhas das outras frases: quem a frase cita, o que pede, quanto dura.
  // C4: "ele", "ela", "o cara" sem nome herdam o sujeito da frase anterior.
  let sujeito: Citado[] = []
  const fixo = e.frases.map((frase, i) => {
    const sujeitoAntes = sujeito
    const doTexto = citadosNoTexto(frase.texto, elenco)
    const citados = doTexto.length === 0 && visao.camadas.personagemForte ? sujeitoHerdado(frase.texto, sujeito) : doTexto
    sujeito = citados
    const daIntencao = citadosNoTexto(frase.intencaoVisual, elenco).filter((c) => !citados.some((x) => bate(x.ficha, c.ficha) || bate(c.ficha, x.ficha)))
    const palavrasIv = palavrasSimples(frase.intencaoVisual)
    const palavrasTx = palavrasSimples(frase.texto)
    // Paisagem: a intencao (o que a TELA mostra) nao cita ninguem. O texto pode
    // citar ("encarar o Whyman na Lua" com a intencao "visao da Lua").
    const ninguemNaTela = citadosNoTexto(frase.intencaoVisual, elenco).length === 0
    const citada = frase.citacaoCueId ? cuePorId.get(frase.citacaoCueId) : undefined
    const d = duracaoDaFrase(frase, e.take)
    return {
      d,
      sujeitoAntes,
      ctx: {
        frase,
        janela: janelas[i]!,
        duracao: d.duracao,
        citados,
        daIntencao,
        pedePaisagem: ninguemNaTela && palavrasIv.some((w) => PALAVRAS_PAISAGEM.has(w)),
        pedeGrupo: [...palavrasIv, ...palavrasTx].some((w) => PALAVRAS_GRUPO.has(w)),
        pedeFala: palavrasIv.some((w) => PALAVRAS_FALANDO.has(w)),
        conceitos: conceitosDaFrase([...palavrasTx, ...palavrasIv]),
        cueCitada: citada ? { start: citada.start, end: citada.end } : null,
        abremEscuro,
        visao,
        sinais: sinaisPorFrase.get(frase.id)!,
        centro: visao.camadas.melhorQuadro
          ? centroAmpliado(janelas[i]!.cueAncora ? janelas[i]!.cueAncora!.start + 0.2 : janelas[i]!.ancora, todos, visao)
          : null,
      } satisfies Omit<ContextoDaFrase, 'anteriores'>,
    }
  })

  // ---- Ate 2 cenas por frase: o contexto de cada pedaco e a decisao.

  /** A fita da frase INTEIRA (sem as anteriores): a conta usa, a decisao olha (plano curto) e o "Juntar em 1" guarda. */
  const inteiras = new Map<number, CandidatoPontuado[]>()
  const inteiraDe = (i: number): CandidatoPontuado[] => {
    let x = inteiras.get(i)
    if (!x) {
      x = fitaDaFrase(todos, { ...fixo[i]!.ctx, anteriores: [] }, e.eventos, inicial.ocupacao, e.indice.id, CANDIDATOS_DA_CONTA)
      inteiras.set(i, x)
    }
    return x
  }

  const feitos = new Map<number, PedacoNoCasar[]>()
  /** Os pedacos da frase i: cada um com as palavras, as pessoas, o sentido e o momento DELE. */
  const pedacosDe = (i: number, corte: CorteDaFrase): PedacoNoCasar[] => {
    const pronto = feitos.get(i)
    if (pronto) return pronto
    const frase = e.frases[i]!
    const kIntencao = intencaoDe.get(i) ?? -1
    const sinaisK = corte.pedacos.map((_, k) => sinaisDaFrase(idDoPedaco(frase.id, k), todos, visao))
    // Quem cada pedaco cita: o nome dito, ou o sujeito herdado ("ele", "o rapaz").
    let sujeitoK = fixo[i]!.sujeitoAntes
    const citadosK = corte.pedacos.map((p) => {
      const doTexto = citadosNoTexto(p.texto, elenco)
      const c = doTexto.length === 0 && visao.camadas.personagemForte ? sujeitoHerdado(p.texto, sujeitoK) : doTexto
      if (c.length > 0) sujeitoK = c
      return c
    })
    // A fala do momento fica com o PRIMEIRO pedaco: a frase comeca no momento dela, como a cena
    // unica comecaria (dar o momento ao pedaco que "diz" a fala empurrava o primeiro para tras, no
    // trecho da frase anterior). Os seguintes acham o deles pelas palavras, depois dele.
    const kMomento = 0
    const js = emOrdem(
      corte.pedacos.map(
        (p, k) =>
          janelaPropria(
            {
              eventoIds: frase.eventoIds,
              citacaoCueId: null,
              cueDoMomento: k === kMomento ? frase.cueDoMomento : null,
              texto: p.texto,
              intencaoVisual: k === kIntencao ? frase.intencaoVisual : '',
            },
            e.eventos,
            e.indice,
            todos,
            elenco,
            sinaisK[k]!.zDaCue,
          ) ?? janelas[i]!,
      ),
      kMomento,
    )
    const palavrasIv = palavrasSimples(frase.intencaoVisual)
    const ninguemNaTela = citadosNoTexto(frase.intencaoVisual, elenco).length === 0
    const saida = corte.pedacos.map((p, k): PedacoNoCasar => {
      const comIntencao = k === kIntencao
      const citados = citadosK[k]!
      const iv = comIntencao ? palavrasIv : []
      const palavrasTx = palavrasSimples(p.texto)
      const janela = js[k]!
      const duracao = Math.max(0.05, p.fim - p.inicio)
      return {
        texto: p.texto,
        palavraInicio: p.palavraInicio,
        duracao,
        janela,
        ctx: {
          frase: { id: frase.id, texto: p.texto, intencaoVisual: comIntencao ? frase.intencaoVisual : '', citacaoCueId: null },
          janela,
          duracao,
          citados,
          daIntencao: comIntencao
            ? citadosNoTexto(frase.intencaoVisual, elenco).filter((c) => !citados.some((x) => bate(x.ficha, c.ficha) || bate(c.ficha, x.ficha)))
            : [],
          pedePaisagem: comIntencao && ninguemNaTela && iv.some((w) => PALAVRAS_PAISAGEM.has(w)),
          pedeGrupo: [...iv, ...palavrasTx].some((w) => PALAVRAS_GRUPO.has(w)),
          pedeFala: iv.some((w) => PALAVRAS_FALANDO.has(w)),
          conceitos: conceitosDaFrase([...palavrasTx, ...iv]),
          cueCitada: null,
          abremEscuro,
          visao,
          sinais: sinaisK[k]!,
          centro: visao.camadas.melhorQuadro ? centroAmpliado(janela.cueAncora ? janela.cueAncora.start + 0.2 : janela.ancora, todos, visao) : null,
        },
      }
    })
    feitos.set(i, saida)
    return saida
  }

  /** Frases cuja divisao saiu fraca (a guarda): ficam com uma cena so. */
  const naoDividir = new Set<number>()
  const divididas = (): Map<number, FraseDividida> => {
    const saida = new Map<number, FraseDividida>()
    if (!divisao) return saida
    for (const i of cortes.keys()) {
      if (naoDividir.has(i)) continue
      const top = inteiraDe(i)[0]
      // d. plano curto: a melhor cena unica emenda o plano seguinte ou congela o ultimo quadro.
      const planoCurto = !!top && (top.planos.length > 1 || top.falta > FOLGA_SEM_EMENDA_SEC)
      const dv = dividirFrase(e.frases[i]!, e.take, divisao, { citados: (t) => citadosNoTexto(t, elenco).map((c) => c.ficha), planoCurto })
      if (dv) saida.set(i, { motivos: dv.motivos, pedacos: pedacosDe(i, dv) })
    }
    return saida
  }

  /** O plano do momento da frase SEGUINTE (o pedaco de depois nao o pega). null = nao ha, ou a seguinte e fixa. */
  const momentoSeguinte = (i: number): string | null => {
    const prox = e.frases[i + 1]
    const jb = janelas[i + 1]
    if (!prox || !jb || !e.refazer.has(prox.id) || !jb.cueAncora || !(jb.forte || jb.estimada) || jb.semCenas || jb.herdada) return null
    const t = jb.cueAncora.start + 0.2
    return todos.find((p) => p.util && t >= p.plano.start && t < p.plano.end)?.plano.id ?? null
  }

  if (visao.camadas.conta) {
    const ctxDaConta: ContextoDaConta = { e, todos, porId, janelas, fixo, fraseDe, inteiraDe, momentoSeguinte, ocupacaoInicial: inicial.ocupacao }
    // A guarda: frase com pedaco fraco volta a ter uma cena so, e a conta refaz.
    const comGuarda = (r: ResultadoDoCasar): ResultadoDoCasar => (divisao ? { ...r, guarda: [...naoDividir].map((i) => e.frases[i]!.id) } : r)
    for (let rodada = 0; ; rodada++) {
      const r = casarPelaConta(ctxDaConta, divididas())
      const fracas = r.fracas.filter((i) => !naoDividir.has(i))
      if (fracas.length === 0) return comGuarda(r.resultado)
      for (const i of fracas) naoDividir.add(i)
      if (rodada >= 4) {
        for (const i of cortes.keys()) naoDividir.add(i)
        return comGuarda(casarPelaConta(ctxDaConta, divididas()).resultado)
      }
    }
  }

  const divididasDoGuloso = divididas()

  /**
   * A frase dividida, pedaco a pedaco, no estado `s` (que ela atualiza so se
   * todos os pedacos acharem cena boa). null = metade fraca: fica uma cena so.
   */
  const casarDividida = (i: number, dv: FraseDividida, s: EstadoDoCasar): FraseCasada | null => {
    const frase = e.frases[i]!
    const copia = copiarEstado(s)
    const evitar = momentoSeguinte(i)
    const escolhidos: { c: CandidatoPontuado; duracao: number; fita: CandidatoPontuado[]; janela: JanelaDaFrase; palavraInicio: number; texto: string }[] = []
    for (const [k, p] of dv.pedacos.entries()) {
      const fita = fitaDaFrase(todos, { ...p.ctx, anteriores: copia.anteriores }, e.eventos, copia.ocupacao, e.indice.id)
      const ok = fita.filter((c) => cobreOPedaco(c) && dentroDaFrase(c, escolhidos) && !(k > 0 && evitar !== null && c.candidato.planoIds.includes(evitar)))
      const primeira = ok[0]
      if (!primeira || primeira.repetido || longeDoEvento(primeira.candidato, p.janela)) return null
      ocupar(copia.ocupacao, primeira.candidato, p.duracao)
      lembrar(copia, primeira.candidato, p.duracao)
      escolhidos.push({ c: primeira, duracao: p.duracao, fita: ok, janela: p.janela, palavraInicio: p.palavraInicio, texto: p.texto })
    }
    const inteira = inteiraDe(i).filter((c) => !sobrepoe(s.ocupacao, c.candidato.planoIds, c.candidato.inSec, Math.min(c.candidato.outSec, c.candidato.inSec + fixo[i]!.d.duracao)))
    s.ocupacao.clear()
    for (const [k, v] of copia.ocupacao) s.ocupacao.set(k, v)
    s.anteriores.splice(0, s.anteriores.length, ...copia.anteriores)
    return escolhaDividida(frase, janelas[i]!, fixo[i]!.d, escolhidos, inteira, dv.motivos)
  }

  /**
   * Uma frase no estado `s` (que ela atualiza). `evitar` = a troca local: a
   * melhor da fita que NAO usa esse plano vai na frente. null = frase fixa.
   */
  const casarUma = (i: number, s: EstadoDoCasar, evitar: string | null): FraseCasada | null => {
    const frase = e.frases[i]!
    const janela = janelas[i]!
    if (!e.refazer.has(frase.id)) {
      const fixa = e.fixas.get(frase.id)
      if (fixa) for (const c of cenasDaFixa(fixa, frase, e.take)) lembrar(s, c.candidato, c.duracao)
      return null
    }
    const dv = evitar ? undefined : divididasDoGuloso.get(i)
    if (dv) {
      const feita = casarDividida(i, dv, s)
      if (feita) return feita
      naoDividir.add(i)
    }
    const { d, ctx: base } = fixo[i]!
    const ctx: ContextoDaFrase = { ...base, anteriores: s.anteriores }
    const pontuada = fitaDaFrase(todos, ctx, e.eventos, s.ocupacao, e.indice.id)
    const k = evitar ? pontuada.findIndex((c) => !c.candidato.planoIds.includes(evitar)) : 0
    const fita = k > 0 ? [pontuada[k]!, ...pontuada.filter((_, x) => x !== k)] : pontuada
    const primeira = fita[0]
    if (primeira) {
      ocupar(s.ocupacao, primeira.candidato, d.duracao)
      lembrar(s, primeira.candidato, d.duracao)
    }
    return escolhaComAvisos(frase, janela, fita, d)
  }

  // O guloso, guardando o estado de antes de cada frase (a troca local recomeca dele).
  const n = e.frases.length
  const antesDe: EstadoDoCasar[] = []
  const feitas: (FraseCasada | null)[] = []
  const refazerDesde = (i: number, evitar: string | null): void => {
    const s = copiarEstado(antesDe[i]!)
    for (let k = i; k < n; k++) {
      antesDe[k] = copiarEstado(s)
      feitas[k] = casarUma(k, s, k === i ? evitar : null)
    }
  }
  antesDe[0] = inicial
  refazerDesde(0, null)

  // A troca local, frase a frase (frase dividida fica como esta: os pedacos ja evitam o momento da seguinte).
  const notaDe = (x: FraseCasada | null): number => x?.fita[0]?.candidato.nota ?? 0
  for (let i = 0; i + 1 < n; i++) {
    const a = feitas[i]
    const b = feitas[i + 1]
    const jb = janelas[i + 1]!
    if (!a?.fita[0] || !b || a.pedacos || b.pedacos || !jb.cueAncora || !(jb.forte || jb.estimada) || jb.semCenas || jb.herdada) continue
    const t = jb.cueAncora.start + 0.2
    const doMomento = todos.find((p) => p.util && t >= p.plano.start && t < p.plano.end)?.plano.id
    if (!doMomento || !a.fita[0].candidato.planoIds.includes(doMomento)) continue
    // A seguinte ja esta no plano do momento, colada ou sem corte seco: nada a trocar.
    const bNoMomento = b.fita[0]?.candidato.planoIds.includes(doMomento) ?? false
    if (bNoMomento && !b.fita[0]!.termos.some((x) => x.chave === 'mesmoPlano')) continue
    const s = copiarEstado(antesDe[i]!)
    const novaA = casarUma(i, s, doMomento)
    if (!novaA?.fita[0] || novaA.fita[0].candidato.planoIds.includes(doMomento)) continue
    const novaB = casarUma(i + 1, s, null)
    if (notaDe(novaA) + notaDe(novaB) < notaDe(a) + notaDe(b) + TROCA_MINIMA) continue
    refazerDesde(i, doMomento)
  }

  const casadas = feitas.filter((x): x is FraseCasada => x !== null)
  const avisos = casadas.flatMap((c) => c.avisos.map((a) => `${c.escolha.fraseId}: ${a.toLowerCase()}`))
  const guarda = [...naoDividir].filter((i) => !casadas.some((c) => c.escolha.fraseId === e.frases[i]!.id && c.pedacos)).map((i) => e.frases[i]!.id)
  return { casadas, avisos, ...(divisao ? { guarda } : {}) }
}

// ------------------------------------------------- ate 2 cenas: os pedacos

/** Um pedaco de uma frase dividida, pronto para a conta: o contexto DELE e o tempo dele. */
interface PedacoNoCasar {
  texto: string
  palavraInicio: number
  duracao: number
  janela: JanelaDaFrase
  ctx: Omit<ContextoDaFrase, 'anteriores'>
}

interface FraseDividida {
  motivos: MotivoDaDivisao[]
  pedacos: PedacoNoCasar[]
}

/** As cenas de uma escolha fixa, cada uma com o tempo dela na frase (o trecho que ela ocupa de verdade). */
function cenasDaFixa(
  esc: EscolhaDaFrase,
  frase: Pick<Frase, 'id' | 'texto'> | undefined,
  take: Pick<TakeDaVoz, 'trechos' | 'palavras'> | null,
): { candidato: CandidatoDeCena; duracao: number }[] {
  if (!frase || esc.cenas.length <= 1) return esc.cenas.map((c) => ({ candidato: c.candidato, duracao: esc.duracao }))
  const tempos = temposDasCenas(esc, frase, take)
  return esc.cenas.map((c, k) => ({ candidato: c.candidato, duracao: Math.max(0.05, (tempos[k]?.fim ?? esc.duracao) - (tempos[k]?.inicio ?? 0)) }))
}

/**
 * O pedaco que a intencao visual descreve: mais nomes dela no pedaco (vale 2)
 * e mais palavras em comum. Empate: o ULTIMO (a oracao principal: "Quando o
 * Lent implorou pra ficar, o Guy asfixiou o rapaz" -- a intencao e o Guy
 * sufocando o Lent). -1 = frase sem intencao.
 */
export function pedacoDaIntencao(intencao: string, corte: Pick<CorteDaFrase, 'pedacos'>, elenco: Elenco): number {
  if (!intencao.trim() || corte.pedacos.length === 0) return -1
  const quem = citadosNoTexto(intencao, elenco)
  const conteudo = fichasDeConteudo(intencao)
  let melhor = corte.pedacos.length - 1
  let maior = -Infinity
  for (let k = corte.pedacos.length - 1; k >= 0; k--) {
    const p = corte.pedacos[k]!
    const nomes = citadosNoTexto(p.texto, elenco)
    const v =
      2 * quem.filter((c) => nomes.some((x) => bate(c.ficha, x.ficha) || bate(x.ficha, c.ficha))).length +
      emComum(fichasDeConteudo(p.texto), conteudo)
    if (v > maior) {
      maior = v
      melhor = k
    }
  }
  return melhor
}

/**
 * As ancoras dos pedacos na ordem do episodio: o pedaco depois do momento que
 * acharia a dele ANTES (ou o de antes, depois) fica com a do vizinho,
 * rebaixada a estimada -- a conta escolhe o plano em volta, em ordem.
 */
function emOrdem(js: readonly JanelaDaFrase[], kMomento: number): JanelaDaFrase[] {
  const saida = [...js]
  const rebaixada = (j: JanelaDaFrase): JanelaDaFrase => ({ ...j, forte: false, estimada: j.forte || j.estimada })
  for (let k = kMomento + 1; k < saida.length; k++) {
    const a = saida[k - 1]!.ancora
    const b = saida[k]!.ancora
    if (a !== null && b !== null && b < a - 2) saida[k] = rebaixada(saida[k - 1]!)
  }
  for (let k = kMomento - 1; k >= 0; k--) {
    const a = saida[k]!.ancora
    const b = saida[k + 1]!.ancora
    if (a !== null && b !== null && a > b + 2) saida[k] = rebaixada(saida[k + 1]!)
  }
  return saida
}

/** Os sinais com os pedacos: a imagem e as etiquetas da frase vao para o pedaco da intencao (idDoPedaco). */
function sinaisComPedacos(
  s: SinaisDoCasar,
  frases: readonly Pick<Frase, 'id'>[],
  cortes: ReadonlyMap<number, CorteDaFrase>,
  intencaoDe: ReadonlyMap<number, number>,
): SinaisDoCasar {
  if (cortes.size === 0) return s
  const imagem = new Map(s.imagemDaFrase ?? [])
  const tags = new Map(s.tagsDaFrase ?? [])
  for (const i of cortes.keys()) {
    const f = frases[i]!
    const k = intencaoDe.get(i) ?? -1
    if (k < 0) continue
    const id = idDoPedaco(f.id, k)
    const v = s.imagemDaFrase?.get(f.id)
    if (v) imagem.set(id, v)
    const t = s.tagsDaFrase?.get(f.id)
    if (t) tags.set(id, t)
  }
  return { ...s, ...(imagem.size > 0 ? { imagemDaFrase: imagem } : {}), ...(tags.size > 0 ? { tagsDaFrase: tags } : {}) }
}

/**
 * O candidato cobre o pedaco inteiro (no maximo a folga que o encaixe segura
 * sem emendar): senao o encaixe emendaria o plano seguinte -- que muitas vezes
 * e justamente o do pedaco seguinte.
 */
function cobreOPedaco(c: CandidatoPontuado): boolean {
  return c.falta <= FOLGA_SEM_EMENDA_SEC
}

/** Dentro da frase vale a ordem do episodio: o pedaco seguinte depois do anterior, sem plano dele. */
function dentroDaFrase(c: CandidatoPontuado, antes: readonly { c: CandidatoPontuado; duracao: number }[]): boolean {
  const ult = antes[antes.length - 1]
  if (!ult) return true
  const planos = new Set(antes.flatMap((x) => x.c.candidato.planoIds))
  if (c.candidato.planoIds.some((id) => planos.has(id))) return false
  const fim = Math.min(ult.c.candidato.outSec, ult.c.candidato.inSec + ult.duracao)
  return c.candidato.inSec >= fim - 0.05
}

/**
 * A escolha da frase dividida: uma cena por pedaco (na palavra dele), a fita
 * com as melhores de cada pedaco intercaladas (a escolhida de cada um
 * primeiro), a confianca do pedaco mais fraco, os avisos de todos e a fita da
 * frase inteira para o "Juntar em 1".
 */
function escolhaDividida(
  frase: FraseDoCasar,
  janela: JanelaDaFrase,
  d: DuracaoDaFraseDoCasar,
  pedacos: readonly { fita: readonly CandidatoPontuado[]; janela: JanelaDaFrase; palavraInicio: number; texto: string; duracao: number }[],
  inteira: readonly CandidatoPontuado[],
  motivos: MotivoDaDivisao[],
): FraseCasada {
  const fita: CandidatoDeCena[] = []
  const vistos = new Set<string>()
  for (let r = 0; fita.length < FITA_MAX && pedacos.some((p) => p.fita[r]); r++) {
    for (const p of pedacos) {
      const c = p.fita[r]
      if (!c || fita.length >= FITA_MAX || vistos.has(c.candidato.planoIds[0]!)) continue
      vistos.add(c.candidato.planoIds[0]!)
      fita.push(c.candidato)
    }
  }
  const avisos: string[] = []
  for (const p of pedacos) {
    const c = p.fita[0]
    if (!c) continue
    if (c.planos.length > 1) avisos.push('Cena emendada')
    if (c.falta > CONGELA_SEC) avisos.push('Cena curta')
    if (p.janela.semCenas && !p.janela.herdada) avisos.push(AVISO_TRECHO_SEM_CENAS)
    else if (longeDoEvento(c.candidato, p.janela) && !p.janela.herdada) avisos.push(AVISO_LONGE_DO_MOMENTO)
  }
  if (janela.herdada) avisos.push('Sem evento: perto da vizinha')
  else if (janela.intervalos.length === 0) avisos.push('Sem evento')
  const inteiraLivre: CandidatoDeCena[] = []
  const planosDaInteira = new Set<string>()
  for (const c of inteira) {
    if (inteiraLivre.length >= FITA_MAX) break
    if (c.candidato.planoIds.some((id) => planosDaInteira.has(id))) continue
    inteiraLivre.push(c.candidato)
    for (const id of c.candidato.planoIds) planosDaInteira.add(id)
  }
  const confianca = Math.min(...pedacos.map((p) => confiancaDaFita(p.fita, p.janela, !!p.fita[0] && longeDoEvento(p.fita[0].candidato, p.janela))))
  const escolha: EscolhaDaFrase = {
    fraseId: frase.id,
    cenas: pedacos.flatMap((p) => (p.fita[0] ? [{ candidato: p.fita[0].candidato, palavraInicio: p.palavraInicio }] : [])),
    fita,
    confianca: arred(Math.max(0, Math.min(1, confianca)), 2),
    travada: false,
    hashTexto: hashDoTexto(frase.texto),
    duracao: d.duracao,
    avisos: [...new Set(avisos)],
    ...(inteiraLivre.length > 0 ? { inteira: inteiraLivre } : {}),
  }
  return {
    escolha,
    fita: [...(pedacos[0]?.fita ?? [])],
    janela,
    avisos: escolha.avisos,
    pedacos: pedacos.map((p) => ({ texto: p.texto, palavraInicio: p.palavraInicio, duracao: p.duracao, janela: p.janela, fita: [...p.fita] })),
    motivos,
  }
}

// ------------------------------------------------------- C4: o sujeito herdado

/** "ele", "ela", "o cara"...: a frase fala de alguem sem dizer o nome. */
const PRONOME_SINGULAR = /\b(ele|ela|dele|dela|o cara|a garota|o garoto|a menina|o menino|o velho|a velha|o moleque|a mocinha|o rapaz|a moca|a mulher|o homem|o sujeito|a pequena|o pequeno)\b/i
const PRONOME_PLURAL = /\b(eles|elas|deles|delas|os dois|as duas|a dupla)\b/i

/**
 * C4: frase sem nome com pronome herda o SUJEITO da anterior (o roteiro so usa
 * "ele/ela" para retomar o sujeito da frase de antes -- regra do prompt):
 * no singular, o primeiro citado; no plural, ate dois. Sem pronome, ninguem.
 */
export function sujeitoHerdado(texto: string, anteriores: readonly Citado[]): Citado[] {
  if (anteriores.length === 0) return []
  const sem = texto.normalize('NFD').replace(/\p{Mn}/gu, '')
  if (PRONOME_PLURAL.test(sem)) return anteriores.slice(0, 2)
  if (PRONOME_SINGULAR.test(sem)) return anteriores.slice(0, 1)
  return []
}

// --------------------------------------------- C5: a conta do roteiro inteiro

/** Quantos candidatos de cada frase entram na conta do roteiro inteiro. */
const CANDIDATOS_DA_CONTA = 12
/** Quantos caminhos a conta guarda de uma frase para a outra (o feixe). */
const FEIXE = 48

/** Um trecho ja mostrado no caminho: os planos e [de, ate] (segundos do .mkv). */
interface TrechoUsado {
  planoIds: readonly string[]
  de: number
  ate: number
}

interface Caminho {
  nota: number
  /**
   * Por item da conta (frase inteira ou pedaco, na ordem): o candidato, os
   * termos da passagem e se entrou forcado (sem saida). null = sem cena.
   */
  escolhas: ({ c: CandidatoPontuado; passagem: Termo[]; forcado: boolean } | null)[]
  usados: TrechoUsado[]
  anteriores: CenaAnterior[]
}

type DuracaoDaFraseDoCasar = ReturnType<typeof duracaoDaFrase>

function cenaAnterior(
  porId: ReadonlyMap<string, PlanoDoCasar>,
  c: Pick<CandidatoDeCena, 'planoIds' | 'inSec' | 'outSec'>,
  duracao: number,
): CenaAnterior {
  const primeiro = porId.get(c.planoIds[0] ?? '')
  const ultimo = porId.get(c.planoIds[c.planoIds.length - 1] ?? '')
  const fimReal = Math.min(c.outSec, c.inSec + duracao)
  return {
    planoIds: [...c.planoIds],
    inSec: c.inSec,
    fimReal,
    ultimoPos: ultimo?.pos ?? -10,
    chegouAoFim: !!ultimo?.util && fimReal >= ultimo.util.ate - 1,
    gente: primeiro?.gente ?? [],
    genteDoRosto: primeiro?.genteDoRosto ?? false,
  }
}

function trechoDe(c: Pick<CandidatoDeCena, 'planoIds' | 'inSec' | 'outSec'>, duracao: number): TrechoUsado {
  return { planoIds: c.planoIds, de: c.inSec, ate: Math.max(c.inSec + 0.05, Math.min(c.outSec, c.inSec + duracao)) }
}

/** O trecho cruza (com a margem) um trecho usado num plano em comum. */
function cruzaUsado(usados: readonly TrechoUsado[], t: TrechoUsado): boolean {
  return usados.some(
    (u) =>
      u.planoIds.some((id) => t.planoIds.includes(id)) &&
      t.ate > u.de - MARGEM_DO_TRECHO_SEC + 1e-6 &&
      t.de < u.ate + MARGEM_DO_TRECHO_SEC - 1e-6,
  )
}

/** A escolha da frase com os avisos de sempre (os mesmos do guloso). */
function escolhaComAvisos(frase: FraseDoCasar, janela: JanelaDaFrase, fita: CandidatoPontuado[], d: DuracaoDaFraseDoCasar): FraseCasada {
  const primeira = fita[0]
  const longe = !!primeira && longeDoEvento(primeira.candidato, janela)
  const avisos: string[] = []
  if (!primeira) avisos.push('Sem cena no episodio')
  else {
    if (primeira.repetido) avisos.push('Cena repetida')
    if (primeira.planos.length > 1) avisos.push('Cena emendada')
    if (primeira.falta > CONGELA_SEC) avisos.push('Cena curta')
    if (janela.semCenas && !janela.herdada) avisos.push(AVISO_TRECHO_SEM_CENAS)
    else if (longe && !janela.herdada) avisos.push(AVISO_LONGE_DO_MOMENTO)
  }
  if (janela.herdada) avisos.push('Sem evento: perto da vizinha')
  else if (janela.intervalos.length === 0) avisos.push('Sem evento')
  if (primeira && fita.length < FITA_MAX) avisos.push(`So ${fita.length} opcoes`)
  const escolha: EscolhaDaFrase = {
    fraseId: frase.id,
    cenas: primeira ? [{ candidato: primeira.candidato, palavraInicio: 0 }] : [],
    fita: fita.map((c) => c.candidato),
    confianca: confiancaDaFita(fita, janela, longe),
    travada: false,
    hashTexto: hashDoTexto(frase.texto),
    duracao: d.duracao,
    avisos,
  }
  return { escolha, fita, janela, avisos }
}

/** O que a conta precisa do casarFrases (calculado uma vez por chamada). */
interface ContextoDaConta {
  e: EntradaDoCasar
  todos: readonly PlanoDoCasar[]
  porId: ReadonlyMap<string, PlanoDoCasar>
  janelas: readonly JanelaDaFrase[]
  fixo: readonly { d: DuracaoDaFraseDoCasar; ctx: Omit<ContextoDaFrase, 'anteriores'> }[]
  fraseDe: ReadonlyMap<string, FraseDoCasar>
  /** A fita da frase inteira (sem as anteriores), CANDIDATOS_DA_CONTA. */
  inteiraDe: (i: number) => CandidatoPontuado[]
  /** O plano do momento da frase seguinte, que o pedaco de depois nao pega. */
  momentoSeguinte: (i: number) => string | null
  /** Os trechos das fixas (as listas dos pedacos comecam sem eles). */
  ocupacaoInicial: Ocupacao
}

/** Um item da conta: uma frase inteira ou um pedaco de uma frase dividida. */
interface ItemDaConta {
  /** A frase (indice no roteiro). */
  i: number
  /** O pedaco (0 = o primeiro, ou a frase inteira). */
  k: number
  /** Quantos pedacos a frase tem (1 = inteira). */
  n: number
  duracao: number
  janela: JanelaDaFrase
  ctx: Omit<ContextoDaFrase, 'anteriores'>
  lista: CandidatoPontuado[]
  palavraInicio: number
  texto: string
}

/**
 * C5: o melhor conjunto de uma vez. Uma programacao dinamica em FEIXE (Viterbi
 * com os FEIXE melhores caminhos): "sem repetir" e "nao 3x a mesma gente"
 * dependem do caminho inteiro, e um Viterbi puro (so a frase anterior como
 * estado) nao enxerga isso. Cada frase tem ate CANDIDATOS_DA_CONTA candidatos
 * com a nota de sempre (janela, fala, pessoa, o que se ve, duracao no take);
 * a passagem de uma frase para a outra soma a cronologia (voltar no episodio
 * custa), a continuidade, a variedade e o reuso de plano. Trecho ja mostrado
 * no caminho nao entra -- so quando a frase nao tem outra saida, com
 * "repetida". As escolhas que ficam (travadas, feitas a mao, em dia) sao
 * pontos FIXOS: entram no caminho como estao (todas as cenas delas). Substitui
 * a troca local.
 *
 * Frase dividida (ate 2 cenas): cada pedaco e um ITEM da sequencia, com a
 * propria lista; a variedade e a cronologia valem entre os pedacos tambem. O
 * pedaco seguinte vem depois do anterior no episodio, sem plano dele e sem o
 * plano do momento da frase seguinte. `fracas` = as frases cujo pedaco ficou
 * sem saida boa (forcado, repetido, longe do momento): a guarda desfaz.
 */
function casarPelaConta(
  x: ContextoDaConta,
  divididas: ReadonlyMap<number, FraseDividida>,
): { resultado: ResultadoDoCasar; fracas: number[] } {
  const { e, porId, janelas, fixo, inteiraDe } = x
  const n = e.frases.length
  // Os trechos das fixas ocupam desde o comeco (como no guloso).
  const usadosFixos: TrechoUsado[] = []
  for (const [fraseId, esc] of e.fixas) {
    if (e.refazer.has(fraseId)) continue
    for (const c of cenasDaFixa(esc, x.fraseDe.get(fraseId), e.take)) usadosFixos.push(trechoDe(c.candidato, c.duracao))
  }
  // Os itens, na ordem: a frase inteira, ou um por pedaco; a lista de cada um sem as anteriores (a passagem conta a parte).
  const itens: ItemDaConta[] = []
  const passos: ({ fixa: number } | { item: number })[] = []
  for (let i = 0; i < n; i++) {
    const frase = e.frases[i]!
    if (!e.refazer.has(frase.id)) {
      passos.push({ fixa: i })
      continue
    }
    const dv = divididas.get(i)
    if (dv) {
      dv.pedacos.forEach((p, k) => {
        passos.push({ item: itens.length })
        itens.push({
          i,
          k,
          n: dv.pedacos.length,
          duracao: p.duracao,
          janela: p.janela,
          ctx: p.ctx,
          lista: listaDoPedaco(x, i, k, p),
          palavraInicio: p.palavraInicio,
          texto: p.texto,
        })
      })
    } else {
      passos.push({ item: itens.length })
      itens.push({ i, k: 0, n: 1, duracao: fixo[i]!.d.duracao, janela: janelas[i]!, ctx: fixo[i]!.ctx, lista: inteiraDe(i), palavraInicio: 0, texto: frase.texto })
    }
  }

  let feixe: Caminho[] = [{ nota: 0, escolhas: [], usados: usadosFixos, anteriores: [] }]
  // A ancora do item anterior que tem cena (fixa ou a refazer).
  let ancoraAntes: number | null = null
  for (const passo of passos) {
    if ('fixa' in passo) {
      const frase = e.frases[passo.fixa]!
      const fixa = e.fixas.get(frase.id)
      if (!fixa) continue
      const cenas = cenasDaFixa(fixa, frase, e.take)
      feixe = feixe.map((k) => ({ ...k, anteriores: [...k.anteriores, ...cenas.map((c) => cenaAnterior(porId, c.candidato, c.duracao))] }))
      ancoraAntes = janelas[passo.fixa]!.ancora
      continue
    }
    const x0 = passo.item
    const item = itens[x0]!
    if (item.lista.length === 0) {
      feixe = feixe.map((k) => ({ ...k, escolhas: [...k.escolhas, null] }))
      ancoraAntes = item.janela.ancora
      continue
    }
    const evitar = item.n > 1 && item.k > 0 ? x.momentoSeguinte(item.i) : null
    const proximos: Caminho[] = []
    for (const k of feixe) {
      // Os pedacos anteriores DESTA frase neste caminho.
      const daFrase = item.k === 0 ? [] : k.escolhas.slice(x0 - item.k, x0).flatMap((y, j) => (y ? [{ c: y.c, duracao: itens[x0 - item.k + j]!.duracao }] : []))
      const pode = (c: CandidatoPontuado): boolean => dentroDaFrase(c, daFrase) && !(evitar !== null && c.candidato.planoIds.includes(evitar))
      const livres = item.lista.filter((c) => pode(c) && !cruzaUsado(k.usados, trechoDe(c.candidato, item.duracao)))
      const opcoes =
        livres.length > 0
          ? livres.map((c) => ({ c, forcado: false }))
          : (item.n > 1 && item.lista.some(pode) ? item.lista.filter(pode) : item.lista).map((c) => ({ c, forcado: true }))
      for (const { c, forcado } of opcoes) {
        const repetido = c.repetido || forcado
        const fimReal = Math.min(c.candidato.outSec, c.candidato.inSec + item.duracao)
        const reusado = !repetido && k.usados.some((u) => u.planoIds.some((id) => c.candidato.planoIds.includes(id)))
        const passagem = termosDaSequencia(c.planos, c.candidato.inSec, fimReal, item.ctx, k.anteriores, reusado, ancoraAntes)
        if (forcado && !c.repetido) passagem.push({ chave: 'repetida', valor: PESOS.repetida, rotulo: 'repetida' })
        proximos.push({
          nota: k.nota + c.candidato.nota + passagem.reduce((s, t) => s + t.valor, 0),
          escolhas: [...k.escolhas, { c: forcado && !c.repetido ? { ...c, repetido: true } : c, passagem, forcado }],
          usados: [...k.usados, trechoDe(c.candidato, item.duracao)],
          anteriores: [...k.anteriores, cenaAnterior(porId, c.candidato, item.duracao)],
        })
      }
    }
    proximos.sort((a, b) => b.nota - a.nota)
    feixe = proximos.slice(0, FEIXE)
    ancoraAntes = item.janela.ancora
  }

  const melhor = feixe[0]!
  /** Os trechos que os itens mostram no caminho escolhido (o resto da fita de cada um nao cruza os dos outros). */
  const trechoDoItem = (y: number): TrechoUsado | null => {
    const esc = melhor.escolhas[y]
    return esc ? trechoDe(esc.c.candidato, itens[y]!.duracao) : null
  }
  /** A fita do item: a escolhida (com a passagem) e os outros candidatos que nenhum outro item mostra. */
  const fitaDoItem = (y: number): CandidatoPontuado[] => {
    const esc = melhor.escolhas[y] ?? null
    const item = itens[y]!
    const fita: CandidatoPontuado[] = []
    if (!esc) return fita
    const termos = [...esc.c.termos, ...esc.passagem]
    const nota = arred(termos.reduce((s, t) => s + t.valor, 0), 2)
    fita.push({ ...esc.c, termos, candidato: { ...esc.c.candidato, nota, porque: porqueDosTermos(termos) } })
    const dosOutros = itens.flatMap((_, z) => (z !== y ? [trechoDoItem(z)] : [])).filter((t): t is TrechoUsado => t !== null)
    const ocupados = new Set(esc.c.candidato.planoIds)
    for (const c of item.lista) {
      if (fita.length >= FITA_MAX) break
      if (c.candidato.planoIds.some((id) => ocupados.has(id))) continue
      if (cruzaUsado([...usadosFixos, ...dosOutros], trechoDe(c.candidato, item.duracao))) continue
      fita.push(c)
      for (const id of c.candidato.planoIds) ocupados.add(id)
    }
    return fita
  }

  const casadas: FraseCasada[] = []
  const fracas: number[] = []
  for (let i = 0; i < n; i++) {
    const frase = e.frases[i]!
    if (!e.refazer.has(frase.id)) continue
    const ys = itens.flatMap((it, y) => (it.i === i ? [y] : []))
    const d = fixo[i]!.d
    const dv = divididas.get(i)
    if (!dv) {
      casadas.push(escolhaComAvisos(frase, janelas[i]!, fitaDoItem(ys[0]!), d))
      continue
    }
    // Pedaco sem cena, forcado (repetido ou fora da ordem) ou longe do momento: metade fraca.
    const fraca = ys.some((y) => {
      const esc = melhor.escolhas[y]
      return !esc || esc.forcado || esc.c.repetido || longeDoEvento(esc.c.candidato, itens[y]!.janela)
    })
    if (fraca) fracas.push(i)
    const pedacos = ys.map((y) => ({
      fita: fitaDoItem(y),
      janela: itens[y]!.janela,
      palavraInicio: itens[y]!.palavraInicio,
      texto: itens[y]!.texto,
      duracao: itens[y]!.duracao,
    }))
    // O "Juntar em 1": a fita da frase inteira, sem o que as OUTRAS frases mostram.
    const dosOutros = itens.flatMap((it, z) => (it.i !== i ? [trechoDoItem(z)] : [])).filter((t): t is TrechoUsado => t !== null)
    const inteira = inteiraDe(i).filter((c) => !cruzaUsado([...usadosFixos, ...dosOutros], trechoDe(c.candidato, d.duracao)))
    casadas.push(escolhaDividida(frase, janelas[i]!, d, pedacos, inteira, dv.motivos))
  }
  const avisos = casadas.flatMap((c) => c.avisos.map((a) => `${c.escolha.fraseId}: ${a.toLowerCase()}`))
  return { resultado: { casadas, avisos }, fracas }
}

/** A lista de um pedaco na conta (uma vez por frase e pedaco: a guarda roda a conta de novo). */
const listasDosPedacos = new WeakMap<ContextoDaConta, Map<string, CandidatoPontuado[]>>()
function listaDoPedaco(x: ContextoDaConta, i: number, k: number, p: PedacoNoCasar): CandidatoPontuado[] {
  let mapa = listasDosPedacos.get(x)
  if (!mapa) {
    mapa = new Map()
    listasDosPedacos.set(x, mapa)
  }
  const chave = `${i}/${k}`
  const pronta = mapa.get(chave)
  if (pronta) return pronta
  // As fixas ja ocupam: a fita do pedaco comeca sem os trechos delas, como a da frase inteira.
  const lista = fitaDaFrase(x.todos, { ...p.ctx, anteriores: [] }, x.e.eventos, x.ocupacaoInicial, x.e.indice.id, CANDIDATOS_DA_CONTA).filter(cobreOPedaco)
  mapa.set(chave, lista)
  return lista
}
