import { BrowserWindow, clipboard, dialog, type OpenDialogOptions } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { copiarParaOProjeto, IMAGENS_DA_THUMB } from './editor'

/**
 * [thumb] O CTRL+V E A PASTA DAS THUMBS (05/11, pedidos do Levi), no main --
 * os dois modulos (Thumbnail e a aba do recap) usam estes:
 *
 * - COLAR: o que estiver na area de transferencia vira a imagem do slot. Um
 *   ARQUIVO copiado no Explorer (a lista de arquivos do Windows, FileNameW) vale
 *   pelo caminho; uma IMAGEM copiada (print, "Copiar imagem" do navegador)
 *   vira um PNG na pasta `cache` (o nome pelo conteudo: colar a mesma de novo
 *   nao duplica). No modo projeto, a imagem e COPIADA para <projeto>/thumb, como
 *   a escolhida no dialogo. null = nao ha imagem para colar.
 * - ESCOLHER A PASTA: o dialogo de pasta; null = desistiu.
 */

/** O arquivo de imagem copiado no Explorer (o primeiro da lista), se houver. */
function arquivoCopiado(): string | null {
  try {
    const cru = clipboard.readBuffer('FileNameW')
    if (cru.length < 4) return null
    const caminho = cru.toString('utf16le').replace(/\0[\s\S]*$/, '').trim()
    if (!caminho || !IMAGENS_DA_THUMB.has(extname(caminho).toLowerCase()) || !existsSync(caminho)) return null
    return caminho
  } catch {
    return null
  }
}

export function colarImagem(cache: string, projeto: string | null): string | null {
  const arquivo = arquivoCopiado()
  if (arquivo) return copiarParaOProjeto(arquivo, projeto)
  const img = clipboard.readImage()
  if (img.isEmpty()) return null
  const png = img.toPNG()
  const pasta = join(cache, 'coladas')
  mkdirSync(pasta, { recursive: true })
  const nome = `colada-${createHash('sha1').update(png).digest('hex').slice(0, 12)}.png`
  const destino = join(pasta, nome)
  if (!existsSync(destino)) writeFileSync(destino, png)
  return copiarParaOProjeto(destino, projeto)
}

export async function escolherPasta(atual: string | null): Promise<string | null> {
  const opcoes: OpenDialogOptions = {
    title: 'Pasta das thumbnails',
    properties: ['openDirectory', 'createDirectory'],
    ...(atual && existsSync(atual) ? { defaultPath: atual } : {}),
  }
  const dono = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const r = dono ? await dialog.showOpenDialog(dono, opcoes) : await dialog.showOpenDialog(opcoes)
  return r.canceled ? null : (r.filePaths[0] ?? null)
}
