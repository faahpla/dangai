import { ipcMain } from 'electron'
import type { IpcResult } from '@shared/channels'

/**
 * Envolve um handler para que erro nunca atravesse a ponte como excecao. O
 * renderer sempre recebe um valor, e a mensagem ja esta em portugues pronta
 * para virar toast.
 *
 * Mora sozinho para o nucleo (ipc.ts) e os modulos (electron/modulos.ts)
 * usarem o MESMO -- o motor-runtime do Studio tinha uma copia.
 */
export function handle<Args extends unknown[], T>(
  channel: string,
  fn: (...args: Args) => Promise<T>,
): void {
  ipcMain.handle(channel, async (_event, ...args: Args): Promise<IpcResult<T>> => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc:${channel}]`, err)
      return { ok: false, error: message }
    }
  })
}
