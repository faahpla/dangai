import { create } from 'zustand'
import type { PublicSettings } from '@shared/channels'
import type { ProvedorDaIa } from '../../shared/canais'
import type { EstadoDoMotorRuntime } from '../../shared/motor-runtime'
import type { AjustesDaVoz } from '../../shared/tipos-da-voz'
import { ponte } from '../ponte'
import { useMotorRuntime } from './motor-runtime'

/*
 * [recap] A BOAS-VINDAS DO RECAP (pedido do Levi, 18/10): a tela de boas-vindas
 * do AniRecap Studio (decisao de 15/10), agora para quem liga o "Gerar recap"
 * sem chave de IA. Antes, ele so descobria no passo 2 ("Sem chave de IA").
 * A tela e src/components/BoasVindas.tsx; aqui fica so a decisao, para o
 * teste sem interface (teste/v-boas-vindas.tsx).
 *
 * Abre quando:
 * - o modulo LIGA (abrindo o app ja ligado, ou nas Configuracoes) ou ele
 *   clica "Gerar recap" (o botao da tela inicial e a paleta);
 * - e nao ha IA: o `ctx.ia.provedor()` do nucleo, pelo canal do modulo,
 *   responde null (nem Gemini nem Anthropic);
 * - so na TELA INICIAL: um projeto aberto, a Biblioteca ou o assistente
 *   nunca ficam por baixo dela;
 * - uma vez por sessao do modulo: "Depois" (o X, o Esc, clicar fora) fecha
 *   ate reabrir o app ou desligar e ligar o modulo. Nada e gravado;
 * - "Nao perguntar mais" grava `naoPerguntarChave` na config do MODULO.
 *
 * Saiu da tela inicial com ela aberta (abriu projeto, soltou arquivo, abriu o
 * assistente): fecha e nao volta nesta sessao. Sem ter aberto (o projeto ja
 * estava aberto, ou saiu enquanto decidia), nada se gasta: o proximo "Gerar
 * recap" na tela inicial pergunta de novo.
 */

type Momento = 'fechada' | 'aberta'

export interface PedidoDaBoasVindas {
  /** Quem atende a IA agora, pelo nucleo. null = nenhuma chave de IA. */
  provedor: ProvedorDaIa | null
  /** O "Nao perguntar mais" da config do modulo. */
  naoPerguntarChave: boolean
}

/** Sem IA nenhuma e sem o "Nao perguntar mais": a tela aparece. */
export function pedeBoasVindas(s: PedidoDaBoasVindas): boolean {
  return s.provedor === null && s.naoPerguntarChave !== true
}

interface LojaDasBoasVindas {
  momento: Momento
  /** Ja abriu nesta sessao do modulo: nao abre de novo. */
  jaAbriu: boolean
  /** As configuracoes do nucleo que a tela mostra (tem/dica das chaves de IA). null ate chegarem. */
  settings: PublicSettings | null
  /** A voz do modulo (tem/dica das chaves, a voz padrao), para a linha "Narracao". */
  voz: AjustesDaVoz | null
  /**
   * Muda quando a chave do Gemini muda POR FORA (as Configuracoes por cima):
   * o campo daqui recomeca limpo. Sem isto, um "recusada" de antes ficava
   * embaixo do "Salva" da chave que ele salvou la.
   */
  campo: number
  /**
   * Pergunta ao main e decide se abre. Devolve se ela esta aberta (quem
   * clicou "Gerar recap" para ali). `naTelaInicial` e perguntado de novo
   * DEPOIS da resposta: o projeto pode ter aberto enquanto ela vinha.
   */
  decidir(naTelaInicial: () => boolean): Promise<boolean>
  /** O ChaveDoGemini salvou: as configuracoes novas. */
  receber(settings: PublicSettings): void
  /** O AjustesDeVoz salvou: a voz nova. */
  receberVoz(voz: AjustesDaVoz): void
  /** Le de novo as duas: as Configuracoes, que abrem por cima dela, fecharam. */
  reler(): Promise<void>
  /** "Depois", o X, o Esc e clicar fora: fecha so nesta sessao. */
  depois(): void
  /** Saiu da tela inicial: fecha, e uma decisao no meio do caminho nao abre mais. */
  saiuDaTelaInicial(): void
  /** Grava o "Nao perguntar mais" na config do modulo e fecha. */
  naoPerguntarMais(): Promise<void>
  /** O modulo desligou: tudo volta ao comeco (ligar de novo e o gatilho). */
  reiniciar(): void
}

/** Sair da tela inicial (ou desligar) no meio da leitura invalida a decisao que estava vindo. */
let vez = 0
/** A decisao em andamento: um gatilho em cima do outro (o app abrindo e o clique) espera a mesma. */
let emAndamento: Promise<boolean> | null = null

export const useBoasVindas = create<LojaDasBoasVindas>((set, get) => ({
  momento: 'fechada',
  jaAbriu: false,
  settings: null,
  voz: null,
  campo: 0,

  async decidir(naTelaInicial) {
    if (get().momento === 'aberta') return true
    if (get().jaAbriu || !naTelaInicial()) return false
    if (emAndamento) return emAndamento
    const minha = vez
    const decidindo = (async (): Promise<boolean> => {
      const [ia, config, settings, voz] = await Promise.all([
        ponte.provedorDaIa(),
        ponte.lerConfig(),
        window.dangai.getSettings(),
        ponte.lerAjustesDaVoz(),
      ])
      if (minha !== vez || get().jaAbriu || !naTelaInicial()) return false
      // Sem resposta do main, na duvida nao abre: o passo 2 ainda avisa.
      if (!ia.ok || !config.ok) return false
      if (!pedeBoasVindas({ provedor: ia.value, naoPerguntarChave: config.value.naoPerguntarChave })) return false
      set({
        momento: 'aberta',
        jaAbriu: true,
        settings: settings.ok ? settings.value : null,
        voz: voz.ok ? voz.value : null,
      })
      return true
    })()
    emAndamento = decidindo
    try {
      return await decidindo
    } finally {
      if (emAndamento === decidindo) emAndamento = null
    }
  },

  receber(settings) {
    set({ settings })
  },

  receberVoz(voz) {
    set({ voz })
  },

  async reler() {
    const [settings, voz] = await Promise.all([window.dangai.getSettings(), ponte.lerAjustesDaVoz()])
    const antes = get().settings
    // O Salvar daqui ja entregou as novas (receber): diferente agora so se veio de fora.
    const outraChave =
      settings.ok && (antes?.hasGeminiKey !== settings.value.hasGeminiKey || antes?.geminiKeyHint !== settings.value.geminiKeyHint)
    set({
      ...(settings.ok ? { settings: settings.value } : {}),
      ...(voz.ok ? { voz: voz.value } : {}),
      ...(outraChave ? { campo: get().campo + 1 } : {}),
    })
  },

  depois() {
    set({ momento: 'fechada' })
  },

  saiuDaTelaInicial() {
    vez += 1
    emAndamento = null
    if (get().momento === 'aberta') set({ momento: 'fechada' })
  },

  async naoPerguntarMais() {
    // Fecha antes de gravar: se o disco falhar, a sessao ja respeitou o pedido.
    set({ momento: 'fechada' })
    const r = await ponte.salvarConfig({ naoPerguntarChave: true })
    if (!r.ok) console.warn('[recap] "Nao perguntar mais" nao gravou:', r.error)
  },

  reiniciar() {
    vez += 1
    emAndamento = null
    set({ momento: 'fechada', jaAbriu: false, settings: null, voz: null })
  },
}))

/** O motor esta pronto para usar (no dev com o motor/.venv: nada a instalar). */
export function motorPronto(estado: EstadoDoMotorRuntime | null): boolean {
  return estado?.fase === 'pronto' || estado?.fase === 'dev'
}

/**
 * O "Instalar agora" da boas-vindas, pela tela e pelo canal do motor-runtime
 * que ja existem: abre a tela "Motor de personagens" (a barra, cancelar, a
 * pasta) e ja comeca, porque ele acabou de pedir.
 *
 * So abre a tela, sem comecar, quando ela tem algo a dizer antes: a placa
 * ainda nao foi lida, falta espaco no disco, ou a ultima instalacao parou na
 * conferencia (la ele escolhe entre Continuar e Recomecar). Instalando, so
 * mostra o andamento.
 */
export function instalarMotorAgora(): void {
  const { estado, abrir, instalar } = useMotorRuntime.getState()
  abrir()
  if (!estado || !comecaDireto(estado)) return
  void instalar()
}

function comecaDireto(e: EstadoDoMotorRuntime): boolean {
  if (e.fase !== 'ausente' && e.fase !== 'incompleto' && e.fase !== 'desatualizado') return false
  if (!e.gpu) return false
  if (e.erro?.tipo === 'conferencia') return false
  const faltaDisco = e.livreNoDisco !== null && e.precisaDeLivre > 0 && e.livreNoDisco < e.precisaDeLivre
  return !faltaDisco
}
