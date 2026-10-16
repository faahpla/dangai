import { Scissors } from 'lucide-react'
import { ROTULO_DO_STATUS_DO_CORTE, temPlanos, type EstadoDoCorte } from '../../shared/episodio'
import { useGerar } from '../store/gerar'
import { EmBreve, Secao } from './pecas'

/**
 * O CORTE EM SEGUNDO PLANO na tela (decisao do Levi, 14/10): o passo 1 nao
 * espera o motor. As falas saem em segundos, o "Proximo: Roteiro" libera, e as
 * cenas sao cortadas (e os personagens reconhecidos) por tras.
 *
 * - AndamentoDoCorte: a linha discreta no cabecalho do assistente, em qualquer
 *   passo ("Cenas 42%"). Clicar leva ao passo 1, onde mora o detalhe. Com o
 *   assistente fechado quem mostra e a AnaliseNaBarra.
 * - SecaoDoCorte: o detalhe, no passo 1 (ResumoDoEpisodio) -- etapas, barra,
 *   Cancelar e, quando para, o porque e o que fazer ("Cortar sem
 *   personagens"). O passo 4 pode montar a mesma secao enquanto espera.
 *
 * [recap] Parte 1: o motor ainda nao veio, entao nada corta. O cabecalho nao
 * mostra nada e a secao diz so "Cortar cenas: em breve". A parte 4 traz de
 * volta o arquivo do Studio inteiro (etapas, barra, Cancelar, Parou).
 */

function porcento(estado: EstadoDoCorte): string {
  return estado.progresso === null ? '' : `${Math.round(estado.progresso * 100)}%`
}

/** O corte esta vivo no main: cortando, ou esperando a vaga do motor. */
export function corteVivo(estado: EstadoDoCorte | null): boolean {
  if (!estado) return false
  return (
    estado.status === 'cortando' ||
    (estado.status === 'pendente' && (estado.mensagem === 'Na fila' || estado.mensagem === 'Esperando o motor'))
  )
}

/** "Cenas 42%" e companhia, numa palavra ou duas. Compartilhado com a barra de status. */
export function textoCurtoDoCorte(estado: EstadoDoCorte): string {
  if (estado.status === 'cortando') return estado.mensagem === 'Cancelando...' ? 'Cancelando...' : `Cenas ${porcento(estado)}`.trim()
  if (estado.status === 'pendente') return corteVivo(estado) ? ROTULO_DO_STATUS_DO_CORTE.pendente : 'Cenas paradas'
  if (estado.status === 'falhou') return ROTULO_DO_STATUS_DO_CORTE.falhou
  return ROTULO_DO_STATUS_DO_CORTE.pronto
}

/** A linha do cabecalho: sem corte nenhum rodando (parte 1), nada a dizer. */
export function AndamentoDoCorte() {
  return null
}

/**
 * O lugar do corte no resumo do episodio: enquanto as cenas nao existem, a
 * linha diz que o corte vem depois. As falas ja valem: o roteiro segue.
 */
export function SecaoDoCorte(_props: { dica?: string } = {}) {
  const indice = useGerar((s) => s.indice)
  if (!indice || temPlanos(indice)) return null
  return (
    <Secao titulo="Cenas">
      <EmBreve icone={<Scissors size={12} strokeWidth={1.5} className="shrink-0" />}>Cortar cenas</EmBreve>
    </Secao>
  )
}
