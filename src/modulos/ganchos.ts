import type { ClipeDaFaixa, ModuloDoRenderer, OrigemDosArquivos } from './api'

/**
 * OS GANCHOS que o nucleo chama: os eventos e os pontos em que um modulo pode
 * entrar no meio. Nao importa o store de proposito -- o store e quem chama
 * isto, e o caminho contrario faria um ciclo.
 *
 * Tudo aqui engole o erro do modulo (com log): um modulo quebrado nunca pode
 * impedir o projeto de abrir, salvar ou renderizar.
 */

export interface EventosDoNucleo {
  /** Um projeto acabou de abrir (arquivo ou autosave). */
  abrirProjeto: { path: string | null }
  /** O projeto foi gravado no disco pelo usuario. */
  depoisDeSalvar: { path: string }
  /** Um render terminou bem. */
  depoisDeRenderizar: { outputPath: string | null }
  /** A narracao do projeto foi trocada por outra. */
  narracaoTrocada: { anterior: string | null; nova: string }
  /**
   * As configuracoes foram gravadas (pela tela, por um modulo, pelo dialogo).
   * O `euMesmo()` de cada modulo ja vem relido quando isto chega.
   */
  configuracoesMudaram: Record<string, never>
}

type Ouvinte<K extends keyof EventosDoNucleo> = (dados: EventosDoNucleo[K]) => void

const ouvintes = new Map<keyof EventosDoNucleo, Set<(dados: never) => void>>()

export function ouvir<K extends keyof EventosDoNucleo>(evento: K, ouvinte: Ouvinte<K>): () => void {
  let lista = ouvintes.get(evento)
  if (!lista) ouvintes.set(evento, (lista = new Set()))
  const guardada = lista
  guardada.add(ouvinte as (dados: never) => void)
  return () => {
    guardada.delete(ouvinte as (dados: never) => void)
  }
}

export function emitir<K extends keyof EventosDoNucleo>(evento: K, dados: EventosDoNucleo[K]): void {
  for (const ouvinte of (ouvintes.get(evento) ?? []) as Set<Ouvinte<K>>) {
    try {
      ouvinte(dados)
    } catch (err) {
      console.error(`[modulos] ouvinte de "${evento}" falhou:`, err)
    }
  }
}

/** Os modulos ligados agora. Quem preenche e ./index (que conhece o registro). */
let ativos: () => readonly ModuloDoRenderer[] = () => []
export function definirModulosAtivos(fn: () => readonly ModuloDoRenderer[]): void {
  ativos = fn
}
export const modulosAtivos = (): readonly ModuloDoRenderer[] => ativos()

/**
 * Os arquivos que ele trouxe passam pelos modulos antes do nucleo. Devolve o
 * que SOBROU para o nucleo.
 */
export async function interceptarArquivos(
  caminhos: readonly string[],
  origem: OrigemDosArquivos,
): Promise<readonly string[]> {
  let resto = caminhos
  for (const m of ativos()) {
    if (!m.interceptarArquivos || resto.length === 0) continue
    try {
      const consumidos = new Set(await m.interceptarArquivos(resto, origem))
      resto = resto.filter((c) => !consumidos.has(c))
    } catch (err) {
      console.error(`[modulo:${m.id}] interceptarArquivos falhou:`, err)
    }
  }
  return resto
}

/** O nome do clipe na linha do tempo, se algum modulo quiser dar um. */
export function rotuloDoClipe(clipe: ClipeDaFaixa): string | null {
  for (const m of ativos()) {
    if (!m.rotuloDoClipe) continue
    try {
      const r = m.rotuloDoClipe(clipe)
      if (r) return r
    } catch (err) {
      console.error(`[modulo:${m.id}] rotuloDoClipe falhou:`, err)
    }
  }
  return null
}
