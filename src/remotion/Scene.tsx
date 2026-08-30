import {
  AbsoluteFill,
  Easing,
  Freeze,
  Img,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
} from 'remotion'
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
export function Scene({
  url,
  durationInFrames,
  effect,
  intensity,
  curve,
  kind,
  sourceDurationInFrames,
  sourceStartFrames,
  abaixo,
  focusX,
  focusY,
}: SceneProps) {
  const frame = useCurrentFrame()

  const eased = interpolate(frame, [0, Math.max(durationInFrames - 1, 1)], [0, 1], {
    easing: easingFor(curve),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  /*
   * Quem decide o movimento e o BLOCO, nao o tipo de arquivo.
   *
   * Antes o clipe nunca recebia Ken Burns, decidido aqui. O motivo continua
   * valendo -- mover uma imagem que ja se move some com o movimento proprio do
   * clipe e costuma dar enjoo -- mas virou o PADRAO em vez de uma regra: o
   * plano marca 'nenhum' no clipe, e o usuario liga onde quiser. Print tambem
   * pode ficar parado agora, que antes era impossivel.
   */
  const { scale, x, y } =
    effect === 'nenhum' ? { scale: 1, x: 0, y: 0 } : motionFor(effect, intensity, eased)

  /*
   * O ultimo frame que o clipe realmente tem.
   *
   * sourceDurationInFrames so vem preenchido quando o clipe e MAIS CURTO que o
   * bloco -- o plano ja resolveu isso. Aqui, null quer dizer "nao ha nada para
   * congelar", e a conta cai para um valor inofensivo porque o Freeze exige um
   * numero finito mesmo desligado.
   */
  const ultimoFrame = Math.max((sourceDurationInFrames ?? durationInFrames) - 1, 0)
  const congelando = sourceDurationInFrames !== null && frame > ultimoFrame

  const cobrindo = {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    transform: `scale(${scale}) translate(${x}%, ${y}%)`,
    // A transformacao parte do centro para o zoom nao puxar para um canto.
    transformOrigin: 'center center',
  }

  /*
   * TELA DIVIDIDA: duas cenas ao mesmo tempo, uma em cima e uma embaixo.
   *
   * Cada metade ocupa 1080x960 e faz o proprio corte preenchendo, com o foco
   * que o app ja tem -- o rosto detectado na importacao, ou o que ele arrastou.
   * Por isso as duas partem do arquivo ORIGINAL: recortar o que ja veio em 9:16
   * mostraria so a faixa central de um quadro estreito, e corta rosto.
   *
   * O Ken Burns fica de fora da divisao de proposito. Sao duas imagens
   * disputando o olho num quadro pela metade; somar movimento em cada uma
   * cansa mais do que ajuda, e ele pode dar ritmo com a duracao do bloco.
   */
  if (abaixo) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000', display: 'flex', flexDirection: 'column' }}>
        <Metade
          url={url}
          kind={kind}
          focusX={focusX}
          focusY={focusY}
          sourceDurationInFrames={sourceDurationInFrames}
          sourceStartFrames={sourceStartFrames}
          durationInFrames={durationInFrames}
        />
        <Metade
          url={abaixo.url}
          kind={abaixo.kind}
          focusX={abaixo.focusX}
          focusY={abaixo.focusY}
          sourceDurationInFrames={abaixo.sourceDurationInFrames}
          sourceStartFrames={abaixo.sourceStartFrames}
          durationInFrames={durationInFrames}
        />
      </AbsoluteFill>
    )
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', overflow: 'hidden' }}>
      {kind === 'video' ? (
        /*
         * O clipe acabou antes do bloco: o ultimo frame fica parado ate o bloco
         * fechar. Sem isso o quadro cairia para preto no meio da narracao.
         *
         * O Freeze fica sempre montado e liga pela funcao em `active`. Trocar
         * <OffthreadVideo> por <Freeze><OffthreadVideo></Freeze> no meio do bloco
         * remontaria o video e daria um piscar exatamente no ponto da emenda.
         *
         * `ultimoFrame` e local ao bloco, que e o que o Freeze espera -- ele
         * mesmo soma o deslocamento da Sequence.
         */
        <Freeze frame={ultimoFrame} active={congelando}>
          {/*
           * OffthreadVideo, e nao Video: o frame e extraido pelo compositor em
           * vez de depender do relogio de um <video> do Chrome, que no render
           * sem tela escorrega e entrega frame repetido ou fora de ordem.
           *
           * muted por decisao de produto -- os clipes ja chegam cortados e o
           * audio do video e a narracao, nao o som original da cena.
           */}
          {/*
           * `trimBefore` e de onde o clipe COMECA a tocar.
           *
           * O clipe ja vem cortado do AnCut, mas o bloco quase nunca tem a
           * mesma duracao dele: uma cena de 6 segundos num bloco de 2 mostrava
           * sempre os dois primeiros, e o que interessa costuma estar no meio
           * ou no fim. Quem escolhe o ponto e o usuario, pelo card da cena.
           */}
          <OffthreadVideo
            src={url}
            muted
            trimBefore={sourceStartFrames > 0 ? sourceStartFrames : undefined}
            style={cobrindo}
          />
        </Freeze>
      ) : (
        <Img src={url} style={cobrindo} />
      )}
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

function motionFor(
  effect: Exclude<SceneProps['effect'], 'nenhum'>,
  intensity: number,
  t: number,
): Motion {
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

/**
 * Uma das duas metades da tela dividida.
 *
 * Corte preenchendo: o quadro 16:9 entra numa caixa de 1080x960 com `cover`, e
 * `objectPosition` usa o foco da cena para escolher QUAL parte fica. Sem isso a
 * metade cortaria sempre pelo centro e o personagem sairia do quadro.
 */
function Metade({
  url,
  kind,
  focusX,
  focusY,
  sourceDurationInFrames,
  sourceStartFrames,
  durationInFrames,
}: {
  url: string
  kind: 'image' | 'video'
  focusX: number
  focusY: number
  sourceDurationInFrames: number | null
  sourceStartFrames: number
  durationInFrames: number
}) {
  const frame = useCurrentFrame()
  const ultimoFrame = Math.max((sourceDurationInFrames ?? durationInFrames) - 1, 0)
  const congelando = sourceDurationInFrames !== null && frame > ultimoFrame

  const preenchendo = {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    objectPosition: `${(focusX * 100).toFixed(1)}% ${(focusY * 100).toFixed(1)}%`,
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
      {kind === 'video' ? (
        <Freeze frame={ultimoFrame} active={congelando}>
          <OffthreadVideo
            src={url}
            muted
            trimBefore={sourceStartFrames > 0 ? sourceStartFrames : undefined}
            style={preenchendo}
          />
        </Freeze>
      ) : (
        <Img src={url} style={preenchendo} />
      )}
    </div>
  )
}
