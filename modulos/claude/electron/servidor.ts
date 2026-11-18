import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { FERRAMENTAS } from '../shared/ferramentas'

/**
 * [claude] O SERVIDOR MCP: HTTP so em 127.0.0.1, o transporte "streamable HTTP"
 * do MCP no modo mais simples (cada POST e um JSON-RPC e a resposta volta como
 * JSON, sem stream). Pede a senha (Authorization: Bearer) em todo pedido: outro
 * programa do PC nao mexe no projeto sem ela.
 */

export interface Conteudo {
  type: 'text' | 'image'
  text?: string
  data?: string
  mimeType?: string
}

export type ChamarFerramenta = (nome: string, args: Record<string, unknown>) => Promise<Conteudo[]>

interface Rpc {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const VERSOES = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

export const INSTRUCOES =
  'Edita o projeto aberto no Dangai (shorts 9:16 de anime). Fluxo: "estado" -> "listar_cenas" -> "ver_cenas" (imagem do recorte 9:16) -> ' +
  '"editar" com TODAS as mudancas num lote so -> "ver_cenas" de novo para conferir. "desfazer" volta o ultimo lote. ' +
  'focoX vai de 0 (esquerda) a 1 (direita); para centrar um rosto que esta na fracao cx da largura do quadro 16:9: focoX = (cx - 0,158) / 0,684. ' +
  'Prefira zoom-in/zoom-out (pan tira o rosto do centro), entrada no melhor momento do clipe (ver_clipe), corpo inteiro > close. ' +
  'Cenas favoritas do usuario (a estrela da Biblioteca): buscar_na_biblioteca com favoritas: true -- use primeiro quando servirem. ' +
  'Legenda: presets_de_legenda lista os presets salvos e diz qual bate com o projeto; aplicar: "<nome>" poe o preset.'

/** O JSON-RPC puro (sem HTTP), para o teste. null = notificacao (sem resposta). */
export async function responderRpc(pedido: Rpc, versaoDoApp: string, chamar: ChamarFerramenta): Promise<Record<string, unknown> | null> {
  const id = pedido.id ?? null
  const ok = (result: unknown): Record<string, unknown> => ({ jsonrpc: '2.0', id, result })
  const erro = (code: number, message: string): Record<string, unknown> => ({ jsonrpc: '2.0', id, error: { code, message } })
  if (pedido.id === undefined || pedido.id === null) return null
  switch (pedido.method) {
    case 'initialize': {
      const pedida = String(pedido.params?.['protocolVersion'] ?? '')
      return ok({
        protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'dangai', version: versaoDoApp },
        instructions: INSTRUCOES,
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: FERRAMENTAS })
    case 'tools/call': {
      const nome = String(pedido.params?.['name'] ?? '')
      if (!FERRAMENTAS.some((f) => f.name === nome)) return erro(-32602, `Ferramenta desconhecida: ${nome}`)
      const args = (pedido.params?.['arguments'] ?? {}) as Record<string, unknown>
      try {
        return ok({ content: await chamar(nome, args) })
      } catch (e) {
        // Erro da ferramenta volta como resultado (o Claude le e corrige), nao como erro de protocolo.
        return ok({ content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
      }
    }
    default:
      return erro(-32601, `Metodo nao suportado: ${String(pedido.method)}`)
  }
}

function lerCorpo(req: IncomingMessage, teto = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let tam = 0
    const partes: Buffer[] = []
    req.on('data', (b: Buffer) => {
      tam += b.length
      if (tam > teto) {
        reject(new Error('pedido grande demais'))
        req.destroy()
      } else partes.push(b)
    })
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')))
    req.on('error', reject)
  })
}

function senhaConfere(req: IncomingMessage, senha: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')
  if (!m || !senha) return false
  const a = Buffer.from(m[1]!.trim())
  const b = Buffer.from(senha)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Pagina da web nao fala com o servidor (DNS rebinding): so sem Origin ou de localhost. */
function origemBoa(req: IncomingMessage): boolean {
  const o = req.headers.origin
  if (!o) return true
  try {
    const h = new URL(o).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
  } catch {
    return false
  }
}

function enviar(res: ServerResponse, status: number, corpo?: unknown): void {
  if (corpo === undefined) {
    res.writeHead(status).end()
    return
  }
  const texto = JSON.stringify(corpo)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(texto) }).end(texto)
}

export interface ServidorLigado {
  porta: number
  fechar(): Promise<void>
}

/** Sobe na porta pedida (ou na proxima livre, ate +10). */
export async function subirServidor(
  portaPedida: number,
  senha: () => string,
  versaoDoApp: string,
  chamar: ChamarFerramenta,
): Promise<ServidorLigado> {
  const atender = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const caminho = (req.url ?? '/').split('?')[0]
    if (caminho !== '/mcp') return enviar(res, 404, { erro: 'use /mcp' })
    if (!origemBoa(req)) return enviar(res, 403, { erro: 'origem recusada' })
    if (!senhaConfere(req, senha())) return enviar(res, 401, { erro: 'senha errada (veja Configuracoes > Claude no Dangai)' })
    if (req.method === 'GET' || req.method === 'DELETE') return enviar(res, 405)
    if (req.method !== 'POST') return enviar(res, 405)
    let corpo: unknown
    try {
      corpo = JSON.parse(await lerCorpo(req))
    } catch {
      return enviar(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalido' } })
    }
    const lote = Array.isArray(corpo) ? (corpo as Rpc[]) : [corpo as Rpc]
    const respostas = (await Promise.all(lote.map((p) => responderRpc(p, versaoDoApp, chamar)))).filter((r) => r !== null)
    if (respostas.length === 0) return enviar(res, 202)
    enviar(res, 200, Array.isArray(corpo) ? respostas : respostas[0])
  }

  for (let porta = portaPedida; porta <= portaPedida + 10; porta++) {
    const servidor: Server = createServer((req, res) => {
      atender(req, res).catch((e) => {
        console.error('[claude] pedido:', e)
        if (!res.headersSent) enviar(res, 500, { erro: String(e) })
      })
    })
    const subiu = await new Promise<boolean>((resolve) => {
      servidor.once('error', () => resolve(false))
      servidor.listen(porta, '127.0.0.1', () => resolve(true))
    })
    if (subiu) {
      return {
        porta,
        fechar: () =>
          new Promise<void>((resolve) => {
            servidor.closeAllConnections?.()
            servidor.close(() => resolve())
          }),
      }
    }
  }
  throw new Error(`As portas ${portaPedida}-${portaPedida + 10} estao ocupadas.`)
}
