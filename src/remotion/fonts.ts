import { continueRender, delayRender } from 'remotion'
import komikaAxis from '../../assets/fonts/KomikaAxis.ttf'

/**
 * A fonte das legendas, carregada do arquivo que vai junto no bundle.
 *
 * Nao da para depender da fonte instalada no sistema: o render roda num Chrome
 * headless proprio, que nao enxerga as fontes do Windows. O arquivo entra no
 * bundle do Remotion e no do Vite pelo mesmo import, entao preview e render
 * carregam exatamente a mesma fonte.
 */
export const CAPTION_FONT_FAMILY = 'Komika Axis'

/** Com o fallback junto, para quem for aplicar em CSS. */
export const CAPTION_FONT_STACK = `"${CAPTION_FONT_FAMILY}", "Inter Variable", Inter, sans-serif`

const handle = delayRender('Carregando a fonte das legendas')

const face = new FontFace(CAPTION_FONT_FAMILY, `url(${komikaAxis}) format("truetype")`)

void face
  .load()
  .then((loaded) => {
    document.fonts.add(loaded)
  })
  .catch(() => {
    // Fonte quebrada nao pode derrubar um render de 70 segundos. Sem ela o
    // texto sai em Inter -- feio para o padrao do canal, mas entregue.
    console.warn('Komika Axis nao carregou; as legendas saem na fonte reserva.')
  })
  .finally(() => {
    continueRender(handle)
  })

/**
 * Carrega uma fonte que o usuario largou na pasta, servida pelo 127.0.0.1.
 *
 * Segura o render enquanto carrega, como a embutida: sem o delayRender, os
 * primeiros frames sairiam na fonte reserva e o video comecaria com a legenda
 * errada por meio segundo.
 *
 * Guarda quem ja foi pedida porque cada frame do render monta o componente de
 * novo -- sem isso seriam centenas de FontFace para o mesmo arquivo.
 */
const carregadas = new Set<string>()

export function carregarFonte(family: string, url: string): void {
  const chave = `${family}|${url}`
  if (carregadas.has(chave)) return
  carregadas.add(chave)

  const espera = delayRender(`Carregando a fonte ${family}`)
  const face = new FontFace(family, `url(${url})`)
  void face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded)
    })
    .catch(() => {
      // Arquivo apagado ou corrompido nao pode derrubar um render inteiro: cai
      // na fonte embutida, que e o padrao de qualquer forma.
      console.warn(`${family} nao carregou; as legendas saem na fonte de sempre.`)
    })
    .finally(() => {
      continueRender(espera)
    })
}
