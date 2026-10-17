/**
 * RUNTIME DO MOTOR: a descarga das rodas do torch com retomada
 * (electron/services/motor-runtime/baixar.ts), contra um servidor HTTP local
 * que entende Range. Sem internet, grava so numa pasta temporaria.
 *
 * Casos: inteiro; conexao cortada no meio (retoma do byte certo); servidor
 * que ignora o Range (200: recomeca do zero); sha256 errado (apaga e
 * 'arquivo-corrompido'); 404 ('sem-internet' sem insistir); servidor fora do
 * ar (tenta, desiste com 'sem-internet'); cancelar no meio (a parte fica) e
 * continuar depois; .whl ja baixado nao baixa de novo; meta de outra versao
 * apaga a parte.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-motor-runtime-baixar.ts
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RodaDoTorch } from '../shared/motor-runtime'
import { baixarRoda, type FetchDoMotor } from '../electron/motor-runtime/baixar'
import { FalhaDaInstalacao, InstalacaoCancelada } from '../electron/motor-runtime/erros'

const TAM = 5 * 1024 * 1024 + 123
const dados = randomBytes(TAM)
const sha = createHash('sha256').update(dados).digest('hex')
const temp = mkdtempSync(join(tmpdir(), 'v-motor-runtime-baixar-'))

type Modo = 'normal' | 'corta' | 'sem-range' | '404' | 'lento'
let modo: Modo = 'normal'
let pedidos: { range: string | undefined; ifRange: string | undefined }[] = []
let cortesFeitos = 0

function responder(req: IncomingMessage, res: ServerResponse): void {
  pedidos.push({ range: req.headers.range, ifRange: req.headers['if-range'] as string | undefined })
  if (modo === '404') {
    res.writeHead(404).end('nao')
    return
  }
  const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '')
  const inicio = m && modo !== 'sem-range' ? Number(m[1]) : 0
  if (inicio >= TAM && m && modo !== 'sem-range') {
    res.writeHead(416, { 'Content-Range': `bytes */${TAM}` }).end()
    return
  }
  const corpo = dados.subarray(inicio)
  const cab: Record<string, string> = { 'Content-Length': String(corpo.length), ETag: '"v1"', 'Accept-Ranges': 'bytes' }
  if (inicio > 0) res.writeHead(206, { ...cab, 'Content-Range': `bytes ${inicio}-${TAM - 1}/${TAM}` })
  else res.writeHead(200, cab)
  if (modo === 'corta' && cortesFeitos < 2) {
    // Manda ~40% do que falta e derruba a conexao.
    cortesFeitos += 1
    res.write(corpo.subarray(0, Math.floor(corpo.length * 0.4)), () => setTimeout(() => res.socket?.destroy(), 30))
    return
  }
  if (modo === 'lento') {
    // 256 KB a cada 50 ms: da tempo de cancelar no meio.
    let i = 0
    const t = setInterval(() => {
      if (res.destroyed) return clearInterval(t)
      const pedaco = corpo.subarray(i, i + 256 * 1024)
      i += pedaco.length
      if (pedaco.length === 0) {
        clearInterval(t)
        res.end()
      } else res.write(pedaco)
    }, 50)
    res.on('close', () => clearInterval(t))
    return
  }
  res.end(corpo)
}

// [recap] Sem await no topo: o tsx roda o teste como CommonJS.
async function principal(): Promise<void> {
const servidor = createServer(responder)
await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
const porta = (servidor.address() as AddressInfo).port
const url = `http://127.0.0.1:${porta}/torch-teste.whl`
const fetchNode: FetchDoMotor = (u, init) => fetch(u, init)

function roda(extra: Partial<RodaDoTorch> = {}): RodaDoTorch {
  return { nome: 'torch', versao: '9.9.9+teste', arquivo: 'torch-teste.whl', url, sha256: sha, bytes: TAM, ...extra }
}

/** O recuo da retomada no teste (o real e 32 MB, maior que a roda falsa). */
const MARGEM = 64 * 1024

async function baixar(pasta: string, r: RodaDoTorch, signal = new AbortController().signal, esperas = [50, 50, 50]) {
  const andamento: number[] = []
  const caminho = await baixarRoda(r, pasta, {
    fetch: fetchNode,
    signal,
    log: () => {},
    esperas,
    silencioMs: 3000,
    margemDaRetomada: MARGEM,
    aoAndar: (n) => andamento.push(n),
  })
  return { caminho, andamento }
}

function zerar(): void {
  pedidos = []
  cortesFeitos = 0
}

try {
  // 1. inteiro
  zerar()
  modo = 'normal'
  let pasta = join(temp, '1')
  let r = await baixar(pasta, roda())
  assert.equal(readFileSync(r.caminho).equals(dados), true)
  assert.equal(existsSync(`${r.caminho}.part`), false)
  assert.equal(existsSync(`${r.caminho}.part.json`), false)
  assert.equal(r.andamento[r.andamento.length - 1], TAM)
  console.log(`ok inteiro (${pedidos.length} pedido)`)

  // 2. ja baixado: nenhum pedido
  zerar()
  r = await baixar(pasta, roda())
  assert.equal(pedidos.length, 0, 'o .whl conferido nao baixa de novo')
  console.log('ok ja baixado')

  // 3. cortada no meio duas vezes: retoma do byte certo com Range e If-Range
  zerar()
  modo = 'corta'
  pasta = join(temp, '3')
  r = await baixar(pasta, roda())
  assert.equal(readFileSync(r.caminho).equals(dados), true)
  assert.equal(pedidos[0]!.range, undefined)
  assert.match(pedidos[1]!.range ?? '', /^bytes=\d+-$/)
  assert.equal(pedidos[1]!.ifRange, '"v1"')
  assert.ok(pedidos.length >= 3)
  console.log(`ok cortada e retomada (${pedidos.map((p) => p.range ?? 'inteiro').join(', ')})`)

  // 4. servidor ignora o Range: 200 recomeca do zero, sem duplicar bytes
  zerar()
  modo = 'normal'
  pasta = join(temp, '4')
  const parte = join(pasta, 'torch-teste.whl.part')
  rmSync(pasta, { recursive: true, force: true })
  await baixar(pasta, roda()).catch(() => {})
  // poe uma parte de 1 MB valida e pede de novo com o servidor sem Range
  rmSync(join(pasta, 'torch-teste.whl'), { force: true })
  writeFileSync(parte, dados.subarray(0, 1024 * 1024))
  writeFileSync(`${parte}.json`, JSON.stringify({ url, sha256: sha, bytes: TAM, etag: '"v1"' }))
  modo = 'sem-range'
  zerar()
  r = await baixar(pasta, roda())
  assert.equal(readFileSync(r.caminho).equals(dados), true)
  assert.equal(statSync(r.caminho).size, TAM)
  console.log('ok 200 no lugar de 206 (recomecou do zero)')

  // 5. meta de outra versao apaga a parte
  modo = 'normal'
  pasta = join(temp, '5')
  const p5 = join(pasta, 'torch-teste.whl.part')
  await baixar(pasta, roda()).then((x) => rmSync(x.caminho))
  writeFileSync(p5, Buffer.alloc(1000, 7))
  writeFileSync(`${p5}.json`, JSON.stringify({ url, sha256: 'f'.repeat(64), bytes: TAM, etag: null }))
  zerar()
  r = await baixar(pasta, roda())
  assert.equal(pedidos[0]!.range, undefined, 'parte de outra versao: pede do zero')
  assert.equal(readFileSync(r.caminho).equals(dados), true)
  console.log('ok meta de outra versao')

  // 6. sha256 errado: apaga e lanca arquivo-corrompido
  pasta = join(temp, '6')
  await assert.rejects(baixar(pasta, roda({ sha256: '0'.repeat(64) })), (e: unknown) => {
    assert.ok(e instanceof FalhaDaInstalacao)
    assert.equal(e.tipo, 'arquivo-corrompido')
    return true
  })
  assert.equal(existsSync(join(pasta, 'torch-teste.whl.part')), false)
  assert.equal(existsSync(join(pasta, 'torch-teste.whl')), false)
  console.log('ok hash errado')

  // 7. 404: sem-internet na hora (nao insiste)
  modo = '404'
  zerar()
  await assert.rejects(baixar(join(temp, '7'), roda()), (e: unknown) => e instanceof FalhaDaInstalacao && e.tipo === 'sem-internet' && /HTTP 404/.test(e.message))
  assert.equal(pedidos.length, 1)
  console.log('ok 404')

  // 8. cancelar no meio: a parte fica; continuar retoma
  modo = 'lento'
  zerar()
  pasta = join(temp, '8')
  const ctl = new AbortController()
  setTimeout(() => ctl.abort(), 400)
  await assert.rejects(baixar(pasta, roda(), ctl.signal), (e: unknown) => e instanceof InstalacaoCancelada)
  const parcial = statSync(join(pasta, 'torch-teste.whl.part')).size
  assert.ok(parcial > 0 && parcial < TAM, `parte com ${parcial} bytes`)
  modo = 'normal'
  zerar()
  r = await baixar(pasta, roda())
  // A retomada de outra sessao recua MARGEM do fim do .part (queda de luz: o fim pode nao estar no disco).
  const recuo = Math.max(0, parcial - MARGEM)
  assert.equal(pedidos[0]!.range, recuo > 0 ? `bytes=${recuo}-` : undefined)
  assert.equal(readFileSync(r.caminho).equals(dados), true)
  console.log(`ok cancelar e continuar (parou em ${parcial} de ${TAM}, retomou de ${recuo})`)

  // 8b. queda de luz: o .part voltou com o fim em ZEROS (o NTFS nao gravou o ultimo trecho).
  // Recuando a margem, os zeros saem e o sha256 fecha, sem baixar tudo de novo.
  modo = 'normal'
  pasta = join(temp, '8b')
  rmSync(pasta, { recursive: true, force: true })
  await baixar(pasta, roda()).then((x) => rmSync(x.caminho))
  const p8 = join(pasta, 'torch-teste.whl.part')
  const bons = 2 * 1024 * 1024
  writeFileSync(p8, Buffer.concat([dados.subarray(0, bons), Buffer.alloc(MARGEM / 2, 0)]))
  writeFileSync(`${p8}.json`, JSON.stringify({ url, sha256: sha, bytes: TAM, etag: '"v1"' }))
  zerar()
  r = await baixar(pasta, roda())
  assert.equal(readFileSync(r.caminho).equals(dados), true, 'o fim zerado saiu no recuo')
  assert.equal(pedidos.length, 1, 'um pedido so, do meio')
  assert.equal(pedidos[0]!.range, `bytes=${bons + MARGEM / 2 - MARGEM}-`)
  console.log('ok queda de luz (fim do .part em zeros)')

  // 9. servidor fora do ar: tenta e desiste com sem-internet
  await new Promise<void>((res) => servidor.close(() => res()))
  servidor.closeAllConnections?.()
  const t0 = Date.now()
  await assert.rejects(baixar(join(temp, '9'), roda(), undefined, [30, 30]), (e: unknown) => e instanceof FalhaDaInstalacao && e.tipo === 'sem-internet')
  console.log(`ok fora do ar (${Date.now() - t0} ms)`)

  console.log('TUDO OK')
} finally {
  servidor.close()
  rmSync(temp, { recursive: true, force: true })
}
}

void principal()
