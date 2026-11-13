import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Pipette } from 'lucide-react'

/**
 * O SELETOR DE COR DO DANGAI, no lugar do `<input type="color">`.
 *
 * "Melhora o design desse grafico de rgb feio": o input nativo abria a janela
 * do Chromium -- o quadrado, a faixa e tres caixas R G B soltas, branca,
 * fora do jeito do app. Este e o mesmo gesto no tema escuro: o quadrado de
 * saturacao e brilho, a faixa da matiz, o codigo (#RRGGBB), o conta-gotas
 * (pega a cor de qualquer lugar da tela) e as ultimas cores usadas.
 *
 * Muda AO VIVO enquanto arrasta, como o nativo: quem chama ve a cor na previa
 * sem precisar soltar. Abre num portal com posicao fixa, para nao ser cortado
 * pela rolagem do painel; fecha clicando fora ou com Esc.
 *
 * `children` e o gatilho (a bolinha de quem chama): ele vira um botao.
 */
export function SeletorDeCor({
  cor,
  onChange,
  titulo,
  className,
  style,
  children,
}: {
  cor: string
  onChange: (cor: string) => void
  /** O nome do que a cor pinta ("Cor da linha 1"): tooltip e leitor de tela. */
  titulo: string
  className?: string
  style?: React.CSSProperties
  children?: ReactNode
}) {
  const [aberto, setAberto] = useState(false)
  const gatilho = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <button
        ref={gatilho}
        type="button"
        onClick={() => setAberto((v) => !v)}
        title={titulo}
        aria-label={titulo}
        aria-expanded={aberto}
        className={className}
        style={style}
      >
        {children}
      </button>
      {aberto && (
        <PainelDeCor
          ancora={gatilho}
          cor={cor}
          onChange={onChange}
          onFechar={() => {
            lembrar(cor)
            setAberto(false)
          }}
        />
      )}
    </>
  )
}

// -------------------------------------------------------------- o painel

const LARGURA = 232
const ALTURA_DO_QUADRADO = 148

function PainelDeCor({
  ancora,
  cor,
  onChange,
  onFechar,
}: {
  ancora: React.RefObject<HTMLButtonElement | null>
  cor: string
  onChange: (cor: string) => void
  onFechar: () => void
}) {
  const painel = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: -9999, top: -9999 })
  /*
   * A COR EM HSV MORA AQUI, e nao so no hex de quem chama: no preto (ou num
   * cinza) a matiz some do hex, e arrastar o brilho ate o fim faria a faixa da
   * matiz pular para o vermelho. O hex de fora so manda quando muda por fora.
   */
  const [hsv, setHsv] = useState(() => hexParaHsv(cor) ?? { h: 0, s: 0, v: 1 })
  const ultimoEnviado = useRef(cor.toLowerCase())
  useEffect(() => {
    if (cor.toLowerCase() === ultimoEnviado.current) return
    const novo = hexParaHsv(cor)
    if (novo) setHsv((atual) => ({ ...novo, h: novo.s === 0 || novo.v === 0 ? atual.h : novo.h }))
    ultimoEnviado.current = cor.toLowerCase()
  }, [cor])
  const [texto, setTexto] = useState(cor.toUpperCase())
  useEffect(() => setTexto(cor.toUpperCase()), [cor])

  const mandar = (h: { h: number; s: number; v: number }): void => {
    setHsv(h)
    const hex = hsvParaHex(h)
    ultimoEnviado.current = hex
    onChange(hex)
  }

  // Abre embaixo do gatilho; sem espaco, em cima. Sempre dentro da janela.
  useLayoutEffect(() => {
    const a = ancora.current?.getBoundingClientRect()
    const p = painel.current?.getBoundingClientRect()
    if (!a || !p) return
    const left = Math.max(8, Math.min(a.left + a.width / 2 - p.width / 2, window.innerWidth - p.width - 8))
    const top = a.bottom + 8 + p.height > window.innerHeight - 8 ? Math.max(8, a.top - 8 - p.height) : a.bottom + 8
    setPos({ left, top })
  }, [ancora])

  useEffect(() => {
    const fora = (e: PointerEvent): void => {
      const alvo = e.target as Node
      if (painel.current?.contains(alvo) || ancora.current?.contains(alvo)) return
      onFechar()
    }
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onFechar()
      }
    }
    window.addEventListener('pointerdown', fora, true)
    window.addEventListener('keydown', tecla, true)
    return () => {
      window.removeEventListener('pointerdown', fora, true)
      window.removeEventListener('keydown', tecla, true)
    }
  }, [ancora, onFechar])

  /** Arrastar dentro de uma area: o valor segue o ponteiro, mesmo fora dela. */
  const arrastar = (ev: React.PointerEvent<HTMLDivElement>, aoMover: (fx: number, fy: number) => void): void => {
    if (ev.button !== 0) return
    ev.preventDefault()
    const caixa = ev.currentTarget.getBoundingClientRect()
    const mover = (x: number, y: number): void =>
      aoMover(
        Math.min(1, Math.max(0, (x - caixa.left) / caixa.width)),
        Math.min(1, Math.max(0, (y - caixa.top) / caixa.height)),
      )
    mover(ev.clientX, ev.clientY)
    const aoMoverJanela = (e: PointerEvent): void => mover(e.clientX, e.clientY)
    const soltar = (): void => {
      window.removeEventListener('pointermove', aoMoverJanela)
      window.removeEventListener('pointerup', soltar)
    }
    window.addEventListener('pointermove', aoMoverJanela)
    window.addEventListener('pointerup', soltar)
  }

  const conta = typeof window !== 'undefined' && 'EyeDropper' in window
  const pegarDaTela = async (): Promise<void> => {
    try {
      const Conta = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
      const r = await new Conta().open()
      const novo = hexParaHsv(r.sRGBHex)
      if (novo) mandar(novo)
    } catch {
      /* desistiu (Esc) */
    }
  }

  const recentes = lerRecentes()
  const hexAgora = hsvParaHex(hsv)

  return createPortal(
    <div
      ref={painel}
      role="dialog"
      aria-label="Escolher cor"
      style={{ left: pos.left, top: pos.top, width: LARGURA }}
      className="glass enter fixed z-[90] flex flex-col gap-2.5 rounded-lg p-3"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* O QUADRADO: saturacao para a direita, brilho para cima. */}
      <div
        onPointerDown={(ev) => arrastar(ev, (fx, fy) => mandar({ h: hsv.h, s: fx, v: 1 - fy }))}
        className="relative w-full cursor-crosshair touch-none overflow-hidden rounded-md"
        style={{
          height: ALTURA_DO_QUADRADO,
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)`,
        }}
      >
        <span
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5),0_2px_6px_rgba(0,0,0,0.5)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hexAgora }}
        />
      </div>

      {/* A MATIZ. */}
      <div
        onPointerDown={(ev) => arrastar(ev, (fx) => mandar({ ...hsv, h: fx * 360 }))}
        className="relative h-3 w-full cursor-pointer touch-none rounded-full"
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5),0_2px_6px_rgba(0,0,0,0.5)]"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }}
        />
      </div>

      {/* O CODIGO, a amostra e o conta-gotas. */}
      <div className="flex items-center gap-2">
        <span className="size-7 shrink-0 rounded-md border border-white/15" style={{ background: hexAgora }} />
        <input
          value={texto}
          maxLength={7}
          spellCheck={false}
          aria-label="Código da cor (hexadecimal)"
          onChange={(e) => {
            setTexto(e.target.value)
            const limpo = e.target.value.trim().replace(/^#?/, '#')
            if (/^#[0-9a-fA-F]{6}$/.test(limpo)) {
              const novo = hexParaHsv(limpo)
              if (novo) mandar(novo)
            }
          }}
          onBlur={() => setTexto(hexAgora.toUpperCase())}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') onFechar()
          }}
          className="tnum h-7 min-w-0 flex-1 rounded-md border border-line bg-elevated px-2 text-[12px] uppercase text-ink focus:border-accent focus:outline-none"
        />
        {conta && (
          <button
            type="button"
            onClick={() => void pegarDaTela()}
            title="Pegar uma cor de qualquer lugar da tela"
            aria-label="Conta-gotas"
            className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-elevated text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          >
            <Pipette size={13} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {recentes.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
          <span className="text-[10px] text-ink-3">Usadas há pouco</span>
          <div className="flex flex-wrap gap-1.5">
            {recentes.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  const novo = hexParaHsv(c)
                  if (novo) mandar(novo)
                }}
                title={c.toUpperCase()}
                aria-label={`Usar ${c}`}
                className={[
                  'size-5 rounded-full border border-black/50 transition-transform hover:scale-110',
                  c === hexAgora ? 'ring-2 ring-accent ring-offset-1 ring-offset-[var(--color-elevated)]' : '',
                ].join(' ')}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

// ---------------------------------------------------- as ultimas usadas

const CHAVE = 'dangai.coresRecentes'

function lerRecentes(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CHAVE) ?? '[]')
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c)).slice(0, 10) : []
  } catch {
    return []
  }
}

/** Guarda a cor escolhida ao fechar (as 10 ultimas, a mais nova primeiro). Gosto desta maquina. */
function lembrar(cor: string): void {
  const c = cor.toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(c)) return
  try {
    localStorage.setItem(CHAVE, JSON.stringify([c, ...lerRecentes().filter((x) => x !== c)].slice(0, 10)))
  } catch {
    /* vale so nesta sessao */
  }
}

// ------------------------------------------------------------- as contas

export function hexParaHsv(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvParaHex({ h, s, v }: { h: number; s: number; v: number }): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const hex = (n: number): string =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}
