import { z } from 'zod'
import type { EpisodeIndex, Plano } from './episodio'
import type { EstadoDasCenas } from './cenas'

/**
 * EPISODIOS EXTRAS (27/11): o recap continua com UM episodio principal (o do
 * roteiro e da voz), mas a aba Cenas pode buscar cenas em outros episodios --
 * o video de curiosidade cita o ep 1 ("depois de ser expulso da guilda").
 *
 * O plano de um extra entra nas escolhas com o id PREFIXADO pelo episodio
 * (`<10 hex do episodio>~<id do plano>`): os ids dos planos ('0025') repetem
 * de um episodio para outro, e com o prefixo a montagem, o encaixe e a tela
 * acham o plano certo num indice so (comExtras), sem saber de extra nenhum.
 * O `episodioId` do candidato e o do extra.
 */

export const MAXIMO_DE_EXTRAS = 24

export const episodioExtraSchema = z.object({
  episodioId: z.string().regex(/^ep_[0-9a-f]{40}$/),
  /** Dica de onde o episodio.json estava (o main acha pelo id se mudou). */
  indicePath: z.string(),
  /** 'Laid-Off S01E01', para a tela. */
  titulo: z.string(),
})
export type EpisodioExtra = z.infer<typeof episodioExtraSchema>

const SEPARADOR = '~'

function prefixoDo(episodioId: string): string {
  return episodioId.slice(3, 13)
}

/** O id do plano de um extra como ele entra nas escolhas. */
export function idNoExtra(episodioId: string, planoId: string): string {
  return `${prefixoDo(episodioId)}${SEPARADOR}${planoId}`
}

/** O plano e de um extra (tem o prefixo). */
export function ehDeExtra(planoId: string): boolean {
  return planoId.includes(SEPARADOR)
}

/** O id cru (o do indice do extra), sem o prefixo. Id sem prefixo volta igual. */
export function idCru(planoId: string): string {
  const i = planoId.indexOf(SEPARADOR)
  return i < 0 ? planoId : planoId.slice(i + 1)
}

/** O plano prefixado e deste episodio. */
export function doEpisodio(planoId: string, episodioId: string): boolean {
  return planoId.startsWith(prefixoDo(episodioId) + SEPARADOR)
}

/** Os planos de um extra com os ids prefixados (copia). */
export function planosDoExtra(indice: Pick<EpisodeIndex, 'id' | 'planos'>): Plano[] {
  return indice.planos.map((p) => ({ ...p, id: idNoExtra(indice.id, p.id) }))
}

/**
 * O indice principal com os planos dos extras no FIM, prefixados. So para
 * achar plano por id (montar, encaixe, grid, tela): o casar e a regua usam o
 * principal sozinho (os tempos dos extras sao de outro .mkv).
 */
export function comExtras<T extends Pick<EpisodeIndex, 'planos'>>(indice: T, extras: readonly Pick<EpisodeIndex, 'id' | 'planos'>[]): T {
  if (extras.length === 0) return indice
  return { ...indice, planos: [...indice.planos, ...extras.flatMap(planosDoExtra)] }
}


/**
 * Frases com cena de um episodio que NAO esta mais nos extras (tirado da
 * lista): o casar refaz, mesmo travadas -- a montagem nao acharia o plano.
 */
export function extrasForaDoRascunho(cenas: Pick<EstadoDasCenas, 'escolhas'>, extras: readonly Pick<EpisodioExtra, 'episodioId'>[]): string[] {
  const prefixos = new Set(extras.map((e) => prefixoDo(e.episodioId)))
  const fora = (id: string): boolean => ehDeExtra(id) && !prefixos.has(id.slice(0, id.indexOf(SEPARADOR)))
  return cenas.escolhas
    .filter((e) => e.cenas.some((c) => [...c.candidato.planoIds, ...(c.baixo?.planoIds ?? [])].some(fora)))
    .map((e) => e.fraseId)
}
