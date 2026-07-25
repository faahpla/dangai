import type { FC } from 'react'
import { AbsoluteFill } from 'remotion'
import {
  linearTiming,
  type TransitionPresentation,
  type TransitionPresentationComponentProps,
} from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { slide } from '@remotion/transitions/slide'
import type { Transition } from '@shared/contract'

/**
 * As transicoes disponiveis, mapeadas para o que o TransitionSeries consome.
 *
 * `cut` nao aparece aqui: corte seco e a ausencia de transicao, e e o que mais
 * funciona em short. Os outros existem para quebrar a monotonia, nao para
 * serem o padrao.
 */

/**
 * Direcao opcional: sem campo obrigatorio, o tipo continua compativel com a
 * forma apagada usada em presentationFor.
 */
interface WhipPanProps extends Record<string, unknown> {
  direction?: 'left' | 'right'
}

/**
 * Whip-pan: a camera "chicoteia" para o lado com borrao de movimento.
 *
 * Nao vem pronto no @remotion/transitions, entao e uma presentation propria.
 * O borrao segue um seno sobre o progresso -- zero nas pontas, maximo no meio.
 * Sem isso o efeito parece so um slide rapido; e o borrao que vende o
 * movimento de camera.
 */
const WhipPanPresentation: FC<TransitionPresentationComponentProps<WhipPanProps>> = ({
  presentationProgress,
  presentationDirection,
  passedProps,
  children,
}) => {
  const sign = passedProps.direction === 'right' ? 1 : -1

  // Entrando: chega da borda ate o centro. Saindo: parte do centro para a
  // borda oposta. As duas se movem juntas, no mesmo sentido.
  const offset =
    presentationDirection === 'entering'
      ? sign * (1 - presentationProgress) * 100
      : -sign * presentationProgress * 100

  const blur = Math.sin(presentationProgress * Math.PI) * 16

  return (
    <AbsoluteFill
      style={{
        transform: `translateX(${offset}%)`,
        filter: `blur(${blur}px)`,
        /*
         * Sem cor de fundo aqui, por mais tentador que seja para esconder o
         * halo do blur.
         *
         * Uma cena que entra por uma transicao e sai por outra recebe as DUAS
         * presentations aninhadas. Um fundo opaco nesta camada fica por cima da
         * cena anterior e engole a transicao de entrada: um crossfade seguido de
         * whip-pan virava fade-para-preto em vez de mistura. Presentation nunca
         * pode ser opaca quando nao e ela que esta cobrindo.
         */
      }}
    >
      {children}
    </AbsoluteFill>
  )
}

function whipPan(props: WhipPanProps): TransitionPresentation<WhipPanProps> {
  return { component: WhipPanPresentation, props }
}

/**
 * Cada presentation e generica sobre as proprias props, entao um switch que
 * devolve varias delas produz uma uniao que o TypeScript nao unifica. As props
 * sao internas a cada presentation -- quem consome so repassa -- entao apagar o
 * parametro aqui e seguro e mantem a chamada legivel.
 */
type OpaquePresentation = TransitionPresentation<Record<string, unknown>>

export function presentationFor(transition: Transition): OpaquePresentation {
  switch (transition) {
    case 'crossfade':
      return fade() as OpaquePresentation
    case 'slide-left':
      return slide({ direction: 'from-right' }) as OpaquePresentation
    case 'slide-right':
      return slide({ direction: 'from-left' }) as OpaquePresentation
    case 'whip-pan':
      return whipPan({ direction: 'left' }) as OpaquePresentation
    case 'cut':
      return fade() as OpaquePresentation
  }
}

/**
 * Tudo linear.
 *
 * Tentei mola no whip-pan para dar aceleracao de chicote, mas com damping alto
 * o progresso salta para perto de 1 nos primeiros frames -- e o borrao, que
 * segue um seno sobre o progresso, passava tao rapido que sumia. Numa
 * transicao de 4 frames o que vende o movimento e o borrao, nao a curva.
 */
export function timingFor(_transition: Transition, durationInFrames: number) {
  return linearTiming({ durationInFrames })
}
