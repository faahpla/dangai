import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Search, TriangleAlert } from 'lucide-react'
import type { BuscaDeAnime, CandidatoDeAnime, ElencoEscolhido } from '../../shared/descoberta'
import { ponte } from '../ponte'
import { Botao, CAMPO_PEQUENO, CLASSE_DO_CAMPO } from './pecas'

/**
 * "BUSCAR ELENCO" (A1, pedido do Levi em 18/10): quando o anime nao e achado
 * sozinho (o Jikan nao abre da rede dele, o nome do arquivo e o titulo inteiro
 * da light novel), ele digita o nome, escolhe da lista com a capa e o elenco
 * desse anime vira o do episodio. No Reconhecer na mao as fotos e as sugestoes
 * de nome chegam na hora; no passo 1, o corte recomeca com o elenco certo.
 *
 * Um botao que abre uma caixinha por baixo: o campo (Enter busca), a lista
 * (setas andam, Enter ou clique escolhe) e Esc fecha. A escolha fica guardada
 * no motor para este nome: as proximas analises ja acham o anime.
 */

const ROTULO_DA_FONTE: Record<string, string> = { anilist: 'AniList', mal: 'MAL', kitsu: 'Kitsu', jikan: 'MAL' }

function Capa({ url }: { url: string | null }) {
  const [quebrou, setQuebrou] = useState(false)
  useEffect(() => setQuebrou(false), [url])
  if (!url || quebrou) return <span className="h-[46px] w-8 shrink-0 rounded-[3px] bg-surface" />
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onError={() => setQuebrou(true)}
      className="h-[46px] w-8 shrink-0 rounded-[3px] object-cover"
    />
  )
}

export function BuscarElenco({
  episodioId,
  anime,
  principal = false,
  rotulo = 'Buscar elenco',
  depois,
}: {
  episodioId: string
  /** O nome do anime das analises (o campo do passo 1 ou o do indice): a escolha fica para ele. */
  anime: string
  principal?: boolean
  rotulo?: string
  /** Depois de montar o elenco (o passo 1 corta de novo). */
  depois?: (r: ElencoEscolhido) => void
}) {
  const [aberta, setAberta] = useState(false)
  const [termo, setTermo] = useState(anime)
  const [buscado, setBuscado] = useState<string | null>(null)
  const [busca, setBusca] = useState<BuscaDeAnime | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [escolhendo, setEscolhendo] = useState<CandidatoDeAnime | null>(null)
  const [marcado, setMarcado] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<ElencoEscolhido | null>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLInputElement>(null)

  // Abriu: o nome do anime no campo, ja buscado (o motor encurta o nome do arquivo sozinho).
  const buscarAoAbrir = useRef(false)
  useEffect(() => {
    if (!aberta) return
    requestAnimationFrame(() => {
      campo.current?.focus()
      campo.current?.select()
    })
    if (!busca && termo.trim().length >= 2) buscarAoAbrir.current = true
    // So na abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta])

  // Clique fora fecha (a busca no ar segue e e esquecida).
  useEffect(() => {
    if (!aberta) return
    const fora = (e: MouseEvent): void => {
      if (escolhendo) return
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberta(false)
    }
    window.addEventListener('mousedown', fora, true)
    return () => window.removeEventListener('mousedown', fora, true)
  }, [aberta, escolhendo])

  const buscar = async (): Promise<void> => {
    const t = termo.trim()
    if (t.length < 2 || buscando) return
    setBuscando(true)
    setErro(null)
    const r = await ponte.buscarAnime(t)
    setBuscando(false)
    if (!r.ok) {
      setErro(r.error)
      return
    }
    setBusca(r.value)
    setBuscado(t)
    setMarcado(0)
  }

  const escolher = async (c: CandidatoDeAnime): Promise<void> => {
    if (escolhendo) return
    setEscolhendo(c)
    setErro(null)
    const r = await ponte.escolherAnime({
      episodioId,
      anime: anime.trim() || termo.trim(),
      escolha: {
        fonte: c.fonte,
        titulo: c.titulo,
        tituloIngles: c.tituloIngles,
        anilistId: c.anilistId,
        malId: c.malId,
        kitsuId: c.kitsuId,
      },
    })
    setEscolhendo(null)
    if (!r.ok) {
      setErro(r.error)
      return
    }
    setFeito(r.value)
    setAberta(false)
    depois?.(r.value)
  }

  useEffect(() => {
    if (!buscarAoAbrir.current) return
    buscarAoAbrir.current = false
    void buscar()
  })

  const lista = busca?.candidatos ?? []
  const desatualizada = buscado !== null && buscado !== termo.trim()

  return (
    <div ref={caixa} className="relative flex shrink-0 items-center gap-2">
      <Botao
        pequeno
        principal={principal}
        onClick={() => {
          setAberta((a) => !a)
          setErro(null)
        }}
        title="Digite o nome do anime e escolha da lista: o elenco dele vira o deste episodio"
      >
        <Search size={12} strokeWidth={1.75} />
        {rotulo}
      </Botao>
      {feito && !aberta && (
        <span
          className="flex min-w-0 max-w-[260px] items-center gap-1 truncate text-[11px] text-ink-3"
          title={`${feito.titulo}: ${feito.personagens} personagens${feito.juntados.length ? `\nJuntados: ${feito.juntados.join(', ')}` : ''}`}
        >
          <Check size={11} strokeWidth={2} className="shrink-0 text-accent" />
          <span className="truncate">{feito.personagens} no elenco</span>
        </span>
      )}

      {aberta && (
        <div
          role="dialog"
          aria-label="Buscar elenco"
          className="absolute left-0 top-full z-40 mt-1 flex w-[440px] max-w-[80vw] flex-col gap-2 rounded-sm border border-line-strong bg-elevated p-2 shadow-lg shadow-black/40"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              if (!escolhendo) setAberta(false)
            }
          }}
        >
          <div className="flex items-center gap-2">
            <input
              ref={campo}
              type="text"
              value={termo}
              maxLength={200}
              disabled={escolhendo !== null}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && lista.length) {
                  e.preventDefault()
                  setMarcado((m) => Math.min(lista.length - 1, m + 1))
                } else if (e.key === 'ArrowUp' && lista.length) {
                  e.preventDefault()
                  setMarcado((m) => Math.max(0, m - 1))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  const alvo = lista[marcado]
                  if (alvo && buscado !== null && !desatualizada) void escolher(alvo)
                  else void buscar()
                }
              }}
              placeholder="Nome do anime"
              aria-label="Nome do anime"
              spellCheck={false}
              className={`${CLASSE_DO_CAMPO} ${CAMPO_PEQUENO} flex-1`}
            />
            <Botao pequeno onClick={() => void buscar()} disabled={buscando || escolhendo !== null || termo.trim().length < 2}>
              {buscando ? <Loader2 size={12} strokeWidth={1.75} className="animate-spin" /> : <Search size={12} strokeWidth={1.75} />}
              Buscar
            </Botao>
          </div>

          {erro && (
            <p className="flex items-start gap-1.5 text-[11px] text-danger" title={erro}>
              <TriangleAlert size={12} strokeWidth={1.5} className="mt-px shrink-0" />
              <span className="min-w-0 truncate">{erro}</span>
            </p>
          )}

          {escolhendo ? (
            <p className="flex items-center gap-2 px-1 py-2 text-[11px] text-ink-2">
              <Loader2 size={12} strokeWidth={1.75} className="shrink-0 animate-spin text-accent" />
              <span className="min-w-0 truncate">Montando o elenco de {escolhendo.tituloIngles || escolhendo.titulo}...</span>
            </p>
          ) : busca && !desatualizada ? (
            lista.length ? (
              <ul role="listbox" aria-label="Animes" className="flex max-h-[320px] flex-col overflow-y-auto">
                {lista.map((c, i) => (
                  <li
                    key={`${c.fonte}-${c.anilistId ?? ''}-${c.malId ?? ''}-${c.kitsuId ?? ''}-${i}`}
                    role="option"
                    aria-selected={i === marcado}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      void escolher(c)
                    }}
                    onMouseMove={() => setMarcado(i)}
                    title={[c.titulo, c.tituloIngles].filter(Boolean).join('\n')}
                    className={[
                      'flex h-[54px] cursor-pointer items-center gap-2 rounded-sm px-1.5',
                      i === marcado ? 'bg-accent-dim' : 'hover:bg-surface',
                    ].join(' ')}
                  >
                    <Capa url={c.capa} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[12px] text-ink">{c.tituloIngles || c.titulo}</span>
                      <span className="tnum truncate text-[11px] text-ink-3">
                        {[c.tituloIngles ? c.titulo : null, c.ano, c.formato].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-ink-3">{ROTULO_DA_FONTE[c.fonte] ?? c.fonte}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-1 py-2 text-[11px] text-ink-3">Nada achado. Tente outro nome.</p>
            )
          ) : buscando ? (
            <p className="flex items-center gap-2 px-1 py-2 text-[11px] text-ink-2">
              <Loader2 size={12} strokeWidth={1.75} className="shrink-0 animate-spin text-accent" />
              Buscando...
            </p>
          ) : (
            <p className="px-1 py-1 text-[11px] text-ink-3">Enter busca · setas escolhem · Esc fecha</p>
          )}

          {busca && busca.avisos.length > 0 && !desatualizada && (
            <p className="px-1 text-[10px] text-ink-3">{busca.avisos.join(' · ')}</p>
          )}
        </div>
      )}
    </div>
  )
}
