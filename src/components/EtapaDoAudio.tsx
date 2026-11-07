import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  AudioWaveform,
  FileAudio,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  Plug,
  Scissors,
  SkipForward,
  Trash2,
  Wand2,
} from 'lucide-react'
import { classifyFile, type AudioEditado, type OndaDaGravacao, type PluginInstalado } from '@shared/channels'
import {
  apagarIntervalo,
  apagarTrecho,
  cortarEm,
  cortarSilencios,
  duracaoEditada,
  duracoesDasFontes,
  fatorDaVelocidade,
  FONTE_PRINCIPAL,
  fonteDo,
  ganhoDoTrecho,
  iniciosEditados,
  inserirEm,
  SILENCIOS_PADRAO,
  substituirIntervalo,
  trechoDaCorrecao,
  VELOCIDADE_MAX,
  VELOCIDADE_MIN,
  VELOCIDADES_RAPIDAS,
  type CadeiaDeAudio,
  type Correcao,
  type EdicaoDeAudio,
  type OpcoesDosSilencios,
} from '@shared/edicao-de-audio'
import { useProject } from '@/store/project'
import { desfazer, refazer } from '@/store/undo'
import { avisar } from '@/store/aviso'
import { BarraDeEtapas } from './BarraDeEtapas'
import { Botaozinho, Deslizante, Grupo, Linha, Segmentos } from './painel'

/**
 * A ETAPA DE AUDIO: a gravacao crua vira a narracao, sem sair do Dangai.
 *
 * "A unica coisa que me prende a outro software e o processo que eu tenho para
 * editar o audio." Em cima, a gravacao na linha do tempo -- cortar (C), apagar
 * (Delete) com o buraco fechando, cortar os silencios de uma vez; do lado, a
 * cadeia dele na ordem dele: isolar a voz (IA), nivelar, EQ, compressor, os
 * plugins (o Fresh Air) e normalizar. "Pronto" grava a narracao ao lado da
 * gravacao e abre a Biblioteca.
 *
 * O que ele ouve e o que vai para o video: o mesmo arquivo que o "Pronto"
 * grava (electron/services/edicao-de-audio.ts). Mexer num efeito refaz o som em
 * segundo plano; cortar e instantaneo na tela e o som acompanha logo depois.
 */
export function EtapaDoAudio() {
  const aberta = useProject((s) => s.etapaDoAudio)
  const edicao = useProject((s) => s.edicaoDeAudio)
  if (!aberta || !edicao) return null
  return <Tela edicao={edicao} />
}

const POR_SEGUNDO = 100

function relogio(s: number): string {
  const t = Math.max(0, s)
  const m = Math.floor(t / 60)
  const r = t - m * 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}

function Tela({ edicao }: { edicao: EdicaoDeAudio }) {
  const mudar = useProject((s) => s.mudarEdicaoDeAudio)
  const concluir = useProject((s) => s.concluirEtapaDoAudio)
  const pular = useProject((s) => s.pularEtapaDoAudio)
  const busy = useProject((s) => s.busy)

  const [comEfeitos, setComEfeitos] = useState(true)
  const [ondas, setOndas] = useState<Record<string, OndaDaGravacao> | null>(null)
  const [som, setSom] = useState<AudioEditado | null>(null)
  const [andamento, setAndamento] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [agulha, setAgulha] = useState(0)
  const [tocando, setTocando] = useState(false)
  const [selecao, setSelecao] = useState<{ a: number; b: number } | null>(null)
  const [escolhido, setEscolhido] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)

  const duracao = duracaoEditada(edicao.trechos)
  /** A velocidade da narracao final (1,15 = 115%). A tela continua no tempo da gravacao. */
  const fator = fatorDaVelocidade(edicao.cadeia)
  const player = useRef<HTMLAudioElement | null>(null)
  if (!player.current) player.current = new Audio()

  // O que o motor esta fazendo (lendo, limpando, passando pelo Fresh Air).
  useEffect(() => window.dangai.onProgressoDaEdicao((m) => setAndamento(m)), [])

  /*
   * A ONDA so muda com os efeitos (ou com a escuta), nao com os cortes: ela e
   * da gravacao inteira, e a tela corta pelos trechos.
   */
  const receitaDaOnda = JSON.stringify([edicao.bruto, edicao.correcoes.map((c) => c.caminho), comEfeitos ? cadeiaSemVelocidade(edicao.cadeia) : null])
  useEffect(() => {
    let vivo = true
    const t = setTimeout(() => {
      void window.dangai.ondaDaEdicao(edicao, comEfeitos).then((r) => {
        if (!vivo) return
        if (r.ok) setOndas(r.value)
        else setErro(r.error)
      })
    }, 350)
    return () => {
      vivo = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receitaDaOnda])

  // O SOM muda com tudo: os cortes e os efeitos. Pedido depois que ele para de mexer.
  const receitaDoSom = JSON.stringify([edicao.bruto, edicao.correcoes.map((c) => c.caminho), edicao.trechos, comEfeitos ? cadeiaSemVelocidade(edicao.cadeia) : null])
  useEffect(() => {
    let vivo = true
    const t = setTimeout(() => {
      setErro(null)
      void window.dangai.renderizarEdicao(edicao, comEfeitos).then((r) => {
        if (!vivo) return
        setAndamento(null)
        if (r.ok) setSom(r.value)
        else setErro(r.error)
      })
    }, 400)
    return () => {
      vivo = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receitaDoSom])

  /*
   * Som novo: continua do mesmo ponto, tocando se estava tocando. O ponto e o
   * da linha do tempo de agora -- depois de um corte, o que vem depois andou
   * para tras, e a agulha fica onde ele a deixou.
   */
  useEffect(() => {
    const p = player.current!
    if (!som) return
    const continuar = !p.paused
    p.src = som.url
    const aoCarregar = (): void => {
      p.currentTime = Math.min(agulha, Math.max(0, p.duration - 0.05))
      if (continuar) void p.play()
    }
    p.addEventListener('loadedmetadata', aoCarregar, { once: true })
    return () => p.removeEventListener('loadedmetadata', aoCarregar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [som?.url])

  /*
   * A VELOCIDADE NO PREVIEW: o proprio navegador acelera sem mudar o tom
   * (preservesPitch), sem renderizar nada -- trocar de 110 para 120 e na hora. A
   * agulha e os cortes continuam no tempo da gravacao; a narracao final sai
   * acelerada pelo Rubber Band no "Pronto".
   */
  useEffect(() => {
    const p = player.current!
    p.preservesPitch = true
    p.defaultPlaybackRate = fator
    p.playbackRate = fator
  }, [fator, som?.url])

  // A agulha acompanha o som enquanto toca.
  useEffect(() => {
    const p = player.current!
    let quadro = 0
    const andar = (): void => {
      setAgulha(p.currentTime)
      quadro = requestAnimationFrame(andar)
    }
    const aoTocar = (): void => {
      setTocando(true)
      quadro = requestAnimationFrame(andar)
    }
    const aoParar = (): void => {
      setTocando(false)
      cancelAnimationFrame(quadro)
    }
    p.addEventListener('play', aoTocar)
    p.addEventListener('pause', aoParar)
    p.addEventListener('ended', aoParar)
    return () => {
      cancelAnimationFrame(quadro)
      p.pause()
      p.removeEventListener('play', aoTocar)
      p.removeEventListener('pause', aoParar)
      p.removeEventListener('ended', aoParar)
    }
  }, [])

  const irPara = useCallback((t: number): void => {
    const x = Math.max(0, t)
    setAgulha(x)
    const p = player.current!
    if (p.src) p.currentTime = Math.min(x, Number.isFinite(p.duration) ? p.duration : x)
  }, [])

  const alternarPlay = useCallback((): void => {
    const p = player.current!
    if (!p.src) return
    if (p.paused) void p.play()
    else p.pause()
  }, [])

  const cortar = useCallback((): void => mudar((e) => ({ ...e, trechos: cortarEm(e.trechos, agulha) })), [mudar, agulha])

  const apagar = useCallback((): void => {
    if (selecao && Math.abs(selecao.b - selecao.a) > 0.01) {
      const ini = Math.min(selecao.a, selecao.b)
      mudar((e) => ({ ...e, trechos: apagarIntervalo(e.trechos, selecao.a, selecao.b) }))
      setSelecao(null)
      irPara(ini)
      return
    }
    if (escolhido !== null) {
      const inicio = iniciosEditados(edicao.trechos)[escolhido] ?? 0
      mudar((e) => ({ ...e, trechos: apagarTrecho(e.trechos, escolhido) }))
      setEscolhido(null)
      irPara(inicio)
    }
  }, [selecao, escolhido, mudar, irPara, edicao.trechos])

  // O teclado da etapa. Os atalhos do editor ficam quietos por baixo (App.tsx).
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent): void => {
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) refazer()
        else desfazer()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        refazer()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'Space') {
        e.preventDefault()
        alternarPlay()
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault()
        cortar()
      } else if (e.key === 'Delete' || e.key === 'Backspace' || e.key.toLowerCase() === 'x') {
        e.preventDefault()
        apagar()
      } else if (e.key === 'Escape') {
        setSelecao(null)
        setEscolhido(null)
      } else if (e.key === 'Home') {
        irPara(0)
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [alternarPlay, cortar, apagar, irPara])

  const [silencios, setSilencios] = useState(false)

  /*
   * A CORRECAO ENTRA: com um pedaco selecionado, no lugar dele; sem, na agulha.
   * Depois e cortar o que sobrou dela, do mesmo jeito do resto.
   */
  const importarCorrecoes = useCallback(
    async (caminhos: readonly string[]): Promise<void> => {
      const audios = caminhos.filter((c) => classifyFile(c) === 'audio')
      if (audios.length === 0) return
      setErro(null)
      const novas: Correcao[] = []
      for (const [i, caminho] of audios.entries()) {
        const r = await window.dangai.analyzeAudio(caminho)
        if (!r.ok) {
          setErro(r.error)
          return
        }
        novas.push({ id: `correcao-${Date.now()}-${i}`, caminho, nome: r.value.fileName, duracao: r.value.durationSec })
      }
      const blocos = novas.map(trechoDaCorrecao)
      const sel = selecao && Math.abs(selecao.b - selecao.a) > 0.01 ? selecao : null
      mudar((e) => ({
        ...e,
        correcoes: [...e.correcoes, ...novas],
        trechos: sel ? substituirIntervalo(e.trechos, sel.a, sel.b, blocos) : inserirEm(e.trechos, agulha, blocos),
      }))
      if (sel) irPara(Math.min(sel.a, sel.b))
      setSelecao(null)
      setEscolhido(null)
      avisar(
        sel
          ? 'A correção entrou no lugar da seleção (em azul). Corte o que sobrar dela com C e Delete.'
          : 'A correção entrou na agulha (em azul). Apague o pedaço ruim e corte o que sobrar dela.',
        8000,
      )
    },
    [selecao, agulha, mudar, irPara],
  )

  const escolherCorrecao = async (): Promise<void> => {
    const r = await window.dangai.pickFiles()
    if (r.ok && r.value.length > 0) await importarCorrecoes(r.value)
  }

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-bg"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        // Audio solto aqui e CORRECAO, nao uma gravacao nova: a etapa trata e nao deixa subir.
        const caminhos = Array.from(e.dataTransfer.files).map((f) => window.dangai.pathForFile(f))
        if (!caminhos.some((c) => classifyFile(c) === 'audio')) return
        e.preventDefault()
        e.stopPropagation()
        void importarCorrecoes(caminhos)
      }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-3">
        <AudioWaveform size={16} strokeWidth={1.5} className="text-accent" />
        <h1 className="text-[15px] font-semibold text-ink">Áudio</h1>
        <span className="min-w-0 truncate text-[12px] text-ink-3" title={edicao.bruto}>
          {edicao.bruto.split(/[\\/]/).pop()}
        </span>
        <span className="tnum shrink-0 text-[12px] text-ink-3">
          {relogio(edicao.duracaoBruta)} → <span className="text-ink-2">{relogio(duracao / fator)}</span>
          {edicao.duracaoBruta - duracao / fator > 0.5 && ` (−${Math.round(edicao.duracaoBruta - duracao / fator)} s)`}
          {fator !== 1 && <span className="text-accent">{` · ${Math.round(fator * 100)}%`}</span>}
          {comEfeitos && som?.lufs != null && ` · ${som.lufs.toFixed(1)} LUFS`}
        </span>
        <span className="flex-1" />
        <BarraDeEtapas />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void pular()}
          disabled={busy !== null}
          title="Usar a gravação como está, sem cortes nem efeitos"
          className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] text-ink-3 transition-colors hover:text-ink disabled:opacity-40"
        >
          <SkipForward size={13} strokeWidth={1.5} />
          Pular
        </button>
        <button
          type="button"
          onClick={() => void concluir()}
          disabled={busy !== null}
          title="Grava a narração final ao lado da gravação e segue para as legendas"
          className="flex items-center gap-2 rounded-sm border border-accent bg-accent-dim px-4 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-accent/30 disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {busy ?? 'Pronto'}
          {!busy && <ArrowRight size={14} strokeWidth={1.75} />}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={alternarPlay}
              title="Tocar ou pausar (espaço)"
              className="grid size-8 place-items-center rounded-sm border border-line bg-elevated text-ink hover:border-line-strong"
            >
              {tocando ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <span className="tnum w-[96px] text-[12px] text-ink-2">
              {relogio(agulha)} / {relogio(duracao)}
            </span>
            <Botaozinho onClick={cortar} title="Corta na agulha (C)">
              <Scissors size={12} strokeWidth={1.5} /> Cortar
            </Botaozinho>
            <Botaozinho
              onClick={apagar}
              disabled={!selecao && escolhido === null}
              title="Apaga o trecho escolhido ou a seleção, e fecha o buraco (Delete)"
            >
              <Trash2 size={12} strokeWidth={1.5} /> Apagar
            </Botaozinho>
            <Botaozinho active={silencios} onClick={() => setSilencios((v) => !v)} title="Encolher todas as pausas longas de uma vez">
              <Wand2 size={12} strokeWidth={1.5} /> Cortar silêncios
            </Botaozinho>
            <Botaozinho
              onClick={() => void escolherCorrecao()}
              title="Um pedaço regravado: entra no lugar da seleção, ou na agulha. Também dá para soltar o arquivo aqui"
            >
              <FileAudio size={12} strokeWidth={1.5} /> Importar correção
            </Botaozinho>
            <span className="mx-1 h-5 w-px bg-line" />
            <div className="flex rounded-sm border border-line bg-elevated p-0.5">
              {([true, false] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setComEfeitos(v)}
                  title={v ? 'Ouvir como vai ficar' : 'Ouvir a gravação crua, só com os cortes'}
                  className={[
                    'h-6 rounded-[3px] px-2 text-[11px] transition-colors',
                    comEfeitos === v ? 'bg-accent-dim text-ink ring-1 ring-inset ring-accent' : 'text-ink-3 hover:text-ink-2',
                  ].join(' ')}
                >
                  {v ? 'Com efeitos' : 'Sem efeitos'}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            {escolhido !== null && edicao.trechos[escolhido] && (
              <div className="flex w-[260px] items-center gap-2">
                <span className="shrink-0 text-[11px] text-ink-3">Volume do trecho</span>
                <Deslizante textoLargo
                  valor={edicao.trechos[escolhido]!.ganhoDb}
                  min={-24}
                  max={12}
                  step={0.5}
                  padrao={0}
                  texto={`${edicao.trechos[escolhido]!.ganhoDb > 0 ? '+' : ''}${edicao.trechos[escolhido]!.ganhoDb} dB`}
                  onChange={(v) => mudar((e) => ({ ...e, trechos: ganhoDoTrecho(e.trechos, escolhido, v) }))}
                />
              </div>
            )}
            <button type="button" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} title="Afastar" className="grid size-7 place-items-center rounded-sm text-ink-3 hover:text-ink">
              <Minus size={13} />
            </button>
            <button type="button" onClick={() => setZoom((z) => Math.min(60, z * 1.5))} title="Aproximar" className="grid size-7 place-items-center rounded-sm text-ink-3 hover:text-ink">
              <Plus size={13} />
            </button>
          </div>

          {silencios && (
            <CortarSilencios
              edicao={edicao}
              aoCortar={(n, s) => {
                setSilencios(false)
                avisar(n === 0 ? 'Nenhuma pausa longa para encolher.' : `${n} ${n === 1 ? 'pausa encolhida' : 'pausas encolhidas'}: ${s.toFixed(1).replace('.', ',')} s a menos.`, 6000)
              }}
            />
          )}

          <LinhaDoTempo
            edicao={edicao}
            ondas={ondas}
            agulha={agulha}
            tocando={tocando}
            zoom={zoom}
            selecao={selecao}
            escolhido={escolhido}
            onAgulha={irPara}
            onSelecao={setSelecao}
            onEscolher={setEscolhido}
            onZoom={setZoom}
          />

          <p className="flex min-h-5 items-center gap-2 text-[12px] text-ink-3">
            {erro ? (
              <span className="text-danger">{erro}</span>
            ) : andamento ? (
              <>
                <Loader2 size={12} className="animate-spin text-accent" />
                {andamento}
              </>
            ) : (
              'Régua: arraste a agulha · clique leva a agulha · arraste para selecionar · C corta · Delete apaga · Ctrl ou Alt + roda: zoom · botão do meio: navegar · Ctrl+Z desfaz'
            )}
          </p>

          <Correcoes edicao={edicao} agulha={agulha} selecao={selecao} aoUsar={() => setSelecao(null)} />
        </main>

        <aside className="flex w-[380px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-line p-4">
          <Efeitos cadeia={edicao.cadeia} mudar={(f) => mudar((e) => ({ ...e, cadeia: f(e.cadeia) }))} />
        </aside>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- linha do tempo

/** A altura da regua: arrastar aqui leva a agulha, como na regua do editor. */
const REGUA = 22

function LinhaDoTempo({
  edicao,
  ondas,
  agulha,
  tocando,
  zoom,
  selecao,
  escolhido,
  onAgulha,
  onSelecao,
  onEscolher,
  onZoom,
}: {
  edicao: EdicaoDeAudio
  ondas: Record<string, OndaDaGravacao> | null
  agulha: number
  tocando: boolean
  zoom: number
  selecao: { a: number; b: number } | null
  escolhido: number | null
  onAgulha: (t: number) => void
  onSelecao: (s: { a: number; b: number } | null) => void
  onEscolher: (i: number | null) => void
  onZoom: (z: number) => void
}) {
  const rolagem = useRef<HTMLDivElement | null>(null)
  const tela = useRef<HTMLCanvasElement | null>(null)
  const [largura, setLargura] = useState(0)
  const [rolado, setRolado] = useState(0)
  const duracao = duracaoEditada(edicao.trechos)
  const total = Math.max(1, largura * zoom)
  const pxPorSeg = duracao > 0 ? total / duracao : 0

  useEffect(() => {
    const el = rolagem.current
    if (!el) return
    const medir = (): void => setLargura(el.clientWidth)
    medir()
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  /*
   * O ZOOM PARA ONDE O MOUSE ESTA. Ctrl ou Alt + roda, como na linha do tempo
   * do editor ("quero que o Alt tambem funcione"): o instante debaixo do mouse
   * fica debaixo dele. Pelos botoes, o meio da vista fica no meio.
   */
  const ancora = useRef<{ t: number; x: number } | null>(null)
  const pxAntes = useRef(pxPorSeg)
  useLayoutEffect(() => {
    const el = rolagem.current
    const antes = pxAntes.current
    pxAntes.current = pxPorSeg
    if (!el || pxPorSeg <= 0 || antes === pxPorSeg) return
    const a = ancora.current ?? { t: (el.scrollLeft + el.clientWidth / 2) / Math.max(antes, 1e-6), x: el.clientWidth / 2 }
    ancora.current = null
    el.scrollLeft = Math.max(0, a.t * pxPorSeg - a.x)
  }, [pxPorSeg])

  // A roda: Ctrl/Alt da zoom; sozinha, anda para os lados quando ha zoom.
  // Ouvida direto no elemento: a do React nao deixa cancelar o zoom da pagina.
  const estado = useRef({ zoom, pxPorSeg, onZoom })
  estado.current = { zoom, pxPorSeg, onZoom }
  useEffect(() => {
    const el = rolagem.current
    if (!el) return
    const aoRolar = (e: WheelEvent): void => {
      const { zoom: z, pxPorSeg: px, onZoom: mudarZoom } = estado.current
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      if (e.ctrlKey || e.altKey) {
        e.preventDefault()
        const r = el.getBoundingClientRect()
        const x = e.clientX - r.left
        ancora.current = { t: (el.scrollLeft + x) / Math.max(px, 1e-6), x }
        mudarZoom(Math.min(60, Math.max(1, z * Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.002))))
        return
      }
      if (z > 1 && Math.abs(delta) > Math.abs(e.deltaX)) {
        e.preventDefault()
        el.scrollLeft += delta
      }
    }
    el.addEventListener('wheel', aoRolar, { passive: false })
    return () => el.removeEventListener('wheel', aoRolar)
  }, [])

  /*
   * A onda EDITADA: os picos de cada gravacao inteira, recortados pelos trechos
   * e no volume de cada um. Cortar so refaz este recorte -- nada de motor. A
   * outra lista diz, pico a pico, se ele e de uma correcao (outra cor).
   */
  const { picos, daCorrecao } = useMemo(() => {
    if (!ondas) return { picos: null, daCorrecao: null }
    const n = Math.ceil(duracaoEditada(edicao.trechos) * POR_SEGUNDO)
    const p = new Float32Array(n)
    const c = new Uint8Array(n)
    let o = 0
    for (const t of edicao.trechos) {
      const onda = ondas[fonteDo(t)]
      const g = 10 ** (t.ganhoDb / 20)
      const correcao = fonteDo(t) !== FONTE_PRINCIPAL ? 1 : 0
      const a = Math.round(t.de * POR_SEGUNDO)
      const b = Math.round(t.ate * POR_SEGUNDO)
      for (let i = a; i < b && o < n; i++) {
        c[o] = correcao
        p[o++] = Math.min(1, (onda?.peaks[i] ?? 0) * g)
      }
    }
    return { picos: p, daCorrecao: c }
  }, [ondas, edicao.trechos])

  const inicios = useMemo(() => iniciosEditados(edicao.trechos), [edicao.trechos])
  const nomes = useMemo(() => new Map(edicao.correcoes.map((c) => [c.id, c.nome])), [edicao.correcoes])

  // A agulha fica na vista enquanto TOCA (arrastando, quem manda e ele).
  useEffect(() => {
    const el = rolagem.current
    if (!el || zoom === 1 || !tocando) return
    const x = agulha * pxPorSeg
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 20) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.2)
  }, [agulha, pxPorSeg, zoom, tocando])

  // O desenho: so a parte visivel, de novo a cada mudanca.
  useEffect(() => {
    const c = tela.current
    if (!c || largura === 0) return
    const dpr = window.devicePixelRatio || 1
    const altura = c.clientHeight
    c.width = Math.round(largura * dpr)
    c.height = Math.round(altura * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, largura, altura)
    const tDe = (x: number): number => (rolado + x) / pxPorSeg
    const xDe = (t: number): number => t * pxPorSeg - rolado
    const meio = REGUA + (altura - REGUA) / 2

    // A regua, com fundo proprio: e onde se pega a agulha.
    g.fillStyle = 'rgba(255, 255, 255, 0.035)'
    g.fillRect(0, 0, largura, REGUA)

    // As correcoes, por baixo de tudo: um fundo da cor delas e o nome.
    for (const [k, t] of edicao.trechos.entries()) {
      if (fonteDo(t) === FONTE_PRINCIPAL) continue
      const a = xDe(inicios[k]!)
      const b = xDe(inicios[k]! + t.ate - t.de)
      if (b < 0 || a > largura) continue
      g.fillStyle = 'rgba(120, 170, 255, 0.10)'
      g.fillRect(a, REGUA, b - a, altura - REGUA)
      if (b - a > 70) {
        g.fillStyle = 'rgba(150, 190, 255, 0.85)'
        g.font = '10px Inter, system-ui, sans-serif'
        g.fillText(`Correção · ${nomes.get(fonteDo(t)) ?? ''}`.slice(0, Math.floor((b - a) / 6)), Math.max(a, 0) + 4, REGUA + 12)
      }
    }
    // O trecho escolhido.
    if (escolhido !== null && edicao.trechos[escolhido]) {
      const a = xDe(inicios[escolhido]!)
      const b = xDe(inicios[escolhido]! + edicao.trechos[escolhido]!.ate - edicao.trechos[escolhido]!.de)
      g.fillStyle = 'rgba(255, 62, 128, 0.10)'
      g.fillRect(a, REGUA, b - a, altura - REGUA)
    }
    if (selecao) {
      const a = xDe(Math.min(selecao.a, selecao.b))
      const b = xDe(Math.max(selecao.a, selecao.b))
      g.fillStyle = 'rgba(255, 255, 255, 0.10)'
      g.fillRect(a, REGUA, b - a, altura - REGUA)
    }

    // As marcas da regua: uma por 0,5 a 60 s, conforme cabe.
    const passo = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pxPorSeg >= 60) ?? 60
    g.fillStyle = 'rgba(255,255,255,0.35)'
    g.font = '10px Inter, system-ui, sans-serif'
    for (let t = Math.floor(tDe(0) / passo) * passo; t <= tDe(largura); t += passo) {
      const x = Math.round(xDe(t)) + 0.5
      g.fillRect(x, REGUA - 6, 1, 6)
      g.fillText(relogio(t).replace(/\.\d$/, ''), x + 3, 12)
    }

    // A onda: a da gravacao principal em branco, a das correcoes em azul.
    if (picos && daCorrecao) {
      const alto = (altura - REGUA - 8) / 2
      for (const [cor, qual] of [['rgba(255, 255, 255, 0.55)', 0], ['rgba(140, 185, 255, 0.85)', 1]] as const) {
        g.fillStyle = cor
        for (let x = 0; x < largura; x++) {
          const i0 = Math.floor(tDe(x) * POR_SEGUNDO)
          const i1 = Math.max(i0 + 1, Math.floor(tDe(x + 1) * POR_SEGUNDO))
          let m = 0
          let doQual = false
          for (let i = i0; i < i1 && i < picos.length; i++) {
            if (daCorrecao[i] !== qual) continue
            doQual = true
            if (picos[i]! > m) m = picos[i]!
          }
          if (!doQual || m <= 0) continue
          const h = Math.max(1, m * alto)
          g.fillRect(x, meio - h, 1, h * 2)
        }
      }
    }

    // Os cortes: onde um trecho encosta no outro.
    g.fillStyle = 'rgba(255, 62, 128, 0.9)'
    for (const t of inicios.slice(1)) g.fillRect(Math.round(xDe(t)) - 0.5, REGUA, 2, altura - REGUA)

    // A agulha, com a cabeca na regua.
    const xa = Math.round(xDe(agulha))
    g.fillStyle = '#fff'
    g.fillRect(xa, 0, 1.5, altura)
    g.beginPath()
    g.moveTo(xa - 5, 0)
    g.lineTo(xa + 6.5, 0)
    g.lineTo(xa + 0.75, 8)
    g.closePath()
    g.fill()
  }, [picos, daCorrecao, largura, rolado, pxPorSeg, agulha, selecao, escolhido, inicios, edicao.trechos, nomes])

  const tempoNo = (clientX: number): number => {
    const r = rolagem.current!.getBoundingClientRect()
    return Math.max(0, Math.min(duracao, (clientX - r.left + rolagem.current!.scrollLeft) / Math.max(pxPorSeg, 1e-6)))
  }

  return (
    <div className="relative h-[240px] shrink-0 overflow-hidden rounded-md border border-line bg-surface">
      {!ondas && (
        <div className="absolute inset-0 z-10 grid place-items-center text-[12px] text-ink-3">Lendo a gravação...</div>
      )}
      <canvas ref={tela} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div
        ref={rolagem}
        className="absolute inset-0 cursor-text overflow-x-auto overflow-y-hidden"
        onScroll={(e) => setRolado(e.currentTarget.scrollLeft)}
        // O botao do meio arrasta a vista; sem isto o Windows liga o "rolar automatico".
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault()
        }}
        onPointerDown={(e) => {
          const el = rolagem.current!
          /*
           * BOTAO DO MEIO: arrastar navega, como na linha do tempo do editor --
           * "quando eu pressionar o scroll do mouse quero poder arrastar e
           * navegar nele quando tiver com zoom".
           */
          if (e.button === 1) {
            e.preventDefault()
            const x0 = e.clientX
            const s0 = el.scrollLeft
            el.style.cursor = 'grabbing'
            const mover = (ev: PointerEvent): void => {
              el.scrollLeft = s0 - (ev.clientX - x0)
            }
            const soltar = (): void => {
              el.style.cursor = ''
              window.removeEventListener('pointermove', mover)
              window.removeEventListener('pointerup', soltar)
            }
            window.addEventListener('pointermove', mover)
            window.addEventListener('pointerup', soltar)
            return
          }
          if (e.button !== 0) return
          // NA REGUA: pega a agulha e arrasta -- "uma agulha de timeline pra navegar".
          if (e.clientY - el.getBoundingClientRect().top < REGUA) {
            onAgulha(tempoNo(e.clientX))
            const mover = (ev: PointerEvent): void => onAgulha(tempoNo(ev.clientX))
            const soltar = (): void => {
              window.removeEventListener('pointermove', mover)
              window.removeEventListener('pointerup', soltar)
            }
            window.addEventListener('pointermove', mover)
            window.addEventListener('pointerup', soltar)
            return
          }
          const t0 = tempoNo(e.clientX)
          const x0 = e.clientX
          let arrastou = false
          const mover = (ev: PointerEvent): void => {
            if (!arrastou && Math.abs(ev.clientX - x0) < 4) return
            arrastou = true
            onSelecao({ a: t0, b: tempoNo(ev.clientX) })
          }
          const soltar = (ev: PointerEvent): void => {
            window.removeEventListener('pointermove', mover)
            window.removeEventListener('pointerup', soltar)
            if (arrastou) {
              onEscolher(null)
              return
            }
            // Clique: leva a agulha e escolhe o trecho de baixo.
            const t = tempoNo(ev.clientX)
            onSelecao(null)
            onAgulha(t)
            let i = inicios.findIndex((ini, k) => t >= ini && t < (inicios[k + 1] ?? Infinity))
            if (i < 0) i = inicios.length - 1
            onEscolher(edicao.trechos.length > 1 ? i : null)
          }
          window.addEventListener('pointermove', mover)
          window.addEventListener('pointerup', soltar)
        }}
      >
        <div style={{ width: total, height: 1 }} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------- correcoes

/**
 * AS CORRECOES importadas: cada uma pode entrar de novo (na agulha ou no lugar
 * da selecao) e sair -- tirar a correcao tira os pedacos dela da linha.
 */
function Correcoes({
  edicao,
  agulha,
  selecao,
  aoUsar,
}: {
  edicao: EdicaoDeAudio
  agulha: number
  selecao: { a: number; b: number } | null
  aoUsar: () => void
}) {
  const mudar = useProject((s) => s.mudarEdicaoDeAudio)
  if (edicao.correcoes.length === 0) return null
  const temSelecao = selecao !== null && Math.abs(selecao.b - selecao.a) > 0.01
  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-3">
      <h3 className="text-[10px] font-medium uppercase tracking-wide text-ink-3">Correções</h3>
      {edicao.correcoes.map((c) => {
        const pedacos = edicao.trechos.filter((t) => fonteDo(t) === c.id).length
        return (
          <div key={c.id} className="flex items-center gap-2 text-[12px]">
            <FileAudio size={13} strokeWidth={1.5} className="shrink-0 text-[rgb(140,185,255)]" />
            <span className="min-w-0 flex-1 truncate text-ink-2" title={c.caminho}>
              {c.nome}
            </span>
            <span className="tnum shrink-0 text-[11px] text-ink-3">
              {relogio(c.duracao)} · {pedacos === 0 ? 'fora da linha' : `${pedacos} ${pedacos === 1 ? 'pedaço' : 'pedaços'}`}
            </span>
            <Botaozinho
              onClick={() => {
                mudar((e) => ({ ...e, trechos: inserirEm(e.trechos, agulha, [trechoDaCorrecao(c)]) }))
                aoUsar()
              }}
              title="Põe a correção inteira na agulha"
            >
              Na agulha
            </Botaozinho>
            <Botaozinho
              disabled={!temSelecao}
              onClick={() => {
                if (!selecao) return
                mudar((e) => ({ ...e, trechos: substituirIntervalo(e.trechos, selecao.a, selecao.b, [trechoDaCorrecao(c)]) }))
                aoUsar()
              }}
              title="Tira o pedaço selecionado e põe a correção no lugar"
            >
              No lugar da seleção
            </Botaozinho>
            <button
              type="button"
              onClick={() =>
                mudar((e) => ({ ...e, correcoes: e.correcoes.filter((x) => x.id !== c.id), trechos: e.trechos.filter((t) => fonteDo(t) !== c.id) }))
              }
              title="Tirar a correção (e os pedaços dela da linha)"
              className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-danger"
            >
              <Trash2 size={12} strokeWidth={1.5} />
            </button>
          </div>
        )
      })}
    </section>
  )
}

// ------------------------------------------------------------- silencios

function CortarSilencios({ edicao, aoCortar }: { edicao: EdicaoDeAudio; aoCortar: (n: number, segundos: number) => void }) {
  const mudar = useProject((s) => s.mudarEdicaoDeAudio)
  const [op, setOp] = useState<OpcoesDosSilencios>(SILENCIOS_PADRAO)
  const [lendo, setLendo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const cortarAgora = async (): Promise<void> => {
    setLendo(true)
    setErro(null)
    const r = await window.dangai.silenciosDaGravacao(edicao, op)
    setLendo(false)
    if (!r.ok) {
      setErro(r.error)
      return
    }
    const feito = cortarSilencios(edicao.trechos, r.value, op.sobraSec, duracoesDasFontes(edicao))
    if (feito.cortados > 0) mudar((e) => ({ ...e, trechos: feito.trechos }))
    aoCortar(feito.cortados, feito.segundos)
  }

  return (
    <div className="enter flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-line bg-surface px-4 py-3">
      <div className="w-[220px]">
        <Linha label="Pausa maior que" title="Pausas mais curtas ficam como estão: são o ritmo da fala">
          <Deslizante textoLargo
            valor={op.minimoSec}
            min={0.2}
            max={2}
            step={0.05}
            padrao={SILENCIOS_PADRAO.minimoSec}
            texto={`${op.minimoSec.toFixed(2)} s`}
            onChange={(v) => setOp({ ...op, minimoSec: v })}
          />
        </Linha>
      </div>
      <div className="w-[220px]">
        <Linha label="Deixa de cada lado" title="O respiro que sobra antes e depois da fala">
          <Deslizante textoLargo
            valor={op.sobraSec}
            min={0.02}
            max={0.5}
            step={0.01}
            padrao={SILENCIOS_PADRAO.sobraSec}
            texto={`${op.sobraSec.toFixed(2)} s`}
            onChange={(v) => setOp({ ...op, sobraSec: v })}
          />
        </Linha>
      </div>
      <div className="w-[220px]">
        <Linha label="Silêncio é" title="Quanto abaixo da voz conta como silêncio. Maior: só o silêncio fundo">
          <Deslizante textoLargo
            valor={op.abaixoDaFalaDb}
            min={12}
            max={50}
            step={1}
            padrao={SILENCIOS_PADRAO.abaixoDaFalaDb}
            texto={`−${op.abaixoDaFalaDb} dB`}
            onChange={(v) => setOp({ ...op, abaixoDaFalaDb: v })}
          />
        </Linha>
      </div>
      <Botaozinho active onClick={() => void cortarAgora()} disabled={lendo}>
        {lendo ? <Loader2 size={12} className="animate-spin" /> : <Scissors size={12} strokeWidth={1.5} />}
        Encolher as pausas
      </Botaozinho>
      {erro && <span className="text-[11px] text-danger">{erro}</span>}
    </div>
  )
}

// ------------------------------------------------------------- efeitos

function Chave({ ligado, onChange }: { ligado: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => onChange(!ligado)}
      title={ligado ? 'Desligar' : 'Ligar'}
      className={['relative h-4 w-7 rounded-full transition-colors', ligado ? 'bg-accent' : 'bg-line-strong'].join(' ')}
    >
      <span className={['absolute top-0.5 size-3 rounded-full bg-white transition-all', ligado ? 'left-3.5' : 'left-0.5'].join(' ')} />
    </button>
  )
}

function Marcar({ rotulo, ligado, onChange }: { rotulo: string; ligado: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
      <input type="checkbox" checked={ligado} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--color-accent)]" />
      {rotulo}
    </label>
  )
}

const hz = (f: number): string => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1).replace('.', ',')} kHz` : `${Math.round(f)} Hz`)
const db = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} dB`

function Efeitos({ cadeia, mudar }: { cadeia: CadeiaDeAudio; mudar: (f: (c: CadeiaDeAudio) => CadeiaDeAudio) => void }) {
  const salvarPadrao = useProject((s) => s.salvarCadeiaComoPadrao)
  const { isolarVoz, nivelar, eq, compressor, normalizar } = cadeia

  return (
    <>
      <p className="px-0.5 text-[11px] leading-relaxed text-ink-3">Na ordem em que o som passa, de cima para baixo.</p>

      <Grupo titulo="Isolar a voz (IA)" acao={<Chave ligado={isolarVoz.ligado} onChange={(v) => mudar((c) => ({ ...c, isolarVoz: { ...c.isolarVoz, ligado: v } }))} />}>
        <Linha label="Quantidade" title="100 tira tudo o que a IA acha que é ruído; menos deixa um pouco do ambiente e a voz soa mais natural">
          <Deslizante textoLargo
            valor={isolarVoz.quantidade}
            min={0}
            max={100}
            step={1}
            padrao={100}
            texto={String(isolarVoz.quantidade)}
            onChange={(v) => mudar((c) => ({ ...c, isolarVoz: { ...c.isolarVoz, quantidade: v } }))}
          />
        </Linha>
      </Grupo>

      <Grupo titulo="Nivelar a voz" acao={<Chave ligado={nivelar.ligado} onChange={(v) => mudar((c) => ({ ...c, nivelar: { ...c.nivelar, ligado: v } }))} />}>
        <Marcar rotulo="Abaixar o que está alto" ligado={nivelar.abaixarAlto} onChange={(v) => mudar((c) => ({ ...c, nivelar: { ...c.nivelar, abaixarAlto: v } }))} />
        <Marcar rotulo="Levantar o que está baixo" ligado={nivelar.levantarBaixo} onChange={(v) => mudar((c) => ({ ...c, nivelar: { ...c.nivelar, levantarBaixo: v } }))} />
        <Marcar rotulo="Abaixar o fundo" ligado={nivelar.abaixarFundo} onChange={(v) => mudar((c) => ({ ...c, nivelar: { ...c.nivelar, abaixarFundo: v } }))} />
        <Linha label="Saída" title="Ganho depois de nivelar">
          <Deslizante textoLargo
            valor={nivelar.ganhoDeSaidaDb}
            min={-12}
            max={12}
            step={0.5}
            padrao={0}
            texto={db(nivelar.ganhoDeSaidaDb)}
            onChange={(v) => mudar((c) => ({ ...c, nivelar: { ...c.nivelar, ganhoDeSaidaDb: v } }))}
          />
        </Linha>
      </Grupo>

      <Grupo titulo="EQ" acao={<Chave ligado={eq.ligado} onChange={(v) => mudar((c) => ({ ...c, eq: { ...c.eq, ligado: v } }))} />}>
        <Linha label="Corte grave" title="Tira o que fica abaixo disto: ronco, vento, pancada no microfone. 0 = sem corte">
          <Deslizante textoLargo
            valor={eq.corteGraveHz}
            min={0}
            max={300}
            step={5}
            padrao={80}
            texto={eq.corteGraveHz === 0 ? 'sem' : hz(eq.corteGraveHz)}
            onChange={(v) => mudar((c) => ({ ...c, eq: { ...c.eq, corteGraveHz: v } }))}
          />
        </Linha>
        {eq.bandas.map((b, i) => (
          <div key={i} className="flex flex-col gap-1 rounded-sm border border-line/60 p-1.5">
            <Linha label={`Banda ${i + 1}`}>
              <Deslizante textoLargo
                valor={Math.log10(b.freqHz)}
                min={Math.log10(40)}
                max={Math.log10(16000)}
                step={0.005}
                texto={hz(b.freqHz)}
                onChange={(v) =>
                  mudar((c) => ({ ...c, eq: { ...c.eq, bandas: c.eq.bandas.map((x, k) => (k === i ? { ...x, freqHz: Math.round(10 ** v) } : x)) } }))
                }
              />
            </Linha>
            <Linha label="Ganho">
              <Deslizante textoLargo
                valor={b.ganhoDb}
                min={-12}
                max={12}
                step={0.5}
                padrao={0}
                texto={db(b.ganhoDb)}
                onChange={(v) => mudar((c) => ({ ...c, eq: { ...c.eq, bandas: c.eq.bandas.map((x, k) => (k === i ? { ...x, ganhoDb: v } : x)) } }))}
              />
            </Linha>
            <Linha label="Largura" title="Menor: mexe numa faixa larga do som. Maior: só bem em volta da frequência">
              <Deslizante textoLargo
                valor={b.q}
                min={0.3}
                max={6}
                step={0.1}
                padrao={1}
                texto={b.q.toFixed(1).replace('.', ',')}
                onChange={(v) => mudar((c) => ({ ...c, eq: { ...c.eq, bandas: c.eq.bandas.map((x, k) => (k === i ? { ...x, q: v } : x)) } }))}
              />
            </Linha>
          </div>
        ))}
      </Grupo>

      <Grupo titulo="Compressor" acao={<Chave ligado={compressor.ligado} onChange={(v) => mudar((c) => ({ ...c, compressor: { ...c.compressor, ligado: v } }))} />}>
        <Linha label="Limiar">
          <Deslizante textoLargo valor={compressor.limiarDb} min={-50} max={0} step={0.5} padrao={-20} texto={db(compressor.limiarDb)}
            onChange={(v) => mudar((c) => ({ ...c, compressor: { ...c.compressor, limiarDb: v } }))} />
        </Linha>
        <Linha label="Razão">
          <Deslizante textoLargo valor={compressor.razao} min={1} max={12} step={0.1} padrao={3} texto={`${compressor.razao.toFixed(1).replace('.', ',')}:1`}
            onChange={(v) => mudar((c) => ({ ...c, compressor: { ...c.compressor, razao: v } }))} />
        </Linha>
        <Linha label="Ataque">
          <Deslizante textoLargo valor={compressor.ataqueMs} min={0.5} max={100} step={0.5} padrao={10} texto={`${compressor.ataqueMs} ms`}
            onChange={(v) => mudar((c) => ({ ...c, compressor: { ...c.compressor, ataqueMs: v } }))} />
        </Linha>
        <Linha label="Soltar">
          <Deslizante textoLargo valor={compressor.soltarMs} min={10} max={1000} step={5} padrao={150} texto={`${compressor.soltarMs} ms`}
            onChange={(v) => mudar((c) => ({ ...c, compressor: { ...c.compressor, soltarMs: v } }))} />
        </Linha>
        <Linha label="Ganho">
          <Deslizante textoLargo valor={compressor.ganhoDb} min={0} max={18} step={0.5} padrao={3} texto={db(compressor.ganhoDb)}
            onChange={(v) => mudar((c) => ({ ...c, compressor: { ...c.compressor, ganhoDb: v } }))} />
        </Linha>
      </Grupo>

      <Plugins cadeia={cadeia} mudar={mudar} />

      <Velocidade valor={cadeia.velocidade} onChange={(v) => mudar((c) => ({ ...c, velocidade: v }))} />

      <Grupo titulo="Normalizar" acao={<Chave ligado={normalizar.ligado} onChange={(v) => mudar((c) => ({ ...c, normalizar: { ...c.normalizar, ligado: v } }))} />}>
        <Linha label="Volume" title="O volume medido do jeito do YouTube (LUFS). −14 é o do render do Dangai">
          <Deslizante textoLargo valor={normalizar.alvoLufs} min={-24} max={-9} step={0.5} padrao={-14} texto={`${normalizar.alvoLufs.toFixed(1).replace('.', ',')} LUFS`}
            onChange={(v) => mudar((c) => ({ ...c, normalizar: { ...c.normalizar, alvoLufs: v } }))} />
        </Linha>
      </Grupo>

      <button
        type="button"
        onClick={() => void salvarPadrao()}
        title="Toda gravação nova começa com estes efeitos"
        className="mt-1 rounded-sm border border-line bg-elevated px-3 py-2 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
      >
        Salvar como meu padrão
      </button>
    </>
  )
}

/** O que muda o SOM (a onda, a escuta): tudo menos a velocidade, que o preview faz tocando. */
function cadeiaSemVelocidade({ velocidade: _fora, ...resto }: CadeiaDeAudio): Omit<CadeiaDeAudio, 'velocidade'> {
  return resto
}

/**
 * A VELOCIDADE sem mudar o tom: "eu costumo usar 110, 115 e 120". Os atalhos e
 * um numero livre, como o Change Clip Speed do DaVinci com o Pitch Correction.
 */
function Velocidade({ valor, onChange }: { valor: number; onChange: (v: number) => void }) {
  const [texto, setTexto] = useState(String(valor))
  useEffect(() => setTexto(String(valor)), [valor])
  const aplicar = (): void => {
    const n = Number(texto.trim().replace(',', '.').replace('%', ''))
    if (!Number.isFinite(n) || n <= 0) {
      setTexto(String(valor))
      return
    }
    const v = Math.min(VELOCIDADE_MAX, Math.max(VELOCIDADE_MIN, Math.round(n * 100) / 100))
    setTexto(String(v))
    if (v !== valor) onChange(v)
  }
  return (
    <Grupo titulo="Velocidade">
      <Segmentos
        opcoes={VELOCIDADES_RAPIDAS.map((v) => ({
          valor: v,
          rotulo: `${v}%`,
          title: v === 100 ? 'Normal' : `${v}%: mais rápido, com o mesmo tom`,
        }))}
        ativo={(v) => Math.abs(v - valor) < 0.005}
        onChange={(v) => onChange(v)}
      />
      <Linha label="Outra" title={`De ${VELOCIDADE_MIN}% a ${VELOCIDADE_MAX}%`}>
        <input
          value={texto}
          inputMode="decimal"
          onChange={(e) => setTexto(e.target.value)}
          onBlur={aplicar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setTexto(String(valor))
              e.currentTarget.blur()
            }
          }}
          className="tnum h-6 w-16 rounded-sm border border-line bg-elevated px-1.5 text-right text-[11px] text-ink outline-none focus:border-accent"
        />
        <span className="text-[11px] text-ink-3">%</span>
      </Linha>
      <p className="text-[11px] leading-relaxed text-ink-3">
        Acelera sem mudar o tom da voz, como o Pitch Correction do DaVinci. O preview já toca nessa velocidade, e a
        narração sai assim no “Pronto”.
      </p>
    </Grupo>
  )
}

function Plugins({ cadeia, mudar }: { cadeia: CadeiaDeAudio; mudar: (f: (c: CadeiaDeAudio) => CadeiaDeAudio) => void }) {
  const [lista, setLista] = useState<PluginInstalado[] | null>(null)
  const [abrindo, setAbrindo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const procurar = async (): Promise<void> => {
    setErro(null)
    setAbrindo('lista')
    const r = await window.dangai.listarPlugins()
    setAbrindo(null)
    if (r.ok) setLista(r.value)
    else setErro(r.error)
  }

  const adicionar = async (p: PluginInstalado): Promise<void> => {
    setLista(null)
    setAbrindo(p.caminho)
    const r = await window.dangai.descreverPlugin(p.caminho, null)
    setAbrindo(null)
    if (!r.ok) {
      setErro(r.error)
      return
    }
    mudar((c) => ({
      ...c,
      plugins: [
        ...c.plugins,
        { id: `plugin-${Date.now()}`, ligado: true, caminho: p.caminho, nome: r.value.nome, estado: r.value.estado, parametros: r.value.parametros },
      ],
    }))
  }

  /*
   * A JANELA DO PROPRIO PLUGIN, a mesma do DaVinci. Ela segura ate ele fechar;
   * o estado novo volta e o som e refeito.
   */
  const abrir = async (id: string): Promise<void> => {
    const p = cadeia.plugins.find((x) => x.id === id)
    if (!p) return
    setErro(null)
    setAbrindo(id)
    const r = await window.dangai.janelaDoPlugin(p.caminho, p.estado)
    setAbrindo(null)
    if (!r.ok) {
      setErro(r.error)
      return
    }
    mudar((c) => ({ ...c, plugins: c.plugins.map((x) => (x.id === id ? { ...x, estado: r.value.estado, parametros: r.value.parametros } : x)) }))
  }

  return (
    <Grupo titulo="Plugins (VST3)">
      {cadeia.plugins.length === 0 && !lista && (
        <p className="text-[11px] leading-relaxed text-ink-3">O Fresh Air e os outros plugins instalados no seu PC entram aqui.</p>
      )}
      {cadeia.plugins.map((p) => (
        <div key={p.id} className="flex items-center gap-2 rounded-sm border border-line/60 px-2 py-1.5">
          <Chave
            ligado={p.ligado}
            onChange={(v) => mudar((c) => ({ ...c, plugins: c.plugins.map((x) => (x.id === p.id ? { ...x, ligado: v } : x)) }))}
          />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{p.nome}</span>
          <Botaozinho onClick={() => void abrir(p.id)} disabled={abrindo !== null} title="Abre a janela do plugin. Feche-a para o Dangai usar os ajustes">
            {abrindo === p.id ? <Loader2 size={11} className="animate-spin" /> : null}
            {abrindo === p.id ? 'Aberto' : 'Abrir'}
          </Botaozinho>
          <button
            type="button"
            onClick={() => mudar((c) => ({ ...c, plugins: c.plugins.filter((x) => x.id !== p.id) }))}
            title="Tirar da cadeia"
            className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-danger"
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        </div>
      ))}
      {lista && (
        <div className="flex flex-col gap-1">
          {lista.length === 0 && <p className="text-[11px] text-ink-3">Nenhum plugin VST3 de efeito instalado.</p>}
          {lista.map((p) => (
            <button
              key={p.caminho}
              type="button"
              onClick={() => void adicionar(p)}
              className="flex items-baseline justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-ink-2 hover:bg-elevated hover:text-ink"
            >
              <span className="truncate">{p.nome}</span>
              <span className="shrink-0 text-[10px] text-ink-3">{p.fabricante}</span>
            </button>
          ))}
        </div>
      )}
      <Botaozinho onClick={() => (lista ? setLista(null) : void procurar())} disabled={abrindo !== null && abrindo !== 'lista'}>
        {abrindo === 'lista' ? <Loader2 size={11} className="animate-spin" /> : <Plug size={11} strokeWidth={1.5} />}
        {lista ? 'Fechar a lista' : abrindo === 'lista' ? 'Procurando os plugins...' : 'Adicionar plugin'}
      </Botaozinho>
      {erro && <p className="text-[11px] leading-relaxed text-danger">{erro}</p>}
    </Grupo>
  )
}
