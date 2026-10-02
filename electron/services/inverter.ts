import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ffmpegPath } from './ffmpeg-path'
import { probeClip } from './clips'

/**
 * O clipe tocando de tras para frente.
 *
 * "Uma opcao onde eu clico e ele faz um reverse do clipe para eu poder usar
 * invertido." O Remotion nao toca video ao contrario -- o compositor extrai o
 * quadro do instante pedido, sempre para frente. Entao o invertido e um
 * ARQUIVO: gerado uma vez pelo ffmpeg, guardado em cache, e dali em diante o
 * clipe invertido e um clipe como outro qualquer para o resto do app.
 *
 * O filtro `reverse` do ffmpeg guarda o clipe INTEIRO na memoria antes de
 * soltar o primeiro quadro: 5 s de 1080p sao ~370 MB, 30 s passariam de 2 GB.
 * Por isso clipe longo vai em pedacos de PEDACO_SEC -- cada pedaco invertido
 * sozinho, e os pedacos costurados na ordem contraria. O resultado e o mesmo
 * quadro a quadro, com memoria limitada ao tamanho de um pedaco.
 */

const PEDACO_SEC = 4

let cacheDir: string | null = null

export function configureInverter(userDataDir: string): void {
  cacheDir = join(userDataDir, 'invertidos')
}

function dir(): string {
  if (!cacheDir) throw new Error('Inverter nao configurado')
  mkdirSync(cacheDir, { recursive: true })
  return cacheDir
}

/**
 * Pela IDENTIDADE do arquivo -- caminho, tamanho e data --, e nao pelo id do
 * asset: o mesmo clipe em dois blocos, ou em dois projetos, inverte uma vez so.
 */
function chave(path: string): string {
  const s = statSync(path)
  return createHash('sha1').update(`${path}|${s.size}|${s.mtimeMs}`).digest('hex').slice(0, 20)
}

function rodar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim().split('\n').slice(-2).join(' '))),
    )
  })
}

/** Mesmo codec e qualidade do recorte 9:16: o invertido nao pode sair pior que o original. */
const CODIFICAR = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p']

/** O caminho do clipe invertido, gerando na primeira vez. */
export async function clipeInvertido(path: string): Promise<string> {
  const alvo = join(dir(), `${chave(path)}.mp4`)
  if (existsSync(alvo)) return alvo

  const { durationSec } = await probeClip(path)
  const parcial = `${alvo}.part.mp4`

  if (durationSec <= PEDACO_SEC * 1.5) {
    await rodar(['-y', '-hide_banner', '-loglevel', 'error', '-i', path, '-vf', 'reverse', ...CODIFICAR, parcial])
  } else {
    /*
     * Os pedacos sao cortados por NUMERO DE QUADRO, e nao por segundo.
     *
     * Por segundo (-ss/-t) a conta nao fecha: 4 s a 23,976 fps sao 95,9
     * quadros, e cada corte arredonda para um lado. Medido num clipe de 8,7 s:
     * o invertido saia com 209 quadros contra 208 do original, e a costura
     * desalinhava ate 10 niveis de cinza por quadro. Com `trim` em quadros, cada
     * quadro cai em exatamente um pedaco.
     */
    const total = await contarQuadros(path)
    const porPedaco = Math.max(1, Math.round((total / durationSec) * PEDACO_SEC))
    const pasta = `${alvo}.pedacos`
    mkdirSync(pasta, { recursive: true })
    try {
      const pedacos: string[] = []
      for (let ini = 0, i = 0; ini < total; ini += porPedaco, i++) {
        const fim = Math.min(total, ini + porPedaco)
        const p = join(pasta, `${String(i).padStart(4, '0')}.mp4`)
        await rodar([
          '-y', '-hide_banner', '-loglevel', 'error', '-i', path,
          '-vf', `trim=start_frame=${ini}:end_frame=${fim},setpts=PTS-STARTPTS,reverse`,
          ...CODIFICAR, p,
        ])
        pedacos.push(p)
      }
      // O ultimo pedaco do original e o PRIMEIRO do invertido.
      const lista = join(pasta, 'lista.txt')
      writeFileSync(lista, pedacos.reverse().map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'))
      await rodar(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', parcial])
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  }

  renameSync(parcial, alvo)
  return alvo
}

/**
 * Quantos quadros o clipe tem de verdade, decodificando ate o fim.
 *
 * Decodificar e nao copiar o stream: o ffmpeg empacotado nao imprime a
 * contagem quando so copia. Num clipe de 8,7 s custa 0,2 s.
 */
function contarQuadros(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', path, '-map', '0:v:0', '-f', 'null', '-'], {
      windowsHide: true,
    })
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', reject)
    child.on('close', () => {
      const todos = [...stderr.matchAll(/frame=\s*(\d+)/g)]
      const n = Number(todos.at(-1)?.[1])
      if (Number.isFinite(n) && n > 0) resolve(n)
      else reject(new Error('Nao deu para contar os quadros do clipe.'))
    })
  })
}
