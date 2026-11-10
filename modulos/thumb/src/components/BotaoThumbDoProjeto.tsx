import { Images } from 'lucide-react'
import { nucleo } from '../nucleo'
import { useTela } from '../store/tela'

/**
 * [thumb] "Thumbnail" na barra do editor: "la na timeline do video, depois de
 * renderizar tudo, eu quero um botao que leva direto pra etapa fazer thumbnail
 * e ele usa o projeto em questao". Abre a tela da thumb no modo "De um
 * projeto", ja no projeto aberto (os quadros limpos das cenas dele; o PNG vai
 * ao lado do video). Aparece com o projeto pronto para renderizar; depois do
 * render, acende -- e o passo seguinte.
 */
export function BotaoThumbDoProjeto() {
  const pronto = nucleo().usar((s) => s.audio !== null && s.plan !== null && s.images.length > 0)
  const renderizando = nucleo().usar((s) => s.render !== null && ['bundling', 'rendering', 'muxing'].includes(s.render.stage))
  const renderizou = nucleo().usar((s) => s.lastOutput !== null)
  if (!pronto || renderizando) return null
  return (
    <button
      type="button"
      onClick={() => useTela.getState().abrir('projeto')}
      title="Fazer a thumbnail deste projeto: os quadros das cenas dele, e o PNG ao lado do vídeo"
      data-thumb="botao-do-editor"
      className={[
        'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
        renderizou ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:text-ink',
      ].join(' ')}
    >
      <Images size={12} strokeWidth={1.5} className={renderizou ? 'text-accent' : ''} />
      <span className="group-data-[compacto]/barra:hidden">Thumbnail</span>
    </button>
  )
}
