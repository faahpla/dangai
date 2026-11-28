import { useState } from 'react'
import { Check, Stamp } from 'lucide-react'
import { NOME_DO_MODO } from '@shared/marca-dagua'
import { useProject } from '@/store/project'
import { escolherMarca, useMarcas } from '@/store/marca-dagua'
import { botaoDaBarra } from './barra'

/**
 * A MARCA D'AGUA DESTE VIDEO, na barra de cima: "Marca: Dopanimes". Escolher
 * aqui vale para o video aberto e vira a do proximo. Os canais se cadastram
 * nas Configuracoes (a pagina "Marca d'agua").
 */
export function BotaoDaMarca() {
  const marcaDagua = useProject((s) => s.marcaDagua)
  const openSettings = useProject((s) => s.openSettings)
  const lista = useMarcas((s) => s.lista)
  const [aberto, setAberto] = useState(false)
  const atual = lista.find((m) => m.id === marcaDagua) ?? null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title="Marca d'água do canal neste vídeo"
        aria-label="Marca d'água"
        aria-pressed={aberto}
        className={botaoDaBarra(aberto ? 'aberto' : 'normal')}
      >
        <Stamp size={14} strokeWidth={1.5} className={atual ? 'text-accent' : undefined} />
        <span className="max-w-[120px] truncate group-data-[compacto]/barra:hidden">{atual ? atual.nome : 'Marca'}</span>
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={() => setAberto(false)} />
          <div className="glass enter absolute top-[calc(100%+6px)] left-0 z-50 flex w-[240px] flex-col gap-0.5 rounded-md p-1.5" data-marca="menu">
            <span className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide text-ink-3">Marca d'água</span>
            <Opcao ativa={!atual} onClick={() => { escolherMarca(''); setAberto(false) }}>
              Nenhuma
            </Opcao>
            {lista.map((m) => (
              <Opcao key={m.id} ativa={atual?.id === m.id} onClick={() => { escolherMarca(m.id); setAberto(false) }} detalhe={NOME_DO_MODO[m.modo]}>
                {m.nome}
              </Opcao>
            ))}
            <button
              type="button"
              onClick={() => {
                setAberto(false)
                openSettings(true, 'marca-dagua')
              }}
              className="mt-1 rounded-sm border-t border-line px-2 pt-2 pb-1 text-left text-[11px] text-ink-3 hover:text-ink"
            >
              {lista.length === 0 ? 'Cadastrar a marca de um canal…' : 'Cadastrar ou mudar os canais…'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Opcao({
  ativa,
  onClick,
  detalhe,
  children,
}: {
  ativa: boolean
  onClick: () => void
  detalhe?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className={[
        'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px]',
        ativa ? 'bg-accent-dim text-ink' : 'text-ink-2 hover:bg-elevated hover:text-ink',
      ].join(' ')}
    >
      <span className="grid size-3 shrink-0 place-items-center">{ativa && <Check size={11} strokeWidth={2.25} />}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {detalhe && <span className="shrink-0 text-[10px] text-ink-3">{detalhe}</span>}
    </button>
  )
}
