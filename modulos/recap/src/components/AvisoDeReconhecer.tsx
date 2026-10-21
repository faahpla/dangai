import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { TriangleAlert, Users, X } from 'lucide-react'
import {
  avisoDeReconhecimento,
  corpoDoAviso,
  detalheDoAviso,
  pedeSugerirDeNovo,
  seloDoAviso,
  textoDoAviso,
  tituloDoAviso,
} from '../../shared/aviso-reconhecer'
import { podeReconhecerNaMao, SO_NO_ANCUT } from '../../shared/descoberta'
import { useGerar } from '../store/gerar'
import { useAncut } from '../store/ancut'
import { useIndiceDasCenas } from '../store/gerar-cenas'
import { useDescoberta } from '../store/gerar-descoberta'
import {
  armazem,
  esquecerSemPersonagens,
  fecharAviso,
  porqueNaoReconhecerAgora,
  reconhecerAgoraESeguir,
  seguirAssim,
  useAvisoReconhecer,
} from '../store/aviso-reconhecer'
import { usePrenderFoco } from '../hooks/usePrenderFoco'
import { useOferta } from './EntradaDaDescoberta'
import { Botao, COR_DE_AVISO, focarBotao } from './pecas'

/** As duas portas de reconhecer, com o porque de cada uma estar desligada. */
function usePortas(): {
  agora: string | null
  naMao: string | null
  /** Os dois fechados: o que fazer, no lugar dos botoes (botao que nao clica so confunde). */
  nenhum: string | null
  iniciarNaMao: () => void
} {
  const indice = useGerar((s) => s.indice)
  const corte = useGerar((s) => s.corte)
  const exclusoesMudaram = useGerar((s) => s.exclusoesMudaram)
  const motor = useGerar((s) => s.motor)
  const palpite = useGerar((s) => s.palpite)
  const job = useGerar((s) => s.job)
  const trazendo = useAncut((s) => (indice ? s.porEpisodio[indice.id]?.fase === 'trazendo' : false))
  const oferta = useOferta()
  const iniciar = useDescoberta((s) => s.iniciar)
  const agora = porqueNaoReconhecerAgora({ indice, exclusoesMudaram, motor, palpite, job }, trazendo)
  const naMao = !indice
    ? 'Sem episodio'
    : oferta
      ? oferta.desligado
      : podeReconhecerNaMao(indice, corte).porque || 'O Reconhecer na mao ja esta aberto'
  const nenhum = agora === null || naMao === null ? null : agora === SO_NO_ANCUT || naMao === SO_NO_ANCUT ? SO_NO_ANCUT : naMao
  return { agora, naMao, nenhum, iniciarNaMao: () => void iniciar() }
}

/**
 * (21/10) O AVISO ANTES DE SEGUIR (store/aviso-reconhecer.ts): por cima do
 * assistente, no passo 1. O principal e reconhecer (o automatico quando da,
 * senao o na mao); "Seguir assim" e neutro. Esc, o X ou clicar fora fecham
 * sem seguir.
 */
export function AvisoDeReconhecer() {
  const aberto = useAvisoReconhecer((s) => s.aberto)
  const episodioId = useGerar((s) => s.indice?.id ?? null)
  const passo = useGerar((s) => s.passo)
  const fase = useGerar((s) => s.fase)
  const portas = usePortas()
  const caixa = useRef<HTMLDivElement>(null)
  usePrenderFoco(caixa, aberto !== null)

  // Saiu do passo 1, trocou de episodio ou o episodio deixou de estar pronto: a pergunta perde o sentido.
  useEffect(() => {
    if (aberto && (aberto.episodioId !== episodioId || passo !== 1 || fase !== 'pronto')) fecharAviso()
  }, [aberto, episodioId, passo, fase])

  const principal = portas.agora === null ? 'aviso-reconhecer-agora' : portas.naMao === null ? 'aviso-reconhecer-na-mao' : 'aviso-seguir-assim'
  useEffect(() => {
    if (!aberto) return
    focarBotao(principal, 'aviso-seguir-assim')
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // So o aviso fecha: o Esc nao desce ate o do assistente (que fecharia tudo).
      e.preventDefault()
      e.stopPropagation()
      fecharAviso()
      focarBotao('proximo-roteiro')
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
    // O foco inicial so ao abrir; o principal muda pouco e nao deve roubar o foco.
  }, [aberto])

  if (!aberto) return null
  const detalhe = detalheDoAviso(aberto)
  const forte = aberto.tipo === 'sem'

  return createPortal(
    // Fundo mais escuro e desfocado que o das outras perguntas: atras ficam os
    // mesmos botoes de reconhecer do resumo, e com 45% pareciam repetidos.
    <div className="fixed inset-0 z-[40] grid place-items-center bg-black/60 backdrop-blur-[2px]" onPointerDown={fecharAviso}>
      <div
        ref={caixa}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="aviso-reconhecer-titulo"
        aria-describedby="aviso-reconhecer-texto"
        onPointerDown={(e) => e.stopPropagation()}
        // Fundo cheio por cima do glass, como a boas-vindas e a escolha do recap.
        style={{ backgroundColor: 'var(--color-elevated)' }}
        className="glass enter flex w-[560px] min-w-[min(520px,calc(100%-32px))] max-w-[calc(100%-32px)] flex-col rounded-lg"
      >
        <header className="flex min-w-0 items-start gap-3 px-5 pt-5">
          <span
            className={[
              'grid size-9 shrink-0 place-items-center rounded-md border',
              forte ? `border-[#f6a23c]/40 bg-[#f6a23c]/10 ${COR_DE_AVISO}` : 'border-line bg-surface text-ink-3',
            ].join(' ')}
          >
            <TriangleAlert size={16} strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
            <h2 id="aviso-reconhecer-titulo" className="text-[15px] font-semibold leading-snug text-ink">
              {tituloDoAviso(aberto)}
            </h2>
            <p id="aviso-reconhecer-texto" className="text-[12px] leading-relaxed text-ink-2">
              {corpoDoAviso(aberto)}
            </p>
            {detalhe && <p className="tnum text-[11px] text-ink-3">{detalhe}</p>}
          </div>
          <button
            type="button"
            onClick={fecharAviso}
            aria-label="Fechar"
            title="Fechar sem seguir (Esc)"
            className="-mr-1.5 -mt-1.5 grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:bg-surface hover:text-ink"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </header>
        {portas.nenhum ? (
          // Nenhum caminho daqui (o episodio do AnCut, sobretudo): o que fazer no lugar dos botoes mortos.
          // pl-[68px]: o texto alinha com o do cabecalho (20 de margem + 36 do icone + 12 de vao).
          <footer className="flex flex-nowrap items-center gap-3 pb-5 pl-[68px] pr-5 pt-4">
            <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-2">{portas.nenhum}</p>
            <Botao principal foco="aviso-seguir-assim" onClick={seguirAssim} title="Segue sem reconhecer. Neste episodio, nao pergunta de novo.">
              Seguir assim
            </Botao>
          </footer>
        ) : (
          <footer className="flex flex-nowrap items-center justify-end gap-2 px-5 pb-5 pt-5">
            {/* Fantasma: o caminho de fugir do conselho fica disponivel, mas nao chama o olho. */}
            <button
              type="button"
              data-foco="aviso-seguir-assim"
              onClick={seguirAssim}
              title="Segue sem reconhecer. Neste episodio, nao pergunta de novo."
              className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-3 text-[13px] font-medium text-ink-3 transition-colors duration-150 hover:bg-surface hover:text-ink"
            >
              Seguir assim
            </button>
            <Botao
              principal={principal === 'aviso-reconhecer-na-mao'}
              foco="aviso-reconhecer-na-mao"
              onClick={() => {
                fecharAviso()
                portas.iniciarNaMao()
              }}
              disabled={portas.naMao !== null}
              title={portas.naMao ?? 'O motor agrupa os rostos e voce da o nome de cada um'}
            >
              <Users size={13} strokeWidth={1.5} />
              Reconhecer na mao
            </Botao>
            <Botao
              principal={principal === 'aviso-reconhecer-agora'}
              foco="aviso-reconhecer-agora"
              onClick={() => void reconhecerAgoraESeguir(aberto.destino)}
              disabled={portas.agora !== null}
              title={portas.agora ?? 'Busca o elenco e reconhece os personagens nas cenas ja cortadas. Ao terminar, segue.'}
            >
              <Users size={13} strokeWidth={1.5} />
              Reconhecer agora
            </Botao>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

/**
 * O SELO DO PASSO 4: seguiu sem reconhecer, a escolha de cenas e mais fraca.
 * [Reconhecer] usa o automatico quando da (volta ao passo 1 pelo andamento e
 * retorna aqui), senao o Reconhecer na mao. Reconhecido depois de as cenas
 * serem sugeridas, o selo vira o lembrete de "Sugerir de novo".
 */
export function SeloSemPersonagens() {
  const indice = useIndiceDasCenas()
  const portas = usePortas()
  const aviso = useMemo(() => (indice ? avisoDeReconhecimento(indice) : null), [indice])
  const vistoSem = useAvisoReconhecer((s) => (indice ? s.vistoSem.includes(indice.id) : false))

  // Visto sem personagens aqui (mesmo sem ter passado pelo aviso): reconhecido depois, sugere "Sugerir de novo".
  useEffect(() => {
    if (!indice || !aviso) return
    const lista = useAvisoReconhecer.getState().vistoSem
    if (!lista.includes(indice.id)) useAvisoReconhecer.setState({ vistoSem: [...lista, indice.id] })
  }, [indice, aviso])

  if (!indice) return null
  if (aviso) {
    const reconhecer = (): void => {
      if (portas.agora === null) void reconhecerAgoraESeguir(4)
      else portas.iniciarNaMao()
    }
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={['flex min-w-0 items-center gap-1 text-[11px]', aviso.tipo === 'sem' ? COR_DE_AVISO : 'text-ink-3'].join(' ')}
          title={textoDoAviso(aviso)}
        >
          <TriangleAlert size={12} strokeWidth={1.75} className="shrink-0" />
          <span className="min-w-0 truncate">{seloDoAviso(aviso)}</span>
        </span>
        {portas.nenhum ? (
          <span className="min-w-0 truncate text-[11px] text-ink-3" title={portas.nenhum}>
            {portas.nenhum === SO_NO_ANCUT ? 'reconheca no AnCut e volte' : portas.nenhum}
          </span>
        ) : (
          <Botao
            onClick={reconhecer}
            title={
              portas.agora === null
                ? 'Reconhece os personagens (o andamento aparece no passo 1) e volta para ca'
                : 'O motor agrupa os rostos e voce da o nome de cada um'
            }
          >
            <Users size={13} strokeWidth={1.5} />
            Reconhecer
          </Botao>
        )}
      </span>
    )
  }
  if (!vistoSem && !pedeSugerirDeNovo(indice, armazem())) return null
  // So o lembrete: o botao e o "Sugerir de novo" ao lado (que tambem apaga o lembrete), sem repetir.
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-2"
      title="As cenas foram sugeridas antes de reconhecer os personagens. Sugerir de novo refaz as frases que voce nao mexeu."
    >
      <Users size={12} strokeWidth={1.5} className="shrink-0 text-accent" />
      <span className="min-w-0 truncate">Personagens reconhecidos: sugira de novo</span>
      <button
        type="button"
        onClick={() => esquecerSemPersonagens(indice.id)}
        aria-label="Fechar o lembrete"
        title="Fechar o lembrete"
        className="grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 hover:bg-surface hover:text-ink"
      >
        <X size={11} strokeWidth={1.5} />
      </button>
    </span>
  )
}
