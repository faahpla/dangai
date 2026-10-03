import { useRef, useState } from 'react'
import { CURVA_DA_ENTRADA_PADRAO, escalaDaEntrada, type CurvaDaEntrada } from '@shared/contract'

/**
 * O grafico da entrada elastica: ESCALA (vertical) ao longo da entrada
 * (horizontal).
 *
 * "Quero ter mais controle sobre essa animacao elastica, um grafico de curvas
 * configuravel." Arrasta os pontos; clique duplo no vazio cria um ponto; clique
 * duplo num ponto apaga. A linha tracejada e o tamanho normal da legenda -- o
 * que fica acima dela e o "repique". O primeiro ponto so sobe e desce (e o
 * tamanho com que ela aparece), e o ultimo e fixo: toda entrada termina no
 * tamanho normal.
 */

const W = 236
const H = 132
const PAD = 10
/** A escala vai de 0 a 1,6 no grafico -- repique alem disso vira salto. */
const V_MAX = 1.6

const xDe = (t: number): number => PAD + t * (W - 2 * PAD)
const yDe = (v: number): number => H - PAD - (v / V_MAX) * (H - 2 * PAD)
const tDe = (x: number): number => Math.min(Math.max((x - PAD) / (W - 2 * PAD), 0), 1)
const vDe = (y: number): number => Math.min(Math.max(((H - PAD - y) / (H - 2 * PAD)) * V_MAX, 0), V_MAX)

/** Formatos prontos, para partir de algum lugar. */
const PRONTAS: { nome: string; curva: CurvaDaEntrada }[] = [
  { nome: 'Padrao', curva: CURVA_DA_ENTRADA_PADRAO },
  {
    nome: 'Pop',
    curva: [
      { t: 0, v: 0.3 },
      { t: 0.35, v: 1.25 },
      { t: 0.65, v: 0.94 },
      { t: 1, v: 1 },
    ],
  },
  {
    nome: 'Repique duplo',
    curva: [
      { t: 0, v: 0.5 },
      { t: 0.25, v: 1.18 },
      { t: 0.45, v: 0.9 },
      { t: 0.65, v: 1.06 },
      { t: 0.82, v: 0.98 },
      { t: 1, v: 1 },
    ],
  },
  {
    nome: 'Suave',
    curva: [
      { t: 0, v: 0.8 },
      { t: 0.6, v: 1.02 },
      { t: 1, v: 1 },
    ],
  },
]

export function CurvaDaEntradaEditor({
  curva,
  onChange,
}: {
  curva: CurvaDaEntrada
  onChange: (curva: CurvaDaEntrada) => void
}) {
  const svg = useRef<SVGSVGElement | null>(null)
  const [arrastando, setArrastando] = useState<number | null>(null)

  const pontos = [...curva].sort((a, b) => a.t - b.t)
  const ultimo = pontos.length - 1

  const noGrafico = (evento: { clientX: number; clientY: number }): { t: number; v: number } => {
    const caixa = svg.current!.getBoundingClientRect()
    // O SVG pode estar escalado pelo CSS: a conta e no sistema do viewBox.
    const x = ((evento.clientX - caixa.left) / caixa.width) * W
    const y = ((evento.clientY - caixa.top) / caixa.height) * H
    return { t: tDe(x), v: vDe(y) }
  }

  const mover = (i: number, alvo: { t: number; v: number }): void => {
    const novos = pontos.map((p) => ({ ...p }))
    if (i === ultimo) return // o fim e fixo
    const antes = pontos[i - 1]
    const depois = pontos[i + 1]
    // O ponto nao atravessa os vizinhos: a ordem no tempo e a da curva.
    const t = i === 0 ? 0 : Math.min(Math.max(alvo.t, (antes?.t ?? 0) + 0.02), (depois?.t ?? 1) - 0.02)
    novos[i] = { t: Math.round(t * 1000) / 1000, v: Math.round(alvo.v * 1000) / 1000 }
    onChange(novos)
  }

  // A curva desenhada: a mesma interpolacao do video, amostrada.
  const caminho = Array.from({ length: 81 }, (_, k) => {
    const t = k / 80
    return `${k === 0 ? 'M' : 'L'}${xDe(t).toFixed(1)},${yDe(escalaDaEntrada(pontos, t)).toFixed(1)}`
  }).join(' ')

  return (
    <div className="mt-2">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none rounded-sm border border-line bg-bg"
        onPointerMove={(e) => {
          if (arrastando !== null) mover(arrastando, noGrafico(e))
        }}
        onPointerUp={() => setArrastando(null)}
        onPointerLeave={() => setArrastando(null)}
        onDoubleClick={(e) => {
          if (e.target !== svg.current && (e.target as Element).tagName !== 'path') return
          if (pontos.length >= 10) return
          const novo = noGrafico(e)
          if (novo.t <= 0.02 || novo.t >= 0.98) return
          onChange([...pontos, { t: Math.round(novo.t * 1000) / 1000, v: Math.round(novo.v * 1000) / 1000 }])
        }}
        aria-label="Curva da entrada da legenda"
      >
        {/* O tamanho normal: acima dele e o repique. */}
        <line x1={PAD} x2={W - PAD} y1={yDe(1)} y2={yDe(1)} className="stroke-ink-3" strokeDasharray="3 3" strokeWidth={1} />
        <text x={W - PAD} y={yDe(1) - 3} textAnchor="end" className="fill-ink-3 text-[8px]">
          100%
        </text>
        <path d={caminho} fill="none" className="stroke-accent" strokeWidth={2} />
        {pontos.map((p, i) => (
          <circle
            key={i}
            cx={xDe(p.t)}
            cy={yDe(p.v)}
            r={i === ultimo ? 3.5 : 5}
            className={i === ultimo ? 'fill-ink-3' : 'cursor-grab fill-ink stroke-accent'}
            strokeWidth={1.5}
            onPointerDown={(e) => {
              if (i === ultimo) return
              e.stopPropagation()
              ;(e.target as Element).setPointerCapture?.(e.pointerId)
              setArrastando(i)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (i === 0 || i === ultimo || pontos.length <= 2) return
              onChange(pontos.filter((_, k) => k !== i))
            }}
          >
            <title>
              {i === ultimo
                ? 'Fim: tamanho normal'
                : `${Math.round(p.v * 100)}% em ${Math.round(p.t * 100)}% da entrada${i > 0 ? ' — clique duplo apaga' : ''}`}
            </title>
          </circle>
        ))}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {PRONTAS.map((p) => (
          <button
            key={p.nome}
            type="button"
            onClick={() => onChange(p.curva)}
            className="rounded-sm border border-line bg-elevated px-1.5 py-0.5 text-[10px] text-ink-3 hover:text-ink"
          >
            {p.nome}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-3">
        Arraste os pontos. Clique duplo no vazio cria um ponto; num ponto, apaga.
      </p>
    </div>
  )
}
