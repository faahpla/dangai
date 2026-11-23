#!/usr/bin/env node
/**
 * O MOTOR DO ANCUT dentro do Dangai: o codigo e a lista do Python dele.
 *
 *   node scripts/motor-ancut.mjs              copia o app/ do ancut-hub-engine para motor/ancut/app
 *   node scripts/motor-ancut.mjs --lock       regera motor/ancut/ancut-runtime.json do .venv de la
 *   node scripts/motor-ancut.mjs --conferir   so confere (sai 1 se o codigo ou o lock mudaram)
 *
 * O ancut-hub-engine fica ao lado (E:\Projetos\ancut-hub-engine); ANCUT_ENGINE
 * troca. A REGRA e a do modulo recap: nao "melhorar" o motor aqui. Correcao de
 * motor vai para o ancut-hub-engine e volta por este script, para o corte e o
 * reconhecimento sairem iguais nos dois apps.
 *
 * O que fica de fora do codigo: a interface Qt (app/ui, app/main.py,
 * app/updater.py: o Dangai so usa o app.headless), os icones e o __pycache__.
 *
 * O LOCK e o mesmo formato do recap (modulos/recap/scripts/motor-lock.mjs, de
 * onde as contas vieram): o `pip freeze` do .venv do motor, versao por versao,
 * com todos os sha256 do PyPI, o torch por variante (cu128/cpu) do indice da
 * PyTorch, o Python OFICIAL do nuget.org e o uv da release oficial. Sem o Qt e
 * sem o empacotador (PyInstaller): ninguem disso roda no app.headless.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE = resolve(process.env['ANCUT_ENGINE'] || join(ROOT, '..', 'ancut-hub-engine'))
const DESTINO = join(ROOT, 'motor', 'ancut')
const LOCK = join(DESTINO, 'ancut-runtime.json')
const ORIGEM = join(DESTINO, 'origem.json')
const CONFERIR = process.argv.includes('--conferir')
const GERAR_LOCK = process.argv.includes('--lock')

function log(msg) {
  process.stdout.write(`  • ${msg}\n`)
}

// ------------------------------------------------------------------ o codigo

/** Fica de fora: a interface Qt, o atualizador do app Qt, icones, cache do Python. */
function fora(rel) {
  const r = rel.replace(/\\/g, '/')
  return (
    r === 'ui' ||
    r.startsWith('ui/') ||
    r === 'main.py' ||
    r === 'updater.py' ||
    r.split('/').includes('__pycache__') ||
    r.endsWith('.pyc') ||
    r === 'assets/_old_cortecenas' ||
    r.startsWith('assets/_old_cortecenas/') ||
    /^assets\/icon[^/]*\.(ico|png)$/.test(r)
  )
}

/** Os arquivos do codigo (relativos ao app/), em ordem. */
function arquivosDoCodigo(app) {
  const lista = []
  const pilha = ['']
  while (pilha.length) {
    const atual = pilha.pop()
    for (const nome of readdirSync(join(app, atual))) {
      const rel = atual ? `${atual}/${nome}` : nome
      if (fora(rel)) continue
      if (statSync(join(app, rel)).isDirectory()) pilha.push(rel)
      else lista.push(rel)
    }
  }
  return lista.sort()
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ENGINE, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function versaoDoMotor(app) {
  const m = /__version__\s*=\s*"([^"]+)"/.exec(readFileSync(join(app, '__init__.py'), 'utf8'))
  return m?.[1] ?? '?'
}

/** O conteudo normalizado (CRLF -> LF): o git do Windows pode trocar o fim de linha. */
function igual(a, b) {
  const ta = readFileSync(a)
  const tb = readFileSync(b)
  if (ta.equals(tb)) return true
  return ta.toString('utf8').replace(/\r\n/g, '\n') === tb.toString('utf8').replace(/\r\n/g, '\n')
}

function conferirCodigo() {
  const app = join(ENGINE, 'app')
  const aqui = join(DESTINO, 'app')
  if (!existsSync(app)) {
    log(`sem o ancut-hub-engine em ${ENGINE}: o codigo nao foi conferido`)
    return true
  }
  const la = arquivosDoCodigo(app)
  const ca = existsSync(aqui) ? arquivosDoCodigo(aqui) : []
  const diferentes = [
    ...la.filter((r) => !ca.includes(r) || !igual(join(app, r), join(aqui, r))),
    ...ca.filter((r) => !la.includes(r)),
  ]
  if (diferentes.length) {
    process.stderr.write(`  motor/ancut/app difere do ancut-hub-engine (${diferentes.slice(0, 5).join(', ')}${diferentes.length > 5 ? '...' : ''}). Rode: node scripts/motor-ancut.mjs\n`)
    return false
  }
  log(`motor/ancut/app confere com o ancut-hub-engine (${la.length} arquivos)`)
  return true
}

function copiarCodigo() {
  const app = join(ENGINE, 'app')
  if (!existsSync(app)) throw new Error(`nao achei o ancut-hub-engine em ${ENGINE} (ANCUT_ENGINE troca)`)
  const aqui = join(DESTINO, 'app')
  rmSync(aqui, { recursive: true, force: true })
  const lista = arquivosDoCodigo(app)
  for (const rel of lista) {
    mkdirSync(dirname(join(aqui, rel)), { recursive: true })
    cpSync(join(app, rel), join(aqui, rel))
  }
  const origem = {
    repositorio: 'faahpla/ancut-hub-engine',
    commit: git(['rev-parse', 'HEAD']),
    resumo: git(['log', '-1', '--format=%s']),
    versao: versaoDoMotor(app),
    sujo: git(['status', '--porcelain', '--', 'app']) !== '',
  }
  writeFileSync(ORIGEM, `${JSON.stringify(origem, null, 2)}\n`)
  log(`copiado: ${lista.length} arquivos do motor ${origem.versao} (${origem.commit.slice(0, 7)}${origem.sujo ? ', com mudancas sem commit' : ''})`)
}

// ------------------------------------------------------------------ o lock

/** O Python OFICIAL: o pacote "python" do nuget.org (o mesmo do recap). */
const PYTHON_OFICIAL = {
  versao: '3.12.10',
  arquivo: 'python.3.12.10.nupkg',
  url: 'https://api.nuget.org/v3-flatcontainer/python/3.12.10/python.3.12.10.nupkg',
  sha256: '0eb85c2dfccccf1b17352de4c397f69194035b7d37149eacc16f1147d93de3b8',
  bytes: 14515433,
  assinante: 'Python Software Foundation',
}

/** O uv da release oficial (o mesmo do recap). */
const UV = {
  versao: '0.11.7',
  arquivo: 'uv-x86_64-pc-windows-msvc.zip',
  url: 'https://github.com/astral-sh/uv/releases/download/0.11.7/uv-x86_64-pc-windows-msvc.zip',
  sha256: 'fe0c7815acf4fc45f8a5eff58ed3cf7ae2e15c3cf1dceadbd10c816ec1690cc1',
  bytes: 23572531,
  sha256Exe: '831730243cf7bbd496ff96353dcdba6f5d4dcbd22576af398130381ab44ac160',
}

/** A interface Qt e o empacotador: o app.headless nunca importa. */
const FORA_DO_LOCK = new Set([
  'pyside6',
  'pyside6-addons',
  'pyside6-essentials',
  'pyside6-pdf',
  'pyside6-webengine',
  'shiboken6',
  'pyinstaller',
  'pyinstaller-hooks-contrib',
  'altgraph',
  'pefile',
  'pywin32-ctypes',
  'pip',
])
const RODAS = ['torch', 'torchvision']
const VARIANTES = ['cu128', 'cpu']
const INDICE_PYTORCH = 'https://download.pytorch.org/whl'

/** PEP 503: minusculas e qualquer sequencia de - _ . vira um -. */
function normalizar(nome) {
  return nome.toLowerCase().replace(/[-_.]+/g, '-')
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

function serve(arquivo, cp) {
  if (arquivo.endsWith('.tar.gz') || arquivo.endsWith('.zip')) return 'sdist'
  if (!arquivo.endsWith('.whl')) return null
  if (/-none-any\.whl$/.test(arquivo)) return 'any'
  if (!/win_amd64\.whl$/.test(arquivo)) return null
  if (arquivo.includes(`-${cp}-`) || /-abi3-/.test(arquivo) || /-py3-none-/.test(arquivo)) return 'win'
  return 'outro'
}

async function pacoteDoPyPI(nome, versao, cp) {
  const j = await buscar(`https://pypi.org/pypi/${encodeURIComponent(nome)}/${encodeURIComponent(versao)}/json`, 'json')
  const arquivos = (j.urls ?? []).filter((u) => serve(u.filename, cp) !== null && serve(u.filename, cp) !== 'outro')
  if (!arquivos.length) throw new Error(`${nome}==${versao} sem arquivo para Windows x64 no PyPI`)
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

/** O freeze do .venv do motor pelo proprio Python (o uv pode nao estar no PATH). */
function freeze(python) {
  const script =
    "import importlib.metadata as m\nfor d in m.distributions():\n    n = d.metadata['Name']\n    if n: print(f'{n}=={d.version}')"
  return execFileSync(python, ['-c', script], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
}

async function gerarLock() {
  const venv = join(ENGINE, '.venv')
  const python = join(venv, 'Scripts', 'python.exe')
  if (!existsSync(python)) throw new Error(`nao achei o venv do motor em ${venv}`)
  const cfg = readFileSync(join(venv, 'pyvenv.cfg'), 'utf8')
  const versaoPython = /^\s*version_info\s*=\s*(\d+\.\d+\.\d+)/m.exec(cfg)?.[1] ?? /^\s*version\s*=\s*(\d+\.\d+\.\d+)/m.exec(cfg)?.[1]
  if (!versaoPython) throw new Error('pyvenv.cfg sem a versao do Python')
  const [maior, menor] = versaoPython.split('.')
  const cp = `cp${maior}${menor}`
  if (!PYTHON_OFICIAL.versao.startsWith(`${maior}.${menor}.`)) {
    throw new Error(`o venv e Python ${versaoPython} e o oficial do lock e ${PYTHON_OFICIAL.versao}: as rodas nao batem`)
  }
  const vistos = new Map()
  for (const l of freeze(python).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;]+)$/.exec(l)
    if (!m) throw new Error(`linha do freeze fora do formato nome==versao: ${l}`)
    vistos.set(normalizar(m[1]), m[2])
  }
  const pinados = []
  const rodas = {}
  for (const [nome, versao] of vistos) {
    if (FORA_DO_LOCK.has(nome)) continue
    if (RODAS.includes(nome)) rodas[nome] = versao.replace(/\+.*$/, '')
    else pinados.push([nome, versao])
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
  log(`pacotes do PyPI: ${(pacotes.reduce((s, p) => s + p.bytes, 0) / 1e6).toFixed(0)} MB para baixar`)
  return {
    formato: 1,
    comentario: 'Gerado por scripts/motor-ancut.mjs --lock a partir do .venv do ancut-hub-engine (sem o Qt e o PyInstaller). Nao editar a mao.',
    python: PYTHON_OFICIAL.versao,
    pythonOficial: PYTHON_OFICIAL,
    uv: UV,
    indice: 'https://pypi.org/simple',
    torch,
    pacotes,
  }
}

// ------------------------------------------------------------------ main

try {
  if (CONFERIR) {
    const ok = conferirCodigo()
    if (!existsSync(LOCK)) {
      process.stderr.write('  falta motor/ancut/ancut-runtime.json. Rode: node scripts/motor-ancut.mjs --lock\n')
      process.exit(1)
    }
    process.exit(ok ? 0 : 1)
  }
  if (GERAR_LOCK) {
    const lock = await gerarLock()
    writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`)
    log(`gravado ${relative(ROOT, LOCK)}`)
  } else {
    copiarCodigo()
  }
} catch (e) {
  process.stderr.write(`\n  ERRO: ${e instanceof Error ? e.message : String(e)}\n\n`)
  process.exit(1)
}
