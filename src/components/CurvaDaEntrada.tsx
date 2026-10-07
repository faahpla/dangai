import { useRef, useState } from 'react'
import { Download, Pencil, Upload } from 'lucide-react'
import { useProject } from '@/store/project'
import { removerCurvaDeEntrada, salvarCurvaDeEntrada } from '@/store/estilo-legenda'
import { CURVA_DA_ENTRADA_PADRAO, alcasDaEntrada, curvaDaEntradaSchema, escalaDaEntrada, type CurvaDaEntrada } from '@shared/contract'

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
  /*
   * EASY EASE, o do After Effects: dois pontos com as alcas DEITADAS a um
   * terco -- sai parado, acelera no meio e pousa parado, sem passar do tamanho.
   */
  {
    nome: 'Easy Ease',
    curva: [
      { t: 0, v: 0.6, sai: { dt: 1 / 3, dv: 0 } },
      { t: 1, v: 1, ent: { dt: -1 / 3, dv: 0 } },
    ],
  },
  {
    nome: 'Easy Ease do zero',
    curva: [
      { t: 0, v: 0, sai: { dt: 1 / 3, dv: 0 } },
      { t: 1, v: 1, ent: { dt: -1 / 3, dv: 0 } },
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

/*
 * AS PRONTAS QUE ELE ESCONDEU: "me da a possibilidade de deletar os presets
 * padrao que eu nao quiser". Ficam escondidas nesta maquina (localStorage); o
 * "restaurar" traz todas de volta.
 */
const CHAVE_OCULTAS = 'dangai.curvasProntasOcultas'
function lerOcultas(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CHAVE_OCULTAS) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function gravarOcultas(lista: string[]): void {
  try {
    localStorage.setItem(CHAVE_OCULTAS, JSON.stringify(lista))
  } catch {
    /* vale so nesta sessao */
  }
}

/*
 * EXPORTAR E IMPORTAR CURVAS: "deixa exportar um preset, e que outra pessoa
 * possa importar o mesmo". Um arquivo .dangai-curva e um JSON pequeno; o import
 * confere tudo pelo schema antes de guardar, e nome repetido ganha um numero.
 */
const TIPO_DO_ARQUIVO = 'dangai.curva-da-entrada'

async function exportarCurva(nome: string, curva: CurvaDaEntrada): Promise<void> {
  const conteudo = JSON.stringify({ tipo: TIPO_DO_ARQUIVO, versao: 1, nome, curva }, null, 2)
  await window.dangai.exportarTexto({
    titulo: 'Exportar curva da entrada',
    nome,
    extensao: 'dangai-curva',
    descricao: 'Curva da entrada do Dangai',
    conteudo,
  })
}

async function importarCurva(): Promise<string | null> {
  const r = await window.dangai.importarTexto({
    titulo: 'Importar curva da entrada',
    extensoes: ['dangai-curva'],
    descricao: 'Curva da entrada do Dangai',
  })
  if (!r.ok) return r.error
  if (!r.value) return null
  let dados: unknown
  try {
    dados = JSON.parse(r.value.conteudo)
  } catch {
    return 'Esse arquivo nao e uma curva do Dangai.'
  }
  const bruto = dados as { tipo?: unknown; nome?: unknown; curva?: unknown }
  const curva = curvaDaEntradaSchema.safeParse(bruto?.curva)
  if (bruto?.tipo !== TIPO_DO_ARQUIVO || !curva.success) return 'Esse arquivo nao e uma curva do Dangai.'
  const base = (typeof bruto.nome === 'string' && bruto.nome.trim() ? bruto.nome.trim() : r.value.nome).slice(0, 26)
  const usados = new Set(useProject.getState().curvasDeEntrada.map((c) => c.nome))
  let nome = base
  for (let n = 2; usados.has(nome); n++) nome = `${base} (${n})`
  salvarCurvaDeEntrada(nome, curva.data)
  return `"${nome}" importada.`
}

/** Escala do grafico: px por unidade de tempo e de escala (para alinhar alcas pelo angulo na tela). */
const SX = W - 2 * PAD
const SY = (H - 2 * PAD) / V_MAX
const arred = (v: number): number => Math.round(v * 1000) / 1000

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
  const [ocultas, setOcultas] = useState<string[]>(lerOcultas)
  const [recado, setRecado] = useState<string | null>(null)
  /*
   * O PONTO ESCOLHIDO mostra as alcas dele, como no Blender: puxar uma alca
   * muda a inclinacao e a suavidade da curva naquele ponto. As duas alcas
   * andam alinhadas (curva lisa); com Alt, so a puxada anda (quina).
   */
  const [escolhido, setEscolhido] = useState<number | null>(null)
  const [puxando, setPuxando] = useState<{ i: number; qual: 'ent' | 'sai' } | null>(null)

  const pontos = [...curva].sort((a, b) => a.t - b.t)
  const ultimo = pontos.length - 1
  const alcas = alcasDaEntrada(pontos)
  const sel = escolhido !== null && escolhido <= ultimo ? escolhido : null

  /** Puxa uma alca ate o ponteiro; a do outro lado gira junto, salvo com Alt. */
  const puxarAlca = (i: number, qual: 'ent' | 'sai', alvo: { t: number; v: number }, livre: boolean): void => {
    const p = pontos[i]!
    let dt = alvo.t - p.t
    const dv = alvo.v - p.v
    dt = qual === 'sai' ? Math.max(dt, 0.005) : Math.min(dt, -0.005)
    const nova = { dt: arred(dt), dv: arred(dv) }
    const outra: 'ent' | 'sai' = qual === 'sai' ? 'ent' : 'sai'
    const temOutra = qual === 'sai' ? i > 0 : i < ultimo
    const novos = pontos.map((q) => ({ ...q }))
    const ponto = { ...novos[i]!, [qual]: nova }
    if (temOutra) {
      const efetiva = alcas[i]![outra]
      if (livre) {
        ponto[outra] = { dt: arred(efetiva.dt), dv: arred(efetiva.dv) }
      } else {
        // Alinhada: mesma reta, sentido contrario, comprimento (na tela) dela.
        const comp = Math.hypot(efetiva.dt * SX, efetiva.dv * SY)
        const dir = Math.hypot(nova.dt * SX, nova.dv * SY) || 1
        ponto[outra] = {
          dt: arred((-nova.dt * SX * comp) / dir / SX),
          dv: arred((-nova.dv * SY * comp) / dir / SY),
        }
      }
    }
    novos[i] = ponto
    onChange(novos)
  }

  /** Os botoes do ponto escolhido. */
  const formaDoPonto = (i: number, forma: 'suave' | 'auto' | 'quina'): void => {
    const novos = pontos.map((q) => ({ ...q }))
    const p = novos[i]!
    const antes = i > 0 ? p.t - pontos[i - 1]!.t : 0
    const depois = i < ultimo ? pontos[i + 1]!.t - p.t : 0
    if (forma === 'auto') {
      delete p.ent
      delete p.sai
    } else if (forma === 'suave') {
      // Deitadas a um terco: o "easy ease" daquele ponto.
      if (i > 0) p.ent = { dt: arred(-antes / 3), dv: 0 }
      if (i < ultimo) p.sai = { dt: arred(depois / 3), dv: 0 }
    } else {
      // Quina: cada alca aponta para o vizinho -- a curva chega e sai reta.
      if (i > 0) p.ent = { dt: arred(-antes / 3), dv: arred((pontos[i - 1]!.v - p.v) / 3) }
      if (i < ultimo) p.sai = { dt: arred(depois / 3), dv: arred((pontos[i + 1]!.v - p.v) / 3) }
    }
    onChange(novos)
  }

  /** Suavidade do ponto: o comprimento das alcas, como fracao do vao ate o vizinho. */
  const suavidadeDe = (i: number): number => {
    const antes = i > 0 ? pontos[i]!.t - pontos[i - 1]!.t : 0
    const depois = i < ultimo ? pontos[i + 1]!.t - pontos[i]!.t : 0
    return depois > 0 ? alcas[i]!.sai.dt / depois : antes > 0 ? -alcas[i]!.ent.dt / antes : 1 / 3
  }
  const mudarSuavidade = (i: number, f: number): void => {
    const novos = pontos.map((q) => ({ ...q }))
    const p = novos[i]!
    const antes = i > 0 ? p.t - pontos[i - 1]!.t : 0
    const depois = i < ultimo ? pontos[i + 1]!.t - p.t : 0
    const { ent, sai } = alcas[i]!
    // Mantem a inclinacao de cada alca; muda so o comprimento.
    if (i > 0) {
      const incl = ent.dt !== 0 ? ent.dv / ent.dt : 0
      p.ent = { dt: arred(-f * antes), dv: arred(-f * antes * incl) }
    }
    if (i < ultimo) {
      const incl = sai.dt !== 0 ? sai.dv / sai.dt : 0
      p.sai = { dt: arred(f * depois), dv: arred(f * depois * incl) }
    }
    onChange(novos)
  }

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
    // As alcas vao junto: elas sao relativas ao ponto.
    novos[i] = { ...novos[i]!, t: Math.round(t * 1000) / 1000, v: Math.round(alvo.v * 1000) / 1000 }
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
          // Clique no vazio do grafico solta o ponto escolhido.
          if (!desenhando && e.target === svg.current) setEscolhido(null)
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
          if (puxando) {
            puxarAlca(puxando.i, puxando.qual, noGrafico(e), e.altKey)
            return
          }
          if (arrastando !== null) mover(arrastando, noGrafico(e))
        }}
        onPointerUp={() => {
          setArrastando(null)
          setPuxando(null)
          if (desenhando && risco && risco.length > 2) {
            // As pontas sao fixas (o comeco em t = 0, o fim em 100%): o risco
            // que encosta nelas sai, senao sobram dois pontos no mesmo instante.
            const miolo = risco.filter((p) => p.t > 0.03 && p.t < 0.97)
            onChange(simplificar([{ t: 0, v: risco[0]!.v }, ...miolo, { t: 1, v: 1 }]))
            setDesenhando(false)
          }
          setRisco(null)
        }}
        onPointerLeave={() => {
          setArrastando(null)
          setPuxando(null)
        }}
        onDoubleClick={(e) => {
          if (e.target !== svg.current && (e.target as Element).tagName !== 'path') return
          if (pontos.length >= 10) return
          const novo = noGrafico(e)
          if (novo.t <= 0.02 || novo.t >= 0.98) return
          onChange([...pontos, { t: Math.round(novo.t * 1000) / 1000, v: Math.round(novo.v * 1000) / 1000 }])
          setEscolhido(null)
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
        {/* As alcas do ponto escolhido. */}
        {sel !== null &&
          !desenhando &&
          (['ent', 'sai'] as const).map((qual) => {
            if ((qual === 'ent' && sel === 0) || (qual === 'sai' && sel === ultimo)) return null
            const p = pontos[sel]!
            const a = alcas[sel]![qual]
            const x = xDe(p.t + a.dt)
            const y = yDe(p.v + a.dv)
            return (
              <g key={qual}>
                <line x1={xDe(p.t)} y1={yDe(p.v)} x2={x} y2={y} stroke="#f6a23c" strokeWidth={1} />
                <circle
                  cx={x}
                  cy={y}
                  r={4}
                  fill="#1a1a1d"
                  stroke="#f6a23c"
                  strokeWidth={1.5}
                  className="cursor-move"
                  data-alca={qual}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    ;(e.target as Element).setPointerCapture?.(e.pointerId)
                    setPuxando({ i: sel, qual })
                  }}
                >
                  <title>Alca: puxe para mudar a suavidade e a inclinacao. Alt solta da outra.</title>
                </circle>
              </g>
            )
          })}
        {pontos.map((p, i) => (
          <circle
            key={i}
            cx={xDe(p.t)}
            cy={yDe(p.v)}
            r={i === ultimo ? 4 : 5}
            className={[
              i === ultimo ? 'cursor-pointer fill-ink-3' : 'cursor-grab fill-ink',
              i === sel ? 'stroke-[#f6a23c]' : 'stroke-accent',
            ].join(' ')}
            // Desenhando, os pontos nao pegam o clique: o risco comeca onde
            // ele clicar, mesmo que seja em cima de um ponto.
            style={desenhando ? { pointerEvents: 'none' } : undefined}
            strokeWidth={1.5}
            onPointerDown={(e) => {
              e.stopPropagation()
              setEscolhido(i)
              if (i === ultimo) return // o fim nao anda, mas a alca dele sim
              ;(e.target as Element).setPointerCapture?.(e.pointerId)
              setArrastando(i)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (i === 0 || i === ultimo || pontos.length <= 2) return
              onChange(pontos.filter((_, k) => k !== i))
              setEscolhido(null)
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
      {sel !== null && !desenhando && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 rounded-sm border border-line bg-elevated/60 px-1.5 py-1">
          <span className="mr-0.5 text-[10px] text-ink-3">
            {sel === 0 ? 'Inicio' : sel === ultimo ? 'Fim' : `Ponto ${sel + 1}`}:
          </span>
          {(
            [
              ['suave', 'Easy ease', 'Alcas deitadas: a curva chega e sai devagar deste ponto'],
              ['auto', 'Auto', 'Volta a suavidade automatica'],
              ['quina', 'Quina', 'Chega e sai reta, sem suavizar'],
            ] as const
          ).map(([forma, rotulo, dica]) => (
            <button
              key={forma}
              type="button"
              title={dica}
              onClick={() => formaDoPonto(sel, forma)}
              className="rounded-sm border border-line bg-elevated px-1.5 py-0.5 text-[10px] text-ink-2 hover:text-ink"
            >
              {rotulo}
            </button>
          ))}
          <label className="ml-1 flex min-w-[110px] flex-1 items-center gap-1.5 text-[10px] text-ink-3" title="O comprimento das alcas: mais longa, mais suave">
            Suavidade
            <input
              type="range"
              min={0.02}
              max={1}
              step={0.01}
              value={Math.min(Math.max(suavidadeDe(sel), 0.02), 1)}
              onChange={(e) => mudarSuavidade(sel, Number(e.target.value))}
              aria-label="Suavidade do ponto escolhido"
              className="dangai-range min-w-0 flex-1"
            />
            <span className="tnum w-7 text-right">{Math.round(suavidadeDe(sel) * 100)}%</span>
          </label>
        </div>
      )}
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
        {PRONTAS.filter((p) => !ocultas.includes(p.nome)).map((p) => (
          <span key={p.nome} className="group/pronta flex items-center rounded-sm border border-line bg-elevated">
            <button
              type="button"
              onClick={() => {
                onChange(p.curva)
                setEscolhido(null)
              }}
              className="px-1.5 py-0.5 text-[10px] text-ink-3 hover:text-ink"
            >
              {p.nome}
            </button>
            <button
              type="button"
              onClick={() => {
                const novas = [...ocultas, p.nome]
                setOcultas(novas)
                gravarOcultas(novas)
              }}
              aria-label={`Esconder a curva pronta ${p.nome}`}
              title="Esconder esta pronta (o restaurar traz de volta)"
              className="pr-1 text-[10px] text-ink-3 opacity-0 hover:text-danger group-hover/pronta:opacity-100"
            >
              ×
            </button>
          </span>
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
              onClick={() => void exportarCurva(g.nome, g.curva)}
              aria-label={`Exportar a curva ${g.nome}`}
              title="Exportar para um arquivo .dangai-curva (para mandar para outra pessoa)"
              className="px-0.5 text-ink-3 opacity-0 hover:text-ink group-hover/curva:opacity-100"
            >
              <Upload size={9} strokeWidth={2} />
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
        <button
          type="button"
          onClick={() => void importarCurva().then(setRecado)}
          title="Importar uma curva que alguem exportou (.dangai-curva)"
          className="flex items-center gap-1 rounded-sm border border-dashed border-line px-1.5 py-0.5 text-[10px] text-ink-3 hover:text-ink-2"
        >
          <Download size={9} strokeWidth={2} />
          Importar
        </button>
        <button
          type="button"
          onClick={() => void exportarCurva('curva', pontos)}
          title="Exportar a curva que esta no grafico agora"
          className="flex items-center gap-1 rounded-sm border border-dashed border-line px-1.5 py-0.5 text-[10px] text-ink-3 hover:text-ink-2"
        >
          <Upload size={9} strokeWidth={2} />
          Exportar a atual
        </button>
        {recado && <span className="w-full text-[10px] text-accent">{recado}</span>}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-3">
        Arraste os pontos, ou desenhe a mao. Clique num ponto para ver as alcas (Alt solta uma da outra). Clique duplo
        no vazio cria um ponto; num ponto, apaga.
        {ocultas.length > 0 && (
          <>
            {' '}
            <button
              type="button"
              onClick={() => {
                setOcultas([])
                gravarOcultas([])
              }}
              className="text-ink-2 underline decoration-dotted underline-offset-2 hover:text-ink"
            >
              Restaurar as {ocultas.length} prontas escondidas
            </button>
          </>
        )}
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
