/**
 * Conexao CDP com o app em dev.
 *
 * Mora no repositorio e nao no scratchpad: o scratchpad e limpo de tempos em
 * tempos, e perder isto no meio de uma investigacao custa uma reescrita a cada
 * vez. Uso: `npx electron-vite dev -- --remote-debugging-port=9333`.
 */
const CDP = 'http://127.0.0.1:9333'

const alvos = await (await fetch(`${CDP}/json/list`)).json()
const pagina = alvos.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
if (!pagina) throw new Error('Janela do app nao encontrada')

const ws = new WebSocket(pagina.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

let seq = 0
const pendentes = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  const p = pendentes.get(msg.id)
  if (p) {
    pendentes.delete(msg.id)
    p(msg)
  }
})

export function enviar(method, params = {}) {
  const id = (seq += 1)
  return new Promise((resolve) => {
    pendentes.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

export async function avaliar(expressao) {
  const r = await enviar('Runtime.evaluate', {
    expression: `(async () => { ${expressao} })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (!r.result) throw new Error('CDP respondeu sem resultado: ' + JSON.stringify(r).slice(0, 300))
  if (r.result.exceptionDetails) {
    const e = r.result.exceptionDetails
    throw new Error(e.exception?.description ?? e.text ?? JSON.stringify(e).slice(0, 300))
  }
  return r.result.result?.value
}

/** Espera o renderer subir e expor o store (so existe em dev). */
export async function esperarStore(tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    if (await avaliar(`return typeof window.dangaiStore === 'function'`)) return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('window.dangaiStore nao apareceu')
}

export function fechar() {
  ws.close()
}
