import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import type { CaptionBlock } from '@shared/contract'

/**
 * Legendas queimadas no estilo de short: 2 a 4 palavras por vez, centro-inferior,
 * fonte pesada, contorno preto grosso e a palavra que esta sendo dita em rosa.
 *
 * O contorno usa -webkit-text-stroke com paint-order: stroke fill. Sem o
 * paint-order o contorno e desenhado por cima da letra e come metade da
 * espessura do traco, deixando o texto magro e sujo.
 */

const ACCENT = '#FF3D81'

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
          fontFamily: '"Inter Variable", Inter, system-ui, sans-serif',
          fontWeight: 800,
          fontSize: 76,
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
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
