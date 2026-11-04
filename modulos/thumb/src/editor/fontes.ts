import anton from '../../assets/fonts/Anton-Regular.ttf'
import bangers from '../../assets/fonts/Bangers-Regular.ttf'
import luckiest from '../../assets/fonts/LuckiestGuy-Regular.ttf'
import poppins from '../../assets/fonts/Poppins-Black.ttf'
import komika from '../../../../assets/fonts/KomikaAxis.ttf'
import { FONTES_DA_THUMB, type FonteDaThumb, type ThumbDoProjeto } from '../../shared/thumb'

/**
 * [thumb] As fontes da thumbnail, carregadas do arquivo que vai no bundle
 * (como a Komika das legendas: o canvas nao enxerga fonte so instalada no
 * Windows). Luckiest Guy (Apache 2.0), Bangers, Anton e Poppins Black (OFL),
 * com a licenca ao lado em modulos/thumb/assets/fonts; a Komika Axis e a do app.
 *
 * Familia com prefixo ("Thumb ...") para nao brigar com uma fonte de mesmo
 * nome instalada no PC dele.
 *
 * (04/11) A FONTE DO PC: os bytes vem do main (electron/fontes-do-pc.ts) e
 * entram com um FontFace proprio ("Thumb PC <n>"). Ate carregar -- ou se o
 * arquivo sumiu --, a `fonte` do app desenha no lugar.
 */
const ARQUIVOS: Record<FonteDaThumb, string> = {
  luckiest,
  bangers,
  anton,
  komika,
  poppins,
}

let carregando: Promise<void> | null = null

/** Carrega as do app uma vez; a que falhar cai na reserva do canvas (sem derrubar a tela). */
export function carregarFontesDaThumb(): Promise<void> {
  // Sem DOM (o teste): nada a carregar.
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve()
  carregando ??= Promise.all(
    FONTES_DA_THUMB.map(async (f) => {
      try {
        const face = new FontFace(f.familia, `url(${ARQUIVOS[f.id]}) format("truetype")`)
        document.fonts.add(await face.load())
      } catch (e) {
        console.warn(`[thumb] a fonte ${f.nome} nao carregou:`, e)
      }
    }),
  ).then(() => undefined)
  return carregando
}

export function familiaDaFonte(id: FonteDaThumb): string {
  return FONTES_DA_THUMB.find((f) => f.id === id)?.familia ?? FONTES_DA_THUMB[0].familia
}

/** As fontes do PC ja carregadas (arquivo -> familia) e as a caminho. */
const doPc = new Map<string, string>()
const doPcCarregando = new Map<string, Promise<boolean>>()
let proximaFamilia = 0

/** A familia que desenha a thumb agora: a do PC carregada, senao a do app. */
export function familiaDaThumb(t: Pick<ThumbDoProjeto, 'fonte'> & { fontePc?: ThumbDoProjeto['fontePc'] }): string {
  const pc = t.fontePc ? doPc.get(t.fontePc.arquivo.toLowerCase()) : undefined
  return pc ?? familiaDaFonte(t.fonte)
}

/** A fonte do PC ja esta carregada (a previa mede com ela). */
export function fonteDoPcPronta(arquivo: string): boolean {
  return doPc.has(arquivo.toLowerCase())
}

/**
 * Carrega uma fonte do PC (uma vez por arquivo; falhou, tenta de novo na
 * proxima). true = pronta.
 */
export function carregarFonteDoPc(arquivo: string, bytes: (arquivo: string) => Promise<Uint8Array | null>): Promise<boolean> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve(false)
  const chave = arquivo.toLowerCase()
  if (doPc.has(chave)) return Promise.resolve(true)
  const ja = doPcCarregando.get(chave)
  if (ja) return ja
  const p = (async () => {
    try {
      const b = await bytes(arquivo)
      if (!b) return false
      const familia = `Thumb PC ${++proximaFamilia}`
      const copia = new Uint8Array(b.byteLength)
      copia.set(b)
      const face = new FontFace(familia, copia.buffer)
      document.fonts.add(await face.load())
      doPc.set(chave, familia)
      return true
    } catch (e) {
      console.warn('[thumb] a fonte do PC nao carregou:', e)
      return false
    } finally {
      doPcCarregando.delete(chave)
    }
  })()
  doPcCarregando.set(chave, p)
  return p
}
