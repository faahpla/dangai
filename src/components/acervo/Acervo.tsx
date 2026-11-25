import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, Library, Loader2, RefreshCw, Scissors, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { agruparPorAnime, tituloBase, type InfoDoPacote } from '@shared/acervo'
import { useAcervo } from '@/store/acervo'
import { useCortar } from '@/store/cortar-episodios'
import { useProject } from '@/store/project'
import { OrganizarAnime } from '../OrganizarAnime'
import { RevisarCena } from '../RevisarCena'
import { Segmentos } from '../painel'
import { GradeDeAnimes, PaginaDoAnime, PaginaDoEpisodio } from './Animes'
import { ListaDePersonagens, PaginaDoPersonagem } from './Personagens'

/**
 * O ACERVO (25/11): "eu preciso da biblioteca assim como no AnCut: saber o
 * que eu ja cortei, o que preciso cortar, a tela de personagens, juntar
 * personagem, marcar cena, o exportar pacote de elenco". A Biblioteca do
 * AnCut, inteira, dentro do Dangai -- e a Biblioteca do Dangai continua sendo
 * a de escolher cena para o video.
 */
export function Acervo() {
  const aberto = useAcervo((s) => s.aberto)
  if (!aberto) return null
  return <Tela />
}

function Tela() {
  const { aba, dados, lendo, erro, anime, episodio, personagem, aviso } = useAcervo(
    useShallow((s) => ({ aba: s.aba, dados: s.dados, lendo: s.lendo, erro: s.erro, anime: s.anime, episodio: s.episodio, personagem: s.personagem, aviso: s.aviso })),
  )
  const [importando, setImportando] = useState<string | null>(null)
  const animes = useMemo(() => agruparPorAnime(dados?.episodios ?? []), [dados])
  const animeAberto = anime ? (animes.find((a) => a.pasta.toLowerCase() === anime.toLowerCase()) ?? null) : null

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return
      // Esc volta um nivel; na grade, fecha.
      const s = useAcervo.getState()
      if (document.querySelector('[role=dialog]:not([data-acervo-tela])')) return
      if (s.aba === 'personagens' && s.personagem) s.abrirPersonagem(null)
      else if (s.aba === 'animes' && s.episodio) s.abrirEpisodio(null)
      else if (s.aba === 'animes' && s.anime) s.abrirAnime(null)
      else s.fechar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  const importar = async (): Promise<void> => {
    const r = await window.dangai.acervoEscolherPacote()
    if (r.ok && r.value) setImportando(r.value)
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg" role="dialog" aria-label="Acervo" data-acervo-tela data-acervo="tela">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <span className="grid size-8 place-items-center rounded-md bg-accent-dim text-accent">
          <Library size={16} strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-[15px] font-semibold text-ink">Acervo</h2>
          <p className="truncate text-[11px] text-ink-3">O que você já cortou, o que falta, os personagens e o elenco. O mesmo acervo do AnCut.</p>
        </div>
        <div className="ml-4 w-[240px]">
          <Segmentos
            opcoes={[
              { valor: 'animes' as const, rotulo: 'Animes', title: 'Os animes cortados, episódio por episódio' },
              { valor: 'personagens' as const, rotulo: 'Personagens', title: 'Todos os personagens do acervo' },
            ]}
            ativo={(v) => aba === v}
            onChange={(v) => useAcervo.getState().setAba(v)}
          />
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            void useAcervo.getState().ler()
            if (useAcervo.getState().personagens) void useAcervo.getState().lerPersonagens()
          }}
          disabled={lendo}
          className="flex h-8 items-center gap-1.5 rounded-sm border border-line bg-elevated px-3 text-[12px] text-ink-2 hover:text-ink disabled:opacity-50"
          title="Ler de novo (o que o AnCut cortou enquanto isto estava aberto também aparece)"
        >
          <RefreshCw size={13} className={lendo ? 'animate-spin' : ''} />
          Atualizar
        </button>
        <button type="button" onClick={() => void importar()} className="flex h-8 items-center gap-1.5 rounded-sm border border-line bg-elevated px-3 text-[12px] text-ink-2 hover:text-ink" data-acervo="importar" title="Um pacote de elenco (.zip) que alguém exportou do Dangai ou do AnCut">
          <Download size={13} />
          Importar elenco…
        </button>
        <button
          type="button"
          onClick={() => {
            useAcervo.getState().fechar()
            useCortar.getState().abrir('arquivos')
          }}
          className="flex h-8 items-center gap-1.5 rounded-sm border border-line bg-elevated px-3 text-[12px] text-ink-2 hover:text-ink"
        >
          <Scissors size={13} />
          Cortar episódios
        </button>
        <button type="button" onClick={() => useAcervo.getState().fechar()} aria-label="Fechar" title="Fechar (Esc)" className="grid size-8 place-items-center rounded-sm text-ink-3 hover:bg-white/[0.06] hover:text-ink">
          <X size={15} />
        </button>
      </header>

      {aviso && (
        <div className={['flex shrink-0 items-start gap-2 border-b px-5 py-2 text-[12px]', aviso.ok ? 'border-accent/30 bg-accent-dim/30 text-ink' : 'border-[#f6a23c]/40 bg-[#f6a23c]/10 text-ink'].join(' ')} data-acervo="aviso">
          <span className="flex-1 select-text">{aviso.texto}</span>
          <button type="button" onClick={() => useAcervo.setState({ aviso: null })} aria-label="Fechar o aviso" className="text-ink-3 hover:text-ink">
            <X size={13} />
          </button>
        </div>
      )}

      {erro && !dados ? (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div className="flex max-w-[480px] flex-col items-center gap-3">
            <AlertTriangle size={20} className="text-[#f6a23c]" />
            <p className="text-[13px] text-ink">{erro}</p>
            <p className="text-[12px] text-ink-3">O Acervo usa o motor de cortes. Sem ele baixado (e sem o AnCut instalado), baixe em "Cortar episódios".</p>
            <button type="button" onClick={() => void useAcervo.getState().ler()} className="h-8 rounded-sm border border-line bg-elevated px-4 text-[12px] text-ink-2 hover:text-ink">
              Tentar de novo
            </button>
          </div>
        </div>
      ) : !dados ? (
        <div className="grid flex-1 place-items-center">
          <p className="flex items-center gap-2 text-[12px] text-ink-3">
            <Loader2 size={14} className="animate-spin" /> Lendo o acervo…
          </p>
        </div>
      ) : aba === 'personagens' ? (
        personagem ? (
          <PaginaDoPersonagem p={personagem.p} anime={personagem.anime} />
        ) : (
          <ListaDePersonagens />
        )
      ) : animeAberto && episodio ? (
        <PaginaDoEpisodio anime={animeAberto} episodio={episodio} />
      ) : animeAberto ? (
        <PaginaDoAnime anime={animeAberto} />
      ) : (
        <GradeDeAnimes />
      )}

      {importando && <ImportarElenco arquivo={importando} sugestoes={animes.map((a) => a.nome)} aoFechar={() => setImportando(null)} />}
      <OrganizarAnime />
      <RevisarCena />
    </div>
  )
}

/** Importar um pacote de elenco: o que ele traz, e a qual anime do acervo ligar. */
function ImportarElenco({ arquivo, sugestoes, aoFechar }: { arquivo: string; sugestoes: string[]; aoFechar: () => void }) {
  const [info, setInfo] = useState<InfoDoPacote | null>(null)
  const [titulo, setTitulo] = useState('')
  const [outro, setOutro] = useState('')
  const [lendo, setLendo] = useState(true)
  const [importando, setImportando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    void window.dangai.acervoLerPacote(arquivo).then((r) => {
      if (!vivo) return
      setLendo(false)
      if (!r.ok) return setErro(r.error)
      if (r.value.erro) return setErro(r.value.erro)
      setInfo(r.value)
      // Ja vem marcado so o anime do acervo com o MESMO nome do pacote; sem nenhum igual, ele escolhe.
      const doPacote = new Set([r.value.titulo, ...r.value.titulos].map(tituloBase))
      setTitulo(sugestoes.find((s) => doPacote.has(tituloBase(s))) ?? '')
    })
    return () => {
      vivo = false
    }
  }, [arquivo, sugestoes])

  const escolhido = (outro.trim() || titulo).trim()
  const importar = async (): Promise<void> => {
    if (!escolhido) return
    setImportando(true)
    setErro('')
    const r = await window.dangai.acervoImportarPacote(arquivo, escolhido)
    setImportando(false)
    if (!r.ok) return setErro(r.error)
    if (r.value.erro) return setErro(r.value.erro)
    const v = r.value
    useAcervo
      .getState()
      .avisar(
        `Importado: ${v.personagens} personagens ligados a “${v.titulo || escolhido}”, ${v.fotos} fotos novas. ` +
          (v.semFoto.length === v.personagens ? 'Nenhum veio com foto: eles só ajudam no "Batizar na mão".' : 'O próximo corte com reconhecimento desse anime, de qualquer temporada, já reconhece eles.'),
        v.semFoto.length < v.personagens,
      )
    aoFechar()
    if (useAcervo.getState().personagens) void useAcervo.getState().lerPersonagens()
  }
  const semFoto = info ? info.personagens - info.comFoto : 0

  return (
    <div className="fixed inset-0 z-[66] grid place-items-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && !importando && aoFechar()}>
      <div role="dialog" aria-label="Importar elenco" style={{ backgroundColor: 'var(--color-elevated)' }} className="glass enter flex max-h-[86vh] w-[500px] max-w-full flex-col overflow-hidden rounded-lg" data-acervo="janela-importar">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">Importar elenco</h2>
          <button type="button" onClick={aoFechar} aria-label="Fechar" className="grid size-7 place-items-center rounded-sm text-ink-3 hover:text-ink">
            <X size={14} />
          </button>
        </header>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3 text-[12px] text-ink-2">
          <p className="truncate text-[11px] text-ink-3" title={arquivo}>
            {arquivo.split(/[\\/]/).pop()}
          </p>
          {lendo && (
            <p className="flex items-center gap-2 text-ink-3">
              <Loader2 size={13} className="animate-spin" /> Lendo o pacote…
            </p>
          )}
          {info && (
            <>
              <div className="rounded-sm border border-line bg-surface px-3 py-2">
                <p className="font-medium text-ink">{info.titulo}</p>
                <p className="mt-0.5 text-ink-3">
                  {info.personagens} personagens · {info.comFoto} com foto · {info.fotos} fotos
                  {info.prontos ? ` · ${info.prontos} já com reconhecimento` : ''}
                </p>
                {info.exemplo && (
                  <p className="mt-0.5 truncate text-[11px] text-ink-3" title={info.exemplo}>
                    Exportado de: {info.exemplo}
                  </p>
                )}
              </div>
              {semFoto > 0 && (
                <p className="flex items-start gap-2 rounded-sm border border-[#f6a23c]/40 bg-[#f6a23c]/10 px-3 py-2">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[#f6a23c]" />
                  {semFoto === info.personagens
                    ? 'Este pacote não traz nenhuma foto: os personagens só ajudam no "Batizar na mão". Peça para quem exportou atualizar e exportar de novo.'
                    : `${semFoto} personagens vêm sem foto e só ajudam no "Batizar na mão".`}
                </p>
              )}
              <p className="font-medium text-ink">Ligar estes personagens a qual anime do seu acervo?</p>
              <ul className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto rounded-sm border border-line bg-surface p-1">
                {sugestoes.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => {
                        setTitulo(s)
                        setOutro('')
                      }}
                      className={['flex w-full items-center rounded-sm px-2.5 py-1.5 text-left', titulo === s && !outro ? 'bg-accent-dim font-semibold text-ink' : 'hover:bg-elevated hover:text-ink'].join(' ')}
                    >
                      {s}
                    </button>
                  </li>
                ))}
                {sugestoes.length === 0 && <li className="px-2.5 py-1.5 text-ink-3">O acervo ainda não tem anime cortado.</li>}
              </ul>
              <input
                value={outro}
                onChange={(e) => setOutro(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Ou o nome do anime que você ainda vai cortar"
                aria-label="Outro anime"
                className="h-8 rounded-sm border border-line bg-surface px-2.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
              <p className="text-[11px] text-ink-3">Vale para qualquer temporada com esse nome: o próximo corte com reconhecimento já usa estes personagens.</p>
            </>
          )}
          {erro && <p className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{erro}</p>}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={aoFechar} disabled={importando} className="h-8 rounded-sm border border-line bg-surface px-4 text-[12px] text-ink-2 hover:text-ink disabled:opacity-40">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void importar()}
            disabled={!info || !escolhido || importando}
            className="flex h-8 items-center gap-1.5 rounded-sm bg-accent px-4 text-[12px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
            data-acervo="confirmar-importar"
          >
            {importando ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Importar{escolhido ? ` em ${escolhido}` : ''}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** Abre o Acervo (fechando a Biblioteca: os dois usam os mesmos menus). */
export function abrirAcervo(aba?: 'animes' | 'personagens'): void {
  useProject.setState({ libraryOpen: false })
  useAcervo.getState().abrir(aba)
}
