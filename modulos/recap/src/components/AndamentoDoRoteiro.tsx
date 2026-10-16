import { Check, Circle, Loader2, X } from 'lucide-react'
import { ROTULO_DA_ETAPA_DO_ROTEIRO, type EtapaDoRoteiro } from '../../shared/roteiro'
import { useRoteiro, type GeracaoEmCurso } from '../store/gerar-roteiro'
import { Barra, useRelogio } from './AndamentoDaAnalise'
import { Botao, focarBotao, formatarTempo, Secao } from './pecas'

/**
 * Uma palavra por etapa, como os chips da analise do passo 1 -- e diferente
 * do passo "2 Roteiro" do cabecalho, que ja diz onde se esta. O nome inteiro
 * vai no tooltip.
 */
const ROTULO_CURTO: Record<'eventos' | 'roteiro' | 'religar', string> = {
  eventos: 'Ler',
  roteiro: 'Escrever',
  religar: 'Ligar',
}

/**
 * O ANDAMENTO DE UM PEDIDO A IA: a etapa, quem responde, o tempo decorrido e
 * o Cancelar. A chamada leva de segundos a minutos (mais quando o modelo esta
 * lotado e o llm.ts troca de modelo); nenhum segundo passa sem sinal.
 *
 * A etapa aparece UMA vez (o titulo); a linha de baixo so diz quem responde e
 * quanto costuma levar ("Gemini · ate 2 min"), que e o que o main manda.
 *
 * O Cancelar e honesto sobre o que faz: a chamada ao Gemini nao tem como ser
 * abortada, entao ele para de ESPERAR. A tela volta a ser dele na hora, e a
 * resposta que chegar depois vai para Versoes sem mexer no que esta na tela
 * nem na aprovacao (gerar-roteiro.ts, cancelarRoteiro no main).
 *
 * `cancelado`: o cartao fica ~1 s no lugar dizendo "Cancelado", sem Cancelar,
 * para a lista nao subir embaixo do cursor.
 *
 * `compacto`: a linha dentro da parte que esta sendo refeita, onde o olho
 * esta -- o cartao do topo podia estar fora da vista.
 */
export function AndamentoDoRoteiro({
  geracao,
  compacto = false,
  cancelado = false,
}: {
  geracao: GeracaoEmCurso
  compacto?: boolean
  cancelado?: boolean
}) {
  const cancelar = useRoteiro((s) => s.cancelarGeracao)
  const agora = useRelogio(!cancelado)
  const decorrido = Math.max(0, (agora - geracao.inicio) / 1000)
  const rotulo = ROTULO_DA_ETAPA_DO_ROTEIRO[geracao.etapa]
  const quem = geracao.mensagem ?? (geracao.comecou ? 'Comecando...' : 'Esperando a resposta anterior...')
  const frase = cancelado ? 'Cancelado.' : compacto ? `${rotulo} · ${quem}` : quem

  const cancelarEDevolverFoco = (): void => {
    cancelar()
    // O botao some com o andamento: o foco vai para o que da para fazer agora.
    if (geracao.secaoId) focarBotao(`refazer-${geracao.secaoId}`)
    else focarBotao('outra-versao', 'gerar-roteiro', 'meu-roteiro')
  }

  const tempo = (
    <span className="tnum text-[11px] text-ink-3" title="Tempo decorrido">
      {formatarTempo(decorrido)}
    </span>
  )
  // Cancelado, o "Cancelado." da linha de baixo ja diz: o canto fica so com o tempo parado.
  const botao = cancelado ? null : (
    <Botao
      pequeno
      onClick={cancelarEDevolverFoco}
      title={
        geracao.religar
          ? 'Para de esperar. O texto fica salvo; as frases novas ficam sem momento por enquanto.'
          : 'Para de esperar. Se a resposta chegar depois, ela fica em Versoes.'
      }
    >
      Cancelar
    </Botao>
  )
  const icone = cancelado ? (
    <X size={12} strokeWidth={1.75} className="shrink-0 text-ink-3" />
  ) : (
    <Loader2 size={12} strokeWidth={1.75} className="shrink-0 animate-spin text-accent" />
  )

  if (compacto) {
    return (
      <div className="flex min-w-0 flex-col gap-2 rounded-sm border border-line bg-elevated px-3 py-2" aria-live="polite">
        <div className="flex min-w-0 items-center gap-2">
          {icone}
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={frase}>
            {frase}
          </span>
          {tempo}
          {botao ?? <span className="h-7 w-0" aria-hidden />}
        </div>
        {cancelado ? <div className="h-[3px] w-full rounded-full bg-line-strong" /> : <Barra fracao={null} />}
      </div>
    )
  }

  return (
    <Secao
      titulo={rotulo}
      acao={
        <div className="flex items-center gap-3">
          {tempo}
          {botao}
        </div>
      }
    >
      {geracao.comEventos && geracao.etapa !== 'secao' && (
        <Etapas atual={geracao.etapa} parado={cancelado} depois={geracao.religar ? 'religar' : 'roteiro'} />
      )}
      {cancelado ? <div className="h-[3px] w-full rounded-full bg-line-strong" /> : <Barra fracao={null} />}
      <p className="min-w-0 select-text truncate text-[11px] text-ink-2" title={frase} aria-live="polite">
        {frase}
      </p>
    </Secao>
  )
}

/**
 * Primeira vez: ler o episodio (eventos) e depois escrever -- ou, no roteiro
 * colado, ligar as frases. Os mesmos chips da analise.
 */
function Etapas({ atual, parado, depois }: { atual: EtapaDoRoteiro; parado: boolean; depois: 'roteiro' | 'religar' }) {
  const etapas = ['eventos', depois] as const
  return (
    <ol className="grid grid-cols-2 gap-1.5">
      {etapas.map((etapa) => {
        const eAtual = etapa === atual
        const feita = etapa === 'eventos' && atual !== 'eventos'
        return (
          <li
            key={etapa}
            title={ROTULO_DA_ETAPA_DO_ROTEIRO[etapa]}
            aria-current={eAtual ? 'step' : undefined}
            className={[
              'flex h-7 min-w-0 items-center gap-1.5 rounded-sm border px-2',
              eAtual && !parado ? 'border-accent bg-accent-dim' : 'border-line bg-elevated',
            ].join(' ')}
          >
            {eAtual && !parado ? (
              <Loader2 size={11} strokeWidth={1.75} className="shrink-0 animate-spin text-accent" />
            ) : feita ? (
              <Check size={11} strokeWidth={2} className="shrink-0 text-ink-2" />
            ) : (
              <Circle size={11} strokeWidth={1.5} className="shrink-0 text-ink-3" />
            )}
            <span className={['min-w-0 truncate text-[11px]', eAtual ? 'text-ink' : feita ? 'text-ink-2' : 'text-ink-3'].join(' ')}>
              {ROTULO_CURTO[etapa]}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
