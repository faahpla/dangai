import { Fragment } from 'react'
import { AudioWaveform, Check, ChevronRight, Clapperboard, FileText, Library as LibraryIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProject } from '@/store/project'
import { etapaAtual, type Etapa } from '@/store/projeto/etapas'

const ETAPAS: { id: Etapa; nome: string; dica: string; icone: typeof Check }[] = [
  { id: 'audio', nome: 'Áudio', dica: 'Cortar a gravação e os efeitos da voz', icone: AudioWaveform },
  { id: 'roteiro', nome: 'Roteiro', dica: 'O roteiro entra e as legendas são sincronizadas com a voz', icone: FileText },
  { id: 'cenas', nome: 'Cenas', dica: 'Escolher as cenas de cada frase na Biblioteca', icone: LibraryIcon },
  { id: 'edicao', nome: 'Edição', dica: 'A linha do tempo, os efeitos e o render', icone: Clapperboard },
]

/**
 * A BARRA DE ETAPAS: Audio -> Roteiro -> Cenas -> Edicao. Diz onde ele esta e
 * leva de uma tela para a outra; a que ja foi feita ganha o certo. Aparece no
 * topo de cada etapa e na barra do editor, sempre a mesma.
 */
export function BarraDeEtapas({ compacta = false }: { compacta?: boolean }) {
  const atual = useProject(etapaAtual)
  const feitas = useProject(
    useShallow((s) => ({
      audio: s.edicaoDeAudio?.saida != null,
      roteiro: s.scriptBlocks !== null,
      cenas: s.images.length > 0,
      edicao: false,
    })),
  )
  const temNarracao = useProject((s) => s.audio !== null)
  const ocupado = useProject((s) => s.busy !== null || s.render !== null)
  const ir = useProject((s) => s.irParaEtapa)
  if (!temNarracao) return null

  return (
    <nav aria-label="Etapas do vídeo" className="flex shrink-0 items-center gap-0.5">
      {ETAPAS.map((e, i) => {
        const aqui = atual === e.id
        const feita = feitas[e.id] && !aqui
        const Icone = e.icone
        return (
          <Fragment key={e.id}>
            {i > 0 && <ChevronRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-3/60" />}
            <button
              type="button"
              onClick={() => void ir(e.id)}
              disabled={aqui || ocupado}
              aria-current={aqui ? 'step' : undefined}
              title={`${i + 1}. ${e.nome}: ${e.dica}`}
              className={[
                'flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] transition-colors',
                aqui ? 'bg-accent-dim font-medium text-ink ring-1 ring-inset ring-accent' : 'text-ink-3 hover:bg-elevated hover:text-ink-2',
                ocupado && !aqui ? 'opacity-50' : '',
              ].join(' ')}
            >
              {feita ? (
                <Check size={12} strokeWidth={2} className="text-accent" />
              ) : (
                <Icone size={12} strokeWidth={1.5} className={aqui ? 'text-accent' : ''} />
              )}
              {/* Na barra do editor apertada, so os icones (o mesmo "compacto" dos outros botoes de la). */}
              <span className={compacta ? 'hidden' : 'group-data-[compacto]/barra:hidden'}>{e.nome}</span>
            </button>
          </Fragment>
        )
      })}
    </nav>
  )
}
