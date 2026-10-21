import { create } from 'zustand'
import {
  avisoAoSeguir,
  avisoDeReconhecimento,
  esquecerSeguirAssim,
  lembrarSeguirAssim,
  type AvisoDeReconhecimento,
} from '../../shared/aviso-reconhecer'
import { SO_NO_ANCUT } from '../../shared/descoberta'
import { devolverAoAncutNoFim, podeIrAoRoteiro, useGerar, type PassoDoAssistente } from './gerar'
import { useAncut } from './ancut'

/**
 * (21/10) O AVISO ANTES DE SEGUIR do passo 1 (shared/aviso-reconhecer.ts): o
 * episodio sem personagens reconhecidos pergunta antes de ir ao roteiro.
 *
 * - [Reconhecer agora]: o mesmo "Reconhecer agora" do resumo (o motor com o
 *   andamento no passo 1); deu certo, segue sozinho para onde ia.
 * - [Reconhecer na mao]: abre a tela de sempre e fica no passo 1.
 * - [Seguir assim]: segue e lembra a escolha daquele episodio.
 * - Esc fecha sem seguir.
 */
interface EstadoDoAviso {
  /** A pergunta na tela, do episodio `episodioId`, a caminho do passo `destino`. */
  aberto: (AvisoDeReconhecimento & { episodioId: string; destino: PassoDoAssistente }) | null
  /** "Reconhecer agora" pedido: quando o motor acabar bem, vai ao passo. */
  esperando: { episodioId: string; destino: PassoDoAssistente } | null
  /** Episodios que o passo 4 mostrou sem personagens nesta sessao (reconhecidos depois: "Sugerir de novo"). */
  vistoSem: string[]
}

export const useAvisoReconhecer = create<EstadoDoAviso>(() => ({ aberto: null, esperando: null, vistoSem: [] }))

/** O localStorage do app, ou null (sem armazem, pergunta sempre; nada quebra). */
export function armazem(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Segue do passo 1 para `destino` -- pelo "Proximo: Roteiro" ou pela barra de
 * passos. Sem personagens (e sem "Seguir assim" deste episodio), abre o aviso.
 */
export function seguirDoEpisodio(destino: PassoDoAssistente = 2): void {
  const g = useGerar.getState()
  if (!podeIrAoRoteiro(g) || !g.indice) return
  const aviso = avisoAoSeguir(g.indice, armazem())
  if (!aviso) {
    g.irParaPasso(destino)
    return
  }
  useAvisoReconhecer.setState({ aberto: { ...aviso, episodioId: g.indice.id, destino } })
}

export function fecharAviso(): void {
  useAvisoReconhecer.setState({ aberto: null })
}

export function seguirAssim(): void {
  const aberto = useAvisoReconhecer.getState().aberto
  if (!aberto) return
  lembrarSeguirAssim(armazem(), aberto.episodioId, aberto.tipo)
  fecharAviso()
  const g = useGerar.getState()
  if (g.indice?.id === aberto.episodioId) g.irParaPasso(aberto.destino)
}

/** Por que o "Reconhecer agora" automatico nao serve aqui (null = serve). */
export function porqueNaoReconhecerAgora(
  s: Pick<ReturnType<typeof useGerar.getState>, 'indice' | 'exclusoesMudaram' | 'motor' | 'palpite' | 'job'>,
  trazendo: boolean,
): string | null {
  const indice = s.indice
  if (!indice) return 'Sem episodio'
  // Cortado pelo recap: aqui, ou movido para o AnCut (o "Reconhecer agora" traz de volta, reconhece e devolve).
  const doRecap = indice.biblioteca.origem === 'studio' || indice.biblioteca.movidoDoRecap === true
  if (!doRecap) return SO_NO_ANCUT
  if (indice.reconhecimento !== 'pulado') return 'O reconhecimento ja rodou neste episodio: use Reconhecer na mao.'
  if (s.job) return 'Espere a analise acabar'
  if (s.exclusoesMudaram) return 'Salve ou desfaca as marcacoes de OP/ED antes'
  if (s.motor?.studio.pronto !== true) return s.motor?.studio.erro ?? 'O motor nao esta pronto'
  if (!s.palpite?.anime.trim()) return 'Falta o nome do anime'
  if (trazendo) return 'Trazendo o episodio de volta do AnCut'
  return null
}

/**
 * O "Reconhecer agora" do resumo (ResumoDoEpisodio): a analise completa sobre
 * as cenas ja cortadas. Mora no AnCut (movido pelo recap): volta antes -- o
 * motor do recap so grava na biblioteca dele, e la reaproveita o corte. No
 * fim, volta para la. false = nem comecou.
 */
export async function reconhecerAgora(): Promise<boolean> {
  const atual = useGerar.getState().indice
  if (!atual) return false
  if (atual.biblioteca.origem === 'ancut' && atual.biblioteca.movidoDoRecap) {
    const deVolta = await useAncut.getState().trazer(atual.id)
    if (!deVolta) return false
    // O indice de volta ja na tela: a analise manda a pasta do anime dele (o corte e reaproveitado).
    if (useGerar.getState().indice?.id === deVolta.id) useGerar.setState({ indice: deVolta })
    devolverAoAncutNoFim(atual.id)
  }
  void useGerar.getState().analisar('studio', true)
  return true
}

/**
 * [Reconhecer agora] do aviso (ou do selo do passo 4): fecha, volta ao passo 1
 * (onde o andamento aparece) e, quando o motor acabar com o indice novo, vai
 * ao `destino`. Cancelado, com erro ou ainda sem personagens apos rodar: fica
 * no passo 1 (sem personagens ainda, so com o recado do motor).
 */
export async function reconhecerAgoraESeguir(destino: PassoDoAssistente): Promise<void> {
  const g = useGerar.getState()
  const indice = g.indice
  if (!indice) return
  fecharAviso()
  if (g.passo !== 1) g.irParaPasso(1)
  useAvisoReconhecer.setState({ esperando: { episodioId: indice.id, destino } })
  let viuJob = useGerar.getState().job !== null
  const acabou = (): void => {
    pare()
    useAvisoReconhecer.setState({ esperando: null })
  }
  const pare = useGerar.subscribe((s) => {
    const esperando = useAvisoReconhecer.getState().esperando
    if (!esperando || esperando.episodioId !== indice.id) return pare()
    // Trocou de episodio no meio: esquece.
    if (s.indice && s.indice.id !== indice.id) return acabou()
    if (s.job) {
      viuJob = true
      return
    }
    // Nem comecou (motor fora, "Falta o nome do anime"): o erro ja esta no rodape.
    if (!viuJob) {
      if (s.erro) acabou()
      return
    }
    if (s.fase === 'analisando' || s.fase === 'indexando') return
    acabou()
    // O indice NOVO (refazer) e o sinal de que deu certo: cancelado ou com erro, o objeto e o mesmo.
    if (s.fase !== 'pronto' || s.erro || !s.indice || s.indice === indice) return
    if (avisoDeReconhecimento(s.indice)?.tipo === 'sem') return
    if (s.passo === 1) s.irParaPasso(esperando.destino)
  })
  const comecou = await reconhecerAgora()
  if (!comecou) acabou()
}

/** "Sugerir de novo" (ou o X do lembrete) depois de reconhecer: a marca do "seguir assim" sai. */
export function esquecerSemPersonagens(episodioId: string): void {
  esquecerSeguirAssim(armazem(), episodioId)
  useAvisoReconhecer.setState((s) => ({ vistoSem: s.vistoSem.filter((id) => id !== episodioId) }))
}
