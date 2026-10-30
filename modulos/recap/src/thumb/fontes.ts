import anton from '../../assets/fonts/Anton-Regular.ttf'
import bangers from '../../assets/fonts/Bangers-Regular.ttf'
import luckiest from '../../assets/fonts/LuckiestGuy-Regular.ttf'
import komika from '../../../../assets/fonts/KomikaAxis.ttf'
import { FONTES_DA_THUMB, type FonteDaThumb } from '../../shared/thumb'

/**
 * [recap] As fontes da thumbnail, carregadas do arquivo que vai no bundle
 * (como a Komika das legendas: o canvas nao enxerga fonte so instalada no
 * Windows). Luckiest Guy (Apache 2.0), Bangers e Anton (OFL), com a licenca
 * ao lado em modulos/recap/assets/fonts; a Komika Axis e a do app.
 *
 * Familia com prefixo ("Thumb ...") para nao brigar com uma fonte de mesmo
 * nome instalada no PC dele.
 */
const ARQUIVOS: Record<FonteDaThumb, string> = {
  luckiest,
  bangers,
  anton,
  komika,
}

let carregando: Promise<void> | null = null

/** Carrega as quatro uma vez; a que falhar cai na reserva do canvas (sem derrubar a tela). */
export function carregarFontesDaThumb(): Promise<void> {
  // Sem DOM (o teste): nada a carregar.
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve()
  carregando ??= Promise.all(
    FONTES_DA_THUMB.map(async (f) => {
      try {
        const face = new FontFace(f.familia, `url(${ARQUIVOS[f.id]}) format("truetype")`)
        document.fonts.add(await face.load())
      } catch (e) {
        console.warn(`[recap] thumb: a fonte ${f.nome} nao carregou:`, e)
      }
    }),
  ).then(() => undefined)
  return carregando
}

export function familiaDaFonte(id: FonteDaThumb): string {
  return FONTES_DA_THUMB.find((f) => f.id === id)?.familia ?? FONTES_DA_THUMB[0].familia
}
