import type { Cue, EpisodeIndex, Plano } from '../../shared/episodio'
import { cuesDoEvento, momentoDaFrase, type Evento, type Frase } from '../../shared/roteiro'
import { hashDoTexto, type TakeDaVoz } from '../../shared/voz'
import {
  AVISO_LONGE_DO_MOMENTO,
  AVISO_TRECHO_SEM_CENAS,
  duracaoDaFrase,
  FITA_MAX,
  PORQUE_MAX,
  type CandidatoDeCena,
  type EscolhaDaFrase,
} from '../../shared/cenas'

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
} as const

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

/** As fichas que identificam a pessoa (3+ letras, nao genericas). */
export function fichasFortes(nome: string): string[] {
  return fichasDe(nome).filter((f) => f.length >= 3 && !FICHAS_FRACAS.has(f) && !/^\d+$/.test(f))
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
    const rostos = plano.personagens.map((x) => ({ nome: x.nome, fichas: fichasFortes(x.nome), conf: x.conf }))
    const falas = plano.falantes.flatMap(falantesDe).map((nome) => ({ nome, fichas: fichasFortes(nome), conf: 1 }))
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
}

export function elencoDoEpisodio(planos: readonly PlanoDoCasar[], indice: Pick<EpisodeIndex, 'cues'>, eventos: readonly Pick<Evento, 'personagens'>[]): Elenco {
  const nomes = new Set<string>()
  for (const p of planos) {
    for (const r of p.rostos) nomes.add(r.nome)
    for (const f of p.falas) nomes.add(f.nome)
  }
  for (const c of indice.cues) if (c.falante) for (const f of falantesDe(c.falante)) nomes.add(f)
  for (const e of eventos) for (const n of e.personagens) nomes.add(n)
  const nomesDaFicha = new Map<string, Set<string>>()
  for (const nome of nomes) {
    for (const f of fichasFortes(nome)) {
      const s = nomesDaFicha.get(f) ?? new Set<string>()
      s.add(nome)
      nomesDaFicha.set(f, s)
    }
  }
  return { nomesDaFicha }
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
    const f = fichas[0]!
    if (f.length < 3 || FICHAS_FRACAS.has(f)) continue
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
    const nomes = [...nomesDe(f)].map(fichasFortes)
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
): { evento: Evento; cue: Cue | null } {
  const textoTodo = `${frase.texto} ${frase.intencaoVisual}`
  const daFrase = fichasDeConteudo(textoTodo)
  let evento = citados[0]!
  let melhor = -1
  for (const e of citados) {
    const n = emComum(daFrase, fichasDeConteudo(`${e.resumo} ${e.personagens.join(' ')}`))
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
      0.5 * Math.min(2, emComum(semNomes, fichasDeConteudo(c.texto)))
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
): JanelaDaFrase | null {
  const porId = new Map(eventos.map((e) => [e.id, e]))
  const citados = frase.eventoIds.map((id) => porId.get(id)).filter((e): e is Evento => e !== undefined)
  if (citados.length === 0) return null
  const m = momentoDaFrase(frase, eventos, indice)
  const cuePorId = new Map(indice.cues.map((c) => [c.id, c]))
  let cue = m ? (cuePorId.get(m.cueId) ?? null) : null
  let ancora = m?.t ?? null
  const forte = !!cue && (cue.id === frase.citacaoCueId || cue.id === frase.cueDoMomento)
  let estimada = false
  if (!forte && frase.texto !== undefined) {
    const achada = ancoraPelasPalavras({ texto: frase.texto, intencaoVisual: frase.intencaoVisual ?? '' }, citados, indice, elenco)
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
  // O indice nao tem cena nenhuma no trecho: a ancora vai para o ponto mais
  // perto que tem cena (o fim do corte, quando o trecho e o epilogo).
  const perto = intervalos.map((i) => ({ de: i.de - 8, ate: i.ate + 8 }))
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
): JanelaDaFrase[] {
  const elenco = elencoDoEpisodio(planos, indice, eventos)
  const proprias = frases.map((f) => janelaPropria(f, eventos, indice, planos, elenco))
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
          : util.de
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
    const dist = distancia(de, ate, ponto)
    const nivel = j.forte ? 'forte' : j.estimada ? 'estimada' : 'fraca'
    const peso = { forte: PESOS.centroForte, estimada: PESOS.centroEstimado, fraca: PESOS.centroFraco }[nivel]
    const queda = { forte: PESOS.quedaForte, estimada: PESOS.quedaEstimada, fraca: PESOS.quedaFraca }[nivel]
    const centro = peso * Math.exp(-dist / queda) * fator
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

  // 5. Cronologia, continuidade e variedade (desempate). Trecho sem cenas:
  // a frase nao esta "em frente" de nada (o momento dela nao tem cena), entao
  // seguir em frente e continuar o plano anterior nao contam.
  const ant = ctx.anteriores[ctx.anteriores.length - 1]
  if (ant) {
    const fraseVaiEmFrente = j.ancora === null || j.ancora >= ant.inSec - 2
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
    const ant2 = ctx.anteriores[ctx.anteriores.length - 2]
    if (mesmaGente(primeiro.gente, ant.gente)) {
      const tres = !!ant2 && mesmaGente(primeiro.gente, ant2.gente)
      if (tres && (primeiro.genteDoRosto || ant.genteDoRosto || ant2.genteDoRosto)) add('variedade', PESOS.repeteRosto, 'repete rosto')
      else if (primeiro.gente.length === 1 && !colado && (primeiro.genteDoRosto || ant.genteDoRosto)) {
        add('variedade', PESOS.repeteRostoSeguido, 'repete rosto')
      }
    }
  }

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
  const saida: string[] = []
  if (herdada) saida.push('sem evento')
  for (const t of pos) {
    if (saida.length >= PORQUE_MAX) break
    if (unico(t)) saida.push(t.rotulo)
  }
  return saida.map((r) => ascii(r).slice(0, 32)).filter(Boolean).slice(0, PORQUE_MAX)
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
): CandidatoPontuado[] {
  const niveis = niveisDaJanela(ctx.janela, eventos)
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
        const nota = arred(termos.reduce((s, t) => s + t.valor, 0), 2)
        const candidato: CandidatoDeCena = {
          planoIds: w.planos.map((q) => q.plano.id),
          episodioId,
          inSec: arred(w.inSec),
          outSec: arred(w.outSec),
          nota,
          porque: porqueDosTermos(termos),
          origem: 'sugestao',
          keyframe: w.planos[0]!.plano.keyframe,
        }
        return { candidato, planos: w.planos, termos, repetido, falta }
      })
      pontuados.sort((a, b) => b.candidato.nota - a.candidato.nota || a.candidato.inSec - b.candidato.inSec)
      const fita: CandidatoPontuado[] = []
      const ocupados = new Set<string>()
      for (const c of pontuados) {
        if (c.candidato.planoIds.some((id) => ocupados.has(id))) continue
        fita.push(c)
        for (const id of c.candidato.planoIds) ocupados.add(id)
        if (fita.length >= FITA_MAX) break
      }
      melhor = fita
      if (fita.length >= FITA_MAX || ultimo) break
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
  take: Pick<TakeDaVoz, 'trechos'> | null
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
}

export interface FraseCasada {
  escolha: EscolhaDaFrase
  /** A fita pontuada inteira, com os termos (o teste e a depuracao leem). */
  fita: CandidatoPontuado[]
  janela: JanelaDaFrase
  avisos: string[]
}

export interface ResultadoDoCasar {
  /** So as frases de `refazer`, na ordem do roteiro. */
  casadas: FraseCasada[]
  /** Recados ASCII ("f07: cena repetida"). */
  avisos: string[]
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
 */
export function casarFrases(e: EntradaDoCasar): ResultadoDoCasar {
  const todos = prepararPlanos(e.indice)
  const porId = new Map(todos.map((p) => [p.plano.id, p]))
  const elenco = elencoDoEpisodio(todos, e.indice, e.eventos)
  const janelas = janelasDasFrases(e.frases, e.eventos, e.indice, todos)
  const cuePorId = new Map(e.indice.cues.map((c) => [c.id, c]))
  const abremEscuro = e.abremEscuro ?? new Set<string>()

  const lembrar = (s: EstadoDoCasar, c: Pick<CandidatoDeCena, 'planoIds' | 'inSec' | 'outSec'>, duracao: number): void => {
    const primeiro = porId.get(c.planoIds[0] ?? '')
    const ultimo = porId.get(c.planoIds[c.planoIds.length - 1] ?? '')
    const fimReal = Math.min(c.outSec, c.inSec + duracao)
    s.anteriores.push({
      planoIds: [...c.planoIds],
      inSec: c.inSec,
      fimReal,
      ultimoPos: ultimo?.pos ?? -10,
      chegouAoFim: !!ultimo?.util && fimReal >= ultimo.util.ate - 1,
      gente: primeiro?.gente ?? [],
      genteDoRosto: primeiro?.genteDoRosto ?? false,
    })
  }

  const inicial: EstadoDoCasar = { ocupacao: new Map(), anteriores: [] }
  for (const [fraseId, esc] of e.fixas) {
    if (e.refazer.has(fraseId)) continue
    for (const c of esc.cenas) ocupar(inicial.ocupacao, c.candidato, esc.duracao)
  }

  // O que nao muda com as escolhas das outras frases: quem a frase cita, o que pede, quanto dura.
  const fixo = e.frases.map((frase, i) => {
    const citados = citadosNoTexto(frase.texto, elenco)
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
      } satisfies Omit<ContextoDaFrase, 'anteriores'>,
    }
  })

  /**
   * Uma frase no estado `s` (que ela atualiza). `evitar` = a troca local: a
   * melhor da fita que NAO usa esse plano vai na frente. null = frase fixa.
   */
  const casarUma = (i: number, s: EstadoDoCasar, evitar: string | null): FraseCasada | null => {
    const frase = e.frases[i]!
    const janela = janelas[i]!
    if (!e.refazer.has(frase.id)) {
      const fixa = e.fixas.get(frase.id)
      const ultima = fixa?.cenas[fixa.cenas.length - 1]
      if (fixa && ultima) lembrar(s, ultima.candidato, fixa.duracao)
      return null
    }
    const { d, ctx: base } = fixo[i]!
    const ctx: ContextoDaFrase = { ...base, anteriores: s.anteriores }
    const pontuada = fitaDaFrase(todos, ctx, e.eventos, s.ocupacao, e.indice.id)
    const k = evitar ? pontuada.findIndex((c) => !c.candidato.planoIds.includes(evitar)) : 0
    const fita = k > 0 ? [pontuada[k]!, ...pontuada.filter((_, x) => x !== k)] : pontuada
    const primeira = fita[0]
    const longe = !!primeira && longeDoEvento(primeira.candidato, janela)
    const avisosDaFrase: string[] = []
    if (!primeira) avisosDaFrase.push('Sem cena no episodio')
    else {
      ocupar(s.ocupacao, primeira.candidato, d.duracao)
      lembrar(s, primeira.candidato, d.duracao)
      if (primeira.repetido) avisosDaFrase.push('Cena repetida')
      if (primeira.planos.length > 1) avisosDaFrase.push('Cena emendada')
      if (primeira.falta > CONGELA_SEC) avisosDaFrase.push('Cena curta')
      if (janela.semCenas && !janela.herdada) avisosDaFrase.push(AVISO_TRECHO_SEM_CENAS)
      else if (longe && !janela.herdada) avisosDaFrase.push(AVISO_LONGE_DO_MOMENTO)
    }
    if (janela.herdada) avisosDaFrase.push('Sem evento: perto da vizinha')
    else if (janela.intervalos.length === 0) avisosDaFrase.push('Sem evento')
    if (primeira && fita.length < FITA_MAX) avisosDaFrase.push(`So ${fita.length} opcoes`)

    const escolha: EscolhaDaFrase = {
      fraseId: frase.id,
      cenas: primeira ? [{ candidato: primeira.candidato, palavraInicio: 0 }] : [],
      fita: fita.map((c) => c.candidato),
      confianca: confiancaDaFita(fita, janela, longe),
      travada: false,
      hashTexto: hashDoTexto(frase.texto),
      duracao: d.duracao,
      avisos: avisosDaFrase,
    }
    return { escolha, fita, janela, avisos: avisosDaFrase }
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

  // A troca local, frase a frase.
  const notaDe = (x: FraseCasada | null): number => x?.fita[0]?.candidato.nota ?? 0
  for (let i = 0; i + 1 < n; i++) {
    const a = feitas[i]
    const b = feitas[i + 1]
    const jb = janelas[i + 1]!
    if (!a?.fita[0] || !b || !jb.cueAncora || !(jb.forte || jb.estimada) || jb.semCenas || jb.herdada) continue
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
  return { casadas, avisos }
}
