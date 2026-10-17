import { useEffect } from 'react'
import { Coins, TriangleAlert } from 'lucide-react'
import { textoDaEstimativa } from '../../shared/voz'
import { useVoz, type PerguntaDeCusto as Pergunta } from '../store/gerar-voz'
import { nucleo } from '../nucleo'
import { Botao, COR_DE_AVISO, focarBotao } from './pecas'

/** Para onde o foco volta quando a pergunta fecha sem gastar: o botao que a abriu. */
export function focoDaPergunta(onde: string): string {
  if (onde === 'narracao') return 'gerar-voz'
  if (onde === 'mudou') return 'regravar-mudou'
  return `regravar-${onde}`
}

/**
 * A PERGUNTA DE CUSTO: gastar caractere SEMPRE passa por aqui. Mostra o que a
 * estimativa do main disse ("~1.034 caracteres · ElevenLabs · restam 8.966")
 * e so o sim chama o motor -- com esse numero como `confirmado`, e o main
 * recusa se o custo real passar dele.
 *
 * Mora no lugar de onde veio o pedido: o cartao da narracao (Gerar), o aviso
 * do roteiro (Regravar so o que mudou) ou a linha da frase (Regravar). Sem
 * saldo, o sim fica desligado. Esc desiste (so a pergunta, nunca o assistente).
 *
 * Sem caixa propria e na altura da linha que ela substitui (o cartao nao pula
 * quando ela entra); `pequeno` nos cartoes de botoes pequenos (a linha da
 * frase, o "roteiro mudou"), para nao misturar dois tamanhos no mesmo cartao.
 */
export function PerguntaDeCusto({
  pergunta,
  pequeno = false,
  extra = null,
}: {
  pergunta: Pergunta
  pequeno?: boolean
  /** Ao lado do custo (o passo 3 poe a duracao prevista do take). */
  extra?: React.ReactNode
}) {
  const confirmar = useVoz((s) => s.confirmar)
  const desistir = useVoz((s) => s.desistir)
  const e = pergunta.estimativa
  const semSaldo = e.suficiente === false

  // O foco vai para o sim: Enter confirma, Esc desiste.
  useEffect(() => {
    focarBotao('confirmar-custo', 'desistir-custo')
  }, [pergunta])

  useEffect(() => {
    const tecla = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      // As Configuracoes por cima ficam com o Esc delas.
      if (nucleo().ler().settingsOpen) return
      ev.stopPropagation()
      desistir()
      focarBotao(focoDaPergunta(pergunta.onde))
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [desistir, pergunta.onde])

  const n = e.fraseIds.length
  const prefixo = pergunta.acao === 'regravar' ? `${n} ${n === 1 ? 'frase' : 'frases'} · ` : ''
  const extras = pergunta.acao === 'regravar' ? e.fraseIds.filter((id) => !pergunta.fraseIds.includes(id)).length : 0
  const texto = `${prefixo}${textoDaEstimativa(e)}`
  const dica = [
    `${e.caracteres.toLocaleString('pt-BR')} caracteres no texto`,
    e.doCache ? 'ja no cache: nao cobra' : null,
    e.creditos !== null ? `~${Math.ceil(e.creditos).toLocaleString('pt-BR')} creditos pela taxa da conta (character-cost das chamadas anteriores)` : null,
    e.aCobrar > 0 ? `teto aceito: ${Math.ceil(e.aCobrar).toLocaleString('pt-BR')} (1 credito por caractere; o motor recusa se passar disso)` : null,
    extras > 0 ? `inclui ${extras} ${extras === 1 ? 'frase que mudou' : 'frases que mudaram'} no roteiro` : null,
    e.limite !== null ? `limite do plano: ${e.limite.toLocaleString('pt-BR')}${e.plano ? ` (${e.plano})` : ''}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div
      role="group"
      aria-label="Confirmar o custo"
      className={['enter flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2', pequeno ? 'min-h-7' : 'min-h-8'].join(' ')}
    >
      <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-2" title={dica}>
        <Coins size={12} strokeWidth={1.5} className="shrink-0 text-accent" />
        <span className="tnum min-w-0 truncate">{texto}</span>
      </p>
      {extra}
      {e.aviso && (
        <span title={e.aviso} className={`flex min-w-0 max-w-[260px] items-center gap-1 text-[11px] ${COR_DE_AVISO}`}>
          <TriangleAlert size={11} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">{e.aviso}</span>
        </span>
      )}
      {semSaldo && <span className="shrink-0 text-[11px] text-danger">Saldo insuficiente</span>}
      <Botao
        principal
        pequeno={pequeno}
        foco="confirmar-custo"
        onClick={() => {
          void confirmar()
          // A pergunta some e o andamento entra no lugar: o foco vai para o Cancelar dele.
          focarBotao('cancelar-voz')
        }}
        disabled={semSaldo}
        title={semSaldo ? 'O que resta na conta nao cobre este pedido' : 'Gasta e gera (Enter)'}
      >
        {pergunta.acao === 'gerar' ? 'Gerar' : 'Regravar'}
      </Botao>
      <Botao
        pequeno={pequeno}
        foco="desistir-custo"
        onClick={() => {
          desistir()
          focarBotao(focoDaPergunta(pergunta.onde))
        }}
        title="Nao gasta nada (Esc)"
      >
        Cancelar
      </Botao>
    </div>
  )
}
