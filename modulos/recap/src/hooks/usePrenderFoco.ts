import { useEffect, type RefObject } from 'react'

/**
 * [Studio] PRENDE O TAB dentro de uma janela por cima (aria-modal): no ultimo
 * focavel o Tab volta ao primeiro, e o Shift+Tab no primeiro vai ao ultimo.
 *
 * Por que: sem isto o Tab saia da boas-vindas e da escolha do "Gerar recap"
 * para os botoes da tela inicial atras do fundo escuro, e o Enter agia por
 * tras (o "Gerar recap" atras da boas-vindas abria o assistente).
 *
 * So age quando o foco esta DENTRO da janela (ou solto no body): com outra
 * janela por cima (as Configuracoes, a tela do motor), o foco esta nela e o
 * Tab e dela.
 */
const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function usePrenderFoco(ref: RefObject<HTMLElement | null>, ativo = true): void {
  useEffect(() => {
    if (!ativo) return
    const tecla = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Tab') return
      const caixa = ref.current
      if (!caixa) return
      const atual = document.activeElement
      const dentro = atual instanceof Node && caixa.contains(atual)
      if (!dentro && atual !== document.body && atual !== null) return
      // So os visiveis: o que esta escondido (display none) nao recebe foco.
      const lista = Array.from(caixa.querySelectorAll<HTMLElement>(FOCAVEIS)).filter((el) => el.getClientRects().length > 0)
      if (lista.length === 0) return
      const primeiro = lista[0]!
      const ultimo = lista[lista.length - 1]!
      if (!dentro) {
        ev.preventDefault()
        ;(ev.shiftKey ? ultimo : primeiro).focus()
        return
      }
      if (!ev.shiftKey && atual === ultimo) {
        ev.preventDefault()
        primeiro.focus()
      } else if (ev.shiftKey && atual === primeiro) {
        ev.preventDefault()
        ultimo.focus()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [ref, ativo])
}
