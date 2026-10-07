import { useEffect, useMemo, useRef, useState } from 'react'
import { Film, Image as ImageIcon, Music, Pause, Play, Search, X } from 'lucide-react'
import { classifyFile, type ArquivoDaBin } from '@shared/channels'
import { duracaoDoTrecho, TRANSITIONS_NA_TELA, type AjusteDaTransicao, type Transition } from '@shared/contract'
import { useProject } from '@/store/project'
import { useConsoleFx } from '@/store/layout'
import {
  aplicarNaEmenda,
  iniciarArrasteDeTransicao,
  TRANSITION_LABEL,
  usePresetsDeTransicao,
} from '@/store/transicoes'
import { iniciarArraste } from './arrastar'
import { IconeDaTransicao } from './EditorDeTransicao'

/**
 * O FX CONSOLE (Ctrl+Espaco): busca em TODAS as bins de uma vez.
 *
 * "Quando eu apertar Ctrl+Space ele abre uma janela que faz pesquisar nas
 * bins; quando eu digitar o nome de um sfx ele deixa eu arrastar para a
 * timeline -- eu nao quero ficar indo la nas bins toda hora."
 *
 * E uma janela FLUTUANTE, sem fundo escuro: a linha do tempo continua a vista
 * e recebendo o arraste. Fica aberta enquanto ele arrasta varios; Esc ou um
 * clique fora fecha. Enter (ou dois cliques) poe o escolhido na agulha, na
 * primeira faixa livre do tipo dele.
 */

type Item = ArquivoDaBin & { bin: string }

/*
 * AS TRANSICOES TAMBEM MORAM AQUI: digitar "zoom", "light", "pan" acha a
 * transicao (e os presets dele), que arrasta para um corte como um SFX
 * arrasta para a faixa. Enter poe no corte mais perto da agulha.
 */
interface ItemDeTransicao {
  chave: string
  nome: string
  tipo: Transition
  ajuste?: AjusteDaTransicao
  busca: string
}

/** Palavras que tambem acham cada transicao. */
const SINONIMOS: Partial<Record<Transition, string>> = {
  light: 'luz flash brilho',
  'zoom-in': 'aproximar entrar',
  'zoom-out': 'afastar sair',
  'pan-left': 'whip esquerda',
  'pan-right': 'whip direita',
  'pan-up': 'whip cima',
  'pan-down': 'whip baixo',
  crossfade: 'fade dissolve',
  'slide-left': 'deslizar empurrar',
  'slide-right': 'deslizar empurrar',
}

/** Sem acento e sem caixa: "impacto" acha "Impácto_01.wav". */
function normal(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Listagem das pastas ligadas, guardada entre aberturas. Reler e barato, mas nao a cada tecla. */
const cacheDePastas = new Map<string, ArquivoDaBin[]>()

export function ConsoleFx() {
  const aberto = useConsoleFx((s) => s.aberto)
  const fechar = useConsoleFx((s) => s.fechar)
  const bins = useProject((s) => s.bins)
  const [busca, setBusca] = useState('')
  const [escolhido, setEscolhido] = useState(0)
  const [versao, setVersao] = useState(0)
  const [tocando, setTocando] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const lista = useRef<HTMLDivElement | null>(null)
  const painel = useRef<HTMLDivElement | null>(null)
  const campo = useRef<HTMLInputElement | null>(null)

  /*
   * Ao abrir, a ultima busca volta SELECIONADA: Enter repete o mesmo som, e
   * digitar qualquer coisa ja substitui.
   */
  useEffect(() => {
    if (!aberto) return
    const id = requestAnimationFrame(() => {
      campo.current?.focus()
      campo.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [aberto])

  /*
   * Clique FORA fecha -- ouvido na janela, e nao numa cortina por cima de
   * tudo: uma cortina ficaria entre o arraste e a linha do tempo, e o arquivo
   * nunca chegaria nas faixas.
   */
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent): void => {
      if (painel.current && !painel.current.contains(e.target as Node)) fechar()
    }
    window.addEventListener('pointerdown', fora, true)
    return () => window.removeEventListener('pointerdown', fora, true)
  }, [aberto, fechar])

  // Esc fecha mesmo com o foco fora do console -- depois de um arraste, o foco
  // fica na pagina, e o Esc nao chegava ao campo de busca.
  useEffect(() => {
    if (!aberto) return
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') fechar()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aberto, fechar])

  // Ao abrir: rele as pastas ligadas (largou um som novo la? ja aparece).
  useEffect(() => {
    if (!aberto) {
      audio.current?.pause()
      setTocando(null)
      return
    }
    setEscolhido(0)
    let vivo = true
    void (async () => {
      for (const bin of bins) {
        if (!bin.pasta) continue
        const r = await window.dangai.listarPasta(bin.pasta)
        if (r.ok) cacheDePastas.set(bin.pasta, r.value)
      }
      if (vivo) setVersao((v) => v + 1)
    })()
    return () => {
      vivo = false
    }
  }, [aberto, bins])

  const todos = useMemo<Item[]>(() => {
    void versao
    const vistos = new Set<string>()
    const out: Item[] = []
    for (const bin of bins) {
      const soltos: ArquivoDaBin[] = bin.arquivos.flatMap((path) => {
        const tipo = classifyFile(path)
        return tipo === 'audio' || tipo === 'video' || tipo === 'image'
          ? [{ path, nome: path.split(/[\\/]/).pop() ?? path, tipo }]
          : []
      })
      for (const a of [...soltos, ...(bin.pasta ? (cacheDePastas.get(bin.pasta) ?? []) : [])]) {
        if (vistos.has(a.path)) continue
        vistos.add(a.path)
        out.push({ ...a, bin: bin.nome })
      }
    }
    return out
  }, [bins, versao])

  const achados = useMemo(() => {
    const termos = normal(busca).split(/\s+/).filter(Boolean)
    const lista = termos.length === 0 ? todos : todos.filter((a) => termos.every((t) => normal(a.nome).includes(t) || normal(a.bin).includes(t)))
    return lista.slice(0, 300)
  }, [todos, busca])

  const presetsDeTransicao = usePresetsDeTransicao((s) => s.lista)
  const presetsCarregados = usePresetsDeTransicao((s) => s.carregado)
  const carregarPresets = usePresetsDeTransicao((s) => s.carregar)
  useEffect(() => {
    if (aberto && !presetsCarregados) void carregarPresets()
  }, [aberto, presetsCarregados, carregarPresets])

  // So com busca: com o campo vazio a lista e das bins, como sempre foi.
  const transicoes = useMemo<ItemDeTransicao[]>(() => {
    const termos = normal(busca).split(/\s+/).filter(Boolean)
    if (termos.length === 0) return []
    const todas: ItemDeTransicao[] = [
      ...presetsDeTransicao.map((p) => ({
        chave: `p-${p.nome}`,
        nome: p.nome,
        tipo: p.tipo,
        ajuste: p.ajuste,
        busca: normal(`${p.nome} transicao preset ${TRANSITION_LABEL[p.tipo]} ${p.tipo} ${SINONIMOS[p.tipo] ?? ''}`),
      })),
      ...TRANSITIONS_NA_TELA.filter((t) => t !== 'cut').map((t) => ({
        chave: `t-${t}`,
        nome: TRANSITION_LABEL[t],
        tipo: t,
        busca: normal(`${TRANSITION_LABEL[t]} transicao ${t} ${SINONIMOS[t] ?? ''}`),
      })),
    ]
    return todas.filter((t) => termos.every((termo) => t.busca.includes(termo)))
  }, [busca, presetsDeTransicao])
  const total = transicoes.length + achados.length

  useEffect(() => setEscolhido(0), [busca])
  useEffect(() => {
    lista.current?.querySelector(`[data-indice="${escolhido}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [escolhido])

  if (!aberto) return null

  const ouvir = async (path: string): Promise<void> => {
    const el = audio.current
    if (!el) return
    if (tocando === path) {
      el.pause()
      setTocando(null)
      return
    }
    const r = await window.dangai.libraryClipUrl(path)
    if (!r.ok) return
    el.src = r.value
    el.currentTime = 0
    void el.play().catch(() => undefined)
    setTocando(path)
  }

  /** No corte mais perto da agulha. */
  const porNoCorte = (t: ItemDeTransicao): void => {
    const s = useProject.getState()
    const scenes = s.plan?.scenes ?? []
    if (scenes.length === 0) return
    const tempos = [0, ...scenes.slice(1).map((c) => c.start), s.audio?.durationSec ?? 0]
    let melhor = 0
    for (let e = 1; e < tempos.length; e++) {
      if (Math.abs(tempos[e]! - s.playhead) < Math.abs(tempos[melhor]! - s.playhead)) melhor = e
    }
    aplicarNaEmenda(melhor, t.tipo, t.ajuste)
  }

  /** Na agulha, na primeira faixa do tipo que esteja livre ali. */
  const porNaAgulha = (a: Item): void => {
    const s = useProject.getState()
    const t = s.playhead
    if (a.tipo === 'audio') {
      let faixa = 0
      while (s.trilhas.some((x) => x.faixa === faixa && t >= x.at - 1e-6 && t < x.at + duracaoDoTrecho(x))) faixa++
      void s.addTrilhasAt([a.path], t, faixa)
    } else {
      let faixa = 0
      while (
        s.sobreposicoes.some(
          (x) => x.faixa === faixa && t >= x.at - 1e-6 && t < x.at + (x.usarSec ?? x.durationSec - x.inicioSec),
        )
      )
        faixa++
      void s.addSobreposicoesAt([a.path], t, faixa)
    }
  }

  const Icone = (tipo: Item['tipo']) => (tipo === 'audio' ? Music : tipo === 'video' ? Film : ImageIcon)

  return (
    <>
      <div
        ref={painel}
        role="dialog"
        aria-label="FX Console"
        className="glass enter fixed left-1/2 top-[10%] z-[61] flex max-h-[62vh] w-[560px] -translate-x-1/2 flex-col rounded-lg"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            fechar()
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            setEscolhido((i) => Math.min(i + 1, total - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setEscolhido((i) => Math.max(i - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const t = transicoes[escolhido]
            if (t) {
              porNoCorte(t)
              return
            }
            const a = achados[escolhido - transicoes.length]
            if (a) porNaAgulha(a)
          }
        }}
      >
        <audio ref={audio} onEnded={() => setTocando(null)} className="hidden" />
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Search size={14} strokeWidth={1.5} className="shrink-0 text-ink-3" />
          <input
            ref={campo}
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nas bins: whoosh, impacto, seta..."
            aria-label="Buscar nas bins"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
          <span className="tnum shrink-0 text-[10px] text-ink-3">{total}</span>
          <button type="button" onClick={fechar} aria-label="Fechar o FX Console" className="text-ink-3 hover:text-ink">
            <X size={13} strokeWidth={1.75} />
          </button>
        </div>

        {total === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-ink-3">
            {bins.length === 0
              ? 'Nenhuma bin ainda. Crie uma no botao Bins e ponha seus SFX nela. Para transicoes, digite zoom, light ou pan.'
              : 'Nada com esse nome nas bins nem nas transicoes.'}
          </p>
        ) : (
          <div ref={lista} className="min-h-0 overflow-y-auto p-1.5">
            {transicoes.map((t, i) => (
              <div
                key={t.chave}
                data-indice={i}
                draggable
                onDragStart={(e) => iniciarArrasteDeTransicao(e, { tipo: t.tipo, ajuste: t.ajuste })}
                onMouseEnter={() => setEscolhido(i)}
                onDoubleClick={() => porNoCorte(t)}
                title="Arraste ate um corte da linha do tempo, ou Enter / dois cliques para por no corte mais perto da agulha"
                className={[
                  'flex cursor-grab items-center gap-2 rounded-sm px-2 py-1.5 text-[12px]',
                  i === escolhido ? 'bg-accent-dim text-ink' : 'text-ink-2',
                ].join(' ')}
              >
                <span className="shrink-0 text-accent">
                  <IconeDaTransicao tipo={t.tipo} />
                </span>
                <span className="min-w-0 flex-1 truncate">{t.nome}</span>
                <span className="shrink-0 text-[10px] text-ink-3">
                  {t.chave.startsWith('p-') ? `preset · ${TRANSITION_LABEL[t.tipo]}` : 'transicao'}
                </span>
              </div>
            ))}
            {achados.map((a, j) => {
              const i = j + transicoes.length
              const I = Icone(a.tipo)
              return (
                <div
                  key={a.path}
                  data-indice={i}
                  draggable
                  onDragStart={(e) => iniciarArraste(e, [a.path])}
                  onMouseEnter={() => setEscolhido(i)}
                  onDoubleClick={() => porNaAgulha(a)}
                  title={`${a.path}\nArraste para a linha do tempo, ou Enter / dois cliques para por na agulha`}
                  className={[
                    'flex cursor-grab items-center gap-2 rounded-sm px-2 py-1.5 text-[12px]',
                    i === escolhido ? 'bg-accent-dim text-ink' : 'text-ink-2',
                  ].join(' ')}
                >
                  <I size={13} strokeWidth={1.5} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                  <span className="max-w-[120px] shrink-0 truncate text-[10px] text-ink-3">{a.bin}</span>
                  {a.tipo === 'audio' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void ouvir(a.path)
                      }}
                      aria-label={tocando === a.path ? `Parar ${a.nome}` : `Ouvir ${a.nome}`}
                      className="grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-accent"
                    >
                      {tocando === a.path ? <Pause size={11} strokeWidth={2} /> : <Play size={11} strokeWidth={2} />}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <p className="border-t border-line px-3 py-1.5 text-[10px] text-ink-3">
          Arraste para a linha do tempo · Enter poe na agulha · zoom, light, pan acham transicoes · Esc fecha
        </p>
      </div>
    </>
  )
}
