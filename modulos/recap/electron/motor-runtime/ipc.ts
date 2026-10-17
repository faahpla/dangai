import { BrowserWindow, dialog, net } from 'electron'
import type { ContextoDoModulo } from '../../../../electron/modulos'
import { CANAIS as C } from '../../shared/canais'
import { pedidoDeInstalacaoSchema, type EstadoDoMotorRuntime } from '../../shared/motor-runtime'
import { esquecerSondaDoMotor, motorRodando } from '../motor'
import { rostosRodando } from '../montar/rostos-motor'
import { visaoRodando } from '../cenas/visao'
import type { FetchDoMotor } from './baixar'
import {
  cancelarMotorRuntime,
  definirAoMudarORuntime,
  definirAvisoDoMotorRuntime,
  definirFetchDoMotorRuntime,
  definirMotorEmUso,
  estadoDoMotorRuntime,
  instalarMotorRuntime,
  removerMotorRuntime,
  usarPastaDoMotorRuntime,
} from './index'
import { pastaDoRuntime } from './pastas'

/**
 * Os canais recap:motor-runtime:* (shared/canais.ts), pelo `ctx.handle` do
 * nucleo (erro vira { ok: false, error } com a frase pronta).
 *
 * [recap] Portado do Studio. O que so o Electron tem entra aqui no index.ts
 * (que fica sem electron para os testes no Node):
 * - net.fetch para o uv, o Python e as rodas do torch: a pilha de rede do
 *   Chromium respeita o proxy e os certificados do sistema;
 * - o dialogo de pasta;
 * - esquecer a sonda do motor.ts quando o runtime muda (instalou, removeu),
 *   para o "Motor pronto" aparecer sem reiniciar o app.
 */
export function registrarIpcDoMotorRuntime(ctx: ContextoDoModulo): void {
  definirAvisoDoMotorRuntime((estado: EstadoDoMotorRuntime) => ctx.enviar(C.motorRuntimeEstado, estado))
  definirFetchDoMotorRuntime(((url, init) => net.fetch(url, init)) as FetchDoMotor)
  definirAoMudarORuntime(() => esquecerSondaDoMotor())
  // Reinstalar ou Recomecar com a analise rodando apagavam o venv debaixo dela.
  definirMotorEmUso(() => motorRodando() || rostosRodando() || visaoRodando())

  ctx.handle<[], EstadoDoMotorRuntime>(C.estadoDoMotorRuntime, () => estadoDoMotorRuntime())
  ctx.handle<[unknown], EstadoDoMotorRuntime>(C.instalarMotorRuntime, (pedido) =>
    instalarMotorRuntime(pedidoDeInstalacaoSchema.parse(pedido ?? {})),
  )
  ctx.handle<[], null>(C.cancelarMotorRuntime, async () => {
    await cancelarMotorRuntime()
    return null
  })
  ctx.handle<[unknown], EstadoDoMotorRuntime>(C.escolherPastaDoMotorRuntime, async (padrao) => {
    if (padrao === true) return usarPastaDoMotorRuntime(null)
    const janela = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opcoes: Electron.OpenDialogOptions = {
      title: 'Pasta do motor de personagens (~5 GB)',
      defaultPath: pastaDoRuntime().pasta,
      properties: ['openDirectory', 'createDirectory'],
    }
    const r = janela ? await dialog.showOpenDialog(janela, opcoes) : await dialog.showOpenDialog(opcoes)
    if (r.canceled || !r.filePaths[0]) return estadoDoMotorRuntime()
    return usarPastaDoMotorRuntime(r.filePaths[0])
  })
  ctx.handle<[], EstadoDoMotorRuntime>(C.removerMotorRuntime, () => removerMotorRuntime())
}
