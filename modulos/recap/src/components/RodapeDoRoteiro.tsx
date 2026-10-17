import { ArrowLeft, ArrowRight, AudioLines, Check } from 'lucide-react'
import { ROTULO_DO_PAPEL, type ProblemaDoRoteiro } from '../../shared/roteiro'
import { useGerar } from '../store/gerar'
import { resumoDaFalha, roteiroAprovado, useProblemasDoRoteiro, useRoteiro } from '../store/gerar-roteiro'
import { focarFrase } from './SecaoDoRoteiro'
import { Botao, focarBotao, Link } from './pecas'

/** "Frase vazia · Gancho": a mensagem e onde ela esta. */
function ondeEsta(problema: ProblemaDoRoteiro, papelDaSecao: (id: string) => string | null): string {
  const papel = problema.secaoId ? papelDaSecao(problema.secaoId) : null
  return papel ? `${problema.mensagem} · ${papel}` : problema.mensagem
}

/** Leva o olho (e o cursor) ate o problema. */
function irAte(problema: ProblemaDoRoteiro): void {
  if (problema.fraseId) {
    focarFrase(problema.fraseId, 'fim')
    return
  }
  if (problema.secaoId) {
    document.querySelector(`[data-secao="${problema.secaoId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

/**
 * A BARRA DE BAIXO do passo 2, no lugar da do passo 1: voltar, o recado do
 * momento e a acao principal ("Aprovar roteiro").
 *
 * O meio, por prioridade: o erro de uma chamada (curto; a nota inteira no
 * tooltip -- inteira e cortada, ela perdia o "o que fazer"); o "Desfazer" de
 * uma frase ou parte removida; o recado; durante a IA, que da para fechar; o
 * que impede a aprovacao (frase vazia...), menos a frase vazia em que ele
 * esta escrevendo agora -- clicar leva ate o problema; e, sem nada disso, so o
 * "Salvo" discreto.
 *
 * Aprovado, o "Proximo: Voz" leva ao passo 3.
 */
export function RodapeDoRoteiro() {
  const irParaPasso = useGerar((s) => s.irParaPasso)
  const rascunho = useRoteiro((s) => s.rascunho)
  const tela = useRoteiro((s) => s.tela)
  const sujo = useRoteiro((s) => s.sujo)
  const salvando = useRoteiro((s) => s.salvando)
  const geracao = useRoteiro((s) => s.geracao)
  const aprovando = useRoteiro((s) => s.aprovando)
  const erro = useRoteiro((s) => s.erro)
  const recado = useRoteiro((s) => s.recado)
  const recadoDetalhe = useRoteiro((s) => s.recadoDetalhe)
  const remocao = useRoteiro((s) => s.remocao)
  const fraseEmFoco = useRoteiro((s) => s.fraseEmFoco)
  const aprovado = useRoteiro(roteiroAprovado)
  const limparErro = useRoteiro((s) => s.limparErro)
  const limparRecado = useRoteiro((s) => s.limparRecado)
  const desfazerRemocao = useRoteiro((s) => s.desfazerRemocao)
  const aprovar = useRoteiro((s) => s.aprovar)
  const desaprovar = useRoteiro((s) => s.desaprovar)
  const noTexto = useRoteiro((s) => s.modo === 'texto')
  const problemas = useProblemasDoRoteiro()

  const bloqueio = problemas.find((p) => p.nivel === 'erro') ?? null
  // A frase vazia com o cursor nela e ele escrevendo: o Aprovar fica desligado,
  // mas o rodape nao grita (o cartao da frase tambem nao).
  const bloqueioVisivel =
    problemas.find((p) => p.nivel === 'erro' && !(p.codigo === 'frase-vazia' && p.fraseId === fraseEmFoco)) ?? null
  const papelDaSecao = (id: string): string | null => {
    const papel = tela?.secoes.find((s) => s.id === id)?.papel
    return papel ? ROTULO_DO_PAPEL[papel] : null
  }

  const podeAprovar = tela !== null && geracao === null && !aprovando && bloqueio === null
  const porqueNao = !tela
    ? 'Sem roteiro ainda'
    : geracao
      ? 'Espere a IA terminar'
      : bloqueio
        ? `Corrija antes: ${ondeEsta(bloqueio, papelDaSecao)}`
        : noTexto
          ? 'Liga as frases novas ao episodio e aprova. Este e o texto que vai ser narrado'
          : 'Este e o texto que vai ser narrado'

  const estado = !rascunho?.atual
    ? ''
    : `v${rascunho.atual}${salvando || sujo ? ' · Salvando...' : ' · Salvo'}`

  const aprovarEFocar = async (): Promise<void> => {
    await aprovar()
    // O botao virou "Aprovado": o foco vai para o "Proximo: Voz" (Enter segue), ou o "Desfazer".
    focarBotao('ir-a-voz', 'desaprovar')
  }

  return (
    <footer className="flex h-[52px] shrink-0 items-center gap-3 border-t border-line px-5">
      <Botao onClick={() => irParaPasso(1)} title="Voltar ao episodio (passo 1). O roteiro fica salvo.">
        <ArrowLeft size={13} strokeWidth={1.5} />
        Voltar
      </Botao>

      <div className="flex min-w-0 flex-1 items-center gap-2" aria-live="polite">
        {erro ? (
          <button
            type="button"
            onClick={limparErro}
            title={`${erro}\n\nClique para fechar o aviso.`}
            className="min-w-0 truncate text-left text-[11px] text-danger"
          >
            {resumoDaFalha(erro).curto}
          </button>
        ) : remocao ? (
          <>
            <span className="shrink-0 text-[11px] text-ink-2">{remocao.tipo === 'frase' ? 'Frase removida' : 'Parte removida'}</span>
            <Link onClick={desfazerRemocao} disabled={geracao !== null} title="Poe de volta no lugar">
              Desfazer
            </Link>
          </>
        ) : recado ? (
          <button
            type="button"
            onClick={limparRecado}
            title={`${recadoDetalhe ? `${recado}\n${recadoDetalhe}` : recado}\n\nClique para fechar o recado.`}
            className="min-w-0 truncate text-left text-[11px] text-ink-2"
          >
            {recado}
          </button>
        ) : geracao ? (
          // Como na analise do passo 1: fechar o assistente nao cancela nada.
          <span className="min-w-0 truncate text-[11px] text-ink-3">Pode fechar: a IA continua</span>
        ) : bloqueioVisivel ? (
          <button
            type="button"
            onClick={() => irAte(bloqueioVisivel)}
            title="Impede a aprovacao. Clique para ir ate la."
            className="min-w-0 truncate text-left text-[11px] text-danger"
          >
            {ondeEsta(bloqueioVisivel, papelDaSecao)}
          </button>
        ) : (
          <span className="tnum min-w-0 truncate text-[11px] text-ink-3">{estado}</span>
        )}
      </div>

      {aprovado ? (
        <>
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-2">
            <Check size={13} strokeWidth={2} className="text-accent" />
            Aprovado
          </span>
          <Link
            foco="desaprovar"
            onClick={() => void desaprovar()}
            disabled={geracao !== null}
            title="Tira a aprovacao (editar tambem tira)"
          >
            Desfazer
          </Link>
          {/* A acao que leva adiante: o rosa da tela, como o "Proximo: Roteiro" do passo 1. */}
          <Botao
            principal
            foco="ir-a-voz"
            onClick={() => irParaPasso(3)}
            disabled={geracao !== null}
            title="Ir a voz (passo 3). O roteiro aprovado e o que vai ser narrado."
          >
            <AudioLines size={13} strokeWidth={1.5} />
            Proximo: Voz
            <ArrowRight size={13} strokeWidth={1.5} />
          </Botao>
        </>
      ) : (
        <Botao principal onClick={() => void aprovarEFocar()} disabled={!podeAprovar} title={porqueNao}>
          <Check size={13} strokeWidth={1.75} />
          {aprovando ? 'Aprovando...' : 'Aprovar roteiro'}
        </Botao>
      )}
    </footer>
  )
}
