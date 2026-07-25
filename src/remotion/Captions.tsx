import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import type { CaptionBlock } from '@shared/contract'
import { CAPTION_FONT_STACK } from './fonts'

/**
 * Legendas queimadas no estilo de short: 2 a 4 palavras por vez, centro-inferior,
 * fonte pesada, contorno preto grosso e a palavra que esta sendo dita em rosa.
 *
 * O contorno usa -webkit-text-stroke com paint-order: stroke fill. Sem o
 * paint-order o contorno e desenhado por cima da letra e come metade da
 * espessura do traco, deixando o texto magro e sujo.
 */

const ACCENT = '#FF3D81'

/** Corpo padrao da legenda. */
const FONT_SIZE = 68

/**
 * Quantos caracteres cabem numa linha nesse corpo.
 *
 * Medido no render de verdade: a Komika Axis a 68px gasta ate ~46px por letra
 * em palavra portuguesa, e sobram 920px entre as margens. Acima disso a linha
 * passa da borda e as pontas somem da tela.
 *
 * Pela regra de montagem, uma linha so passa daqui quando e uma palavra unica
 * comprida demais para o limite -- a excecao que existe justamente porque
 * quebrar palavra no meio seria pior.
 */
const CHARS_PER_LINE = 18

export function Captions({ blocks }: { blocks: readonly CaptionBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => (
        <Sequence
          key={`${block.from}-${index}`}
          from={block.from}
          durationInFrames={block.durationInFrames}
          layout="none"
        >
          <Block block={block} />
        </Sequence>
      ))}
    </>
  )
}

function Block({ block }: { block: CaptionBlock }) {
  // useCurrentFrame dentro da Sequence e relativo a ela; as palavras carregam
  // frames absolutos, entao a comparacao volta para a base absoluta.
  const frame = useCurrentFrame() + block.from

  // Palavra comprida demais encolhe o suficiente para caber inteira, em vez de
  // sair pelos dois lados da tela.
  const chars = block.words.map((word) => word.text).join(' ').length
  const fontSize = FONT_SIZE * Math.min(1, CHARS_PER_LINE / chars)

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        // Um pouco acima da borda: no TikTok e no Reels a faixa de baixo fica
        // coberta pela interface do proprio app.
        paddingBottom: 420,
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
        {block.words.map((word, index) => {
          const active = frame >= word.from && frame < word.from + word.durationInFrames
          return (
            <span
              key={`${word.text}-${index}`}
              style={{ color: active ? ACCENT : '#FFFFFF' }}
            >
              {word.text}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
