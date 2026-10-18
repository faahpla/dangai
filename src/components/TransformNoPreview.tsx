import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { compensarPivo, type Transform2D } from '@shared/transform'
import { useProject } from '@/store/project'
import { animado, patchDoTransform, transformNaAgulha } from '@/store/transform-do-clipe'

/**
 * O TRANSFORM DO INSERT PELO PROPRIO PREVIEW, como no DaVinci: "poder mexer na
 * posicao de inserts pelo proprio preview". Com um clipe da faixa de video
 * escolhido e a agulha dentro dele, aparece a caixa dele por cima do preview:
 *
 * - arrastar dentro da caixa move (x/y);
 * - os cantos -- ou a roda do mouse em cima dela -- escalam;
 * - logo FORA de cada canto, ou na bolinha de cima, gira (Shift: de 15 em 15)
 *   -- "deixa eu rotacionar pelas extremidades tambem";
 * - na camada de ajuste, a caixa e o quadro inteiro: o transform e o de tudo
 *   o que esta embaixo dela.
 *
 * A CAIXA ABRACA O QUE SE VE. Uma seta .mov exportada no tamanho do video e um
 * quadro quase todo transparente; a caixa do quadro, girada, virava um losango
 * enorme longe da seta ("a marcacao fica meio bugada"). O main mede a parte
 * nao transparente do arquivo (caixaDoConteudo), e o giro e a escala passam a
 * acontecer em volta do centro DELA -- o pivo --, com a posicao compensada na
 * primeira mexida para nada pular.
 *
 * Com quadros-chave, cada mexida grava uma chave na agulha.
 *
 * A caixa e DESENHADA por cima da tela (portal), sem ser cortada pelo preview.
 * Fora do preview ela e so desenho, menos as alcas; quem pega o arraste e a
 * roda dentro dela e o proprio retangulo do preview.
 */

type Caixa = { x0: number; y0: number; x1: number; y1: number }
const INTEIRA: Caixa = { x0: 0, y0: 0, x1: 1, y1: 1 }
/** A caixa do conteudo de cada arquivo, medida uma vez por sessao. */
const caixas = new Map<string, Caixa | null>()

/** O cursor de girar: uma seta curva, branca com contorno. */
const CURSOR_GIRAR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#000" stroke-width="4"><path d="M5 12a7 7 0 1 0 2.05-4.95"/><path d="M4 4v4.5h4.5"/></g><g stroke="#fff" stroke-width="2"><path d="M5 12a7 7 0 1 0 2.05-4.95"/><path d="M4 4v4.5h4.5"/></g></svg>',
)}") 12 12, crosshair`

export function TransformNoPreview({ quadroRef }: { quadroRef: React.RefObject<HTMLDivElement | null> }) {
  const escolhido = useProject((s) => (s.clipeSelecionado?.tipo === 'video' ? s.clipeSelecionado.id : null))
  const o = useProject((s) => (escolhido ? s.sobreposicoes.find((x) => x.id === escolhido) : undefined))
  const playhead = useProject((s) => s.playhead)
  const formato = useProject((s) => s.formato)
  const ajustar = useProject((s) => s.ajustarSobreposicao)
  const ancora = useRef<HTMLDivElement | null>(null)
  const [quadroNaTela, setQuadroNaTela] = useState<DOMRect | null>(null)
  const ajuste = o?.tipo === 'ajuste'
  const caminho = o && !ajuste ? o.path : null
  const [caixa, setCaixa] = useState<Caixa | null>(() => (caminho ? (caixas.get(caminho) ?? null) : null))

  const toca = o ? (o.usarSec ?? o.durationSec - o.inicioSec) : 0
  const ativo = o !== undefined && playhead >= o.at - 1e-3 && playhead < o.at + toca

  useEffect(() => {
    if (!caminho) return setCaixa(null)
    if (caixas.has(caminho)) return setCaixa(caixas.get(caminho) ?? null)
    setCaixa(null)
    let vivo = true
    void window.dangai.caixaDoConteudo(caminho).then((r) => {
      const c = r.ok ? r.value : null
      caixas.set(caminho, c)
      if (vivo) setCaixa(c)
    })
    return () => {
      vivo = false
    }
  }, [caminho])

  useLayoutEffect(() => {
    const el = ancora.current
    if (!el || !ativo) return
    const medir = (): void => setQuadroNaTela(el.getBoundingClientRect())
    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(el)
    // O quadro muda de tamanho com o zoom do visor: a caixa acompanha.
    if (quadroRef.current) observer.observe(quadroRef.current)
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

  /** O retangulo do que se ve, em fracao do quadro, antes do transform. */
  const conteudo = (): { l: number; t: number; r: number; b: number } => {
    if (!o || ajuste) return { l: 0, t: 0, r: 1, b: 1 }
    const a = o.aspecto || 16 / 9
    const cobre = o.preencher === true
    // O tamanho do arquivo no quadro, em fracao da largura e da altura dele.
    const [fw, fh] = (a > quadro) !== cobre ? [1, quadro / a] : [a / quadro, 1]
    const c = caixa ?? INTEIRA
    return {
      l: 0.5 - fw / 2 + c.x0 * fw,
      r: 0.5 - fw / 2 + c.x1 * fw,
      t: 0.5 - fh / 2 + c.y0 * fh,
      b: 0.5 - fh / 2 + c.y1 * fh,
    }
  }

  /**
   * Tudo em px da tela: o pivo ja movido, o centro e o tamanho da caixa. A
   * conta e a do CSS do Remotion: p' = pivo + T + A(p - pivo).
   */
  const geometria = (v: Transform2D, pivo: { x: number; y: number } | undefined) => {
    // O QUADRO do video (que encolhe com o zoom do visor), e nao o visor inteiro.
    const r = (quadroRef.current ?? ancora.current!).getBoundingClientRect()
    const c = conteudo()
    const px = r.left + r.width * (pivo?.x ?? 0.5)
    const py = r.top + r.height * (pivo?.y ?? 0.5)
    const tx = (v.x / 100) * r.width
    const ty = (v.y / 100) * r.height
    const dx = (r.left + (r.width * (c.l + c.r)) / 2 - px) * (o?.espelhar && !ajuste ? -1 : 1) * v.escala
    const dy = (r.top + (r.height * (c.t + c.b)) / 2 - py) * v.escala
    const ang = (v.rotacao * Math.PI) / 180
    return {
      r,
      // O ponto em volta do qual gira e escala.
      ox: px + tx,
      oy: py + ty,
      cx: px + tx + dx * Math.cos(ang) - dy * Math.sin(ang),
      cy: py + ty + dx * Math.sin(ang) + dy * Math.cos(ang),
      bw: r.width * (c.r - c.l) * v.escala,
      bh: r.height * (c.b - c.t) * v.escala,
    }
  }
  /** O ponteiro caiu dentro da caixa (girada)? */
  const dentroDaCaixa = (x: number, y: number): boolean => {
    if (!o) return false
    if (ajuste) return true
    const v = transformNaAgulha(o, useProject.getState().playhead)
    const { cx, cy, bw, bh } = geometria(v, o.pivo)
    const ang = (-v.rotacao * Math.PI) / 180
    const dx = (x - cx) * Math.cos(ang) - (y - cy) * Math.sin(ang)
    const dy = (x - cx) * Math.sin(ang) + (y - cy) * Math.cos(ang)
    return Math.abs(dx) <= bw / 2 + 2 && Math.abs(dy) <= bh / 2 + 2
  }

  /**
   * Antes de girar ou escalar um insert pela primeira vez: o pivo vai para o
   * centro do que se ve, e a posicao (de cada chave tambem) e compensada para a
   * imagem ficar exatamente onde estava.
   */
  const comPivo = (x: NonNullable<typeof o>): NonNullable<typeof o> => {
    if (ajuste || x.pivo || !caixa) return x
    const c = conteudo()
    const de = { x: 0.5, y: 0.5 }
    const para = { x: (c.l + c.r) / 2, y: (c.t + c.b) / 2 }
    const ajeita = <T extends Transform2D>(v: T): T => ({ ...v, ...compensarPivo(v, de, para, W, H, x.espelhar ?? false) })
    const patch = {
      pivo: para,
      ...ajeita({ x: x.x, y: x.y, escala: x.escala, rotacao: x.rotacao }),
      ...(x.chaves ? { chaves: x.chaves.map(ajeita) } : {}),
    }
    ajustar(x.id, patch)
    return { ...x, ...patch }
  }

  // A roda em cima da caixa: escala; com Shift, gira. Fora dela, nada.
  const atual = useRef(o)
  atual.current = o
  useEffect(() => {
    const el = ancora.current
    if (!el || !ativo) return
    const roda = (e: WheelEvent): void => {
      // Ctrl+roda e o zoom do visor (o Preview cuida): deixa passar.
      if (e.ctrlKey) return
      let x = atual.current
      if (!x || !dentroDaCaixa(e.clientX, e.clientY)) return
      e.preventDefault()
      x = comPivo(x)
      const agulha = useProject.getState().playhead
      const v = transformNaAgulha(x, agulha)
      if (e.shiftKey) {
        ajustar(x.id, patchDoTransform(x, agulha, { rotacao: v.rotacao + ((e.deltaY || e.deltaX) > 0 ? 2 : -2) }))
      } else {
        ajustar(x.id, patchDoTransform(x, agulha, { escala: v.escala * Math.exp(-e.deltaY * 0.0012) }))
      }
    }
    el.addEventListener('wheel', roda, { passive: false })
    return () => el.removeEventListener('wheel', roda)
  })

  const [sobre, setSobre] = useState(false)

  if (!o) return null

  const arrastar = (event: React.PointerEvent, modo: 'mover' | 'escalar' | 'girar'): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const agulha = useProject.getState().playhead
    const x = modo === 'mover' ? o : comPivo(o)
    const inicio = transformNaAgulha(x, agulha)
    const { r, ox, oy } = geometria(inicio, x.pivo)
    const x0 = event.clientX
    const y0 = event.clientY
    const dist0 = Math.max(Math.hypot(x0 - ox, y0 - oy), 1)
    let angAnterior = Math.atan2(y0 - oy, x0 - ox)
    let giro = inicio.rotacao
    // Cada mexida le o clipe de AGORA (as chaves mudam a cada passo).
    const vivo = (): typeof x => useProject.getState().sobreposicoes.find((y) => y.id === x.id) ?? x

    const mover = (e: PointerEvent): void => {
      if (modo === 'mover') {
        ajustar(x.id, patchDoTransform(vivo(), agulha, {
          x: inicio.x + ((e.clientX - x0) / r.width) * 100,
          y: inicio.y + ((e.clientY - y0) / r.height) * 100,
        }))
      } else if (modo === 'escalar') {
        const d = Math.hypot(e.clientX - ox, e.clientY - oy)
        ajustar(x.id, patchDoTransform(vivo(), agulha, { escala: inicio.escala * (d / dist0) }))
      } else {
        // Somando os pedacinhos: com chaves, o giro pode dar voltas inteiras.
        const ang = Math.atan2(e.clientY - oy, e.clientX - ox)
        let passo = ang - angAnterior
        if (passo > Math.PI) passo -= 2 * Math.PI
        if (passo < -Math.PI) passo += 2 * Math.PI
        angAnterior = ang
        giro += (passo * 180) / Math.PI
        const graus = e.shiftKey ? Math.round(giro / 15) * 15 : giro
        ajustar(x.id, patchDoTransform(vivo(), agulha, { rotacao: graus }))
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

  const v = transformNaAgulha(o, playhead)
  const g = ativo && quadroNaTela && ancora.current ? geometria(v, o.pivo) : null
  const temChave = animado(o)

  /** Um canto: o quadradinho escala; a area logo fora dele gira. */
  const canto = (sx: -1 | 1, sy: -1 | 1, cursor: string) => (
    <>
      <span
        onPointerDown={(e) => arrastar(e, 'girar')}
        title="Girar (Shift: de 15 em 15 graus)"
        data-girar
        className="pointer-events-auto absolute size-[22px]"
        style={{
          left: sx < 0 ? -24 : undefined,
          right: sx > 0 ? -24 : undefined,
          top: sy < 0 ? -24 : undefined,
          bottom: sy > 0 ? -24 : undefined,
          cursor: CURSOR_GIRAR,
        }}
      />
      <span
        onPointerDown={(e) => arrastar(e, 'escalar')}
        title="Escalar"
        data-escalar
        className="pointer-events-auto absolute size-[10px] rounded-[2px] border border-accent bg-white"
        style={{
          left: sx < 0 ? -5 : undefined,
          right: sx > 0 ? -5 : undefined,
          top: sy < 0 ? -5 : undefined,
          bottom: sy > 0 ? -5 : undefined,
          cursor,
        }}
      />
    </>
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
        title={
          ativo
            ? `Arraste para mover · roda escala · Shift+roda gira${temChave ? ' · grava uma chave na agulha' : ''}`
            : undefined
        }
        onPointerMove={(e) => ativo && setSobre(dentroDaCaixa(e.clientX, e.clientY))}
        onPointerLeave={() => setSobre(false)}
        onPointerDown={(e) => {
          if (ativo && dentroDaCaixa(e.clientX, e.clientY)) arrastar(e, 'mover')
        }}
      />
      {/*
        A caixa e desenhada DENTRO do visor, como no DaVinci: o que passa da
        borda dele e cortado junto, e nada fica por cima do resto do programa.
        Para alcancar uma alca fora da tela, diminua o zoom do visor.
      */}
      {g && quadroNaTela && (
          <div className="pointer-events-none absolute inset-0 z-[15]">
            <div
              className={[
                'absolute border border-accent shadow-[0_0_0_1px_rgba(0,0,0,0.5)]',
                // Animado: a borda tracejada lembra que mexer grava uma chave.
                temChave ? 'border-dashed' : '',
              ].join(' ')}
              data-transform-do-insert
              style={{
                left: g.cx - quadroNaTela.left,
                top: g.cy - quadroNaTela.top,
                width: g.bw,
                height: g.bh,
                transform: `translate(-50%, -50%) rotate(${v.rotacao}deg)`,
              }}
            >
              {canto(-1, -1, 'nwse-resize')}
              {canto(1, -1, 'nesw-resize')}
              {canto(-1, 1, 'nesw-resize')}
              {canto(1, 1, 'nwse-resize')}
              {/* O giro: uma haste saindo do meio de cima. */}
              <span className="pointer-events-none absolute left-1/2 top-0 h-[18px] w-px -translate-x-1/2 -translate-y-full bg-accent" />
              <span
                onPointerDown={(e) => arrastar(e, 'girar')}
                title="Girar (Shift: de 15 em 15 graus)"
                className="pointer-events-auto absolute left-1/2 top-0 size-[11px] -translate-x-1/2 -translate-y-[26px] rounded-full border border-accent bg-white"
                style={{ cursor: CURSOR_GIRAR }}
              />
            </div>
            {/* O ponto de giro, quando nao e o meio da caixa. */}
            {Math.hypot(g.ox - g.cx, g.oy - g.cy) > 3 && (
              <span
                className="absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-black/40"
                style={{ left: g.ox - quadroNaTela.left, top: g.oy - quadroNaTela.top }}
              />
            )}
          </div>
      )}
    </>
  )
}
