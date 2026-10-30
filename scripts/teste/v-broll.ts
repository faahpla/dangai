/**
 * O B-ROLL (shared/broll.ts): ler os episodios do bloco de notas dele, saber
 * que um .txt e B-roll e nao roteiro, casar cada frase com o item certo, e a
 * escolha de cena preferir -- sem prender -- os episodios da lista.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-broll.ts`.
 */
import {
  casarFrasesComBroll,
  clipeNoAlvo,
  episodiosQueFaltam,
  lerBroll,
  pareceBroll,
  preferenciasDoBroll,
  resolverTemporadas,
  resumoDoBroll,
  rotuloDoItem,
} from '../../shared/broll.ts'
import type { LibraryClip } from '../../shared/channels.ts'
import { buildScriptIndex, readScript } from '../../shared/script-reader.ts'
import { selectClips } from '../../shared/selection.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}
const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// O B-roll do print dele (10/2026), do jeito que a IA devolve: negrito e topicos.
const BROLL = `**1. Episódio 50 — DEATH & STRAWBERRY (4ª parte, episódio 10)**
• Cobre a abertura sobre o último episódio, o salto de dez anos, o destino de Aizen e a energia de Yhwach que reaparece no futuro.
• Cenas principais: reencontro dos personagens, Kazui, Aizen no Muken e encerramento com Number One.

**2. Episódio 49 — THE BLADE (4ª parte, episódio 9)**
• Cobre a pergunta sobre a flecha de Still Silver e o Almighty.
• Cena principal: Uryu participa da derrota de Yhwach, junto aos ataques de Ichigo. É o melhor material para ilustrar a pergunta sobre como o vilão foi atingido.

**3. Episódio 40 — MY LAST WORDS (3ª parte, episódio 14)**
• Cobre a sobrevivência de Uryu à Seleção Sagrada.
• Cena principal: flashback de Uryu criança e Kanae Katagiri sendo atingidos pelo Auswählen. É exatamente a cena mencionada no roteiro.

**4. Episódio 47 — THE END 2 (4ª parte, episódio 7)**
• Cobre a falta de explicação sobre a verdadeira Bankai de Ichigo.
• Cena principal: Ichigo ativa sua Bankai contra Yhwach, mas o Almighty a torna inútil.

**5. Episódio 48 — THE END TWO WORLD (4ª parte, episódio 8)**
• Cobre o desaparecimento de Isshin e Ryuken da reta final e ajuda a contextualizar a flecha de Still Silver.
• Cenas principais: Ryuken entregando a ponta da flecha a Uryu, além do confronto de Aizen e Ichigo contra Yhwach.
`

// 1. Ler
const itens = lerBroll(BROLL)
ok('le os cinco itens', itens.length === 5, String(itens.length))
ok('episodio 50, e a outra conta (4a parte, ep. 10)', igual(itens[0]?.alvos, [{ temporada: null, episodio: 50 }, { temporada: 4, episodio: 10 }]), JSON.stringify(itens[0]?.alvos))
ok('ordem da lista', igual(itens.map((i) => i.alvos[0]!.episodio), [50, 49, 40, 47, 48]))
ok('o texto do item traz o que ele cobre e as cenas', /Still Silver/.test(itens[1]!.texto) && /Uryu participa/.test(itens[1]!.texto) && !/\*\*/.test(itens[1]!.texto))
ok('titulo sem negrito', itens[0]!.titulo === '1. Episódio 50 — DEATH & STRAWBERRY (4ª parte, episódio 10)' || itens[0]!.titulo === 'Episódio 50 — DEATH & STRAWBERRY (4ª parte, episódio 10)', itens[0]!.titulo)
ok('rotulo e resumo', rotuloDoItem(itens[0]!) === 'Episódio 50' && resumoDoBroll(itens) === '5 episódios: 50, 49, 40, 47, 48', resumoDoBroll(itens))

const sem = BROLL.replace(/\*\*/g, '').replace(/• /g, '- ')
ok('o mesmo sem negrito e com traco', igual(lerBroll(sem).map((i) => i.alvos), itens.map((i) => i.alvos)))

const formatos = lerBroll(
  [
    'S01E48 - Ryuken e a flecha',
    'Cena: Ryuken entrega a ponta da flecha.',
    '2ª temporada, episódio 5',
    'Cobre a luta.',
    'Episódios 47 e 48',
    'Ep. 12: a reuniao',
    'Episódio 30 a 32',
    'Temporada 3 Episódio 14',
    'Episódio 50 – 4ª parte, episódio 10',
  ].join('\n'),
)
ok('S01E48', igual(formatos[0]?.alvos, [{ temporada: 1, episodio: 48 }]), JSON.stringify(formatos[0]?.alvos))
ok('2a temporada, episodio 5', igual(formatos[1]?.alvos, [{ temporada: 2, episodio: 5 }]), JSON.stringify(formatos[1]?.alvos))
ok('Episodios 47 e 48', igual(formatos[2]?.alvos.map((a) => a.episodio), [47, 48]), JSON.stringify(formatos[2]?.alvos))
ok('Ep. 12', formatos[3]?.alvos[0]?.episodio === 12)
ok('Episodio 30 a 32 (intervalo)', igual(formatos[4]?.alvos.map((a) => a.episodio), [30, 31, 32]), JSON.stringify(formatos[4]?.alvos))
ok('Temporada 3 Episodio 14', igual(formatos[5]?.alvos, [{ temporada: 3, episodio: 14 }]))
ok('"50 – 4a parte" nao e intervalo', igual(formatos[6]?.alvos, [{ temporada: null, episodio: 50 }, { temporada: 4, episodio: 10 }]), JSON.stringify(formatos[6]?.alvos))

// Os formatos dos B-rolls dele (10/2026), resumidos.
const comSecao = lerBroll(`Cyberpunk: Edgerunners — 1ª temporada

- Episódio 2 — Like a Boy
Lucy mostra a David a simulação da Lua.
Cobre: o sonho de Lucy.

Cyberpunk: Edgerunners 2 — 2ª temporada

- Episódio 4 — Someone That I Used to Know
Capri precisa de um hospedeiro.
Cobre: o satélite.`)
ok('secao de temporada: o 2 e da 1a, o 4 e da 2a', igual(comSecao.map((i) => i.alvos), [[{ temporada: 1, episodio: 2 }], [{ temporada: 2, episodio: 4 }]]), JSON.stringify(comSecao.map((i) => i.alvos)))

const duasLinhas = lerBroll(`B-roll — Re:Zero
Os episódios mais importantes são o 34 e o 35.

2ª temporada — Episódio 9 | Geral 34
Episódio 34 — Love Love Love
Subaru sai da tumba.
Cenas essenciais: Satella surgindo das sombras.

1ª temporada — Episódio 7
Episódio 7 — O Recomeço
Cena essencial: a punição no quarto da mansão.`)
ok('duas cabecas do mesmo episodio viram um item', duasLinhas.length === 2, String(duasLinhas.length))
ok('...com as duas contas (2a temp. ep. 9 e o 34 corrido)', igual(duasLinhas[0]?.alvos, [{ temporada: 2, episodio: 9 }, { temporada: null, episodio: 34 }]), JSON.stringify(duasLinhas[0]?.alvos))
ok('lista sem descricao continua um item por episodio', lerBroll('Episódio 3\nEpisódio 7\nEpisódio 12').length === 3)

// 2. B-roll ou roteiro?
const ROTEIRO = `Mano, como o Uryu sobreviveu à Seleção Sagrada?

Episódio 40 foi onde tudo ficou claro.

O Yhwach tirou o poder de todos os Quincy mestiços, mas o Uryu continuou de pé.

E ninguém explicou direito a flecha de Still Silver.`
ok('o B-roll e B-roll', pareceBroll(BROLL))
ok('o roteiro nao e (mesmo com uma frase "Episodio 40 foi...")', !pareceBroll(ROTEIRO))
ok('o nome "b-roll.txt" resolve com um item so', pareceBroll('Episódio 48\nRyuken e a flecha', 'B-roll do Uryu.txt') && !pareceBroll('Episódio 48\nRyuken e a flecha', 'roteiro.txt'))
// Descricao corrida entre os topicos, sem marcador de lista (o B-roll 4 dele).
const corrido = `Episódios recomendados

Episódio 1 — Last Chance for a Slow Dance
Mostra King sofrendo com a ciberpsicose, perdendo seus implantes e chegando ao ponto de desistir da vida.
Cobre: abertura, passado de King.

Episódio 2 — Give Me Another Day
Avida procura King e afirma que Talia é filha dele. É a cena central para mostrar como ela o convenceu.
Cobre: antigo relacionamento e mentira sobre a paternidade.`
ok('B-roll de descricao corrida, pelo conteudo (nome qualquer)', pareceBroll(corrido, 'notas.txt'))

// 3. A cena e do episodio?
const clipe = (pasta: string, season: number, episode: number, characters: string[] = [], shot = '0001', duration = 4): LibraryClip =>
  ({
    id: `${pasta}/${shot}`,
    path: `D:\\Animes\\Bleach Thousand-Year Blood War\\${pasta}\\shots\\${shot}.mp4`,
    anime: 'Bleach Thousand-Year Blood War',
    animeTitle: '',
    season,
    episode,
    shot,
    start: Number(shot),
    duration,
    characters,
    thumbUrl: '',
    thumbPath: '',
    keyframe: '',
  }) as LibraryClip
ok('S01E50 e do "Episodio 50"', clipeNoAlvo(clipe('S01E50', 1, 50), itens[0]!.alvos))
ok('a abertura S01-OP2 (json diz episodio 2) nao e do "Episodio 2"', !clipeNoAlvo(clipe('S01-OP2', 1, 2), [{ temporada: null, episodio: 2 }]))
ok('temporada errada nao vale', !clipeNoAlvo(clipe('S02E05', 2, 5), [{ temporada: 3, episodio: 5 }]) && clipeNoAlvo(clipe('S02E05', 2, 5), [{ temporada: 2, episodio: 5 }]))

// 4. Qual frase vai com qual item
const frases = [
  'Bleach terminou com um salto de dez anos.',
  'O Aizen continua preso no Muken, e a energia do Yhwach reapareceu.',
  'Mas ninguém explicou direito a flecha de Still Silver.',
  'Como ela anulou o Almighty?',
  'E tem mais.',
  'Como o Uryu sobreviveu à Seleção Sagrada?',
  'Ele era um Quincy mestiço, e mesmo assim ficou de pé.',
  'A verdadeira Bankai do Ichigo nunca foi explicada.',
  'O Almighty simplesmente quebrou a espada dele.',
  'E onde estavam o Isshin e o Ryuken na reta final?',
  'Eles simplesmente desapareceram.',
]
const casou = casarFrasesComBroll(frases, itens)
console.log('    casamento:', casou.map((k) => (k === null ? '-' : k + 1)).join(' '))
ok('o salto de dez anos e o Muken -> item 1 (ep. 50)', casou[0] === 0 && casou[1] === 0)
ok('a flecha de Still Silver -> item 2 (ep. 49)', casou[2] === 1)
ok('"Como ela anulou o Almighty?" vai com a vizinha -> item 2', casou[3] === 1)
ok('a Selecao Sagrada -> item 3 (ep. 40)', casou[5] === 2 && casou[6] === 2)
ok('a Bankai -> item 4 (ep. 47)', casou[7] === 3 && casou[8] === 3)
ok('Isshin e Ryuken -> item 5 (ep. 48)', casou[9] === 4 && casou[10] === 4)
ok('sem B-roll, nada', casarFrasesComBroll(frases, []).every((k) => k === null))

// Os trechos da mesma frase casam juntos (a Biblioteca corta na virgula).
const trechos = ['E onde estavam,', 'na reta final,', 'o Isshin e o Ryuken?']
ok('trechos da mesma frase herdam o item dela', igual(casarFrasesComBroll(trechos, itens, undefined, [0, 0, 0]), [4, 4, 4]))

// 5. A escolha prefere o episodio do item -- e nao prende.
const personagens = ['Ishida, Uryuu', 'Kurosaki, Ichigo', 'Ryuken', 'Yhwach', 'Aizen, Sousuke']
// "Uryu" no roteiro e "Ishida, Uryuu" no AnCut: e o apelido que ele cadastra.
const indice = buildScriptIndex(personagens, [{ term: 'Uryu', character: 'Ishida, Uryuu' }])
const clips = [
  clipe('S01E14', 1, 14, ['Ishida, Uryuu'], '0010'),
  clipe('S01E14', 1, 14, ['Ishida, Uryuu'], '0011'),
  clipe('S01E40', 1, 40, ['Ishida, Uryuu'], '0200'),
  clipe('S01E48', 1, 48, ['Ishida, Uryuu', 'Ryuken'], '0300'),
  clipe('S01E48', 1, 48, ['Ryuken'], '0301'),
  clipe('S01E49', 1, 49, ['Ishida, Uryuu'], '0400'),
]
const linhas = (textos: string[]) =>
  readScript(textos, indice).map((l, i) => ({ ...l, text: textos[i]!, start: i * 3, end: i * 3 + 3 }))
const t1 = ['Como o Uryu sobreviveu à Seleção Sagrada?']
const semBroll = selectClips(linhas(t1), clips, { mode: 'theory', fita: 6 })[0]!
const comBroll = selectClips(linhas(t1), clips, { mode: 'theory', fita: 6, broll: preferenciasDoBroll(t1, itens, indice) })[0]!
ok('sem B-roll: a primeira e a do episodio 14 (o desempate antigo)', semBroll.candidates[0]?.clip.episode === 14, String(semBroll.candidates[0]?.clip.episode))
ok('com B-roll: a primeira e a do episodio 40 (o do item)', comBroll.candidates[0]?.clip.episode === 40, comBroll.candidates[0]?.reason ?? '')
ok('o motivo diz de onde veio', /B-roll: Episódio 40/.test(comBroll.candidates[0]?.reason ?? ''), comBroll.candidates[0]?.reason)
ok('as de fora da lista continuam na fita', comBroll.candidates.some((c) => c.clip.episode === 14))

// Frase sem nome: o item do B-roll empresta quem ele cita.
const t2 = ['E onde estavam o pai dele na reta final?']
const semNome = selectClips(linhas(t2), clips, { mode: 'theory', fita: 6, broll: preferenciasDoBroll(t2, itens, indice) })[0]!
ok('frase sem nome: entra a cena do Ryuken do episodio 48', semNome.candidates[0]?.clip.shot === '0301' || semNome.candidates[0]?.clip.shot === '0300', semNome.candidates.map((c) => c.clip.shot + ' ' + c.reason).join(' | '))

// 6. O episodio que nao esta cortado no AnCut
const faltam = episodiosQueFaltam(itens, clips, [])
ok('avisa que faltam os episodios 50 e 47', igual(faltam.map(rotuloDoItem), ['Episódio 50', 'Episódio 47']), faltam.map(rotuloDoItem).join(', '))

// 7. "Episodio 4" sem temporada num anime com duas: decide quem o B-roll cita.
const cp = (pasta: string, season: number, episode: number, characters: string[]): LibraryClip =>
  ({ ...clipe(pasta, season, episode, characters), anime: 'Cyberpunk Edgerunners', path: `D:\\Animes\\Cyberpunk Edgerunners\\${pasta}\\shots\\0001.mp4` }) as LibraryClip
const cyber = [cp('S01E04', 1, 4, ['David Martinez']), cp('S02E04', 2, 4, ['Talia']), cp('S02E05', 2, 5, ['Avida', 'Kiril']), cp('S01E05', 1, 5, ['Lucy'])]
const indiceCp = buildScriptIndex(['David Martinez', 'Talia', 'Avida', 'Kiril', 'Lucy'], [])
const semTemp = lerBroll('1. Episódio 4 — Someone\nD encontra a lista com seu nome, Talia e David Martinez.\n\n2. Episódio 8 — Serce\nKiril intercepta, e Avida é atingida.')
const resolvidos = resolverTemporadas(semTemp, cyber, [], indiceCp)
ok('Talia, Avida e Kiril votam na 2a temporada (David, de passagem, na 1a)', igual(resolvidos[0]?.alvos, [{ temporada: 2, episodio: 4 }]), JSON.stringify(resolvidos[0]?.alvos))
ok('episodio que so existe numa temporada fica como estava', igual(resolvidos[1]?.alvos, [{ temporada: null, episodio: 8 }]), JSON.stringify(resolvidos[1]?.alvos))

// 8. A pista de lugar: "Cobre a abertura" puxa o comeco; "para o encerramento", o fim.
const lugar = lerBroll(`Episódio 1 — A
Cobre a abertura e o passado de King.

Episódio 9 — B
Kiril entrega Talia.

Episódio 10 — C
O episódio essencial para o encerramento.`)
const roteiroDeLugar = ['O que ninguém percebeu nessa história?', 'Kiril entregou a própria filha.', 'Ninguém esperava.', 'E foi assim que tudo terminou.']
ok('o gancho vai com a abertura e a ultima frase com o encerramento', igual(casarFrasesComBroll(roteiroDeLugar, lugar), [0, 1, 1, 2]), JSON.stringify(casarFrasesComBroll(roteiroDeLugar, lugar)))
ok('"encerramento com Number One" e o ED do anime, nao o fim do video', !/para o encerramento/.test(itens[0]!.texto) && casou[casou.length - 1] === 4)

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
