import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Loader2, RefreshCw, Search, X } from 'lucide-react'
import type { LibraryClip } from '@shared/channels'
import { useProject } from '@/store/project'

/**
 * Busca na biblioteca de cenas que o AnCut HUB ja cortou.
 *
 * Resolve a dor declarada -- "encontrar material manualmente e extremamente
 * demorado" -- sem tocar em nada do que ja funciona: aqui so se ESCOLHE o
 * material. Quando ele sai daqui vira caminho de arquivo e entra pela mesma
 * porta do arraste, com a mesma analise e o mesmo render.
 *
 * Nao existe modelo, download nem GPU nesta tela. Tudo que ela mostra ja estava
 * no disco do usuario antes de o Dangai abrir.
 */

/** Largura alvo de cada miniatura. Define quantas colunas cabem. */
const ITEM_ALVO = 190
const GAP = 10
/** Altura da faixa de texto embaixo da miniatura. */
const RODAPE = 26
/** Linhas desenhadas fora da vista, de cada lado, para o scroll nao piscar. */
const FOLGA = 3

export function Library() {
  const open = useProject((s) => s.libraryOpen)
  const openLibrary = useProject((s) => s.openLibrary)
  const library = useProject((s) => s.library)
  const busy = useProject((s) => s.libraryBusy)
  const error = useProject((s) => s.libraryError)
  const syncLibrary = useProject((s) => s.syncLibrary)
  const addFromLibrary = useProject((s) => s.addFromLibrary)

  const [texto, setTexto] = useState('')
  const [anime, setAnime] = useState<string | null>(null)
  const [personagem, setPersonagem] = useState<string | null>(null)
  const [minSec, setMinSec] = useState(0)
  const [maxSec, setMaxSec] = useState(0)
  const [escolhidos, setEscolhidos] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void openLibrary(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openLibrary])

  // Sair da tela zera a escolha: manter selecao de uma visita para a outra faria
  // o usuario adicionar sem querer cenas que ele nem lembra ter marcado.
  useEffect(() => {
    if (!open) setEscolhidos([])
  }, [open])

  const filtrados = useMemo(() => {
    if (!library) return []
    const busca = texto.trim().toLowerCase()
    return library.clips.filter((clip) => {
      if (anime && clip.anime !== anime) return false
      if (personagem && !clip.characters.includes(personagem)) return false
      if (minSec > 0 && clip.duration < minSec) return false
      if (maxSec > 0 && clip.duration > maxSec) return false
      if (!busca) return true
      return textoDe(clip).includes(busca)
    })
  }, [library, texto, anime, personagem, minSec, maxSec])

  if (!open) return null

  const escolher = (id: string): void => {
    setEscolhidos((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    )
  }

  const adicionar = (): void => {
    if (!library) return
    // A ordem e a da GRADE, nao a de clique: o usuario le a grade em ordem
    // cronologica, e e essa a ordem que ele espera ver no video.
    const porId = new Map(library.clips.map((c) => [c.id, c.path]))
    const caminhos = filtrados
      .filter((c) => escolhidos.includes(c.id))
      .map((c) => porId.get(c.id))
      .filter((p): p is string => p !== undefined)
    void addFromLibrary(caminhos)
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex h-[46px] shrink-0 items-center gap-3 border-b border-line px-5">
        <h2 className="text-[15px] font-semibold text-ink">Biblioteca</h2>
        {library && (
          <span className="tnum text-[11px] text-ink-3">
            {library.clips.length.toLocaleString('pt-BR')} cenas · {library.episodes} episodios
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void syncLibrary()}
            disabled={busy !== null}
            title="Procura episodios novos na pasta"
            className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
            ) : (
              <RefreshCw size={12} strokeWidth={1.5} />
            )}
            Sincronizar
          </button>
          <button
            type="button"
            onClick={() => void openLibrary(false)}
            aria-label="Fechar"
            className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {error ? (
        <SemBiblioteca mensagem={error} />
      ) : !library ? (
        <div className="grid flex-1 place-items-center text-[13px] text-ink-3">
          <span className="flex items-center gap-2">
            <Loader2 size={14} strokeWidth={1.5} className="animate-spin text-accent" />
            {busy ?? 'Lendo a biblioteca...'}
          </span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <Rail
            clips={library.clips}
            anime={anime}
            personagem={personagem}
            onAnime={setAnime}
            onPersonagem={setPersonagem}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <Filtros
              texto={texto}
              onTexto={setTexto}
              minSec={minSec}
              maxSec={maxSec}
              onFaixa={(min, max) => {
                setMinSec(min)
                setMaxSec(max)
              }}
              total={filtrados.length}
            />
            <Grade clips={filtrados} escolhidos={escolhidos} onEscolher={escolher} />
          </div>
        </div>
      )}

      {escolhidos.length > 0 && (
        <footer className="flex h-[52px] shrink-0 items-center justify-between border-t border-line px-5">
          <span className="tnum text-[12px] text-ink-2">
            {escolhidos.length} {escolhidos.length === 1 ? 'cena marcada' : 'cenas marcadas'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEscolhidos([])}
              className="rounded-sm px-2.5 py-1.5 text-[12px] text-ink-3 hover:text-ink"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={adicionar}
              className="lift rounded-sm border border-accent bg-accent-dim px-3.5 py-1.5 text-[13px] font-medium text-ink"
            >
              Adicionar ao projeto
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}

/**
 * Tudo que a busca por texto enxerga de uma cena.
 *
 * O titulo do AnCut entra aqui mesmo sem agrupar nada: quem lembra de "Sennen
 * Kessen" ou de "Slime Datta Ken" tem que achar, ainda que a pasta se chame
 * "Bleach - Thousand Year Blood War" ou "Tensura".
 */
function textoDe(clip: LibraryClip): string {
  return `${clip.anime} ${clip.animeTitle} ${clip.characters.join(' ')} s${clip.season}e${clip.episode} ${clip.shot}`.toLowerCase()
}

// ------------------------------------------------------------------ sem pasta

function SemBiblioteca({ mensagem }: { mensagem: string }) {
  const syncLibrary = useProject((s) => s.syncLibrary)

  const escolher = async (): Promise<void> => {
    const result = await window.dangai.pickLibraryDir()
    if (result.ok && result.value) await syncLibrary()
  }

  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="max-w-[420px] text-center">
        <p className="mb-4 text-[13px] leading-relaxed text-ink-2">{mensagem}</p>
        <button
          type="button"
          onClick={() => void escolher()}
          className="lift inline-flex items-center gap-2 rounded-sm border border-line bg-elevated px-3 py-1.5 text-[13px] text-ink"
        >
          <FolderOpen size={13} strokeWidth={1.5} />
          Escolher a pasta da biblioteca
        </button>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          E a pasta onde o AnCut grava, a que contem uma pasta por anime. O Dangai so le: ele
          nunca renomeia, move nem apaga nada la dentro.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------- rail

interface RailProps {
  clips: readonly LibraryClip[]
  anime: string | null
  personagem: string | null
  onAnime: (v: string | null) => void
  onPersonagem: (v: string | null) => void
}

/**
 * Animes e personagens com a contagem do lado.
 *
 * A contagem nao e enfeite: e ela que diz de cara que dois tercos das cenas nao
 * tem personagem nenhum identificado -- que e exatamente o buraco que a busca
 * por texto ainda nao cobre.
 */
function Rail({ clips, anime, personagem, onAnime, onPersonagem }: RailProps) {
  const { animes, personagens, semRosto } = useMemo(() => {
    const porAnime = new Map<string, number>()
    const porPersonagem = new Map<string, number>()
    let sem = 0

    for (const clip of clips) {
      porAnime.set(clip.anime, (porAnime.get(clip.anime) ?? 0) + 1)
      if (clip.characters.length === 0) sem += 1
      for (const nome of clip.characters) {
        porPersonagem.set(nome, (porPersonagem.get(nome) ?? 0) + 1)
      }
    }

    const ordenar = (m: Map<string, number>): [string, number][] =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))

    return { animes: ordenar(porAnime), personagens: ordenar(porPersonagem), semRosto: sem }
  }, [clips])

  return (
    <nav className="w-[210px] shrink-0 overflow-y-auto border-r border-line p-3">
      <Titulo>Anime</Titulo>
      <Item ativo={anime === null} onClick={() => onAnime(null)} contagem={clips.length}>
        Todos
      </Item>
      {animes.map(([nome, n]) => (
        <Item key={nome} ativo={anime === nome} onClick={() => onAnime(nome)} contagem={n}>
          {nome}
        </Item>
      ))}

      <div className="my-3 h-px bg-line" />

      <Titulo>Personagem</Titulo>
      <Item
        ativo={personagem === null}
        onClick={() => onPersonagem(null)}
        contagem={clips.length}
      >
        Qualquer
      </Item>
      {personagens.map(([nome, n]) => (
        <Item
          key={nome}
          ativo={personagem === nome}
          onClick={() => onPersonagem(nome)}
          contagem={n}
        >
          {nome}
        </Item>
      ))}

      <p className="mt-3 px-1.5 text-[10px] leading-relaxed text-ink-3">
        {semRosto.toLocaleString('pt-BR')} cenas sem personagem identificado — cenario, planos
        abertos e detalhes. Por enquanto so da para chegar nelas rolando a grade.
      </p>
    </nav>
  )
}

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 px-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
      {children}
    </h3>
  )
}

function Item({
  ativo,
  onClick,
  contagem,
  children,
}: {
  ativo: boolean
  onClick: () => void
  contagem: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-[12px] transition-colors duration-150',
        ativo ? 'bg-accent-dim text-ink' : 'text-ink-2 hover:text-ink',
      ].join(' ')}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className="tnum shrink-0 text-[10px] text-ink-3">{contagem}</span>
    </button>
  )
}

// ------------------------------------------------------------------- filtros

interface FiltrosProps {
  texto: string
  onTexto: (v: string) => void
  minSec: number
  maxSec: number
  onFaixa: (min: number, max: number) => void
  total: number
}

/**
 * As faixas de duracao sao as do uso real: um bloco de narracao tem ~1.3s, e a
 * cena mediana da biblioteca tem 2.3s. "Curta" e "media" e o corte que decide se
 * o clipe cabe no bloco sem congelar o ultimo frame.
 */
const FAIXAS: readonly { nome: string; min: number; max: number }[] = [
  { nome: 'Qualquer', min: 0, max: 0 },
  { nome: 'ate 2s', min: 0, max: 2 },
  { nome: '2 a 5s', min: 2, max: 5 },
  { nome: 'mais de 5s', min: 5, max: 0 },
]

function Filtros({ texto, onTexto, minSec, maxSec, onFaixa, total }: FiltrosProps) {
  return (
    <div className="flex h-[46px] shrink-0 items-center gap-3 border-b border-line px-4">
      <div className="relative min-w-0 flex-1">
        <Search
          size={12}
          strokeWidth={1.5}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <input
          value={texto}
          onChange={(event) => onTexto(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Buscar por anime, personagem ou episodio (ex.: ichigo, s01e42)"
          spellCheck={false}
          className="w-full select-text rounded-sm border border-line bg-elevated py-1.5 pl-7 pr-2.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
        />
      </div>

      <div className="flex shrink-0 gap-1">
        {FAIXAS.map((faixa) => {
          const ativa = minSec === faixa.min && maxSec === faixa.max
          return (
            <button
              key={faixa.nome}
              type="button"
              onClick={() => onFaixa(faixa.min, faixa.max)}
              className={[
                'rounded-sm border px-2 py-1 text-[11px] transition-colors duration-150',
                ativa
                  ? 'border-accent bg-accent-dim text-ink'
                  : 'border-line bg-elevated text-ink-2 hover:text-ink',
              ].join(' ')}
            >
              {faixa.nome}
            </button>
          )
        })}
      </div>

      <span className="tnum shrink-0 text-[11px] text-ink-3">
        {total.toLocaleString('pt-BR')} {total === 1 ? 'resultado' : 'resultados'}
      </span>
    </div>
  )
}

// --------------------------------------------------------------------- grade

interface GradeProps {
  clips: readonly LibraryClip[]
  escolhidos: readonly string[]
  onEscolher: (id: string) => void
}

/**
 * Grade com janela de rolagem.
 *
 * Nove mil miniaturas de uma vez seriam nove mil nos no DOM e nove mil pedidos
 * ao servidor local. Desenhar so as linhas visiveis mantem isso em algumas
 * dezenas, e o espacador de cima e de baixo faz a barra de rolagem continuar
 * dizendo a verdade sobre o tamanho do acervo.
 */
function Grade({ clips, escolhidos, onEscolher }: GradeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(0)
  const [altura, setAltura] = useState(0)
  const [scroll, setScroll] = useState(0)

  /*
   * A medida sai antes da pintura, e nao so pelo observador.
   *
   * A primeira entrega do ResizeObserver depende do ciclo de renderizacao do
   * Chrome, e ela ATRASA quando a janela nao esta pintando -- foi medido: a
   * grade ficava vazia porque `largura` seguia zero. Medindo aqui, o primeiro
   * quadro ja sai certo e o observador cuida so do que vier depois.
   */
  useLayoutEffect(() => {
    const alvo = ref.current
    if (!alvo) return
    const medir = (): void => {
      setLargura(alvo.clientWidth)
      setAltura(alvo.clientHeight)
    }
    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(alvo)
    return () => observer.disconnect()
  }, [])

  // Filtro novo devolve a rolagem ao topo: continuar no meio de uma lista que
  // acabou de mudar mostra um pedaco aleatorio do resultado.
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
    setScroll(0)
  }, [clips])

  const colunas = Math.max(2, Math.floor((largura + GAP) / (ITEM_ALVO + GAP)))
  const itemW = colunas > 0 && largura > 0 ? (largura - GAP * (colunas - 1) - 24) / colunas : 0
  const linhaH = Math.round((itemW * 9) / 16) + RODAPE + GAP
  const linhas = Math.ceil(clips.length / colunas)

  const primeira = Math.max(0, Math.floor(scroll / linhaH) - FOLGA)
  const ultima = Math.min(linhas, Math.ceil((scroll + altura) / linhaH) + FOLGA)
  const visiveis = clips.slice(primeira * colunas, ultima * colunas)

  if (clips.length === 0) {
    return (
      <div className="grid flex-1 place-items-center text-[13px] text-ink-3">
        Nenhuma cena com esses filtros.
      </div>
    )
  }

  return (
    <div
      ref={ref}
      onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
    >
      <div style={{ height: linhas * linhaH, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: primeira * linhaH,
            left: 0,
            right: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))`,
            gap: GAP,
          }}
        >
          {itemW > 0 &&
            visiveis.map((clip) => (
              <Cartao
                key={clip.id}
                clip={clip}
                marcado={escolhidos.includes(clip.id)}
                onClick={() => onEscolher(clip.id)}
              />
            ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Uma cena na grade.
 *
 * Passar o mouse toca o clipe no lugar da miniatura. E o que separa "ver uma
 * imagem parada" de "saber se a cena serve": num acervo de anime metade das
 * miniaturas de um mesmo plano sao quase iguais, e o movimento e o que
 * distingue uma da outra.
 */
function Cartao({
  clip,
  marcado,
  onClick,
}: {
  clip: LibraryClip
  marcado: boolean
  onClick: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [dentro, setDentro] = useState(false)
  const timer = useRef<number | null>(null)

  const entrar = useCallback(() => {
    setDentro(true)
    // A espera evita publicar clipe a cada cena que o mouse atravessa de
    // passagem -- so o que o usuario parou para olhar vira pedido de verdade.
    timer.current = window.setTimeout(() => {
      void window.dangai.libraryClipUrl(clip.path).then((result) => {
        if (result.ok) setUrl(result.value)
      })
    }, 350)
  }, [clip.path])

  const sair = useCallback(() => {
    setDentro(false)
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={entrar}
      onMouseLeave={sair}
      title={`${clip.animeTitle || clip.anime} · S${pad(clip.season)}E${pad(clip.episode)} · cena ${clip.shot} · ${clip.duration.toFixed(1)}s`}
      className={[
        'group flex flex-col overflow-hidden rounded-sm border text-left transition-colors duration-150',
        marcado ? 'border-accent' : 'border-line hover:border-line-strong',
      ].join(' ')}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-elevated">
        <img
          src={clip.thumbUrl}
          alt=""
          loading="lazy"
          draggable={false}
          className="size-full object-cover"
        />
        {dentro && url && (
          <video
            src={url}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <span className="tnum absolute bottom-1 right-1 rounded-sm bg-black/70 px-1 py-0.5 text-[10px] text-white">
          {clip.duration.toFixed(1)}s
        </span>
        {marcado && (
          <span className="absolute inset-0 border-2 border-accent bg-accent-dim/30" />
        )}
      </div>

      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <span className="tnum shrink-0 text-[10px] text-ink-3">
          E{pad(clip.episode)}·{clip.shot}
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-ink-2">
          {clip.characters.join(', ')}
        </span>
      </div>
    </button>
  )
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
