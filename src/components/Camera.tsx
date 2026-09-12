import { useCallback, useRef } from 'react'
import { CAMERA_SCALE_MAX, type CameraFrame, type ImageAsset } from '@shared/contract'

/**
 * A midia do bloco, parada, para enquadrar em cima dela.
 *
 * Print e clipe chegam os dois em `image.url`, mas um e imagem e o outro e um
 * mp4 -- e `<img src="...mp4">` nao desenha nada, so o icone de arquivo
 * quebrado. Foi o que apareceu na primeira versao disto, num projeto feito
 * inteiro de clipes: "consigo nem ver oq vou fazer".
 *
 * O clipe entra como <video> parado no instante em que o bloco comeca, que e o
 * quadro que ele esta de fato enquadrando -- o primeiro segundo do arquivo
 * costuma ser outra coisa.
 */
function Midia({
  image,
  sourceStart,
  style,
}: {
  image: ImageAsset
  sourceStart: number
  style: React.CSSProperties
}) {
  if (image.kind === 'video') {
    return (
      <video
        src={image.url}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          event.currentTarget.currentTime = sourceStart
        }}
        style={style}
      />
    )
  }
  return <img src={image.url} alt="" draggable={false} style={style} />
}

/**
 * O enquadramento de uma das pontas da camera livre.
 *
 * Mostra o quadro 9:16 inteiro, escurecido, e por cima o RETANGULO do que vai
 * aparecer naquele instante -- com a midia em brilho normal dentro dele.
 * Arrastar move; o slider aproxima.
 *
 * A conta que liga o retangulo ao video:
 *
 *   o render aplica `scale(s) translate(x%, y%)`, entao um ponto p da imagem
 *   aparece em s * (p + x/100). Fica visivel quem cai dentro do quadro, ou
 *   seja |s * (p + x/100)| <= 0.5. Isolando p:
 *
 *     lado do retangulo = 1/s
 *     canto esquerdo    = 0.5 - x/100 - 0.5/s
 *
 * Desenhar o retangulo e aplicar essa formula; arrastar e resolve-la ao
 * contrario. Por isso ela mora aqui e em mais lugar nenhum -- duas contas
 * parecidas divergem, e ai o retangulo passa a mentir sobre o video.
 */
export function Camera({
  image,
  sourceStart,
  value,
  onChange,
  label,
  aoMexer,
}: {
  image: ImageAsset
  sourceStart: number
  value: CameraFrame
  onChange: (frame: CameraFrame) => void
  label: string
  /**
   * Leva a agulha para o instante que ESTE quadro descreve.
   *
   * Sem isto o preview discordava do retangulo, e com razao: "Comeca em" e o
   * primeiro frame do bloco, mas a agulha costuma estar no meio dele, onde o
   * enquadramento ja avancou parte do caminho ate a outra ponta. Os dois nao
   * tinham como concordar, e nada na tela dizia por que.
   *
   * O "Trecho do clipe" ja fazia isso a cada arrasto, pelo mesmo motivo.
   */
  aoMexer: () => void
}) {
  const caixaRef = useRef<HTMLDivElement | null>(null)
  const arrasto = useRef<{ x: number; y: number; de: CameraFrame } | null>(null)

  const lado = 1 / value.scale
  const left = 0.5 - value.x / 100 - lado / 2
  const top = 0.5 - value.y / 100 - lado / 2

  /**
   * O quanto a camera pode sair do centro sem deixar entrar borda preta.
   *
   * Com escala 1 o retangulo ocupa o quadro todo e nao ha folga nenhuma -- por
   * isso o limite e zero ali, e cresce conforme ele aproxima.
   */
  const folga = 50 * (1 - 1 / value.scale)
  const preso = (n: number): number => Math.min(Math.max(n, -folga), folga)

  const mover = useCallback(
    (clientX: number, clientY: number) => {
      const caixa = caixaRef.current
      const inicio = arrasto.current
      if (!caixa || !inicio) return

      const rect = caixa.getBoundingClientRect()
      /*
       * Sinal trocado de proposito: o que se arrasta e a JANELA, e o numero
       * guardado desloca a IMAGEM. Puxar a janela para a direita e mostrar o
       * que esta a direita, o que em transform significa empurrar a imagem
       * para a esquerda.
       */
      const dx = ((clientX - inicio.x) / rect.width) * 100
      const dy = ((clientY - inicio.y) / rect.height) * 100

      onChange({
        scale: inicio.de.scale,
        x: preso(inicio.de.x - dx),
        y: preso(inicio.de.y - dy),
      })
    },
    [onChange, folga],
  )

  /* A midia ocupando o quadro inteiro. O retangulo repete isto por dentro. */
  const cobrindo: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-ink-3">{label}</span>

      <div
        ref={caixaRef}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          arrasto.current = { x: event.clientX, y: event.clientY, de: value }
          aoMexer()
        }}
        onPointerMove={(event) => {
          if (arrasto.current) mover(event.clientX, event.clientY)
        }}
        onPointerUp={() => {
          arrasto.current = null
        }}
        onPointerCancel={() => {
          arrasto.current = null
        }}
        /*
         * A ALTURA manda, e a largura sai dela.
         *
         * Com `w-full` o quadro crescia ate 390px de altura e empurrava a
         * Intensidade e o Ritmo para fora da vista -- e o ritmo e justamente o
         * que da sentido ao movimento desenhado aqui.
         *
         * Limitar pela altura E O UNICO JEITO CERTO: a conta do retangulo
         * assume 9:16 nos dois eixos, entao um `max-h` por cima de `w-full`
         * achataria o quadro sem achatar a conta, e o retangulo passaria a
         * apontar para o lugar errado. Fixando a altura, a largura vem do
         * aspect e a proporcao se mantem exata.
         */
        className="relative mx-auto aspect-[9/16] h-[240px] w-auto cursor-move select-none overflow-hidden rounded-sm border border-line bg-black"
      >
        {/*
          UMA MIDIA SO, e o escurecimento com um furo.

          A primeira versao desenhava a midia duas vezes -- apagada ao fundo e
          de novo, recortada, dentro do retangulo. Com clipe isso virava DOIS
          <video> independentes, cada um procurando o proprio quadro: quando um
          terminava o seek antes do outro, o miolo mostrava um instante
          diferente do fundo. Na tela, isso se lia como retangulo cortado e como
          enquadramento que nao bate com o preview.

          Agora o escuro e uma sombra que se espalha para FORA do retangulo,
          entao ha uma imagem so embaixo de tudo e nada pode divergir.
        */}
        <Midia image={image} sourceStart={sourceStart} style={cobrindo} />

        <div
          style={{
            left: `${left * 100}%`,
            top: `${top * 100}%`,
            width: `${lado * 100}%`,
            height: `${lado * 100}%`,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
          }}
          className="pointer-events-none absolute border border-accent"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="range"
          min={1}
          max={CAMERA_SCALE_MAX}
          step={0.05}
          value={value.scale}
          aria-label={`Aproximacao -- ${label}`}
          onChange={(event) => {
            aoMexer()
            const scale = Number(event.target.value)
            // Reaperta o deslocamento na folga NOVA: afastar encolhe a margem,
            // e um x que era valido em 2x poe borda preta em 1.2x.
            const nova = 50 * (1 - 1 / scale)
            onChange({
              scale,
              x: Math.min(Math.max(value.x, -nova), nova),
              y: Math.min(Math.max(value.y, -nova), nova),
            })
          }}
          className="dangai-range min-w-0 flex-1"
        />
        <span className="tnum w-9 shrink-0 text-right text-[11px] text-ink-3">
          {value.scale.toFixed(2)}x
        </span>
      </div>
    </div>
  )
}
