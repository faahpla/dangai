import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion'
import {
  activeWordIndex,
  CAPTION_CHARS_PER_LINE,
  CAPTION_FONT_SIZE as FONT_SIZE,
  corDaLegenda,
  escalaDaEntrada,
  type CurvaDaEntrada,
  type CaptionAnimation,
  type CaptionBlock,
  type CaptionColor,
  type CaptionMark,
  type CaptionPontuacao,
  type CaptionShadow,
  sombraCss,
  textoNaLegenda,
} from '@shared/contract'
import { carregarFonte, CAPTION_FONT_STACK } from './fonts'

/** Margem de cada lado da legenda e o vao entre palavras, em px do quadro. */
const MARGEM = 80
const VAO = 18
/** 2% de sobra no encolher: a medida do canvas e a do layout diferem um fio, e sem
 * folga a linha encolhida quebrava em duas e ficava minuscula. */
const FOLGA = 0.98

/** O maior tamanho que a entrada elastica atinge (1 = nunca passa do final), amostrado. */
const picos = new WeakMap<CurvaDaEntrada, number>()
export function picoDaEntrada(curva: CurvaDaEntrada): number {
  const ja = picos.get(curva)
  if (ja !== undefined) return ja
  let p = 1
  for (let i = 0; i <= 60; i++) p = Math.max(p, escalaDaEntrada(curva, i / 60))
  picos.set(curva, p)
  return p
}
let regua: CanvasRenderingContext2D | null | undefined

/**
 * Largura da linha na fonte de verdade, no tamanho pedido: as palavras em
 * caixa alta, os vaos entre elas e o contorno (metade para cada lado, nas
 * pontas). null quando nao ha canvas para medir: quem chama cai na conta por
 * letras de antes. A fonte ja esta carregada aqui -- o Video so monta a
 * legenda depois do fontsReady.
 */
function larguraDaLinha(palavras: readonly string[], stack: string, tamanho: number, stroke: number): number | null {
  if (palavras.length === 0) return 0
  if (regua === undefined) regua = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (!regua) return null
  regua.font = `400 ${tamanho}px ${stack}`
  const soma = palavras.reduce((s, p) => s + regua!.measureText(p.toUpperCase()).width, 0)
  return soma + VAO * (palavras.length - 1) + stroke
}

/**
 * Legendas queimadas no estilo de short: 2 a 4 palavras por vez, centro-inferior,
 * fonte pesada, contorno preto grosso e a palavra sendo dita colorida.
 *
 * O contorno usa -webkit-text-stroke com paint-order: stroke fill. Sem o
 * paint-order o contorno e desenhado por cima da letra e come metade da
 * espessura do traco, deixando o texto magro e sujo.
 */

export function Captions({
  blocks,
  color,
  y,
  font,
  animation,
  animationFrames,
  animationCurve,
  mark,
  pontuacao,
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
  animationCurve: CurvaDaEntrada
  mark: CaptionMark
  /** 'limpar': so ? ! % na tela; o roteiro e as quebras de linha nao mudam. */
  pontuacao: CaptionPontuacao
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
            animationCurve={animationCurve}
            mark={mark}
            pontuacao={pontuacao}
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
  animationCurve,
  mark,
  pontuacao,
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
  animationCurve: CurvaDaEntrada
  mark: CaptionMark
  /** 'limpar': so ? ! % na tela; o roteiro e as quebras de linha nao mudam. */
  pontuacao: CaptionPontuacao
  shadow: CaptionShadow
  stroke: number
  scale: number
}) {
  // A altura vem da COMPOSICAO: a legenda desce uma fracao do quadro, e o
  // quadro deixou de ser sempre 1920.
  const { fps, height, width } = useVideoConfig()
  // useCurrentFrame dentro da Sequence e relativo a ela; as palavras carregam
  // frames absolutos, entao a comparacao volta para a base absoluta.
  const frame = useCurrentFrame() + block.from

  // Palavra comprida demais encolhe o suficiente para caber inteira, em vez de
  // sair pelos dois lados da tela.
  const textos = block.words.map((word) => textoNaLegenda(word.text, pontuacao))
  // O tamanho que ele escolheu vale enquanto a linha couber. A largura e MEDIDA na
  // fonte de verdade (antes era contada em letras, e com letra grande "FINALMENTE"
  // encolhia mesmo cabendo -- o short do Dopanimes deixa a palavra larga e da a
  // mesma altura a todas). So encolhe o que passaria das margens.
  const pedida = FONT_SIZE * scale
  const largura = larguraDaLinha(textos.filter(Boolean), stack, pedida, stroke)
  /*
   * O PICO DA ENTRADA cabe tambem: "no bounce o texto da saindo da tela". A
   * curva elastica passa de 1 (a do Levi chega a 1,11), e a linha que cabia
   * no tamanho final saia pelas bordas no meio da entrada. A largura util e
   * dividida pelo maior ponto da curva: so encolhe a linha que estouraria.
   */
  const pico = animation === 'elastica' ? picoDaEntrada(animationCurve) : 1
  const util = (width - 2 * MARGEM) / pico
  const fontSize =
    largura === null
      ? FONT_SIZE * Math.min(scale, CAPTION_CHARS_PER_LINE / Math.max(1, textos.filter(Boolean).join(' ').length))
      : largura > util ? (pedida * util * FOLGA) / largura : pedida

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
  /*
   * A CURVA e dele agora: "quero mais controle sobre essa animacao elastica,
   * um grafico de curvas configuravel". A curva padrao e a mola de antes
   * amostrada (no maximo 0,6% de diferenca), entao quem nunca mexeu ve a
   * mesma entrada.
   */
  const progresso = Math.min(Math.max((frame - block.from) / Math.max(animationFrames, 1), 0), 1)
  const escala = animation === 'elastica' ? escalaDaEntrada(animationCurve, progresso) : 1

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        // Distancia do rodape. O padrao mantem os 420px de sempre; ver
        // CAPTION_Y_DEFAULT para por que 420 e nao qualquer outro numero.
        paddingBottom: y * height,
        paddingLeft: MARGEM,
        paddingRight: MARGEM,
      }}
    >
      <div
        style={{
          display: 'flex',
          // Uma linha so: quem nao cabe encolhe (larguraDaLinha), nao quebra.
          flexWrap: 'nowrap',
          justifyContent: 'center',
          gap: `0 ${VAO}px`,
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
        {block.words.map((word, index) => textos[index] === '' ? null : (
          <span
            key={`${word.text}-${index}`}
            /*
             * Em 'tudo' a legenda inteira sai da cor escolhida e nenhuma palavra
             * e marcada -- e o visual de bloco unico, sem o karaoke. Em
             * 'palavra', que e o padrao, so a que esta sendo dita ganha cor.
             */
            style={{
              color:
                mark === 'tudo' || index === marcada ? corDaLegenda(color) : '#FFFFFF',
            }}
          >
            {textos[index]}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  )
}
