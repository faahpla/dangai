import { BrowserWindow, clipboard, dialog, nativeImage, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import sharp from 'sharp'
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

/**
 * (12/11) O BOTAO DIREITO NAS SUGESTOES, pedido do Levi: "salvar imagem como" e
 * "copiar imagem" (para dar Ctrl+V em outro lugar). Os dois recebem o quadro
 * CHEIO ja no cache (quadroEmCache: PNG sem as barras pretas), nao a miniatura.
 */
export function copiarQuadro(png: string): boolean {
  const img = nativeImage.createFromPath(png)
  if (img.isEmpty()) throw new Error('Nao deu para ler esse quadro.')
  clipboard.writeImage(img)
  return true
}

/** O dialogo de salvar (PNG ou JPG) e a copia do quadro; null = desistiu. */
export async function salvarQuadroComo(png: string, nome: string, pasta: string | null): Promise<string | null> {
  const opcoes: SaveDialogOptions = {
    title: 'Salvar imagem como',
    defaultPath: pasta && existsSync(pasta) ? join(pasta, nome) : nome,
    filters: [
      { name: 'PNG', extensions: ['png'] },
      { name: 'JPG', extensions: ['jpg', 'jpeg'] },
    ],
    properties: ['showOverwriteConfirmation'],
  }
  const dono = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const r = dono ? await dialog.showSaveDialog(dono, opcoes) : await dialog.showSaveDialog(opcoes)
  if (r.canceled || !r.filePath) return null
  const ext = extname(r.filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') {
    await sharp(png).jpeg({ quality: 95 }).toFile(r.filePath)
    return r.filePath
  }
  const destino = ext === '.png' ? r.filePath : `${r.filePath}.png`
  copyFileSync(png, destino)
  return destino
}
