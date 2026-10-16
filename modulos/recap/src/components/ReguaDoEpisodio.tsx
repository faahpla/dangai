import { useMemo, useRef, useState } from 'react'
import type { Capitulo, Exclusao, MotivoDaExclusao } from '../../shared/episodio'
import { TRECHO_MINIMO } from '../store/gerar'
import { formatarTempo } from './pecas'

/** Distancia, em pixels, em que a borda gruda num corte de cena. */
const IMA_PX = 6
/** Menos que isso de arraste e clique. */
const LIMIAR_DE_ARRASTE_PX = 3
/**
 * Para MARCAR um trecho novo no vazio, mais folga: com 3 px um clique tremido
 * virava um trecho de ~5 s (24 min em 1098 px). Ajustar uma borda segue nos 3.
 */
const LIMIAR_PARA_MARCAR_PX = 7

const CURTO: Record<MotivoDaExclusao, string> = {
  op: 'OP',
  ed: 'ED',
  preview: 'Previa',
  creditos: 'Creditos',
  // O mesmo nome do select da lista (ROTULO_DO_MOTIVO).
  manual: 'Outro',
}

/** O listrado da sugestao: "ainda nao visto", sem precisar ler legenda nenhuma. */
export const LISTRADO =
  'repeating-linear-gradient(135deg, rgb(255 61 129 / 0.22) 0 5px, rgb(255 61 129 / 0.06) 5px 10px)'

/**
 * A faixa onde os trechos ficam: de 26 px do topo ate 22 px do fundo da regua
 * (76 px com a borda; 74 por dentro, que e a base do `top` absoluto).
 */
const FAIXA_TOPO = 26
const FAIXA_ALTURA = 74 - 26 - 22

/**
 * Trechos que se sobrepoem (no episodio curto, ED 1:45-3:34 e OP 1:48-3:15)
 * caiam um em cima do outro, e o de baixo sumia. Cada trecho ganha uma
 * pista: o primeiro que nao bate com nenhum anterior fica na de cima, os
 * outros descem. Sem sobreposicao, uma pista so, do jeito de sempre.
 */
export function pistasDosTrechos(exclusoes: readonly { start: number; end: number }[]): { pista: number[]; total: number } {
  const ordem = exclusoes.map((_, i) => i).sort((a, b) => exclusoes[a]!.start - exclusoes[b]!.start)
  const fimDaPista: number[] = []
  const pista = new Array<number>(exclusoes.length).fill(0)
  for (const i of ordem) {
    const ex = exclusoes[i]!
    let p = fimDaPista.findIndex((fim) => fim <= ex.start)
    if (p === -1) {
      p = fimDaPista.length
      fimDaPista.push(ex.end)
    } else {
      fimDaPista[p] = ex.end
    }
    pista[i] = p
  }
  return { pista, total: Math.max(1, fimDaPista.length) }
}

type Arraste = {
  modo: 'inicio' | 'fim' | 'mover' | 'desenhar'
  i: number
  /** Tempo sob o ponteiro no comeco (ja imantado no desenhar). */
  t0: number
  x0: number
  start0: number
  end0: number
  moveu: boolean
}

/**
 * A REGUA DO EPISODIO: o tempo inteiro numa faixa, com as falas embaixo, os
 * cortes de cena em cima e os trechos fora do recap (OP/ED) por cima.
 *
 * As falas estao ai de proposito: abertura e encerramento sao os buracos sem
 * fala, e ver o buraco ao lado da sugestao e o que deixa confirmar com um
 * clique. Os cortes servem de ima -- a OP comeca e termina num corte, e
 * arrastar a borda ate perto dele gruda (Alt solta o ima).
 *
 * Gestos: arrastar a borda ajusta; arrastar o meio move; arrastar num espaco
 * vazio marca um trecho novo; clicar escolhe.
 */
export function ReguaDoEpisodio({
  duracao,
  exclusoes,
  selecionada,
  onSelecionar,
  onAjustar,
  onMarcar,
  falas,
  cortes,
  capitulos,
}: {
  duracao: number
  exclusoes: readonly Exclusao[]
  selecionada: number | null
  onSelecionar: (i: number | null) => void
  onAjustar: (i: number, patch: { start?: number; end?: number }) => void
  /** Devolve o indice do trecho novo na lista. */
  onMarcar: (start: number, end: number) => number
  falas: readonly { start: number; end: number }[]
  /** Em ordem crescente. */
  cortes: readonly number[]
  capitulos: readonly Capitulo[]
}) {
  const trilho = useRef<HTMLDivElement>(null)
  const arraste = useRef<Arraste | null>(null)
  const desenhoRef = useRef<{ start: number; end: number } | null>(null)
  const [desenho, setDesenho] = useState<{ start: number; end: number } | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)

  const pct = (t: number): number => (duracao > 0 ? (t / duracao) * 100 : 0)

  // Um path so para centenas de cortes e falas: o arraste redesenha a regua a cada movimento.
  const caminhoDosCortes = useMemo(() => cortes.map((c) => `M${c} 0V24`).join(''), [cortes])
  const caminhoDasFalas = useMemo(
    () => falas.map((f) => `M${f.start} 80H${Math.max(f.end, f.start + duracao / 2000)}V100H${f.start}Z`).join(''),
    [falas, duracao],
  )

  const marcas = useMemo(() => {
    const passos = [15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600]
    const passo = passos.find((p) => duracao / p <= 10) ?? 3600
    const lista: number[] = []
    for (let t = 0; t <= duracao + 0.001; t += passo) lista.push(t)
    return { lista, passo }
  }, [duracao])

  const pistas = useMemo(() => pistasDosTrechos(exclusoes), [exclusoes])

  const tempoNoX = (clientX: number): number => {
    const r = trilho.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return 0
    return Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * duracao
  }

  const imantar = (t: number, livre: boolean): number => {
    if (livre || cortes.length === 0) return t
    const largura = trilho.current?.getBoundingClientRect().width ?? 0
    if (largura <= 0) return t
    const limiar = (IMA_PX / largura) * duracao
    // Busca binaria: o primeiro corte >= t, e o vizinho de antes.
    let lo = 0
    let hi = cortes.length - 1
    while (lo < hi) {
      const meio = (lo + hi) >> 1
      if (cortes[meio]! < t) lo = meio + 1
      else hi = meio
    }
    let melhor = t
    let distancia = limiar
    for (const j of [lo - 1, lo]) {
      const c = cortes[j]
      if (c !== undefined && Math.abs(c - t) <= distancia) {
        melhor = c
        distancia = Math.abs(c - t)
      }
    }
    return melhor
  }

  const terminar = (): void => {
    arraste.current = null
    desenhoRef.current = null
    setDesenho(null)
  }

  return (
    <div className="flex flex-col gap-1 pt-5">
      <div
        ref={trilho}
        role="group"
        aria-label="Regua do episodio"
        onPointerDown={(e) => {
          if (e.button !== 0 || duracao <= 0) return
          const alvo = (e.target as HTMLElement).closest<HTMLElement>('[data-ex]')
          const t = tempoNoX(e.clientX)
          e.currentTarget.setPointerCapture(e.pointerId)
          if (alvo) {
            const i = Number(alvo.dataset['ex'])
            const ex = exclusoes[i]
            if (!ex) return
            const borda = alvo.dataset['borda']
            onSelecionar(i)
            arraste.current = {
              modo: borda === 'inicio' ? 'inicio' : borda === 'fim' ? 'fim' : 'mover',
              i,
              t0: t,
              x0: e.clientX,
              start0: ex.start,
              end0: ex.end,
              moveu: false,
            }
          } else {
            arraste.current = {
              modo: 'desenhar',
              i: -1,
              t0: imantar(t, e.altKey),
              x0: e.clientX,
              start0: 0,
              end0: 0,
              moveu: false,
            }
          }
        }}
        onPointerMove={(e) => {
          const t = tempoNoX(e.clientX)
          const a = arraste.current
          if (!a) {
            setCursor(t)
            return
          }
          // Clique para escolher nao pode virar ajuste: so conta depois de uns pixels.
          const limiar = a.modo === 'desenhar' ? LIMIAR_PARA_MARCAR_PX : LIMIAR_DE_ARRASTE_PX
          if (!a.moveu && Math.abs(e.clientX - a.x0) < limiar) return
          a.moveu = true
          const livre = e.altKey
          if (a.modo === 'inicio') {
            const s = imantar(Math.min(t, a.end0 - TRECHO_MINIMO), livre)
            onAjustar(a.i, { start: s })
            setCursor(s)
          } else if (a.modo === 'fim') {
            const f = imantar(Math.max(t, a.start0 + TRECHO_MINIMO), livre)
            onAjustar(a.i, { end: f })
            setCursor(f)
          } else if (a.modo === 'mover') {
            const largura = a.end0 - a.start0
            let s = Math.min(Math.max(a.start0 + (t - a.t0), 0), Math.max(0, duracao - largura))
            const inicioImantado = imantar(s, livre)
            if (inicioImantado !== s) s = inicioImantado
            else {
              const fimImantado = imantar(s + largura, livre)
              if (fimImantado !== s + largura) s = fimImantado - largura
            }
            onAjustar(a.i, { start: s, end: s + largura })
            setCursor(s)
          } else {
            const p = imantar(t, livre)
            const novo = { start: Math.min(a.t0, p), end: Math.max(a.t0, p) }
            desenhoRef.current = novo
            setDesenho(novo)
            setCursor(p)
          }
        }}
        onPointerUp={() => {
          const a = arraste.current
          const d = desenhoRef.current
          terminar()
          if (!a || a.modo !== 'desenhar') return
          if (a.moveu && d && d.end - d.start >= TRECHO_MINIMO) onSelecionar(onMarcar(d.start, d.end))
          else onSelecionar(null)
        }}
        onPointerCancel={terminar}
        onPointerLeave={() => {
          if (!arraste.current) setCursor(null)
        }}
        title="Arraste as bordas para ajustar (grudam nos cortes; Alt solta). Arraste no vazio para marcar outro trecho."
        className="relative h-[76px] cursor-crosshair touch-none rounded-sm border border-line bg-elevated"
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${Math.max(duracao, 1)} 100`}
          preserveAspectRatio="none"
          aria-hidden
        >
          <path d={caminhoDosCortes} stroke="rgb(255 255 255 / 0.12)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={caminhoDasFalas} fill="rgb(160 160 168 / 0.55)" />
          {capitulos
            .filter((c) => c.start > 0.5)
            .map((c, i) => (
              <line
                key={i}
                x1={c.start}
                x2={c.start}
                y1={0}
                y2={100}
                stroke="rgb(237 237 239 / 0.35)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
        </svg>

        {exclusoes.map((ex, i) => {
          const escolhida = i === selecionada
          const altura = FAIXA_ALTURA / pistas.total
          return (
            <div
              key={i}
              data-ex={i}
              title={`${CURTO[ex.motivo]} ${formatarTempo(ex.start, 1)} - ${formatarTempo(ex.end, 1)}${ex.porque ? ` · ${ex.porque}` : ''}${ex.confirmada ? '' : ' (sugerida)'}`}
              className={[
                'group/ex absolute min-w-[4px] cursor-grab rounded-[4px] border active:cursor-grabbing',
                ex.confirmada ? 'border-accent bg-accent/30' : 'border-dashed border-accent',
                escolhida ? 'z-10 ring-2 ring-ink' : '',
              ].join(' ')}
              style={{
                left: `${pct(ex.start)}%`,
                width: `${pct(ex.end - ex.start)}%`,
                // Uma pista: a faixa inteira. Mais de uma: cada trecho na sua, com 1 px entre elas.
                top: FAIXA_TOPO + (pistas.pista[i] ?? 0) * altura,
                height: pistas.total > 1 ? altura - 1 : altura,
                backgroundImage: ex.confirmada ? undefined : LISTRADO,
              }}
            >
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-1 text-[10px] font-medium text-ink">
                {CURTO[ex.motivo]}
              </span>
              {(['inicio', 'fim'] as const).map((borda) => (
                <span
                  key={borda}
                  data-ex={i}
                  data-borda={borda}
                  className={[
                    'absolute inset-y-[-4px] w-[9px] cursor-ew-resize',
                    borda === 'inicio' ? '-left-[5px]' : '-right-[5px]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-accent transition-opacity',
                      escolhida ? 'opacity-100' : 'opacity-0 group-hover/ex:opacity-100',
                    ].join(' ')}
                  />
                </span>
              ))}
            </div>
          )
        })}

        {desenho && (
          <div
            className="pointer-events-none absolute rounded-[4px] border border-dashed border-ink-2 bg-white/5"
            style={{
              left: `${pct(desenho.start)}%`,
              width: `${pct(desenho.end - desenho.start)}%`,
              top: FAIXA_TOPO,
              height: FAIXA_ALTURA,
            }}
          />
        )}

        {cursor !== null && (
          <div className="pointer-events-none absolute inset-y-0 w-px bg-ink/50" style={{ left: `${pct(cursor)}%` }}>
            <span className="tnum absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-bg px-1 text-[10px] text-ink-2">
              {formatarTempo(cursor, 1)}
            </span>
          </div>
        )}
      </div>

      <div className="relative h-4">
        {marcas.lista.map((t, i) => {
          /*
           * A ultima marca colada no fim (24:00 num episodio de 24:00.5) se
           * alinha pela direita: centrada, metade do rotulo passava da borda.
           */
          const colada = duracao - t < marcas.passo / 2
          return (
            <span
              key={t}
              className={[
                'tnum absolute top-0 text-[10px] text-ink-3',
                i === 0 ? '' : colada ? '-translate-x-full' : '-translate-x-1/2',
              ].join(' ')}
              style={{ left: `${pct(colada && i > 0 ? duracao : t)}%` }}
            >
              {formatarTempo(t)}
            </span>
          )
        })}
      </div>
    </div>
  )
}
