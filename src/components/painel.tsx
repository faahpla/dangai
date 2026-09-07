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
  children,
}: {
  titulo: string
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3">
      <h3 className="text-[10px] font-medium uppercase tracking-wide text-ink-3">{titulo}</h3>
      {children}
    </section>
  )
}
