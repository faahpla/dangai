import { useEffect, useState } from 'react'
import { Check, CircleAlert, FolderOpen, Link2, Loader2, Play, Scissors, Square, Trash2, TriangleAlert, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { rotuloDoEpisodio, type QualidadeDoDownload, type VideoDoLink } from '@shared/ancut'
import { useCortar, ouvirOMotor, type ItemDoCorte } from '@/store/cortar-episodios'
import { useProject } from '@/store/project'
import { Segmentos } from './painel'

/**
 * CORTAR EPISODIOS (20/11, o AnCut dentro do Dangai): "so corto o episodio" --
 * agora aqui. Solta (ou escolhe) os episodios, confere o anime e o numero que
 * o nome do arquivo deu, e a fila corta um depois do outro no motor do AnCut.
 * As cenas vao para a mesma pasta de sempre (D:\Animes) e aparecem na
 * Biblioteca. E o B-roll por link: cola o link, escolhe de que anime e, e o
 * video baixa e corta.
 */
export function CortarEpisodios() {
  const aberta = useCortar((s) => s.aberta)
  useEffect(() => {
    if (aberta) ouvirOMotor()
  }, [aberta])
  if (!aberta) return null
  return <Tela />
}

const VIDEO = /\.(mkv|mp4|avi|mov|webm|m4v|ts|m2ts)$/i

function Tela() {
  const { aba, motor, itens, rodando, lendo, modo } = useCortar(
    useShallow((s) => ({ aba: s.aba, motor: s.motor, itens: s.itens, rodando: s.rodando, lendo: s.lendo, modo: s.modo })),
  )
  const [sobre, setSobre] = useState(false)

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || useProject.getState().libraryOpen) return
      // Cortando, o Esc nao some com a tela: a fila continua, mas ele perderia o andamento de vista.
      if (useCortar.getState().rodando) return
      useCortar.getState().fechar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  const esperando = itens.filter((i) => i.status === 'esperando').length
  const prontos = itens.filter((i) => i.status === 'pronto').length
  const terminados = itens.filter((i) => i.status === 'pronto' || i.status === 'falhou' || i.status === 'cancelado').length
  const semMotor = motor !== null && !motor.achado

  const soltar = (ev: React.DragEvent): void => {
    ev.preventDefault()
    setSobre(false)
    const caminhos = Array.from(ev.dataTransfer.files)
      .map((f) => window.dangai.pathForFile(f))
      .filter((c) => VIDEO.test(c))
    if (caminhos.length > 0) void useCortar.getState().adicionar(caminhos)
  }

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-6" onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
      <div role="dialog" aria-label="Cortar episódios" className="glass enter flex h-[min(800px,94vh)] w-[min(1080px,96vw)] flex-col overflow-hidden rounded-lg" data-cortar="tela">
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-4">
          <span className="grid size-9 place-items-center rounded-md bg-accent-dim text-accent">
            <Scissors size={17} strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-[15px] font-semibold text-ink">Cortar episódios</h2>
            <p className="truncate text-[12px] text-ink-3">
              O mesmo corte do AnCut: as cenas vão para {motor?.saida ? <span className="text-ink-2">{motor.saida}</span> : 'a pasta do AnCut'} e já aparecem na Biblioteca.
            </p>
          </div>
          <span className="flex-1" />
          <div className="w-[260px]" data-cortar="abas">
            <Segmentos
              opcoes={[
                { valor: 'arquivos' as const, rotulo: 'Episódios', title: 'Episódios do computador' },
                { valor: 'link' as const, rotulo: 'B-roll por link', title: 'Trailer, gameplay, teaser: cola o link, baixa e corta' },
              ]}
              ativo={(v) => aba === v}
              onChange={(v) => useCortar.getState().setAba(v)}
            />
          </div>
          <button
            type="button"
            onClick={() => useCortar.getState().fechar()}
            aria-label="Fechar"
            title={rodando ? 'Fechar a tela (a fila continua cortando)' : 'Fechar (Esc)'}
            className="grid size-8 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink"
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        </header>

        {semMotor && (
          <div className="flex items-start gap-2 border-b border-line bg-[#f6a23c]/10 px-5 py-3 text-[12px] text-ink" data-cortar="sem-motor">
            <TriangleAlert size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#f6a23c]" />
            {motor.motivo}
          </div>
        )}

        {aba === 'link' ? (
          <PorLink />
        ) : (
          <section
            onDragOver={(e) => {
              e.preventDefault()
              setSobre(true)
            }}
            onDragLeave={() => setSobre(false)}
            onDrop={soltar}
            className={['min-h-0 flex-1 overflow-y-auto px-5 py-4 transition-colors', sobre ? 'bg-accent-dim/40' : ''].join(' ')}
          >
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  const r = await window.dangai.ancutEscolherVideos()
                  if (r.ok && r.value.length > 0) void useCortar.getState().adicionar(r.value)
                }}
                className="flex h-9 items-center gap-2 rounded-sm border border-line bg-elevated px-4 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
              >
                <FolderOpen size={14} strokeWidth={1.75} />
                Escolher episódios…
              </button>
              <span className="text-[12px] text-ink-3">ou solte os arquivos aqui</span>
              <span className="flex-1" />
              <div className="w-[340px]" data-cortar="modo">
                <Segmentos
                  opcoes={[
                    { valor: 'cortar' as const, rotulo: 'Só cortar', title: 'Pica o episódio em cenas: rápido, sem internet' },
                    {
                      valor: 'reconhecer' as const,
                      rotulo: 'Cortar e reconhecer',
                      title: 'Também marca quem o AnCut já conhece (o elenco do AniList e quem você batizou antes). Mais demorado.',
                    },
                  ]}
                  ativo={(v) => modo === v}
                  onChange={(v) => useCortar.getState().setModo(v)}
                />
              </div>
            </div>

            {itens.length === 0 ? (
              <div className="grid place-items-center rounded-lg border border-dashed border-line-strong px-6 py-16 text-center">
                <Scissors size={22} strokeWidth={1.5} className="mb-2 text-ink-3" />
                <p className="text-[13px] text-ink-2">Solte os episódios aqui (ou escolha acima).</p>
                <p className="mt-1 text-[11px] text-ink-3">O anime, a temporada e o episódio saem do nome do arquivo: confira antes de começar.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2" data-cortar="fila">
                {itens.map((i) => (
                  <ItemDaFila key={i.id} item={i} />
                ))}
              </div>
            )}
          </section>
        )}

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-5 py-3">
          <span className="text-[12px] text-ink-3">
            {lendo
              ? 'Lendo o nome dos arquivos…'
              : itens.length === 0
                ? 'Nada na fila.'
                : `${esperando} esperando${prontos > 0 ? ` · ${prontos} ${prontos === 1 ? 'pronto' : 'prontos'}` : ''}`}
          </span>
          {terminados > 0 && !rodando && (
            <button type="button" onClick={() => useCortar.getState().limparTerminados()} className="text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
              Limpar os terminados
            </button>
          )}
          <span className="flex-1" />
          {prontos > 0 && (
            <button
              type="button"
              onClick={() => {
                useCortar.getState().fechar()
                void useProject.getState().openLibrary(true)
              }}
              className="flex h-9 items-center gap-2 rounded-sm border border-line bg-elevated px-4 text-[13px] text-ink-2 hover:text-ink"
            >
              Abrir a Biblioteca
            </button>
          )}
          {rodando ? (
            <button
              type="button"
              onClick={() => useCortar.getState().cancelar()}
              className="flex h-9 items-center gap-2 rounded-sm border border-danger/50 bg-danger/10 px-5 text-[13px] font-semibold text-ink hover:bg-danger/20"
            >
              <Square size={13} strokeWidth={2} />
              Parar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void useCortar.getState().comecar()}
              disabled={esperando === 0 || semMotor || lendo}
              className="flex h-9 items-center gap-2 rounded-sm bg-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
              data-cortar="comecar"
            >
              <Play size={13} strokeWidth={2} />
              {esperando > 1 ? `Cortar os ${esperando}` : 'Cortar'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

const campo = 'h-8 rounded-sm border border-line bg-elevated px-2.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none disabled:opacity-60'

/** Um episodio da fila: o arquivo, o que ele e (editavel ate comecar), e o andamento. */
function ItemDaFila({ item }: { item: ItemDoCorte }) {
  const p = item.pedido
  const editavel = item.status === 'esperando'
  const mudar = useCortar.getState().mudar
  const broll = p.tipo === 'BROLL'
  const ativo = item.status === 'cortando' || item.status === 'baixando'
  return (
    <div
      className={[
        'flex flex-col gap-2 rounded-md border px-3 py-2.5',
        ativo ? 'border-accent/60 bg-accent-dim/30' : item.status === 'falhou' ? 'border-danger/40 bg-surface' : 'border-line bg-surface',
      ].join(' ')}
      data-cortar="item"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Situacao item={item} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={p.video || item.link?.url}>
          {item.nome}
        </span>
        {editavel && (
          <button
            type="button"
            onClick={() => useCortar.getState().remover(item.id)}
            title="Tirar da fila"
            aria-label="Tirar da fila"
            className="grid size-7 place-items-center rounded-sm text-ink-3 hover:text-danger"
          >
            <Trash2 size={13} strokeWidth={1.75} />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={p.anime}
          disabled={!editavel}
          onChange={(e) => mudar(item.id, { anime: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="De que anime é"
          aria-label="Anime"
          className={`${campo} w-[260px]`}
        />
        <select
          value={p.tipo}
          disabled={!editavel || !!item.link}
          onChange={(e) => mudar(item.id, { tipo: e.target.value === 'BROLL' ? 'BROLL' : '' })}
          aria-label="Tipo"
          className={`${campo} w-[120px]`}
        >
          <option value="">Episódio</option>
          <option value="BROLL">B-roll</option>
        </select>
        {broll ? (
          <input
            value={p.titulo ?? ''}
            disabled={!editavel}
            onChange={(e) => mudar(item.id, { titulo: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Nome do vídeo (vira o nome da pasta)"
            aria-label="Nome do B-roll"
            className={`${campo} min-w-[200px] flex-1`}
          />
        ) : (
          <>
            <label className="flex items-center gap-1.5 text-[11px] text-ink-3">
              Temporada
              <input
                type="number"
                min={1}
                value={p.temporada}
                disabled={!editavel}
                onChange={(e) => mudar(item.id, { temporada: Math.max(1, Number(e.target.value) || 1) })}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Temporada"
                className={`${campo} w-16`}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-ink-3">
              Episódio
              <input
                type="number"
                min={0}
                value={p.episodio}
                disabled={!editavel}
                onChange={(e) => mudar(item.id, { episodio: Math.max(0, Number(e.target.value) || 0) })}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Episódio"
                className={`${campo} w-20`}
              />
            </label>
          </>
        )}
        <span className="text-[11px] text-ink-3">{rotuloDoEpisodio(p)}</span>
      </div>
      {ativo && (
        <div className="flex items-center gap-2.5">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-black/40">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(item.andamento * 100)}%` }} />
          </div>
          <span className="tnum w-9 text-right text-[11px] text-ink-2">{Math.round(item.andamento * 100)}%</span>
          <span className="min-w-0 max-w-[45%] truncate text-[11px] text-ink-3">{item.etapa}</span>
        </div>
      )}
      {item.status === 'pronto' && (
        <p className="text-[11px] text-emerald-300" data-cortar="pronto">
          {item.cenas} {item.cenas === 1 ? 'cena' : 'cenas'}
          {item.personagens && item.personagens.length > 0 ? ` · ${item.personagens.slice(0, 6).join(', ')}${item.personagens.length > 6 ? '…' : ''}` : ''}
          {' '}· já na Biblioteca
        </p>
      )}
      {item.erro && <p className="text-[11px] text-danger">{item.erro}</p>}
    </div>
  )
}

function Situacao({ item }: { item: ItemDoCorte }) {
  const tamanho = 14
  if (item.status === 'cortando' || item.status === 'baixando') return <Loader2 size={tamanho} className="shrink-0 animate-spin text-accent" />
  if (item.status === 'pronto') return <Check size={tamanho} strokeWidth={2} className="shrink-0 text-emerald-300" />
  if (item.status === 'falhou') return <CircleAlert size={tamanho} strokeWidth={1.75} className="shrink-0 text-danger" />
  if (item.status === 'cancelado') return <X size={tamanho} strokeWidth={1.75} className="shrink-0 text-ink-3" />
  return item.link ? <Link2 size={tamanho} strokeWidth={1.75} className="shrink-0 text-ink-3" /> : <Scissors size={tamanho} strokeWidth={1.75} className="shrink-0 text-ink-3" />
}

const duracao = (s: number): string => {
  if (!s) return ''
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(ss).padStart(2, '0')}`
}

/**
 * O B-ROLL POR LINK (o "Baixar por link" do AnCut): cola o link (ou varios,
 * ou uma playlist), confere os videos, diz de que anime e. Cada um baixa para
 * a "Baixados" do anime e corta como B-roll ("B-roll 03 - Titulo").
 */
function PorLink() {
  const motor = useCortar((s) => s.motor)
  const [texto, setTexto] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [preparo, setPreparo] = useState('')
  const [videos, setVideos] = useState<VideoDoLink[] | null>(null)
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState('')
  const [anime, setAnime] = useState('')
  const [pastas, setPastas] = useState<string[]>([])
  const [qualidade, setQualidade] = useState<QualidadeDoDownload>('1080')

  useEffect(() => {
    void window.dangai.ancutPastaDoAnime('_').then((r) => r.ok && r.value && setPastas(r.value.existentes))
  }, [])
  useEffect(() => {
    if (!buscando) return
    return window.dangai.onAncutLinkEvento((e) => {
      if (e.tipo === 'ferramenta') setPreparo(`${e.mensagem}${e.fracao >= 0 ? ` ${Math.round(e.fracao * 100)}%` : ''}`)
    })
  }, [buscando])

  const buscar = async (): Promise<void> => {
    const links = texto.split(/\s+/).map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l))
    if (links.length === 0) return setErro('Cole um link que comece com http.')
    setBuscando(true)
    setErro('')
    setPreparo('')
    const achados: VideoDoLink[] = []
    for (const link of links) {
      const r = await window.dangai.ancutLinkListar(link)
      if (!r.ok) {
        setErro(r.error)
        continue
      }
      if (r.value.erro) setErro(r.value.erro)
      for (const v of r.value.itens) if (!achados.some((a) => a.url === v.url)) achados.push(v)
    }
    setBuscando(false)
    setPreparo('')
    setVideos(achados)
    setEscolhidos(new Set(achados.map((v) => v.url)))
  }

  const mandar = async (): Promise<void> => {
    const nome = anime.trim()
    if (!nome) return setErro('Diga de que anime (ou jogo) é: o B-roll fica na pasta dele.')
    if (!motor?.saida) return setErro('O AnCut ainda não tem pasta de saída.')
    const r = await window.dangai.ancutPastaDoAnime(nome)
    const pastaDoAnime = (r.ok && r.value?.pasta) || nome
    const sep = motor.saida.includes('/') && !motor.saida.includes('\\') ? '/' : '\\'
    const base = motor.saida.replace(/[\\/]+$/, '')
    const selecionados = (videos ?? []).filter((v) => escolhidos.has(v.url))
    useCortar.getState().adicionarLinks(selecionados, { anime: nome, pastaDoAnime, pasta: `${base}${sep}${pastaDoAnime}${sep}Baixados`, qualidade })
    setVideos(null)
    setTexto('')
    void useCortar.getState().comecar()
  }

  return (
    <section className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-cortar="link">
      <div className="flex flex-col gap-3">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          rows={3}
          placeholder="Cole o link do vídeo (ou vários, um por linha, ou uma playlist): trailer, gameplay, teaser…"
          aria-label="Links"
          className="resize-none rounded-sm border border-line bg-elevated px-3 py-2 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void buscar()}
            disabled={buscando || !texto.trim()}
            className="flex h-9 items-center gap-2 rounded-sm border border-line bg-elevated px-4 text-[13px] text-ink-2 hover:text-ink disabled:opacity-40"
          >
            {buscando ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} strokeWidth={1.75} />}
            Ver os vídeos do link
          </button>
          {buscando && <span className="text-[12px] text-ink-3">{preparo || 'Abrindo o link…'}</span>}
          {erro && <span className="text-[12px] text-danger">{erro}</span>}
        </div>

        {videos && videos.length > 0 && (
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3">
            <div className="flex flex-col gap-1">
              {videos.map((v) => (
                <label key={v.url} className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-[12px] text-ink-2 hover:bg-elevated">
                  <input
                    type="checkbox"
                    checked={escolhidos.has(v.url)}
                    onChange={(e) => {
                      const novo = new Set(escolhidos)
                      if (e.target.checked) novo.add(v.url)
                      else novo.delete(v.url)
                      setEscolhidos(novo)
                    }}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 flex-1 truncate text-ink">{v.titulo}</span>
                  <span className="tnum text-[11px] text-ink-3">{duracao(v.duracao)}</span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                value={anime}
                list="cortar-pastas-de-anime"
                onChange={(e) => setAnime(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="De que anime (ou jogo) é"
                aria-label="De que anime é"
                className={`${campo} w-[280px]`}
              />
              <datalist id="cortar-pastas-de-anime">
                {pastas.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              <div className="w-[240px]">
                <Segmentos
                  opcoes={[
                    { valor: '1080' as const, rotulo: 'Até 1080p', title: 'MP4 em H.264: abre liso no editor. O recomendado.' },
                    { valor: 'max' as const, rotulo: 'Máxima (4K)', title: 'A maior que o vídeo tiver: arquivo maior e mais pesado.' },
                  ]}
                  ativo={(v) => qualidade === v}
                  onChange={setQualidade}
                />
              </div>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => void mandar()}
                disabled={escolhidos.size === 0 || !anime.trim() || !motor?.achado}
                className="flex h-9 items-center gap-2 rounded-sm bg-accent px-5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
              >
                <Scissors size={13} strokeWidth={2} />
                Baixar e cortar {escolhidos.size > 1 ? `os ${escolhidos.size}` : ''}
              </button>
            </div>
            <p className="text-[11px] text-ink-3">
              O vídeo fica guardado na pasta “Baixados” do anime e vira um B-roll dele (“B-roll 01 - Título”) na Biblioteca. B-roll é sempre só corte: o
              AnCut não procura personagem em trailer.
            </p>
          </div>
        )}
        {videos && videos.length === 0 && !erro && <p className="text-[12px] text-ink-3">Nenhum vídeo nesse link.</p>}
      </div>
    </section>
  )
}
