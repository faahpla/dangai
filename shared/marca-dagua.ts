import { z } from 'zod'

/**
 * MARCA D'AGUA POR CANAL (28/11): "preciso deixar uma marca d'agua nos meus
 * videos, uma pra cada canal, pq tem uma galera roubando. Eu tenho os arquivos
 * ja na posicao que eu quero na resolucao 9:16, e quero essas PNGs em modo
 * overlay".
 *
 * Cada canal e cadastrado UMA vez nas Configuracoes (nome, o PNG do tamanho do
 * video, o modo de mistura e a forca). O projeto guarda qual marca usa (o id);
 * o video novo nasce com a ultima escolhida. No video, o PNG cobre o quadro
 * inteiro, por cima de tudo (legenda inclusive), misturado pelo modo -- o
 * `mix-blend-mode` do CSS, o mesmo na previa e no render.
 */

export const MODOS_DA_MARCA = ['overlay', 'normal', 'soft-light', 'screen', 'multiply'] as const
export type ModoDaMarca = (typeof MODOS_DA_MARCA)[number]

export const NOME_DO_MODO: Record<ModoDaMarca, string> = {
  overlay: 'Overlay',
  normal: 'Normal',
  'soft-light': 'Luz suave',
  screen: 'Clarear (Screen)',
  multiply: 'Escurecer (Multiply)',
}

export const marcaDaguaSchema = z.object({
  id: z.string().min(1),
  nome: z.string().trim().min(1).max(40),
  /** O PNG no disco (o tamanho do video, ja na posicao). */
  caminho: z.string().min(1),
  modo: z.enum(MODOS_DA_MARCA).catch('overlay'),
  /** 0..1. */
  opacidade: z.number().min(0).max(1).catch(1),
})
export type MarcaDagua = z.infer<typeof marcaDaguaSchema>

/** A lista guardada nas configuracoes; a que estiver quebrada fica de fora. */
export function lerMarcas(lista: readonly unknown[] | undefined): MarcaDagua[] {
  return (lista ?? []).flatMap((m) => {
    const ok = marcaDaguaSchema.safeParse(m)
    return ok.success ? [ok.data] : []
  })
}

export function novaMarca(nome: string, caminho: string): MarcaDagua {
  return {
    id: `marca-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    nome: nome.trim().slice(0, 40) || 'Canal',
    caminho,
    modo: 'overlay',
    opacidade: 1,
  }
}

/** O nome do arquivo sem extensao, para sugerir o nome do canal. */
export function nomeSugerido(caminho: string): string {
  return (caminho.split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/, '').slice(0, 40)
}

/** O que vai para o video: o arquivo (ja com a URL desta sessao), o modo e a forca. */
export const marcaNoVideoSchema = z.object({
  url: z.string(),
  modo: z.enum(MODOS_DA_MARCA),
  opacidade: z.number().min(0).max(1),
})
export type MarcaNoVideo = z.infer<typeof marcaNoVideoSchema>
