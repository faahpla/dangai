import { useState } from 'react'
/**
 * As pecas dos paineis de edicao de bloco.
 *
 * Moram aqui porque o painel do bloco foi partido em DOIS: a coluna estreita da
 * direita, com "qual cena e esta" (trocar, buscar na biblioteca, ponto de
 * entrada), e o painel largo do meio, com "como ela se comporta" (enquadramento,
 * giro, movimento, transicao).
 *
 * A partilha e escolha dele, depois de montar um video inteiro: a coluna unica
 * rolava, e rolando ele confundia o slider de intensidade do movimento com o do
 * ponto de entrada do clipe. Separados, os dois nunca mais aparecem juntos.
 */

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium text-ink-2">{label}</span>
      {children}
    </div>
  )
}

export function Chip({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'lift rounded-sm border px-2 py-1.5 text-[11px] disabled:opacity-40',
        active ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/**
 * Um grupo do painel largo: titulo em cima, conteudo embaixo, borda em volta.
 *
 * A borda existe para o olho: no painel largo os grupos ficam lado a lado, e sem
 * ela dois sliders vizinhos de grupos diferentes pareceriam do mesmo assunto --
 * que e exatamente a confusao que a coluna unica causava.
 */
export function Grupo({
  titulo,
  acao,
  children,
}: {
  titulo: string
  /** Controles no canto do titulo -- o que liga e desliga o grupo inteiro. */
  acao?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-surface p-2.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="text-[10px] font-medium uppercase tracking-wide text-ink-3">{titulo}</h3>
        {acao && <div className="flex items-center gap-1">{acao}</div>}
      </div>
      {children}
    </section>
  )
}

/*
 * AS PECAS COMPACTAS do painel do bloco.
 *
 * "A hierarquia desses botoes ta ocupando muito espaco na tela
 * desnecessariamente." Cada escolha era um botao da largura da coluna, um por
 * linha, com o rotulo numa linha propria e uma frase de explicacao embaixo. O
 * jeito dos editores e uma LINHA por controle: rotulo na esquerda, o seletor
 * colado na direita, e a explicacao no tooltip.
 */

/** Uma linha do painel: rotulo curto na esquerda, controle na direita. */
export function Linha({
  label,
  title,
  children,
}: {
  label: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2" title={title}>
      <span className="w-[68px] shrink-0 truncate text-[11px] text-ink-3">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  )
}

export type Segmento<T> = {
  valor: T
  rotulo: React.ReactNode
  /** O nome por extenso, para o tooltip e para leitor de tela. */
  title?: string
}

/** Opcoes coladas numa barra so, como o seletor de modo do DaVinci. */
export function Segmentos<T>({
  opcoes,
  ativo,
  onChange,
}: {
  opcoes: readonly Segmento<T>[]
  ativo: (valor: T) => boolean
  onChange: (valor: T) => void
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap gap-0.5 rounded-sm border border-line bg-elevated p-0.5">
      {opcoes.map((o, i) => {
        const ligado = ativo(o.valor)
        return (
          <button
            key={i}
            type="button"
            title={o.title}
            aria-label={o.title}
            aria-pressed={ligado}
            onClick={() => onChange(o.valor)}
            className={[
              'flex h-6 min-w-6 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-[3px] px-1.5 text-[11px] transition-colors',
              ligado ? 'bg-accent-dim text-ink ring-1 ring-inset ring-accent' : 'text-ink-3 hover:bg-surface hover:text-ink-2',
            ].join(' ')}
          >
            {o.rotulo}
          </button>
        )
      })}
    </div>
  )
}

/** Um botao pequeno, da altura de uma linha do painel. */
export function Botaozinho({
  active = false,
  onClick,
  title,
  disabled,
  children,
}: {
  active?: boolean
  onClick: () => void
  title?: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={active}
      className={[
        'flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-[11px] transition-colors disabled:opacity-40',
        active ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** Slider com o valor ao lado, numa linha so. */
export function Deslizante({
  valor,
  min,
  max,
  step,
  onChange,
  texto,
  padrao,
  dica,
  digitar,
}: {
  valor: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  texto: string
  /** Duplo clique volta a este valor. */
  padrao?: number
  /** O que o slider faz, no tooltip (junto do "duplo clique volta ao padrao"). */
  dica?: string
  /**
   * DIGITAR O VALOR: dois cliques no numero viram um campo. O que ele digita
   * vale mesmo fora da faixa do slider -- e o jeito de chegar num 1200% ou num
   * -250% que o arrastar nao alcanca. `numero` e o valor na unidade mostrada.
   */
  digitar?: { numero: number; aplicar: (n: number) => void }
}) {
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={valor}
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={padrao === undefined ? undefined : () => onChange(padrao)}
        title={[dica, padrao === undefined ? null : 'Duplo clique volta ao padrao'].filter(Boolean).join(' · ') || undefined}
        className="dangai-range min-w-0 flex-1"
      />
      {digitar ? (
        <ValorDigitavel texto={texto} numero={digitar.numero} aplicar={digitar.aplicar} className="w-12 text-[11px] text-ink-3" />
      ) : (
        <span className="tnum w-9 shrink-0 text-right text-[11px] text-ink-3">{texto}</span>
      )}
    </>
  )
}

/**
 * Um numero que, com dois cliques, vira campo de digitar. Enter (ou sair do
 * campo) aplica; Esc desiste. Aceita virgula.
 */
export function ValorDigitavel({
  texto,
  numero,
  aplicar,
  className = '',
}: {
  texto: string
  numero: number
  aplicar: (n: number) => void
  className?: string
}) {
  const [editando, setEditando] = useState<string | null>(null)
  if (editando === null) {
    return (
      <span
        onDoubleClick={() => setEditando(String(Math.round(numero * 10) / 10))}
        title="Dois cliques para digitar o valor"
        className={`tnum shrink-0 cursor-text text-right hover:text-ink ${className}`}
      >
        {texto}
      </span>
    )
  }
  const confirmar = (): void => {
    const n = Number(editando.replace(',', '.').replace(/[^0-9.+-]/g, ''))
    if (editando.trim() !== '' && Number.isFinite(n)) aplicar(n)
    setEditando(null)
  }
  return (
    <input
      autoFocus
      value={editando}
      onChange={(e) => setEditando(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={confirmar}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') confirmar()
        else if (e.key === 'Escape') setEditando(null)
      }}
      className={`tnum shrink-0 rounded-sm border border-line-strong bg-elevated px-1 text-right text-ink outline-none ${className}`}
    />
  )
}
