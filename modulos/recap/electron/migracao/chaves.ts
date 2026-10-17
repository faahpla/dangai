import { spawn } from 'node:child_process'
import { createDecipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * [recap] AS CHAVES DO STUDIO, abertas no main so o tempo de ir para o cofre
 * do Dangai (parte 5).
 *
 * O Studio grava `<campo>Enc` no settings.json: base64 do safeStorage do
 * Electron. No Windows e o os_crypt do Chromium:
 *
 *   'v10' + nonce (12 bytes) + texto cifrado + tag (16 bytes), AES-256-GCM,
 *
 * com a chave AES no `Local State` DO STUDIO (os_crypt.encrypted_key, base64
 * de 'DPAPI' + o blob do DPAPI, preso ao mesmo usuario do Windows). O
 * safeStorage do Dangai usa a chave DELE e nao abre isso: aqui a chave do
 * Studio sai pelo DPAPI (ProtectedData do .NET, pelo PowerShell, com tudo por
 * stdin/stdout -- nada vai para disco, linha de comando ou log) e o AES-GCM e
 * o do node.
 *
 * Nunca imprime, loga ou grava uma chave. Erro aqui vira so "nao abriu": a
 * mensagem do sistema poderia carregar pedaco do que estava sendo lido.
 */

/** Abre um blob do DPAPI do usuario atual. Trocavel no teste (sem Windows). */
export type DesprotegerDpapi = (blob: Buffer) => Promise<Buffer>

const PREFIXO_DPAPI = Buffer.from('DPAPI', 'latin1')
const PREFIXO_V10 = Buffer.from('v10', 'latin1')
const NONCE = 12
const TAG = 16

/**
 * O DPAPI do Windows pelo PowerShell (ProtectedData.Unprotect, CurrentUser):
 * o blob entra em base64 pelo stdin e a chave sai em base64 pelo stdout. O
 * script nao tem segredo nenhum; o que passa pelos pipes fica so na memoria.
 */
export const dpapiDoWindows: DesprotegerDpapi = (blob) =>
  new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('DPAPI so existe no Windows.'))
      return
    }
    const script =
      "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;" +
      '$b=[Convert]::FromBase64String([Console]::In.ReadLine());' +
      "$k=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser');" +
      '[Console]::Out.Write([Convert]::ToBase64String($k))'
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const pedacos: Buffer[] = []
    const teto = setTimeout(() => ps.kill(), 30_000)
    ps.stdout.on('data', (d: Buffer) => pedacos.push(d))
    ps.on('error', () => {
      clearTimeout(teto)
      reject(new Error('O PowerShell nao abriu.'))
    })
    ps.on('close', (codigo) => {
      clearTimeout(teto)
      const saida = Buffer.concat(pedacos).toString('latin1').trim()
      pedacos.forEach((p) => p.fill(0))
      if (codigo !== 0 || !saida) {
        reject(new Error('O DPAPI nao abriu a chave do Studio.'))
        return
      }
      resolve(Buffer.from(saida, 'base64'))
    })
    ps.stdin.end(`${blob.toString('base64')}\n`)
  })

/** A chave AES do os_crypt do Studio, pelo Local State dele. null = nao abre. */
export async function chaveDoOsCrypt(pastaDoStudio: string, desproteger: DesprotegerDpapi): Promise<Buffer | null> {
  let cifrada: Buffer
  try {
    const ls = JSON.parse(readFileSync(join(pastaDoStudio, 'Local State'), 'utf8')) as { os_crypt?: { encrypted_key?: unknown } }
    const b64 = ls.os_crypt?.encrypted_key
    if (typeof b64 !== 'string' || !b64) return null
    cifrada = Buffer.from(b64, 'base64')
  } catch {
    return null
  }
  if (!cifrada.subarray(0, PREFIXO_DPAPI.length).equals(PREFIXO_DPAPI)) return null
  try {
    const chave = await desproteger(cifrada.subarray(PREFIXO_DPAPI.length))
    return chave.length === 32 ? chave : null
  } catch {
    return null
  }
}

/** Um `<campo>Enc` do Studio aberto com a chave do os_crypt. null = nao abre (outra conta, mexido). */
export function abrirV10(base64: string, chave: Buffer): string | null {
  try {
    const blob = Buffer.from(base64, 'base64')
    if (!blob.subarray(0, 3).equals(PREFIXO_V10) || blob.length < 3 + NONCE + TAG + 1) return null
    const nonce = blob.subarray(3, 3 + NONCE)
    const tag = blob.subarray(blob.length - TAG)
    const corpo = blob.subarray(3 + NONCE, blob.length - TAG)
    const d = createDecipheriv('aes-256-gcm', chave, nonce)
    d.setAuthTag(tag)
    const aberto = Buffer.concat([d.update(corpo), d.final()])
    const texto = aberto.toString('utf8')
    aberto.fill(0)
    return texto.trim() || null
  } catch {
    return null
  }
}

/**
 * As chaves do Studio abertas, por campo. Campo sem `Enc` (ou com a chave em
 * texto puro, de um settings antigo) tambem vale. null = estava la e nao abriu.
 * Campo ausente no resultado = o Studio nao tinha.
 */
export async function abrirChavesDoStudio(
  pastaDoStudio: string,
  settingsDoStudio: Record<string, unknown>,
  campos: readonly string[],
  desproteger: DesprotegerDpapi,
): Promise<Map<string, string | null>> {
  const saida = new Map<string, string | null>()
  const cifradas = campos.filter((c) => typeof settingsDoStudio[`${c}Enc`] === 'string' && settingsDoStudio[`${c}Enc`] !== '')
  for (const c of campos) {
    const aberta = settingsDoStudio[c]
    if (typeof aberta === 'string' && aberta.trim()) saida.set(c, aberta.trim())
  }
  if (cifradas.length === 0) return saida
  const chave = await chaveDoOsCrypt(pastaDoStudio, desproteger)
  for (const c of cifradas) {
    if (saida.has(c)) continue
    saida.set(c, chave ? abrirV10(settingsDoStudio[`${c}Enc`] as string, chave) : null)
  }
  chave?.fill(0)
  return saida
}
