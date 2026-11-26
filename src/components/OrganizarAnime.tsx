import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { ArrowRight, Combine, Film, Loader2, RefreshCw, ScanFace, Sparkles, TriangleAlert, Users, X } from 'lucide-react'
import type { EpisodioNoAncut, PlanoDeJuntarAnimes, PlanoDeRenomear } from '@shared/ancut'
import type { LibraryClip } from '@shared/channels'
import { useCortar } from '@/store/cortar-episodios'
import { useProject } from '@/store/project'
import { ComoReconhecer } from './ComoReconhecer'
import { avisarNaBiblioteca, Janela, releBiblioteca, useRevisarCena } from './RevisarCena'

/**
 * ORGANIZAR A BIBLIOTECA (23/11, "a estrutura do AnCut no Dangai"): o botao
 * direito num anime ou num episodio da coluna da Biblioteca faz o que ele
 * fazia na Biblioteca do AnCut -- juntar dois animes numa pasta so, mudar a
 * temporada, passar para B-roll, ver e corrigir os personagens do episodio,
 * reconhecer depois de um "So cortar", reforcar as fotos e repescar.
 *
 * Quem muda e o motor (electron/services/ancut/organizar.ts), em dois tempos:
 * o plano primeiro (o que vai mudar de nome, o que vai mover), e so depois o
 * "Juntar"/"Mudar". Depois, a Biblioteca le de novo o que mudou.
 */

/** Um anime ou um episodio da coluna, com os clipes que o representam (um por episodio). */
export interface AlvoDoOrganizar {
  tipo: 'anime' | 'episodio'
  anime: string
  /** "S01E04" (so no episodio). */
  chave?: string
  clipes: LibraryClip[]
}

type Dialogo = 'juntar' | 'temporada' | 'broll' | 'personagens' | 'reforcar' | 'repescar'

export const useOrganizar = create<{
  menu: { alvo: AlvoDoOrganizar; x: number; y: number } | null
  dialogo: { tipo: Dialogo; alvo: AlvoDoOrganizar } | null
}>(() => ({ menu: null, dialogo: null }))

/** O botao direito num anime ou episodio da coluna. */
export function abrirMenuDoOrganizar(e: React.MouseEvent, alvo: AlvoDoOrganizar): void {
  e.preventDefault()
  if (alvo.clipes.length === 0) {
    avisarNaBiblioteca('Isto não veio do corte (é uma pasta solta, mangá ou filme de fora): não há o que organizar aqui.')
    return
  }
  useOrganizar.setState({ menu: { alvo, x: e.clientX, y: e.clientY } })
}

export function OrganizarAnime() {
  const menu = useOrganizar((s) => s.menu)
  const dialogo = useOrganizar((s) => s.dialogo)
  return createPortal(
    <>
      {menu && <Menu alvo={menu.alvo} x={menu.x} y={menu.y} />}
      {dialogo?.tipo === 'juntar' && <JuntarAnimes alvo={dialogo.alvo} />}
      {dialogo?.tipo === 'temporada' && <MudarTemporada alvo={dialogo.alvo} />}
      {dialogo?.tipo === 'broll' && <PassarParaBroll alvo={dialogo.alvo} />}
      {dialogo?.tipo === 'personagens' && <PersonagensDoEpisodio alvo={dialogo.alvo} />}
      {(dialogo?.tipo === 'reforcar' || dialogo?.tipo === 'repescar') && <Trabalho tipo={dialogo.tipo} alvo={dialogo.alvo} />}
    </>,
    document.body,
  )
}

const fecharDialogo = (): void => useOrganizar.setState({ dialogo: null })
const abrir = (tipo: Dialogo, alvo: AlvoDoOrganizar): void => useOrganizar.setState({ menu: null, dialogo: { tipo, alvo } })

function Menu({ alvo, x: x0, y: y0 }: { alvo: AlvoDoOrganizar; x: number; y: number }) {
  useEffect(() => {
    const fora = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement | null)?.closest('[data-organizar="menu"]')) useOrganizar.setState({ menu: null })
    }
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      useOrganizar.setState({ menu: null })
    }
    window.addEventListener('mousedown', fora, true)
    window.addEventListener('keydown', tecla, true)
    return () => {
      window.removeEventListener('mousedown', fora, true)
      window.removeEventListener('keydown', tecla, true)
    }
  }, [])
  const ep = alvo.tipo === 'episodio'
  const x = Math.min(x0, window.innerWidth - 290)
  const y = Math.min(y0, window.innerHeight - (ep ? 340 : 190))
  const item = 'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface hover:text-ink'
  return (
    <div role="menu" data-organizar="menu" style={{ left: x, top: y }} className="enter fixed z-[70] w-[280px] rounded-md border border-line bg-elevated p-1 shadow-[0_14px_40px_rgba(0,0,0,0.55)]">
      <p className="truncate px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {ep ? `${alvo.anime} · ${alvo.chave}` : `${alvo.anime} · ${alvo.clipes.length} ${alvo.clipes.length === 1 ? 'episódio' : 'episódios'}`}
      </p>
      {ep ? (
        <>
          <button type="button" role="menuitem" className={item} onClick={() => abrir('personagens', alvo)} title="Quem está no episódio, quantas cenas cada um, tirar o errado e reconhecer de novo">
            <Users size={14} strokeWidth={1.75} />
            Personagens do episódio…
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => abrir('reforcar', alvo)} title="Os rostos mais confiáveis deste episódio viram foto do elenco: o reconhecimento dos próximos melhora. Só acrescenta.">
            <Sparkles size={14} strokeWidth={1.75} />
            Reforçar as fotos do elenco
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => abrir('repescar', alvo)} title="Passa de novo pelas cenas sem ninguém marcado e marca quem dá para reconhecer">
            <RefreshCw size={14} strokeWidth={1.75} />
            Repescar quem ficou sem marcação
          </button>
          <div className="my-1 h-px bg-line" />
          <button type="button" role="menuitem" className={item} onClick={() => abrir('temporada', alvo)}>
            <ArrowRight size={14} strokeWidth={1.75} />
            Mudar a temporada…
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => abrir('broll', alvo)} title="Trailer, abertura ou vídeo que entrou como episódio vira B-roll do anime">
            <Film size={14} strokeWidth={1.75} />
            Passar para B-roll…
          </button>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[12px] text-danger transition-colors hover:bg-danger/10"
            onClick={() => {
              useOrganizar.setState({ menu: null })
              useRevisarCena.setState({ apagarDe: alvo.clipes[0] ?? null })
            }}
          >
            <TriangleAlert size={14} strokeWidth={1.75} />
            Apagar o episódio inteiro…
          </button>
        </>
      ) : (
        <>
          <button type="button" role="menuitem" className={item} onClick={() => abrir('juntar', alvo)} title="O mesmo anime em duas pastas (nomes diferentes): os episódios passam para uma só">
            <Combine size={14} strokeWidth={1.75} />
            Juntar com outro anime…
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => abrir('temporada', alvo)} title="Todos os episódios deste anime">
            <ArrowRight size={14} strokeWidth={1.75} />
            Mudar a temporada de todos…
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => abrir('repescar', alvo)} title="Em todos os episódios: marca quem ficou sem marcação">
            <RefreshCw size={14} strokeWidth={1.75} />
            Repescar quem ficou sem marcação
          </button>
        </>
      )}
    </div>
  )
}

const botao = 'h-8 rounded-sm border border-line bg-elevated px-4 text-[12px] text-ink-2 hover:text-ink disabled:opacity-40'
const principal = 'flex h-8 items-center gap-1.5 rounded-sm bg-accent px-4 text-[12px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40'
const ultimaPasta = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

function Conflitos({ conflitos, erro }: { conflitos: string[]; erro: string }) {
  return (
    <>
      {erro && <p className="text-[12px] text-danger">{erro}</p>}
      {conflitos.length > 0 && (
        <div className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-ink">
          <p className="mb-1 font-medium">Já existe no destino:</p>
          {conflitos.slice(0, 8).map((c) => (
            <p key={c} className="truncate text-ink-3" title={c}>
              {ultimaPasta(c)}
            </p>
          ))}
          {conflitos.length > 8 && <p className="text-ink-3">e mais {conflitos.length - 8}</p>}
        </div>
      )}
    </>
  )
}

// --------------------------------------------------------------- juntar

function JuntarAnimes({ alvo }: { alvo: AlvoDoOrganizar }) {
  const clipe = alvo.clipes[0]!.path
  const [vizinhos, setVizinhos] = useState<string[] | null>(null)
  const [destino, setDestino] = useState('')
  const [plano, setPlano] = useState<PlanoDeJuntarAnimes | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  useEffect(() => {
    void window.dangai.ancutAnimesVizinhos(clipe).then((r) => setVizinhos(r.ok ? r.value : []))
  }, [clipe])
  useEffect(() => {
    if (!destino) return setPlano(null)
    let vivo = true
    setOcupado(true)
    setErro('')
    void window.dangai.ancutJuntarAnimes(clipe, destino, false).then((r) => {
      if (!vivo) return
      setOcupado(false)
      if (r.ok) setPlano(r.value)
      else setErro(r.error)
    })
    return () => {
      vivo = false
    }
  }, [clipe, destino])
  const juntar = async (): Promise<void> => {
    setOcupado(true)
    const r = await window.dangai.ancutJuntarAnimes(clipe, destino, true)
    setOcupado(false)
    if (!r.ok) return setErro(r.error)
    if (!r.value.aplicado) return setPlano(r.value)
    fecharDialogo()
    avisarNaBiblioteca(`${r.value.mover.length} ${r.value.mover.length === 1 ? 'episódio passou' : 'episódios passaram'} para ${ultimaPasta(r.value.destino)}.`)
    releBiblioteca()
  }
  return (
    <Janela titulo={`Juntar ${alvo.anime} com outro anime`} aoFechar={fecharDialogo} largura={520}>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4 text-[12px] text-ink-2" data-organizar="juntar">
        <p>
          Os episódios de <span className="font-semibold text-ink">{alvo.anime}</span> passam para a pasta escolhida, e o histórico (personagens, favoritos) vai junto.
        </p>
        {vizinhos === null ? (
          <p className="flex items-center gap-2 text-ink-3">
            <Loader2 size={13} className="animate-spin" /> Lendo as pastas…
          </p>
        ) : vizinhos.length === 0 ? (
          <p className="text-ink-3">Não há outra pasta de anime ao lado desta.</p>
        ) : (
          <select value={destino} onChange={(e) => setDestino(e.target.value)} className="h-8 rounded-sm border border-line bg-elevated px-2 text-[12px] text-ink focus:border-accent focus:outline-none" aria-label="Juntar com">
            <option value="">Escolha o anime que fica…</option>
            {vizinhos.map((v) => (
              <option key={v} value={v}>
                {ultimaPasta(v)}
              </option>
            ))}
          </select>
        )}
        {ocupado && !plano && (
          <p className="flex items-center gap-2 text-ink-3">
            <Loader2 size={13} className="animate-spin" /> Vendo o que muda…
          </p>
        )}
        {plano && (
          <>
            <p>
              {plano.mover.length} {plano.mover.length === 1 ? 'episódio vai' : 'episódios vão'} para <span className="text-ink">{ultimaPasta(plano.destino)}</span>
              {plano.linhas > 0 ? ` (${plano.linhas} no histórico)` : ''}.
            </p>
            <Conflitos conflitos={plano.conflitos} erro={plano.erro} />
          </>
        )}
        {erro && <p className="text-[12px] text-danger">{erro}</p>}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
        <button type="button" onClick={fecharDialogo} className={botao}>
          Cancelar
        </button>
        <button type="button" onClick={() => void juntar()} disabled={!plano?.pode || ocupado} className={principal}>
          {ocupado && plano ? <Loader2 size={13} className="animate-spin" /> : <Combine size={13} strokeWidth={2} />}
          Juntar
        </button>
      </footer>
    </Janela>
  )
}

// ------------------------------------------------------ temporada e B-roll

function ListaDeMudancas({ plano }: { plano: PlanoDeRenomear }) {
  return (
    <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto rounded-sm border border-line bg-surface px-3 py-2">
      {plano.mudancas.length === 0 ? (
        <p className="text-ink-3">Nada muda.</p>
      ) : (
        plano.mudancas.map((m) => (
          <p key={`${m.episodioId}-${m.de}`} className="flex min-w-0 items-center gap-2 text-[11px]">
            <span className="min-w-0 truncate text-ink-3" title={m.de}>
              {ultimaPasta(m.de)}
            </span>
            <ArrowRight size={11} className="shrink-0 text-ink-3" />
            <span className="min-w-0 truncate text-ink" title={m.para}>
              {ultimaPasta(m.para)}
            </span>
          </p>
        ))
      )}
    </div>
  )
}

function MudarTemporada({ alvo }: { alvo: AlvoDoOrganizar }) {
  const clipes = alvo.clipes.map((c) => c.path)
  const atual = alvo.clipes[0]?.season || 1
  const [temporada, setTemporada] = useState(atual === 1 ? 2 : atual)
  const [plano, setPlano] = useState<PlanoDeRenomear | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  useEffect(() => {
    let vivo = true
    const t = setTimeout(() => {
      setOcupado(true)
      setErro('')
      void window.dangai.ancutTemporada(clipes, temporada, false).then((r) => {
        if (!vivo) return
        setOcupado(false)
        if (r.ok) setPlano(r.value)
        else setErro(r.error)
      })
    }, 350)
    return () => {
      vivo = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temporada])
  const mudar = async (): Promise<void> => {
    setOcupado(true)
    const r = await window.dangai.ancutTemporada(clipes, temporada, true)
    setOcupado(false)
    if (!r.ok) return setErro(r.error)
    if (!r.value.aplicado) return setPlano(r.value)
    fecharDialogo()
    avisarNaBiblioteca(`${r.value.mudancas.length} ${r.value.mudancas.length === 1 ? 'episódio foi' : 'episódios foram'} para a temporada ${temporada}.`)
    releBiblioteca()
  }
  return (
    <Janela titulo={alvo.tipo === 'anime' ? `Temporada de ${alvo.anime}` : `Temporada de ${alvo.anime} · ${alvo.chave}`} aoFechar={fecharDialogo} largura={480}>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4 text-[12px] text-ink-2" data-organizar="temporada">
        <label className="flex items-center gap-2">
          Passar para a temporada
          <input
            type="number"
            min={1}
            value={temporada}
            onChange={(e) => setTemporada(Math.max(1, Number(e.target.value) || 1))}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-8 w-20 rounded-sm border border-line bg-elevated px-2 text-[12px] text-ink focus:border-accent focus:outline-none"
            aria-label="Temporada"
          />
          {ocupado && <Loader2 size={13} className="animate-spin text-ink-3" />}
        </label>
        {plano && (
          <>
            <ListaDeMudancas plano={plano} />
            <Conflitos conflitos={plano.conflitos} erro={plano.erro} />
          </>
        )}
        {erro && <p className="text-danger">{erro}</p>}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
        <button type="button" onClick={fecharDialogo} className={botao}>
          Cancelar
        </button>
        <button type="button" onClick={() => void mudar()} disabled={!plano?.pode || plano.mudancas.length === 0 || ocupado} className={principal}>
          Mudar
        </button>
      </footer>
    </Janela>
  )
}

function PassarParaBroll({ alvo }: { alvo: AlvoDoOrganizar }) {
  const clipes = alvo.clipes.map((c) => c.path)
  const [plano, setPlano] = useState<PlanoDeRenomear | null>(null)
  const [ocupado, setOcupado] = useState(true)
  const [erro, setErro] = useState('')
  useEffect(() => {
    void window.dangai.ancutParaBroll(clipes, false).then((r) => {
      setOcupado(false)
      if (r.ok) setPlano(r.value)
      else setErro(r.error)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const passar = async (): Promise<void> => {
    setOcupado(true)
    const r = await window.dangai.ancutParaBroll(clipes, true)
    setOcupado(false)
    if (!r.ok) return setErro(r.error)
    if (!r.value.aplicado) return setPlano(r.value)
    fecharDialogo()
    avisarNaBiblioteca('O episódio virou B-roll do anime.')
    releBiblioteca()
  }
  return (
    <Janela titulo={`Passar ${alvo.chave ?? alvo.anime} para B-roll`} aoFechar={fecharDialogo} largura={480}>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4 text-[12px] text-ink-2" data-organizar="broll">
        <p>Para o trailer, a abertura ou o vídeo que entrou como episódio: a pasta vira &ldquo;B-roll&rdquo; do anime, com as mesmas cenas.</p>
        {ocupado && !plano && (
          <p className="flex items-center gap-2 text-ink-3">
            <Loader2 size={13} className="animate-spin" /> Vendo o que muda…
          </p>
        )}
        {plano && (
          <>
            <ListaDeMudancas plano={plano} />
            <Conflitos conflitos={plano.conflitos} erro={plano.erro} />
          </>
        )}
        {erro && <p className="text-danger">{erro}</p>}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
        <button type="button" onClick={fecharDialogo} className={botao}>
          Cancelar
        </button>
        <button type="button" onClick={() => void passar()} disabled={!plano?.pode || plano.mudancas.length === 0 || ocupado} className={principal}>
          <Film size={13} strokeWidth={2} />
          Passar para B-roll
        </button>
      </footer>
    </Janela>
  )
}

// --------------------------------------------------------- personagens

function PersonagensDoEpisodio({ alvo }: { alvo: AlvoDoOrganizar }) {
  const clipe = alvo.clipes[0]!.path
  const [ep, setEp] = useState<EpisodioNoAncut | null | undefined>(undefined)
  const [tirando, setTirando] = useState<number | null>(null)
  const [confirmar, setConfirmar] = useState<number | null>(null)
  const [erro, setErro] = useState('')
  const [mudou, setMudou] = useState(false)
  useEffect(() => {
    void window.dangai.ancutEpisodio(clipe).then((r) => {
      if (r.ok) setEp(r.value)
      else {
        setEp(null)
        setErro(r.error)
      }
    })
  }, [clipe])
  const fechar = (): void => {
    fecharDialogo()
    if (mudou) releBiblioteca()
  }
  const tirar = async (id: number): Promise<void> => {
    setConfirmar(null)
    setTirando(id)
    const r = await window.dangai.ancutTirarPersonagem(clipe, id)
    setTirando(null)
    if (!r.ok) return setErro(r.error)
    setEp(r.value)
    setMudou(true)
  }
  const [comoReconhecer, setComoReconhecer] = useState(false)
  const reconhecer = (modo: 'batizar' | 'reconhecer'): void => {
    setComoReconhecer(false)
    if (!ep) return
    useCortar.getState().adicionarPedido(
      {
        video: ep.video,
        anime: ep.anime,
        temporada: ep.temporada,
        episodio: ep.episodio,
        tipo: ep.tipo === 'BROLL' ? 'BROLL' : '',
        modo,
        pastaDoAnime: ultimaPasta(ep.pastaDoAnime),
        ...(ep.titulo ? { titulo: ep.titulo } : {}),
      },
      `${ep.anime} · ${alvo.chave ?? ''}`,
    )
    fecharDialogo()
    useProject.setState({ libraryOpen: false })
    useCortar.getState().abrir('arquivos')
    void useCortar.getState().comecar()
  }
  // A escolha ocupa o lugar da janela (uma janela dentro da outra ficaria presa nela); fechar volta.
  if (comoReconhecer) return <ComoReconhecer aoEscolher={reconhecer} aoFechar={() => setComoReconhecer(false)} />
  return (
    <Janela titulo={`Personagens · ${alvo.anime} · ${alvo.chave ?? ''}`} aoFechar={fechar} largura={520}>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4 text-[12px] text-ink-2" data-organizar="personagens">
        {ep === undefined && (
          <p className="flex items-center gap-2 text-ink-3">
            <Loader2 size={13} className="animate-spin" /> Lendo o episódio…
          </p>
        )}
        {ep === null && !erro && <p className="text-ink-3">Este episódio não está no histórico do corte.</p>}
        {ep && (
          <>
            <p>
              {ep.cenas} cenas · {ep.cenas - ep.semPersonagem} com alguém marcado · {ep.semPersonagem} sem ninguém.
            </p>
            {ep.personagens.length === 0 ? (
              <p className="text-ink-3">Ninguém marcado neste episódio ainda.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {[...ep.personagens]
                  .sort((a, b) => b.cenas - a.cenas)
                  .map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-surface">
                      <Users size={12} strokeWidth={1.75} className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate text-ink">{p.nome}</span>
                      <span className="tnum text-[11px] text-ink-3">
                        {p.cenas} {p.cenas === 1 ? 'cena' : 'cenas'}
                      </span>
                      {confirmar === p.id ? (
                        <>
                          <button type="button" onClick={() => setConfirmar(null)} className="text-[11px] text-ink-3 hover:text-ink">
                            Não
                          </button>
                          <button type="button" onClick={() => void tirar(p.id)} className="rounded-sm bg-danger px-2 py-0.5 text-[11px] font-semibold text-white">
                            Tirar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={tirando !== null}
                          onClick={() => setConfirmar(p.id)}
                          title="Tira esse personagem do episódio inteiro (as cenas ficam, só deixam de ser dele)"
                          className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-danger disabled:opacity-40"
                        >
                          {tirando === p.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} strokeWidth={2} />}
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
        {erro && <p className="text-danger">{erro}</p>}
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={() => setComoReconhecer(true)}
          disabled={!ep || !ep.videoExiste}
          title={ep && !ep.videoExiste ? `O vídeo original não está mais no lugar (${ep.video || 'sem registro'}): sem ele não há rosto para reconhecer.` : 'Batizar na mão (Modo Descoberta) ou reconhecer sozinho; o que já foi marcado na mão fica.'}
          className={principal}
        >
          <ScanFace size={13} strokeWidth={2} />
          Reconhecer de novo
        </button>
        <span className="flex-1" />
        <button type="button" onClick={fechar} className={botao}>
          Pronto
        </button>
      </footer>
    </Janela>
  )
}

// --------------------------------------------------- reforcar e repescar

function Trabalho({ tipo, alvo }: { tipo: 'reforcar' | 'repescar'; alvo: AlvoDoOrganizar }) {
  const [andamento, setAndamento] = useState('Abrindo o motor (carrega os modelos, leva alguns segundos)…')
  const [fim, setFim] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    let vivo = true
    const sair = window.dangai.onAncutOrganizar((e) => {
      if (!vivo) return
      if (e.tipo === 'reforcar') setAndamento(`${e.nome}${e.total ? ` (${e.feitos} de ${e.total})` : ''}`)
      else setAndamento(`Episódio ${e.feitos} de ${e.total} · ${e.cenas} cenas marcadas até aqui`)
    })
    const fazer = async (): Promise<void> => {
      if (tipo === 'reforcar') {
        const r = await window.dangai.ancutReforcar(alvo.clipes[0]!.path)
        if (!vivo) return
        if (!r.ok) return setErro(r.error)
        if (r.value.erro) return setErro(r.value.erro)
        const nomes = Object.entries(r.value.adicionadas).filter(([, n]) => n > 0)
        setFim(
          r.value.total > 0
            ? `${r.value.total} ${r.value.total === 1 ? 'foto entrou' : 'fotos entraram'} no elenco: ${nomes.map(([n, k]) => `${n} (${k})`).join(', ')}.`
            : 'Nenhuma foto nova: os rostos deste episódio não eram confiáveis o bastante (ou o elenco já tinha).',
        )
      } else {
        const r = await window.dangai.ancutRepescar(alvo.clipes.map((c) => c.path))
        if (!vivo) return
        if (!r.ok) return setErro(r.error)
        if (r.value.erro) return setErro(r.value.erro)
        const nomes = Object.entries(r.value.porPersonagem).sort((a, b) => b[1] - a[1])
        setFim(
          r.value.cenas > 0
            ? `${r.value.cenas} ${r.value.cenas === 1 ? 'cena ganhou' : 'cenas ganharam'} personagem em ${r.value.episodios} ${r.value.episodios === 1 ? 'episódio' : 'episódios'}: ${nomes
                .slice(0, 8)
                .map(([n, k]) => `${n} (${k})`)
                .join(', ')}.`
            : 'Nenhuma cena nova: quem dava para reconhecer já estava marcado.',
        )
        releBiblioteca()
      }
    }
    void fazer()
    return () => {
      vivo = false
      sair()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const titulo = tipo === 'reforcar' ? 'Reforçar as fotos do elenco' : 'Repescar quem ficou sem marcação'
  return (
    <Janela titulo={titulo} aoFechar={fecharDialogo} largura={480}>
      <div className="flex flex-col gap-3 px-4 py-4 text-[12px] text-ink-2" data-organizar={tipo}>
        {fim ? (
          <p className="text-ink">{fim}</p>
        ) : erro ? (
          <p className="text-danger">{erro}</p>
        ) : (
          <p className="flex items-center gap-2">
            <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
            <span className="min-w-0 truncate">{andamento}</span>
          </p>
        )}
        {!fim && !erro && <p className="text-[11px] text-ink-3">Pode fechar: continua por trás, e a Biblioteca atualiza quando terminar.</p>}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
        <button type="button" onClick={fecharDialogo} className={botao}>
          {fim || erro ? 'Pronto' : 'Fechar'}
        </button>
      </footer>
    </Janela>
  )
}
