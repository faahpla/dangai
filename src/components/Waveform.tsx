import { useEffect, useRef } from 'react'

interface WaveformProps {
  peaks: readonly number[]
  className?: string
}

/**
 * Waveform em canvas, desenhado em cinza ao fundo da timeline. Canvas e nao SVG
 * porque sao ~2000 barras redesenhadas a cada resize.
 */
export function Waveform({ peaks, className }: WaveformProps) {
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

      canvas.width = Math.round(cssWidth * dpr)
      canvas.height = Math.round(cssHeight * dpr)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, cssWidth, cssHeight)

      const midline = cssHeight / 2
      const barWidth = 2
      const gap = 1
      const stride = barWidth + gap
      const barCount = Math.max(Math.floor(cssWidth / stride), 1)

      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)'

      for (let i = 0; i < barCount; i++) {
        // Reamostra os picos para o numero de barras que cabem na largura atual.
        const from = Math.floor((i / barCount) * peaks.length)
        const to = Math.max(Math.floor(((i + 1) / barCount) * peaks.length), from + 1)

        let peak = 0
        for (let p = from; p < to && p < peaks.length; p++) {
          const value = peaks[p]
          if (value !== undefined && value > peak) peak = value
        }

        // Piso de 1px para o silencio continuar legivel como linha.
        const amplitude = Math.max(peak * (midline - 2), 0.5)
        ctx.fillRect(i * stride, midline - amplitude, barWidth, amplitude * 2)
      }
    }

    draw()

    const parent = canvas.parentElement
    if (!parent) return
    const observer = new ResizeObserver(draw)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [peaks])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
