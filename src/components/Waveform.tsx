import { useEffect, useRef } from 'react'

interface WaveformProps {
  /** Picos 0..1 cobrindo a largura INTEIRA do elemento pai. */
  peaks: readonly number[]
  className?: string
  /** Cor do pico (a forma clara de fora). Padrao: o branco translucido da narracao. */
  cor?: string
  /** RMS nos mesmos buckets dos picos: a forma mais forte de dentro. */
  rms?: readonly number[]
  corRms?: string
}

/**
 * A ONDA, desenhada so no pedaco que esta na tela.
 *
 * "Quando eu dou muito zoom na timeline a waveform fica toda bugada." O canvas
 * tinha a largura da faixa inteira -- com zoom, dezenas de milhares de pixels,
 * acima do teto do Chrome -- e a onda era espremida ou cortada. Agora o canvas
 * tem a largura do que se ve: ele procura o container que rola, mede quanto do
 * pai esta visivel e desenha so isso, de novo a cada rolagem.
 *
 * O desenho e uma FORMA cheia e espelhada, como nos editores: o pico por fora
 * (claro) e o RMS por dentro (forte). Com mais dados que pixels, cada coluna
 * pega o pico maior e o RMS medio do trecho dela; com menos (zoom alto), a
 * forma passa reta entre os pontos, sem degraus.
 */
export function Waveform({ peaks, className, cor = 'rgba(255, 255, 255, 0.16)', rms, corRms }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const pai = canvas?.parentElement
    if (!canvas || !pai) return
    const rolagem = pai.closest('.overflow-auto') as HTMLElement | null
    let quadro = 0

    const desenhar = (): void => {
      quadro = 0
      const larguraPai = pai.clientWidth
      const altura = pai.clientHeight
      if (larguraPai === 0 || altura === 0) return

      // O pedaco do pai que aparece na tela (com uma folga dos dois lados).
      const caixaPai = pai.getBoundingClientRect()
      const vista = rolagem?.getBoundingClientRect() ?? caixaPai
      const folga = 200
      const de = Math.max(0, Math.floor(vista.left - caixaPai.left - folga))
      const ate = Math.min(larguraPai, Math.ceil(vista.right - caixaPai.left + folga))
      const largura = Math.max(0, ate - de)
      canvas.style.left = `${de}px`
      canvas.style.width = `${largura}px`
      canvas.style.height = `${altura}px`
      if (largura === 0) return

      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(largura * dpr))
      canvas.height = Math.max(1, Math.round(altura * dpr))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, largura, altura)

      const meio = altura / 2
      const cabe = meio - 1
      const n = peaks.length
      if (n === 0) return

      /** O valor de uma serie na coluna x (em px do pai). */
      const amostrar = (serie: readonly number[], x: number, media: boolean): number => {
        const a = (x / larguraPai) * serie.length
        const b = ((x + 1) / larguraPai) * serie.length
        if (b - a >= 1) {
          const i0 = Math.floor(a)
          const i1 = Math.min(Math.ceil(b), serie.length)
          let max = 0
          let soma = 0
          for (let i = i0; i < i1; i++) {
            const v = serie[i] ?? 0
            if (v > max) max = v
            soma += v
          }
          return media ? soma / Math.max(i1 - i0, 1) : max
        }
        // Menos dados que pixels: reta entre os dois vizinhos.
        const c = (a + b) / 2 - 0.5
        const i = Math.max(0, Math.min(serie.length - 1, Math.floor(c)))
        const j = Math.min(serie.length - 1, i + 1)
        const t = Math.min(Math.max(c - i, 0), 1)
        return (serie[i] ?? 0) * (1 - t) + (serie[j] ?? 0) * t
      }

      const forma = (serie: readonly number[], fill: string, media: boolean, ganho: number): void => {
        const topo: number[] = new Array(largura + 1)
        for (let k = 0; k <= largura; k++) topo[k] = Math.min(1, amostrar(serie, de + k, media) * ganho) * cabe
        ctx.beginPath()
        ctx.moveTo(0, meio - topo[0]!)
        for (let k = 1; k <= largura; k++) ctx.lineTo(k, meio - topo[k]!)
        for (let k = largura; k >= 0; k--) ctx.lineTo(k, meio + topo[k]!)
        ctx.closePath()
        ctx.fillStyle = fill
        ctx.fill()
      }

      forma(peaks, cor, false, 1)
      // O RMS fica ~1/3 do pico numa musica alta; dobrado ele aparece por
      // dentro, e o pico continua como contorno por fora.
      if (rms && rms.length > 0) forma(rms, corRms ?? cor, true, 2)
      // A linha do zero: o silencio continua legivel como um fio.
      ctx.fillStyle = corRms ?? cor
      ctx.fillRect(0, meio - 0.5, largura, 1)
    }

    const pedir = (): void => {
      if (!quadro) quadro = requestAnimationFrame(desenhar)
    }
    desenhar()
    const observador = new ResizeObserver(pedir)
    observador.observe(pai)
    if (rolagem) observador.observe(rolagem)
    rolagem?.addEventListener('scroll', pedir, { passive: true })
    return () => {
      observador.disconnect()
      rolagem?.removeEventListener('scroll', pedir)
      if (quadro) cancelAnimationFrame(quadro)
    }
  }, [peaks, cor, rms, corRms])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ position: 'absolute', top: 0, left: 0 }}
      aria-hidden="true"
    />
  )
}
