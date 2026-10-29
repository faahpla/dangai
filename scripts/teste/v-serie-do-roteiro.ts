/**
 * EM QUE ANIME A BIBLIOTECA ABRE (shared/suggest.ts, serieDoRoteiro): a serie
 * com mais personagens citados, mesmo quando um nome existe em duas ("Lucy" em
 * Cyberpunk e em Mushoku Tensei); no empate, o nome do anime no texto decide;
 * ainda empatado, nenhuma.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-serie-do-roteiro.ts`.
 */
import type { LibraryClip, ScriptBlock } from '../../shared/channels.ts'
import { serieDoRoteiro, seriesDoRoteiro } from '../../shared/suggest.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

let n = 0
const clipe = (anime: string, characters: string[]): LibraryClip =>
  ({ id: `c${n++}`, anime, characters, season: 1, episode: 1, shot: String(n), path: `x${n}.mp4`, duration: 3 }) as unknown as LibraryClip
const clips: LibraryClip[] = [
  clipe('Cyberpunk Edgerunners', ['Kiwi']),
  clipe('Cyberpunk Edgerunners', ['Rebecca']),
  clipe('Cyberpunk Edgerunners', ['David Martinez']),
  clipe('Cyberpunk Edgerunners', ['Lucy']),
  clipe('Mushoku Tensei Jobless Reincarnation', ['Lucy']),
  clipe('Mushoku Tensei Jobless Reincarnation', ['Rudeus']),
  clipe('The Apothecary Diaries', ['Maomao']),
]
const characters = ['Kiwi', 'Rebecca', 'David Martinez', 'Lucy', 'Rudeus', 'Maomao']
const ctx = (frases: string[]) => ({
  blocks: frases.map((text, index) => ({ text, index }) as unknown as ScriptBlock),
  clips,
  characters,
  nicknames: [],
  descriptions: {},
})

const kiwi = ctx(['Por que a Kiwi usa a mascara?', 'Rebecca riu.', 'David Martinez chegou com a Lucy.'])
ok('o caso da Kiwi: a lista antiga dava duas series', seriesDoRoteiro(kiwi).length === 2, seriesDoRoteiro(kiwi).join(' ; '))
ok('...e agora abre em Cyberpunk (4 personagens a 1)', serieDoRoteiro(kiwi) === 'Cyberpunk Edgerunners', String(serieDoRoteiro(kiwi)))
ok('so a Lucy, sem nome de anime: empate, nenhuma', serieDoRoteiro(ctx(['A Lucy sorriu.'])) === null)
ok('so a Lucy, com "Mushoku Tensei" no texto: Mushoku', serieDoRoteiro(ctx(['A Lucy de Mushoku Tensei sorriu.'])) === 'Mushoku Tensei Jobless Reincarnation')
ok('sem personagem, com "Cyberpunk" no titulo: Cyberpunk', serieDoRoteiro(ctx(['POR QUE NIGHT CITY E TAO CRUEL EM CYBERPUNK?'])) === 'Cyberpunk Edgerunners')
ok('sem personagem e sem nome de anime: nenhuma', serieDoRoteiro(ctx(['Uma historia triste.'])) === null)
ok('Lucy + Rudeus: Mushoku (2 a 1)', serieDoRoteiro(ctx(['Lucy e Rudeus brigaram.'])) === 'Mushoku Tensei Jobless Reincarnation')
ok('o nome do anime casa palavra inteira, sem acento nem caixa', serieDoRoteiro(ctx(['O apothecary da corte.'])) === 'The Apothecary Diaries')
ok('roteiro vazio: nenhuma', serieDoRoteiro(ctx([])) === null)

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
