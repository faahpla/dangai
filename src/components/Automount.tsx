import { Wand2, Clapperboard, Lightbulb } from 'lucide-react'
import { useProject } from '@/store/project'
import type { AutomountMode } from '@shared/channels'

/**
 * A escolha entre recap e teoria, no instante em que ela existe.
 *
 * Aparece so quando ha narracao e nenhuma imagem -- que e exatamente o momento
 * depois de soltar o mp3 sozinho. Quem solta narracao E imagens nunca ve isto,
 * e o caminho manual continua intocado: montar sozinho e um segundo gesto no
 * mesmo lugar, nao um modo em que se entra.
 *
 * Sao dois botoes e nao um seletor porque a escolha e a acao. Um seletor
 * pediria dois cliques para a mesma decisao, e a spec so admite dois cliques do
 * arraste ao render.
 */
export function Automount() {
  const audio = useProject((s) => s.audio)
  const images = useProject((s) => s.images)
  const busy = useProject((s) => s.busy)
  const automount = useProject((s) => s.automount)

  if (!audio || images.length > 0) return null

  const opcoes: { mode: AutomountMode; icon: typeof Wand2; label: string; hint: string }[] = [
    {
      mode: 'recap',
      icon: Clapperboard,
      label: 'Montar recap',
      // A cronologia e a unica diferenca entre os dois modos, e e decisiva.
      hint: 'Segue a ordem do episodio: cada cena vem depois da anterior',
    },
    {
      mode: 'theory',
      icon: Lightbulb,
      label: 'Montar teoria',
      hint: 'Segue a ordem do argumento, misturando temporadas',
    },
  ]

  return (
    <div className="enter flex flex-col items-center gap-4 rounded-lg border border-dashed border-line p-8">
      <div className="flex items-center gap-2 text-[13px] text-ink-2">
        <Wand2 size={14} strokeWidth={1.5} className="text-accent" />
        Solte as cenas, ou deixe ele escolher pela narracao
      </div>

      <div className="flex gap-2">
        {opcoes.map(({ mode, icon: Icon, label, hint }) => (
          <button
            key={mode}
            type="button"
            onClick={() => void automount(mode)}
            disabled={busy !== null}
            title={hint}
            className="flex items-center gap-2 rounded-sm border border-line bg-bg px-4 py-2 text-[13px] text-ink transition-colors duration-150 hover:border-accent disabled:opacity-40"
          >
            <Icon size={14} strokeWidth={1.5} className="text-accent" />
            {label}
          </button>
        ))}
      </div>

      <p className="max-w-[420px] text-center text-[11px] leading-relaxed text-ink-3">
        Ele le a narracao, descobre quem esta em cada frase e escolhe uma cena da
        biblioteca para cada uma. Depois voce troca o que nao gostou.
      </p>
    </div>
  )
}
