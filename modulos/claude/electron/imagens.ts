import { spawn } from 'node:child_process'
import sharp, { type OverlayOptions } from 'sharp'
import { ffmpegPath } from '../../../electron/services/ffmpeg-path'

/**
 * [claude] O QUE O CLAUDE VE: folhas JPEG com o recorte 9:16 como o Dangai
 * mostra (as contas sao as do folha-final.py da skill), e a medida de sons e
 * imagens para o "editar".
 */

const LARG = 120
const ALT = 213

function rodar(args: string[], teto = 30_000): Promise<{ saida: Buffer; erro: string; codigo: number | null }> {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, args, { windowsHide: true })
    const saida: Buffer[] = []
    let erro = ''
    const t = setTimeout(() => p.kill(), teto)
    p.stdout.on('data', (b: Buffer) => saida.push(b))
    p.stderr.on('data', (b: Buffer) => (erro += b.toString()))
    p.on('error', (e) => {
      clearTimeout(t)
      resolve({ saida: Buffer.alloc(0), erro: String(e), codigo: -1 })
    })
    p.on('close', (codigo) => {
      clearTimeout(t)
      resolve({ saida: Buffer.concat(saida), erro, codigo })
    })
  })
}

/** Duracao (s) e tamanho, pelo `ffmpeg -i` (o Dangai nao embarca ffprobe). */
export async function sondar(caminho: string): Promise<{ duracao: number | null; largura: number | null; altura: number | null }> {
  const { erro } = await rodar(['-hide_banner', '-i', caminho])
  const d = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(erro)
  const v = erro
    .split('\n')
    .filter((l) => /Stream #.*Video:/.test(l) && !/attached pic/i.test(l))
    .map((l) => /,\s(\d{2,5})x(\d{2,5})[\s,]/.exec(l))
    .find((m) => m !== null)
  return {
    duracao: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
    largura: v ? Number(v[1]) : null,
    altura: v ? Number(v[2]) : null,
  }
}

/** Aspecto (largura/altura) de uma imagem ou video. */
export async function aspectoDe(caminho: string): Promise<number | null> {
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(caminho)) {
    try {
      const m = await sharp(caminho).metadata()
      if (m.width && m.height) return m.width / m.height
    } catch {
      /* cai no ffmpeg */
    }
  }
  const s = await sondar(caminho)
  return s.largura && s.altura ? s.largura / s.altura : null
}

/**
 * Um quadro no recorte 9:16: `cx` = centro da janela em fracao da largura,
 * `zoom` = quanto amplia dentro da janela. Preto se o ffmpeg nao achou o quadro.
 */
async function quadro(caminho: string, t: number, cx: number, zoom: number, ox = 0.5, oy = 0.5): Promise<Buffer> {
  const z = Math.max(1, zoom)
  const filtro =
    `scale=-2:540,crop=w='trunc(ih*9/16/2)*2':h=ih:x='max(0,min(iw-ih*9/16,${cx.toFixed(4)}*iw-ih*9/32))':y=0,` +
    `crop=w='trunc(iw/${z.toFixed(4)}/2)*2':h='trunc(ih/${z.toFixed(4)}/2)*2':x='(iw-ow)*${ox.toFixed(3)}':y='(ih-oh)*${oy.toFixed(3)}',scale=${LARG}:${ALT}`
  for (let k = 0; k < 4; k++) {
    const ss = Math.max(0, t - 0.15 * k)
    const r = await rodar(['-v', 'error', '-ss', ss.toFixed(3), '-i', caminho, '-frames:v', '1', '-vf', filtro, '-f', 'image2pipe', '-vcodec', 'png', '-'])
    if (r.saida.length > 0) return r.saida
  }
  return sharp({ create: { width: LARG, height: ALT, channels: 3, background: '#000' } }).png().toBuffer()
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export interface Ladrilho {
  /** Os quadros, da esquerda para a direita. */
  quadros: { caminho: string; t: number; cx: number; zoom: number; ox?: number; oy?: number }[]
  rotulo: string
}

/** Uma folha com os ladrilhos em grade. Devolve JPEG em base64. */
export async function folha(ladrilhos: Ladrilho[], colunas: number): Promise<string> {
  const porLadrilho = Math.max(...ladrilhos.map((l) => l.quadros.length))
  const lw = porLadrilho * (LARG + 3) - 3
  const lh = ALT + 18
  const linhas = Math.ceil(ladrilhos.length / colunas)
  const W = colunas * (lw + 8) - 8
  const H = linhas * (lh + 8) - 8
  const camadas: OverlayOptions[] = []
  // Poucos ffmpeg de cada vez: a folha inteira em ~1-3 s sem travar o PC.
  const tarefas = ladrilhos.flatMap((l, i) => l.quadros.map((q, j) => ({ i, j, q })))
  const prontos: Buffer[] = new Array(tarefas.length)
  let proxima = 0
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (proxima < tarefas.length) {
        const k = proxima++
        const { q } = tarefas[k]!
        prontos[k] = await quadro(q.caminho, q.t, q.cx, q.zoom, q.ox, q.oy)
      }
    }),
  )
  tarefas.forEach(({ i, j }, k) => {
    const x = (i % colunas) * (lw + 8) + j * (LARG + 3)
    const y = Math.floor(i / colunas) * (lh + 8)
    camadas.push({ input: prontos[k]!, left: x, top: y })
  })
  ladrilhos.forEach((l, i) => {
    const x = (i % colunas) * (lw + 8)
    const y = Math.floor(i / colunas) * (lh + 8) + ALT
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lw}" height="18"><text x="2" y="14" font-family="Arial" font-weight="bold" font-size="13" fill="#fff">${esc(l.rotulo)}</text></svg>`
    camadas.push({ input: Buffer.from(svg), left: x, top: y })
  })
  const jpg = await sharp({ create: { width: W, height: H, channels: 3, background: '#141414' } })
    .composite(camadas)
    .jpeg({ quality: 82 })
    .toBuffer()
  return jpg.toString('base64')
}

/** O centro e o zoom da janela 9:16 de uma cena no comeco (fr=0) ou no fim (fr=1). */
export function janelaDaCena(cena: Record<string, unknown>, focoX: number, fr: 0 | 1): { cx: number; zoom: number; ox: number; oy: number } {
  const cam = cena['camera'] as { from?: { x: number; scale: number }; to?: { x: number; scale: number } } | null | undefined
  const fixo = typeof cena['escala'] === 'number' ? Math.max(1, cena['escala']) : 1
  const o = (cena['escalaOrigem'] as { x?: number; y?: number } | undefined) ?? {}
  const ox = fixo > 1 ? (o.x ?? 0.5) : 0.5
  const oy = fixo > 1 ? (o.y ?? 0.5) : 0.5
  if (cam?.from && cam.to) {
    const c = fr === 0 ? cam.from : cam.to
    return { cx: 0.5 - c.x / 100, zoom: c.scale * fixo, ox, oy }
  }
  const e = cena['effect']
  const i = typeof cena['intensity'] === 'number' ? cena['intensity'] : 0.1
  const zoom = e === 'zoom-in' ? 1 + i * fr : e === 'zoom-out' ? 1 + i * (1 - fr) : 1 + i
  return { cx: 0.158 + focoX * 0.684, zoom: zoom * fixo, ox, oy }
}

/**
 * As folhas do RECONHECER PERSONAGENS: uma linha por grupo (key, cenas, palpite e
 * ate 8 rostos) e a do elenco (foto + nome). Rostos em base64 (vem da janela).
 * Devolve JPEGs em base64: ate 14 grupos por folha, para caber na leitura.
 */
export async function folhasDoReconhecer(
  grupos: { key: number; cenas: number; rostos: string[]; conhecido: boolean; figurante: boolean; palpite: string | null }[],
  elenco: { nome: string; foto: string | null }[],
): Promise<string[]> {
  const T = 96
  const ROTULO = 250
  const POR_FOLHA = 14
  const txt = (w: number, h: number, linhas: { t: string; cor: string }[]): Buffer =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${linhas
        .map((l, i) => `<text x="4" y="${18 + i * 20}" font-family="Arial" font-weight="bold" font-size="15" fill="${l.cor}">${esc(l.t)}</text>`)
        .join('')}</svg>`,
    )
  const rosto = async (b64: string, lado: number): Promise<Buffer | null> => {
    try {
      return await sharp(Buffer.from(b64, 'base64')).resize(lado, lado, { fit: 'cover' }).jpeg().toBuffer()
    } catch {
      return null
    }
  }
  const saida: string[] = []
  for (let n = 0; n < grupos.length; n += POR_FOLHA) {
    const lote = grupos.slice(n, n + POR_FOLHA)
    const W = ROTULO + 8 * (T + 3)
    const H = lote.length * (T + 6)
    const camadas: OverlayOptions[] = []
    for (const [r, g] of lote.entries()) {
      const y = r * (T + 6)
      camadas.push({
        input: txt(ROTULO, T, [
          { t: `g${g.key} - ${g.cenas} cenas${g.figurante ? ' (figurante)' : ''}`, cor: '#ffd400' },
          { t: g.conhecido ? `JA TEM NOME: ${g.palpite ?? ''}`.slice(0, 30) : `palpite: ${g.palpite ?? '-'}`.slice(0, 30), cor: '#ffffff' },
        ]),
        left: 0,
        top: y,
      })
      for (const [i, b] of g.rostos.slice(0, 8).entries()) {
        const img = await rosto(b, T)
        if (img) camadas.push({ input: img, left: ROTULO + i * (T + 3), top: y })
      }
    }
    const jpg = await sharp({ create: { width: W, height: Math.max(H, 1), channels: 3, background: '#121212' } }).composite(camadas).jpeg({ quality: 82 }).toBuffer()
    saida.push(jpg.toString('base64'))
  }
  if (elenco.length) {
    const C = 8
    const L = 130
    const W = C * L
    const H = Math.ceil(elenco.length / C) * (L + 22)
    const camadas: OverlayOptions[] = []
    for (const [k, e] of elenco.entries()) {
      const x = (k % C) * L
      const y = Math.floor(k / C) * (L + 22)
      const img = e.foto ? await rosto(e.foto, L - 8) : null
      if (img) camadas.push({ input: img, left: x + 4, top: y })
      camadas.push({ input: txt(L, 22, [{ t: e.nome.slice(0, 18), cor: '#ffffff' }]), left: x, top: y + L - 4 })
    }
    const jpg = await sharp({ create: { width: W, height: H, channels: 3, background: '#121212' } }).composite(camadas).jpeg({ quality: 82 }).toBuffer()
    saida.push(jpg.toString('base64'))
  }
  return saida
}

/**
 * VER VARIOS: uma folha com o quadro INTEIRO (16:9) de varios clipes, para
 * escolher por expressao/acao entre muitos candidatos (a "cara de bravo" entre
 * 40 cenas do personagem). `momento` 0..1 = onde no clipe (0,5 = o meio).
 * Rotulo = o numero na lista + o nome do arquivo.
 */
export async function folhaDeVarios(caminhos: readonly string[], momento: number, duracoes: readonly (number | null)[]): Promise<string> {
  const W = 256
  const H = 144
  const C = Math.min(6, caminhos.length)
  const linhas = Math.ceil(caminhos.length / C)
  const prontos: (Buffer | null)[] = new Array(caminhos.length).fill(null)
  let proxima = 0
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (proxima < caminhos.length) {
        const k = proxima++
        const d = duracoes[k] ?? 1
        const t = Math.max(0, Math.min(d - 0.05, d * momento))
        const r = await rodar(['-v', 'error', '-ss', t.toFixed(3), '-i', caminhos[k]!, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'image2pipe', '-vcodec', 'png', '-'])
        prontos[k] = r.saida.length ? r.saida : null
      }
    }),
  )
  const camadas: OverlayOptions[] = []
  caminhos.forEach((c, k) => {
    const x = (k % C) * (W + 6)
    const y = Math.floor(k / C) * (H + 24)
    const img = prontos[k]
    if (img) camadas.push({ input: img, left: x, top: y })
    const nome = c.split(/[\/]/).slice(-3).join('/').replace(/\.mp4$/i, '')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="22"><text x="2" y="16" font-family="Arial" font-weight="bold" font-size="13" fill="#ffd400">${k + 1}</text><text x="26" y="16" font-family="Arial" font-size="12" fill="#fff">${esc(nome.slice(-30))}</text></svg>`
    camadas.push({ input: Buffer.from(svg), left: x, top: y + H + 1 })
  })
  const jpg = await sharp({ create: { width: C * (W + 6) - 6, height: linhas * (H + 24), channels: 3, background: '#141414' } })
    .composite(camadas)
    .jpeg({ quality: 82 })
    .toBuffer()
  return jpg.toString('base64')
}
