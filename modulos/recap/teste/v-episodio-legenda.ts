/**
 * O parser puro da legenda (shared/legenda-episodio.ts) e a sugestao de OP/ED
 * (shared/oped.ts), com entradas escritas a mao -- cada uma e um bug do leitor
 * do AniRecap ou um caso medido nos .mkv reais.
 *
 * Rodar da raiz do projeto:
 *   npx esbuild modulos/recap/teste/v-episodio-legenda.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json | node
 */
import { lerAss, lerLegenda, lerSrt, montarCues, decodificarLegenda } from '../shared/legenda-episodio'
import { motivoDoCapitulo, sugerirOpEd } from '../shared/oped'
import type { Cue, FaixaDeLegenda } from '../shared/episodio'
import { escolherLegenda } from '../electron/episodio/sondar'

let falhas = 0
function confere(ok: boolean, mensagem: string, detalhe?: unknown): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`, detalhe === undefined ? '' : JSON.stringify(detalhe))
  }
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

console.log('\n== .ass')
{
  // Format com os campos em OUTRA ordem (Name antes de Style) e um campo a mais:
  // o leitor por posicao fixa do AniRecap trocava falante e estilo.
  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    '',
    '[Events]',
    'Format: Layer, Start, End, Name, Style, Actor, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:02.50,Senku,Main,x,0,0,0,,Ten billion percent, {\\i1}baby{\\i0}!',
    'Comment: 0,0:00:03.00,0:00:04.00,Senku,Main,x,0,0,0,,linha desligada',
    'Dialogue: 0,0:00:05.00,0:00:06.00,Text,Sign_Basic,x,0,0,0,,{\\pos(320,40)}A Few Years Later',
    'Dialogue: 1,0:00:05.00,0:00:06.00,Text,Sign_Basic,x,0,0,0,,{\\pos(320,40)}A Few Years Later',
    'Dialogue: 0,0:00:07.00,0:00:08.00,,OP_Romaji,x,0,0,0,,{\\k20}ka{\\k30}ze',
    'Dialogue: 0,0:00:09.00,0:00:10.00,,Default,x,0,0,0,,{\\pos(10,10)}PLACA SEM NOME',
    'Dialogue: 0,0:00:11.00,0:00:12.00,Gen,Default,x,0,0,0,,{\\an8\\pos(10,10)}fala posta no alto',
    'Dialogue: 0,0:00:13.00,0:00:14.00,,Default,x,0,0,0,,{\\p1}m 0 0 l 100 0 100 100{\\p0}',
    'Dialogue: 0,0:00:15.00,0:00:16.00,Chrome,Main,x,0,0,0,,Super-\\Nconductor\\Nand, a virgula, fica',
    'Dialogue: 0,0:00:17.00,0:00:18.00,,Main,x,0,0,0,,Cyberpunk EDgerunners nao e musica',
  ].join('\r\n')
  const cues = lerAss(decodificarLegenda(utf8(ass)))
  confere(cues[0]?.falante === 'Senku' && cues[0]?.estilo === 'Main', 'Name e Style pela linha Format, nao pela posicao', cues[0])
  confere(cues[0]?.texto === 'Ten billion percent, baby!', 'tags {...} fora, virgula do texto mantida', cues[0]?.texto)
  confere(!cues.some((c) => c.texto === 'linha desligada'), 'Comment: nao entra')
  const placa = cues.find((c) => c.texto === 'A Few Years Later')
  confere(placa?.tipo === 'placa' && placa.falante === null, "Name 'Text' vira placa sem falante")
  confere(cues.find((c) => c.texto === 'kaze')?.tipo === 'musica', 'estilo OP_Romaji + \\k vira musica')
  confere(cues.find((c) => c.texto === 'PLACA SEM NOME')?.tipo === 'placa', '\\pos sem falante vira placa')
  confere(cues.find((c) => c.texto === 'fala posta no alto')?.tipo === 'fala', '\\pos COM falante continua fala')
  confere(!cues.some((c) => c.texto.startsWith('m 0 0')), 'desenho vetorial (\\p1) nao vira texto')
  confere(cues.some((c) => c.texto === 'Super-conductor and, a virgula, fica'), '\\N vira espaco e a palavra hifenizada volta inteira')
  confere(cues.find((c) => c.texto.startsWith('Cyberpunk'))?.tipo === 'fala', 'palavra dentro de outra (EDgerunners) nao e estilo de musica')
  const montadas = montarCues(cues)
  confere(montadas.filter((c) => c.texto === 'A Few Years Later').length === 1, 'a mesma placa em duas camadas vira uma')
  confere(montadas.map((c) => c.id).join(',') === montadas.map((_, i) => `c${String(i + 1).padStart(4, '0')}`).join(','), 'ids c0001... em ordem')

  // Sem linha Format (ssa velho): cai no formato padrao.
  const semFormat = lerAss('[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,Kohaku,0,0,0,,Oi')
  confere(semFormat[0]?.falante === 'Kohaku' && semFormat[0]?.texto === 'Oi', 'sem Format: usa o padrao do ASS')
}

console.log('\n== encodings')
{
  const ass = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Main,Senkū,0,0,0,,Ação!'
  const comBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(ass)])
  const lido = lerLegenda(comBom, 'ass')
  confere(lido[0]?.falante === 'Senkū' && lido[0]?.texto === 'Ação!', 'utf-8 com BOM: o BOM nao gruda no [Events]', lido[0])

  const le = new Uint8Array(2 + ass.length * 2)
  le[0] = 0xff
  le[1] = 0xfe
  for (let i = 0; i < ass.length; i += 1) {
    le[2 + i * 2] = ass.charCodeAt(i) & 0xff
    le[3 + i * 2] = ass.charCodeAt(i) >> 8
  }
  confere(lerLegenda(le, 'ass')[0]?.texto === 'Ação!', 'utf-16le com BOM')

  const semBom16 = le.subarray(2)
  confere(lerLegenda(semBom16, 'ass')[0]?.texto === 'Ação!', 'utf-16le sem BOM (pelo padrao de zeros)')

  // cp1252: "Acao" com c-cedilha = 0xE7 e a-til = 0xE3, que nao e utf-8 valido
  const srt1252 = new Uint8Array([...utf8('1\n00:00:01,000 --> 00:00:02,000\nA'), 0xe7, 0xe3, ...utf8('o\n')])
  confere(lerLegenda(srt1252, 'srt')[0]?.texto === 'Açãoo'.slice(0, 1) + 'çã' + 'o', 'cp1252 de reserva quando o utf-8 recusa', lerLegenda(srt1252, 'srt')[0]?.texto)
}

console.log('\n== .srt / .vtt')
{
  // Sem linha em branco no fim: o AniRecap perdia a ultima fala.
  const srt = '1\r\n00:00:01,000 --> 00:00:02,000\r\n<i>Primeira</i>\r\n\r\n2\r\n00:00:03,500 --> 00:00:05,000\r\nSegunda\r\nlinha\r\n\r\n3\r\n00:23:59,000 --> 00:24:01,000\r\nUltima sem branco no fim'
  const cues = lerSrt(decodificarLegenda(utf8(srt)))
  confere(cues.length === 3, 'tres cues, a ultima inclusa', cues.length)
  confere(cues[2]?.texto === 'Ultima sem branco no fim' && cues[2]?.start === 1439, 'ultima com texto e tempo certos')
  confere(cues[0]?.texto === 'Primeira' && cues[1]?.texto === 'Segunda linha', 'HTML fora, linhas juntas')
  confere(cues.every((c) => c.falante === null && c.estilo === ''), '.srt sem falante')

  const tipos = lerSrt('1\n00:00:01,000 --> 00:00:02,000\n♪ Letra da abertura ♪\n\n2\n00:00:03,000 --> 00:00:04,000\nNITRIC ACID FIELD\n\n3\n00:00:05,000 --> 00:00:06,000\n[footsteps approaching]\n\n4\n00:00:07,000 --> 00:00:08,000\n[upbeat music playing]\n\n5\n00:00:09,000 --> 00:00:10,000\nSubtitle translation by: Fulana\n\n6\n00:00:11,000 --> 00:00:12,000\nOK!\n')
  confere(tipos.map((c) => c.tipo).join(',') === 'musica,placa,placa,musica,placa,fala', '♪ musica, MAIUSCULA placa, [som] placa, [musica] musica, credito placa, "OK!" fala', tipos.map((c) => c.tipo))

  const vtt = 'WEBVTT\n\nNOTE comentario\n\nid-1\n00:01.000 --> 00:02.500 align:start\nOla &amp; tchau\n\n01:00:00.000 --> 01:00:01.000\nUma hora'
  const v = lerSrt(vtt)
  confere(v.length === 2 && v[0]?.texto === 'Ola & tchau' && v[0]?.end === 2.5 && v[1]?.start === 3600, '.vtt: identificador, NOTE, mm:ss e entidade', v)
}

console.log('\n== base de tempo')
{
  const cruas = [
    { start: 1.5, end: 2, texto: 'a', falante: null, estilo: '', tipo: 'fala' as const },
    { start: 0.2, end: 0.4, texto: 'antes do zero', falante: null, estilo: '', tipo: 'fala' as const },
    { start: 0.1, end: 1.2, texto: 'cruza o zero', falante: null, estilo: '', tipo: 'fala' as const },
  ]
  const m = montarCues(cruas, 0.5)
  confere(m.length === 2 && m[0]!.texto === 'cruza o zero' && m[0]!.start === 0 && m[1]!.start === 1, 'desconta o startTimeSec, corta o que fica antes do zero', m)
}

console.log('\n== OP/ED')
{
  confere(motivoDoCapitulo('Intro', 100, 1440) === 'op', 'capitulo Intro = op')
  confere(motivoDoCapitulo('Opening 2', 100, 1440) === 'op', 'capitulo Opening 2 = op')
  confere(motivoDoCapitulo('Credits', 1300, 1440) === 'ed', 'Credits no fim = ed')
  confere(motivoDoCapitulo('Ending', 1300, 1440) === 'ed', 'Ending = ed')
  confere(motivoDoCapitulo('Preview', 1420, 1440) === 'preview', 'Preview = preview')
  confere(motivoDoCapitulo('Scene 3', 200, 1440) === null && motivoDoCapitulo('Episode', 0, 1440) === null, 'capitulo de historia nao e exclusao')
  confere(motivoDoCapitulo('Prologue', 0, 1440) === null && motivoDoCapitulo('Recap', 0, 1440) === null, 'prologo e recap ficam')

  // Episodio sintetico de 24 min: fala a cada 5 s, com um buraco de 90 s aos
  // 2:00 (OP), outro de 2 min aos 10:00 (cena muda) e 95 s aos 22:00 (ED).
  const cues: Cue[] = []
  const buracos = [[120, 210], [600, 720], [1320, 1415]] as const
  let n = 0
  for (let t = 0; t < 1440; t += 5) {
    if (buracos.some(([a, b]) => t >= a && t < b)) continue
    n += 1
    cues.push({ id: `c${String(n).padStart(4, '0')}`, start: t, end: t + 3, texto: 'x', falante: null, estilo: '', tipo: 'fala' })
  }
  // placa no meio da OP nao pode quebrar o vao
  cues.push({ id: 'c9999', start: 150, end: 152, texto: 'TITULO', falante: null, estilo: '', tipo: 'placa' })
  const s = sugerirOpEd({ duracaoSec: 1440, capitulos: [], cues })
  const op = s.find((x) => x.motivo === 'op')
  const ed = s.find((x) => x.motivo === 'ed')
  confere(op?.start === 118 && op?.end === 210, 'OP pelo primeiro vao (a placa no meio nao conta)', op)
  confere(ed?.start === 1318 && ed?.end === 1415, 'ED pelo ultimo vao perto do fim', ed)
  confere(!s.some((x) => x.start >= 590 && x.end <= 730), 'o vao do meio (cena muda) nao vira exclusao')
  confere(s.every((x) => x.confirmada === false && x.porque.length > 0), 'sugestao nao confirmada, com porque')

  const comConfirmada = sugerirOpEd({
    duracaoSec: 1440,
    capitulos: [],
    cues,
    confirmadas: [{ start: 115, end: 212, motivo: 'op', origem: 'usuario', confirmada: true, porque: '' }],
  })
  confere(!comConfirmada.some((x) => x.motivo === 'op'), 'OP ja confirmada nao volta como sugestao')

  const skip = sugerirOpEd({ duracaoSec: 1440, capitulos: [], cues: [], skipRanges: { head: 90, tail: 90 } })
  confere(
    skip.length === 2 && skip[0]!.origem === 'skip_ranges' && skip[0]!.end === 90 && skip[1]!.start === 1350,
    'skip_ranges do Corte Cenas sem legenda: comeco e fim',
    skip,
  )

  // Bloco de musica no comeco: ganha do vao e vai de fala a fala.
  const comMusica: Cue[] = [
    ...cues,
    ...[125, 135, 145, 160, 175, 190].map((t, i) => ({
      id: `m${i}`, start: t, end: t + 6, texto: 'la la', falante: null, estilo: 'OP', tipo: 'musica' as const,
    })),
  ]
  const m = sugerirOpEd({ duracaoSec: 1440, capitulos: [], cues: comMusica }).find((x) => x.motivo === 'op')
  confere(m?.origem === 'estilo' && m.start === 118 && m.end === 210 && m.porque.includes('bate com'), 'musica de OP ganha do vao e cita o vao', m)
}

console.log('\n== escolher a faixa (faixas como o ffprobe mostrou nos .mkv da pasta Downloads)')
{
  // "index:codec:idioma:titulo:D:F", copiado da varredura dos arquivos reais.
  const faixas = (texto: string): FaixaDeLegenda[] =>
    texto.split(' ; ').map((f) => {
      const [index, codec, idioma, nome, ...marcas] = f.split(':')
      return { index: Number(index), codec: codec!, idioma: idioma!, nome: nome ?? '', default: marcas.includes('D'), forced: marcas.includes('F') }
    })
  const casos: [string, string, number | null][] = [
    ['SubsPlease Hell Mode: a unica faixa e forced, mas e o dialogo', '2:ass:eng:English:D:F', 2],
    ['Re.ZERO VARYG: pt-BR ganha do ingles default', '3:subrip:eng:Forced:F ; 4:subrip:eng::D ; 5:subrip:eng:SDH ; 13:subrip:por:Brazilian ; 14:subrip:rus:', 13],
    ['Witch Hat ToonsHub: por Brazil em .ass', '3:ass:eng::D ; 4:ass:eng:Forced:F ; 5:subrip:eng:CC ; 10:ass:por:Brazil ; 11:ass:rus:', 10],
    ['Kaoru Erai: Brazilian_NF antes do por sem regiao', '2:ass:eng:NF:D ; 4:ass:por:Brazilian_NF ; 14:ass:por:NF', 4],
    ['Chainsaw Man: por Brazil antes de por Europe', '3:subrip:eng::D ; 12:subrip:por:Brazil ; 13:subrip:por:Europe', 12],
    ['Doomdos: ingles ganha do vietnamita default', '2:subrip:vie:Vietnamese:D ; 3:subrip:chi:Simplified Chinese ; 7:subrip:eng:English', 7],
    ['Dr. Stone NF: ingles default, sem SDH', '2:subrip:eng::D ; 3:subrip:jpn: ; 4:subrip:jpn:SDH', 2],
    ['Witch Hat ToonsHub so ingles: .ass limpo antes do CC .srt', '9:ass:eng:Forced:F ; 10:ass:eng::D ; 11:subrip:eng:CC', 10],
    ['Hanazakari AMZN: so japones SDH -- ainda e texto', '2:subrip:jpn:SDH:D', 2],
    ['Signs & Songs perde para a faixa inteira', '2:ass:eng:Signs & Songs:D ; 3:ass:eng:Full Subtitles', 3],
    ['Legenda de imagem (PGS) nunca', '2:hdmv_pgs_subtitle:por::D', null],
    ['Sem legenda', '', null],
  ]
  for (const [nome, texto, esperado] of casos) {
    const obtido = escolherLegenda(texto ? faixas(texto) : [])
    confere(obtido === esperado, nome, { obtido, esperado })
  }
}

console.log(`\n${falhas === 0 ? 'tudo certo' : `${falhas} falha(s)`}`)
if (falhas > 0) process.exit(1)
