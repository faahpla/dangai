import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import sharp from 'sharp'
import { ffmpegPath } from './ffmpeg-path'
import { probeClip } from './clips'

/**
 * Prepara um arquivo para a FAIXA DE VIDEO (setas, circulos, emoji animado).
 *
 * O .mov que ele exporta do editor costuma ser ProRes 4444 ou QuickTime
 * Animation com canal alfa -- o fundo vazado e o que faz a seta flutuar sobre a
 * cena. Nem o preview (Chromium) nem o <video> tocam ProRes. O que os dois
 * tocam COM transparencia e WebM VP9 com alfa, e e para isso que o .mov e
 * convertido, uma vez, num cache pela identidade do arquivo.
 *
 * WebM e MP4 ja tocam e entram como estao (MP4 nao tem alfa, mas pode ser um
 * overlay opaco de proposito). Imagem entra direto.
 */

let cacheDir: string | null = null

export function configureSobreposicao(userDataDir: string): void {
  cacheDir = join(userDataDir, 'sobreposicoes')
}

function dir(): string {
  if (!cacheDir) throw new Error('Sobreposicao nao configurada')
  mkdirSync(cacheDir, { recursive: true })
  return cacheDir
}

const TOCA_DIRETO = ['.webm', '.mp4', '.m4v']

export interface SobreposicaoPronta {
  /** O arquivo que o preview e o render vao tocar. */
  arquivo: string
  tipo: 'video' | 'image'
  durationSec: number
  aspecto: number
}

export async function prepararSobreposicao(path: string): Promise<SobreposicaoPronta> {
  const ext = extname(path).toLowerCase()

  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    const meta = await sharp(path).metadata()
    return {
      arquivo: path,
      tipo: 'image',
      // Imagem nao tem duracao: o teto e largo, e quanto ela fica na tela e
      // decidido na faixa (nasce com 3 s).
      durationSec: 3600,
      aspecto: meta.width && meta.height ? meta.width / meta.height : 1,
    }
  }

  const info = await probeClip(path)
  const aspecto = info.width / info.height
  if (TOCA_DIRETO.includes(ext)) {
    return { arquivo: path, tipo: 'video', durationSec: info.durationSec, aspecto }
  }

  const s = statSync(path)
  const chave = createHash('sha1').update(`${path}|${s.size}|${s.mtimeMs}`).digest('hex').slice(0, 20)
  const alvo = join(dir(), `${chave}.webm`)
  if (!existsSync(alvo)) {
    /*
     * UMA CONVERSAO POR ARQUIVO. O mesmo .mov duas vezes na linha do tempo (a
     * mesma seta em dois pontos) pedia duas conversoes ao mesmo tempo para o
     * mesmo destino: a primeira renomeava o .part, a segunda falhava no rename
     * ("ENOENT") e aquele clipe ficava sem video no preview e no render.
     * Quem chega com a conversao andando espera a mesma.
     */
    const andando = convertendo.get(alvo)
    if (andando) {
      await andando
    } else {
      const tarefa = converter(path, alvo)
      convertendo.set(alvo, tarefa)
      try {
        await tarefa
      } finally {
        convertendo.delete(alvo)
      }
    }
  }
  return { arquivo: alvo, tipo: 'video', durationSec: info.durationSec, aspecto }
}

const convertendo = new Map<string, Promise<void>>()

/** Onde esta o que se VE no arquivo, em fracao da largura e da altura dele. */
export interface CaixaDoConteudo {
  x0: number
  y0: number
  x1: number
  y1: number
}

const caixas = new Map<string, Promise<CaixaDoConteudo | null>>()

/**
 * A CAIXA DO CONTEUDO: a parte nao transparente do arquivo, somada ao longo do
 * clipe todo.
 *
 * Uma seta exportada no tamanho do video e um quadro 1080x1920 quase todo
 * vazio, com a seta pequena num canto. O transform pelo preview desenhava a
 * caixa do QUADRO -- girada, virava um losango enorme saindo da tela, longe da
 * seta. Esta e a caixa que abraca a seta.
 *
 * O ffmpeg extrai o alfa de ate 60 quadros (4 por segundo), num tamanho
 * pequeno, e o filtro bbox diz onde ha alguma coisa em cada um. Arquivo sem
 * alfa sai com o quadro inteiro. null = nao deu para medir (o preview fica com
 * o quadro inteiro, como antes).
 */
export function caixaDoConteudo(path: string): Promise<CaixaDoConteudo | null> {
  let chave = path
  try {
    const s = statSync(path)
    chave = `${path}|${s.size}|${s.mtimeMs}`
  } catch {
    return Promise.resolve(null)
  }
  const ja = caixas.get(chave)
  if (ja) return ja
  const medindo = medirCaixa(path).catch(() => null)
  caixas.set(chave, medindo)
  return medindo
}

async function medirCaixa(path: string): Promise<CaixaDoConteudo | null> {
  const ext = extname(path).toLowerCase()
  const L = 256
  // O decodificador VP9 nativo do ffmpeg joga o alfa fora; o libvpx guarda.
  const decodificadores = ext === '.webm' ? [['-c:v', 'libvpx-vp9'], ['-c:v', 'libvpx'], []] : [[]]
  for (const dec of decodificadores) {
    const saida = await rodarComSaida([
      '-hide_banner', '-nostats', ...dec, '-i', path,
      '-vf', `fps=4,scale=${L}:${L},format=rgba,alphaextract,bbox=min_val=24`,
      '-frames:v', '60', '-an', '-f', 'null', '-',
    ])
    if (saida === null) continue
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const m of saida.matchAll(/x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/g)) {
      x0 = Math.min(x0, Number(m[1]))
      x1 = Math.max(x1, Number(m[2]) + 1)
      y0 = Math.min(y0, Number(m[3]))
      y1 = Math.max(y1, Number(m[4]) + 1)
    }
    if (!Number.isFinite(x0) || x1 <= x0 || y1 <= y0) return null
    // Um pixel de folga em volta: a caixa nao encosta na borda da seta.
    return {
      x0: Math.max(0, (x0 - 1) / L),
      y0: Math.max(0, (y0 - 1) / L),
      x1: Math.min(1, (x1 + 1) / L),
      y1: Math.min(1, (y1 + 1) / L),
    }
  }
  return null
}

/** Roda o ffmpeg e devolve o stderr; null se ele falhou. */
function rodarComSaida(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString()
      // So as linhas do bbox interessam; o resto nao precisa crescer sem fim.
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000)
    })
    child.on('error', () => resolve(null))
    child.on('close', (code) => resolve(code === 0 ? stderr : null))
  })
}

async function converter(path: string, alvo: string): Promise<void> {
  const parcial = `${alvo}.part.webm`
  try {
    await rodar([
      '-y', '-hide_banner', '-loglevel', 'error', '-i', path,
      // yuva420p guarda o canal alfa; sem alfa na fonte, ele sai opaco.
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
      '-b:v', '0', '-crf', '24', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
      // Alfa em VP9 exige isto desligado.
      '-auto-alt-ref', '0',
      '-an', parcial,
    ])
    renameSync(parcial, alvo)
  } catch (erro) {
    rmSync(parcial, { force: true })
    throw erro
  }
}

function rodar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Nao deu para preparar o video: ${stderr.trim().split('\n').slice(-2).join(' ')}`)),
    )
  })
}
