import { AbsoluteFill, Easing, Img, interpolate, useCurrentFrame } from 'remotion'
import type { RenderProps } from '@shared/contract'

type SceneProps = RenderProps['scenes'][number]

/**
 * Uma cena: a imagem cobrindo a tela inteira com Ken Burns.
 *
 * Regras que nao mudam: escala nunca passa de 1.15 (acima disso fica tosco), a
 * imagem sempre cobre os 1080x1920 (objectFit cover), e nunca aparece barra
 * preta -- por isso o pan parte de uma escala ja ampliada, senao a borda entra
 * no quadro quando a imagem desliza.
 */
export function Scene({ url, durationInFrames, effect, intensity, curve }: SceneProps) {
  const frame = useCurrentFrame()

  const eased = interpolate(frame, [0, Math.max(durationInFrames - 1, 1)], [0, 1], {
    easing: easingFor(curve),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const { scale, x, y } = motionFor(effect, intensity, eased)

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', overflow: 'hidden' }}>
      <Img
        src={url}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${x}%, ${y}%)`,
          // A transformacao parte do centro para o zoom nao puxar para um canto.
          transformOrigin: 'center center',
        }}
      />
    </AbsoluteFill>
  )
}

/**
 * A curva escolhida, na forma que o interpolate espera.
 *
 * Cubica em todas para as quatro serem comparaveis entre si: trocar a curva tem
 * que mudar so o ritmo, nao a "quantidade" de movimento. Nenhuma delas passa de
 * 0..1 -- curva com overshoot empurraria o pan alem da folga de borda que o
 * motionFor reserva, e a tarja preta entraria no quadro.
 */
function easingFor(curve: SceneProps['curve']): ((t: number) => number) | undefined {
  switch (curve) {
    case 'ease-in-out':
      return Easing.inOut(Easing.cubic)
    case 'ease-out':
      return Easing.out(Easing.cubic)
    case 'ease-in':
      return Easing.in(Easing.cubic)
    case 'linear':
      // Sem easing: o interpolate ja e linear por natureza.
      return undefined
  }
}

interface Motion {
  scale: number
  x: number
  y: number
}

function motionFor(effect: SceneProps['effect'], intensity: number, t: number): Motion {
  // Deslocamento em % da propria imagem. A margem que a escala extra cria e
  // (scale-1)/2 de cada lado; ficar abaixo disso garante que a borda nao entra.
  const travel = (intensity / 2) * 100 * 0.8

  switch (effect) {
    case 'zoom-in':
      return { scale: 1 + intensity * t, x: 0, y: 0 }
    case 'zoom-out':
      return { scale: 1 + intensity * (1 - t), x: 0, y: 0 }
    case 'pan-left':
      return { scale: 1 + intensity, x: -travel + travel * 2 * (1 - t), y: 0 }
    case 'pan-right':
      return { scale: 1 + intensity, x: travel - travel * 2 * (1 - t), y: 0 }
    case 'pan-up':
      return { scale: 1 + intensity, x: 0, y: -travel + travel * 2 * (1 - t) }
    case 'pan-down':
      return { scale: 1 + intensity, x: 0, y: travel - travel * 2 * (1 - t) }
  }
}
