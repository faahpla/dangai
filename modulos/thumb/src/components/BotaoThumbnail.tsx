import { useEffect, useRef, useState } from 'react'
import { Images } from 'lucide-react'
import { nucleo } from '../nucleo'
import { useTela } from '../store/tela'

const IMAGEM = /\.(png|jpe?g|webp|bmp)$/i

/**
 * [thumb] "Thumbnail" na tela inicial, ao lado do "Gerar recap" e no mesmo
 * estilo (a mesma altura, letra e o rosa apagado). Clicar abre o editor solto
 * (a tela inicial nao tem projeto aberto). Soltar uma imagem EM CIMA do botao
 * abre o editor ja com ela; solta em qualquer outro lugar, a imagem faz o que
 * o Dangai faz.
 */
export function BotaoThumbnail({ arrastando, aoAcender }: { arrastando: boolean; aoAcender?: (aceso: boolean) => void }) {
  const busy = nucleo().usar((s) => s.busy)
  const [sobre, setSobre] = useState(false)
  // Entrar num filho (icone, texto) dispara leave no pai: conta a profundidade.
  const profundidade = useRef(0)
  const acesso = sobre && arrastando && busy === null
  useEffect(() => {
    aoAcender?.(acesso)
  }, [acesso, aoAcender])

  if (busy !== null) return null

  return (
    <button
      type="button"
      onClick={() => useTela.getState().abrir()}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        profundidade.current += 1
        setSobre(true)
      }}
      onDragLeave={() => {
        profundidade.current = Math.max(0, profundidade.current - 1)
        if (profundidade.current === 0) setSobre(false)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        profundidade.current = 0
        setSobre(false)
        const imagens = Array.from(event.dataTransfer.files)
          .map((f) => window.dangai.pathForFile(f))
          .filter((c) => IMAGEM.test(c))
        if (imagens.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        useTela.getState().abrir('solta', imagens)
      }}
      title="A capa 1080x1920 do short, com imagens do PC ou os quadros de um projeto (solte uma imagem aqui)"
      data-thumb="botao-inicial"
      className={[
        'flex shrink-0 items-center gap-2 rounded-sm border border-accent px-3 py-1.5 text-[12px] font-medium transition-colors duration-150',
        acesso ? 'bg-accent text-white' : 'bg-accent-dim text-ink hover:bg-accent-glow',
      ].join(' ')}
    >
      <Images size={13} strokeWidth={1.5} className={acesso ? 'text-white' : 'text-accent'} />
      Thumbnail
    </button>
  )
}
