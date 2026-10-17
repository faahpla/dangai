import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, Plus, X } from 'lucide-react'
import type { EpisodeIndex, Plano } from '../../shared/episodio'
import { nomeNatural } from '@shared/nomes'
import { ROTULO_DO_PAPEL, type Frase, type Roteiro } from '../../shared/roteiro'
import { palavrasDaFrase, type TakeDaVoz } from '../../shared/voz'
import {
  duracaoDaFrase,
  escolhaDaFrase,
  janelaDaNarracao,
  temposDasCenas,
  trechosDoCandidato,
  type CandidatoDeCena,
  type EscolhaDaFrase,
  type EstadoDasCenas,
} from '../../shared/cenas'
import { encaixarEscolha } from '../../shared/encaixe'
import { mesmaCena, useCenas, type PreviaNoTocador } from '../store/gerar-cenas'
import { nucleo } from '../nucleo'
import { useListaDaFrase } from './GradeDasCenas'
import { formatarTempo } from './pecas'

/**
 * O PLAYER GRANDE da tela de Cenas: o da Biblioteca do Dangai ("um player que
 * abre pra poder ver em alta escala"), com a diferenca que importa aqui -- a
 * cena toca COM A NARRACAO DA FRASE por cima, no tempo real do take aprovado,
 * para sentir o corte antes de escolher.
 *
 * Toca a frase como ela ficaria: sem candidato, as cenas escolhidas; com um
 * candidato, a frase com ele no lugar da cena alvo (o que o clique faria), ja
 * encaixado na voz (encaixarEscolha, o mesmo do main). O audio do clipe fica
 * mudo, como no video (Scene.tsx).
 *
 * Teclado (captura, antes do resto da tela): Espaco toca e pausa; <- -> anda
 * pelas cenas da grade (na ordem da tela; antes da primeira, "como esta");
 * cima/baixo anda entre as frases; Enter escolhe; Shift+Enter poe mais uma;
 * Esc fecha.
 */
export function TocadorDasCenas({
  previa,
  roteiro,
  cenas,
  take,
  indice,
  rascunhoId,
}: {
  previa: PreviaNoTocador
  roteiro: Roteiro
  cenas: EstadoDasCenas
  take: TakeDaVoz | null
  indice: EpisodeIndex
  rascunhoId: string
}) {
  const fecharPrevia = useCenas((s) => s.fecharPrevia)
  const abrirPrevia = useCenas((s) => s.abrirPrevia)
  const andarFrase = useCenas((s) => s.andarFrase)
  const trocarCena = useCenas((s) => s.trocarCena)
  const adicionarCena = useCenas((s) => s.adicionarCena)
  const cenaAlvo = useCenas((s) => s.cenaAlvo)
  const carregarAudio = useCenas((s) => s.carregarAudio)
  const audioPublicado = useCenas((s) => (take ? (s.audios[`${rascunhoId}:${take.id}`] ?? null) : null))

  const frases = useMemo(() => roteiro.secoes.flatMap((s) => s.frases.map((f) => ({ frase: f, papel: s.papel }))), [roteiro])
  const posicao = frases.findIndex((x) => x.frase.id === previa.fraseId)
  const atual = frases[posicao]
  const frase = atual?.frase ?? null
  const escolha = frase ? escolhaDaFrase(cenas, frase.id) : null
  const lista = useListaDaFrase(frase ?? { id: previa.fraseId }, escolha, frase ? duracaoDaFrase(frase, take).duracao : 0)
  const candidatos = useMemo(() => {
    // Sem repetir o mesmo plano (a fita e as vizinhas podem se cruzar).
    const vistos = new Set<string>()
    return [...lista.sugestoes, ...lista.vizinhas, ...lista.outras].filter((c) => {
      const id = c.planoIds[0] ?? ''
      if (vistos.has(id)) return false
      vistos.add(id)
      return true
    })
  }, [lista])

  const naLista = previa.candidato ? candidatos.findIndex((c) => mesmaCena(c, previa.candidato!)) : -1
  const escolhida = previa.candidato !== null && (escolha?.cenas.some((c) => mesmaCena(c.candidato, previa.candidato!)) ?? false)

  useEffect(() => {
    if (take) void carregarAudio(rascunhoId, take.id)
  }, [carregarAudio, rascunhoId, take])

  /** A frase como vai tocar: a escolha, ou a escolha com o candidato no lugar da cena alvo, encaixada. */
  const montagem = useMemo((): EscolhaDaFrase | null => {
    if (!frase) return null
    if (!previa.candidato || escolhida) return escolha
    const base: EscolhaDaFrase = escolha ?? {
      fraseId: frase.id,
      cenas: [],
      fita: [],
      confianca: 0,
      travada: true,
      hashTexto: '0000000000000000',
      duracao: 0,
      avisos: [],
    }
    const alvo = Math.min(cenaAlvo, Math.max(0, base.cenas.length - 1))
    const candidato = previa.candidato
    const novas =
      base.cenas.length === 0 ? [{ candidato, palavraInicio: 0 }] : base.cenas.map((c, k) => (k === alvo ? { ...c, candidato } : c))
    return encaixarEscolha({ ...base, cenas: novas }, { indice, frase, take }).escolha
  }, [frase, previa.candidato, escolhida, escolha, cenaAlvo, indice, take])

  const ir = useCallback(
    (i: number) => {
      if (!frase) return
      if (i < 0) abrirPrevia({ fraseId: frase.id, candidato: null })
      else {
        const c = candidatos[i]
        if (c) abrirPrevia({ fraseId: frase.id, candidato: c })
      }
    },
    [abrirPrevia, candidatos, frase],
  )

  const escolher = useCallback(
    (mais: boolean) => {
      if (!frase || !previa.candidato) return
      if (mais) adicionarCena(previa.candidato, frase.id)
      else trocarCena(previa.candidato, frase.id)
    },
    [adicionarCena, trocarCena, frase, previa.candidato],
  )

  const motor = useMotorDaMontagem({
    montagem,
    frase,
    take,
    planos: indice.planos,
    audioUrl: audioPublicado?.url ?? null,
    tocarAoAbrir: previa.tocar,
    chave: `${previa.fraseId}|${previa.candidato?.planoIds.join('+') ?? 'como-esta'}|${montagem?.cenas.map((c) => `${c.candidato.planoIds.join('+')}@${c.palavraInicio}:${c.candidato.inSec.toFixed(2)}`).join(',') ?? ''}`,
  })

  /*
   * O teclado do player vem ANTES do resto (captura): o Esc fecha so ele; as
   * setas andam aqui. Uma escuta so, com o que ela usa num ref: o player
   * redesenha a cada quadro tocando, e religar a escuta a cada quadro e ruido.
   */
  const teclas = useRef({
    fecharPrevia,
    alternar: motor.alternar,
    ir,
    total: candidatos.length,
    naLista,
    andarFrase,
    escolher,
    comCandidato: previa.candidato !== null,
  })
  teclas.current = {
    fecharPrevia,
    alternar: motor.alternar,
    ir,
    total: candidatos.length,
    naLista,
    andarFrase,
    escolher,
    comCandidato: previa.candidato !== null,
  }
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (nucleo().haModalPorCima()) return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      const k = teclas.current
      if (e.key === 'Escape') k.fecharPrevia()
      else if (e.key === ' ') k.alternar()
      else if (e.key === 'ArrowRight') k.ir(Math.min(k.total - 1, k.naLista + 1))
      else if (e.key === 'ArrowLeft') k.ir(Math.max(-1, k.naLista - 1))
      else if (e.key === 'ArrowDown') k.andarFrase(1)
      else if (e.key === 'ArrowUp') k.andarFrase(-1)
      else if (e.key === 'Enter' && k.comCandidato) k.escolher(e.shiftKey)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [])

  if (!frase || !atual) return null
  const palavras = palavrasDaFrase(frase.texto)
  const inicios = new Set((montagem?.cenas ?? []).slice(1).map((c) => c.palavraInicio))
  const c = previa.candidato
  const plano = c ? (indice.planos.find((p) => p.id === c.planoIds[0]) ?? null) : null
  // O titulo curto (como o do player do Dangai); o resto no tooltip.
  const detalhes = [
    `${ROTULO_DO_PAPEL[atual.papel]} · frase ${posicao + 1} · ${motor.duracao.toFixed(1)}s`,
    c ? `cena ${c.planoIds.join('+')} · ${formatarTempo(c.inSec)}` : 'como esta',
    plano && plano.personagens.length > 0 ? plano.personagens.map((p) => nomeNatural(p.nome)).join(', ') : null,
    c && c.porque.length > 0 ? c.porque.join(' · ') : null,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    // bg-black/92: com /85 o texto da coluna do roteiro aparecia por tras da frase e dos botoes.
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/92 p-6" onClick={fecharPrevia}>
      <div className="flex max-h-full w-full max-w-[1400px] flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 text-[12px] text-ink-2">
          <span className="min-w-0 flex-1 truncate" title={detalhes}>
            <span className="text-ink">frase {posicao + 1}</span>
            {c ? (
              <span className="tnum text-ink-3">
                {' '}
                · cena {c.planoIds[0]}
                {c.planoIds.length > 1 ? `+${c.planoIds.length - 1}` : ''} · {formatarTempo(c.inSec)}
              </span>
            ) : (
              <span className="text-ink-3"> · como esta</span>
            )}
          </span>
          <span className="tnum text-ink-3">{naLista >= 0 ? `${naLista + 1} de ${candidatos.length}` : c ? '' : 'Atual'}</span>
          <button type="button" onClick={fecharPrevia} aria-label="Fechar o player" className="text-ink-3 hover:text-ink">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="relative flex min-h-0 items-center justify-center">
          <button
            type="button"
            disabled={naLista < 0}
            onClick={() => ir(naLista - 1)}
            aria-label="Cena anterior"
            className="absolute left-2 z-10 grid size-10 place-items-center rounded-full bg-black/60 text-white hover:bg-accent disabled:opacity-20"
          >
            <ChevronLeft size={20} />
          </button>
          <Tela motor={motor} planoDoPoster={montagem?.cenas[0]?.candidato.planoIds[0] ?? c?.planoIds[0] ?? null} />
          <button
            type="button"
            disabled={naLista >= candidatos.length - 1}
            onClick={() => ir(naLista + 1)}
            aria-label="Proxima cena"
            className="absolute right-2 z-10 grid size-10 place-items-center rounded-full bg-black/60 text-white hover:bg-accent disabled:opacity-20"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* A faixa de baixo num painel cheio: por tras dela ficava o texto da coluna do roteiro. */}
        <div className="flex flex-col gap-3 rounded-md bg-bg px-3 py-3">
          <BarraDaFrase motor={motor} />

          {/* A frase, com a palavra falada acesa e a marca rosa onde cada cena entra. */}
          <p className="mx-auto max-w-[900px] text-center text-[15px] leading-relaxed">
            {palavras.map((p, i) => (
              <span key={i}>
                {inicios.has(i) && <span className="mx-1 inline-block h-3.5 w-[3px] rounded-full bg-accent align-middle" />}
                <span className={i === motor.palavra ? 'text-accent' : i < motor.palavra ? 'text-ink' : 'text-ink-3'}>{p}</span>{' '}
              </span>
            ))}
          </p>

          <div className="flex items-center justify-center gap-2 text-[12px]">
            <button
              type="button"
              onClick={motor.alternar}
              className="flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-3 py-1.5 text-ink-2 hover:text-ink"
            >
              {motor.tocando ? <Pause size={13} strokeWidth={1.75} /> : <Play size={13} strokeWidth={1.75} />}
              {motor.tocando ? 'Pausar' : 'Tocar'}
            </button>
            {c && (
              <>
                <button
                  type="button"
                  onClick={() => escolher(false)}
                  className={[
                    'rounded-sm border px-3 py-1.5',
                    escolhida ? 'border-accent bg-accent-dim text-ink' : 'border-accent text-ink hover:bg-accent-dim',
                  ].join(' ')}
                >
                  {escolhida ? 'Escolhida (clique para tirar)' : 'Escolher esta cena'}
                </button>
                {!escolhida && (escolha?.cenas.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => escolher(true)}
                    title="Shift+Enter"
                    className="flex items-center gap-1 rounded-sm border border-line bg-elevated px-3 py-1.5 text-ink-2 hover:text-ink"
                  >
                    <Plus size={12} strokeWidth={1.75} />
                    Mais uma cena
                  </button>
                )}
              </>
            )}
            <span className="text-[11px] text-ink-3">Espaco toca · ← → outra cena · ↑ ↓ outra frase · Esc fecha</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// --------------------------------------------------------------- o motor

/** Um pedaco de mp4 na linha do tempo da frase (segundos relativos ao inicio do trecho). */
interface Segmento {
  arquivo: string
  /** Segundos dentro do mp4. Depois de `ate` a imagem fica parada (cena mais longa que o video). */
  de: number
  ate: number
  /** Onde ele entra e sai na frase. */
  t0: number
  t1: number
  cena: number
}

function segmentosDa(
  montagem: EscolhaDaFrase | null,
  frase: Frase | null,
  take: TakeDaVoz | null,
  planos: readonly Plano[],
): Segmento[] {
  if (!montagem || !frase) return []
  const tempos = temposDasCenas(montagem, frase, take)
  const porId = new Map(planos.map((p) => [p.id, p]))
  const saida: Segmento[] = []
  for (const [k, cena] of montagem.cenas.entries()) {
    const janela = tempos[k]
    if (!janela || janela.fim <= janela.inicio) continue
    const dele = cena.candidato.planoIds.map((id) => porId.get(id)).filter((p): p is Plano => p !== undefined)
    let t = janela.inicio
    let ultimo: Segmento | null = null
    for (const tr of trechosDoCandidato(cena.candidato, dele)) {
      if (t >= janela.fim) break
      const fim = Math.min(janela.fim, t + (tr.ate - tr.de))
      ultimo = {
        arquivo: tr.arquivo,
        de: tr.de,
        ate: tr.de + (fim - t),
        t0: t,
        t1: fim,
        cena: k,
      }
      saida.push(ultimo)
      t = fim
    }
    // Video mais curto que a cena: o ultimo pedaco segura o quadro final ate a cena acabar.
    if (ultimo && t < janela.fim) ultimo.t1 = janela.fim
  }
  return saida
}

interface MotorDaMontagem {
  segmentos: Segmento[]
  duracao: number
  t: number
  tocando: boolean
  /** O segmento na tela. -1 = nenhum. */
  ativo: number
  /** Indice (em palavrasDaFrase) da palavra que a narracao fala agora. -1 = antes da primeira. */
  palavra: number
  /** Onde cada cena comeca, relativo a frase (as marcas da barra). */
  cortes: number[]
  alternar: () => void
  irPara: (t: number) => void
  videoRef: (i: number) => (el: HTMLVideoElement | null) => void
}

/**
 * Toca a montagem: um <audio> com o take (o relogio, quando ha trecho real) e
 * um <video> mudo por pedaco de mp4, empilhados -- so o pedaco da vez aparece,
 * e o seguinte ja esta parado no ponto certo, entao o corte nao pisca. Sem
 * trecho do take, o relogio e o do sistema (sem som).
 */
function useMotorDaMontagem({
  montagem,
  frase,
  take,
  planos,
  audioUrl,
  tocarAoAbrir,
  chave,
}: {
  montagem: EscolhaDaFrase | null
  frase: Frase | null
  take: TakeDaVoz | null
  planos: readonly Plano[]
  audioUrl: string | null
  tocarAoAbrir: boolean
  chave: string
}): MotorDaMontagem {
  const segmentos = useMemo(() => segmentosDa(montagem, frase, take, planos), [montagem, frase, take, planos])
  const duracao = frase ? duracaoDaFrase(frase, take).duracao : 0
  const real = frase ? duracaoDaFrase(frase, take).real : false
  const janela = useMemo(() => (take && frase && real ? janelaDaNarracao(take, frase.id) : null), [take, frase, real])
  const palavrasDoTake = useMemo(
    () => (take && frase && janela ? take.palavras.filter((p) => p.fraseId === frase.id).map((p) => p.start - janela.inicio) : []),
    [take, frase, janela],
  )
  const cortes = useMemo(
    () =>
      montagem && frase
        ? temposDasCenas(montagem, frase, take)
            .slice(1)
            .map((x) => x.inicio)
        : [],
    [montagem, frase, take],
  )

  const [t, setT] = useState(0)
  const [tocando, setTocando] = useState(false)
  const [ativo, setAtivo] = useState(-1)
  const tRef = useRef(0)
  const tocandoRef = useRef(false)
  const relogio = useRef({ base: 0, desde: 0 })
  const videos = useRef<(HTMLVideoElement | null)[]>([])
  const audio = useRef<HTMLAudioElement | null>(null)
  const segRef = useRef(segmentos)
  segRef.current = segmentos

  // Um <audio> fora do React (como o tocador do passo 3): troca so a src quando o take muda.
  useEffect(() => {
    const el = new Audio()
    el.preload = 'auto'
    audio.current = el
    return () => {
      el.pause()
      el.removeAttribute('src')
      el.load()
      audio.current = null
    }
  }, [])
  useEffect(() => {
    const el = audio.current
    if (!el) return
    if (audioUrl && el.src !== audioUrl) {
      el.src = audioUrl
      el.load()
    }
  }, [audioUrl])

  const agora = useCallback((): number => {
    const el = audio.current
    if (tocandoRef.current && el && janela && audioUrl && !el.paused) return el.currentTime - janela.inicio
    if (!tocandoRef.current) return tRef.current
    return relogio.current.base + (performance.now() - relogio.current.desde) / 1000
  }, [janela, audioUrl])

  /** Poe cada video no lugar: o da vez toca (ou para no quadro), os outros esperam no comeco deles. */
  const sincronizar = useCallback((tt: number, tocandoAgora: boolean): void => {
    const segs = segRef.current
    let vez = segs.findIndex((s) => tt >= s.t0 && tt < s.t1)
    if (vez < 0 && segs.length > 0) vez = tt >= (segs[segs.length - 1]?.t1 ?? 0) ? segs.length - 1 : 0
    segs.forEach((s, i) => {
      const v = videos.current[i]
      if (!v) return
      if (i === vez) {
        const alvo = Math.min(s.ate, s.de + Math.max(0, tt - s.t0))
        const parado = alvo >= s.ate - 0.02
        if (tocandoAgora && !parado) {
          if (Math.abs(v.currentTime - alvo) > 0.25) v.currentTime = alvo
          if (v.paused) void v.play().catch(() => undefined)
        } else {
          if (!v.paused) v.pause()
          if (Math.abs(v.currentTime - alvo) > 0.04) v.currentTime = alvo
        }
      } else {
        if (!v.paused) v.pause()
        if (i > vez && !v.seeking && Math.abs(v.currentTime - s.de) > 0.04) v.currentTime = s.de
      }
    })
    setAtivo(vez)
  }, [])

  const pausar = useCallback((): void => {
    tocandoRef.current = false
    setTocando(false)
    audio.current?.pause()
    for (const v of videos.current) v?.pause()
  }, [])

  const irPara = useCallback(
    (alvo: number): void => {
      const tt = Math.min(Math.max(0, alvo), duracao)
      tRef.current = tt
      setT(tt)
      relogio.current = { base: tt, desde: performance.now() }
      const el = audio.current
      if (el && janela && audioUrl) el.currentTime = janela.inicio + tt
      sincronizar(tt, tocandoRef.current)
    },
    [duracao, janela, audioUrl, sincronizar],
  )

  const tocar = useCallback((): void => {
    if (duracao <= 0) return
    const inicio = tRef.current >= duracao - 0.05 ? 0 : tRef.current
    tocandoRef.current = true
    setTocando(true)
    irPara(inicio)
    const el = audio.current
    if (el && janela && audioUrl) void el.play().catch(() => undefined)
  }, [duracao, irPara, janela, audioUrl])

  const alternar = useCallback((): void => {
    if (tocandoRef.current) pausar()
    else tocar()
  }, [pausar, tocar])

  // O relogio anda a cada quadro enquanto toca; no fim da frase, para (o audio seguiria para a proxima).
  useEffect(() => {
    if (!tocando) return
    let quadro = 0
    const passo = (): void => {
      let tt = agora()
      if (tt >= duracao) {
        tt = duracao
        tRef.current = tt
        setT(tt)
        pausar()
        sincronizar(tt, false)
        return
      }
      tRef.current = tt
      setT(tt)
      sincronizar(tt, true)
      quadro = requestAnimationFrame(passo)
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
  }, [tocando, agora, duracao, pausar, sincronizar])

  // Outra montagem (outra cena, outra frase): do comeco, tocando se o player pediu.
  const tocarRef = useRef(tocarAoAbrir)
  tocarRef.current = tocarAoAbrir
  useEffect(() => {
    const seguia = tocandoRef.current
    pausar()
    tRef.current = 0
    setT(0)
    // Espera os videos novos montarem antes de posicionar.
    const id = requestAnimationFrame(() => {
      sincronizar(0, false)
      if (seguia || tocarRef.current) tocar()
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  // O audio chegou depois do play (primeira abertura): entra no ponto certo.
  useEffect(() => {
    if (audioUrl && tocandoRef.current && janela) {
      const el = audio.current
      if (el) {
        el.currentTime = janela.inicio + tRef.current
        void el.play().catch(() => undefined)
      }
    }
  }, [audioUrl, janela])

  // Fechou o player: tudo para.
  useEffect(() => () => pausar(), [pausar])

  let palavra = -1
  for (const [i, inicio] of palavrasDoTake.entries()) {
    if (inicio <= t + 0.02) palavra = i
    else break
  }

  const videoRef = useCallback(
    (i: number) =>
      (el: HTMLVideoElement | null): void => {
        videos.current[i] = el
      },
    [],
  )

  return {
    segmentos,
    duracao,
    t,
    tocando,
    ativo,
    palavra,
    cortes,
    alternar,
    irPara,
    videoRef,
  }
}

/** Sem nenhum video carregado depois disto, o giro vira o recado (o mp4 pode estar num disco lento ou ter sumido). */
const ESPERA_DO_VIDEO_MS = 12000

/**
 * Os videos empilhados (so o da vez aparece) e, enquanto nada carregou, a
 * miniatura. O mp4 que nao existe mais (corte refeito, disco desligado) vira
 * recado no lugar do giro -- a narracao seguia tocando sobre um giro eterno.
 */
function Tela({ motor, planoDoPoster }: { motor: MotorDaMontagem; planoDoPoster: string | null }) {
  const publicarVideo = useCenas((s) => s.publicarVideo)
  const videos = useCenas((s) => s.videos)
  const poster = useCenas((s) => (planoDoPoster ? (s.miniaturas[planoDoPoster] ?? null) : null))
  const arquivos = useMemo(() => [...new Set(motor.segmentos.map((s) => s.arquivo))], [motor.segmentos])
  const [faltando, setFaltando] = useState<ReadonlySet<string>>(new Set())
  const [demorou, setDemorou] = useState(false)
  const marcarFalta = useCallback((arquivo: string) => {
    setFaltando((antes) => (antes.has(arquivo) ? antes : new Set([...antes, arquivo])))
  }, [])
  useEffect(() => {
    for (const a of arquivos) {
      void publicarVideo(a).then((url) => {
        if (!url) marcarFalta(a)
      })
    }
  }, [arquivos, publicarVideo, marcarFalta])
  const algum = motor.segmentos.some((s) => videos[s.arquivo] && !faltando.has(s.arquivo))
  useEffect(() => {
    setDemorou(false)
    if (algum || arquivos.length === 0) return
    const t = window.setTimeout(() => setDemorou(true), ESPERA_DO_VIDEO_MS)
    return () => window.clearTimeout(t)
  }, [algum, arquivos])
  const semArquivo = motor.segmentos.length > 0 && !algum && (demorou || arquivos.every((a) => faltando.has(a)))

  return (
    <div className="relative aspect-video max-h-[64vh] w-full overflow-hidden rounded-md bg-black">
      {poster && !algum && <img src={poster} alt="" className="absolute inset-0 size-full object-contain" />}
      {motor.segmentos.map((s, i) => {
        const url = videos[s.arquivo]
        return url ? (
          <video
            key={`${i}-${s.arquivo}`}
            ref={motor.videoRef(i)}
            src={url}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              // Ja nasce parado no comeco do proprio pedaco.
              if (i !== motor.ativo) e.currentTarget.currentTime = s.de
            }}
            onError={() => marcarFalta(s.arquivo)}
            className="absolute inset-0 size-full object-contain"
            style={{ opacity: i === motor.ativo ? 1 : 0 }}
          />
        ) : null
      })}
      {motor.segmentos.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-[12px] text-ink-3">Sem cena nesta frase</div>
      )}
      {semArquivo ? (
        <div className="absolute inset-0 grid place-items-center bg-black/60 text-[12px] text-ink-3">
          Arquivo da cena nao encontrado
        </div>
      ) : (
        motor.segmentos.length > 0 &&
        !algum && (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 size={20} className="animate-spin text-ink-3" />
          </div>
        )
      )}
    </div>
  )
}

/** A barra da frase: o andamento, as cenas em faixas alternadas e a marca de cada corte. Clicar leva a agulha. */
function BarraDaFrase({ motor }: { motor: MotorDaMontagem }) {
  const d = Math.max(0.001, motor.duracao)
  const limites = [0, ...motor.cortes, motor.duracao]
  return (
    <div className="flex items-center gap-3">
      <span className="tnum w-[42px] shrink-0 text-right text-[11px] text-ink-3">{motor.t.toFixed(1)}s</span>
      <div
        role="slider"
        aria-label="Andamento da frase"
        aria-valuemin={0}
        aria-valuemax={motor.duracao}
        aria-valuenow={motor.t}
        tabIndex={-1}
        onClick={(e) => {
          const caixa = e.currentTarget.getBoundingClientRect()
          motor.irPara(((e.clientX - caixa.left) / caixa.width) * motor.duracao)
        }}
        className="relative h-[10px] flex-1 cursor-pointer overflow-hidden rounded-full bg-elevated"
      >
        {limites.slice(0, -1).map((inicio, k) => (
          <span
            key={k}
            className={['absolute inset-y-0', k % 2 === 0 ? 'bg-accent-dim' : 'bg-line-strong/60'].join(' ')}
            style={{
              left: `${(inicio / d) * 100}%`,
              width: `${(((limites[k + 1] ?? d) - inicio) / d) * 100}%`,
            }}
          />
        ))}
        {motor.cortes.map((c, k) => (
          <span key={`c${k}`} className="absolute inset-y-0 w-[2px] bg-accent" style={{ left: `${(c / d) * 100}%` }} />
        ))}
        <span className="absolute inset-y-0 w-[2px] bg-white" style={{ left: `calc(${(motor.t / d) * 100}% - 1px)` }} />
      </div>
      <span className="tnum w-[42px] shrink-0 text-[11px] text-ink-3">{motor.duracao.toFixed(1)}s</span>
    </div>
  )
}
