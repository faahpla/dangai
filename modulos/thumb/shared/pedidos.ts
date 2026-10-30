import { z } from 'zod'
import {
  cenaDoVideoSchema,
  FONTES_DA_THUMB,
  thumbDoProjetoSchema,
  type FonteDaThumb,
  type ThumbDoProjeto,
} from './thumb'

/**
 * [thumb] Os pedidos do modulo Thumbnail (conferidos no main) e a config dele.
 * Fora de canais.ts de proposito: a ponte (sandbox) nao leva o zod.
 */

// ------------------------------------------------------------- a config

/**
 * O ULTIMO PRESET do editor solto (o texto, as cores, a fonte, a altura, o
 * tamanho, o layout, a seta ligada e o divisor): abrir de novo comeca dele. As imagens nunca: o
 * editor solto abre vazio.
 */
export const presetDaThumbSchema = z.object({
  layout: thumbDoProjetoSchema.shape.layout,
  linhas: thumbDoProjetoSchema.shape.linhas,
  cores: thumbDoProjetoSchema.shape.cores,
  fonte: z.enum(FONTES_DA_THUMB.map((f) => f.id) as [FonteDaThumb, ...FonteDaThumb[]]),
  textoY: thumbDoProjetoSchema.shape.textoY,
  seta: z.boolean(),
  /** O "Tamanho do texto" e o divisor (ausentes num preset de antes: 100% e desligado). */
  tamanho: thumbDoProjetoSchema.shape.tamanho,
  divisor: thumbDoProjetoSchema.shape.divisor,
})
export type PresetDaThumb = z.infer<typeof presetDaThumbSchema>

export const configDaThumbSchema = z.object({
  versao: z.literal(1),
  preset: presetDaThumbSchema.nullable(),
})
export type ConfigDaThumb = z.infer<typeof configDaThumbSchema>
export const CONFIG_DA_THUMB_PADRAO: ConfigDaThumb = { versao: 1, preset: null }

/** O preset de uma thumb (o que o editor solto lembra). */
export function presetDe(t: ThumbDoProjeto): PresetDaThumb {
  return { layout: t.layout, linhas: t.linhas, cores: t.cores, fonte: t.fonte, textoY: t.textoY, seta: t.seta.ligada, tamanho: t.tamanho, divisor: { ...t.divisor } }
}

/** A thumb do comeco a partir do preset (sem preset: o padrao do editor, com o texto vazio). */
export function thumbDoPreset(preset: PresetDaThumb | null, base: ThumbDoProjeto): ThumbDoProjeto {
  if (!preset) return base
  return {
    ...base,
    layout: preset.layout,
    linhas: preset.linhas,
    cores: preset.cores,
    fonte: preset.fonte,
    textoY: preset.textoY,
    seta: { ligada: preset.seta, base: null, ponta: null },
    tamanho: preset.tamanho,
    divisor: { ...preset.divisor },
  }
}

// ------------------------------------------------------------- os pedidos

/** A thumb do modulo no projeto: `modulos.thumb` = { versao, thumb } (o resto do projeto nao e dele). */
export const thumbNoProjetoSchema = z.object({
  versao: z.literal(1),
  thumb: z.unknown(),
})

export const pedidoDeSugestoesDoProjetoSchema = z.object({
  cenas: z.array(cenaDoVideoSchema).max(2000),
})

export const pedidoDeImagemSchema = z.object({
  /** Onde o dialogo abre (a pasta da ultima imagem). */
  pasta: z.string().max(1024).nullable(),
  /** A pasta do projeto: a imagem e COPIADA para <projeto>/thumb. null = fica onde esta (editor solto). */
  projeto: z.string().max(1024).nullable(),
})
export type PedidoDeImagem = z.infer<typeof pedidoDeImagemSchema>

export const pedidoDeCopiaSchema = z.object({
  arquivo: z.string().min(1).max(1024),
  projeto: z.string().max(1024).nullable(),
})
export type PedidoDeCopia = z.infer<typeof pedidoDeCopiaSchema>

export const pedidoDoVideoSchema = z.object({
  /** A narracao do projeto: o render cai ao lado dela (`<narracao>-short.mp4`). */
  audio: z.string().max(1024).nullable(),
  /** O ultimo render desta sessao (lastOutput do nucleo). */
  ultimo: z.string().max(1024).nullable(),
})
export type PedidoDoVideo = z.infer<typeof pedidoDoVideoSchema>

export const pedidoDeSalvarComoSchema = z.object({
  png: z.instanceof(Uint8Array),
  /** Onde o dialogo abre. */
  pasta: z.string().max(1024).nullable(),
  /** O nome sugerido (`<imagem>-thumb.png`). */
  nome: z.string().min(1).max(255),
})
export type PedidoDeSalvarComo = z.infer<typeof pedidoDeSalvarComoSchema>
