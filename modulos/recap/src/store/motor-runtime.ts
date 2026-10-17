import { create } from 'zustand'
import type { EstadoDoMotorRuntime, PedidoDeInstalacao } from '../../shared/motor-runtime'
import { ponte } from '../ponte'

/*
 * DONO: agente A (runtime + tela), contrato de 15/10 em shared/motor-runtime.ts.
 *
 * O estado do runtime do motor no app instalado, para a tela "Instalar motor"
 * (src/components/motor-runtime/), a linha do motor (LinhaDoMotor) e as
 * Configuracoes. O agente B so le `estado?.fase` (o StatusBar segura o
 * "Atualizar para X" enquanto o motor instala: a atualizacao fecha o app).
 *
 * O main manda o estado INTEIRO a cada mudanca (motor-runtime:mudou); aqui so
 * guarda o ultimo.
 *
 * O 1o USO que precisa do motor (cortar, reconhecer, Reconhecer na mao) pede
 * por `pedirMotor(acao)`: com o motor fora, a tela abre UMA vez por sessao e a
 * acao fica guardada; quando a fase vira 'pronto', a tela fecha sozinha e a
 * acao roda. "Agora nao" nao reabre na sessao: a acao segue e falha com a
 * frase do motor, e a linha do motor oferece o botao.
 */

/** As fases em que o motor nao sobe e o Levi pode resolver daqui. */
const PEDE_INSTALAR = new Set(['ausente', 'incompleto', 'desatualizado', 'instalando'])

interface LojaDoMotorRuntime {
  /** null = ainda nao perguntou ao main. */
  estado: EstadoDoMotorRuntime | null
  /** A tela "Instalar motor" aberta. */
  aberta: boolean
  /** "Agora nao" nesta sessao: o 1o uso nao abre mais a tela sozinho. */
  dispensada: boolean
  /** O que estava esperando o motor (roda quando a fase vira 'pronto'). */
  pendente: (() => void) | null
  /** Erro de um comando (instalar, remover...) que nao veio no estado. */
  erroDoPedido: string | null
  conferir(): Promise<void>
  /** Abre a tela. `depois` roda quando o motor ficar pronto. */
  abrir(depois?: () => void): void
  /** Fecha (o X). A instalacao continua por tras. */
  fechar(): void
  /** "Agora nao": fecha, esquece a acao e nao abre sozinha de novo na sessao. */
  agoraNao(): void
  instalar(pedido?: PedidoDeInstalacao): Promise<void>
  cancelar(): Promise<void>
  escolherPasta(padrao?: boolean): Promise<void>
  remover(): Promise<void>
}

export const useMotorRuntime = create<LojaDoMotorRuntime>((set, get) => ({
  estado: null,
  aberta: false,
  dispensada: false,
  pendente: null,
  erroDoPedido: null,
  async conferir() {
    const r = await ponte.estadoDoMotorRuntime()
    if (r.ok) receber(r.value)
  },
  abrir(depois) {
    set({ aberta: true, erroDoPedido: null, ...(depois ? { pendente: depois } : {}) })
    void get().conferir()
  },
  fechar() {
    set({ aberta: false })
  },
  agoraNao() {
    set({ aberta: false, dispensada: true, pendente: null })
  },
  async instalar(pedido = {}) {
    set({ erroDoPedido: null })
    const r = await ponte.instalarMotorRuntime(pedido)
    if (r.ok) receber(r.value)
    else set({ erroDoPedido: r.error })
  },
  async cancelar() {
    const r = await ponte.cancelarMotorRuntime()
    if (!r.ok) set({ erroDoPedido: r.error })
    await get().conferir()
  },
  async escolherPasta(padrao) {
    set({ erroDoPedido: null })
    const r = await ponte.escolherPastaDoMotorRuntime(padrao)
    if (r.ok) receber(r.value)
    else set({ erroDoPedido: r.error })
  },
  async remover() {
    set({ erroDoPedido: null })
    const r = await ponte.removerMotorRuntime()
    if (r.ok) receber(r.value)
    else set({ erroDoPedido: r.error })
  },
}))

/** Quem quer saber que o motor acabou de ficar pronto. */
const aoFicarPronto = new Set<() => void>()

export function quandoOMotorFicarPronto(fn: () => void): () => void {
  aoFicarPronto.add(fn)
  return () => aoFicarPronto.delete(fn)
}

/**
 * Quem quer saber que a FASE mudou (instalou, removeu, parou, ficou
 * desatualizado): o gerar.ts sonda o motor de novo, para a linha do motor e as
 * Configuracoes nao ficarem com o "Pronto" de antes de um Remover.
 */
const aoMudarDeFase = new Set<() => void>()

export function quandoAFaseMudar(fn: () => void): () => void {
  aoMudarDeFase.add(fn)
  return () => aoMudarDeFase.delete(fn)
}

/** Um estado novo do main: guarda e, se o motor acabou de ficar pronto, roda o que esperava. */
function receber(estado: EstadoDoMotorRuntime): void {
  const antes = useMotorRuntime.getState().estado
  useMotorRuntime.setState({ estado })
  if (antes !== null && antes.fase !== estado.fase) {
    for (const fn of aoMudarDeFase) {
      try {
        fn()
      } catch (e) {
        console.error('[motor-runtime] aoMudarDeFase:', e)
      }
    }
  }
  const ficouPronto = estado.fase === 'pronto' && antes !== null && antes.fase !== 'pronto' && antes.fase !== 'dev'
  if (!ficouPronto) return
  for (const fn of aoFicarPronto) {
    try {
      fn()
    } catch (e) {
      console.error('[motor-runtime] aoFicarPronto:', e)
    }
  }
  const { pendente } = useMotorRuntime.getState()
  useMotorRuntime.setState({ pendente: null })
  if (pendente) {
    // Um respiro para o "Motor pronto" aparecer antes de a tela fechar e a acao comecar.
    setTimeout(() => {
      useMotorRuntime.setState({ aberta: false })
      pendente()
    }, 1200)
  }
}

/**
 * O motor do Studio precisa do runtime agora? Com ele fora (app instalado,
 * motor ausente/parado/desatualizado/instalando), abre a tela UMA vez por
 * sessao, guarda a `acao` para quando ficar pronto e devolve true: quem chama
 * para ali. false = siga (dev, pronto, ou ele ja disse "Agora nao").
 */
export async function pedirMotor(acao: () => void): Promise<boolean> {
  let { estado } = useMotorRuntime.getState()
  if (!estado) {
    await useMotorRuntime.getState().conferir()
    estado = useMotorRuntime.getState().estado
  }
  if (!estado || !PEDE_INSTALAR.has(estado.fase)) return false
  // Atualizacao automatica (so pacotes) ainda nao comecou: o main comeca sozinho ~10 s depois de abrir.
  const { dispensada, aberta } = useMotorRuntime.getState()
  if (dispensada && estado.fase !== 'instalando') return false
  useMotorRuntime.setState({ pendente: acao })
  if (!aberta) useMotorRuntime.getState().abrir()
  return true
}

/** O motor depende do runtime e nao esta pronto (para a linha do motor e as Configuracoes). */
export function runtimeFora(estado: EstadoDoMotorRuntime | null): boolean {
  return !!estado && PEDE_INSTALAR.has(estado.fase)
}

/** Liga o evento do main ao store. Chamar uma vez (a tela InstalarMotor, montada no App). */
export function ouvirMotorRuntime(): () => void {
  return ponte.onMotorRuntime((estado) => receber(estado))
}
