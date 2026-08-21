import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { VIDEO_HEIGHT, VIDEO_WIDTH } from '@shared/contract'
import { ffmpegPath } from './ffmpeg-path'

/**
 * Clipe de video como fonte de um bloco.
 *
 * O ponto inteiro deste arquivo e o pre-corte na IMPORTACAO, e ele nao e um
 * detalhe de desempenho -- e o que torna o recurso viavel. Medido em 2026-07-28
 * num video de 48 blocos e 64s, o mesmo render:
 *
 *   clipe cru 1920x1080 publicado inteiro ....... o Chrome recorta a cada frame
 *   clipe pre-cortado na resolucao nativa ....... 1.77x mais rapido
 *
 * Com o pre-corte, um video inteiro de clipe custa 50s contra 47s do mesmo video
 * so com print. Sem ele, dobra. A conversao custa 0.28s por clipe, uma vez.
 *
 * A resolucao do recorte importa e nao e obvia: um 1920x1080 cortado em 9:16 tem
 * so 608x1080 de pixels uteis, o que ja e MENOR que o quadro de render de
 * 1242x2208. Converter para 1242x2208 -- que foi a primeira tentativa -- amplia
 * 608 para 1242 e paga para decodificar pixel sem informacao: sai 2x mais LENTO
 * que nao converter nada. O recorte tem que ficar na resolucao nativa e deixar a
 * ampliacao para o Chrome, que faria isso de qualquer jeito.
 */

/** Onde ficam as conversoes. Mesma pasta do cache de imagem, mesma vida util. */
let cacheDir = ''

export function configureClips(dir: string): void {
  cacheDir = dir
}

export interface ClipInfo {
  width: number
  height: number
  durationSec: number
}

/**
 * Dimensoes e duracao, lidas do proprio ffmpeg.
 *
 * O projeto nao embarca ffprobe -- so ffmpeg-static. Um `-i` sem saida faz o
 * ffmpeg descrever a entrada no stderr e sair com erro; e o modo suportado de
 * sondar sem um segundo binario de 70MB no instalador.
 */
/**
 * Dimensao e duracao nao mudam enquanto o app esta aberto, e o reenquadramento
 * sondaria de novo a cada vez que o usuario solta o arraste. A memoria evita um
 * processo de ffmpeg por arraste.
 *
 * Nao e o gargalo, e medir deixou isso claro: reenquadrar continuou em ~0.7s com
 * e sem ela, porque quem custa e a conversao. Fica por ser um processo a menos,
 * nao por ser rapida -- o ganho de verdade viria de converter so o trecho que o
 * bloco usa, e isso so vale quando o clipe chegar mais longo que o bloco.
 */
const sondados = new Map<string, ClipInfo>()

export async function probeClip(path: string): Promise<ClipInfo> {
  const lembrado = sondados.get(path)
  if (lembrado) return lembrado

  const saida = await runFfmpeg(['-hide_banner', '-i', path], { aceitaFalha: true })

  const dimensao = /,\s(\d{2,5})x(\d{2,5})[\s,]/.exec(saida)
  const duracao = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(saida)
  if (!dimensao || !duracao) {
    throw new Error('nao foi possivel ler dimensoes ou duracao')
  }

  const width = Number(dimensao[1])
  const height = Number(dimensao[2])
  const durationSec =
    Number(duracao[1]) * 3600 + Number(duracao[2]) * 60 + Number(duracao[3])

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error('duracao invalida')
  }

  const info = { width, height, durationSec }
  sondados.set(path, info)
  return info
}

/**
 * Menor webp que ainda pode ser uma imagem de verdade.
 *
 * Existe porque o ffmpeg NAO reclama quando o instante pedido cai depois do fim
 * do clipe: ele sai com codigo 0 e deixa um arquivo de 8 bytes. Sem esta
 * conferencia o arquivo vazio ia para o cache e a cena ficava preta na esteira
 * para sempre, sem nenhum erro em lugar nenhum.
 */
const THUMB_MINIMO_BYTES = 200

/**
 * Miniatura de um frame do meio do clipe, no mesmo formato que a da imagem.
 *
 * O instante e `min(1s, metade do clipe)`. Um segundo fixo era o que existia
 * antes, com um bom motivo -- o frame zero costuma ser fade de entrada --, mas
 * cena de anime nao tem duracao minima: no episodio de teste dele, 15 de 321
 * cenas duram MENOS de um segundo, e nelas o instante pedido caia depois do
 * fim. Duas apareceram pretas na esteira dele.
 *
 * A metade resolve os dois casos: foge do fade nos clipes longos e continua
 * dentro do arquivo nos curtos.
 */
export async function makeClipThumbnail(path: string, durationSec?: number): Promise<string> {
  const alvo = join(cacheDir, `thumb-${hashDe(path)}.webp`)

  // Vazio guardado por uma versao anterior nao pode sobreviver para sempre.
  if (existsSync(alvo) && statSync(alvo).size < THUMB_MINIMO_BYTES) rmSync(alvo, { force: true })

  if (!existsSync(alvo)) {
    mkdirSync(cacheDir, { recursive: true })
    const dur = durationSec ?? (await probeClip(path)).durationSec

    /*
     * Tres instantes, e nao um.
     *
     * O primeiro e o de sempre: um segundo dentro, ou a metade quando a cena e
     * mais curta que isso. Os outros dois existem porque frame preto acontece
     * -- abertura de episodio, fade, cena que comeca no escuro. Achei isso numa
     * cena de 7 minutos da biblioteca dele: o frame saia com 134 bytes em
     * qualquer ponto perto do comeco, e a importacao FALHAVA, deixando ele sem
     * poder usar o arquivo.
     *
     * Desistir na primeira tentativa transformava "a miniatura ficou feia" em
     * "essa cena nao entra no projeto", que e muito pior.
     */
    for (const instante of [Math.min(1, dur / 2), dur * 0.25, dur * 0.5]) {
      await runFfmpeg([
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        instante.toFixed(3),
        '-i',
        path,
        '-frames:v',
        '1',
        '-vf',
        'scale=220:-2',
        '-c:v',
        'libwebp',
        '-quality',
        '78',
        '-y',
        alvo,
      ])
      if (existsSync(alvo) && statSync(alvo).size >= THUMB_MINIMO_BYTES) break
    }
  }

  if (!existsSync(alvo) || statSync(alvo).size < THUMB_MINIMO_BYTES) {
    /*
     * Todos os instantes vieram vazios: o clipe e preto de ponta a ponta, ou
     * esta corrompido. Ai a miniatura nao e o problema, e recusar e honesto --
     * mas a mensagem tem que dizer o que ele veria no video.
     */
    rmSync(alvo, { force: true })
    throw new Error('nao ha imagem nesse clipe -- ele parece preto do comeco ao fim')
  }

  const { readFile } = await import('node:fs/promises')
  return `data:image/webp;base64,${(await readFile(alvo)).toString('base64')}`
}

/**
 * Recorta o clipe em 9:16 na resolucao nativa, ancorado no ponto escolhido.
 *
 * Mesma matematica do makeRenderReady das imagens, com a mesma consequencia:
 * quem controla o enquadramento e o usuario, e mudar o foco gera outro arquivo
 * em vez de sobrescrever o anterior -- senao o cache devolveria o recorte velho.
 */
export async function makeClipRenderReady(
  path: string,
  id: string,
  focusX: number,
  focusY: number,
  info: ClipInfo,
): Promise<string> {
  mkdirSync(cacheDir, { recursive: true })

  const x = clamp01(focusX)
  const y = clamp01(focusY)
  const alvo = join(cacheDir, `${id}-${Math.round(x * 1000)}-${Math.round(y * 1000)}.mp4`)
  if (existsSync(alvo)) return alvo

  // A maior janela 9:16 que cabe no clipe, em pixels pares -- o yuv420p exige
  // largura e altura pares, e o ffmpeg falha em vez de arredondar sozinho.
  const proporcao = VIDEO_WIDTH / VIDEO_HEIGHT
  const largura = par(Math.min(info.width, info.height * proporcao), info.width)
  const altura = par(Math.min(info.height, info.width / proporcao), info.height)

  // Quanto sobra para deslizar, e onde a janela para dentro dessa sobra.
  const left = Math.round((info.width - largura) * x)
  const top = Math.round((info.height - altura) * y)

  await runFfmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    path,
    // O audio do clipe nao entra: a trilha do video e a narracao.
    '-an',
    '-vf',
    `crop=${largura}:${altura}:${left}:${top}`,
    '-c:v',
    'libx264',
    // crf 18 para a conversao nao virar o elo fraco da qualidade: medida contra
    // o caminho sem conversao, a diferenca media ficou em 1.2/255, invisivel.
    '-crf',
    '18',
    // veryfast porque isto roda enquanto o usuario espera para comecar a editar,
    // e o arquivo e consumido uma vez pelo render -- nao e um entregavel.
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-y',
    alvo,
  ])

  return alvo
}

function runFfmpeg(args: string[], opcoes?: { aceitaFalha?: boolean }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let saida = ''
    child.stderr.on('data', (chunk: Buffer) => {
      saida += chunk.toString()
    })
    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0 || opcoes?.aceitaFalha) resolve(saida)
      else reject(new Error(saida.trim().split('\n').at(-1) ?? `ffmpeg saiu com ${code}`))
    })
  })
}

/**
 * Par mais proximo, sem nunca passar do que o clipe tem.
 *
 * Arredondar sempre para baixo parece a escolha segura e nao e: num 1920x1080 a
 * janela 9:16 mede 607.5px, e descer para 606 joga fora dois pixels E torce a
 * proporcao (0.5611 em vez de 0.5625), o que reaparece como um recorte de
 * sobra no render. Subir para 608 mantem a proporcao; o teto impede que o
 * arredondamento peca pixel que o arquivo nao tem.
 */
function par(valor: number, maximo: number): number {
  const arredondado = Math.round(valor / 2) * 2
  const teto = Math.floor(maximo / 2) * 2
  return Math.max(Math.min(arredondado, teto), 2)
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.5
}

/** Nome estavel para a miniatura, sem depender do caminho cru no sistema. */
function hashDe(texto: string): string {
  let h = 0
  for (let i = 0; i < texto.length; i++) h = (Math.imul(31, h) + texto.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
