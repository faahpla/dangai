import { useEffect, useMemo, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { duracaoDoTrecho, familiaDaFonte, medidasDo, VIDEO_FPS } from '@shared/contract'
import { toRenderProps } from '@shared/plan'
import type { ImageAsset, ScenePlan } from '@shared/contract'
import { sfxParaDisparar } from '@shared/sfx'
import { useProject } from '@/store/project'
import { useAjusteDasFaixas, useDucking } from './som-do-preview'
import { Video } from '@/remotion/Video'
import { TransformNoPreview } from './TransformNoPreview'
import { useVisor, useVisorCheio, ZOOM_DO_VISOR_MIN } from '@/store/layout'
import { Maximize2, Minimize2, Pause, Play } from 'lucide-react'
import { create } from 'zustand'

/*
 * O PLAYER ESPERANDO O VIDEO. "Aperto play e demora pra cena acompanhar o
 * audio, principalmente no inicio": a narracao comecava na hora e a imagem,
 * ainda abrindo o clipe e procurando o ponto (medido: ate 1s quando o play cai
 * no meio de um bloco), corria atras. Agora o <video> pede espera
 * (pauseWhenBuffering, em Scene) e todo audio do preview espera junto -- os
 * dois comecam no mesmo instante, como num editor.
 */
const useEspera = create<{ esperando: boolean }>(() => ({ esperando: false }))

/** Tocando DE VERDADE: play apertado e o player nao esta esperando video. */
function useTocando(): boolean {
  const playing = useProject((s) => s.playing)
  const esperando = useEspera((s) => s.esperando)
  return playing && !esperando
}

/**
 * Preview NO FORMATO DO PROJETO, com o @remotion/player -- o MESMO componente
 * Video que o render usa. E o motivo de ter escolhido Remotion: o que aparece aqui e o que sai no
 * MP4, sem uma simulacao paralela para manter em dia.
 *
 * O plano vem de shared/plan, tambem o mesmo que o main usa no render.
 */
export function Preview() {
  const cheio = useVisorCheio((s) => s.aberto)
  // Em tela cheia o quadro ocupa o visor inteiro: a margem do zoom e para as
  // alcas de um insert, e ali nao se edita.
  const zoomDoVisor = useVisor((s) => (cheio ? 1 : s.zoom))
  const quadroRef = useRef<HTMLDivElement | null>(null)
  const visorRef = useRef<HTMLDivElement | null>(null)
  // Ctrl+roda no preview: o zoom do visor (a roda sozinha, em cima de um
  // insert escolhido, continua escalando o insert).
  useEffect(() => {
    const el = visorRef.current
    if (!el) return
    const roda = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const v = useVisor.getState()
      v.definir(v.zoom * Math.exp(-e.deltaY * 0.0015))
    }
    el.addEventListener('wheel', roda, { passive: false })
    return () => el.removeEventListener('wheel', roda)
  }, [])
  const audio = useProject((s) => s.audio)
  const images = useProject((s) => s.images)
  const music = useProject((s) => s.music)
  const musicGainDb = useProject((s) => s.musicGainDb)

  /*
   * O mesmo ganho que o ffmpeg aplica no render, em amplitude linear.
   *
   * O equilibrio que se ouve aqui e proximo do final, nao identico: no render a
   * narracao passa antes pelo loudnorm de -14 LUFS, e aqui ela toca no nivel
   * cru do arquivo. Narracao de TTS costuma sair perto disso, entao a diferenca
   * e pequena -- mas quem quiser o numero exato tem que renderizar.
   */
  const musicVolume = 10 ** (musicGainDb / 20)

  /*
   * O player entra em estado, nao em ref: ele so e montado depois que ha audio
   * E imagens, entao no primeiro efeito uma ref ainda esta em null. Como as
   * acoes do store sao estaveis, o efeito que assina 'frameupdate' rodaria
   * uma unica vez -- justamente antes do player existir -- e nunca mais. O
   * resultado era o playhead preso em zero enquanto o video e o audio tocavam
   * normalmente. Guardar a instancia em estado reexecuta os efeitos na hora em
   * que ela aparece.
   */
  const [player, setPlayer] = useState<PlayerRef | null>(null)

  const durationInFrames = Math.max(Math.ceil((audio?.durationSec ?? 1) * VIDEO_FPS), 1)

  // Exatamente o plano que vai para o render -- nao uma aproximacao.
  const plan = useProject((s) => s.plan)
  const captions = useProject((s) => s.captions)
  const captionsEnabled = useProject((s) => s.captionsEnabled)
  const captionColor = useProject((s) => s.captionColor)
  const captionFont = useProject((s) => s.captionFont)
  const captionAnimation = useProject((s) => s.captionAnimation)
  const captionAnimationFrames = useProject((s) => s.captionAnimationFrames)
  const captionAnimationCurve = useProject((s) => s.captionAnimationCurve)
  const captionMark = useProject((s) => s.captionMark)
  const captionShadow = useProject((s) => s.captionShadow)
  const captionStroke = useProject((s) => s.captionStroke)
  const captionY = useProject((s) => s.captionY)
  const captionScale = useProject((s) => s.captionScale)

  const formato = useProject((s) => s.formato)
  const quadro = medidasDo(formato)
  const hookText = useProject((s) => s.hookText)
  const hookSec = useProject((s) => s.hookSec)
  const endText = useProject((s) => s.endText)
  const endSec = useProject((s) => s.endSec)
  const sobreposicoes = useProject((s) => s.sobreposicoes)
  const faixasMudas = useProject((s) => s.faixasMudas)
  /*
   * So a imagem que esta sendo ENQUADRADA AGORA toca o original, com o foco
   * recortando ao vivo; assim que o recorte novo fica pronto ela volta a copia
   * leve. Tocar o original em todos (v1.62.2) -- ou so no bloco escolhido --
   * deixava o play lento para pegar: "aperto play e demora pra cena
   * acompanhar o audio, principalmente no inicio".
   */
  const enquadrando = useProject((s) => s.enquadrando)
  const focoAoVivo = useMemo(() => new Set(enquadrando ? [enquadrando] : []), [enquadrando])

  /*
   * O TRECHO DO CLIPE AO VIVO: enquanto ele arrasta a janela da tira, o preview
   * usa o ponto de entrada do dedo (ver PontoDeEntrada) -- "quero que mude
   * simultaneamente no preview, so assim pra eu ver exatamente onde deve
   * comecar". So a cena arrastada muda; a chave dela nao, entao o video so
   * procura o quadro, sem remontar.
   */
  const trechoAoVivo = useProject((s) => s.trechoAoVivo)
  const planDoPreview = useMemo(() => {
    if (!plan || !trechoAoVivo) return plan
    return {
      ...plan,
      scenes: plan.scenes.map((s, i) => (i === trechoAoVivo.index ? { ...s, [trechoAoVivo.campo]: trechoAoVivo.valor } : s)),
    }
  }, [plan, trechoAoVivo])

  const inputProps = useMemo(
    () =>
      planDoPreview && images.length > 0
        ? toRenderProps(
            planDoPreview,
            images,
            captionsEnabled ? captions : [],
            { hook: hookText, hookSec, end: endText, endSec },
            captionColor,
            captionY,
            // O preview precisa do mesmo tempo do render, senao ele mostraria um
            // final que o MP4 nao tem (ou esconderia um que ele tem).
            audio?.durationSec,
            {
              // Sem URL resolvida (projeto recem-aberto), vale a embutida ate o
              // refreshFontes reencontrar o arquivo na pasta.
              font: captionFont?.url ? {
                    family: familiaDaFonte(captionFont.nome),
                    url: captionFont.url,
                  }
                : null,
              animation: captionAnimation,
              animationFrames: captionAnimationFrames,
              animationCurve: captionAnimationCurve,
              mark: captionMark,
              shadow: captionShadow,
              stroke: captionStroke,
              scale: captionScale,
            },
            formato,
            sobreposicoes.filter((o) => !faixasMudas.video.includes(o.faixa)),
            // O enquadramento do bloco escolhido muda o preview AO VIVO.
            focoAoVivo,
          )
        : {
            formato,
            scenes: [],
            captions: [],
            cards: [],
            captionColor,
            captionY,
            captionFont: null,
            captionAnimation,
            captionAnimationFrames,
            captionAnimationCurve,
            captionMark,
            captionShadow,
            captionStroke,
            captionScale,
            sobreposicoes: [],
          },
    [
      planDoPreview,
      images,
      audio,
      captions,
      captionsEnabled,
      captionColor,
      captionY,
      /*
       * Tudo que entra nas props tem que estar AQUI.
       *
       * Faltando um campo, o memo nao recalcula e o player continua com as props
       * antigas: mudar a fonte, a animacao ou o modo de cor nao surtia efeito
       * nenhum ate encostar em alguma coisa que estivesse na lista -- ligar e
       * desligar a legenda, por exemplo. O render nunca teve esse problema
       * porque le o estado direto, e foi por isso que passou despercebido.
       */
      captionFont,
      captionAnimation,
      captionAnimationFrames,
      captionAnimationCurve,
      captionMark,
      captionShadow,
      captionStroke,
      captionScale,
      hookText,
      hookSec,
      endText,
      endSec,
      sobreposicoes,
      faixasMudas,
      focoAoVivo,
    ],
  )


  return (
    /*
     * A MOLDURA DA TELA CHEIA. Fechada, ela nao existe para o layout
     * ('contents'); aberta, cobre o editor. O visor continua o MESMO elemento
     * nos dois jeitos -- trocar de pai remontaria o Player e a imagem piscaria.
     * O tamanho sai do espaco que sobra acima da barra (o miolo flex-1), e nao
     * da janela: o editor e quem contem a moldura.
     */
    <div
      className={cheio ? 'fixed inset-0 z-[60] flex flex-col items-center gap-3 bg-black px-6 pt-6 pb-4' : 'contents'}
    >
    <div className={cheio ? 'flex min-h-0 w-full flex-1 items-center justify-center' : 'contents'}>
    {/*
     * A CAIXA TEM O FORMATO DO PROJETO, e o eixo que manda muda com ele.
     *
     * No vertical a altura manda e a largura sai do aspecto -- o preview em pe
     * cabe folgado ao lado dos controles. No horizontal isso se inverteria de
     * um jeito ruim: um 16:9 com a altura da coluna mediria quase setecentos
     * pixels de largura e comeria a area de edicao inteira. Ali quem manda e a
     * largura, presa numa faixa, e a altura sai dela.
     */}
    <div
      ref={visorRef}
      style={{
        aspectRatio: `${quadro.width} / ${quadro.height}`,
        // Na tela cheia: o maior que couber no miolo.
        ...(cheio ? { height: '100%', maxWidth: '100%' } : {}),
      }}
      className={[
        'relative shrink-0 overflow-hidden rounded-md border border-line',
        zoomDoVisor < 1 ? 'bg-bg' : 'bg-surface',
        cheio ? '' : quadro.width > quadro.height ? 'w-[clamp(320px,32vw,560px)] self-start' : 'h-full',
      ].join(' ')}
    >
      {images.length > 0 && audio ? (
        <>
          {/*
            O QUADRO dentro do visor: no zoom 100% ocupa tudo; menor, fica no
            meio com a margem escura em volta (ver useVisor).
          */}
          <div
            ref={quadroRef}
            className={['absolute', zoomDoVisor < 1 ? 'outline outline-1 outline-line-strong' : ''].join(' ')}
            style={{
              left: `${((1 - zoomDoVisor) / 2) * 100}%`,
              top: `${((1 - zoomDoVisor) / 2) * 100}%`,
              width: `${zoomDoVisor * 100}%`,
              height: `${zoomDoVisor * 100}%`,
            }}
          >
            <Player
              ref={setPlayer}
              component={Video}
              inputProps={inputProps}
              durationInFrames={durationInFrames}
              fps={VIDEO_FPS}
              compositionWidth={quadro.width}
              compositionHeight={quadro.height}
              style={{ width: '100%', height: '100%' }}
              // Sem controles proprios: a timeline do app e o unico transporte.
              controls={false}
              clickToPlay={false}
              doubleClickToFullscreen={false}
              acknowledgeRemotionLicense
            />
          </div>
          {/* A caixa do insert escolhido: mover, escalar e girar no proprio preview. */}
          {!cheio && <TransformNoPreview quadroRef={quadroRef} />}
          {!cheio && <ZoomDoVisor />}
          {/* Na tela cheia, clicar no video toca e pausa, como num player. */}
          {cheio && (
            <button
              type="button"
              aria-label="Tocar ou pausar"
              className="absolute inset-0 z-10 cursor-default"
              onClick={() => useProject.getState().togglePlay()}
            />
          )}
          {/*
            A narracao toca por fora da composicao porque o Remotion entrega
            video puro e o audio so entra no mux -- ver Video.tsx.
          */}
          <SyncedAudio url={audio.url} />
          {music && <SyncedAudio url={music.url} volume={musicVolume} loop />}
          <SfxPreview />
          <TrilhasPreview />
          <Sincronia player={player} plan={plan} images={images} />
        </>
      ) : (
        <div className="grid h-full place-items-center px-6 text-center text-[11px] text-ink-3">
          {images.length === 0 ? 'Solte imagens para ver o preview' : 'Solte a narração'}
        </div>
      )}

      {!cheio && (
        <span className="tnum pointer-events-none absolute bottom-2 right-2 rounded-[6px] bg-black/60 px-1.5 py-0.5 text-[10px] text-white/70">
          {quadro.width} x {quadro.height}
        </span>
      )}
      {!cheio && images.length > 0 && audio && (
        <button
          type="button"
          onClick={() => useVisorCheio.getState().alternar()}
          title="Assistir em tela cheia (F)"
          aria-label="Assistir em tela cheia"
          className="absolute right-2 top-2 z-20 grid h-6 w-6 place-items-center rounded-[6px] bg-black/60 text-white/70 hover:text-white"
        >
          <Maximize2 size={12} strokeWidth={1.75} />
        </button>
      )}
    </div>
    </div>
    {cheio && <BarraDaTelaCheia duracaoSec={durationInFrames / VIDEO_FPS} />}
    </div>
  )
}

/**
 * A BARRA DE BAIXO da tela cheia: tocar/pausar, o tempo, a agulha (arrastar
 * anda no video) e sair. O teclado continua valendo: espaco, setas, Esc.
 */
function BarraDaTelaCheia({ duracaoSec }: { duracaoSec: number }) {
  const playing = useProject((s) => s.playing)
  const playhead = useProject((s) => s.playhead)
  const relogio = (t: number): string => {
    const s = Math.max(0, Math.floor(t))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  return (
    <div className="flex w-full max-w-[720px] shrink-0 items-center gap-3 text-white/80">
      <button
        type="button"
        onClick={() => useProject.getState().togglePlay()}
        aria-label={playing ? 'Pausar' : 'Tocar'}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20"
      >
        {playing ? <Pause size={14} strokeWidth={1.75} /> : <Play size={14} strokeWidth={1.75} />}
      </button>
      <span className="tnum w-[88px] shrink-0 text-[12px]">
        {relogio(playhead)} / {relogio(duracaoSec)}
      </span>
      <input
        type="range"
        min={0}
        max={duracaoSec}
        step={1 / VIDEO_FPS}
        value={Math.min(playhead, duracaoSec)}
        onChange={(e) => useProject.getState().setPlayhead(Number(e.target.value))}
        aria-label="Agulha"
        className="dangai-range min-w-0 flex-1"
      />
      <button
        type="button"
        onClick={() => useVisorCheio.getState().fechar()}
        title="Sair da tela cheia (Esc ou F)"
        className="flex shrink-0 items-center gap-1.5 rounded-sm bg-white/10 px-2.5 py-1.5 text-[12px] hover:bg-white/20"
      >
        <Minimize2 size={12} strokeWidth={1.75} />
        Sair
      </button>
    </div>
  )
}

/**
 * O ZOOM DO VISOR, no canto de baixo do preview: menos, o valor (clique volta
 * a 100%) e mais. Ctrl+roda faz o mesmo.
 */
function ZoomDoVisor() {
  const zoom = useVisor((s) => s.zoom)
  const definir = useVisor((s) => s.definir)
  // Le o zoom de AGORA (e nao o do render): cliques seguidos somam todos.
  const passo = (sinal: 1 | -1): void => definir(Math.round((useVisor.getState().zoom + sinal * 0.1) * 10) / 10)
  const botao = 'grid h-5 w-5 place-items-center text-white/70 hover:text-white disabled:opacity-30'
  return (
    <div
      className="absolute bottom-2 left-2 z-20 flex items-center rounded-[6px] bg-black/60 text-[10px]"
      title="Zoom do visor (Ctrl+roda): menor, sobra espaço em volta para as alças de um insert grande"
    >
      <button type="button" className={botao} disabled={zoom <= ZOOM_DO_VISOR_MIN} onClick={() => passo(-1)} aria-label="Diminuir o zoom do visor">
        −
      </button>
      <button type="button" className="tnum px-1 text-white/70 hover:text-white" onClick={() => definir(1)} title="Voltar a 100%">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className={botao} disabled={zoom >= 1} onClick={() => passo(1)} aria-label="Aumentar o zoom do visor">
        +
      </button>
    </div>
  )
}

/**
 * Os SFX postos a mao, tocando no preview.
 *
 * Sem isto ele posicionava no escuro: o som so existia no MP4, entao conferir
 * se o whoosh caiu na silaba certa exigia renderizar. Palavras dele: "como q eu
 * vou saber se ta certo".
 *
 * Cada som e um DISPARO, e nao uma faixa sincronizada como a narracao: ele nao
 * acompanha o playhead, ele toca do inicio quando a agulha CRUZA o instante
 * dele. Quem decide isso e `sfxParaDisparar`, em @shared/sfx -- ela vive fora
 * daqui porque o Player pausa a cada seek externo, e sem isso nao haveria como
 * PROVAR a regra sem um par de olhos e um par de ouvidos na frente da tela.
 *
 * Os automaticos ficam de fora de proposito: eles sao decididos na hora do
 * render, a partir dos cortes, e nao existem como objeto ate la.
 */
function SfxPreview() {
  const sfxManual = useProject((s) => s.sfxManual)
  const sfxEnabled = useProject((s) => s.sfxEnabled)
  const playing = useTocando()
  const playhead = useProject((s) => s.playhead)

  const elementos = useRef(new Map<string, HTMLAudioElement>())
  const anterior = useRef(playhead)

  useEffect(() => {
    const antes = anterior.current
    anterior.current = playhead

    if (!playing || !sfxEnabled) return

    // A regra de quem dispara mora em @shared/sfx, onde ela e testada -- aqui
    // sobra so ligar o resultado nos elementos.
    for (const id of sfxParaDisparar(sfxManual, antes, playhead)) {
      const el = elementos.current.get(id)
      if (!el) continue
      el.currentTime = 0
      void el.play().catch(() => undefined)
    }
  }, [playhead, playing, sfxEnabled, sfxManual])

  // Pausar o video cala o que estiver tocando -- senao o som continua sozinho
  // depois que a imagem parou.
  useEffect(() => {
    if (playing) return
    for (const el of elementos.current.values()) {
      el.pause()
      el.currentTime = 0
    }
  }, [playing])

  return (
    <>
      {sfxManual.map((som) =>
        som.url ? (
          <audio
            key={som.id}
            ref={(el) => {
              if (el) elementos.current.set(som.id, el)
              else elementos.current.delete(som.id)
            }}
            src={som.url}
            preload="auto"
            className="hidden"
          />
        ) : null,
      )}
    </>
  )
}

/**
 * Acima disto so um salto recupera -- travada de verdade, nao deriva.
 *
 * Fica ACIMA da tolerancia velha de 0,25s de proposito: ali ela era o unico
 * mecanismo e deixava passar tudo que fosse menor; aqui ela e a ultima linha,
 * porque a deriva pequena ja e corrigida pela velocidade.
 */
const SALTO_SEC = 0.35

/** Quanto a velocidade pode desviar de 1. Dois por cento nao se ouve numa voz. */
const DESVIO_MAX = 0.02

/**
 * A ZONA MORTA da correcao, com histerese.
 *
 * A agulha anda em quadros (1/24 s) e o audio anda continuo, entao a deriva
 * medida treme uns 40 ms o tempo todo -- e a correcao proporcional mexia na
 * velocidade a CADA quadro. Com a velocidade diferente de 1, o Chrome liga o
 * esticador de tempo (que preserva o tom), e ligado sem parar ele deixa a voz
 * chiada e com "glitch de leve". Agora a velocidade fica em 1 exato ate a
 * deriva passar de ENTRA_SEC, corrige com o desvio fixo, e volta a 1 quando
 * cai abaixo de SAI_SEC.
 */
const ENTRA_SEC = 0.06
const SAI_SEC = 0.015

/**
 * Elemento de audio cru, sincronizado com o playhead do store.
 *
 * Serve a narracao e a musica. A musica repete (`loop`) porque a faixa costuma
 * ser mais curta que o video -- o mesmo que o -stream_loop faz no render.
 */
function SyncedAudio({
  url,
  volume = 1,
  loop = false,
}: {
  url: string
  volume?: number
  loop?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playing = useTocando()
  const playhead = useProject((s) => s.playhead)
  const corrigindo = useRef(false)

  useEffect(() => {
    const element = audioRef.current
    if (!element) return
    if (playing) {
      /*
       * COMECAR TOCANDO DE ONDE A AGULHA ESTA, e nao de onde a faixa parou.
       *
       * Sem esta linha o play retomava do proprio `currentTime` do elemento,
       * que a tolerancia abaixo deixava ficar para tras -- entao a narracao
       * comecava dessincronizada e assim seguia, porque nada dentro da
       * tolerancia corrigia.
       */
      // So se estiver fora do lugar: parado (e esperando o video) a faixa ja
      // fica na agulha -- ver o efeito abaixo --, e reposicionar de novo aqui
      // atrasava o som uns 100-180ms em relacao a imagem.
      const alvo = useProject.getState().playhead
      if (!loop && Math.abs(element.currentTime - alvo) > 0.03) element.currentTime = alvo
      void element.play().catch(() => undefined)
    } else {
      element.pause()
      element.playbackRate = 1
    }
  }, [playing, loop])

  useEffect(() => {
    const element = audioRef.current
    if (!element) return
    element.volume = Math.min(Math.max(volume, 0), 1)
  }, [volume])

  /*
   * A NARRACAO PERSEGUE A AGULHA. Antes ela so era reposicionada quando passava
   * de 250ms de diferenca -- seis frames -- e dentro disso ninguem corrigia
   * nada. Era o bastante para ouvir uma palavra e ver a onda de outra, e
   * julgar corte por ouvido virava adivinhacao: "o audio no preview as vezes
   * nao bate com a waveform".
   *
   * A tolerancia existia por um motivo real: escrever `currentTime` a cada
   * frame durante a reproducao pica o som. A saida e nao usar a mesma ferramenta
   * para os dois casos.
   *
   * Com loop ligado o currentTime volta para zero sozinho a cada repeticao, e
   * comparar com o playhead traria a faixa de volta ao inicio do video --
   * entao a musica continua fora desta conta.
   */
  useEffect(() => {
    const element = audioRef.current
    if (!element || loop) return

    const deriva = element.currentTime - playhead

    /*
     * PARADO, a posicao e exata. Nao ha reproducao para picar, e e justamente
     * aqui que ele arrasta a agulha procurando a palavra -- errar por 200ms
     * neste momento e errar no unico momento que importa.
     */
    if (!playing) {
      if (Math.abs(deriva) > 0.005) element.currentTime = playhead
      return
    }

    // Saiu de vez (travou, o sistema engasgou): so um salto recupera.
    if (Math.abs(deriva) > SALTO_SEC) {
      element.currentTime = playhead
      element.playbackRate = 1
      return
    }

    /*
     * TOCANDO, a correcao e pela VELOCIDADE e nao por salto.
     *
     * Dois por cento em cima ou embaixo nao se ouve numa voz -- e um salto, em
     * compensacao, se ouve sempre. Assim a faixa volta ao lugar sozinha, sem um
     * clique no meio da narracao.
     */
    if (Math.abs(deriva) > ENTRA_SEC) corrigindo.current = true
    else if (Math.abs(deriva) < SAI_SEC) corrigindo.current = false
    const rate = corrigindo.current ? (deriva > 0 ? 1 - DESVIO_MAX : 1 + DESVIO_MAX) : 1
    if (element.playbackRate !== rate) element.playbackRate = rate
  }, [playhead, playing, loop])

  return <audio ref={audioRef} src={url} preload="auto" loop={loop} className="hidden" />
}

/**
 * Tudo que depende do PLAYHEAD, fora do componente que segura o Player.
 *
 * O Preview assinava o playhead direto, e com isso re-renderizava trinta vezes
 * por segundo -- arrastando o <Player> junto na reconciliacao a cada frame que
 * o video andava. Ele so precisava do playhead para duas coisas: mandar o
 * player pular quando a agulha e arrastada, e escolher a janela de cenas a
 * preparar. Nenhuma das duas desenha nada.
 *
 * Entao as duas moram aqui, num componente que retorna null. Ele re-renderiza
 * a cada frame como antes, mas re-renderizar nada e barato -- e o Player parou
 * de ser tocado.
 */
function Sincronia({
  player,
  plan,
  images,
}: {
  player: PlayerRef | null
  plan: ScenePlan | null
  images: readonly ImageAsset[]
}) {
  const playhead = useProject((s) => s.playhead)
  // O play APERTADO (e nao o "tocando de verdade"): e ele que manda no player.
  const playing = useProject((s) => s.playing)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const setPlaying = useProject((s) => s.setPlaying)

  /*
   * Prepara as proximas cenas -- print e clipe -- antes de elas entrarem.
   *
   * Medido: TODA <img> nasce dentro do player com complete=false. O player, ao
   * contrario do render, nao espera imagem nenhuma -- entao no primeiro frame
   * do bloco novo a imagem ainda nao pintou e o preto do fundo aparece. E o
   * piscar que so existe no preview.
   *
   * A janela e curta de proposito. Uma imagem de 1242x2208 decodificada ocupa
   * ~11MB; segurar as 46 de um projeto seriam 500MB de bitmap so para evitar um
   * frame preto. Cinco a frente cobrem qualquer corte com folga.
   */
  const decodificadas = useRef(new Map<string, HTMLImageElement | HTMLVideoElement>())
  const blocoAtual = plan
    ? Math.max(
        plan.scenes.findIndex((scene) => playhead >= scene.start && playhead < scene.end),
        0,
      )
    : 0

  useEffect(() => {
    if (!plan) return

    /*
     * O CLIPE TAMBEM PRECISA DISTO, e por muito mais tempo que o print.
     *
     * Ate aqui a janela so preparava <img>, e nos projetos feitos de clipes o
     * preto continuava aparecendo a cada troca de bloco -- um <video> que nasce
     * na hora ainda tem que baixar, abrir e procurar o quadro certo antes de
     * pintar qualquer coisa, e ate la o que se ve e o fundo.
     *
     * Um print e uma URL so; um clipe precisa tambem do instante em que o bloco
     * entra, porque e ESSE quadro que tem que estar pronto -- deixar o
     * decodificador parado no segundo zero de um clipe que comeca aos 4s nao
     * adianta nada.
     */
    /*
     * A janela do CLIPE e um pouco mais curta que a do print.
     *
     * Um print preparado custa memoria e nada mais: decodifica uma vez e fica
     * quieto. Um clipe preparado e um decodificador de video ABERTO, e muitos
     * deles disputam com o player o mesmo hardware.
     *
     * Ja esteve em dois, o que era apertado demais: junto com a cama limitada,
     * foi o que trouxe o flash de volta. A razao dada era um travamento de 24
     * quadros por segundo -- que depois se revelou a taxa CHEIA da composicao.
     * Quatro cobrem as proximas trocas com folga sem abrir meia duzia de
     * decodificadores de uma vez.
     */
    const CLIPES_A_FRENTE = 4
    const PRINTS_A_FRENTE = 6

    const janela = plan.scenes.slice(blocoAtual, blocoAtual + PRINTS_A_FRENTE).flatMap((scene, i) => {
      const asset = images[scene.imageIndex]
      if (!asset?.url) return []
      const video = asset.kind === 'video'
      if (video && i > CLIPES_A_FRENTE) return []
      return [{ url: asset.url, video, de: scene.sourceStart ?? 0 }]
    })

    const cache = decodificadas.current
    for (const item of janela) {
      if (cache.has(item.url)) continue

      if (item.video) {
        const clipe = document.createElement('video')
        clipe.preload = 'auto'
        clipe.muted = true
        clipe.src = item.url
        // Fora do DOM e mudo: ninguem ve nem ouve isto. So existe para o
        // decodificador chegar no quadro antes do bloco chegar nele.
        clipe.currentTime = item.de
        cache.set(item.url, clipe)
        continue
      }

      const img = new Image()
      img.src = item.url
      cache.set(item.url, img)
      // decode() rejeita se a imagem for trocada no meio; nao ha o que fazer
      // alem de deixar o player carregar sozinho, como fazia antes.
      void img.decode().catch(() => undefined)
    }

    // Solta o que ficou para tras: manter tudo decodificado estoura a memoria.
    const vivas = new Set(janela.map((item) => item.url))
    for (const [url, elemento] of cache) {
      if (vivas.has(url)) continue
      // O <video> nao basta soltar da lista: sem largar a fonte, o buffer dele
      // fica na memoria ate o coletor passar, e um projeto de clipes tem muitos.
      if (elemento instanceof HTMLVideoElement) {
        elemento.removeAttribute('src')
        elemento.load()
      }
      cache.delete(url)
    }
  }, [plan, images, blocoAtual])

  /*
   * O ultimo frame que o PROPRIO player anunciou.
   *
   * Os dois lados escrevem no playhead: o player avisa cada frame que passa, e
   * o store manda o player pular quando ele arrasta a agulha. Sem saber de onde
   * veio a mexida, os dois entravam em rebote -- o player emitia o frame 90, o
   * store guardava 3,0s, e o efeito abaixo comparava isso com o frame que o
   * player JA estava tocando (91 ou 92) e mandava voltar para 90. Trinta vezes
   * por segundo, e esse puxao para tras que aparece como tremor na imagem.
   *
   * Guardando o numero que o player anunciou, a volta e reconhecida e ignorada.
   * O arraste da agulha traz um numero que o player nao anunciou, entao continua
   * fazendo o player pular -- inclusive com o video tocando.
   */
  const frameDoPlayer = useRef<number | null>(null)

  // O store e a fonte da verdade do playhead; o player segue.
  useEffect(() => {
    if (!player) return
    const target = Math.round(playhead * VIDEO_FPS)
    if (frameDoPlayer.current === target) return
    if (Math.abs(player.getCurrentFrame() - target) > 1) {
      player.seekTo(target)
    }
  }, [player, playhead])

  useEffect(() => {
    if (!player) return
    if (playing) void player.play()
    else player.pause()
  }, [player, playing])

  // E o player devolve a posicao enquanto toca.
  useEffect(() => {
    if (!player) return

    const onFrame = (event: { detail: { frame: number } }): void => {
      // Anota antes de escrever no store: o efeito de sincronizacao roda logo
      // em seguida e precisa reconhecer este numero como sendo dele.
      frameDoPlayer.current = event.detail.frame
      setPlayhead(event.detail.frame / VIDEO_FPS)
    }
    const onPause = (): void => {
      useEspera.setState({ esperando: false })
      setPlaying(false)
    }
    const onEnded = (): void => {
      useEspera.setState({ esperando: false })
      setPlaying(false)
    }
    // O video pediu espera / ficou pronto: o audio para e volta junto.
    const onWaiting = (): void => useEspera.setState({ esperando: true })
    const onResume = (): void => useEspera.setState({ esperando: false })

    player.addEventListener('frameupdate', onFrame)
    player.addEventListener('pause', onPause)
    player.addEventListener('ended', onEnded)
    player.addEventListener('waiting', onWaiting)
    player.addEventListener('resume', onResume)
    return () => {
      player.removeEventListener('frameupdate', onFrame)
      player.removeEventListener('pause', onPause)
      player.removeEventListener('ended', onEnded)
      player.removeEventListener('waiting', onWaiting)
      player.removeEventListener('resume', onResume)
      useEspera.setState({ esperando: false })
    }
  }, [player, setPlayhead, setPlaying])

  return null
}

/**
 * O volume de um trecho no instante `local` (segundos desde o comeco dele): o
 * ganho em dB e as rampas de fade, o mesmo envelope do render. O <audio> nao
 * passa de 1 -- ganho positivo so se ouve no MP4.
 */
function volumeDoTrecho(
  t: { gainDb: number; fadeInSec: number; fadeOutSec: number; durationSec: number; inicioSec: number; usarSec: number | null },
  local: number,
  /** Ducking do trecho neste instante + o desconto do nivel do preview (som-do-preview.ts), em dB. */
  extraDb = 0,
): number {
  const toca = duracaoDoTrecho(t)
  const entrada = Math.min(t.fadeInSec, toca)
  const saida = Math.min(t.fadeOutSec, toca)
  let envelope = 1
  if (entrada > 0 && local < entrada) envelope = Math.max(0, local / entrada)
  if (saida > 0 && local > toca - saida) envelope = Math.min(envelope, Math.max(0, (toca - local) / saida))
  return Math.min(1, Math.max(0, 10 ** ((t.gainDb + extraDb) / 20) * envelope))
}

/**
 * As faixas de audio tocando no preview, cada trecho no instante dele.
 *
 * Diferente do SFX, que e um disparo, a musica ACOMPANHA a agulha: pular para
 * o meio de um trecho tem que tocar daquele ponto, e nao do comeco. Cada
 * trecho e um <audio> que segue o tempo do preview -- dentro do trecho ele toca
 * no ponto certo do arquivo (com os fades e o volume), fora dele fica calado.
 */
function TrilhasPreview() {
  const trilhas = useProject((s) => s.trilhas)
  const mudas = useProject((s) => s.faixasMudas.audio)
  const playing = useTocando()
  const playhead = useProject((s) => s.playhead)
  const elementos = useRef(new Map<string, HTMLAudioElement>())

  // O equilibrio do render (a narracao aqui toca crua, la vai a -14 LUFS) e o
  // mesmo envelope de ducking dele. Ver som-do-preview.ts.
  const vozPath = useProject((s) => s.audio?.path)
  const duracaoDaVoz = useProject((s) => s.audio?.durationSec)
  const words = useProject((s) => s.transcript?.words)
  const ajuste = useAjusteDasFaixas(vozPath, trilhas.map((t) => t.path))
  const ducking = useDucking(trilhas, words, duracaoDaVoz)
  const extraDb = (t: (typeof trilhas)[number], local: number): number => ajuste(t.path) + ducking(t.ducking, t.at + local)

  /*
   * QUEM TOCA E QUANDO segue a agulha; o volume segue o relogio do audio.
   *
   * "Em alguns momentos o audio fica meio chiado, ou da uns glitch de leve."
   * Eram duas coisas: o volume era escrito por dois lados -- pela agulha e por
   * um relogio -- com valores um pouco diferentes durante o fade, e o volume
   * ficava pulando entre eles (o chiado). E qualquer descompasso acima de
   * 0,3 s virava um SALTO no audio (o glitch). Agora so o relogio escreve o
   * volume, e descompasso pequeno se corrige acelerando ou freando o audio uns
   * 4% -- inaudivel --, deixando o salto para quando o player realmente trava.
   */
  useEffect(() => {
    for (const t of trilhas) {
      const el = elementos.current.get(t.id)
      if (!el) continue
      const toca = duracaoDoTrecho(t)
      const dentro = playhead >= t.at && playhead < t.at + toca
      if (!playing || !dentro || mudas.includes(t.faixa)) {
        if (!el.paused) el.pause()
        el.playbackRate = 1
        continue
      }
      const alvo = t.inicioSec + (playhead - t.at)
      if (el.paused) {
        el.currentTime = alvo
        el.playbackRate = 1
        el.volume = volumeDoTrecho(t, playhead - t.at, extraDb(t, playhead - t.at))
        void el.play().catch(() => undefined)
        continue
      }
      const atraso = el.currentTime - alvo
      if (Math.abs(atraso) > 0.5) {
        el.currentTime = alvo
        el.playbackRate = 1
      } else if (Math.abs(atraso) > ENTRA_SEC) {
        // Mesma zona morta da narracao: velocidade em 1 exato quase sempre.
        const rate = atraso > 0 ? 0.97 : 1.03
        if (el.playbackRate !== rate) el.playbackRate = rate
      } else if (Math.abs(atraso) < SAI_SEC && el.playbackRate !== 1) {
        el.playbackRate = 1
      }
    }
  }, [trilhas, playing, playhead, mudas, ajuste, ducking])

  /*
   * O VOLUME, pelo tempo do proprio <audio>, a cada 40 ms. Tocando do frame 0,
   * o fade de entrada comeca em 0 e a agulha demora a andar enquanto o player
   * carrega -- seguindo a agulha, o som ficava mudo.
   */
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      for (const t of trilhas) {
        const el = elementos.current.get(t.id)
        if (!el || el.paused || mudas.includes(t.faixa)) continue
        const local = el.currentTime - t.inicioSec
        const v = volumeDoTrecho(t, local, extraDb(t, local))
        // Escrever o mesmo valor de novo nao custa, mas escrever um quase igual
        // a cada 40 ms e o que fazia o volume tremer. A folga e RELATIVA (1%,
        // ~0,1 dB): com o desconto do nivel a musica toca perto de 0,03, e a
        // folga fixa de 0,003 la era 1 dB de degrau numa rampa.
        if (Math.abs(el.volume - v) > Math.max(v * 0.01, 0.0002)) el.volume = v
      }
    }, 40)
    return () => window.clearInterval(id)
  }, [playing, trilhas, mudas, ajuste, ducking])

  return (
    <>
      {trilhas.map((t) =>
        t.url ? (
          <audio
            key={t.id}
            ref={(el) => {
              if (el) elementos.current.set(t.id, el)
              else elementos.current.delete(t.id)
            }}
            src={t.url}
            preload="auto"
            className="hidden"
          />
        ) : null,
      )}
    </>
  )
}
