import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Sparkles, Tag, Trash2, UserMinus, X } from 'lucide-react'
import { rotuloDoEpisodioDoAcervo, type CenaDoAcervo } from '@shared/acervo'

/**
 * A GRADE DE CENAS do Acervo (o episodio aberto, ou um personagem): o quadro
 * de cada cena, o clipe tocando sem som com o mouse em cima, e a selecao
 * (clique marca, Shift+clique marca o trecho, Ctrl+A todas). Com alguma
 * marcada, a barra de baixo: marcar com um personagem, tirar do personagem
 * aberto, mandar para a lixeira.
 */

export interface AcoesDaGrade {
  /** "Marcar com…" (abre a janela de escolher o personagem). */
  marcar: (cenas: CenaDoAcervo[]) => void
  /** "Tirar de <nome>" (so quando a grade e de um personagem). */
  tirar?: { nome: string; fazer: (cenas: CenaDoAcervo[]) => Promise<void> }
  lixeira: (cenas: CenaDoAcervo[]) => Promise<void>
  /** Confirma o palpite da cena sem ninguem ("E a Maomao?"). */
  confirmarPalpite?: (cena: CenaDoAcervo) => Promise<void>
}

export function GradeDeCenas({
  cenas,
  carregando,
  vazio,
  acoes,
  mostrarEpisodio = false,
}: {
  cenas: CenaDoAcervo[] | null
  carregando: boolean
  vazio: string
  acoes: AcoesDaGrade
  /** Na grade de um personagem (atravessa episodios): o rotulo do episodio em cada cena. */
  mostrarEpisodio?: boolean
}) {
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set())
  const [ultima, setUltima] = useState<number | null>(null)
  const [largura, setLargura] = useState(200)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const raiz = useRef<HTMLDivElement>(null)

  // Lista nova (outro personagem, outro episodio, depois de mudar): a selecao vale so para o que ainda esta la.
  useEffect(() => {
    if (!cenas) return
    setMarcadas((m) => new Set([...m].filter((id) => cenas.some((c) => c.id === id))))
  }, [cenas])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (!cenas || (e.target as HTMLElement | null)?.closest('input, textarea, select')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setMarcadas(new Set(cenas.map((c) => c.id)))
      }
      if (e.key === 'Escape' && marcadas.size > 0) {
        e.stopPropagation()
        setMarcadas(new Set())
      }
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [cenas, marcadas.size])

  const escolhidas = useMemo(() => (cenas ?? []).filter((c) => marcadas.has(c.id)), [cenas, marcadas])

  const clicar = (e: React.MouseEvent, c: CenaDoAcervo, i: number): void => {
    if (!cenas) return
    const trecho = e.shiftKey && ultima !== null ? [Math.min(ultima, i), Math.max(ultima, i)] : null
    // Pelo estado mais novo: cliques seguidos antes de a tela redesenhar nao se apagam.
    setMarcadas((antes) => {
      const novo = new Set(antes)
      if (trecho) for (let k = trecho[0]!; k <= trecho[1]!; k++) novo.add(cenas[k]!.id)
      else if (novo.has(c.id)) novo.delete(c.id)
      else novo.add(c.id)
      return novo
    })
    setUltima(i)
  }

  const fazer = async (rotulo: string, f: () => Promise<void>): Promise<void> => {
    setOcupado(rotulo)
    try {
      await f()
      setMarcadas(new Set())
    } finally {
      setOcupado(null)
    }
  }

  if (carregando && !cenas) {
    return (
      <div className="grid min-h-[220px] place-items-center">
        <Loader2 size={18} className="animate-spin text-ink-3" />
      </div>
    )
  }
  if (!cenas || cenas.length === 0) return <p className="py-12 text-center text-[12px] text-ink-3">{vazio}</p>

  return (
    <div ref={raiz} className="flex min-h-0 flex-1 flex-col" data-acervo="grade">
      <div className="mb-2 flex shrink-0 items-center gap-3 text-[11px] text-ink-3">
        <span>
          {cenas.length} {cenas.length === 1 ? 'cena' : 'cenas'} · clique para marcar, Shift+clique marca o trecho, Ctrl+A todas
        </span>
        <span className="flex-1" />
        {carregando && <Loader2 size={12} className="animate-spin" />}
        <label className="flex items-center gap-2">
          Tamanho
          <input type="range" min={130} max={340} step={10} value={largura} onChange={(e) => setLargura(Number(e.target.value))} className="h-1 w-24 accent-[var(--color-accent)]" />
        </label>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto pb-20" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${largura}px, 1fr))` }}>
        {cenas.map((c, i) => (
          <Cena
            key={c.id}
            cena={c}
            marcada={marcadas.has(c.id)}
            mostrarEpisodio={mostrarEpisodio}
            onClick={(e) => clicar(e, c, i)}
            onPalpite={
              acoes.confirmarPalpite && c.palpite
                ? () => void fazer('palpite', () => acoes.confirmarPalpite!(c))
                : undefined
            }
          />
        ))}
      </div>
      {escolhidas.length > 0 && (
        <div className="sticky bottom-0 z-10 -mt-16 flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-elevated px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.5)]" data-acervo="barra">
          <span className="text-[12px] text-ink">
            {escolhidas.length} {escolhidas.length === 1 ? 'cena marcada' : 'cenas marcadas'}
          </span>
          <button type="button" onClick={() => setMarcadas(new Set())} className="text-[11px] text-ink-3 hover:text-ink">
            Desmarcar
          </button>
          <span className="flex-1" />
          {ocupado && <Loader2 size={13} className="animate-spin text-ink-3" />}
          <button
            type="button"
            disabled={!!ocupado}
            onClick={() => acoes.marcar(escolhidas)}
            className="flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-[12px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
            data-acervo="marcar"
          >
            <Tag size={12} strokeWidth={2} />
            Marcar com…
          </button>
          {acoes.tirar && (
            <button
              type="button"
              disabled={!!ocupado}
              onClick={() => void fazer('tirar', () => acoes.tirar!.fazer(escolhidas))}
              className="flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-[12px] text-ink-2 hover:text-ink disabled:opacity-40"
              title={`As cenas continuam; só deixam de ser de ${acoes.tirar.nome}`}
              data-acervo="tirar"
            >
              <UserMinus size={12} strokeWidth={1.75} />
              Tirar de {acoes.tirar.nome}
            </button>
          )}
          <button
            type="button"
            disabled={!!ocupado}
            onClick={() => void fazer('lixeira', () => acoes.lixeira(escolhidas))}
            className="flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-[12px] text-ink-2 hover:border-danger/50 hover:text-danger disabled:opacity-40"
            title="As cenas saem do episódio; os arquivos vão para a pasta _lixeira dentro dele (dá para voltar)"
          >
            <Trash2 size={12} strokeWidth={1.75} />
            Lixeira
          </button>
        </div>
      )}
    </div>
  )
}

function Cena({
  cena,
  marcada,
  mostrarEpisodio,
  onClick,
  onPalpite,
}: {
  cena: CenaDoAcervo
  marcada: boolean
  mostrarEpisodio: boolean
  onClick: (e: React.MouseEvent) => void
  onPalpite?: () => void
}) {
  const [tocando, setTocando] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onMouseEnter={() => setTocando(true)}
      onMouseLeave={() => setTocando(false)}
      className={[
        'group relative aspect-video cursor-pointer overflow-hidden rounded-md border bg-black/40 transition-colors',
        marcada ? 'border-accent ring-2 ring-accent/50' : 'border-line hover:border-line-strong',
      ].join(' ')}
      data-acervo="cena"
    >
      {tocando && cena.video ? (
        <video src={cena.video} muted autoPlay loop playsInline className="size-full object-cover" />
      ) : cena.quadro ? (
        <img src={cena.quadro} alt="" loading="lazy" className="size-full object-cover" />
      ) : null}
      <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">{cena.duracao.toFixed(1)}s</span>
      {mostrarEpisodio && (
        <span className="absolute bottom-1 left-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
          {rotuloDoEpisodioDoAcervo({ tipo: cena.tipo, temporada: cena.temporada, episodio: cena.episodio, titulo: '' })}
        </span>
      )}
      <span className={['absolute left-1 top-1 grid size-5 place-items-center rounded-sm border', marcada ? 'border-accent bg-accent text-white' : 'border-white/40 bg-black/40 text-transparent group-hover:text-white/60'].join(' ')}>
        <Check size={12} strokeWidth={2.5} />
      </span>
      {cena.palpite && onPalpite && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onPalpite()
          }}
          title={`O reconhecimento acha que é ${cena.palpite.nome}, mas não teve certeza. Clique para confirmar.`}
          className="absolute right-1 top-1 flex max-w-[80%] items-center gap-1 rounded-full bg-black/75 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-accent"
        >
          <Sparkles size={10} />
          <span className="truncate">É {cena.palpite.nome}?</span>
        </button>
      )}
    </div>
  )
}

/** A janela de escolher o personagem para marcar as cenas (os do anime, ou um nome novo). */
export function MarcarCom({
  quantas,
  opcoes,
  aoEscolher,
  aoFechar,
}: {
  quantas: number
  /** Os personagens do anime (do episodio primeiro). */
  opcoes: { id: number; nome: string; detalhe?: string }[]
  aoEscolher: (escolha: { id: number } | { nome: string }) => Promise<void>
  aoFechar: () => void
}) {
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const termo = busca.trim().toLowerCase()
  const visiveis = opcoes.filter((o) => !termo || o.nome.toLowerCase().includes(termo)).slice(0, 60)
  const exato = opcoes.some((o) => o.nome.toLowerCase() === termo)
  const escolher = async (e: { id: number } | { nome: string }): Promise<void> => {
    setOcupado(true)
    setErro('')
    try {
      await aoEscolher(e)
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x))
      setOcupado(false)
    }
  }
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      aoFechar()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [aoFechar])
  return (
    <div className="fixed inset-0 z-[66] grid place-items-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div role="dialog" aria-label="Marcar com" style={{ backgroundColor: 'var(--color-elevated)' }} className="glass enter flex max-h-[80vh] w-[440px] max-w-full flex-col overflow-hidden rounded-lg" data-acervo="marcar-com">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
            Marcar {quantas} {quantas === 1 ? 'cena' : 'cenas'} com…
          </h2>
          <button type="button" onClick={aoFechar} aria-label="Fechar" className="grid size-7 place-items-center rounded-sm text-ink-3 hover:text-ink">
            <X size={14} />
          </button>
        </header>
        <div className="flex min-h-0 flex-col gap-2 px-4 py-3">
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && termo) {
                const um = visiveis[0]
                void escolher(um && um.nome.toLowerCase().includes(termo) ? { id: um.id } : { nome: busca.trim() })
              }
            }}
            placeholder="Procurar, ou digitar um nome novo"
            aria-label="Personagem"
            className="h-8 rounded-sm border border-line bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <div className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
            {visiveis.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={ocupado}
                onClick={() => void escolher({ id: o.id })}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-ink-2 hover:bg-surface hover:text-ink disabled:opacity-40"
              >
                <Tag size={12} strokeWidth={1.75} className="text-ink-3" />
                <span className="min-w-0 flex-1 truncate">{o.nome}</span>
                {o.detalhe && <span className="text-[10px] text-ink-3">{o.detalhe}</span>}
              </button>
            ))}
            {termo && !exato && (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void escolher({ nome: busca.trim() })}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-accent hover:bg-surface disabled:opacity-40"
              >
                <Tag size={12} strokeWidth={1.75} />
                Marcar como “{busca.trim()}” (personagem novo)
              </button>
            )}
            {opcoes.length === 0 && !termo && <p className="px-2 py-2 text-[12px] text-ink-3">Este anime ainda não tem personagem: digite o nome.</p>}
          </div>
          {ocupado && (
            <p className="flex items-center gap-2 text-[11px] text-ink-3">
              <Loader2 size={12} className="animate-spin" /> Marcando…
            </p>
          )}
          {erro && <p className="text-[11px] text-danger">{erro}</p>}
        </div>
      </div>
    </div>
  )
}
