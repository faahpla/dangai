import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * CLIPE HDR VIRANDO IMAGEM COMUM -- com a cor que o Chrome mostra.
 *
 * "Eu cortei um anime em HDR, e na selecao de cenas os clipes ficaram meio
 * lavados." O AnCut corta com as marcas do HDR (BT.2020 + PQ). O Chrome, que
 * toca o clipe na linha do tempo, le as marcas e converte para a tela -- por
 * isso la a cor e a certa. Mas quadro solto (miniatura, keyframe do AnCut, o
 * render do Remotion) sai com os numeros do PQ lidos como video comum: imagem
 * lavada, roxa, cinzenta.
 *
 * A conversao abaixo foi AJUSTADA CONTRA O PROPRIO CHROME: o quadro que ele
 * desenha de tres cenas do Cyberpunk Edgerunners, comparado pixel a pixel. Com
 * branco de referencia 140 nits e o pico do Hable em 4, ficou a ~30 dB do
 * Chrome (o tone mapping do ffmpeg chegava a 25-28; o quadro sem conversao, a
 * 17-23). E uma funcao de RGB 8 bits para RGB 8 bits -- a mesma entrada que o
 * keyframe do AnCut e o quadro solto do ffmpeg ja sao --, entao serve igual
 * para miniatura (em JS) e para video (numa tabela 3D no lut3d do ffmpeg).
 */

const NPL = 140
const PICO = 4
const m1 = 2610 / 16384
const m2 = (2523 / 4096) * 128
const c1 = 3424 / 4096
const c2 = (2413 / 4096) * 32
const c3 = (2392 / 4096) * 32
const pq = (e: number): number => {
  const p = Math.pow(Math.max(e, 0), 1 / m2)
  return 10000 * Math.pow(Math.max(p - c1, 0) / (c2 - c3 * p), 1 / m1)
}
const hable = (x: number): number => {
  const a = 0.15
  const b = 0.5
  const c = 0.1
  const d = 0.2
  const e = 0.02
  const f = 0.3
  return (x * (x * a + b * c) + d * e) / (x * (x * a + b) + d * f) - e / f
}
const HABLE_PICO = hable(PICO)
const oetf = (l: number): number => (l < 0.018 ? 4.5 * l : 1.099 * Math.pow(l, 0.45) - 0.099)
const corta = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Um pixel (0..1) lido como PQ/BT.2020 vira o pixel SDR/BT.709 que o Chrome mostraria. */
export function pixelHdrParaSdr(R: number, G: number, B: number): [number, number, number] {
  // O RGB veio do YCbCr pelo BT.601 (JFIF e o ffmpeg fazem assim): desfaz e
  // refaz pelos coeficientes do BT.2020, que e como o clipe foi gravado.
  const Y = 0.299 * R + 0.587 * G + 0.114 * B
  const Cb = (B - Y) / 1.772
  const Cr = (R - Y) / 1.402
  const r2 = Y + 1.4746 * Cr
  const g2 = Y - 0.16455 * Cb - 0.57135 * Cr
  const b2 = Y + 1.8814 * Cb
  // PQ -> nits -> relativo ao branco de referencia.
  let r = pq(r2) / NPL
  let g = pq(g2) / NPL
  let b = pq(b2) / NPL
  // Cores do BT.2020 para as do BT.709, em luz linear.
  const r7 = 1.6605 * r - 0.5876 * g - 0.0728 * b
  const g7 = -0.1246 * r + 1.1329 * g - 0.0083 * b
  const b7 = -0.0182 * r - 0.1006 * g + 1.1187 * b
  r = Math.max(r7, 0)
  g = Math.max(g7, 0)
  b = Math.max(b7, 0)
  // Hable sobre o maior canal: comprime o brilho sem mudar a cor.
  const sinal = Math.max(r, g, b)
  if (sinal > 1e-6) {
    const k = hable(sinal) / HABLE_PICO / sinal
    r *= k
    g *= k
    b *= k
  }
  return [corta(oetf(Math.min(r, 1))), corta(oetf(Math.min(g, 1))), corta(oetf(Math.min(b, 1)))]
}

/** Converte um buffer RGB de 8 bits (3 canais) no lugar. */
export function converterRgbHdr(buf: Uint8Array): void {
  // Tabela de 32768 cores (5 bits por canal) com interpolacao? Simples e rapido o
  // bastante: miniatura tem ~60 mil pixels; cache por cor cobre a repeticao.
  const memo = new Map<number, number>()
  for (let i = 0; i + 2 < buf.length; i += 3) {
    const chave = (buf[i]! << 16) | (buf[i + 1]! << 8) | buf[i + 2]!
    let pronto = memo.get(chave)
    if (pronto === undefined) {
      const [r, g, b] = pixelHdrParaSdr(buf[i]! / 255, buf[i + 1]! / 255, buf[i + 2]! / 255)
      pronto = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)
      memo.set(chave, pronto)
    }
    buf[i] = (pronto >> 16) & 255
    buf[i + 1] = (pronto >> 8) & 255
    buf[i + 2] = pronto & 255
  }
}

/** O clipe e HDR? Pelo texto que o ffmpeg imprime sobre o stream de video. */
export function ehHdrPeloFfmpeg(saidaDoFfmpeg: string): boolean {
  return /smpte2084|arib-std-b67/i.test(saidaDoFfmpeg)
}

/*
 * A MESMA conversao para o ffmpeg: uma tabela 3D (.cube) de 65 pontos por
 * canal, aplicada pelo lut3d. Escrita uma vez no temporario; o nome leva a
 * versao, para uma mudanca na conta nao reaproveitar a tabela velha.
 */
const VERSAO_DA_TABELA = 1
let tabela: string | null = null

function caminhoDaTabela(): string {
  if (tabela && existsSync(tabela)) return tabela
  const dir = join(tmpdir(), 'dangai-cor')
  mkdirSync(dir, { recursive: true })
  const alvo = join(dir, `hdr-para-sdr-v${VERSAO_DA_TABELA}.cube`)
  if (!existsSync(alvo)) {
    const N = 65
    const linhas: string[] = ['TITLE "Dangai HDR PQ -> SDR (como o Chrome)"', `LUT_3D_SIZE ${N}`]
    // Ordem do .cube: o R varia mais rapido, depois o G, depois o B.
    for (let bi = 0; bi < N; bi++) {
      for (let gi = 0; gi < N; gi++) {
        for (let ri = 0; ri < N; ri++) {
          const [r, g, b] = pixelHdrParaSdr(ri / (N - 1), gi / (N - 1), bi / (N - 1))
          linhas.push(`${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`)
        }
      }
    }
    const parcial = `${alvo}.part`
    writeFileSync(parcial, linhas.join('\n') + '\n')
    renameSync(parcial, alvo)
  }
  tabela = alvo
  return alvo
}

/** O trecho de filtro do ffmpeg que converte o quadro (termina em RGB). */
export function filtroHdr(): string {
  // Barras normais e o ":" do drive escapado: e o jeito que o parser de filtros
  // do ffmpeg aceita um caminho do Windows.
  const caminho = caminhoDaTabela().replace(/\\/g, '/').replace(/:/g, '\\:')
  return `format=rgb24,lut3d=file='${caminho}':interp=tetrahedral`
}

/** O filtro de video, com a conversao na frente quando o clipe e HDR. */
export function comConversaoHdr(hdr: boolean, filtro: string): string {
  return hdr ? `${filtroHdr()},${filtro}` : filtro
}
