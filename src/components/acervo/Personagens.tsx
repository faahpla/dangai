import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronRight, Combine, Loader2, X } from 'lucide-react'
import type { CenaDoAcervo, PersonagemDoAcervo } from '@shared/acervo'
import { useAcervo } from '@/store/acervo'
import { Rosto } from './Animes'
import { GradeDeCenas, MarcarCom } from './Cenas'

/**
 * OS PERSONAGENS DO ACERVO (25/11, "assim como no AnCut eu tenha a tela de
 * personagens, juntar personagem, marcar uma cena com tal personagem"): o
 * acervo visto por personagem, um anime por gaveta, e a pagina de cada um com
 * TODAS as cenas dele (atravessando episodios e temporadas). De la: marcar
 * cenas com outro, tirar dele, mandar para a lixeira, juntar com outro
 * personagem. (Renomear nao: o motor acha o personagem pelo nome, e o do
 * AniList volta com o nome de la na proxima analise.)
 *
 * As grafias do mesmo ("Hayakawa, Aki" e "Aki") ja chegam juntas do motor;
 * "Juntar" e para o que o motor nao junta sozinho (nomes diferentes da mesma
 * pessoa).
 */

/** Quanto ele tem NESTE anime (o numero da secao). */
function naSecao(p: PersonagemDoAcervo, anime: string): { cenas: number; episodios: number } {
  return p.porAnime.find((x) => x.anime.toLowerCase() === anime.toLowerCase()) ?? { cenas: p.cenas, episodios: p.episodios }
}

export function ListaDePersonagens() {
  const personagens = useAcervo((s) => s.personagens)
  const lendo = useAcervo((s) => s.lendoPersonagens)
  const [busca, setBusca] = useState('')
  const [fechadas, setFechadas] = useState<string[]>([])

  useEffect(() => {
    if (!personagens) void useAcervo.getState().lerPersonagens()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const secoes = useMemo(() => {
    const alvo = busca.trim().toLowerCase()
    const lista = (personagens ?? []).filter(
      (p) => !alvo || p.nome.toLowerCase().includes(alvo) || p.apelidos.some((a) => a.toLowerCase().includes(alvo)) || p.porAnime.some((a) => a.anime.toLowerCase().includes(alvo)),
    )
    const caixas = new Map<string, { anime: string; cenas: number; gente: PersonagemDoAcervo[] }>()
    for (const p of lista) {
      const partes = p.porAnime.length ? p.porAnime : [{ anime: '', cenas: p.cenas, episodios: p.episodios }]
      for (const parte of partes) {
        const c = caixas.get(parte.anime) ?? { anime: parte.anime, cenas: 0, gente: [] }
        c.cenas += parte.cenas
        c.gente.push(p)
        caixas.set(parte.anime, c)
      }
    }
    for (const c of caixas.values()) c.gente.sort((a, b) => naSecao(b, c.anime).cenas - naSecao(a, c.anime).cenas)
    return [...caixas.values()].sort((a, b) => a.anime.localeCompare(b.anime, 'pt-BR', { numeric: true }))
  }, [personagens, busca])

  if (!personagens) {
    return (
      <div className="grid flex-1 place-items-center">
        <p className="flex items-center gap-2 text-[12px] text-ink-3">
          <Loader2 size={14} className="animate-spin" /> Lendo os personagens (a primeira vez recorta os rostos, leva alguns segundos)…
        </p>
      </div>
    )
  }
  const buscando = busca.trim() !== ''
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5" data-acervo="personagens">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[12px] text-ink-3">
          {personagens.length} {personagens.length === 1 ? 'personagem' : 'personagens'} no acervo · clique para ver todas as cenas de um, de todos os episódios
        </p>
        {lendo && <Loader2 size={13} className="animate-spin text-ink-3" />}
        <span className="flex-1" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Procurar personagem ou anime…"
          aria-label="Procurar personagem"
          className="h-8 w-64 rounded-sm border border-line bg-elevated px-2.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
      </div>
      {secoes.length === 0 ? (
        <p className="py-12 text-center text-[13px] text-ink-3">{busca ? `Ninguém com “${busca}”.` : 'Nenhum personagem marcado ainda.'}</p>
      ) : (
        secoes.map((s) => {
          const fechada = !buscando && fechadas.includes(s.anime)
          return (
            <section key={s.anime} className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => setFechadas((f) => (f.includes(s.anime) ? f.filter((x) => x !== s.anime) : [...f, s.anime]))}
                className="flex items-center gap-2 text-left"
              >
                <ChevronRight size={14} className={['shrink-0 text-ink-3 transition-transform', fechada ? '' : 'rotate-90'].join(' ')} />
                <span className="truncate text-[14px] font-semibold text-ink">{s.anime || 'Sem anime'}</span>
                <span className="shrink-0 text-[11px] text-ink-3">
                  {s.gente.length} {s.gente.length === 1 ? 'personagem' : 'personagens'} · {s.cenas.toLocaleString('pt-BR')} cenas
                </span>
              </button>
              {!fechada && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
                  {s.gente.map((p) => {
                    const n = naSecao(p, s.anime)
                    return (
                      <button
                        key={p.nome}
                        type="button"
                        onClick={() => useAcervo.getState().abrirPersonagem(p, s.anime)}
                        title={p.apelidos.length ? `também: ${p.apelidos.join(', ')}` : p.nome}
                        className="lift flex flex-col items-center gap-1.5 rounded-md border border-line bg-surface px-2 pb-3 pt-3.5 text-center hover:border-accent/40"
                        data-acervo="personagem"
                      >
                        <Rosto url={p.rosto} nome={p.nome} tamanho={64} />
                        <span className="w-full truncate text-[12px] font-semibold text-ink">{p.nome}</span>
                        <span className="text-[10px] text-ink-3">
                          {n.cenas.toLocaleString('pt-BR')} cenas · {n.episodios} {n.episodios === 1 ? 'ep.' : 'eps.'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}

export function PaginaDoPersonagem({ p, anime }: { p: PersonagemDoAcervo; anime: string }) {
  const personagens = useAcervo((s) => s.personagens)
  const [cenas, setCenas] = useState<CenaDoAcervo[] | null>(null)
  const [lendo, setLendo] = useState(false)
  const [marcando, setMarcando] = useState<CenaDoAcervo[] | null>(null)
  const [juntar, setJuntar] = useState(false)
  const avisar = useAcervo.getState().avisar
  const n = naSecao(p, anime)

  const ler = async (): Promise<void> => {
    setLendo(true)
    const r = await window.dangai.acervoCenasDoPersonagem(p.ids, anime || undefined)
    setLendo(false)
    if (r.ok) setCenas(r.value)
    else avisar(r.error, false)
  }
  useEffect(() => {
    setCenas(null)
    void ler()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.ids.join(','), anime])

  /** Os outros do mesmo anime (para marcar e para juntar). */
  const doAnime = useMemo(
    () =>
      (personagens ?? [])
        .filter((x) => x.nome !== p.nome && x.ids[0] && (!anime || x.porAnime.some((a) => a.anime.toLowerCase() === anime.toLowerCase())))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [personagens, p.nome, anime],
  )

  const depois = async (): Promise<void> => {
    await ler()
    useAcervo.getState().mudou()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4" data-acervo="pagina-do-personagem">
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <button type="button" onClick={() => useAcervo.getState().abrirPersonagem(null)} className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-[12px] text-ink-2 hover:bg-surface hover:text-ink">
          <ArrowLeft size={13} />
          Personagens
        </button>
        <Rosto url={p.rosto} nome={p.nome} tamanho={44} />
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-[17px] font-bold text-ink">{p.nome}</h2>
          <p className="truncate text-[11px] text-ink-3" title={p.apelidos.join('\n')}>
            {anime ? `${anime} · ` : ''}
            {cenas ? cenas.length : n.cenas} cenas · {n.episodios} {n.episodios === 1 ? 'episódio' : 'episódios'}
            {p.apelidos.length > 0 ? ` · também: ${p.apelidos.join(', ')}` : ''}
          </p>
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setJuntar(true)}
          className="flex h-8 items-center gap-1.5 rounded-sm border border-line bg-elevated px-3 text-[12px] text-ink-2 hover:border-line-strong hover:text-ink"
          title="O mesmo personagem com outro nome: as cenas deste passam para o outro"
          data-acervo="juntar-personagem"
        >
          <Combine size={13} strokeWidth={1.75} />
          Juntar com outro…
        </button>
      </header>
      <GradeDeCenas
        cenas={cenas}
        carregando={lendo}
        vazio="Nenhuma cena deste personagem."
        mostrarEpisodio
        acoes={{
          marcar: (c) => setMarcando(c),
          tirar: {
            nome: p.nome,
            fazer: async (c) => {
              const r = await window.dangai.acervoMarcar(c.map((x) => x.id), p.ids[0]!, true)
              if (!r.ok) return avisar(r.error, false)
              avisar(`${r.value} ${r.value === 1 ? 'cena deixou' : 'cenas deixaram'} de ser de ${p.nome}.`)
              await depois()
            },
          },
          lixeira: async (c) => {
            const porEp = new Map<number, number[]>()
            for (const x of c) porEp.set(x.episodioId, [...(porEp.get(x.episodioId) ?? []), x.id])
            const r = await window.dangai.acervoLixeira([...porEp.entries()].map(([episodioId, cenaIds]) => ({ episodioId, cenaIds })))
            if (!r.ok) return avisar(r.error, false)
            avisar(`${r.value} ${r.value === 1 ? 'cena foi' : 'cenas foram'} para a lixeira do episódio.`)
            await depois()
          },
        }}
      />
      {marcando && (
        <MarcarCom
          quantas={marcando.length}
          opcoes={doAnime.map((x) => ({ id: x.ids[0]!, nome: x.nome, detalhe: `${naSecao(x, anime).cenas} cenas` }))}
          aoFechar={() => setMarcando(null)}
          aoEscolher={async (e) => {
            const ids = marcando.map((x) => x.id)
            const r = 'id' in e ? await window.dangai.acervoMarcar(ids, e.id, false) : await window.dangai.acervoMarcarComNome(ids, e.nome)
            if (!r.ok) throw new Error(r.error)
            setMarcando(null)
            avisar(`${r.value} ${r.value === 1 ? 'cena marcada' : 'cenas marcadas'} (continuam de ${p.nome} também: use "Tirar de ${p.nome}" se não for ele).`)
            await depois()
          }}
        />
      )}
      {juntar && <JuntarPersonagem p={p} anime={anime} outros={doAnime} aoFechar={() => setJuntar(false)} />}
    </div>
  )
}

/** Juntar com outro personagem: as cenas deste passam para o escolhido, e este sai de cada episodio. */
function JuntarPersonagem({ p, anime, outros, aoFechar }: { p: PersonagemDoAcervo; anime: string; outros: PersonagemDoAcervo[]; aoFechar: () => void }) {
  const [busca, setBusca] = useState('')
  const [escolhido, setEscolhido] = useState<PersonagemDoAcervo | null>(null)
  const [andamento, setAndamento] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const termo = busca.trim().toLowerCase()
  const visiveis = outros.filter((o) => !termo || o.nome.toLowerCase().includes(termo)).slice(0, 80)

  const fazer = async (): Promise<void> => {
    if (!escolhido) return
    if (!anime) return setErro('Abra o personagem pela seção do anime dele.')
    setErro('')
    setAndamento('Marcando as cenas…')
    const sair = window.dangai.onAcervo((e) => {
      if (e.tipo === 'juntar') setAndamento(`Tirando ${p.nome} dos episódios: ${e.feitos} de ${e.total}`)
    })
    try {
      const r = await window.dangai.acervoJuntarPersonagem({ ids: p.ids, anime }, { id: escolhido.ids[0]! })
      if (!r.ok) {
        setErro(r.error)
        setAndamento(null)
        return
      }
      useAcervo
        .getState()
        .avisar(`${p.nome} → ${escolhido.nome}: ${r.value.cenas} ${r.value.cenas === 1 ? 'cena' : 'cenas'} em ${r.value.episodios} ${r.value.episodios === 1 ? 'episódio' : 'episódios'}.`)
      aoFechar()
      useAcervo.getState().abrirPersonagem(null)
      useAcervo.getState().mudou()
    } finally {
      sair()
    }
  }

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || andamento) return
      e.stopPropagation()
      aoFechar()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [aoFechar, andamento])

  return (
    <div className="fixed inset-0 z-[66] grid place-items-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && !andamento && aoFechar()}>
      <div role="dialog" aria-label="Juntar personagem" style={{ backgroundColor: 'var(--color-elevated)' }} className="glass enter flex max-h-[84vh] w-[480px] max-w-full flex-col overflow-hidden rounded-lg" data-acervo="janela-juntar">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">Juntar {p.nome} com…</h2>
          {!andamento && (
            <button type="button" onClick={aoFechar} aria-label="Fechar" className="grid size-7 place-items-center rounded-sm text-ink-3 hover:text-ink">
              <X size={14} />
            </button>
          )}
        </header>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3 text-[12px] text-ink-2">
          <p>
            O mesmo personagem com outro nome: as cenas de <span className="font-semibold text-ink">{p.nome}</span>
            {anime ? ` em ${anime}` : ''} passam para o escolhido, e {p.nome} sai de cada episódio (um novo reconhecimento não traz ele de volta).
          </p>
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Procurar o personagem que fica…"
            aria-label="Personagem que fica"
            className="h-8 rounded-sm border border-line bg-surface px-2.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <div className="flex max-h-[40vh] flex-col gap-0.5 overflow-y-auto">
            {visiveis.map((o) => (
              <button
                key={o.nome}
                type="button"
                disabled={!!andamento}
                onClick={() => setEscolhido(o)}
                className={['flex items-center gap-2 rounded-sm px-2 py-1.5 text-left', escolhido?.nome === o.nome ? 'bg-accent-dim text-ink' : 'hover:bg-surface hover:text-ink'].join(' ')}
              >
                <Rosto url={o.rosto} nome={o.nome} tamanho={26} />
                <span className="min-w-0 flex-1 truncate">{o.nome}</span>
                <span className="text-[10px] text-ink-3">{naSecao(o, anime).cenas} cenas</span>
              </button>
            ))}
            {visiveis.length === 0 && <p className="px-2 py-2 text-ink-3">Ninguém mais neste anime{termo ? ` com “${busca}”` : ''}.</p>}
          </div>
          {andamento && (
            <p className="flex items-center gap-2 text-ink">
              <Loader2 size={13} className="animate-spin text-accent" /> {andamento}
            </p>
          )}
          {erro && <p className="text-danger">{erro}</p>}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={aoFechar} disabled={!!andamento} className="h-8 rounded-sm border border-line bg-surface px-4 text-[12px] text-ink-2 hover:text-ink disabled:opacity-40">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void fazer()}
            disabled={!escolhido || !!andamento}
            className="flex h-8 items-center gap-1.5 rounded-sm bg-accent px-4 text-[12px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
            data-acervo="confirmar-juntar"
          >
            <Combine size={13} strokeWidth={2} />
            {escolhido ? `Juntar em ${escolhido.nome}` : 'Juntar'}
          </button>
        </footer>
      </div>
    </div>
  )
}
