/**
 * O ACERVO (25/11): as contas puras de shared/acervo.ts.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-acervo.ts`.
 *
 * - agrupar o historico do motor em anime -> temporada -> episodio, pela
 *   PASTA (como o AnCut), com o B-roll a parte e a capa do mais recente;
 * - o que falta numa temporada (os numeros entre 1 e o maior; a temporada que
 *   comeca no 13 conta do 13);
 * - o numero do episodio pelo nome do arquivo, nos formatos dos releases;
 * - o que falta cortar numa pasta de origem (nem o mesmo arquivo nem o mesmo
 *   numero; abertura e trailer ficam de fora).
 */
import {
  agruparPorAnime,
  faltando,
  filtrarAnimes,
  numeroDoArquivo,
  chaveDoVideo,
  filtrarEpisodios,
  ordenarEpisodios,
  paraCortarNaPasta,
  pastaDoAnime,
  prefixoDaSerie,
  rotuloDoEpisodioDoAcervo,
  soCortados,
  tituloBase,
  type EpisodioDoAcervo,
} from '../../shared/acervo.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const ep = (p: Partial<EpisodioDoAcervo> & Pick<EpisodioDoAcervo, 'pasta' | 'temporada' | 'episodio'>): EpisodioDoAcervo => ({
  episodioId: Math.floor(Math.random() * 1e6),
  anime: 'Chainsaw Man',
  tipo: '',
  cenas: 100,
  marcadas: 50,
  cortadoEm: '2026-11-01',
  capa: '',
  titulo: '',
  origem: '',
  video: '',
  videoExiste: false,
  ...p,
})

console.log('agrupar')
ok('pasta do anime e a mae da do episodio', pastaDoAnime('D:\\Animes\\Chainsaw Man\\S01E04') === 'D:\\Animes\\Chainsaw Man')
ok('na raiz do disco, com a barra', pastaDoAnime('D:\\Chainsaw Man') === 'D:\\')
const lista = [
  ep({ pasta: 'D:\\Animes\\Chainsaw Man\\S01E04', temporada: 1, episodio: 4, cortadoEm: '2026-11-02', capa: 'u4' }),
  ep({ pasta: 'D:\\Animes\\Chainsaw Man\\S01E01', temporada: 1, episodio: 1, cortadoEm: '2026-11-01', capa: 'u1' }),
  ep({ pasta: 'D:\\Animes\\Chainsaw Man\\S01E02', temporada: 1, episodio: 2, cenas: 10, marcadas: 0 }),
  ep({ pasta: 'D:\\Animes\\chainsaw man\\S02E13', temporada: 2, episodio: 13, anime: 'Chainsaw Man 2' }),
  ep({ pasta: 'D:\\Animes\\Chainsaw Man\\S02E15', temporada: 2, episodio: 15 }),
  ep({ pasta: 'D:\\Animes\\Chainsaw Man\\OP01', temporada: 1, episodio: 1, tipo: 'OP' }),
  ep({ pasta: 'D:\\Animes\\Chainsaw Man\\B-roll 01 - Teaser', temporada: 1, episodio: 1, tipo: 'BROLL', titulo: 'Teaser' }),
  ep({ pasta: 'D:\\Filmes\\Reze\\Filme (2025)', temporada: 1, episodio: 1, tipo: 'MOVIE', anime: 'Reze' }),
]
const animes = agruparPorAnime(lista)
const csm = animes.find((a) => a.nome === 'Chainsaw Man')
ok('dois animes (a caixa do Windows nao separa)', animes.length === 2, animes.map((a) => a.nome).join(', '))
ok('temporadas 1 e 2, B-roll a parte', csm?.temporadas.map((t) => t.numero).join() === '1,2' && csm.broll.length === 1)
ok('episodios contam sem o B-roll', csm?.episodios === 6)
ok('cenas e marcadas somam tudo', csm?.cenas === 610 && csm.marcadas === 300, `${csm?.cenas} ${csm?.marcadas}`)
ok('capa do corte mais recente', csm?.capa === 'u4')
ok('dois titulos no historico', csm?.titulos.length === 2)
const t1 = csm?.temporadas[0]
ok('ordem: episodios, depois abertura', t1?.episodios.map((e) => `${e.tipo}${e.episodio}`).join() === '1,2,4,OP1')
ok('falta o 3 na temporada 1', t1?.faltam.join() === '3')
ok('a temporada 2 conta do 13: falta o 14', csm?.temporadas[1]?.faltam.join() === '14')
ok('filme nao tem "falta"', animes.find((a) => a.nome === 'Reze')?.filme === true && animes.find((a) => a.nome === 'Reze')?.temporadas[0]?.faltam.length === 0)
ok('busca pelo nome mantem o anime inteiro', filtrarAnimes(animes, 'chainsaw').length === 1 && filtrarAnimes(animes, 'teaser').length === 1)

console.log('faltando')
ok('nada cortado, nada falta', faltando([]).length === 0)
ok('1,2,5 -> 3,4', faltando([1, 2, 5]).join() === '3,4')
ok('comecando no 2 ainda conta do 1', faltando([2, 3]).join() === '1')
ok('repetido e zero nao atrapalham', faltando([0, 1, 1, 3]).join() === '2')

console.log('o numero pelo nome do arquivo')
const casos: [string, number | null][] = [
  ['[SubsPlease] Kusuriya no Hitorigoto - 30 (1080p) [A1B2C3D4].mkv', 30],
  ['Chainsaw.Man.S01E05.1080p.WEB.x264.mkv', 5],
  ['[Erai-raws] Black Clover - 170v2 [1080p].mkv', 170],
  ['One Piece Ep 1100.mp4', 1100],
  ['Naruto Episodio 12.mp4', 12],
  ['[Judas] Jujutsu Kaisen - S02E07.mkv', 7],
  ['Frieren [08][1080p].mkv', 8],
  ['Bleach 366.mkv', 366],
  ['Chainsaw Man - NCOP.mkv', null],
  ['Chainsaw Man - Trailer 2.mp4', null],
  ['Reze 2025 1080p.mkv', null],
]
for (const [nome, n] of casos) ok(`${nome} -> ${n}`, numeroDoArquivo(nome) === n, String(numeroDoArquivo(nome)))

console.log('o que falta cortar na pasta')
const cortados = [
  { video: 'E:\\Downloads\\CSM\\Chainsaw Man - 01.mkv', temporada: 1, episodio: 1, tipo: '' as const },
  { video: 'E:\\Downloads\\CSM\\Chainsaw Man - 02.mkv', temporada: 1, episodio: 2, tipo: '' as const },
]
const pasta = [
  'E:\\Downloads\\CSM\\Chainsaw Man - 01.mkv',
  'E:\\Downloads\\CSM\\chainsaw man - 02 (copia).mkv',
  'E:\\Downloads\\CSM\\Chainsaw Man - 03.mkv',
  'E:\\Downloads\\CSM\\Chainsaw Man - 10.mkv',
  'E:\\Downloads\\CSM\\Chainsaw Man - NCOP.mkv',
  'E:\\Downloads\\CSM\\legenda.srt',
  'E:\\Downloads\\CSM\\Chainsaw Man - Especial.mkv',
  'E:\\Downloads\\CSM\\[SubsPlease] Bleach - 05 (1080p).mkv',
  'E:\\Downloads\\CSM\\Outro Anime S01E07.mkv',
]
const falta = paraCortarNaPasta(pasta, cortados)
ok('outro anime na mesma pasta fica de fora', !falta.some((f) => /Bleach|Outro/.test(f.arquivo)), falta.map((f) => f.arquivo.split('\\').pop()).join(' | '))
ok('o prefixo da serie', prefixoDaSerie('[SubsPlease] Kusuriya no Hitorigoto - 30 (1080p).mkv') === '[subsplease] kusuriya no hitorigoto' && prefixoDaSerie('Chainsaw.Man.S01E05.1080p.mkv') === 'chainsaw man', `${prefixoDaSerie('[SubsPlease] Kusuriya no Hitorigoto - 30 (1080p).mkv')} | ${prefixoDaSerie('Chainsaw.Man.S01E05.1080p.mkv')}`)
ok('o 03 e o 10 faltam, em ordem', falta.slice(0, 2).map((f) => f.episodio).join() === '3,10', falta.map((f) => `${f.episodio}`).join())
ok('o mesmo arquivo e o mesmo numero nao contam', !falta.some((f) => f.episodio === 1 || f.episodio === 2))
ok('abertura e legenda ficam de fora', !falta.some((f) => /NCOP|srt/i.test(f.arquivo)))
ok('o que nao tem numero entra no fim', falta[falta.length - 1]?.arquivo.endsWith('Especial.mkv') === true && falta[falta.length - 1]?.episodio === null)
ok('a temporada da pasta e a dos cortados', falta.every((f) => f.temporada === 1))
// 25/11: o 0925 e o 1053 cortados como animes proprios (nome lido errado) apareciam como "falta" no 1057.
const wano = 'D:\\Episódios\\One Piece\\Season 20 - Wano Country\\'
const doWano = ['0925 - Dashing!', '1053 - Sanji', '1057 - For Luffy', '1071 - Gear Five!'].map((t) => `${wano}[Anime Time] One Piece - ${t}.mkv`)
const so1057 = [{ video: doWano[2]!, temporada: 1, episodio: 1, tipo: '' as const }]
const todos = new Set(doWano.slice(0, 3).map(chaveDoVideo))
const faltaWano = paraCortarNaPasta(doWano, so1057, todos)
ok('cortado como OUTRO anime nao falta', faltaWano.length === 1 && faltaWano[0]!.episodio === 1071, faltaWano.map((f) => f.episodio).join())
ok('sem a lista do acervo, aparecia (o defeito)', paraCortarNaPasta(doWano, so1057).length === 3)
ok('a chave ignora barra e maiuscula', chaveDoVideo('D:/Episódios/A.MKV') === chaveDoVideo('d:\\episódios\\a.mkv'))

console.log('a ordem e o filtro dos episodios (25/11)')
const bc = [
  ep({ pasta: 'D:\\Animes\\BC\\S01E02', temporada: 1, episodio: 2, cenas: 100, marcadas: 55, cortadoEm: '2026-11-03' }),
  ep({ pasta: 'D:\\Animes\\BC\\S01E10', temporada: 1, episodio: 10, cenas: 100, marcadas: 0, cortadoEm: '2026-11-05', video: 'E:\\a.mkv', videoExiste: true }),
  ep({ pasta: 'D:\\Animes\\BC\\S01E01', temporada: 1, episodio: 1, cenas: 100, marcadas: 41, cortadoEm: '2026-11-01' }),
  ep({ pasta: 'D:\\Animes\\BC\\S01-OP1', temporada: 1, episodio: 1, tipo: 'OP', cenas: 50, marcadas: 0, video: 'E:\\op.mkv', videoExiste: false }),
]
const nums = (l: EpisodioDoAcervo[]): string => l.map((e) => `${e.tipo}${e.episodio}`).join(',')
ok('1 -> ultimo (abertura depois)', nums(ordenarEpisodios(bc, 'numero')) === '1,2,10,OP1', nums(ordenarEpisodios(bc, 'numero')))
ok('ultimo -> 1 e o contrario', nums(ordenarEpisodios(bc, 'numero-desc')) === 'OP1,10,2,1', nums(ordenarEpisodios(bc, 'numero-desc')))
ok('cortados por ultimo', nums(ordenarEpisodios(bc, 'recentes')).startsWith('10,2'), nums(ordenarEpisodios(bc, 'recentes')))
ok('mais marcados primeiro', nums(ordenarEpisodios(bc, 'mais-marcados')).startsWith('2,1'), nums(ordenarEpisodios(bc, 'mais-marcados')))
ok('menos marcados: os so cortados primeiro', nums(ordenarEpisodios(bc, 'menos-marcados')).endsWith('1,2'), nums(ordenarEpisodios(bc, 'menos-marcados')))
ok('ordenar nao mexe na lista original', nums(bc) === '2,10,1,OP1')
ok('filtro so cortados', nums(filtrarEpisodios(bc, 'so-cortados')) === '10,OP1')
ok('filtro com personagem', nums(filtrarEpisodios(bc, 'com-personagem')) === '2,1')
ok('filtro "os que faltam" nao mostra cortado', filtrarEpisodios(bc, 'faltam').length === 0)
const [animeBc] = agruparPorAnime([...bc, ep({ pasta: 'D:\\Animes\\BC\\B-roll 01', temporada: 1, episodio: 1, tipo: 'BROLL', marcadas: 0, video: 'E:\\t.mp4', videoExiste: true })])
const sc = soCortados(animeBc!)
ok('reconhecer os so cortados: so os com video no lugar', nums(sc.prontos) === '10', nums(sc.prontos))
ok('o sem video fica separado (para avisar)', nums(sc.semVideo) === 'OP1', nums(sc.semVideo))
ok('B-roll fica de fora', ![...sc.prontos, ...sc.semVideo].some((e) => e.tipo === 'BROLL'))

console.log('rotulos e titulos')
ok('S01E05', rotuloDoEpisodioDoAcervo({ tipo: '', temporada: 1, episodio: 5, titulo: '' }) === 'S01E05')
ok('Abertura 2', rotuloDoEpisodioDoAcervo({ tipo: 'OP', temporada: 1, episodio: 2, titulo: '' }) === 'Abertura 2')
ok('B-roll com titulo', rotuloDoEpisodioDoAcervo({ tipo: 'BROLL', temporada: 1, episodio: 3, titulo: 'Teaser' }) === 'B-roll 03 · Teaser')
ok('titulo base tira temporada e acento', tituloBase('Mushoku Tensei II: Isekai Ittara Honki Dasu Part 2') === tituloBase('Mushoku Tensei: Isekai Ittara Honki Dasu') && tituloBase('Avatar – Os Sete Refúgios') === 'avatar os sete refugios')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo ok')
process.exit(falhas ? 1 : 0)
