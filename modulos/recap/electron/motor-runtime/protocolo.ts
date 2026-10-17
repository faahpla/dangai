import {
  createWriteStream,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  utimesSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  DISCO_DO_PYTHON,
  DISCO_DO_TORCH,
  DISCO_DOS_MODELOS,
  ETAPAS_DA_INSTALACAO,
  FATOR_DOS_PACOTES,
  FOLGA_DE_DISCO,
  type AndamentoDaInstalacao,
  type EstadoGravado,
  type EtapaDaInstalacao,
  type GpuDetectada,
  type ImpressaoGravada,
  type LockDoRuntime,
  type PacoteDoLock,
  type RodaDoTorch,
  type VarianteDoMotor,
} from '../../shared/motor-runtime'
import { pythonDoMotor } from '../python-do-motor'
import { ambienteDoRuntime } from './ambiente'
import { baixarRoda, sha256DoArquivo, type FetchDoMotor } from './baixar'
import { ehArquivoPreso, ehBloqueio, ehDeRede, ehSemEspaco, falha, FalhaDaInstalacao } from './erros'
import { discoDa, gb, livreNoDisco, tamanhoDaPasta } from './espaco'
import { impressaoDoLock, requisitosDoLock, versoesDoLock } from './lock'
import { CAMINHO_MAXIMO_DA_PASTA, caminhosDoRuntime, type CaminhosDoRuntime } from './pastas'
import { assinaturaGravada, garantirUv, instalarPythonOficial, uvConfere } from './fontes'
import { ambienteDoUv, rodar, type SaidaDoProcesso } from './uv'

/**
 * O PROTOCOLO DE INSTALACAO do runtime do motor: preparar -> python -> venv ->
 * baixar-torch -> torch -> pacotes -> conferir.
 *
 * Portado do Studio. [recap] Duas diferencas (fontes.ts): o uv e baixado no
 * preparar (nao vem no instalador do Dangai) e o Python e o OFICIAL do
 * python.org (nuget.org, assinatura da PSF conferida), nao o `uv python
 * install`.
 *
 * Sem import do electron: o fetch entra por parametro, e um script Node
 * (teste/v-motor-runtime-instalar.ts) instala de verdade fora do pacote MSIX
 * do Claude, no %LOCALAPPDATA% real.
 *
 * RETOMADA: cada etapa olha o disco ANTES e pula o que ja esta feito (o
 * Python na pasta, o venv com o home certo, o dist-info de cada pacote na
 * versao do lock, a roda ja baixada e conferida). O estado.json e so para a
 * tela ("Parou em 43%"); quem decide o que falta e o disco. Por isso
 * cancelar, cair a internet ou fechar o app no meio nunca estragam nada: o
 * "Continuar" refaz so o que falta.
 *
 * O impressao.json so e gravado no FIM de uma instalacao conferida (tmp +
 * rename). Enquanto existir um estado.json, o motor nao sobe
 * (backendDoRuntime): o venv pode estar pela metade.
 */

export interface OpcoesDoProtocolo {
  /** A pasta do runtime (<...>\motor-runtime). */
  pasta: string
  lock: LockDoRuntime
  variante: VarianteDoMotor
  /** [recap] O uv.exe: <runtime>/uv/uv.exe, baixado no preparar se faltar (ANIRECAP_UV nos testes). */
  uv: string
  fetch: FetchDoMotor
  signal: AbortSignal
  /** resources/motor (ou <repo>/motor): cwd do probe. */
  codigoDoMotor: string
  /** ANIRECAP_MOTOR_DADOS do probe (<userData>/motor). */
  dadosDoMotor: string
  versaoDoApp: string
  gpu: GpuDetectada
  /** Apaga venv/, uv-cache/, estado.json e impressao.json antes (o "Recomecar"). A roda baixada fica. */
  recomecar?: boolean
  /** Atualizacao automatica (so pacotes): vai para o estado.json. */
  automatica?: boolean
  aoAndar(andamento: AndamentoDaInstalacao): void
  /** Eco do log (os testes imprimem). O arquivo e gravado aqui mesmo. */
  log?(linha: string): void
  /** Esperas da descarga (os testes encurtam). */
  esperasDaDescarga?: number[]
}

// ----------------------------------------------------------- o que ha no disco

/** PEP 503: minusculas, qualquer sequencia de - _ . vira um hifen. */
export function nomeNormalizado(nome: string): string {
  return nome.toLowerCase().replace(/[-_.]+/g, '-')
}

/**
 * Os pacotes instalados no site-packages, pelos `<nome>-<versao>.dist-info`
 * (sem subir Python: le uma pasta). nome normalizado -> versao.
 */
export function pacotesInstalados(sitePackages: string): Map<string, string> {
  const mapa = new Map<string, string>()
  let itens: string[]
  try {
    itens = readdirSync(sitePackages)
  } catch {
    return mapa
  }
  for (const item of itens) {
    const m = /^(.+)-([^-]+)\.dist-info$/i.exec(item)
    if (!m) continue
    // Um dist-info sem METADATA e sobra de instalacao interrompida: nao conta.
    if (!existsSync(join(sitePackages, item, 'METADATA'))) continue
    mapa.set(nomeNormalizado(m[1]!), m[2]!)
  }
  return mapa
}

/** O python.exe do Python do lock em <rt>/python, ou null. */
export function pythonDoLock(c: CaminhosDoRuntime, versao: string): string | null {
  let itens: string[]
  try {
    itens = readdirSync(c.python)
  } catch {
    return null
  }
  for (const item of itens) {
    if (!item.toLowerCase().startsWith(`cpython-${versao}-`)) continue
    const exe = join(c.python, item, process.platform === 'win32' ? 'python.exe' : join('bin', 'python3'))
    if (existsSync(exe)) return exe
  }
  return null
}

/** O venv existe, aponta para ESTE Python e e da versao do lock? */
function venvBom(c: CaminhosDoRuntime, python: string | null, versao: string): boolean {
  if (!python || !existsSync(c.pythonDoVenv)) return false
  try {
    const cfg = readFileSync(join(c.venv, 'pyvenv.cfg'), 'utf8')
    const home = /^\s*home\s*=\s*(.+?)\s*$/m.exec(cfg)?.[1]?.replace(/^["']+|["']+$/g, '')
    const ver = /^\s*version_info\s*=\s*(.+?)\s*$/m.exec(cfg)?.[1]
    if (!home || ver !== versao) return false
    // O uv grava o `home` pelo link da versao menor (python/cpython-3.12-windows-x86_64-none,
    // uma juncao para a pasta do 3.12.13): compara o caminho REAL dos dois.
    const real = (p: string): string => {
      try {
        return realpathSync.native(p).toLowerCase()
      } catch {
        return resolve(p).toLowerCase()
      }
    }
    return real(home) === real(resolve(python, '..'))
  } catch {
    return false
  }
}

/** O plano de uma instalacao do zero: a escala da barra (os pesos) e sempre esta. */
function planoCheio(lock: LockDoRuntime, variante: VarianteDoMotor): PlanoDaInstalacao {
  return {
    python: true,
    venv: true,
    rodas: lock.torch[variante].map((roda) => ({ roda, instalada: false, baixada: 0 })),
    pacotesFaltando: lock.pacotes,
    pacotesSobrando: [],
    bytesParaBaixar: 0,
    discoQueFalta: 0,
  }
}

export interface PlanoDaInstalacao {
  /** Falta instalar o Python do lock. */
  python: boolean
  /** Falta criar (ou refazer) o venv. */
  venv: boolean
  rodas: { roda: RodaDoTorch; instalada: boolean; baixada: number }[]
  pacotesFaltando: PacoteDoLock[]
  /** Instalados que o lock nao tem (versao velha removida do lock, o Qt do dev...). */
  pacotesSobrando: string[]
  bytesParaBaixar: number
  /** Quanto o disco ainda vai crescer (sem a folga). */
  discoQueFalta: number
}

/** O tamanho do que ja esta em <baixando> para esta roda (o .whl conferido ou a parte com a meta certa). */
function jaBaixado(c: CaminhosDoRuntime, roda: RodaDoTorch): number {
  const final = join(c.baixando, roda.arquivo)
  try {
    if (statSync(final).size === roda.bytes) return roda.bytes
  } catch {
    // sem .whl
  }
  try {
    const meta = JSON.parse(readFileSync(`${final}.part.json`, 'utf8')) as { url?: string; sha256?: string; bytes?: number }
    if (meta.url !== roda.url || meta.sha256 !== roda.sha256 || meta.bytes !== roda.bytes) return 0
    return Math.min(roda.bytes, statSync(`${final}.part`).size)
  } catch {
    return 0
  }
}

/** O que falta, olhando so o disco. Barato (le duas pastas): a tela pede a cada estado. */
export function planoDaInstalacao(pasta: string, lock: LockDoRuntime, variante: VarianteDoMotor): PlanoDaInstalacao {
  const c = caminhosDoRuntime(pasta)
  const python = pythonDoLock(c, lock.python)
  const venv = !venvBom(c, python, lock.python)
  const instalados = venv ? new Map<string, string>() : pacotesInstalados(c.sitePackages)
  const rodas = lock.torch[variante].map((roda) => {
    const instalada = instalados.get(nomeNormalizado(roda.nome)) === roda.versao
    return { roda, instalada, baixada: instalada ? roda.bytes : jaBaixado(c, roda) }
  })
  const pacotesFaltando = lock.pacotes.filter((p) => instalados.get(nomeNormalizado(p.nome)) !== p.versao)
  const conhecidos = new Set([...lock.pacotes.map((p) => nomeNormalizado(p.nome)), ...rodas.map((r) => nomeNormalizado(r.roda.nome))])
  const pacotesSobrando = [...instalados.keys()].filter((n) => !conhecidos.has(n))
  const rodasPorBaixar = rodas.filter((r) => !r.instalada).reduce((s, r) => s + (r.roda.bytes - r.baixada), 0)
  const pacotesPorBaixar = pacotesFaltando.reduce((s, p) => s + p.bytes, 0)
  const torchFalta = rodas.some((r) => !r.instalada)
  // Os modelos da 1a analise vao para <runtime>/modelos (HF_HOME): contam no espaco da instalacao nova.
  const modelosFaltam = torchFalta && !existsSync(c.modelos)
  // [recap] O uv vem na instalacao (fontes.ts): falta enquanto o <runtime>/uv/uv.exe nao existir.
  const uvFalta = !existsSync(join(c.uv, 'uv.exe'))
  return {
    python: !python,
    venv,
    rodas,
    pacotesFaltando,
    pacotesSobrando,
    bytesParaBaixar: (python ? 0 : lock.pythonOficial.bytes) + (uvFalta ? lock.uv.bytes : 0) + rodasPorBaixar + pacotesPorBaixar,
    discoQueFalta:
      (python ? 0 : DISCO_DO_PYTHON) +
      (torchFalta ? DISCO_DO_TORCH[variante] : 0) +
      rodasPorBaixar +
      pacotesPorBaixar * FATOR_DOS_PACOTES +
      (modelosFaltam ? DISCO_DOS_MODELOS : 0),
  }
}

// ------------------------------------------------------------ estado.json

export function lerEstadoGravado(c: CaminhosDoRuntime): EstadoGravado | null {
  try {
    const j = JSON.parse(readFileSync(c.estado, 'utf8')) as Partial<EstadoGravado>
    if (j.formato !== 1 || (j.variante !== 'cu128' && j.variante !== 'cpu') || typeof j.alvo !== 'string') return null
    return {
      formato: 1,
      alvo: j.alvo,
      variante: j.variante,
      etapasFeitas: Array.isArray(j.etapasFeitas) ? j.etapasFeitas.filter((e) => ETAPAS_DA_INSTALACAO.includes(e)) : [],
      fracao: typeof j.fracao === 'number' ? Math.min(1, Math.max(0, j.fracao)) : 0,
      cancelado: j.cancelado === true,
      erro: j.erro && typeof j.erro.mensagem === 'string' ? j.erro : null,
      iniciadoEm: typeof j.iniciadoEm === 'string' ? j.iniciadoEm : new Date().toISOString(),
      atualizadoEm: typeof j.atualizadoEm === 'string' ? j.atualizadoEm : new Date().toISOString(),
      ...(j.etapa && ETAPAS_DA_INSTALACAO.includes(j.etapa) ? { etapa: j.etapa } : {}),
      ...(j.automatica ? { automatica: true } : {}),
    }
  } catch {
    return null
  }
}

/** Grava o estado.json por cima do que havia (tmp + rename). Nunca lanca: e so para a tela. */
export function gravarEstadoGravado(c: CaminhosDoRuntime, parcial: Partial<EstadoGravado> & Pick<EstadoGravado, 'alvo' | 'variante'>): void {
  try {
    const antes = lerEstadoGravado(c)
    const agora = new Date().toISOString()
    const e: EstadoGravado = {
      formato: 1,
      etapasFeitas: [],
      fracao: 0,
      cancelado: false,
      erro: null,
      iniciadoEm: antes?.alvo === parcial.alvo ? antes.iniciadoEm : agora,
      ...(antes?.alvo === parcial.alvo ? antes : {}),
      ...parcial,
      atualizadoEm: agora,
    }
    const tmp = `${c.estado}.tmp`
    writeFileSync(tmp, `${JSON.stringify(e, null, 2)}\n`, 'utf8')
    renameSync(tmp, c.estado)
  } catch {
    // pasta sumiu: a tela fica sem a fracao, nada mais
  }
}

// ---------------------------------------------------------------- a trava

function pidVivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as { code?: string }).code === 'EPERM'
  }
}

/** A trava esta com OUTRO processo vivo (que renovou ha menos de 90 s)? */
export function travaDeOutro(c: CaminhosDoRuntime): number | null {
  try {
    const j = JSON.parse(readFileSync(c.trava, 'utf8')) as { pid?: unknown }
    const pid = typeof j.pid === 'number' ? j.pid : null
    if (!pid || pid === process.pid) return null
    if (Date.now() - statSync(c.trava).mtimeMs > 90_000) return null
    return pidVivo(pid) ? pid : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------- andamento

/** Segundos estimados de cada etapa do plano: o peso dela na barra. */
function pesosDoPlano(p: PlanoDaInstalacao): Record<EtapaDaInstalacao, number> {
  const rodasFaltando = p.rodas.filter((r) => !r.instalada)
  const s: Record<EtapaDaInstalacao, number> = {
    preparar: 1,
    python: p.python ? 15 : 0,
    venv: p.venv ? 3 : 0,
    'baixar-torch': rodasFaltando.reduce((t, r) => t + (r.roda.bytes - r.baixada), 0) / 12e6,
    torch: rodasFaltando.reduce((t, r) => t + r.roda.bytes, 0) / 50e6,
    // + a compilacao do site-packages (sempre; rapida quando ja esta compilado)
    pacotes: p.pacotesFaltando.reduce((t, x) => t + x.bytes, 0) / 8e6 + (p.pacotesFaltando.length ? 15 : 0) + 15,
    conferir: 25,
  }
  const total = Object.values(s).reduce((a, b) => a + b, 0)
  for (const k of ETAPAS_DA_INSTALACAO) s[k] = s[k] / total
  return s
}

/** "1,2 MiB" do uv -> bytes. */
function bytesDoUv(numero: string, unidade: string): number {
  const n = Number.parseFloat(numero)
  const u = unidade.toLowerCase()
  const fator = u.startsWith('g') ? 1024 ** 3 : u.startsWith('m') ? 1024 ** 2 : u.startsWith('k') ? 1024 : 1
  return Number.isFinite(n) ? n * fator : 0
}

/** A frase da tela quando o uv falha em cada passo (o detalhe vai no tooltip). */
const FRASE_DO_UV: Record<string, string> = {
  'uv venv': 'Nao deu para criar o ambiente do motor. Veja o log e clique em Continuar.',
  'uv pip install (torch)': 'A instalacao do torch falhou. Veja o log e clique em Continuar.',
}

/**
 * As linhas do ERRO do uv: da primeira "error:" em diante (o uv poe a causa
 * nas "Caused by:" de baixo). Sem elas, a cauda. Procurar "network" no log
 * inteiro achava o "Downloading networkx" de toda instalacao nova, e qualquer
 * falha de pacote virava "Sem internet".
 */
export function linhasDoErroDoUv(linhas: readonly string[]): string[] {
  const i = linhas.findIndex((l) => /^\s*(error|erro)\s*:/i.test(l) || /^\s*Caused by:/i.test(l))
  return i >= 0 ? linhas.slice(i) : linhas.slice(-10)
}

/** O porque de um uv que saiu com erro, pelo texto do erro (nao pelo log inteiro). */
export function erroDoUv(saida: SaidaDoProcesso, oQue: string): FalhaDaInstalacao {
  const cauda = saida.linhas.slice(-10).join('\n')
  const texto = linhasDoErroDoUv(saida.linhas).join('\n')
  if (saida.codigo === null && ehBloqueio(texto)) return falha('antivirus', `${oQue}\n${cauda}`)
  if (ehSemEspaco(new Error(texto))) return falha('sem-espaco', cauda)
  if (ehArquivoPreso(texto)) {
    return falha('antivirus', `${oQue}\n${cauda}`, 'Um arquivo do motor ficou preso (antivirus?). Clique em Continuar.')
  }
  if (ehDeRede(new Error(texto))) return falha('sem-internet', cauda)
  return falha('uv', `${oQue} (codigo ${saida.codigo ?? 'nenhum'})\n${cauda}`, FRASE_DO_UV[oQue])
}

/**
 * O que a conferencia roda no Python do runtime (cwd = o codigo do motor): os
 * pacotes, os MODULOS do motor que o Studio usa (app.pipeline puxa todo o
 * reconhecimento; app.rostos, o da Edicao rapida) e uma conta na GPU. Com a
 * lista fixa so dos pacotes, um import novo no codigo do motor sem o pacote no
 * lock passava por "pronto" e a 1a analise morria com ImportError.
 */
const SCRIPT_DA_CONFERENCIA = [
  'import json, sys',
  'r = {"python": sys.version.split()[0]}',
  'import numpy, cv2, torch, torchvision, open_clip, ultralytics, onnxruntime, scenedetect',
  'import app.headless, app.pipeline, app.rostos',
  'r["torch"] = torch.__version__',
  'r["cuda"] = torch.version.cuda',
  'r["gpu"] = None',
  'r["cudaOk"] = False',
  'if torch.cuda.is_available():',
  '    r["gpu"] = torch.cuda.get_device_name(0)',
  '    try:',
  '        x = torch.ones(1024, device="cuda") * 2',
  '        torch.cuda.synchronize()',
  '        r["cudaOk"] = float(x.sum().item()) == 2048.0',
  '    except Exception as e:',
  '        r["erroCuda"] = str(e)[:300]',
  'print("CONFERENCIA " + json.dumps(r), flush=True)',
].join('\n')

/** O limite de cada passo da conferencia (a 1a carga do torch). Estourar e 'demorou', nao import que falhou. */
const LIMITE_DA_CONFERENCIA_MS = 300_000

/** So a conta na GPU (reconferirCuda): o torch e uma soma. */
const SCRIPT_DA_CUDA = [
  'import json, torch',
  'r = {"gpu": None, "cudaOk": False}',
  'if torch.cuda.is_available():',
  '    r["gpu"] = torch.cuda.get_device_name(0)',
  '    try:',
  '        x = torch.ones(1024, device="cuda") * 2',
  '        torch.cuda.synchronize()',
  '        r["cudaOk"] = float(x.sum().item()) == 2048.0',
  '    except Exception as e:',
  '        r["erroCuda"] = str(e)[:300]',
  'print("CUDA " + json.dumps(r), flush=True)',
].join('\n')

/**
 * Refaz SO a conta na GPU de um runtime cu128 ja instalado (o driver mudou: a
 * tela pedia para atualizar, e antes so o Reinstalar, com 3 GB, reavaliava).
 * null = nao deu para medir (o Python nao rodou): fica o que estava.
 */
export async function reconferirCuda(pasta: string, signal: AbortSignal): Promise<{ cudaOk: boolean; gpu: string | null } | null> {
  const c = caminhosDoRuntime(pasta)
  if (!existsSync(c.pythonDoVenv)) return null
  const py = pythonDoMotor(c.pythonDoVenv)
  const r = await rodar(py.cmd, ['-c', SCRIPT_DA_CUDA], {
    env: { ...ambienteDoRuntime(process.env, { cudaOk: true, modelos: c.modelos }), ...py.env },
    cwd: c.pasta,
    signal,
    log: () => {},
    limiteMs: LIMITE_DA_CONFERENCIA_MS,
  }).catch(() => null)
  const linha = r?.linhas.find((l) => l.startsWith('CUDA '))
  if (!r || r.codigo !== 0 || !linha) return null
  try {
    const j = JSON.parse(linha.slice('CUDA '.length)) as { cudaOk?: unknown; gpu?: unknown }
    return { cudaOk: j.cudaOk === true, gpu: typeof j.gpu === 'string' ? j.gpu : null }
  } catch {
    return null
  }
}

export interface ResultadoDaConferencia {
  python: string
  torch: string
  cuda: string | null
  gpu: string | null
  cudaOk: boolean
  erroCuda?: string
}

// ---------------------------------------------------------------- instalar

/**
 * Instala, continua ou atualiza o runtime. Devolve a impressao gravada.
 * Lanca FalhaDaInstalacao (com o tipo para a tela) ou InstalacaoCancelada;
 * quem chama grava o erro/cancelado no estado.json (gravarEstadoGravado).
 */
export async function instalarRuntime(o: OpcoesDoProtocolo): Promise<ImpressaoGravada> {
  const c = caminhosDoRuntime(o.pasta)
  const alvo = impressaoDoLock(o.lock, o.variante)
  let log: WriteStream | null = null
  const escrever = (linha: string): void => {
    const t = new Date().toISOString().slice(11, 19)
    log?.write(`[${t}] ${linha}\n`)
    o.log?.(linha)
  }

  let etapa: EtapaDaInstalacao = 'preparar'
  let pesos: Record<EtapaDaInstalacao, number> | null = null
  let feito = 0
  let ultimaFracao = 0
  const etapasFeitas: EtapaDaInstalacao[] = []
  const andar = (fracaoDaEtapa: number, mensagem: string, extra: Partial<AndamentoDaInstalacao> = {}): void => {
    const peso = pesos?.[etapa] ?? 0
    const f = Math.min(0.999, feito + peso * Math.min(1, Math.max(0, fracaoDaEtapa)))
    ultimaFracao = Math.max(ultimaFracao, f)
    o.aoAndar({ etapa, fracao: ultimaFracao, mensagem, ...extra })
  }
  const terminar = (e: EtapaDaInstalacao): void => {
    feito += pesos?.[e] ?? 0
    ultimaFracao = Math.max(ultimaFracao, Math.min(0.999, feito))
    etapasFeitas.push(e)
    gravarEstadoGravado(c, { alvo, variante: o.variante, etapasFeitas: [...etapasFeitas], fracao: ultimaFracao, etapa: e, cancelado: false, erro: null })
  }
  const comecar = (e: EtapaDaInstalacao, mensagem: string): void => {
    etapa = e
    escrever(`== ${e}: ${mensagem}`)
    andar(0, mensagem)
  }
  /** Andamento pelo relogio, para as etapas sem medida (o uv nao diz quanto falta): ate 95%. */
  const relogio = (estimadoS: number, mensagem: string): (() => void) => {
    const inicio = Date.now()
    const t = setInterval(() => {
      const s = (Date.now() - inicio) / 1000
      andar(0.95 * (1 - Math.exp(-s / Math.max(1, estimadoS))), mensagem)
    }, 500)
    return () => clearInterval(t)
  }
  const ambienteUv = ambienteDoUv(c)
  const uv = (args: string[], aoLinha?: (linha: string) => void, limiteMs?: number): Promise<SaidaDoProcesso> => {
    escrever(`$ uv ${args.join(' ')}`)
    return rodar(o.uv, args, { env: ambienteUv, signal: o.signal, log: (l) => escrever(`  ${l}`), aoLinha, limiteMs })
  }

  let batida: NodeJS.Timeout | null = null
  try {
    // ------------------------------------------------------------ 0 preparar
    if (process.platform !== 'win32' || process.arch !== 'x64') throw falha('sistema', `${process.platform}-${process.arch}`)
    if (c.pasta.length > CAMINHO_MAXIMO_DA_PASTA) {
      throw falha('pasta', c.pasta, `O caminho da pasta do motor e longo demais (maximo ${CAMINHO_MAXIMO_DA_PASTA} letras). Escolha outra pasta.`)
    }
    try {
      await mkdir(join(c.pasta, 'logs'), { recursive: true })
      const prova = join(c.pasta, `.prova-${process.pid}`)
      await writeFile(prova, 'ok')
      await rm(prova, { force: true })
    } catch (e) {
      throw falha('pasta', `${c.pasta}: ${e instanceof Error ? e.message : String(e)}`, `Nao deu para gravar em ${c.pasta}. Escolha outra pasta.`)
    }
    const outro = travaDeOutro(c)
    if (outro) throw falha('ocupado', `pid ${outro}`)
    writeFileSync(c.trava, JSON.stringify({ pid: process.pid, desde: new Date().toISOString() }), 'utf8')
    // Renova a trava: uma trava parada ha 90 s e de um processo que morreu sem soltar.
    batida = setInterval(() => {
      try {
        const agora = new Date()
        utimesSync(c.trava, agora, agora)
      } catch {
        // pasta sumiu
      }
    }, 20_000)

    // O log da instalacao: um arquivo so, com as tentativas em sequencia (cortado quando passa de 5 MB).
    try {
      if (statSync(c.log).size > 5e6) await rm(c.log, { force: true })
    } catch {
      // sem log ainda
    }
    log = createWriteStream(c.log, { flags: 'a' })
    escrever(`==== Dangai ${o.versaoDoApp} (recap): instalar o motor (${o.variante}) em ${c.pasta}`)
    escrever(`GPU: ${o.gpu.nome ?? 'nenhuma NVIDIA'}${o.gpu.driver ? ` (driver ${o.gpu.driver})` : ''} [${o.gpu.fonte}]`)
    etapa = 'preparar'
    // A barra e na escala da instalacao INTEIRA (pesosDoPlano do plano cheio): o
    // "Continuar" segue de onde parou, nunca volta para perto de zero.
    const antes = o.recomecar ? null : lerEstadoGravado(c)
    if (antes?.alvo === alvo) ultimaFracao = Math.min(0.99, antes.fracao)
    o.aoAndar({ etapa, fracao: ultimaFracao, mensagem: 'Preparando' })

    if (o.recomecar) {
      escrever('recomecar: apagando venv, uv-cache, estado e impressao')
      /*
       * O venv sai por RENAME primeiro: com o motor rodando (uma .pyd/.dll do
       * torch carregada) o Windows recusa o rename e nada fica pela metade. O
       * rm direto apagava o site-packages em ordem alfabetica ate esbarrar no
       * arquivo preso, e a analise em andamento quebrava no proximo import.
       * A roda baixada (baixando/) fica: ja foi conferida pelo sha256, e
       * recomecar nao precisa de mais 2,7 GB.
       */
      if (existsSync(c.venv)) {
        const lixo = `${c.venv}.apagar-${Date.now()}`
        try {
          renameSync(c.venv, lixo)
        } catch (e) {
          const codigo = (e as { code?: string }).code
          if (codigo === 'EPERM' || codigo === 'EBUSY' || codigo === 'EACCES') {
            throw falha('ocupado', `${c.venv}: ${codigo}`, 'O motor esta em uso. Espere a analise terminar e tente de novo.')
          }
          throw e
        }
        await rm(lixo, { recursive: true, force: true })
      }
      for (const p of [c.uvCache, c.estado, c.impressao]) await rm(p, { recursive: true, force: true })
    }
    // Restos de um venv de um Recomecar que o app fechou no meio.
    for (const item of await readdir(c.pasta).catch(() => [] as string[])) {
      if (item.startsWith('venv.apagar-')) await rm(join(c.pasta, item), { recursive: true, force: true }).catch(() => {})
    }
    // Restos de um uv-cache que ficou para apagar depois (o fim renomeia e apaga por tras).
    for (const item of await readdir(c.pasta).catch(() => [] as string[])) {
      if (item.startsWith('uv-cache.apagar')) await rm(join(c.pasta, item), { recursive: true, force: true }).catch(() => {})
    }

    // Partes de rodas que este lock nao usa (outra variante, versao velha) so ocupam disco.
    // [recap] O .nupkg do Python e o zip do uv baixando tambem ficam (retomada).
    const daVez = new Set(
      [...o.lock.torch[o.variante], o.lock.pythonOficial, o.lock.uv].flatMap((r) => [r.arquivo, `${r.arquivo}.part`, `${r.arquivo}.part.json`]),
    )
    for (const item of await readdir(c.baixando).catch(() => [] as string[])) {
      if (!daVez.has(item)) await rm(join(c.baixando, item), { recursive: true, force: true })
    }

    let plano = planoDaInstalacao(c.pasta, o.lock, o.variante)
    pesos = pesosDoPlano(planoCheio(o.lock, o.variante))
    escrever(
      `plano: python ${plano.python ? 'instalar' : 'ok'}, venv ${plano.venv ? 'criar' : 'ok'}, ` +
        `rodas ${plano.rodas.map((r) => `${r.roda.nome}=${r.instalada ? 'ok' : `${r.baixada}/${r.roda.bytes}`}`).join(' ')}, ` +
        `pacotes faltando ${plano.pacotesFaltando.length}, sobrando ${plano.pacotesSobrando.length}, baixar ${gb(plano.bytesParaBaixar)}`,
    )
    const livre = await livreNoDisco(c.pasta)
    const precisa = plano.discoQueFalta + FOLGA_DE_DISCO
    escrever(`disco: livre ${livre === null ? '?' : gb(livre)}, precisa ${gb(precisa)}`)
    if (livre !== null && livre < precisa) {
      throw falha(
        'sem-espaco',
        `livre ${gb(livre)} em ${discoDa(c.pasta)}, precisa de ${gb(precisa)}`,
        `Falta espaco: precisa de ${gb(precisa)} livres em ${discoDa(c.pasta)} (tem ${gb(livre)}).`,
      )
    }
    gravarEstadoGravado(c, { alvo, variante: o.variante, cancelado: false, erro: null, ...(o.automatica ? { automatica: true } : {}) })

    /*
     * [recap] O uv: baixado aqui (fontes.ts), da release oficial, conferido
     * pelo sha256 do zip e do exe. ANIRECAP_UV (testes) usa o que esta la.
     */
    if (!process.env['ANIRECAP_UV'] && !uvConfere(c, o.lock)) {
      andar(0, 'Baixando o uv')
      await garantirUv(c, o.lock, {
        fetch: o.fetch,
        signal: o.signal,
        log: escrever,
        aoAndar: (n, total) => andar(n / Math.max(1, total), 'Baixando o uv'),
        ...(o.esperasDaDescarga ? { esperasDaDescarga: o.esperasDaDescarga } : {}),
      })
    }
    if (!existsSync(o.uv)) throw falha('uv-ausente', o.uv)
    // 2 min: o antivirus examina o uv.exe (nao assinado) na 1a vez antes de deixar rodar.
    const versao = await uv(['--version'], undefined, 120_000)
    const versaoDoUv = versao.stdout.trim()
    /*
     * O uv EXISTE mas nao rodou (spawn recusado, tempo estourado, saiu sem
     * dizer a versao): e o antivirus ou o Smart App Control, nao o app
     * quebrado. "Reinstale o app" nao resolvia e o erro voltava a cada
     * reinstalacao.
     */
    if (versao.codigo !== 0 || !versaoDoUv) {
      throw falha('antivirus', `${o.uv}: ${versao.linhas.slice(-3).join(' | ') || `codigo ${versao.codigo ?? 'nenhum'}`}`)
    }
    if (!versaoDoUv.startsWith(`uv ${o.lock.uv.versao}`)) {
      throw falha('uv-ausente', `${o.uv}: ${versaoDoUv} (esperado uv ${o.lock.uv.versao})`)
    }
    terminar('preparar')

    // -------------------------------------------------------------- 1 python
    // [recap] O Python OFICIAL (nuget.org): baixa, extrai, confere a assinatura da PSF.
    let pythonExe = pythonDoLock(c, o.lock.python)
    if (!pythonExe) {
      comecar('python', 'Baixando o Python')
      const r = await instalarPythonOficial(c, o.lock, {
        fetch: o.fetch,
        signal: o.signal,
        log: escrever,
        aoAndar: (n, total) => andar(0.8 * (n / Math.max(1, total)), n >= total ? 'Conferindo o Python' : 'Baixando o Python'),
        ...(o.esperasDaDescarga ? { esperasDaDescarga: o.esperasDaDescarga } : {}),
      })
      pythonExe = pythonDoLock(c, o.lock.python)
      if (!pythonExe || resolve(pythonExe).toLowerCase() !== resolve(r.exe).toLowerCase()) {
        throw falha('uv', `o Python ${o.lock.python} nao apareceu em ${c.python}`)
      }
    }
    const assinatura = assinaturaGravada(pythonExe)
    escrever(`python: ${pythonExe} (${assinatura ? `${assinatura.status}, ${assinatura.assinante}` : 'sem assinatura gravada'})`)
    terminar('python')

    // ---------------------------------------------------------------- 2 venv
    if (plano.venv) {
      comecar('venv', 'Criando o ambiente')
      await rm(c.venv, { recursive: true, force: true })
      const r = await uv(['venv', c.venv, '--python', pythonExe, '--no-project'], undefined, 120_000)
      if (r.codigo !== 0) throw erroDoUv(r, 'uv venv')
      if (!existsSync(c.pythonDoVenv)) throw falha('uv', `o venv nao tem ${c.pythonDoVenv}`)
      // Venv novo: tudo que estava no velho sumiu junto.
      plano = planoDaInstalacao(c.pasta, o.lock, o.variante)
    }
    terminar('venv')

    // -------------------------------------------------------- 3 baixar-torch
    const rodasFaltando = plano.rodas.filter((r) => !r.instalada)
    const arquivos: string[] = []
    if (rodasFaltando.length) {
      comecar('baixar-torch', 'Baixando torch')
      const total = rodasFaltando.reduce((s, r) => s + r.roda.bytes, 0)
      // Na escala da etapa cheia: as rodas ja instaladas contam como baixadas.
      const todas = Math.max(1, o.lock.torch[o.variante].reduce((s, r) => s + r.bytes, 0))
      const jaInstaladas = plano.rodas.filter((r) => r.instalada).reduce((s, r) => s + r.roda.bytes, 0)
      const noDisco = new Map(rodasFaltando.map((r) => [r.roda.arquivo, r.baixada]))
      // Velocidade: a media dos ultimos ~3 s.
      const amostras: { t: number; b: number }[] = []
      let ultimo = 0
      for (const { roda } of rodasFaltando) {
        const caminho = await baixarRoda(roda, c.baixando, {
          fetch: o.fetch,
          signal: o.signal,
          log: escrever,
          ...(o.esperasDaDescarga ? { esperas: o.esperasDaDescarga } : {}),
          aoConferir: () => andar(1, 'Conferindo o download'),
          aoAndar: (n) => {
            noDisco.set(roda.arquivo, n)
            const agora = Date.now()
            if (agora - ultimo < 250) return
            ultimo = agora
            const baixados = [...noDisco.values()].reduce((s, x) => s + x, 0)
            amostras.push({ t: agora, b: baixados })
            while (amostras.length > 2 && agora - amostras[0]!.t > 3000) amostras.shift()
            const a = amostras[0]!
            const bytesPorSegundo = agora > a.t ? ((baixados - a.b) * 1000) / (agora - a.t) : 0
            andar((jaInstaladas + baixados) / todas, `Baixando ${roda.nome}`, {
              baixados,
              total,
              ...(bytesPorSegundo > 0 ? { bytesPorSegundo } : {}),
            })
          },
        })
        arquivos.push(caminho)
      }
    }
    terminar('baixar-torch')

    // --------------------------------------------------------------- 4 torch
    if (arquivos.length) {
      comecar('torch', 'Instalando torch')
      const estimado = rodasFaltando.reduce((s, r) => s + r.roda.bytes, 0) / 50e6
      const parar = relogio(estimado, 'Instalando torch')
      try {
        const r = await uv(['pip', 'install', '--python', c.pythonDoVenv, '--no-deps', '--no-index', ...arquivos])
        if (r.codigo !== 0) {
          const erro = erroDoUv(r, 'uv pip install (torch)')
          /*
           * Uma roda que o uv nao abre (estragou no disco depois de conferida)
           * travaria o "Continuar" para sempre. Mas o caso comum e passageiro
           * (antivirus segurando uma DLL recem-extraida, disco que encheu): ai a
           * roda de 2,7 GB nao tem culpa. So apaga a roda cujo sha256 nao bate
           * mais (~10 s por roda), e nunca em disco cheio nem arquivo preso.
           */
          if (!o.signal.aborted && erro.tipo !== 'sem-espaco' && erro.tipo !== 'antivirus') {
            for (const { roda } of rodasFaltando) {
              const a = join(c.baixando, roda.arquivo)
              if (!existsSync(a)) continue
              const hash = await sha256DoArquivo(a, o.signal).catch(() => null)
              if (hash !== roda.sha256) {
                escrever(`a roda ${roda.arquivo} nao confere mais (sha256 ${hash ?? '?'}): apagando`)
                await rm(a, { force: true })
              }
            }
          }
          throw erro
        }
      } finally {
        parar()
      }
      const instalados = pacotesInstalados(c.sitePackages)
      for (const { roda } of rodasFaltando) {
        if (instalados.get(nomeNormalizado(roda.nome)) !== roda.versao) throw falha('uv', `${roda.nome} ${roda.versao} nao ficou instalado`)
      }
      // Instalado: a roda de 2,7 GB nao serve mais (o uv ja ligou os arquivos no venv).
      for (const a of arquivos) await rm(a, { force: true })
    }
    terminar('torch')

    // ------------------------------------------------------------- 5 pacotes
    comecar('pacotes', plano.pacotesFaltando.length ? 'Instalando pacotes' : 'Conferindo pacotes')
    if (plano.pacotesFaltando.length) {
      await mkdir(join(c.requisitos, '..'), { recursive: true })
      await writeFile(c.requisitos, requisitosDoLock(o.lock), 'utf8')
      const porNome = new Map(o.lock.pacotes.map((p) => [nomeNormalizado(p.nome), p]))
      const totalBytes = Math.max(1, plano.pacotesFaltando.reduce((s, p) => s + p.bytes, 0))
      const estimado = totalBytes / 8e6 + 15
      let baixados = 0
      let porBytes = 0
      let porTempo = 0
      const contados = new Set<string>()
      const mostrar = (): void => andar(Math.max(porBytes, porTempo), 'Instalando pacotes')
      const inicio = Date.now()
      const t = setInterval(() => {
        porTempo = 0.6 * (1 - Math.exp(-(Date.now() - inicio) / 1000 / estimado))
        mostrar()
      }, 500)
      try {
        const r = await uv(
          ['pip', 'install', '--python', c.pythonDoVenv, '--no-deps', '--require-hashes', '--index-url', o.lock.indice, '-r', c.requisitos],
          (linha) => {
            // O uv sem terminal escreve "Downloading numpy (12.0MiB)" / " Downloaded numpy" para os grandes
            // e "Prepared N packages" / "Installed N packages" no fim.
            const baixou = /^\s*Downloaded\s+(\S+)/.exec(linha)
            if (baixou) {
              const nome = nomeNormalizado(baixou[1]!)
              if (!contados.has(nome)) {
                contados.add(nome)
                baixados += porNome.get(nome)?.bytes ?? 0
                porBytes = 0.85 * Math.min(1, baixados / totalBytes)
                mostrar()
              }
              return
            }
            const baixando = /^\s*Downloading\s+(\S+)\s+\(([\d.]+)\s*([KMG]i?B|B)\)/.exec(linha)
            if (baixando && !porNome.has(nomeNormalizado(baixando[1]!))) escrever(`  (fora do lock: ${baixando[1]} ${gb(bytesDoUv(baixando[2]!, baixando[3]!))})`)
            if (/^\s*Prepared \d+ packages?/i.test(linha)) {
              porBytes = Math.max(porBytes, 0.85)
              mostrar()
            }
            if (/^\s*Installed \d+ packages?/i.test(linha)) {
              porBytes = Math.max(porBytes, 0.9)
              mostrar()
            }
          },
        )
        if (r.codigo !== 0) throw erroDoUv(r, 'uv pip install (pacotes)')
      } finally {
        clearInterval(t)
      }
    }
    // O que o lock nao tem mais (atualizacao do app que tirou um pacote) sai.
    const conhecidos = new Set([...o.lock.pacotes.map((p) => nomeNormalizado(p.nome)), ...o.lock.torch[o.variante].map((r) => nomeNormalizado(r.nome))])
    const instalados = pacotesInstalados(c.sitePackages)
    const sobrando = [...instalados.keys()].filter((n) => !conhecidos.has(n))
    if (sobrando.length) {
      const r = await uv(['pip', 'uninstall', '--python', c.pythonDoVenv, ...sobrando])
      if (r.codigo !== 0) throw erroDoUv(r, 'uv pip uninstall')
    }
    const faltando = o.lock.pacotes.filter((p) => pacotesInstalados(c.sitePackages).get(nomeNormalizado(p.nome)) !== p.versao)
    if (faltando.length) throw falha('uv', `nao ficaram instalados: ${faltando.map((p) => `${p.nome}==${p.versao}`).join(', ')}`)
    // O pip check so vai para o log: dependencia que faltar aparece na conferencia (o import), que e o que vale.
    const check = await uv(['pip', 'check', '--python', c.pythonDoVenv], undefined, 120_000)
    if (check.codigo !== 0) escrever(`AVISO: uv pip check saiu com ${check.codigo}`)

    // O motor roda com PYTHONDONTWRITEBYTECODE (nada gravado na pasta de instalacao):
    // o site-packages compilado AQUI evita o import lento do torch a cada analise.
    // O compileall pula o que ja esta compilado, entao o "Continuar" sai barato.
    andar(0.92, 'Compilando')
    {
      const py = pythonDoMotor(c.pythonDoVenv)
      const parar = relogio(15, 'Compilando')
      try {
        const env = { ...ambienteDoRuntime(process.env, { cudaOk: true, modelos: c.modelos }), ...py.env }
        delete env['PYTHONDONTWRITEBYTECODE']
        escrever(`$ python -m compileall -q -j 0 ${c.sitePackages}`)
        const r = await rodar(py.cmd, ['-W', 'ignore', '-m', 'compileall', '-q', '-j', '0', c.sitePackages], {
          env,
          cwd: c.pasta,
          signal: o.signal,
          log: (l) => escrever(`  ${l}`),
          limiteMs: 15 * 60_000,
        })
        // Arquivo de exemplo com sintaxe de Python 2 em algum pacote nao e erro da instalacao.
        if (r.codigo !== 0) escrever(`AVISO: compileall saiu com ${r.codigo}`)
      } finally {
        parar()
      }
    }
    terminar('pacotes')

    // ------------------------------------------------------------ 6 conferir
    comecar('conferir', 'Conferindo o motor')
    const conferencia = await conferir(c, o, escrever)
    terminar('conferir')

    // ------------------------------------------------------------------ fim
    const bytesNoDisco = (await tamanhoDaPasta(c.python)) + (await tamanhoDaPasta(c.uv)) + (await tamanhoDaPasta(c.venv)) + (await tamanhoDaPasta(c.modelos))
    const gravada: ImpressaoGravada = {
      formato: 1,
      impressao: alvo,
      variante: o.variante,
      python: o.lock.python,
      ...versoesDoLock(o.lock, o.variante),
      cudaOk: conferencia.cudaOk,
      gpu: conferencia.gpu,
      driver: o.gpu.driver,
      uv: versaoDoUv.replace(/^uv\s+/, '').split(/\s/)[0] ?? o.lock.uv.versao,
      app: o.versaoDoApp,
      instaladoEm: new Date().toISOString(),
      bytesNoDisco,
      ...(assinatura ? { assinatura } : {}),
    }
    const tmp = `${c.impressao}.tmp`
    await writeFile(tmp, `${JSON.stringify(gravada, null, 2)}\n`, 'utf8')
    await rename(tmp, c.impressao)
    await rm(c.estado, { force: true })
    await rm(c.baixando, { recursive: true, force: true })
    // O uv-cache tem dezenas de milhares de hardlinks: renomeia agora (o venv
    // fica com os dele) e apaga por tras. Se o app fechar no meio, o preparar
    // da proxima vez termina.
    if (existsSync(c.uvCache)) {
      const lixo = `${c.uvCache}.apagar-${Date.now()}`
      try {
        renameSync(c.uvCache, lixo)
        void rm(lixo, { recursive: true, force: true }).catch(() => {})
      } catch {
        void rm(c.uvCache, { recursive: true, force: true }).catch(() => {})
      }
    }
    escrever(`==== pronto: ${o.variante}, torch ${conferencia.torch}, GPU ${conferencia.gpu ?? 'nenhuma'} (cudaOk ${conferencia.cudaOk}), ${gb(bytesNoDisco)} no disco`)
    o.aoAndar({ etapa: 'conferir', fracao: 1, mensagem: 'Pronto' })
    return gravada
  } catch (e) {
    escrever(`!! ${etapa}: ${e instanceof Error ? `${e.message}${e instanceof FalhaDaInstalacao && e.detalhe ? `\n${e.detalhe}` : ''}` : String(e)}`)
    // A fracao e a etapa onde parou ficam para o "Parou em 43%".
    if (!(e instanceof FalhaDaInstalacao && (e.tipo === 'ocupado' || e.tipo === 'pasta' || e.tipo === 'sistema'))) {
      if (existsSync(c.pasta)) gravarEstadoGravado(c, { alvo, variante: o.variante, fracao: ultimaFracao, etapa })
    }
    throw e
  } finally {
    if (batida) clearInterval(batida)
    try {
      if (!travaDeOutro(c) && existsSync(c.trava)) {
        const j = JSON.parse(readFileSync(c.trava, 'utf8')) as { pid?: number }
        if (j.pid === process.pid) await rm(c.trava, { force: true })
      }
    } catch {
      // trava torta: a proxima instalacao sobrescreve
    }
    await new Promise<void>((r) => (log ? log.end(r) : r()))
  }
}

/**
 * 6. A conferencia: o Python do runtime importa o que o motor usa e faz uma
 * conta na GPU (placa sem kernel no torch cu128 = cudaOk false, e o motor
 * roda na CPU em vez de quebrar no 1o kernel); depois o `app.headless probe`
 * pelo MESMO caminho do motor.ts (pythonDoMotor + ambienteDoRuntime), que
 * precisa achar o ffmpeg.
 */
async function conferir(c: CaminhosDoRuntime, o: OpcoesDoProtocolo, escrever: (l: string) => void): Promise<ResultadoDaConferencia> {
  const py = pythonDoMotor(c.pythonDoVenv)
  const base: NodeJS.ProcessEnv = { ...process.env, ANIRECAP_MOTOR_DADOS: o.dadosDoMotor }
  escrever(`$ ${py.cmd} -c <conferencia>`)
  // cwd = o codigo do motor: o script importa app.pipeline e app.rostos (PYTHONDONTWRITEBYTECODE: nada gravado la).
  const r = await rodar(py.cmd, ['-c', SCRIPT_DA_CONFERENCIA], {
    env: { ...ambienteDoRuntime(base, { cudaOk: true, modelos: c.modelos }), ...py.env },
    cwd: o.codigoDoMotor,
    signal: o.signal,
    log: (l) => escrever(`  ${l}`),
    limiteMs: LIMITE_DA_CONFERENCIA_MS,
  })
  const linha = r.linhas.find((l) => l.startsWith('CONFERENCIA '))
  let j: ResultadoDaConferencia | null = null
  try {
    j = linha ? (JSON.parse(linha.slice('CONFERENCIA '.length)) as ResultadoDaConferencia) : null
  } catch {
    j = null
  }
  /*
   * Tempo estourado NAO e import que falhou: a 1a carga do torch cu128 com o
   * antivirus examinando ~4 GB de DLLs passa de minutos num HD. O Continuar
   * (que refaz so a conferencia) resolve; o Recomecar baixaria 3 GB de novo
   * para esbarrar no mesmo tempo.
   */
  if (r.codigo === null && r.linhas.some((l) => /^nao terminou em \d+ s$/.test(l))) {
    throw falha('demorou', `a conferencia passou de ${LIMITE_DA_CONFERENCIA_MS / 1000} s\n${r.linhas.slice(-8).join('\n')}`)
  }
  if (r.codigo !== 0 || !j) throw falha('conferencia', `o Python do motor nao importou os pacotes (codigo ${r.codigo ?? 'nenhum'})\n${r.linhas.slice(-8).join('\n')}`)
  const cudaOk = o.variante === 'cu128' && j.cudaOk === true
  if (o.variante === 'cu128' && !cudaOk) escrever(`AVISO: a GPU nao rodou a conta (${j.erroCuda ?? 'cuda indisponivel'}); o motor vai rodar na CPU`)

  escrever(`$ ${py.cmd} -m app.headless probe (cwd ${o.codigoDoMotor})`)
  const p = await rodar(py.cmd, ['-m', 'app.headless', 'probe'], {
    env: { ...ambienteDoRuntime(base, { cudaOk, modelos: c.modelos }), ...py.env },
    cwd: o.codigoDoMotor,
    signal: o.signal,
    log: (l) => escrever(`  ${l}`),
    limiteMs: LIMITE_DA_CONFERENCIA_MS,
  })
  let probe: Record<string, unknown> | null = null
  for (const l of p.linhas) {
    try {
      const ev = JSON.parse(l) as Record<string, unknown>
      if (ev['type'] === 'probe') probe = ev
    } catch {
      // linha de log
    }
  }
  if (!probe && p.codigo === null && p.linhas.some((l) => /^nao terminou em \d+ s$/.test(l))) {
    throw falha('demorou', `o probe passou de ${LIMITE_DA_CONFERENCIA_MS / 1000} s\n${p.linhas.slice(-8).join('\n')}`)
  }
  if (!probe) throw falha('conferencia', `o motor nao respondeu ao probe (codigo ${p.codigo ?? 'nenhum'})\n${p.linhas.slice(-8).join('\n')}`)
  if (probe['ffmpeg'] !== true) throw falha('conferencia', 'o motor nao achou o ffmpeg', 'O motor instalou, mas nao achou o ffmpeg. Reinstale o Dangai.')
  escrever(`conferencia: python ${j.python}, torch ${j.torch}, cuda ${j.cuda ?? '-'}, gpu ${j.gpu ?? '-'}, cudaOk ${cudaOk}, probe ${JSON.stringify(probe)}`)
  return { ...j, cudaOk }
}
