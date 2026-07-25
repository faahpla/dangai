import { AbsoluteFill, Sequence } from 'remotion'
import type { RenderProps } from '@shared/contract'
import { Scene } from './Scene'

/**
 * A composicao inteira: 1080x1920 @30fps.
 *
 * Sem audio aqui de proposito. O Remotion entrega video puro e o FFmpeg cuida
 * da narracao, dos SFX e do loudnorm -- e onde o loudnorm de duas passadas
 * precisa viver de qualquer jeito, e evita decodificar audio dentro do Chrome.
 *
 * Na v0.2 toda transicao e corte seco; crossfade, slide e whip-pan entram na
 * v0.4 e so mexem neste arquivo.
 */
export function Video({ scenes }: RenderProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {scenes.map((scene, index) => (
        <Sequence
          key={`${scene.url}-${scene.from}-${index}`}
          from={scene.from}
          durationInFrames={scene.durationInFrames}
        >
          <Scene {...scene} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
