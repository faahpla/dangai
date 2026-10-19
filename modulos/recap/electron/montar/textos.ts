import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { CAPTION_SCALE_DEFAULT, CAPTION_Y_DEFAULT, medidasDo, type CaptionStyle, type Formato } from '@shared/contract'
import type { ClipeDoRecap as SobreposicaoSalva } from '../../shared/projeto-do-recap'
import type { Roteiro } from '../../shared/roteiro'
import {
  centroDoTexto,
  clipeDoTexto,
  faixaDosTextos,
  LARGURA_UTIL,
  linhasDoRotulo,
  momentosDosTextos,
  normalizar,
  type PedidoDeTextos,
  type PngDoTexto,
} from '../../shared/textos-na-tela'
import type { TakeDaVoz } from '../../shared/voz'
import { contexto } from '../contexto'
import { lerRascunhoDoDisco } from '../gerar/rascunho'
import { conferirPastaPedida } from './pasta'

/**
 * [recap] O PNG DE CADA TEXTO NA TELA (shared/textos-na-tela.ts): o rotulo
 * desenhado pelo sharp (Pango, com a fonte das legendas) num quadro
 * transparente do tamanho do video -- o clipe de imagem com `contain` cai
 * exatamente onde foi desenhado, e o pop escala em volta do centro do rotulo.
 *
 * O desenho e o das legendas do Dangai: Komika Axis em caixa alta, branco,
 * contorno preto arredondado e sombra rosa dura embaixo (o rosa do app,
 * #FF3D81, o mesmo do marcador de palavra).
 *
 * Nada aqui grava fora da pasta do projeto (`<pasta>/textos/`) ou do perfil do
 * modulo; pasta de biblioteca externa e recusada (conferirPastaPedida).
 */

/** Muda quando o desenho muda: o nome do arquivo leva junto (PNG velho nao e reaproveitado). */
const VERSAO_DO_DESENHO = 1

const ROSA = { r: 0xff, g: 0x3d, b: 0x81 }
/** O corpo do rotulo no quadro 1080 de largura (maior que o card de gancho, 92). */
const CORPO_PX = 118
const FAMILIA = 'Komika Axis'

/**
 * A Komika Axis num arquivo de verdade (o Pango nao le de dentro do asar): em
 * dev, a do repositorio; empacotado, a do bundle do renderer (lida do asar) ou
 * a do bundle do Remotion. Copiada uma vez para <dados do modulo>/fontes.
 */
export function fonteDosTextos(): string {
  const app = contexto().pasta('app')
  const candidatos: string[] = [join(app, 'assets', 'fonts', 'KomikaAxis.ttf')]
  const procurar = (pasta: string, fundo: number): void => {
    let nomes: string[] = []
    try {
      nomes = readdirSync(pasta)
    } catch {
      return
    }
    for (const nome of nomes) {
      const caminho = join(pasta, nome)
      if (/komika.*\.ttf$/i.test(nome)) candidatos.push(caminho)
      else if (fundo > 0 && !/\./.test(nome)) procurar(caminho, fundo - 1)
    }
  }
  procurar(join(app, 'out', 'renderer', 'assets'), 0)
  if (process.resourcesPath) procurar(join(process.resourcesPath, 'remotion'), 2)
  const destino = join(contexto().pasta('dados'), 'fontes', 'KomikaAxis.ttf')
  for (const origem of candidatos) {
    try {
      const bytes = readFileSync(origem)
      if (bytes.length < 1000) continue
      if (!existsSync(destino) || statSync(destino).size !== bytes.length) {
        mkdirSync(join(destino, '..'), { recursive: true })
        writeFileSync(destino, bytes)
      }
      return destino
    } catch {
      continue
    }
  }
  throw new Error('A fonte das legendas (Komika Axis) nao foi achada.')
}

function escaparPango(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A mascara (alfa) do texto em `px`, com as linhas centralizadas. */
async function mascara(linhas: readonly string[], px: number, fonte: string): Promise<{ alfa: Buffer; largura: number; altura: number }> {
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="#FFFFFF">${escaparPango(linhas.join('\n'))}</span>`,
      font: `${FAMILIA} ${px}`,
      fontfile: fonte,
      rgba: true,
      align: 'centre',
      dpi: 72,
      // As duas linhas mais juntas: o rotulo le como um bloco so.
      spacing: Math.round(px * -0.12),
    },
  })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const alfa = Buffer.alloc(info.width * info.height)
  for (let i = 0; i < alfa.length; i++) alfa[i] = data[i * info.channels + info.channels - 1]!
  return { alfa, largura: info.width, altura: info.height }
}

/**
 * O rotulo desenhado (sem o quadro em volta): PNG RGBA com o contorno e a
 * sombra, e o tamanho. `larguraMax` = a largura util do quadro.
 */
export async function desenharRotulo(
  texto: string,
  e: { larguraQuadro: number; fonte: string },
): Promise<{ png: Buffer; largura: number; altura: number }> {
  const linhas = linhasDoRotulo(texto)
  const escalaDoQuadro = e.larguraQuadro / 1080
  let px = Math.round(CORPO_PX * escalaDoQuadro)
  let m = await mascara(linhas, px, e.fonte)
  const larguraMax = Math.round(e.larguraQuadro * LARGURA_UTIL)
  if (m.largura > larguraMax) {
    // Palavra comprida: encolhe ate caber (como a legenda faz), sem quebrar palavra.
    px = Math.max(24, Math.floor((px * larguraMax) / m.largura))
    m = await mascara(linhas, px, e.fonte)
  }
  const contorno = Math.max(2, Math.round(px * 0.085))
  const sombra = Math.max(2, Math.round(px * 0.09))
  const borda = contorno + 4
  const W = m.largura + 2 * borda
  const H = m.altura + 2 * borda
  const alfa = Buffer.alloc(W * H)
  for (let y = 0; y < m.altura; y++) m.alfa.copy(alfa, (y + borda) * W + borda, y * m.largura, (y + 1) * m.largura)
  // Contorno ARREDONDADO: a mascara borrada e cortada alto (o dilate quadrado deixava quina).
  const grosso = await sharp(alfa, { raw: { width: W, height: H, channels: 1 } })
    .blur(Math.max(0.5, contorno * 0.6))
    .linear(6, -60)
    .extractChannel(0)
    .raw()
    .toBuffer()
  const camada = (a: Buffer, cor: { r: number; g: number; b: number }): Buffer => {
    const out = Buffer.alloc(W * H * 4)
    for (let i = 0; i < W * H; i++) {
      out[i * 4] = cor.r
      out[i * 4 + 1] = cor.g
      out[i * 4 + 2] = cor.b
      out[i * 4 + 3] = a[i]!
    }
    return out
  }
  const raw = { width: W, height: H, channels: 4 as const }
  const png = await sharp({ create: { width: W, height: H + sombra, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      // Sombra rosa dura (sem desfoque), colada embaixo: o padrao da legenda, no rosa do app.
      { input: camada(grosso, ROSA), raw, top: sombra, left: 0 },
      { input: camada(grosso, { r: 0, g: 0, b: 0 }), raw, top: 0, left: 0 },
      { input: camada(alfa, { r: 255, g: 255, b: 255 }), raw, top: 0, left: 0 },
    ])
    .png()
    .toBuffer()
  return { png, largura: W, altura: H + sombra }
}

/** O rotulo no quadro inteiro (transparente), no lugar certo. */
export async function quadroDoTexto(
  texto: string,
  e: { formato: Formato; captionY: number; captionScale: number; fonte: string },
): Promise<{ png: Buffer; centroX: number; centroY: number; aspecto: number }> {
  const { width, height } = medidasDo(e.formato)
  const rotulo = await desenharRotulo(texto, { larguraQuadro: width, fonte: e.fonte })
  const centroY = centroDoTexto({ captionY: e.captionY, captionScale: e.captionScale, alturaRel: rotulo.altura / height, alturaPx: height })
  const top = Math.max(0, Math.round(centroY * height - rotulo.altura / 2))
  const left = Math.max(0, Math.round(width / 2 - rotulo.largura / 2))
  const png = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: rotulo.png, top, left }])
    .png({ compressionLevel: 9 })
    .toBuffer()
  return { png, centroX: 0.5, centroY: (top + rotulo.altura / 2) / height, aspecto: width / height }
}

/** "divida-magica" */
function slug(texto: string): string {
  return normalizar(texto).replace(/\s+/g, '-').slice(0, 40) || 'texto'
}

/**
 * Os PNGs dos textos, em `<pasta>/textos/` (a do projeto; null = a do
 * modulo). O nome leva o texto e uma impressao do desenho: rodar de novo com o
 * mesmo texto e o mesmo lugar acha o MESMO arquivo (o clipe continua intacto).
 */
export async function pngsDosTextos(
  pedido: PedidoDeTextos,
  fonte: string = fonteDosTextos(),
): Promise<{ pngs: PngDoTexto[]; avisos: string[] }> {
  const base = pedido.pasta ? conferirPastaPedida(pedido.pasta) : contexto().pasta('dados')
  const pasta = join(base, 'textos')
  mkdirSync(pasta, { recursive: true })
  const pngs: PngDoTexto[] = []
  const avisos: string[] = []
  for (const t of pedido.textos) {
    try {
      const feito = await quadroDoTexto(t.texto, { formato: pedido.formato, captionY: pedido.captionY, captionScale: pedido.captionScale, fonte })
      const marca = createHash('sha1')
        .update(JSON.stringify([VERSAO_DO_DESENHO, t.texto, pedido.formato, pedido.captionY, pedido.captionScale]))
        .digest('hex')
        .slice(0, 10)
      const arquivo = join(pasta, `${slug(t.texto)}-${marca}.png`)
      if (!existsSync(arquivo)) writeFileSync(arquivo, feito.png)
      pngs.push({ fraseId: t.fraseId, path: arquivo, centroX: feito.centroX, centroY: feito.centroY, aspecto: feito.aspecto })
    } catch (err) {
      avisos.push(`Texto "${t.texto}" sem imagem: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { pngs, avisos }
}

/**
 * Os TEXTOS NA TELA da montagem ("Abrir no editor" com a Edicao rapida): o
 * texto de tela de cada frase, menos a 1a (essa e o card de gancho), no tempo
 * do take, desenhado em `<pasta do projeto>/textos/` e posto como clipe de
 * imagem acima da camada de cor. Melhor esforco: falhou, vira aviso e o
 * projeto sai sem os textos.
 */
export async function textosDaMontagem(e: {
  roteiro: Pick<Roteiro, 'secoes'>
  take: Pick<TakeDaVoz, 'trechos' | 'palavras' | 'duracao'>
  pasta: string
  estilo: Pick<CaptionStyle, 'y' | 'scale'> | null
  /** Ate quando o card de gancho fica na tela (0 = sem card). */
  ganchoAteSec: number
  /** O que ja esta na faixa de video (a camada de cor): os textos ficam acima. */
  faixaDeVideo: readonly SobreposicaoSalva[]
  fonte?: string
}): Promise<{ clipes: SobreposicaoSalva[]; avisos: string[] }> {
  try {
    const frases = e.roteiro.secoes.flatMap((s) => s.frases)
    const trechos = new Map(e.take.trechos.map((t) => [t.fraseId, t]))
    const pedidos = frases.slice(1).flatMap((f) => {
      const t = trechos.get(f.id)
      const texto = f.textoDeTela?.trim()
      return t && texto ? [{ fraseId: f.id, texto, inicio: t.offset, fim: t.offset + t.duracao }] : []
    })
    if (pedidos.length === 0) return { clipes: [], avisos: [] }
    const momentos = momentosDosTextos(pedidos, e.take.palavras, { duracaoSec: e.take.duracao, ganchoAteSec: e.ganchoAteSec })
    if (momentos.textos.length === 0) return { clipes: [], avisos: momentos.avisos }
    const feito = await pngsDosTextos(
      {
        textos: momentos.textos.map((t) => ({ fraseId: t.fraseId, texto: t.texto })),
        pasta: e.pasta,
        formato: 'short',
        captionY: e.estilo?.y ?? CAPTION_Y_DEFAULT,
        captionScale: e.estilo?.scale ?? CAPTION_SCALE_DEFAULT,
      },
      e.fonte,
    )
    const porFrase = new Map(feito.pngs.map((p) => [p.fraseId, p]))
    const faixa = faixaDosTextos(e.faixaDeVideo, momentos.textos)
    const rodada = Date.now().toString(36)
    const clipes = momentos.textos.flatMap((t) => {
      const png = porFrase.get(t.fraseId)
      return png ? [clipeDoTexto({ id: `er-texto-${t.fraseId}-${rodada}`, png, texto: t, faixa })] : []
    })
    return { clipes, avisos: [...momentos.avisos, ...feito.avisos] }
  } catch (err) {
    return { clipes: [], avisos: [`Sem textos na tela: ${err instanceof Error ? err.message : String(err)}`] }
  }
}

/**
 * Os textos de tela de uma versao do roteiro (fraseId -> texto ou null): o
 * projeto montado antes dos Textos na tela nao guarda o texto em
 * `modulos.recap.secoes`, e a Edicao rapida no editor busca aqui. So le.
 */
export function telasDoRascunho(rascunhoId: string, versao: number): Record<string, string | null> | null {
  try {
    const r = lerRascunhoDoDisco(rascunhoId)
    const roteiro = r.roteiros.find((v) => v.versao === versao)
    if (!roteiro) return null
    return Object.fromEntries(roteiro.secoes.flatMap((s) => s.frases.map((f) => [f.id, f.textoDeTela?.trim() || null] as const)))
  } catch {
    return null
  }
}
