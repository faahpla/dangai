import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { TRANSITIONS_NA_TELA, type Transition } from '@shared/contract'
import { useProject } from '@/store/project'

/**
 * A TRANSICAO do bloco escolhido, atras de um botao na barra.
 *
 * "Esse campo de transicao eu nao tenho usado muito, entao pode deixar ele mais
 * escondido, pode ser ate como um dos botoes que ficam acima da timeline." O
 * painel do bloco ganha o espaco de volta, e a transicao continua a um clique:
 * entrada (a emenda com o bloco anterior) e saida (a emenda com o seguinte).
 */

export const TRANSITION_LABEL: Readonly<Record<Transition, string>> = {
  cut: 'Corte seco',
  crossfade: 'Crossfade',
  'slide-left': 'Desliza p/ esquerda',
  'slide-right': 'Desliza p/ direita',
  'whip-pan-left': 'Whip-pan p/ esquerda',
  'whip-pan-right': 'Whip-pan p/ direita',
  // Fora da tela: so chega de projeto salvo antes de o par existir.
  'whip-pan': 'Whip-pan p/ esquerda',
}

export function BotaoDeTransicao() {
  const plan = useProject((s) => s.plan)
  const index = useProject((s) => s.selectedScene)
  const updateScene = useProject((s) => s.updateScene)
  const [aberto, setAberto] = useState(false)

  const scene = index === null ? undefined : plan?.scenes[index]
  if (index === null || !scene) return null
  const proxima = plan?.scenes[index + 1]
  const temAlgo = scene.transitionIn !== 'cut' || (proxima !== undefined && proxima.transitionIn !== 'cut')

  const opcoes = (atual: Transition, escolher: (t: Transition) => void) => (
    <div className="mt-1.5 grid grid-cols-2 gap-1">
      {TRANSITIONS_NA_TELA.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => escolher(t)}
          className={[
            'rounded-sm border px-2 py-1 text-[11px]',
            atual === t ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:text-ink',
          ].join(' ')}
        >
          {TRANSITION_LABEL[t]}
        </button>
      ))}
    </div>
  )

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title={`Transicao do bloco ${index + 1}`}
        className={[
          'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
          aberto ? 'border-line-strong bg-elevated text-ink' : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
        ].join(' ')}
      >
        <ArrowLeftRight size={12} strokeWidth={1.5} className={temAlgo ? 'text-accent' : undefined} />
        Transicao
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={() => setAberto(false)} />
          <div className="glass enter absolute bottom-[calc(100%+6px)] left-0 z-50 w-[360px] rounded-md p-3">
            <span className="text-[10px] uppercase tracking-wide text-ink-3">
              Entrada do bloco {index + 1} (emenda com o anterior)
            </span>
            {index === 0 ? (
              <p className="mt-1 text-[11px] text-ink-3">O primeiro bloco nao tem de onde entrar.</p>
            ) : (
              opcoes(scene.transitionIn, (t) => updateScene(index, { transitionIn: t }))
            )}
            <span className="mt-3 block text-[10px] uppercase tracking-wide text-ink-3">
              Saida (emenda com o proximo)
            </span>
            {proxima === undefined ? (
              <p className="mt-1 text-[11px] text-ink-3">O ultimo bloco nao tem para onde sair.</p>
            ) : (
              // Escreve no bloco SEGUINTE: e a entrada dele que descreve esta emenda.
              opcoes(proxima.transitionIn, (t) => updateScene(index + 1, { transitionIn: t }))
            )}
          </div>
        </>
      )}
    </div>
  )
}
