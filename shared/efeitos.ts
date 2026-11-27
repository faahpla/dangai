import { z } from 'zod'

/**
 * EFEITOS NO CLIPE (27/11): "uma secao para aplicar efeitos nos clipes ou nos
 * inserts; tem situacoes que preciso censurar alguma coisa e nao consigo".
 *
 * Desfoque, mosaico e tarja, na tela toda ou so numa AREA (um retangulo, em
 * fracao do quadro). Valem no bloco da faixa de cenas, no clipe da faixa de
 * video (o insert) e na camada de ajuste -- nessa, censuram tudo o que esta
 * embaixo no trecho dela, seja qual for o clipe.
 *
 * Sao desenhados por um filtro SVG (src/remotion/Efeitos.tsx), o mesmo
 * caminho da camada de ajuste: a previa e o render saem iguais e nada e
 * reprocessado em ffmpeg -- mexer na forca ou na area aparece na hora.
 */

export const TIPOS_DE_EFEITO = ['desfoque', 'mosaico', 'tarja'] as const
export type TipoDeEfeito = (typeof TIPOS_DE_EFEITO)[number]

export const NOME_DO_EFEITO: Record<TipoDeEfeito, string> = {
  desfoque: 'Desfoque',
  mosaico: 'Mosaico',
  tarja: 'Tarja',
}

/** Um retangulo do quadro, em fracao (0..1): canto de cima a esquerda, largura e altura. */
export const areaDoEfeitoSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.01).max(1),
  h: z.number().min(0.01).max(1),
})
export type AreaDoEfeito = z.infer<typeof areaDoEfeitoSchema>

export const efeitoDoClipeSchema = z.object({
  id: z.string(),
  tipo: z.enum(TIPOS_DE_EFEITO),
  /** 0..1: o quanto desfoca, o tamanho dos quadradinhos. Na tarja, nada. */
  forca: z.number().min(0).max(1).catch(0.5),
  /** null = a tela toda. */
  area: areaDoEfeitoSchema.nullable().catch(null),
  /** Cor da tarja (#RRGGBB). */
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).catch('#000000').optional(),
  /** Desligado sem apagar: para comparar com e sem. */
  ligado: z.boolean().catch(true).optional(),
})
export type EfeitoDoClipe = z.infer<typeof efeitoDoClipeSchema>

/** A lista de um clipe; o que estiver quebrado sai, o resto fica. */
export const efeitosSchema = z
  .array(z.unknown())
  .transform((l) => l.flatMap((e) => {
    const ok = efeitoDoClipeSchema.safeParse(e)
    return ok.success ? [ok.data] : []
  }))

/** A area padrao de quem liga "so uma area": um retangulo no meio. */
export const AREA_PADRAO: AreaDoEfeito = { x: 0.3, y: 0.35, w: 0.4, h: 0.3 }

export function novoEfeito(tipo: TipoDeEfeito): EfeitoDoClipe {
  return {
    id: `ef-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    tipo,
    forca: 0.5,
    area: null,
    ...(tipo === 'tarja' ? { cor: '#000000' } : {}),
  }
}

/** Os que valem de fato (ligados, e a tarja/forca que desenha algo). */
export function efeitosAtivos(l: readonly EfeitoDoClipe[] | undefined | null): EfeitoDoClipe[] {
  return (l ?? []).filter((e) => e.ligado !== false && (e.tipo === 'tarja' || e.forca > 0))
}

/** A area que fica dentro do quadro (nada passa da borda). */
export function areaNoQuadro(a: AreaDoEfeito | null): AreaDoEfeito {
  if (!a) return { x: 0, y: 0, w: 1, h: 1 }
  const w = Math.min(Math.max(a.w, 0.01), 1)
  const h = Math.min(Math.max(a.h, 0.01), 1)
  return { x: Math.min(Math.max(a.x, 0), 1 - w), y: Math.min(Math.max(a.y, 0), 1 - h), w, h }
}

/**
 * Do 0..1 da tela para o filtro, em px do quadro de 1080 de largura:
 * desfoque de 4 a 60 px (desvio), mosaico de quadradinhos de 12 a 120 px.
 * Proporcional a largura do quadro, para o 16:9 ficar igual ao 9:16.
 */
export function desvioDoDesfoque(forca: number, largura: number): number {
  return ((4 + 56 * Math.min(Math.max(forca, 0), 1)) * largura) / 1080
}

export function ladoDoMosaico(forca: number, largura: number): number {
  return Math.max(2, Math.round(((12 + 108 * Math.min(Math.max(forca, 0), 1)) * largura) / 1080))
}
