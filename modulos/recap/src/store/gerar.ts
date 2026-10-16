import { create } from 'zustand'
import { classifyFile } from '@shared/channels'
import {
  statusDoCorte,
  temPlanos,
  type EpisodeIndex,
  type EpisodioEncontrado,
  type EstadoDoCorte,
  type EventoDoCorte,
  type Exclusao,
  type FimDaAnalise,
  type IndexarEpisodioArgs,
  type Motor,
  type PalpiteDoEpisodio,
  type ProgressoDaAnalise,
  type SondaDoEpisodio,
  type StatusDoMotor,
} from '../../shared/episodio'
import type { RascunhoAberto } from '../../shared/roteiro'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { passoAoRestaurar, type PassoDoAssistente } from './gerar-passos'
import { recapsParaContinuar, type RecapParaContinuar } from './gerar-continuar'
import { pedirMotor, quandoAFaseMudar } from './motor-runtime'

/**
 * [recap] O corte das cenas em segundo plano chega com o motor (parte 4). Ate
 * la o episodio novo para nas falas: nada sobe por tras, e a tela diz "Cortar
 * cenas: em breve" no lugar do andamento do corte.
 */
export const CORTE_NO_FUNDO = false

/*
 * DONOS DESTA STORE (contrato de 14/10, cinco agentes em paralelo):
 * - agente C (navegacao): `passo`, `irParaPasso`, `tomarRascunhoRestaurado` e a
 *   regra em gerar-passos.ts (PassoDoAssistente, PASSOS, passoAoRestaurar);
 * - agente E (fluxo do passo 1): todo o resto -- fases, sonda, busca, motor,
 *   analisar/indexar, regua, podeIrAoRoteiro e o corte em segundo plano
 *   (estado novo do corte entra aqui).
 * Mexer na parte do outro so com Edit pequeno e relendo antes.
 */
export type { PassoDoAssistente } from './gerar-passos'

/**
 * O ASSISTENTE "GERAR RECAP", passo 1 (Episodio).
 *
 * Store propria, fora do documento: nada daqui entra no undo, no autosave nem
 * no arquivo do projeto. O assistente prepara o EPISODIO (cenas cortadas,
 * legenda com quem fala, OP/ED marcadas) e o que ele produz mora no disco, no
 * episodio.json da biblioteca do Studio -- nao no projeto aberto.
 *
 * O estado sobrevive a fechar o assistente: a analise leva minutos, e fechar a
 * tela para olhar outra coisa nao pode jogar fora o andamento. Reabrir mostra
 * exatamente onde parou.
 *
 * A navegacao entre os passos (`passo`) mora aqui; o passo 2 (Roteiro) tem a
 * store dele em gerar-roteiro.ts.
 */

/**
 * Em que pe esta o passo 1. A tela mostra uma secao por fase; os dados (sonda,
 * busca, indice) ficam guardados a parte para a fase seguinte reaproveitar.
 */
export type FaseDoEpisodio =
  /** Nenhum arquivo ainda: a area de soltar. */
  | 'vazio'
  /** Lendo medidas, faixas e palpite do arquivo. */
  | 'sondando'
  /** Arquivo lido; busca e motor chegando ou ja na tela. Esperando a escolha. */
  | 'escolha'
  /** O motor esta cortando (e talvez reconhecendo personagens). */
  | 'analisando'
  /** Lendo a legenda e montando o episodio.json. */
  | 'indexando'
  /** Indice na mao: resumo e regua de OP/ED. */
  | 'pronto'

export interface JobDaAnalise {
  /** null enquanto o pedido esta no ar e o main ainda nao devolveu o id. */
  id: string | null
  motor: Motor
  reconhecer: boolean
  /** Date.now() do pedido, para o tempo decorrido. */
  inicio: number
  cancelando: boolean
}

export interface DescobertaPendente {
  motivo: 'anime-nao-encontrado' | 'sem-referencias'
  motor: Motor
  erro: string
}

/**
 * O recado de um Continuar que nao abriu, dito para ESTA tela: o main manda
 * "Abra o episodio de novo no passo 1", mas na escolha nao ha passo 1 -- o
 * caminho e o Novo recap com o .mkv.
 */
export function recadoDaEscolha(erro: string): string {
  return /Abra o episodio de novo no passo 1/.test(erro) ? 'Episodio nao encontrado. Use Novo recap.' : erro
}

/** A escolha "Novo recap | Continuar" na tela (EscolhaDoRecap.tsx, regras em gerar-continuar.ts). */
export interface EscolhaAberta {
  /** As linhas do "Continuar", do mais recente ao mais antigo. Nunca vazia: sem recap, o clique vai direto ao arquivo. */
  recaps: RecapParaContinuar[]
  /** O episodio que esta abrindo (clicou na linha). As outras linhas esperam. */
  abrindo: string | null
  /** Por que o ultimo nao abriu (o recado do abrirRascunho), em ASCII. */
  erro: string | null
  /** O episodio cujo Continuar nao abriu: a linha fica marcada e o foco volta a ela. */
  falhou?: string | null
}

interface EstadoDoGerar {
  aberto: boolean
  fase: FaseDoEpisodio
  arquivo: string | null
  sonda: SondaDoEpisodio | null
  /** O palpite como o usuario deixou (comeca no da sonda). */
  palpite: PalpiteDoEpisodio | null
  /** `index` absoluto da faixa escolhida. null = sem legenda. */
  faixaLegenda: number | null
  /** null = ainda procurando (ou nem comecou). [] = nao achou. */
  busca: EpisodioEncontrado[] | null
  procurando: boolean
  /** O palpite com que a busca rodou, para saber se vale procurar de novo. */
  palpiteDaBusca: string | null
  motor: StatusDoMotor | null
  motorErro: string | null
  /** Um statusDoMotor no ar. Segura o segundo pedido e mostra "Conferindo..." no botao. */
  conferindoMotor: boolean
  reconhecer: boolean
  job: JobDaAnalise | null
  progresso: ProgressoDaAnalise | null
  /** As etapas por onde a analise ja passou (o motor nao anda em ordem fixa). */
  etapasVistas: string[]
  descoberta: DescobertaPendente | null
  /** A linha de andamento da indexacao. null fora dela. */
  indexando: string | null
  indice: EpisodeIndex | null
  /**
   * O tempo de motor gasto NESTE episodio, somando as rodadas: uma que cortou
   * e parou no reconhecimento (minutos) mais o "cortar sem reconhecer" que
   * reaproveitou o corte (segundos). So a ultima mentiria "feita em 9s".
   */
  ultimaAnalise: { motor: Motor; segundos: number; rodadas: number } | null
  /** Todas as rodadas do motor neste episodio (as que falharam tambem). Zera ao trocar de arquivo. */
  tempoDoMotor: { segundos: number; rodadas: number }
  /**
   * De onde vieram as fotos do elenco na ultima analise deste episodio, quando
   * nao foi a busca online ('Corte Cenas', da reserva do elenco). A tela diz
   * "Fotos: Corte Cenas" no resumo. null = busca online, ou nao se sabe.
   */
  fotosDoElenco: string | null
  /**
   * O motor (este) cortou o episodio e parou no reconhecimento (sem fotos do
   * elenco): as cenas estao no disco, mas sem shots.json a busca nao as ve. A
   * tela nao pode dizer "nao esta na biblioteca". null = nao aconteceu.
   */
  corteSemIndice: Motor | null
  /** As marcacoes da regua como estao na tela (o indice guarda as salvas). */
  exclusoes: Exclusao[]
  exclusoesMudaram: boolean
  salvando: boolean
  salvoEm: number | null
  erro: string | null
  /** Recado neutro, sem vermelho ("Analise cancelada."). */
  recado: string | null
  /**
   * O CORTE EM SEGUNDO PLANO do episodio na tela (shared/episodio.ts, corte):
   * o indice nasce so com as falas e as cenas chegam depois. null = sem indice,
   * ou indice que ja nasceu com as cenas (nada a mostrar). Vem do indice, do
   * iniciarCorte e do evento corteProgresso.
   */
  corte: EstadoDoCorte | null
  /** Um iniciarCorte no ar: segura o segundo clique. */
  pedindoCorte: boolean
  /** Date.now() de quando as cenas chegaram (o cabecalho mostra "Cenas prontas" por uns segundos). */
  fimDoCorteEm: number | null
  /**
   * O corte de OUTRO episodio que segue rodando por tras (trocou de episodio
   * no meio). So para a barra de status; a tela mostra o do episodio dela.
   */
  corteDeOutro: { episodioId: string; estado: EstadoDoCorte } | null
  /**
   * O "Trocar pasta" pediu as Configuracoes ja na Biblioteca do Studio, que
   * fica no fim delas. AjustesDoStudio rola ate la e apaga o pedido.
   */
  ajustesPedidos: boolean
  /**
   * Em que parada do assistente a tela esta. O passo 2 (Roteiro) tem store
   * propria (gerar-roteiro.ts); aqui mora so a navegacao. Trocar de episodio
   * volta ao 1.
   */
  passo: PassoDoAssistente
  /**
   * O rascunho que o "Continuar" ja abriu: o passo 2 pega este em vez de pedir
   * de novo ao main. null = nada guardado.
   */
  rascunhoRestaurado: RascunhoAberto | null
  /** A escolha "Novo recap | Continuar" aberta. null = fechada. Fica fora do `limpo`: nao e do episodio. */
  escolha: EscolhaAberta | null

  /** Vai ao passo. O 2 e o 3 so com o episodio pronto (podeIrAoRoteiro). */
  irParaPasso: (passo: PassoDoAssistente) => void
  /** Entrega (e esquece) o rascunho restaurado, se for deste episodio. */
  tomarRascunhoRestaurado: (episodioId: string) => RascunhoAberto | null

  abrir: (path?: string) => void
  /** Abre as Configuracoes na aba Geral, roladas ate a Biblioteca do Studio. */
  abrirAjustesDoStudio: () => void
  ajustesVistos: () => void
  /**
   * A porta do assistente (botao da tela inicial, paleta): com um episodio ja
   * nele (ou uma analise rodando), reabre onde parou; sem, abre a escolha
   * "Novo recap | Continuar" -- e, sem recap nenhum para continuar, vai
   * direto ao dialogo de escolher o .mkv (decisao do Levi, 15/10).
   */
  abrirOuEscolher: () => Promise<void>
  /**
   * "Novo recap" da escolha: com `path` (o .mkv solto nela), abre com ele;
   * sem, o dialogo. Cancelar o dialogo deixa a escolha na tela.
   */
  novoRecap: (path?: string) => Promise<void>
  /**
   * "Continuar" um recap da escolha: reabre o episodio do rascunho no passo
   * onde parou. Nao abriu: a escolha fica, com o recado do main.
   */
  continuar: (episodioId: string) => Promise<void>
  fecharEscolha: () => void
  fechar: () => void
  /** Dialogo nativo. true = escolheu um arquivo (e o assistente abriu). */
  escolherArquivo: () => Promise<boolean>
  carregarArquivo: (path: string) => Promise<void>
  /** Volta para a area de soltar ("Trocar episodio"). */
  recomecar: () => void
  editarPalpite: (patch: Partial<PalpiteDoEpisodio>) => void
  procurarDeNovo: () => Promise<void>
  escolherFaixa: (index: number | null) => void
  definirReconhecer: (ligado: boolean) => void
  usarAnalise: (achado: EpisodioEncontrado) => Promise<void>
  /**
   * Episodio novo: le as falas JA (indexarFalas) e corta por tras. Episodio
   * achado ("Analisar de novo") ou "Reconhecer agora": a analise em primeiro
   * plano de sempre.
   */
  analisar: (motor: Motor, reconhecer?: boolean) => Promise<void>
  cancelar: () => Promise<void>
  /**
   * (Re)comeca o corte em segundo plano do episodio na tela. Sem opcoes, o
   * motor e o "reconhecer" do ultimo corte. O nome corrigido na tela vai junto.
   */
  cortarNoFundo: (opcoes?: { motor?: Motor; reconhecer?: boolean }) => Promise<void>
  /** Para o corte em segundo plano. As falas continuam valendo. */
  cancelarCorte: () => Promise<void>
  /** Le a legenda de novo (outra faixa) sobre a mesma pasta de cenas. */
  reindexar: () => Promise<void>
  esquecerDescoberta: () => void
  confirmarExclusao: (i: number) => void
  confirmarTodas: () => void
  removerExclusao: (i: number) => void
  ajustarExclusao: (i: number, patch: Partial<Pick<Exclusao, 'start' | 'end' | 'motivo'>>) => void
  /** Acrescenta um trecho manual e devolve o indice dele na lista. */
  marcarTrecho: (start: number, end: number) => number
  descartarMudancas: () => void
  salvarExclusoes: () => Promise<void>
  verNaBiblioteca: () => Promise<void>
  limparErro: () => void
  limparRecado: () => void
  /**
   * Pergunta ao main se o motor responde. O main guarda so a resposta pronta:
   * motor que nao respondeu e sondado de novo a cada pedido.
   */
  conferirMotor: () => Promise<void>
}

/**
 * O passo 2 abre com o episodio PRONTO e com a regua salva: os eventos saem
 * do indice gravado, e marcacao de OP/ED so na tela ficaria fora deles.
 *
 * NAO espera o corte em segundo plano (`corte`): o roteiro so precisa das
 * falas. Quem espera as cenas e o passo 4. O `job` e so a analise em primeiro
 * plano ("Analisar de novo", "Reconhecer agora"), que troca o indice no fim.
 */
export function podeIrAoRoteiro(
  s: Pick<EstadoDoGerar, 'fase' | 'indice' | 'exclusoesMudaram' | 'job'>,
): boolean {
  return s.fase === 'pronto' && s.indice !== null && !s.exclusoesMudaram && s.job === null
}

/** Trecho mais curto que a regua aceita. Menos que isso e clique, nao marcacao. */
export const TRECHO_MINIMO = 1

/** O mesmo filtro do dialogo de abrir (ipc.ts): o motor le estes. */
const EXTENSOES_DE_EPISODIO = ['mkv', 'mp4', 'm4v', 'webm', 'mov']

export function ehEpisodio(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return classifyFile(path) === 'video' && EXTENSOES_DE_EPISODIO.includes(ext)
}

function chaveDoPalpite(p: PalpiteDoEpisodio): string {
  return `${p.anime.trim().toLowerCase()}|${p.temporada}|${p.episodio}|${p.kind}`
}

/** Dentro do episodio, com pelo menos TRECHO_MINIMO de largura. */
export function normalizarExclusao(e: Exclusao, duracao: number): Exclusao {
  const fim = duracao > 0 ? duracao : Math.max(e.end, e.start + TRECHO_MINIMO)
  let start = Math.min(Math.max(0, e.start), Math.max(0, fim - TRECHO_MINIMO))
  let end = Math.min(Math.max(e.end, start + TRECHO_MINIMO), fim)
  if (end - start < TRECHO_MINIMO) start = Math.max(0, end - TRECHO_MINIMO)
  // Decimos de segundo: mais que isso e ruido de arraste, e o json fica legivel.
  start = Math.round(start * 1000) / 1000
  end = Math.round(end * 1000) / 1000
  return { ...e, start, end }
}

function emOrdem(lista: readonly Exclusao[]): Exclusao[] {
  return [...lista].sort((a, b) => a.start - b.start || a.end - b.end)
}

/** '<biblioteca>/Dr STONE/S04E24' -> 'Dr STONE': a pasta do anime, a de cima da do episodio. */
function pastaDaSerie(pastaDoEpisodio: string): string | null {
  const partes = pastaDoEpisodio.split(/[\\/]+/).filter(Boolean)
  return partes.length >= 2 ? (partes[partes.length - 2] ?? null) : null
}

/*
 * EVENTOS SEM DONO. O main devolve o jobId antes de qualquer evento do job
 * (sobe o processo em setImmediate), mas a ordem entre a resposta do invoke e
 * o primeiro webContents.send nao e algo em que valha apostar a tela. Enquanto
 * o id nao chegou, o que vier fica guardado aqui e e reaplicado na chegada.
 */
let eventosSemDono: ({ tipo: 'progresso'; p: ProgressoDaAnalise } | { tipo: 'fim'; f: FimDaAnalise })[] = []

/**
 * Cada arquivo carregado ganha uma geracao. Resposta que volta de uma geracao
 * velha (sonda lenta de um arquivo que ele ja trocou) e descartada.
 */
let geracao = 0

/** A releitura da Biblioteca do editor depois de um episodio novo do Studio. */
let sincronizando: Promise<void> | null = null

/**
 * A lista de rascunhos no ar (o clique na porta): o segundo clique no botao
 * nao abre o dialogo nem a escolha por cima.
 */
let lendoAPorta = false

/**
 * Os receptores do progresso e do fim, preenchidos dentro do create (precisam
 * do set/get da store). Declarados ANTES dele: o create roda na hora.
 */
let receptores: {
  receberProgresso: (p: ProgressoDaAnalise) => void
  receberFim: (f: FimDaAnalise) => void
  receberCorte: (e: EventoDoCorte) => void
} = { receberProgresso: () => {}, receberFim: () => {}, receberCorte: () => {} }

/**
 * Dos dois estados do mesmo corte, o mais novo. A resposta do iniciarCorte e
 * o evento do motor correm em paralelo; o que chegou depois nao pode desfazer
 * o andamento que ja esta na tela.
 */
function maisNovo(a: EstadoDoCorte | null, b: EstadoDoCorte): EstadoDoCorte {
  if (!a || a.status !== 'cortando' || b.status !== 'cortando' || a.jobId !== b.jobId) return b
  return a.atualizadoEm > b.atualizadoEm ? a : b
}

/** O corte do indice que interessa a tela: null quando ele ja nasceu com as cenas. */
function corteDoIndice(indice: EpisodeIndex): EstadoDoCorte | null {
  if (temPlanos(indice) && statusDoCorte(indice) === 'pronto') return null
  return indice.corte ?? null
}

export const useGerar = create<EstadoDoGerar>((set, get) => {
  const limpo = {
    fase: 'vazio' as FaseDoEpisodio,
    arquivo: null,
    sonda: null,
    palpite: null,
    faixaLegenda: null,
    busca: null,
    procurando: false,
    palpiteDaBusca: null,
    progresso: null,
    etapasVistas: [],
    descoberta: null,
    indexando: null,
    indice: null,
    ultimaAnalise: null,
    tempoDoMotor: { segundos: 0, rodadas: 0 },
    fotosDoElenco: null,
    corteSemIndice: null,
    exclusoes: [],
    exclusoesMudaram: false,
    salvando: false,
    salvoEm: null,
    erro: null,
    recado: null,
    corte: null as EstadoDoCorte | null,
    pedindoCorte: false,
    fimDoCorteEm: null as number | null,
    // Outro episodio comeca no passo 1 (o roteiro guardado e de outro).
    passo: 1 as PassoDoAssistente,
    rascunhoRestaurado: null,
  }

  /**
   * Trocando de episodio com o corte do atual rodando: ele continua no main
   * (e anexa as cenas sozinho no fim), e a barra de status segue mostrando.
   */
  const guardarCorteQueSegue = (): void => {
    const { indice, corte } = get()
    if (indice && corte && (corte.status === 'cortando' || corte.mensagem === 'Na fila')) {
      set({ corteDeOutro: { episodioId: indice.id, estado: corte } })
    }
  }

  /**
   * Depois de ter o indice so com as falas: o que o main sabe do corte agora
   * (um job vivo, se a tela recarregou no meio) e, se ninguem esta cortando,
   * comeca. `iniciar: false` so olha.
   */
  const acompanharCorte = async (
    indice: EpisodeIndex,
    opcoes: { iniciar: boolean; motor?: Motor; reconhecer?: boolean },
  ): Promise<void> => {
    if (!CORTE_NO_FUNDO) return
    const r = await ponte.estadoDoCorte(indice.id)
    if (get().indice?.id !== indice.id) return
    const estado = r.ok ? r.value : null
    if (estado) set({ corte: maisNovo(get().corte, estado) })
    if (estado?.status === 'cortando' || estado?.status === 'pronto') return
    // Na fila (vivo no main): ja vai subir sozinho.
    if (estado?.status === 'pendente' && (estado.mensagem === 'Na fila' || estado.mensagem === 'Esperando o motor')) return
    if (opcoes.iniciar) await get().cortarNoFundo({ motor: opcoes.motor, reconhecer: opcoes.reconhecer })
  }

  /**
   * EPISODIO NOVO, sem esperar o corte: as falas e a sugestao de OP/ED em
   * segundos (indexarFalas), a tela vai para o resumo e o "Proximo: Roteiro"
   * libera; o corte sobe por tras.
   */
  const comecarSemEsperar = async (motor: Motor, reconhecer: boolean): Promise<void> => {
    const { arquivo, palpite, faixaLegenda } = get()
    if (!arquivo || !palpite) return
    const minhaGeracao = geracao
    set({ fase: 'indexando', indexando: 'Lendo a legenda...', erro: null, recado: null, descoberta: null, reconhecer })
    const r = await ponte.indexarFalas({ path: arquivo, palpite, faixaLegenda })
    if (minhaGeracao !== geracao) return
    if (!r.ok) {
      set({ fase: 'escolha', indexando: null, erro: r.error })
      return
    }
    const indice = r.value
    set({
      fase: 'pronto',
      indexando: null,
      indice,
      exclusoes: emOrdem(indice.exclusoes),
      exclusoesMudaram: false,
      salvoEm: null,
      faixaLegenda: indice.faixaLegenda?.index ?? null,
      corte: corteDoIndice(indice),
    })
    // Ja tinha cenas (cortado antes, e a busca nao viu): nada a esperar.
    if (corteDoIndice(indice) === null) return
    await acompanharCorte(indice, { iniciar: true, motor, reconhecer })
  }

  /** As cenas chegaram (ou o corte mudou de estado). */
  const receberCorte = (e: EventoDoCorte): void => {
    const { indice, corteDeOutro } = get()
    if (!indice || e.episodioId !== indice.id) {
      // Outro episodio cortando por tras: so a barra de status quer saber.
      const segue = e.estado.status === 'cortando' || e.estado.mensagem === 'Na fila'
      if (segue) set({ corteDeOutro: { episodioId: e.episodioId, estado: e.estado } })
      else if (corteDeOutro?.episodioId === e.episodioId) set({ corteDeOutro: null })
      return
    }
    // O corte deste episodio corria como "de outro" (Trocar episodio) e ele foi
    // reaberto (Continuar, ou o mesmo .mkv pelo dialogo): agora ele e o da tela.
    // Sem isto a barra de status ficava presa no "Cenas 30%" velho para sempre.
    const deOutro = corteDeOutro?.episodioId === e.episodioId ? { corteDeOutro: null } : {}
    // O tempo de motor desta rodada, quando ela acaba (pronta, parada ou cancelada):
    // como na analise em primeiro plano, o resumo soma as rodadas do episodio.
    const anterior = get().corte
    const acabouRodada = anterior?.status === 'cortando' && e.estado.status !== 'cortando'
    const inicio = e.estado.inicio ? Date.parse(e.estado.inicio) : Number.NaN
    const segundos = Number.isFinite(inicio) ? Math.max(0, (Date.parse(e.estado.atualizadoEm) - inicio) / 1000) : 0
    const gasto = get().tempoDoMotor
    const tempoDoMotor = acabouRodada ? { segundos: gasto.segundos + segundos, rodadas: gasto.rodadas + 1 } : gasto
    if (!e.indice) {
      set({ corte: maisNovo(anterior, e.estado), tempoDoMotor, ...deOutro })
      return
    }
    const novo = e.indice
    // O recado "ainda sendo cortadas" falava de antes das cenas chegarem.
    const recado = get().recado
    set({
      ...deOutro,
      corte: e.estado,
      indice: novo,
      ...(recado?.startsWith('As cenas ainda') ? { recado: null } : {}),
      // Marcacao mexida e nao salva fica como esta na tela; o resto segue o disco.
      ...(get().exclusoesMudaram ? {} : { exclusoes: emOrdem(novo.exclusoes) }),
      // Indice novo SEM rodada de corte (o fim do Reconhecer na mao): "Cenas
      // prontas" so quando as cenas chegaram agora, e nada de "Studio · 0s".
      ...(acabouRodada || !temPlanos(indice) ? { fimDoCorteEm: Date.now() } : {}),
      ...(tempoDoMotor.rodadas > 0 ? { ultimaAnalise: { motor: e.estado.motor, ...tempoDoMotor } } : {}),
      tempoDoMotor,
      ...(e.fotosDoElenco ? { fotosDoElenco: e.fotosDoElenco } : {}),
    })
    // Cenas novas na biblioteca do Studio: a Biblioteca do editor so as ve
    // depois de reler (a mesma regra do indexar).
    if (novo.biblioteca.origem === 'studio' && nucleo().ler().library) {
      sincronizando = nucleo()
        .sincronizarBiblioteca()
        .finally(() => {
          sincronizando = null
        })
    }
  }

  /**
   * CONTINUAR UM RECAP: o rascunho mais recente do episodio `episodioId`
   * (abrirRascunho) volta com o episodio dele, no passo onde parou. O store do
   * passo 1 nao persiste, entao ele e remontado do indice que o abrirRascunho
   * devolve (caminhos ja corrigidos); a sonda (medidas e faixas de legenda)
   * chega depois, em segundo plano, se o arquivo ainda existir -- video que
   * sumiu nao impede: roteiro e voz moram no rascunho, as cenas na biblioteca.
   * null = abriu; texto = por que nao (o erro do main, ja em ASCII).
   */
  const restaurar = async (episodioId: string): Promise<string | null> => {
    const aberto = await ponte.abrirRascunho(episodioId)
    if (!aberto.ok) return aberto.error
    // Um arquivo chegou enquanto isso (soltou um .mkv): ele manda.
    if (get().arquivo !== null || get().job !== null) {
      set({ aberto: true })
      return null
    }
    const { indice } = aberto.value
    const minhaGeracao = ++geracao
    set({
      ...limpo,
      aberto: true,
      fase: 'pronto',
      arquivo: indice.fonte.path,
      palpite: { anime: indice.anime, temporada: indice.temporada, episodio: indice.episodio, kind: indice.kind },
      faixaLegenda: indice.faixaLegenda?.index ?? null,
      indice,
      exclusoes: emOrdem(indice.exclusoes),
      // Volta no passo onde parou (a regra mora em gerar-passos.ts).
      passo: passoAoRestaurar(aberto.value.rascunho),
      rascunhoRestaurado: aberto.value,
      corte: corteDoIndice(indice),
      // O corte dele seguia por tras como "de outro": volta a ser o da tela.
      ...(get().corteDeOutro?.episodioId === indice.id ? { corteDeOutro: null } : {}),
    })
    if (!get().motor?.studio.pronto) void conferirMotor()
    /*
     * Indice que ainda espera as cenas: o app fechou com o corte no meio (o
     * disco diz 'cortando', o main diz 'pendente'). Ele recomeca sozinho com o
     * motor e o "reconhecer" de antes -- o passo 4 precisa das cenas. Corte que
     * falhou ou que ele cancelou nao: o porque (ou o "Cortar no Studio") fica
     * na tela do passo 1.
     */
    if (corteDoIndice(indice) !== null) {
      const antes = indice.corte
      void acompanharCorte(indice, {
        // Cancelado pelo Levi tambem nao volta sozinho (subiria o motor sem ele pedir).
        iniciar: antes?.status !== 'falhou' && antes?.mensagem !== 'Cancelado',
        motor: antes?.motor,
        reconhecer: antes?.reconhecer,
      })
    }
    void ponte.sondarEpisodio(indice.fonte.path).then((r) => {
      if (r.ok && minhaGeracao === geracao) set({ sonda: r.value })
    })
    return null
  }

  const procurar = async (minhaGeracao: number): Promise<void> => {
    const { arquivo, palpite } = get()
    if (!arquivo || !palpite) return
    set({ procurando: true, busca: null })
    const r = await ponte.procurarEpisodio(arquivo, palpite)
    if (minhaGeracao !== geracao) return
    if (r.ok) {
      set({ procurando: false, busca: r.value, palpiteDaBusca: chaveDoPalpite(palpite) })
    } else {
      // Busca que falhou vira "nao achou", com o motivo na tela: analisar de
      // novo continua sendo um caminho valido.
      set({ procurando: false, busca: [], palpiteDaBusca: chaveDoPalpite(palpite), erro: r.error })
    }
  }

  const conferirMotor = async (): Promise<void> => {
    // Depois de pronto, a resposta e o cache do main (de graca). Antes disso
    // cada pedido sobe um probe: um por vez.
    if (get().conferindoMotor) return
    set({ conferindoMotor: true })
    const r = await ponte.statusDoMotor()
    if (r.ok) set({ motor: r.value, motorErro: null, conferindoMotor: false })
    else set({ motorErro: r.error, conferindoMotor: false })
  }

  const indexar = async (args: IndexarEpisodioArgs): Promise<void> => {
    const minhaGeracao = geracao
    set({ fase: 'indexando', indexando: 'Lendo a legenda...', erro: null, recado: null })
    const r = await ponte.indexarEpisodio(args)
    if (minhaGeracao !== geracao) return
    if (!r.ok) {
      // Ja havia um indice (trocou a legenda, ou reconheceu depois): ele continua valendo.
      if (get().indice) {
        set({ fase: 'pronto', indexando: null, erro: r.error })
        return
      }
      set({ fase: 'escolha', indexando: null, erro: r.error })
      /*
       * A analise pode ter dado certo e so a leitura da legenda falhado: as
       * cenas estao no disco. Procurar de novo poe o episodio recem-cortado no
       * cartao de "Ja analisado", e o "Usar essa analise" vira o tentar de novo
       * -- sem cortar tudo outra vez.
       */
      void procurar(minhaGeracao)
      return
    }
    set({
      fase: 'pronto',
      indexando: null,
      indice: r.value,
      exclusoes: emOrdem(r.value.exclusoes),
      exclusoesMudaram: false,
      salvoEm: null,
      faixaLegenda: r.value.faixaLegenda?.index ?? null,
      corte: corteDoIndice(r.value),
    })
    /*
     * Cenas novas na biblioteca do Studio: a Biblioteca do editor so as ve
     * depois de reler. Se ela ainda nao foi aberta nesta sessao, a primeira
     * abertura ja le tudo -- reler agora seria pagar duas vezes.
     */
    if (args.origem === 'studio' && nucleo().ler().library) {
      sincronizando = nucleo()
        .sincronizarBiblioteca()
        .finally(() => {
          sincronizando = null
        })
    }
  }

  const receberProgresso = (p: ProgressoDaAnalise): void => {
    const job = get().job
    if (!job) return
    if (job.id === null) {
      eventosSemDono.push({ tipo: 'progresso', p })
      return
    }
    if (p.jobId !== job.id) return
    const vistas = get().etapasVistas
    set({
      progresso: p,
      etapasVistas: vistas.includes(p.etapa) ? vistas : [...vistas, p.etapa],
    })
  }

  const receberFim = (f: FimDaAnalise): void => {
    const { job, arquivo, palpite, faixaLegenda } = get()
    if (!job) return
    if (job.id === null) {
      eventosSemDono.push({ tipo: 'fim', f })
      return
    }
    if (f.jobId !== job.id) return
    const gasto = get().tempoDoMotor
    const tempoDoMotor = {
      segundos: gasto.segundos + (f.ok ? f.segundos : Math.max(0, (Date.now() - job.inicio) / 1000)),
      rodadas: gasto.rodadas + 1,
    }
    if (f.ok) {
      set({
        job: null,
        progresso: null,
        etapasVistas: [],
        corteSemIndice: null,
        tempoDoMotor,
        ultimaAnalise: { motor: f.motor, ...tempoDoMotor },
        // So muda quando a analise reconheceu: um "cortar sem personagens"
        // depois nao apaga de onde vieram as fotos de antes.
        ...(f.fotosDoElenco ? { fotosDoElenco: f.fotosDoElenco } : {}),
      })
      if (!arquivo || !palpite) return
      void indexar({
        path: arquivo,
        pastaDoEpisodio: f.pastaDoEpisodio,
        origem: f.motor === 'studio' ? 'studio' : 'ancut',
        palpite,
        faixaLegenda,
        // Acabou de cortar: um indice antigo desta pasta falaria de outras cenas.
        refazer: true,
      })
      return
    }
    /*
     * Volta para onde estava: a escolha, ou o resumo quando a analise foi um
     * "reconhecer agora" sobre um episodio ja pronto -- o indice dele continua
     * valendo.
     */
    const jaPronto = get().indice !== null
    const fimDaFila = {
      job: null,
      progresso: null,
      etapasVistas: [],
      tempoDoMotor,
      fase: (jaPronto ? 'pronto' : 'escolha') as FaseDoEpisodio,
    }
    if (f.cancelado) {
      // Cancelar nao e falha: sem vermelho.
      set({ ...fimDaFila, recado: 'Analise cancelada.' })
    } else if (f.precisaDescoberta && !jaPronto) {
      set({
        ...fimDaFila,
        descoberta: { motivo: f.precisaDescoberta, motor: job.motor, erro: f.erro },
        // Sem fotos do elenco o motor para DEPOIS de cortar; sem o anime, antes.
        corteSemIndice: f.precisaDescoberta === 'sem-referencias' ? job.motor : get().corteSemIndice,
      })
    } else if (f.precisaDescoberta) {
      /*
       * As cenas ja estao cortadas: "cortar sem personagens" nao teria o que
       * fazer. O nome do anime fica editavel ao lado do "Reconhecer agora"
       * (ResumoDoEpisodio), entao o recado diz o que fazer -- antes o campo
       * ficava travado e era um beco sem saida.
       */
      set({
        ...fimDaFila,
        erro:
          f.precisaDescoberta === 'anime-nao-encontrado'
            ? `Nao achei "${palpite?.anime.trim() ?? ''}" no AniList/MAL. Corrija o nome (em romaji) e tente de novo.`
            : 'Sem fotos do elenco desse anime, nem no Corte Cenas. Use "Reconhecer na mao": voce da os nomes.',
      })
    } else {
      set({ ...fimDaFila, erro: f.erro || 'A analise parou sem dizer por que.' })
    }
  }

  // Os receptores ficam acessiveis a escuta, que mora fora do create.
  receptores = { receberProgresso, receberFim, receberCorte }

  return {
    aberto: false,
    ...limpo,
    motor: null,
    motorErro: null,
    conferindoMotor: false,
    reconhecer: true,
    job: null,
    corteDeOutro: null,
    ajustesPedidos: false,
    escolha: null,

    abrir: (path) => {
      set({ aberto: true })
      if (path && path !== get().arquivo) void get().carregarArquivo(path)
    },

    abrirAjustesDoStudio: () => {
      set({ ajustesPedidos: true })
      // [recap] Direto na secao do modulo nas Configuracoes (a ancora dela).
      nucleo().abrirConfiguracoes('recap-biblioteca')
    },
    ajustesVistos: () => set({ ajustesPedidos: false }),

    abrirOuEscolher: async () => {
      const { arquivo, job } = get()
      if (arquivo !== null || job !== null) {
        get().abrir()
        return
      }
      if (lendoAPorta || get().escolha) return
      /*
       * Antes, o primeiro clique da sessao reabria sozinho o ultimo rascunho,
       * e quem queria comecar outro episodio caia no recap velho. Agora ele
       * escolhe: "Novo recap" ou um dos ultimos. A lista que falha vale como
       * vazia -- o dialogo de sempre continua sendo um caminho.
       */
      lendoAPorta = true
      let recaps: RecapParaContinuar[] = []
      try {
        const lista = await ponte.listarRascunhos()
        if (lista.ok) recaps = recapsParaContinuar(lista.value)
      } finally {
        lendoAPorta = false
      }
      // Um .mkv solto no botao chegou enquanto a lista vinha: ele ja abriu o assistente.
      if (get().arquivo !== null || get().job !== null) return
      if (recaps.length > 0) {
        set({ escolha: { recaps, abrindo: null, erro: null } })
        return
      }
      await get().escolherArquivo()
    },

    novoRecap: async (path) => {
      if (get().escolha?.abrindo) return
      if (path) {
        set({ escolha: null })
        get().abrir(path)
        return
      }
      const jaAberto = get().aberto
      const escolheu = await get().escolherArquivo()
      // Escolheu, ou o dialogo falhou e o assistente abriu com o erro: a escolha sai.
      if (escolheu || (!jaAberto && get().aberto)) set({ escolha: null })
    },

    continuar: async (episodioId) => {
      const antes = get().escolha
      if (antes?.abrindo) return
      if (antes) set({ escolha: { ...antes, abrindo: episodioId, erro: null, falhou: null } })
      const erro = await restaurar(episodioId)
      const agora = get().escolha
      if (erro === null) {
        if (agora) set({ escolha: null })
        return
      }
      // Nao abriu (o episodio.json sumiu, a biblioteca esta fora): a lista fica, com o porque.
      if (agora) set({ escolha: { ...agora, abrindo: null, erro: recadoDaEscolha(erro), falhou: episodioId } })
      else set({ aberto: true, erro })
    },

    fecharEscolha: () => set({ escolha: null }),

    fechar: () => set({ aberto: false }),

    irParaPasso: (passo) => {
      if (passo !== 1 && !podeIrAoRoteiro(get())) return
      set({ passo })
    },

    tomarRascunhoRestaurado: (episodioId) => {
      const guardado = get().rascunhoRestaurado
      if (!guardado || guardado.rascunho.episodioId !== episodioId) return null
      set({ rascunhoRestaurado: null })
      return guardado
    },

    escolherArquivo: async () => {
      const r = await ponte.escolherEpisodio()
      if (!r.ok) {
        set({ aberto: true, erro: r.error })
        return false
      }
      if (!r.value) return false
      get().abrir(r.value)
      return true
    },

    carregarArquivo: async (path) => {
      if (get().job) {
        set({ erro: 'Tem uma analise rodando. Cancele antes de trocar de episodio.' })
        return
      }
      if (get().exclusoesMudaram) {
        set({ erro: 'Salve ou desfaca as marcacoes de OP/ED antes de trocar de episodio.' })
        return
      }
      if (!ehEpisodio(path)) {
        set({ erro: 'Solte um episodio em video (.mkv, .mp4, .m4v, .webm ou .mov).' })
        return
      }
      const minhaGeracao = ++geracao
      // O corte em segundo plano do episodio anterior NAO para: segue no main.
      guardarCorteQueSegue()
      set({ ...limpo, fase: 'sondando', arquivo: path })
      // O motor e conferido junto: a resposta chega enquanto a sonda roda.
      // Enquanto ele nao estiver pronto, cada arquivo novo pergunta de novo.
      if (!get().motor?.studio.pronto) void conferirMotor()
      const r = await ponte.sondarEpisodio(path)
      if (minhaGeracao !== geracao) return
      if (!r.ok) {
        set({ ...limpo, erro: r.error })
        return
      }
      set({
        fase: 'escolha',
        sonda: r.value,
        palpite: r.value.palpite,
        faixaLegenda: r.value.legendaSugerida,
      })
      await procurar(minhaGeracao)
    },

    recomecar: () => {
      if (get().job) return
      geracao++
      guardarCorteQueSegue()
      set({ ...limpo })
    },

    editarPalpite: (patch) => {
      const atual = get().palpite
      if (!atual) return
      set({ palpite: { ...atual, ...patch } })
    },

    procurarDeNovo: async () => {
      await procurar(geracao)
    },

    escolherFaixa: (index) => set({ faixaLegenda: index }),

    definirReconhecer: (ligado) => set({ reconhecer: ligado }),

    usarAnalise: async (achado) => {
      const { arquivo, faixaLegenda } = get()
      if (!arquivo) return
      /*
       * O palpite passa a ser o da pasta achada. E ele que da nome a pasta do
       * indice no Studio: com o mesmo nome que a biblioteca usa, a Biblioteca
       * e o indice agrupam o episodio no mesmo lugar.
       */
      const palpite: PalpiteDoEpisodio = {
        anime: achado.anime,
        temporada: achado.temporada,
        episodio: achado.episodio,
        kind: achado.kind,
      }
      // As fotos do elenco de um corte do Studio (reserva) aparecem no resumo tambem.
      set({ palpite, descoberta: null, fotosDoElenco: achado.fotosDoElenco ?? null })
      await indexar({
        path: arquivo,
        pastaDoEpisodio: achado.pasta,
        origem: achado.origem,
        palpite,
        faixaLegenda,
      })
    },

    analisar: async (motor, reconhecer) => {
      const { arquivo, palpite, job } = get()
      if (!arquivo || !palpite || job) return
      const anime = palpite.anime.trim()
      if (!anime) {
        set({ erro: 'Falta o nome do anime.' })
        return
      }
      const comPersonagens = reconhecer ?? get().reconhecer
      /*
       * EPISODIO NOVO (a busca nao achou nada, e ainda nao ha indice): as falas
       * saem ja e o corte vai por tras (decisao do Levi, 14/10). "Analisar de
       * novo" sobre um achado e "Reconhecer agora" continuam em primeiro plano:
       * ali as cenas ja existem e o indice ja esta pronto.
       */
      if (get().indice === null && get().busca?.length === 0) {
        await comecarSemEsperar(motor, comPersonagens)
        return
      }
      /*
       * "Reconhecer agora" sobre cenas que o Studio ja cortou: a pasta do anime
       * vai junto e fica onde esta. O nome digitado passa a servir so para
       * achar o elenco -- corrigi-lo nao corta o episodio de novo noutra pasta.
       */
      // Analise em primeiro plano sem o motor (app instalado): instala e volta.
      if (motor === 'studio' && (await pedirMotor(() => void get().analisar(motor, reconhecer)))) return
      const indice = get().indice
      const pastaDoAnime =
        motor === 'studio' && indice?.biblioteca.origem === 'studio' ? pastaDaSerie(indice.biblioteca.pasta) : null
      eventosSemDono = []
      set({
        fase: 'analisando',
        job: { id: null, motor, reconhecer: comPersonagens, inicio: Date.now(), cancelando: false },
        progresso: null,
        etapasVistas: [],
        descoberta: null,
        erro: null,
        recado: null,
      })
      /*
       * A escuta (escutarGerar) ja esta de pe desde que o app abriu: o que o
       * motor mandar antes do id voltar cai em eventosSemDono, e nada se perde.
       */
      const r = await ponte.analisarEpisodio({
        path: arquivo,
        anime,
        temporada: palpite.temporada,
        episodio: palpite.episodio,
        kind: palpite.kind,
        motor,
        reconhecer: comPersonagens,
        ...(pastaDoAnime ? { pastaDoAnime } : {}),
      })
      if (!r.ok) {
        eventosSemDono = []
        // O motor e um so: com um corte em segundo plano rodando, o "ja existe
        // uma analise" do main nao diz qual.
        const cortando = get().corte?.status === 'cortando' || get().corteDeOutro !== null
        const erro =
          cortando && /ja existe uma analise/i.test(r.error)
            ? 'O motor esta cortando as cenas de um episodio. Espere ou cancele o corte.'
            : r.error
        // A mesma regra do receberFim: um "reconhecer agora" sobre um
        // episodio pronto volta para o resumo, que continua valendo.
        set({ fase: get().indice ? 'pronto' : 'escolha', job: null, erro })
        return
      }
      const atual = get().job
      if (!atual) return
      set({ job: { ...atual, id: r.value } })
      // Cancelar clicado antes de o id chegar (o main pode ficar ate 15 s
      // esperando o processo anterior morrer) so foi marcado: manda agora.
      if (atual.cancelando) {
        void ponte.cancelarAnalise(r.value).then((c) => {
          if (c.ok) return
          const j = get().job
          if (j?.id === r.value) set({ job: { ...j, cancelando: false }, erro: c.error })
        })
      }
      const guardados = eventosSemDono
      eventosSemDono = []
      for (const e of guardados) {
        if (e.tipo === 'progresso') receptores.receberProgresso(e.p)
        else receptores.receberFim(e.f)
      }
    },

    cancelar: async () => {
      const job = get().job
      if (!job || job.cancelando) return
      set({ job: { ...job, cancelando: true } })
      if (job.id === null) return
      const r = await ponte.cancelarAnalise(job.id)
      // O fim (cancelado: true) chega por onAnaliseFim; aqui so o pedido falhou.
      if (!r.ok) {
        const atual = get().job
        if (atual) set({ job: { ...atual, cancelando: false }, erro: r.error })
      }
    },

    cortarNoFundo: async (opcoes) => {
      const { indice, palpite, pedindoCorte } = get()
      if (!indice || pedindoCorte || corteDoIndice(indice) === null) return
      const anterior = get().corte
      const motor = opcoes?.motor ?? anterior?.motor ?? 'studio'
      const reconhecer = opcoes?.reconhecer ?? anterior?.reconhecer ?? get().reconhecer
      // App instalado sem o motor: a tela "Instalar motor" abre (uma vez por sessao) e o corte vem quando ficar pronto.
      if (motor === 'studio' && (await pedirMotor(() => void get().cortarNoFundo(opcoes)))) return
      // O nome corrigido na tela (o anime que o AniList nao achou) vai junto.
      const corrigido =
        palpite &&
        palpite.anime.trim() !== '' &&
        (palpite.anime.trim() !== indice.anime ||
          palpite.temporada !== indice.temporada ||
          palpite.episodio !== indice.episodio ||
          palpite.kind !== indice.kind)
          ? { ...palpite, anime: palpite.anime.trim() }
          : undefined
      set({ pedindoCorte: true, recado: null })
      const r = await ponte.iniciarCorte({
        episodioId: indice.id,
        motor,
        reconhecer,
        ...(corrigido ? { palpite: corrigido } : {}),
      })
      if (get().indice?.id !== indice.id) {
        set({ pedindoCorte: false })
        return
      }
      if (r.ok) {
        set({ pedindoCorte: false, corte: maisNovo(get().corte, r.value) })
        return
      }
      // O main nao subiu o motor (motor fora, video sumido, motor ocupado): a
      // tela do corte mostra o porque e o "Tentar de novo".
      const base = get().corte ?? anterior
      set({
        pedindoCorte: false,
        corte: {
          status: 'falhou',
          jobId: null,
          progresso: null,
          etapa: null,
          mensagem: '',
          motor,
          reconhecer,
          erro: r.error,
          inicio: base?.inicio ?? null,
          atualizadoEm: new Date().toISOString(),
          descoberta: null,
        },
      })
    },

    cancelarCorte: async () => {
      const { indice, corte } = get()
      if (!indice || !corte) return
      // A tela troca na hora; o estado de verdade chega pelo evento.
      set({ corte: { ...corte, mensagem: 'Cancelando...' } })
      const r = await ponte.cancelarCorte(indice.id)
      if (!r.ok) set({ erro: r.error })
      else if (!r.value) {
        // Nao havia corte vivo no main (ja tinha acabado): pergunta como ficou.
        const e = await ponte.estadoDoCorte(indice.id)
        if (e.ok && e.value && get().indice?.id === indice.id) set({ corte: e.value })
      }
    },

    reindexar: async () => {
      const { arquivo, palpite, indice, faixaLegenda } = get()
      if (!arquivo || !palpite || !indice) return
      if (get().exclusoesMudaram) {
        set({ erro: 'Salve ou desfaca as marcacoes de OP/ED antes de ler a legenda de novo.' })
        return
      }
      /*
       * Indice que ainda espera as cenas: nao ha pasta de cenas para o
       * indexarEpisodio. A legenda nova sai pelo indexarFalas, e o corte que
       * esta rodando segue (no fim ele cruza as cenas com as cues novas).
       */
      if (corteDoIndice(indice) !== null) {
        const minhaGeracao = geracao
        set({ fase: 'indexando', indexando: 'Lendo a legenda...', erro: null, recado: null })
        const r = await ponte.indexarFalas({ path: arquivo, palpite, faixaLegenda })
        if (minhaGeracao !== geracao) return
        if (!r.ok) {
          set({ fase: 'pronto', indexando: null, erro: r.error })
          return
        }
        set({
          fase: 'pronto',
          indexando: null,
          indice: r.value,
          exclusoes: emOrdem(r.value.exclusoes),
          exclusoesMudaram: false,
          salvoEm: null,
          faixaLegenda: r.value.faixaLegenda?.index ?? null,
          // O andamento ao vivo e o da tela; o do disco so vale se nao havia nenhum.
          corte: corteDoIndice(r.value) === null ? null : (get().corte ?? corteDoIndice(r.value)),
        })
        return
      }
      await indexar({
        path: arquivo,
        pastaDoEpisodio: indice.biblioteca.pasta,
        origem: indice.biblioteca.origem,
        palpite,
        faixaLegenda,
        refazer: true,
      })
    },

    esquecerDescoberta: () => set({ descoberta: null }),

    confirmarExclusao: (i) => {
      const lista = get().exclusoes
      const alvo = lista[i]
      if (!alvo || alvo.confirmada) return
      set({
        exclusoes: lista.map((e, j) => (j === i ? { ...e, confirmada: true } : e)),
        exclusoesMudaram: true,
      })
    },

    confirmarTodas: () => {
      const lista = get().exclusoes
      if (lista.every((e) => e.confirmada)) return
      set({ exclusoes: lista.map((e) => ({ ...e, confirmada: true })), exclusoesMudaram: true })
    },

    removerExclusao: (i) => {
      const lista = get().exclusoes
      if (!lista[i]) return
      set({ exclusoes: lista.filter((_, j) => j !== i), exclusoesMudaram: true })
    },

    ajustarExclusao: (i, patch) => {
      const lista = get().exclusoes
      const alvo = lista[i]
      if (!alvo) return
      const duracao = get().indice?.fonte.duracaoSec ?? 0
      const mexeuNoTempo = patch.start !== undefined || patch.end !== undefined
      /*
       * Mexer no trecho e ter olhado para ele: vira confirmada e passa a ser
       * "do usuario" (o `porque` guarda de onde a sugestao veio). Trocar so o
       * motivo nao muda a origem.
       */
      const novo = normalizarExclusao(
        {
          ...alvo,
          ...patch,
          ...(mexeuNoTempo ? { origem: 'usuario' as const, confirmada: true } : {}),
        },
        duracao,
      )
      set({ exclusoes: lista.map((e, j) => (j === i ? novo : e)), exclusoesMudaram: true })
    },

    marcarTrecho: (start, end) => {
      const duracao = get().indice?.fonte.duracaoSec ?? 0
      const novo = normalizarExclusao(
        { start: Math.min(start, end), end: Math.max(start, end), motivo: 'manual', origem: 'usuario', confirmada: true, porque: '' },
        duracao,
      )
      const lista = [...get().exclusoes, novo]
      set({ exclusoes: lista, exclusoesMudaram: true })
      return lista.length - 1
    },

    descartarMudancas: () => {
      const indice = get().indice
      set({ exclusoes: indice ? emOrdem(indice.exclusoes) : [], exclusoesMudaram: false })
    },

    salvarExclusoes: async () => {
      const { indice, exclusoes, salvando } = get()
      if (!indice || salvando) return
      const duracao = indice.fonte.duracaoSec
      const lista = emOrdem(exclusoes.map((e) => normalizarExclusao(e, duracao)))
      set({ salvando: true, erro: null })
      const r = await ponte.salvarExclusoes(indice.id, lista)
      if (!r.ok) {
        set({ salvando: false, erro: r.error })
        return
      }
      set({
        salvando: false,
        indice: r.value,
        exclusoes: emOrdem(r.value.exclusoes),
        exclusoesMudaram: false,
        salvoEm: Date.now(),
      })
    },

    verNaBiblioteca: async () => {
      // As cenas ainda estao sendo cortadas (indice so com as falas): nao ha o que mostrar.
      const semCenas = get().indice
      if (semCenas && !temPlanos(semCenas)) {
        const cortando = get().corte?.status === 'cortando'
        set({ recado: cortando ? 'As cenas ainda estao sendo cortadas.' : 'As cenas ainda nao foram cortadas.' })
        return
      }
      // Episodio recem-cortado: espera a releitura, ou o "ir ate o clipe" nao o acharia.
      if (sincronizando) await sincronizando
      const primeiro = get().indice?.planos[0]?.arquivo
      /*
       * A Biblioteca do editor so le a pasta dela e a do Studio. Um episodio
       * de fora (o Corte Cenas, sem a Biblioteca do AnCut apontada para la)
       * nao esta nela, e abrir assim caia em silencio no episodio do filtro
       * anterior. A tela ja esconde o botao nesse caso; isto e a rede -- e
       * ela le a Biblioteca antes de decidir, se ainda nao foi lida na sessao
       * (sem isso a rede pulava e abria no "Todos").
       */
      if (primeiro && nucleo().ler().library === null) await nucleo().sincronizarBiblioteca()
      const projeto = nucleo()
      const lida = projeto.ler().library
      if (primeiro && lida && !lida.clips.some((c) => c.path === primeiro)) {
        set({ recado: 'Esse episodio nao esta na Biblioteca do editor. Use Abrir pasta.' })
        return
      }
      // A Biblioteca abre POR CIMA do assistente; fechar ela volta para ca.
      if (primeiro) await projeto.mostrarNaBiblioteca(primeiro)
      else await projeto.abrirBiblioteca()
    },

    limparErro: () => set({ erro: null }),
    limparRecado: () => set({ recado: null }),
    conferirMotor,
  }
})

/**
 * Liga a escuta do motor e da indexacao. Devolve a funcao que desliga.
 *
 * Fica de pe enquanto o assistente estiver montado -- e ele monta junto com o
 * app, aberto ou nao --, entao ja esta ouvindo antes de qualquer
 * analisarEpisodio e continua ouvindo com a tela fechada.
 */
export function escutarGerar(): () => void {
  const tirarProgresso = ponte.onAnaliseProgresso((p) => receptores.receberProgresso(p))
  const tirarFim = ponte.onAnaliseFim((f) => receptores.receberFim(f))
  // O corte em segundo plano: andamento, fila e as cenas chegando (com a tela fechada tambem).
  const tirarCorte = ponte.onCorteProgresso((e) => receptores.receberCorte(e))
  // O runtime do motor mudou de fase (instalou, removeu: app instalado): a linha do motor sonda de novo.
  const tirarMotorPronto = quandoAFaseMudar(() => void useGerar.getState().conferirMotor())
  const tirarIndexar = ponte.onIndexarProgresso((mensagem) => {
    // So substitui um andamento que existe: a ultima mensagem pode chegar
    // depois de a indexacao ter acabado e ressuscitaria o "lendo".
    if (useGerar.getState().indexando !== null) useGerar.setState({ indexando: mensagem })
  })
  return () => {
    tirarProgresso()
    tirarFim()
    tirarCorte()
    tirarIndexar()
    tirarMotorPronto()
  }
}
