import { Fragment, useEffect, useState } from 'react'
import {
  AbsoluteFill,
  cancelRender,
  continueRender,
  delayRender,
  getRemotionEnvironment,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
} from 'remotion'
import { TransitionSeries } from '@remotion/transitions'
import type { RenderProps } from '@shared/contract'
import { Scene, easingFor, motionFor } from './Scene'
import { Captions } from './Captions'
import { Cards } from './Card'
import { presentationFor, timingFor } from './Transition'

/**
 * A composicao inteira, no formato do projeto: 1080x1920 no vertical,
 * 1920x1080 no horizontal. As medidas chegam pelas props -- ver Root.
 *
 * Sem audio aqui de proposito. O Remotion entrega video puro e o FFmpeg cuida
 * da narracao, dos SFX e do loudnorm -- e onde o loudnorm de duas passadas
 * precisa viver de qualquer jeito, e evita decodificar audio dentro do Chrome.
 *
 * As duracoes que chegam ja incluem a folga da sobreposicao das transicoes
 * (ver toRenderProps): somadas e descontadas as sobreposicoes, o total bate
 * exatamente com a duracao da narracao.
 */
/**
 * Segura o render ate a fonte das legendas estar pronta.
 *
 * Sem isso o Chrome desenha o primeiro frame com a fonte de fallback e o video
 * sai com legenda em outra tipografia -- um erro que so aparece no arquivo
 * final, nunca no preview, porque no preview a fonte ja carregou faz tempo.
 */
function useFontsReady(enabled: boolean): boolean {
  const [ready, setReady] = useState(!enabled)

  useEffect(() => {
    if (!enabled) return
    const handle = delayRender('carregando a fonte das legendas')
    document.fonts
      .ready.then(() => {
        setReady(true)
        continueRender(handle)
      })
      .catch((err: unknown) => {
        cancelRender(err instanceof Error ? err : new Error(String(err)))
      })
  }, [enabled])

  return ready
}

export function Video({
  scenes,
  captions,
  cards,
  captionColor,
  captionY,
  captionFont,
  captionAnimation,
  captionAnimationFrames,
  captionAnimationCurve,
  sobreposicoes,
  captionMark,
  captionShadow,
  captionStroke,
  captionScale,
}: RenderProps) {
  // Gancho e legenda usam a mesma fonte, entao qualquer um dos dois obriga a
  // esperar por ela -- senao o card sai no fallback e so aparece no MP4.
  const fontsReady = useFontsReady(captions.length > 0 || cards.length > 0)

  /*
   * Trinta quadros sao 1,25s a 23,976: folga para um <video> abrir o arquivo,
   * procurar o ponto de entrada e decodificar o primeiro quadro. Menos que
   * isso corre o risco de nao dar tempo justamente nos clipes que comecam
   * longe do inicio do arquivo, que sao os que mais demoram.
   */
  const premount = getRemotionEnvironment().isRendering ? 0 : 30

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/*
        A CAMA DO PREVIEW, por baixo de tudo e SEMPRE montada.

        Ela ja viveu dentro da Scene, e ali nao funcionava tocando -- so
        parado. Arrastando a agulha o player renderiza um quadro e espera, e
        tudo tem tempo de pintar; no play ele avanca 24 quadros por segundo, e
        no quadro em que o bloco entra o React MONTA a cena inteira. Uma <img>
        recem-criada nao pinta em 41ms nem com o arquivo em cache, entao o
        preto de tras aparecia mesmo com a cama existindo.

        Aqui ela nunca e montada na hora: e um elemento so, vivo do inicio ao
        fim do video, que apenas TROCA de src. E isso muda tudo -- ao trocar a
        fonte de uma imagem que ja esta na tela, o navegador segura o quadro
        anterior ate o novo decodificar. Nao ha buraco para o preto aparecer.
      */}
      <CamaDoPreview scenes={scenes} />

      <TransitionSeries>
        {scenes.map((scene, index) => (
          <Fragment key={`${scene.url}-${index}`}>
            {scene.transitionInFrames > 0 && (
              <TransitionSeries.Transition
                presentation={presentationFor(scene.transitionIn)}
                timing={timingFor(scene.transitionIn, scene.transitionInFrames)}
              />
            )}
            {/*
              PREMOUNT: a cena nasce ANTES de entrar, e por isso nao pisca.

              Era esta a causa do flash desde o comeco, e as tentativas de
              cobri-lo por baixo -- cama de miniatura, pre-carga fora do DOM --
              atacavam o sintoma. O <video> do bloco era criado no quadro exato
              em que o bloco comecava, e carregar, procurar o ponto e
              decodificar nao cabe nos 41ms de um quadro. Tocando, dava flash;
              parado, nao, porque ali o player espera.

              `premountFor` monta a sequencia trinta quadros antes, invisivel e
              congelada no frame 0: quando chega a hora, o video ja achou o
              quadro e so precisa aparecer.

              O CAST existe porque o TIPO nao declara a prop, mas a
              implementacao repassa tudo que nao seja durationInFrames,
              children, offset, controls e from para a <Sequence> interna --
              que a suporta. A documentacao do Remotion lista `premountFor`
              como aceito aqui; os tipos e que ficaram para tras.

              So no preview: no render o frame vem pronto do compositor, nao ha
              o que esconder, e montar cenas adiantado so custaria memoria.
            */}
            <TransitionSeries.Sequence
              durationInFrames={scene.durationInFrames}
              {...(premount > 0 ? ({ premountFor: premount } as { premountFor: number }) : {})}
            >
              <Scene {...scene} />
            </TransitionSeries.Sequence>
          </Fragment>
        ))}
      </TransitionSeries>

      {/*
        A FAIXA DE VIDEO: por cima das cenas, por baixo das legendas -- a seta
        aponta para a cena, e a legenda continua legivel por cima de tudo.
      */}
      <Sobreposicoes itens={sobreposicoes} />

      {fontsReady && captions.length > 0 && (
        <Captions
          blocks={captions}
          color={captionColor}
          y={captionY}
          font={captionFont}
          animation={captionAnimation}
          animationFrames={captionAnimationFrames}
          animationCurve={captionAnimationCurve}
          mark={captionMark}
          shadow={captionShadow}
          stroke={captionStroke}
          scale={captionScale}
        />
      )}
      {fontsReady && cards.length > 0 && <Cards cards={cards} />}
    </AbsoluteFill>
  )
}

/**
 * A miniatura do bloco atual, viva o video inteiro, so trocando de src.
 *
 * Existe para o preview e mais nada: no render o frame vem pronto do
 * compositor, e nao ha instante nenhum em que o quadro esteja vazio.
 *
 * Qual bloco esta no ar se descobre somando as duracoes e descontando as
 * transicoes -- numa TransitionSeries a emenda SOBREPOE os dois vizinhos, e
 * ignorar isso faria a cama atrasar um pouco mais a cada transicao do video.
 * O desconto mantem a conta alinhada do primeiro ao ultimo bloco.
 */
function CamaDoPreview({ scenes }: { scenes: RenderProps['scenes'] }) {
  const frame = useCurrentFrame()

  if (getRemotionEnvironment().isRendering) return null

  let inicio = 0
  let atual: RenderProps['scenes'][number] | undefined
  for (const scene of scenes) {
    inicio -= scene.transitionInFrames
    if (frame < inicio + scene.durationInFrames) {
      atual = scene
      break
    }
    inicio += scene.durationInFrames
  }

  const thumb = atual?.thumbnail
  if (!thumb) return null

  /*
   * <img> cru, e nao o <Img> do Remotion: o que se quer aqui e justamente o
   * comportamento nativo de segurar o quadro antigo enquanto o novo carrega.
   * O <Img> do Remotion existe para GARANTIR que a imagem esteja pronta antes
   * de desenhar, que e o oposto -- e no player ele nao espera de qualquer
   * forma.
   */
  return (
    <img
      src={thumb}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
      }}
    />
  )
}

/**
 * As sobreposicoes da faixa de video. A faixa de numero maior fica por cima,
 * como nos editores.
 *
 * O arquivo cobre o quadro com `contain` -- um .mov exportado no tamanho do
 * video cai exatamente no lugar em que foi desenhado -- e depois anda e
 * escala pelos controles da faixa. `transparent` faz o render extrair o quadro
 * com o canal alfa: sem ele o fundo vazado viraria preto.
 */
function Sobreposicoes({ itens }: { itens: RenderProps['sobreposicoes'] }) {
  if (itens.length === 0) return null
  const ordenadas = [...itens].sort((a, b) => a.faixa - b.faixa)
  return (
    <>
      {ordenadas.map((o, i) => (
        <Sequence key={`${o.url}-${o.from}-${i}`} from={o.from} durationInFrames={o.durationInFrames} layout="none">
          <Sobreposicao o={o} />
        </Sequence>
      ))}
    </>
  )
}

/**
 * Um clipe da faixa de video: posicao, escala, GIRO e opacidade fixos, e por
 * dentro deles o MESMO movimento dos blocos (zoom e pan, no ritmo escolhido).
 * O quadro conta a partir do comeco do clipe, entao o movimento atravessa o
 * clipe inteiro, como num bloco.
 */
function Sobreposicao({ o }: { o: RenderProps['sobreposicoes'][number] }) {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [0, Math.max(o.durationInFrames - 1, 1)], [0, 1], {
    easing: easingFor(o.curva, o.pontosDaCurva),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const m = o.efeito === 'nenhum' ? { scale: 1, x: 0, y: 0 } : motionFor(o.efeito, o.intensidade, t)
  const cobre = { width: '100%', height: '100%', objectFit: 'contain' as const }
  return (
    <AbsoluteFill
      style={{
        transform: `translate(${o.x}%, ${o.y}%) rotate(${o.rotacao}deg) scale(${o.escala})`,
        transformOrigin: 'center center',
        opacity: o.opacidade,
      }}
    >
      <AbsoluteFill
        style={{ transform: `translate(${m.x}%, ${m.y}%) scale(${m.scale})`, transformOrigin: 'center center' }}
      >
        {o.tipo === 'video' ? (
          <OffthreadVideo
            src={o.url}
            muted
            transparent
            trimBefore={o.inicioFrames > 0 ? o.inicioFrames : undefined}
            style={cobre}
          />
        ) : (
          <Img src={o.url} style={cobre} />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
