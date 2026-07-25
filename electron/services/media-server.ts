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
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
}

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

  const contentType = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
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
      'Content-Type': contentType,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    })
    createReadStream(path, { start, end }).pipe(res)
    return
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
  })
  createReadStream(path).pipe(res)
}
