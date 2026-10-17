import { useMemo } from 'react'
import { create } from 'zustand'
import type { EpisodeIndex } from '../../shared/episodio'
import {
  ALVO_PADRAO,
  INSTRUCAO_MAX,
  cuesElegiveis,
  ehParadaNoReserva,
  fraseVazia,
  idsDeFrase,
  mesmoTextoDoRoteiro,
  proximoId,
  redividirRoteiro,
  roteiroAtual,
  textoDaParada,
  textoDoRoteiro,
  validarRoteiro,
  type AlvoSec,
  type EtapaDoRoteiro,
  type Evento,
  type Frase,
  type ParadoNoReserva,
  type PedidoDeReligar,
  type ProblemaDoRoteiro,
  type RascunhoAberto,
  type RascunhoDoRecap,
  type Roteiro,
  type RoteiroReligadoPronto,
  type Secao,
} from '../../shared/roteiro'
import { ehPerguntaDeCusto, type EstimativaDoEscritor } from '../../shared/escritor'
import { ponte } from '../ponte'
import { useGerar } from './gerar'
import { useRitmoDaVoz } from './ritmo'

/**
 * O ASSISTENTE "GERAR RECAP", passo 2 (Roteiro).
 *
 * Store propria, como a do passo 1: nada daqui entra no undo nem no projeto
 * aberto. O que vale mora no disco, no RASCUNHO DO RECAP (<userData>/recaps,
 * shared/roteiro.ts); o main devolve o rascunho INTEIRO a cada mudanca e a
 * tela troca o dela por ele.
 *
 * A tela edita uma COPIA (`tela`) e grava sozinha, com espera curta: digitar
 * nao pode virar uma chamada por tecla, e fechar o assistente nao pode perder
 * nada (o relogio mora aqui, nao no componente).
 *
 * As chamadas RAPIDAS que mudam o rascunho passam por uma FILA, uma por vez:
 * gravar, trocar de versao, aprovar, e o comeco de um pedido a IA (que grava
 * o pendente antes). A chamada LENTA a IA (minutos) fica FORA da fila: com
 * ela dentro, um Cancelar soltava a tela mas cada gravacao, o Aprovar e as
 * Versoes ficavam esperando em silencio a resposta abandonada -- e fechar o
 * app nessa janela perdia o que foi digitado. O main aguenta a IA e as
 * gravacoes ao mesmo tempo (ele rele o rascunho antes de gravar a versao), e
 * a resposta de um pedido cancelado vai so para o historico (cancelarRoteiro).
 *
 * MODO TEXTO ("Partes | Texto"): o roteiro inteiro num bloco so. Cada tecla
 * re-divide o texto contra o roteiro de quando ele entrou no modo
 * (redividirRoteiro, sempre contra a MESMA base: contra a ultima tela, uma
 * frase reescrita aos poucos herdaria os vinculos da original sem parecer em
 * nada com ela) e a tela grava sozinha como no modo Partes -- o texto nunca
 * se perde. Ao sair (ou aprovar), o religarRoteiro do main liga as frases
 * novas aos eventos numa chamada so. Texto igual ao da entrada nao chama
 * nada. "Usar meu roteiro" passa pelo mesmo religar, com tudo novo.
 *
 * Lote 1 das ideias (17/10): o ESCRITOR PAGO para antes de gastar (a pergunta
 * de custo, `custo`; o sim refaz o MESMO pedido com o teto aceito), o REVISOR
 * roda sozinho depois de um roteiro inteiro novo (fora da fila e fora da vez
 * do roteiro: nunca trava a tela; sem cota, so avisa) e o painel "Meu estilo".
 */

/** O pedido de IA em andamento. */
export interface GeracaoEmCurso {
  /** Identifica o pedido: o Cancelar solta ESTE, e a resposta de outro nao entra na tela. */
  token: number
  etapa: EtapaDoRoteiro
  /** A parte sendo refeita ("Refazer"). null = o roteiro inteiro. */
  secaoId: string | null
  /** O pedido passa pelos eventos antes (primeira vez): a tela mostra as duas etapas. */
  comEventos: boolean
  /** Date.now() do clique, para o tempo decorrido. */
  inicio: number
  /** A frase do main (onRoteiroProgresso). null = ainda nenhuma. */
  mensagem: string | null
  /** O main ja trabalha NESTE pedido (antes, so esperava o anterior). */
  comecou: boolean
  /** E o religar (modo Texto, "Usar meu roteiro", "Ligar frases"): o texto ja esta gravado. */
  religar: boolean
}

/** O pedido de religar, para refazer igual depois do "Usar modelo reserva". */
export interface PedidoDaTela {
  texto: string
  modo: PedidoDeReligar['modo']
  alvoSec?: AlvoSec
}

export type ModoDoRoteiro = 'partes' | 'texto'

/**
 * O pedido parou antes do modelo RESERVA (os bons sem cota ou lotados) e a
 * tela pergunta: "Usar modelo reserva" refaz este mesmo pedido com a
 * permissao; "Esperar" fecha. Leva o pedido para refazer igual.
 */
export interface PerguntaDoReserva extends ParadoNoReserva {
  /** A parte do "Refazer". null = o roteiro inteiro. */
  secaoId: string | null
  instrucao: string | null
  /** Parou no religar: o "Usar modelo reserva" refaz ESTE pedido, nao um roteiro novo. */
  religar?: PedidoDaTela | null
}

/** O escritor pago parou antes de gastar: a pergunta, com o pedido para refazer igual. */
export interface PerguntaDeCustoNaTela {
  estimativa: EstimativaDoEscritor
  /** A parte do "Refazer". null = o roteiro inteiro. */
  secaoId: string | null
  instrucao: string | null
  usarReserva: boolean
}

/** O que a lixeira (ou o "Remover parte") tirou, para o "Desfazer" do rodape. */
export type Remocao =
  | { tipo: 'frase'; secaoId: string; frase: Frase; posicao: number }
  | { tipo: 'parte'; secao: Secao; posicao: number }

interface EstadoDoRoteiro {
  /** O episodio do rascunho na tela. */
  episodioId: string | null
  rascunho: RascunhoDoRecap | null
  /** O indice que veio com o rascunho. A tela prefere o do passo 1, quando e o mesmo. */
  indice: EpisodeIndex | null
  /** Recados do abrirRascunho (indice que mudou de lugar...), em ASCII. */
  avisos: string[]
  abrindo: boolean
  /** O roteiro como esta na tela (a versao atual + o que foi digitado). null = sem roteiro. */
  tela: Roteiro | null
  /** O alvo escolhido antes de existir roteiro (depois, o alvo e o da `tela`). */
  alvoSemRoteiro: AlvoSec
  /** A tela tem edicao que o disco ainda nao tem. */
  sujo: boolean
  salvando: boolean
  salvoEm: number | null
  geracao: GeracaoEmCurso | null
  /**
   * O pedido que acabou de ser cancelado, por ~1 s: o cartao do andamento fica
   * no lugar dizendo "Cancelado" em vez de sumir e a lista subir embaixo do cursor.
   */
  geracaoCancelada: GeracaoEmCurso | null
  aprovando: boolean
  /** Miniatura do keyframe por id de plano. null = a cena nao tem. Ausente = ainda nao pedida. */
  miniaturas: Record<string, string | null>
  erro: string | null
  /**
   * Por que o ultimo pedido a IA falhou (a nota inteira). Fica depois de o
   * erro do rodape ser fechado: o cartao "Sem roteiro" continua dizendo o porque.
   */
  falhaDaGeracao: string | null
  recado: string | null
  /** O texto inteiro do recado, para o tooltip. */
  recadoDetalhe: string | null
  /** A ultima frase ou parte removida, por alguns segundos (o "Desfazer"). */
  remocao: Remocao | null
  /** A frase com o cursor: o rodape nao grita "Frase vazia" enquanto ele escreve nela. */
  fraseEmFoco: string | null
  /** O ultimo pedido parou antes do modelo reserva: a pergunta na tela. null = nenhuma. */
  reserva: PerguntaDoReserva | null
  /** "Partes" (uma frase por campo) ou "Texto" (o roteiro inteiro num bloco). */
  modo: ModoDoRoteiro
  /** O bloco do modo Texto, como ele digitou. */
  textoDoModo: string
  /** A tela de quando entrou no modo Texto: toda tecla re-divide contra ela. */
  baseDoTexto: Roteiro | null
  /** O cartao "Meu roteiro" (colar um roteiro proprio) esta aberto. */
  colando: boolean
  /** O que foi colado, ate o roteiro novo existir (Cancelar antes do main nao perde). */
  textoColado: string
  /** O escritor pago parou antes de gastar: a pergunta de custo. null = nenhuma. */
  custo: PerguntaDeCustoNaTela | null
  /** O revisor esta no ar (sozinho depois de gerar, ou o "Revisar"). */
  revisando: boolean
  /** O painel "Meu estilo" esta aberto no passo 2. */
  estiloAberto: boolean

  /** Abre (ou reabre) o rascunho do episodio e, sem roteiro, gera sozinho uma vez. */
  entrar: (episodioId: string) => Promise<void>
  /**
   * So LER o rascunho deste episodio, quando ele ja tem roteiro (o cabecalho
   * do assistente sabe do roteiro aprovado e da voz sem entrar no passo 2).
   * Nunca cria rascunho nem chama a IA: sem roteiro, nao faz nada.
   */
  espiar: (episodioId: string) => Promise<void>
  /**
   * Um rascunho NOVO deste episodio (eventos e roteiro do zero): o caminho
   * quando as falas mudaram depois do roteiro. O de agora fica no disco.
   */
  recomecarRascunho: () => Promise<void>
  /**
   * Sem `secaoId`: "Outra versao" (ou a primeira). Com: "Refazer esta parte".
   * `usarReserva`: ele aceitou o modelo reserva para este pedido.
   */
  gerar: (pedido?: { secaoId?: string; instrucao?: string; usarReserva?: boolean; custoAceito?: number }) => Promise<void>
  /** "Usar modelo reserva": refaz o pedido que parou, com a permissao. */
  usarReserva: () => void
  /** "Esperar": fecha a pergunta. O porque fica no cartao "Sem roteiro". */
  esperarReserva: () => void
  /** Para de esperar. O que chegar depois vai para o historico, sem mexer na tela. */
  cancelarGeracao: () => void
  /** Troca a tela inteira por `mudar(tela)` e agenda a gravacao. Travado durante a IA. */
  editar: (mudar: (roteiro: Roteiro) => Roteiro) => void
  editarFrase: (fraseId: string, patch: Partial<Omit<Frase, 'id'>>) => void
  /** Frase nova na secao, na posicao (fim, sem posicao). Devolve o id dela. */
  inserirFrase: (secaoId: string, posicao?: number, base?: Partial<Omit<Frase, 'id'>>) => string | null
  /** Parte a frase em duas no ponto do cursor. Devolve o id da segunda. */
  dividirFrase: (fraseId: string, antes: string, depois: string) => string | null
  /** Junta a frase com a anterior da mesma secao. Devolve o id da anterior e onde o cursor fica. */
  juntarComAnterior: (fraseId: string) => { fraseId: string; cursor: number } | null
  /** `desfazivel`: a lixeira (com texto, o rodape oferece "Desfazer"). O Backspace numa vazia nao. */
  removerFrase: (fraseId: string, desfazivel?: boolean) => void
  removerSecao: (secaoId: string) => void
  desfazerRemocao: () => void
  trocarAlvo: (alvo: AlvoSec) => void
  escolherVersao: (versao: number) => Promise<void>
  aprovar: () => Promise<void>
  desaprovar: () => Promise<void>
  /** Grava ja o que estiver pendente (sem esperar o relogio). */
  salvarAgora: () => Promise<void>
  pedirMiniaturas: (planoIds: readonly string[]) => Promise<void>
  marcarFoco: (fraseId: string | null) => void
  limparErro: () => void
  limparRecado: () => void
  /**
   * "Partes | Texto". Para o Texto: o roteiro vira um bloco. Para Partes: as
   * frases novas sao ligadas aos eventos (religarRoteiro); texto igual ao da
   * entrada volta sem chamar nada.
   */
  trocarModo: (modo: ModoDoRoteiro) => Promise<void>
  /** Uma tecla no bloco do modo Texto: re-divide e agenda a gravacao. */
  digitarTexto: (texto: string) => void
  abrirColar: () => void
  fecharColar: () => void
  digitarColado: (texto: string) => void
  /** "Usar meu roteiro": o texto colado vira a versao atual, com as frases ligadas aos eventos. */
  usarMeuRoteiro: () => Promise<void>
  /** Liga aos eventos as frases que ainda nao tem vinculo (o "Ligar N frases" da barra). */
  ligarFrases: () => Promise<void>
  /** O sim da pergunta de custo: refaz o pedido com o teto que ela mostrou. */
  confirmarCusto: () => void
  /** O nao: fecha a pergunta, nada gasto. */
  desistirCusto: () => void
  /** Revisa a versao atual (grava antes). `automatico` = depois de gerar (respeita o "Revisar depois de gerar"). */
  revisar: (automatico?: boolean) => Promise<void>
  /** "Aplicar todas": versao nova com as sugestoes. */
  aplicarRevisao: () => Promise<void>
  /** "Ignorar": as marcas dessas frases somem. */
  ignorarRevisao: (fraseIds: readonly string[]) => Promise<void>
  abrirEstilo: () => void
  fecharEstilo: () => void
}

/** Espera depois da ultima tecla antes de gravar. */
const ESPERA_DA_GRAVACAO_MS = 700
/** Quanto o "Desfazer" de uma remocao fica no rodape. */
const DESFAZER_POR_MS = 6000
/** Quanto o cartao do andamento segura o lugar depois do Cancelar. */
const CANCELADO_POR_MS = 1000

let fila: Promise<unknown> = Promise.resolve()
/** Poe a tarefa no fim da fila. Uma tarefa nunca chama naFila (esperaria por si mesma). */
function naFila<T>(tarefa: () => Promise<T>): Promise<T> {
  const vez = fila.then(tarefa, tarefa)
  fila = vez.catch(() => undefined)
  return vez
}

/**
 * A chamada a IA de cada rascunho que ainda esta no ar (inclusive a de um
 * pedido cancelado). O main aceita um pedido por rascunho: o pedido novo
 * espera esta terminar, mostrando "Esperando a resposta anterior...".
 */
const iaNoAr = new Map<string, Promise<void>>()
function noAr<T>(rascunhoId: string, chamada: Promise<T>): Promise<T> {
  const fim = chamada.then(
    () => undefined,
    () => undefined,
  )
  iaNoAr.set(rascunhoId, fim)
  void fim.then(() => {
    if (iaNoAr.get(rascunhoId) === fim) iaNoAr.delete(rascunhoId)
  })
  return chamada
}

let relogio: ReturnType<typeof setTimeout> | null = null
function pararRelogio(): void {
  if (relogio) clearTimeout(relogio)
  relogio = null
}

let relogioDaRemocao: ReturnType<typeof setTimeout> | null = null
let relogioDoCancelado: ReturnType<typeof setTimeout> | null = null

let ultimoToken = 0

/** Rascunhos que ja tiveram a geracao automatica nesta sessao (falhou ou cancelou: o botao assume). */
const jaGerados = new Set<string>()
/** Miniaturas pedidas ao main (uma vez por plano e episodio). */
const miniaturasPedidas = new Set<string>()

const LIMPO = {
  rascunho: null,
  indice: null,
  avisos: [],
  abrindo: false,
  tela: null,
  alvoSemRoteiro: ALVO_PADRAO,
  sujo: false,
  salvando: false,
  salvoEm: null,
  geracao: null,
  geracaoCancelada: null,
  aprovando: false,
  miniaturas: {},
  erro: null,
  falhaDaGeracao: null,
  recado: null,
  recadoDetalhe: null,
  remocao: null,
  fraseEmFoco: null,
  reserva: null,
  modo: 'partes',
  textoDoModo: '',
  baseDoTexto: null,
  colando: false,
  textoColado: '',
  custo: null,
  revisando: false,
  estiloAberto: false,
} satisfies Partial<EstadoDoRoteiro>

/** Fora do modo Texto (a tela volta as partes). */
const SEM_TEXTO = { modo: 'partes', textoDoModo: '', baseDoTexto: null } satisfies Partial<EstadoDoRoteiro>

/** "1 frase nova" / "3 frases novas": a conta e o substantivo juntos. */
function conta(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`
}

/**
 * O recado curto do religar ("3 frases novas, 2 religadas, 1 sem momento"),
 * com os consertos da resposta no tooltip. `casamento` e o do texto contra o
 * roteiro de antes do modo Texto (o do main ja ve as frases gravadas no
 * caminho, todas iguais). null = nada mudou e nada foi ligado.
 */
export function resumoDaReligacao(
  feito: Pick<RoteiroReligadoPronto, 'frases' | 'religadas' | 'semEvento' | 'doCache' | 'avisos'>,
  casamento: { novas: number; parecidas: number; removidas: number } | null,
): { recado: string | null; detalhe: string | null } {
  const novas = casamento?.novas ?? feito.frases.filter((f) => f.destino === 'nova').length
  const parecidas = casamento?.parecidas ?? feito.frases.filter((f) => f.destino === 'parecida').length
  const removidas = casamento?.removidas ?? 0
  const partes = [
    novas > 0 ? conta(novas, 'frase nova', 'frases novas') : null,
    parecidas > 0 ? conta(parecidas, 'mudada', 'mudadas') : null,
    removidas > 0 ? conta(removidas, 'removida', 'removidas') : null,
    feito.religadas.length > 0 ? conta(feito.religadas.length, 'religada', 'religadas') : null,
    feito.semEvento.length > 0 ? `${feito.semEvento.length} sem momento` : null,
  ].filter((x): x is string => x !== null)
  if (partes.length === 0) return { recado: null, detalhe: null }
  const detalhe = [
    feito.doCache ? 'Ligacao do cache, sem gastar cota.' : null,
    feito.semEvento.length > 0 ? 'Sem momento: a frase fica sem cena do episodio ate ganhar um evento (clique no quadro dela).' : null,
    ...feito.avisos,
  ].filter((x): x is string => x !== null)
  return { recado: partes.join(', '), detalhe: detalhe.length > 0 ? detalhe.join('\n') : null }
}

/** Os avisos do main que contam conserto na resposta da IA (os outros a tela ja mostra). */
function reparos(avisos: readonly string[]): string[] {
  return avisos.filter((a) => /removid|descartad|ignorad/i.test(a))
}

/**
 * A tela com a versao, a hora e a origem do que esta no disco. E por `versao`
 * e `criadoEm` que o main sabe se a tela partiu da gravacao atual (senao, a
 * edicao vira versao nova em vez de trocar no lugar: aplicarEdicao). Quando
 * ele digita durante a gravacao a tela fica com o texto dele, mas com estes
 * dados do que acabou de ser gravado.
 */
function comDadosDoDisco(tela: Roteiro, salvo: Roteiro): Roteiro {
  const { revisada: _revisada, ...resto } = tela
  return {
    ...resto,
    versao: salvo.versao,
    criadoEm: salvo.criadoEm,
    origem: salvo.origem,
    derivadoDe: salvo.derivadoDe,
    pedido: salvo.pedido,
    modelo: salvo.modelo,
    ...(salvo.revisada ? { revisada: true } : {}),
  }
}

/**
 * Aplica `mudar` na frase `fraseId`, onde quer que ela esteja. Frase que nao
 * existe mais (um blur que chega depois de juntar) devolve o MESMO roteiro: a
 * tela nao vira "suja" a toa.
 */
function naFrase(roteiro: Roteiro, fraseId: string, mudar: (f: Frase) => Frase): Roteiro {
  if (!roteiro.secoes.some((s) => s.frases.some((f) => f.id === fraseId))) return roteiro
  return {
    ...roteiro,
    secoes: roteiro.secoes.map((s) =>
      s.frases.some((f) => f.id === fraseId) ? { ...s, frases: s.frases.map((f) => (f.id === fraseId ? mudar(f) : f)) } : s,
    ),
  }
}

/** O mais novo dos dois (pelo atualizadoEm): respostas de chamadas cruzadas podem chegar fora de ordem. */
function maisNovo(a: RascunhoDoRecap | null, b: RascunhoDoRecap): RascunhoDoRecap {
  return a && a.id === b.id && a.atualizadoEm > b.atualizadoEm ? a : b
}

export const useRoteiro = create<EstadoDoRoteiro>((set, get) => {
  /** O rascunho na tela ainda e este (o usuario nao trocou de episodio no meio). */
  const ainda = (id: string): boolean => get().rascunho?.id === id

  const agendar = (): void => {
    pararRelogio()
    relogio = setTimeout(() => {
      relogio = null
      void get().salvarAgora()
    }, ESPERA_DA_GRAVACAO_MS)
  }

  /**
   * Grava a edicao pendente. SO DENTRO DA FILA. false = falhou (o erro ja
   * esta na tela) ou o rascunho mudou. Se ele digitou enquanto gravava, a tela
   * fica com o texto dele (com os dados do que foi gravado) e outra gravacao e
   * agendada.
   */
  const gravarPendente = async (id: string): Promise<boolean> => {
    const s = get()
    if (!ainda(id)) return false
    if (!s.tela || !s.sujo) return true
    const enviada = s.tela
    set({ salvando: true })
    const r = await ponte.salvarRoteiro(id, enviada)
    if (!ainda(id)) return false
    if (!r.ok) {
      set({ salvando: false, erro: r.error })
      return false
    }
    const salvo = roteiroAtual(r.value) ?? enviada
    const igual = get().tela === enviada
    set({
      rascunho: r.value,
      salvando: false,
      salvoEm: Date.now(),
      ...(igual ? { tela: salvo, sujo: false } : { tela: comDadosDoDisco(get().tela ?? enviada, salvo) }),
    })
    if (!igual) agendar()
    return true
  }

  /** O indice para conferir as falas: o do passo 1 quando e o mesmo episodio (pode ter relido a legenda). */
  const indiceDaTela = (): EpisodeIndex | null => {
    const doPasso1 = useGerar.getState().indice
    return doPasso1 && doPasso1.id === get().episodioId ? doPasso1 : get().indice
  }

  const aplicarAberto = (aberto: RascunhoAberto): void => {
    const tela = roteiroAtual(aberto.rascunho)
    // O bloco do modo Texto so continua se ainda e o texto do disco (voltou ao passo sem mudar nada).
    const s = get()
    const textoVelho = s.modo === 'texto' && (!tela || !mesmoTextoDoRoteiro(textoDoRoteiro(tela), s.textoDoModo))
    set({
      abrindo: false,
      rascunho: aberto.rascunho,
      indice: aberto.indice,
      avisos: aberto.avisos,
      tela,
      alvoSemRoteiro: aberto.rascunho.alvoSec,
      sujo: false,
      ...(textoVelho ? SEM_TEXTO : {}),
    })
  }

  /**
   * Sem roteiro ainda: gera sozinho, UMA vez por rascunho na sessao. Se falhar
   * ou for cancelado, o botao "Gerar roteiro" assume -- reentrar no passo nao
   * pode virar uma chamada nova a cada vez (a cota e curta).
   */
  const gerarSozinho = (): void => {
    const s = get()
    const r = s.rascunho
    if (!r || r.atual !== null || s.geracao || jaGerados.has(r.id)) return
    const indice = indiceDaTela()
    if (!indice || cuesElegiveis(indice).length === 0) return
    jaGerados.add(r.id)
    void get().gerar()
  }

  /** Reler o rascunho ao voltar ao passo: a legenda pode ter sido relida no passo 1. */
  const reabrir = async (): Promise<void> => {
    const s = get()
    const episodioId = s.episodioId
    const id = s.rascunho?.id
    if (!episodioId || !id || s.geracao || s.abrindo) return
    pararRelogio()
    await naFila(async () => {
      if (!ainda(id) || get().geracao) return
      if (!(await gravarPendente(id))) return
      const r = await ponte.abrirRascunho(episodioId)
      if (!ainda(id) || get().geracao) return
      if (!r.ok) {
        set({ erro: r.error })
        return
      }
      // Digitou enquanto relia: a tela dele fica; o resto vem do disco.
      if (get().sujo) set({ rascunho: r.value.rascunho, indice: r.value.indice, avisos: r.value.avisos })
      else aplicarAberto(r.value)
    })
  }

  const lembrarRemocao = (remocao: Remocao): void => {
    if (relogioDaRemocao) clearTimeout(relogioDaRemocao)
    set({ remocao })
    relogioDaRemocao = setTimeout(() => {
      relogioDaRemocao = null
      if (get().remocao === remocao) set({ remocao: null })
    }, DESFAZER_POR_MS)
  }

  /**
   * Rele o rascunho do disco sem tirar a tela de quem digita. E o caminho
   * depois de um religar que nao trouxe o rascunho (erro, parada no reserva):
   * o main grava o texto ANTES da IA, entao o disco ja tem a versao nova.
   */
  const recarregar = async (id: string): Promise<void> => {
    const episodioId = get().episodioId
    if (!episodioId) return
    await naFila(async () => {
      if (!ainda(id)) return
      const r = await ponte.abrirRascunho(episodioId)
      if (!ainda(id) || !r.ok || r.value.rascunho.id !== id) return
      if (get().sujo) set({ rascunho: r.value.rascunho })
      else set({ rascunho: r.value.rascunho, tela: roteiroAtual(r.value.rascunho) })
    })
  }

  /** O texto `texto` ja esta na versao atual do disco (o main gravou antes de a IA falhar). */
  const textoGravado = (texto: string): boolean => {
    const atual = get().rascunho ? roteiroAtual(get().rascunho!) : null
    return atual !== null && mesmoTextoDoRoteiro(textoDoRoteiro(atual), texto)
  }

  /**
   * O RELIGAR (religarRoteiro no main): o texto vira roteiro e as frases sem
   * vinculo sao ligadas aos eventos numa chamada so. Como o "gerar": o que
   * esta digitado grava ANTES, na fila; a chamada lenta fica fora dela e
   * espera a IA anterior deste rascunho. true = a tela ficou com o roteiro
   * religado. Falhou ou parou no reserva: a tela rele o disco (o texto ja
   * esta la) e sai do modo Texto se ele ficou gravado.
   */
  const religar = async (p: PedidoDaTela & { usarReserva?: boolean }): Promise<boolean> => {
    const s = get()
    const r = s.rascunho
    if (!r || s.geracao || s.aprovando) return false
    const id = r.id
    const token = ++ultimoToken
    pararRelogio()
    if (relogioDoCancelado) clearTimeout(relogioDoCancelado)
    // O resumo conta contra o roteiro de antes do modo Texto: as novas de toda a edicao.
    const base = s.modo === 'texto' && p.modo === 'editar' ? s.baseDoTexto : null
    const casamento = base ? redividirRoteiro(base, p.texto) : null
    const comEventos = r.eventos.length === 0
    set({
      geracao: {
        token,
        etapa: comEventos ? 'eventos' : 'religar',
        secaoId: null,
        comEventos,
        inicio: Date.now(),
        mensagem: null,
        comecou: false,
        religar: true,
      },
      geracaoCancelada: null,
      erro: null,
      falhaDaGeracao: null,
      recado: null,
      recadoDetalhe: null,
      remocao: null,
      reserva: null,
    })
    const vivo = (): boolean => get().geracao?.token === token

    // O que esta digitado vai para o disco antes de tudo: o texto nunca depende da IA.
    const gravou = await naFila(async () => (ainda(id) ? gravarPendente(id) : false))
    if (!gravou) {
      if (vivo()) set({ geracao: null })
      return false
    }
    await (iaNoAr.get(id) ?? Promise.resolve())
    if (!vivo() || !ainda(id)) return false
    const g = get().geracao
    if (g) set({ geracao: { ...g, comecou: true } })
    const tela = get().tela
    const resposta = await noAr(
      id,
      ponte.religarRoteiro(id, {
        texto: p.texto,
        modo: p.modo,
        ...(p.alvoSec !== undefined ? { alvoSec: p.alvoSec } : {}),
        ...(p.modo === 'editar' && tela ? { versao: tela.versao, criadoEm: tela.criadoEm } : {}),
        pedidoId: String(token),
        aceitouReserva: p.usarReserva === true,
      }),
    )
    if (!ainda(id)) return false

    const parada = resposta.ok && ehParadaNoReserva(resposta.value) ? resposta.value : null
    if (!resposta.ok || parada) {
      await recarregar(id)
      if (!vivo()) return false
      const gravado = textoGravado(p.texto)
      // Gravado, o texto ja e o roteiro da tela: o modo Texto e o cartao de colar fecham.
      const fechar = gravado ? { ...SEM_TEXTO, colando: false, textoColado: '' } : {}
      if (!resposta.ok || !parada) {
        const erro = resposta.ok ? 'Resposta inesperada.' : resposta.error
        set({ geracao: null, erro, ...fechar, ...(gravado || p.modo !== 'meu-roteiro' ? {} : { colando: true }) })
        return false
      }
      const refazer: PedidoDaTela = { texto: p.texto, modo: p.modo, ...(p.alvoSec !== undefined ? { alvoSec: p.alvoSec } : {}) }
      set({ geracao: null, ...fechar, reserva: { ...parada, secaoId: null, instrucao: null, religar: refazer } })
      return false
    }

    const feito = resposta.value
    if (ehParadaNoReserva(feito)) return false
    if (!vivo()) {
      // Cancelado: o main nao aplicou a ligacao, mas o texto ficou gravado.
      const novo = maisNovo(get().rascunho, feito.rascunho)
      set(get().sujo ? { rascunho: novo } : { rascunho: novo, tela: roteiroAtual(novo) })
      return false
    }
    const resumo = resumoDaReligacao(
      feito,
      casamento
        ? {
            novas: casamento.religar.length,
            parecidas: casamento.frases.filter((f) => f.destino === 'parecida').length,
            removidas: casamento.removidas.length,
          }
        : null,
    )
    set({
      rascunho: feito.rascunho,
      tela: feito.roteiro,
      sujo: false,
      salvoEm: Date.now(),
      geracao: null,
      ...SEM_TEXTO,
      colando: false,
      textoColado: '',
      recado: resumo.recado,
      recadoDetalhe: resumo.detalhe,
    })
    return true
  }

  /** Sai do modo Texto: texto igual ao da entrada volta direto; mudado, passa pelo religar. */
  const sairDoTexto = async (): Promise<boolean> => {
    const s = get()
    if (s.modo !== 'texto') return true
    if (!s.baseDoTexto || mesmoTextoDoRoteiro(s.textoDoModo, textoDoRoteiro(s.baseDoTexto))) {
      set(SEM_TEXTO)
      return true
    }
    return religar({ texto: s.textoDoModo, modo: 'editar' })
  }

  /** O "Aprovar roteiro" de sempre: grava a tela e aprova numa chamada so. */
  const aprovarTela = async (): Promise<void> => {
    const s = get()
    if (!s.rascunho || !s.tela || s.geracao || s.aprovando) return
    const id = s.rascunho.id
    pararRelogio()
    set({ aprovando: true, erro: null })
    await naFila(async () => {
      const tela = get().tela
      if (!ainda(id) || !tela) {
        set({ aprovando: false })
        return
      }
      const r = await ponte.aprovarRoteiro(id, tela)
      if (!ainda(id)) return
      if (!r.ok) {
        set({ aprovando: false, erro: r.error })
        return
      }
      const salvo = roteiroAtual(r.value) ?? tela
      const igual = get().tela === tela
      set({
        aprovando: false,
        rascunho: r.value,
        salvoEm: Date.now(),
        remocao: null,
        // "Cancelado.", "Do cache..." eram de antes: aprovado, o rodape diz so isso.
        recado: null,
        recadoDetalhe: null,
        ...(igual ? { tela: salvo, sujo: false } : { tela: comDadosDoDisco(get().tela ?? tela, salvo) }),
      })
      // Digitou durante a aprovacao: a gravacao seguinte desaprova, como deve.
      if (!igual) agendar()
    })
  }

  return {
    episodioId: null,
    ...LIMPO,

    entrar: async (episodioId) => {
      const s = get()
      if (s.episodioId === episodioId && (s.rascunho !== null || s.abrindo)) {
        await reabrir()
        gerarSozinho()
        return
      }
      /*
       * Outro episodio. A tela e marcada como dele AGORA, antes de qualquer
       * espera: o StrictMode chama o efeito duas vezes, e as duas abririam
       * (ou criariam) o rascunho ao mesmo tempo. O que ficou por gravar do
       * anterior vai para a fila com a tela dele.
       */
      pararRelogio()
      const anterior = s.rascunho?.id
      const telaAnterior = s.tela
      if (anterior && s.sujo && telaAnterior) void naFila(() => ponte.salvarRoteiro(anterior, telaAnterior))
      miniaturasPedidas.clear()
      set({ ...LIMPO, episodioId, abrindo: true })
      const restaurado = useGerar.getState().tomarRascunhoRestaurado(episodioId)
      // Abrir so le (ou cria) o rascunho DESTE episodio: nao espera a fila do outro.
      const r = restaurado ? { ok: true as const, value: restaurado } : await ponte.abrirRascunho(episodioId)
      if (get().episodioId !== episodioId) return
      if (!r.ok) {
        set({ abrindo: false, erro: r.error })
        return
      }
      aplicarAberto(r.value)
      gerarSozinho()
    },

    espiar: async (episodioId) => {
      const s = get()
      if (s.episodioId === episodioId || s.abrindo || s.geracao) return
      const lista = await ponte.listarRascunhos()
      // O mais recente deste episodio (a lista vem do mais novo ao mais velho, como o "voltar onde parou").
      const deste = lista.ok ? lista.value.find((x) => x.episodioId === episodioId) : undefined
      // Sem roteiro, entrar geraria um sozinho (gerarSozinho): isso e so do passo 2.
      if (!deste || deste.palavras === null) return
      const agora = get()
      if (agora.episodioId === episodioId || agora.abrindo || agora.geracao) return
      await get().entrar(episodioId)
    },

    recomecarRascunho: async () => {
      const s = get()
      const episodioId = s.episodioId
      const id = s.rascunho?.id
      if (!episodioId || !id || s.geracao || s.abrindo || s.aprovando) return
      pararRelogio()
      // O que esta digitado fica gravado no rascunho de agora antes de sair dele.
      await naFila(() => gravarPendente(id))
      if (!ainda(id) || get().geracao) return
      set({ abrindo: true, erro: null, recado: null, recadoDetalhe: null, remocao: null, reserva: null })
      const r = await ponte.abrirRascunho(episodioId, true)
      if (get().episodioId !== episodioId) return
      if (!r.ok) {
        set({ abrindo: false, erro: r.error })
        return
      }
      aplicarAberto(r.value)
      gerarSozinho()
    },

    gerar: async (pedido = {}) => {
      const s = get()
      const r = s.rascunho
      // No modo Texto o bloco e a tela: uma versao nova da IA o deixaria para tras.
      if (!r || s.geracao || s.aprovando || s.modo === 'texto') return
      const id = r.id
      const token = ++ultimoToken
      const secaoId = pedido.secaoId ?? null
      const instrucao = pedido.instrucao?.trim().slice(0, INSTRUCAO_MAX) || null
      const usarReserva = pedido.usarReserva === true
      const custoAceito = pedido.custoAceito
      const alvoSec = s.tela?.alvoSec ?? s.alvoSemRoteiro
      const comEventos = r.eventos.length === 0
      pararRelogio()
      if (relogioDoCancelado) clearTimeout(relogioDoCancelado)
      set({
        geracao: {
          token,
          etapa: comEventos ? 'eventos' : secaoId ? 'secao' : 'roteiro',
          secaoId,
          comEventos,
          inicio: Date.now(),
          mensagem: null,
          comecou: false,
          religar: false,
        },
        geracaoCancelada: null,
        erro: null,
        falhaDaGeracao: null,
        recado: null,
        recadoDetalhe: null,
        remocao: null,
        reserva: null,
        custo: null,
      })
      const vivo = (): boolean => get().geracao?.token === token
      const marcar = (patch: Partial<GeracaoEmCurso>): void => {
        const g = get().geracao
        if (g?.token === token) set({ geracao: { ...g, ...patch } })
      }
      const falhou = (erro: string): void => {
        if (vivo()) set({ geracao: null, erro, falhaDaGeracao: erro })
      }
      // So sobrou o reserva: nada foi gravado (a versao e a aprovacao ficam). A
      // tela pergunta; o pedido vai junto para o "Usar modelo reserva" refazer igual.
      const parou = (p: ParadoNoReserva): void => {
        if (vivo()) set({ geracao: null, reserva: { ...p, secaoId, instrucao } })
      }

      // A IA anterior deste rascunho (um pedido cancelado) ainda no ar: espera
      // aqui, FORA da fila, para nao segurar as gravacoes de ninguem.
      await (iaNoAr.get(id) ?? Promise.resolve())
      if (!vivo() || !ainda(id)) return

      // Na fila so o comeco: a edicao que ainda nao foi gravada vai antes
      // ("Refazer" parte do que esta na tela).
      const pronto = await naFila(async () => {
        if (!vivo() || !ainda(id)) return false
        marcar({ comecou: true })
        if (!(await gravarPendente(id))) {
          if (vivo()) set({ geracao: null })
          return false
        }
        return vivo() && ainda(id)
      })
      if (!pronto) return

      /*
       * Com o reserva aceito, os eventos que faltam vao no proprio pedido do
       * roteiro (o main roda os dois): o gerarEventos do IPC so leva o id, e
       * pediria sem a permissao. A etapa vem do andamento do main.
       */
      if (get().rascunho!.eventos.length === 0 && !usarReserva) {
        marcar({ etapa: 'eventos', mensagem: null })
        const ev = await noAr(id, ponte.gerarEventos(id))
        if (!ainda(id)) return
        if (!ev.ok) return falhou(ev.error)
        if (ehParadaNoReserva(ev.value)) return parou(ev.value)
        set({ rascunho: maisNovo(get().rascunho, ev.value.rascunho) })
        if (!vivo()) return
      }

      // A versao na tela antes do pedido: e para ela que a corrida do Cancelar volta.
      const anterior = get().rascunho!.atual
      if (get().rascunho!.eventos.length > 0) marcar({ etapa: secaoId ? 'secao' : 'roteiro', mensagem: null })
      const ro = await noAr(
        id,
        ponte.gerarRoteiro(id, {
          alvoSec,
          instrucao,
          secaoId,
          pedidoId: String(token),
          aceitouReserva: usarReserva,
          ...(custoAceito !== undefined ? { custoAceito } : {}),
        }),
      )
      if (!ainda(id)) return
      if (!ro.ok) return falhou(ro.error)
      if (ehParadaNoReserva(ro.value)) return parou(ro.value)
      // Escritor pago sem o sim: nada foi gasto nem gravado. A pergunta entra no lugar do andamento.
      if (ehPerguntaDeCusto(ro.value)) {
        if (vivo()) set({ geracao: null, custo: { estimativa: ro.value.estimativa, secaoId, instrucao, usarReserva } })
        return
      }
      const { rascunho, roteiro, doCache, soNoHistorico, avisos, escritor } = ro.value
      const consertos = reparos(avisos)
      const semChave = avisos.find((a) => /sem chave: escrito pelo gratis/.test(a)) ?? null

      if (vivo()) {
        const partes = [
          doCache ? 'Do cache, sem gastar cota.' : null,
          escritor && !doCache ? `Escrito por ${escritor}.` : null,
          semChave,
          consertos.length > 0
            ? `${consertos.length} ${consertos.length === 1 ? 'ajuste' : 'ajustes'} na resposta da IA.`
            : null,
        ].filter((x): x is string => x !== null)
        set({
          rascunho,
          tela: roteiro,
          sujo: false,
          geracao: null,
          salvoEm: Date.now(),
          recado: partes.length > 0 ? partes.join(' ') : null,
          recadoDetalhe: consertos.length > 0 ? consertos.join('\n') : null,
        })
        // O revisor: so depois de um roteiro INTEIRO novo (o "Refazer esta parte" nao gasta outra chamada).
        if (!secaoId) void get().revisar(true)
        return
      }

      /*
       * CANCELADO NO MEIO. O caso comum: o main soube do Cancelar a tempo e
       * guardou a versao so no historico -- a tela, a versao atual e a
       * aprovacao nao mudam; a lista de Versoes ganha a nova.
       */
      if (soNoHistorico) {
        set({
          rascunho: maisNovo(get().rascunho, rascunho),
          recado: `Versao ${roteiro.versao} guardada em Versoes.`,
          recadoDetalhe: null,
        })
        return
      }
      // Sem versao antes (a primeira), nao ha o que proteger: ela aparece.
      if (anterior === null) {
        set(get().tela === null ? { rascunho, tela: roteiro, sujo: false } : { rascunho: maisNovo(get().rascunho, rascunho) })
        return
      }
      /*
       * A corrida: o main gravou a versao como atual antes de o Cancelar
       * chegar. Volta para a versao que a tela tinha (a de antes, ou a que ele
       * editou depois do Cancelar) e, se estava aprovada, aprova de novo.
       */
      await naFila(async () => {
        if (!ainda(id)) return
        const antes = get().rascunho
        const voltarPara = antes?.atual ?? anterior
        const reaprovar = antes?.aprovado === true && !get().sujo
        const volta = await ponte.escolherVersao(id, voltarPara)
        if (!ainda(id)) return
        if (!volta.ok) {
          set({ rascunho, erro: volta.error })
          return
        }
        let final = volta.value
        const atual = roteiroAtual(final)
        if (reaprovar && atual) {
          const ap = await ponte.aprovarRoteiro(id, atual)
          if (!ainda(id)) return
          if (ap.ok) final = ap.value
        }
        set({ rascunho: final, recado: `Versao ${roteiro.versao} guardada em Versoes.`, recadoDetalhe: null })
      })
    },

    confirmarCusto: () => {
      const c = get().custo
      if (!c) return
      set({ custo: null })
      void get().gerar({
        ...(c.secaoId ? { secaoId: c.secaoId } : {}),
        ...(c.instrucao ? { instrucao: c.instrucao } : {}),
        usarReserva: c.usarReserva,
        custoAceito: c.estimativa.usdMaximo,
      })
    },

    desistirCusto: () => {
      if (get().custo) set({ custo: null, recado: 'Nada gasto.', recadoDetalhe: null })
    },

    revisar: async (automatico = false) => {
      const s = get()
      if (!s.rascunho || !s.tela || s.revisando || s.modo === 'texto') return
      const id = s.rascunho.id
      set({ revisando: true })
      // A edicao pendente vai antes: o main revisa o que esta gravado.
      pararRelogio()
      const gravou = await naFila(async () => (ainda(id) ? gravarPendente(id) : false))
      if (!gravou || !ainda(id)) {
        if (ainda(id)) set({ revisando: false })
        return
      }
      const r = await ponte.revisarRoteiro(id, automatico)
      if (!ainda(id)) return
      if (!r.ok) {
        set({ revisando: false, recado: `Revisao pulada: ${resumoDaFalha(r.error).curto}.`, recadoDetalhe: r.error })
        return
      }
      const feita = r.value
      if (feita.pulada !== null) {
        // Desligado nao e recado; o resto (cota, rede, so reserva) avisa e segue.
        set(
          feita.pulada === 'desligada'
            ? { revisando: false }
            : { revisando: false, recado: `Revisao pulada: ${resumoDaFalha(feita.nota).curto}.`, recadoDetalhe: feita.nota },
        )
        return
      }
      const n = feita.revisao.itens.length
      set({
        revisando: false,
        rascunho: maisNovo(get().rascunho, feita.rascunho),
        recado: n === 0 ? 'Revisado: nada a apontar.' : `Revisado: ${n} ${n === 1 ? 'frase marcada' : 'frases marcadas'}.`,
        recadoDetalhe: feita.doCache ? 'Do cache, sem gastar cota.' : null,
      })
    },

    aplicarRevisao: async () => {
      const s = get()
      if (!s.rascunho || !s.tela || s.geracao || s.aprovando) return
      const id = s.rascunho.id
      pararRelogio()
      await naFila(async () => {
        if (!ainda(id) || !(await gravarPendente(id))) return
        const r = await ponte.aplicarRevisao(id)
        if (!ainda(id)) return
        if (!r.ok) {
          set({ erro: r.error })
          return
        }
        const tela = roteiroAtual(r.value)
        set({
          rascunho: r.value,
          tela,
          sujo: false,
          salvoEm: Date.now(),
          recado: tela ? `Versao ${tela.versao}: revisada. A anterior fica em Versoes.` : null,
          recadoDetalhe: null,
        })
      })
    },

    ignorarRevisao: async (fraseIds) => {
      const s = get()
      if (!s.rascunho || fraseIds.length === 0) return
      const id = s.rascunho.id
      await naFila(async () => {
        if (!ainda(id) || !(await gravarPendente(id))) return
        const r = await ponte.ignorarRevisao(id, fraseIds)
        if (!ainda(id)) return
        if (!r.ok) set({ erro: r.error })
        else set({ rascunho: maisNovo(get().rascunho, r.value) })
      })
    },

    abrirEstilo: () => set({ estiloAberto: true }),
    fecharEstilo: () => set({ estiloAberto: false }),

    usarReserva: () => {
      const p = get().reserva
      if (!p) return
      if (p.religar) {
        set({ reserva: null })
        void religar({ ...p.religar, usarReserva: true })
        return
      }
      void get().gerar({ secaoId: p.secaoId ?? undefined, instrucao: p.instrucao ?? undefined, usarReserva: true })
    },

    esperarReserva: () => {
      const p = get().reserva
      if (!p) return
      // No religar o texto ja esta gravado: so a ligacao fica para depois ("Ligar N frases").
      if (p.religar) set({ reserva: null, recado: 'Frases novas sem momento por enquanto.', recadoDetalhe: textoDaParada(p) })
      else set({ reserva: null, falhaDaGeracao: textoDaParada(p, true) })
    },

    cancelarGeracao: () => {
      const s = get()
      const g = s.geracao
      if (!g) return
      // O main manda a resposta deste pedido so para o historico.
      if (s.rascunho && g.comecou) void ponte.cancelarRoteiro(s.rascunho.id, String(g.token))
      if (relogioDoCancelado) clearTimeout(relogioDoCancelado)
      if (g.religar) {
        /*
         * O texto do modo Texto ja esta gravado (vai antes da IA): a tela volta
         * as partes. O colado so esta gravado se o main ja comecou; antes
         * disso o cartao de colar volta com o texto.
         */
        const colado = s.textoColado.trim() !== '' && !g.comecou
        set({
          geracao: null,
          geracaoCancelada: g,
          ...SEM_TEXTO,
          colando: colado,
          ...(colado ? {} : { textoColado: '' }),
          recado: 'Cancelado.',
          recadoDetalhe: 'O texto ficou salvo. As frases novas ficam sem momento ate o "Ligar frases".',
        })
        // O main grava o texto assim que recebe o pedido: a tela mostra ja o que ficou, sem esperar a IA.
        if (g.comecou && s.rascunho) void recarregar(s.rascunho.id)
      } else {
        set({
          geracao: null,
          geracaoCancelada: g,
          recado: 'Cancelado.',
          recadoDetalhe: 'Se a resposta da IA chegar depois, ela fica em Versoes.',
        })
      }
      relogioDoCancelado = setTimeout(() => {
        relogioDoCancelado = null
        if (get().geracaoCancelada?.token === g.token) set({ geracaoCancelada: null })
      }, CANCELADO_POR_MS)
    },

    editar: (mudar) => {
      const s = get()
      if (!s.tela || s.geracao) return
      const nova = mudar(s.tela)
      if (nova === s.tela) return
      set({ tela: nova, sujo: true })
      agendar()
    },

    editarFrase: (fraseId, patch) => {
      get().editar((r) => naFrase(r, fraseId, (f) => ({ ...f, ...patch })))
    },

    inserirFrase: (secaoId, posicao, base) => {
      const tela = get().tela
      if (!tela || get().geracao) return null
      const nova: Frase = { ...fraseVazia(tela), ...base }
      get().editar((r) => ({
        ...r,
        secoes: r.secoes.map((s) => {
          if (s.id !== secaoId) return s
          const frases = [...s.frases]
          frases.splice(posicao ?? frases.length, 0, nova)
          return { ...s, frases }
        }),
      }))
      return nova.id
    },

    dividirFrase: (fraseId, antes, depois) => {
      const tela = get().tela
      if (!tela || get().geracao) return null
      const secao = tela.secoes.find((s) => s.frases.some((f) => f.id === fraseId))
      const original = secao?.frases.find((f) => f.id === fraseId)
      if (!secao || !original) return null
      /*
       * A segunda metade fala do MESMO momento: leva os eventos e a intencao
       * visual. Citacao, texto de tela e o instante escolhido ficam na
       * primeira (sao de uma fala e de um instante, nao se dividem).
       */
      const id = proximoId('f', idsDeFrase(tela))
      const segunda: Frase = {
        id,
        texto: depois,
        eventoIds: [...original.eventoIds],
        cueDoMomento: null,
        intencaoVisual: original.intencaoVisual,
        textoDeTela: null,
        citacaoCueId: null,
      }
      get().editar((r) => ({
        ...r,
        secoes: r.secoes.map((s) =>
          s.id !== secao.id
            ? s
            : {
                ...s,
                frases: s.frases.flatMap((f) => (f.id === fraseId ? [{ ...f, texto: antes }, segunda] : [f])),
              },
        ),
      }))
      return id
    },

    juntarComAnterior: (fraseId) => {
      const tela = get().tela
      if (!tela || get().geracao) return null
      const secao = tela.secoes.find((s) => s.frases.some((f) => f.id === fraseId))
      if (!secao) return null
      const i = secao.frases.findIndex((f) => f.id === fraseId)
      const anterior = secao.frases[i - 1]
      const atual = secao.frases[i]
      if (!anterior || !atual) return null
      const esquerda = anterior.texto.trimEnd()
      const direita = atual.texto.trimStart()
      const texto = esquerda && direita ? `${esquerda} ${direita}` : esquerda || direita
      const eventoIds = [...anterior.eventoIds, ...atual.eventoIds.filter((e) => !anterior.eventoIds.includes(e))]
      get().editar((r) => ({
        ...r,
        secoes: r.secoes.map((s) =>
          s.id !== secao.id
            ? s
            : {
                ...s,
                frases: s.frases
                  .filter((f) => f.id !== fraseId)
                  .map((f) =>
                    f.id === anterior.id
                      ? {
                          ...f,
                          texto,
                          eventoIds,
                          cueDoMomento: f.cueDoMomento ?? atual.cueDoMomento,
                          intencaoVisual: f.intencaoVisual || atual.intencaoVisual,
                          textoDeTela: f.textoDeTela ?? atual.textoDeTela,
                          citacaoCueId: f.citacaoCueId ?? atual.citacaoCueId,
                        }
                      : f,
                  ),
              },
        ),
      }))
      return { fraseId: anterior.id, cursor: esquerda.length + (esquerda && direita ? 1 : 0) }
    },

    removerFrase: (fraseId, desfazivel = false) => {
      const tela = get().tela
      if (!tela || get().geracao) return
      const secao = tela.secoes.find((s) => s.frases.some((f) => f.id === fraseId))
      const posicao = secao?.frases.findIndex((f) => f.id === fraseId) ?? -1
      const frase = secao?.frases[posicao]
      if (!secao || !frase) return
      get().editar((r) => ({
        ...r,
        secoes: r.secoes.map((s) => (s.id === secao.id ? { ...s, frases: s.frases.filter((f) => f.id !== fraseId) } : s)),
      }))
      // Frase em branco nao precisa de volta; com texto, um clique errado nao pode apagar para sempre.
      if (desfazivel && frase.texto.trim()) lembrarRemocao({ tipo: 'frase', secaoId: secao.id, frase, posicao })
    },

    removerSecao: (secaoId) => {
      const tela = get().tela
      if (!tela || get().geracao) return
      const posicao = tela.secoes.findIndex((s) => s.id === secaoId)
      const secao = tela.secoes[posicao]
      if (!secao) return
      get().editar((r) => ({ ...r, secoes: r.secoes.filter((s) => s.id !== secaoId) }))
      lembrarRemocao({ tipo: 'parte', secao, posicao })
    },

    desfazerRemocao: () => {
      const rem = get().remocao
      if (!rem || get().geracao) return
      if (relogioDaRemocao) clearTimeout(relogioDaRemocao)
      relogioDaRemocao = null
      set({ remocao: null })
      if (rem.tipo === 'frase') {
        get().editar((r) =>
          !r.secoes.some((s) => s.id === rem.secaoId) || r.secoes.some((s) => s.frases.some((f) => f.id === rem.frase.id))
            ? r
            : {
                ...r,
                secoes: r.secoes.map((s) => {
                  if (s.id !== rem.secaoId) return s
                  const frases = [...s.frases]
                  frases.splice(Math.min(rem.posicao, frases.length), 0, rem.frase)
                  return { ...s, frases }
                }),
              },
        )
        return
      }
      get().editar((r) => {
        if (r.secoes.some((s) => s.id === rem.secao.id)) return r
        const secoes = [...r.secoes]
        secoes.splice(Math.min(rem.posicao, secoes.length), 0, rem.secao)
        return { ...r, secoes }
      })
    },

    trocarAlvo: (alvo) => {
      const s = get()
      if (s.geracao) return
      // Sem roteiro, o alvo so vale para o proximo pedido.
      if (!s.tela) {
        set({ alvoSemRoteiro: alvo })
        return
      }
      if (s.tela.alvoSec === alvo) return
      get().editar((r) => ({ ...r, alvoSec: alvo }))
    },

    escolherVersao: async (versao) => {
      const s = get()
      const r = s.rascunho
      if (!r || s.geracao || s.aprovando || s.modo === 'texto') return
      if (r.atual === versao && !s.sujo) return
      const id = r.id
      pararRelogio()
      await naFila(async () => {
        // O que estava digitado vira uma versao 'editado' antes de sair dela.
        if (!(await gravarPendente(id))) return
        const v = await ponte.escolherVersao(id, versao)
        if (!ainda(id)) return
        if (!v.ok) {
          set({ erro: v.error })
          return
        }
        // O recado era da resposta da IA de outra versao ("1 ajuste..."): nao vale para esta.
        set({
          rascunho: v.value,
          tela: roteiroAtual(v.value),
          sujo: false,
          salvoEm: Date.now(),
          recado: null,
          recadoDetalhe: null,
          remocao: null,
        })
      })
    },

    aprovar: async () => {
      if (get().modo !== 'texto') {
        await aprovarTela()
        return
      }
      // No modo Texto, as frases novas sao ligadas antes: aprova o que ficou nas partes.
      if (!(await sairDoTexto())) return
      const { recado, recadoDetalhe } = get()
      await aprovarTela()
      // O resumo do religar ("2 frases novas, 2 religadas") vale mais que o silencio do "Aprovado".
      if (recado && get().rascunho?.aprovado && !get().recado) set({ recado, recadoDetalhe })
    },

    desaprovar: async () => {
      const s = get()
      if (!s.rascunho?.aprovado || s.geracao) return
      const id = s.rascunho.id
      await naFila(async () => {
        if (!ainda(id)) return
        const r = await ponte.desaprovarRoteiro(id)
        if (!ainda(id)) return
        if (!r.ok) set({ erro: r.error })
        else set({ rascunho: r.value })
      })
    },

    salvarAgora: async () => {
      pararRelogio()
      const s = get()
      const id = s.rascunho?.id
      if (!id || !s.sujo) return
      await naFila(() => gravarPendente(id))
    },

    pedirMiniaturas: async (planoIds) => {
      const { episodioId, miniaturas } = get()
      if (!episodioId) return
      const faltam = [...new Set(planoIds)].filter((p) => !(p in miniaturas) && !miniaturasPedidas.has(p))
      if (faltam.length === 0) return
      for (const p of faltam) miniaturasPedidas.add(p)
      const r = await ponte.miniaturasDasCenas(episodioId, faltam)
      if (get().episodioId !== episodioId) return
      // A miniatura e apoio: falhar deixa o quadro vazio com o tempo, sem recado.
      if (!r.ok) return
      set({ miniaturas: { ...get().miniaturas, ...r.value } })
    },

    marcarFoco: (fraseId) => {
      if (get().fraseEmFoco !== fraseId) set({ fraseEmFoco: fraseId })
    },

    limparErro: () => set({ erro: null }),
    limparRecado: () => set({ recado: null, recadoDetalhe: null }),

    trocarModo: async (modo) => {
      const s = get()
      if (s.modo === modo || !s.tela || s.geracao || s.aprovando) return
      if (modo === 'partes') {
        await sairDoTexto()
        return
      }
      const texto = textoDoRoteiro(s.tela)
      set({ modo: 'texto', textoDoModo: texto, baseDoTexto: s.tela, colando: false, remocao: null })
    },

    digitarTexto: (texto) => {
      const s = get()
      const base = s.baseDoTexto
      if (s.modo !== 'texto' || !base || s.geracao) return
      set({ textoDoModo: texto })
      // Voltou ao texto da entrada: o roteiro de antes, inteiro (nada re-dividido a toa).
      const secoes = mesmoTextoDoRoteiro(texto, textoDoRoteiro(base)) ? base.secoes : redividirRoteiro(base, texto).secoes
      get().editar((r) => (JSON.stringify(r.secoes) === JSON.stringify(secoes) ? r : { ...r, secoes }))
    },

    abrirColar: () => {
      const s = get()
      if (!s.rascunho || s.geracao || s.aprovando) return
      set({ colando: true })
    },

    fecharColar: () => set({ colando: false }),

    digitarColado: (texto) => set({ textoColado: texto }),

    usarMeuRoteiro: async () => {
      const s = get()
      const texto = s.textoColado
      if (!s.rascunho || s.geracao || s.aprovando || !texto.trim()) return
      // O roteiro colado troca o da tela: o modo Texto (ja gravado) acaba aqui.
      set({ colando: false, ...SEM_TEXTO })
      await religar({ texto, modo: 'meu-roteiro', alvoSec: s.tela?.alvoSec ?? s.alvoSemRoteiro })
    },

    ligarFrases: async () => {
      const s = get()
      if (!s.tela || s.modo !== 'partes') return
      // O mesmo texto: o main nao re-divide nada, so liga as que estao sem vinculo.
      await religar({ texto: textoDoRoteiro(s.tela), modo: 'editar' })
    },
  }
})

// Em dev, alcancavel pelo console e pelo teste por CDP, como o gerarStore (main.tsx).
if (import.meta.env.DEV) Reflect.set(window, 'roteiroStore', useRoteiro)

/**
 * O indice que a tela do roteiro usa: o do passo 1 quando e o mesmo episodio
 * (ele pode ter relido a legenda), senao o que veio com o rascunho.
 */
export function useIndiceDoRoteiro(): EpisodeIndex | null {
  const episodioId = useRoteiro((s) => s.episodioId)
  const doRascunho = useRoteiro((s) => s.indice)
  const doPasso1 = useGerar((s) => s.indice)
  return useMemo(() => {
    if (!doPasso1 || doPasso1.id !== episodioId) return doRascunho
    /*
     * O corte em segundo plano terminou e so o indice do rascunho ganhou os
     * planos (escutarRoteiro): as falas ficam as do passo 1, as cenas vem do
     * corte -- e as miniaturas aparecem sem sair do passo.
     */
    if (doPasso1.planos.length === 0 && doRascunho?.id === doPasso1.id && doRascunho.planos.length > 0) {
      return { ...doPasso1, planos: doRascunho.planos }
    }
    return doPasso1
  }, [episodioId, doRascunho, doPasso1])
}

/** A ultima conta do validarRoteiro: a lista, a barra e o rodape pedem a mesma a cada tecla. */
let ultimaConta: {
  tela: Roteiro
  eventos: readonly Evento[]
  indice: EpisodeIndex | null
  ritmo: number
  problemas: ProblemaDoRoteiro[]
} | null = null

/**
 * Os problemas do roteiro na tela (validarRoteiro), contados uma vez por
 * mudanca para os tres lugares que mostram: as frases, a barra e o rodape.
 */
export function useProblemasDoRoteiro(): ProblemaDoRoteiro[] {
  const tela = useRoteiro((s) => s.tela)
  const eventos = useRoteiro((s) => s.rascunho?.eventos)
  const indice = useIndiceDoRoteiro()
  // O "Curto/Longo" mede o TEMPO na voz que vai narrar (shared/ritmo.ts), nao palavras a 2,7.
  const ritmo = useRitmoDaVoz()
  return useMemo(() => {
    if (!tela || !eventos) return []
    if (ultimaConta && ultimaConta.tela === tela && ultimaConta.eventos === eventos && ultimaConta.indice === indice && ultimaConta.ritmo === ritmo) {
      return ultimaConta.problemas
    }
    const problemas = validarRoteiro(tela, eventos, indice ?? undefined, ritmo)
    ultimaConta = { tela, eventos, indice, ritmo, problemas }
    return problemas
  }, [tela, eventos, indice, ritmo])
}

/** O roteiro aprovado esta na tela, sem nada digitado depois. */
export function roteiroAprovado(s: Pick<EstadoDoRoteiro, 'rascunho' | 'sujo' | 'aprovando'>): boolean {
  return s.rascunho?.aprovado === true && !s.sujo && !s.aprovando
}

/**
 * Liga a escuta do andamento da IA e a gravacao ao fechar a janela. Devolve a
 * funcao que desliga. Monta com o app (GerarRecap), como a do passo 1.
 */
export function escutarRoteiro(): () => void {
  const tirar = ponte.onRoteiroProgresso((p) => {
    const s = useRoteiro.getState()
    const g = s.geracao
    // O andamento de um pedido cancelado (ou de outro rascunho) nao fala do que esta na tela.
    if (!g || !g.comecou || s.rascunho?.id !== p.rascunhoId) return
    useRoteiro.setState({ geracao: { ...g, etapa: p.etapa, mensagem: p.mensagem } })
  })
  // O corte do episodio terminou (passo 1, em segundo plano): o indice com os
  // planos chega aqui, e o momento de cada frase ganha a miniatura da cena.
  const tirarCorte = ponte.onCorteProgresso((e) => {
    if (!e.indice || e.episodioId !== useRoteiro.getState().episodioId) return
    useRoteiro.setState({ indice: e.indice })
  })
  /*
   * Fechar o app com a ultima tecla ainda no relogio: grava JA, direto, fora
   * da fila. Uma gravacao que entrasse atras de outra tarefa nao sairia antes
   * de a janela fechar; o main serializa as chamadas e confere a base.
   */
  const antesDeFechar = (): void => {
    pararRelogio()
    const s = useRoteiro.getState()
    if (s.rascunho && s.tela && s.sujo) void ponte.salvarRoteiro(s.rascunho.id, s.tela)
  }
  window.addEventListener('beforeunload', antesDeFechar)
  return () => {
    tirar()
    tirarCorte()
    window.removeEventListener('beforeunload', antesDeFechar)
  }
}

/**
 * O porque de uma falha da IA em poucas palavras, e se o caminho e
 * Configuracoes (chave, cota, modelo). A nota inteira do llm.ts fica no
 * tooltip: cortada pelo rodape estreito, ela perdia justamente a parte do
 * "o que fazer".
 *
 * `espera`: nao e falha, e o "Esperar" do modelo reserva. A tela mantem a cor
 * de aviso da pergunta, em vez de virar erro vermelho depois do clique.
 */
export function resumoDaFalha(nota: string): { curto: string; configuracoes: boolean; espera?: boolean } {
  // O "Esperar" do modelo reserva: a frase ja e curta (textoDaParada).
  if (/^Modelos bons/.test(nota)) return { curto: nota, configuracoes: false, espera: true }
  if (/cota gratis do Gemini acabou por hoje/i.test(nota)) {
    return { curto: 'Cota gratis acabou hoje', configuracoes: true }
  }
  if (/nao tem cota gratis|aposentou|nao existe no Gemini/i.test(nota)) {
    return { curto: 'Modelo sem cota gratis', configuracoes: true }
  }
  if (/Sem chave de IA/i.test(nota)) return { curto: 'Sem chave de IA', configuracoes: true }
  if (/chave .* recusada|nao tem permissao/i.test(nota)) {
    return { curto: 'Chave de IA recusada', configuracoes: true }
  }
  if (/Nenhum modelo gratis/i.test(nota)) return { curto: 'Nenhum modelo livre agora', configuracoes: false }
  if (/Sem conexao/i.test(nota)) return { curto: 'Sem internet', configuracoes: false }
  if (/demorou demais/i.test(nota)) return { curto: 'A IA demorou demais', configuracoes: false }
  if (/Muitos pedidos/i.test(nota)) return { curto: 'Muitos pedidos: espere 1 min', configuracoes: false }
  const primeira = nota.split(/(?<=[.!?])\s/)[0] ?? nota
  return { curto: primeira.length > 48 ? `${primeira.slice(0, 46).trimEnd()}...` : primeira.replace(/\.$/, ''), configuracoes: false }
}
