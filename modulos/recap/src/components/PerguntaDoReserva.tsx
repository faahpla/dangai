import { TriangleAlert } from 'lucide-react'
import { ROTULO_DA_ETAPA_DO_ROTEIRO, textoDaParada } from '../../shared/roteiro'
import { useRoteiro, type PerguntaDoReserva as Pergunta } from '../store/gerar-roteiro'
import { Botao, COR_DE_AVISO, focarBotao, Secao } from './pecas'

/**
 * A PERGUNTA DO MODELO RESERVA: os modelos bons do Gemini estao sem cota (ou
 * lotados) e o pedido PAROU antes de cair no reserva (o "lite"), cujo roteiro
 * sai chapado, lista de fatos. Antes a troca era calada e so o selo "Modelo
 * reserva" contava, depois de gastar a chamada.
 *
 * No lugar do andamento: no topo para o roteiro inteiro, dentro da parte para
 * o "Refazer" (`compacto`). Os dois botoes sao neutros -- nenhum e o caminho
 * certo para todo mundo:
 * - "Usar modelo reserva" refaz o MESMO pedido com a permissao, e a versao sai
 *   marcada "Modelo reserva";
 * - "Esperar" so fecha. Nada foi gravado: a versao atual e a aprovacao ficam.
 */
export function PerguntaDoReserva({ pergunta, compacto = false }: { pergunta: Pergunta; compacto?: boolean }) {
  const usar = useRoteiro((s) => s.usarReserva)
  const esperar = useRoteiro((s) => s.esperarReserva)
  const aprovando = useRoteiro((s) => s.aprovando)

  const texto = textoDaParada(pergunta)
  // No religar (modo Texto, Meu roteiro) o texto ja esta gravado: o reserva so liga as frases aos momentos.
  const dica = pergunta.religar
    ? `So o ${pergunta.reserva} esta livre agora. Ele liga as frases aos momentos com menos cuidado; o texto fica como esta.`
    : `So o ${pergunta.reserva} esta livre agora. Ele escreve pior: a versao sai marcada "Modelo reserva".`

  const esperarEDevolverFoco = (): void => {
    esperar()
    // O cartao some com o foco: volta para o que pede de novo.
    if (pergunta.secaoId) focarBotao(`refazer-${pergunta.secaoId}`)
    else focarBotao('outra-versao', 'gerar-roteiro')
  }

  const linha = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2" role="status">
      <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-2" title={dica}>
        <TriangleAlert size={12} strokeWidth={1.75} className={`shrink-0 ${COR_DE_AVISO}`} />
        <span className="min-w-0 truncate">{texto}</span>
      </p>
      <Botao pequeno={compacto} foco="usar-reserva" onClick={usar} disabled={aprovando} title={dica}>
        Usar modelo reserva
      </Botao>
      <Botao
        pequeno={compacto}
        onClick={esperarEDevolverFoco}
        title={pergunta.porCota ? 'Fecha o aviso. Peca de novo depois que a cota renovar.' : 'Fecha o aviso. Peca de novo em alguns minutos.'}
      >
        Esperar
      </Botao>
    </div>
  )

  if (compacto) {
    return (
      <div className="flex min-w-0 flex-col rounded-sm border border-line bg-elevated px-3 py-2">
        {linha}
      </div>
    )
  }
  return <Secao titulo={ROTULO_DA_ETAPA_DO_ROTEIRO[pergunta.etapa]}>{linha}</Secao>
}
