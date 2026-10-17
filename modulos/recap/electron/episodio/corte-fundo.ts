import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { app } from 'electron'
import {
  anexarPlanos,
  episodeIndexSchema,
  ROTULO_DA_ETAPA,
  statusDoCorte,
  temPlanos,
  type EpisodeIndex,
  type EstadoDoCorte,
  type EtapaDaAnalise,
  type EventoDoCorte,
  type FimDaAnalise,
  type PalpiteDoEpisodio,
  type PedidoDeAnalise,
  type PedidoDeCorte,
} from '../../shared/episodio'
import { haDescobertaViva, motorComADescoberta } from '../descoberta/vivas'
import { analisarEpisodio, cancelarAnalise, type OuvintesDaAnalise } from '../motor'
import { estadoPendente } from './falas'
import {
  acharIndice,
  avisosDeTempo,
  caminhoDoIndice,
  guardarAnterior,
  lerIndiceDoDisco,
  mesmoCaminho,
  montarPlanos,
  reconhecimentoDaPasta,
} from './indice'
import { lerPastaDoEpisodio } from './pasta-do-episodio'
import { gravarJsonAtomico, lembrarIndice } from './perfil'
import { garantirGravavel } from './protegidas'
import { abrirIndicePorId } from './abrir-indice'
import { garantirVisao } from '../cenas/visao'
import { configDoRecap } from '../contexto'

export { indexarFalas } from './falas'

/**
 * O CORTE EM SEGUNDO PLANO (decisao do Levi, 14/10), no main.
 *
 * O passo 1 nao espera o motor: o indice nasce so com as falas (falas.ts) e o
 * corte + reconhecimento roda por tras, com o motor.ts de sempre
 * (analisarEpisodio, a mesma vaga de um job por vez) e ouvintes PROPRIOS -- o
 * andamento vai pelo corteProgresso (EventoDoCorte), nunca pelo
 * analiseProgresso/analiseFim do passo 1 em primeiro plano, que a tela trataria
 * como a analise dela.
 *
 * No fim: lerPastaDoEpisodio + montarPlanos com as cues DESTE indice (lido de
 * novo do disco na hora: a regua pode ter sido salva no meio) -> anexarPlanos
 * -> grava em <pasta do episodio>/episodio.json (motor do Studio) ou no proprio
 * _indices (AnCut) -> renomeia o de _indices (nunca apaga) -> lembrarIndice ->
 * evento com o indice novo. A legenda nao e lida de novo e a sugestao de OP/ED
 * nao e refeita: o roteiro ja cita essas cues, e a regua mexida fica.
 *
 * FILA: o motor ocupa a GPU inteira. Um segundo corte (outro episodio) espera
 * o primeiro ('pendente', "Na fila") e sobe sozinho quando ele termina. Uma
 * analise em primeiro plano rodando (o "Analisar de novo") nao entra na fila:
 * o pedido volta com erro, e a tela oferece tentar de novo.
 *
 * GRAVACAO: o estado so vai para o disco nas TROCAS de status (comecou,
 * pronto, parou, falhou); o andamento fica na memoria e no evento. Sempre
 * ler + aplicar + gravar sem await no meio, como o rascunho.ts.
 */

// ------------------------------------------------------------------ o motor

/** O que o corte usa do motor. Trocavel so no teste (scripts/teste/v-corte-fundo.ts). */
export interface MotorDoCorte {
  analisar(pedido: PedidoDeAnalise, ouvintes: OuvintesDaAnalise): Promise<string>
  cancelar(jobId: string): Promise<void>
}

const MOTOR_DE_VERDADE: MotorDoCorte = { analisar: analisarEpisodio, cancelar: cancelarAnalise }
let motor: MotorDoCorte = MOTOR_DE_VERDADE

/** So para o teste: um motor falso. null volta ao de verdade. */
export function trocarMotorDoCorte(falso: MotorDoCorte | null): void {
  motor = falso ?? MOTOR_DE_VERDADE
}

// --------------------------------------------------------------- andamento

/**
 * Quanto do corte inteiro cada etapa ocupa, pela ordem em que o motor anda.
 * Com personagens o motor busca o elenco ANTES de cortar (a identidade do anime
 * decide a pasta) e volta a ele para as fotos de referencia depois; as fatias
 * sairam do log real (S04E24: deteccao e corte ~2/3 do tempo sem elenco novo;
 * analise + segunda passada ~70 s).
 */
const FATIAS_COM: Record<EtapaDaAnalise | 'elenco-depois', [number, number]> = {
  preparando: [0, 0.02],
  elenco: [0.02, 0.06],
  detectando: [0.06, 0.3],
  cortando: [0.3, 0.58],
  'elenco-depois': [0.58, 0.64],
  personagens: [0.64, 0.96],
  organizando: [0.96, 1],
}
const FATIAS_SEM: Record<EtapaDaAnalise | 'elenco-depois', [number, number]> = {
  preparando: [0, 0.02],
  elenco: [0.02, 0.02],
  detectando: [0.02, 0.4],
  cortando: [0.4, 0.95],
  'elenco-depois': [0.95, 0.95],
  personagens: [0.95, 0.95],
  organizando: [0.95, 1],
}

/**
 * O andamento do corte INTEIRO (0..1) pela etapa e pela fracao dentro dela.
 * `jaCortou`: o motor ja passou por detectar/cortar -- o 'elenco' daqui em
 * diante e o das fotos de referencia, nao o da busca do anime. null na fracao
 * = o comeco da etapa. Puro, para o teste.
 */
export function progressoDoCorte(
  etapa: EtapaDaAnalise,
  fracao: number | null,
  reconhecer: boolean,
  jaCortou: boolean,
): number {
  const fatias = reconhecer ? FATIAS_COM : FATIAS_SEM
  const chave = etapa === 'elenco' && jaCortou ? 'elenco-depois' : etapa
  const [de, ate] = fatias[chave]
  const f = fracao === null || !Number.isFinite(fracao) ? 0 : Math.min(1, Math.max(0, fracao))
  return Math.round((de + (ate - de) * f) * 1000) / 1000
}

/** O evento de andamento sai no maximo a cada tanto (o motor manda um por cena). */
const INTERVALO_DO_EVENTO_MS = 250
/** Uma analise em primeiro plano ocupa o motor: a fila tenta de novo depois disto. */
const ESPERA_DO_MOTOR_OCUPADO_MS = 5000

// ---------------------------------------------------------- cortes vivos

interface Corte {
  episodioId: string
  pedido: PedidoDeCorte
  estado: EstadoDoCorte
  /** O motor ja passou por detectar/cortar (ver progressoDoCorte). */
  jaCortou: boolean
  /** Date.now() do ultimo evento de andamento enviado. */
  ultimoEnvio: number
  /** Cancelar pedido antes de o jobId voltar: manda assim que ele chegar. */
  cancelarAoSubir: boolean
}

/** Os cortes vivos: o que esta rodando e os da fila. Saem daqui ao terminar. */
const vivos = new Map<string, Corte>()
/** A ordem da fila (episodioIds esperando a vaga). */
const fila: string[] = []
/** O corte com a vaga do motor agora (subindo ou rodando). */
let rodando: string | null = null
let relogioDaFila: NodeJS.Timeout | null = null
/** Para quem vai o evento. O ipc.ts passa o mesmo enviarATodas em toda chamada. */
let avisarATodas: (evento: EventoDoCorte) => void = () => {}

/**
 * O app esta fechando. O before-quit do main.ts mata o motor (encerrarMotor), e
 * o fim que o motor.ts entrega depois disso ("parou sem terminar") nao e uma
 * falha do corte: o disco fica com o 'cortando', que o estadoLido le como
 * 'pendente', e o "voltar onde parou" recomeca sozinho.
 */
let saindo = false
let ouvindoSaida = false

function ouvirSaida(): void {
  if (ouvindoSaida) return
  ouvindoSaida = true
  try {
    // Fora do Electron (o teste em node) nao ha `app`: nada a ouvir.
    app?.on?.('before-quit', () => {
      saindo = true
    })
  } catch {
    /* sem app: teste */
  }
}

function agora(): string {
  return new Date().toISOString()
}

function enviar(episodioId: string, estado: EstadoDoCorte, indice: EpisodeIndex | null = null, fotos?: string | null): void {
  try {
    avisarATodas({ episodioId, estado, indice, ...(fotos !== undefined ? { fotosDoElenco: fotos } : {}) })
  } catch (e) {
    console.error('[corte] aviso falhou:', e)
  }
}

/** O estado de um indice que nasceu antes do corte em segundo plano: pronto. */
function estadoPronto(indice: EpisodeIndex): EstadoDoCorte {
  return {
    status: 'pronto',
    jobId: null,
    progresso: 1,
    etapa: null,
    mensagem: '',
    motor: indice.biblioteca.origem === 'ancut' ? 'ancut' : 'studio',
    reconhecer: indice.reconhecimento === 'feito',
    erro: null,
    inicio: null,
    atualizadoEm: indice.atualizadoEm,
    descoberta: null,
  }
}

/** O indice do episodio, lido agora. null = sumiu ou quebrou. */
function lerAgora(episodioId: string): { indice: EpisodeIndex; caminho: string } | null {
  const caminho = acharIndice(episodioId)
  if (!caminho) return null
  const indice = lerIndiceDoDisco(caminho)
  return indice ? { indice, caminho } : null
}

/**
 * Grava o estado do corte (e o nome corrigido, quando veio) no indice que
 * ainda espera as cenas. Indice que ja tem as cenas nao e tocado: um "parou"
 * atrasado nao pode desfazer um pronto. Sem await: le, aplica, grava.
 */
function gravarEstado(episodioId: string, estado: EstadoDoCorte, palpite?: PalpiteDoEpisodio): void {
  const lido = lerAgora(episodioId)
  if (!lido || (temPlanos(lido.indice) && statusDoCorte(lido.indice) === 'pronto')) return
  try {
    garantirGravavel(dirname(lido.caminho))
    const nome = palpite
      ? {
          anime: palpite.anime.trim() || lido.indice.anime,
          temporada: palpite.temporada,
          episodio: palpite.episodio,
          kind: palpite.kind,
        }
      : {}
    gravarJsonAtomico(lido.caminho, episodeIndexSchema.parse({ ...lido.indice, ...nome, corte: estado }))
  } catch (e) {
    // O andamento continua valendo na memoria e no evento; o disco so serve
    // para o "voltar onde parou".
    console.error('[corte] nao deu para gravar o estado:', e)
  }
}

function atualizar(corte: Corte, patch: Partial<EstadoDoCorte>): EstadoDoCorte {
  corte.estado = { ...corte.estado, ...patch, atualizadoEm: agora() }
  return corte.estado
}

// ------------------------------------------------------------------ o fim

/**
 * As cenas que o motor gravou viram os planos do indice. Le o indice de novo
 * AGORA (a regua pode ter sido salva durante o corte), cruza com as cues dele e
 * grava no lugar de quem tem cenas. Lanca com a frase para a tela.
 */
function anexar(episodioId: string, fim: Extract<FimDaAnalise, { ok: true }>): EpisodeIndex {
  const dados = lerPastaDoEpisodio(fim.pastaDoEpisodio)
  if (!dados || dados.cenas.length === 0) {
    throw new Error('O motor terminou, mas a pasta nao tem cenas legiveis.')
  }
  const origem = fim.motor === 'studio' ? 'studio' : 'ancut'
  // Daqui ate gravar, sem await.
  const lido = lerAgora(episodioId)
  if (!lido) throw new Error('Os dados desse episodio sumiram durante o corte. Abra o episodio de novo.')
  const atual = lido.indice
  const planos = montarPlanos(dados, atual.cues)
  const novo = anexarPlanos(
    atual,
    {
      planos,
      biblioteca: { origem, pasta: fim.pastaDoEpisodio },
      reconhecimento: reconhecimentoDaPasta(dados, planos),
      avisos: avisosDeTempo(atual.fonte, dados, atual.fonte.path, false),
    },
    agora(),
  )
  const destino = caminhoDoIndice(origem, fim.pastaDoEpisodio, episodioId)
  if (origem === 'studio') garantirGravavel(fim.pastaDoEpisodio)
  garantirGravavel(dirname(destino))
  // Um indice antigo no destino (episodio cortado de novo) fica ao lado, com
  // carimbo; o de _indices tambem, quando o destino e outro. Nada e apagado.
  guardarAnterior(destino, existsSync(destino) ? lerIndiceDoDisco(destino) : null)
  gravarJsonAtomico(destino, novo)
  if (!mesmoCaminho(lido.caminho, destino) && existsSync(lido.caminho)) guardarAnterior(lido.caminho, atual)
  lembrarIndice(episodioId, destino)
  return novo
}

function terminar(corte: Corte, fim: FimDaAnalise): void {
  const id = corte.episodioId
  vivos.delete(id)
  if (rodando === id) rodando = null
  // O app fechou no meio: nada de 'falhou' no disco (ver `saindo`).
  if (saindo && !fim.ok) return

  if (fim.ok) {
    try {
      const novo = anexar(id, fim)
      enviar(id, novo.corte!, novo, fim.fotosDoElenco)
      if (motor === MOTOR_DE_VERDADE) complementar(id)
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e)
      const estado = atualizar(corte, { status: 'falhou', jobId: null, etapa: null, mensagem: '', erro })
      gravarEstado(id, estado)
      enviar(id, estado)
    }
  } else if (fim.cancelado) {
    // Cancelar nao e falha: volta a 'pendente', sem vermelho.
    const estado = atualizar(corte, { status: 'pendente', jobId: null, progresso: null, etapa: null, mensagem: 'Cancelado', erro: null })
    gravarEstado(id, estado)
    enviar(id, estado)
  } else {
    const estado = atualizar(corte, {
      status: 'falhou',
      jobId: null,
      etapa: null,
      mensagem: '',
      erro: fim.erro || 'O corte parou sem dizer por que.',
      descoberta: fim.precisaDescoberta,
    })
    gravarEstado(id, estado)
    enviar(id, estado)
  }
  // O proximo da fila. O motor ainda segura a vaga ate o processo sair
  // (analisarEpisodio espera ate 15 s por isso).
  setImmediate(() => void proximo())
}

/** Espera entre olhar de novo se a vaga do motor ja esta livre para complementar. */
const COMPLEMENTO_ESPERA_MS = 15_000

/**
 * [lote 2] Depois do corte, em segundo plano, o que se ve das cenas (CLIP,
 * beleza, sentido das falas, etiquetas: cenas/visao.ts), para o passo 4 nao
 * esperar. So com a fila de cortes vazia (a GPU e de quem corta). Falhou:
 * o passo 4 tenta de novo, ou segue com as regras.
 */
function complementar(episodioId: string): void {
  let quer: { motor: boolean; etiquetas: boolean }
  try {
    const c = configDoRecap().cenas
    quer = { motor: c.visao, etiquetas: c.etiquetas }
  } catch {
    return
  }
  if (!quer.motor && !quer.etiquetas) return
  const tentar = (): void => {
    if (saindo) return
    if (rodando !== null || fila.length > 0) {
      setTimeout(tentar, COMPLEMENTO_ESPERA_MS)
      return
    }
    try {
      const { indice, caminho } = abrirIndicePorId(episodioId)
      const t0 = Date.now()
      void garantirVisao(indice, caminho, quer).then((e) =>
        console.log(`[corte] visao de ${episodioId}: ${e.pronta ? 'pronta' : 'incompleta'} em ${Date.now() - t0} ms${e.motivo ? ` (${e.motivo})` : ''}`),
      )
    } catch (e) {
      console.warn(`[corte] visao de ${episodioId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  setTimeout(tentar, 2000)
}

function ouvintes(corte: Corte): OuvintesDaAnalise {
  let acabou = false
  return {
    progresso: (p) => {
      if (acabou || vivos.get(corte.episodioId) !== corte) return
      if (p.etapa === 'detectando' || p.etapa === 'cortando') corte.jaCortou = true
      const trocouDeEtapa = corte.estado.etapa !== p.etapa
      const progresso = Math.max(
        corte.estado.progresso ?? 0,
        progressoDoCorte(p.etapa, p.fracao, corte.estado.reconhecer, corte.jaCortou),
      )
      // "Cancelando..." fica ate o fim chegar: a frase do motor por cima dela
      // diria que nada aconteceu.
      const mensagem = corte.estado.mensagem === 'Cancelando...' ? corte.estado.mensagem : p.mensagem || `${ROTULO_DA_ETAPA[p.etapa]}...`
      const estado = atualizar(corte, { etapa: p.etapa, progresso, mensagem })
      const t = Date.now()
      if (trocouDeEtapa || t - corte.ultimoEnvio >= INTERVALO_DO_EVENTO_MS) {
        corte.ultimoEnvio = t
        enviar(corte.episodioId, estado)
      }
    },
    fim: (f) => {
      if (acabou) return
      acabou = true
      terminar(corte, f)
    },
  }
}

// ------------------------------------------------------------- comecar

/** Erro do motor que quer dizer "a vaga esta ocupada" (analisarEpisodio). */
function motorOcupado(e: unknown): boolean {
  return e instanceof Error && /ja existe uma analise rodando/i.test(e.message)
}

/**
 * Sobe o motor para este corte. Reserva a vaga ANTES do primeiro await: um
 * segundo pedido no mesmo instante cai na fila em vez de bater no motor.
 * Lanca com a frase do motor ("O motor de personagens nao esta instalado...").
 */
async function comecar(corte: Corte): Promise<void> {
  const id = corte.episodioId
  rodando = id
  const lido = lerAgora(id)
  if (!lido) {
    rodando = null
    vivos.delete(id)
    throw new Error('Nao achei os dados desse episodio. Abra o episodio de novo no passo 1.')
  }
  const { indice } = lido
  const palpite = corte.pedido.palpite ?? {
    anime: indice.anime,
    temporada: indice.temporada,
    episodio: indice.episodio,
    kind: indice.kind,
  }
  let jobId: string
  try {
    jobId = await motor.analisar(
      {
        path: indice.fonte.path,
        anime: palpite.anime.trim() || indice.anime,
        temporada: palpite.temporada,
        episodio: palpite.episodio,
        kind: palpite.kind,
        motor: corte.pedido.motor,
        reconhecer: corte.pedido.reconhecer,
      },
      ouvintes(corte),
    )
  } catch (e) {
    if (rodando === id) rodando = null
    vivos.delete(id)
    throw motorOcupado(e)
      ? new Error('O motor esta ocupado com outra analise. Tente de novo quando ela acabar.')
      : e
  }
  // O fim pode ter chegado antes daqui (motor falso, ou um erro de subida).
  if (vivos.get(id) !== corte) return
  const estado = atualizar(corte, {
    status: 'cortando',
    jobId,
    progresso: corte.estado.progresso ?? 0,
    etapa: corte.estado.etapa ?? 'preparando',
    mensagem: corte.estado.mensagem && corte.estado.mensagem !== 'Na fila' ? corte.estado.mensagem : 'Preparando...',
    erro: null,
    descoberta: null,
    inicio: agora(),
  })
  gravarEstado(id, estado, corte.pedido.palpite)
  enviar(id, estado)
  if (corte.cancelarAoSubir) {
    corte.cancelarAoSubir = false
    atualizar(corte, { mensagem: 'Cancelando...' })
    void motor.cancelar(jobId)
  }
}

/** O proximo da fila, se a vaga estiver livre. Falhar em subir um nao trava os outros. */
async function proximo(): Promise<void> {
  if (relogioDaFila) {
    clearTimeout(relogioDaFila)
    relogioDaFila = null
  }
  while (rodando === null && fila.length > 0) {
    const id = fila.shift()!
    const corte = vivos.get(id)
    if (!corte) continue
    try {
      await comecar(corte)
    } catch (e) {
      if (motorOcupado(e) || (e instanceof Error && /motor esta ocupado/i.test(e.message))) {
        // Analise em primeiro plano com a vaga: volta para a frente da fila e
        // tenta de novo daqui a pouco.
        vivos.set(id, corte)
        fila.unshift(id)
        atualizar(corte, { mensagem: 'Esperando o motor' })
        enviar(id, corte.estado)
        relogioDaFila = setTimeout(() => void proximo(), ESPERA_DO_MOTOR_OCUPADO_MS)
        return
      }
      const erro = e instanceof Error ? e.message : String(e)
      const estado = atualizar(corte, { status: 'falhou', jobId: null, etapa: null, mensagem: '', erro })
      gravarEstado(id, estado)
      enviar(id, estado)
    }
  }
}

// ------------------------------------------------------------------- api

/**
 * Comeca (ou poe na fila) o corte do episodio e devolve o estado na hora.
 * - ja cortando ou na fila: devolve o estado vivo (o segundo clique nao sobe
 *   outro motor);
 * - indice que ja tem as cenas: devolve 'pronto', nada a fazer;
 * - vaga livre: sobe o motor agora; erro de subida (motor fora, video sumido,
 *   analise em primeiro plano) volta como erro;
 * - outro corte rodando: 'pendente', "Na fila".
 */
export async function iniciarCorte(pedido: PedidoDeCorte, avisar: (evento: EventoDoCorte) => void): Promise<EstadoDoCorte> {
  avisarATodas = avisar
  ouvirSaida()
  const id = pedido.episodioId
  const vivo = vivos.get(id)
  if (vivo) return vivo.estado

  const lido = lerAgora(id)
  if (!lido) throw new Error('Nao achei os dados desse episodio. Abra o episodio de novo no passo 1.')
  if (temPlanos(lido.indice) && statusDoCorte(lido.indice) === 'pronto') return lido.indice.corte ?? estadoPronto(lido.indice)
  if (!existsSync(lido.indice.fonte.path)) throw new Error('O video desse episodio nao esta mais no disco.')
  // Reconhecer na mao (descoberta/) vivo neste episodio: um corte agora
  // regravaria o shots.json por baixo dos nomes que ele vai salvar.
  if (haDescobertaViva(id)) throw new Error('Esse episodio esta no Reconhecer na mao. Termine ou cancele antes de cortar.')

  const corte: Corte = {
    episodioId: id,
    pedido,
    estado: { ...estadoPendente(agora(), pedido.motor, pedido.reconhecer), mensagem: 'Na fila' },
    jaCortou: false,
    ultimoEnvio: 0,
    cancelarAoSubir: false,
  }
  vivos.set(id, corte)
  if (rodando !== null) {
    fila.push(id)
    enviar(id, corte.estado)
    return corte.estado
  }
  // A descoberta de OUTRO episodio segura a vaga do motor esperando os nomes:
  // este corte espera na fila (o proximo() tenta de 5 em 5 s) em vez de voltar erro.
  if (motorComADescoberta()) {
    fila.push(id)
    atualizar(corte, { mensagem: 'Esperando o motor' })
    enviar(id, corte.estado)
    relogioDaFila ??= setTimeout(() => void proximo(), ESPERA_DO_MOTOR_OCUPADO_MS)
    return corte.estado
  }
  await comecar(corte)
  return corte.estado
}

/**
 * O estado do corte do episodio: o vivo (rodando ou na fila) ou o que o
 * indice diz. Um 'cortando' gravado sem job vivo (o app fechou no meio) vale
 * como 'pendente'. null = sem indice.
 */
export async function estadoDoCorte(episodioId: string): Promise<EstadoDoCorte | null> {
  const vivo = vivos.get(episodioId)
  if (vivo) return vivo.estado
  const lido = lerAgora(episodioId)
  return lido ? estadoLido(lido.indice) : null
}

/** O estado gravado num indice, sem job vivo no main. Puro, para o teste. */
export function estadoLido(indice: EpisodeIndex): EstadoDoCorte {
  const corte = indice.corte
  if (!corte) return temPlanos(indice) ? estadoPronto(indice) : estadoPendente(indice.atualizadoEm)
  if (corte.status === 'cortando') {
    return { ...corte, status: 'pendente', jobId: null, progresso: null, etapa: null, mensagem: '' }
  }
  return corte
}

/**
 * Para o corte. Rodando: pede ao motor, e o fim (cancelado) volta o status a
 * 'pendente' pelo evento. Na fila: sai da fila na hora. false = nao havia corte
 * vivo deste episodio.
 */
export async function cancelarCorte(episodioId: string): Promise<boolean> {
  const corte = vivos.get(episodioId)
  if (!corte) return false
  const i = fila.indexOf(episodioId)
  if (i >= 0) {
    fila.splice(i, 1)
    vivos.delete(episodioId)
    const estado = atualizar(corte, { status: 'pendente', mensagem: 'Cancelado' })
    enviar(episodioId, estado)
    return true
  }
  const estado = atualizar(corte, { mensagem: 'Cancelando...' })
  enviar(episodioId, estado)
  if (corte.estado.jobId) await motor.cancelar(corte.estado.jobId)
  else corte.cancelarAoSubir = true
  return true
}
