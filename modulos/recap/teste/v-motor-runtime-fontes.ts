/**
 * [recap] RUNTIME DO MOTOR, as FONTES OFICIAIS (electron/motor-runtime/fontes.ts):
 * o leitor de zip (o .nupkg do Python e o zip do uv), o uv baixado na
 * instalacao contra um servidor HTTP local, e a conferencia da assinatura
 * Authenticode (Get-AuthenticodeSignature) com um arquivo sem assinatura e um
 * do Windows. Sem internet; grava so numa pasta temporaria.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-motor-runtime-fontes.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import type { LockDoRuntime } from '../shared/motor-runtime'
import { FalhaDaInstalacao } from '../electron/motor-runtime/erros'
import { conferirAssinatura, extrairDoZip, garantirUv, tirarDoZip, uvConfere } from '../electron/motor-runtime/fontes'
import { caminhosDoRuntime } from '../electron/motor-runtime/pastas'

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

/** Um zip de verdade (deflate), montado na mao: so o que o leitor precisa. */
function zipCom(arquivos: Record<string, Buffer>): Buffer {
  const locais: Buffer[] = []
  const centrais: Buffer[] = []
  let deslocamento = 0
  for (const [nome, dados] of Object.entries(arquivos)) {
    const n = Buffer.from(nome, 'utf8')
    const comp = deflateRawSync(dados)
    const crc = crc32(dados)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(dados.length, 22)
    local.writeUInt16LE(n.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(comp.length, 20)
    central.writeUInt32LE(dados.length, 24)
    central.writeUInt16LE(n.length, 28)
    central.writeUInt32LE(deslocamento, 42)
    locais.push(local, n, comp)
    centrais.push(central, n)
    deslocamento += 30 + n.length + comp.length
  }
  const dir = Buffer.concat(centrais)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(Object.keys(arquivos).length, 8)
  fim.writeUInt16LE(Object.keys(arquivos).length, 10)
  fim.writeUInt32LE(dir.length, 12)
  fim.writeUInt32LE(deslocamento, 16)
  return Buffer.concat([...locais, dir, fim])
}

async function principal(): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), 'v-fontes-'))
  let servidor: ReturnType<typeof createServer> | null = null
  try {
    // 1. o leitor de zip: so o prefixo, nome %XX decodificado (OPC do .nupkg)
    const exe = Buffer.from('MZ' + 'x'.repeat(5000))
    const z = zipCom({ 'tools/python.exe': exe, 'tools/Lib/a%2Bb.txt': Buffer.from('mais'), 'images/python.png': Buffer.from('png') })
    const destino = join(temp, 'py')
    mkdirSync(destino)
    const n = await extrairDoZip(z, 'tools/', destino)
    assert.equal(n, 2)
    assert.deepEqual(readFileSync(join(destino, 'python.exe')), exe)
    assert.equal(readFileSync(join(destino, 'Lib', 'a+b.txt'), 'utf8'), 'mais')
    assert.ok(!existsSync(join(destino, 'images')), 'fora do prefixo nao sai')
    assert.deepEqual(tirarDoZip(z, 'python.exe'), exe)
    console.log('ok zip: prefixo, %XX, tirar um arquivo')

    // 2. zip-slip: nome com .. e recusado e nada sai da pasta
    const ruim = zipCom({ 'tools/../../fora.txt': Buffer.from('x') })
    await assert.rejects(extrairDoZip(ruim, 'tools/', join(temp, 'slip')), /perigoso/)
    assert.ok(!existsSync(join(temp, 'fora.txt')))
    console.log('ok zip-slip recusado')

    // 3. o uv baixado: confere o zip e o exe, grava uv.json, nao baixa de novo
    const uvExe = Buffer.from('MZ uv falso ' + 'u'.repeat(20_000))
    const uvZip = zipCom({ 'uv-x86_64-pc-windows-msvc/uv.exe': uvExe, 'uv-x86_64-pc-windows-msvc/uvx.exe': Buffer.from('MZ') })
    let pedidos = 0
    servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
      pedidos++
      res.writeHead(200, { 'content-length': uvZip.length, etag: '"a"' })
      if (req.method === 'HEAD') return res.end()
      res.end(uvZip)
    })
    await new Promise<void>((r) => servidor!.listen(0, '127.0.0.1', r))
    const porta = (servidor.address() as AddressInfo).port
    const lock = {
      uv: {
        versao: '0.0.1',
        arquivo: 'uv-teste.zip',
        url: `http://127.0.0.1:${porta}/uv-teste.zip`,
        sha256: sha(uvZip),
        bytes: uvZip.length,
        sha256Exe: sha(uvExe),
      },
    } as unknown as LockDoRuntime
    const c = caminhosDoRuntime(join(temp, 'rt'))
    const o = { fetch: (u: string, init: { headers: Record<string, string>; signal: AbortSignal }) => fetch(u, init), signal: new AbortController().signal, log: () => {}, esperasDaDescarga: [20, 20] }
    assert.ok(!uvConfere(c, lock))
    const caminho = await garantirUv(c, lock, o)
    assert.deepEqual(readFileSync(caminho), uvExe)
    assert.equal(JSON.parse(readFileSync(join(c.uv, 'uv.json'), 'utf8')).sha256Exe, sha(uvExe))
    assert.ok(!existsSync(join(c.baixando, 'uv-teste.zip')), 'o zip sai depois de conferido')
    const antes = pedidos
    await garantirUv(c, lock, o)
    assert.equal(pedidos, antes, 'uv ja conferido: nenhum pedido')
    console.log(`ok uv baixado e conferido (${antes} pedido)`)

    // 4. o exe de dentro nao bate: arquivo-corrompido, e o uv velho nao fica
    rmSync(c.uv, { recursive: true, force: true })
    const torto = { uv: { ...lock.uv, sha256Exe: 'f'.repeat(64) } } as unknown as LockDoRuntime
    await assert.rejects(garantirUv(c, torto, o), (e: unknown) => e instanceof FalhaDaInstalacao && e.tipo === 'arquivo-corrompido')
    assert.ok(!existsSync(join(c.uv, 'uv.exe')))
    console.log('ok uv.exe que nao confere: recusado')

    // 5. a assinatura: sem assinatura recusa; a do Windows so passa com o assinante dela
    if (process.platform === 'win32') {
      const semAssinatura = join(temp, 'sem.exe')
      writeFileSync(semAssinatura, exe)
      const sinal = new AbortController().signal
      await assert.rejects(
        conferirAssinatura([semAssinatura], 'Python Software Foundation', sinal, () => {}),
        (e: unknown) => e instanceof FalhaDaInstalacao && e.tipo === 'assinatura',
      )
      const doWindows = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'cmd.exe')
      await assert.rejects(
        conferirAssinatura([doWindows], 'Python Software Foundation', sinal, () => {}),
        (e: unknown) => e instanceof FalhaDaInstalacao && e.tipo === 'assinatura',
        'assinado, mas por outro: recusa',
      )
      const visto = await conferirAssinatura([doWindows], 'Microsoft Windows', sinal, () => {})
      assert.equal(visto.status, 'Valid')
      assert.match(visto.assinante, /CN=Microsoft Windows,/)
      console.log('ok assinatura: sem assinatura e de outro recusadas; a certa passa')
    }

    console.log('TUDO OK')
  } finally {
    servidor?.close()
    rmSync(temp, { recursive: true, force: true })
  }
}

void principal().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
