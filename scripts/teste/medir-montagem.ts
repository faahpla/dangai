/**
 * Mede a MONTAGEM AUTOMATICA contra um video que ele ja fez a mao: a mesma
 * cadeia do "Montar tudo" (electron/services/automount.ts), so que com a
 * transcricao que o projeto ja tem, e a cena que ela poria em cada bloco
 * comparada com a que ele marcou na Biblioteca no mesmo momento da narracao.
 *
 * So le: o projeto, o B-roll (opcional) e a biblioteca do perfil.
 *
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/medir-montagem.ts <projeto.dangai> [b-roll.txt] [recap|theory]`
 *
 * "NADA A VER" e a cena da montagem de outro episodio e sem ninguem em comum com
 * a dele -- e regua dura: a cena dele de outro episodio sem etiqueta conta como
 * erro mesmo quando a da montagem servia. Medido em 11/2026, "Ninguem e Especial
 * em Cyberpunk" com o B-roll dele: 74% antes (temporada do B-roll mal lida,
 * observacao grudada no ultimo episodio, "cruel" lido como a Isolte Cruel de
 * Mushoku, "D" nunca lido), 53-56% depois. Os dois do Bleach ficaram iguais.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lerBroll, preferenciasDoBroll, resolverTemporadas, rotuloDoItem } from '../../shared/broll.ts'
import type { LibraryClip, Nickname, ScriptBlock } from '../../shared/channels.ts'
import { readScript, toSentences } from '../../shared/script-reader.ts'
import { videoDoRoteiro } from '../../shared/suggest.ts'
import { selectClips, type SelectionMode } from '../../shared/selection.ts'

const [projeto, broll, modo = 'recap'] = process.argv.slice(2)
if (!projeto) {
  console.log('uso: medir-montagem.ts <projeto.dangai> [b-roll.txt] [recap|theory]')
  process.exit(1)
}
const perfil = join(process.env.APPDATA ?? '', 'Dangai')
const cache = JSON.parse(readFileSync(join(perfil, 'library-cache.json'), 'utf8')) as {
  episodes: Record<string, { clips: LibraryClip[] }>
}
const clips = Object.values(cache.episodes).flatMap((e) => e.clips)
const characters = [...new Set(clips.flatMap((c) => c.characters))]
const apelidos = Object.values(JSON.parse(readFileSync(join(perfil, 'apelidos.json'), 'utf8')) as Record<string, Nickname[]>).flat()
const arquivo = JSON.parse(readFileSync(projeto, 'utf8')) as {
  transcript: { words: { text: string; start: number; end: number }[] }
  biblioteca: { blocos: ScriptBlock[] | null; porBloco: Record<string, string[]> }
}
const porCaminho = new Map(clips.map((c) => [c.path.toLowerCase(), c]))

// A mesma cadeia do automount.ts.
const frases = toSentences(arquivo.transcript.words)
const { series, index } = videoDoRoteiro(
  { blocks: frases.map((f, i) => ({ ...f, sentence: i })), clips, characters, nicknames: apelidos, descriptions: {} },
  process.env.SERIE ?? null,
)
console.log('series do video:', series.join(' + '))
const lidas = readScript(
  frases.map((f) => f.text),
  index,
)
const linhas = lidas.map((l, i) => ({ ...l, text: frases[i]!.text, start: frases[i]!.start, end: frases[i]!.end }))
const itens = broll ? resolverTemporadas(lerBroll(readFileSync(broll, 'utf8')), clips, series, index) : []
const prefs = preferenciasDoBroll(
  linhas.map((l) => l.text),
  itens,
  index,
)
const blocos = selectClips(linhas, clips, { mode: modo as SelectionMode, series, broll: prefs })

// As cenas dele, por tempo: o bloco da Biblioteca que cobre o meio da linha.
const marcados = (arquivo.biblioteca.blocos ?? []).map((b, i) => ({
  ...b,
  cenas: (arquivo.biblioteca.porBloco[i] ?? []).map((p) => porCaminho.get(p.toLowerCase())).filter((c): c is LibraryClip => !!c),
}))
const episodio = (c: LibraryClip): string => `${c.anime}|${c.season}|${c.episode}`
const rotulo = (c: LibraryClip): string => `${c.anime.split(' ').slice(-1)[0]!.slice(0, 6)} S${c.season}E${c.episode}#${c.shot}`

const conta = { linhas: 0, comDele: 0, mesma: 0, momento: 0, episodio: 0, personagem: 0, nadaAVer: 0 }
for (const [i, b] of blocos.entries()) {
  const meio = (b.start + b.end) / 2
  const dele = marcados.find((m) => m.start <= meio && meio <= m.end + 0.05)?.cenas ?? []
  const auto = b.candidates[0]?.clip
  conta.linhas++
  let veredito = ''
  if (dele.length > 0 && auto) {
    conta.comDele++
    const mesma = dele.some((d) => d.id === auto.id)
    const momento = dele.some((d) => episodio(d) === episodio(auto) && Math.abs(d.start - auto.start) <= 20)
    const ep = dele.some((d) => episodio(d) === episodio(auto))
    const gente = dele.some((d) => d.characters.some((p) => auto.characters.includes(p)))
    if (mesma) conta.mesma++
    if (momento) conta.momento++
    if (ep) conta.episodio++
    if (gente) conta.personagem++
    if (!ep && !gente) conta.nadaAVer++
    veredito = mesma ? 'MESMA' : momento ? 'momento' : ep ? 'episodio' : gente ? 'personagem' : 'NADA A VER'
  }
  const item = prefs[i]?.item ? rotuloDoItem(prefs[i]!.item!) : '-'
  console.log(
    `${String(i).padStart(3)} ${b.text.slice(0, 46).padEnd(46)} | ${item.padEnd(8)} | auto ${auto ? rotulo(auto) : '(nada)'} [${auto?.characters.join(',') ?? ''}] | dele ${dele.map(rotulo).join(' ') || '-'} [${[...new Set(dele.flatMap((d) => d.characters))].join(',')}] | ${veredito}\n      por que: ${b.candidates[0]?.reason ?? ''}`,
  )
}
const pct = (n: number): string => `${Math.round((100 * n) / Math.max(conta.comDele, 1))}%`
console.log(`\n${conta.linhas} blocos, ${conta.comDele} com cena dele no mesmo momento`)
console.log(`  a mesma cena: ${pct(conta.mesma)}   mesmo momento (20s): ${pct(conta.momento)}   mesmo episodio: ${pct(conta.episodio)}   personagem em comum: ${pct(conta.personagem)}`)
console.log(`  NADA A VER (outro episodio e ninguem em comum): ${pct(conta.nadaAVer)}`)
