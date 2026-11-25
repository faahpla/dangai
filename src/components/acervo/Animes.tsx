import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Combine, Film, FolderOpen, Loader2, MoreHorizontal, RefreshCw, ScanFace, Scissors, Share2, Sparkles, UserSearch, Users } from 'lucide-react'
import {
  agruparPorAnime,
  filtrarAnimes,
  rotuloDoEpisodioDoAcervo,
  SEM_NINGUEM,
  TODAS,
  type AnimeDoAcervo,
  type CenaDoAcervo,
  type EpisodioDoAcervo,
  type ParaCortar,
  type PersonagemDoEpisodioAberto,
} from '@shared/acervo'
import type { LibraryClip } from '@shared/channels'
import { useAcervo } from '@/store/acervo'
import { useCortar } from '@/store/cortar-episodios'
import { abrirMenuDoOrganizar, useOrganizar, type AlvoDoOrganizar } from '../OrganizarAnime'
import { GradeDeCenas, MarcarCom } from './Cenas'

/**
 * OS ANIMES DO ACERVO (25/11): a grade de capas, a pagina de um anime e o
 * episodio aberto -- a Biblioteca do AnCut. O que mexe em pasta e historico
 * (juntar, temporada, B-roll, apagar, reforcar, repescar) e o mesmo do botao
 * direito da Biblioteca do Dangai (OrganizarAnime): o mesmo menu, as mesmas
 * janelas.
 */

/** O "clipe" que as janelas de organizar esperam: qualquer arquivo dentro de <episodio>\shots. */
export function clipeDoEpisodio(e: EpisodioDoAcervo, anime: string): LibraryClip {
  return {
    path: `${e.pasta}\\shots\\_`,
    anime,
    season: e.temporada,
    episode: e.episodio,
    ...(e.tipo === 'MOVIE' ? { filme: { ano: null } } : {}),
  } as unknown as LibraryClip
}

function alvoDoAnime(a: AnimeDoAcervo): AlvoDoOrganizar {
  const eps = [...a.temporadas.flatMap((t) => t.episodios), ...a.broll]
  return { tipo: 'anime', anime: a.nome, clipes: eps.map((e) => clipeDoEpisodio(e, a.nome)) }
}

function alvoDoEpisodio(a: AnimeDoAcervo, e: EpisodioDoAcervo): AlvoDoOrganizar {
  return { tipo: 'episodio', anime: a.nome, chave: rotuloDoEpisodioDoAcervo(e), clipes: [clipeDoEpisodio(e, a.nome)] }
}

const pct = (m: number, c: number): number => (c ? Math.round((m / c) * 100) : 0)

function Capa({ url, className }: { url: string; className?: string }) {
  return url ? (
    <img src={url} alt="" loading="lazy" className={['bg-black/40 object-cover', className].join(' ')} />
  ) : (
    <span className={['grid place-items-center bg-surface text-ink-3', className].join(' ')}>
      <Film size={20} strokeWidth={1.25} />
    </span>
  )
}

function Cobertura({ marcadas, cenas }: { marcadas: number; cenas: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct(marcadas, cenas)}%` }} />
    </div>
  )
}

/** O que falta de um anime: os numeros que pulam e os videos da pasta ainda nao cortados. */
function faltaDo(a: AnimeDoAcervo, paraCortar: ParaCortar[]): { buracos: number; naPasta: number } {
  return { buracos: a.temporadas.reduce((s, t) => s + t.faltam.length, 0), naPasta: paraCortar.length }
}

// ---------------------------------------------------------------- a grade

type Ordem = 'nome' | 'recentes' | 'cenas' | 'menos'

export function GradeDeAnimes() {
  const dados = useAcervo((s) => s.dados)
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<Ordem>('recentes')
  const animes = useMemo(() => agruparPorAnime(dados?.episodios ?? []), [dados])
  const visiveis = useMemo(() => {
    const lista = filtrarAnimes(animes, busca)
    return lista.sort((a, b) =>
      ordem === 'nome'
        ? a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })
        : ordem === 'cenas'
          ? b.cenas - a.cenas
          : ordem === 'menos'
            ? pct(a.marcadas, a.cenas) - pct(b.marcadas, b.cenas)
            : b.recente.localeCompare(a.recente),
    )
  }, [animes, busca, ordem])
  const episodios = animes.reduce((s, a) => s + a.episodios + a.broll.length, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5" data-acervo="animes">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[12px] text-ink-3">
          {animes.length} {animes.length === 1 ? 'anime' : 'animes'} · {episodios} {episodios === 1 ? 'episódio cortado' : 'episódios cortados'}
          {dados?.saida ? ` · em ${dados.saida}` : ''}
        </p>
        <span className="flex-1" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Procurar anime…"
          aria-label="Procurar anime"
          className="h-8 w-60 rounded-sm border border-line bg-elevated px-2.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordem" className="h-8 rounded-sm border border-line bg-elevated px-2 text-[12px] text-ink-2 focus:outline-none">
          <option value="recentes">Cortados por último</option>
          <option value="nome">Nome</option>
          <option value="cenas">Mais cenas</option>
          <option value="menos">Menos marcados</option>
        </select>
      </div>

      {visiveis.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-ink-3">{busca ? `Nenhum anime com “${busca}”.` : 'Nada cortado ainda. Corte um episódio em "Cortar episódios".'}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
          {visiveis.map((a) => {
            const falta = faltaDo(a, dados?.paraCortar[a.pasta.toLowerCase()] ?? [])
            return (
              <button
                key={a.pasta}
                type="button"
                onClick={() => useAcervo.getState().abrirAnime(a.pasta)}
                onContextMenu={(e) => abrirMenuDoOrganizar(e, alvoDoAnime(a))}
                title={`${a.pasta}\nBotão direito: juntar, temporada, repescar`}
                className="lift group flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-left transition-colors hover:border-accent/40"
                data-acervo="anime"
              >
                <span className="relative block">
                  <Capa url={a.capa} className="aspect-video w-full" />
                  {(falta.buracos > 0 || falta.naPasta > 0) && (
                    <span className="absolute right-2 top-2 rounded bg-black/75 px-2 py-0.5 text-[11px] font-semibold text-[#f6a23c]">
                      {falta.naPasta > 0 ? `${falta.naPasta} para cortar` : `faltam ${falta.buracos}`}
                    </span>
                  )}
                </span>
                <span className="flex flex-col gap-1.5 px-3 py-2.5">
                  <span className="truncate text-[13px] font-semibold text-ink">{a.nome}</span>
                  <span className="text-[11px] text-ink-3">
                    {[
                      a.episodios > 0 && `${a.episodios} ${a.filme ? (a.episodios === 1 ? 'filme' : 'filmes') : a.episodios === 1 ? 'episódio' : 'episódios'}`,
                      a.broll.length > 0 && `${a.broll.length} B-roll`,
                      `${a.cenas.toLocaleString('pt-BR')} cenas`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <Cobertura marcadas={a.marcadas} cenas={a.cenas} />
                  <span className="text-[10px] text-ink-3">{pct(a.marcadas, a.cenas)}% das cenas com personagem</span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {dados && dados.semPasta.length > 0 && (
        <details className="rounded-md border border-line bg-surface px-3 py-2 text-[12px] text-ink-3">
          <summary className="cursor-pointer text-ink-2">
            {dados.semPasta.length} {dados.semPasta.length === 1 ? 'episódio do histórico está' : 'episódios do histórico estão'} sem a pasta no disco
          </summary>
          <p className="mt-1.5">A pasta foi apagada ou mudou de lugar por fora. Eles continuam no histórico, mas não abrem.</p>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {dados.semPasta.slice(0, 30).map((e) => (
              <li key={e.episodioId} className="truncate" title={e.pasta}>
                {e.anime} · {rotuloDoEpisodioDoAcervo(e)} — {e.pasta}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// ------------------------------------------------------------- um anime

export function PaginaDoAnime({ anime }: { anime: AnimeDoAcervo }) {
  const dados = useAcervo((s) => s.dados)
  const personagens = useAcervo((s) => s.personagens)
  const [aba, setAba] = useState<number | 'broll'>(anime.temporadas[0]?.numero ?? 'broll')
  const [exportando, setExportando] = useState(false)
  const paraCortar = dados?.paraCortar[anime.pasta.toLowerCase()] ?? []

  useEffect(() => {
    if (!personagens) void useAcervo.getState().lerPersonagens()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const existe = aba === 'broll' ? anime.broll.length > 0 : anime.temporadas.some((t) => t.numero === aba)
    if (!existe) setAba(anime.temporadas[0]?.numero ?? 'broll')
  }, [anime, aba])

  const gente = useMemo(
    () =>
      (personagens ?? [])
        .map((p) => ({ p, n: p.porAnime.find((x) => x.anime.toLowerCase() === anime.nome.toLowerCase())?.cenas ?? 0 }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n),
    [personagens, anime.nome],
  )
  const temporada = aba === 'broll' ? null : (anime.temporadas.find((t) => t.numero === aba) ?? null)
  const lista = aba === 'broll' ? anime.broll : (temporada?.episodios ?? [])
  const faltamAqui = temporada?.faltam ?? []
  const paraCortarAqui = (n: number): ParaCortar | undefined => paraCortar.find((f) => f.episodio === n && (temporada ? f.temporada === temporada.numero : true))

  const exportar = async (): Promise<void> => {
    setExportando(true)
    const ids = [...anime.temporadas.flatMap((t) => t.episodios), ...anime.broll].map((e) => e.episodioId)
    const r = await window.dangai.acervoExportarElenco(ids, anime.nome)
    setExportando(false)
    const { avisar } = useAcervo.getState()
    if (!r.ok) return avisar(r.error, false)
    if (!r.value) return
    const v = r.value
    if (v.erro || v.personagens === 0) return avisar(v.erro || `“${anime.nome}” ainda não tem personagem batizado para exportar.`, false)
    const base = `Exportado: ${v.personagens} personagens de “${anime.nome}”, ${v.fotos} fotos${v.juntados ? `, ${v.juntados} nomes repetidos juntados` : ''}.`
    if (v.semFoto.length === v.personagens) avisar(`${base} Atenção: nenhum saiu com foto — este pacote só ajuda no "Batizar na mão".`, false)
    else if (v.semFoto.length > 0) avisar(`${base} ${v.semFoto.length} sem foto: ${v.semFoto.slice(0, 5).join(', ')}${v.semFoto.length > 5 ? '…' : ''}.`, false)
    else avisar(`${base} Todos com foto. Mande o .zip para quem quiser: no Dangai ou no AnCut dele, é "Importar elenco".`)
    if (v.arquivo) void window.dangai.revealFile(v.arquivo)
  }

  const cortarOsQueFaltam = (): void => {
    if (paraCortar.length === 0) return
    void useCortar.getState().adicionarDoAnime(
      paraCortar.map((f) => f.arquivo),
      { anime: anime.titulos[0] ?? anime.nome, pastaDoAnime: anime.nome, temporadas: Object.fromEntries(paraCortar.map((f) => [f.arquivo, f.temporada])) },
    )
    useAcervo.getState().fechar()
    useCortar.getState().abrir('arquivos')
  }

  const abrirOrganizar = (tipo: 'juntar' | 'temporada' | 'repescar'): void => useOrganizar.setState({ menu: null, dialogo: { tipo, alvo: alvoDoAnime(anime) } })
  const resumo = [
    anime.temporadas.length > 0 && `${anime.temporadas.length} ${anime.temporadas.length === 1 ? 'temporada' : 'temporadas'}`,
    anime.episodios > 0 && `${anime.episodios} ${anime.filme ? 'filme' : anime.episodios === 1 ? 'episódio' : 'episódios'}`,
    anime.broll.length > 0 && `${anime.broll.length} de B-roll`,
    `${anime.cenas.toLocaleString('pt-BR')} cenas`,
    gente.length > 0 && `${gente.length} ${gente.length === 1 ? 'personagem' : 'personagens'}`,
  ].filter(Boolean)
  const botao = 'flex h-8 items-center gap-1.5 rounded-sm border border-line bg-elevated px-3 text-[12px] text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-40'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5" data-acervo="pagina-do-anime">
      <nav className="flex items-center gap-1.5 text-[12px] text-ink-3">
        <button type="button" onClick={() => useAcervo.getState().abrirAnime(null)} className="text-accent hover:underline">
          Acervo
        </button>
        <ChevronRight size={12} />
        <span className="truncate text-ink-2">{anime.nome}</span>
      </nav>

      <section className="flex flex-wrap items-start gap-6">
        <Capa url={anime.capa} className="aspect-video w-[360px] max-w-full rounded-lg" />
        <div className="flex min-w-[320px] flex-1 flex-col gap-3">
          <h2 className="text-[24px] font-bold leading-tight text-ink">{anime.nome}</h2>
          <p className="text-[12px] text-ink-3">{resumo.join(' · ')}</p>
          {anime.titulos.length > 1 && (
            <p className="text-[11px] text-ink-3" title={anime.titulos.join('\n')}>
              {anime.titulos.length} títulos diferentes no histórico
            </p>
          )}
          <div className="flex max-w-[560px] flex-col gap-1.5 rounded-md border border-line bg-surface px-3 py-2.5">
            <div className="flex justify-between text-[12px]">
              <span>
                <span className="font-semibold text-ink">{pct(anime.marcadas, anime.cenas)}%</span> <span className="text-ink-3">das cenas têm personagem</span>
              </span>
              {anime.cenas - anime.marcadas > 0 && <span className="text-[#f6a23c]">{(anime.cenas - anime.marcadas).toLocaleString('pt-BR')} sem ninguém</span>}
            </div>
            <Cobertura marcadas={anime.marcadas} cenas={anime.cenas} />
          </div>
          {(paraCortar.length > 0 || anime.temporadas.some((t) => t.faltam.length > 0)) && (
            <div className="flex max-w-[560px] flex-col gap-1.5 rounded-md border border-[#f6a23c]/40 bg-[#f6a23c]/10 px-3 py-2.5 text-[12px] text-ink" data-acervo="falta">
              {anime.temporadas
                .filter((t) => t.faltam.length > 0)
                .map((t) => (
                  <p key={t.numero}>
                    Faltam na temporada {t.numero}: {t.faltam.slice(0, 20).map((n) => `E${String(n).padStart(2, '0')}`).join(', ')}
                    {t.faltam.length > 20 ? '…' : ''}
                  </p>
                ))}
              {paraCortar.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink-2">
                    Na pasta de onde os episódios vieram, {paraCortar.length === 1 ? '1 vídeo ainda não foi cortado' : `${paraCortar.length} vídeos ainda não foram cortados`}
                    {paraCortar.some((f) => f.episodio !== null) ? ` (${paraCortar.filter((f) => f.episodio !== null).slice(0, 8).map((f) => f.episodio).join(', ')})` : ''}.
                  </span>
                  <button type="button" onClick={cortarOsQueFaltam} className="flex h-7 items-center gap-1.5 rounded-sm bg-accent px-3 text-[12px] font-semibold text-white hover:bg-accent-hover" data-acervo="cortar-falta">
                    <Scissors size={12} strokeWidth={2} />
                    Cortar {paraCortar.length === 1 ? 'esse' : `os ${paraCortar.length}`}
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={botao} onClick={() => abrirOrganizar('repescar')} title="Procura personagem nas cenas sem ninguém: só marca quando as duas IAs concordam">
              <UserSearch size={13} strokeWidth={1.75} />
              Achar quem ficou sem marca
            </button>
            <button type="button" className={botao} onClick={() => void exportar()} disabled={exportando} title="Um .zip com os nomes, as fotos e o reconhecimento de cada personagem, para outra pessoa importar" data-acervo="exportar">
              {exportando ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} strokeWidth={1.75} />}
              Exportar elenco
            </button>
            <button type="button" className={botao} onClick={() => abrirOrganizar('juntar')}>
              <Combine size={13} strokeWidth={1.75} />
              Juntar com outro anime
            </button>
            <button type="button" className={botao} onClick={() => abrirOrganizar('temporada')}>
              <MoreHorizontal size={13} strokeWidth={1.75} />
              Mudar a temporada de todos
            </button>
            <button type="button" className={botao} onClick={() => void window.dangai.revealFile(anime.pasta)} title={anime.pasta}>
              <FolderOpen size={13} strokeWidth={1.75} />
              Abrir a pasta
            </button>
          </div>
        </div>
      </section>

      {gente.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-ink">Personagens</h3>
          <div className="flex flex-wrap gap-2">
            {gente.slice(0, 16).map(({ p, n }) => (
              <button
                key={p.nome}
                type="button"
                onClick={() => useAcervo.getState().abrirPersonagem(p, anime.nome)}
                className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-left hover:border-accent/50"
                title={p.apelidos.length ? `também: ${p.apelidos.join(', ')}` : p.nome}
              >
                <Rosto url={p.rosto} nome={p.nome} tamanho={28} />
                <span className="flex flex-col leading-tight">
                  <span className="text-[12px] font-medium text-ink">{p.nome}</span>
                  <span className="text-[10px] text-ink-3">{n} cenas</span>
                </span>
              </button>
            ))}
            {gente.length > 16 && (
              <button type="button" onClick={() => useAcervo.getState().setAba('personagens')} className="px-2 text-[12px] text-accent hover:underline">
                Ver todos ({gente.length})
              </button>
            )}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13px] font-semibold text-ink">{anime.filme ? 'Filmes' : 'Episódios'}</h3>
          {(anime.temporadas.length > 1 || anime.broll.length > 0) && (
            <div className="flex gap-1 rounded-md border border-line bg-surface p-0.5">
              {anime.temporadas.map((t) => (
                <button
                  key={t.numero}
                  type="button"
                  onClick={() => setAba(t.numero)}
                  className={['h-7 rounded-sm px-3 text-[12px] font-medium', aba === t.numero ? 'bg-accent-dim text-ink' : 'text-ink-3 hover:text-ink'].join(' ')}
                >
                  Temporada {t.numero} <span className="text-ink-3">{t.episodios.length}</span>
                </button>
              ))}
              {anime.broll.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAba('broll')}
                  className={['flex h-7 items-center gap-1 rounded-sm px-3 text-[12px] font-medium', aba === 'broll' ? 'bg-accent-dim text-ink' : 'text-ink-3 hover:text-ink'].join(' ')}
                >
                  <Film size={12} />
                  B-roll <span className="text-ink-3">{anime.broll.length}</span>
                </button>
              )}
            </div>
          )}
          <span className="flex-1" />
          <span className="text-[11px] text-ink-3">Clique para abrir · botão direito para mais opções</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
          {lista.map((e) => (
            <button
              key={e.episodioId}
              type="button"
              onClick={() => useAcervo.getState().abrirEpisodio(e)}
              onContextMenu={(ev) => abrirMenuDoOrganizar(ev, alvoDoEpisodio(anime, e))}
              className="lift flex flex-col overflow-hidden rounded-md border border-line bg-surface text-left hover:border-accent/40"
              data-acervo="episodio"
            >
              <span className="relative block">
                <Capa url={e.capa} className="aspect-video w-full" />
                <span className="absolute bottom-1.5 left-1.5 max-w-[90%] truncate rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white">{rotuloDoEpisodioDoAcervo(e)}</span>
              </span>
              <span className="flex items-center justify-between gap-2 px-2.5 py-2 text-[11px]">
                <span className="text-ink-3">{e.cenas} cenas</span>
                <span className={pct(e.marcadas, e.cenas) >= 60 ? 'text-emerald-300' : e.marcadas > 0 ? 'text-[#f6a23c]' : 'text-ink-3'}>
                  {e.marcadas > 0 ? `${pct(e.marcadas, e.cenas)}% com personagem` : 'só cortado'}
                </span>
              </span>
            </button>
          ))}
          {faltamAqui.map((n) => {
            const arquivo = paraCortarAqui(n)
            return (
              <div key={`falta-${n}`} className="flex aspect-[16/11] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong px-3 text-center" data-acervo="falta-episodio">
                <span className="text-[13px] font-semibold text-ink-3">
                  S{String(temporada?.numero ?? 1).padStart(2, '0')}E{String(n).padStart(2, '0')}
                </span>
                <span className="text-[11px] text-ink-3">ainda não cortado</span>
                {arquivo && (
                  <button
                    type="button"
                    onClick={() => {
                      void useCortar.getState().adicionarDoAnime([arquivo.arquivo], {
                        anime: anime.titulos[0] ?? anime.nome,
                        pastaDoAnime: anime.nome,
                        temporadas: { [arquivo.arquivo]: arquivo.temporada },
                      })
                      useAcervo.getState().fechar()
                      useCortar.getState().abrir('arquivos')
                    }}
                    title={arquivo.arquivo}
                    className="flex h-7 items-center gap-1.5 rounded-sm border border-accent/50 px-3 text-[11px] text-accent hover:bg-accent-dim"
                  >
                    <Scissors size={11} />
                    Cortar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

/** O rosto de um personagem (ou a inicial, sem foto). */
export function Rosto({ url, nome, tamanho = 40 }: { url: string; nome: string; tamanho?: number }) {
  return url ? (
    <img src={url} alt="" loading="lazy" style={{ width: tamanho, height: tamanho }} className="shrink-0 rounded-full bg-black/40 object-cover" />
  ) : (
    <span style={{ width: tamanho, height: tamanho, fontSize: Math.max(10, tamanho / 2.6) }} className="grid shrink-0 place-items-center rounded-full bg-accent-dim font-semibold text-accent">
      {nome.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

// ---------------------------------------------------------- um episodio

export function PaginaDoEpisodio({ anime, episodio }: { anime: AnimeDoAcervo; episodio: EpisodioDoAcervo }) {
  const personagensDoAcervo = useAcervo((s) => s.personagens)
  const [info, setInfo] = useState<{ personagens: PersonagemDoEpisodioAberto[]; cenas: number; semNinguem: number; video: string; videoExiste: boolean } | null>(null)
  const [filtro, setFiltro] = useState<number>(TODAS)
  const [cenas, setCenas] = useState<CenaDoAcervo[] | null>(null)
  const [lendo, setLendo] = useState(false)
  const [marcando, setMarcando] = useState<CenaDoAcervo[] | null>(null)
  const avisar = useAcervo.getState().avisar

  const lerInfo = async (): Promise<void> => {
    const r = await window.dangai.acervoEpisodio(episodio.episodioId)
    if (r.ok) setInfo(r.value)
    else avisar(r.error, false)
  }
  const lerCenas = async (qual = filtro): Promise<void> => {
    setLendo(true)
    const r = await window.dangai.acervoCenasDoEpisodio(episodio.episodioId, episodio.pasta, qual)
    setLendo(false)
    if (r.ok) setCenas(r.value)
    else avisar(r.error, false)
  }
  useEffect(() => {
    setInfo(null)
    setCenas(null)
    setFiltro(TODAS)
    void lerInfo()
    void lerCenas(TODAS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodio.episodioId])

  const escolher = (qual: number): void => {
    setFiltro(qual)
    setCenas(null)
    void lerCenas(qual)
  }
  /** Depois de mudar: este episodio, e o resto do acervo (contagens). */
  const depois = async (): Promise<void> => {
    await Promise.all([lerInfo(), lerCenas()])
    useAcervo.getState().mudou()
  }

  // Quem pode marcar: os do episodio e os do anime (do acervo), sem repetir nome.
  const opcoes = useMemo(() => {
    const vistos = new Set<string>()
    const saida: { id: number; nome: string; detalhe?: string }[] = []
    for (const p of info?.personagens ?? []) {
      vistos.add(p.nome.toLowerCase())
      saida.push({ id: p.id, nome: p.nome, detalhe: `${p.cenas} neste episódio` })
    }
    for (const p of personagensDoAcervo ?? []) {
      const n = p.porAnime.find((x) => x.anime.toLowerCase() === anime.nome.toLowerCase())?.cenas ?? 0
      if (n === 0 || vistos.has(p.nome.toLowerCase()) || !p.ids[0]) continue
      vistos.add(p.nome.toLowerCase())
      saida.push({ id: p.ids[0], nome: p.nome, detalhe: 'do anime' })
    }
    return saida
  }, [info, personagensDoAcervo, anime.nome])

  const atual = info?.personagens.find((p) => p.id === filtro) ?? null
  const reconhecer = (): void => {
    if (!info?.videoExiste) return
    useCortar.getState().adicionarPedido(
      {
        video: info.video,
        anime: episodio.anime,
        temporada: episodio.temporada,
        episodio: episodio.episodio,
        tipo: episodio.tipo === 'BROLL' ? 'BROLL' : '',
        modo: 'reconhecer',
        pastaDoAnime: anime.nome,
        ...(episodio.titulo ? { titulo: episodio.titulo } : {}),
      },
      `${anime.nome} · ${rotuloDoEpisodioDoAcervo(episodio)}`,
    )
    useAcervo.getState().fechar()
    useCortar.getState().abrir('arquivos')
    void useCortar.getState().comecar()
  }
  const item = (ativo: boolean): string =>
    ['flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] transition-colors', ativo ? 'bg-accent-dim text-ink' : 'text-ink-2 hover:bg-surface hover:text-ink'].join(' ')
  const botao = 'flex h-8 w-full items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 text-[12px] text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-40'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4" data-acervo="pagina-do-episodio">
      <nav className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-3">
        <button type="button" onClick={() => useAcervo.getState().abrirAnime(null)} className="text-accent hover:underline">
          Acervo
        </button>
        <ChevronRight size={12} />
        <button type="button" onClick={() => useAcervo.getState().abrirEpisodio(null)} className="text-accent hover:underline">
          {anime.nome}
        </button>
        <ChevronRight size={12} />
        <span className="text-ink-2">{rotuloDoEpisodioDoAcervo(episodio)}</span>
        <span className="flex-1" />
        <span>
          {episodio.cenas} cenas · {pct(episodio.marcadas, episodio.cenas)}% com personagem
        </span>
      </nav>
      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="flex w-[220px] shrink-0 flex-col gap-3 overflow-y-auto">
          <div className="flex flex-col gap-0.5">
            <button type="button" className={item(filtro === TODAS)} onClick={() => escolher(TODAS)}>
              <span className="min-w-0 flex-1 truncate">Todas as cenas</span>
              <span className="tnum text-[10px] text-ink-3">{info?.cenas ?? episodio.cenas}</span>
            </button>
            {[...(info?.personagens ?? [])]
              .sort((a, b) => b.cenas - a.cenas)
              .map((p) => (
                <button key={p.id} type="button" className={item(filtro === p.id)} onClick={() => escolher(p.id)} data-acervo="filtro-personagem">
                  <Users size={11} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                  <span className="tnum text-[10px] text-ink-3">{p.cenas}</span>
                </button>
              ))}
            <button type="button" className={item(filtro === SEM_NINGUEM)} onClick={() => escolher(SEM_NINGUEM)} data-acervo="sem-ninguem">
              <span className="min-w-0 flex-1 truncate">Sem ninguém</span>
              <span className="tnum text-[10px] text-ink-3">{info?.semNinguem ?? '…'}</span>
            </button>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-line pt-3">
            <button
              type="button"
              className={botao}
              onClick={reconhecer}
              disabled={!info?.videoExiste}
              title={info && !info.videoExiste ? `O vídeo original não está mais no lugar (${info.video || 'sem registro'})` : 'Corta de novo com o reconhecimento ligado; o que foi marcado na mão fica'}
            >
              <ScanFace size={13} strokeWidth={1.75} />
              Reconhecer de novo
            </button>
            <button type="button" className={botao} onClick={() => useOrganizar.setState({ dialogo: { tipo: 'reforcar', alvo: alvoDoEpisodio(anime, episodio) } })} title="Os rostos mais confiáveis deste episódio viram foto do elenco">
              <Sparkles size={13} strokeWidth={1.75} />
              Reforçar as fotos do elenco
            </button>
            <button type="button" className={botao} onClick={() => useOrganizar.setState({ dialogo: { tipo: 'repescar', alvo: alvoDoEpisodio(anime, episodio) } })}>
              <RefreshCw size={13} strokeWidth={1.75} />
              Repescar sem marcação
            </button>
            <button type="button" className={botao} onClick={(e) => abrirMenuDoOrganizar(e, alvoDoEpisodio(anime, episodio))}>
              <MoreHorizontal size={13} strokeWidth={1.75} />
              Temporada, B-roll, apagar…
            </button>
            <button type="button" className={botao} onClick={() => void window.dangai.revealFile(episodio.pasta)} title={episodio.pasta}>
              <FolderOpen size={13} strokeWidth={1.75} />
              Abrir a pasta
            </button>
          </div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <GradeDeCenas
            cenas={cenas}
            carregando={lendo}
            vazio={filtro === SEM_NINGUEM ? 'Toda cena tem alguém marcado.' : 'Nenhuma cena aqui.'}
            acoes={{
              marcar: (c) => setMarcando(c),
              ...(atual
                ? {
                    tirar: {
                      nome: atual.nome,
                      fazer: async (c) => {
                        const r = await window.dangai.acervoMarcar(c.map((x) => x.id), atual.id, true)
                        if (!r.ok) return avisar(r.error, false)
                        avisar(`${r.value} ${r.value === 1 ? 'cena deixou' : 'cenas deixaram'} de ser de ${atual.nome}.`)
                        await depois()
                      },
                    },
                  }
                : {}),
              lixeira: async (c) => {
                const r = await window.dangai.acervoLixeira([{ episodioId: episodio.episodioId, cenaIds: c.map((x) => x.id) }])
                if (!r.ok) return avisar(r.error, false)
                avisar(`${r.value} ${r.value === 1 ? 'cena foi' : 'cenas foram'} para a lixeira do episódio.`)
                await depois()
              },
              confirmarPalpite: async (c) => {
                if (!c.palpite) return
                const r = await window.dangai.acervoMarcar([c.id], c.palpite.id, false)
                if (!r.ok) return avisar(r.error, false)
                await depois()
              },
            }}
          />
        </div>
      </div>
      {marcando && (
        <MarcarCom
          quantas={marcando.length}
          opcoes={opcoes}
          aoFechar={() => setMarcando(null)}
          aoEscolher={async (e) => {
            const ids = marcando.map((x) => x.id)
            const r = 'id' in e ? await window.dangai.acervoMarcar(ids, e.id, false) : await window.dangai.acervoMarcarComNome(ids, e.nome)
            if (!r.ok) throw new Error(r.error)
            setMarcando(null)
            avisar(`${r.value} ${r.value === 1 ? 'cena marcada' : 'cenas marcadas'}.`)
            await depois()
          }}
        />
      )}
    </div>
  )
}
