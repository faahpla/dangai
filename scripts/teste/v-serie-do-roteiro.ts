/**
 * EM QUE ANIME A BIBLIOTECA ABRE (shared/suggest.ts, serieDoRoteiro): a serie
 * com mais personagens citados, mesmo quando um nome existe em duas ("Lucy" em
 * Cyberpunk e em Mushoku Tensei); no empate, o nome do anime no texto decide;
 * ainda empatado, nenhuma. E as series DO VIDEO (videoDoRoteiro): a dele e a
 * franquia, e so os nomes delas sao lidos.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-serie-do-roteiro.ts`.
 */
import type { LibraryClip, ScriptBlock } from '../../shared/channels.ts'
import { readScript } from '../../shared/script-reader.ts'
import { familiaDaSerie, serieDoRoteiro, seriesDoRoteiro, videoDoRoteiro } from '../../shared/suggest.ts'

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

console.log('as series do video e os nomes que valem (videoDoRoteiro)')
{
  // "Ninguem e Especial em Cyberpunk" (11/2026): "cruel" virava a Isolte Cruel de
  // Mushoku, e a montagem punha Mushoku num video de Cyberpunk.
  const mais = [
    ...clips,
    clipe('Cyberpunk 2077', []),
    clipe('Cyberpunk Edgerunners', ['D']),
    clipe('Mushoku Tensei Jobless Reincarnation', ['Cruel, Isolte']),
    clipe('Mushoku Tensei Jobless Reincarnation', ['Roxy']),
  ]
  const todos = [...characters, 'D', 'Cruel, Isolte', 'Roxy']
  const video = (frases: string[], escolhida: string | null = null) =>
    videoDoRoteiro({ ...ctx(frases), clips: mais, characters: todos }, escolhida)
  const cyber = video(['David Martinez e a Lucy.', 'Seriam V e D.', 'Ele ja era extremamente cruel antes dos implantes.'])
  const lidos = readScript(['Ele ja era extremamente cruel.', 'Seriam V e D.'], cyber.index).map((l) => l.matches.map((m) => m.character))
  ok('a franquia entra junto: Edgerunners + 2077', cyber.series.join(' + ') === 'Cyberpunk Edgerunners + Cyberpunk 2077', cyber.series.join(' + '))
  ok('"cruel" nao e lido como a Isolte Cruel de Mushoku', lidos[0]!.length === 0, JSON.stringify(lidos[0]))
  ok('"D", de uma letra so, e lido como o D', JSON.stringify(lidos[1]) === '["D"]', JSON.stringify(lidos[1]))
  const cruzado = video(['David Martinez e a Lucy.', 'Kiwi e Rebecca.', 'Rudeus e Roxy tambem aguentariam?'])
  ok('video que compara de verdade (2 de Mushoku) fica com as duas series', cruzado.series.includes('Mushoku Tensei Jobless Reincarnation'), cruzado.series.join(' + '))
  ok('anime escolhido na montagem manda, com a franquia', video(['Lucy e Rudeus.'], 'Cyberpunk Edgerunners').series.join(' + ') === 'Cyberpunk Edgerunners + Cyberpunk 2077')
  ok('franquia pela primeira palavra longa', familiaDaSerie('Bleach Thousand-Year Blood War', ['Bleach Assets', 'Black Clover', 'Bleach Thousand-Year Blood War']).join(' + ') === 'Bleach Thousand-Year Blood War + Bleach Assets')
}

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
