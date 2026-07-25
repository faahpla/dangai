import { Fragment, useEffect, useState } from 'react'
import { AbsoluteFill, cancelRender, continueRender, delayRender } from 'remotion'
import { TransitionSeries } from '@remotion/transitions'
import type { RenderProps } from '@shared/contract'
import { Scene } from './Scene'
import { Captions } from './Captions'
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

export function Video({ scenes, captions }: RenderProps) {
  const fontsReady = useFontsReady(captions.length > 0)

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
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

      {fontsReady && captions.length > 0 && <Captions blocks={captions} />}
    </AbsoluteFill>
  )
}
