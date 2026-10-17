import type { FocoDoRosto, LoteDeRostos, RostosDoLote } from '../../shared/edicao-rapida'
import { focosDosPedacos, instantesDoTrecho } from './foco'
import { chaveDoPedaco } from './projeto'

/**
 * [recap] O ROSTO DA EDICAO RAPIDA, em lote: o `rostosDosPedacos` do Studio so
 * com a RESERVA dele, o detector antigo do nucleo (lbpcascade, ./foco.ts). O
 * motor (YOLO de rosto de anime, preferindo quem a frase cita) chega na parte
 * 4 e entra ANTES disto, com esta mesma resposta (`fonte: 'motor'`).
 *
 * Um foco por pedido, na ordem dos pedidos; sem rosto (ou sem tempo), o
 * centro sem marca de automatico. Nunca lanca: rosto e melhoria.
 */
export async function rostosDosPedacos(lote: LoteDeRostos): Promise<RostosDoLote> {
  const inicio = Date.now()
  const avisos: string[] = []
  const unicos = new Map(lote.pedidos.map((p) => [p.chave, p]))
  let achados = new Map<string, { focusX: number; focusY: number; focusAuto: boolean }>()
  try {
    achados = await focosDosPedacos(
      [...unicos.values()].map((p) => ({ arquivo: p.arquivo, de: p.de, ate: Math.max(p.ate, p.de) })),
      lote.tetoMs,
      lote.formato,
    )
  } catch {
    avisos.push('Nao deu para procurar os rostos: os blocos ficam no centro.')
  }
  const lista: FocoDoRosto[] = lote.pedidos.map((p) => {
    const f = achados.get(chaveDoPedaco({ arquivo: p.arquivo, de: p.de }))
    return {
      chave: p.chave,
      focusX: f?.focusX ?? 0.5,
      focusY: f?.focusY ?? 0.5,
      focusAuto: f?.focusAuto ?? false,
      fonte: f ? 'lbp' : null,
      personagem: null,
      // O detector antigo olha os mesmos 3 instantes e nao diz em quantos achou.
      instantesComRosto: f ? 1 : 0,
      instantes: instantesDoTrecho(p.de, p.ate).length,
    }
  })
  const comRosto = lista.filter((f) => f.focusAuto).length
  return { focos: lista, fonte: comRosto > 0 ? 'lbp' : 'nenhum', comRosto, total: lista.length, avisos, ms: Date.now() - inicio }
}
