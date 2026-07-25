import { Fragment } from 'react'
import { AbsoluteFill } from 'remotion'
import { TransitionSeries } from '@remotion/transitions'
import type { RenderProps } from '@shared/contract'
import { Scene } from './Scene'
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
export function Video({ scenes }: RenderProps) {
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
    </AbsoluteFill>
  )
}
