import { Images } from 'lucide-react'
import type { ModuloDoRenderer } from '@/modulos/api'
import { BotaoThumbnail } from './components/BotaoThumbnail'
import { TelaDaThumb } from './components/TelaDaThumb'
import { guardarNucleo } from './nucleo'
import { useTela } from './store/tela'

/**
 * [thumb] O MODULO THUMBNAIL no renderer (pedido do Levi, 30/10): o editor
 * da capa 1080x1920 da tela "Video pronto" do recap, como modulo proprio,
 * para quem usa o Dangai sem o recap. So com o modulo ligado
 * (Configuracoes > Modulos):
 *
 * - "Thumbnail" na tela inicial, ao lado do "Gerar recap", e na paleta;
 * - a tela cheia (TelaDaThumb) com o mesmo editor (modulos/thumb/src/editor),
 *   solta ou de um projeto;
 * - funciona com o recap desligado; o motor de rostos e a tela que instala o
 *   motor sao emprestados pelo recap (electron/motor.ts, src/motor.ts).
 */
export const thumb: ModuloDoRenderer = {
  id: 'thumb',

  iniciar(n) {
    guardarNucleo(n)
    // Desligado com a tela aberta: ela fecha (o nucleo ja solta o inerte).
    return () => useTela.setState({ aberta: false })
  },

  BotoesDaTelaInicial: ({ arrastando, definirAlvo }) => <BotaoThumbnail arrastando={arrastando} aoAcender={definirAlvo} />,

  Telas: () => <TelaDaThumb />,

  comandos: () => [
    {
      id: 'thumb-abrir',
      label: 'Thumbnail',
      hint: 'A capa 1080x1920 do short',
      icon: Images,
      run: () => useTela.getState().abrir(),
    },
  ],
}
