#!/usr/bin/env node
/**
 * Publica uma versão do Dangai no GitHub Releases.
 *
 *   npm run release
 *   npm run release -- --dry-run     monta e confere, sem publicar
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
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SAIDA = join(ROOT, 'release')
const DRY = process.argv.includes('--dry-run')

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const TAG = `v${version}`
const EXE = `Dangai-${version}-win-x64.exe`

function log(msg) {
  process.stdout.write(`  • ${msg}\n`)
}

function morre(msg) {
  process.stderr.write(`\n  ERRO: ${msg}\n\n`)
  process.exit(1)
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
  morre('há mudanças não commitadas. Publicar assim geraria um instalador que\n' +
    '  não corresponde a commit nenhum.')
}

/*
 * A TAG PRECISA ESTAR NO REMOTO, e apontando para este commit.
 *
 * O GitHub recusa criar release publicada numa tag que ele não conhece
 * ("Published releases must have a valid tag"), e isso só apareceria depois de
 * todo o tempo de empacotamento -- foi assim que a v1.23.0 se perdeu.
 */
const local = git('rev-parse', TAG)
const remoto = git('ls-remote', 'origin', `refs/tags/${TAG}`).split('\t')[0]

if (!remoto) {
  morre(`a tag ${TAG} não está no GitHub. Envie antes:\n\n    git push origin ${TAG}\n`)
}
if (remoto !== local) {
  morre(`a tag ${TAG} no GitHub aponta para outro commit.\n` +
    `  local:  ${local}\n  remoto: ${remoto}`)
}
if (git('rev-parse', 'HEAD') !== local) {
  morre(`a tag ${TAG} não aponta para o commit atual.`)
}
log('tag conferida no remoto')

// ------------------------------------------------------------------ empacota

log('empacotando (alguns minutos)...')
// Estes dois precisam de shell (são .cmd), e nenhum argumento tem espaço.
run('npm', ['run', 'build'], { shell: true })
run('npx', ['electron-builder', '--win', '--publish', 'never'], { shell: true })

// ------------------------------------------------------------- confere o pacote

const exePath = join(SAIDA, EXE)
const ymlPath = join(SAIDA, 'latest.yml')

if (!existsSync(exePath)) morre(`não achei ${EXE} em release/`)
if (!existsSync(ymlPath)) morre('não achei release/latest.yml')

const yml = readFileSync(ymlPath, 'utf8')
const versaoNoYml = /^version:\s*(.+)$/m.exec(yml)?.[1]?.trim()
const tamanhoNoYml = Number(/^\s*size:\s*(\d+)$/m.exec(yml)?.[1])
const tamanhoReal = statSync(exePath).size

/*
 * Estas três conferências são o coração do script.
 *
 * `release/` não é limpo entre publicações: um latest.yml da versão anterior
 * sobrevive ali e tem cara de novo. Subi-lo produz uma release que parece
 * completa e diz aos apps que a versão mais recente é a velha -- ninguém
 * atualiza, e o sintoma aparece dias depois.
 *
 * O tamanho é conferido porque reempacotar gera um .exe com bytes diferentes
 * (medido: 88 bytes entre duas execuções). Com o yml apontando para um tamanho
 * que o arquivo publicado não tem, o updater baixa e recusa na verificação.
 */
if (versaoNoYml !== version) {
  morre(`release/latest.yml é da versão ${versaoNoYml}, e estamos publicando a ${version}.\n` +
    '  É o arquivo da publicação anterior. Apague release/ e rode de novo.')
}
if (!yml.includes(EXE)) {
  morre(`release/latest.yml não aponta para ${EXE}.`)
}
if (tamanhoNoYml !== tamanhoReal) {
  morre(`o tamanho no latest.yml (${tamanhoNoYml}) não bate com o do arquivo (${tamanhoReal}).`)
}
log(`latest.yml confere: ${version}, ${tamanhoReal} bytes`)

if (DRY) {
  log('ensaio — nada foi publicado. Os arquivos estão em release/')
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
    run('gh', ['release', 'view', TAG], { quiet: true })
    return true
  } catch {
    return false
  }
})()

if (jaExiste) {
  log(`release ${TAG} já existe, subindo os arquivos nela`)
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
  run('gh', ['api', 'repos/faahpla/dangai/releases/latest'], { quiet: true }),
)
const nomes = latest.assets.map((a) => a.name)

if (latest.tag_name !== TAG) {
  morre(`o GitHub está servindo ${latest.tag_name} como a mais recente, e não ${TAG}.`)
}
for (const preciso of [EXE, `${EXE}.blockmap`, 'latest.yml']) {
  if (!nomes.includes(preciso)) morre(`faltou ${preciso} na release publicada.`)
}

log(`publicado: https://github.com/faahpla/dangai/releases/tag/${TAG}`)
log('os apps instalados percebem sozinhos em algumas horas, ou na próxima abertura')
