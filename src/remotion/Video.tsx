import { Fragment, useEffect, useState } from 'react'
import {
  AbsoluteFill,
  cancelRender,
  continueRender,
  delayRender,
  getRemotionEnvironment,
  useCurrentFrame,
} from 'remotion'
import { TransitionSeries } from '@remotion/transitions'
import type { RenderProps } from '@shared/contract'
import { Scene } from './Scene'
import { Captions } from './Captions'
import { Cards } from './Card'
import { presentationFor, timingFor } from './Transition'

/**
 * A composicao inteira: 1080x1920 @30fps.
 *
 * Sem audio aqui de proposito. O Remotion entrega video puro e o FFmpeg cuida
 * da narracao, dos SFX e do loudnorm -- e onde o loudnorm de duas passadas
 * precisa viver de qualquer jeito, e evita decodificar audio dentro do Chrome.
 *
 * As duracoes que chegam ja incluem a folga da sobreposicao das transicoes
 * (ver toRenderProps): somadas e descontadas as sobreposicoes, o total bate
 * exatamente com a duracao da narracao.
 */
/**
 * Segura o render ate a fonte das legendas estar pronta.
 *
 * Sem isso o Chrome desenha o primeiro frame com a fonte de fallback e o video
 * sai com legenda em outra tipografia -- um erro que so aparece no arquivo
 * final, nunca no preview, porque no preview a fonte ja carregou faz tempo.
 */
function useFontsReady(enabled: boolean): boolean {
  const [ready, setReady] = useState(!enabled)

  useEffect(() => {
    if (!enabled) return
    const handle = delayRender('carregando a fonte das legendas')
    document.fonts
      .ready.then(() => {
        setReady(true)
        continueRender(handle)
      })
      .catch((err: unknown) => {
        cancelRender(err instanceof Error ? err : new Error(String(err)))
      })
  }, [enabled])

  return ready
}

export function Video({
  scenes,
  captions,
  cards,
  captionColor,
  captionY,
  captionFont,
  captionAnimation,
  captionAnimationFrames,
  captionMark,
  captionShadow,
  captionStroke,
  captionScale,
}: RenderProps) {
  // Gancho e legenda usam a mesma fonte, entao qualquer um dos dois obriga a
  // esperar por ela -- senao o card sai no fallback e so aparece no MP4.
  const fontsReady = useFontsReady(captions.length > 0 || cards.length > 0)

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/*
        A CAMA DO PREVIEW, por baixo de tudo e SEMPRE montada.

        Ela ja viveu dentro da Scene, e ali nao funcionava tocando -- so
        parado. Arrastando a agulha o player renderiza um quadro e espera, e
        tudo tem tempo de pintar; no play ele avanca 24 quadros por segundo, e
        no quadro em que o bloco entra o React MONTA a cena inteira. Uma <img>
        recem-criada nao pinta em 41ms nem com o arquivo em cache, entao o
        preto de tras aparecia mesmo com a cama existindo.

        Aqui ela nunca e montada na hora: e um elemento so, vivo do inicio ao
        fim do video, que apenas TROCA de src. E isso muda tudo -- ao trocar a
        fonte de uma imagem que ja esta na tela, o navegador segura o quadro
        anterior ate o novo decodificar. Nao ha buraco para o preto aparecer.
      */}
      <CamaDoPreview scenes={scenes} />

      <TransitionSeries>
        {scenes.map((scene, index) => (
          <Fragment key={`${scene.url}-${index}`}>
            {scene.transitionInFrames > 0 && (
              <TransitionSeries.Transition
                presentation={presentationFor(scene.transitionIn)}
                timing={timingFor(scene.transitionIn, scene.transitionInFrames)}
              />
            )}
            <TransitionSeries.Sequence durationInFrames={scene.durationInFrames}>
              <Scene {...scene} />
            </TransitionSeries.Sequence>
          </Fragment>
        ))}
      </TransitionSeries>

      {fontsReady && captions.length > 0 && (
        <Captions
          blocks={captions}
          color={captionColor}
          y={captionY}
          font={captionFont}
          animation={captionAnimation}
          animationFrames={captionAnimationFrames}
          mark={captionMark}
          shadow={captionShadow}
          stroke={captionStroke}
          scale={captionScale}
        />
      )}
      {fontsReady && cards.length > 0 && <Cards cards={cards} />}
    </AbsoluteFill>
  )
}

/**
 * A miniatura do bloco atual, viva o video inteiro, so trocando de src.
 *
 * Existe para o preview e mais nada: no render o frame vem pronto do
 * compositor, e nao ha instante nenhum em que o quadro esteja vazio.
 *
 * Qual bloco esta no ar se descobre somando as duracoes e descontando as
 * transicoes -- numa TransitionSeries a emenda SOBREPOE os dois vizinhos, e
 * ignorar isso faria a cama atrasar um pouco mais a cada transicao do video.
 * O desconto mantem a conta alinhada do primeiro ao ultimo bloco.
 */
function CamaDoPreview({ scenes }: { scenes: RenderProps['scenes'] }) {
  const frame = useCurrentFrame()

  if (getRemotionEnvironment().isRendering) return null

  let inicio = 0
  let atual: RenderProps['scenes'][number] | undefined
  for (const scene of scenes) {
    inicio -= scene.transitionInFrames
    if (frame < inicio + scene.durationInFrames) {
      atual = scene
      break
    }
    inicio += scene.durationInFrames
  }

  const thumb = atual?.thumbnail
  if (!thumb) return null

  /*
   * <img> cru, e nao o <Img> do Remotion: o que se quer aqui e justamente o
   * comportamento nativo de segurar o quadro antigo enquanto o novo carrega.
   * O <Img> do Remotion existe para GARANTIR que a imagem esteja pronta antes
   * de desenhar, que e o oposto -- e no player ele nao espera de qualquer
   * forma.
   */
  return (
    <img
      src={thumb}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
      }}
    />
  )
}
