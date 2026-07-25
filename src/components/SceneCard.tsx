import { KEN_BURNS_EFFECTS, TRANSITIONS, type Transition } from '@shared/contract'
import { useProject, formatTimecode } from '@/store/project'
import { Framing } from './Framing'

/**
 * Painel fino da cena selecionada. So aparece quando ha cena selecionada -- e o
 * terceiro elemento do estado "editando", nao uma coluna permanente.
 */
export function SceneCard() {
  const images = useProject((s) => s.images)
  const plan = useProject((s) => s.plan)
  const selectedImageId = useProject((s) => s.selectedImageId)
  const updateScene = useProject((s) => s.updateScene)

  const index = images.findIndex((image) => image.id === selectedImageId)
  const scene = index >= 0 ? plan?.scenes[index] : undefined
  const image = index >= 0 ? images[index] : undefined

  if (!scene || !image) return null

  return (
    <aside className="enter flex w-[228px] shrink-0 flex-col gap-5 overflow-y-auto">
      <header className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink">Cena {index + 1}</span>
        <span className="tnum text-[11px] text-ink-3">
          {(scene.end - scene.start).toFixed(1)}s
        </span>
      </header>

      <Field label="Entra em">
        <span className="tnum text-[13px] text-ink-2">{formatTimecode(scene.start)}</span>
      </Field>

      <Field label="Enquadramento">
        <Framing image={image} />
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
            A primeira cena nao tem de onde entrar.
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
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'lift rounded-sm border px-2 py-1.5 text-[11px]',
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
