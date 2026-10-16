#!/usr/bin/env node
/**
 * Publica uma versão do Dangai no GitHub Releases.
 *
 *   npm run release
 *   npm run release -- --dry-run     monta e confere, sem publicar
 *   npm run release -- --republicar  sobe de novo uma versao ja publicada
 *
 * No ensaio, a arvore suja, a tag ausente e a versao repetida viram AVISO em
 * vez de parar: da para provar o empacotamento antes de commitar e criar a
 * tag. O que o ensaio nao prova e so o upload (`gh`), que ele nunca faz.
 *
 * POR QUE ISTO EXISTE, e não `electron-builder --publish always`:
 *
 * O electron-builder abre UM PUBLISHER POR ARTEFATO, e cada um guarda a
 * release num `new Lazy(...)` próprio da instância. Com dois artefatos (o .exe
 * e o .blockmap) são duas chamadas concorrentes a `getOrCreateRelease()`: as
 * duas listam as releases, as duas leem "não existe", e as duas criam. Uma
 * ganha, a outra leva `422 already_exists` e ABORTA o processo -- junto com o
 * `latest.yml`, que seria gerado depois.
 *
 * Isso derrubou três publicações seguidas:
 *
 *   v1.23.0  a tag não estava no remoto  (causa diferente, já corrigida)
 *   v1.24.0  os dois criaram: duas releases na mesma tag, e o GitHub elegeu
 *            como "latest" justamente a que estava quase vazia
 *   v1.25.0  um criou, o outro morreu: release sem latest.yml
 *
 * Aqui o empacotamento roda com `--publish never` e quem sobe os arquivos é o
 * `gh`, em ordem, depois de conferir. Sem corrida, sem a janela de duas horas
 * que o publisher impõe, e com a chance de OLHAR o latest.yml antes -- que é o
 * que faltou nas três vezes.
 *
 * O `latest.yml` é o arquivo mais perigoso do pacote: sem ele ninguém
 * atualiza, e com o da versão errada todo mundo fica parado achando que está
 * em dia. `release/` não é limpo entre publicações, então o da versão passada
 * fica lá parecendo o novo. Por isso ele é conferido linha a linha.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { conferirPacote, nomeDoExe, REPO } from './conferir-pacote.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry-run')
/** Subir de novo os arquivos de uma versao JA publicada (so de proposito). */
const REPUBLICAR = process.argv.includes('--republicar')

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const TAG = `v${version}`
const EXE = nomeDoExe(version)

function log(msg) {
  process.stdout.write(`  • ${msg}\n`)
}

function morre(msg) {
  process.stderr.write(`\n  ERRO: ${msg}\n\n`)
  process.exit(1)
}

/** O que o ensaio deixou passar e a publicação de verdade recusaria. */
const avisos = []

/**
 * Conferência de ANTES de empacotar: na publicação para tudo; no ensaio só
 * avisa, para dar para ensaiar antes de commitar e de criar a tag.
 */
function recusa(msg) {
  if (!DRY) morre(msg)
  avisos.push(msg)
  process.stdout.write(`  ! AVISO (ensaio): ${msg.split('\n')[0]}\n`)
}

/**
 * `shell` SÓ onde é indispensável, e nunca com argumento que tenha espaço.
 *
 * `npm` e `npx` são .cmd no Windows e não executam sem shell. Mas com shell o
 * Node não escapa nada -- ele concatena os argumentos numa linha só, e o
 * próprio runtime avisa isso. Um `--notes "Dangai 1.26.0"` vira três palavras
 * soltas, e o `gh` responde `no matches found for '1.26.0'`.
 *
 * Foi o que derrubou a primeira execução deste script. `gh` e `git` são .exe:
 * rodam direto, com os argumentos preservados.
 */
function run(cmd, args, opts = {}) {
  const { quiet, shell, ...resto } = opts
  return execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: shell ?? false,
    ...resto,
  })
}

function git(...args) {
  return run('git', args, { quiet: true }).trim()
}

// ----------------------------------------------------------------- conferências

log(`versão ${version}, tag ${TAG}`)

if (git('status', '--porcelain')) {
  recusa('há mudanças não commitadas. Publicar assim geraria um instalador que\n' +
    '  não corresponde a commit nenhum.')
}

/*
 * A TAG PRECISA ESTAR NO REMOTO, e apontando para este commit.
 *
 * O GitHub recusa criar release publicada numa tag que ele não conhece
 * ("Published releases must have a valid tag"), e isso só apareceria depois de
 * todo o tempo de empacotamento -- foi assim que a v1.23.0 se perdeu.
 */
/*
 * Sempre o COMMIT, e nunca o que a ref guarda.
 *
 * Tag leve aponta direto para o commit; tag anotada aponta para um objeto
 * `tag`, que por sua vez aponta para o commit -- e `git rev-parse v1.27.0`
 * devolve o objeto, um sha que não é igual ao do HEAD. Este script nasceu num
 * projeto de tags leves e comparava os dois cruamente, então a primeira tag
 * anotada (as que o `npm version` cria) seria recusada com "não aponta para o
 * commit atual" estando perfeitamente certa. `^{commit}` desfaz os dois casos.
 */
const local = (() => {
  try {
    return git('rev-parse', '--verify', '--quiet', `${TAG}^{commit}`)
  } catch {
    return ''
  }
})()

/*
 * No remoto o mesmo problema aparece em duas linhas: `refs/tags/X` traz o
 * objeto da tag e `refs/tags/X^{}` traz o commit já resolvido (só existe para
 * tag anotada). A última linha é a que vale nos dois casos.
 */
let consultou = true
let remoto
try {
  const linhas = git('ls-remote', 'origin', `refs/tags/${TAG}`, `refs/tags/${TAG}^{}`)
    .split('\n')
    .filter(Boolean)
  remoto = linhas.at(-1)?.split('\t')[0]
} catch (e) {
  // Sem rede ou sem acesso ao origin: publicar nao daria, ensaiar da.
  consultou = false
  recusa(`não consegui consultar as tags no GitHub (${e instanceof Error ? e.message.split('\n')[0] : e}).`)
}

if (!local) {
  recusa(`a tag ${TAG} não existe aqui. Crie e envie antes:\n\n    git tag ${TAG}\n    git push origin ${TAG}\n`)
} else if (!consultou) {
  // ja avisado acima
} else if (!remoto) {
  recusa(`a tag ${TAG} não está no GitHub. Envie antes:\n\n    git push origin ${TAG}\n`)
} else if (remoto !== local) {
  recusa(`a tag ${TAG} no GitHub aponta para outro commit.\n` +
    `  local:  ${local}\n  remoto: ${remoto}`)
} else if (git('rev-parse', 'HEAD') !== local) {
  recusa(`a tag ${TAG} não aponta para o commit atual.`)
} else {
  log('tag conferida no remoto')
}

/*
 * VERSAO REPETIDA. A recusa pela tag nao basta: com a tag no HEAD, rodar de
 * novo (workflow_dispatch, ou o npm run release duas vezes) subia tudo por
 * cima com --clobber. Reempacotar gera um .exe com outros bytes, quem ja esta
 * na versao nao recebe nada, e na janela entre apagar e subir quem baixa a
 * atualizacao recusa pelo sha512 ou nao acha o latest.yml. E a versao precisa
 * ser MAIOR que a que o updater ve como a mais recente.
 */
const maior = (a, b) => {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}
try {
  const ja = JSON.parse(run('gh', ['release', 'view', TAG, '--repo', REPO, '--json', 'assets'], { quiet: true }))
  const nomes = (ja.assets ?? []).map((a) => a.name)
  if (nomes.includes(EXE) && nomes.includes('latest.yml') && !REPUBLICAR) {
    recusa(`versao ${version} ja publicada: suba a versao (ou rode com --republicar, de proposito).`)
  }
} catch (e) {
  const texto = `${e?.stderr ?? ''}${e instanceof Error ? e.message : e}`
  // "release not found" e o normal de uma versao nova; o resto e nao conseguir perguntar.
  if (!/not found|nao encontr/i.test(texto)) recusa(`nao consegui consultar a release ${TAG} no GitHub (${texto.split('\n')[0]}).`)
}
try {
  const ultima = JSON.parse(run('gh', ['api', `repos/${REPO}/releases/latest`], { quiet: true }))
  const v = String(ultima.tag_name ?? '').replace(/^v/, '')
  if (v && v !== version && !maior(version, v)) {
    recusa(`a versao ${version} nao e maior que a publicada como a mais recente (${v}): os apps nao atualizariam.`)
  } else if (v) {
    log(`mais recente no GitHub: ${v}`)
  }
} catch (e) {
  const texto = `${e?.stderr ?? ''}${e instanceof Error ? e.message : e}`
  // Sem release nenhuma ainda o endpoint responde 404: qualquer versao serve.
  if (!/404|not found/i.test(texto)) recusa(`nao consegui consultar a release mais recente no GitHub (${texto.split('\n')[0]}).`)
  else log('nenhuma release publicada ainda')
}

// ------------------------------------------------------------------ empacota

log('empacotando (alguns minutos)...')
// Estes dois precisam de shell (são .cmd), e nenhum argumento tem espaço.
run('npm', ['run', 'build'], { shell: true })
run('npx', ['electron-builder', '--win', '--publish', 'never'], { shell: true })

// ------------------------------------------------------------- confere o pacote

/*
 * Estas três conferências são o coração do script.
 *
 * `release/` não é limpo entre publicações: um latest.yml da versão anterior
 * sobrevive ali e tem cara de novo. Subi-lo produz uma release que parece
 * completa e diz aos apps que a versão mais recente é a velha -- ninguém
 * atualiza, e o sintoma aparece dias depois.
 *
 * O tamanho e o sha512 são conferidos porque reempacotar gera um .exe com
 * bytes diferentes (medido: 88 bytes entre duas execuções). Com o yml
 * apontando para um arquivo que não é o publicado, o updater baixa e recusa
 * na verificação.
 *
 * As conferências moram em scripts/conferir-pacote.mjs, para rodar também
 * sozinhas depois de um `npm run dist`, sem tag nenhuma.
 */
const { erros, info } = conferirPacote({ raiz: ROOT, versao: version })
for (const linha of info) log(linha)
if (erros.length) morre(erros.join('\n  ERRO: '))

if (DRY) {
  if (avisos.length) {
    log(`ensaio — nada foi publicado. Publicar de verdade pararia em ${avisos.length} conferência(s):`)
    for (const a of avisos) process.stdout.write(`      - ${a.split('\n')[0]}\n`)
  } else {
    log('ensaio — nada foi publicado. Os arquivos estão em release/')
  }
  process.exit(0)
}

// ------------------------------------------------------------------- publica

/*
 * A release é criada ANTES de qualquer upload, e por um só processo. Era
 * exatamente isto que faltava: com ela existindo, não há o que dois publishers
 * disputem.
 */
const jaExiste = (() => {
  try {
    run('gh', ['release', 'view', TAG, '--repo', REPO], { quiet: true })
    return true
  } catch {
    return false
  }
})()

if (jaExiste) {
  // Chega aqui so com a release sem os arquivos (um upload que caiu) ou com --republicar.
  log(`release ${TAG} já existe, subindo os arquivos nela${REPUBLICAR ? ' (--republicar)' : ''}`)
} else {
  log(`criando a release ${TAG}`)
  run('gh', ['release', 'create', TAG, '--title', version, '--notes', `Dangai ${version}`])
}

log('subindo .exe, .blockmap e latest.yml')
run('gh', [
  'release', 'upload', TAG,
  `release/${EXE}`,
  `release/${EXE}.blockmap`,
  'release/latest.yml',
  '--clobber',
])

// -------------------------------------------------------------- confere no ar

/*
 * Pergunta o que o UPDATER vê, e não o que está na tag.
 *
 * `gh release view vX.Y.Z` responde por uma release da tag -- e quando havia
 * duas, como na v1.24.0, respondia pela boa enquanto o GitHub servia a outra
 * como "latest". Só este endpoint diz a verdade.
 */
const latest = JSON.parse(
  run('gh', ['api', `repos/${REPO}/releases/latest`], { quiet: true }),
)
const nomes = latest.assets.map((a) => a.name)

if (latest.tag_name !== TAG) {
  morre(`o GitHub está servindo ${latest.tag_name} como a mais recente, e não ${TAG}.`)
}
for (const preciso of [EXE, `${EXE}.blockmap`, 'latest.yml']) {
  if (!nomes.includes(preciso)) morre(`faltou ${preciso} na release publicada.`)
}

log(`publicado: https://github.com/${REPO}/releases/tag/${TAG}`)
log('os apps instalados percebem sozinhos em algumas horas, ou na próxima abertura')
