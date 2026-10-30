import { z } from 'zod'
import { cenaDoVideoSchema } from '../../thumb/shared/thumb'

/**
 * [recap] O GERADOR DE THUMBNAIL da tela "Video pronto": o preset, as contas
 * e o contrato moram no editor em comum (modulos/thumb/shared/thumb.ts, o
 * mesmo do modulo Thumbnail). Aqui so o que e do recap: o pedido das
 * sugestoes, que abre o indice do episodio e o rascunho (o gancho, a beleza e
 * a nitidez do passo 4).
 */
export * from '../../thumb/shared/thumb'

export const pedidoDeSugestoesSchema = z.object({
  episodioId: z
    .string()
    .regex(/^ep_[0-9a-f]{40}$/)
    .nullable(),
  rascunhoId: z
    .string()
    .regex(/^rc_[0-9a-z_]+$/)
    .nullable(),
  cenas: z.array(cenaDoVideoSchema).max(400),
})
export type PedidoDeSugestoes = z.infer<typeof pedidoDeSugestoesSchema>
