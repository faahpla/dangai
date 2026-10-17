import { z } from 'zod'

/**
 * O RUNTIME DO MOTOR: contrato entre o main (electron/motor-runtime/) e a
 * tela (src/components/motor-runtime/, src/store/motor-runtime.ts). Desenho
 * aprovado pelo Levi em 15/10 no Studio; [recap] no Dangai, parte 4.
 *
 * O instalador do Dangai leva so o CODIGO do motor
 * (resources/modulos/recap/motor, ~2 MB). O RUNTIME -- Python 3.12 + torch +
 * pacotes, ~5 GB no disco -- e o uv sao instalados pela tela do modulo no
 * primeiro uso, das fontes oficiais, em %LOCALAPPDATA%/Dangai/recap/motor-runtime:
 *
 *   motor-runtime/
 *     uv/             o uv da release oficial (astral-sh/uv), pinado no lock (versao + sha256)
 *     python/         o Python OFICIAL do python.org: o pacote "python" do nuget.org, pinado
 *                     por versao + sha256, com o python.exe assinado pela PSF (conferido)
 *     venv/           uv venv: Scripts/python.exe + Lib/site-packages (torch...)
 *     baixando/       as rodas do torch, retomaveis (.part + .part.json); apagadas no fim
 *     uv-cache/       UV_CACHE_DIR: retomada dos pacotes; apagada no fim
 *     req/pacotes.txt o lock em formato pip (com --hash), gerado a cada instalacao
 *     logs/instalar.log  saida do uv e das etapas da ultima instalacao
 *     estado.json     EstadoGravado: a instalacao em andamento (retomada)
 *     impressao.json  ImpressaoGravada: escrito SO no fim de uma instalacao boa
 *     instalando.trava  pid de quem instala (duas janelas nao instalam juntas)
 *
 * Em dev com modulos/recap/motor/.venv a fase e 'dev' e o motor roda nele. Sem o
 * venv (ou com ANIRECAP_MOTOR_RUNTIME=1) o dev usa o runtime, como o instalado.
 */

// ------------------------------------------------------------------ o lock

/** Uma roda do torch, baixada pelo proprio app (retomavel) e conferida pelo sha256. */
export interface RodaDoTorch {
  nome: 'torch' | 'torchvision'
  /** Com o sufixo local: "2.11.0+cu128". */
  versao: string
  arquivo: string
  url: string
  sha256: string
  bytes: number
}

/** Um pacote do PyPI, instalado pelo uv com --no-deps e --require-hashes. */
export interface PacoteDoLock {
  /** Normalizado (PEP 503): minusculas, com hifen. */
  nome: string
  versao: string
  /** Do arquivo que o uv vai preferir no Windows x64 (para a barra e o "~3 GB"). */
  bytes: number
  /** Todos os sha256 que o uv pode encontrar para esta versao. */
  hashes: string[]
}

/**
 * [recap] Um arquivo baixado das fontes oficiais na instalacao (o Python do
 * nuget.org, o zip do uv), pinado: a mesma forma de uma roda, para a mesma
 * descarga com retomada e sha256 (baixar.ts).
 */
export interface ArquivoOficial {
  versao: string
  arquivo: string
  url: string
  sha256: string
  bytes: number
}

/** [recap] O Python oficial: o pacote "python" do nuget.org (a build do python.org). */
export interface PythonOficial extends ArquivoOficial {
  /** Quem assina o python.exe (Authenticode): "Python Software Foundation". */
  assinante: string
}

/** [recap] O uv: o zip da release do astral-sh/uv e o sha256 do uv.exe de dentro. */
export interface UvOficial extends ArquivoOficial {
  sha256Exe: string
}

/**
 * motor/studio-runtime.json, gerado por scripts/motor-lock.mjs a partir do
 * `uv pip freeze` do motor/.venv do dev (sem o Qt). Vai no instalador dentro
 * de resources/modulos/recap/motor.
 */
export interface LockDoRuntime {
  formato: 1
  comentario?: string
  /** "3.12.10": a versao do Python oficial (= pythonOficial.versao). */
  python: string
  /** [recap] De onde vem o Python (nuget.org, assinado pela PSF). */
  pythonOficial: PythonOficial
  /** [recap] De onde vem o uv (baixado na instalacao, nao no instalador do Dangai). */
  uv: UvOficial
  /** https://pypi.org/simple */
  indice: string
  torch: Record<VarianteDoMotor, RodaDoTorch[]>
  pacotes: PacoteDoLock[]
}

// ------------------------------------------------------------- o que grava

/** cu128: NVIDIA (o torch leva o CUDA, 2,7 GB). cpu: sem NVIDIA (120 MB). */
export const varianteDoMotorSchema = z.enum(['cu128', 'cpu'])
export type VarianteDoMotor = z.infer<typeof varianteDoMotorSchema>

/**
 * impressao.json. A `impressao` e o sha256 de
 * {formato, python, variante, rodas [nome, versao], pacotes [nome==versao] em ordem}
 * (impressaoDoLock em electron/services/motor-runtime/lock.ts). Os mapas
 * guardados servem para dizer O QUE mudou numa atualizacao do app.
 */
export interface ImpressaoGravada {
  formato: 1
  impressao: string
  variante: VarianteDoMotor
  python: string
  /** nome -> versao das rodas instaladas ("torch" -> "2.11.0+cu128"). */
  rodas: Record<string, string>
  /** nome -> versao dos pacotes instalados. */
  pacotes: Record<string, string>
  /**
   * O torch rodou uma conta na GPU na conferencia. false = o motor sobe com
   * ANIRECAP_MOTOR_SEM_CUDA=1 (o torch na CPU; o NVENC do ffmpeg continua).
   */
  cudaOk: boolean
  gpu: string | null
  /**
   * O driver da NVIDIA quando o cudaOk foi medido. Outro driver (ele atualizou,
   * como a tela pede) = a conta na GPU e refeita ao abrir o app, sem reinstalar.
   * Ausente nas gravadas antes disto.
   */
  driver?: string | null
  uv: string
  /** Versao do app que instalou. */
  app: string
  /** ISO. */
  instaladoEm: string
  /** Medido no fim (python/ + venv/). Ausente nas gravadas antes de medir. */
  bytesNoDisco?: number
  /** [recap] A assinatura do python.exe conferida na instalacao. */
  assinatura?: AssinaturaDoPython
}

/** [recap] O que o Get-AuthenticodeSignature disse do Python oficial. */
export interface AssinaturaDoPython {
  /** "Valid" (qualquer outro recusa a instalacao). */
  status: string
  /** O Subject do certificado: "CN=Python Software Foundation, O=..., C=US". */
  assinante: string
  thumbprint: string
  /** Os arquivos conferidos (python.exe e python3XX.dll). */
  arquivos: string[]
  /** ISO. */
  conferidoEm: string
}

/** estado.json: a instalacao que comecou e ainda nao terminou. */
export interface EstadoGravado {
  formato: 1
  /** A impressao que esta instalacao vai gravar no fim. Outra = recomeca o plano. */
  alvo: string
  variante: VarianteDoMotor
  etapasFeitas: EtapaDaInstalacao[]
  /** Fracao total quando parou (o "Continuar (43%)"). */
  fracao: number
  cancelado: boolean
  erro: ErroDaInstalacao | null
  iniciadoEm: string
  atualizadoEm: string
  /** A etapa em que parou (o 'Parou em Baixar torch'). */
  etapa?: EtapaDaInstalacao
  /** Comecou como atualizacao automatica (so pacotes). */
  automatica?: boolean
}

// --------------------------------------------------------------- a instalacao

/**
 * - dev: em desenvolvimento o motor e o motor/.venv; nada a instalar.
 * - ausente: nunca instalado nesta pasta.
 * - incompleto: comecou e parou (cancelou, erro, app fechou). Da para continuar.
 * - instalando: rodando agora (instalar, continuar ou atualizar).
 * - desatualizado: instalado, mas o studio-runtime.json do app mudou.
 * - pronto: impressao.json bate com o lock do app.
 */
export type FaseDoMotorRuntime = 'dev' | 'ausente' | 'incompleto' | 'instalando' | 'desatualizado' | 'pronto'

/** As etapas, na ordem. Cada uma confere o disco antes e pula o que ja esta feito. */
export const ETAPAS_DA_INSTALACAO = ['preparar', 'python', 'venv', 'baixar-torch', 'torch', 'pacotes', 'conferir'] as const
export type EtapaDaInstalacao = (typeof ETAPAS_DA_INSTALACAO)[number]

/** Quanto cada etapa pesa na barra numa instalacao completa cu128 (o main ajusta pelo plano). */
export const PESO_DAS_ETAPAS: Record<EtapaDaInstalacao, number> = {
  preparar: 0.01,
  python: 0.02,
  venv: 0.01,
  'baixar-torch': 0.7,
  torch: 0.12,
  pacotes: 0.1,
  conferir: 0.04,
}

/** Rotulo curto de cada etapa (ASCII, uma ou duas palavras). */
export const ROTULO_DA_ETAPA: Record<EtapaDaInstalacao, string> = {
  preparar: 'Preparar',
  python: 'Python',
  venv: 'Ambiente',
  'baixar-torch': 'Baixar torch',
  torch: 'Instalar torch',
  pacotes: 'Pacotes',
  conferir: 'Conferir',
}

export type TipoDeErroDaInstalacao =
  /** DNS, conexao recusada, tempo esgotado, HTTP 5xx. */
  | 'sem-internet'
  /** Antes de comecar (statfs) ou ENOSPC no meio. */
  | 'sem-espaco'
  /** sha256 de uma roda nao bateu: o arquivo e apagado. */
  | 'arquivo-corrompido'
  /** O uv saiu com erro (python, venv, pacotes, pip check). */
  | 'uv'
  /** Instalou, mas o torch ou o `app.headless probe` nao responderam. */
  | 'conferencia'
  /** Outro processo do app esta instalando (instalando.trava com pid vivo). */
  | 'ocupado'
  /** Nao consegue gravar na pasta, ou o caminho e longo demais. */
  | 'pasta'
  /** [recap] A lista do motor (o lock) faltando ou torta, ou o uv baixado de outra versao. */
  | 'uv-ausente'
  /** [recap] O python.exe baixado nao tem a assinatura valida da PSF: nao instala. */
  | 'assinatura'
  /**
   * O uv (nao assinado) nao rodou, ou um arquivo ficou preso no meio: o
   * antivirus ou o Smart App Control. Liberar e Continuar; reinstalar o app
   * nao resolve.
   */
  | 'antivirus'
  /** Uma etapa passou do tempo (a 1a carga do torch com o antivirus examinando ~4 GB): o Continuar refaz so ela. */
  | 'demorou'
  /** Sistema sem suporte (fora do Windows x64). */
  | 'sistema'

export interface ErroDaInstalacao {
  tipo: TipoDeErroDaInstalacao
  /** Uma frase curta, ASCII, que diz o que fazer ("Sem internet. Confira a conexao e clique em Continuar."). */
  mensagem: string
  /** Para o tooltip: a cauda do log do uv, o caminho, o codigo. */
  detalhe?: string
}

export interface AndamentoDaInstalacao {
  etapa: EtapaDaInstalacao
  /** 0..1 da instalacao inteira. null = sem como medir agora (spinner). */
  fracao: number | null
  /** Curta: "Baixando torch", "Instalando pacotes (12/60)". */
  mensagem: string
  /** So no baixar-torch: bytes ja no disco e o total das rodas. */
  baixados?: number
  total?: number
  /** Media dos ultimos segundos, para "18 MB/s". */
  bytesPorSegundo?: number
}

/** O que mudou entre o runtime instalado e o lock do app (fase 'desatualizado'). */
export interface MudancasDoRuntime {
  /** Python de outra versao: o venv inteiro e refeito. */
  python: boolean
  /** torch/torchvision de outra versao (ou outra variante): baixa de novo. */
  torch: boolean
  /** "numpy 2.5.2 -> 2.6.0", "+ novo 1.0", "- velho 2.0". */
  pacotes: string[]
  /** Sem python nem torch: o app atualiza sozinho ao abrir e so avisa. */
  automatica: boolean
  /** Quanto falta baixar (estimativa). */
  bytes: number
}

export interface GpuDetectada {
  /** "NVIDIA GeForce RTX 5080". null = sem NVIDIA. */
  nome: string | null
  /** "581.57". null = nao deu para ler (veio pelo WMI). */
  driver: string | null
  /** Driver abaixo do minimo do CUDA 12.8 (DRIVER_MINIMO_CU128): instala, mas avisa. */
  driverAntigo: boolean
  /**
   * A "compute capability" da placa (nvidia-smi compute_cap): 6.1 numa GTX
   * 1060, 12.0 numa RTX 5080. null = nao deu para ler (nvidia-smi velho, WMI).
   */
  computeCap?: number | null
  /** Por onde soube: nvidia-smi, WMI ou nenhum. */
  fonte: 'nvidia-smi' | 'wmi' | 'nenhuma'
}

/** CUDA 12.8 no Windows pede driver R570 ou mais novo. */
export const DRIVER_MINIMO_CU128 = 570.65

/**
 * O torch cu128 do lock so tem kernels de sm_75 para cima (torch.cuda.
 * get_arch_list() = sm_75..sm_120, medido em 15/10): GTX 10xx, GTX 9xx e
 * Titan V nao rodam nele. Abaixo disto a sugestao e a cpu (120 MB em vez de
 * 2,7 GB que rodariam na CPU do mesmo jeito).
 */
export const COMPUTE_CAP_MINIMO_CU128 = 7.5

/** Tudo que a tela precisa, sempre inteiro (o evento manda o estado todo). */
export interface EstadoDoMotorRuntime {
  fase: FaseDoMotorRuntime
  /** A pasta efetiva do runtime. */
  pasta: string
  /** false = o Levi escolheu outra pasta (<userData>/motor-runtime.json). */
  pastaPadrao: boolean
  /** A instalada, ou a da instalacao em andamento. null = nada instalado. */
  variante: VarianteDoMotor | null
  /** Pela GPU detectada. */
  varianteSugerida: VarianteDoMotor
  /** null = ainda detectando (a 1a leitura leva ~1 s). */
  gpu: GpuDetectada | null
  /** O que falta baixar para chegar ao 'pronto' (o "~3 GB" do botao). */
  bytesParaBaixar: number
  /** Quanto o runtime ocupa (ou vai ocupar) no disco. */
  bytesNoDisco: number
  /** Espaco livre no disco da pasta. null = nao deu para medir. */
  livreNoDisco: number | null
  /** Quanto precisa estar livre para chegar ao 'pronto' (o que falta + a folga). 0 = nada. */
  precisaDeLivre: number
  /** O Remover ainda esta apagando a pasta antiga por tras (o app espera ele ao fechar). */
  apagando?: boolean
  /**
   * O runtime instalado roda o torch na GPU? false = cu128 que nao rodou a
   * conta (placa sem kernel, driver velho): o motor vai na CPU e a tela diz.
   * null = nada instalado (ou dev).
   */
  cudaOk?: boolean | null
  /** So em 'instalando' (e o ultimo, em 'incompleto'). */
  andamento: AndamentoDaInstalacao | null
  /** O que parou a ultima tentativa. null em 'instalando' e 'pronto'. */
  erro: ErroDaInstalacao | null
  /** So em 'desatualizado' e na atualizacao em andamento. */
  mudancas: MudancasDoRuntime | null
  /** Aviso de uma linha depois de uma atualizacao automatica ("Motor atualizado: 3 pacotes"). */
  aviso: string | null
  /** <pasta>/logs/instalar.log, quando existe. */
  log: string | null
}

export const pedidoDeInstalacaoSchema = z.object({
  /** Ausente = a sugerida (ou a ja instalada, numa atualizacao). */
  variante: varianteDoMotorSchema.optional(),
  /** Apaga venv, baixando/ e uv-cache e faz do zero (o "Recomecar" depois de erro de conferencia). */
  recomecar: z.boolean().optional(),
})
export type PedidoDeInstalacao = z.infer<typeof pedidoDeInstalacaoSchema>

// ------------------------------------------------------------ contas puras

/** Folga alem do que o runtime ocupa: o uv descompacta antes de ligar os arquivos. */
export const FOLGA_DE_DISCO = 1.5e9

/** O Python oficial instalado (python/cpython-3.12.10-..., ~60 MB) + o uv (~60 MB). */
export const DISCO_DO_PYTHON = 0.15e9

/** torch + torchvision instalados, com os .pyc (medido em 15/10: cu128 4,1 GB; cpu ~0,5 GB). */
export const DISCO_DO_TORCH: Record<VarianteDoMotor, number> = {
  cu128: 4.3e9,
  cpu: 0.55e9,
}

/** Os pacotes do PyPI ocupam ~4x o que baixam (medido: 170 MB -> 0,65 GB). */
export const FATOR_DOS_PACOTES = 4

/**
 * Os modelos que o motor baixa na 1a analise (CLIP ViT-L/14 ~890 MB, YOLO de
 * rosto e de cabeca, CCIP, SCRFD): no runtime instalado eles moram em
 * <runtime>/modelos (HF_HOME), entao contam no espaco que a instalacao pede.
 */
export const DISCO_DOS_MODELOS = 1.2e9

/**
 * Quanto ocupa instalado: python + venv com os .pyc (medido em 15/10 pelo
 * proprio instalador: cu128 5,2 GB, cpu 1,2 GB). O pico durante a instalacao
 * cu128 foi ~7,3 GB (a roda de 2,7 GB ainda no disco enquanto o uv liga os
 * arquivos): coberto pela FOLGA_DE_DISCO.
 */
export const DISCO_POR_VARIANTE: Record<VarianteDoMotor, number> = {
  cu128: 5.2e9,
  cpu: 1.2e9,
}

/** O que baixar do zero numa variante: rodas + pacotes + o Python + [recap] o uv. */
export function bytesDaInstalacaoCompleta(lock: LockDoRuntime, variante: VarianteDoMotor): number {
  const rodas = lock.torch[variante].reduce((s, r) => s + r.bytes, 0)
  const pacotes = lock.pacotes.reduce((s, p) => s + p.bytes, 0)
  return rodas + pacotes + lock.pythonOficial.bytes + lock.uv.bytes
}

/** "~3 GB", "~320 MB": o tamanho no botao, arredondado para cima de leve. */
export function textoDoTamanho(bytes: number): string {
  if (bytes >= 1e9) {
    const gb = bytes / 1e9
    return `~${gb >= 2 ? Math.round(gb) : gb.toFixed(1).replace('.', ',')} GB`
  }
  return `~${Math.max(1, Math.round(bytes / 1e7) * 10)} MB`
}

/**
 * O que mudou entre o que esta instalado e o lock do app. null = nada.
 * Variante trocada conta como torch mudado (os pacotes ficam).
 */
export function mudancasDoRuntime(
  gravada: Pick<ImpressaoGravada, 'python' | 'variante' | 'rodas' | 'pacotes'>,
  lock: LockDoRuntime,
  variante: VarianteDoMotor = gravada.variante,
): MudancasDoRuntime | null {
  const python = gravada.python !== lock.python
  const rodas = lock.torch[variante]
  const torch = variante !== gravada.variante || rodas.some((r) => gravada.rodas[r.nome] !== r.versao)
  const pacotes: string[] = []
  let bytes = 0
  const noLock = new Map(lock.pacotes.map((p) => [p.nome, p]))
  for (const p of lock.pacotes) {
    const antes = gravada.pacotes[p.nome]
    if (antes === p.versao && !python) continue
    if (antes !== p.versao) pacotes.push(antes ? `${p.nome} ${antes} -> ${p.versao}` : `+ ${p.nome} ${p.versao}`)
    bytes += p.bytes
  }
  for (const [nome, versao] of Object.entries(gravada.pacotes)) {
    if (!noLock.has(nome)) pacotes.push(`- ${nome} ${versao}`)
  }
  if (torch || python) bytes += rodas.reduce((s, r) => s + r.bytes, 0)
  if (python) bytes += lock.pythonOficial.bytes
  if (!python && !torch && pacotes.length === 0) return null
  return { python, torch, pacotes, automatica: !python && !torch, bytes }
}
