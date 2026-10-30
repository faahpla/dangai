import { Check, TriangleAlert } from 'lucide-react'

/**
 * [thumb] As pecas pequenas do editor de thumbnail: as MESMAS do assistente
 * do recap (modulos/recap/src/components/pecas.tsx), copiadas para o editor
 * em comum nao depender do recap (a direcao e recap -> thumb). Mudar o
 * desenho de uma e mudar a da outra junto: a aba do recap e o modulo tem que
 * parecer a mesma tela.
 */

/** 89.5 -> "1:29.5"; 3725 -> "1:02:05". `decimais` 0 arredonda para o segundo. */
export function formatarTempo(seg: number, decimais = 0): string {
  const s = Math.max(0, seg)
  const fator = 10 ** decimais
  const arredondado = Math.round(s * fator) / fator
  const h = Math.floor(arredondado / 3600)
  const m = Math.floor((arredondado % 3600) / 60)
  const resto = arredondado - h * 3600 - m * 60
  const inteiro = Math.floor(resto)
  const frac = decimais > 0 ? (resto - inteiro).toFixed(decimais).slice(1) : ''
  const ss = `${String(inteiro).padStart(2, '0')}${frac === '.0' ? '' : frac}`
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** O cartao de uma secao, com o titulo pequeno em caixa alta e controles no canto. */
export function Secao({
  titulo,
  acao,
  children,
}: {
  titulo: string
  /** Controles no canto do titulo. */
  acao?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="enter flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <header className="flex min-h-7 items-center gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{titulo}</h3>
        <span className="flex-1" />
        {acao}
      </header>
      {children}
    </section>
  )
}

/** Os botoes: `principal` e o rosa apagado da acao que leva adiante (um por tela). */
export function Botao({
  onClick,
  disabled,
  title,
  principal = false,
  pequeno = false,
  foco,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  principal?: boolean
  pequeno?: boolean
  /** Nome para devolver o foco do teclado a este botao depois de uma acao. */
  foco?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-foco={foco}
      className={[
        'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border font-medium',
        pequeno ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3.5 text-[13px]',
        disabled
          ? 'cursor-not-allowed border-line bg-elevated text-ink-2 opacity-40'
          : principal
            ? 'border-accent bg-accent-dim text-ink transition-colors duration-150 hover:bg-accent-glow'
            : 'lift border-line bg-elevated text-ink-2 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** O link discreto, para acao de canto que nao merece botao. */
export function Link({
  onClick,
  disabled,
  title,
  foco,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  foco?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-foco={foco}
      className="shrink-0 text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
    >
      {children}
    </button>
  )
}

/** Uma caixinha de marcar com o texto ao lado. */
export function Caixinha({
  ligada,
  onChange,
  disabled,
  title,
  children,
}: {
  ligada: boolean
  onChange: (ligada: boolean) => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ligada}
      onClick={() => onChange(!ligada)}
      disabled={disabled}
      title={title}
      className="flex shrink-0 items-center gap-2 text-left text-[12px] text-ink-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={[
          'grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors',
          ligada ? 'border-accent bg-accent-dim text-accent' : 'border-line-strong bg-elevated',
        ].join(' ')}
      >
        {ligada && <Check size={11} strokeWidth={2.25} />}
      </span>
      {children}
    </button>
  )
}

/** As classes do campo de texto do app (as mesmas das Configuracoes), sem o tamanho. */
export const CLASSE_DO_CAMPO =
  'min-w-0 select-text rounded-sm border border-line bg-elevated text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-40'

export const CAMPO_NORMAL = 'h-8 px-2.5 text-[13px]'

/** O laranja dos avisos (o mesmo da StatusBar). */
export const COR_DE_AVISO = 'text-[#f6a23c]'

/** Um aviso dentro da secao. Icone e texto neutros. */
export function Aviso({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-2" title={title}>
      <TriangleAlert size={12} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-3" />
      <span className="min-w-0 select-text">{children}</span>
    </p>
  )
}
