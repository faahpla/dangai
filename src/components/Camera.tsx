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
}: {
  image: ImageAsset
  sourceStart: number
  value: CameraFrame
  onChange: (frame: CameraFrame) => void
  label: string
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
        className="relative aspect-[9/16] w-full cursor-move select-none overflow-hidden rounded-sm border border-line bg-black"
      >
        {/* O quadro inteiro, apagado: e a referencia do que fica DE FORA. */}
        <div className="absolute inset-0 opacity-35">
          <Midia image={image} sourceStart={sourceStart} style={cobrindo} />
        </div>

        {/*
          O miolo, em brilho normal.

          E a MESMA midia desenhada de novo, do tamanho do quadro inteiro, mas
          recortada pelo retangulo: dentro de uma janela de lado `lado`, uma
          copia de tamanho `1/lado` deslocada de `-left/lado` mostra exatamente
          o pedaco certo. Sem isso o retangulo seria so uma moldura vazia, que e
          onde a primeira versao parou.
        */}
        <div
          style={{
            left: `${left * 100}%`,
            top: `${top * 100}%`,
            width: `${lado * 100}%`,
            height: `${lado * 100}%`,
          }}
          className="pointer-events-none absolute overflow-hidden border border-accent"
        >
          <Midia
            image={image}
            sourceStart={sourceStart}
            style={{
              position: 'absolute',
              left: `${(-left / lado) * 100}%`,
              top: `${(-top / lado) * 100}%`,
              width: `${(1 / lado) * 100}%`,
              height: `${(1 / lado) * 100}%`,
              objectFit: 'cover',
            }}
          />
        </div>
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
