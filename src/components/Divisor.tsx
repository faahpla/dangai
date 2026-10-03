import { useRef } from 'react'

/**
 * Uma divisoria que se arrasta, como as do Premiere.
 *
 * `eixo` 'x' muda uma largura (arrasta para os lados); 'y' muda uma altura.
 * `valor` e o tamanho atual e `sinal` diz para que lado ele cresce: a parte de
 * baixo cresce quando a divisoria SOBE, entao ali o sinal e -1. Dois cliques
 * voltam ao padrao.
 */
export function Divisor({
  eixo,
  valor,
  min,
  max,
  sinal = 1,
  onChange,
  onPadrao,
  titulo,
}: {
  eixo: 'x' | 'y'
  valor: number
  min: number
  max: number
  sinal?: 1 | -1
  onChange: (v: number) => void
  onPadrao: () => void
  titulo: string
}) {
  const inicio = useRef<{ p: number; v: number } | null>(null)
  return (
    <div
      role="separator"
      aria-orientation={eixo === 'x' ? 'vertical' : 'horizontal'}
      aria-label={titulo}
      title={`${titulo} -- arraste; dois cliques voltam ao padrao`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        inicio.current = { p: eixo === 'x' ? e.clientX : e.clientY, v: valor }
      }}
      onPointerMove={(e) => {
        const i = inicio.current
        if (!i) return
        const delta = (eixo === 'x' ? e.clientX : e.clientY) - i.p
        onChange(Math.min(Math.max(i.v + sinal * delta, min), max))
      }}
      onPointerUp={() => (inicio.current = null)}
      onPointerCancel={() => (inicio.current = null)}
      onDoubleClick={onPadrao}
      className={[
        'group/divisor relative shrink-0',
        eixo === 'x' ? 'w-3 cursor-col-resize' : 'h-3 cursor-row-resize',
      ].join(' ')}
    >
      <span
        className={[
          'absolute rounded-full bg-line transition-colors group-hover/divisor:bg-accent',
          eixo === 'x' ? 'inset-y-6 left-1/2 w-[2px] -translate-x-1/2' : 'inset-x-6 top-1/2 h-[2px] -translate-y-1/2',
        ].join(' ')}
      />
    </div>
  )
}
