import { useEffect, useMemo } from 'react'
import { ArrowLeft, Loader2, RotateCcw } from 'lucide-react'
import { ROTULO_DO_STATUS_DO_CORTE, temPlanos, type EpisodeIndex } from '../../shared/episodio'
import { roteiroAtual, type RascunhoDoRecap, type Roteiro } from '../../shared/roteiro'
import { podeIrParaCenas, takeAtual } from '../../shared/voz'
import { duracaoDaFrase, escolhaDaFrase, frasesDoRoteiro } from '../../shared/cenas'
import { useGerar, type PassoDoAssistente } from '../store/gerar'
import { roteiroAprovado, useRoteiro } from '../store/gerar-roteiro'
import { avisosDasFrases, cenasNaTela, useCenas, useIndiceDasCenas } from '../store/gerar-cenas'
import { nucleo } from '../nucleo'
import { Barra } from './AndamentoDaAnalise'
import { SecaoDoCorte } from './AndamentoDoCorte'
import { CartaoDoEpisodio } from './CartaoDoEpisodio'
import { FrasesDasCenas } from './FrasesDasCenas'
import { GradeDasCenas, usePlanosDaTela } from './GradeDasCenas'
import { TocadorDasCenas } from './TocadorDasCenas'
import { Botao, Secao } from './pecas'

/**
 * O PASSO 4 DO ASSISTENTE: as CENAS de cada frase, no tempo REAL da voz
 * aprovada. A tela e a da selecao do Dangai que o Levi ja conhece (Library.tsx
 * no modo "por roteiro" + ScriptColumn.tsx): o roteiro frase por frase a
 * esquerda, a grade do episodio a direita, o player grande com a narracao.
 *
 * Quando ele chega aqui as cenas ja estao colocadas: o app sugeriu em segundo
 * plano assim que o roteiro foi aprovado (gerar-cenas.ts, escutarCenas) e
 * encaixa na voz ao entrar. Antes disso, o passo espera o que falta: o
 * roteiro aprovado, a voz aprovada e o corte das cenas (com o andamento, e
 * entra sozinho quando acaba).
 *
 * Teclado: cima/baixo andam entre as frases; Espaco toca a frase no player.
 */
export function PassoDasCenas() {
  const episodioId = useGerar((s) => s.indice?.id ?? null)
  const doRoteiro = useRoteiro((s) => s.episodioId)
  const abrindo = useRoteiro((s) => s.abrindo)
  const rascunho = useRoteiro((s) => s.rascunho)
  const aprovado = useRoteiro(roteiroAprovado)
  const indice = useIndiceDasCenas()
  const entrar = useCenas((s) => s.entrar)

  // Reabriu direto no passo 4 (voltar onde parou): quem abre o rascunho e a store do roteiro.
  useEffect(() => {
    if (episodioId && doRoteiro !== episodioId) void useRoteiro.getState().entrar(episodioId)
  }, [episodioId, doRoteiro])

  // Entrou (ou as cenas do corte chegaram): a frase inicial e o estado do corte.
  const rascunhoId = rascunho?.id ?? null
  const comPlanos = indice !== null && temPlanos(indice)
  useEffect(() => {
    if (rascunhoId) entrar()
  }, [rascunhoId, comPlanos, entrar])

  // [recap] As cenas que o Dangai mesclou (Biblioteca > Mesclar) depois do
  // indice: lidas ao entrar, quando a Biblioteca fecha e ao voltar a janela.
  const bibliotecaAberta = nucleo().usar((s) => s.libraryOpen)
  useEffect(() => {
    if (rascunhoId && !bibliotecaAberta) void useCenas.getState().carregarMesclas()
  }, [rascunhoId, bibliotecaAberta])
  useEffect(() => {
    const ler = (): void => void useCenas.getState().carregarMesclas()
    window.addEventListener('focus', ler)
    return () => window.removeEventListener('focus', ler)
  }, [])

  if (abrindo || !rascunho || (episodioId !== null && doRoteiro !== episodioId)) {
    return (
      <Parada>
        <p className="flex items-center gap-2 text-[12px] text-ink-2">
          <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
          Abrindo as cenas...
        </p>
      </Parada>
    )
  }
  const roteiro = roteiroAtual(rascunho)
  if (!roteiro || !aprovado) return <Falta texto="Aprove o roteiro antes das cenas." rotulo="Roteiro" passo={2} />
  if (!podeIrParaCenas(rascunho, roteiro)) return <Falta texto="Aprove a voz antes das cenas." rotulo="Voz" passo={3} />
  if (!indice || !temPlanos(indice)) return <EsperandoOCorte />
  return <Mesa rascunho={rascunho} roteiro={roteiro} indice={indice} />
}

/** As telas de espera: o cartao do episodio em cima e uma secao "Cenas", como nos outros passos. */
function Parada({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-6 py-6">
        <CartaoDoEpisodio />
        <Secao titulo="Cenas">{children}</Secao>
      </div>
    </div>
  )
}

/** Falta um passo anterior: a frase curta e o botao que leva la. */
function Falta({ texto, rotulo, passo }: { texto: string; rotulo: string; passo: PassoDoAssistente }) {
  const irParaPasso = useGerar((s) => s.irParaPasso)
  return (
    <Parada>
      <div className="flex min-h-8 items-center gap-3">
        <p className="min-w-0 flex-1 text-[12px] text-ink-2">{texto}</p>
        <Botao onClick={() => irParaPasso(passo)} title={`Voltar (passo ${passo})`}>
          <ArrowLeft size={13} strokeWidth={1.5} />
          {rotulo}
        </Botao>
      </div>
    </Parada>
  )
}

/**
 * O corte das cenas ainda nao acabou (ele roda em segundo plano desde o passo
 * 1): o andamento aqui, e o passo entra sozinho quando as cenas chegam.
 */
function EsperandoOCorte() {
  const corte = useCenas((s) => s.corte)
  const doPasso1 = useGerar((s) => s.corte)
  const irParaPasso = useGerar((s) => s.irParaPasso)
  const status = corte?.status ?? 'pendente'

  /*
   * O passo 1 conhece o corte deste episodio: a mesma secao de la, com as
   * etapas, o Cancelar e, quando para, o "Tentar de novo" / "Cortar sem
   * personagens" -- sem precisar voltar ao passo 1 para recomecar.
   */
  if (doPasso1 && doPasso1.status !== 'pronto') {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-6 py-6">
          <CartaoDoEpisodio />
          <SecaoDoCorte dica="Pode fechar: as cenas entram sozinhas." />
        </div>
      </div>
    )
  }

  if (status === 'falhou') {
    return (
      <Parada>
        <div className="flex min-h-8 items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-[12px] text-danger" title={corte?.erro ?? undefined}>
            {corte?.erro ?? ROTULO_DO_STATUS_DO_CORTE.falhou}
          </p>
          <Botao onClick={() => irParaPasso(1)} title="O corte recomeca no passo 1">
            <ArrowLeft size={13} strokeWidth={1.5} />
            Episodio
          </Botao>
        </div>
      </Parada>
    )
  }
  const pct = corte?.progresso != null ? ` ${Math.round(corte.progresso * 100)}%` : ''
  return (
    <Parada>
      <p className="flex items-center gap-2 text-[12px] text-ink-2">
        <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
        <span className="min-w-0 truncate">
          {corte?.mensagem || ROTULO_DO_STATUS_DO_CORTE[status]}
          <span className="tnum">{pct}</span>
        </span>
      </p>
      <Barra fracao={status === 'cortando' ? (corte?.progresso ?? null) : null} />
      <p className="text-[11px] text-ink-3">Pode fechar: as cenas entram sozinhas.</p>
    </Parada>
  )
}

/** Fora de campo de texto: ali as setas e o Espaco sao do campo. */
function digitando(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false
  return alvo.isContentEditable || alvo.closest('input, textarea, select') !== null
}

/** Botao, link e slider com foco: o Espaco e deles. */
function espacoDeOutro(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false
  return alvo.closest('button, a, [role="slider"], [role="checkbox"]') !== null
}

/** A mesa de trabalho: a coluna do roteiro, a grade e o player. */
function Mesa({ rascunho, roteiro, indice }: { rascunho: RascunhoDoRecap; roteiro: Roteiro; indice: EpisodeIndex }) {
  const pendentes = useCenas((s) => s.pendentes)
  const fraseAtiva = useCenas((s) => s.fraseAtiva)
  const previa = useCenas((s) => s.previa)
  const sugerindo = useCenas((s) => s.sugerindo)
  const erro = useCenas((s) => s.erro)
  const sugerirDeNovo = useCenas((s) => s.sugerirDeNovo)
  const take = takeAtual(rascunho)
  const cenas = useMemo(() => cenasNaTela(rascunho, roteiro, pendentes), [rascunho, roteiro, pendentes])
  const avisos = useMemo(() => avisosDasFrases(roteiro, cenas, take), [roteiro, cenas, take])
  const planos = usePlanosDaTela(indice)
  const frase = frasesDoRoteiro(roteiro).find((f) => f.id === fraseAtiva) ?? null
  const escolha = frase ? escolhaDaFrase(cenas, frase.id) : null

  // Planos ja escolhidos em OUTRA frase: a grade apaga (repetir as vezes e escolha; sem perceber, e erro).
  const usadas = useMemo(() => {
    const ids = new Set<string>()
    for (const e of cenas.escolhas) {
      if (e.fraseId === fraseAtiva) continue
      // (rodada 4) A metade de baixo do grid tambem e uma cena usada.
      for (const c of e.cenas) for (const id of [...c.candidato.planoIds, ...(c.baixo?.planoIds ?? [])]) ids.add(id)
    }
    return ids
  }, [cenas, fraseAtiva])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return
      const s = useCenas.getState()
      // O player trata o proprio teclado (na captura).
      if (s.previa) return
      if (nucleo().haModalPorCima()) return
      if (digitando(e.target)) return
      if (e.key === 'ArrowDown') s.andarFrase(1)
      else if (e.key === 'ArrowUp') s.andarFrase(-1)
      else if (e.key === ' ' && s.fraseAtiva && !espacoDeOutro(e.target)) s.abrirPrevia({ fraseId: s.fraseAtiva, candidato: null })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  // Primeira vez, antes de a sugestao automatica voltar: a tela espera (e de graca, segundos).
  if (cenas.escolhas.length === 0) {
    return (
      <Parada>
        {sugerindo !== null || !erro ? (
          <p className="flex items-center gap-2 text-[12px] text-ink-2">
            <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
            Sugerindo as cenas...
          </p>
        ) : (
          <div className="flex min-h-8 items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-[12px] text-danger" title={erro}>
              {erro}
            </p>
            <Botao onClick={() => void sugerirDeNovo(null)} title="Sugere as cenas de novo">
              <RotateCcw size={13} strokeWidth={1.5} />
              Tentar de novo
            </Botao>
          </div>
        )}
      </Parada>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <FrasesDasCenas roteiro={roteiro} cenas={cenas} take={take} planos={planos} avisos={avisos} />
      {frase ? (
        <GradeDasCenas frase={frase} escolha={escolha} planos={planos} usadas={usadas} duracao={duracaoDaFrase(frase, take).duracao} />
      ) : (
        <div className="grid flex-1 place-items-center text-[12px] text-ink-3">Escolha uma frase ao lado.</div>
      )}
      {previa && (
        <TocadorDasCenas previa={previa} roteiro={roteiro} cenas={cenas} take={take} indice={indice} rascunhoId={rascunho.id} />
      )}
    </div>
  )
}
