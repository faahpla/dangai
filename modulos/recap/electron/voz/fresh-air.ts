import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginDaCadeia } from '../../../../shared/edicao-de-audio'
import { getSettings } from '../../../../electron/services/settings'
import { aplicarPlugins, listarPlugins, prepararPlugins } from '../../../../electron/services/vst'
import { decodificar } from './ffmpeg'
import { wavDoPcm, type Pcm } from './wav'

/**
 * O FRESH AIR NA VOZ IMPORTADA (14/11): "so fresh air e normalizar, quem quiser".
 *
 * O normalizar ja acontece sempre (volume.ts iguala em -23 LUFS e o render leva a
 * narracao a -14): nao precisa de opcao. O Fresh Air (Slate Digital, VST3) e o
 * plugin que ele usa no DaVinci e na etapa de audio do Dangai; aqui passa pelo
 * MESMO leitor de plugins do nucleo (electron/services/vst.ts: o vst-host com o
 * Pedalboard, baixado no 1o uso, ~23 MB), sem mexer no nucleo.
 *
 * O preset: o do "meu padrao" da etapa de audio (settings.cadeiaDeAudio), se ele
 * salvou um com o Fresh Air; senao o padrao do plugin.
 *
 * Melhor esforco: plugin que falha (leitor que nao baixou, erro do plugin) deixa a
 * voz sem ele e um aviso no take; so o Cancelar interrompe.
 *
 * Entra depois dos cortes e da velocidade, antes de igualar o volume. So muda o
 * som: a saida tem exatamente as amostras da entrada (o que sobrar ou faltar no
 * fim e cortado ou completado com silencio), entao as palavras nao andam.
 */

const EH_FRESH_AIR = /fresh\s*air/i

/** O Fresh Air a usar (o do padrao dele, ou o instalado). null = nao tem neste PC. */
export async function pluginDoFreshAir(avisar: (m: string) => void = () => {}): Promise<PluginDaCadeia | null> {
  const cadeia = getSettings().cadeiaDeAudio as { plugins?: PluginDaCadeia[] } | null
  const salvo = Array.isArray(cadeia?.plugins) ? cadeia!.plugins.find((p) => p && typeof p.nome === 'string' && EH_FRESH_AIR.test(p.nome)) : undefined
  await prepararPlugins(avisar)
  if (salvo) return { ...salvo, ligado: true }
  const instalado = (await listarPlugins()).find((p) => EH_FRESH_AIR.test(p.nome))
  return instalado ? { id: 'fresh-air', ligado: true, caminho: instalado.caminho, nome: instalado.nome, estado: null, parametros: {} } : null
}

/** A mesma quantidade de amostras: corta o que sobrou ou completa com silencio. */
export function mesmoTamanho(saida: Int16Array, n: number): Int16Array {
  if (saida.length === n) return saida
  const r = new Int16Array(n)
  r.set(saida.subarray(0, Math.min(n, saida.length)))
  return r
}

export async function comFreshAir(
  pcm: Pcm,
  pasta: string,
  avisar: (m: string) => void = () => {},
  signal?: AbortSignal,
): Promise<{ pcm: Pcm; aviso: string | null }> {
  let plugin: PluginDaCadeia | null
  try {
    plugin = await pluginDoFreshAir(avisar)
  } catch (err) {
    return { pcm, aviso: `Fresh Air nao rodou (${err instanceof Error ? err.message.slice(0, 80) : 'erro'}): a voz ficou sem ele.` }
  }
  if (!plugin) return { pcm, aviso: 'Fresh Air nao encontrado neste PC: a voz ficou sem ele.' }
  const tmp = join(pasta, '_fresh-air')
  mkdirSync(tmp, { recursive: true })
  const entrada = join(tmp, 'entrada.wav')
  const saida = join(tmp, 'saida.wav')
  try {
    writeFileSync(entrada, wavDoPcm(pcm))
    await aplicarPlugins(entrada, saida, [plugin])
    // O Pedalboard grava em float: o ffmpeg traz de volta para 16 bits mono na mesma taxa.
    const lido = await decodificar(saida, pcm.taxa, signal)
    return { pcm: { taxa: pcm.taxa, amostras: mesmoTamanho(lido.amostras, pcm.amostras.length) }, aviso: null }
  } catch (err) {
    // Cancelado pela tela: cancela mesmo. Qualquer outro erro do plugin nao derruba a voz.
    if (signal?.aborted) throw err
    return { pcm, aviso: `Fresh Air nao rodou (${err instanceof Error ? err.message.slice(0, 80) : 'erro'}): a voz ficou sem ele.` }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
