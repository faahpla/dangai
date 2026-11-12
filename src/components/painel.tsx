import { useState } from 'react'
import { CircleHelp } from 'lucide-react'
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
 * Um grupo do painel largo: titulo em cima, conteudo embaixo, um cartao em volta.
 *
 * O cartao existe para o olho: no painel largo os grupos ficam lado a lado, e
 * sem ele dois sliders vizinhos de grupos diferentes pareceriam do mesmo
 * assunto -- que e exatamente a confusao que a coluna unica causava. E um fundo
 * um tom acima do da tela, sem borda: com a borda eram caixas dentro de caixas,
 * e a tela inteira parecia uma planilha ("muito poluido visualmente").
 */
export function Grupo({
  titulo,
  acao,
  dica,
  children,
}: {
  titulo: string
  /** Controles no canto do titulo -- o que liga e desliga o grupo inteiro. */
  acao?: React.ReactNode
  /**
   * O que o grupo faz, num "?" ao lado do titulo. Era um paragrafo fixo no alto
   * de cada grupo: ajuda na primeira vez e vira ruido em todas as outras.
   */
  dica?: string
  children?: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5 rounded-lg bg-surface p-3">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">{titulo}</h3>
          {dica && (
            <span title={dica} aria-label={dica} className="shrink-0 cursor-help text-ink-3/70 hover:text-ink-2">
              <CircleHelp size={12} strokeWidth={1.5} />
            </span>
          )}
        </div>
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
              // flex-auto, e nao flex-1: sem caber, a opcao desce de linha em vez de encavalar o texto da vizinha.
              'flex h-6 min-w-6 flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-[3px] px-1.5 text-[11px] transition-colors',
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
  textoLargo = false,
}: {
  valor: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  texto: string
  /** Valor com unidade comprida ("-20,0 dB", "9,0 kHz"): mais espaco para nao quebrar. */
  textoLargo?: boolean
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
        title={[dica, padrao === undefined ? null : 'Duplo clique volta ao padrão'].filter(Boolean).join(' · ') || undefined}
        className="dangai-range min-w-0 flex-1"
      />
      {digitar ? (
        <ValorDigitavel texto={texto} numero={digitar.numero} aplicar={digitar.aplicar} className="w-12 text-[11px] text-ink-3" />
      ) : (
        <span className={['tnum shrink-0 text-right text-[11px] text-ink-3', textoLargo ? 'w-[58px]' : 'w-9'].join(' ')}>{texto}</span>
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

/**
 * O MEIO DO EDITOR EM COLUNAS DE LARGURA CERTA.
 *
 * "Sliders ENORMES desnecessariamente": cada painel era metade do meio, e o
 * slider de Intensidade passava de 600 px para um numero de 4% a 15%. Agora os
 * grupos moram em colunas de 320 a ~400 px, lado a lado, quantas couberem -- o
 * espaco se divide entre assuntos, e nao entre um assunto e o vazio do lado
 * dele. Numa janela estreita a coluna que nao cabe desce para baixo das outras.
 */
export function Colunas({ children }: { children: React.ReactNode }) {
  return (
    <div className="enter @container min-h-0 flex-1 overflow-y-auto pr-1">
      {/*
        auto-FILL, e nao auto-fit: com so dois grupos (bloco parado, sem ritmo)
        a terceira coluna fica vazia em vez de os dois esticarem ate a borda.
        O teto de largura segura as colunas numa tela muito larga. "dense": um
        grupo de duas colunas que desce de linha nao deixa um buraco do lado
        do anterior -- o proximo grupo pequeno sobe para la.
      */}
      <div className="grid max-w-[1240px] grid-flow-row-dense grid-cols-[repeat(auto-fill,minmax(320px,1fr))] items-start gap-3">
        {children}
      </div>
    </div>
  )
}

/**
 * Uma coluna de `Colunas`: os grupos dela empilhados. `largo` ocupa duas
 * colunas quando cabem tres (a camera livre, com as duas pontas lado a lado).
 * Com so duas, ela fica com uma, ao lado da outra coluna -- ocupando as duas
 * ela desceria para baixo de tudo.
 */
export function Coluna({ children, largo = false }: { children: React.ReactNode; largo?: boolean }) {
  return (
    <div className={['flex min-w-0 flex-col gap-3 empty:hidden', largo ? '@min-[1000px]:col-span-2' : ''].join(' ')}>
      {children}
    </div>
  )
}
