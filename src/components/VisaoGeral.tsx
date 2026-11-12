import { MousePointerClick } from 'lucide-react'
import { useProject } from '@/store/project'
import { dicaDoAtalho, useAtalhos, type Acao } from '@/store/atalhos'
import { ImageStrip } from './ImageStrip'
import { EscolherNaBiblioteca } from './EscolherNaBiblioteca'

/**
 * O MEIO DO EDITOR SEM NADA ESCOLHIDO: as cenas na ordem do video, e o que
 * fazer a seguir.
 *
 * A fila de miniaturas morava aqui em cima o tempo todo, e com um bloco aberto
 * ela so repetia a faixa de cenas da linha do tempo -- 110 px a menos para os
 * controles. Agora ela e a visao geral: aparece quando nada esta escolhido (Esc
 * solta o bloco), e e onde se arrasta uma cena para outro lugar do video. Sem
 * isto o meio ficava um vazio preto.
 */
export function VisaoGeral() {
  const quantas = useProject((s) => s.images.length)
  // Os atalhos sao dele (Configuracoes): a dica mostra as teclas de agora.
  useAtalhos((s) => s.mapa)

  if (quantas === 0) return <EscolherNaBiblioteca />

  return (
    <div className="enter flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-[13px] font-medium text-ink">Cenas</h2>
        <span className="tnum text-[11px] text-ink-3">{quantas}</span>
        <span className="text-[11px] text-ink-3">· arraste para mudar a ordem</span>
      </div>
      <ImageStrip />

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-white/[0.04] text-ink-3">
          <MousePointerClick size={18} strokeWidth={1.5} />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-[13px] text-ink-2">Clique num bloco da linha do tempo para editar</p>
          <p className="text-[11px] text-ink-3">Enquadramento, movimento, ritmo e transição de cada cena aparecem aqui.</p>
        </div>
        <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
          <Dica acao="tocar" texto="tocar" />
          <Dica acao="cortar" texto="cortar na agulha" />
          <Dica acao="excluir" texto="apagar" />
          <Dica tecla="Esc" texto="soltar o que está escolhido" />
        </div>
      </div>
    </div>
  )
}

function Dica({ acao, tecla, texto }: { acao?: Acao; tecla?: string; texto: string }) {
  const combo = tecla ?? (acao ? dicaDoAtalho(acao) : undefined)
  if (!combo) return null
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
      <kbd className="rounded-[5px] border border-line-strong bg-elevated px-1.5 py-px font-sans text-[10px] text-ink-2">
        {combo}
      </kbd>
      {texto}
    </span>
  )
}
