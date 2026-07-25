import { Scissors } from 'lucide-react'
import { KEN_BURNS_EFFECTS, TRANSITIONS, type Transition } from '@shared/contract'
import { MIN_SCENE_SEC } from '@shared/plan'
import { useProject, formatTimecode } from '@/store/project'
import { Framing } from './Framing'

/**
 * Painel fino da cena selecionada. So aparece quando ha cena selecionada -- e o
 * terceiro elemento do estado "editando", nao uma coluna permanente.
 */
export function SceneCard() {
  const images = useProject((s) => s.images)
  const plan = useProject((s) => s.plan)
  const index = useProject((s) => s.selectedScene)
  const playhead = useProject((s) => s.playhead)
  const updateScene = useProject((s) => s.updateScene)
  const splitScene = useProject((s) => s.splitScene)
  const mergeSceneBack = useProject((s) => s.mergeSceneBack)

  const scene = index === null ? undefined : plan?.scenes[index]
  const image = scene ? images[scene.imageIndex] : undefined

  if (index === null || !scene || !image) return null

  // Quantos blocos esta imagem ocupa, e qual deles e este. So aparece quando ha
  // mais de um: com um so, a informacao seria ruido.
  const doImage = plan?.scenes.filter((item) => item.imageIndex === scene.imageIndex) ?? []
  const ordem = doImage.indexOf(scene) + 1

  const podeJuntar = plan?.scenes[index - 1]?.imageIndex === scene.imageIndex
  const podeDividir = scene.end - scene.start >= MIN_SCENE_SEC * 2
  const cortarEm = Math.min(Math.max(playhead, scene.start), scene.end)
  const agulhaDentro = playhead > scene.start && playhead < scene.end

  return (
    <aside className="enter flex w-[228px] shrink-0 flex-col gap-5 overflow-y-auto">
      <header className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink">Bloco {index + 1}</span>
        <span className="tnum text-[11px] text-ink-3">
          {(scene.end - scene.start).toFixed(1)}s
        </span>
      </header>

      <Field label="Entra em">
        <span className="tnum text-[13px] text-ink-2">{formatTimecode(scene.start)}</span>
      </Field>

      <Field label="Cortar">
        <div className="flex flex-col gap-1.5">
          <Chip
            active={false}
            disabled={!podeDividir}
            onClick={() =>
              splitScene(index, agulhaDentro ? cortarEm : (scene.start + scene.end) / 2)
            }
          >
            <Scissors size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            {agulhaDentro ? 'Dividir na agulha' : 'Dividir ao meio'}
          </Chip>
          {podeJuntar && (
            <Chip active={false} onClick={() => mergeSceneBack(index)}>
              Juntar com o anterior
            </Chip>
          )}
        </div>
      </Field>

      <Field label="Enquadramento">
        <Framing image={image} />
        {doImage.length > 1 && (
          <p className="text-[11px] leading-relaxed text-ink-3">
            Vale para os {doImage.length} blocos desta imagem — este e o {ordem}o.
          </p>
        )}
      </Field>

      <Field label="Movimento">
        <div className="grid grid-cols-2 gap-1.5">
          {KEN_BURNS_EFFECTS.map((effect) => (
            <Chip
              key={effect}
              active={scene.effect === effect}
              onClick={() => updateScene(index, { effect })}
            >
              {EFFECT_LABEL[effect]}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="Intensidade">
        <div className="flex items-center gap-2.5">
          <input
            type="range"
            min={0.04}
            max={0.15}
            step={0.01}
            value={scene.intensity}
            onChange={(event) =>
              updateScene(index, { intensity: Number(event.target.value) })
            }
            className="dangai-range min-w-0 flex-1"
          />
          <span className="tnum w-8 shrink-0 text-right text-[11px] text-ink-3">
            {Math.round(scene.intensity * 100)}%
          </span>
        </div>
      </Field>

      <Field label="Transicao de entrada">
        {index === 0 ? (
          <p className="text-[11px] leading-relaxed text-ink-3">
            O primeiro bloco nao tem de onde entrar.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {TRANSITIONS.map((transition) => (
              <Chip
                key={transition}
                active={scene.transitionIn === transition}
                onClick={() => updateScene(index, { transitionIn: transition })}
              >
                {TRANSITION_LABEL[transition]}
              </Chip>
            ))}
          </div>
        )}
      </Field>

      <p className="text-[11px] leading-relaxed text-ink-3">{image.fileName}</p>
    </aside>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium text-ink-2">{label}</span>
      {children}
    </div>
  )
}

function Chip({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'lift rounded-sm border px-2 py-1.5 text-[11px] disabled:opacity-40',
        active ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

const EFFECT_LABEL: Readonly<Record<(typeof KEN_BURNS_EFFECTS)[number], string>> = {
  'zoom-in': 'Zoom in',
  'zoom-out': 'Zoom out',
  'pan-left': 'Pan esq.',
  'pan-right': 'Pan dir.',
  'pan-up': 'Pan cima',
  'pan-down': 'Pan baixo',
}

const TRANSITION_LABEL: Readonly<Record<Transition, string>> = {
  cut: 'Corte seco',
  crossfade: 'Crossfade',
  'slide-left': 'Slide esquerda',
  'slide-right': 'Slide direita',
  'whip-pan': 'Whip-pan',
}
