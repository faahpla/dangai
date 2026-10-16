/**
 * LOUDNESS (ITU-R BS.1770 / EBU R128) em JS puro: a mesma conta do libebur128
 * (filtro K em duas biquads, janela de 400 ms, porta absoluta de -70 LUFS e
 * relativa de -10 LU), aos pedacos, sem precisar do arquivo inteiro na memoria.
 * O teste (scripts/teste/v-som-mix.ts) confere contra o ebur128 do ffmpeg.
 *
 * Quem usa: o preview, para tocar no equilibrio do render (som-do-preview.ts,
 * medido no main por electron/services/medir-som.ts).
 *
 * Canais: soma das potencias, peso 1 em todos (estereo e mono; surround nao
 * importa aqui). MONO conta como um canal so, igual ao ffmpeg -- quem quer o
 * loudness de um mono tocado nos DOIS alto-falantes em ganho 1 (o navegador)
 * soma +3 dB (ver `monoEmDoisCanais`).
 */

/**
 * O loudness da narracao no MP4: o render normaliza nela (loudnorm em
 * render.ts). O preview usa o mesmo numero para tocar no equilibrio do render.
 */
export const LUFS_DA_NARRACAO = -14

/** A medida de um arquivo de som (electron/services/medir-som.ts). */
export interface MedidaDoSom {
  path: string
  /** Duracao do ARQUIVO inteiro, s. */
  durationSec: number
  /** Loudness integrado (LUFS). null = silencio ou curto demais para medir. */
  lufsIntegrado: number | null
  /** O maior loudness MOMENTANEO (janela de 400 ms), LUFS. null = silencio. */
  lufsMomentaneoMax: number | null
  /** O centro da janela de 100 ms mais forte (K-ponderada), s. */
  picoSec: number
  /** O primeiro e o ultimo instante audivel (acima do piso), s. */
  inicioSomSec: number
  fimSomSec: number
  /**
   * Canais do arquivo (1 = mono). O preview precisa: o navegador toca mono nos
   * dois alto-falantes em ganho 1 (+3 dB), o render a -3 dB por canal.
   * Ausente = nao se sabe (trata como estereo).
   */
  canais?: number
}

/** Uma biquad (a0 = 1). */
interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/** As duas biquads do filtro K na taxa dada (as formulas do libebur128). */
export function filtroK(taxa: number): [Biquad, Biquad] {
  // Estagio 1: prateleira alta (+4 dB acima de ~1,7 kHz, a "cabeca").
  let f0 = 1681.974450955533
  const G = 3.999843853973347
  let Q = 0.7071752369554196
  let K = Math.tan((Math.PI * f0) / taxa)
  const Vh = 10 ** (G / 20)
  const Vb = Vh ** 0.4996667741545416
  const a0 = 1 + K / Q + K * K
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  }
  // Estagio 2: passa-alta em ~38 Hz (curva RLB).
  f0 = 38.13547087602444
  Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / taxa)
  const d = 1 + K / Q + K * K
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / d, a2: (1 - K / Q + K * K) / d }
  return [shelf, hp]
}

/**
 * O acumulador da energia K-ponderada em sub-blocos de 10 ms, somada nos
 * canais: e(j) = soma dos quadrados do sub-bloco j. Recebe o audio AOS
 * PEDACOS (o stdout do ffmpeg), entao uma musica de 10 min nao precisa caber
 * inteira na memoria. Tudo o mais (momentaneo, integrado, pico, audivel) sai
 * de e(j).
 */
export class EnergiaK {
  readonly h: number
  private readonly filtros: [Biquad, Biquad]
  private readonly z: Float64Array
  private energia: Float64Array
  private usados = 0
  /** Amostras por canal ja lidas. */
  amostras = 0

  constructor(
    readonly taxa: number,
    readonly canais: number,
    subSec = 0.01,
  ) {
    this.h = Math.max(1, Math.round(subSec * taxa))
    this.filtros = filtroK(taxa)
    this.z = new Float64Array(4 * Math.max(canais, 1))
    this.energia = new Float64Array(1024)
  }

  /** Amostras INTERCALADAS (L R L R ...), `canais` por quadro. */
  intercalado(x: Float32Array): void {
    const C = this.canais
    const quadros = Math.floor(x.length / C)
    for (let c = 0; c < C; c++) this.filtrar(x, c, C, quadros)
    this.amostras += quadros
  }

  /** Um canal por vez (o AudioBuffer do navegador). Todos com o mesmo tamanho. */
  planar(canais: readonly Float32Array[]): void {
    const quadros = canais.reduce((m, c) => Math.max(m, c.length), 0)
    canais.forEach((x, c) => this.filtrar(x, c, 1, x.length))
    this.amostras += quadros
  }

  private filtrar(x: Float32Array, c: number, passo: number, quadros: number): void {
    const [s1, s2] = this.filtros
    const z = this.z
    const o = 4 * c
    let z1a = z[o]!
    let z2a = z[o + 1]!
    let z1b = z[o + 2]!
    let z2b = z[o + 3]!
    const h = this.h
    const base = this.amostras
    this.garantir(Math.ceil((base + quadros) / h))
    const e = this.energia
    for (let i = 0; i < quadros; i++) {
      const xi = x[i * passo + (passo > 1 ? c : 0)]!
      // Forma direta II transposta, em double.
      const y1 = s1.b0 * xi + z1a
      z1a = s1.b1 * xi - s1.a1 * y1 + z2a
      z2a = s1.b2 * xi - s1.a2 * y1
      const y2 = s2.b0 * y1 + z1b
      z1b = s2.b1 * y1 - s2.a1 * y2 + z2b
      z2b = s2.b2 * y1 - s2.a2 * y2
      const k = ((base + i) / h) | 0
      e[k] = e[k]! + y2 * y2
    }
    z[o] = z1a
    z[o + 1] = z2a
    z[o + 2] = z1b
    z[o + 3] = z2b
  }

  private garantir(n: number): void {
    if (n > this.usados) this.usados = n
    if (n <= this.energia.length) return
    let cap = this.energia.length
    while (cap < n) cap *= 2
    const maior = new Float64Array(cap)
    maior.set(this.energia)
    this.energia = maior
  }

  /** e(j) de todos os sub-blocos lidos. */
  subBlocos(): Float64Array {
    return this.energia.subarray(0, this.usados)
  }

  resultado(): LoudnessMedido {
    return medirDaEnergia(this.subBlocos(), this.h, this.taxa, this.amostras, this.canais)
  }
}

/** Potencia media (soma dos canais) -> LUFS. Zero = -Infinity. */
export function lufsDaPotencia(p: number): number {
  return p > 0 ? -0.691 + 10 * Math.log10(p) : Number.NEGATIVE_INFINITY
}

export function potenciaDoLufs(l: number): number {
  return Number.isFinite(l) ? 10 ** ((l + 0.691) / 10) : 0
}

/** Integrado com as duas portas (BS.1770-4) sobre as potencias dos blocos de 400 ms. null = tudo abaixo da porta. */
export function integradoDasPotencias(potencias: readonly number[]): number | null {
  const PORTA_ABS = potenciaDoLufs(-70)
  const acima = potencias.filter((p) => p > PORTA_ABS)
  if (acima.length === 0) return null
  const media = acima.reduce((s, p) => s + p, 0) / acima.length
  const portaRel = potenciaDoLufs(lufsDaPotencia(media) - 10)
  const dentro = acima.filter((p) => p > portaRel)
  if (dentro.length === 0) return null
  return lufsDaPotencia(dentro.reduce((s, p) => s + p, 0) / dentro.length)
}

/** O que a medida devolve. Tempos em segundos do comeco do arquivo. */
export interface LoudnessMedido {
  durationSec: number
  /** Integrado BS.1770 (portas -70/-10). null = silencio. */
  integrado: number | null
  /** Maior momentaneo (400 ms) com passo de 10 ms. null = silencio. */
  momentaneoMax: number | null
  /** Onde a janela de 400 ms do maximo momentaneo termina. */
  momentaneoMaxFimSec: number
  /** O centro da janela de 100 ms mais forte (K-ponderada): o "pico" do som. */
  picoSec: number
  /** Primeiro e ultimo instante acima do piso (50 dB abaixo do sub-bloco mais forte, nunca abaixo de -70 dBFS). */
  inicioSomSec: number
  fimSomSec: number
  /**
   * O loudness de cada bloco de 400 ms com passo de 100 ms (o bloco k cobre
   * [k*0,1 ; k*0,1 + 0,4]), em LUFS com 2 casas; -Infinity vira -200. Serve
   * para o integrado de um TRECHO (integradoNoTrecho) sem decodificar de novo.
   */
  blocos: number[]
}

/**
 * Mede tudo de uma vez, um canal por array (float -1..1, mesma taxa). Sem
 * amostra: tudo nulo/zero.
 */
export function medirLoudness(canais: readonly Float32Array[], taxa: number): LoudnessMedido {
  const acc = new EnergiaK(taxa, Math.max(canais.length, 1))
  acc.planar(canais)
  return acc.resultado()
}

function medirDaEnergia(energia: Float64Array, h: number, taxa: number, n: number, canaisN0: number): LoudnessMedido {
  const durationSec = n / taxa
  const J = energia.length
  const vazio: LoudnessMedido = {
    durationSec,
    integrado: null,
    momentaneoMax: null,
    momentaneoMaxFimSec: 0,
    picoSec: 0,
    inicioSomSec: 0,
    fimSomSec: durationSec,
    blocos: [],
  }
  if (J === 0) return vazio

  // Soma acumulada: janela [a, b) de sub-blocos = S[b] - S[a].
  const S = new Float64Array(J + 1)
  for (let j = 0; j < J; j++) S[j + 1] = S[j]! + energia[j]!
  const soma = (a: number, b: number): number => S[Math.min(b, J)]! - S[Math.max(a, 0)]!

  // 400 ms = 40 sub-blocos. Arquivo mais curto: uma janela so, com zeros (como o ffmpeg).
  const W = 40
  const amostrasJanela = W * h
  let mMax = 0
  let mMaxFim = Math.min(W, J)
  for (let b = Math.min(W, J); b <= J; b++) {
    const p = soma(b - W, b) / amostrasJanela
    if (p > mMax) {
      mMax = p
      mMaxFim = b
    }
  }

  // Blocos de gating: passo de 100 ms (10 sub-blocos).
  const blocos: number[] = []
  const potencias: number[] = []
  if (J <= W) {
    const p = soma(0, J) / amostrasJanela
    potencias.push(p)
    blocos.push(arred2(lufsDaPotencia(p)))
  } else {
    for (let a = 0; a + W <= J; a += 10) {
      const p = soma(a, a + W) / amostrasJanela
      potencias.push(p)
      blocos.push(arred2(lufsDaPotencia(p)))
    }
  }

  // Pico: a janela de 100 ms mais forte.
  const P = 10
  let pMax = -1
  let pMaxIni = 0
  for (let a = 0; a + Math.min(P, J) <= J; a++) {
    const e = soma(a, a + P)
    if (e > pMax) {
      pMax = e
      pMaxIni = a
    }
  }
  const picoSec = Math.min((pMaxIni + Math.min(P, J) / 2) * h, n) / taxa

  // Audivel: sub-blocos acima do piso.
  let eMax = 0
  for (let j = 0; j < J; j++) if (energia[j]! > eMax) eMax = energia[j]!
  const canaisN = Math.max(canaisN0, 1)
  const nivel = (e: number): number => (e > 0 ? 10 * Math.log10(e / (h * canaisN)) : Number.NEGATIVE_INFINITY)
  const piso = Math.max(nivel(eMax) - 50, -70)
  let ini = -1
  let fim = -1
  for (let j = 0; j < J; j++) {
    if (nivel(energia[j]!) > piso) {
      if (ini < 0) ini = j
      fim = j
    }
  }

  return {
    durationSec,
    integrado: integradoDasPotencias(potencias),
    momentaneoMax: mMax > 0 ? lufsDaPotencia(mMax) : null,
    momentaneoMaxFimSec: Math.min(mMaxFim * h, n) / taxa,
    picoSec,
    inicioSomSec: ini < 0 ? 0 : (ini * h) / taxa,
    fimSomSec: fim < 0 ? durationSec : Math.min((fim + 1) * h, n) / taxa,
    blocos,
  }
}

/**
 * O integrado do pedaco [deSec, ateSec] do arquivo, pelos blocos ja medidos
 * (os que cabem inteiros no pedaco). Pedaco menor que um bloco: o bloco mais
 * perto. null = silencio ou sem blocos.
 */
export function integradoNoTrecho(blocos: readonly number[], deSec: number, ateSec: number): number | null {
  if (blocos.length === 0) return null
  const pot = (l: number): number => (l <= -199 ? 0 : potenciaDoLufs(l))
  const dentro: number[] = []
  blocos.forEach((l, k) => {
    const a = k * 0.1
    if (a >= deSec - 1e-6 && a + 0.4 <= ateSec + 1e-6) dentro.push(pot(l))
  })
  if (dentro.length === 0) {
    const k = Math.min(Math.max(Math.round(deSec / 0.1), 0), blocos.length - 1)
    dentro.push(pot(blocos[k]!))
  }
  return integradoDasPotencias(dentro)
}

/**
 * O navegador toca um arquivo MONO nos dois alto-falantes em ganho 1 (o
 * Chromium copia o canal), e o ffmpeg do render sobe o mono para estereo a
 * -3 dB por canal (loudness igual ao do mono). Para comparar o que se OUVE no
 * preview com o render: mono soa +3 dB no preview.
 */
export function monoEmDoisCanais(canais: number): number {
  return canais === 1 ? 10 * Math.log10(2) : 0
}

function arred2(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : -200
}
