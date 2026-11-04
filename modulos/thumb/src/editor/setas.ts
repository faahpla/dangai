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

/** A imagem da seta, se ja carregou (null = vetor, ou ainda a caminho). */
export function imagemDaSeta(s: Pick<SetaNoQuadro, 'forma'>): HTMLImageElement | null {
  const arquivo = desenhoDaSeta(s).imagem?.arquivo
  return arquivo ? (prontas.get(arquivo) ?? null) : null
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
