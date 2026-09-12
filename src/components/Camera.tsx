import { useCallback, useRef } from 'react'
import { CAMERA_SCALE_MAX, type CameraFrame, type ImageAsset } from '@shared/contract'

/**
 * O enquadramento de uma das pontas da camera livre.
 *
 * Mostra o quadro 9:16 inteiro e, por cima, o RETANGULO do que vai aparecer
 * naquele instante. Arrastar move; o slider aproxima. E o mesmo gesto do
 * Enquadramento que ele ja usa, com uma diferenca: la a janela recorta uma
 * imagem maior que a tela, aqui ela escolhe um pedaco DENTRO da tela.
 *
 * A conta que liga os dois mundos:
 *
 *   o render aplica `scale(s) translate(x%, y%)`, entao um ponto p da imagem
 *   aparece em s * (p + x/100). Fica visivel quem cai dentro do quadro, ou
 *   seja |s * (p + x/100)| <= 0.5. Isolando p:
 *
 *     largura do retangulo = 1/s
 *     canto esquerdo       = 0.5 - x/100 - 0.5/s
 *
 * Desenhar o retangulo e aplicar essa formula; arrastar e resolve-la ao
 * contrario. Por isso ela mora aqui e em mais lugar nenhum -- duas contas
 * parecidas divergem, e ai o retangulo passa a mentir sobre o video.
 */
export function Camera({
  image,
  value,
  onChange,
  label,
}: {
  image: ImageAsset
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
   * Com escala 1 o retangulo ocupa o quadro todo e nao ha folga nenhuma --
   * por isso o limite e zero ali, e cresce conforme ele aproxima.
   */
  const folga = 50 * (1 - 1 / value.scale)
  const preso = (n: number): number => Math.min(Math.max(n, -folga), folga)

  const mover = useCallback(
    (clientX: number, clientY: number) => {
      const caixa = caixaRef.current
      const inicio = arrasto.current
      if (!caixa || !inicio) return

      const rect = caixa.getBoundingClientRect()
      // O arraste anda com a IMAGEM, e o retangulo e a janela: puxar o
      // retangulo para a direita mostra o que esta a direita, o que significa
      // deslocar a imagem para a esquerda. Dai o sinal trocado.
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
        className="relative aspect-[9/16] w-full cursor-move overflow-hidden rounded-sm border border-line bg-black"
      >
        <img src={image.url} alt="" draggable={false} className="h-full w-full object-cover" />

        {/* O que fica de fora escurece: o retangulo se le pelo contraste. */}
        <div className="pointer-events-none absolute inset-0 bg-black/55" />
        <div
          style={{
            left: `${left * 100}%`,
            top: `${top * 100}%`,
            width: `${lado * 100}%`,
            height: `${lado * 100}%`,
            backgroundImage: `url(${image.url})`,
            // A janela repete a imagem no tamanho do quadro inteiro, deslocada
            // para o pedaco certo -- e o que faz o miolo aparecer sem o veu.
            backgroundSize: `${100 / lado}% ${100 / lado}%`,
            backgroundPosition: `${(left / (1 - lado || 1)) * 100}% ${(top / (1 - lado || 1)) * 100}%`,
          }}
          className="pointer-events-none absolute border border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0)]"
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
