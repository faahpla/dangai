/**
 * RUNTIME DO MOTOR, so o contrato: o lock (motor/studio-runtime.json), a
 * impressao, o requirements com hash, o diff de uma atualizacao, o backend e
 * o ambiente do processo. Sem rede e sem uv. Grava so numa pasta temporaria.
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-motor-runtime-contrato.ts
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import {
  bytesDaInstalacaoCompleta,
  mudancasDoRuntime,
  textoDoTamanho,
  type ImpressaoGravada,
  type LockDoRuntime,
} from '../shared/motor-runtime'
import { impressaoDoLock, lerLock, requisitosDoLock, versoesDoLock } from '../electron/motor-runtime/lock'
import { caminhosDoRuntime, configurarMotorRuntime } from '../electron/motor-runtime/pastas'
import { ambienteDoRuntime, backendDoRuntime } from '../electron/motor-runtime/index'
import { lerNvidiaSmi, placaSemKernelCu128, varianteSugerida } from '../electron/motor-runtime/gpu'
import { erroDoUv, linhasDoErroDoUv } from '../electron/motor-runtime/protocolo'
import { paraErroDaInstalacao } from '../electron/motor-runtime/erros'
import { fraseDoErroDoMotor } from '../electron/frase-do-motor'

const raiz = resolve('.')
const temp = mkdtempSync(join(tmpdir(), 'v-motor-runtime-'))
process.env['ANIRECAP_MOTOR_RUNTIME'] = '1'
process.env['ANIRECAP_MOTOR_RUNTIME_PASTA'] = join(temp, 'runtime')
configurarMotorRuntime({ userData: join(temp, 'ud'), appPath: raiz, resourcesPath: join(temp, 'res'), empacotado: false, versaoDoApp: '0.0.0' })

try {
  // 1. o lock do repositorio
  const lock = lerLock()
  // [recap] O Python oficial (nuget.org) e o uv, pinados no lock: baixados na instalacao.
  assert.equal(lock.python, '3.12.10')
  assert.equal(lock.pythonOficial.versao, lock.python)
  assert.ok(lock.pythonOficial.url.startsWith('https://api.nuget.org/v3-flatcontainer/python/3.12.10/'))
  assert.equal(lock.pythonOficial.sha256.length, 64)
  assert.equal(lock.pythonOficial.assinante, 'Python Software Foundation')
  assert.ok(lock.uv.url.startsWith('https://github.com/astral-sh/uv/releases/download/0.11.7/'))
  assert.equal(lock.uv.sha256Exe.length, 64)
  assert.ok(lock.pacotes.length > 40)
  assert.ok(!lock.pacotes.some((p) => /pyside6|shiboken6/.test(p.nome)), 'o Qt nao entra no runtime')
  assert.ok(!lock.pacotes.some((p) => p.nome === 'torch' || p.nome === 'torchvision'), 'torch vem das rodas')
  const cu = bytesDaInstalacaoCompleta(lock, 'cu128')
  const cpu = bytesDaInstalacaoCompleta(lock, 'cpu')
  assert.equal(textoDoTamanho(cu), '~3 GB', `cu128 baixa ${cu}`)
  assert.ok(cpu < 0.5e9, `cpu baixa ${cpu}`)
  console.log(`ok lock: ${lock.pacotes.length} pacotes, cu128 ${textoDoTamanho(cu)}, cpu ${textoDoTamanho(cpu)}`)

  // 2. impressao: estavel, por variante, so nome/versao
  const a = impressaoDoLock(lock, 'cu128')
  assert.equal(a, impressaoDoLock(lock, 'cu128'))
  assert.notEqual(a, impressaoDoLock(lock, 'cpu'))
  const outroEspelho: LockDoRuntime = JSON.parse(JSON.stringify(lock))
  outroEspelho.torch.cu128[0]!.url = 'https://outro/torch.whl'
  outroEspelho.pacotes.reverse()
  assert.equal(impressaoDoLock(outroEspelho, 'cu128'), a, 'url e ordem nao mudam a impressao')
  console.log(`ok impressao ${a.slice(0, 12)}`)

  // 3. requirements com hash (formato pip, sem barra no fim da ultima linha de cada pacote)
  const req = requisitosDoLock(lock)
  assert.match(req, /^numpy==\S+ \\\n {4}--hash=sha256:[0-9a-f]{64}/m)
  assert.ok(!/\\\n(?! {4}--hash)/.test(req), 'barra de continuacao seguida de algo que nao e hash')
  console.log('ok requisitos')

  // 4. diff de uma atualizacao do app
  const gravada: ImpressaoGravada = {
    formato: 1, impressao: a, variante: 'cu128', python: lock.python, ...versoesDoLock(lock, 'cu128'),
    cudaOk: true, gpu: 'RTX', uv: '0.11.7', app: '0.1.0', instaladoEm: new Date().toISOString(),
  }
  assert.equal(mudancasDoRuntime(gravada, lock), null)
  const novo: LockDoRuntime = JSON.parse(JSON.stringify(lock))
  novo.pacotes.find((p) => p.nome === 'numpy')!.versao = '9.9.9'
  novo.pacotes.push({ nome: 'zz-novo', versao: '1.0', bytes: 1000, hashes: ['0'.repeat(64)] })
  const sem = { ...gravada, pacotes: { ...gravada.pacotes, 'velho-pkg': '2.0' } }
  const m = mudancasDoRuntime(sem, novo)!
  assert.equal(m.automatica, true)
  assert.equal(m.torch, false)
  assert.deepEqual(m.pacotes.sort(), [`+ zz-novo 1.0`, `- velho-pkg 2.0`, `numpy ${gravada.pacotes['numpy']} -> 9.9.9`].sort())
  const comTorch: LockDoRuntime = JSON.parse(JSON.stringify(lock))
  comTorch.torch.cu128[0]!.versao = '2.12.0+cu128'
  const mt = mudancasDoRuntime(gravada, comTorch)!
  assert.equal(mt.torch, true)
  assert.equal(mt.automatica, false)
  assert.ok(mt.bytes > 2e9)
  assert.equal(mudancasDoRuntime(gravada, lock, 'cpu')!.torch, true, 'trocar de variante e trocar o torch')
  console.log('ok mudancas')

  // 5. backend: ausente -> incompleto -> pronto -> desatualizado
  const c = caminhosDoRuntime(join(temp, 'runtime'))
  let b = backendDoRuntime()
  assert.ok('erro' in b && b.fase === 'ausente', JSON.stringify(b))
  mkdirSync(c.pasta, { recursive: true })
  writeFileSync(c.estado, '{}')
  b = backendDoRuntime()
  assert.ok('erro' in b && b.fase === 'incompleto', JSON.stringify(b))
  mkdirSync(join(c.venv, 'Scripts'), { recursive: true })
  writeFileSync(c.pythonDoVenv, '')
  writeFileSync(c.impressao, JSON.stringify(gravada))
  rmSync(c.estado)
  b = backendDoRuntime()
  assert.ok(!('erro' in b), JSON.stringify(b))
  assert.equal(b.python, c.pythonDoVenv)
  assert.equal(b.cwd, join(raiz, 'modulos', 'recap', 'motor'))
  assert.equal(b.modelos, c.modelos, 'HF_HOME dentro do runtime')
  writeFileSync(c.impressao, JSON.stringify({ ...gravada, impressao: 'x'.repeat(64) }))
  b = backendDoRuntime()
  assert.ok('erro' in b && b.fase === 'desatualizado', JSON.stringify(b))
  console.log('ok backend')

  // 6. ambiente: ffmpeg do app na frente, ffprobe no fim, Python isolado
  const base = { Path: ['C:\\sistema\\bin', 'C:\\outro'].join(delimiter), PYTHONHOME: 'C:\\py', PYTHONPATH: 'x', ANIRECAP_MOTOR_DADOS: 'd' }
  const env = ambienteDoRuntime(base, { cudaOk: false })
  assert.equal(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH').length, 1, 'uma chave de PATH so')
  const partes = env['Path']!.split(delimiter)
  assert.match(partes[0]!, /ffmpeg-static/)
  assert.match(partes[partes.length - 1]!, /compositor-/)
  assert.equal(partes[1], 'C:\\sistema\\bin')
  assert.equal(env['PYTHONHOME'], undefined)
  assert.equal(env['PYTHONPATH'], undefined)
  assert.equal(env['PYTHONDONTWRITEBYTECODE'], '1')
  assert.equal(env['PYTHONNOUSERSITE'], '1')
  // cudaOk false: o torch na CPU pelo config do motor, e a placa continua visivel (NVENC do ffmpeg).
  assert.equal(env['CUDA_VISIBLE_DEVICES'], undefined)
  assert.equal(env['ANIRECAP_MOTOR_SEM_CUDA'], '1')
  assert.equal(env['ANIRECAP_MOTOR_DADOS'], 'd')
  assert.equal(ambienteDoRuntime(base, { cudaOk: true })['ANIRECAP_MOTOR_SEM_CUDA'], undefined)
  assert.equal(ambienteDoRuntime({ ...base, ANIRECAP_MOTOR_SEM_CUDA: '1' }, { cudaOk: true })['ANIRECAP_MOTOR_SEM_CUDA'], undefined)
  // Os modelos da 1a analise dentro do runtime (HF_HOME), so quando vier a pasta.
  assert.equal(ambienteDoRuntime(base, { cudaOk: true, modelos: 'X:\\rt\\modelos' })['HF_HOME'], 'X:\\rt\\modelos')
  assert.equal(ambienteDoRuntime(base, { cudaOk: true })['HF_HOME'], undefined)
  console.log('ok ambiente')

  // 7. a placa: compute cap do nvidia-smi e a sugestao (revisao A de 15/10)
  const rtx = lerNvidiaSmi('NVIDIA GeForce RTX 5080, 581.57, 12.0\n')
  assert.deepEqual(rtx, { nome: 'NVIDIA GeForce RTX 5080', driver: '581.57', computeCap: 12 })
  const gtx = lerNvidiaSmi('NVIDIA GeForce GTX 1060 6GB, 581.57, 6.1')
  assert.equal(gtx?.computeCap, 6.1)
  assert.equal(lerNvidiaSmi('NVIDIA GeForce GTX 1060, 472.12')?.computeCap, null, 'nvidia-smi velho: sem compute cap')
  const gpu = (nome: string | null, computeCap: number | null) => ({ nome, driver: '581.57', driverAntigo: false, computeCap, fonte: 'nvidia-smi' as const })
  assert.ok(placaSemKernelCu128(gpu('GTX 1060', 6.1)) && !placaSemKernelCu128(gpu('RTX 2060', 7.5)) && !placaSemKernelCu128(gpu('X', null)))
  delete process.env['ANIRECAP_MOTOR_RUNTIME_VARIANTE']
  assert.equal(varianteSugerida(gpu('NVIDIA GeForce GTX 1060', 6.1)), 'cpu', 'GTX 10xx: cpu (o cu128 nao tem kernel para ela)')
  assert.equal(varianteSugerida(gpu('NVIDIA GeForce RTX 5080', 12)), 'cu128')
  assert.equal(varianteSugerida(gpu('NVIDIA (WMI)', null)), 'cu128', 'sem compute cap: a de antes')
  assert.equal(varianteSugerida(gpu(null, null)), 'cpu')
  console.log('ok placa')

  // 8. o erro do uv pelas linhas do ERRO, nao pelo log inteiro
  const saida = (linhas: string[], codigo: number | null = 1) => ({ codigo, linhas, stdout: '' })
  const comNetworkx = ['Resolved 60 packages in 1ms', 'Downloading networkx (2.0MiB)', ' Downloaded networkx', 'error: Failed to install: numpy-2.2.6-cp312-cp312-win_amd64.whl (numpy==2.2.6)', '  Caused by: failed to hardlink file from X to Y: Access is denied. (os error 5)']
  assert.equal(linhasDoErroDoUv(comNetworkx)[0], comNetworkx[3])
  assert.equal(erroDoUv(saida(comNetworkx), 'uv pip install (pacotes)').tipo, 'antivirus', 'arquivo preso: antivirus, nao "Sem internet"')
  const soNetworkx = ['Downloading networkx (2.0MiB)', 'error: Failed to build `foo==1.0`', '  Caused by: the build backend returned an error']
  assert.equal(erroDoUv(saida(soNetworkx), 'uv pip install (pacotes)').tipo, 'uv', '"networkx" no log nao vira "Sem internet"')
  const rede = ['Downloading networkx (2.0MiB)', 'error: Request failed after 3 retries', '  Caused by: error sending request for url (https://files.pythonhosted.org/...)', '  Caused by: tcp connect error']
  assert.equal(erroDoUv(saida(rede), 'uv pip install (pacotes)').tipo, 'sem-internet')
  assert.equal(erroDoUv(saida(['spawn UNKNOWN'], null), 'uv venv').tipo, 'antivirus', 'uv barrado no spawn: antivirus')
  assert.equal(erroDoUv(saida(['error: failed to write to file: There is not enough space on the disk. (os error 112)']), 'uv pip install (torch)').tipo, 'sem-espaco')
  // EPERM dentro do venv (o motor rodando) nao e "escolha outra pasta"
  const eperm = Object.assign(new Error("EPERM: operation not permitted, unlink 'C:\\rt\\venv\\Lib\\site-packages\\torch\\lib\\c10.dll'"), { code: 'EPERM' })
  assert.equal(paraErroDaInstalacao(eperm).tipo, 'ocupado')
  const epermPasta = Object.assign(new Error("EPERM: operation not permitted, mkdir 'D:\\x\\motor-runtime'"), { code: 'EPERM' })
  assert.equal(paraErroDaInstalacao(epermPasta).tipo, 'pasta')
  console.log('ok erros do uv')

  // 9. o erro do motor sem os modelos (sem rede na 1a analise)
  assert.match(fraseDoErroDoMotor("module 'cv2' has no attribute 'CascadeClassifier'", 'huggingface_hub.errors.LocalEntryNotFoundError: ... ConnectTimeout') ?? '', /Sem internet para baixar os modelos/)
  assert.match(fraseDoErroDoMotor("module 'cv2' has no attribute 'CascadeClassifier'", 'ImportError: ultralytics') ?? '', /detector de rostos/)
  assert.equal(fraseDoErroDoMotor('division by zero', ''), null)
  console.log('ok erro dos modelos')
  console.log('\nTUDO OK')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
