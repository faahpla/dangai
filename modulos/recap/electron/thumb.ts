import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import sharp from 'sharp'
import type { InferenceSession } from 'onnxruntime-node'
import { modeloPath, upscaleReady } from '../../../electron/services/upscale'
import type { EpisodeIndex, Plano } from '../shared/episodio'
import {
  escolherSugestoes,
  nomeDaThumb,
  TAGS_DE_EXPRESSAO,
  type CandidatoDaThumb,
  type PedidoDeQuadro,
  type PedidoDeRecorte,
  type PedidoDeSalvar,
  type PedidoDeSugestoes,
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
import { normalizarTag } from '../shared/visao'
import { rostoNosInstantes } from './assets'
import { sinaisDoEpisodio } from './cenas/visao'
import { contexto } from './contexto'
import { abrirIndicePorId } from './episodio/abrir-indice'
import { lerRascunhoDoDisco } from './gerar/rascunho'
import { rodarMotorDeRostos, type RostosDoPedaco } from './montar/rostos-motor'
import { rodarFfmpeg } from './voz/ffmpeg'

/**
 * [recap] O GERADOR DE THUMBNAIL, no main (shared/thumb.ts): tirar o quadro
 * de um arquivo (a cena do episodio, o video pronto ou a imagem dele), achar
 * os rostos, sugerir os quadros das cenas que entraram no video, recortar
 * cada painel do PNG final com UPSCALE e gravar o PNG ao lado do video.
 *
 * - Os quadros ficam em cache no perfil local do modulo (<local>/thumb): a
 *   previa e o PNG final leem o MESMO quadro, em resolucao cheia.
 * - Os rostos: o YOLO de rosto de anime do motor (o mesmo da Edicao rapida,
 *   so detectando, um processo por lote); sem motor, o detector antigo do
 *   nucleo. Guardados por arquivo (rostos.json): repetir nao roda de novo.
 * - O UPSCALE so no PNG final (pedido do Levi): a janela da FONTE que vai
 *   aparecer no painel, ampliada 4x pelo modelo do nucleo
 *   (realesr-animevideov3, o do "Upscale" do render: modeloPath/upscaleReady)
 *   e so entao REDUZIDA para o painel (lanczos) -- o painel sai de uma
 *   reducao, nao de um esticamento. Sem o modelo, so o lanczos.
 * - Grava so o `<video>-thumb.png`, na pasta do video, e nunca por cima sem
 *   ele dizer (modo 'perguntar').
 */

const IMAGENS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])

function pastaDaThumb(): string {
  const p = join(contexto().pasta('local'), 'thumb')
  mkdirSync(join(p, 'quadros'), { recursive: true })
  return p
}

/** Muda junto com o arquivo: mesmo caminho com outro conteudo e outro quadro. */
function impressao(arquivo: string): string {
  const st = statSync(arquivo)
  return `${arquivo.toLowerCase()}|${st.size}|${Math.round(st.mtimeMs)}`
}

function hash(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 24)
}

// ------------------------------------------------------------- os quadros

const quadrosEmAndamento = new Map<string, Promise<string>>()

/**
 * O quadro `t` do arquivo como PNG em resolucao cheia, no cache (o caminho).
 * Imagem: ela mesma (girada pelo EXIF). Video: o ffmpeg; instante depois do
 * fim (o keyframe a 75% de um plano curto) tenta um pouco antes.
 */
export async function quadroEmCache(arquivo: string, t: number): Promise<string> {
  if (!existsSync(arquivo)) throw new Error('O arquivo dessa imagem nao esta mais no lugar.')
  const ehImagem = IMAGENS.has(extname(arquivo).toLowerCase())
  const chave = hash(`${impressao(arquivo)}|${ehImagem ? 0 : t.toFixed(3)}`)
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
        png = await rodarFfmpeg(['-ss', instante.toFixed(3), '-i', arquivo, '-frames:v', '1', '-an', '-f', 'image2pipe', '-vcodec', 'png', '-'])
        if (png.length > 0) break
      }
      if (png.length === 0) throw new Error('Nao deu para tirar o quadro desse video.')
    }
    const tmp = `${destino}.${process.pid}.tmp`
    writeFileSync(tmp, png)
    renameSync(tmp, destino)
    return destino
  })().finally(() => quadrosEmAndamento.delete(destino))
  quadrosEmAndamento.set(destino, conta)
  return conta
}

/** O quadro para a previa: o tamanho de verdade e um JPEG de ate 2048 de lado. */
export async function quadroDaThumb(p: PedidoDeQuadro): Promise<QuadroDaThumb> {
  const caminho = await quadroEmCache(p.arquivo, p.t)
  const meta = await sharp(caminho).metadata()
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
  }
}

// -------------------------------------------------------------- os rostos

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

/** O que o motor achou, so os ROSTOS (a cabeca sem rosto e a nuca de quem esta de costas), em fracao. */
export function rostosDoMotor(achado: RostosDoPedaco): RostoDaThumb[] | null {
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

/** Um motor por vez: o lote das sugestoes e o rosto de um quadro escolhido nao sobem dois torch juntos. */
let fila: Promise<unknown> = Promise.resolve()
function naFila<T>(f: () => Promise<T>): Promise<T> {
  const vez = fila.then(f, f)
  fila = vez.catch(() => undefined)
  return vez
}

/** Teto do motor por lote (subir o torch custa ~8 s; 60 imagens, ~20 s). */
const TETO_DO_MOTOR_MS = 120_000

/**
 * Os rostos de varias IMAGENS (arquivos de imagem), pelo cache, pelo motor
 * (um processo para todas) e, no que ele nao respondeu, pelo detector antigo.
 * Nunca lanca: imagem sem resposta fica null.
 */
export async function rostosDasImagens(
  imagens: readonly string[],
  rodar: typeof rodarMotorDeRostos = rodarMotorDeRostos,
): Promise<{
  rostos: Map<string, RostoDaThumb[] | null>
  detector: 'motor' | 'antigo' | null
}> {
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
  if (faltam.length > 0) {
    await naFila(async () => {
      const itens = faltam.map((arquivo, i) => ({
        chave: `i${i}`,
        arquivo,
        instantes: [0],
        personagens: [],
        candidatos: [],
      }))
      const r = await rodar(itens, { anime: null, temporada: null, identificar: false, aspecto: null }, TETO_DO_MOTOR_MS).catch(() => null)
      faltam.forEach((arquivo, i) => {
        const achado = r?.resultados.get(`i${i}`)
        const rostos = achado ? rostosDoMotor(achado) : null
        if (rostos) {
          saida.set(arquivo, rostos)
          g.itens[chaves.get(arquivo)!] = { rostos, detector: 'motor' }
          detector = 'motor'
        }
      })
    })
    // Sem motor (ou o que ele nao respondeu): o detector antigo do nucleo, um rosto por imagem.
    for (const arquivo of faltam.filter((f) => !saida.has(f))) {
      const achado = await rostoNosInstantes(arquivo, [0])
        .then((a) => a[0] ?? null)
        .catch(() => undefined)
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
  return { rostos: saida, detector }
}

export async function rostosDoQuadro(p: PedidoDeQuadro): Promise<RostosDoQuadro> {
  const caminho = await quadroEmCache(p.arquivo, p.t)
  const r = await rostosDasImagens([caminho])
  return { rostos: r.rostos.get(caminho) ?? [], detector: r.detector }
}

// ----------------------------------------------------------- as sugestoes

const normal = (c: string): string => c.replace(/\//g, '\\').toLowerCase()

function abrirIndice(p: PedidoDeSugestoes): { indice: EpisodeIndex; caminho: string } | null {
  if (!p.episodioId) return null
  let dica: string | null = null
  if (p.rascunhoId) {
    try {
      dica = lerRascunhoDoDisco(p.rascunhoId).indicePath
    } catch {
      dica = null
    }
  }
  try {
    const a = abrirIndicePorId(p.episodioId, dica)
    return { indice: a.indice, caminho: a.caminho }
  } catch {
    return null
  }
}

/**
 * AS SUGESTOES: os keyframes (25/50/75%) das cenas que entraram no video,
 * com a beleza e a nitidez do passo 4 (visao.json) e as etiquetas de
 * expressao do plano; os rostos de todos num lote so do motor. A escolha e a
 * conta pura (escolherSugestoes): o gancho primeiro, depois close, expressao,
 * nitidez. Cena sem indice (projeto normal, biblioteca sumida): o quadro do
 * meio do trecho mostrado.
 */
export async function sugestoesDaThumb(p: PedidoDeSugestoes, rodar: typeof rodarMotorDeRostos = rodarMotorDeRostos): Promise<SugestoesDaThumb> {
  const aberto = abrirIndice(p)
  const planos = new Map<string, Plano>()
  for (const pl of aberto?.indice.planos ?? []) planos.set(normal(pl.arquivo), pl)
  const sinais = aberto ? sinaisDoEpisodio(aberto.indice, aberto.caminho) : {}

  interface Item {
    cand: CandidatoDaThumb
    /** A imagem para achar o rosto e fazer a miniatura. */
    imagem: string | null
    arquivo: string
    t: number
    rotulo: string
  }
  const itens = new Map<string, Item>()
  const juntar = (it: Item): void => {
    const ja = itens.get(it.cand.chave)
    if (!ja) {
      itens.set(it.cand.chave, it)
      return
    }
    ja.cand = {
      ...ja.cand,
      gancho: ja.cand.gancho || it.cand.gancho,
      ordem: Math.min(ja.cand.ordem, it.cand.ordem),
      noTrecho: ja.cand.noTrecho || it.cand.noTrecho,
    }
  }
  for (const cena of p.cenas) {
    if (!existsSync(cena.arquivo)) continue
    const plano = planos.get(normal(cena.arquivo))
    const quadros = plano ? (sinais.quadros?.get(plano.id) ?? []) : []
    const tags = plano ? (sinais.tagsDoPlano?.get(plano.id) ?? []) : []
    const expressao = tags.slice(0, 40).some((t) => TAGS_DE_EXPRESSAO.has(normalizarTag(t)))
    if (plano && quadros.length > 0) {
      for (const q of quadros) {
        const t = (plano.inicioNoArquivo ?? 0) + q.pos * Math.max(0, plano.end - plano.start)
        juntar({
          cand: {
            chave: `${plano.id}|${q.k}`,
            plano: plano.id,
            ordem: cena.ordem,
            gancho: cena.gancho,
            rostos: null,
            beleza: q.beleza,
            nitidez: q.nitidez,
            expressao,
            noTrecho: t >= cena.de - 0.05 && t <= cena.ate + 0.05,
          },
          imagem: q.arquivo && existsSync(q.arquivo) ? q.arquivo : null,
          arquivo: cena.arquivo,
          t,
          rotulo: `Cena ${plano.id}`,
        })
      }
    } else {
      const t = cena.de + Math.max(0, cena.ate - cena.de) / 2
      const nome = cena.arquivo.split(/[\\/]/).pop() ?? ''
      juntar({
        cand: {
          chave: `${normal(cena.arquivo)}|${t.toFixed(2)}`,
          plano: plano?.id ?? normal(cena.arquivo),
          ordem: cena.ordem,
          gancho: cena.gancho,
          rostos: null,
          beleza: null,
          nitidez: null,
          expressao,
          noTrecho: true,
        },
        imagem: null,
        arquivo: cena.arquivo,
        t,
        rotulo: plano ? `Cena ${plano.id}` : nome.replace(/\.[^.]+$/, ''),
      })
    }
  }
  // Sem keyframe no disco: o quadro do proprio video (no cache).
  for (const it of itens.values()) {
    if (it.imagem) continue
    try {
      it.imagem = await quadroEmCache(it.arquivo, it.t)
    } catch {
      it.imagem = null
    }
  }
  const lista = [...itens.values()].filter((it) => it.imagem)
  const achados = await rostosDasImagens(
    lista.map((it) => it.imagem!),
    rodar,
  )
  for (const it of lista) it.cand = { ...it.cand, rostos: achados.rostos.get(it.imagem!) ?? null }
  const escolhidas = escolherSugestoes(lista.map((it) => it.cand))
  const porChave = new Map(lista.map((it) => [it.cand.chave, it]))
  const sugestoes: SugestaoDaThumb[] = []
  for (const e of escolhidas) {
    const it = porChave.get(e.candidato.chave)
    if (!it?.imagem) continue
    try {
      const img = sharp(it.imagem)
      const meta = await img.metadata()
      const miniatura = await sharp(it.imagem).resize({ width: 400, height: 400, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer()
      sugestoes.push({
        arquivo: it.arquivo,
        t: it.t,
        largura: meta.width ?? 1,
        altura: meta.height ?? 1,
        rostos: e.candidato.rostos ? [...e.candidato.rostos] : null,
        gancho: e.candidato.gancho,
        nota: e.nota,
        ordem: e.candidato.ordem,
        miniatura: new Uint8Array(miniatura),
        rotulo: it.rotulo,
      })
    } catch {
      continue
    }
  }
  return { sugestoes, detector: achados.detector }
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

/**
 * Um painel do PNG final: a janela da fonte recortada do quadro em cache,
 * ampliada 4x pelo modelo quando o painel e maior que ela (e o modelo
 * existe), e reduzida (lanczos) para o tamanho exato do painel.
 */
export async function recorteDaThumb(p: PedidoDeRecorte): Promise<RecorteDaThumb> {
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
      console.warn('[recap] thumb: upscale falhou, vai so o lanczos:', e instanceof Error ? e.message : e)
      fonte = sharp(caminho).extract({ left, top, width, height }).removeAlpha()
    }
  }
  const png = await fonte.resize(p.largura, p.altura, { kernel: 'lanczos3', fit: 'fill' }).png({ compressionLevel: 6 }).toBuffer()
  return { png: new Uint8Array(png), ampliado, ms: Date.now() - inicio }
}

// ---------------------------------------------------------- o upload

/**
 * A imagem que ele escolheu no PC vai para `<pasta do projeto>/thumb/`: o
 * projeto guarda esse caminho e nao quebra se a de fora mudar de lugar. A
 * mesma imagem de novo (mesmo nome e mesmo conteudo) reaproveita a copia;
 * outra de mesmo nome ganha "-2", "-3"... Sem pasta (projeto nunca salvo) ou
 * pasta que sumiu: o caminho original.
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

/**
 * Grava o PNG 1080x1920 ao lado do video (`<video>-thumb.png`). 'perguntar'
 * nunca sobrescreve: devolve `existe` para a tela perguntar; 'novo' acha o
 * proximo nome livre (-thumb-2.png...).
 */
export async function salvarThumb(p: PedidoDeSalvar): Promise<ResultadoDoSalvar> {
  const bytes = Buffer.from(p.png.buffer, p.png.byteOffset, p.png.byteLength)
  if (bytes.length < 8 || ASSINATURA_PNG.some((b, i) => bytes[i] !== b)) throw new Error('A thumb nao saiu como PNG.')
  const meta = await sharp(bytes).metadata()
  if (meta.width !== LARGURA || meta.height !== ALTURA) throw new Error(`A thumb saiu ${meta.width}x${meta.height}, e nao ${LARGURA}x${ALTURA}.`)
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
  const tmp = `${destino}.${process.pid}.tmp`
  writeFileSync(tmp, bytes)
  renameSync(tmp, destino)
  return { salvo: destino }
}
