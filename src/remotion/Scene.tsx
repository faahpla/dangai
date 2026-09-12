import {
  AbsoluteFill,
  Easing,
  Freeze,
  getRemotionEnvironment,
  Img,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
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
  thumbnail,
  camera,
  sourceDurationInFrames,
  sourceStartFrames,
  abaixo,
  focusX,
  focusY,
  rotation,
  curvePoints,
}: SceneProps) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const eased = interpolate(frame, [0, Math.max(durationInFrames - 1, 1)], [0, 1], {
    easing: easingFor(curve, curvePoints),
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
  /*
   * A CAMERA LIVRE MANDA quando existe.
   *
   * Os presets produzem movimentos ancorados no centro -- um zoom out abre a
   * partir do meio e pronto. Nao cobriam abrir a partir do ROSTO de alguem que
   * esta no alto e fora do eixo, que foi o que ele pediu. Com as duas pontas
   * definidas, o movimento e a reta entre elas, e a curva do bloco continua
   * decidindo o RITMO da passagem, igual a um preset.
   *
   * Fica fora da tela dividida: ali cada metade tem quadro proprio, e uma
   * camera so para as duas nao quer dizer nada.
   */
  const { scale, x, y } = camera
    ? {
        scale: camera.from.scale + (camera.to.scale - camera.from.scale) * eased,
        x: camera.from.x + (camera.to.x - camera.from.x) * eased,
        y: camera.from.y + (camera.to.y - camera.from.y) * eased,
      }
    : effect === 'nenhum'
      ? { scale: 1, x: 0, y: 0 }
      : motionFor(effect, intensity, eased)

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

  /*
   * GIRO: a CAIXA gira, e o corte continua preenchendo.
   *
   * Girar so a imagem deixaria canto vazio -- um quadro deitado dentro de um
   * quadro em pe nao cobre as pontas. Entao quem gira e uma caixa com as
   * medidas TROCADAS: num giro de um quarto ela nasce 1920x1080, preenche isso
   * com cover, e so entao vira. O que chega ao quadro ja e 1080x1920 cheio, e
   * nenhuma tarja preta aparece em angulo nenhum.
   *
   * As medidas saem do useVideoConfig e nao de numero fixo: quem manda no
   * tamanho e a composicao, e escrever 1080 aqui seria uma segunda verdade
   * esperando divergir da primeira.
   */
  const quarto = rotation === 90 || rotation === 270
  const caixa =
    rotation === 0
      ? // `relative` so para a cama do preview ter a que se prender. Numa div
        // que ja ocupa os 100%, nao muda nada do que aparece.
        { width: '100%', height: '100%', position: 'relative' as const }
      : {
          position: 'absolute' as const,
          top: '50%',
          left: '50%',
          width: quarto ? height : width,
          height: quarto ? width : height,
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
        }

  const cobrindo = {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    /*
     * Girado de um quarto, a fonte e o arquivo ORIGINAL -- sem o recorte 9:16
     * que a importacao faz. Entao quem escolhe qual parte dele fica no quadro e
     * o foco, como na tela dividida; sem isto o corte cairia no centro e o
     * rosto sairia.
     *
     * O foco vale em coordenadas da IMAGEM, nao da tela: o cover acontece antes
     * do giro, entao nao ha eixo para trocar.
     */
    ...(quarto
      ? { objectPosition: `${(focusX * 100).toFixed(1)}% ${(focusY * 100).toFixed(1)}%` }
      : {}),
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
          effect={effect}
          intensity={intensity}
          curve={curve}
          curvePoints={curvePoints}
        />
        <Metade
          url={abaixo.url}
          kind={abaixo.kind}
          focusX={abaixo.focusX}
          focusY={abaixo.focusY}
          sourceDurationInFrames={abaixo.sourceDurationInFrames}
          sourceStartFrames={abaixo.sourceStartFrames}
          durationInFrames={durationInFrames}
          // Ja resolvido pelo plano: aqui nao existe "segue a de cima".
          effect={abaixo.effect}
          intensity={abaixo.intensity}
          curve={curve}
          curvePoints={curvePoints}
        />
      </AbsoluteFill>
    )
  }

  /*
   * O Ken Burns fica DENTRO da caixa, e por isso acompanha o giro: num bloco
   * deitado, "pan para a esquerda" continua sendo a esquerda de quem assiste.
   */
  return (
    <AbsoluteFill style={{ backgroundColor: '#000', overflow: 'hidden' }}>
      <div style={caixa}>
        {/*
          A CAMA DA TROCA DE BLOCO -- e so no preview.

          O <video> do clipe nasce na hora em que o bloco entra: carregar,
          procurar o ponto de entrada e decodificar leva bem mais que um frame,
          e ate ele pintar quem aparece e o preto deste AbsoluteFill. O render
          nao sofre disso, porque la o frame vem pronto do compositor.

          A miniatura e a mesma que a linha do tempo ja mostra, entao ja esta em
          cache e pinta na hora. Ela fica ATRAS do clipe e nao sai: assim que o
          video tem quadro, ele cobre isto por cima. O olho troca um buraco
          preto por dois frames de cena em baixa resolucao.

          Fica fora do render de proposito. O MP4 ja sai certo, e por um
          incomodo que so existe na edicao nao vale pendurar um elemento a mais
          no caminho do arquivo final.
        */}
        {/*
          A CAMA FICA O BLOCO INTEIRO. Ja tentei limitar, e voltou o flash.

          Houve uma versao que a desmontava apos doze quadros, com o argumento
          de que passado isso ela seria peso morto -- uma camada de 1080x1920
          embaixo de cada clipe, para o compositor empilhar a cada frame. O
          argumento partia de um travamento medido em 24 quadros por segundo.

          So que 24 e a taxa CHEIA desta composicao, que roda a 24000/1001: nao
          havia travamento nenhum para combater, e a economia custou justamente
          o que a cama existe para resolver. Quando o <video> demora mais de
          meio segundo para achar o quadro -- e demora, num clipe que comeca
          longe do inicio do arquivo --, o preto voltava a aparecer.

          O custo real dela e uma camada parada embaixo do video, que o
          compositor resolve na GPU. Barato perto de um flash a cada troca.
        */}
        {kind === 'video' && thumbnail && !getRemotionEnvironment().isRendering && (
          // Absoluta, senao ela nao ficaria ATRAS do clipe: os dois sao filhos
          // da mesma caixa e, no fluxo normal, a cama empurraria o video para
          // baixo em vez de ficar embaixo dele.
          <Img src={thumbnail} style={{ ...cobrindo, position: 'absolute', inset: 0 }} />
        )}
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
      </div>
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
 *
 * A curva desenhada a mao entra por cima dos quatro presets, com a mesma
 * restricao: e uma cubica, e os pontos de controle vivem dentro de 0..1.
 */
function easingFor(
  curve: SceneProps['curve'],
  pontos: SceneProps['curvePoints'],
): ((t: number) => number) | undefined {
  /*
   * A curva desenhada a mao ganha do preset.
   *
   * Os quatro numeros ja chegam presos entre 0 e 1 pelo schema, entao esta
   * bezier obedece a mesma regra das outras quatro: nunca passa de 0..1, e o
   * pan nunca ultrapassa a folga de borda que o motionFor reserva.
   */
  if (pontos) return Easing.bezier(pontos[0], pontos[1], pontos[2], pontos[3])

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
  effect,
  intensity,
  curve,
  curvePoints,
}: {
  url: string
  kind: 'image' | 'video'
  focusX: number
  focusY: number
  sourceDurationInFrames: number | null
  sourceStartFrames: number
  durationInFrames: number
  effect: SceneProps['effect']
  intensity: number
  curve: SceneProps['curve']
  curvePoints: SceneProps['curvePoints']
}) {
  const frame = useCurrentFrame()
  const ultimoFrame = Math.max((sourceDurationInFrames ?? durationInFrames) - 1, 0)
  const congelando = sourceDurationInFrames !== null && frame > ultimoFrame

  /*
   * A METADE TAMBEM SE MEXE, e cada uma com o seu movimento.
   *
   * Houve uma decisao de deixar o Ken Burns fora da divisao: sao duas imagens
   * disputando o olho num quadro pela metade, e somar movimento em cada uma
   * cansaria mais do que ajudaria. Ele usou e discordou -- a divisao ficava
   * parada no meio de um video que se move o tempo todo, e destoava.
   *
   * A CURVA continua sendo do bloco. O que separa e o efeito e a intensidade:
   * o ritmo de uma emenda e do bloco inteiro, e duas metades acelerando em
   * tempos diferentes e que dariam o enjoo que a decisao antiga temia.
   */
  const eased = interpolate(frame, [0, Math.max(durationInFrames - 1, 1)], [0, 1], {
    easing: easingFor(curve, curvePoints),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const { scale, x, y } =
    effect === 'nenhum' ? { scale: 1, x: 0, y: 0 } : motionFor(effect, intensity, eased)

  const preenchendo = {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    objectPosition: `${(focusX * 100).toFixed(1)}% ${(focusY * 100).toFixed(1)}%`,
    // O cover ja preencheu a metade, entao ampliar daqui nunca abre tarja --
    // o mesmo motivo pelo qual o Ken Burns de tela cheia parte de uma escala
    // ja ampliada.
    transform: `scale(${scale}) translate(${x}%, ${y}%)`,
    transformOrigin: 'center center',
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
