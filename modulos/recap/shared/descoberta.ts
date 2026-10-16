import type { EpisodeIndex, EstadoDoCorte } from './episodio'

/**
 * [recap] O pedaco do contrato do RECONHECER NA MAO que o resumo do episodio
 * le. O resto (e a regra de verdade de quando oferecer) vem com o motor, na
 * parte 4; ate la nunca se oferece.
 */

/** O `fotosDoElenco` de um batismo feito no Reconhecer na mao. */
export const ORIGEM_DO_BATISMO = 'Reconhecer na mao'

/** Os nomes reconhecidos com uma arte so. Sem o motor: nenhum. */
export function nomesDeUmaArte(_fotosDoElenco: string | null | undefined): string[] | null {
  return null
}

export function podeReconhecerNaMao(
  _indice: Pick<EpisodeIndex, 'planos' | 'biblioteca' | 'corte'>,
  _corte: Pick<EstadoDoCorte, 'status' | 'descoberta' | 'mensagem'> | null,
): { pode: boolean } {
  return { pode: false }
}
