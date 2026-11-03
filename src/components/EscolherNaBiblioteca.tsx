import { Library as LibraryIcon } from 'lucide-react'
import { useProject } from '@/store/project'

/**
 * A porta da Biblioteca enquanto ha narracao e nenhuma cena.
 *
 * Soltar a narracao ja abre a Biblioteca (ingest, no store). Isto e para depois
 * de fecha-la sem escolher: a narracao tira o app do estado vazio, e sem este
 * botao nao sobraria porta visivel -- "cade a outra mecanica?".
 *
 * Aqui moravam o "Montar tudo", o "Montar recap" e o "Montar teoria". Sairam na
 * 1.91: "nada disso da certo e eu nao quero mais perder tempo com isso".
 */
export function EscolherNaBiblioteca() {
  const visivel = useProject((s) => s.audio !== null && s.images.length === 0)
  const busy = useProject((s) => s.busy)
  const openLibrary = useProject((s) => s.openLibrary)

  if (!visivel) return null

  return (
    <div className="enter flex flex-col items-center gap-3 rounded-lg border border-dashed border-line p-8">
      <button
        type="button"
        onClick={() => void openLibrary(true)}
        disabled={busy !== null}
        title="Escolher as cenas de cada frase (Ctrl+B)"
        className="flex items-center gap-2 rounded-sm border border-accent bg-accent-dim px-4 py-2 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-accent/30 disabled:opacity-40"
      >
        <LibraryIcon size={14} strokeWidth={1.5} className="text-accent" />
        Escolher na biblioteca
      </button>
      <p className="text-[11px] text-ink-3">Ou solte as cenas aqui, na ordem do vídeo.</p>
    </div>
  )
}
