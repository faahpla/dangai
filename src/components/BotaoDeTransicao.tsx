import { useRef, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { useProject } from '@/store/project'
import { EditorDaEmenda } from './EditorDeTransicao'

/**
 * O BOTAO "TRANSICAO" na barra acima da linha do tempo.
 *
 * Abre o mesmo editor do botao direito nas emendas: com um bloco escolhido,
 * a entrada ou a saida dele; sem bloco, o corte mais perto da agulha. As
 * transicoes ali tambem ARRASTAM -- da para pegar um Zoom in e soltar em
 * qualquer corte da linha do tempo sem fechar nada.
 */
export function BotaoDeTransicao() {
  const plan = useProject((s) => s.plan)
  const index = useProject((s) => s.selectedScene)
  const playhead = useProject((s) => s.playhead)
  const duracao = useProject((s) => s.audio?.durationSec ?? 0)
  const [aberto, setAberto] = useState<{ x: number; y: number } | null>(null)
  const [lado, setLado] = useState<'entrada' | 'saida'>('entrada')
  const botao = useRef<HTMLButtonElement | null>(null)

  const scenes = plan?.scenes ?? []
  if (scenes.length === 0) return null

  const pertoDaAgulha = (): number => {
    const tempos = [0, ...scenes.slice(1).map((s) => s.start), duracao]
    let melhor = 0
    for (let e = 1; e < tempos.length; e++) {
      if (Math.abs(tempos[e]! - playhead) < Math.abs(tempos[melhor]! - playhead)) melhor = e
    }
    return melhor
  }
  const emenda = index === null || !scenes[index] ? pertoDaAgulha() : lado === 'entrada' ? index : index + 1
  const temAlgo =
    index !== null &&
    (scenes[index]?.transitionIn !== 'cut' ||
      (index + 1 < scenes.length ? scenes[index + 1]!.transitionIn !== 'cut' : scenes[index]?.transitionOut !== undefined))

  return (
    <div className="relative">
      <button
        ref={botao}
        type="button"
        onClick={() => {
          if (aberto) {
            setAberto(null)
            return
          }
          const r = botao.current?.getBoundingClientRect()
          // Abre para cima: o botao mora na barra logo acima da linha do tempo.
          setAberto(r ? { x: r.left + r.width / 2, y: r.top - 8 } : { x: 400, y: 300 })
        }}
        title="Transicoes: Zoom, Light, Pan... (clique, ou botao direito num corte da linha do tempo)"
        className={[
          'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
          aberto ? 'border-line-strong bg-elevated text-ink' : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
        ].join(' ')}
      >
        <ArrowLeftRight size={12} strokeWidth={1.5} className={temAlgo ? 'text-accent' : undefined} />
        Transicao
      </button>
      {aberto && (
        <EditorDaEmenda
          emenda={emenda}
          x={aberto.x}
          y={aberto.y}
          onFechar={() => setAberto(null)}
          ignorar={botao}
          topo={
            index !== null && scenes[index] ? (
              <div className="grid grid-cols-2 gap-1">
                {(['entrada', 'saida'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLado(l)}
                    className={[
                      'rounded-sm border px-2 py-1 text-[11px]',
                      lado === l ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-3 hover:text-ink',
                    ].join(' ')}
                  >
                    {l === 'entrada' ? `Entrada do bloco ${index + 1}` : `Saida do bloco ${index + 1}`}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-ink-3">
                Sem bloco escolhido: vale o corte mais perto da agulha. Arraste uma transicao ate qualquer corte, ou
                clique com o botao direito nele.
              </p>
            )
          }
        />
      )}
    </div>
  )
}
