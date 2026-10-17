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
  /** C1: o sentido (multilingual-e5-small) do texto de cada frase e de cada fala (cueId). */
  sentidoDaFrase?: ReadonlyMap<string, Float32Array>
  sentidoDaCue?: ReadonlyMap<string, Float32Array>
  /** C3: as etiquetas do WD-Tagger de cada plano (da mais confiante para a menos) e as da frase. */
  tagsDoPlano?: ReadonlyMap<string, readonly string[]>
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
