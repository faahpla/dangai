import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { COMPUTE_CAP_MINIMO_CU128, DRIVER_MINIMO_CU128, type GpuDetectada, type VarianteDoMotor } from '../../shared/motor-runtime'

/**
 * Qual torch instalar: cu128 (NVIDIA) ou cpu.
 *
 * DONO: agente A. Sem electron.
 *
 * 1. nvidia-smi (vem com o driver; no PATH ou em System32): nome, versao do
 *    driver e a compute capability numa linha. E o que diz se o CUDA 12.8
 *    roda (driver R570+) e se o torch do lock tem kernel para a placa
 *    (sm_75+). nvidia-smi velho sem o campo compute_cap: so nome e driver.
 * 2. Sem ele, o WMI (Win32_VideoController): so o nome, sem driver.
 * Sem nenhuma NVIDIA, a cpu (~320 MB em vez de ~3 GB).
 *
 * O resultado vale para a sessao: placa nao muda com o app aberto, e o
 * nvidia-smi leva ~0,5 s.
 */

let emCache: Promise<GpuDetectada> | null = null

function rodar(cmd: string, args: string[], limiteMs: number): Promise<string | null> {
  return new Promise((resolver) => {
    try {
      execFile(cmd, args, { windowsHide: true, timeout: limiteMs, encoding: 'utf8' }, (erro, saida) => {
        resolver(erro ? null : String(saida))
      })
    } catch {
      resolver(null)
    }
  })
}

/** "NVIDIA GeForce RTX 5080, 581.57, 12.0" -> nome, driver e compute cap (a primeira placa). */
export function lerNvidiaSmi(saida: string): { nome: string; driver: string | null; computeCap: number | null } | null {
  for (const linha of saida.split(/\r?\n/)) {
    const [nome, driver, cap] = linha.split(',').map((s) => s.trim())
    if (nome) {
      const n = cap && /^\d+(\.\d+)?$/.test(cap) ? Number.parseFloat(cap) : Number.NaN
      return { nome, driver: driver && /^\d+(\.\d+)*$/.test(driver) ? driver : null, computeCap: Number.isFinite(n) ? n : null }
    }
  }
  return null
}

/** A placa nao tem kernel no torch cu128 do lock (compute cap abaixo de 7.5)? null = nao da para dizer. */
export function placaSemKernelCu128(gpu: Pick<GpuDetectada, 'computeCap'> | null): boolean {
  const cap = gpu?.computeCap
  return typeof cap === 'number' && cap < COMPUTE_CAP_MINIMO_CU128
}

/** O driver esta abaixo do que o CUDA 12.8 pede? null (sem driver lido) = nao da para dizer. */
export function driverAntigo(driver: string | null): boolean {
  if (!driver) return false
  const n = Number.parseFloat(driver)
  return Number.isFinite(n) && n < DRIVER_MINIMO_CU128
}

async function detectar(): Promise<GpuDetectada> {
  if (process.platform !== 'win32') return { nome: null, driver: null, driverAntigo: false, computeCap: null, fonte: 'nenhuma' }
  const system32 = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe')
  for (const cmd of ['nvidia-smi', ...(existsSync(system32) ? [system32] : [])]) {
    // O campo compute_cap so existe no nvidia-smi dos drivers de 2021 para ca:
    // o velho recusa a consulta inteira, e entao vale a de antes (nome e driver).
    for (const campos of ['name,driver_version,compute_cap', 'name,driver_version']) {
      const saida = await rodar(cmd, [`--query-gpu=${campos}`, '--format=csv,noheader'], 5000)
      const lido = saida ? lerNvidiaSmi(saida) : null
      if (lido) {
        return { nome: lido.nome, driver: lido.driver, driverAntigo: driverAntigo(lido.driver), computeCap: lido.computeCap, fonte: 'nvidia-smi' }
      }
    }
  }
  const wmi = await rodar(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
    10_000,
  )
  const nvidia = wmi
    ?.split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => /nvidia/i.test(s))
  if (nvidia) return { nome: nvidia, driver: null, driverAntigo: false, computeCap: null, fonte: 'wmi' }
  return { nome: null, driver: null, driverAntigo: false, computeCap: null, fonte: 'nenhuma' }
}

/** A placa (cache da sessao). Nunca lanca. */
export function detectarGpu(): Promise<GpuDetectada> {
  emCache ??= detectar().catch(() => ({ nome: null, driver: null, driverAntigo: false, computeCap: null, fonte: 'nenhuma' as const }))
  return emCache
}

/**
 * O que a tela sugere: ANIRECAP_MOTOR_RUNTIME_VARIANTE (testes) > a placa.
 * NVIDIA sem kernel no cu128 (GTX 10xx: compute cap 6.1) vai de cpu: o torch
 * rodaria na CPU de qualquer jeito, e a cpu baixa 120 MB em vez de 2,7 GB.
 * Driver velho NAO muda a sugestao: atualizar o driver resolve, e o app refaz
 * a conta na GPU sozinho quando o driver muda (reconferirCudaSeODriverMudou).
 */
export function varianteSugerida(gpu: GpuDetectada | null): VarianteDoMotor {
  const env = process.env['ANIRECAP_MOTOR_RUNTIME_VARIANTE']
  if (env === 'cpu' || env === 'cu128') return env
  if (!gpu?.nome || placaSemKernelCu128(gpu)) return 'cpu'
  return 'cu128'
}
