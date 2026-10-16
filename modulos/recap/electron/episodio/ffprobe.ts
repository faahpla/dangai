import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ffmpegPath } from '../ffmpeg-path'

/**
 * O FFPROBE do Studio.
 *
 * O app nao precisa de pacote novo: o compositor do Remotion
 * (@remotion/compositor-<plataforma>) ja traz um ffprobe junto do ffmpeg dele,
 * ja vai no instalador e ja fica fora do asar (asarUnpack de
 * `@remotion/compositor-*` no electron-builder.yml, que o render usa). E o
 * mesmo build (FFmpeg 7.1) com que o Remotion le os videos do projeto.
 *
 * Por que ffprobe e nao o `ffmpeg -i` que o clips.ts usa: o passo 1 precisa de
 * capitulos, disposition (default/forced), tags de idioma e titulo de cada
 * faixa e o start_time exato. O -i imprime isso em texto para gente, com
 * duracao em centesimos e formatos que mudam entre versoes; o ffprobe devolve
 * JSON.
 *
 * Onde procurar, nesta ordem:
 * 1. ao lado do ffmpeg-static: <node_modules>/@remotion/compositor-*. O
 *    ffmpegPath ja vem com app.asar trocado por app.asar.unpacked quando
 *    empacotado, entao a mesma conta serve em dev, empacotado e nos testes;
 * 2. o ffprobe do PATH (ffmpeg 9 na maquina do Levi), so como reserva.
 */

let achado: string | null = null

export function caminhoDoFfprobe(): string {
  if (achado) return achado
  const exe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const nodeModules = dirname(dirname(ffmpegPath))
  try {
    const remotion = join(nodeModules, '@remotion')
    const pasta = readdirSync(remotion).find((nome) => nome.startsWith('compositor-'))
    if (pasta && existsSync(join(remotion, pasta, exe))) {
      achado = join(remotion, pasta, exe)
      return achado
    }
  } catch {
    /* sem o compositor: tenta o PATH */
  }
  achado = exe
  return achado
}

/** O pedaco do JSON do ffprobe que o Studio usa. */
export interface StreamDoFfprobe {
  index: number
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  start_time?: string
  duration?: string
  color_transfer?: string
  color_primaries?: string
  disposition?: Record<string, number>
  tags?: Record<string, string>
}

export interface SaidaDoFfprobe {
  streams?: StreamDoFfprobe[]
  format?: { duration?: string; start_time?: string; size?: string; format_name?: string; tags?: Record<string, string> }
  chapters?: { start_time?: string; end_time?: string; tags?: Record<string, string> }[]
}

/** Roda o ffprobe e devolve o JSON. Lanca com mensagem pronta para a tela. */
export function sondarComFfprobe(arquivo: string): Promise<SaidaDoFfprobe> {
  return new Promise((resolve, reject) => {
    const filho = spawn(
      caminhoDoFfprobe(),
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', arquivo],
      { windowsHide: true },
    )
    // Buffers juntos e decodificados no fim: um acento partido entre dois
    // pedacos do stdout viraria lixo no titulo da faixa.
    const saida: Buffer[] = []
    const erro: Buffer[] = []
    filho.stdout.on('data', (c: Buffer) => saida.push(c))
    filho.stderr.on('data', (c: Buffer) => erro.push(c))
    filho.on('error', (e) => reject(new Error(`Nao deu para abrir o ffprobe (${e.message}).`)))
    filho.on('close', (codigo) => {
      if (codigo !== 0) {
        const motivo = Buffer.concat(erro).toString('utf8').trim().split('\n').pop() ?? ''
        reject(new Error(`Nao deu para ler o video${motivo ? `: ${motivo}` : ''}.`))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(saida).toString('utf8')) as SaidaDoFfprobe)
      } catch {
        reject(new Error('O ffprobe respondeu algo que nao e JSON.'))
      }
    })
  })
}
