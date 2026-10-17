import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Clapperboard, TriangleAlert } from 'lucide-react'
import { roteiroAtual } from '../../shared/roteiro'
import { podeIrParaCenas, takeAtual } from '../../shared/voz'
import { useGerar } from '../store/gerar'
import { roteiroAprovado, useRoteiro } from '../store/gerar-roteiro'
import { alinhamentoFraco, resumoDaFalhaDaVoz, useSituacaoDaVoz, useVoz } from '../store/gerar-voz'
import { nucleo } from '../nucleo'
import { Botao, COR_DE_AVISO, focarBotao, formatarTempo, Link } from './pecas'

/**
 * A BARRA DE BAIXO do passo 3, no lugar da do passo 2: voltar, o recado do
 * momento e a acao principal ("Aprovar voz").
 *
 * O meio, por prioridade: o erro de uma chamada (curto; a nota inteira no
 * tooltip); durante um pedido, que da para fechar; a voz desatualizada (o
 * roteiro mudou) -- o ESTADO de agora vence o recado de uma acao de antes
 * ("Importado." escondia o "Roteiro mudou"); o recado (gasto, cache,
 * cancelado); e, sem nada disso, o take na tela.
 *
 * Alinhamento fraco (o audio pode nao ser o roteiro, ou o som desmente o tempo
 * de alguma palavra): o "Aprovar voz" pede confirmacao antes.
 *
 * Aprovada, o "Proximo: Cenas" leva ao passo 4 (as cenas ja estao sugeridas
 * em segundo plano desde a aprovacao do roteiro).
 */
export function RodapeDaVoz() {
  const irParaPasso = useGerar((s) => s.irParaPasso)
  const rascunho = useRoteiro((s) => s.rascunho)
  const roteiroOk = useRoteiro(roteiroAprovado)
  const situacao = useSituacaoDaVoz()
  const pedido = useVoz((s) => s.pedido)
  const aprovando = useVoz((s) => s.aprovando)
  const perguntaAberta = useVoz((s) => s.pergunta !== null || s.perguntando !== null)
  const erro = useVoz((s) => s.erro)
  const recado = useVoz((s) => s.recado)
  const recadoDetalhe = useVoz((s) => s.recadoDetalhe)
  const limparErro = useVoz((s) => s.limparErro)
  const limparRecado = useVoz((s) => s.limparRecado)
  const aprovar = useVoz((s) => s.aprovar)
  const desaprovar = useVoz((s) => s.desaprovar)
  const [confirmando, setConfirmando] = useState(false)

  const take = rascunho ? takeAtual(rascunho) : null
  const fraco = take !== null && alinhamentoFraco(take)
  const aprovada = situacao === 'aprovada'
  const podeAprovar = roteiroOk && situacao === 'pronta' && pedido === null && !aprovando && !perguntaAberta
  const porqueNao = !roteiroOk
    ? 'Aprove o roteiro antes'
    : !take
      ? 'Gere ou importe a voz antes'
      : situacao === 'desatualizada'
        ? 'O roteiro mudou: atualize a voz antes'
        : pedido
          ? 'Espere a voz terminar'
          : perguntaAberta
            ? 'Responda a pergunta de custo antes'
            : fraco
              ? 'Alinhamento fraco: pede confirmacao antes de aprovar'
              : 'Esta e a narracao do recap'
  // O mesmo que o passo 4 exige (passoLiberado): roteiro e voz aprovados, e a voz em dia com o roteiro.
  const cenas = rascunho !== null && podeIrParaCenas(rascunho, roteiroAtual(rascunho))

  // A confirmacao era deste take e deste momento: trocar de take, comecar um pedido ou travar a aprovacao fecha.
  const takeId = take?.id ?? null
  useEffect(() => setConfirmando(false), [takeId])
  useEffect(() => {
    if (!podeAprovar) setConfirmando(false)
  }, [podeAprovar])

  // Esc fecha so a confirmacao (sem isto, o Esc do app fechava o assistente).
  useEffect(() => {
    if (!confirmando) return
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || nucleo().ler().settingsOpen) return
      e.stopPropagation()
      setConfirmando(false)
      focarBotao('aprovar-voz')
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [confirmando])

  const aprovarEFocar = async (): Promise<void> => {
    setConfirmando(false)
    await aprovar()
    // O botao virou "Aprovada": o foco vai para o "Desfazer" ([recap] o "Proximo: Cenas" espera a parte 3).
    focarBotao('desaprovar-voz')
  }

  const pedirAprovacao = (): void => {
    if (fraco && !confirmando) {
      setConfirmando(true)
      focarBotao('aprovar-mesmo-assim')
      return
    }
    void aprovarEFocar()
  }

  return (
    <footer className="flex h-[52px] shrink-0 items-center gap-3 border-t border-line px-5">
      <Botao onClick={() => irParaPasso(2)} title="Voltar ao roteiro (passo 2). A voz fica salva.">
        <ArrowLeft size={13} strokeWidth={1.5} />
        Voltar
      </Botao>

      <div className="flex min-w-0 flex-1 items-center gap-2" aria-live="polite">
        {confirmando ? (
          <span className={`flex min-w-0 items-center gap-1.5 text-[11px] ${COR_DE_AVISO}`} title="Ouca as frases antes: as palavras podem acender fora de hora.">
            <TriangleAlert size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="min-w-0 truncate">Alinhamento fraco. Aprovar assim?</span>
          </span>
        ) : erro ? (
          <button
            type="button"
            onClick={limparErro}
            title={`${erro}\n\nClique para fechar o aviso.`}
            className="min-w-0 truncate text-left text-[11px] text-danger"
          >
            {resumoDaFalhaDaVoz(erro).curto}
          </button>
        ) : pedido ? (
          // Como no passo 2: fechar o assistente nao cancela nada.
          <span className="min-w-0 truncate text-[11px] text-ink-3">Pode fechar: a voz continua</span>
        ) : situacao === 'desatualizada' ? (
          <span className={`min-w-0 truncate text-[11px] ${COR_DE_AVISO}`}>Roteiro mudou depois da voz</span>
        ) : recado ? (
          <button
            type="button"
            onClick={limparRecado}
            title={`${recadoDetalhe ? `${recado}\n${recadoDetalhe}` : recado}\n\nClique para fechar o recado.`}
            className="min-w-0 truncate text-left text-[11px] text-ink-2"
          >
            {recado}
          </button>
        ) : take ? (
          <span className="tnum min-w-0 truncate text-[11px] text-ink-3">
            {take.id} · {formatarTempo(take.duracao, 1)}
          </span>
        ) : null}
      </div>

      {aprovada ? (
        <>
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-2">
            <Check size={13} strokeWidth={2} className="text-accent" />
            Aprovada
          </span>
          <Link
            foco="desaprovar-voz"
            onClick={() => void desaprovar()}
            disabled={pedido !== null}
            title="Tira a aprovacao (trocar de take tambem tira)"
          >
            Desfazer
          </Link>
          {/* A acao que leva adiante: o rosa da tela, como o "Proximo: Voz" do passo 2. */}
          {cenas && (
            // [recap] As cenas chegam na parte 3: o botao fica no lugar, desligado, com o porque.
            <Botao principal foco="proximo-cenas" onClick={() => {}} disabled title="As cenas chegam em breve">
              <Clapperboard size={13} strokeWidth={1.5} />
              Proximo: Cenas
              <span className="text-[11px] font-normal opacity-80">em breve</span>
            </Botao>
          )}
        </>
      ) : confirmando ? (
        <>
          <Link
            onClick={() => {
              setConfirmando(false)
              focarBotao('aprovar-voz')
            }}
            title="Nao aprova (Esc)"
          >
            Cancelar
          </Link>
          <Botao principal foco="aprovar-mesmo-assim" onClick={() => void aprovarEFocar()} disabled={!podeAprovar} title="Aprova esta narracao mesmo com o alinhamento fraco">
            <Check size={13} strokeWidth={1.75} />
            Aprovar mesmo assim
          </Botao>
        </>
      ) : (
        <Botao principal foco="aprovar-voz" onClick={pedirAprovacao} disabled={!podeAprovar} title={porqueNao}>
          <Check size={13} strokeWidth={1.75} />
          {aprovando ? 'Aprovando...' : 'Aprovar voz'}
        </Botao>
      )}
    </footer>
  )
}
