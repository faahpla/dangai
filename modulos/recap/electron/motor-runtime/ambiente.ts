import { existsSync, readdirSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { ffmpegPath } from '../ffmpeg-path'
import { configDoRuntime } from './pastas'

/**
 * O AMBIENTE do processo do motor quando ele roda no runtime (app instalado).
 *
 * DONO: agente A.
 *
 * Em dev o motor.ts continua como sempre: o ffmpeg do sistema primeiro (o
 * ffmpeg 9 do Levi, com ffprobe e NVENC) e o ffmpeg-static no fim. O app
 * instalado nao pode depender do PATH de ninguem:
 *
 * - ffmpeg: o do app PRIMEIRO (ffmpeg-static, gyan 6.1.1 essentials: libx264,
 *   h264_nvenc). Um ffmpeg velho qualquer no PATH de quem instalou nao decide
 *   o corte. O motor acha pelo PATH (motor/app/ffmpeg_locate.py) porque
 *   resources/motor nao tem bin/.
 * - ffprobe: o motor usa so para saber se o video e HDR. O ffmpeg-static nao
 *   tem; o compositor do Remotion tem (ja desempacotado do asar, com as DLLs ao
 *   lado). Vai no FIM do PATH: so vale quando o sistema nao tem um, e as DLLs
 *   dele (avcodec-61, zlib1...) nunca ficam na frente das do sistema.
 * - Python isolado: sem PYTHONHOME/PYTHONPATH/site do usuario, que fariam o
 *   Python do runtime carregar pacote de outra instalacao.
 * - PYTHONDONTWRITEBYTECODE: o codigo do motor fica em resources/motor, dentro
 *   da pasta de instalacao, onde nada pode ser gravado (a atualizacao troca a
 *   pasta inteira). O site-packages do runtime ja vem compilado da instalacao
 *   (uv --compile-bytecode), entao o import do torch nao fica mais lento.
 * - cudaOk false (a GPU nao rodou a conta da conferencia: placa sem suporte no
 *   torch cu128): ANIRECAP_MOTOR_SEM_CUDA=1, e o motor poe o torch na CPU
 *   (motor/app/config.py, [Studio]) em vez de quebrar no primeiro kernel. O
 *   CUDA_VISIBLE_DEVICES=-1 de antes escondia a placa tambem do ffmpeg, e o
 *   corte perdia o NVENC/NVDEC que uma GTX 10xx tem (cuInit = NO_DEVICE).
 */

/** Variaveis do usuario que mudariam qual Python/pacote o runtime carrega. */
const FORA_DO_AMBIENTE = [
  'PYTHONHOME',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'PYTHONUSERBASE',
  'PYTHONEXECUTABLE',
  'VIRTUAL_ENV',
  'CONDA_PREFIX',
  'CONDA_DEFAULT_ENV',
  '__PYVENV_LAUNCHER__',
]

/** A pasta do compositor do Remotion (tem ffprobe.exe + DLLs). null = nao achou. */
export function pastaDoFfprobe(): string | null {
  const c = configDoRuntime()
  const base = c.empacotado
    ? join(c.resourcesPath, 'app.asar.unpacked', 'node_modules', '@remotion')
    : join(c.appPath, 'node_modules', '@remotion')
  try {
    const nome = readdirSync(base).find((n) => n.startsWith('compositor-'))
    if (!nome) return null
    const pasta = join(base, nome)
    return existsSync(join(pasta, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')) ? pasta : null
  } catch {
    return null
  }
}

/**
 * O ambiente do motor no runtime, a partir do ambiente base (o process.env, ou
 * o que o motor.ts ja montou com ANIRECAP_MOTOR_DADOS). Nao muda o `base`.
 */
export function ambienteDoRuntime(base: NodeJS.ProcessEnv, opcoes: { cudaOk: boolean; modelos?: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const chave of Object.keys(env)) {
    if (FORA_DO_AMBIENTE.includes(chave.toUpperCase())) delete env[chave]
  }
  env['PYTHONIOENCODING'] = 'utf-8'
  env['PYTHONDONTWRITEBYTECODE'] = '1'
  env['PYTHONNOUSERSITE'] = '1'
  env['YOLO_AUTOINSTALL'] = 'false'
  if (opcoes.cudaOk) delete env['ANIRECAP_MOTOR_SEM_CUDA']
  else env['ANIRECAP_MOTOR_SEM_CUDA'] = '1'
  // Os modelos da 1a analise dentro do runtime (CaminhosDoRuntime.modelos).
  if (opcoes.modelos) env['HF_HOME'] = opcoes.modelos

  // No Windows a chave e 'Path'. Criar 'PATH' ao lado deixaria duas, e qual
  // vale fica por conta da ordem (a mesma licao do motor.ts).
  const chave = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const doSistema = (env[chave] ?? '').split(delimiter).filter(Boolean)
  const ffmpeg = dirname(ffmpegPath)
  const ffprobe = pastaDoFfprobe()
  env[chave] = [ffmpeg, ...doSistema.filter((p) => p !== ffmpeg && p !== ffprobe), ...(ffprobe ? [ffprobe] : [])].join(delimiter)
  return env
}
