import { create } from 'zustand'
import {
  alternarRosto,
  decisaoInicial,
  descobertaViva,
  guardarDecisao,
  ignorarGrupo,
  juntarGrupos,
  mudancasDaDecisao,
  nomearGrupo,
  nomesDeUmaArte,
  reaplicarDecisao,
  resumoDaDecisao,
  separarGrupo,
  type DecisaoDaDescoberta,
  type DecisaoGuardada,
  type DescobertaPronta,
  type EstadoDaDescoberta,
  type EventoDaDescoberta,
  type ForaDoElenco,
  type ResultadoDaDescoberta,
} from '../../shared/descoberta'
import { temPlanos, type EpisodioEncontrado } from '../../shared/episodio'
import { useGerar } from './gerar'
import { pedirMotor } from './motor-runtime'
import { ponte } from '../ponte'

/*
 * DONO: agente B (tela), contrato de 15/10 em shared/descoberta.ts.
 */

/**
 * RECONHECER NA MAO, a store da tela. Fica FORA do gerar.ts (codigo novo em
 * arquivo novo): o passo 1 nao ganha estado novo, e o indice com os
 * personagens chega a ele pelo corteProgresso de sempre (o main manda no fim,
 * como no fim de um corte), que o gerar.ts, o gerar-roteiro.ts e o
 * gerar-cenas.ts ja ouvem.
 *
 * A descoberta e do EPISODIO DA TELA (useGerar.indice). Fechar a tela (ou o
 * assistente) nao cancela nada: o processo segue vivo esperando os nomes, o
 * cabecalho mostra "Dar nomes" e reabrir restaura os grupos e o que ele ja
 * digitou (a decisao fica aqui; descobertaAtual devolve os grupos). Trocar de
 * episodio com ela viva (agrupando ou esperando nomes) CANCELA: ela segura a
 * vaga do motor, e o corte do episodio novo ficaria esperando calado. Refazer
 * e rapido (o corte e os rostos ficam em cache no disco). Salvando nunca e
 * interrompido. O2: os grupos e a decisao ficam no disco (salvarDecisao):
 * trocar de episodio, ou o app fechar, nao perde os nomes -- voltando, a
 * descobertaAtual reabre do disco com eles.
 *
 * Confirmado, a tela fecha e o resumo volta no passo 1: os chips de
 * personagens saem do indice novo (corteProgresso) e a linha do resultado
 * (fotos salvas, descartados) sai de `resultado`.
 */
interface EstadoDaTelaDaDescoberta {
  /** A tela de grupos esta na frente, por cima do assistente. */
  aberta: boolean
  /** O episodio desta descoberta. Evento de outro episodio nao entra. */
  episodioId: string | null
  /** O que o main diz (andamento, status). null = nenhuma descoberta nesta sessao. */
  estado: EstadoDaDescoberta | null
  /** Os grupos, quando chegaram. null fora do 'pronta'/'salvando'. */
  pronta: DescobertaPronta | null
  /** O que o Levi decidiu ate agora. Comeca no decisaoInicial(pronta). */
  decisao: DecisaoDaDescoberta
  /** "Figurantes (N)" aberto. */
  mostrarFigurantes: boolean
  /** Um iniciarDescoberta no ar. */
  pedindo: boolean
  /** Um confirmarDescoberta no ar (o motor salvando). */
  confirmando: boolean
  /** Um cancelarDescoberta no ar. */
  cancelando: boolean
  /** O que o commit deixou. Fica ate ele fechar a linha do resultado no passo 1. */
  resultado: ResultadoDaDescoberta | null
  erro: string | null
  /**
   * O Confirmar achou nomes fora do elenco ("lyn" digitado e o campo deixado
   * assim): a tela pergunta antes, e o segundo Confirmar (ou Ctrl+Enter) vale.
   * null = nenhuma pergunta. Qualquer mudanca na decisao apaga.
   */
  perguntaForaDoElenco: ForaDoElenco[] | null

  /**
   * Comeca a descoberta do episodio da tela, com o nome do anime do campo. A
   * tela abre na hora (o andamento e o erro aparecem nela). Com uma viva deste
   * episodio, so abre a tela.
   */
  iniciar: () => Promise<void>
  /** Pergunta ao main se ha descoberta viva deste episodio (tela reaberta, renderer recarregado). */
  restaurar: (episodioId: string) => Promise<void>
  abrirTela: () => void
  /** So esconde: a descoberta segue viva, com o que ele ja decidiu. */
  fecharTela: () => void
  nomear: (key: number, nome: string) => void
  ignorar: (key: number, ignorar: boolean) => void
  /** Junta o grupo `de` ao grupo `em` (o mesmo personagem; `em` e o dono). */
  juntar: (de: number, em: number) => void
  separar: (key: number) => void
  alternarRosto: (key: number, indice: number) => void
  alternarFigurantes: () => void
  /**
   * Manda a decisao e espera o motor salvar. Deu certo: a tela fecha e o passo
   * 1 mostra o resultado. Com nomes fora do elenco, so pergunta
   * (perguntaForaDoElenco); `assim: true` confirma mesmo assim.
   */
  confirmar: (assim?: boolean) => Promise<void>
  /** Fecha a pergunta do fora do elenco sem confirmar. */
  voltarDaPergunta: () => void
  /**
   * Para a descoberta. O indice fica como estava. No 'salvando' so vale com o
   * motor mudo (o "Parar": o main confere), e o fim chega pelo evento.
   */
  cancelar: () => Promise<void>
  limparErro: () => void
  /** Fecha a linha do resultado e esquece a rodada. */
  esquecer: () => void
}

const VAZIA: DecisaoDaDescoberta = { nomes: {}, ignorados: [], juntar: [], removidos: {} }

/** O que some ao trocar de episodio ou ao esquecer a rodada. */
const LIMPA = {
  aberta: false,
  episodioId: null,
  estado: null,
  pronta: null,
  decisao: VAZIA,
  mostrarFigurantes: false,
  resultado: null,
  erro: null,
  perguntaForaDoElenco: null,
} satisfies Partial<EstadoDaTelaDaDescoberta>

/**
 * A decisao de uma rodada que CAIU (motor morreu, grupos expiraram, o main
 * perdeu a sessao) com mudancas feitas. O "Tentar de novo" traz os mesmos
 * grupos (o corte e os rostos vem do cache), e ela volta neles
 * (reaplicarDecisao) em vez de ele nomear tudo de novo. Cancelar de proposito
 * ou salvar esquece.
 */
let guardada: DecisaoGuardada | null = null

/** Guarda a decisao da tela se ela tem alguma mudanca (chamado quando os grupos vao sumir sem salvar). */
function guardarSeMudou(): void {
  const s = useDescoberta.getState()
  if (!s.pronta || !s.episodioId || mudancasDaDecisao(s.pronta, s.decisao).total === 0) return
  guardada = guardarDecisao(s.episodioId, s.pronta, s.decisao)
}

/** Uma edicao da decisao: a pergunta e o aviso velho eram da decisao de antes. */
function editar(decisao: DecisaoDaDescoberta): Partial<EstadoDaTelaDaDescoberta> {
  return { decisao, erro: null, perguntaForaDoElenco: null }
}

/** Os nomes do elenco da rodada, para o resumo (grafias e fora do elenco). */
export function opcoesDoResumo(pronta: Pick<DescobertaPronta, 'elenco'> | null): { elenco: string[] } {
  return { elenco: (pronta?.elenco ?? []).map((e) => e.nome) }
}

export const useDescoberta = create<EstadoDaTelaDaDescoberta>((set, get) => ({
  ...LIMPA,
  pedindo: false,
  confirmando: false,
  cancelando: false,

  iniciar: async () => {
    const { indice, palpite } = useGerar.getState()
    if (!indice || get().pedindo) return
    if (get().episodioId === indice.id && descobertaViva(get().estado)) {
      set({ aberta: true })
      return
    }
    // App instalado sem o motor: a tela "Instalar motor" abre e o Reconhecer na mao vem quando ficar pronto.
    if (await pedirMotor(() => void useDescoberta.getState().iniciar())) return
    const anime = palpite?.anime.trim()
    // Rodada nova de OUTRO episodio: a decisao guardada era de la.
    if (guardada && guardada.episodioId !== indice.id) guardada = null
    set({
      ...LIMPA,
      aberta: true,
      pedindo: true,
      episodioId: indice.id,
    })
    const r = await ponte.iniciarDescoberta({ episodioId: indice.id, ...(anime ? { anime } : {}) })
    // Trocou de episodio enquanto o pedido estava no ar: o job novo nao e desta tela.
    if (useGerar.getState().indice?.id !== indice.id) {
      set({ pedindo: false })
      if (r.ok && r.value.jobId) void ponte.cancelarDescoberta(r.value.jobId, true)
      return
    }
    if (!r.ok) {
      set({ pedindo: false, erro: r.error })
      return
    }
    // O evento pode ter chegado antes da resposta: o mais adiantado fica.
    const atual = get().estado
    const fica = atual && atual.jobId === r.value.jobId && atual.atualizadoEm > r.value.atualizadoEm ? atual : r.value
    set({ pedindo: false, estado: fica })
  },

  restaurar: async (episodioId) => {
    const r = await ponte.descobertaAtual(episodioId)
    if (!r.ok || useGerar.getState().indice?.id !== episodioId) return
    if (r.value) {
      receber(r.value)
      return
    }
    // O main nao tem nenhuma viva (expirou, app reiniciado): a tela nao finge que tem.
    const s = get()
    if (s.episodioId === episodioId && descobertaViva(s.estado) && !s.pedindo) {
      guardarSeMudou()
      set({ estado: null, pronta: null, decisao: VAZIA, aberta: false, perguntaForaDoElenco: null })
    }
  },

  abrirTela: () => set({ aberta: true }),
  fecharTela: () => set({ aberta: false }),

  nomear: (key, nome) => set(editar(nomearGrupo(get().decisao, key, nome))),
  ignorar: (key, sim) => set(editar(ignorarGrupo(get().decisao, key, sim))),
  juntar: (de, em) => set(editar(juntarGrupos(get().decisao, de, em))),
  separar: (key) => set(editar(separarGrupo(get().decisao, key))),
  alternarRosto: (key, indice) => {
    // So rosto que existe: a tecla 5 num grupo de 3 recortes nao marca nada.
    const g = get().pronta?.grupos.find((x) => x.key === key)
    if (!g || indice < 0 || indice >= g.rostos.length) return
    set(editar(alternarRosto(get().decisao, key, indice)))
  },
  alternarFigurantes: () => set({ mostrarFigurantes: !get().mostrarFigurantes }),

  confirmar: async (assim = false) => {
    const { estado, pronta, decisao, confirmando } = get()
    if (!estado?.jobId || !pronta || confirmando || estado.status !== 'pronta') return
    // A mesma conta do main (paraOMotor): sem nenhum nome o motor morreria com os grupos.
    const resumo = resumoDaDecisao(pronta.grupos, decisao, opcoesDoResumo(pronta))
    if (resumo.erro) {
      set({ erro: resumo.erro, perguntaForaDoElenco: null })
      return
    }
    // "lyn" no campo vira personagem e as fotos dele viram referencia para sempre: pergunta antes.
    if (!assim && resumo.foraDoElenco.length > 0) {
      set({ perguntaForaDoElenco: resumo.foraDoElenco, erro: null })
      return
    }
    set({ confirmando: true, erro: null, perguntaForaDoElenco: null })
    const r = await ponte.confirmarDescoberta(estado.jobId, decisao)
    if (!r.ok) {
      // Grupos expirados, motor que caiu: a tela mostra o porque e os nomes continuam la.
      set({ confirmando: false, erro: r.error })
      return
    }
    // Outro episodio na tela (trocou durante o salvar): o indice dele ja foi gravado pelo main.
    if (useGerar.getState().indice?.id !== r.value.episodioId) {
      set({ confirmando: false })
      return
    }
    guardada = null
    // O aviso "uma foto so" era sobre os nomes do reconhecimento automatico; agora os nomes sao os do Levi.
    if (nomesDeUmaArte(useGerar.getState().fotosDoElenco)) useGerar.setState({ fotosDoElenco: null })
    set({ confirmando: false, resultado: r.value, pronta: null, decisao: VAZIA, aberta: false, mostrarFigurantes: false })
  },

  voltarDaPergunta: () => set({ perguntaForaDoElenco: null }),

  cancelar: async () => {
    const estado = get().estado
    const jobId = estado?.jobId
    if (!jobId || get().cancelando) {
      // Nada vivo no main (o pedido falhou antes de subir): so fecha.
      if (!jobId) set({ aberta: false, erro: null })
      return
    }
    set({ cancelando: true, perguntaForaDoElenco: null })
    const r = await ponte.cancelarDescoberta(jobId)
    set({ cancelando: false })
    if (!r.ok) {
      set({ erro: r.error })
      return
    }
    if (get().estado?.jobId !== jobId) return
    // O "Parar" do salvando: o motor esta sendo morto, e o fim (falhou, com o
    // porque) chega pelo evento. A decisao fica ate la (o receber guarda).
    if (estado.status === 'salvando') return
    // Cancelar de proposito: a decisao desta rodada nao volta no proximo.
    guardada = null
    // true = parou; false = ja nao havia (expirou). Nos dois a tela fecha e o indice fica como estava.
    set({
      aberta: false,
      pronta: null,
      decisao: VAZIA,
      erro: null,
      estado: r.value ? { ...estado, status: 'cancelada', etapa: null, progresso: null, atualizadoEm: new Date().toISOString() } : null,
    })
  },

  limparErro: () => set({ erro: null }),
  esquecer: () => set({ ...LIMPA }),
}))

/*
 * [Reconhecer na mao] ANTES de haver indice com cenas (a fase 'escolha' do
 * passo 1): o "Elenco nao encontrado" depois do "Analisar de novo", ou a
 * analise achada pela busca sem personagens. Primeiro chega ao indice com as
 * cenas -- usar a analise achada, ou cortar sem personagens (reaproveita o
 * corte do disco quando ele ja existe) -- e, com ele na tela, comeca a
 * descoberta.
 */

/** O corte sem personagens que, ao terminar com o indice pronto, abre o Reconhecer na mao. */
let depoisDoCorte: { arquivo: string } | null = null

/** "Usar essa analise" e ja reconhecer na mao (analise do Studio sem personagens). */
export async function usarEReconhecer(achado: EpisodioEncontrado): Promise<void> {
  await useGerar.getState().usarAnalise(achado)
  const indice = useGerar.getState().indice
  if (indice && temPlanos(indice)) await useDescoberta.getState().iniciar()
}

/** "Cortar sem personagens" e, com as cenas no indice, o Reconhecer na mao. */
export async function cortarEReconhecer(): Promise<void> {
  const g = useGerar.getState()
  if (!g.arquivo || g.job) return
  // Sem o motor (app instalado): instala primeiro e volta para cortar e reconhecer.
  if (await pedirMotor(() => void cortarEReconhecer())) return
  depoisDoCorte = { arquivo: g.arquivo }
  await g.analisar('studio', false)
  // O pedido nem subiu (motor ocupado, falta o nome): o erro ja esta na tela.
  const depois = useGerar.getState()
  if (!depois.job && !(depois.indice && temPlanos(depois.indice)) && depois.fase !== 'indexando') depoisDoCorte = null
}

/** Liga o "corta e depois reconhece na mao". Devolve quem desliga. */
function escutarDepoisDoCorte(): () => void {
  return useGerar.subscribe((s) => {
    const alvo = depoisDoCorte
    if (!alvo) return
    // Outro arquivo, ou o corte parou (erro ou cancelado; na escolha ou no corte por tras): esquece.
    const parou = (s.job === null && s.fase === 'escolha') || (!!s.indice && !temPlanos(s.indice) && s.corte?.status === 'falhou')
    if (s.arquivo !== alvo.arquivo || parou) {
      depoisDoCorte = null
      return
    }
    if (s.job === null && s.fase === 'pronto' && s.indice && temPlanos(s.indice)) {
      depoisDoCorte = null
      void useDescoberta.getState().iniciar()
    }
  })
}

/** Um evento do main (ou a resposta do descobertaAtual) na store. */
function receber(e: EventoDaDescoberta): void {
  const s = useDescoberta.getState()
  // Outro episodio (o fim de uma descoberta cancelada ao trocar de episodio): nao e desta tela.
  if (e.episodioId !== useGerar.getState().indice?.id) return
  // Evento atrasado de uma rodada anterior (cancelada, e ja comecou outra): fica a de agora.
  if (s.estado?.jobId && e.estado.jobId && s.estado.jobId !== e.estado.jobId && descobertaViva(s.estado) && !descobertaViva(e.estado)) return
  // O pedido da rodada nova esta no ar e o fim da anterior (cancelada ha pouco, o
  // processo saindo) chega agora: nao e desta tela -- fecharia a tela nova.
  if (s.pedindo && e.estado.jobId && e.estado.jobId !== s.estado?.jobId && !descobertaViva(e.estado)) return
  const patch: Partial<EstadoDaTelaDaDescoberta> = { estado: e.estado, episodioId: e.episodioId }
  if (e.pronta) {
    // Os mesmos grupos de novo (descobertaAtual depois do evento): nao apaga o que ele ja decidiu.
    const mesmos = s.pronta?.jobId === e.pronta.jobId
    patch.pronta = e.pronta
    if (!mesmos) {
      // Rodada refeita depois de cair: o que ele ja tinha decidido volta nos grupos iguais.
      // O2: e com o app reaberto, o que ficou gravado no disco (decisaoSalva).
      const volta = guardada && guardada.episodioId === e.episodioId ? guardada : (e.decisaoSalva ?? null)
      patch.decisao = volta ? reaplicarDecisao(volta, e.pronta) : decisaoInicial(e.pronta)
      guardada = null
      patch.perguntaForaDoElenco = null
    }
  } else if (e.estado.status !== 'pronta' && e.estado.status !== 'salvando') {
    // Os grupos vao sumir sem salvar (falhou): a decisao fica guardada para o "Tentar de novo".
    if (e.estado.status === 'falhou' && s.pronta?.jobId === e.estado.jobId) guardarSeMudou()
    patch.pronta = null
    patch.perguntaForaDoElenco = null
  }
  if (e.resultado) patch.resultado = e.resultado
  // Acabou (salvou ou parou por fora): a tela de grupos nao tem mais o que mostrar.
  if (e.estado.status === 'feita' || e.estado.status === 'cancelada') {
    patch.aberta = false
    patch.decisao = VAZIA
    if (e.estado.status === 'feita') guardada = null
  }
  useDescoberta.setState(patch)
}

/**
 * Liga a escuta. Devolve a funcao que desliga. Monta junto com o assistente
 * (GerarRecap, ao lado do escutarGerar), aberto ou nao.
 */
/** O2: quanto a decisao espera parada antes de ir ao disco (cada letra digitada nao vira uma gravacao). */
const ESPERA_PARA_GRAVAR_MS = 250

/**
 * O2: a decisao vai ao disco a cada mudanca (os nomes, juntar, ignorar, rostos
 * tirados), com os grupos na tela. Fechar o app no meio -- de proposito ou
 * nao -- nao perde o que ele ja fez: reabrindo, os grupos voltam com ela.
 */
function gravarDecisaoAoMudar(): () => void {
  let relogio: ReturnType<typeof setTimeout> | null = null
  let pendente: { episodioId: string; decisao: DecisaoDaDescoberta } | null = null
  const gravar = (): void => {
    relogio = null
    const p = pendente
    pendente = null
    if (p) void ponte.salvarDecisao(p.episodioId, p.decisao)
  }
  const tirar = useDescoberta.subscribe((s, antes) => {
    if (s.decisao === antes.decisao || !s.episodioId || !s.pronta) return
    if (s.estado?.status !== 'pronta') return
    // Os grupos acabaram de chegar (decisaoInicial): nada a gravar ainda.
    if (s.pronta !== antes.pronta && mudancasDaDecisao(s.pronta, s.decisao).total === 0) return
    pendente = { episodioId: s.episodioId, decisao: s.decisao }
    if (relogio) clearTimeout(relogio)
    relogio = setTimeout(gravar, ESPERA_PARA_GRAVAR_MS)
  })
  // A janela fechando com uma gravacao na espera: vai agora.
  const aoSair = (): void => {
    if (relogio) {
      clearTimeout(relogio)
      gravar()
    }
  }
  window.addEventListener('beforeunload', aoSair)
  return () => {
    tirar()
    window.removeEventListener('beforeunload', aoSair)
    aoSair()
  }
}

export function escutarDescoberta(): () => void {
  const tirar = ponte.onDescobertaProgresso((e) => receber(e))
  const tirarGravacao = gravarDecisaoAoMudar()
  const tirarDepois = escutarDepoisDoCorte()
  const tirarGerar = useGerar.subscribe((s, antes) => {
    const agora = s.indice?.id ?? null
    const era = antes.indice?.id ?? null
    if (agora === era) return
    const d = useDescoberta.getState()
    // Trocou de episodio com a descoberta viva: cancela (ver o comentario da store).
    if (d.episodioId && d.episodioId !== agora && d.estado?.jobId && (d.estado.status === 'agrupando' || d.estado.status === 'pronta')) {
      // O2: os nomes ja dados ficam no disco (voltando ao episodio, voltam).
      void ponte.cancelarDescoberta(d.estado.jobId, true)
    }
    if (d.episodioId !== agora) useDescoberta.setState({ ...LIMPA })
    if (agora) void useDescoberta.getState().restaurar(agora)
  })
  const inicial = useGerar.getState().indice?.id
  if (inicial) void useDescoberta.getState().restaurar(inicial)
  return () => {
    tirar()
    tirarGerar()
    tirarDepois()
    tirarGravacao()
  }
}

// Em dev, alcancavel pelo console e pelo teste por CDP, como o cenasStore.
if (import.meta.env.DEV) Reflect.set(window, 'descobertaStore', useDescoberta)
