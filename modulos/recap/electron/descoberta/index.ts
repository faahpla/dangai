import { basename, dirname, join } from 'node:path'
import {
  CENAS_MINIMAS_POR_PERSONAGEM,
  descobertaProntaSchema,
  descobertaViva,
  discoveryReadyDoMotorSchema,
  ESPERA_MAXIMA_DOS_NOMES_MS,
  MUDO_PARA_PARAR_MS,
  nomesDescartados,
  paraOMotor,
  podeReconhecerNaMao,
  PRAZO_DO_SALVAR_MS,
  progressoDaDescoberta,
  resumoDaDecisao,
  sugestoesDoMotor,
  type DecisaoDaDescoberta,
  type DescobertaPronta,
  type EstadoDaDescoberta,
  type EventoDaDescoberta,
  type MotivoDaDescoberta,
  type PedidoDaDescoberta,
  type ResultadoDaDescoberta,
} from '../../shared/descoberta'
import {
  ROTULO_DA_ETAPA,
  slugDoEpisodio,
  temPlanos,
  type EventoDoCorte,
  type FimDaAnalise,
  type ProgressoDaAnalise,
} from '../../shared/episodio'
import { abrirIndicePorId } from '../episodio/abrir-indice'
import { estadoDoCorte } from '../episodio/corte-fundo'
import { mesmoCaminho } from '../episodio/indice'
import { ascii } from '../frase-do-motor'
import { analisarEpisodio, cancelarAnalise, comandarDescoberta, pastaDeDadosDoMotor, type OuvintesDaAnalise } from '../motor'
import { pastaDaBibliotecaStudio } from '../settings'
import { aplicarNoIndice, personagensDoIndice } from './aplicar'
import { erroNaTela } from './erro'
import { limparCopiasVelhas, montarPronta } from './recortes'
import { marcarViva } from './vivas'

export { haDescobertaViva } from './vivas'

/**
 * RECONHECER NA MAO no main (o Modo Descoberta do motor). Contrato, protocolo
 * do Python e regras em shared/descoberta.ts.
 *
 *   iniciarDescoberta -> analisarEpisodio(..., { descoberta: true }) -> o motor
 *   corta (reaproveita o corte do disco), acha os rostos e agrupa ->
 *   discovery-ready -> recortes copiados e publicados + elenco ('pronta') ->
 *   o processo ESPERA, vivo -> confirmarDescoberta (paraOMotor) ->
 *   comandarDescoberta -> commit no motor ('salvando') -> done ->
 *   aplicarNoIndice -> corteProgresso 'pronto' com o indice novo + 'feita'.
 *
 * UMA descoberta por vez: ela usa a mesma vaga do motor (motor.ts, `atual`)
 * que o corte e a analise, e segura essa vaga enquanto espera os nomes. Motor
 * ocupado = erro na hora (sem fila). O corte de OUTRO episodio que chegar
 * enquanto ela espera vai para a fila do corte-fundo ("Esperando o motor").
 *
 * Sem decisao em ESPERA_MAXIMA_DOS_NOMES_MS o processo e cancelado (falhou,
 * "os grupos expiraram"). No 'salvando', PRAZO_DO_SALVAR_MS sem nenhum sinal
 * do motor tambem mata (antes, um motor travado deixava a tela em "Salvando..."
 * para sempre segurando a vaga), e mudo ha MUDO_PARA_PARAR_MS o "Parar" da tela
 * vale. O app fechando mata o processo (encerrarMotor, no
 * before-quit), e o Python tambem se cancela sozinho quando o pipe do host
 * fecha: nada fica orfao segurando a GPU.
 *
 * O que o commit grava no MOTOR DO STUDIO (nunca no do Corte Cenas):
 * <dados>/cache/anime_db/<titulo> [al<id>]/characters/<nome>/auto_disc_NN.jpg
 * (ate 10 por nome) e o centroide no <dados>/cache/index.db. No proximo
 * episodio do mesmo anime, o `run` normal soma essas fotos as do catalogo
 * (ReferenceStore.ensure_references le os arquivos locais) e o personagem
 * passa do minimo de 2 fotos: o reconhecimento automatico funciona sozinho.
 */

/** Para quem vao os eventos. O ipc.ts passa os dois enviarATodas em toda chamada. */
export interface AvisosDaDescoberta {
  /** canal descobertaProgresso: o andamento, os grupos ('pronta') e o fim. */
  descoberta(evento: EventoDaDescoberta): void
  /**
   * canal corteProgresso: no 'feita', o indice novo com estado 'pronto' -- o
   * mesmo evento do fim de um corte, que as stores do passo 1, 2 e 4 ja
   * ouvem para trocar o indice.
   */
  corte(evento: EventoDoCorte): void
}

/** O evento de andamento sai no maximo a cada tanto (o motor manda um por cena). */
const INTERVALO_DO_EVENTO_MS = 250
/** No 'salvando' a mesma frase sai de novo a cada tanto: a tela sabe que o motor esta vivo (o "Parar"). */
const INTERVALO_DO_SALVANDO_MS = 5000

let esperaDosNomesMs = ESPERA_MAXIMA_DOS_NOMES_MS
let prazoDoSalvarMs = PRAZO_DO_SALVAR_MS
let mudoParaPararMs = MUDO_PARA_PARAR_MS

/** So para o teste (scripts/teste/v-descoberta-motor.ts): um prazo curto. null volta ao de verdade. */
export function trocarEsperaDosNomes(ms: number | null): void {
  esperaDosNomesMs = ms ?? ESPERA_MAXIMA_DOS_NOMES_MS
}

/** So para o teste: os prazos do 'salvando' (o relogio e o "Parar"). null volta ao de verdade. */
export function trocarPrazosDoSalvar(prazo: number | null, mudo: number | null = null): void {
  prazoDoSalvarMs = prazo ?? PRAZO_DO_SALVAR_MS
  mudoParaPararMs = mudo ?? MUDO_PARA_PARAR_MS
}

interface Confirmacao {
  resolver: (r: ResultadoDaDescoberta) => void
  rejeitar: (e: Error) => void
  /** Os nomes que foram ao motor (sem repetir), para achar os descartados. */
  nomes: string[]
  /** Fotos que viram referencia (resumoDaDecisao): o que o commit grava. */
  refs: number
}

interface Sessao {
  episodioId: string
  jobId: string | null
  estado: EstadoDaDescoberta
  pronta: DescobertaPronta | null
  resultado: ResultadoDaDescoberta | null
  avisar: AvisosDaDescoberta
  /** Com cenas no disco: a pasta em que o motor TEM que abrir o episodio. */
  pastaEsperada: string | null
  inicio: number
  ultimoEnvio: number
  /** Date.now() do ultimo evento do motor (qualquer um): o "Parar" do salvando olha isto. */
  ultimoSinal: number
  /** O relogio da espera dos nomes (no 'pronta') ou do salvar (no 'salvando'). */
  relogio: NodeJS.Timeout | null
  /** O fim do motor vai chegar como cancelado, mas a tela deve ver este erro. */
  erroForcado: string | null
  /**
   * Cancelada (ou abortada) e o processo ainda saindo -- ate 10 s, o relogio do
   * cancelarAnalise. Um iniciar nesse meio tempo espera ela acabar em vez de
   * devolver a rodada que esta morrendo (o "cancelada" dela fecharia a tela nova).
   */
  encerrando: boolean
  confirmacao: Confirmacao | null
  /** O `refsDir` do done. */
  refsDir: string | null
}

/** A descoberta da vez (viva) ou a ultima (terminada). Uma so. */
let sessao: Sessao | null = null

function agora(): string {
  return new Date().toISOString()
}

function evento(s: Sessao, comPronta = s.estado.status === 'pronta'): EventoDaDescoberta {
  return {
    episodioId: s.episodioId,
    estado: s.estado,
    pronta: comPronta ? s.pronta : null,
    resultado: s.estado.status === 'feita' ? s.resultado : null,
  }
}

function enviar(s: Sessao): void {
  s.ultimoEnvio = Date.now()
  try {
    s.avisar.descoberta(evento(s))
  } catch (e) {
    console.error('[descoberta] aviso falhou:', e)
  }
}

function atualizar(s: Sessao, patch: Partial<EstadoDaDescoberta>): EstadoDaDescoberta {
  s.estado = { ...s.estado, ...patch, atualizadoEm: agora() }
  marcarViva(descobertaViva(s.estado) ? s.episodioId : null)
  return s.estado
}

function pararRelogio(s: Sessao): void {
  if (s.relogio) clearTimeout(s.relogio)
  s.relogio = null
}

/**
 * O relogio do 'salvando': rearmado a cada sinal do motor. Estourou sem sinal
 * nenhum, o motor travou: mata o processo e libera a vaga (o indice so muda no
 * `done`, entao fica como estava).
 */
function armarRelogioDoSalvar(s: Sessao): void {
  pararRelogio(s)
  s.relogio = setTimeout(() => {
    if (sessao !== s || s.estado.status !== 'salvando') return
    abortar(s, 'O motor nao respondeu ao salvar. As cenas ficaram como estavam; tente de novo.')
  }, prazoDoSalvarMs)
  s.relogio.unref?.()
}

/**
 * As frases da descoberta no motor (run_discovery/commit_discovery), que o
 * frase-do-motor.ts nao conhece, em curtas ASCII. As outras ja vem limpas.
 */
function frase(mensagem: string): string {
  const regras: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^Buscando o titulo \(descoberta\)/i, () => 'Procurando o anime...'],
    [/descoberta reforcando o banco/i, () => 'Elenco achado'],
    [/^Modo Descoberta - sem banco online/i, () => 'Sem elenco online'],
    [/^Sem fonte online - usando os (\d+)/i, (m) => `Sem elenco online; ${m[1]} nomes ja conhecidos`],
    [/^Baixando fotos pra sugerir nomes/i, () => 'Baixando fotos do elenco...'],
    [/^Modelos prontos/i, () => 'Modelos prontos'],
    [/^Agrupando (\d+) rostos/i, (m) => `Agrupando ${m[1]} rostos...`],
    [/^(\d+) personagens descobertos/i, (m) => `${m[1]} grupos`],
    [/^Salvando personagens descobertos/i, () => 'Salvando os personagens...'],
    [/^Gerando pastas e metadados/i, () => 'Gravando as cenas...'],
  ]
  // A tela e ASCII: o motor narra com acento e com seta ("1384 rostos -> 53 grupos").
  const limpa = ascii(mensagem).replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim()
  for (const [padrao, curta] of regras) {
    const m = padrao.exec(limpa)
    if (m) return curta(m)
  }
  return limpa
}

// ------------------------------------------------------------------ fim

function terminarMal(s: Sessao, status: 'falhou' | 'cancelada', erro: string | null, detalhe: string | null = null): void {
  pararRelogio(s)
  atualizar(s, {
    status,
    etapa: null,
    progresso: null,
    mensagem: '',
    erro: status === 'falhou' ? erro : null,
    detalhe: status === 'falhou' ? detalhe : null,
  })
  const c = s.confirmacao
  s.confirmacao = null
  c?.rejeitar(new Error(erro ?? 'Reconhecer na mao cancelado.'))
  enviar(s)
}

function terminarBem(s: Sessao, fim: Extract<FimDaAnalise, { ok: true }>): void {
  pararRelogio(s)
  const c = s.confirmacao
  s.confirmacao = null
  try {
    const indice = aplicarNoIndice(s.episodioId, fim.pastaDoEpisodio, agora())
    const personagens = personagensDoIndice(indice)
    // Pela pessoa, nao pelo texto: o canonizar do indice pode ter unido grafias.
    const descartados = nomesDescartados(c?.nomes ?? [], personagens.map((p) => p.nome))
    const avisos = descartados.map(
      (n) => `${n}: menos de ${CENAS_MINIMAS_POR_PERSONAGEM} cenas, ficou de fora.`,
    )
    if (s.pronta && !s.pronta.online) {
      avisos.push('Anime nao achado online: as fotos ficaram num banco local com este nome.')
    }
    const resultado: ResultadoDaDescoberta = {
      episodioId: s.episodioId,
      jobId: fim.jobId,
      personagens,
      cenasComPersonagem: indice.planos.filter((p) => p.personagens.length > 0).length,
      totalCenas: indice.planos.length,
      refsSalvas: c?.refs ?? 0,
      pastaDasReferencias: s.refsDir,
      descartados,
      avisos,
      segundos: Math.round((Date.now() - s.inicio) / 100) / 10,
      indice,
    }
    s.resultado = resultado
    atualizar(s, {
      status: 'feita',
      etapa: null,
      progresso: 1,
      mensagem: `${personagens.length} ${personagens.length === 1 ? 'personagem' : 'personagens'} em ${resultado.cenasComPersonagem} cenas`,
      erro: null,
    })
    // Primeiro o indice (as stores dos passos trocam por ele), depois o 'feita'.
    try {
      s.avisar.corte({ episodioId: s.episodioId, estado: indice.corte!, indice })
    } catch (e) {
      console.error('[descoberta] aviso do corte falhou:', e)
    }
    enviar(s)
    c?.resolver(resultado)
  } catch (e) {
    const erro = `Os personagens foram salvos no motor, mas o indice nao: ${e instanceof Error ? e.message : String(e)}`
    // A confirmacao ja saiu da sessao: o terminarMal nao a ve, e ela e rejeitada aqui.
    terminarMal(s, 'falhou', erro)
    c?.rejeitar(new Error(erro))
  }
}

// ------------------------------------------------------------ ouvintes

function ouvintes(s: Sessao): OuvintesDaAnalise {
  let acabou = false
  return {
    progresso: (p: ProgressoDaAnalise) => {
      if (acabou || sessao !== s) return
      s.ultimoSinal = Date.now()
      const st = s.estado.status
      if (st === 'agrupando') {
        const trocou = s.estado.etapa !== p.etapa
        const progresso = Math.max(s.estado.progresso ?? 0, progressoDaDescoberta(p.etapa, p.fracao, s.estado.comCorte))
        const mensagem =
          s.estado.mensagem === 'Cancelando...' ? s.estado.mensagem : frase(p.mensagem) || `${ROTULO_DA_ETAPA[p.etapa]}...`
        atualizar(s, { etapa: p.etapa, progresso, mensagem })
        if (trocou || Date.now() - s.ultimoEnvio >= INTERVALO_DO_EVENTO_MS) enviar(s)
      } else if (st === 'salvando') {
        // O motor esta vivo: o prazo do salvar recomeca.
        if (!s.erroForcado) armarRelogioDoSalvar(s)
        const nova = frase(p.mensagem)
        const mensagem = s.estado.mensagem === 'Parando...' ? s.estado.mensagem : nova || s.estado.mensagem
        const trocou = mensagem !== s.estado.mensagem
        atualizar(s, { etapa: p.etapa, mensagem })
        if (trocou || Date.now() - s.ultimoEnvio >= INTERVALO_DO_SALVANDO_MS) enviar(s)
      }
    },
    descobertaPronta: (cru) => {
      if (acabou || sessao !== s) return
      void receberGrupos(s, cru)
    },
    resultadoDoMotor: (r) => {
      if (sessao === s && typeof r['refsDir'] === 'string' && r['refsDir']) s.refsDir = r['refsDir']
    },
    fim: (f: FimDaAnalise) => {
      if (acabou) return
      acabou = true
      if (sessao !== s) return
      if (f.ok) {
        if (s.estado.status === 'salvando') terminarBem(s, f)
        else terminarMal(s, 'falhou', 'O motor terminou sem pedir os nomes.')
      } else if (s.erroForcado) {
        terminarMal(s, 'falhou', s.erroForcado)
      } else if (f.cancelado) {
        terminarMal(s, 'cancelada', null)
      } else {
        // Uma frase curta em portugues; o stderr cru so no tooltip (e no log do motor).
        const e = erroNaTela(f.erro)
        if (e.detalhe) console.warn(`[descoberta] o motor parou: ${e.detalhe}`)
        terminarMal(s, 'falhou', e.curto, e.detalhe)
      }
    },
  }
}

/** Para o processo com um erro para a tela (o fim chega como cancelado). */
function abortar(s: Sessao, erro: string): void {
  // O primeiro porque fica: o relogio do salvar estourando depois do "Parar" nao troca a frase.
  if (s.erroForcado) return
  s.erroForcado = erro
  s.encerrando = true
  pararRelogio(s)
  if (s.jobId) void cancelarAnalise(s.jobId)
}

async function receberGrupos(s: Sessao, cru: Record<string, unknown>): Promise<void> {
  const lido = discoveryReadyDoMotorSchema.safeParse(cru)
  if (!lido.success || !s.jobId) {
    abortar(s, 'O motor mandou os grupos num formato que o recap nao entende.')
    return
  }
  const ev = lido.data
  // Defesa: com cenas no disco a pasta foi conferida antes de subir o motor.
  if (s.pastaEsperada && !mesmoCaminho(s.pastaEsperada, ev.episodeRoot)) {
    abortar(s, `O motor abriu outra pasta (${ev.episodeRoot}) em vez da do episodio. Nada foi gravado no indice.`)
    return
  }
  if (ev.groups.length === 0) {
    abortar(s, 'Nenhum rosto achado nas cenas deste episodio.')
    return
  }
  atualizar(s, { etapa: 'organizando', progresso: 1, mensagem: 'Preparando os grupos...' })
  enviar(s)
  try {
    const { pronta, faltaram } = await montarPronta(ev, {
      episodioId: s.episodioId,
      jobId: s.jobId,
      dadosDoMotor: pastaDeDadosDoMotor(),
    })
    if (sessao !== s || s.estado.status !== 'agrupando' || s.erroForcado) return
    s.pronta = descobertaProntaSchema.parse(pronta)
    if (faltaram > 0) console.warn(`[descoberta] ${faltaram} recortes sumiram do disco`)
    const n = pronta.grupos.length
    atualizar(s, { status: 'pronta', etapa: null, progresso: 1, mensagem: `${n} ${n === 1 ? 'grupo' : 'grupos'}`, erro: null })
    // Sem resposta no prazo: libera a vaga do motor (os cortes de outros
    // episodios esperam por ela). unref: o relogio nao segura o processo vivo.
    pararRelogio(s)
    s.relogio = setTimeout(() => {
      if (sessao !== s || s.estado.status !== 'pronta') return
      const min = Math.max(1, Math.round(esperaDosNomesMs / 60_000))
      abortar(s, `Os grupos expiraram (${min} min sem resposta). Reconheca de novo: e rapido, o corte e os rostos ficaram salvos.`)
    }, esperaDosNomesMs)
    s.relogio.unref?.()
    enviar(s)
  } catch (e) {
    abortar(s, `Nao deu para preparar os grupos: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ------------------------------------------------------------------- api

/** Quanto um iniciar espera a rodada cancelada sair (o cancelarAnalise mata em 10 s). */
const ESPERA_DA_RODADA_SAINDO_MS = 15_000

/** Espera a sessao deixar de estar viva. false = ainda viva no prazo. */
async function esperarSair(s: Sessao, ms: number): Promise<boolean> {
  const ate = Date.now() + ms
  while (descobertaViva(s.estado) && Date.now() < ate) await new Promise((r) => setTimeout(r, 100))
  return !descobertaViva(s.estado)
}

/**
 * Comeca a descoberta do episodio e devolve o estado na hora ('agrupando', com
 * o jobId). Os grupos chegam pelo evento ('pronta'). Lanca com a frase para a
 * tela: episodio que nao pode (podeReconhecerNaMao), motor fora ou ocupado,
 * corte vivo do mesmo episodio, video sumido.
 */
export async function iniciarDescoberta(pedido: PedidoDaDescoberta, avisar: AvisosDaDescoberta): Promise<EstadoDaDescoberta> {
  const id = pedido.episodioId
  let viva = sessao && descobertaViva(sessao.estado) ? sessao : null
  // Cancelada agora ha pouco (Esc sem mudanca e "Revisar" de novo): o processo
  // ainda esta saindo. Espera ele sair e sobe outra rodada.
  const saindo = viva?.encerrando === true
  if (viva?.encerrando) {
    if (!(await esperarSair(viva, ESPERA_DA_RODADA_SAINDO_MS))) {
      throw new Error('A rodada anterior ainda esta fechando. Tente de novo em alguns segundos.')
    }
    viva = sessao && descobertaViva(sessao.estado) ? sessao : null
  }
  if (viva) {
    // O segundo clique nao sobe outro motor.
    if (viva.episodioId === id) {
      viva.avisar = avisar
      return viva.estado
    }
    throw new Error('Ja ha um Reconhecer na mao aberto em outro episodio. Termine ou cancele ele antes.')
  }

  const { indice } = abrirIndicePorId(id)
  const corte = await estadoDoCorte(id)
  const oferta = podeReconhecerNaMao(indice, corte)
  if (!oferta.pode || !oferta.motivo) throw new Error(oferta.porque || 'Esse episodio nao pode ser reconhecido na mao agora.')
  if (corte?.jobId) throw new Error('Espere o corte das cenas acabar.')

  // Com cenas no disco, o motor TEM que reabrir a mesma pasta (outputFolder =
  // a pasta do anime): noutra ele cortaria o episodio inteiro de novo. A
  // pasta que ele abriria e <biblioteca>/<anime>/<SxxEyy>.
  let pastaEsperada: string | null = null
  let pastaDoAnime: string | undefined
  if (temPlanos(indice)) {
    const pasta = indice.biblioteca.pasta
    pastaDoAnime = basename(dirname(pasta))
    const esperada = join(pastaDaBibliotecaStudio(), pastaDoAnime, slugDoEpisodio(indice.temporada, indice.episodio, indice.kind))
    if (!pastaDoAnime || !mesmoCaminho(esperada, pasta)) {
      throw new Error(
        'As cenas desse episodio estao fora da biblioteca do recap de agora (ou com outro numero de episodio). Abra o episodio pela Biblioteca atual para reconhecer.',
      )
    }
    pastaEsperada = pasta
  }

  const motivo: MotivoDaDescoberta = oferta.motivo
  const inicio = agora()
  const s: Sessao = {
    episodioId: id,
    jobId: null,
    estado: {
      episodioId: id,
      jobId: null,
      motivo,
      status: 'agrupando',
      etapa: 'preparando',
      progresso: 0,
      mensagem: 'Preparando...',
      erro: null,
      comCorte: !temPlanos(indice),
      inicio,
      atualizadoEm: inicio,
    },
    pronta: null,
    resultado: null,
    avisar,
    pastaEsperada,
    inicio: Date.now(),
    ultimoEnvio: 0,
    ultimoSinal: Date.now(),
    relogio: null,
    erroForcado: null,
    encerrando: false,
    confirmacao: null,
    refsDir: null,
  }
  // A vaga e marcada ANTES do await: um corte do mesmo episodio pedido agora
  // ja e recusado (corte-fundo.ts, haDescobertaViva).
  sessao = s
  marcarViva(id)

  let jobId: string
  try {
    const subir = (): Promise<string> =>
      analisarEpisodio(
        {
          path: indice.fonte.path,
          anime: pedido.anime?.trim() || indice.anime,
          temporada: indice.temporada,
          episodio: indice.episodio,
          kind: indice.kind,
          motor: 'studio',
          reconhecer: true,
          ...(pastaDoAnime ? { pastaDoAnime } : {}),
        },
        ouvintes(s),
        { descoberta: true },
      )
    // A rodada anterior acabou de sair: a vaga do motor solta quando o processo
    // fecha (motor.ts, soltar), um instante depois do fim. Tenta de novo um pouco.
    const ate = Date.now() + (saindo ? ESPERA_DA_RODADA_SAINDO_MS : 0)
    for (;;) {
      try {
        jobId = await subir()
        break
      } catch (e) {
        const ocupado = /ja existe uma analise rodando/i.test(e instanceof Error ? e.message : String(e))
        if (!ocupado || Date.now() >= ate || sessao !== s) throw e
        await new Promise((r) => setTimeout(r, 250))
      }
    }
  } catch (e) {
    if (sessao === s) {
      sessao = null
      marcarViva(null)
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      /ja existe uma analise rodando/i.test(msg)
        ? 'O motor esta ocupado cortando outro episodio. Tente de novo quando ele acabar.'
        : msg,
    )
  }
  s.jobId = jobId
  atualizar(s, { jobId })
  // As copias de recortes de rodadas velhas saem agora (a desta nasce no 'pronta').
  void limparCopiasVelhas(pastaDeDadosDoMotor(), jobId)
  enviar(s)
  return s.estado
}

/**
 * A descoberta viva deste episodio (a tela reabrindo, ou o renderer
 * recarregado com o processo esperando os nomes): o mesmo formato do evento,
 * com `pronta` enquanto ela estiver de pe (inclusive salvando). null = nenhuma
 * viva (ou de outro episodio).
 */
export async function descobertaAtual(episodioId: string): Promise<EventoDaDescoberta | null> {
  const s = sessao
  if (!s || s.episodioId !== episodioId || !descobertaViva(s.estado)) return null
  return evento(s, s.estado.status === 'pronta' || s.estado.status === 'salvando')
}

/**
 * Manda os nomes (paraOMotor ANTES: decisao vazia nunca chega ao motor) e
 * espera o commit. Devolve o resultado com o indice novo, ja gravado; os
 * eventos 'salvando' e 'feita' (e o corteProgresso) saem no caminho. Lanca
 * quando o job nao esta mais esperando nomes (cancelado, expirou, app
 * reiniciado): "Os grupos expiraram. Reconheca de novo."
 */
export async function confirmarDescoberta(jobId: string, decisao: DecisaoDaDescoberta): Promise<ResultadoDaDescoberta> {
  const s = sessao
  const expirou = new Error('Os grupos expiraram. Reconheca de novo.')
  if (!s || s.jobId !== jobId) throw expirou
  if (s.estado.status === 'salvando') throw new Error('Ja esta salvando. Espere acabar.')
  if (s.estado.status !== 'pronta' || !s.pronta) throw expirou

  // Lanca 'De nome a pelo menos um personagem.' sem tocar no processo. Com o
  // elenco, as grafias da mesma pessoa viram a do elenco (grafiasDaDecisao).
  const opcoes = { elenco: s.pronta.elenco.map((e) => e.nome) }
  const comando = paraOMotor(s.pronta.grupos, decisao, opcoes)
  const resumo = resumoDaDecisao(s.pronta.grupos, decisao, opcoes)
  if (!comandarDescoberta(jobId, comando)) throw expirou

  s.ultimoSinal = Date.now()
  armarRelogioDoSalvar(s)
  const promessa = new Promise<ResultadoDaDescoberta>((resolver, rejeitar) => {
    s.confirmacao = {
      resolver,
      rejeitar,
      nomes: [...new Set(Object.values(comando.names))],
      refs: resumo.personagens.reduce((soma, p) => soma + p.refs, 0),
    }
  })
  atualizar(s, { status: 'salvando', etapa: 'organizando', progresso: null, mensagem: 'Salvando os personagens...', erro: null })
  enviar(s)
  return promessa
}

/** A1: a pasta do episodio da descoberta aberta deste episodio (os grupos no disco), ou null. */
export function pastaDaSessao(episodioId: string): string | null {
  const s = sessao
  return s && s.episodioId === episodioId && s.pronta ? s.pronta.pastaDoEpisodio : null
}

/**
 * A1: o elenco do anime escolhido no "Buscar elenco" entra na descoberta
 * aberta deste episodio: o elenco com as fotos, o titulo, `online` e, nos
 * grupos, as sugestoes novas (o palpite do grupo nao conhecido vira a 1a).
 * Vai pelo evento de sempre com o MESMO jobId: a tela guarda o que ele ja
 * decidiu. false = nenhuma descoberta deste episodio esperando nomes, ou
 * nenhuma sugestao nova.
 */
export function aplicarElencoNaSessao(
  episodioId: string,
  novo: { titulo: string; elenco: DescobertaPronta['elenco']; sugestoes: Record<string, { nome: string; sim: number }[]> },
): boolean {
  const s = sessao
  if (!s || s.episodioId !== episodioId || !s.pronta || s.estado.status !== 'pronta') return false
  let comSugestoes = false
  const grupos = s.pronta.grupos.map((g) => {
    const lista = sugestoesDoMotor((novo.sugestoes[String(g.key)] ?? []).map((x) => ({ name: x.nome, sim: x.sim })))
    if (lista.length === 0) return g
    comSugestoes = true
    const primeira = lista[0]!
    return { ...g, sugestoes: lista, sugestao: g.conhecido ? g.sugestao : { nome: primeira.nome, similaridade: primeira.similaridade } }
  })
  s.pronta = descobertaProntaSchema.parse({
    ...s.pronta,
    anime: novo.titulo || s.pronta.anime,
    online: true,
    elenco: novo.elenco.length ? novo.elenco : s.pronta.elenco,
    grupos,
  })
  enviar(s)
  return comSugestoes
}

/**
 * Para a descoberta (agrupando ou esperando nomes). O indice fica como estava.
 * false = nao havia. Salvando so para com o motor MUDO ha MUDO_PARA_PARAR_MS
 * (travou: o "Parar" da tela); falando, lanca -- ele esta gravando as fotos e o
 * shots.json, e o commit leva segundos.
 */
export async function cancelarDescoberta(jobId: string): Promise<boolean> {
  const s = sessao
  if (!s || s.jobId !== jobId || !descobertaViva(s.estado)) return false
  if (s.estado.status === 'salvando') {
    if (Date.now() - s.ultimoSinal < mudoParaPararMs) throw new Error('Ja esta salvando os personagens. Espere acabar.')
    pararRelogio(s)
    s.encerrando = true
    atualizar(s, { mensagem: 'Parando...' })
    enviar(s)
    // O fim chega como cancelado e a tela ve este porque (falhou): nada foi para o indice.
    abortar(s, 'Parado: o motor nao respondia ao salvar. As cenas ficaram como estavam.')
    return true
  }
  s.encerrando = true
  atualizar(s, { mensagem: 'Cancelando...' })
  enviar(s)
  await cancelarAnalise(jobId)
  return true
}
