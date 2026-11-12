/**
 * O BOTAO DAS BARRAS DO EDITOR (a de cima e a da linha do tempo).
 *
 * "E muito poluido visualmente." Eram dezessete botoes iguais, cada um com
 * borda e fundo proprios, e o olho nao achava o que era de cada assunto. Agora
 * o botao nao tem caixa: so o icone e o nome, um fundo leve no hover, e o rosa
 * quando esta ligado. Quem separa os assuntos sao os grupos e as divisorias
 * (`Divisoria`), e o unico botao cheio e o Renderizar.
 *
 * Os botoes dos modulos chegam com o estilo antigo (borda, `lift`); o
 * `[data-modulos-na-barra]` do index.css os traz para este mesmo jeito.
 */
export type EstadoDoBotao = 'normal' | 'ligado' | 'aberto'

export function botaoDaBarra(estado: EstadoDoBotao = 'normal'): string {
  return [
    'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-[12px] transition-colors duration-150',
    'disabled:pointer-events-none disabled:opacity-40',
    estado === 'ligado'
      ? 'bg-accent-dim text-ink [&_svg]:text-accent'
      : estado === 'aberto'
        ? 'bg-white/[0.07] text-ink'
        : 'text-ink-2 hover:bg-white/[0.05] hover:text-ink',
  ].join(' ')
}

/** So o icone (o nome mora no title). */
export function iconeDaBarra(estado: EstadoDoBotao = 'normal'): string {
  return botaoDaBarra(estado).replace('px-2.5', 'w-8 justify-center px-0')
}

/** O risco vertical entre os grupos de uma barra. */
export function Divisoria() {
  return <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-line-strong" />
}
