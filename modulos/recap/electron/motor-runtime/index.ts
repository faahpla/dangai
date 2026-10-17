import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  DISCO_POR_VARIANTE,
  FOLGA_DE_DISCO,
  mudancasDoRuntime,
  type AndamentoDaInstalacao,
  type ErroDaInstalacao,
  type EstadoDoMotorRuntime,
  type FaseDoMotorRuntime,
  type MudancasDoRuntime,
  type PedidoDeInstalacao,
  type VarianteDoMotor,
} from '../../shared/motor-runtime'
import type { FetchDoMotor } from './baixar'
import { FalhaDaInstalacao, FRASE_DO_ERRO, InstalacaoCancelada, paraErroDaInstalacao } from './erros'
import { livreNoDisco } from './espaco'
import { detectarGpu, varianteSugerida } from './gpu'
import { impressaoDoLock, lerImpressaoGravada, lerLock } from './lock'
import {
  CAMINHO_MAXIMO_DA_PASTA,
  caminhoDoUv,
  caminhosDoRuntime,
  configDoRuntime,
  gravarPastaEscolhida,
  pastaDoCodigoDoMotor,
  pastaDoRuntime,
  pastaPadraoDoRuntime,
  usaRuntime,
} from './pastas'
import { gravarEstadoGravado, instalarRuntime, lerEstadoGravado, planoDaInstalacao, reconferirCuda, travaDeOutro } from './protocolo'
import { matarTodos } from './uv'

export { configurarMotorRuntime, usaRuntime } from './pastas'
export { ambienteDoRuntime } from './ambiente'

/**
 * O RUNTIME DO MOTOR no app instalado: a API que o resto do main usa.
 *
 * DONO: agente A (runtime + tela). Contrato em shared/motor-runtime.ts.
 *
 * Quem chama:
 * - [recap] o index.ts do modulo: configurarMotorRuntime (no configurar),
 *   iniciarMotorRuntime (depois da janela: a atualizacao automatica dos
 *   pacotes) e encerrarMotorRuntime (before-quit: mata o uv, guarda a retomada);
 * - ./ipc.ts: os canais motor-runtime:*, e o que so o Electron tem (net.fetch,
 *   o dialogo de pasta, esquecer a sonda do motor.ts) entra por injecao;
 * - motor.ts (backendDoStudio + ambiente) e montar/rostos-motor.ts (backend):
 *   backendDoRuntime + ambienteDoRuntime quando usaRuntime().
 *
 * Sem import do electron: o teste do contrato e o instalador de teste rodam
 * isto no Node.
 */

/** Avisa a tela (motor-runtime:mudou). Ligado pelo ./ipc.ts. */
type Avisar = (estado: EstadoDoMotorRuntime) => void
let avisar: Avisar | null = null
/** net.fetch no app (respeita o proxy do sistema). Sem ele, o fetch do Node. */
let fetchDoApp: FetchDoMotor | null = null
/** O runtime mudou (instalou, removeu): o motor.ts esquece a sonda guardada. */
let aoMudar: (() => void) | null = null

export function definirAvisoDoMotorRuntime(fn: Avisar): void {
  avisar = fn
}

export function definirFetchDoMotorRuntime(fn: FetchDoMotor): void {
  fetchDoApp = fn
}

export function definirAoMudarORuntime(fn: () => void): void {
  aoMudar = fn
}

/**
 * Ha um processo do motor vivo (a analise do motor.ts, um lote de rostos)?
 * Ligado pelo ./ipc.ts. Instalar por cima (Reinstalar, Recomecar, Atualizar)
 * mexe no venv que esse python esta usando: recusa antes de comecar.
 */
let motorEmUso: (() => boolean) | null = null

export function definirMotorEmUso(fn: () => boolean): void {
  motorEmUso = fn
}

const FRASE_DO_MOTOR_EM_USO = 'O motor esta em uso. Espere a analise terminar.'

/**
 * O Remover apagando a pasta antiga por tras. O app espera ele ao fechar
 * (esperarRemocao, no before-quit): cortado no meio, sobravam ate 5 GB num
 * motor-runtime.apagar-* que so o app limpava.
 */
let apagando: Promise<void> | null = null

/** null = nada a esperar. */
export function remocaoEmAndamento(): Promise<void> | null {
  return apagando
}

/** [recap] Ha uma instalacao do runtime rodando neste processo (o motivoParaNaoAtualizar). */
export function instalandoMotorRuntime(): boolean {
  return execucao !== null
}

/** A instalacao em andamento NESTE processo. */
interface Execucao {
  variante: VarianteDoMotor
  alvo: string
  pasta: string
  controle: AbortController
  andamento: AndamentoDaInstalacao
  automatica: boolean
  mudancas: MudancasDoRuntime | null
  promessa: Promise<void>
}
let execucao: Execucao | null = null
/** O erro da ultima tentativa que nao deu para gravar no estado.json (pasta, ocupado). */
let ultimoErro: ErroDaInstalacao | null = null
/** "Motor atualizado: 3 pacotes" depois de uma atualizacao automatica. */
let aviso: string | null = null
/** O app esta fechando: nada novo comeca. */
let encerrando = false

// ---------------------------------------------------------------- o motor

export interface BackendDoRuntime {
  /** <runtime>/venv/Scripts/python.exe (o motor.ts abre o base com pythonDoMotor). */
  python: string
  /** resources/motor (cwd do processo: `-m app.headless` acha o pacote app/ aqui). */
  cwd: string
  /** false = ANIRECAP_MOTOR_SEM_CUDA=1 (ambienteDoRuntime): o torch na CPU, o NVENC continua. */
  cudaOk: boolean
  /** HF_HOME: os modelos da 1a analise dentro do runtime. */
  modelos: string
}

/**
 * O Python do runtime para subir o motor, ou o motivo de nao haver (frase
 * curta para a tela; o resumoDoMotor da tela reconhece cada uma).
 *
 * Sincrono e barato (le dois JSON pequenos): roda a cada sondagem e analise.
 * Nao instala nada -- quem instala e o pedido explicito da tela. Recusa
 * enquanto houver um estado.json: o venv pode estar pela metade.
 */
export function backendDoRuntime(): BackendDoRuntime | { erro: string; fase: FaseDoMotorRuntime } {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return { erro: 'O motor de personagens so roda no Windows 64 bits por enquanto.', fase: 'ausente' }
  }
  if (execucao) return { erro: 'O motor de personagens esta sendo instalado.', fase: 'instalando' }
  const c = caminhosDoRuntime(pastaDoRuntime().pasta)
  if (existsSync(c.estado)) return { erro: 'A instalacao do motor de personagens nao terminou.', fase: 'incompleto' }
  const gravada = lerImpressaoGravada(c.impressao)
  if (!gravada || !existsSync(c.pythonDoVenv)) return { erro: 'O motor de personagens nao esta instalado.', fase: 'ausente' }
  let lock
  try {
    lock = lerLock()
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e), fase: 'ausente' }
  }
  if (impressaoDoLock(lock, gravada.variante) !== gravada.impressao) {
    return { erro: 'O motor de personagens precisa de uma atualizacao.', fase: 'desatualizado' }
  }
  return { python: c.pythonDoVenv, cwd: pastaDoCodigoDoMotor(), cudaOk: gravada.cudaOk, modelos: c.modelos }
}

// ------------------------------------------------------------------ estado

/** O ultimo estado montado, para os eventos de andamento nao relerem o disco 4x por segundo. */
let guardado: { em: number; estado: EstadoDoMotorRuntime } | null = null

/** O estado inteiro para a tela, lido do disco (e da instalacao viva, se houver). */
export async function estadoDoMotorRuntime(): Promise<EstadoDoMotorRuntime> {
  const { pasta, padrao } = pastaDoRuntime()
  const c = caminhosDoRuntime(pasta)
  const base: EstadoDoMotorRuntime = {
    fase: 'dev',
    pasta,
    pastaPadrao: padrao,
    variante: null,
    varianteSugerida: 'cu128',
    gpu: null,
    bytesParaBaixar: 0,
    bytesNoDisco: 0,
    livreNoDisco: null,
    precisaDeLivre: 0,
    andamento: null,
    erro: null,
    mudancas: null,
    aviso,
    log: existsSync(c.log) ? c.log : null,
    ...(apagando ? { apagando: true } : {}),
  }
  if (!usaRuntime()) return base

  const gpu = await detectarGpu()
  base.gpu = gpu
  base.varianteSugerida = varianteSugerida(gpu)
  base.livreNoDisco = await livreNoDisco(pasta)
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return { ...base, fase: 'ausente', erro: { tipo: 'sistema', mensagem: FRASE_DO_ERRO.sistema } }
  }
  let lock
  try {
    lock = lerLock()
  } catch (e) {
    return { ...base, fase: 'ausente', erro: { tipo: 'uv-ausente', mensagem: e instanceof Error ? e.message : String(e) } }
  }

  const gravada = lerImpressaoGravada(c.impressao)
  const gravado = lerEstadoGravado(c)
  const variante = execucao?.variante ?? gravado?.variante ?? gravada?.variante ?? base.varianteSugerida
  const plano = planoDaInstalacao(pasta, lock, variante)
  const comum: EstadoDoMotorRuntime = {
    ...base,
    variante: execucao?.variante ?? gravado?.variante ?? gravada?.variante ?? null,
    bytesParaBaixar: plano.bytesParaBaixar,
    precisaDeLivre: plano.discoQueFalta > 0 ? plano.discoQueFalta + FOLGA_DE_DISCO : 0,
    bytesNoDisco: gravada?.bytesNoDisco && gravada.variante === variante ? gravada.bytesNoDisco : DISCO_POR_VARIANTE[variante],
  }
  if (execucao) return { ...comum, fase: 'instalando', andamento: execucao.andamento, mudancas: execucao.mudancas }
  const mudancas = gravada ? mudancasDoRuntime(gravada, lock, variante) : null
  if (gravado) {
    return {
      ...comum,
      fase: 'incompleto',
      andamento: {
        etapa: gravado.etapa ?? gravado.etapasFeitas[gravado.etapasFeitas.length - 1] ?? 'preparar',
        fracao: gravado.fracao,
        mensagem: gravado.cancelado ? 'Cancelado' : 'Parou',
      },
      erro: gravado.erro ?? ultimoErro,
      mudancas,
    }
  }
  if (!gravada || !existsSync(c.pythonDoVenv)) return { ...comum, fase: 'ausente', erro: ultimoErro }
  // cu128 que nao rodou a conta na GPU: a tela diz "CPU" em vez do nome da placa.
  const cudaOk = gravada.variante === 'cu128' ? gravada.cudaOk : null
  if (!mudancas) return { ...comum, fase: 'pronto', bytesParaBaixar: 0, precisaDeLivre: 0, erro: null, cudaOk }
  return { ...comum, fase: 'desatualizado', mudancas, erro: ultimoErro, cudaOk }
}

/** Numero de ordem dos estados enviados: um montado antes nao chega depois de um mais novo. */
let ordem = 0
let ultimaOrdemEnviada = 0
let ultimoEnvio = 0
let agendado: NodeJS.Timeout | null = null

/** Manda o estado inteiro para a tela, no maximo 4 por segundo (`ja` passa na frente: fim, erro). */
function emitir(ja = false): void {
  if (!avisar) return
  const falta = 250 - (Date.now() - ultimoEnvio)
  if (!ja && falta > 0) {
    agendado ??= setTimeout(() => {
      agendado = null
      emitir(true)
    }, falta)
    return
  }
  if (agendado) {
    clearTimeout(agendado)
    agendado = null
  }
  ultimoEnvio = Date.now()
  const minha = ++ordem
  const montar = async (): Promise<EstadoDoMotorRuntime> => {
    // Durante a instalacao so o andamento muda a cada evento: o resto vem do ultimo estado (ate 2 s).
    const ex = execucao
    if (!ja && ex && guardado && guardado.estado.fase === 'instalando' && Date.now() - guardado.em < 2000) {
      return { ...guardado.estado, andamento: ex.andamento }
    }
    const e = await estadoDoMotorRuntime()
    guardado = { em: Date.now(), estado: e }
    return e
  }
  void montar()
    .then((e) => {
      if (minha < ultimaOrdemEnviada) return
      ultimaOrdemEnviada = minha
      avisar?.(e)
    })
    .catch((e: unknown) => console.error('[motor-runtime] estado:', e))
}

// --------------------------------------------------------------- comandos

/** Comeca a instalacao em segundo plano (quem chama ja conferiu que nao ha outra). */
function comecar(variante: VarianteDoMotor, opcoes: { recomecar?: boolean; automatica: boolean; mudancas: MudancasDoRuntime | null }): void {
  const cfg = configDoRuntime()
  const lock = lerLock()
  const { pasta } = pastaDoRuntime()
  const c = caminhosDoRuntime(pasta)
  const gravado = lerEstadoGravado(c)
  const controle = new AbortController()
  ultimoErro = null
  aviso = null
  const ex: Execucao = {
    variante,
    alvo: impressaoDoLock(lock, variante),
    pasta,
    controle,
    andamento: { etapa: 'preparar', fracao: gravado?.variante === variante && !opcoes.recomecar ? gravado.fracao : 0, mensagem: 'Preparando' },
    automatica: opcoes.automatica,
    mudancas: opcoes.mudancas,
    promessa: Promise.resolve(),
  }
  execucao = ex
  ex.promessa = detectarGpu()
    .then((gpu) =>
      instalarRuntime({
        pasta,
        lock,
        variante,
        uv: caminhoDoUv(),
        fetch: fetchDoApp ?? ((url, init) => fetch(url, init)),
        signal: controle.signal,
        codigoDoMotor: pastaDoCodigoDoMotor(),
        dadosDoMotor: join(cfg.userData, 'motor'),
        versaoDoApp: cfg.versaoDoApp,
        gpu,
        ...(opcoes.recomecar ? { recomecar: true } : {}),
        ...(opcoes.automatica ? { automatica: true } : {}),
        aoAndar: (a) => {
          if (execucao !== ex) return
          ex.andamento = a
          emitir()
        },
      }),
    )
    .then(() => {
      if (execucao === ex) execucao = null
      if (ex.automatica && ex.mudancas) {
        const n = ex.mudancas.pacotes.length
        aviso = `Motor atualizado: ${n} ${n === 1 ? 'pacote' : 'pacotes'}`
      }
    })
    .catch((e: unknown) => {
      if (execucao === ex) execucao = null
      const cancelado = e instanceof InstalacaoCancelada || controle.signal.aborted
      const erro = cancelado ? null : paraErroDaInstalacao(e)
      if (!cancelado) console.error('[motor-runtime] instalacao parou:', e)
      ultimoErro = erro
      // Ocupado, pasta e sistema nao tocam no estado.json: ou e de outro processo, ou nao da para gravar.
      const semGravar = e instanceof FalhaDaInstalacao && (e.tipo === 'ocupado' || e.tipo === 'pasta' || e.tipo === 'sistema')
      if (!semGravar && existsSync(pasta)) {
        gravarEstadoGravado(c, { alvo: ex.alvo, variante, cancelado, erro, fracao: ex.andamento.fracao ?? 0, etapa: ex.andamento.etapa })
      }
    })
    .finally(() => {
      guardado = null
      try {
        aoMudar?.()
      } catch {
        // o motor.ts nao pode derrubar o fim da instalacao
      }
      emitir(true)
    })
  emitir(true)
}

/** Instala, continua ou atualiza, em segundo plano. Devolve o estado ja em 'instalando'. */
export async function instalarMotorRuntime(pedido: PedidoDeInstalacao): Promise<EstadoDoMotorRuntime> {
  if (!usaRuntime()) throw new Error('Em desenvolvimento o motor e o motor/.venv: nada a instalar.')
  if (encerrando) throw new Error('O app esta fechando.')
  if (execucao) throw new Error('O motor ja esta sendo instalado.')
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error(FRASE_DO_ERRO.sistema)
  // O motor so roda com o runtime pronto: com ele vivo, qualquer instalacao mexe no venv dele.
  if (motorEmUso?.()) throw new Error(FRASE_DO_MOTOR_EM_USO)
  const lock = lerLock()
  const c = caminhosDoRuntime(pastaDoRuntime().pasta)
  const outro = travaDeOutro(c)
  if (outro) throw new Error(FRASE_DO_ERRO.ocupado)
  const gpu = await detectarGpu()
  const gravada = lerImpressaoGravada(c.impressao)
  const gravado = lerEstadoGravado(c)
  const variante = pedido.variante ?? gravado?.variante ?? gravada?.variante ?? varianteSugerida(gpu)
  const mudancas = gravada ? mudancasDoRuntime(gravada, lock, variante) : null
  comecar(variante, { recomecar: pedido.recomecar === true, automatica: false, mudancas })
  return estadoDoMotorRuntime()
}

/** Para a instalacao; o que ja baixou fica. No-op sem instalacao. */
export async function cancelarMotorRuntime(): Promise<void> {
  const ex = execucao
  if (!ex) return
  ex.controle.abort()
  matarTodos()
  // Espera o protocolo gravar o estado (a descarga fecha o arquivo, o uv morre); no maximo 10 s.
  await Promise.race([ex.promessa, new Promise((r) => setTimeout(r, 10_000))])
}

/**
 * A pasta que o Levi escolheu (o dialogo e do ./ipc.ts). null = voltar a
 * padrao. So fora de 'instalando' e com o motor ausente: mudar a pasta de um
 * runtime instalado o deixaria orfao (5 GB perdidos); para isso, Remover antes.
 * A pasta vira SEMPRE <escolhida>\motor-runtime: o Remover so apaga uma pasta
 * com esse nome.
 */
export async function usarPastaDoMotorRuntime(escolhida: string | null): Promise<EstadoDoMotorRuntime> {
  if (!usaRuntime()) throw new Error('Em desenvolvimento o motor e o motor/.venv.')
  if (execucao) throw new Error('Espere o motor terminar de instalar.')
  const atual = await estadoDoMotorRuntime()
  if (atual.fase !== 'ausente') throw new Error('Remova o motor antes de trocar a pasta.')
  if (escolhida === null) {
    gravarPastaEscolhida(null)
  } else {
    const alvo = basename(escolhida).toLowerCase() === 'motor-runtime' ? resolve(escolhida) : join(resolve(escolhida), 'motor-runtime')
    if (alvo.length > CAMINHO_MAXIMO_DA_PASTA) {
      throw new Error(`Caminho longo demais (maximo ${CAMINHO_MAXIMO_DA_PASTA} letras). Escolha uma pasta mais perto da raiz do disco.`)
    }
    try {
      await mkdir(alvo, { recursive: true })
      const prova = join(alvo, `.prova-${process.pid}`)
      await writeFile(prova, 'ok')
      await rm(prova, { force: true })
    } catch {
      throw new Error(`Nao deu para gravar em ${alvo}. Escolha outra pasta.`)
    }
    gravarPastaEscolhida(resolve(alvo).toLowerCase() === resolve(pastaPadraoDoRuntime()).toLowerCase() ? null : alvo)
  }
  ultimoErro = null
  guardado = null
  emitir(true)
  return estadoDoMotorRuntime()
}

/**
 * Apaga o runtime da pasta atual (libera ~5 GB). So fora de 'instalando', e
 * so uma pasta chamada motor-runtime. Renomeia primeiro: com o motor rodando
 * (python.exe aberto), o Windows recusa o rename e nada fica pela metade.
 */
export async function removerMotorRuntime(): Promise<EstadoDoMotorRuntime> {
  if (!usaRuntime()) throw new Error('Em desenvolvimento o motor e o motor/.venv: nada a remover.')
  if (execucao) throw new Error('Espere o motor terminar de instalar, ou cancele.')
  const { pasta } = pastaDoRuntime()
  if (basename(pasta).toLowerCase() !== 'motor-runtime') throw new Error(`So apago uma pasta chamada motor-runtime (${pasta}).`)
  const c = caminhosDoRuntime(pasta)
  if (travaDeOutro(c)) throw new Error(FRASE_DO_ERRO.ocupado)
  if (existsSync(pasta)) {
    const lixo = `${pasta}.apagar-${Date.now()}`
    try {
      renameSync(pasta, lixo)
    } catch {
      throw new Error('O motor esta em uso. Espere a analise terminar e tente de novo.')
    }
    // Por tras, mas o app espera ao fechar (remocaoEmAndamento, no before-quit do main).
    const anterior = apagando
    const esta: Promise<void> = (async () => {
      await anterior?.catch(() => {})
      await rm(lixo, { recursive: true, force: true }).catch((e: unknown) => console.error('[motor-runtime] remover:', e))
    })().finally(() => {
      if (apagando === esta) apagando = null
      guardado = null
      emitir(true)
    })
    apagando = esta
  }
  ultimoErro = null
  aviso = null
  guardado = null
  try {
    aoMudar?.()
  } catch {
    // idem
  }
  emitir(true)
  return estadoDoMotorRuntime()
}

/**
 * Depois da janela (so no app instalado): se o runtime ficou 'desatualizado'
 * por uma atualizacao do app e a mudanca e so de pacotes (mudancas.automatica),
 * atualiza sozinho em segundo plano e avisa. Com python ou torch mudados,
 * espera o pedido da tela. Nunca lanca.
 */
export function iniciarMotorRuntime(): void {
  if (!usaRuntime()) return
  // Restos de um Remover (ou do uv-cache do fim de uma instalacao) que o app
  // fechou antes de terminar de apagar.
  try {
    const { pasta } = pastaDoRuntime()
    const pai = resolve(pasta, '..')
    for (const nome of readdirSync(pai)) {
      if (nome.startsWith(`${basename(pasta)}.apagar-`)) void rm(join(pai, nome), { recursive: true, force: true }).catch(() => {})
    }
    if (!travaDeOutro(caminhosDoRuntime(pasta))) {
      for (const nome of readdirSync(pasta)) {
        if (nome.startsWith('uv-cache.apagar')) void rm(join(pasta, nome), { recursive: true, force: true }).catch(() => {})
      }
    }
  } catch {
    // pasta ainda nao existe
  }
  // A conta na GPU de um cu128 que rodava na CPU, refeita quando o driver muda (dev tambem: so le e mede).
  setTimeout(() => void reconferirCudaSeODriverMudou(), 6000)
  // A atualizacao sozinha so no app instalado: no dev (ANIRECAP_MOTOR_RUNTIME=1) quem testa pede.
  if (!configDoRuntime().empacotado) return
  setTimeout(() => {
    void (async () => {
      try {
        if (execucao || encerrando || motorEmUso?.()) return
        const e = await estadoDoMotorRuntime()
        if (e.fase !== 'desatualizado' || !e.mudancas?.automatica || !e.variante) return
        comecar(e.variante, { automatica: true, mudancas: e.mudancas })
      } catch (err) {
        console.error('[motor-runtime] atualizacao automatica:', err)
      }
    })()
  }, 10_000)
}

/**
 * cu128 instalado com cudaOk false (placa sem kernel, driver velho): a tela
 * pedia para atualizar o driver, mas o cudaOk ficava congelado no
 * impressao.json, e so o Reinstalar (3 GB) reavaliava. Com OUTRO driver que o
 * da medida, refaz so a conta na GPU (~10 s, sem rede) e regrava o cudaOk.
 * Nunca lanca; sem motor vivo nem instalacao.
 */
export async function reconferirCudaSeODriverMudou(): Promise<boolean | null> {
  try {
    if (!usaRuntime() || execucao || encerrando || motorEmUso?.()) return null
    const { pasta } = pastaDoRuntime()
    const c = caminhosDoRuntime(pasta)
    if (existsSync(c.estado)) return null
    const gravada = lerImpressaoGravada(c.impressao)
    if (!gravada || gravada.variante !== 'cu128' || gravada.cudaOk) return null
    const gpu = await detectarGpu()
    if (!gpu.driver || gpu.driver === gravada.driver) return null
    const medida = await reconferirCuda(pasta, new AbortController().signal)
    if (!medida) return null
    // Pode ter comecado uma instalacao (ou o Remover) enquanto media.
    if (execucao || !existsSync(c.impressao)) return null
    const nova = { ...gravada, cudaOk: medida.cudaOk, gpu: medida.gpu ?? gravada.gpu, driver: gpu.driver }
    const tmp = `${c.impressao}.tmp`
    await writeFile(tmp, `${JSON.stringify(nova, null, 2)}\n`, 'utf8')
    await rename(tmp, c.impressao)
    console.log(`[motor-runtime] driver ${gravada.driver ?? '?'} -> ${gpu.driver}: cudaOk ${medida.cudaOk}`)
    guardado = null
    try {
      aoMudar?.()
    } catch {
      // idem
    }
    emitir(true)
    return medida.cudaOk
  } catch (e) {
    console.error('[motor-runtime] reconferir a GPU:', e)
    return null
  }
}

/** before-quit: mata o uv e a descarga e grava a retomada. Sincrono, nunca lanca. */
export function encerrarMotorRuntime(): void {
  encerrando = true
  const ex = execucao
  if (!ex) return
  try {
    ex.controle.abort()
    matarTodos(true)
    const c = caminhosDoRuntime(ex.pasta)
    gravarEstadoGravado(c, {
      alvo: ex.alvo,
      variante: ex.variante,
      cancelado: true,
      erro: null,
      fracao: ex.andamento.fracao ?? 0,
      etapa: ex.andamento.etapa,
    })
    try {
      const j = JSON.parse(readFileSync(c.trava, 'utf8')) as { pid?: number }
      if (j.pid === process.pid) rmSync(c.trava, { force: true })
    } catch {
      // sem trava
    }
  } catch (e) {
    console.error('[motor-runtime] encerrar:', e)
  }
}
