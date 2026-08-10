import { useEffect, useMemo, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from '@shared/contract'
import { toRenderProps } from '@shared/plan'
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
  const playhead = useProject((s) => s.playhead)
  const playing = useProject((s) => s.playing)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const setPlaying = useProject((s) => s.setPlaying)
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
  const captionY = useProject((s) => s.captionY)

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
          )
        : { scenes: [], captions: [], cards: [], captionColor, captionY },
    [
      plan,
      images,
      audio,
      captions,
      captionsEnabled,
      captionColor,
      captionY,
      hookText,
      hookSec,
      endText,
      endSec,
    ],
  )

  /*
   * Decodifica as proximas imagens antes de elas entrarem em cena.
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
  const decodificadas = useRef(new Map<string, HTMLImageElement>())
  const blocoAtual = plan
    ? Math.max(
        plan.scenes.findIndex((scene) => playhead >= scene.start && playhead < scene.end),
        0,
      )
    : 0

  useEffect(() => {
    if (!plan) return

    const janela = plan.scenes
      .slice(blocoAtual, blocoAtual + 6)
      .map((scene) => images[scene.imageIndex]?.url)
      .filter((url): url is string => Boolean(url))

    const cache = decodificadas.current
    for (const url of janela) {
      if (cache.has(url)) continue
      const img = new Image()
      img.src = url
      cache.set(url, img)
      // decode() rejeita se a imagem for trocada no meio; nao ha o que fazer
      // alem de deixar o player carregar sozinho, como fazia antes.
      void img.decode().catch(() => undefined)
    }

    // Solta o que ficou para tras: manter tudo decodificado estoura a memoria.
    const vivas = new Set(janela)
    for (const url of cache.keys()) {
      if (!vivas.has(url)) cache.delete(url)
    }
  }, [plan, images, blocoAtual])

  // O store e a fonte da verdade do playhead; o player segue.
  useEffect(() => {
    if (!player) return
    const target = Math.round(playhead * VIDEO_FPS)
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
