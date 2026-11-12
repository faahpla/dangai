import { create } from 'zustand'
import {
  CENTRO_DO_DIVISOR,
  COR_ORIGINAL_DO_DIVISOR,
  FAIXA_DO_DIVISOR,
  PNG_DA_FORMA_DO_RASGO,
  PNG_DO_DIVISOR,
  recolorirDivisor,
  tomDoBrilho,
  type DivisorDaThumb,
  type ModeloComPng,
  type PixelsRgba,
} from '../../shared/thumb'
import type { DivisorPronto } from './desenho'

/**
 * [thumb] OS DIVISORES NA TELA: os PNGs dos modelos (modulos/thumb/assets/
 * divisores, embutidos no bundle como data: -- imagem de file:// "suja" o
 * canvas e o toBlob do Salvar PNG falharia), os pixels deles e o recolorido
 * de cada cor (shared/divisores.ts), guardados para a previa redesenhar sem
 * refazer a conta. A previa e o PNG final desenham o MESMO canvas, no
 * tamanho do arquivo (1080x1920): no PNG, 1 px dele = 1 px da thumb.
 */

/** Os PNGs como data: (o Vite embute; no teste sem DOM isto nunca roda). */
function arquivosEmbutidos(): Record<string, () => Promise<string>> {
  return import.meta.glob<string>('../../assets/divisores/*.png', { query: '?inline', import: 'default' })
}

/** Cada vez que um divisor fica pronto, a previa redesenha. */
export const useDivisoresProntos = create<{ versao: number }>(() => ({ versao: 0 }))

const pixels = new Map<string, Promise<PixelsRgba>>()
/** Os prontos: `modelo|cor` (cor vazia = a original). */
const prontos = new Map<string, DivisorPronto>()
const preparando = new Map<string, Promise<DivisorPronto | null>>()
/** O ultimo pronto de cada modelo: a previa mostra este enquanto a cor nova recolore (sem piscar). */
const ultimoDoModelo = new Map<string, DivisorPronto>()
/** Poucas cores guardadas (o seletor livre cria uma por arrastar). */
const MAXIMO_GUARDADO = 8

function semDom(): boolean {
  return typeof document === 'undefined' || typeof Image === 'undefined'
}

async function lerPixels(nome: string): Promise<PixelsRgba> {
  let p = pixels.get(nome)
  if (!p) {
    p = (async () => {
      const arquivos = arquivosEmbutidos()
      const chave = Object.keys(arquivos).find((k) => k.endsWith(`/${nome}`))
      if (!chave) throw new Error(`O divisor ${nome} nao esta no app.`)
      const url = await arquivos[chave]!()
      const img = new Image()
      img.src = url
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('O canvas nao abriu.')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height)
      return { largura: d.width, altura: d.height, dados: d.data }
    })()
    pixels.set(nome, p)
    p.catch(() => pixels.delete(nome))
  }
  return p
}

function chaveDo(d: DivisorDaThumb): string {
  const brilho = d.modelo === 'rasgo-brilho' ? Math.round(d.brilho) : 0
  return `${d.modelo}|${d.modelo === 'linha' ? '' : (d.cor ?? '')}|${d.modelo === 'linha' ? String(d.contorno) : ''}|${brilho}`
}

/** O azul do brilho do Rasgo com brilho original (o do MEIO.png, um pouco mais claro). */
const BRILHO_ORIGINAL = '#2f74e0'

function misturar(hex: string, alvo: [number, number, number], quanto: number): string {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v + (alvo[i]! - v) * quanto))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

/**
 * (12/11) O BRILHO MAIOR do Rasgo com brilho (0-100): por baixo do PNG, a forma
 * do rasgo borrada e clara (o halo que cresce com o valor); por cima, a mesma
 * forma, nitida, na cor do brilho com um pouco de opacidade -- o meio do rasgo
 * fica menos escuro. Pedido do Levi comparando com o thumb de referencia.
 */
function comBrilho(base: HTMLCanvasElement, forma: PixelsRgba, cor: string | null, brilho: number): HTMLCanvasElement {
  const b = Math.min(100, Math.max(0, brilho)) / 100
  const tom = cor ? tomDoBrilho(cor) : BRILHO_ORIGINAL
  const pintar = (cssCor: string): HTMLCanvasElement => {
    const c = document.createElement('canvas')
    c.width = forma.largura
    c.height = forma.altura
    const x = c.getContext('2d')!
    const d = new Uint8ClampedArray(forma.dados)
    x.putImageData(new ImageData(d as Uint8ClampedArray<ArrayBuffer>, forma.largura, forma.altura), 0, 0)
    x.globalCompositeOperation = 'source-in'
    x.fillStyle = cssCor
    x.fillRect(0, 0, c.width, c.height)
    return c
  }
  const halo = pintar(misturar(tom, [255, 255, 255], 0.45))
  const miolo = pintar(tom)
  const out = document.createElement('canvas')
  out.width = base.width
  out.height = base.height
  const ctx = out.getContext('2d')!
  // O halo e a forma ESTICADA na vertical em volta do centro (o rasgo e fino: so
  // borrar espalha pouca cor) e borrada; duas passadas, uma larga e uma perto.
  const centro = CENTRO_DO_DIVISOR['rasgo-brilho']
  const esticada = (k: number): void => {
    const h = out.height * k
    ctx.drawImage(halo, 0, centro - centro * k, out.width, h)
  }
  ctx.filter = `blur(${Math.round(40 + 160 * b)}px)`
  ctx.globalAlpha = 0.45 + 0.55 * b
  esticada(1 + 5 * b)
  esticada(1 + 5 * b)
  ctx.filter = `blur(${Math.round(12 + 48 * b)}px)`
  ctx.globalAlpha = 0.4 + 0.6 * b
  esticada(1 + 1.5 * b)
  ctx.filter = 'none'
  ctx.globalAlpha = 1
  ctx.drawImage(base, 0, 0)
  ctx.globalAlpha = 0.75 * b
  ctx.drawImage(miolo, 0, 0)
  ctx.globalAlpha = 1
  return out
}

/** Os pixels do divisor (o original, ou recolorido) num canvas do tamanho do arquivo. */
async function montar(modelo: ModeloComPng, cor: string | null, brilho = 0): Promise<DivisorPronto> {
  const png = await lerPixels(PNG_DO_DIVISOR[modelo])
  const forma = modelo === 'rasgo-brilho' && (cor || brilho > 0) ? await lerPixels(PNG_DA_FORMA_DO_RASGO) : null
  const dados = cor ? recolorirDivisor(modelo, cor, png, forma) : new Uint8ClampedArray(png.dados)
  const canvas = document.createElement('canvas')
  canvas.width = png.largura
  canvas.height = png.altura
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('O canvas nao abriu.')
  ctx.putImageData(new ImageData(dados as Uint8ClampedArray<ArrayBuffer>, png.largura, png.altura), 0, 0)
  const fonte = forma && brilho > 0 ? comBrilho(canvas, forma, cor, brilho) : canvas
  return { tipo: 'imagem', fonte, largura: png.largura, altura: png.altura, centro: CENTRO_DO_DIVISOR[modelo], faixa: FAIXA_DO_DIVISOR[modelo] }
}

/** O divisor pronto para o desenho (esperando o PNG ficar pronto). null = sem divisor. */
export async function prepararDivisor(d: DivisorDaThumb | null): Promise<DivisorPronto | null> {
  if (!d) return null
  if (d.modelo === 'linha') return { tipo: 'linha', cor: d.cor ?? COR_ORIGINAL_DO_DIVISOR.linha, contorno: d.contorno }
  if (semDom()) return null
  const chave = chaveDo(d)
  const pronto = prontos.get(chave)
  if (pronto) return pronto
  let p = preparando.get(chave)
  if (!p) {
    p = montar(d.modelo, d.cor, d.modelo === 'rasgo-brilho' ? d.brilho : 0)
      .then((m) => {
        prontos.set(chave, m)
        ultimoDoModelo.set(d.modelo, m)
        // A mais antiga sai (Map guarda a ordem de entrada).
        while (prontos.size > MAXIMO_GUARDADO) prontos.delete(prontos.keys().next().value!)
        useDivisoresProntos.setState((s) => ({ versao: s.versao + 1 }))
        return m
      })
      .catch((e: unknown) => {
        console.warn('[thumb] o divisor nao abriu:', e)
        return null
      })
      .finally(() => preparando.delete(chave))
    preparando.set(chave, p)
  }
  return p
}

/** Para a previa: o pronto agora, ou null (e pede; quando ficar pronto, useDivisoresProntos muda). */
export function divisorAgora(d: DivisorDaThumb | null): DivisorPronto | null {
  if (!d) return null
  if (d.modelo === 'linha') return { tipo: 'linha', cor: d.cor ?? COR_ORIGINAL_DO_DIVISOR.linha, contorno: d.contorno }
  const pronto = prontos.get(chaveDo(d))
  if (pronto) return pronto
  void prepararDivisor(d)
  return ultimoDoModelo.get(d.modelo) ?? null
}
