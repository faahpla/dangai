#!/usr/bin/env node
/**
 * Gera motor/studio-runtime.json: o que o app instala no runtime do motor.
 *
 *   node modulos/recap/scripts/motor-lock.mjs             regera a partir do motor/.venv do dev
 *   node modulos/recap/scripts/motor-lock.mjs --conferir  so compara com o arquivo (sai 1 se mudou)
 *   node modulos/recap/scripts/motor-lock.mjs --de <lock> sem venv: o torch e os pacotes de
 *                                                         outro lock (o do Studio) + as fontes daqui
 *
 * [recap] Portado do Studio. No Dangai o lock leva tambem as FONTES OFICIAIS
 * que a tela baixa na instalacao (electron/motor-runtime/fontes.ts):
 * - pythonOficial: o pacote "python" do nuget.org (a build do python.org, com
 *   o python.exe assinado pela PSF), pinado por versao, sha256 e tamanho. O
 *   `python` do lock e a versao dele (o venv do dev precisa ser da mesma
 *   3.12: as rodas cp312 sao as mesmas);
 * - uv: o zip da release oficial do astral-sh/uv, sha256 do zip e do uv.exe.
 * Trocar de versao: atualizar PYTHON_OFICIAL/UV abaixo (o sha256 do .nupkg e
 * o do zip saem do arquivo baixado; o do uv.exe, do zip aberto).
 *
 * POR QUE UM LOCK, e nao o requirements.txt: o requirements do motor e todo
 * `>=` (vem do upstream), e instalar "o mais novo" ja quebrou o motor duas
 * vezes no AnCut HUB (scenedetect 0.7 e open_clip 3, AnCut-HUB-NOTES.md). O
 * runtime do app instalado tem que ser o MESMO conjunto que roda no dev do
 * Levi: entao o lock sai do `uv pip freeze` do motor/.venv, versao por versao.
 *
 * - O Qt (PySide6 + shiboken6, ~650 MB) fica de fora: so a interface do motor
 *   (app/main.py, app/ui/, app/updater.py) importa, e o Studio usa so o
 *   app.headless. Sem ele o download cai ~200 MB e o disco ~650 MB.
 * - torch e torchvision saem do indice da PyTorch, por variante (cu128 com
 *   NVIDIA, cpu sem), com URL, sha256 e tamanho fixos: o app baixa esses dois
 *   sozinho, com retomada (o torch cu128 tem 2,7 GB), e confere o hash.
 * - O resto sai do PyPI com TODOS os sha256 dos arquivos que o uv pode
 *   escolher no Windows x64 (win_amd64, none-any, sdist): instalado com
 *   --require-hashes, qualquer arquivo trocado no caminho para a instalacao.
 *
 * A "impressao" do runtime (electron/services/motor-runtime/lock.ts) e feita
 * de python + variante + nome/versao das rodas e dos pacotes: regerar este
 * arquivo com versoes novas faz o app instalado atualizar o runtime.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// [recap] modulos/recap/scripts -> modulos/recap
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VENV = join(ROOT, 'motor', '.venv')
const SAIDA = join(ROOT, 'motor', 'studio-runtime.json')
const CONFERIR = process.argv.includes('--conferir')
const DE = process.argv.includes('--de') ? process.argv[process.argv.indexOf('--de') + 1] : null

/** [recap] O Python OFICIAL: o pacote "python" do nuget.org (3.12.10 e a ultima 3.12 com binario do python.org). */
const PYTHON_OFICIAL = {
  versao: '3.12.10',
  arquivo: 'python.3.12.10.nupkg',
  url: 'https://api.nuget.org/v3-flatcontainer/python/3.12.10/python.3.12.10.nupkg',
  sha256: '0eb85c2dfccccf1b17352de4c397f69194035b7d37149eacc16f1147d93de3b8',
  bytes: 14515433,
  assinante: 'Python Software Foundation',
}

/** [recap] O uv da release oficial (o mesmo 0.11.7 do Studio, do baixar-uv.mjs de la). */
const UV = {
  versao: '0.11.7',
  arquivo: 'uv-x86_64-pc-windows-msvc.zip',
  url: 'https://github.com/astral-sh/uv/releases/download/0.11.7/uv-x86_64-pc-windows-msvc.zip',
  sha256: 'fe0c7815acf4fc45f8a5eff58ed3cf7ae2e15c3cf1dceadbd10c816ec1690cc1',
  bytes: 23572531,
  sha256Exe: '831730243cf7bbd496ff96353dcdba6f5d4dcbd22576af398130381ab44ac160',
}

/** [recap] O lock com as fontes oficiais logo depois do python. */
function comFontes(lock) {
  const { formato, comentario, indice, torch, pacotes } = lock
  return { formato, comentario, python: PYTHON_OFICIAL.versao, pythonOficial: PYTHON_OFICIAL, uv: UV, indice, torch, pacotes }
}

/** So a interface Qt do motor usa (o app.headless nunca importa). */
const FORA = new Set(['pyside6', 'pyside6-addons', 'pyside6-essentials', 'pyside6-pdf', 'pyside6-webengine', 'shiboken6'])
/** Baixados pelo app, por variante, do indice da PyTorch. */
const RODAS = ['torch', 'torchvision']
const VARIANTES = ['cu128', 'cpu']
const INDICE_PYTORCH = 'https://download.pytorch.org/whl'

function log(msg) {
  process.stdout.write(`  • ${msg}\n`)
}

/** PEP 503: minusculas e qualquer sequencia de - _ . vira um -. */
export function normalizar(nome) {
  return nome.toLowerCase().replace(/[-_.]+/g, '-')
}

function acharUv() {
  const doBuild = join(ROOT, 'build', 'uv', 'uv.exe')
  if (process.env['UV'] && existsSync(process.env['UV'])) return process.env['UV']
  if (existsSync(doBuild)) return doBuild
  return 'uv'
}

async function buscar(url, como = 'text') {
  let ultimo
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(url, { redirect: 'follow' })
      if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`)
      return como === 'json' ? await r.json() : await r.text()
    } catch (e) {
      ultimo = e
      await new Promise((ok) => setTimeout(ok, 1000 * t))
    }
  }
  throw ultimo
}

async function tamanho(url) {
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(url, { method: 'HEAD', redirect: 'follow' })
      const n = Number(r.headers.get('content-length'))
      if (r.ok && n > 0) return n
    } catch {
      /* tenta de novo */
    }
    await new Promise((ok) => setTimeout(ok, 1000 * t))
  }
  throw new Error(`sem tamanho para ${url}`)
}

/** As rodas de uma variante, no indice simples da PyTorch (PEP 503, com #sha256=). */
async function rodaDaPyTorch(nome, versao, variante, cp) {
  const html = await buscar(`${INDICE_PYTORCH}/${variante}/${nome}/`)
  const arquivo = `${nome}-${versao}+${variante}-${cp}-${cp}-win_amd64.whl`
  const alvo = arquivo.replace('+', '%2B')
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1].replace(/&amp;/g, '&')
    const [url, frag] = href.split('#')
    if (!url.endsWith(`/${alvo}`) && !url.endsWith(`/${arquivo}`)) continue
    const sha256 = /sha256=([0-9a-f]{64})/.exec(frag ?? '')?.[1]
    if (!sha256) throw new Error(`${arquivo} sem sha256 no indice`)
    const absoluta = new URL(url, `${INDICE_PYTORCH}/${variante}/${nome}/`).href
    return { nome, versao: `${versao}+${variante}`, arquivo, url: absoluta, sha256, bytes: await tamanho(absoluta) }
  }
  throw new Error(`${arquivo} nao esta em ${INDICE_PYTORCH}/${variante}/${nome}/`)
}

/** Um arquivo que o uv pode escolher no Windows x64 com este Python. */
function serve(arquivo, cp) {
  if (arquivo.endsWith('.tar.gz') || arquivo.endsWith('.zip')) return 'sdist'
  if (!arquivo.endsWith('.whl')) return null
  if (/-none-any\.whl$/.test(arquivo)) return 'any'
  if (!/win_amd64\.whl$/.test(arquivo)) return null
  if (arquivo.includes(`-${cp}-`) || /-abi3-/.test(arquivo) || /-py3-none-/.test(arquivo)) return 'win'
  // Wheel de outro Python (cp311, cp313...): o uv nao escolhe, mas o hash a mais nao atrapalha.
  return 'outro'
}

async function pacoteDoPyPI(nome, versao, cp) {
  const j = await buscar(`https://pypi.org/pypi/${encodeURIComponent(nome)}/${encodeURIComponent(versao)}/json`, 'json')
  const arquivos = (j.urls ?? []).filter((u) => serve(u.filename, cp) !== null && serve(u.filename, cp) !== 'outro')
  if (!arquivos.length) throw new Error(`${nome}==${versao} sem arquivo para Windows x64 no PyPI`)
  // O tamanho (para a barra e o "~3 GB") e o do arquivo que o uv vai preferir.
  const ordem = { win: 0, any: 1, sdist: 2 }
  const preferido = [...arquivos].sort((a, b) => ordem[serve(a.filename, cp)] - ordem[serve(b.filename, cp)])[0]
  const hashes = [...new Set(arquivos.map((u) => u.digests.sha256))].sort()
  return { nome, versao, bytes: preferido.size, hashes }
}

async function emLotes(itens, n, fn) {
  const saida = new Array(itens.length)
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < itens.length) {
        const k = i++
        saida[k] = await fn(itens[k])
      }
    }),
  )
  return saida
}

async function gerar() {
  const python = process.platform === 'win32' ? join(VENV, 'Scripts', 'python.exe') : join(VENV, 'bin', 'python')
  if (!existsSync(python)) throw new Error(`nao achei o venv do motor em ${VENV}`)
  const cfg = readFileSync(join(VENV, 'pyvenv.cfg'), 'utf8')
  const versaoPython = /^\s*version_info\s*=\s*(\d+\.\d+\.\d+)/m.exec(cfg)?.[1]
  if (!versaoPython) throw new Error('pyvenv.cfg sem version_info')
  const [maior, menor] = versaoPython.split('.')
  const cp = `cp${maior}${menor}`
  if (!PYTHON_OFICIAL.versao.startsWith(`${maior}.${menor}.`)) {
    throw new Error(`o venv e Python ${versaoPython} e o oficial do lock e ${PYTHON_OFICIAL.versao}: as rodas nao batem`)
  }

  const freeze = execFileSync(acharUv(), ['pip', 'freeze', '--python', python], {
    encoding: 'utf8',
    env: { ...process.env, UV_NO_CONFIG: '1' },
  })
  const linhas = freeze
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  const pinados = []
  const rodas = {}
  for (const l of linhas) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;]+)$/.exec(l)
    if (!m) throw new Error(`linha do freeze fora do formato nome==versao: ${l}`)
    const nome = normalizar(m[1])
    if (FORA.has(nome)) continue
    if (RODAS.includes(nome)) rodas[nome] = m[2].replace(/\+.*$/, '')
    else pinados.push([nome, m[2]])
  }
  for (const r of RODAS) if (!rodas[r]) throw new Error(`${r} nao esta no venv do motor`)
  pinados.sort((a, b) => a[0].localeCompare(b[0]))

  log(`python ${versaoPython}, torch ${rodas.torch}, torchvision ${rodas.torchvision}, ${pinados.length} pacotes`)
  const torch = {}
  for (const v of VARIANTES) {
    torch[v] = []
    for (const nome of RODAS) torch[v].push(await rodaDaPyTorch(nome, rodas[nome], v, cp))
    log(`${v}: ${torch[v].map((r) => `${r.arquivo} (${(r.bytes / 1e6).toFixed(0)} MB)`).join(', ')}`)
  }
  const pacotes = await emLotes(pinados, 8, ([nome, versao]) => pacoteDoPyPI(nome, versao, cp))
  const bytesDosPacotes = pacotes.reduce((s, p) => s + p.bytes, 0)
  log(`pacotes do PyPI: ${(bytesDosPacotes / 1e6).toFixed(0)} MB para baixar`)

  return comFontes({
    formato: 1,
    comentario:
      'Gerado por modulos/recap/scripts/motor-lock.mjs a partir do uv pip freeze de motor/.venv (sem o Qt). Nao editar a mao.',
    indice: 'https://pypi.org/simple',
    torch,
    pacotes,
  })
}

/** [recap] Sem venv: o torch e os pacotes (cp312) de outro lock, com as fontes oficiais daqui. */
function deOutroLock(caminho) {
  const outro = JSON.parse(readFileSync(caminho, 'utf8'))
  const [maior, menor] = PYTHON_OFICIAL.versao.split('.')
  if (outro.formato !== 1 || !String(outro.python).startsWith(`${maior}.${menor}.`)) {
    throw new Error(`${caminho} nao e um lock de Python ${maior}.${menor}`)
  }
  log(`do lock ${caminho}: python ${outro.python} -> ${PYTHON_OFICIAL.versao} (oficial), ${outro.pacotes.length} pacotes`)
  return comFontes({
    ...outro,
    comentario:
      'Gerado por modulos/recap/scripts/motor-lock.mjs --de (o lock do AniRecap Studio: uv pip freeze do motor/.venv de la, sem o Qt) com o Python oficial. Nao editar a mao.',
  })
}

const novo = await (DE ? Promise.resolve().then(() => deOutroLock(DE)) : gerar()).catch((e) => {
  process.stderr.write(`\n  ERRO: ${e instanceof Error ? e.message : String(e)}\n\n`)
  process.exit(1)
})
const texto = `${JSON.stringify(novo, null, 2)}\n`
if (CONFERIR) {
  const atual = existsSync(SAIDA) ? readFileSync(SAIDA, 'utf8') : ''
  if (atual.replace(/\r\n/g, '\n') !== texto) {
    process.stderr.write('  motor/studio-runtime.json esta diferente do motor/.venv. Rode: node modulos/recap/scripts/motor-lock.mjs\n')
    process.exit(1)
  }
  log('motor/studio-runtime.json confere com o motor/.venv')
} else {
  writeFileSync(SAIDA, texto)
  log(`gravado ${SAIDA}`)
}
