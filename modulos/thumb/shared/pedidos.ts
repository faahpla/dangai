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
 * tamanho, a rotacao, o layout, a seta ligada e o divisor): abrir de novo comeca dele. As imagens nunca: o
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
  /** A "Rotacao" do texto (ausente num preset de antes: 0). */
  rotacao: thumbDoProjetoSchema.shape.rotacao,
  /** (04/11) O estilo (Kizuni, Faah, AJK), o degrade de cada linha, o contorno, a seta e a fonte do PC (ausentes: o de sempre). */
  estilo: thumbDoProjetoSchema.shape.estilo,
  degrades: thumbDoProjetoSchema.shape.degrades,
  contorno: thumbDoProjetoSchema.shape.contorno,
  /** (13/11) A "Sombra" do texto (ausente num preset de antes: a do estilo). */
  sombra: thumbDoProjetoSchema.shape.sombra,
  formaDaSeta: thumbDoProjetoSchema.shape.seta.shape.forma,
  fontePc: thumbDoProjetoSchema.shape.fontePc,
  /** (16/11) O angulo da sombra, as cores juntas e a cor da seta (ausentes num preset de antes: os de sempre). */
  anguloDaSombra: thumbDoProjetoSchema.shape.anguloDaSombra,
  coresJuntas: thumbDoProjetoSchema.shape.coresJuntas,
  corDaSeta: thumbDoProjetoSchema.shape.seta.shape.cor,
  degradeDaSeta: thumbDoProjetoSchema.shape.seta.shape.degrade,
})
export type PresetDaThumb = z.infer<typeof presetDaThumbSchema>

/**
 * (13/11) UM MODELO DA THUMB, com nome: "quero uma opcao de salvar
 * preset/modelo". O jeito inteiro de uma thumb -- o estilo, as cores e o
 * degrade, a fonte, o contorno, a sombra, o tamanho, a rotacao, a altura do
 * texto, o layout, o divisor e a seta (a livre com o lugar dela) -- para
 * aplicar com um clique em outra. Ficam de fora o TEXTO e as IMAGENS (sao de
 * cada video) e a COR das imagens (o "Do projeto" e de cada projeto).
 */
const S = thumbDoProjetoSchema.shape
export const modeloDaThumbSchema = z.object({
  nome: z.string().trim().min(1).max(40),
  layout: S.layout,
  cores: S.cores,
  degrades: S.degrades,
  fonte: S.fonte,
  fontePc: S.fontePc,
  estilo: S.estilo,
  contorno: S.contorno,
  sombra: S.sombra,
  tamanho: S.tamanho,
  rotacao: S.rotacao,
  textoY: S.textoY,
  divisor: S.divisor,
  seta: S.seta,
  /** (16/11) O angulo da sombra e as cores juntas (ausentes num modelo de antes: os de sempre). */
  anguloDaSombra: S.anguloDaSombra,
  coresJuntas: S.coresJuntas,
  /**
   * (16/11) O MODELO DE ABERTURA: "quero poder definir um modelo pra ir direto
   * sempre que o modulo for aberto". Um so na lista (marcar outro desmarca);
   * a thumb nova (solta, ou de um projeto que ainda nao tem) nasce com ele.
   */
  padrao: z.boolean().optional(),
})
export type ModeloDaThumb = z.infer<typeof modeloDaThumbSchema>
/** Quantos modelos cabem (o bastante; a lista nao vira um arquivo). */
export const MODELOS_NO_MAXIMO = 60
export const listaDeModelosSchema = z.array(modeloDaThumbSchema).max(MODELOS_NO_MAXIMO)

/** O modelo de uma thumb (a seta que aponta o rosto nao leva as pontas: ela procura o rosto de novo). */
export function modeloDe(t: ThumbDoProjeto, nome: string): ModeloDaThumb {
  return {
    nome: nome.trim().slice(0, 40),
    layout: t.layout,
    cores: [t.cores[0], t.cores[1]],
    degrades: [t.degrades[0], t.degrades[1]],
    fonte: t.fonte,
    fontePc: t.fontePc,
    estilo: t.estilo,
    contorno: { ...t.contorno },
    sombra: t.sombra,
    tamanho: t.tamanho,
    rotacao: t.rotacao,
    textoY: t.textoY,
    divisor: { ...t.divisor },
    seta: t.seta.livre ? { ...t.seta } : { ...t.seta, base: null, ponta: null },
    ...(t.anguloDaSombra === undefined ? {} : { anguloDaSombra: t.anguloDaSombra }),
    ...(t.coresJuntas === undefined ? {} : { coresJuntas: t.coresJuntas }),
  }
}

/**
 * O que aplicar um modelo muda numa thumb (o texto, as imagens e a cor delas
 * ficam). O que o modelo nao tem (um de antes do angulo da sombra) volta ao de
 * sempre, e nao fica o da thumb anterior.
 */
export function camposDoModelo(m: ModeloDaThumb): Partial<ThumbDoProjeto> {
  const { nome: _nome, padrao: _padrao, ...campos } = m
  return {
    anguloDaSombra: undefined,
    coresJuntas: undefined,
    ...campos,
    seta: { ...m.seta },
    divisor: { ...m.divisor },
    contorno: { ...m.contorno },
  }
}

/** JSON com as chaves em ordem (a seta montada aos pedacos tem as chaves em outra ordem que a do zod). */
function estavel(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, y]) => y !== undefined).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  )
}

/** O mesmo jeito (o nome e o "de abertura" nao contam). */
export function mesmoJeito(m: ModeloDaThumb, t: ThumbDoProjeto): boolean {
  const { nome: _a, padrao: _p, ...x } = m
  const { nome: _b, ...y } = modeloDe(t, m.nome)
  return estavel(x) === estavel(y)
}

/** O modelo de abertura da lista (null = nenhum marcado). */
export function modeloDeAbertura(lista: readonly ModeloDaThumb[]): ModeloDaThumb | null {
  return lista.find((m) => m.padrao) ?? null
}

export const configDaThumbSchema = z.object({
  versao: z.literal(1),
  preset: presetDaThumbSchema.nullable(),
  /** (13/11) Os modelos com nome (ausente numa config de antes: nenhum). */
  modelos: listaDeModelosSchema.default([]),
})
export type ConfigDaThumb = z.infer<typeof configDaThumbSchema>
export const CONFIG_DA_THUMB_PADRAO: ConfigDaThumb = { versao: 1, preset: null, modelos: [] }

/** O preset de uma thumb (o que o editor solto lembra). */
export function presetDe(t: ThumbDoProjeto): PresetDaThumb {
  return {
    layout: t.layout,
    linhas: t.linhas,
    cores: t.cores,
    fonte: t.fonte,
    textoY: t.textoY,
    seta: t.seta.ligada,
    tamanho: t.tamanho,
    divisor: { ...t.divisor },
    rotacao: t.rotacao,
    estilo: t.estilo,
    degrades: t.degrades,
    contorno: { ...t.contorno },
    sombra: t.sombra,
    formaDaSeta: t.seta.forma,
    fontePc: t.fontePc,
    anguloDaSombra: t.anguloDaSombra,
    coresJuntas: t.coresJuntas,
    corDaSeta: t.seta.cor,
    degradeDaSeta: t.seta.degrade,
  }
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
    seta: { ligada: preset.seta, base: null, ponta: null, forma: preset.formaDaSeta, cor: preset.corDaSeta, degrade: preset.degradeDaSeta },
    anguloDaSombra: preset.anguloDaSombra,
    coresJuntas: preset.coresJuntas,
    tamanho: preset.tamanho,
    divisor: { ...preset.divisor },
    rotacao: preset.rotacao,
    estilo: preset.estilo,
    degrades: preset.degrades,
    contorno: { ...preset.contorno },
    sombra: preset.sombra,
    fontePc: preset.fontePc,
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
