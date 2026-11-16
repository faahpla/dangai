import { create } from 'zustand'
import { desenhoDaSeta, type FormaDaSeta, type SetaNoQuadro } from '../../shared/thumb'

/**
 * [thumb] AS SETAS QUE SAO PNG (04/11, a do AJK): o arquivo embutido como
 * data: (como os divisores -- imagem de file:// suja o canvas e o Salvar PNG
 * falharia), decodificado uma vez. Enquanto nao fica pronto, o desenho usa a
 * silhueta vetorizada (desenho.ts).
 */

function arquivosEmbutidos(): Record<string, () => Promise<string>> {
  return import.meta.glob<string>('../../assets/setas/*.png', { query: '?inline', import: 'default' })
}

/** Cada vez que uma seta fica pronta, a previa redesenha. */
export const useSetasProntas = create<{ versao: number }>(() => ({ versao: 0 }))

const prontas = new Map<string, HTMLImageElement>()
const carregando = new Map<string, Promise<HTMLImageElement | null>>()
/** (16/11) A seta de PNG em BRANCO: cada pixel com o brilho dele (o vermelho vira branco, o traco preto e a sombra ficam). */
const brancas = new Map<string, HTMLCanvasElement>()

/** A imagem da seta, se ja carregou (null = vetor, ou ainda a caminho). */
export function imagemDaSeta(s: Pick<SetaNoQuadro, 'forma'>): HTMLImageElement | null {
  const arquivo = desenhoDaSeta(s).imagem?.arquivo
  return arquivo ? (prontas.get(arquivo) ?? null) : null
}

/**
 * (16/11) A seta de PNG pronta para receber a COR dele (desenho.ts multiplica
 * o degrade por cima): o pixel vira cinza pelo maior canal -- o vermelho puro
 * vira branco, o preto do pincel e da sombra continua preto, e o alpha fica.
 */
export function setaBranca(s: Pick<SetaNoQuadro, 'forma'>): HTMLCanvasElement | null {
  const arquivo = desenhoDaSeta(s).imagem?.arquivo
  if (!arquivo) return null
  const ja = brancas.get(arquivo)
  if (ja) return ja
  const img = prontas.get(arquivo)
  if (!img || typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height)
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.max(d.data[i]!, d.data[i + 1]!, d.data[i + 2]!)
    d.data[i] = v
    d.data[i + 1] = v
    d.data[i + 2] = v
  }
  ctx.putImageData(d, 0, 0)
  brancas.set(arquivo, c)
  return c
}

/** Carrega o PNG da seta (uma vez). */
export function carregarSeta(forma: FormaDaSeta): Promise<HTMLImageElement | null> {
  const arquivo = desenhoDaSeta({ forma }).imagem?.arquivo
  if (!arquivo || typeof document === 'undefined' || typeof Image === 'undefined') return Promise.resolve(null)
  const ja = prontas.get(arquivo)
  if (ja) return Promise.resolve(ja)
  let p = carregando.get(arquivo)
  if (!p) {
    p = (async () => {
      try {
        const arquivos = arquivosEmbutidos()
        const chave = Object.keys(arquivos).find((k) => k.endsWith(`/${arquivo}`))
        if (!chave) return null
        const img = new Image()
        img.src = await arquivos[chave]!()
        await img.decode()
        prontas.set(arquivo, img)
        useSetasProntas.setState((s) => ({ versao: s.versao + 1 }))
        return img
      } catch (e) {
        console.warn(`[thumb] a seta ${arquivo} nao carregou:`, e)
        return null
      } finally {
        carregando.delete(arquivo)
      }
    })()
    carregando.set(arquivo, p)
  }
  return p
}
