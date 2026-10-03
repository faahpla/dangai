import { useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { useProject } from '@/store/project'
import { removerCurvaDeEntrada, salvarCurvaDeEntrada } from '@/store/estilo-legenda'
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
  /*
   * DESENHAR A MAO: "deixa eu desenhar uma propria". Ligado, arrastar no
   * grafico risca a curva; ao soltar, o risco vira pontos editaveis (no maximo
   * dez), e dali em diante e uma curva como as outras.
   */
  const [desenhando, setDesenhando] = useState(false)
  const [risco, setRisco] = useState<{ t: number; v: number }[] | null>(null)
  const guardadas = useProject((s) => s.curvasDeEntrada)
  const [nomeando, setNomeando] = useState(false)
  const [nome, setNome] = useState('')

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
        className={[
          'w-full touch-none select-none rounded-sm border bg-bg',
          desenhando ? 'cursor-crosshair border-accent' : 'border-line',
        ].join(' ')}
        onPointerDown={(e) => {
          if (!desenhando) return
          const alvo = e.target as Element
          alvo.setPointerCapture?.(e.pointerId)
          setRisco([noGrafico(e)])
        }}
        onPointerMove={(e) => {
          if (desenhando && risco) {
            const p = noGrafico(e)
            // So anda para a frente no tempo: a curva e uma funcao do tempo.
            if (p.t > risco.at(-1)!.t) setRisco([...risco, p])
            return
          }
          if (arrastando !== null) mover(arrastando, noGrafico(e))
        }}
        onPointerUp={() => {
          setArrastando(null)
          if (desenhando && risco && risco.length > 2) {
            // As pontas sao fixas (o comeco em t = 0, o fim em 100%): o risco
            // que encosta nelas sai, senao sobram dois pontos no mesmo instante.
            const miolo = risco.filter((p) => p.t > 0.03 && p.t < 0.97)
            onChange(simplificar([{ t: 0, v: risco[0]!.v }, ...miolo, { t: 1, v: 1 }]))
            setDesenhando(false)
          }
          setRisco(null)
        }}
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
        {risco ? (
          <path
            d={risco.map((p, k) => `${k === 0 ? 'M' : 'L'}${xDe(p.t).toFixed(1)},${yDe(p.v).toFixed(1)}`).join(' ')}
            fill="none"
            className="stroke-ink"
            strokeWidth={2}
          />
        ) : (
          <path d={caminho} fill="none" className="stroke-accent" strokeWidth={2} />
        )}
        {pontos.map((p, i) => (
          <circle
            key={i}
            cx={xDe(p.t)}
            cy={yDe(p.v)}
            r={i === ultimo ? 3.5 : 5}
            className={i === ultimo ? 'fill-ink-3' : 'cursor-grab fill-ink stroke-accent'}
            // Desenhando, os pontos nao pegam o clique: o risco comeca onde
            // ele clicar, mesmo que seja em cima de um ponto.
            style={desenhando ? { pointerEvents: 'none' } : undefined}
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
        <button
          type="button"
          onClick={() => setDesenhando((v) => !v)}
          aria-pressed={desenhando}
          className={[
            'flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px]',
            desenhando ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:text-ink',
          ].join(' ')}
        >
          <Pencil size={9} strokeWidth={1.75} />
          {desenhando ? 'Risque no grafico...' : 'Desenhar a mao'}
        </button>
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
        {guardadas.map((g) => (
          <span key={g.nome} className="group/curva flex items-center rounded-sm border border-accent/40 bg-elevated">
            <button
              type="button"
              onClick={() => onChange(g.curva)}
              className="px-1.5 py-0.5 text-[10px] text-ink-2 hover:text-ink"
            >
              {g.nome}
            </button>
            <button
              type="button"
              onClick={() => removerCurvaDeEntrada(g.nome)}
              aria-label={`Apagar a curva ${g.nome}`}
              className="pr-1 text-[10px] text-ink-3 opacity-0 hover:text-danger group-hover/curva:opacity-100"
            >
              ×
            </button>
          </span>
        ))}
        {nomeando ? (
          <input
            autoFocus
            value={nome}
            maxLength={30}
            placeholder="Nome da curva"
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                salvarCurvaDeEntrada(nome, curva)
                setNomeando(false)
                setNome('')
              }
              if (e.key === 'Escape') setNomeando(false)
            }}
            onBlur={() => {
              if (nome.trim()) salvarCurvaDeEntrada(nome, curva)
              setNomeando(false)
              setNome('')
            }}
            className="w-28 rounded-sm border border-accent bg-elevated px-1.5 py-0.5 text-[10px] text-ink focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setNomeando(true)}
            className="rounded-sm border border-dashed border-line px-1.5 py-0.5 text-[10px] text-ink-3 hover:text-ink-2"
          >
            + Salvar curva
          </button>
        )}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-3">
        Arraste os pontos, ou desenhe a mao. Clique duplo no vazio cria um ponto; num ponto, apaga.
      </p>
    </div>
  )
}

/**
 * O risco a mao vira no maximo dez pontos (Ramer-Douglas-Peucker): fica so o
 * que muda a forma -- os picos, os vales, as viradas --, e o resto e reta.
 */
function simplificar(pts: { t: number; v: number }[]): CurvaDaEntrada {
  const rdp = (lista: { t: number; v: number }[], eps: number): { t: number; v: number }[] => {
    if (lista.length < 3) return lista
    const a = lista[0]!
    const b = lista.at(-1)!
    let maior = 0
    let idx = 0
    for (let i = 1; i < lista.length - 1; i++) {
      const p = lista[i]!
      // A distancia vertical ate a reta a-b, no instante do ponto.
      const f = (p.t - a.t) / Math.max(b.t - a.t, 1e-9)
      const d = Math.abs(p.v - (a.v + (b.v - a.v) * f))
      if (d > maior) {
        maior = d
        idx = i
      }
    }
    if (maior <= eps) return [a, b]
    return [...rdp(lista.slice(0, idx + 1), eps).slice(0, -1), ...rdp(lista.slice(idx), eps)]
  }
  let eps = 0.01
  let r = rdp(pts, eps)
  while (r.length > 10) {
    eps *= 1.5
    r = rdp(pts, eps)
  }
  // Pontos colados demais no tempo viram um so: o grafico nao os separa, e o
  // arraste de um levaria o outro junto.
  const espacados = r.filter((p, i) => i === 0 || i === r.length - 1 || (p.t - r[i - 1]!.t >= 0.03 && r.at(-1)!.t - p.t >= 0.03))
  return espacados.map((p) => ({
    t: Math.round(p.t * 1000) / 1000,
    v: Math.round(Math.min(Math.max(p.v, 0), 2) * 1000) / 1000,
  }))
}
