import { Composition } from 'remotion'
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH, type RenderProps } from '@shared/contract'
import { Video } from './Video'

export const COMPOSITION_ID = 'dangai'

/**
 * Duracao e cenas chegam por inputProps no momento do render; os valores aqui
 * sao so o que o Remotion Studio precisa para abrir sem props.
 */
const FALLBACK_PROPS: RenderProps = { scenes: [], captions: [] }

export function RemotionRoot() {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={Video}
      durationInFrames={VIDEO_FPS * 10}
      fps={VIDEO_FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      defaultProps={FALLBACK_PROPS}
      // O render passa a duracao real via calculateMetadata do lado do main.
    />
  )
}
