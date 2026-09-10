import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import {
  activeWordIndex,
  CAPTION_CHARS_PER_LINE,
  CAPTION_COLOR_HEX,
  VIDEO_HEIGHT,
  type CaptionAnimation,
  type CaptionBlock,
  type CaptionColor,
  type CaptionMark,
  type CaptionShadow,
  sombraCss,
} from '@shared/contract'
import { carregarFonte, CAPTION_FONT_STACK } from './fonts'

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
  font,
  animation,
  animationFrames,
  mark,
  shadow,
  stroke,
  scale,
}: {
  blocks: readonly CaptionBlock[]
  color: CaptionColor
  /** Altura na tela, fracao a partir do rodape. */
  y: number
  /** A fonte que ele escolheu, ou null para a embutida. */
  font: { family: string; url: string } | null
  animation: CaptionAnimation
  animationFrames: number
  mark: CaptionMark
  shadow: CaptionShadow
  stroke: number
  scale: number
}) {
  // Pedir a fonte aqui, e nao dentro do bloco: sao dezenas de blocos por video,
  // e cada um pediria o mesmo arquivo.
  if (font) carregarFonte(font.family, font.url)

  const stack = font ? `"${font.family}", ${CAPTION_FONT_STACK}` : CAPTION_FONT_STACK

  return (
    <>
      {blocks.map((block, index) => (
        <Sequence
          key={`${block.from}-${index}`}
          from={block.from}
          durationInFrames={block.durationInFrames}
          layout="none"
        >
          <Block
            block={block}
            color={color}
            y={y}
            stack={stack}
            animation={animation}
            animationFrames={animationFrames}
            mark={mark}
            shadow={shadow}
            stroke={stroke}
            scale={scale}
          />
        </Sequence>
      ))}
    </>
  )
}

function Block({
  block,
  color,
  y,
  stack,
  animation,
  animationFrames,
  mark,
  shadow,
  stroke,
  scale,
}: {
  block: CaptionBlock
  color: CaptionColor
  y: number
  stack: string
  animation: CaptionAnimation
  animationFrames: number
  mark: CaptionMark
  shadow: CaptionShadow
  stroke: number
  scale: number
}) {
  const { fps } = useVideoConfig()
  // useCurrentFrame dentro da Sequence e relativo a ela; as palavras carregam
  // frames absolutos, entao a comparacao volta para a base absoluta.
  const frame = useCurrentFrame() + block.from

  // Palavra comprida demais encolhe o suficiente para caber inteira, em vez de
  // sair pelos dois lados da tela.
  const chars = block.words.map((word) => word.text).join(' ').length
  // O tamanho que ele escolheu so vale enquanto a linha couber: passando da
  // largura, quem manda continua sendo o ajuste automatico. Por isso os dois
  // disputam no mesmo Math.min, em vez de um multiplicar o outro.
  const fontSize = FONT_SIZE * Math.min(scale, CAPTION_CHARS_PER_LINE / chars)

  const marcada = activeWordIndex(block, frame)

  /*
   * A entrada elastica: a legenda cresce e passa um pouco do ponto antes de
   * assentar.
   *
   * Mola com amortecimento BAIXO -- e o repique que faz a diferenca entre
   * "aparecer" e "saltar". Ela parte de 0.6 e nao de zero: comecar do nada faz
   * o olho perder a primeira palavra procurando de onde ela veio.
   *
   * A mola e calculada SEMPRE, mesmo com a animacao desligada. Ela usa hooks
   * por dentro, e hook dentro de condicao quebra na hora em que ele liga ou
   * desliga a opcao no meio do preview -- o React conta hooks entre renders.
   */
  const mola = spring({
    // Relativo ao bloco: `frame` la em cima ja virou absoluto somando block.from.
    frame: frame - block.from,
    fps,
    config: { damping: 9, mass: 0.5, stiffness: 130 },
    /*
     * `durationInFrames` estica ou comprime a curva INTEIRA sem mudar o formato
     * dela: o repique continua sendo o mesmo repique, so mais rapido ou mais
     * lento. Mexer no stiffness em vez disso mudaria o quanto ela passa do
     * ponto, e ai a velocidade e a intensidade viravam um controle so.
     */
    durationInFrames: animationFrames,
  })
  const escala = animation === 'elastica' ? 0.6 + 0.4 * mola : 1

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
          fontFamily: stack,
          // Komika Axis tem um peso so. Pedir 800 faria o Chrome engrossar a
          // letra na marra, e o falso negrito briga com o contorno de 6px.
          fontWeight: 400,
          fontSize,
          lineHeight: 1.15,
          textAlign: 'center',
          textTransform: 'uppercase',
          /*
           * Zero desliga o contorno: o -webkit-text-stroke com 0px ainda
           * desenha uma linha de meio pixel em alguns zooms, e `undefined`
           * some de verdade.
           */
          WebkitTextStroke: stroke > 0 ? `${stroke}px #000` : undefined,
          paintOrder: 'stroke fill',
          /*
           * Sombra projetada por baixo do contorno.
           *
           * O contorno preto ja separa a letra do fundo, mas em cena clara ele
           * encosta no claro do fundo e a legenda "gruda" na imagem. A sombra
           * deslocada para baixo devolve profundidade sem engrossar a letra.
           */
          textShadow: sombraCss(shadow),
          transform: `scale(${escala})`,
          /*
           * Cresce a partir do CENTRO da propria legenda.
           *
           * Comecou em 'center bottom' com o argumento de que a altura e uma
           * escolha dele e a base nao devia se mexer. Visto rodando, o efeito
           * era o oposto do esperado: o texto parecia brotar de baixo em vez de
           * crescer no lugar. Pedido dele, com estas palavras -- "ela deve vir
           * do meio".
           */
          transformOrigin: 'center center',
        }}
      >
        {block.words.map((word, index) => (
          <span
            key={`${word.text}-${index}`}
            /*
             * Em 'tudo' a legenda inteira sai da cor escolhida e nenhuma palavra
             * e marcada -- e o visual de bloco unico, sem o karaoke. Em
             * 'palavra', que e o padrao, so a que esta sendo dita ganha cor.
             */
            style={{
              color:
                mark === 'tudo' || index === marcada ? CAPTION_COLOR_HEX[color] : '#FFFFFF',
            }}
          >
            {word.text}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  )
}
