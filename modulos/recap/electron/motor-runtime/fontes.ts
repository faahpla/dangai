import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type { AssinaturaDoPython, LockDoRuntime } from '../../shared/motor-runtime'
import { baixarRoda, type FetchDoMotor } from './baixar'
import { falha, InstalacaoCancelada } from './erros'
import type { CaminhosDoRuntime } from './pastas'
import { rodar } from './uv'

/**
 * [recap] AS FONTES OFICIAIS do runtime no Dangai: o uv e o Python.
 *
 * No Studio o uv ia no instalador (resources/uv, ~66 MB) e o Python era o
 * python-build-standalone que o `uv python install` baixa. No Dangai:
 *
 * - o uv e baixado AQUI, na instalacao do runtime, da release oficial do
 *   astral-sh/uv (versao, sha256 do zip e do uv.exe pinados no lock): quem
 *   nunca liga o modulo nao paga os 66 MB no instalador do Dangai;
 * - o Python e o OFICIAL do python.org: o pacote "python" do nuget.org (a
 *   build que o python.org publica, com o python.exe assinado pela Python
 *   Software Foundation), pinado por versao + sha256. Depois de extrair a
 *   pasta tools/, a assinatura do python.exe e da DLL e conferida no Windows
 *   (Get-AuthenticodeSignature = Valid, assinante = PSF): sem isso nada vira
 *   runtime. O que foi visto fica em python/<versao>/assinatura.json e no
 *   impressao.json.
 *
 * Os dois passam pela MESMA descarga das rodas (baixar.ts: retomada, sha256
 * no fim) e so ganham o nome final depois de conferidos (pasta .novo-* e
 * rename): uma pasta cpython-* no disco ja foi conferida.
 */

export interface OpcoesDasFontes {
  fetch: FetchDoMotor
  signal: AbortSignal
  log(linha: string): void
  /** Bytes deste arquivo ja no disco (para a barra). */
  aoAndar?(noDisco: number, total: number): void
  esperasDaDescarga?: number[]
}

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex')

// ------------------------------------------------------------------- o zip

interface EntradaDoZip {
  nome: string
  metodo: number
  comprimido: number
  local: number
}

/**
 * As entradas de um zip, pelo diretorio central. Sem ferramenta de fora (o
 * `tar` do PATH pode ser o do Git, que nao abre zip; o Expand-Archive e
 * lento): o mesmo leitor do baixar-uv.mjs do Studio. So os metodos 0
 * (guardado) e 8 (deflate), que sao os do zip do uv e do .nupkg.
 */
export function entradasDoZip(zip: Buffer): EntradaDoZip[] {
  let fim = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fim = i
      break
    }
  }
  if (fim < 0) throw new Error('zip sem diretorio central')
  const total = zip.readUInt16LE(fim + 10)
  let p = zip.readUInt32LE(fim + 16)
  const lista: EntradaDoZip[] = []
  for (let n = 0; n < total; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('diretorio central torto')
    const metodo = zip.readUInt16LE(p + 10)
    const comprimido = zip.readUInt32LE(p + 20)
    const tamNome = zip.readUInt16LE(p + 28)
    const tamExtra = zip.readUInt16LE(p + 30)
    const tamComent = zip.readUInt16LE(p + 32)
    const local = zip.readUInt32LE(p + 42)
    const nome = zip.subarray(p + 46, p + 46 + tamNome).toString('utf8')
    p += 46 + tamNome + tamExtra + tamComent
    lista.push({ nome, metodo, comprimido, local })
  }
  return lista
}

/** Os bytes de uma entrada. */
export function lerDoZip(zip: Buffer, e: EntradaDoZip): Buffer {
  if (zip.readUInt32LE(e.local) !== 0x04034b50) throw new Error('cabecalho local torto')
  const ini = e.local + 30 + zip.readUInt16LE(e.local + 26) + zip.readUInt16LE(e.local + 28)
  const dados = zip.subarray(ini, ini + e.comprimido)
  if (e.metodo === 0) return Buffer.from(dados)
  if (e.metodo === 8) return inflateRawSync(dados)
  throw new Error(`metodo de compressao ${e.metodo} nao suportado`)
}

/** Tira UM arquivo (pelo nome, em qualquer pasta do zip). */
export function tirarDoZip(zip: Buffer, nome: string): Buffer {
  const e = entradasDoZip(zip).find((x) => x.nome === nome || x.nome.endsWith(`/${nome}`))
  if (!e) throw new Error(`${nome} nao esta no zip`)
  return lerDoZip(zip, e)
}

/**
 * Extrai as entradas que comecam com `prefixo` (sem ele) para `destino`. Nome
 * com `..` ou absoluto e recusado (zip-slip). O .nupkg guarda os nomes com
 * %XX (OPC): decodifica. Devolve quantos arquivos gravou.
 */
export async function extrairDoZip(zip: Buffer, prefixo: string, destino: string, signal?: AbortSignal): Promise<number> {
  let n = 0
  const base = normalize(destino)
  for (const e of entradasDoZip(zip)) {
    if (signal?.aborted) throw new InstalacaoCancelada()
    if (!e.nome.startsWith(prefixo) || e.nome.endsWith('/')) continue
    let rel = e.nome.slice(prefixo.length)
    if (rel.includes('%')) {
      try {
        rel = decodeURIComponent(rel)
      } catch {
        // nome com % de verdade: fica como esta
      }
    }
    if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).some((parte) => parte === '..')) throw new Error(`nome perigoso no zip: ${e.nome}`)
    const alvo = normalize(join(base, rel))
    if (!alvo.startsWith(base + sep)) throw new Error(`nome perigoso no zip: ${e.nome}`)
    await mkdir(dirname(alvo), { recursive: true })
    await writeFile(alvo, lerDoZip(zip, e))
    n++
  }
  return n
}

// --------------------------------------------------------------------- o uv

/** O uv.exe do runtime ja e o do lock? (sha256 do exe, ~0,1 s). */
export function uvConfere(c: CaminhosDoRuntime, lock: LockDoRuntime): boolean {
  const exe = join(c.uv, 'uv.exe')
  try {
    return sha256(readFileSync(exe)) === lock.uv.sha256Exe
  } catch {
    return false
  }
}

/**
 * O uv do lock em <runtime>/uv/uv.exe: baixa o zip da release oficial (com
 * retomada), confere o sha256 do zip e o do uv.exe de dentro, e so entao poe
 * no lugar. Ja estando la e conferido, nao baixa nada. Devolve o caminho.
 */
export async function garantirUv(c: CaminhosDoRuntime, lock: LockDoRuntime, o: OpcoesDasFontes): Promise<string> {
  const exe = join(c.uv, 'uv.exe')
  if (uvConfere(c, lock)) return exe
  o.log(`uv ${lock.uv.versao}: baixando ${lock.uv.url}`)
  const zipPath = await baixarRoda(lock.uv, c.baixando, {
    fetch: o.fetch,
    signal: o.signal,
    log: o.log,
    aoAndar: (n) => o.aoAndar?.(n, lock.uv.bytes),
    ...(o.esperasDaDescarga ? { esperas: o.esperasDaDescarga } : {}),
  })
  const conteudo = tirarDoZip(await readFile(zipPath), 'uv.exe')
  const h = sha256(conteudo)
  if (h !== lock.uv.sha256Exe) {
    await rm(zipPath, { force: true })
    throw falha('arquivo-corrompido', `uv.exe: sha256 ${h}, esperado ${lock.uv.sha256Exe}`)
  }
  await mkdir(c.uv, { recursive: true })
  const tmp = `${exe}.novo`
  await writeFile(tmp, conteudo)
  await rm(exe, { force: true })
  await rename(tmp, exe)
  await writeFile(
    join(c.uv, 'uv.json'),
    `${JSON.stringify({ versao: lock.uv.versao, origem: lock.uv.url, sha256Zip: lock.uv.sha256, sha256Exe: lock.uv.sha256Exe }, null, 2)}\n`,
  )
  await rm(zipPath, { force: true })
  o.log(`uv ${lock.uv.versao}: ok (${(conteudo.length / 1e6).toFixed(1)} MB, sha256 do zip e do exe conferidos)`)
  return exe
}

// ---------------------------------------------------------------- o Python

/** O nome da pasta do Python oficial (pythonDoLock acha pelo prefixo cpython-<versao>-). */
export function pastaDoPythonOficial(c: CaminhosDoRuntime, versao: string): string {
  return join(c.python, `cpython-${versao}-windows-x86_64-nuget`)
}

/** A assinatura gravada ao lado do python.exe na instalacao (ou null). */
export function assinaturaGravada(pythonExe: string): AssinaturaDoPython | null {
  try {
    const j = JSON.parse(readFileSync(join(dirname(pythonExe), 'assinatura.json'), 'utf8')) as AssinaturaDoPython
    return typeof j.status === 'string' && typeof j.assinante === 'string' ? j : null
  } catch {
    return null
  }
}

/** O powershell do Windows (System32), ou o do PATH. */
function powershell(): string {
  const doSistema = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(doSistema) ? doSistema : 'powershell.exe'
}

/**
 * Confere a assinatura Authenticode dos arquivos (Get-AuthenticodeSignature):
 * todos Valid, do mesmo certificado, com o assinante esperado no Subject.
 * Lanca FalhaDaInstalacao 'assinatura' com o que viu.
 */
export async function conferirAssinatura(arquivos: string[], assinante: string, signal: AbortSignal, log: (l: string) => void): Promise<AssinaturaDoPython> {
  const lista = arquivos.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
  const script =
    `Get-AuthenticodeSignature -LiteralPath ${lista} | ForEach-Object { ` +
    `[pscustomobject]@{ status = $_.Status.ToString(); assinante = $_.SignerCertificate.Subject; thumbprint = $_.SignerCertificate.Thumbprint } ` +
    `} | ConvertTo-Json -Compress`
  const r = await rodar(powershell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: process.env,
    signal,
    log: () => {},
    limiteMs: 120_000,
  })
  let vistos: { status?: string; assinante?: string | null; thumbprint?: string | null }[] = []
  try {
    const j = JSON.parse(r.stdout.trim()) as unknown
    vistos = (Array.isArray(j) ? j : [j]) as typeof vistos
  } catch {
    throw falha('assinatura', `Get-AuthenticodeSignature nao respondeu (codigo ${r.codigo ?? 'nenhum'}): ${r.linhas.slice(-3).join(' | ')}`)
  }
  for (const [i, v] of vistos.entries()) log(`assinatura: ${arquivos[i] ?? '?'}: ${v.status ?? '?'} | ${v.assinante ?? '-'} | ${v.thumbprint ?? '-'}`)
  const primeiro = vistos[0]
  const ok =
    vistos.length === arquivos.length &&
    vistos.every(
      (v) =>
        v.status === 'Valid' &&
        typeof v.assinante === 'string' &&
        (v.assinante.includes(`CN=${assinante},`) || v.assinante.includes(`O=${assinante},`)) &&
        v.thumbprint === primeiro?.thumbprint,
    )
  if (!ok || !primeiro) {
    throw falha('assinatura', vistos.map((v, i) => `${arquivos[i] ?? '?'}: ${v.status ?? '?'} (${v.assinante ?? 'sem certificado'})`).join('\n'))
  }
  return {
    status: primeiro.status ?? 'Valid',
    assinante: primeiro.assinante ?? '',
    thumbprint: primeiro.thumbprint ?? '',
    arquivos: arquivos.map((a) => a.split(/[\\/]/).pop() ?? a),
    conferidoEm: new Date().toISOString(),
  }
}

/**
 * Instala o Python oficial do lock em <runtime>/python: baixa o .nupkg (com
 * retomada e sha256), extrai a pasta tools/ numa pasta .novo, confere a
 * assinatura do python.exe e da python3XX.dll (PSF) e so entao renomeia para
 * cpython-<versao>-windows-x86_64-nuget. Devolve o python.exe e a assinatura.
 */
export async function instalarPythonOficial(
  c: CaminhosDoRuntime,
  lock: LockDoRuntime,
  o: OpcoesDasFontes,
): Promise<{ exe: string; assinatura: AssinaturaDoPython }> {
  const p = lock.pythonOficial
  o.log(`python ${p.versao}: baixando ${p.url}`)
  const nupkg = await baixarRoda(p, c.baixando, {
    fetch: o.fetch,
    signal: o.signal,
    log: o.log,
    aoAndar: (n) => o.aoAndar?.(n, p.bytes),
    ...(o.esperasDaDescarga ? { esperas: o.esperasDaDescarga } : {}),
  })
  const novo = join(c.python, `.novo-${process.pid}`)
  // Restos de uma extracao que o app fechou no meio.
  for (const item of existsSync(c.python) ? readdirSync(c.python) : []) {
    if (item.startsWith('.novo-')) await rm(join(c.python, item), { recursive: true, force: true })
  }
  await mkdir(novo, { recursive: true })
  const n = await extrairDoZip(await readFile(nupkg), 'tools/', novo, o.signal)
  const exe = join(novo, 'python.exe')
  const [maior, menor] = p.versao.split('.')
  const dll = join(novo, `python${maior}${menor}.dll`)
  if (!existsSync(exe) || !existsSync(dll)) throw falha('arquivo-corrompido', `o pacote do Python nao tem python.exe/${dll.split(/[\\/]/).pop()}`)
  o.log(`python ${p.versao}: ${n} arquivos extraidos; conferindo a assinatura`)
  const assinatura = await conferirAssinatura([exe, dll], p.assinante, o.signal, o.log)
  await writeFile(join(novo, 'assinatura.json'), `${JSON.stringify({ ...assinatura, origem: p.url, sha256: p.sha256 }, null, 2)}\n`)
  const final = pastaDoPythonOficial(c, p.versao)
  await rm(final, { recursive: true, force: true })
  await rename(novo, final)
  await rm(nupkg, { force: true })
  o.log(`python ${p.versao}: ok em ${final} (${assinatura.status}, ${assinatura.assinante})`)
  return { exe: join(final, 'python.exe'), assinatura }
}
