import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame } from 'remotion'
import type { OverlayCard } from '@shared/contract'
import { CAPTION_FONT_STACK } from './fonts'

/**
 * Gancho e card de final: texto grande por cima da imagem.
 *
 * Sobreposicao, nunca trecho extra -- ver o comentario de overlayCardSchema. O
 * video continua com a duracao exata da narracao.
 *
 * O gancho fica no alto porque a legenda mora embaixo; os dois no mesmo lugar
 * se atropelariam justo nos segundos que decidem se a pessoa continua vendo.
 */

const ACCENT = '#FF3D81'

/** Corpo maior que o da legenda: e o texto que tem que parar o dedo. */
const FONT_SIZE = 92

/** Acima disso a frase quebra em linhas demais e deixa de ser lida de relance. */
const CHARS_PER_LINE = 14

/** Entrada e saida. Curtas: o card tem poucos segundos para existir. */
const FADE_FRAMES = 6

export function Cards({ cards }: { cards: readonly OverlayCard[] }) {
  return (
    <>
      {cards.map((card, index) => (
        <Sequence
          key={`${card.from}-${index}`}
          from={card.from}
          durationInFrames={card.durationInFrames}
          layout="none"
        >
          <Card card={card} />
        </Sequence>
      ))}
    </>
  )
}

function Card({ card }: { card: OverlayCard }) {
  const frame = useCurrentFrame()

  // Entra e sai por opacidade. Sem escala: um texto que cresce por cima da
  // imagem rouba a atencao do corte que esta acontecendo atras dele.
  const opacity = interpolate(
    frame,
    [0, FADE_FRAMES, card.durationInFrames - FADE_FRAMES, card.durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) },
  )

  // Frase comprida encolhe para caber inteira, como a legenda faz.
  const linhas = Math.max(Math.ceil(card.text.length / CHARS_PER_LINE), 1)
  const fontSize = FONT_SIZE * Math.min(1, 3 / linhas)

  return (
    <AbsoluteFill
      style={{
        opacity,
        justifyContent: card.position === 'top' ? 'flex-start' : 'center',
        alignItems: 'center',
        paddingTop: card.position === 'top' ? 300 : 0,
        paddingLeft: 70,
        paddingRight: 70,
      }}
    >
      <span
        style={{
          fontFamily: CAPTION_FONT_STACK,
          fontWeight: 400,
          fontSize,
          lineHeight: 1.08,
          textAlign: 'center',
          textTransform: 'uppercase',
          color: '#FFFFFF',
          WebkitTextStroke: '7px #000',
          paintOrder: 'stroke fill',
          // Uma sombra rosa curta destaca do fundo sem virar outra cor no video.
          textShadow: `0 0 28px ${ACCENT}66`,
        }}
      >
        {card.text}
      </span>
    </AbsoluteFill>
  )
}
