#!/usr/bin/env node
/**
 * Confere o pacote do Windows que o electron-builder deixou em release/.
 *
 *   node scripts/conferir-pacote.mjs     depois de `npm run dist`
 *
 * O release.mjs chama o mesmo `conferirPacote` antes de subir qualquer
 * arquivo; aqui da para rodar sozinho, sem tag e sem publicar nada.
 *
 * O QUE CONFERE, e por que cada um:
 *
 * - O .exe existe com o nome do win.artifactName (Dangai-<v>-win-x64.exe) e
 *   tem MENOS de 1,9 GiB: o GitHub recusa arquivo de release acima de 2 GiB.
 * - O latest.yml e desta versao, aponta para este .exe e tem o tamanho E o
 *   sha512 dele. `release/` nao e limpo entre execucoes, e um yml velho tem
 *   cara de novo (ver release.mjs). O sha512 e o que o updater confere depois
 *   de baixar: errado, todo mundo baixa e recusa.
 * - O .blockmap existe (a atualizacao diferencial le ele).
 * - resources/app-update.yml aponta para este repo: sem ele o updater do app
 *   instalado nao sabe onde procurar atualizacao.
 * - O onnxruntime-node so com o binario win32/x64 (files do electron-builder.yml).
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** O repositorio das releases (publish do electron-builder.yml). */
export const REPO = 'faahpla/dangai'

/** O mesmo nome do win.artifactName do electron-builder.yml. */
export function nomeDoExe(versao) {
  return `Dangai-${versao}-win-x64.exe`
}

/** 1,9 GiB: folga abaixo do limite de 2 GiB por arquivo do GitHub. */
export const LIMITE_DO_EXE = Math.floor(1.9 * 1024 ** 3)

/**
 * Confere release/ inteira. Devolve { erros, info }: erros vazio = pode subir.
 * Nunca lanca por arquivo faltando; cada falta vira uma linha em `erros`.
 */
export function conferirPacote({ raiz = ROOT, versao } = {}) {
  const v = versao ?? JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).version
  const saida = join(raiz, 'release')
  const exe = nomeDoExe(v)
  const erros = []
  const info = []

  // ---------------------------------------------------------- o .exe e o yml
  const exePath = join(saida, exe)
  const ymlPath = join(saida, 'latest.yml')
  if (!existsSync(exePath)) erros.push(`nao achei ${exe} em release/`)
  if (!existsSync(ymlPath)) erros.push('nao achei release/latest.yml')
  if (!existsSync(`${exePath}.blockmap`)) erros.push(`nao achei ${exe}.blockmap em release/`)

  if (existsSync(exePath)) {
    const tamanho = statSync(exePath).size
    const mb = tamanho / 1024 ** 2
    info.push(`${exe}: ${mb.toFixed(1)} MB (${tamanho} bytes)`)
    if (tamanho >= LIMITE_DO_EXE) {
      erros.push(`${exe} tem ${mb.toFixed(0)} MB: passa de 1,9 GiB e o GitHub recusa (algo pesado entrou no pacote)`)
    }

    if (existsSync(ymlPath)) {
      const antes = erros.length
      const yml = readFileSync(ymlPath, 'utf8')
      const versaoNoYml = /^version:\s*(.+)$/m.exec(yml)?.[1]?.trim()
      const tamanhoNoYml = Number(/^\s*size:\s*(\d+)$/m.exec(yml)?.[1])
      const pathNoYml = /^path:\s*(.+)$/m.exec(yml)?.[1]?.trim()
      const sha512NoYml = /^sha512:\s*(.+)$/m.exec(yml)?.[1]?.trim()
      if (versaoNoYml !== v) {
        erros.push(`release/latest.yml e da versao ${versaoNoYml}, e o pacote e a ${v}. ` +
          'E o arquivo de uma execucao anterior: apague release/ e rode de novo.')
      }
      if (pathNoYml !== exe || !yml.includes(`url: ${exe}`)) {
        erros.push(`release/latest.yml nao aponta para ${exe} (path: ${pathNoYml})`)
      }
      if (tamanhoNoYml !== tamanho) {
        erros.push(`o tamanho no latest.yml (${tamanhoNoYml}) nao bate com o do arquivo (${tamanho})`)
      }
      const sha512 = createHash('sha512').update(readFileSync(exePath)).digest('base64')
      if (sha512NoYml !== sha512) {
        erros.push('o sha512 no latest.yml nao e o do .exe: o updater baixaria e recusaria')
      }
      if (erros.length === antes) info.push(`latest.yml confere: ${v}, ${exe}, ${tamanho} bytes, sha512`)
    }
  }

  // -------------------------------------------------------------- resources
  const res = join(saida, 'win-unpacked', 'resources')
  if (!existsSync(res)) {
    erros.push('nao achei release/win-unpacked/resources (o electron-builder nao rodou?)')
    return { erros, info }
  }

  // O updater do app instalado le daqui.
  const appUpdate = join(res, 'app-update.yml')
  const [owner, repo] = REPO.split('/')
  if (!existsSync(appUpdate)) {
    erros.push('falta resources/app-update.yml: o app instalado nao saberia onde procurar atualizacao')
  } else {
    const au = readFileSync(appUpdate, 'utf8')
    if (!/^provider:\s*github$/m.test(au) || !new RegExp(`^owner:\\s*${owner}$`, 'm').test(au) ||
      !new RegExp(`^repo:\\s*${repo}$`, 'm').test(au)) {
      erros.push(`resources/app-update.yml nao aponta para ${REPO}`)
    } else {
      info.push(`app-update.yml aponta para ${REPO}`)
    }
  }

  // onnxruntime-node so com o binario do Windows x64
  const napi = join(res, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6')
  if (existsSync(napi)) {
    const plataformas = readdirSync(napi)
    const archs = existsSync(join(napi, 'win32')) ? readdirSync(join(napi, 'win32')) : []
    if (!archs.includes('x64')) erros.push('o onnxruntime-node empacotado nao tem o binario win32/x64')
    const outras = [
      ...plataformas.filter((n) => n !== 'win32'),
      ...archs.filter((n) => n !== 'x64').map((n) => `win32/${n}`),
    ]
    if (outras.length) erros.push(`o onnxruntime-node empacotado leva ${outras.join(', ')} (files do electron-builder.yml)`)
  } else {
    erros.push('falta o onnxruntime-node desempacotado')
  }

  return { erros, info }
}

async function main() {
  const { erros, info } = conferirPacote()
  for (const linha of info) process.stdout.write(`  • ${linha}\n`)
  if (erros.length) {
    for (const e of erros) process.stderr.write(`  ERRO: ${e}\n`)
    process.exit(1)
  }
  process.stdout.write('  • pacote conferido\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    process.stderr.write(`\n  ERRO: ${e instanceof Error ? e.message : String(e)}\n\n`)
    process.exit(1)
  })
}
