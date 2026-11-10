import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { app } from 'electron'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { PluginDaCadeia } from '@shared/edicao-de-audio'

/**
 * PLUGINS VST3 na etapa de audio -- o Fresh Air, da Slate Digital, que ele ja
 * usa no DaVinci e no Premiere.
 *
 * Quem abre o plugin e o vst-host (ferramentas/vst/host.py), um programa a
 * parte: Python com o Pedalboard, do Spotify (GPL-3). O Dangai so conversa com
 * ele por arquivos JSON -- chama, espera e le a resposta. Medido aqui: o Fresh
 * Air abre em 1,3 s e passa 15 s de narracao em 0,1 s.
 *
 * O programa (23 MB) e baixado no primeiro uso, como o
 * Whisper; em desenvolvimento serve o build local (ferramentas/vst/dist) ou o
 * Python de DANGAI_VST_PYTHON rodando o host.py direto.
 */

/*
 * v2 (1.99): o comando `acelerar` -- a velocidade da etapa de audio, sem mudar o
 * tom (Rubber Band R3). Quem tinha a v1 baixa a v2 uma vez; a v1 sai do disco.
 * Desde a 1.100 a velocidade e o atempo do ffmpeg (o R3 deixou a voz robotica,
 * ver edicao-de-audio.ts): o Dangai nao chama mais o `acelerar`.
 *
 * v3 (2.0): a janela do plugin abre NA TELA (a do Pedalboard abria com a barra
 * de titulo acima do monitor, sem o X a vista), por cima do Dangai, com o nome
 * do plugin, e fecha quando o Dangai pede (o `sinal` do comando `janela`).
 *
 * v4 (2.1): os botoes AO VIVO -- com a janela aberta, o que ele mexe vai para o
 * arquivo `vivo` e o Dangai refaz o som (antes, so ao fechar a janela).
 */
const VST_HOST = {
  versao: '4',
  url: 'https://github.com/faahpla/dangai/releases/download/ferramentas-vst-4/vst-host-4.zip',
  sha256: 'df183b5c4a7a7daa413c6e88ed772cd7d400ec5b8f9044d016c908efd4757215',
  mb: 23,
}

export const TAMANHO_DOS_PLUGINS_MB = VST_HOST.mb

let pasta: string | null = null

export function configureVst(userData: string): void {
  pasta = join(userData, 'audio-editado', 'ferramentas')
}

function dir(): string {
  if (!pasta) throw new Error('Plugins não configurados')
  mkdirSync(pasta, { recursive: true })
  return pasta
}

const instalado = (): string => join(dir(), `vst-host-${VST_HOST.versao}`, 'vst-host', 'vst-host.exe')
/** O build local de quem desenvolve (ferramentas/vst/build.ps1). */
const doBuildLocal = (): string => join(app.getAppPath(), 'ferramentas', 'vst', 'dist', 'vst-host', 'vst-host.exe')

/** Como chamar o vst-host: o programa, e o que vai antes dos argumentos. */
function comoChamar(): { exe: string; antes: string[] } | null {
  const py = process.env['DANGAI_VST_PYTHON']
  if (py) return { exe: py, antes: [join(app.getAppPath(), 'ferramentas', 'vst', 'host.py')] }
  if (existsSync(instalado())) return { exe: instalado(), antes: [] }
  if (!app.isPackaged && existsSync(doBuildLocal())) return { exe: doBuildLocal(), antes: [] }
  return null
}

export function pluginsProntos(): boolean {
  return process.platform === 'win32' && comoChamar() !== null
}

let baixando: Promise<void> | null = null

/** Baixa e abre o vst-host na pasta do Dangai. Confere o sha256 antes de usar. */
export function prepararPlugins(onProgress: (m: string) => void): Promise<void> {
  if (pluginsProntos()) return Promise.resolve()
  if (process.platform !== 'win32') return Promise.reject(new Error('Os plugins VST3 ainda só funcionam no Windows.'))
  if (!VST_HOST.sha256) return Promise.reject(new Error('Os plugins ainda não foram publicados para esta versão.'))
  baixando ??= (async () => {
    const zip = join(dir(), `vst-host-${VST_HOST.versao}.zip`)
    const parcial = `${zip}.part`
    onProgress(`Baixando o leitor de plugins (só na primeira vez)... 0/${VST_HOST.mb} MB`)
    const resposta = await fetch(VST_HOST.url, { redirect: 'follow' })
    if (!resposta.ok || !resposta.body) throw new Error(`Não deu para baixar o leitor de plugins (${resposta.status}).`)
    let baixado = 0
    let ultimo = 0
    const fonte = Readable.fromWeb(resposta.body as Parameters<typeof Readable.fromWeb>[0])
    fonte.on('data', (c: Buffer) => {
      baixado += c.length
      const mb = Math.floor(baixado / 1_000_000)
      if (mb > ultimo) {
        ultimo = mb
        onProgress(`Baixando o leitor de plugins (só na primeira vez)... ${mb}/${VST_HOST.mb} MB`)
      }
    })
    await pipeline(fonte, createWriteStream(parcial))
    const soma = createHash('sha256')
    await pipeline(createReadStream(parcial), soma)
    if (soma.digest('hex') !== VST_HOST.sha256) {
      rmSync(parcial, { force: true })
      throw new Error('O leitor de plugins veio diferente do esperado. Tente de novo.')
    }
    renameSync(parcial, zip)
    const destino = join(dir(), `vst-host-${VST_HOST.versao}`)
    rmSync(destino, { recursive: true, force: true })
    // Expand-Archive: o par do Compress-Archive que gerou o .zip (build.ps1).
    await new Promise<void>((resolve, reject) => {
      const ps = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${destino}' -Force`],
        { windowsHide: true },
      )
      ps.on('error', reject)
      ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Não deu para abrir o leitor de plugins baixado.'))))
    })
    rmSync(zip, { force: true })
    if (!existsSync(instalado())) throw new Error('O leitor de plugins baixado está incompleto.')
    // As versoes anteriores nao servem mais (a nova faz tudo o que elas faziam).
    for (const nome of readdirSync(dir())) {
      if (/^vst-host-\d+$/.test(nome) && nome !== `vst-host-${VST_HOST.versao}`) {
        rmSync(join(dir(), nome), { recursive: true, force: true })
      }
    }
  })().finally(() => {
    baixando = null
  })
  return baixando
}

/** Uma ida e volta com o vst-host: pedido num arquivo, resposta em outro. */
async function chamar<T>(comando: string, pedido: unknown, opcoes: { janela?: boolean } = {}): Promise<T> {
  const como = comoChamar()
  if (!como) throw new Error('O leitor de plugins ainda não está instalado.')
  const temp = join(dir(), `_${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  mkdirSync(temp, { recursive: true })
  const ida = join(temp, 'pedido.json')
  const volta = join(temp, 'resposta.json')
  writeFileSync(ida, JSON.stringify(pedido))
  try {
    await new Promise<void>((resolve, reject) => {
      // A janela do plugin precisa aparecer: escondida, a do Fresh Air abria
      // invisivel e o Dangai ficava esperando alguem fecha-la.
      const child = spawn(como.exe, [...como.antes, comando, ida, volta], { windowsHide: !opcoes.janela })
      child.on('error', (e) => reject(new Error(`O leitor de plugins não abriu: ${e.message}`)))
      child.on('close', () => resolve())
    })
    if (!existsSync(volta)) throw new Error('O leitor de plugins fechou sem responder.')
    const resposta = JSON.parse(readFileSync(volta, 'utf8')) as T & { erro?: string }
    if (resposta && typeof resposta === 'object' && 'erro' in resposta && resposta.erro) {
      throw new Error(`O plugin deu erro: ${resposta.erro}`)
    }
    return resposta
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

export interface PluginInstalado {
  nome: string
  fabricante: string
  caminho: string
}

export interface DescricaoDoPlugin {
  nome: string
  estado: string
  parametros: Record<string, number>
  textos: Record<string, string>
}

export function listarPlugins(): Promise<PluginInstalado[]> {
  return chamar<PluginInstalado[]>('listar', {})
}

export function descreverPlugin(caminho: string, estado: string | null): Promise<DescricaoDoPlugin> {
  return chamar<DescricaoDoPlugin>('descrever', { caminho, estado })
}

/** O arquivo-sinal de cada janela aberta: criado, o vst-host fecha a janela (ver host.py). */
const janelasAbertas = new Set<string>()

/**
 * Abre a janela do proprio plugin; volta quando ela FECHA, com o estado novo.
 * Fecha pelo X ou por fecharJanelasDosPlugins (o botao "Fechar", sair da etapa,
 * fechar o Dangai) -- antes da v3 do vst-host ela abria com o X fora da tela e
 * so morria com o Dangai.
 */
export async function janelaDoPlugin(
  caminho: string,
  estado: string | null,
  titulo: string,
  /** Os botoes mudaram com a janela aberta (v4): o Dangai refaz o som com eles, ao vivo. */
  aoVivo?: (parametros: Record<string, number>) => void,
): Promise<DescricaoDoPlugin> {
  const base = join(dir(), `_janela-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  const sinal = `${base}.fechar`
  const vivo = `${base}.vivo.json`
  janelasAbertas.add(sinal)
  let visto = 0
  const vigia = setInterval(() => {
    if (!aoVivo) return
    try {
      const quando = statSync(vivo).mtimeMs
      if (quando === visto) return
      visto = quando
      aoVivo(JSON.parse(readFileSync(vivo, 'utf8')) as Record<string, number>)
    } catch {
      // Ainda nao mexeu (o arquivo nem existe), ou pegou no meio da escrita: a proxima volta le.
    }
  }, 250)
  try {
    return await chamar<DescricaoDoPlugin>('janela', { caminho, estado, titulo, sinal, vivo }, { janela: true })
  } finally {
    clearInterval(vigia)
    janelasAbertas.delete(sinal)
    rmSync(sinal, { force: true })
    rmSync(vivo, { force: true })
  }
}

/** Fecha as janelas de plugin abertas. Cada uma devolve o estado dela a quem abriu. */
export function fecharJanelasDosPlugins(): void {
  for (const sinal of janelasAbertas) {
    try {
      writeFileSync(sinal, '')
    } catch {
      // A pasta sumiu: a janela fecha com o processo.
    }
  }
}

/** Passa o .wav pelos plugins ligados, na ordem. */
export async function aplicarPlugins(entrada: string, saida: string, plugins: readonly PluginDaCadeia[]): Promise<void> {
  await chamar('processar', {
    entrada,
    saida,
    plugins: plugins.map((p) => ({ caminho: p.caminho, estado: p.estado, parametros: p.parametros })),
  })
}
