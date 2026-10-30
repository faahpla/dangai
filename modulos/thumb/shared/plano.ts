import type { CenaDoVideo } from './thumb'

/**
 * [thumb] O PLANO DO PROJETO visto pela thumbnail: qual arquivo de ORIGEM (e
 * o ponto dentro dele) o video mostra em cada instante. A thumb nunca sai do
 * video renderizado (a legenda vem queimada): o quadro e tirado da cena de
 * origem, limpo. O mesmo para a aba do recap e para o modulo Thumbnail.
 *
 * So o pedaco do projeto que importa aqui (o EstadoPublico da fachada serve).
 */
export interface CenaDoPlano {
  imageIndex: number
  imageIndexB?: number | null
  start: number
  end: number
  sourceStart?: number | null
  sourceStartB?: number | null
}

export interface PlanoMinimo {
  plan: { scenes: readonly CenaDoPlano[] } | null
  images: readonly { path: string }[]
}

export interface QuadroDaCena {
  arquivo: string
  t: number
  nome: string
}

/** O que o video mostra no instante: a cena (e, no grid, a metade de baixo). */
export interface CenaNoInstante {
  a: QuadroDaCena
  b: QuadroDaCena | null
}

const nome = (c: string): string => c.split(/[\\/]/).pop() ?? c

/**
 * A cena que o video mostra no instante `t` (o plano do projeto): o arquivo
 * de ORIGEM e o ponto dentro dele (o `sourceStart` mais o quanto o bloco ja
 * andou). No grid, as duas metades. null = fora do plano.
 */
export function cenaNoInstante(e: PlanoMinimo, t: number): CenaNoInstante | null {
  const scenes = e.plan?.scenes ?? []
  const s = scenes.find((x) => t >= x.start && t < x.end) ?? (t >= (scenes[scenes.length - 1]?.end ?? 0) ? scenes[scenes.length - 1] : undefined)
  if (!s) return null
  const dentro = Math.max(0, Math.min(t, s.end) - s.start)
  const a = e.images[s.imageIndex]
  if (!a) return null
  const b = s.imageIndexB !== null && s.imageIndexB !== undefined ? e.images[s.imageIndexB] : undefined
  return {
    a: { arquivo: a.path, t: (s.sourceStart ?? 0) + dentro, nome: nome(a.path) },
    b: b ? { arquivo: b.path, t: (s.sourceStartB ?? 0) + dentro, nome: nome(b.path) } : null,
  }
}

/**
 * As cenas que entraram no video (o plano do projeto), com o trecho de cada
 * uma DENTRO do arquivo. `gancho` = o trecho do video que e o gancho (o recap
 * sabe; fora dele, null e nenhuma e do gancho).
 */
export function cenasDoPlano(e: PlanoMinimo, gancho: { de: number; ate: number } | null): CenaDoVideo[] {
  const scenes = e.plan?.scenes ?? []
  const cenas: CenaDoVideo[] = []
  scenes.forEach((s, ordem) => {
    const dentro = gancho !== null && Math.min(s.end, gancho.ate) - Math.max(s.start, gancho.de) > 0.05
    const dur = Math.max(0, s.end - s.start)
    const a = e.images[s.imageIndex]
    if (a)
      cenas.push({
        arquivo: a.path,
        de: s.sourceStart ?? 0,
        ate: (s.sourceStart ?? 0) + dur,
        ordem,
        gancho: dentro,
      })
    const b = s.imageIndexB !== null && s.imageIndexB !== undefined ? e.images[s.imageIndexB] : undefined
    if (b)
      cenas.push({
        arquivo: b.path,
        de: s.sourceStartB ?? 0,
        ate: (s.sourceStartB ?? 0) + dur,
        ordem,
        gancho: dentro,
      })
  })
  return cenas
}

/** A duracao do plano (o fim da ultima cena). */
export function duracaoDoPlano(e: PlanoMinimo): number {
  const scenes = e.plan?.scenes ?? []
  return Math.max(0, ...scenes.map((s) => s.end))
}
