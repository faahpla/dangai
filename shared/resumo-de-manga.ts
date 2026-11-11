import { z } from 'zod'

/**
 * O RESUMO DE MANGA (11/2026): "quero comecar um canal de resumos de mangas e
 * criar uma forma automatizada de fazer isso aqui no Dangai... parecido com as
 * curiosidades que faco hoje de anime". Shorts verticais, a voz e dele, o
 * roteiro sai da IA e ele corrige.
 *
 * O caminho: ele escolhe os capitulos na pasta dos mangas -> a IA le as paginas
 * (cada quadrinho numerado) -> a IA escreve o roteiro, e cada frase ja diz DE
 * QUAIS QUADRINHOS saiu -> ele corrige e grava -> solta a narracao -> as cenas
 * de cada trecho chegam marcadas com os quadrinhos da frase, e ele so revisa.
 *
 * Por que isto da certo onde a montagem automatica de anime nao deu (saiu na
 * 1.91, ~15% de acerto): la o roteiro vinha antes e era preciso ADIVINHAR a
 * cena. Aqui o roteiro nasce das paginas -- a cena de cada frase nao e
 * adivinhada, e a origem dela.
 */

/** Um capitulo na pasta dos mangas: <pasta>/<serie>/<capitulo>/<paginas>. */
export interface CapituloDoManga {
  dir: string
  serie: string
  /** O nome da pasta, como ele chamou: "Cap. 359". */
  capitulo: string
  numero: number | null
  paginas: number
}

export interface SerieDoManga {
  serie: string
  capitulos: CapituloDoManga[]
}

/**
 * Um quadrinho (ou pagina inteira) que o roteiro pode citar.
 *
 * `ref` e o nome dele para a IA: "c1p12q3" = capitulo 1 da leva, pagina 12,
 * quadro 3; "c1p12" = a pagina inteira.
 */
export interface QuadroDoResumo {
  ref: string
  /** O capitulo, na ordem da leva (1 = o primeiro escolhido). */
  capitulo: number
  pagina: number
  /** null = a pagina inteira. */
  quadro: number | null
  /** O arquivo: o recorte do quadrinho, ou a pagina. E o que vai para a cena. */
  caminho: string
  /** A miniatura, para a tela (endereco do servidor de midia: muda a cada sessao). */
  miniatura: string
  /** O arquivo da miniatura, para publicar de novo num rascunho reaberto. */
  arquivoDaMiniatura: string
  /** O que a IA viu nele (vazio ate a leitura). */
  oque: string
  falas: string
  /** Quadro que segura a tela: close, golpe, pagina dupla, revelacao. */
  forte: boolean
}

export interface FraseDoResumo {
  texto: string
  /** Os quadrinhos da frase, pelos `ref`, na ordem em que entram. */
  quadros: string[]
}

/** O que a tela do resumo tem na mao: os capitulos lidos e o roteiro. */
export interface ResumoDoManga {
  capitulos: CapituloDoManga[]
  quadros: QuadroDoResumo[]
  titulo: string
  frases: FraseDoResumo[]
}

/** Quanto ele quer de video. As palavras sao no ritmo dele: ~3,4 por segundo. */
export const TAMANHOS_DO_RESUMO = {
  curto: { nome: 'Curto (~1 min)', palavras: 200 },
  medio: { nome: 'Médio (~1 min e meio)', palavras: 290 },
  longo: { nome: 'Longo (~2 min e meio)', palavras: 480 },
} as const
export type TamanhoDoResumo = keyof typeof TAMANHOS_DO_RESUMO

export interface PedidoDoResumo {
  dirs: string[]
  tamanho: TamanhoDoResumo
  /** O que ele quer destacar ("foca na luta do Asta"); vazio = a IA decide. */
  pedido: string
}

// ------------------------------------------------------------ o que a IA devolve

/** A leitura de um lote de paginas: o que acontece em cada quadrinho numerado. */
export const leituraDasPaginasSchema = z.object({
  paginas: z.array(
    z.object({
      pagina: z.number(),
      quadros: z.array(
        z.object({
          /** O numero desenhado no quadrinho; 0 = a pagina inteira (pagina sem numeros). */
          n: z.number(),
          oque: z.string(),
          falas: z.string(),
          forte: z.boolean(),
        }),
      ),
    }),
  ),
})
export type LeituraDasPaginas = z.infer<typeof leituraDasPaginasSchema>

export const roteiroDoMangaSchema = z.object({
  titulo: z.string(),
  frases: z.array(
    z.object({
      texto: z.string(),
      quadros: z.array(z.string()),
    }),
  ),
})
export type RoteiroDoManga = z.infer<typeof roteiroDoMangaSchema>

// ------------------------------------------------------ do roteiro para as cenas

/** O que fica no projeto: cada frase com os ARQUIVOS dos quadrinhos dela. */
export interface ResumoNoProjeto {
  /** O titulo que a IA sugeriu: vira o nome sugerido do projeto. */
  titulo: string
  capitulos: string[]
  frases: { texto: string; quadros: string[] }[]
}

export const resumoNoProjetoSchema = z.object({
  titulo: z.string().default(''),
  capitulos: z.array(z.string()),
  frases: z.array(z.object({ texto: z.string(), quadros: z.array(z.string()) })),
})

/** A palavra sem acento, caixa e pontuacao. */
const normal = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')

const palavras = (texto: string): string[] => texto.split(/\s+/).map(normal).filter(Boolean)

/**
 * AS CENAS DE CADA TRECHO, a partir das frases do resumo.
 *
 * O trecho da narracao (o pedaco entre pontuacoes) nao e a frase do resumo:
 * uma frase com virgula vira dois trechos, e ele pode ter mexido no roteiro
 * depois. Entao casa PALAVRA COM PALAVRA (a maior sequencia em comum) e cada
 * trecho fica com a frase de onde vem a maioria das palavras dele.
 *
 * Os quadrinhos de uma frase se espalham pelos trechos dela, na ordem: com
 * mais quadrinhos que trechos, cada trecho leva um grupo; com menos, os
 * trechos sem quadrinho ficam vazios -- e a cena anterior segue por eles (e o
 * que o "Pronto" ja faz com trecho sem cena).
 */
export function cenasDosTrechos(
  frases: readonly { texto: string; quadros: readonly string[] }[],
  trechos: readonly { text: string }[],
): Record<number, string[]> {
  const a: { p: string; frase: number }[] = []
  for (const [i, f] of frases.entries()) for (const p of palavras(f.texto)) a.push({ p, frase: i })
  const b: { p: string; trecho: number }[] = []
  for (const [j, t] of trechos.entries()) for (const p of palavras(t.text)) b.push({ p, trecho: j })

  // A maior subsequencia em comum (umas 250 palavras de cada lado).
  const n = a.length
  const m = b.length
  const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i]![j] = a[i]!.p === b[j]!.p ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!)
    }
  }
  const votos = trechos.map(() => new Map<number, number>())
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i]!.p === b[j]!.p) {
      const v = votos[b[j]!.trecho]!
      v.set(a[i]!.frase, (v.get(a[i]!.frase) ?? 0) + 1)
      i++
      j++
    } else if (t[i + 1]![j]! >= t[i]![j + 1]!) i++
    else j++
  }

  // A frase de cada trecho; sem voto nenhum (frase nova dele), nenhuma.
  const fraseDo: (number | null)[] = votos.map((v) => {
    let melhor: number | null = null
    let max = 0
    for (const [f, c] of v) if (c > max) [melhor, max] = [f, c]
    return melhor
  })

  const saida: Record<number, string[]> = {}
  for (const [f, frase] of frases.entries()) {
    const dela = fraseDo.flatMap((x, k) => (x === f ? [k] : []))
    const qs = frase.quadros
    if (dela.length === 0 || qs.length === 0) continue
    const k = qs.length
    const tm = dela.length
    if (k >= tm) {
      // Grupos seguidos, do tamanho de cada trecho (pelas palavras).
      const pesos = dela.map((x) => Math.max(1, palavras(trechos[x]!.text).length))
      const total = pesos.reduce((s, p) => s + p, 0)
      let feito = 0
      let acum = 0
      for (const [g, x] of dela.entries()) {
        acum += pesos[g]!
        const ate = g === tm - 1 ? k : Math.max(feito + 1, Math.min(k - (tm - 1 - g), Math.round((acum / total) * k)))
        saida[x] = qs.slice(feito, ate)
        feito = ate
      }
    } else {
      // Menos quadrinhos que trechos: espalhados, o primeiro sempre no primeiro trecho.
      for (const [q, caminho] of qs.entries()) {
        const x = dela[Math.floor((q * tm) / k)]!
        ;(saida[x] ??= []).push(caminho)
      }
    }
  }
  return saida
}

/** O roteiro como texto: uma frase por linha, que e como ele grava e o Dangai sincroniza. */
export function textoDoResumo(frases: readonly { texto: string }[]): string {
  return frases
    .map((f) => f.texto.trim())
    .filter(Boolean)
    .join('\n')
}

/** O resumo da tela do Resumo de mangá do jeito que entra no projeto: cada frase com os ARQUIVOS dos quadrinhos. */
export function resumoParaOProjeto(resumo: Pick<ResumoDoManga, 'titulo' | 'capitulos' | 'quadros' | 'frases'>): ResumoNoProjeto {
  const porRef = new Map(resumo.quadros.map((q) => [q.ref, q.caminho]))
  return {
    titulo: resumo.titulo,
    capitulos: resumo.capitulos.map((c) => c.dir),
    frases: resumo.frases
      .filter((f) => f.texto.trim())
      .map((f) => ({
        texto: f.texto.trim(),
        quadros: f.quadros.map((r) => porRef.get(r)).filter((x): x is string => !!x),
      })),
  }
}

// --------------------------------------- o roteiro pronto no caminho de sempre

/*
 * O ROTEIRO DE MANGA NO CAMINHO DE SEMPRE: "quero tambem um processo semelhante
 * ao padrao do app... arrastar um audio e edita-lo, depois arrastar um roteiro
 * ja pronto de manga, e depois ele ja ir direto na biblioteca para selecionar".
 *
 * Todo roteiro que o Resumo de mangá escreve fica guardado (com os quadrinhos
 * de cada frase). Um .txt que entra na etapa do Roteiro e confere com um deles
 * -- mesmo depois de ele mexer no texto -- traz os quadrinhos junto. Roteiro
 * escrito fora do Dangai: ele diz de que capitulos e, e a IA casa cada frase
 * com os quadrinhos (ver casamentoDosQuadrosSchema).
 */

/** Um roteiro que o Resumo de mangá escreveu, guardado para ser reconhecido depois. */
export interface RoteiroDeMangaGuardado extends ResumoNoProjeto {
  id: string
  /** Quando foi escrito ou mexido por ultimo, em ms. */
  em: number
}

/**
 * Quanto do roteiro solto (`texto`) sai destas frases: a fracao das palavras
 * dele que aparecem nelas, na mesma ordem (a maior sequencia em comum). 1 = o
 * mesmo texto; ele trocar umas palavras ainda da perto disso.
 */
export function quantoBate(texto: string, frases: readonly { texto: string }[]): number {
  const a = palavras(texto)
  const b = frases.flatMap((f) => palavras(f.texto))
  if (a.length === 0 || b.length === 0) return 0
  let anterior = new Uint16Array(b.length + 1)
  for (let i = a.length - 1; i >= 0; i--) {
    const linha = new Uint16Array(b.length + 1)
    for (let j = b.length - 1; j >= 0; j--) {
      linha[j] = a[i] === b[j] ? anterior[j + 1]! + 1 : Math.max(anterior[j]!, linha[j + 1]!)
    }
    anterior = linha
  }
  return anterior[0]! / Math.max(a.length, b.length)
}

/** O roteiro guardado de onde este texto saiu (no minimo 60% igual), ou null. */
export function roteiroQueBate<R extends { frases: readonly { texto: string }[] }>(texto: string, guardados: readonly R[]): R | null {
  let melhor: R | null = null
  let nota = 0.6
  for (const g of guardados) {
    const n = quantoBate(texto, g.frases)
    if (n >= nota) [melhor, nota] = [g, n]
  }
  return melhor
}

/** As frases de um roteiro em texto: um ponto final (ou ? !) encerra a frase, como no resto do Dangai. */
export function frasesDoTexto(texto: string): string[] {
  return (texto.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]+["'”)]*|[^.!?…]+$/g) ?? []).map((f) => f.trim()).filter(Boolean)
}

/** O que a IA devolve ao casar um roteiro pronto com os quadrinhos: os de cada frase, pelo numero dela. */
export const casamentoDosQuadrosSchema = z.object({
  frases: z.array(
    z.object({
      n: z.number().int(),
      quadros: z.array(z.string()),
    }),
  ),
})
