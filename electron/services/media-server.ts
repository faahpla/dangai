import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'

/**
 * Servidor HTTP efemero em 127.0.0.1 que expoe os arquivos do usuario.
 *
 * Existe por dois motivos que se resolvem juntos:
 *  - o Chrome headless do render nao le file:// arbitrario;
 *  - o preview (@remotion/player, no renderer) e o render (Chrome headless)
 *    passam a consumir a MESMA URL, entao o que aparece no preview e o que sai
 *    no MP4.
 *
 * So serve caminho explicitamente publicado. Um pedido para qualquer outro
 * caminho recebe 404 -- nao existe travessia de diretorio porque nao existe
 * caminho vindo da URL: a URL carrega um id opaco.
 */

const MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  // Clipes. O Range logo abaixo ja existia para o audio e serve a estes tambem
  // -- e obrigatorio: o extrator de frames busca posicao em vez de ler tudo.
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  // As fontes que ele larga na pasta, para as legendas. Ver FONTES abaixo.
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

/**
 * FONTE EXIGE CORS, e so fonte.
 *
 * A interface do app roda de `file://` (e em dev, do servidor do Vite), e o
 * render roda num Chrome proprio servido pelo Remotion -- as duas sao OUTRA
 * origem em relacao a este servidor. Imagem, video e audio carregam de outra
 * origem sem pedir licenca nenhuma; FONTE NAO: a especificacao exige que o
 * servidor autorize, e sem isso o navegador recusa o arquivo.
 *
 * Foi assim que a fonte escolhida para as legendas nunca aparecia no video:
 * o FontFace dava NetworkError, o app caia calado na Komika Axis, e o aviso
 * ia para um console que ninguem ve. Reportado pelo ajk ("tentou adicionar
 * outra fonte para as legendas e nao altera no video") e confirmado
 * carregando a fonte do jeito que o app carrega, a partir de `file://`.
 *
 * So as fontes ganham a liberacao: e o unico tipo que precisa dela, e o resto
 * continua sem ser legivel por outra origem. O servidor so escuta 127.0.0.1 e
 * cada arquivo mora atras de um id sorteado, entao liberar uma fonte que ele
 * mesmo largou na pasta nao expoe nada que valha proteger.
 */
const FONTES = new Set(['.ttf', '.otf', '.woff', '.woff2'])

/** id opaco -> caminho absoluto no disco */
const published = new Map<string, string>()
/** caminho -> id, para republicar o mesmo arquivo nao vazar ids */
const byPath = new Map<string, string>()

let baseUrl: string | null = null
let starting: Promise<string> | null = null

export function startMediaServer(): Promise<string> {
  if (baseUrl) return Promise.resolve(baseUrl)
  if (starting) return starting

  starting = new Promise<string>((resolve, reject) => {
    const server = createServer(handleRequest)

    server.on('error', (err) => {
      starting = null
      reject(new Error(`Servidor de midia local nao subiu: ${err.message}`))
    })

    // Porta 0: o SO escolhe uma livre. Escuta so em loopback.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      baseUrl = `http://127.0.0.1:${address.port}`
      resolve(baseUrl)
    })

    server.unref()
  })

  return starting
}

/** Publica um arquivo e devolve a URL completa para ele. */
export function publish(absolutePath: string): string {
  if (!baseUrl) {
    throw new Error('Servidor de midia ainda nao subiu')
  }

  const existing = byPath.get(absolutePath)
  if (existing) return `${baseUrl}/m/${existing}`

  const id = randomUUID()
  published.set(id, absolutePath)
  byPath.set(absolutePath, id)
  return `${baseUrl}/m/${id}`
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const id = req.url?.startsWith('/m/') ? req.url.slice(3) : null
  const path = id ? published.get(id) : undefined

  if (!path) {
    res.writeHead(404).end()
    return
  }

  let size: number
  try {
    size = statSync(path).size
  } catch {
    res.writeHead(404).end()
    return
  }

  const extensao = extname(path).toLowerCase()
  const contentType = MIME[extensao] ?? 'application/octet-stream'
  const cors: Record<string, string> = FONTES.has(extensao)
    ? { 'Access-Control-Allow-Origin': '*' }
    : {}
  const range = req.headers.range

  // Range e obrigatorio para o <Audio> conseguir buscar posicao no preview.
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    const start = match?.[1] ? Number(match[1]) : 0
    const end = match?.[2] ? Number(match[2]) : size - 1

    if (start >= size || end >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return
    }

    res.writeHead(206, {
      ...cors,
      'Content-Type': contentType,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    })
    createReadStream(path, { start, end }).pipe(res)
    return
  }

  res.writeHead(200, {
    ...cors,
    'Content-Type': contentType,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
  })
  createReadStream(path).pipe(res)
}
