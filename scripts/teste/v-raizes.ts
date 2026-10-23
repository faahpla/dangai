/**
 * BIBLIOTECA COM VARIAS RAIZES: a libraryDir mais as raizes registradas.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-raizes.ts`.
 *
 * Tudo em pastas sinteticas no TEMP, no formato do AnCut
 * (`<serie>/SxxEyy/shots|keyframes|metadata`). Nenhuma biblioteca real e tocada.
 *
 * - sem raiz registrada, o resultado E o cache sao identicos aos da versao
 *   anterior do library.ts (lida do git e rodada lado a lado);
 * - duas raizes: ids com prefixo, sem colisao;
 * - raiz dentro de outra nao duplica cena;
 * - o cache de uma raiz sobrevive a varredura da outra;
 * - todo leitor (Ctrl+B, Montar sozinho, etiquetar, ler cenas, vocabulario)
 *   pega a lista do mesmo lugar.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import {
  configureLibrary,
  escanearRaizes,
  raizesDaBiblioteca,
  registrarRaizDaBiblioteca,
  scanLibrary,
} from '../../electron/services/library.ts'
import { configureSettings } from '../../electron/services/settings.ts'
import { vocabularioDaBiblioteca } from '../../electron/services/vocabulario.ts'
import type { LibraryIndex } from '../../shared/channels.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const repo = resolve(__dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'dangai-raizes-'))
const pub = (p: string): string => `url:${p}`
/** O texto sem acento: o recado de hoje comparado com o de um commit antigo. */
const semAcento = (t: string): string => t.normalize('NFD').replace(/\p{Diacritic}/gu, '')

// ------------------------------------------------------------ pastas sinteticas

async function episodio(raiz: string, serie: string, pasta: string, cenas: string[], quem: string): Promise<void> {
  const dir = join(raiz, serie, pasta)
  for (const sub of ['shots', 'keyframes', 'metadata']) mkdirSync(join(dir, sub), { recursive: true })
  const linhas = []
  for (const [i, cena] of cenas.entries()) {
    writeFileSync(join(dir, 'shots', `${cena}.mp4`), 'nao e video')
    await sharp({ create: { width: 64, height: 36, channels: 3, background: { r: 40 * i, g: 90, b: 160 } } })
      .jpeg()
      .toFile(join(dir, 'keyframes', `${cena}_1.jpg`))
    linhas.push({
      shot_id: cena,
      file: `shots/${cena}.mp4`,
      keyframe: `keyframes/${cena}_1.jpg`,
      start: i * 2,
      end: i * 2 + 2,
      duration: 2,
      characters: [{ name: quem, character_id: 1 }],
      anime: serie,
      season: 1,
      episode: 1,
    })
  }
  writeFileSync(join(dir, 'metadata', 'shots.json'), JSON.stringify(linhas))
  writeFileSync(join(dir, 'metadata', 'characters.json'), JSON.stringify([{ name: quem, character_id: 1 }]))
}

// O tsx roda isto como CJS: sem await no topo.
async function main(): Promise<void> {
const A = join(tmp, 'libs', 'A')
const B = join(tmp, 'libs', 'B')
const VAZIA = join(tmp, 'libs', 'vazia')
mkdirSync(VAZIA, { recursive: true })
await episodio(A, 'Serie X', 'S01E01', ['0001', '0002', '0003'], 'Alfa')
await episodio(A, 'Serie X', 'S01E02', ['0001'], 'Alfa')
// A mesma serie e o mesmo episodio em B: sem prefixo, os ids colidiriam.
await episodio(B, 'Serie X', 'S01E01', ['0001', '0002'], 'Beta')
await episodio(B, 'Outra', 'S02E05', ['0007'], 'Beta')

const ud = join(tmp, 'ud')
mkdirSync(ud, { recursive: true })
const cacheNovo = join(ud, 'library-cache.json')
function apontar(libraryDir: string): void {
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ libraryDir }))
  configureSettings(ud)
}
configureLibrary(ud)
const ids = (i: LibraryIndex): string[] => i.clips.map((c) => c.id)
const lerCache = (p: string): { episodes: Record<string, { prefixo?: string }> } =>
  JSON.parse(readFileSync(p, 'utf8'))

// ------------------------------------------- a versao anterior, lida do git

/*
 * O library.ts de antes desta mudanca, rodado lado a lado com o novo. Os
 * imports relativos viram absolutos para ele rodar do TEMP; o resto e o
 * arquivo como estava.
 */
const ANTES = '235a08c'
const fonte = execFileSync('git', ['-C', repo, 'show', `${ANTES}:electron/services/library.ts`], { encoding: 'utf8' })
const url = (p: string): string => pathToFileURL(p).href
const sharpUrl = url(createRequire(join(repo, 'package.json')).resolve('sharp'))
const antigoTs = join(tmp, 'antes', 'library.ts')
mkdirSync(join(tmp, 'antes'), { recursive: true })
writeFileSync(
  antigoTs,
  fonte
    .replace(/from '\.\/([\w-]+)'/g, (_m, n: string) => `from '${url(join(repo, 'electron', 'services', `${n}.ts`))}'`)
    .replace(/from '@shared\/([\w-]+)'/g, (_m, n: string) => `from '${url(join(repo, 'shared', `${n}.ts`))}'`)
    .replace(/from 'sharp'/, `from '${sharpUrl}'`),
)
const antigo = (await import(url(antigoTs))) as typeof import('../../electron/services/library.ts')
const udAntes = join(tmp, 'ud-antes')
mkdirSync(udAntes, { recursive: true })

console.log('Sem raiz registrada: igual a antes')
apontar(A)
// Uma raiz registrada que nao tem episodio nao conta: continua o Dangai puro.
registrarRaizDaBiblioteca({ id: 'teste', prefixo: 'teste:', raiz: () => VAZIA })
const so = raizesDaBiblioteca()
ok('a lista e so a libraryDir, sem prefixo', so.length === 1 && so[0]!.raiz === A && so[0]!.prefixo === '')
const novo = await escanearRaizes(so, pub)
antigo.configureLibrary(udAntes)
const velho = await antigo.scanLibrary(A, pub)
// O unico que muda e a pasta do userData (thumbs e cache), que e outra de proposito.
const semUd = (x: unknown, d: string): string => JSON.stringify(x).split(JSON.stringify(d).slice(1, -1)).join('<ud>')
ok('os mesmos ids', JSON.stringify(ids(novo)) === JSON.stringify(ids(velho)), ids(novo).join(', '))
ok('ids sem prefixo', ids(novo).every((id) => id.startsWith('Serie X/')))
ok('o mesmo indice inteiro', semUd(novo, ud) === semUd(velho, udAntes))
ok(
  'o mesmo cache, byte a byte',
  semUd(lerCache(cacheNovo), ud) === semUd(lerCache(join(udAntes, 'library-cache.json')), udAntes),
)
ok('o cache nao ganhou campo de prefixo', !readFileSync(cacheNovo, 'utf8').includes('prefixo'))

apontar('')
ok('sem libraryDir: lista vazia (cada leitor da o aviso de sempre)', raizesDaBiblioteca().length === 0)
const erro = async (f: () => Promise<unknown>): Promise<string> => f().then(() => '', (e: Error) => e.message)
ok(
  'sem raiz: o mesmo erro da varredura antiga',
  (await erro(() => escanearRaizes([], pub))) === (await erro(() => antigo.scanLibrary('', pub))),
)
apontar(join(tmp, 'sumiu'))
ok(
  'libraryDir que sumiu: o mesmo erro de antes',
  // O mesmo recado de antes, agora com acento (v1.78).
  semAcento(await erro(() => escanearRaizes(raizesDaBiblioteca(), pub))) ===
    (await erro(() => antigo.scanLibrary(join(tmp, 'sumiu'), pub))),
)

console.log('Duas raizes')
apontar(A)
registrarRaizDaBiblioteca({ id: 'teste', prefixo: 'teste:', raiz: () => B })
const duas = await escanearRaizes(raizesDaBiblioteca(), pub)
const todos = ids(duas)
ok('cenas das duas', todos.length === 4 + 3, todos.join(', '))
ok('nenhum id repetido', new Set(todos).size === todos.length)
ok(
  'a mesma cena relativa nas duas, com ids diferentes',
  todos.includes('Serie X/S01E01/0001') && todos.includes('teste:Serie X/S01E01/0001'),
)
ok('as de A sem prefixo, as de B com', duas.clips.every((c) => c.id.startsWith('teste:') === c.path.startsWith(B)))
ok('episodios somados', duas.episodes === 2 + 2, String(duas.episodes))
ok('series e personagens das duas', duas.animes.join('|') === 'Outra|Serie X' && duas.characters.join('|') === 'Alfa|Beta')
const miniaturas = duas.clips.map((c) => c.thumbPath)
ok('miniatura propria por id', new Set(miniaturas).size === miniaturas.length)
let invalido = ''
try {
  registrarRaizDaBiblioteca({ id: 'outro', prefixo: 'teste:', raiz: () => B })
} catch (e) {
  invalido = (e as Error).message
}
ok('prefixo de outra raiz e recusado', invalido.includes('teste:'))
for (const prefixo of ['', 'sem-dois-pontos', 'a/b:']) {
  let recusou = false
  try {
    registrarRaizDaBiblioteca({ id: 'x', prefixo, raiz: () => B })
  } catch {
    recusou = true
  }
  ok(`prefixo "${prefixo}" e recusado`, recusou)
}

console.log('Cache por raiz')
const depoisDasDuas = lerCache(cacheNovo).episodes
ok(
  'o cache tem as duas',
  Object.values(depoisDasDuas).some((e) => e.prefixo === 'teste:') &&
    Object.values(depoisDasDuas).some((e) => e.prefixo === undefined),
)
// So a libraryDir de novo: a entrada de B tem que continuar la.
await scanLibrary(A, pub)
ok(
  'varrer A nao apaga o cache de B',
  Object.values(lerCache(cacheNovo).episodes).filter((e) => e.prefixo === 'teste:').length === 2,
)
await scanLibrary(B, pub, () => {}, { prefixoDoId: 'teste:' })
ok(
  'varrer B nao apaga o cache de A',
  Object.values(lerCache(cacheNovo).episodes).filter((e) => e.prefixo === undefined).length === 2,
)
const deNovo = await escanearRaizes(raizesDaBiblioteca(), pub)
ok('a segunda varredura das duas nao rele nada', deNovo.scanned === 0, String(deNovo.scanned))

console.log('Raiz dentro de outra')
registrarRaizDaBiblioteca({ id: 'teste', prefixo: 'teste:', raiz: () => join(A, 'Serie X') })
const dentro = await escanearRaizes(raizesDaBiblioteca(), pub)
ok('raiz dentro da libraryDir nao duplica', JSON.stringify(ids(dentro)) === JSON.stringify(ids(novo)), ids(dentro).join(', '))
registrarRaizDaBiblioteca({ id: 'teste', prefixo: 'teste:', raiz: () => join(tmp, 'libs') })
const fora = await escanearRaizes(raizesDaBiblioteca(), pub)
const caminhos = fora.clips.map((c) => c.path.toLowerCase())
ok('raiz que contem a libraryDir: cada cena uma vez', new Set(caminhos).size === caminhos.length && caminhos.length === 7)
ok(
  'as de A ficam com o id de sempre',
  fora.clips.filter((c) => c.path.startsWith(A)).every((c) => !c.id.startsWith('teste:')),
)
const segunda = await escanearRaizes(raizesDaBiblioteca(), pub)
ok('a mesma pasta com dois prefixos nao se derruba no cache', segunda.scanned === 0, String(segunda.scanned))

console.log('Todo leitor pega a lista do mesmo lugar')
registrarRaizDaBiblioteca({ id: 'teste', prefixo: 'teste:', raiz: () => B })
const vocab = await vocabularioDaBiblioteca(pub)
ok('o vocabulario do Whisper ve as duas', vocab.includes('Alfa') && vocab.includes('Beta'), vocab.join(', '))
const leitores: Record<string, string> = {
  'Ctrl+B, etiquetar e ler cenas (ipc.ts)': 'electron/ipc.ts',
  'Montar sozinho (automount.ts)': 'electron/services/automount.ts',
  'vocabulario (vocabulario.ts)': 'electron/services/vocabulario.ts',
}
for (const [nome, arquivo] of Object.entries(leitores)) {
  const src = readFileSync(join(repo, arquivo), 'utf8')
  const lista = src.match(/raizesDaBiblioteca\(\)/g)?.length ?? 0
  const varre = src.match(/escanearRaizes\(raizes,/g)?.length ?? 0
  const direto = /scanLibrary\(|libraryDir \} = getSettings\(\)|getSettings\(\)\.libraryDir/.test(src)
  ok(`${nome}: le a lista e nunca a libraryDir direto`, lista > 0 && lista === varre && !direto)
}
const ipc = readFileSync(join(repo, 'electron/ipc.ts'), 'utf8')
ok('ipc.ts: os quatro handlers (scan, series, tag, describe) passam pela lista', (ipc.match(/raizesDaBiblioteca\(\)/g)?.length ?? 0) === 4)

rmSync(tmp, { recursive: true, force: true })
console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`)
process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
