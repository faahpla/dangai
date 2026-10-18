import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Columns2, Loader2, ScanSearch, Sparkles, SpellCheck } from 'lucide-react'
import { mudancasNaTela, type ModoDaRevisao, type MudancaDaRevisao } from '../../shared/revisao'
import { useRoteiro } from '../store/gerar-roteiro'
import { Botao, focarBotao } from './pecas'

/**
 * [recap, A2] O REVISOR no passo 2, do jeito que o Levi acha: um BOTAO de
 * verdade na barra ("Revisar", com icone, como Estilo/Meu roteiro/Versoes) e
 * um menu pequeno com os dois modos. Antes era um link apagado ao lado das
 * palavras, e ele nao achou.
 *
 * Depois de revisar, o que mudou aparece: o recado no rodape ("6 frases
 * melhoradas"), a marca discreta em cada frase trocada (o texto de antes no
 * tooltip) e o "Comparar" (as duas versoes lado a lado). A versao que fica e
 * ele quem escolhe, em Versoes, como sempre.
 */

const MODOS: readonly { modo: ModoDaRevisao; titulo: string; detalhe: string; dica: string }[] = [
  {
    modo: 'corrigir',
    titulo: 'Corrigir erros',
    detalhe: 'Fatos, nomes, clareza',
    dica: 'Confere cada frase contra as falas: sem prova, contradiz, confusa, fraca, repetida. Ja faz a versao Revisada. 1 pedido, gratis no Gemini.',
  },
  {
    modo: 'melhorar',
    titulo: 'Melhorar texto',
    detalhe: 'Gancho, ritmo, virada',
    dica: 'Reescreve os trechos chapados com gancho e ritmo, no seu Estilo, sem fato novo. Faz a versao Melhorada. 1 pedido, gratis no Gemini.',
  },
]

/** O botao "Revisar" e o menu dos dois modos. Enquanto a IA confere, o botao diz o que esta fazendo. */
export function BotaoRevisar({ travado, revisado }: { travado: boolean; revisado: boolean }) {
  const revisando = useRoteiro((s) => s.revisando)
  const modoNoAr = useRoteiro((s) => s.revisandoModo)
  const revisar = useRoteiro((s) => s.revisar)
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  // Esc fecha o menu, e so ele (sem isto o Esc do app fechava o assistente).
  useEffect(() => {
    if (!aberto) return
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setAberto(false)
      focarBotao('revisar')
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [aberto])

  // Clicar fora fecha (pelo documento, como o Versoes: o `enter` da barra prende o `fixed`).
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent): void => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('pointerdown', fora, true)
    return () => document.removeEventListener('pointerdown', fora, true)
  }, [aberto])

  // A IA comecou a escrever com o menu aberto: fecha.
  useEffect(() => {
    if (travado) setAberto(false)
  }, [travado])

  if (revisando && modoNoAr !== null) {
    // No ar (pedido pelo botao): o mesmo desenho do botao, sem o apagado de desligado (nao e erro, e trabalho).
    return (
      <span
        role="status"
        className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border border-line bg-elevated px-2.5 text-[11px] font-medium text-ink-2"
      >
        <Loader2 size={12} strokeWidth={1.75} className="animate-spin text-accent" />
        {modoNoAr === 'melhorar' ? 'Melhorando' : 'Revisando'}
      </span>
    )
  }

  return (
    <div ref={caixa} className="relative">
      <Botao
        pequeno
        foco="revisar"
        onClick={() => setAberto((v) => !v)}
        disabled={travado || revisando}
        title={
          travado || revisando
            ? 'Espere a IA terminar (ou volte para Partes)'
            : `Revisar o roteiro: corrigir erros ou melhorar o texto${revisado ? '. Esta versao ja foi conferida: nada a apontar.' : ''}`
        }
      >
        <ScanSearch size={12} strokeWidth={1.5} className={aberto ? 'text-accent' : undefined} />
        Revisar
        {revisado && <Check size={11} strokeWidth={2} className="text-[#4f9a74]" aria-label="Revisado" />}
        <ChevronDown size={11} strokeWidth={1.75} className="-mr-0.5 text-ink-3" />
      </Botao>
      {aberto && (
        <ul
          role="menu"
          aria-label="Revisar"
          className="glass enter absolute right-0 top-[calc(100%+6px)] z-50 w-[232px] rounded-md p-1.5"
          style={{ backgroundColor: 'var(--color-elevated)' }}
        >
          {MODOS.map((m) => (
            <li key={m.modo} role="none">
              <button
                type="button"
                role="menuitem"
                data-foco={`revisar-${m.modo}`}
                title={m.dica}
                onClick={() => {
                  setAberto(false)
                  void revisar(false, m.modo)
                }}
                className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-ink-2 hover:bg-accent-dim hover:text-ink focus-visible:bg-accent-dim focus-visible:text-ink focus-visible:outline-none"
              >
                {m.modo === 'melhorar' ? (
                  <Sparkles size={13} strokeWidth={1.5} className="shrink-0 text-accent" />
                ) : (
                  <SpellCheck size={13} strokeWidth={1.5} className="shrink-0 text-accent" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="text-[12px] font-medium text-ink">{m.titulo}</span>
                  <span className="truncate text-[11px] text-ink-3">{m.detalhe}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** As frases que o revisor trocou e continuam como ele deixou (a marca de cada uma e o resumo da barra). */
export function useMudancasDaRevisao(): Map<string, MudancaDaRevisao> {
  const tela = useRoteiro((s) => s.tela)
  const roteiros = useRoteiro((s) => s.rascunho?.roteiros)
  return useMemo(() => (roteiros ? mudancasNaTela({ roteiros }, tela) : new Map<string, MudancaDaRevisao>()), [roteiros, tela])
}

/**
 * Embaixo da barra, quando a versao na tela veio do revisor: "6 frases
 * melhoradas" (ou "1 frase corrigida") e o "Comparar" com a versao de onde
 * ela saiu. Na linha de baixo, e nao na barra: com a contagem fora do tempo
 * ("Refazer para 60 s") a barra ja nao cabia numa linha.
 */
export function ResumoDasMudancas({ travado }: { travado: boolean }) {
  const mudancas = useMudancasDaRevisao()
  const comparando = useRoteiro((s) => s.comparando)
  const abrirComparar = useRoteiro((s) => s.abrirComparar)
  const fecharComparar = useRoteiro((s) => s.fecharComparar)
  if (mudancas.size === 0) return null
  // A 2a metade de uma frase dividida nao conta outra frase.
  const trocadas = [...mudancas.values()].filter((m) => m.antes !== '').length || mudancas.size
  const melhorar = [...mudancas.values()][0]!.modo === 'melhorar'
  const rotulo = melhorar ? (trocadas === 1 ? 'frase melhorada' : 'frases melhoradas') : trocadas === 1 ? 'frase corrigida' : 'frases corrigidas'
  const Icone = melhorar ? Sparkles : Check
  return (
    <span className="flex shrink-0 items-center gap-3">
      <span
        className="tnum flex items-center gap-1.5 text-[11px] text-ink-2"
        title="A marca em cada frase trocada mostra o texto de antes. A versao de antes fica em Versoes."
      >
        <Icone size={12} strokeWidth={melhorar ? 1.5 : 2} className="text-accent" />
        {trocadas} {rotulo}
      </span>
      <button
        type="button"
        data-foco="comparar"
        onClick={comparando === null ? () => abrirComparar() : fecharComparar}
        disabled={travado}
        title="As duas versoes lado a lado, frase por frase"
        className="flex shrink-0 items-center gap-1 text-[11px] text-ink-2 underline-offset-2 hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Columns2 size={12} strokeWidth={1.5} className={comparando !== null ? 'text-accent' : 'text-ink-3'} />
        {comparando === null ? 'Comparar' : 'Fechar comparacao'}
      </button>
    </span>
  )
}

/**
 * A MARCA DISCRETA de uma frase trocada pelo revisor: um icone pequeno, o
 * texto de antes no tooltip. Some quando ele mexe na frase.
 */
export function MarcaDaMudanca({ mudanca }: { mudanca: MudancaDaRevisao }) {
  const dica = mudanca.antes ? `Antes: ${mudanca.antes}` : 'Frase nova (dividida pelo revisor)'
  const Icone = mudanca.modo === 'melhorar' ? Sparkles : Check
  return (
    <span title={dica} aria-label={dica} className="grid size-5 shrink-0 place-items-center text-accent opacity-80">
      <Icone size={11} strokeWidth={mudanca.modo === 'melhorar' ? 1.75 : 2} />
    </span>
  )
}
