import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import {
  activeWordIndex,
  CAPTION_CHARS_PER_LINE,
  CAPTION_COLOR_HEX,
  VIDEO_HEIGHT,
  type CaptionBlock,
  type CaptionColor,
} from '@shared/contract'
import { CAPTION_FONT_STACK } from './fonts'

/**
 * Legendas queimadas no estilo de short: 2 a 4 palavras por vez, centro-inferior,
 * fonte pesada, contorno preto grosso e a palavra sendo dita colorida.
 *
 * O contorno usa -webkit-text-stroke com paint-order: stroke fill. Sem o
 * paint-order o contorno e desenhado por cima da letra e come metade da
 * espessura do traco, deixando o texto magro e sujo.
 */

/** Corpo padrao da legenda. */
const FONT_SIZE = 68

export function Captions({
  blocks,
  color,
  y,
}: {
  blocks: readonly CaptionBlock[]
  color: CaptionColor
  /** Altura na tela, fracao a partir do rodape. */
  y: number
}) {
  return (
    <>
      {blocks.map((block, index) => (
        <Sequence
          key={`${block.from}-${index}`}
          from={block.from}
          durationInFrames={block.durationInFrames}
          layout="none"
        >
          <Block block={block} color={color} y={y} />
        </Sequence>
      ))}
    </>
  )
}

function Block({
  block,
  color,
  y,
}: {
  block: CaptionBlock
  color: CaptionColor
  y: number
}) {
  // useCurrentFrame dentro da Sequence e relativo a ela; as palavras carregam
  // frames absolutos, entao a comparacao volta para a base absoluta.
  const frame = useCurrentFrame() + block.from

  // Palavra comprida demais encolhe o suficiente para caber inteira, em vez de
  // sair pelos dois lados da tela.
  const chars = block.words.map((word) => word.text).join(' ').length
  const fontSize = FONT_SIZE * Math.min(1, CAPTION_CHARS_PER_LINE / chars)

  const marcada = activeWordIndex(block, frame)

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        // Distancia do rodape. O padrao mantem os 420px de sempre; ver
        // CAPTION_Y_DEFAULT para por que 420 e nao qualquer outro numero.
        paddingBottom: y * VIDEO_HEIGHT,
        paddingLeft: 80,
        paddingRight: 80,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '0 18px',
          fontFamily: CAPTION_FONT_STACK,
          // Komika Axis tem um peso so. Pedir 800 faria o Chrome engrossar a
          // letra na marra, e o falso negrito briga com o contorno de 6px.
          fontWeight: 400,
          fontSize,
          lineHeight: 1.15,
          textAlign: 'center',
          textTransform: 'uppercase',
          WebkitTextStroke: '6px #000',
          paintOrder: 'stroke fill',
        }}
      >
        {block.words.map((word, index) => (
          <span
            key={`${word.text}-${index}`}
            style={{ color: index === marcada ? CAPTION_COLOR_HEX[color] : '#FFFFFF' }}
          >
            {word.text}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  )
}
