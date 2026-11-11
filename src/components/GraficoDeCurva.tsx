import { useRef, useState } from 'react'

/**
 * O GRAFICO DA CURVA: dois pontos de controle arrastaveis (o cubic-bezier do CSS).
 *
 * Horizontal e o tempo, vertical e quanto do movimento ja aconteceu. Trecho
 * plano e uma pausa, trecho ingreme e uma disparada -- e o mesmo desenho de
 * qualquer editor de video, que e onde ele ja sabe ler isto.
 *
 * Na camera dos blocos A CAIXA E O LIMITE: arrastar para fora nao passa de 0..1.
 * Fora dessa faixa a curva ultrapassaria o fim do movimento e voltaria, e o pan
 * comeria a folga de borda que existe para nunca aparecer tarja preta.
 *
 * Na animacao por quadros-chave (`livre`) o ultrapassar e justamente o que ele
 * quer as vezes -- passar do ponto e voltar, recuar antes de ir --, e nao ha
 * borda para proteger: os pontos podem subir ate meio grafico acima e descer
 * meio grafico abaixo da caixa.
 */
export function GraficoDeCurva({
  pontos,
  onChange,
  livre = false,
}: {
  pontos: readonly [number, number, number, number]
  onChange: (pontos: [number, number, number, number]) => void
  livre?: boolean
}) {
  const area = useRef<SVGSVGElement>(null)
  const [arrastando, setArrastando] = useState<0 | 1 | null>(null)
  const [x1, y1, x2, y2] = pontos
  // A faixa vertical que o desenho mostra (em unidades do progresso).
  const yMin = livre ? -0.6 : 0
  const yMax = livre ? 1.6 : 1
  const alto = (yMax - yMin) * 100

  const mover = (event: React.PointerEvent, qual: 0 | 1): void => {
    const caixa = area.current?.getBoundingClientRect()
    if (!caixa) return
    const x = presa(emUnidades((event.clientX - caixa.left) / caixa.width, 100), 0, 1)
    // O SVG cresce para baixo e o progresso para cima: o eixo vira aqui.
    const y = presa(yMax - emUnidades((event.clientY - caixa.top) / caixa.height, alto), yMin, yMax)
    const r = (v: number): number => Math.round(v * 1000) / 1000
    onChange(qual === 0 ? [r(x), r(y), x2, y2] : [x1, y1, r(x), r(y)])
  }

  const px = (v: number): number => v * 100
  const py = (v: number): number => (yMax - v) * 100

  return (
    <div className="flex w-[132px] shrink-0 flex-col gap-0.5">
      <svg
        ref={area}
        viewBox={`${-FOLGA} ${-FOLGA} ${100 + FOLGA * 2} ${alto + FOLGA * 2}`}
        className="w-full touch-none rounded-sm bg-elevated"
        onPointerMove={(event) => arrastando !== null && mover(event, arrastando)}
        onPointerUp={() => setArrastando(null)}
        onPointerLeave={() => setArrastando(null)}
      >
        {/* A caixa desenhada, e nao a borda do elemento: com a folga em volta, a
            borda ficaria longe do limite real e mentiria sobre onde ele esta. */}
        <rect x={0} y={py(1)} width={100} height={100} fill="none" className="stroke-line-strong" strokeWidth={0.8} />

        {/* Referencia: a diagonal e o movimento em ritmo constante. */}
        <line x1={0} y1={py(0)} x2={100} y2={py(1)} className="stroke-line-strong" strokeWidth={0.8} strokeDasharray="3 3" />

        <line x1={0} y1={py(0)} x2={px(x1)} y2={py(y1)} className="stroke-ink-3" strokeWidth={0.8} />
        <line x1={100} y1={py(1)} x2={px(x2)} y2={py(y2)} className="stroke-ink-3" strokeWidth={0.8} />

        <path
          d={`M 0 ${py(0)} C ${px(x1)} ${py(y1)}, ${px(x2)} ${py(y2)}, 100 ${py(1)}`}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
        />

        {([0, 1] as const).map((qual) => (
          <g key={qual} className="cursor-grab">
            <circle cx={px(qual === 0 ? x1 : x2)} cy={py(qual === 0 ? y1 : y2)} r={4} className="fill-accent" />
            {/* Alvo maior que a bolinha: 4 unidades dao uns 8 pixels na largura
                do card, que e pouco para pegar com o mouse. */}
            <circle
              cx={px(qual === 0 ? x1 : x2)}
              cy={py(qual === 0 ? y1 : y2)}
              r={10}
              fill="transparent"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                setArrastando(qual)
              }}
            />
          </g>
        ))}
      </svg>
      {/* Os quatro numeros: e o que ele repete em outro bloco quando acerta um ritmo. */}
      <p className="tnum text-[10px] text-ink-3">{pontos.map((v) => v.toFixed(2)).join(', ')}</p>
    </div>
  )
}

/**
 * Folga em volta da caixa, em unidades do desenho.
 *
 * A alca de um preset comum cai exatamente em cima do limite -- o ease-in-out
 * poe uma no chao e outra no teto. Sem esta folga, metade da bolinha fica fora
 * do desenho e nao da para pegar.
 */
const FOLGA = 8

/** Fracao do ELEMENTO para unidade do desenho (0..1 da caixa), descontando a folga das bordas. */
function emUnidades(fracao: number, tamanho: number): number {
  return (fracao * (tamanho + FOLGA * 2) - FOLGA) / 100
}

function presa(v: number, de: number, ate: number): number {
  return Math.min(Math.max(v, de), ate)
}
