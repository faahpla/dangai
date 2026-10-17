import { app } from 'electron'
import { join } from 'node:path'
import type { ContextoDoModulo } from '../../../../electron/modulos'
import { getSettings as settingsDoNucleo, saveSettings, type Settings } from '../../../../electron/services/settings'
import { CANAIS as C } from '../../shared/canais'
import type { ProgressoDaMigracao, ResumoDaMigracao, StudioAchado } from '../../shared/migracao'
import { configDoRecap } from '../contexto'
import { encerrarRostosDoMotor, rostosRodando } from '../montar/rostos-motor'
import { motorRodando } from '../motor'
import { instalandoMotorRuntime, remocaoEmAndamento } from '../motor-runtime'
import { pastaDaBibliotecaStudio } from '../settings'
import { lerMedidas } from '../voz/ritmo'
import { dpapiDoWindows } from './chaves'
import { acharStudio, trazerDoStudio, type PatchDoNucleo, type VistaDoNucleo } from './index'

/**
 * [recap] O "Trazer do AniRecap Studio" no main (parte 5).
 *
 * A pasta do Studio e o userData do app de productName "AniRecap Studio":
 * %APPDATA%/AniRecap Studio, de qualquer usuario. No DEV (nao empacotado),
 * RECAP_STUDIO_DIR troca a pasta -- o teste aponta para uma COPIA do perfil
 * real, nunca para ele. No instalado a variavel e ignorada.
 *
 * O NUCLEO: as chaves de voz vao pelo cofre do modulo (ctx.salvarChave). A do
 * Gemini, a IA (provedor/modelo), a pasta de SFX e um preset de cor sao do
 * nucleo, e o ctx nao tem como gravar campo do nucleo: aqui eles vao pelo
 * saveSettings do nucleo, SO quando o Dangai nao tem o dele (a migracao nunca
 * le uma chave de IA: so se ela existe). Anotado para o Faah: um gancho
 * `ctx.preencherDoNucleo` deixaria isto dentro do contrato.
 */

export function pastaDoStudio(ctx: ContextoDoModulo): string {
  const dev = ctx.empacotado ? '' : (process.env['RECAP_STUDIO_DIR'] ?? '').trim()
  if (dev) return dev
  return join(app.getPath('appData'), 'AniRecap Studio')
}

function vistaDoNucleo(): VistaDoNucleo {
  const s = settingsDoNucleo()
  return {
    temGemini: s.geminiApiKey.length > 0,
    temAnthropic: s.anthropicApiKey.length > 0,
    iaProvedor: s.iaProvedor,
    geminiModelo: s.geminiModelo,
    anthropicModelo: s.anthropicModelo,
    sfxDir: s.sfxDir,
    presetsDeCor: s.presetsDeCor,
  }
}

function gravarNoNucleo(patch: PatchDoNucleo): void {
  const p: Partial<Settings> = { ...patch }
  if (patch.geminiApiKey !== undefined) p.geminiApiKey = patch.geminiApiKey.trim()
  saveSettings(p)
}

let emAndamento: { pedidoId: string; controle: AbortController } | null = null

/** Por que nao da para trazer agora (o motor mexe no index.db do modulo). null = pode. */
function motivoParaEsperar(): string | null {
  if (motorRodando()) return 'O motor de personagens esta cortando. Espere terminar.'
  if (rostosRodando()) return 'O motor esta procurando os rostos. Espere terminar.'
  if (instalandoMotorRuntime()) return 'O motor de personagens esta instalando. Espere ou cancele.'
  if (remocaoEmAndamento()) return 'O motor de personagens esta sendo removido.'
  return null
}

export function registrarCanaisDaMigracao(ctx: ContextoDoModulo): void {
  ctx.handle<[], StudioAchado>(C.acharStudio, async () => acharStudio(pastaDoStudio(ctx)))

  ctx.handle<[unknown], ResumoDaMigracao>(C.trazerDoStudio, async (pedidoIdCru) => {
    const pedidoId = typeof pedidoIdCru === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(pedidoIdCru) ? pedidoIdCru : 'migracao'
    if (emAndamento) throw new Error('Ja estou trazendo do Studio.')
    const espera = motivoParaEsperar()
    if (espera) throw new Error(espera)
    const studio = pastaDoStudio(ctx)
    if (!acharStudio(studio).existe) throw new Error('Nao achei o AniRecap Studio neste PC.')
    // O lote de rostos ocioso pode estar com o index.db aberto: sai antes.
    encerrarRostosDoMotor()
    const controle = new AbortController()
    emAndamento = { pedidoId, controle }
    let ultimo = 0
    try {
      return await trazerDoStudio({
        studio,
        modulo: ctx.pasta('dados'),
        biblioteca: pastaDaBibliotecaStudio(),
        temp: ctx.pasta('temp'),
        desproteger: dpapiDoWindows,
        cofre: {
          tem: (campo) => ctx.chave(campo).length > 0,
          salvar: (campo, valor) => ctx.salvarChave(campo, valor),
        },
        nucleo: { ler: vistaDoNucleo, gravar: gravarNoNucleo },
        config: { ler: configDoRecap, salvar: (patch) => void ctx.salvarConfig(patch) },
        ritmoDoModulo: () => lerMedidas(),
        sinal: controle.signal,
        progresso: (fase, texto, feitos, total) => {
          const agora = Date.now()
          if (fase !== 'fim' && agora - ultimo < 100) return
          ultimo = agora
          const p: ProgressoDaMigracao = { pedidoId, fase, texto, feitos, total }
          ctx.enviar(C.trazerProgresso, p)
        },
      })
    } finally {
      emAndamento = null
    }
  })

  ctx.handle<[unknown], boolean>(C.cancelarTrazer, async (pedidoId) => {
    if (!emAndamento || (typeof pedidoId === 'string' && pedidoId !== emAndamento.pedidoId)) return false
    emAndamento.controle.abort()
    return true
  })
}

/** Trazendo agora (o "Atualizar" espera). */
export function trazendoDoStudio(): boolean {
  return emAndamento !== null
}
