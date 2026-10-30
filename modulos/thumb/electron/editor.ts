import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import sharp from 'sharp'
import type { InferenceSession } from 'onnxruntime-node'
import { ffmpegPath } from '../../../electron/services/ffmpeg-path'
import { modeloPath, upscaleReady } from '../../../electron/services/upscale'
import {
  escolherSugestoes,
  nomeDaThumb,
  type CandidatoDaThumb,
  type CenaDoVideo,
  type PedidoDeQuadro,
  type PedidoDeRecorte,
  type PedidoDeSalvar,
  type QuadroDaThumb,
  type RecorteDaThumb,
  type ResultadoDoSalvar,
  type RostoDaThumb,
  type RostosDoQuadro,
  type SugestaoDaThumb,
  type SugestoesDaThumb,
  LARGURA,
  ALTURA,
} from '../shared/thumb'
import { areaSemBarras } from '../shared/barras'

/**
 * [thumb] O EDITOR DE THUMBNAIL no main, em comum (shared/thumb.ts): tirar o
 * quadro de um arquivo (uma cena, o video pronto ou uma imagem), achar os
 * rostos, recortar cada painel do PNG final com UPSCALE e gravar o PNG. O
 * recap (a aba da tela "Video pronto", modulos/recap/electron/thumb.ts) e o
 * modulo Thumbnail (ipc.ts) criam cada um o seu (criarEditorNoMain), com a
 * pasta de cache e os detectores de rosto deles.
 *
 * - Os quadros ficam em cache na pasta local de quem criou (<pasta>/quadros):
 *   a previa e o PNG final leem o MESMO quadro, em resolucao cheia.
 * - Os rostos: o detector do motor de personagens, se quem criou tiver um (o
 *   YOLO de anime do recap, so detectando, um processo por lote) e, no que ele
 *   nao respondeu, o detector antigo do nucleo, se quem criou quiser.
 *   Guardados por arquivo (rostos.json): repetir nao roda de novo.
 * - O UPSCALE so no PNG final (pedido do Levi): a janela da FONTE que vai
 *   aparecer no painel, ampliada 4x pelo modelo do nucleo
 *   (realesr-animevideov3, o do "Upscale" do render: modeloPath/upscaleReady,
 *   so lidos) e so entao REDUZIDA para o painel (lanczos) -- o painel sai de
 *   uma reducao, nao de um esticamento. Sem o modelo, so o lanczos.
 * - Grava so o PNG pedido, e nunca por cima sem ele dizer.
 */

export const IMAGENS_DA_THUMB = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])

/** Muda junto com o arquivo: mesmo caminho com outro conteudo e outro quadro. */
function impressao(arquivo: string): string {
  const st = statSync(arquivo)
  return `${arquivo.toLowerCase()}|${st.size}|${Math.round(st.mtimeMs)}`
}

function hash(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 24)
}

/** O quadro como PNG pelo stdout do ffmpeg do nucleo. Codigo != 0 lanca; vazio volta vazio. */
function quadroPeloFfmpeg(args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true })
    const pedacos: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => pedacos.push(c))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', (err) => reject(new Error(`FFmpeg nao pode ser executado (${err.message}).`)))
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(pedacos))
        return
      }
      const detalhe = stderr.trim().split('\n').at(-1) ?? `codigo ${code}`
      reject(new Error(`FFmpeg falhou ao tirar o quadro: ${detalhe}`))
    })
  })
}

// ------------------------------------------------------------ os detectores

/** Um rosto como o motor de personagens devolve (pixels do quadro). So `tipo: 'rosto'` conta. */
export interface RostoDoMotorNaThumb {
  x: number
  y: number
  w: number
  h: number
  conf: number
  tipo: string
}

/** O que o motor achou numa imagem (o RostosDoPedaco do recap, so o que a thumb le). */
export interface AchadoDoMotor {
  largura: number
  altura: number
  quadros: readonly { ok: boolean; rostos: readonly RostoDoMotorNaThumb[] }[]
}

/**
 * O detector do motor para varias IMAGENS de uma vez (um processo so): a
 * resposta por imagem, ou null se o motor nao subiu. Nunca lanca.
 */
export type DetectorDoMotor = (imagens: readonly string[]) => Promise<Map<string, AchadoDoMotor> | null>

/** O detector antigo do nucleo (lbpcascade): um rosto por imagem, centro e area em fracao. */
export type DetectorAntigo = (arquivo: string) => Promise<{ centroX: number; centroY: number; area: number } | null>

/** O que o motor achou, so os ROSTOS (a cabeca sem rosto e a nuca de quem esta de costas), em fracao. */
export function rostosDoMotor(achado: AchadoDoMotor): RostoDaThumb[] | null {
  const q = achado.quadros[0]
  if (!q?.ok || !(achado.largura > 0) || !(achado.altura > 0)) return null
  return q.rostos
    .filter((r) => r.tipo === 'rosto')
    .map((r) => ({
      x: r.x / achado.largura,
      y: r.y / achado.altura,
      w: r.w / achado.largura,
      h: r.h / achado.altura,
      conf: Math.max(0, Math.min(1, r.conf)),
    }))
}

/** Um motor por vez (o recap e o modulo juntos): dois lotes nao sobem dois torch juntos. */
let fila: Promise<unknown> = Promise.resolve()
function naFila<T>(f: () => Promise<T>): Promise<T> {
  const vez = fila.then(f, f)
  fila = vez.catch(() => undefined)
  return vez
}

// ------------------------------------------------------- recorte + upscale

let sessao: Promise<InferenceSession> | null = null

function abrirSessao(): Promise<InferenceSession> {
  sessao ??= (async () => {
    // Import dinamico, como o nucleo: o onnxruntime carrega DLLs e custa ~1 s.
    const ort = await import('onnxruntime-node')
    return ort.InferenceSession.create(modeloPath(), {
      executionProviders: ['dml', 'cpu'],
    })
  })().catch((e: unknown) => {
    sessao = null
    throw e
  })
  return sessao
}

/** O modelo esta no lugar (o upscale do nucleo). Falso nos testes sem o configureUpscale. */
export function temUpscale(): boolean {
  try {
    return upscaleReady()
  } catch {
    return false
  }
}

/** Mais que isto de pixels na entrada do modelo: reduz antes (a saida 4x passaria de ~11 MP). */
const ENTRADA_MAX_PX = 700_000
/** So amplia pelo modelo quando o painel pede pelo menos isto a mais que a janela da fonte. */
const AMPLIAR_A_PARTIR = 1.2

/** A mesma conta do rodarModelo do nucleo: RGB 0..1 em planos (NCHW), sai 4x. */
async function ampliar4x(rgb: Buffer, largura: number, altura: number): Promise<{ rgb: Buffer; largura: number; altura: number }> {
  const ort = await import('onnxruntime-node')
  const s = await abrirSessao()
  const plano = largura * altura
  const entrada = new Float32Array(3 * plano)
  for (let i = 0; i < plano; i++) {
    entrada[i] = rgb[i * 3]! / 255
    entrada[plano + i] = rgb[i * 3 + 1]! / 255
    entrada[2 * plano + i] = rgb[i * 3 + 2]! / 255
  }
  const r = await s.run({
    input: new ort.Tensor('float32', entrada, [1, 3, altura, largura]),
  })
  const dados = r.output!.data as Float32Array
  const ow = largura * 4
  const oh = altura * 4
  const n = ow * oh
  const saida = Buffer.allocUnsafe(n * 3)
  const c = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255))
  for (let i = 0; i < n; i++) {
    saida[i * 3] = c(dados[i]!)
    saida[i * 3 + 1] = c(dados[n + i]!)
    saida[i * 3 + 2] = c(dados[2 * n + i]!)
  }
  return { rgb: saida, largura: ow, altura: oh }
}

// ------------------------------------------------- as barras pretas

/**
 * A imagem sem as barras pretas embutidas (letterbox/pillarbox, ver
 * shared/barras.ts), no mesmo formato. null = nao tem barra (use a de entrada).
 */
export async function semBarras(imagem: Buffer | string, formato: 'png' | 'jpeg'): Promise<Buffer | null> {
  const { data, info } = await sharp(imagem).rotate().greyscale().raw().toBuffer({ resolveWithObject: true })
  const a = areaSemBarras(data, info.width, info.height)
  if (a.largura === info.width && a.altura === info.height) return null
  const corte = sharp(imagem).rotate().extract({ left: a.x, top: a.y, width: a.largura, height: a.altura })
  return formato === 'png' ? corte.png().toBuffer() : corte.jpeg({ quality: 85 }).toBuffer()
}

// ------------------------------------------------- fps e quadro rapido

const fpsGuardado = new Map<string, number | null>()

/** Os quadros por segundo do video (o "23.98 fps" que o ffmpeg imprime); null = nao deu. */
export function fpsDoVideo(arquivo: string): Promise<number | null> {
  const k = arquivo.toLowerCase()
  if (fpsGuardado.has(k)) return Promise.resolve(fpsGuardado.get(k) ?? null)
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-i', arquivo], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    const fim = (): void => {
      const m = /Video:.*?(\d+(?:\.\d+)?) fps/.exec(stderr)
      const fps = m ? Number(m[1]) : null
      const valido = fps !== null && fps > 1 && fps < 240 ? fps : null
      fpsGuardado.set(k, valido)
      resolve(valido)
    }
    child.on('error', () => resolve(null))
    child.on('close', fim)
  })
}

/**
 * O QUADRO RAPIDO para o arrastar do "Quadro dentro da cena": um JPEG pequeno
 * (480 px de largura) direto do ffmpeg, sem cache e sem PNG cheio -- so para a
 * previa enquanto ele arrasta. Ao soltar, vale o quadro cheio (quadroDaThumb).
 */
export async function quadroRapido(arquivo: string, t: number): Promise<Uint8Array> {
  if (!existsSync(arquivo)) throw new Error('O arquivo dessa imagem nao esta mais no lugar.')
  if (IMAGENS_DA_THUMB.has(extname(arquivo).toLowerCase())) {
    const jpeg = await sharp(arquivo).rotate().resize({ width: 480 }).jpeg({ quality: 80 }).toBuffer()
    // Sem as barras pretas, como o quadro cheio (o arrastar mostra o mesmo enquadramento).
    return new Uint8Array((await semBarras(jpeg, 'jpeg').catch(() => null)) ?? jpeg)
  }
  const jpeg = await quadroPeloFfmpeg([
    '-ss',
    Math.max(0, t).toFixed(3),
    '-i',
    arquivo,
    '-frames:v',
    '1',
    '-an',
    '-vf',
    'scale=480:-2:flags=bilinear,format=yuvj420p',
    '-q:v',
    '4',
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    '-',
  ])
  if (jpeg.length === 0) throw new Error('Nao deu para tirar o quadro desse video.')
  return new Uint8Array((await semBarras(jpeg, 'jpeg').catch(() => null)) ?? jpeg)
}

// ---------------------------------------------------------------- a fabrica

export interface OpcoesDoEditorNoMain {
  /** A pasta do cache (quadros/ e rostos.json), so desta maquina. Criada na hora. */
  pasta(): string
  /** Prefixo dos avisos no console ('[recap]', '[thumb]'). */
  rotulo: string
  /** O detector do motor de personagens agora (null = sem motor). */
  motor(): DetectorDoMotor | null
  /** O detector antigo do nucleo, no que o motor nao respondeu. null = nao usa (fica sem rosto). */
  antigo: DetectorAntigo | null
}

export interface EditorNoMain {
  quadroEmCache(arquivo: string, t: number): Promise<string>
  /** Uma imagem de fora (o keyframe da biblioteca) sem as barras pretas: ela mesma, ou uma copia cortada no cache. */
  imagemSemBarras(imagem: string): Promise<string>
  quadroDaThumb(p: PedidoDeQuadro): Promise<QuadroDaThumb>
  /** Os rostos de varias IMAGENS: cache, motor (um processo para todas) e o antigo. Nunca lanca. */
  rostosDasImagens(
    imagens: readonly string[],
    motor?: DetectorDoMotor | null,
  ): Promise<{ rostos: Map<string, RostoDaThumb[] | null>; detector: 'motor' | 'antigo' | null }>
  rostosDoQuadro(p: PedidoDeQuadro): Promise<RostosDoQuadro>
  recorteDaThumb(p: PedidoDeRecorte): Promise<RecorteDaThumb>
  /**
   * As sugestoes SEM indice (um projeto qualquer, ou o recap sem a
   * biblioteca): o quadro do meio do trecho de cada cena, com os rostos e a
   * nitidez medida aqui; a escolha e a conta pura (escolherSugestoes).
   */
  sugestoesDasCenas(cenas: readonly CenaDoVideo[], opcoes?: { medirNitidez?: boolean; vagas?: number }): Promise<SugestoesDaThumb>
}

export function criarEditorNoMain(o: OpcoesDoEditorNoMain): EditorNoMain {
  function pastaDaThumb(): string {
    const p = o.pasta()
    mkdirSync(join(p, 'quadros'), { recursive: true })
    return p
  }

  const quadrosEmAndamento = new Map<string, Promise<string>>()

  /**
   * O quadro `t` do arquivo como PNG em resolucao cheia, no cache (o caminho).
   * Imagem: ela mesma (girada pelo EXIF). Video: o ffmpeg; instante depois do
   * fim (o keyframe a 75% de um plano curto) tenta um pouco antes.
   */
  async function quadroEmCache(arquivo: string, t: number): Promise<string> {
    if (!existsSync(arquivo)) throw new Error('O arquivo dessa imagem nao esta mais no lugar.')
    const ehImagem = IMAGENS_DA_THUMB.has(extname(arquivo).toLowerCase())
    // `sb`: o quadro sai sem as barras pretas (os de antes, com barra, ficam para tras no cache).
    const chave = hash(`${impressao(arquivo)}|${ehImagem ? 0 : t.toFixed(3)}|sb`)
    const destino = join(pastaDaThumb(), 'quadros', `${chave}.png`)
    if (existsSync(destino)) return destino
    const ja = quadrosEmAndamento.get(destino)
    if (ja) return ja
    const conta = (async () => {
      let png: Buffer
      if (ehImagem) {
        png = await sharp(arquivo).rotate().png().toBuffer()
      } else {
        png = Buffer.alloc(0)
        for (const instante of [t, Math.max(0, t - 0.5), 0]) {
          png = await quadroPeloFfmpeg(['-ss', instante.toFixed(3), '-i', arquivo, '-frames:v', '1', '-an', '-f', 'image2pipe', '-vcodec', 'png', '-'])
          if (png.length > 0) break
        }
        if (png.length === 0) throw new Error('Nao deu para tirar o quadro desse video.')
      }
      png = (await semBarras(png, 'png').catch(() => null)) ?? png
      const tmp = `${destino}.${process.pid}.tmp`
      writeFileSync(tmp, png)
      renameSync(tmp, destino)
      return destino
    })().finally(() => quadrosEmAndamento.delete(destino))
    quadrosEmAndamento.set(destino, conta)
    return conta
  }

  const semBarrasGuardado = new Map<string, Promise<string>>()

  async function imagemSemBarras(imagem: string): Promise<string> {
    let k: string
    try {
      k = hash(`${impressao(imagem)}|sb`)
    } catch {
      return imagem
    }
    let p = semBarrasGuardado.get(k)
    if (!p) {
      p = (async () => {
        const destino = join(pastaDaThumb(), 'quadros', `${k}.png`)
        if (existsSync(destino)) return destino
        const cortada = await semBarras(imagem, 'png').catch(() => null)
        if (!cortada) return imagem
        const tmp = `${destino}.${process.pid}.tmp`
        writeFileSync(tmp, cortada)
        renameSync(tmp, destino)
        return destino
      })()
      semBarrasGuardado.set(k, p)
      p.catch(() => semBarrasGuardado.delete(k))
    }
    return p
  }

  /** O quadro para a previa: o tamanho de verdade e um JPEG de ate 2048 de lado. */
  async function quadroDaThumb(p: PedidoDeQuadro): Promise<QuadroDaThumb> {
    const caminho = await quadroEmCache(p.arquivo, p.t)
    const meta = await sharp(caminho).metadata()
    const fps = IMAGENS_DA_THUMB.has(extname(p.arquivo).toLowerCase()) ? null : await fpsDoVideo(p.arquivo)
    const previa = await sharp(caminho)
      .resize({
        width: 2048,
        height: 2048,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer()
    return {
      largura: meta.width ?? 1,
      altura: meta.height ?? 1,
      previa: new Uint8Array(previa),
      ...(fps ? { fps } : {}),
    }
  }

  interface RostosGuardados {
    versao: 1
    itens: Record<string, { rostos: RostoDaThumb[]; detector: 'motor' | 'antigo' }>
  }

  function lerRostosGuardados(): RostosGuardados {
    try {
      const j = JSON.parse(readFileSync(join(pastaDaThumb(), 'rostos.json'), 'utf8')) as RostosGuardados
      if (j.versao === 1 && j.itens && typeof j.itens === 'object') return j
    } catch {
      // sem cache
    }
    return { versao: 1, itens: {} }
  }

  function gravarRostosGuardados(g: RostosGuardados): void {
    try {
      const arquivo = join(pastaDaThumb(), 'rostos.json')
      // So os 2000 mais recentes (cada episodio poe ~60).
      const chaves = Object.keys(g.itens)
      for (const k of chaves.slice(0, Math.max(0, chaves.length - 2000))) delete g.itens[k]
      const tmp = `${arquivo}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(g), 'utf8')
      renameSync(tmp, arquivo)
    } catch {
      // cache e conveniencia
    }
  }

  async function rostosDasImagens(
    imagens: readonly string[],
    motor: DetectorDoMotor | null = o.motor(),
  ): Promise<{ rostos: Map<string, RostoDaThumb[] | null>; detector: 'motor' | 'antigo' | null }> {
    const g = lerRostosGuardados()
    const saida = new Map<string, RostoDaThumb[] | null>()
    const chaves = new Map<string, string>()
    let detector: 'motor' | 'antigo' | null = null
    for (const img of new Set(imagens)) {
      let k: string
      try {
        k = hash(impressao(img))
      } catch {
        saida.set(img, null)
        continue
      }
      chaves.set(img, k)
      const ja = g.itens[k]
      if (ja) {
        saida.set(img, ja.rostos)
        detector ??= ja.detector
      }
    }
    const faltam = [...chaves.keys()].filter((img) => !saida.has(img))
    if (faltam.length > 0 && (motor || o.antigo)) {
      if (motor) {
        await naFila(async () => {
          const r = await motor(faltam).catch(() => null)
          for (const arquivo of faltam) {
            const achado = r?.get(arquivo)
            const rostos = achado ? rostosDoMotor(achado) : null
            if (rostos) {
              saida.set(arquivo, rostos)
              g.itens[chaves.get(arquivo)!] = { rostos, detector: 'motor' }
              detector = 'motor'
            }
          }
        })
      }
      // Sem motor (ou o que ele nao respondeu): o detector antigo do nucleo, um rosto por imagem.
      for (const arquivo of o.antigo ? faltam.filter((f) => !saida.has(f)) : []) {
        const achado = await o.antigo!(arquivo).catch(() => undefined)
        if (achado === undefined) {
          saida.set(arquivo, null)
          continue
        }
        let rostos: RostoDaThumb[] = []
        if (achado) {
          const meta = await sharp(arquivo)
            .metadata()
            .catch(() => null)
          const iw = meta?.width ?? 1
          const ih = meta?.height ?? 1
          const lado = Math.sqrt(Math.max(0, achado.area) * iw * ih)
          const w = lado / iw
          const h = lado / ih
          rostos = [
            {
              x: achado.centroX - w / 2,
              y: achado.centroY - h / 2,
              w,
              h,
              conf: 0.6,
            },
          ]
        }
        saida.set(arquivo, rostos)
        g.itens[chaves.get(arquivo)!] = { rostos, detector: 'antigo' }
        detector ??= 'antigo'
      }
      gravarRostosGuardados(g)
    }
    // Sem detector nenhum: quem faltou fica null (o enquadramento vai ao meio).
    for (const arquivo of faltam) if (!saida.has(arquivo)) saida.set(arquivo, null)
    return { rostos: saida, detector }
  }

  async function rostosDoQuadro(p: PedidoDeQuadro): Promise<RostosDoQuadro> {
    const caminho = await quadroEmCache(p.arquivo, p.t)
    const r = await rostosDasImagens([caminho])
    return { rostos: r.rostos.get(caminho) ?? [], detector: r.detector }
  }

  /**
   * Um painel do PNG final: a janela da fonte recortada do quadro em cache,
   * ampliada 4x pelo modelo quando o painel e maior que ela (e o modelo
   * existe), e reduzida (lanczos) para o tamanho exato do painel.
   */
  async function recorteDaThumb(p: PedidoDeRecorte): Promise<RecorteDaThumb> {
    const inicio = Date.now()
    const caminho = await quadroEmCache(p.arquivo, p.t)
    const meta = await sharp(caminho).metadata()
    const iw = meta.width ?? 1
    const ih = meta.height ?? 1
    const left = Math.max(0, Math.min(iw - 1, Math.floor(p.sx)))
    const top = Math.max(0, Math.min(ih - 1, Math.floor(p.sy)))
    const width = Math.max(1, Math.min(iw - left, Math.round(p.sw)))
    const height = Math.max(1, Math.min(ih - top, Math.round(p.sh)))
    const fator = Math.max(p.largura / width, p.altura / height)
    let fonte = sharp(caminho).extract({ left, top, width, height }).removeAlpha()
    let ampliado = false
    if (fator >= AMPLIAR_A_PARTIR && temUpscale()) {
      try {
        let w = width
        let h = height
        if (w * h > ENTRADA_MAX_PX) {
          const k = Math.sqrt(ENTRADA_MAX_PX / (w * h))
          w = Math.max(1, Math.round(w * k))
          h = Math.max(1, Math.round(h * k))
          fonte = fonte.resize(w, h, { kernel: 'lanczos3', fit: 'fill' })
        }
        const cru = await fonte.raw().toBuffer({ resolveWithObject: true })
        const grande = await ampliar4x(cru.data, cru.info.width, cru.info.height)
        fonte = sharp(grande.rgb, {
          raw: { width: grande.largura, height: grande.altura, channels: 3 },
        })
        ampliado = true
      } catch (e) {
        console.warn(`${o.rotulo} thumb: upscale falhou, vai so o lanczos:`, e instanceof Error ? e.message : e)
        fonte = sharp(caminho).extract({ left, top, width, height }).removeAlpha()
      }
    }
    const png = await fonte.resize(p.largura, p.altura, { kernel: 'lanczos3', fit: 'fill' }).png({ compressionLevel: 6 }).toBuffer()
    return { png: new Uint8Array(png), ampliado, ms: Date.now() - inicio }
  }

  async function sugestoesDasCenas(
    cenas: readonly CenaDoVideo[],
    opcoes: { medirNitidez?: boolean; vagas?: number } = {},
  ): Promise<SugestoesDaThumb> {
    interface Item {
      cand: CandidatoDaThumb
      imagem: string | null
      arquivo: string
      t: number
      rotulo: string
      trecho: { de: number; ate: number }
    }
    const itens = new Map<string, Item>()
    for (const cena of cenas) {
      if (!existsSync(cena.arquivo)) continue
      const t = cena.de + Math.max(0, cena.ate - cena.de) / 2
      const chave = `${cena.arquivo.replace(/\//g, '\\').toLowerCase()}|${t.toFixed(2)}`
      const ja = itens.get(chave)
      if (ja) {
        ja.cand = { ...ja.cand, gancho: ja.cand.gancho || cena.gancho, ordem: Math.min(ja.cand.ordem, cena.ordem) }
        continue
      }
      const nome = cena.arquivo.split(/[\\/]/).pop() ?? ''
      itens.set(chave, {
        cand: {
          chave,
          plano: chave,
          ordem: cena.ordem,
          gancho: cena.gancho,
          rostos: null,
          beleza: null,
          nitidez: null,
          expressao: false,
          noTrecho: true,
        },
        imagem: null,
        arquivo: cena.arquivo,
        t,
        rotulo: nome.replace(/\.[^.]+$/, ''),
        trecho: { de: cena.de, ate: cena.ate },
      })
    }
    for (const it of itens.values()) {
      try {
        it.imagem = await quadroEmCache(it.arquivo, it.t)
      } catch {
        it.imagem = null
      }
    }
    const lista = [...itens.values()].filter((it) => it.imagem)
    if (opcoes.medirNitidez) {
      for (const it of lista) it.cand = { ...it.cand, nitidez: await nitidezDaImagem(it.imagem!) }
    }
    const achados = await rostosDasImagens(lista.map((it) => it.imagem!))
    for (const it of lista) it.cand = { ...it.cand, rostos: achados.rostos.get(it.imagem!) ?? null }
    const escolhidas = escolherSugestoes(
      lista.map((it) => it.cand),
      opcoes.vagas,
    )
    const porChave = new Map(lista.map((it) => [it.cand.chave, it]))
    const sugestoes: SugestaoDaThumb[] = []
    for (const e of escolhidas) {
      const it = porChave.get(e.candidato.chave)
      if (!it?.imagem) continue
      try {
        sugestoes.push(await sugestaoDe(it.imagem, it.arquivo, it.t, e.candidato, e.nota, it.rotulo, it.trecho))
      } catch {
        continue
      }
    }
    return { sugestoes, detector: achados.detector }
  }

  return { quadroEmCache, imagemSemBarras, quadroDaThumb, rostosDasImagens, rostosDoQuadro, recorteDaThumb, sugestoesDasCenas }
}

/** Uma sugestao pronta para a tela: o tamanho de verdade e a miniatura (JPEG pequeno). */
export async function sugestaoDe(
  imagem: string,
  arquivo: string,
  t: number,
  candidato: CandidatoDaThumb,
  nota: number,
  rotulo: string,
  trecho?: { de: number; ate: number },
): Promise<SugestaoDaThumb> {
  const meta = await sharp(imagem).metadata()
  const miniatura = await sharp(imagem).resize({ width: 400, height: 400, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer()
  return {
    arquivo,
    t,
    largura: meta.width ?? 1,
    altura: meta.height ?? 1,
    rostos: candidato.rostos ? [...candidato.rostos] : null,
    gancho: candidato.gancho,
    nota,
    ordem: candidato.ordem,
    miniatura: new Uint8Array(miniatura),
    ...(trecho ? { trecho } : {}),
    rotulo,
  }
}

/**
 * A NITIDEZ de uma imagem para as sugestoes sem o passo 4: a variancia do
 * laplaciano da imagem em cinza, reduzida a 320 px de largura (o mesmo
 * tamanho para todas: a medida compara quadros de tamanhos diferentes).
 * Quadro borrado (movimento, transicao) da baixo. null = nao deu para medir.
 */
export async function nitidezDaImagem(imagem: string): Promise<number | null> {
  try {
    const r = await sharp(imagem)
      .resize({ width: 320, withoutEnlargement: false })
      .greyscale()
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
      .stats()
    const d = r.channels[0]?.stdev
    return typeof d === 'number' && Number.isFinite(d) ? d * d : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------- o upload

/**
 * A imagem que ele escolheu no PC vai para `<pasta do projeto>/thumb/`: o
 * projeto guarda esse caminho e nao quebra se a de fora mudar de lugar. A
 * mesma imagem de novo (mesmo nome e mesmo conteudo) reaproveita a copia;
 * outra de mesmo nome ganha "-2", "-3"... Sem pasta (projeto nunca salvo,
 * editor solto) ou pasta que sumiu: o caminho original.
 */
export function copiarParaOProjeto(origem: string, pasta: string | null): string {
  if (!pasta || !existsSync(pasta)) return origem
  const destinoDir = join(pasta, 'thumb')
  // Ja esta dentro da pasta da thumb do projeto.
  if (dirname(origem).toLowerCase() === destinoDir.toLowerCase()) return origem
  mkdirSync(destinoDir, { recursive: true })
  const bytes = readFileSync(origem)
  const nome = origem.split(/[\\/]/).pop() ?? 'imagem.png'
  const ponto = nome.lastIndexOf('.')
  const base = ponto > 0 ? nome.slice(0, ponto) : nome
  const ext = ponto > 0 ? nome.slice(ponto) : ''
  for (let n = 1; n < 1000; n++) {
    const destino = join(destinoDir, n === 1 ? nome : `${base}-${n}${ext}`)
    if (!existsSync(destino)) {
      writeFileSync(destino, bytes)
      return destino
    }
    try {
      if (statSync(destino).size === bytes.length && readFileSync(destino).equals(bytes)) return destino
    } catch {
      continue
    }
  }
  return origem
}

// -------------------------------------------------------------- o salvar

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Os bytes so se forem um PNG de 1080x1920 (o que a tela desenhou); senao lanca. */
async function pngConferido(png: Uint8Array): Promise<Buffer> {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  if (bytes.length < 8 || ASSINATURA_PNG.some((b, i) => bytes[i] !== b)) throw new Error('A thumb nao saiu como PNG.')
  const meta = await sharp(bytes).metadata()
  if (meta.width !== LARGURA || meta.height !== ALTURA) throw new Error(`A thumb saiu ${meta.width}x${meta.height}, e nao ${LARGURA}x${ALTURA}.`)
  return bytes
}

function gravarJunto(destino: string, bytes: Buffer): void {
  const tmp = `${destino}.${process.pid}.tmp`
  writeFileSync(tmp, bytes)
  renameSync(tmp, destino)
}

/**
 * Grava o PNG 1080x1920 ao lado do video (`<video>-thumb.png`). 'perguntar'
 * nunca sobrescreve: devolve `existe` para a tela perguntar; 'novo' acha o
 * proximo nome livre (-thumb-2.png...).
 */
export async function salvarThumb(p: PedidoDeSalvar): Promise<ResultadoDoSalvar> {
  const bytes = await pngConferido(p.png)
  const pasta = dirname(p.video)
  if (!existsSync(pasta)) throw new Error('A pasta do video nao existe mais.')
  let destino = nomeDaThumb(p.video)
  if (existsSync(destino)) {
    if (p.modo === 'perguntar') return { existe: destino }
    if (p.modo === 'novo') {
      let n = 2
      while (existsSync(nomeDaThumb(p.video, n)) && n < 1000) n += 1
      destino = nomeDaThumb(p.video, n)
    }
  }
  gravarJunto(destino, bytes)
  return { salvo: destino }
}

/**
 * Grava o PNG onde ele escolheu no dialogo de salvar (que ja perguntou se
 * pode substituir). So .png, e a pasta tem que existir.
 */
export async function salvarPngEm(destino: string, png: Uint8Array): Promise<string> {
  const bytes = await pngConferido(png)
  if (extname(destino).toLowerCase() !== '.png') throw new Error('A thumb so sai em .png.')
  if (!existsSync(dirname(destino))) throw new Error('Essa pasta nao existe mais.')
  gravarJunto(destino, bytes)
  return destino
}

// ------------------------------------------------------- o projeto

/** As cenas espalhadas pelo video inteiro, ate `max`. */
export function espalhar<T>(lista: readonly T[], max: number): T[] {
  if (lista.length <= max) return [...lista]
  const passo = lista.length / max
  return Array.from({ length: max }, (_, i) => lista[Math.floor(i * passo)]!)
}

/**
 * O video do projeto: o ultimo render desta sessao, ou o mais novo
 * `<narracao>-short*.mp4` ao lado da narracao (o nome que o render do
 * nucleo usa). null = nunca renderizou.
 */
export function videoDoProjeto(audio: string | null, ultimo: string | null): string | null {
  if (ultimo && existsSync(ultimo)) return ultimo
  if (!audio) return null
  const pasta = dirname(audio)
  const tronco = basename(audio, extname(audio)).toLowerCase()
  const doRender = (nome: string): boolean => {
    const n = nome.toLowerCase()
    return n.startsWith(`${tronco}-short`) && /^(-\d+)?\.mp4$/.test(n.slice(tronco.length + '-short'.length))
  }
  let melhor: { caminho: string; em: number } | null = null
  try {
    for (const nome of readdirSync(pasta)) {
      if (!doRender(nome)) continue
      const caminho = join(pasta, nome)
      const em = statSync(caminho).mtimeMs
      if (!melhor || em > melhor.em) melhor = { caminho, em }
    }
  } catch {
    return null
  }
  return melhor?.caminho ?? null
}
