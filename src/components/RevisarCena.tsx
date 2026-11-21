import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { Loader2, Plus, Trash2, TriangleAlert, UserRound, Users, X } from 'lucide-react'
import type { CenaNoAncut, PlanoDeApagarEpisodio } from '@shared/ancut'
import type { LibraryClip } from '@shared/channels'
import { useProject } from '@/store/project'

/**
 * REVISAR A CENA NA BIBLIOTECA (20/11, o AnCut dentro do Dangai): o botao
 * direito numa cena de episodio do AnCut abre o que ele fazia la --
 *
 * - "Quem está na cena": tirar o personagem errado, marcar o que faltou (um
 *   do anime, ou um nome novo);
 * - "Mandar para a lixeira": a cena sai do episodio; o arquivo vai para a
 *   `_lixeira` dentro da pasta dele (da para voltar). Com cenas marcadas no
 *   Ctrl+clique, vale para todas elas;
 * - "Apagar o episódio inteiro": mostra o que vai sumir e pede confirmacao --
 *   essa nao tem lixeira.
 *
 * Quem muda e o motor do AnCut (electron/services/ancut/revisar.ts); depois a
 * Biblioteca le de novo so o episodio que mudou.
 */

interface Menu {
  clip: LibraryClip
  x: number
  y: number
  /** Os clipes que a lixeira leva: os marcados no Ctrl+clique (se este e um deles), ou so este. */
  alvos: string[]
}

export const useRevisarCena = create<{
  menu: Menu | null
  personagensDe: LibraryClip | null
  apagarDe: LibraryClip | null
  recado: string | null
  abrirMenu: (menu: Menu) => void
  fechar: () => void
}>((set) => ({
  menu: null,
  personagensDe: null,
  apagarDe: null,
  recado: null,
  abrirMenu: (menu) => set({ menu, recado: null }),
  fechar: () => set({ menu: null, personagensDe: null, apagarDe: null }),
}))

let apagarRecado: ReturnType<typeof setTimeout> | null = null
function avisarNaBiblioteca(texto: string): void {
  useRevisarCena.setState({ recado: texto })
  if (apagarRecado) clearTimeout(apagarRecado)
  apagarRecado = setTimeout(() => useRevisarCena.setState({ recado: null }), 7000)
}

/** Depois de mudar no AnCut: a Biblioteca le de novo (so o episodio que mudou e relido). */
function releBiblioteca(): void {
  void useProject.getState().syncLibrary()
}

/** O menu, as janelas e o recado. Montado dentro da Biblioteca. */
export function RevisarCena({ aoMudar }: { aoMudar?: () => void }) {
  const menu = useRevisarCena((s) => s.menu)
  const personagensDe = useRevisarCena((s) => s.personagensDe)
  const apagarDe = useRevisarCena((s) => s.apagarDe)
  const recado = useRevisarCena((s) => s.recado)
  return createPortal(
    <>
      {menu && <MenuDaCena menu={menu} aoMudar={aoMudar} />}
      {personagensDe && <QuemEstaNaCena clip={personagensDe} />}
      {apagarDe && <ApagarEpisodio clip={apagarDe} aoMudar={aoMudar} />}
      {recado && (
        <div className="enter fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-md border border-line bg-elevated px-4 py-2 text-[12px] text-ink shadow-[0_10px_30px_rgba(0,0,0,0.5)]" data-revisar="recado">
          {recado}
        </div>
      )}
    </>,
    document.body,
  )
}

function MenuDaCena({ menu, aoMudar }: { menu: Menu; aoMudar?: () => void }) {
  const [cena, setCena] = useState<CenaNoAncut | null | undefined>(undefined)
  const [mandando, setMandando] = useState(false)
  useEffect(() => {
    let vivo = true
    void window.dangai.ancutCena(menu.clip.path).then((r) => {
      if (vivo) setCena(r.ok ? r.value : null)
    })
    const fora = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement | null)?.closest('[data-revisar="menu"]')) useRevisarCena.setState({ menu: null })
    }
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      useRevisarCena.setState({ menu: null })
    }
    window.addEventListener('mousedown', fora, true)
    window.addEventListener('keydown', tecla, true)
    return () => {
      vivo = false
      window.removeEventListener('mousedown', fora, true)
      window.removeEventListener('keydown', tecla, true)
    }
  }, [menu])

  const doAncut = cena !== null && cena !== undefined
  const varias = menu.alvos.length > 1
  const lixeira = async (): Promise<void> => {
    setMandando(true)
    const r = await window.dangai.ancutLixeira(menu.alvos)
    setMandando(false)
    useRevisarCena.setState({ menu: null })
    if (!r.ok) return avisarNaBiblioteca(r.error)
    if (r.value.erro && r.value.apagadas === 0) return avisarNaBiblioteca(r.value.erro)
    avisarNaBiblioteca(
      r.value.apagadas === 1
        ? 'A cena foi para a lixeira do episódio (a pasta _lixeira dentro dele).'
        : `${r.value.apagadas} cenas foram para a lixeira do episódio (a pasta _lixeira dentro dele).`,
    )
    releBiblioteca()
    aoMudar?.()
  }

  // O menu nunca sai da tela.
  const x = Math.min(menu.x, window.innerWidth - 270)
  const y = Math.min(menu.y, window.innerHeight - 190)
  const item = 'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div
      role="menu"
      data-revisar="menu"
      style={{ left: x, top: y }}
      className="enter fixed z-[70] w-[260px] rounded-md border border-line bg-elevated p-1 shadow-[0_14px_40px_rgba(0,0,0,0.55)]"
    >
      <p className="truncate px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {varias ? `${menu.alvos.length} cenas marcadas` : cena === undefined ? 'Lendo a cena…' : doAncut ? `${cena.anime} · cena ${menu.clip.shot}` : 'Cena'}
      </p>
      {cena === null && <p className="px-2.5 pb-2 text-[11px] leading-relaxed text-ink-3">Esta cena não é de um episódio cortado pelo AnCut (ou o AnCut não está neste computador).</p>}
      <button
        type="button"
        role="menuitem"
        disabled={!doAncut || varias}
        onClick={() => useRevisarCena.setState({ menu: null, personagensDe: menu.clip })}
        className={`${item} text-ink-2 hover:bg-surface hover:text-ink`}
        title={varias ? 'Uma cena por vez' : 'Tirar quem está errado, marcar quem faltou'}
      >
        <Users size={14} strokeWidth={1.75} />
        Quem está na cena…
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!doAncut || mandando}
        onClick={() => void lixeira()}
        className={`${item} text-ink-2 hover:bg-surface hover:text-ink`}
        title="A cena sai do episódio; o arquivo vai para a pasta _lixeira dentro dele (dá para voltar)"
      >
        {mandando ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} strokeWidth={1.75} />}
        {varias ? `Mandar as ${menu.alvos.length} para a lixeira` : 'Mandar para a lixeira'}
      </button>
      <div className="my-1 h-px bg-line" />
      <button
        type="button"
        role="menuitem"
        disabled={!doAncut || varias}
        onClick={() => useRevisarCena.setState({ menu: null, apagarDe: menu.clip })}
        className={`${item} text-danger hover:bg-danger/10`}
        title="Apaga a pasta do episódio e tira do histórico do AnCut (pede confirmação)"
      >
        <TriangleAlert size={14} strokeWidth={1.75} />
        Apagar o episódio inteiro…
      </button>
    </div>
  )
}

function Janela({ titulo, children, aoFechar, largura = 460 }: { titulo: string; children: React.ReactNode; aoFechar: () => void; largura?: number }) {
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
    <div className="fixed inset-0 z-[65] grid place-items-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div role="dialog" aria-label={titulo} style={{ width: largura }} className="glass enter flex max-h-[80vh] max-w-full flex-col overflow-hidden rounded-lg">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{titulo}</h2>
          <button type="button" onClick={aoFechar} aria-label="Fechar" className="grid size-7 place-items-center rounded-sm text-ink-3 hover:text-ink">
            <X size={14} strokeWidth={1.75} />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

/** Quem esta na cena: tirar o errado, marcar o que faltou (do anime, ou um nome novo). */
function QuemEstaNaCena({ clip }: { clip: LibraryClip }) {
  const [cena, setCena] = useState<CenaNoAncut | null>(null)
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [mudou, setMudou] = useState(false)
  useEffect(() => {
    void window.dangai.ancutCena(clip.path).then((r) => setCena(r.ok ? r.value : null))
  }, [clip.path])
  const fechar = (): void => {
    useRevisarCena.setState({ personagensDe: null })
    if (mudou) releBiblioteca()
  }
  const aplicar = async (fazer: () => Promise<{ ok: true; value: CenaNoAncut | null } | { ok: false; error: string }>): Promise<void> => {
    setOcupado(true)
    setErro(null)
    const r = await fazer()
    setOcupado(false)
    if (!r.ok) return setErro(r.error)
    if (r.value) setCena(r.value)
    setMudou(true)
    setBusca('')
  }
  const marcados = new Set(cena?.personagens.map((p) => p.id) ?? [])
  const termo = busca.trim().toLowerCase()
  const opcoes = useMemo(
    () => (cena?.doAnime ?? []).filter((p) => !marcados.has(p.id) && (!termo || p.nome.toLowerCase().includes(termo))).slice(0, 40),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cena, termo],
  )
  const exato = (cena?.doAnime ?? []).some((p) => p.nome.toLowerCase() === termo)
  return (
    <Janela titulo={`Quem está na cena ${clip.shot}`} aoFechar={fechar}>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4" data-revisar="personagens">
        <img src={clip.thumbUrl} alt="" className="aspect-video w-full rounded-md bg-black/40 object-cover" />
        {!cena ? (
          <p className="flex items-center gap-2 text-[12px] text-ink-3">
            <Loader2 size={13} className="animate-spin" /> Lendo a cena…
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {cena.personagens.length === 0 && <span className="text-[12px] text-ink-3">Ninguém marcado nesta cena.</span>}
              {cena.personagens.map((p) => (
                <span key={p.id} className="flex h-7 items-center gap-1.5 rounded-full border border-accent/50 bg-accent-dim pl-2.5 pr-1 text-[12px] text-ink">
                  <UserRound size={12} strokeWidth={1.75} />
                  {p.nome}
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => void aplicar(() => window.dangai.ancutMarcar(clip.path, p.id, true))}
                    title={`Tirar ${p.nome} desta cena`}
                    aria-label={`Tirar ${p.nome} desta cena`}
                    className="grid size-5 place-items-center rounded-full text-ink-3 hover:bg-black/20 hover:text-ink disabled:opacity-40"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </span>
              ))}
            </div>
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && termo) {
                  const um = opcoes[0]
                  if (um && um.nome.toLowerCase().includes(termo)) void aplicar(() => window.dangai.ancutMarcar(clip.path, um.id, false))
                  else void aplicar(() => window.dangai.ancutNovoPersonagem(clip.path, busca))
                }
              }}
              placeholder="Marcar alguém: digite o nome"
              aria-label="Nome do personagem"
              className="h-8 rounded-sm border border-line bg-elevated px-2.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <div className="flex flex-col gap-0.5">
              {opcoes.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={ocupado}
                  onClick={() => void aplicar(() => window.dangai.ancutMarcar(clip.path, p.id, false))}
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-ink-2 hover:bg-surface hover:text-ink disabled:opacity-40"
                >
                  <Plus size={12} strokeWidth={1.75} className="text-ink-3" />
                  <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                  <span className="text-[10px] text-ink-3">{p.cenas > 0 ? `${p.cenas} ${p.cenas === 1 ? 'cena' : 'cenas'} neste episódio` : 'do anime'}</span>
                </button>
              ))}
              {termo && !exato && (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => void aplicar(() => window.dangai.ancutNovoPersonagem(clip.path, busca))}
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-accent hover:bg-surface disabled:opacity-40"
                >
                  <Plus size={12} strokeWidth={1.75} />
                  Marcar “{busca.trim()}” (personagem novo)
                </button>
              )}
            </div>
          </>
        )}
        {erro && <p className="text-[12px] text-danger">{erro}</p>}
      </div>
      <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
        {ocupado && <Loader2 size={13} className="animate-spin text-ink-3" />}
        <span className="flex-1 text-[11px] text-ink-3">Muda no AnCut também: os dois apps veem igual.</span>
        <button type="button" onClick={fechar} className="h-8 rounded-sm border border-line bg-elevated px-4 text-[12px] text-ink-2 hover:text-ink">
          Pronto
        </button>
      </footer>
    </Janela>
  )
}

const tamanho = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`

/** Apagar o episodio inteiro: o plano primeiro (o que vai sumir), depois a confirmacao. Sem lixeira. */
function ApagarEpisodio({ clip, aoMudar }: { clip: LibraryClip; aoMudar?: () => void }) {
  const [plano, setPlano] = useState<PlanoDeApagarEpisodio | null | undefined>(undefined)
  const [apagando, setApagando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    void window.dangai.ancutApagarEpisodio(clip.path, false).then((r) => {
      if (!r.ok) return setErro(r.error)
      setPlano(r.value)
    })
  }, [clip.path])
  const fechar = (): void => useRevisarCena.setState({ apagarDe: null })
  const apagar = async (): Promise<void> => {
    setApagando(true)
    const r = await window.dangai.ancutApagarEpisodio(clip.path, true)
    setApagando(false)
    if (!r.ok) return setErro(r.error)
    if (!r.value?.aplicado) return setErro(r.value?.motivo || 'O episódio não foi apagado.')
    fechar()
    // Pelo plano de antes: depois de apagar, a pasta ja nao existe (e a resposta diria "so o registro").
    const soORegistro = !!plano && (plano.outrosNaPasta > 0 || !plano.pastaExiste)
    avisarNaBiblioteca(soORegistro ? 'O episódio saiu do histórico do AnCut.' : `O episódio foi apagado (${r.value.cenas} cenas).`)
    releBiblioteca()
    aoMudar?.()
  }
  const episodio = clip.filme ? 'o filme' : `${clip.anime} · S${String(clip.season).padStart(2, '0')}E${String(clip.episode).padStart(2, '0')}`
  return (
    <Janela titulo="Apagar o episódio inteiro" aoFechar={fechar} largura={440}>
      <div className="flex flex-col gap-3 px-4 py-4 text-[13px] text-ink-2" data-revisar="apagar">
        {plano === undefined && !erro && (
          <p className="flex items-center gap-2 text-ink-3">
            <Loader2 size={13} className="animate-spin" /> Vendo o que seria apagado…
          </p>
        )}
        {plano === null && <p>Este episódio não está no histórico do AnCut.</p>}
        {plano && (plano.outrosNaPasta > 0 || !plano.pastaExiste) && (
          <p>
            Tirar <span className="font-semibold text-ink">{episodio}</span> do histórico do AnCut.{' '}
            {plano.pastaExiste
              ? `Os arquivos ficam: ${plano.outrosNaPasta === 1 ? 'outro episódio usa' : `outros ${plano.outrosNaPasta} episódios usam`} a mesma pasta.`
              : 'A pasta já não está no disco.'}
          </p>
        )}
        {plano && plano.outrosNaPasta === 0 && plano.pastaExiste && (
          <>
            <p>
              Apagar <span className="font-semibold text-ink">{episodio}</span>: {plano.cenas} {plano.cenas === 1 ? 'cena' : 'cenas'},{' '}
              {tamanho(plano.bytes)}. A pasta sai do disco e o episódio sai do histórico do AnCut.
            </p>
            <p className="flex items-start gap-2 rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-ink">
              <TriangleAlert size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" />
              Não tem lixeira: não dá para desfazer. Para tirar só algumas cenas, use “Mandar para a lixeira”.
            </p>
          </>
        )}
        {plano && (
          <p className="truncate text-[11px] text-ink-3" title={plano.pasta}>
            {plano.pasta}
          </p>
        )}
        {plano && !plano.pode && plano.motivo && <p className="text-[12px] text-danger">{plano.motivo}</p>}
        {erro && <p className="text-[12px] text-danger">{erro}</p>}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
        <button type="button" onClick={fechar} className="h-8 rounded-sm border border-line bg-elevated px-4 text-[12px] text-ink-2 hover:text-ink">
          Cancelar
        </button>
        <button
          type="button"
          disabled={!plano?.pode || apagando}
          onClick={() => void apagar()}
          className="flex h-8 items-center gap-2 rounded-sm bg-danger px-4 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {apagando ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} strokeWidth={2} />}
          {plano && (plano.outrosNaPasta > 0 || !plano.pastaExiste) ? 'Tirar do histórico' : 'Apagar de vez'}
        </button>
      </footer>
    </Janela>
  )
}
