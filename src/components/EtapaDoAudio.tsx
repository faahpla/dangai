import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArrowRight,
  AudioWaveform,
  FileAudio,
  Loader2,
  Magnet,
  Minus,
  Pause,
  Play,
  Plus,
  Plug,
  Scissors,
  SkipForward,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { classifyFile, type AudioEditado, type OndaDaGravacao, type PluginInstalado } from '@shared/channels'
import {
  aparar,
  apagarIntervalo,
  apagarTrechos,
  cortarEm,
  cortarSilencios,
  duracaoEditada,
  duracoesDasFontes,
  faixasUsadas,
  fatorDaVelocidade,
  fimDo,
  FONTE_PRINCIPAL,
  fonteDo,
  ganhoDosTrechos,
  inserirEm,
  MAX_FAIXAS,
  moverPerto,
  SILENCIOS_PADRAO,
  sobAgulha,
  substituirIntervalo,
  trechoDaCorrecao,
  VELOCIDADE_MAX,
  VELOCIDADE_MIN,
  VELOCIDADES_RAPIDAS,
  type CadeiaDeAudio,
  type Correcao,
  type EdicaoDeAudio,
  type OpcoesDosSilencios,
  type TrechoDaGravacao,
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
 * editar o audio." Em cima, as FAIXAS (2.0), como no DaVinci: cada pedaco da
 * gravacao e um trecho que se arrasta (de lugar e de faixa), se apara pela
 * borda e se corta (C); Delete apaga fechando o vao, Backspace deixa o vao. Do
 * lado, a cadeia dele na ordem dele: isolar a voz (IA), nivelar, EQ,
 * compressor, os plugins (o Fresh Air) e normalizar. "Pronto" grava a narracao
 * ao lado da gravacao e segue.
 *
 * A VELOCIDADE (115%...) vale para a mistura inteira e a linha do tempo mostra o
 * tempo FINAL: "quero que ajuste simultaneamente tudo, e tambem atualize o tempo
 * geral da composicao". Por dentro os trechos ficam em segundos a 100% (ver
 * shared/edicao-de-audio.ts) e a tela so encolhe a vista.
 *
 * O que ele ouve e o que vai para o video: o mesmo arquivo que o "Pronto"
 * grava (electron/services/edicao-de-audio.ts), tocado na velocidade escolhida.
 */
export function EtapaDoAudio() {
  const aberta = useProject((s) => s.etapaDoAudio)
  const edicao = useProject((s) => s.edicaoDeAudio)
  if (!aberta || !edicao) return null
  return <Tela edicao={edicao} />
}

/** Picos por segundo da onda (ver ondaDe no main). */
const POR_SEGUNDO = 100

function relogio(s: number): string {
  const t = Math.max(0, s)
  const m = Math.floor(t / 60)
  const r = t - m * 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}

/*
 * A AGULHA fora do React. Ela anda 60 vezes por segundo tocando, e cada passo
 * era um setState na tela inteira -- a linha do tempo, o painel de efeitos, tudo
 * redesenhando junto ("eu sinto ela meio bugada"). Agora so quem mostra a
 * agulha (o relogio e a linha branca) acompanha; o resto le quando precisa.
 */
interface Agulha {
  get: () => number
  set: (t: number) => void
  ouvir: (o: () => void) => () => void
}

function criarAgulha(): Agulha {
  let t = 0
  const ouvintes = new Set<() => void>()
  return {
    get: () => t,
    set: (v) => {
      if (v === t) return
      t = v
      for (const o of ouvintes) o()
    },
    ouvir: (o) => {
      ouvintes.add(o)
      return () => ouvintes.delete(o)
    },
  }
}

const NENHUM: ReadonlySet<string> = new Set()

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
  const [tocando, setTocando] = useState(false)
  /** Um pedaco do tempo, em todas as faixas (arrastar no vazio). */
  const [selecao, setSelecao] = useState<{ a: number; b: number } | null>(null)
  /** Os trechos escolhidos (clique; Ctrl+clique soma). */
  const [escolhidos, setEscolhidos] = useState<ReadonlySet<string>>(NENHUM)
  const [zoom, setZoom] = useState(1)
  /** O ima: arrastar gruda nas pontas dos outros trechos e na agulha (N). */
  const [ima, setIma] = useState(true)
  const [silencios, setSilencios] = useState(false)
  const agulha = useMemo(criarAgulha, [])
  /** A janela de plugin aberta (o Fresh Air): o "Pronto" fecha e espera o estado dela voltar. */
  const janelaDoPlugin = useRef<Promise<void> | null>(null)

  const trechos = edicao.trechos
  const duracao = duracaoEditada(trechos)
  /** A velocidade da narracao final (1,15 = 115%). */
  const fator = fatorDaVelocidade(edicao.cadeia)
  const player = useRef<HTMLAudioElement | null>(null)
  if (!player.current) player.current = new Audio()

  // O que o motor esta fazendo (lendo, limpando, passando pelo Fresh Air).
  useEffect(() => window.dangai.onProgressoDaEdicao((m) => setAndamento(m)), [])

  // Trecho escolhido que deixou de existir (cortado, apagado, Ctrl+Z) sai da escolha.
  useEffect(() => {
    setEscolhidos((atual) => {
      if (atual.size === 0) return atual
      const vivos = new Set(trechos.map((x) => x.id))
      const ficam = [...atual].filter((id) => vivos.has(id))
      return ficam.length === atual.size ? atual : new Set(ficam)
    })
  }, [trechos])

  /*
   * A ONDA so muda com os efeitos (ou com a escuta), nao com os cortes: ela e
   * da gravacao inteira, e a tela recorta pelos trechos.
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

  // O SOM muda com tudo: os trechos (lugar, faixa nao) e os efeitos. Pedido depois que ele para de mexer.
  const receitaDoSom = JSON.stringify([
    edicao.bruto,
    edicao.correcoes.map((c) => c.caminho),
    trechos.map((x) => [x.de, x.ate, x.ganhoDb, fonteDo(x), x.em]),
    comEfeitos ? cadeiaSemVelocidade(edicao.cadeia) : null,
  ])
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
    }, 300)
    return () => {
      vivo = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receitaDoSom])

  /*
   * A TROCA DO SOM. Cada corte ou arrasto refaz a mistura, e o player troca de
   * arquivo -- e ate o arquivo novo carregar, o player diz que esta no ZERO.
   * "Dou play onde ta a agulha e do nada vai pro comeco do audio": quem lia o
   * player nessa hora (a agulha andando, o "pausou" da troca) levava a agulha
   * junto para o zero, e o arquivo novo comecava dali. Medido: tocando do 20 s,
   * cortar no 21 jogava a agulha para o 0.
   *
   * Durante a troca, a agulha e a verdade e o player nao fala: `troca` guarda se
   * era para estar tocando (o play apertado no meio da troca tambem conta), e o
   * arquivo novo comeca de onde a agulha esta.
   */
  const troca = useRef<{ tocar: boolean } | null>(null)
  useEffect(() => {
    const p = player.current!
    if (!som) return
    troca.current = { tocar: troca.current?.tocar ?? !p.paused }
    p.src = som.url
    const aoCarregar = (): void => {
      const tocar = troca.current?.tocar ?? false
      p.currentTime = Math.min(agulha.get(), Math.max(0, p.duration - 0.05))
      p.playbackRate = fatorDaVelocidade(useProject.getState().edicaoDeAudio?.cadeia ?? { velocidade: 100 })
      troca.current = null
      if (tocar) void p.play()
      else setTocando(false)
    }
    // Arquivo que nao abriu: a troca acaba (a agulha volta a ouvir o player), parado.
    const aoFalhar = (): void => {
      troca.current = null
      setTocando(false)
    }
    p.addEventListener('loadedmetadata', aoCarregar, { once: true })
    p.addEventListener('error', aoFalhar, { once: true })
    return () => {
      p.removeEventListener('loadedmetadata', aoCarregar)
      p.removeEventListener('error', aoFalhar)
    }
  }, [som?.url, agulha])

  /*
   * A VELOCIDADE NO PREVIEW: o proprio navegador acelera sem mudar o tom
   * (preservesPitch), sem renderizar nada -- trocar de 110 para 120 e na hora. A
   * narracao final sai acelerada no "Pronto" pelo atempo do ffmpeg, da mesma
   * familia do jeito do navegador (emenda pedacos da propria onda): o que toca
   * aqui e o que sai.
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
    // Trocando de arquivo, o player esta no zero de mentira: a agulha nao ouve (ver `troca`).
    const andar = (): void => {
      if (!troca.current) agulha.set(p.currentTime)
      quadro = requestAnimationFrame(andar)
    }
    const aoTocar = (): void => {
      setTocando(true)
      cancelAnimationFrame(quadro)
      quadro = requestAnimationFrame(andar)
    }
    const aoParar = (): void => {
      cancelAnimationFrame(quadro)
      if (troca.current) return
      setTocando(false)
      agulha.set(p.currentTime)
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
  }, [agulha])

  // Saiu da etapa com a janela do plugin aberta: ela fecha (e o estado dela volta para a edicao).
  useEffect(
    () => () => {
      if (janelaDoPlugin.current) void window.dangai.fecharJanelasDosPlugins()
    },
    [],
  )

  const irPara = useCallback(
    (t: number): void => {
      const x = Math.max(0, t)
      agulha.set(x)
      const p = player.current!
      // Trocando de arquivo: o novo ja comeca da agulha (ver `troca`).
      if (p.src && !troca.current) p.currentTime = Math.min(x, Number.isFinite(p.duration) ? p.duration : x)
    },
    [agulha],
  )

  const alternarPlay = useCallback((): void => {
    const p = player.current!
    if (!p.src) return
    // No meio da troca: so anota; o arquivo novo toca (ou nao) da agulha quando carregar.
    if (troca.current) {
      troca.current.tocar = !troca.current.tocar
      setTocando(troca.current.tocar)
      return
    }
    if (p.paused) {
      // Tocou ate o fim: recomeca do comeco, como qualquer player. So nesse caso --
      // agulha perto do fim depois de um corte nao e "fim".
      if (p.ended) irPara(0)
      void p.play()
    } else p.pause()
  }, [irPara])

  const mudarTrechos = useCallback(
    (f: (t: TrechoDaGravacao[]) => TrechoDaGravacao[]): void => mudar((e) => ({ ...e, trechos: f(e.trechos) })),
    [mudar],
  )

  /** C: corta os escolhidos debaixo da agulha; sem nenhum escolhido ali, tudo o que esta debaixo dela. */
  const cortar = useCallback((): void => {
    const t = agulha.get()
    const debaixo = sobAgulha(trechos, t)
    if (debaixo.length === 0) return
    const dosEscolhidos = debaixo.filter((x) => escolhidos.has(x.id))
    mudarTrechos((tr) => cortarEm(tr, t, new Set((dosEscolhidos.length > 0 ? dosEscolhidos : debaixo).map((x) => x.id))))
  }, [agulha, trechos, escolhidos, mudarTrechos])

  /** Delete (fechar) ou Backspace (deixar o vao): a selecao de tempo, ou os trechos escolhidos. */
  const apagar = useCallback(
    (fechar: boolean): void => {
      if (selecao && Math.abs(selecao.b - selecao.a) > 0.01) {
        const ini = Math.min(selecao.a, selecao.b)
        mudarTrechos((tr) => apagarIntervalo(tr, selecao.a, selecao.b, fechar))
        setSelecao(null)
        irPara(ini)
        return
      }
      if (escolhidos.size === 0) return
      const inicio = Math.min(...trechos.filter((x) => escolhidos.has(x.id)).map((x) => x.em))
      mudarTrechos((tr) => apagarTrechos(tr, escolhidos, fechar))
      setEscolhidos(NENHUM)
      if (fechar && Number.isFinite(inicio)) irPara(inicio)
    },
    [selecao, escolhidos, trechos, mudarTrechos, irPara],
  )

  // O teclado da etapa. Os atalhos do editor ficam quietos por baixo (App.tsx).
  const teclas = useRef({ alternarPlay, cortar, apagar, irPara, duracao, trechos })
  teclas.current = { alternarPlay, cortar, apagar, irPara, duracao, trechos }
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent): void => {
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT')) return
      const k = teclas.current
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setEscolhidos(new Set(k.trechos.map((x) => x.id)))
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const passo = e.shiftKey ? 1 : 0.1
      if (e.code === 'Space') {
        // Tambem com um botao em foco: o espaco e do play, nao do botao (que dispararia junto).
        e.preventDefault()
        k.alternarPlay()
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault()
        k.cortar()
      } else if (e.key === 'Delete' || e.key.toLowerCase() === 'x') {
        e.preventDefault()
        k.apagar(true)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        k.apagar(false)
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setIma((v) => !v)
      } else if (e.key === 'Escape') {
        setSelecao(null)
        setEscolhidos(NENHUM)
      } else if (e.key === 'Home') {
        e.preventDefault()
        k.irPara(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        k.irPara(k.duracao)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        k.irPara(agulha.get() - passo)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        k.irPara(Math.min(k.duracao, agulha.get() + passo))
      }
    }
    // O botao em foco solta o clique no keyup do espaco: cancelado aqui, o play nao dispara duas vezes.
    const aoSoltar = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && (e.target as HTMLElement | null)?.tagName === 'BUTTON') e.preventDefault()
    }
    window.addEventListener('keydown', aoTeclar)
    window.addEventListener('keyup', aoSoltar)
    return () => {
      window.removeEventListener('keydown', aoTeclar)
      window.removeEventListener('keyup', aoSoltar)
    }
  }, [agulha])

  /** A faixa de quem chega (uma correcao): a do trecho escolhido, ou a A1. */
  const faixaAlvo = trechos.find((x) => escolhidos.has(x.id))?.faixa ?? 0

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
      const t = agulha.get()
      mudar((e) => ({
        ...e,
        correcoes: [...e.correcoes, ...novas],
        trechos: sel ? substituirIntervalo(e.trechos, sel.a, sel.b, faixaAlvo, blocos) : inserirEm(e.trechos, t, faixaAlvo, blocos),
      }))
      if (sel) irPara(Math.min(sel.a, sel.b))
      setSelecao(null)
      setEscolhidos(NENHUM)
      avisar(
        sel
          ? 'A correção entrou no lugar da seleção (em azul). Corte o que sobrar dela com C e Delete.'
          : 'A correção entrou na agulha (em azul). Apague o pedaço ruim e corte o que sobrar dela.',
        8000,
      )
    },
    [selecao, agulha, faixaAlvo, mudar, irPara],
  )

  const escolherCorrecao = async (): Promise<void> => {
    const r = await window.dangai.pickFiles()
    if (r.ok && r.value.length > 0) await importarCorrecoes(r.value)
  }

  /** Antes de sair (Pronto, Pular): a janela do plugin fecha e o estado dela volta para a edicao. */
  const fecharPlugin = async (): Promise<void> => {
    const pendente = janelaDoPlugin.current
    if (!pendente) return
    await window.dangai.fecharJanelasDosPlugins()
    await pendente
  }

  const primeiroEscolhido = trechos.find((x) => escolhidos.has(x.id))
  const temSelecao = selecao !== null && Math.abs(selecao.b - selecao.a) > 0.01

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
        <span className="tnum shrink-0 text-[12px] text-ink-3" title="A gravação → a narração final, já na velocidade escolhida">
          {relogio(edicao.duracaoBruta)} → <span className="text-ink-2">{relogio(duracao / fator)}</span>
          {fator !== 1 && <span className="text-accent">{` · ${Math.round(fator * 100)}%`}</span>}
          {comEfeitos && som?.lufs != null && ` · ${som.lufs.toFixed(1)} LUFS`}
        </span>
        <span className="flex-1" />
        <BarraDeEtapas />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void fecharPlugin().then(() => pular())}
          disabled={busy !== null}
          title="Usar a gravação como está, sem cortes nem efeitos"
          className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] text-ink-3 transition-colors hover:text-ink disabled:opacity-40"
        >
          <SkipForward size={13} strokeWidth={1.5} />
          Pular
        </button>
        <button
          type="button"
          onClick={() => void fecharPlugin().then(() => concluir())}
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
        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={alternarPlay}
              title="Tocar ou pausar (espaço)"
              className="grid size-8 place-items-center rounded-sm border border-line bg-elevated text-ink hover:border-line-strong"
            >
              {tocando ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <Tempo agulha={agulha} fator={fator} duracao={duracao} />
            <Botaozinho onClick={cortar} title="Corta na agulha: o trecho escolhido, ou tudo o que está debaixo dela (C)">
              <Scissors size={12} strokeWidth={1.5} /> Cortar
            </Botaozinho>
            <Botaozinho
              onClick={() => apagar(true)}
              disabled={!temSelecao && escolhidos.size === 0}
              title="Apaga o trecho escolhido ou a seleção e fecha o vão (Delete). Backspace apaga e deixa o vão"
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
            <Botaozinho active={ima} onClick={() => setIma((v) => !v)} title="Ímã: arrastar gruda nas pontas dos outros trechos e na agulha (N)">
              <Magnet size={12} strokeWidth={1.5} /> Ímã
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
            <button type="button" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} title="Afastar" className="grid size-7 place-items-center rounded-sm text-ink-3 hover:text-ink">
              <Minus size={13} />
            </button>
            <button type="button" onClick={() => setZoom((z) => Math.min(80, z * 1.5))} title="Aproximar" className="grid size-7 place-items-center rounded-sm text-ink-3 hover:text-ink">
              <Plus size={13} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Velocidade valor={edicao.cadeia.velocidade} onChange={(v) => mudar((e) => ({ ...e, cadeia: { ...e.cadeia, velocidade: v } }))} />
            {primeiroEscolhido && (
              <div className="flex w-[300px] items-center gap-2">
                <span className="shrink-0 text-[11px] text-ink-3">{escolhidos.size > 1 ? `Volume dos ${escolhidos.size} trechos` : 'Volume do trecho'}</span>
                <Deslizante
                  textoLargo
                  valor={primeiroEscolhido.ganhoDb}
                  min={-24}
                  max={12}
                  step={0.5}
                  padrao={0}
                  texto={`${primeiroEscolhido.ganhoDb > 0 ? '+' : ''}${primeiroEscolhido.ganhoDb} dB`}
                  onChange={(v) => mudarTrechos((tr) => ganhoDosTrechos(tr, escolhidos, v))}
                />
              </div>
            )}
          </div>

          {silencios && (
            <CortarSilencios
              edicao={edicao}
              aoCortar={(n, s) => {
                setSilencios(false)
                avisar(n === 0 ? 'Nenhuma pausa longa para encolher.' : `${n} ${n === 1 ? 'pausa encolhida' : 'pausas encolhidas'}: ${(s / fator).toFixed(1).replace('.', ',')} s a menos.`, 6000)
              }}
            />
          )}

          <Faixas
            edicao={edicao}
            ondas={ondas}
            fator={fator}
            agulha={agulha}
            tocando={tocando}
            zoom={zoom}
            ima={ima}
            selecao={selecao}
            escolhidos={escolhidos}
            onAgulha={irPara}
            onSelecao={setSelecao}
            onEscolher={setEscolhidos}
            onZoom={setZoom}
            onTrechos={(novos) => mudarTrechos(() => novos)}
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
              'Arraste o trecho para mudar de lugar ou de faixa · puxe a borda para aparar · arraste no vazio para selecionar · C corta · Delete apaga e fecha o vão · Backspace apaga e deixa o vão · Ctrl ou Alt + roda: zoom · Ctrl+Z desfaz'
            )}
          </p>

          <Correcoes edicao={edicao} agulha={agulha} faixa={faixaAlvo} selecao={selecao} aoUsar={() => setSelecao(null)} />
        </main>

        <aside className="flex w-[380px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-line p-4">
          <Efeitos cadeia={edicao.cadeia} janela={janelaDoPlugin} mudar={(f) => mudar((e) => ({ ...e, cadeia: f(e.cadeia) }))} />
        </aside>
      </div>
    </div>
  )
}

/** O relogio da agulha, no tempo FINAL (ja na velocidade). So ele acompanha a agulha tocando. */
function Tempo({ agulha, fator, duracao }: { agulha: Agulha; fator: number; duracao: number }) {
  const t = useSyncExternalStore(agulha.ouvir, agulha.get)
  return (
    <span className="tnum w-[104px] text-[12px] text-ink-2" title={fator !== 1 ? `Tempo final, a ${Math.round(fator * 100)}%` : undefined}>
      {relogio(t / fator)} / {relogio(duracao / fator)}
    </span>
  )
}

// ------------------------------------------------------------- as faixas

/** A altura da regua: arrastar aqui leva a agulha, como na regua do editor. */
const REGUA = 22
/** A altura de cada faixa. */
const ALTURA = 72
/** Quantos pixels da ponta de um trecho pegam a borda (aparar) e nao o meio (mover). */
const BORDA = 6
/** Distancia em pixels em que o ima gruda. */
const IMA_PX = 8

type Arrasto =
  | { tipo: 'mover'; ids: ReadonlySet<string> }
  | { tipo: 'aparar'; id: string; lado: 'inicio' | 'fim' }

function Faixas({
  edicao,
  ondas,
  fator,
  agulha,
  tocando,
  zoom,
  ima,
  selecao,
  escolhidos,
  onAgulha,
  onSelecao,
  onEscolher,
  onZoom,
  onTrechos,
}: {
  edicao: EdicaoDeAudio
  ondas: Record<string, OndaDaGravacao> | null
  fator: number
  agulha: Agulha
  tocando: boolean
  zoom: number
  ima: boolean
  selecao: { a: number; b: number } | null
  escolhidos: ReadonlySet<string>
  onAgulha: (t: number) => void
  onSelecao: (s: { a: number; b: number } | null) => void
  onEscolher: (s: ReadonlySet<string>) => void
  onZoom: (z: number) => void
  onTrechos: (t: TrechoDaGravacao[]) => void
}) {
  const rolagem = useRef<HTMLDivElement | null>(null)
  const tela = useRef<HTMLCanvasElement | null>(null)
  const [largura, setLargura] = useState(0)
  const [rolado, setRolado] = useState(0)
  /** O desenho durante um arrasto (mover/aparar): so vira edicao ao soltar -- um passo de Ctrl+Z. */
  const [previa, setPrevia] = useState<TrechoDaGravacao[] | null>(null)
  /** Onde o ima grudou (a linha amarela). */
  const [guia, setGuia] = useState<number | null>(null)

  const trechos = edicao.trechos
  const desenho = previa ?? trechos
  const duracao = duracaoEditada(trechos)
  // Um rabo vazio depois do fim: da para arrastar um trecho para depois do ultimo.
  const extensao = Math.max(4, duracao * 1.06 + 1)
  const total = Math.max(1, largura * zoom)
  /** Pixels por segundo DO MODELO (a 100%). A regua mostra o tempo final (dividido pela velocidade). */
  const pxs = total / extensao
  const nFaixas = Math.min(MAX_FAIXAS, Math.max(2, faixasUsadas(trechos) + 1))
  const alturaTotal = REGUA + nFaixas * ALTURA
  const duracoes = useMemo(() => duracoesDasFontes(edicao), [edicao])
  /*
   * A ESCALA DA ONDA: a gravacao com os efeitos ainda nao esta no volume final
   * (a normalizacao e na mistura) -- medido na narracao dele, o pico de 99% das
   * janelas fica em 0,45. Desenhada em escala cheia, a fala virava um fio no
   * meio da faixa com zoom. Aqui o pico de 99% vai a quase a altura toda.
   */
  const escalaDaOnda = useMemo(() => {
    if (!ondas) return 1
    let p99 = 0
    for (const o of Object.values(ondas)) {
      const fila = [...o.peaks].sort((a, b) => a - b)
      p99 = Math.max(p99, fila[Math.floor(fila.length * 0.99)] ?? 0)
    }
    return p99 > 0.01 ? 0.92 / p99 : 1
  }, [ondas])
  const nomes = useMemo(
    () => new Map<string, string>([[FONTE_PRINCIPAL, (edicao.bruto.split(/[\\/]/).pop() ?? 'Gravação').replace(/\.[^.]+$/, '')], ...edicao.correcoes.map((c): [string, string] => [c.id, c.nome])]),
    [edicao.bruto, edicao.correcoes],
  )

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
   * do editor: o instante debaixo do mouse fica debaixo dele. Pelos botoes, o
   * meio da vista fica no meio.
   */
  const ancora = useRef<{ t: number; x: number } | null>(null)
  const pxAntes = useRef(pxs)
  useLayoutEffect(() => {
    const el = rolagem.current
    const antes = pxAntes.current
    pxAntes.current = pxs
    if (!el || pxs <= 0 || antes === pxs) return
    const a = ancora.current ?? { t: (el.scrollLeft + el.clientWidth / 2) / Math.max(antes, 1e-6), x: el.clientWidth / 2 }
    ancora.current = null
    el.scrollLeft = Math.max(0, a.t * pxs - a.x)
  }, [pxs])

  // A roda: Ctrl/Alt da zoom; sozinha, anda para os lados quando ha zoom.
  // Ouvida direto no elemento: a do React nao deixa cancelar o zoom da pagina.
  const estado = useRef({ zoom, pxs, onZoom })
  estado.current = { zoom, pxs, onZoom }
  useEffect(() => {
    const el = rolagem.current
    if (!el) return
    const aoRolar = (e: WheelEvent): void => {
      const { zoom: z, pxs: px, onZoom: mudarZoom } = estado.current
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      if (e.ctrlKey || e.altKey) {
        e.preventDefault()
        const r = el.getBoundingClientRect()
        const x = e.clientX - r.left
        ancora.current = { t: (el.scrollLeft + x) / Math.max(px, 1e-6), x }
        mudarZoom(Math.min(80, Math.max(1, z * Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.002))))
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

  // A agulha fica na vista enquanto TOCA (arrastando, quem manda e ele).
  useEffect(() => {
    if (!tocando) return
    return agulha.ouvir(() => {
      const el = rolagem.current
      if (!el || estado.current.zoom === 1) return
      const x = agulha.get() * estado.current.pxs
      if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 20) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.2)
    })
  }, [agulha, tocando])

  // O desenho: so a parte visivel, de novo a cada mudanca (a agulha e outro elemento).
  useEffect(() => {
    const c = tela.current
    if (!c || largura === 0) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(largura * dpr)
    c.height = Math.round(alturaTotal * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, largura, alturaTotal)
    const xDe = (t: number): number => t * pxs - rolado
    const tDe = (x: number): number => (rolado + x) / pxs

    // A regua e as faixas.
    g.fillStyle = 'rgba(255, 255, 255, 0.035)'
    g.fillRect(0, 0, largura, REGUA)
    for (let f = 0; f < nFaixas; f++) {
      const y = REGUA + f * ALTURA
      g.fillStyle = f % 2 === 0 ? 'rgba(255, 255, 255, 0.022)' : 'rgba(255, 255, 255, 0.01)'
      g.fillRect(0, y, largura, ALTURA)
      g.fillStyle = 'rgba(255, 255, 255, 0.06)'
      g.fillRect(0, y + ALTURA - 1, largura, 1)
    }
    // Depois do fim: mais escuro (o que esta ali nao toca).
    const xFim = xDe(duracaoEditada(desenho))
    if (xFim < largura) {
      g.fillStyle = 'rgba(0, 0, 0, 0.22)'
      g.fillRect(Math.max(0, xFim), REGUA, largura - Math.max(0, xFim), alturaTotal - REGUA)
    }
    if (selecao) {
      const a = xDe(Math.min(selecao.a, selecao.b))
      const b = xDe(Math.max(selecao.a, selecao.b))
      g.fillStyle = 'rgba(255, 255, 255, 0.10)'
      g.fillRect(a, REGUA, b - a, alturaTotal - REGUA)
    }

    // Os trechos: os escolhidos por ultimo (a borda branca por cima).
    const fila = [...desenho].sort((p, q) => Number(escolhidos.has(p.id)) - Number(escolhidos.has(q.id)))
    g.font = '10px Inter, system-ui, sans-serif'
    for (const x of fila) {
      const x0 = xDe(x.em)
      const x1 = xDe(fimDo(x))
      if (x1 < 0 || x0 > largura) continue
      const y0 = REGUA + x.faixa * ALTURA + 3
      const h = ALTURA - 7
      const correcao = fonteDo(x) !== FONTE_PRINCIPAL
      const escolhido = escolhidos.has(x.id)
      g.beginPath()
      g.roundRect(x0, y0, Math.max(1, x1 - x0), h, 3)
      g.fillStyle = correcao ? 'rgba(80, 130, 240, 0.28)' : escolhido ? 'rgba(46, 160, 104, 0.42)' : 'rgba(46, 160, 104, 0.28)'
      g.fill()

      /*
       * A onda do trecho: o pedaco da gravacao dele, no volume dele. O pico vai
       * clarinho e o corpo da fala (o RMS) forte por cima: com a voz ja nivelada
       * e comprimida, so o pico virava um bloco liso, sem pausa a vista.
       */
      const onda = ondas?.[fonteDo(x)]
      if (onda) {
        const ganho = 10 ** (x.ganhoDb / 20) * escalaDaOnda
        const meio = y0 + (h - 12) / 2
        const alto = (h - 16) / 2
        const p0 = Math.max(0, Math.floor(x0))
        const p1 = Math.min(largura, Math.ceil(x1))
        const pico = correcao ? 'rgba(175, 205, 255, 0.38)' : 'rgba(205, 245, 222, 0.34)'
        const corpo = correcao ? 'rgba(190, 215, 255, 0.95)' : 'rgba(215, 250, 230, 0.92)'
        for (let px = p0; px < p1; px++) {
          const s0 = x.de + (tDe(px) - x.em)
          const s1 = x.de + (tDe(px + 1) - x.em)
          const i0 = Math.max(0, Math.floor(s0 * POR_SEGUNDO))
          const i1 = Math.min(onda.peaks.length, Math.max(i0 + 1, Math.floor(s1 * POR_SEGUNDO)))
          let m = 0
          let r = 0
          for (let i = i0; i < i1; i++) {
            if (onda.peaks[i]! > m) m = onda.peaks[i]!
            if ((onda.rms[i] ?? 0) > r) r = onda.rms[i] ?? 0
          }
          m = Math.min(1, m * ganho)
          if (m <= 0) continue
          const a = Math.max(0.5, m * alto)
          g.fillStyle = pico
          g.fillRect(px, meio - a, 1, a * 2)
          const b = Math.max(0.5, Math.min(m, r * ganho * 1.7) * alto)
          g.fillStyle = corpo
          g.fillRect(px, meio - b, 1, b * 2)
        }
      }

      g.lineWidth = escolhido ? 1.5 : 1
      g.strokeStyle = escolhido ? '#ffffff' : correcao ? 'rgba(120, 165, 255, 0.7)' : 'rgba(70, 190, 125, 0.6)'
      g.stroke()

      if (x1 - x0 > 36) {
        g.save()
        g.beginPath()
        g.rect(x0, y0, x1 - x0, h)
        g.clip()
        g.fillStyle = 'rgba(255, 255, 255, 0.78)'
        const rotulo = `${nomes.get(fonteDo(x)) ?? ''}${x.ganhoDb !== 0 ? ` · ${x.ganhoDb > 0 ? '+' : ''}${x.ganhoDb} dB` : ''}`
        g.fillText(rotulo, Math.max(x0, 0) + 5, y0 + h - 4)
        g.restore()
      }
    }

    // As marcas da regua, no tempo FINAL: uma por 0,5 a 60 s, conforme cabe.
    const pxFinal = pxs * fator
    const passo = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pxFinal >= 60) ?? 60
    g.fillStyle = 'rgba(255,255,255,0.35)'
    for (let t = Math.floor(tDe(0) / fator / passo) * passo; t <= tDe(largura) / fator; t += passo) {
      const x = Math.round(xDe(t * fator)) + 0.5
      g.fillRect(x, REGUA - 6, 1, 6)
      g.fillText(relogio(t).replace(/\.\d$/, ''), x + 3, 12)
    }

    if (guia !== null) {
      g.fillStyle = 'rgba(255, 205, 60, 0.95)'
      g.fillRect(Math.round(xDe(guia)), REGUA, 1, alturaTotal - REGUA)
    }
  }, [desenho, ondas, escalaDaOnda, largura, rolado, pxs, fator, nFaixas, alturaTotal, selecao, escolhidos, nomes, guia])

  const tempoNo = (clientX: number): number => {
    const el = rolagem.current!
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(extensao, (clientX - r.left + el.scrollLeft) / Math.max(pxs, 1e-6)))
  }
  const faixaNo = (clientY: number): number => Math.floor((clientY - rolagem.current!.getBoundingClientRect().top - REGUA) / ALTURA)

  /** O que esta debaixo do mouse: um trecho (e se na borda dele), ou nada. */
  const acharEm = (clientX: number, clientY: number): { trecho: TrechoDaGravacao; borda: 'inicio' | 'fim' | null } | null => {
    const f = faixaNo(clientY)
    const t = tempoNo(clientX)
    const x = trechos.find((y) => y.faixa === f && y.em <= t && t < fimDo(y))
    const borda = (y: TrechoDaGravacao): 'inicio' | 'fim' | null => {
      const larguraPx = (fimDo(y) - y.em) * pxs
      if (larguraPx < BORDA * 3) return null
      if (Math.abs((t - y.em) * pxs) <= BORDA) return 'inicio'
      if (Math.abs((fimDo(y) - t) * pxs) <= BORDA) return 'fim'
      return null
    }
    if (x) return { trecho: x, borda: borda(x) }
    // Logo fora da ponta tambem pega a borda (o mouse nunca cai exato nela).
    const perto = trechos.find((y) => y.faixa === f && (Math.abs((t - y.em) * pxs) <= BORDA || Math.abs((t - fimDo(y)) * pxs) <= BORDA))
    return perto ? { trecho: perto, borda: borda(perto) } : null
  }

  /** O ima: o ajuste que leva um dos `valores` ate a ponta mais perto (dentro de IMA_PX), ou nada. */
  const grudar = (valores: readonly number[], ignorar: ReadonlySet<string>): { ajuste: number; onde: number } | null => {
    if (!ima) return null
    const alvos = [0, agulha.get(), ...trechos.filter((x) => !ignorar.has(x.id)).flatMap((x) => [x.em, fimDo(x)])]
    let melhor: { ajuste: number; onde: number } | null = null
    for (const v of valores) {
      for (const a of alvos) {
        const d = a - v
        if (Math.abs(d) * pxs <= IMA_PX && (!melhor || Math.abs(d) < Math.abs(melhor.ajuste))) melhor = { ajuste: d, onde: a }
      }
    }
    return melhor
  }

  const aoApertar = (e: React.PointerEvent<HTMLDivElement>): void => {
    const el = rolagem.current!
    /*
     * BOTAO DO MEIO: arrastar navega, como na linha do tempo do editor --
     * "quando eu pressionar o scroll do mouse quero poder arrastar e navegar
     * nele quando tiver com zoom".
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
    const f0 = faixaNo(e.clientY)
    const x0 = e.clientX
    const y0 = e.clientY
    const somar = e.ctrlKey || e.metaKey || e.shiftKey
    const achado = acharEm(e.clientX, e.clientY)

    // NO VAZIO: arrastar seleciona um pedaco do tempo; clicar leva a agulha.
    if (!achado) {
      let arrastou = false
      const mover = (ev: PointerEvent): void => {
        if (!arrastou && Math.abs(ev.clientX - x0) < 4) return
        arrastou = true
        onSelecao({ a: t0, b: tempoNo(ev.clientX) })
      }
      const soltar = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', mover)
        window.removeEventListener('pointerup', soltar)
        onEscolher(NENHUM)
        if (arrastou) return
        onSelecao(null)
        onAgulha(tempoNo(ev.clientX))
      }
      window.addEventListener('pointermove', mover)
      window.addEventListener('pointerup', soltar)
      return
    }

    const { trecho, borda } = achado
    let arrasto: Arrasto
    if (borda && !somar) {
      arrasto = { tipo: 'aparar', id: trecho.id, lado: borda }
      onEscolher(new Set([trecho.id]))
    } else {
      let grupo: ReadonlySet<string>
      if (somar) {
        const s = new Set(escolhidos)
        if (s.has(trecho.id)) s.delete(trecho.id)
        else s.add(trecho.id)
        onEscolher(s)
        if (!s.has(trecho.id)) return
        grupo = s
      } else if (escolhidos.has(trecho.id)) {
        grupo = escolhidos
      } else {
        grupo = new Set([trecho.id])
        onEscolher(grupo)
      }
      arrasto = { tipo: 'mover', ids: grupo }
    }
    onSelecao(null)

    let arrastou = false
    let ultima: TrechoDaGravacao[] | null = null
    const mover = (ev: PointerEvent): void => {
      if (!arrastou && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 6) return
      arrastou = true
      if (arrasto.tipo === 'aparar') {
        let t = tempoNo(ev.clientX)
        const g = grudar([t], new Set([arrasto.id]))
        if (g) t += g.ajuste
        setGuia(g ? g.onde : null)
        ultima = aparar(trechos, arrasto.id, arrasto.lado, t, duracoes)
        setPrevia(ultima)
        return
      }
      const indo = trechos.filter((x) => arrasto.ids.has(x.id))
      const menor = Math.min(...indo.map((x) => x.faixa))
      const maior = Math.max(...indo.map((x) => x.faixa))
      const dFaixa = Math.max(-menor, Math.min(nFaixas - 1 - maior, faixaNo(ev.clientY) - f0))
      let dt = tempoNo(ev.clientX) - t0
      const g = grudar(indo.flatMap((x) => [x.em + dt, fimDo(x) + dt]), arrasto.ids)
      if (g) dt += g.ajuste
      const r = moverPerto(trechos, arrasto.ids, dt, dFaixa)
      if (!r) return
      // O guia so aparece se o ima ficou valendo (encostar no vizinho tambem vale como encaixe).
      setGuia(g && Math.abs(r.dt - dt) < 1e-6 ? g.onde : null)
      ultima = r.trechos
      setPrevia(ultima)
    }
    const soltar = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      setPrevia(null)
      setGuia(null)
      if (arrastou) {
        if (ultima && JSON.stringify(ultima) !== JSON.stringify(trechos)) onTrechos(ultima)
        return
      }
      // Clique num trecho: escolhe so ele e leva a agulha (Ctrl+clique so soma, sem mexer na agulha).
      if (somar) return
      onEscolher(new Set([trecho.id]))
      onAgulha(tempoNo(ev.clientX))
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
  }

  // O cursor diz o que o clique vai fazer: aparar, mover, selecionar.
  const aoPassar = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.buttons !== 0) return
    const el = rolagem.current!
    if (e.clientY - el.getBoundingClientRect().top < REGUA) {
      el.style.cursor = 'pointer'
      return
    }
    const achado = acharEm(e.clientX, e.clientY)
    el.style.cursor = !achado ? 'text' : achado.borda ? 'ew-resize' : 'grab'
  }

  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border border-line bg-surface">
      <div className="w-[46px] shrink-0 border-r border-line">
        <div style={{ height: REGUA }} />
        {Array.from({ length: nFaixas }, (_, f) => {
          const quantos = trechos.filter((x) => x.faixa === f).length
          return (
            <div key={f} style={{ height: ALTURA }} className="flex flex-col justify-center gap-0.5 border-b border-line/40 px-2">
              <span className="text-[11px] font-medium text-ink-2">A{f + 1}</span>
              <span className="tnum text-[9px] text-ink-3">{quantos > 0 ? quantos : ''}</span>
            </div>
          )
        })}
      </div>
      <div className="relative min-w-0 flex-1" style={{ height: alturaTotal }}>
        {!ondas && <div className="absolute inset-0 z-10 grid place-items-center text-[12px] text-ink-3">Lendo a gravação...</div>}
        <canvas ref={tela} className="pointer-events-none absolute inset-0 h-full w-full" />
        <Cabeca agulha={agulha} pxs={pxs} rolado={rolado} />
        <div
          ref={rolagem}
          className="absolute inset-0 overflow-x-auto overflow-y-hidden"
          onScroll={(e) => setRolado(e.currentTarget.scrollLeft)}
          // O botao do meio arrasta a vista; sem isto o Windows liga o "rolar automatico".
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault()
          }}
          onPointerDown={aoApertar}
          onPointerMove={aoPassar}
        >
          <div style={{ width: total, height: 1 }} />
        </div>
      </div>
    </div>
  )
}

/** A agulha: a linha branca com a cabeca na regua. Anda sozinha, sem redesenhar as faixas. */
function Cabeca({ agulha, pxs, rolado }: { agulha: Agulha; pxs: number; rolado: number }) {
  const t = useSyncExternalStore(agulha.ouvir, agulha.get)
  const x = Math.round(t * pxs - rolado)
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 z-[1]" style={{ transform: `translateX(${x}px)` }}>
      <div className="absolute inset-y-0 w-[1.5px] bg-white" />
      <div className="absolute -left-[5px] top-0 size-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-white" />
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
  faixa,
  selecao,
  aoUsar,
}: {
  edicao: EdicaoDeAudio
  agulha: Agulha
  faixa: number
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
                const t = agulha.get()
                mudar((e) => ({ ...e, trechos: inserirEm(e.trechos, t, faixa, [trechoDaCorrecao(c)]) }))
                aoUsar()
              }}
              title={`Põe a correção inteira na agulha, na A${faixa + 1}`}
            >
              Na agulha
            </Botaozinho>
            <Botaozinho
              disabled={!temSelecao}
              onClick={() => {
                if (!selecao) return
                mudar((e) => ({ ...e, trechos: substituirIntervalo(e.trechos, selecao.a, selecao.b, faixa, [trechoDaCorrecao(c)]) }))
                aoUsar()
              }}
              title="Tira o pedaço selecionado e põe a correção no lugar"
            >
              No lugar da seleção
            </Botaozinho>
            <button
              type="button"
              onClick={() =>
                mudar((e) => ({
                  ...e,
                  correcoes: e.correcoes.filter((x) => x.id !== c.id),
                  trechos: apagarTrechos(e.trechos, new Set(e.trechos.filter((t) => fonteDo(t) === c.id).map((t) => t.id)), true),
                }))
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

function Efeitos({
  cadeia,
  janela,
  mudar,
}: {
  cadeia: CadeiaDeAudio
  /** A janela de plugin aberta, para quem precisa esperar ela fechar (ver Tela). */
  janela: React.MutableRefObject<Promise<void> | null>
  mudar: (f: (c: CadeiaDeAudio) => CadeiaDeAudio) => void
}) {
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

      <Plugins cadeia={cadeia} janela={janela} mudar={mudar} />

      <Grupo titulo="Normalizar" acao={<Chave ligado={normalizar.ligado} onChange={(v) => mudar((c) => ({ ...c, normalizar: { ...c.normalizar, ligado: v } }))} />}>
        <Linha label="Volume" title="O volume medido do jeito do YouTube (LUFS). −14 é o do render do Dangai">
          <Deslizante textoLargo valor={normalizar.alvoLufs} min={-24} max={-9} step={0.5} padrao={-14} texto={`${normalizar.alvoLufs.toFixed(1).replace('.', ',')} LUFS`}
            onChange={(v) => mudar((c) => ({ ...c, normalizar: { ...c.normalizar, alvoLufs: v } }))} />
        </Linha>
      </Grupo>

      <button
        type="button"
        onClick={() => void salvarPadrao()}
        title="Toda gravação nova começa com estes efeitos (e com esta velocidade)"
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
 * Mora em cima das faixas (2.0): mexe na linha do tempo inteira -- os trechos e
 * o tempo total encolhem juntos na tela.
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
    <div
      className="flex items-center gap-2"
      title="Acelera tudo sem mudar o tom da voz, como o Pitch Correction do DaVinci. A linha do tempo já mostra o tempo final, e a narração sai assim no “Pronto”"
    >
      <span className="text-[11px] text-ink-3">Velocidade</span>
      <div className="w-[230px]">
        <Segmentos
          opcoes={VELOCIDADES_RAPIDAS.map((v) => ({
            valor: v,
            rotulo: `${v}%`,
            title: v === 100 ? 'Normal' : `${v}%: mais rápido, com o mesmo tom`,
          }))}
          ativo={(v) => Math.abs(v - valor) < 0.005}
          onChange={(v) => onChange(v)}
        />
      </div>
      <input
        value={texto}
        inputMode="decimal"
        aria-label={`Outra velocidade, de ${VELOCIDADE_MIN}% a ${VELOCIDADE_MAX}%`}
        title={`Outra: de ${VELOCIDADE_MIN}% a ${VELOCIDADE_MAX}%`}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={aplicar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setTexto(String(valor))
            e.currentTarget.blur()
          }
        }}
        className="tnum h-6 w-14 rounded-sm border border-line bg-elevated px-1.5 text-right text-[11px] text-ink outline-none focus:border-accent"
      />
      <span className="text-[11px] text-ink-3">%</span>
    </div>
  )
}

function Plugins({
  cadeia,
  janela,
  mudar,
}: {
  cadeia: CadeiaDeAudio
  janela: React.MutableRefObject<Promise<void> | null>
  mudar: (f: (c: CadeiaDeAudio) => CadeiaDeAudio) => void
}) {
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
   * A JANELA DO PROPRIO PLUGIN, a mesma do DaVinci: abre no meio da tela, por
   * cima do Dangai. Fecha pelo X dela ou pelo "Fechar" daqui (e sozinha ao sair
   * da etapa); o estado novo volta e o som e refeito. "Quando eu ativo o plugin
   * fresh air, eu nao consigo fecha-lo" -- o X abria fora da tela (ver host.py).
   */
  const abrir = async (id: string): Promise<void> => {
    const p = cadeia.plugins.find((x) => x.id === id)
    if (!p) return
    setErro(null)
    setAbrindo(id)
    const pedido = window.dangai.janelaDoPlugin(p.caminho, p.estado, p.nome)
    janela.current = pedido.then(
      () => undefined,
      () => undefined,
    )
    const r = await pedido
    janela.current = null
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
          {abrindo === p.id ? (
            <Botaozinho active onClick={() => void window.dangai.fecharJanelasDosPlugins()} title="Fecha a janela do plugin e usa os ajustes dela">
              <X size={11} strokeWidth={1.75} /> Fechar
            </Botaozinho>
          ) : (
            <Botaozinho onClick={() => void abrir(p.id)} disabled={abrindo !== null} title="Abre a janela do plugin. Feche-a (pelo X dela ou aqui) para o Dangai usar os ajustes">
              Abrir
            </Botaozinho>
          )}
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
