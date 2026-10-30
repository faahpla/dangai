/**
 * Mostra como o Dangai LE um B-roll e casa com o roteiro: os itens e episodios
 * que achou, se cada episodio esta na biblioteca, e o item de cada frase.
 * Para conferir a olho um B-roll novo, sem precisar de projeto.
 *
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/medir-broll-roteiro.ts <b-roll.txt> <roteiro.txt> [pasta do perfil]`
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { episodiosQueFaltam, lerBroll, pareceBroll, preferenciasDoBroll, resolverTemporadas, rotuloDoItem } from '../../shared/broll.ts'
import type { LibraryClip, Nickname } from '../../shared/channels.ts'
import { buildScriptIndex } from '../../shared/script-reader.ts'
import { serieDoRoteiro } from '../../shared/suggest.ts'

const [broll, roteiro, perfil = join(process.env.APPDATA ?? '', 'Dangai')] = process.argv.slice(2)
if (!broll || !roteiro) {
  console.log('uso: medir-broll-roteiro.ts <b-roll.txt> <roteiro.txt> [pasta do perfil]')
  process.exit(1)
}
const cache = JSON.parse(readFileSync(join(perfil, 'library-cache.json'), 'utf8')) as {
  episodes: Record<string, { clips: LibraryClip[] }>
}
const clips = Object.values(cache.episodes).flatMap((e) => e.clips)
const characters = [...new Set(clips.flatMap((c) => c.characters))]
const apelidos = Object.values(JSON.parse(readFileSync(join(perfil, 'apelidos.json'), 'utf8')) as Record<string, Nickname[]>).flat()
const indice = buildScriptIndex(characters, apelidos)

const textoDoBroll = readFileSync(broll, 'utf8')
const textoDoRoteiro = readFileSync(roteiro, 'utf8')
const frases = textoDoRoteiro.split(/(?<=[.!?])\s+|\r?\n+/).map((f) => f.trim()).filter(Boolean)
const serie = serieDoRoteiro({ blocks: frases.map((text, i) => ({ text, start: i, end: i + 1, sentence: i })), clips, characters, nicknames: apelidos, descriptions: {} })
const lidos = lerBroll(textoDoBroll)
const itens = resolverTemporadas(lidos, clips, serie ? [serie] : [], indice)

console.log(`e B-roll: ${pareceBroll(textoDoBroll, broll)} | o roteiro parece B-roll: ${pareceBroll(textoDoRoteiro, roteiro)} | anime: ${serie}`)
const faltam = new Set(episodiosQueFaltam(itens, clips, serie ? [serie] : []))
for (const [k, item] of itens.entries()) {
  const alvos = item.alvos.map((a) => (a.temporada === null ? `E${a.episodio}` : `S${a.temporada}E${a.episodio}`)).join(' / ')
  console.log(`  ${k + 1}. ${alvos.padEnd(16)} ${faltam.has(item) ? 'FALTA NA BIBLIOTECA' : 'na biblioteca      '}  ${item.titulo.slice(0, 70)}`)
}
console.log()
const prefs = preferenciasDoBroll(frases, itens, indice)
for (const [i, f] of frases.entries()) {
  const item = prefs[i]?.item
  const k = item ? itens.indexOf(item) + 1 : 0
  console.log(`  ${k ? String(k).padStart(2) : ' -'}  ${(item ? rotuloDoItem(item) : '').padEnd(12)} ${f.slice(0, 100)}`)
}
