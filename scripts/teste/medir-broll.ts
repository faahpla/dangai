/**
 * Mede o B-ROLL contra um video que ele JA FEZ: em que posicao as sugestoes da
 * Biblioteca poriam as cenas que ele escolheu, com e sem o B-roll.
 *
 * So le: o projeto (.dangai), o B-roll (.txt) e a biblioteca ja varrida pelo
 * Dangai (library-cache.json e apelidos.json do perfil).
 *
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/medir-broll.ts <projeto.dangai> <b-roll.txt> [pasta do perfil]`
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clipeNoAlvo, lerBroll, resolverTemporadas, rotuloDoItem } from '../../shared/broll.ts'
import type { LibraryClip, Nickname, ScriptBlock } from '../../shared/channels.ts'
import { buildScriptIndex } from '../../shared/script-reader.ts'
import { brollDosTrechos, MAIS_SUGESTOES, sugerirParaBloco, type ContextoDeSugestao } from '../../shared/suggest.ts'

const [projeto, broll, perfil = join(process.env.APPDATA ?? '', 'Dangai')] = process.argv.slice(2)
if (!projeto || !broll) {
  console.log('uso: medir-broll.ts <projeto.dangai> <b-roll.txt> [pasta do perfil]')
  process.exit(1)
}

const cache = JSON.parse(readFileSync(join(perfil, 'library-cache.json'), 'utf8')) as {
  episodes: Record<string, { clips: LibraryClip[] }>
}
const clips = Object.values(cache.episodes).flatMap((e) => e.clips)
const characters = [...new Set(clips.flatMap((c) => c.characters))]
const apelidos = JSON.parse(readFileSync(join(perfil, 'apelidos.json'), 'utf8')) as Record<string, Nickname[]>
const arquivo = JSON.parse(readFileSync(projeto, 'utf8')) as {
  biblioteca: { blocos: ScriptBlock[] | null; porBloco: Record<string, string[]> }
}
const blocos = arquivo.biblioteca.blocos ?? []
const itens = resolverTemporadas(
  lerBroll(readFileSync(broll, 'utf8')),
  clips,
  [],
  buildScriptIndex(characters, Object.values(apelidos).flat()),
)
const porCaminho = new Map(clips.map((c) => [c.path.toLowerCase(), c]))

const ctx = (comBroll: boolean): ContextoDeSugestao => ({
  blocks: blocos,
  clips,
  characters,
  nicknames: Object.values(apelidos).flat(),
  descriptions: {},
  broll: comBroll ? itens : [],
})
const sem = ctx(false)
const com = ctx(true)
const prefs = brollDosTrechos(com)

console.log(`${clips.length} cenas na biblioteca, ${blocos.length} trechos, B-roll com ${itens.length} itens\n`)

/** A melhor posicao (1 = primeira) entre as cenas que ele escolheu; 0 = fora das 60. */
function posicao(c: ContextoDeSugestao, i: number, escolhidas: LibraryClip[]): number {
  const lista = sugerirParaBloco(c, i, new Set(), MAIS_SUGESTOES)
  const ids = new Set(escolhidas.map((e) => e.id))
  const k = lista.findIndex((s) => ids.has(s.clip.id))
  return k + 1
}

/** A primeira sugestao (a que a montagem automatica poria) e do episodio que ele usou? */
const episodio = (c: LibraryClip): string => `${c.anime}|${c.season}|${c.episode}`
function mesmoEpisodio(c: ContextoDeSugestao, i: number, escolhidas: LibraryClip[]): boolean {
  const primeira = sugerirParaBloco(c, i, new Set(), 1)[0]
  return primeira !== undefined && escolhidas.some((e) => episodio(e) === episodio(primeira.clip))
}
const noEpisodio = { sem: 0, com: 0 }

const resultado = { sem: [] as number[], com: [] as number[] }
let doItem = 0
let deOutroItem = 0
let deFora = 0
let semItem = 0
for (const [i, bloco] of blocos.entries()) {
  const escolhidas = (arquivo.biblioteca.porBloco[i] ?? [])
    .map((p) => porCaminho.get(p.toLowerCase()))
    .filter((c): c is LibraryClip => c !== undefined)
  if (escolhidas.length === 0) continue
  const a = posicao(sem, i, escolhidas)
  const b = posicao(com, i, escolhidas)
  resultado.sem.push(a)
  resultado.com.push(b)
  if (mesmoEpisodio(sem, i, escolhidas)) noEpisodio.sem++
  if (mesmoEpisodio(com, i, escolhidas)) noEpisodio.com++

  const item = prefs[i]?.item ?? null
  const eps = escolhidas.map((c) => `${c.anime.split(' ')[0]} S${c.season}E${c.episode}`)
  let onde: string
  if (!item) {
    semItem++
    onde = 'sem item'
  } else if (escolhidas.some((c) => clipeNoAlvo(c, item.alvos))) {
    doItem++
    onde = 'do item'
  } else if (escolhidas.some((c) => clipeNoAlvo(c, itens.flatMap((x) => x.alvos)))) {
    deOutroItem++
    onde = 'OUTRO item'
  } else {
    deFora++
    onde = 'fora da lista'
  }
  const fmt = (n: number): string => (n === 0 ? ' --' : String(n).padStart(3))
  console.log(
    `${String(i).padStart(3)} sem ${fmt(a)} com ${fmt(b)}  ${(item ? rotuloDoItem(item) : '-').padEnd(12)} ${onde.padEnd(13)} ${[...new Set(eps)].join(', ').padEnd(28)} ${bloco.text.slice(0, 60)}`,
  )
}

const taxa = (v: number[], ate: number): string => `${Math.round((100 * v.filter((n) => n > 0 && n <= ate).length) / v.length)}%`
console.log(`\n${resultado.sem.length} trechos com cena escolhida`)
for (const ate of [1, 3, 12, 60]) {
  console.log(`  entre as ${String(ate).padStart(2)} primeiras: sem B-roll ${taxa(resultado.sem, ate).padStart(4)}   com B-roll ${taxa(resultado.com, ate).padStart(4)}`)
}
const pct = (n: number): string => `${Math.round((100 * n) / resultado.sem.length)}%`
console.log(`  a 1a sugestao e do episodio que ele usou: sem B-roll ${pct(noEpisodio.sem).padStart(4)}   com B-roll ${pct(noEpisodio.com).padStart(4)}`)
console.log(`\nde onde vieram as cenas dele, pelo item que o casamento deu ao trecho:`)
console.log(`  do episodio do item: ${doItem}   de outro item: ${deOutroItem}   fora da lista: ${deFora}   trecho sem item: ${semItem}`)
