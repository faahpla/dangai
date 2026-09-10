import { useEffect, useMemo, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { familiaDaFonte, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from '@shared/contract'
import { toRenderProps } from '@shared/plan'
import type { ImageAsset, ScenePlan } from '@shared/contract'
import { sfxParaDisparar } from '@shared/sfx'
import { useProject } from '@/store/project'
import { Video } from '@/remotion/Video'

/**
 * Preview 9:16 com o @remotion/player -- o MESMO componente Video que o render
 * usa. E o motivo de ter escolhido Remotion: o que aparece aqui e o que sai no
 * MP4, sem uma simulacao paralela para manter em dia.
 *
 * O plano vem de shared/plan, tambem o mesmo que o main usa no render.
 */
export function Preview() {
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
  const captionMark = useProject((s) => s.captionMark)
  const captionShadow = useProject((s) => s.captionShadow)
  const captionStroke = useProject((s) => s.captionStroke)
  const captionY = useProject((s) => s.captionY)
  const captionScale = useProject((s) => s.captionScale)

  const hookText = useProject((s) => s.hookText)
  const hookSec = useProject((s) => s.hookSec)
  const endText = useProject((s) => s.endText)
  const endSec = useProject((s) => s.endSec)

  const inputProps = useMemo(
    () =>
      plan && images.length > 0
        ? toRenderProps(
            plan,
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
              mark: captionMark,
              shadow: captionShadow,
              stroke: captionStroke,
              scale: captionScale,
            },
          )
        : {
            scenes: [],
            captions: [],
            cards: [],
            captionColor,
            captionY,
            captionFont: null,
            captionAnimation,
            captionAnimationFrames,
            captionMark,
            captionShadow,
            captionStroke,
            captionScale,
          },
    [
      plan,
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
      captionMark,
      captionShadow,
      captionStroke,
      captionScale,
      hookText,
      hookSec,
      endText,
      endSec,
    ],
  )


  return (
    <div className="relative aspect-[9/16] h-full shrink-0 overflow-hidden rounded-md border border-line bg-surface">
      {images.length > 0 && audio ? (
        <>
          <Player
            ref={setPlayer}
            component={Video}
            inputProps={inputProps}
            durationInFrames={durationInFrames}
            fps={VIDEO_FPS}
            compositionWidth={VIDEO_WIDTH}
            compositionHeight={VIDEO_HEIGHT}
            style={{ width: '100%', height: '100%' }}
            // Sem controles proprios: a timeline do app e o unico transporte.
            controls={false}
            clickToPlay={false}
            doubleClickToFullscreen={false}
            acknowledgeRemotionLicense
          />
          {/*
            A narracao toca por fora da composicao porque o Remotion entrega
            video puro e o audio so entra no mux -- ver Video.tsx.
          */}
          <SyncedAudio url={audio.url} />
          {music && <SyncedAudio url={music.url} volume={musicVolume} loop />}
          <SfxPreview />
          <Sincronia player={player} plan={plan} images={images} />
        </>
      ) : (
        <div className="grid h-full place-items-center px-6 text-center text-[11px] text-ink-3">
          {images.length === 0 ? 'Solte imagens para ver o preview' : 'Solte a narracao'}
        </div>
      )}

      <span className="tnum pointer-events-none absolute bottom-2 right-2 rounded-[6px] bg-black/60 px-1.5 py-0.5 text-[10px] text-white/70">
        {VIDEO_WIDTH} x {VIDEO_HEIGHT}
      </span>
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
  const playing = useProject((s) => s.playing)
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
  const playing = useProject((s) => s.playing)
  const playhead = useProject((s) => s.playhead)

  useEffect(() => {
    const element = audioRef.current
    if (!element) return
    if (playing) void element.play().catch(() => undefined)
    else element.pause()
  }, [playing])

  useEffect(() => {
    const element = audioRef.current
    if (!element) return
    element.volume = Math.min(Math.max(volume, 0), 1)
  }, [volume])

  useEffect(() => {
    const element = audioRef.current
    if (!element) return
    // Só corrige quando saiu de sincronia de verdade, senao o proprio play
    // dispara reposicionamento a cada frame.
    //
    // Com loop ligado o currentTime volta para zero sozinho a cada repeticao, e
    // comparar com o playhead traria a faixa de volta ao inicio do video --
    // entao a musica so e posicionada quando nao repete.
    if (loop) return
    if (Math.abs(element.currentTime - playhead) > 0.25) {
      element.currentTime = playhead
    }
  }, [playhead, loop])

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
     * A janela do CLIPE e curta, e a do print continua longa.
     *
     * Um print preparado custa memoria e nada mais: ele decodifica uma vez e
     * fica quieto. Um clipe preparado e um decodificador de video ABERTO --
     * seis deles rodando ao mesmo tempo disputam com o player o mesmo hardware
     * que esta tentando tocar o preview, e a cura fica pior que a doenca num
     * projeto que e feito de clipes do comeco ao fim.
     *
     * Dois a frente cobrem a proxima troca, que e o unico momento em que o
     * preto apareceria.
     */
    const CLIPES_A_FRENTE = 2
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
    const onPause = (): void => setPlaying(false)
    const onEnded = (): void => setPlaying(false)

    player.addEventListener('frameupdate', onFrame)
    player.addEventListener('pause', onPause)
    player.addEventListener('ended', onEnded)
    return () => {
      player.removeEventListener('frameupdate', onFrame)
      player.removeEventListener('pause', onPause)
      player.removeEventListener('ended', onEnded)
    }
  }, [player, setPlayhead, setPlaying])

  return null
}
