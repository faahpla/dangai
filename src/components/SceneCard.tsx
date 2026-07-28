import { Film, ImagePlus, Scissors } from 'lucide-react'
import { isVisual } from '@shared/channels'
import {
  KEN_BURNS_EFFECTS,
  MOTION_CURVES,
  TRANSITIONS,
  type MotionCurve,
  type Transition,
} from '@shared/contract'
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
  const updateScene = useProject((s) => s.updateScene)
  const applyCurveToAll = useProject((s) => s.applyCurveToAll)
  const insertImages = useProject((s) => s.insertImages)

  const scene = index === null ? undefined : plan?.scenes[index]
  const image = scene ? images[scene.imageIndex] : undefined

  if (index === null || !scene || !image) return null

  const total = plan?.scenes.length ?? 0

  // O botao de aplicar em todos so aparece quando ha o que aplicar -- se o
  // video inteiro ja usa esta curva, ele nao faria nada.
  const mesmaCurvaEmTodas = plan?.scenes.every((s) => s.curve === scene.curve) ?? true

  const inserir = async (seconds: number): Promise<void> => {
    const picked = await window.dangai.pickFiles()
    if (!picked.ok) return
    const imagens = picked.value.filter((path) => isVisual(path))
    if (imagens.length > 0) await insertImages(imagens, seconds)
  }

  return (
    <aside className="enter flex w-[228px] shrink-0 flex-col gap-5 overflow-y-auto">
      <header className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink">
          Bloco {index + 1} <span className="text-ink-3">de {total}</span>
        </span>
        <span className="tnum text-[11px] text-ink-3">
          {(scene.end - scene.start).toFixed(1)}s
        </span>
      </header>

      <Field label="Entra em">
        <span className="tnum text-[13px] text-ink-2">{formatTimecode(scene.start)}</span>
      </Field>

      <Field label="Inserir imagem">
        <div className="flex flex-col gap-1.5">
          <Chip active={false} onClick={() => void inserir(scene.start)}>
            <ImagePlus size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            Antes deste bloco
          </Chip>
          <Chip active={false} onClick={() => void inserir((scene.start + scene.end) / 2)}>
            <Scissors size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            No meio, cortando ao meio
          </Chip>
          <Chip active={false} onClick={() => void inserir(scene.end)}>
            <ImagePlus size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            Depois deste bloco
          </Chip>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-3">
          O tempo sai deste bloco, entao o resto da linha do tempo nao se mexe. Arrastar imagens
          direto na timeline faz o mesmo.
        </p>
      </Field>

      <Field label="Enquadramento">
        <Framing image={image} />
      </Field>

      {/*
        Clipe nao tem controle de movimento -- ele ja se move sozinho, e o Ken
        Burns fica desligado nele. Esconder os controles em vez de deixa-los
        inertes: um controle que nao faz nada e pior que um controle ausente,
        porque o usuario mexe e culpa o render.
      */}
      {image.kind === 'video' ? (
        <Field label="Movimento">
          <p className="text-[11px] leading-relaxed text-ink-3">
            O clipe ja tem o movimento dele, entao o app nao acrescenta nenhum. Os blocos de print
            continuam com o movimento normal.
          </p>
        </Field>
      ) : (
        <>
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
                onChange={(event) => updateScene(index, { intensity: Number(event.target.value) })}
                className="dangai-range min-w-0 flex-1"
              />
              <span className="tnum w-8 shrink-0 text-right text-[11px] text-ink-3">
                {Math.round(scene.intensity * 100)}%
              </span>
            </div>
          </Field>

          <Field label="Ritmo do movimento">
            <div className="grid grid-cols-2 gap-1.5">
              {MOTION_CURVES.map((curve) => (
                <Chip
                  key={curve}
                  active={scene.curve === curve}
                  onClick={() => updateScene(index, { curve })}
                >
                  {CURVE_LABEL[curve]}
                </Chip>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-ink-3">{CURVE_HINT[scene.curve]}</p>
            {total > 1 && !mesmaCurvaEmTodas && (
              <Chip active={false} onClick={() => applyCurveToAll(scene.curve)}>
                Usar em todos os {total} blocos
              </Chip>
            )}
          </Field>
        </>
      )}

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

      <p className="flex items-baseline gap-1.5 text-[11px] leading-relaxed text-ink-3">
        {/* Miniatura de clipe e miniatura de print sao a mesma coisa na tela.
            Sem esta marca nao da para saber qual bloco e qual. */}
        {image.kind === 'video' && (
          <span className="flex items-center gap-1 text-accent">
            <Film size={11} strokeWidth={1.5} />
            clipe
          </span>
        )}
        <span className="min-w-0 truncate">{image.fileName}</span>
      </p>
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

/**
 * Nomeadas pelo que se ve, nao pelo nome tecnico.
 *
 * "ease-out" nao diz nada para quem esta montando um short -- e pior, o nome
 * sugere o contrario do que faz.
 */
const CURVE_LABEL: Readonly<Record<MotionCurve, string>> = {
  'ease-in-out': 'Suave',
  linear: 'Constante',
  'ease-out': 'Desacelera',
  'ease-in': 'Acelera',
}

const CURVE_HINT: Readonly<Record<MotionCurve, string>> = {
  'ease-in-out': 'Parte devagar e para devagar. E o que o app sempre fez.',
  linear: 'Mesma velocidade do inicio ao fim. Num movimento lento, fica menos travado que o suave.',
  'ease-out': 'Parte rapido e pousa. Bom para revelacao.',
  'ease-in': 'Parte devagar e acelera. Cria tensao entrando no corte.',
}

const TRANSITION_LABEL: Readonly<Record<Transition, string>> = {
  cut: 'Corte seco',
  crossfade: 'Crossfade',
  'slide-left': 'Slide esquerda',
  'slide-right': 'Slide direita',
  'whip-pan': 'Whip-pan',
}
