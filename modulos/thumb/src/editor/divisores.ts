import { create } from 'zustand'
import {
  CENTRO_DO_DIVISOR,
  COR_ORIGINAL_DO_DIVISOR,
  FAIXA_DO_DIVISOR,
  PNG_DA_FORMA_DO_RASGO,
  PNG_DO_DIVISOR,
  recolorirDivisor,
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
  return `${d.modelo}|${d.modelo === 'linha' ? '' : (d.cor ?? '')}|${d.modelo === 'linha' ? String(d.contorno) : ''}`
}

/** Os pixels do divisor (o original, ou recolorido) num canvas do tamanho do arquivo. */
async function montar(modelo: ModeloComPng, cor: string | null): Promise<DivisorPronto> {
  const png = await lerPixels(PNG_DO_DIVISOR[modelo])
  const forma = modelo === 'rasgo-brilho' && cor ? await lerPixels(PNG_DA_FORMA_DO_RASGO) : null
  const dados = cor ? recolorirDivisor(modelo, cor, png, forma) : new Uint8ClampedArray(png.dados)
  const canvas = document.createElement('canvas')
  canvas.width = png.largura
  canvas.height = png.altura
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('O canvas nao abriu.')
  ctx.putImageData(new ImageData(dados as Uint8ClampedArray<ArrayBuffer>, png.largura, png.altura), 0, 0)
  return { tipo: 'imagem', fonte: canvas, largura: png.largura, altura: png.altura, centro: CENTRO_DO_DIVISOR[modelo], faixa: FAIXA_DO_DIVISOR[modelo] }
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
    p = montar(d.modelo, d.cor)
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
