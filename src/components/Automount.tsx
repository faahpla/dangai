import { useEffect } from 'react'
import { Wand2, Clapperboard, Lightbulb, Library as LibraryIcon, Loader2 } from 'lucide-react'
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
 * O botao da Biblioteca fica AQUI ao lado, e nao so na tela vazia: soltar a
 * narracao ja tira o app do estado vazio, e ele ficou sem nenhuma porta visivel
 * para escolher as cenas na mao. Palavras dele: "cade a outra mecanica?".
 */
export function Automount() {
  const audio = useProject((s) => s.audio)
  const images = useProject((s) => s.images)
  const busy = useProject((s) => s.busy)
  const automount = useProject((s) => s.automount)
  const openLibrary = useProject((s) => s.openLibrary)
  const library = useProject((s) => s.library)
  const libraryBusy = useProject((s) => s.libraryBusy)
  const syncLibrary = useProject((s) => s.syncLibrary)
  const serie = useProject((s) => s.automountSeries)
  const setSerie = useProject((s) => s.setAutomountSeries)

  const visivel = audio !== null && images.length === 0

  /*
   * A lista de series vem da varredura, que pode nunca ter rodado nesta sessao.
   * Puxar aqui e o que faz a escolha existir antes do primeiro clique -- pedir
   * depois seria mostrar um seletor vazio.
   */
  useEffect(() => {
    if (visivel && !library && !libraryBusy) void syncLibrary()
  }, [visivel, library, libraryBusy, syncLibrary])

  if (!visivel) return null

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
        Solte as cenas, escolha na biblioteca, ou deixe ele montar
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[12px] text-ink-3" htmlFor="automount-serie">
          Anime
        </label>
        <select
          id="automount-serie"
          value={serie ?? ''}
          onChange={(e) => setSerie(e.target.value || null)}
          disabled={busy !== null || !library}
          className="min-w-[200px] rounded-sm border border-line bg-bg px-2 py-1.5 text-[12px] text-ink disabled:opacity-40"
        >
          {/* Deduzir continua sendo o padrao, mas dizer e uma linha so a menos de
              trabalho para um resultado que ele controla. */}
          <option value="">
            {library ? 'Descobrir pelo roteiro' : 'Lendo a biblioteca...'}
          </option>
          {(library?.animes ?? []).map((nome) => (
            <option key={nome} value={nome}>
              {nome}
            </option>
          ))}
        </select>
        {libraryBusy !== null && (
          <Loader2 size={13} strokeWidth={1.5} className="animate-spin text-ink-3" />
        )}
      </div>

      <div className="flex gap-2">
        {opcoes.map(({ mode, icon: Icon, label, hint }) => (
          <button
            key={mode}
            type="button"
            onClick={() => void automount(mode, serie)}
            disabled={busy !== null}
            title={hint}
            className="flex items-center gap-2 rounded-sm border border-line bg-bg px-4 py-2 text-[13px] text-ink transition-colors duration-150 hover:border-accent disabled:opacity-40"
          >
            <Icon size={14} strokeWidth={1.5} className="text-accent" />
            {label}
          </button>
        ))}

        <button
          type="button"
          onClick={() => void openLibrary(true)}
          disabled={busy !== null}
          title="Escolher as cenas na mao (Ctrl+B)"
          className="flex items-center gap-2 rounded-sm border border-line bg-bg px-4 py-2 text-[13px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink disabled:opacity-40"
        >
          <LibraryIcon size={14} strokeWidth={1.5} className="text-accent" />
          Escolher na biblioteca
        </button>
      </div>

      <p className="max-w-[440px] text-center text-[11px] leading-relaxed text-ink-3">
        Montar sozinho le a narracao, descobre quem esta em cada frase e traz uma
        cena para cada uma. Depois voce troca o que nao gostou.
      </p>
    </div>
  )
}
