import { useEffect } from 'react'
import { Coins } from 'lucide-react'
import { REAIS_POR_DOLAR, textoDoCusto } from '../../shared/escritor'
import { useRoteiro } from '../store/gerar-roteiro'
import { nucleo } from '../nucleo'
import { Botao, focarBotao } from './pecas'

/**
 * [recap] A PERGUNTA DE CUSTO do escritor pago (Claude Sonnet ou Gemini Pro):
 * pagar SEMPRE passa por aqui, como na voz. O main calculou pelo prompt de
 * verdade e parou sem chamar; o sim refaz o mesmo pedido com o teto (ate 2
 * chamadas), e o main nunca gasta mais que isso. Esc desiste.
 *
 * `compacto`: dentro da parte do "Refazer" (botoes pequenos, sem cartao).
 */
export function PerguntaDoEscritor({ compacto = false }: { compacto?: boolean }) {
  const custo = useRoteiro((s) => s.custo)
  const confirmar = useRoteiro((s) => s.confirmarCusto)
  const desistir = useRoteiro((s) => s.desistirCusto)

  useEffect(() => {
    if (custo) focarBotao('confirmar-escritor')
  }, [custo])

  useEffect(() => {
    if (!custo) return
    const tecla = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape' || nucleo().ler().settingsOpen) return
      ev.stopPropagation()
      desistir()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [custo, desistir])

  if (!custo) return null
  const e = custo.estimativa
  const dica = [
    `${e.rotulo} (${e.modelo}), so para escrever`,
    `~${e.tokensDeEntrada.toLocaleString('pt-BR')} tokens de entrada + ~${e.tokensDeSaida.toLocaleString('pt-BR')} de saida`,
    `Teto: ${textoDoCusto(e.usdMaximo)} (2a chamada so se o tamanho sair fora)`,
    `Cotacao fixa: R$ ${REAIS_POR_DOLAR.toFixed(2).replace('.', ',')}`,
  ].join('\n')

  const conteudo = (
    <div role="group" aria-label="Confirmar o custo" className={['flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2', compacto ? 'min-h-7' : 'min-h-8'].join(' ')}>
      <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-2" title={dica}>
        <Coins size={12} strokeWidth={1.5} className="shrink-0 text-accent" />
        <span className="tnum min-w-0 truncate">
          ~{textoDoCusto(e.usd)} · {e.rotulo}
        </span>
      </p>
      <Botao principal pequeno={compacto} foco="confirmar-escritor" onClick={confirmar} title="Gasta e escreve (Enter)">
        Escrever
      </Botao>
      <Botao pequeno={compacto} onClick={desistir} title="Nao gasta nada (Esc)">
        Cancelar
      </Botao>
    </div>
  )
  if (compacto) return conteudo
  return <section className="enter rounded-md border border-line bg-surface px-4 py-3">{conteudo}</section>
}
