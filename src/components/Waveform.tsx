import { useEffect, useRef } from 'react'

interface WaveformProps {
  peaks: readonly number[]
  className?: string
  /** Cor das barras. Padrao: o branco translucido da narracao. */
  cor?: string
  /** RMS nos mesmos buckets dos picos: desenhado por cima, mais forte. */
  rms?: readonly number[]
  corRms?: string
}

/*
 * O canvas tem teto de largura no Chrome (32767 px, e menos em area). Com zoom
 * alto, a faixa passava disso, o canvas falhava calado e a onda sumia ou saia
 * cortada -- "a waveform de algumas musicas esta meio bugada". Acima deste
 * limite a resolucao horizontal cai um pouco, mas a onda continua inteira.
 */
const LARGURA_MAXIMA_DO_CANVAS = 16000

/**
 * Waveform em canvas, desenhado em cinza ao fundo da timeline. Canvas e nao SVG
 * porque sao ~2000 barras redesenhadas a cada resize.
 */
export function Waveform({ peaks, className, cor = 'rgba(255, 255, 255, 0.16)', rms, corRms }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const parent = canvas.parentElement
      if (!parent) return

      const dpr = window.devicePixelRatio || 1
      const cssWidth = parent.clientWidth
      const cssHeight = parent.clientHeight
      if (cssWidth === 0 || cssHeight === 0) return

      const escalaX = Math.min(dpr, LARGURA_MAXIMA_DO_CANVAS / cssWidth)
      canvas.width = Math.max(1, Math.round(cssWidth * escalaX))
      canvas.height = Math.round(cssHeight * dpr)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.scale(escalaX, dpr)
      ctx.clearRect(0, 0, cssWidth, cssHeight)

      const midline = cssHeight / 2
      const barWidth = 2
      const gap = 1
      const stride = barWidth + gap
      const barCount = Math.max(Math.floor(cssWidth / stride), 1)

      const camada = (valores: readonly number[], cor: string, media: boolean): void => {
        ctx.fillStyle = cor
        for (let i = 0; i < barCount; i++) {
          // Reamostra para o numero de barras que cabem na largura atual. Com
          // MENOS valores que barras, interpola entre os vizinhos em vez de
          // repetir o mesmo -- repetido, a onda virava escada.
          const exato = ((i + 0.5) / barCount) * valores.length - 0.5
          let valor: number
          if (valores.length < barCount) {
            const a = Math.max(0, Math.floor(exato))
            const b = Math.min(valores.length - 1, a + 1)
            const t = Math.min(Math.max(exato - a, 0), 1)
            valor = (valores[a] ?? 0) * (1 - t) + (valores[b] ?? 0) * t
          } else {
            const from = Math.floor((i / barCount) * valores.length)
            const to = Math.max(Math.floor(((i + 1) / barCount) * valores.length), from + 1)
            valor = 0
            let soma = 0
            for (let p = from; p < to && p < valores.length; p++) {
              const v = valores[p] ?? 0
              if (v > valor) valor = v
              soma += v
            }
            if (media) valor = soma / Math.max(to - from, 1)
          }
          // Piso de 1px para o silencio continuar legivel como linha.
          const amplitude = Math.max(valor * (midline - 2), 0.5)
          ctx.fillRect(i * stride, midline - amplitude, barWidth, amplitude * 2)
        }
      }

      camada(peaks, cor, false)
      // O RMS fica ~1/3 do pico numa musica alta; dobrado ele aparece, e o
      // contorno do pico continua por tras.
      if (rms && rms.length > 0) camada(rms.map((v) => Math.min(1, v * 2)), corRms ?? cor, true)
    }

    draw()

    const parent = canvas.parentElement
    if (!parent) return
    const observer = new ResizeObserver(draw)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [peaks, cor, rms, corRms])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
