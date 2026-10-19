/**
 * [recap] O que o passo 4 VE das cenas (lote 2 das ideias do Levi, C1-C3 e C7):
 * os tipos e as contas puras. Quem calcula os vetores e o motor (modo `cenas`,
 * motor/app/cenas.py) e o etiquetador do nucleo (electron/services/tagger.ts);
 * quem guarda e electron/cenas/visao.ts; quem usa e o casar (cenas/casar.ts).
 *
 * Tudo opcional: sem motor, sem modelo ou sem etiqueta, o casar fica como era.
 */

/** Um keyframe do plano: o motor tira 3, a 25%, 50% e 75% do plano (keyframe_extractor.py). */
export interface QuadroDaVisao {
  /** 0, 1 ou 2 (o sufixo _k.jpg). */
  k: number
  /** Onde o quadro cai dentro do plano, 0..1 (k=0 -> 0,25). */
  pos: number
  arquivo: string
  /** CLIP ViT-L/14 da imagem, L2-normalizado. null = sem vetor (CPU pulou, arquivo sumiu). */
  vetor: Float32Array | null
  /** Nota de beleza do LAION aesthetic predictor (~1..10). */
  beleza: number | null
  /** Variancia do Laplaciano (quadro reduzido a 640 px). Baixa = borrado ou transicao. */
  nitidez: number | null
}

/** Os sinais que o casar usa. Cada mapa ausente = aquela camada fica de fora. */
export interface SinaisDoCasar {
  /** C2/C7: os keyframes de cada plano (planoId). */
  quadros?: ReadonlyMap<string, readonly QuadroDaVisao[]>
  /** C2: o CLIP da `visualEn` de cada frase (fraseId). */
  imagemDaFrase?: ReadonlyMap<string, Float32Array>
  /**
   * (4a rodada) O CLIP da consulta da PONTE VISUAL (consultaVisual) de cada frase
   * e de cada pedaco (fraseId ou idDoPedaco): o alvo de imagem de quem nao tem a
   * `visualEn` da IA. Vale menos que ela.
   */
  imagemDaPonte?: ReadonlyMap<string, Float32Array>
  /** C1: o sentido (multilingual-e5-small) do texto de cada frase e de cada fala (cueId). */
  sentidoDaFrase?: ReadonlyMap<string, Float32Array>
  sentidoDaCue?: ReadonlyMap<string, Float32Array>
  /** C3: as etiquetas do WD-Tagger de cada plano (da mais confiante para a menos) e as da frase. */
  tagsDoPlano?: ReadonlyMap<string, readonly string[]>
  /**
   * C3 (19/10): a CONFIANCA (0..1) de cada etiqueta do plano, planoId -> tag
   * normalizada -> p (etiquetarComConfianca do nucleo). Plano ausente = o
   * visao.json de antes, sem confianca: a etiqueta vale pela posicao na lista.
   */
  confiancaDasTags?: ReadonlyMap<string, ReadonlyMap<string, number>>
  tagsDaFrase?: ReadonlyMap<string, readonly string[]>
}

/** As camadas ligadas (a config "Cenas" e a medicao desligam uma a uma). */
export interface CamadasDoCasar {
  /** C2: busca pela imagem (CLIP). */
  imagem: boolean
  /** C1: busca por sentido (nota e ancora). */
  sentido: boolean
  /** C3: etiquetas. */
  tags: boolean
  /** C4: personagem como regra forte, o "ele/ela" herdado e as duas pessoas. */
  personagemForte: boolean
  /** C5: a conta do roteiro inteiro (em vez do guloso com troca local). */
  conta: boolean
  /** C7: o melhor trecho dentro do plano longo. */
  melhorQuadro: boolean
}

export const CAMADAS_PADRAO: CamadasDoCasar = {
  imagem: true,
  sentido: true,
  tags: true,
  personagemForte: true,
  conta: true,
  melhorQuadro: true,
}

/** As camadas de antes do lote 2 (o casar v0 inteiro): o teste e a medicao comparam. */
export const CAMADAS_DESLIGADAS: CamadasDoCasar = {
  imagem: false,
  sentido: false,
  tags: false,
  personagemForte: false,
  conta: false,
  melhorQuadro: false,
}

export function produtoInterno(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!
  return s
}

/** Media e desvio de uma lista (desvio minimo 1e-6: lista constante nao divide por zero). */
export function mediaEDesvio(xs: readonly number[]): { media: number; desvio: number } {
  if (xs.length === 0) return { media: 0, desvio: 1 }
  const media = xs.reduce((s, x) => s + x, 0) / xs.length
  const v = xs.reduce((s, x) => s + (x - media) ** 2, 0) / xs.length
  return { media, desvio: Math.max(1e-6, Math.sqrt(v)) }
}

/**
 * A forca 0..1 de um sinal medido em desvios acima da media do episodio:
 * abaixo de `de` desvios nao conta (o parecido "de sempre"), em `ate` vale
 * inteiro. O cosseno cru do CLIP e do e5 anda numa faixa estreita (0,15-0,30 e
 * 0,75-0,93): o que diz algo e quanto o plano se destaca dos outros.
 */
export function forcaDoDesvio(z: number, de = 1, ate = 3): number {
  return Math.max(0, Math.min(1, (z - de) / (ate - de)))
}

/** "Long_Hair" -> "long hair": a forma do selected_tags.csv sem o sublinhado, minusculas. */
export function normalizarTag(t: string): string {
  return t.replace(/_/g, ' ').trim().toLowerCase()
}

/**
 * Etiquetas que nao ajudam a achar a cena (aparencia e contagem de gente): o
 * idf ja derruba as comuns, estas saem de vez.
 */
const TAGS_FRACAS = new Set([
  '1girl', '1boy', '2girls', '2boys', '3girls', '3boys', 'multiple girls', 'multiple boys', 'solo', 'solo focus',
  'long hair', 'short hair', 'medium hair', 'looking at viewer', 'blush', 'open mouth', 'closed mouth', 'bangs',
  'brown hair', 'black hair', 'blonde hair', 'white hair', 'red hair', 'blue hair', 'pink hair', 'green hair',
  'purple hair', 'grey hair', 'blue eyes', 'red eyes', 'brown eyes', 'green eyes', 'yellow eyes', 'purple eyes',
  'anime coloring', 'parody', 'male focus', 'upper body', 'portrait', 'hair between eyes', 'shirt', 'jacket',
])

export function tagUtil(t: string): boolean {
  return t.length > 1 && !TAGS_FRACAS.has(t)
}

// ------------------------------------------ a confianca da etiqueta (19/10)

/**
 * Abaixo desta confianca a etiqueta nao conta na escolha (C3). O etiquetador
 * guarda tudo acima de 0,35 (o corte do autor do modelo). Conferido olhando os
 * keyframes do MRM E02 e do Nia E01, nas etiquetas que as frases pedem: de
 * 0,35 a 0,40 acertam ~2 em 3 (os erros: "bed" numa tela de cristal, "lying"
 * na cama vazia, "close-up" no quadro borrado da transicao, "sunlight" no
 * ceu); de 0,40 a 0,45, ~3 em 4; de 0,45 a 0,5, ~85%; acima, quase todas.
 * Mais alto joga fora etiqueta que ainda acerta e mexe na conta do roteiro:
 * a 0,45 (e a 0,50 e 0,55) o f06 do Nia trocava o corredor da mansao por um
 * lustre no escuro; a 0,35 e 0,40 nenhuma cena muda nos dois.
 */
export const TAG_CORTE = 0.4
/** A partir daqui a etiqueta vale inteira. */
export const TAG_CHEIA = 0.85
/**
 * O corte do ASSUNTO (o objeto na mao, objetosDasTags): o do proprio
 * etiquetador, sem corte a mais. Os objetos acertam ate com pouca confianca
 * ("paper" de 0,41 a 0,49 e o "holding" do Lent com o papel, 0,35 e 0,39: todos
 * certos) e perder um traz a repeticao de volta: a 0,40 o 0133 deixa de ser
 * "Lent com o papel" e o f10 do MRM E02 vira a 3a cena seguida com o papel.
 */
export const TAG_CORTE_DO_ASSUNTO = 0.35

/**
 * O peso 0..1 de uma etiqueta do plano na escolha. Com a confianca `p`: 0
 * abaixo de TAG_CORTE, de 0,5 (no corte) a 1 (TAG_CHEIA). Sem ela (o visao.json
 * de antes): pela posicao na lista das 20 mais confiantes, a 1a vale 1 e a 20a
 * ~0,5 -- a conta de sempre.
 */
export function pesoDaTag(p: number | undefined, posicao: number): number {
  if (p === undefined || !Number.isFinite(p)) return 1 - (0.5 * posicao) / 20
  if (p < TAG_CORTE) return 0
  return 0.5 + 0.5 * Math.min(1, (p - TAG_CORTE) / (TAG_CHEIA - TAG_CORTE))
}

/** As etiquetas do plano que contam, normalizadas, com o peso (pesoDaTag > 0). A 1a vez de cada uma vale. */
export function tagsComPeso(tags: readonly string[], confianca: ReadonlyMap<string, number> | undefined): Map<string, number> {
  const saida = new Map<string, number>()
  tags.forEach((bruta, i) => {
    const t = normalizarTag(bruta)
    if (saida.has(t)) return
    const peso = pesoDaTag(confianca?.get(t), i)
    if (peso > 0) saida.set(t, peso)
  })
  return saida
}

/** As etiquetas do plano para o ASSUNTO: todas sem confianca; com ela, so a partir de TAG_CORTE_DO_ASSUNTO. */
export function tagsDoAssunto(tags: readonly string[], confianca: ReadonlyMap<string, number> | undefined): string[] {
  if (!confianca) return [...tags]
  return tags.filter((t) => (confianca.get(normalizarTag(t)) ?? 1) >= TAG_CORTE_DO_ASSUNTO)
}

/** A confianca gravada (tags e p na mesma ordem) no formato do casar. Listas tortas ficam de fora. */
export function confiancaDasTagsGravadas(
  tags: Readonly<Record<string, readonly string[]>>,
  confiancas: Readonly<Record<string, readonly number[]>>,
): Map<string, Map<string, number>> {
  const saida = new Map<string, Map<string, number>>()
  for (const [id, lista] of Object.entries(tags)) {
    const ps = confiancas[id]
    if (!Array.isArray(ps) || ps.length !== lista.length) continue
    const m = new Map<string, number>()
    lista.forEach((t, i) => {
      const k = normalizarTag(t)
      if (!m.has(k)) m.set(k, Number(ps[i]))
    })
    saida.set(id, m)
  }
  return saida
}

/** O rotulo do "porque" para as etiquetas mais comuns de acao, objeto e lugar. O resto vai em ingles. */
const TAG_PT: Readonly<Record<string, string>> = {
  punching: 'soco', fighting: 'luta', 'fighting stance': 'luta', kick: 'chute', kicking: 'chute', fight: 'luta',
  crying: 'choro', tears: 'choro', smile: 'sorriso', smiling: 'sorriso', laughing: 'riso', angry: 'raiva',
  surprised: 'susto', shouting: 'grito', screaming: 'grito', running: 'corrida', eating: 'comendo', food: 'comida',
  sword: 'espada', weapon: 'arma', gun: 'arma', 'holding sword': 'espada', explosion: 'explosao', fire: 'fogo',
  blood: 'sangue', night: 'noite', 'night sky': 'noite', moon: 'lua', sky: 'ceu', cloud: 'nuvem', rain: 'chuva',
  sea: 'mar', ocean: 'mar', forest: 'floresta', tree: 'arvore', building: 'predio', city: 'cidade', bed: 'cama',
  'on bed': 'cama', lying: 'deitada', sleeping: 'dormindo', hospital: 'hospital', kiss: 'beijo', hug: 'abraco',
  monster: 'monstro', dragon: 'dragao', magic: 'magia', 'magic circle': 'magia', book: 'livro', ship: 'navio',
  boat: 'barco', rocket: 'foguete', 'space craft': 'nave', space: 'espaco', planet: 'planeta', earth: 'terra',
  castle: 'castelo', classroom: 'sala', school: 'escola', crowd: 'multidao', battle: 'batalha', dog: 'cachorro',
  cat: 'gato', horse: 'cavalo', snow: 'neve', water: 'agua', training: 'treino', dancing: 'danca', 'sweat': 'suor',
}

export function tagEmPortugues(t: string): string {
  return TAG_PT[t] ?? t
}

/** A matriz float32 little-endian do motor, linha por linha. */
export function linhasDaMatriz(buf: Uint8Array, dim: number): Float32Array[] {
  if (dim <= 0) return []
  const copia = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.byteLength - (buf.byteLength % 4))))
  const n = Math.floor(copia.length / dim)
  const saida: Float32Array[] = []
  for (let i = 0; i < n; i++) saida.push(copia.subarray(i * dim, (i + 1) * dim))
  return saida
}

/** "0026_1.jpg" -> 1. null = nome fora do formato do motor. */
export function kDoKeyframe(arquivo: string): number | null {
  const m = /_(\d)\.jpe?g$/i.exec(arquivo)
  return m ? Number(m[1]) : null
}

/** Onde o keyframe k (de 3) cai no plano: (k+1)/4, a regra do keyframe_extractor.py. */
export function posDoKeyframe(k: number, total = 3): number {
  return (k + 1) / (total + 1)
}

// ------------------------------------------------- a legibilidade do quadro

/** O tamanho em que o servico le o keyframe para a legibilidade (a conta depende da escala). */
export const LEITURA_LARGURA = 96
export const LEITURA_ALTURA = 54

/**
 * A LEGIBILIDADE de um quadro, 0..1 (19/10, 2a rodada do MRM E02): o olho le
 * a tela quando ha forma (contraste local: o gradiente medio da luma) e algum
 * destaque aceso (o p98 do maior canal -- o olho vermelho brilhando conta, a
 * luma dele nao). A luz media enganava: o grupo de olhos vermelhos (0006, luz
 * 36) e legivel e o queixo na chuva (0007, luz 46) nao. Medido nos keyframes
 * do MRM E02 e do Nia E01: 0006 = 0,88, 0007 = 0,19; abaixo de 0,4 ficam 5,5%
 * e 1,6% dos quadros (a abertura na chuva, o preto, o fundo de noite).
 *
 * `rgb`: os pixels RGB (3 bytes) do quadro reduzido a largura x altura
 * (LEITURA_LARGURA x LEITURA_ALTURA, encaixe "fill").
 */
export function legibilidadeDoQuadro(rgb: Uint8Array, largura: number, altura: number): number {
  const n = largura * altura
  if (n <= 0 || rgb.length < 3 * n) return 0
  const y = new Float32Array(n)
  const maior: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const r = rgb[3 * i]!
    const g = rgb[3 * i + 1]!
    const b = rgb[3 * i + 2]!
    y[i] = 0.299 * r + 0.587 * g + 0.114 * b
    maior[i] = Math.max(r, g, b)
  }
  let gradiente = 0
  let contados = 0
  for (let l = 1; l < altura - 1; l++) {
    for (let c = 1; c < largura - 1; c++) {
      const i = l * largura + c
      const gx = y[i + 1]! - y[i - 1]!
      const gy = y[i + largura]! - y[i - largura]!
      gradiente += Math.sqrt(gx * gx + gy * gy)
      contados += 1
    }
  }
  gradiente = contados > 0 ? gradiente / contados : 0
  maior.sort((a, b) => a - b)
  const destaque = maior[Math.min(n - 1, Math.floor(0.98 * n))]!
  const faixa = (x: number): number => Math.max(0, Math.min(1, x))
  return 0.5 * faixa((gradiente - 8) / 8) + 0.5 * faixa((destaque - 100) / 80)
}

// ---------------------------------------------- o assunto do plano (2a rodada)

/** A familia do objeto na mao, pelas etiquetas do WD-Tagger: "paper" e "holding paper" sao o mesmo papel. */
const OBJETOS: Readonly<Record<string, string>> = {
  paper: 'papel', 'holding paper': 'papel', scroll: 'papel', 'holding scroll': 'papel', letter: 'papel', document: 'papel',
  envelope: 'papel', contract: 'papel', book: 'papel', 'holding book': 'papel', 'open book': 'papel', notebook: 'papel', map: 'papel',
  sword: 'arma', 'holding sword': 'arma', katana: 'arma', weapon: 'arma', 'holding weapon': 'arma', polearm: 'arma', spear: 'arma',
  staff: 'arma', 'holding staff': 'arma', gun: 'arma', 'holding gun': 'arma', shield: 'arma', dagger: 'arma', knife: 'arma',
  cup: 'copo', mug: 'copo', bottle: 'copo', 'holding cup': 'copo', alcohol: 'copo', food: 'comida', fruit: 'comida', 'holding food': 'comida',
  phone: 'celular', cellphone: 'celular', 'holding phone': 'celular', smartphone: 'celular', bag: 'bolsa', coin: 'dinheiro', money: 'dinheiro',
}

/** Na mao, sem dizer o que: casa com qualquer objeto (o "holding" do Lent com o papel). */
export const NA_MAO = 'mao'

/** Os objetos (familias) que as etiquetas de um plano mostram. "holding" sozinho vira NA_MAO. */
export function objetosDasTags(tags: readonly string[]): string[] {
  const saida = new Set<string>()
  for (const bruta of tags) {
    const t = normalizarTag(bruta)
    const f = OBJETOS[t]
    if (f) saida.add(f)
    else if (t === 'holding') saida.add(NA_MAO)
  }
  return [...saida]
}
