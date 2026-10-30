import { BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { CANAIS_DA_THUMB as C, type MotorDaThumb } from '../shared/canais'
import {
  configDaThumbSchema,
  pedidoDeCopiaSchema,
  pedidoDeImagemSchema,
  pedidoDeSalvarComoSchema,
  pedidoDeSugestoesDoProjetoSchema,
  pedidoDoVideoSchema,
  presetDaThumbSchema,
  type ConfigDaThumb,
} from '../shared/pedidos'
import {
  pedidoDeQuadroSchema,
  pedidoDeRecorteSchema,
  pedidoDeSalvarSchema,
  type CenaDoVideo,
  type QuadroDaThumb,
  type RecorteDaThumb,
  type ResultadoDoSalvar,
  type RostoDaThumb,
  type SugestoesDaThumb,
} from '../shared/thumb'
import { contexto } from './contexto'
import { copiarParaOProjeto, criarEditorNoMain, espalhar, IMAGENS_DA_THUMB, quadroRapido, salvarPngEm, salvarThumb, temUpscale, videoDoProjeto } from './editor'
import { motivoSemMotor, motorDeRostos } from './motor'

/**
 * [thumb] OS CANAIS DO MODULO THUMBNAIL (`thumb:`). O editor em comum
 * (editor.ts) com o cache na pasta local DO MODULO (%LOCALAPPDATA%\<app>\thumb)
 * e so o detector do motor emprestado pelo recap (motor.ts) -- sem ele, sem
 * rosto (a imagem no meio), nunca o detector antigo do nucleo: frontal, ele
 * acha rosto errado em anime e o enquadramento iria para o lugar errado.
 *
 * Escreve so: o cache local, a copia da imagem em <projeto>/thumb (modo
 * projeto), o PNG onde ele mandou e o preset nas configuracoes do modulo.
 */

const editor = criarEditorNoMain({
  pasta: () => join(contexto().pasta('local'), 'cache'),
  rotulo: '[thumb]',
  motor: () => {
    const m = motorDeRostos()
    return m && motivoSemMotor() === null ? m.detector : null
  },
  antigo: null,
})

/** As sugestoes de um projeto longo: no maximo isto de cenas (espalhadas), um quadro de cada. */
const CENAS_MAX = 48

function janela(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
}

function imagemValida(caminho: string): string {
  if (!IMAGENS_DA_THUMB.has(extname(caminho).toLowerCase())) throw new Error('So PNG, JPG, WEBP ou BMP.')
  if (!existsSync(caminho)) throw new Error('Essa imagem nao esta mais no lugar.')
  return caminho
}

export function registrarCanais(ctx: ContextoDoModulo): void {
  ctx.handle<[unknown], QuadroDaThumb>(C.quadro, async (p) => editor.quadroDaThumb(pedidoDeQuadroSchema.parse(p)))
  ctx.handle<[unknown], Uint8Array>(C.miniatura, async (p) => {
    const pedido = pedidoDeQuadroSchema.parse(p)
    return quadroRapido(pedido.arquivo, pedido.t)
  })
  ctx.handle<[unknown], RostoDaThumb[] | null>(C.rostos, async (p) => {
    const pedido = pedidoDeQuadroSchema.parse(p)
    const caminho = await editor.quadroEmCache(pedido.arquivo, pedido.t)
    const r = await editor.rostosDasImagens([caminho])
    return r.rostos.get(caminho) ?? null
  })
  ctx.handle<[unknown], RecorteDaThumb>(C.recorte, async (p) => editor.recorteDaThumb(pedidoDeRecorteSchema.parse(p)))
  ctx.handle<[], boolean>(C.upscale, async () => temUpscale())
  ctx.handle<[], MotorDaThumb>(C.motor, async () => {
    const motivo = motivoSemMotor()
    return { pronto: motivo === null, motivo }
  })
  ctx.handle<[unknown], SugestoesDaThumb>(C.sugestoes, async (cenas) => {
    const lista: CenaDoVideo[] = pedidoDeSugestoesDoProjetoSchema.shape.cenas.parse(cenas)
    return editor.sugestoesDasCenas(espalhar(lista, CENAS_MAX), { medirNitidez: true })
  })
  ctx.handle<[unknown], string | null>(C.escolherImagem, async (p) => {
    const pedido = pedidoDeImagemSchema.parse(p)
    const opcoes: OpenDialogOptions = {
      title: 'Escolher a imagem da thumbnail',
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      ...(pedido.pasta && existsSync(pedido.pasta) ? { defaultPath: pedido.pasta } : {}),
    }
    const dono = janela()
    const r = dono ? await dialog.showOpenDialog(dono, opcoes) : await dialog.showOpenDialog(opcoes)
    const escolhida = r.canceled ? null : (r.filePaths[0] ?? null)
    return escolhida ? copiarParaOProjeto(imagemValida(escolhida), pedido.projeto) : null
  })
  ctx.handle<[unknown], string>(C.copiarImagem, async (p) => {
    const pedido = pedidoDeCopiaSchema.parse(p)
    return copiarParaOProjeto(imagemValida(pedido.arquivo), pedido.projeto)
  })
  ctx.handle<[unknown], string | null>(C.escolherProjeto, async (pasta) => {
    const inicio = typeof pasta === 'string' && existsSync(pasta) ? pasta : undefined
    const opcoes: OpenDialogOptions = {
      title: 'Escolher o projeto da thumbnail',
      properties: ['openFile'],
      filters: [{ name: 'Projeto do Dangai', extensions: ['dangai'] }],
      ...(inicio ? { defaultPath: inicio } : {}),
    }
    const dono = janela()
    const r = dono ? await dialog.showOpenDialog(dono, opcoes) : await dialog.showOpenDialog(opcoes)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  ctx.handle<[unknown], string | null>(C.videoDoProjeto, async (p) => {
    const pedido = pedidoDoVideoSchema.parse(p)
    return videoDoProjeto(pedido.audio, pedido.ultimo)
  })
  ctx.handle<[unknown], ResultadoDoSalvar>(C.salvarAoLado, async (p) => salvarThumb(pedidoDeSalvarSchema.parse(p)))
  ctx.handle<[unknown], ResultadoDoSalvar | null>(C.salvarComo, async (p) => {
    const pedido = pedidoDeSalvarComoSchema.parse(p)
    const pasta = pedido.pasta && existsSync(pedido.pasta) ? pedido.pasta : null
    const opcoes: SaveDialogOptions = {
      title: 'Salvar a thumbnail',
      defaultPath: pasta ? join(pasta, pedido.nome) : pedido.nome,
      filters: [{ name: 'PNG', extensions: ['png'] }],
      properties: ['showOverwriteConfirmation'],
    }
    const dono = janela()
    const r = dono ? await dialog.showSaveDialog(dono, opcoes) : await dialog.showSaveDialog(opcoes)
    if (r.canceled || !r.filePath) return null
    const destino = extname(r.filePath).toLowerCase() === '.png' ? r.filePath : `${r.filePath}.png`
    return { salvo: await salvarPngEm(destino, pedido.png) }
  })
  ctx.handle<[unknown], ConfigDaThumb>(C.salvarPreset, async (preset) =>
    configDaThumbSchema.parse(ctx.salvarConfig({ preset: presetDaThumbSchema.parse(preset) })),
  )
}
