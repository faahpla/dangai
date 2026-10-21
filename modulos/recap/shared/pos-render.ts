import { z } from 'zod'

/**
 * [recap] A TELA POS-RENDER (a do CapCut depois de exportar): o video pronto
 * tocando a esquerda e, a direita, o que ele copia para publicar -- os 3
 * titulos e os 3 textos de thumb que a IA sugeriu junto com o roteiro, a
 * descricao e as hashtags (o metadata do nucleo), "Copiar tudo", "Abrir
 * pasta" e "Fechar". So nos projetos do recap (`modulos.recap` na raiz).
 */

/** O pedido ao main: o arquivo que o render gravou e de onde o projeto veio. */
export const pedidoDoPosRenderSchema = z.object({
  outputPath: z.string().min(1).max(1024),
  rascunhoId: z.string().regex(/^rc_[0-9a-z_]+$/).nullable(),
  roteiroVersao: z.number().int().positive().nullable(),
  /** O .dangai aberto: se o video saiu do lugar com a pasta do projeto, procura pelo nome nela. */
  projetoPath: z.string().max(1024).nullable().optional(),
})
export type PedidoDoPosRender = z.infer<typeof pedidoDoPosRenderSchema>

/** A resposta: a URL do video (servidor local do nucleo) e as sugestoes da versao do roteiro. */
export interface TextosDoPosRender {
  /** null = o arquivo sumiu (ou nao e video). */
  videoUrl: string | null
  /** Onde o video foi achado (o gravado, ou o de mesmo nome na pasta do projeto). */
  videoPath: string | null
  titulos: string[]
  thumbs: string[]
}

/**
 * "Escrever de novo" nos titulos e nos textos de thumb: UM pedido para os dois
 * (gasta menos), com o roteiro do projeto e o que ja esta na tela (a IA da
 * opcoes DIFERENTES). O resultado fica no projeto (`modulos.recap.sugestoesDoVideo`).
 */
export const pedidoDeTitulosSchema = z.object({
  /** O roteiro do projeto agora (o `script`); vazio = o texto da versao do rascunho. */
  roteiro: z.string().max(20_000),
  rascunhoId: z.string().regex(/^rc_[0-9a-z_]+$/).nullable(),
  roteiroVersao: z.number().int().positive().nullable(),
  atuais: z.object({ titulos: z.array(z.string().max(200)).max(10), thumbs: z.array(z.string().max(80)).max(10) }),
})
export type PedidoDeTitulos = z.infer<typeof pedidoDeTitulosSchema>
export interface TitulosNovos {
  /** Vazia = a IA nao trouxe titulo novo que sirva (a tela fica com os de antes). */
  titulos: string[]
  thumbs: string[]
}

/** O teto de titulo do YouTube: a contagem fica em aviso passando disso. */
export const TITULO_MAX = 100

/** As hashtags como vao para a plataforma: "#a #b". */
export function hashtagsEmTexto(hashtags: readonly string[]): string {
  return hashtags
    .map((h) => h.trim().replace(/^#+/, ''))
    .filter((h) => h.length > 0)
    .map((h) => `#${h}`)
    .join(' ')
}

/**
 * O "Copiar tudo": cada bloco com o rotulo dele, na ordem da tela, so os que
 * tem algo. Texto puro, para colar num bloco de notas ou no chat.
 */
export function textoDeCopiarTudo(t: {
  titulos: readonly string[]
  thumbs: readonly string[]
  descricao: string | null
  hashtags: readonly string[]
}): string {
  const blocos: string[] = []
  if (t.titulos.length > 0) blocos.push(['TITULOS', ...t.titulos.map((x, i) => `${i + 1}. ${x}`)].join('\n'))
  if (t.thumbs.length > 0) blocos.push(['TEXTO DA THUMBNAIL', ...t.thumbs.map((x, i) => `${i + 1}. ${x.toLocaleUpperCase('pt-BR')}`)].join('\n'))
  if (t.descricao?.trim()) blocos.push(['DESCRICAO', t.descricao.trim()].join('\n'))
  const tags = hashtagsEmTexto(t.hashtags)
  if (tags) blocos.push(['HASHTAGS', tags].join('\n'))
  return blocos.join('\n\n')
}
