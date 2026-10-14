import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useProject } from '@/store/project'

/**
 * O TRANSFORM DO INSERT PELO PROPRIO PREVIEW, como no DaVinci: "poder mexer na
 * posicao de inserts pelo proprio preview". Com um clipe da faixa de video
 * escolhido e a agulha dentro dele, aparece a caixa dele por cima do preview:
 *
 * - arrastar dentro da caixa move (x/y);
 * - os cantos -- ou a roda do mouse em cima dela -- escalam, a partir do centro;
 * - a bolinha de cima -- ou Shift+roda -- gira (Shift no arraste: de 15 em 15).
 *
 * A conta e a MESMA do Remotion (Video.tsx > Sobreposicao): o arquivo entra
 * inteiro no quadro (contain) -- ou cobrindo (cover) com "preencher" --, e por
 * cima vem translate(x%, y%) rotate() scale() a partir do centro.
 *
 * A caixa e DESENHADA por cima da tela (portal), sem ser cortada pelo preview:
 * um insert do tamanho do quadro, movido um pouco, ficava com as alcas fora do
 * alcance. Fora do preview ela e so desenho -- nao rouba clique do resto da
 * tela --; quem pega o arraste e a roda e o proprio retangulo do preview,
 * perguntando se o ponteiro caiu dentro da caixa girada.
 */
export function TransformNoPreview() {
  const escolhido = useProject((s) => (s.clipeSelecionado?.tipo === 'video' ? s.clipeSelecionado.id : null))
  const o = useProject((s) => (escolhido ? s.sobreposicoes.find((x) => x.id === escolhido) : undefined))
  const playhead = useProject((s) => s.playhead)
  const formato = useProject((s) => s.formato)
  const ajustar = useProject((s) => s.ajustarSobreposicao)
  const ancora = useRef<HTMLDivElement | null>(null)
  const [quadroNaTela, setQuadroNaTela] = useState<DOMRect | null>(null)

  const toca = o ? (o.usarSec ?? o.durationSec - o.inicioSec) : 0
  const ativo = o !== undefined && o.tipo !== 'ajuste' && playhead >= o.at - 1e-3 && playhead < o.at + toca

  useLayoutEffect(() => {
    const el = ancora.current
    if (!el || !ativo) return
    const medir = (): void => setQuadroNaTela(el.getBoundingClientRect())
    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(el)
    window.addEventListener('resize', medir)
    window.addEventListener('scroll', medir, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', medir)
      window.removeEventListener('scroll', medir, true)
    }
  }, [ativo])

  const W = formato === 'long' ? 16 : 9
  const H = formato === 'long' ? 9 : 16
  const quadro = W / H
  const a = o?.aspecto || 16 / 9
  // O tamanho do arquivo no quadro, em fracao da largura e da altura dele.
  const cobre = o?.preencher === true
  const [fw, fh] = (a > quadro) !== cobre ? [1, quadro / a] : [a / quadro, 1]

  /** O retangulo do preview, o centro e o tamanho do insert, em px da tela. */
  const geometria = () => {
    const r = ancora.current!.getBoundingClientRect()
    return {
      r,
      cx: r.left + r.width * (0.5 + (o!.x) / 100),
      cy: r.top + r.height * (0.5 + (o!.y) / 100),
      bw: fw * o!.escala * r.width,
      bh: fh * o!.escala * r.height,
    }
  }
  /** O ponteiro caiu dentro da caixa (girada)? */
  const dentroDaCaixa = (x: number, y: number): boolean => {
    const { cx, cy, bw, bh } = geometria()
    const ang = (-(o!.rotacao) * Math.PI) / 180
    const dx = (x - cx) * Math.cos(ang) - (y - cy) * Math.sin(ang)
    const dy = (x - cx) * Math.sin(ang) + (y - cy) * Math.cos(ang)
    return Math.abs(dx) <= bw / 2 && Math.abs(dy) <= bh / 2
  }

  // A roda em cima da caixa: escala; com Shift, gira. Fora dela, nada.
  const atual = useRef(o)
  atual.current = o
  useEffect(() => {
    const el = ancora.current
    if (!el || !ativo) return
    const roda = (e: WheelEvent): void => {
      const x = atual.current
      if (!x || !dentroDaCaixa(e.clientX, e.clientY)) return
      e.preventDefault()
      if (e.shiftKey) {
        const g = x.rotacao + ((e.deltaY || e.deltaX) > 0 ? 2 : -2)
        ajustar(x.id, { rotacao: Math.round((((((g + 180) % 360) + 360) % 360) - 180) * 10) / 10 })
      } else {
        ajustar(x.id, { escala: Math.round(Math.min(Math.max(x.escala * Math.exp(-e.deltaY * 0.0012), 0.05), 4) * 100) / 100 })
      }
    }
    el.addEventListener('wheel', roda, { passive: false })
    return () => el.removeEventListener('wheel', roda)
  })

  const [sobre, setSobre] = useState(false)

  if (!o || o.tipo === 'ajuste') return null

  const arrastar = (event: React.PointerEvent, modo: 'mover' | 'escalar' | 'girar'): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const { r, cx, cy } = geometria()
    const x0 = event.clientX
    const y0 = event.clientY
    const inicio = { x: o.x, y: o.y, escala: o.escala, rotacao: o.rotacao }
    const dist0 = Math.max(Math.hypot(x0 - cx, y0 - cy), 1)
    const ang0 = Math.atan2(y0 - cy, x0 - cx)
    const limita = (v: number, de: number, ate: number): number => Math.min(Math.max(v, de), ate)

    const mover = (e: PointerEvent): void => {
      if (modo === 'mover') {
        ajustar(o.id, {
          x: Math.round(limita(inicio.x + ((e.clientX - x0) / r.width) * 100, -100, 100) * 10) / 10,
          y: Math.round(limita(inicio.y + ((e.clientY - y0) / r.height) * 100, -100, 100) * 10) / 10,
        })
      } else if (modo === 'escalar') {
        const d = Math.hypot(e.clientX - cx, e.clientY - cy)
        ajustar(o.id, { escala: Math.round(limita(inicio.escala * (d / dist0), 0.05, 4) * 100) / 100 })
      } else {
        const ang = Math.atan2(e.clientY - cy, e.clientX - cx)
        let graus = inicio.rotacao + ((ang - ang0) * 180) / Math.PI
        graus = ((((graus + 180) % 360) + 360) % 360) - 180
        if (e.shiftKey) graus = Math.round(graus / 15) * 15
        ajustar(o.id, { rotacao: Math.round(graus * 10) / 10 })
      }
    }
    const soltar = (): void => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', soltar)
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', soltar)
  }

  const canto = (pos: string, cursor: string) => (
    <span
      onPointerDown={(e) => arrastar(e, 'escalar')}
      title="Escalar"
      className={`pointer-events-auto absolute size-[10px] rounded-[2px] border border-accent bg-white ${pos}`}
      style={{ cursor }}
    />
  )

  return (
    <>
      {/*
        O retangulo do preview: mede a caixa e pega o arraste e a roda quando o
        ponteiro esta DENTRO do insert (fora dele, o clique passa).
      */}
      <div
        ref={ancora}
        className={['absolute inset-0 z-10', ativo ? '' : 'pointer-events-none'].join(' ')}
        style={{ cursor: sobre ? 'move' : undefined }}
        title={ativo ? 'Arraste o insert para mover · roda escala · Shift+roda gira' : undefined}
        onPointerMove={(e) => ativo && setSobre(dentroDaCaixa(e.clientX, e.clientY))}
        onPointerLeave={() => setSobre(false)}
        onPointerDown={(e) => {
          if (ativo && dentroDaCaixa(e.clientX, e.clientY)) arrastar(e, 'mover')
        }}
      />
      {ativo &&
        quadroNaTela &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[45] overflow-visible"
            style={{ left: quadroNaTela.left, top: quadroNaTela.top, width: quadroNaTela.width, height: quadroNaTela.height }}
          >
            <div
              className="absolute border border-accent shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
              data-transform-do-insert
              style={{
                left: `${50 + o.x}%`,
                top: `${50 + o.y}%`,
                width: `${fw * o.escala * 100}%`,
                height: `${fh * o.escala * 100}%`,
                transform: `translate(-50%, -50%) rotate(${o.rotacao}deg)`,
              }}
            >
              {canto('-left-[5px] -top-[5px]', 'nwse-resize')}
              {canto('-right-[5px] -top-[5px]', 'nesw-resize')}
              {canto('-left-[5px] -bottom-[5px]', 'nesw-resize')}
              {canto('-right-[5px] -bottom-[5px]', 'nwse-resize')}
              {/* O giro: uma haste saindo do meio de cima. */}
              <span className="pointer-events-none absolute left-1/2 top-0 h-[18px] w-px -translate-x-1/2 -translate-y-full bg-accent" />
              <span
                onPointerDown={(e) => arrastar(e, 'girar')}
                title="Girar (Shift: de 15 em 15 graus)"
                className="pointer-events-auto absolute left-1/2 top-0 size-[11px] -translate-x-1/2 -translate-y-[26px] cursor-grab rounded-full border border-accent bg-white"
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
