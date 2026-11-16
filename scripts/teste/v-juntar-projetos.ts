/**
 * JUNTAR PROJETOS: dois ou tres videos de ~30 s viram um de 60 s+, cada parte
 * inteira e tudo dela no tempo certo. `npx tsx scripts/teste/v-juntar-projetos.ts`.
 *
 * - cada parte comeca onde a anterior (e a frase de ligacao) termina;
 * - cenas, palavras, legendas, sons, camadas e a escolha da Biblioteca andam juntos;
 * - a frase de ligacao entra com a cena, a legenda, o roteiro e o bloco dela;
 * - o "so som" poe o som no corte, numa faixa so dele, sem tempo a mais;
 * - nada se perde ao reabrir (o resultado passa pelo schema do arquivo).
 */
import { projectFileSchema, type ProjectFile } from '../../shared/project-file.ts'
import { sobreposicaoSchema, VIDEO_FPS } from '../../shared/contract.ts'
import { antesDoCorte, caberAte, cobrirAFraseAntes, juntarProjetos, seguirSobAFrase } from '../../shared/juntar-projetos.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}
const perto = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6

/** Um projeto de `dur` segundos: duas cenas, quatro palavras, duas legendas, uma musica e uma camada. */
function projeto(nome: string, dur: number): ProjectFile {
  const meio = dur / 2
  return projectFileSchema.parse({
    version: 2,
    savedAt: '2026-11-16T00:00:00Z',
    audio: { path: `D:/${nome}.wav`, rel: null, fileName: `${nome}.wav` },
    images: [
      { path: `D:/${nome}-a.mp4`, rel: null, fileName: 'a.mp4', focusX: 0.5, focusY: 0.5 },
      { path: `D:/${nome}-b.mp4`, rel: null, fileName: 'b.mp4', focusX: 0.5, focusY: 0.5 },
    ],
    script: `${nome} um. ${nome} dois.`,
    subtitle: null,
    plan: {
      scenes: [
        { imageIndex: 0, start: 0, end: meio, effect: 'zoom-in', intensity: 0.1, transitionIn: 'cut' },
        { imageIndex: 1, start: meio, end: dur, effect: 'pan-left', intensity: 0.1, transitionIn: 'cut' },
      ],
    },
    planOrigin: 'auto',
    planEdited: false,
    transcript: {
      source: 'script',
      words: [
        { text: nome, start: 0.2, end: 0.8 },
        { text: 'um.', start: 0.9, end: 1.4 },
        { text: nome, start: meio + 0.2, end: meio + 0.8 },
        { text: 'dois.', start: meio + 0.9, end: meio + 1.4 },
      ],
      segments: [{ text: `${nome} um.`, start: 0.2, end: 1.4 }],
      text: `${nome} um. ${nome} dois.`,
      cutCandidates: [meio],
      alinhado: true,
    },
    captions: [
      { from: 6, durationInFrames: 30, words: [{ text: nome, from: 6, durationInFrames: 18 }] },
      { from: Math.round(meio * VIDEO_FPS), durationInFrames: 30, words: [{ text: 'dois.', from: Math.round(meio * VIDEO_FPS), durationInFrames: 30 }] },
    ],
    captionsEdited: false,
    captionsEnabled: true,
    sfxEnabled: false,
    trilhas: [
      { id: 'musica', path: `D:/${nome}-musica.mp3`, fileName: 'musica.mp3', faixa: 1, at: 0, durationSec: dur },
    ],
    sobreposicoes: [],
    biblioteca: {
      escolhidos: [],
      blocos: [
        { text: `${nome} um.`, start: 0, end: meio, sentence: 0 },
        { text: `${nome} dois.`, start: meio, end: dur, sentence: 1 },
      ],
      porBloco: { '0': [`D:/${nome}-a.mp4`], '1': [`D:/${nome}-b.mp4`] },
      pesos: {},
      unioes: {},
      cortes: {},
      ativo: 1,
    },
  })
}

const a = projeto('Asta', 30)
const b = projeto('Yami', 28)
const c = projeto('Noelle', 31)
const audio = { path: 'D:/junto.wav', rel: null, fileName: 'junto.wav' }

console.log('\n== frase de ligacao entre a 1a e a 2a, so som entre a 2a e a 3a')
const frase = {
  tipo: 'frase' as const,
  duracao: 2,
  texto: 'E não para por aí...',
  palavras: [
    { text: 'E', start: 0.1, end: 0.25 },
    { text: 'não', start: 0.3, end: 0.6 },
    { text: 'para', start: 0.65, end: 0.95 },
    { text: 'por', start: 1, end: 1.2 },
    { text: 'aí...', start: 1.25, end: 1.8 },
  ],
  cena: null,
}
const som = { tipo: 'som' as const, som: { path: 'D:/whoosh.mp3', fileName: 'whoosh.mp3', durationSec: 1.2, peaks: [0.1, 0.9, 0.2] } }
const r = juntarProjetos(
  [
    { file: a, duracao: 30 },
    { file: b, duracao: 28 },
    { file: c, duracao: 31 },
  ],
  [frase, som],
  audio,
)
const f = r.file

ok('as partes comecam em 0, 32 (30 + a frase) e 60', perto(r.inicios[0]!, 0) && perto(r.inicios[1]!, 32) && perto(r.inicios[2]!, 60), JSON.stringify(r.inicios))
ok('a duracao total e 91 s (30 + 2 + 28 + 31)', perto(r.duracao, 91))
ok('as ligacoes: a frase em 30, o corte do som em 60', perto(r.ligacoes[0]!, 30) && perto(r.ligacoes[1]!, 60), JSON.stringify(r.ligacoes))

console.log('\n== as cenas')
const cenas = f.plan!.scenes
ok('7 cenas: 2 + a da frase + 2 + 2', cenas.length === 7, String(cenas.length))
ok('sem buraco nem sobreposicao entre as cenas', cenas.every((s, i) => i === 0 || perto(s.start, cenas[i - 1]!.end)))
ok('a primeira comeca em 0 e a ultima termina em 91', perto(cenas[0]!.start, 0) && perto(cenas.at(-1)!.end, 91))
ok('a cena da frase vai de 30 a 32', perto(cenas[2]!.start, 30) && perto(cenas[2]!.end, 32))
ok(
  'a cena da frase e a primeira da parte seguinte (sem cena escolhida)',
  f.images[cenas[2]!.imageIndex]!.path === 'D:/Yami-a.mp4',
  f.images[cenas[2]!.imageIndex]!.path,
)
ok('as imagens da 2a parte apontam para as dela', f.images[cenas[3]!.imageIndex]!.path === 'D:/Yami-a.mp4' && f.images[cenas[4]!.imageIndex]!.path === 'D:/Yami-b.mp4')
ok('a 3a parte comeca em 60 com a cena dela', perto(cenas[5]!.start, 60) && f.images[cenas[5]!.imageIndex]!.path === 'D:/Noelle-a.mp4')

console.log('\n== as palavras, as legendas e o roteiro')
const w = f.transcript!.words
ok('17 palavras: 4 + 5 da frase + 4 + 4', w.length === 17, String(w.length))
ok('a primeira palavra da 2a parte anda 32 s', perto(w[9]!.start, 32.2), String(w[9]!.start))
ok('a frase entra em 30 + o tempo dela', perto(w[4]!.start, 30.1) && w[8]!.text === 'aí...', `${w[4]!.start} ${w[8]!.text}`)
ok('as palavras ficam em ordem', w.every((x, i) => i === 0 || x.start >= w[i - 1]!.start))
ok('a legenda da 2a parte anda 32 s em quadros', f.captions.some((cap) => cap.from === 6 + Math.round(32 * VIDEO_FPS)), f.captions.map((cap) => cap.from).join())
ok('a frase ganhou legenda (comeca em 30 s)', f.captions.some((cap) => cap.from >= 30 * VIDEO_FPS && cap.from < 32 * VIDEO_FPS))
ok('as legendas de cada parte ficam como ele deixou', f.captionsEdited === true)
ok('o roteiro: as tres partes e a frase, em paragrafos', f.script === 'Asta um. Asta dois.\n\nE não para por aí...\n\nYami um. Yami dois.\n\nNoelle um. Noelle dois.', JSON.stringify(f.script))
ok('os tempos ja sao os certos: transcricao travada', f.transcriptTravado === true)

console.log('\n== os sons e a musica')
const musicas = f.trilhas.filter((x) => x.fileName === 'musica.mp3')
ok('a musica de cada parte anda junto (0, 32, 60)', musicas.map((x) => x.at).join() === '0,32,60', musicas.map((x) => x.at).join())
ok('os ids nao se repetem entre as partes', new Set(f.trilhas.map((x) => x.id)).size === f.trilhas.length)
const whoosh = f.trilhas.find((x) => x.fileName === 'whoosh.mp3')
ok('o som da ligacao fica no corte (o meio dele em 60 s)', !!whoosh && perto(whoosh.at, 60 - antesDoCorte(1.2)), String(whoosh?.at))
ok('numa faixa so dele, acima das das partes', !!whoosh && whoosh.faixa === 2, String(whoosh?.faixa))

console.log('\n== a musica nao invade a parte seguinte')
const trilha = (x: Partial<{ at: number; durationSec: number; inicioSec: number; usarSec: number | null; fadeOutSec: number }>) => ({
  at: 0,
  durationSec: 140,
  inicioSec: 0,
  usarSec: null as number | null,
  fadeOutSec: 0,
  ...x,
})
const longa = caberAte(trilha({}), 30)
ok('a musica inteira (140 s) termina na emenda, com fade', !!longa && perto(longa.usarSec!, 30) && longa.fadeOutSec > 0, JSON.stringify(longa))
const riser = caberAte(trilha({ at: 29, durationSec: 1.9 }), 30)
ok('o rabo de um riser passa da emenda inteiro', !!riser && riser.usarSec === null)
ok('o que comecaria depois da emenda fica de fora', caberAte(trilha({ at: 31, durationSec: 2 }), 30) === null)
ok('na ultima parte nada e cortado', caberAte(trilha({}), Infinity)?.usarSec === null)
const aparada = trilha({ inicioSec: 98.4, usarSec: 30 })
ok('a musica aparada no fim da parte segue sob a frase', perto(seguirSobAFrase(aparada, 30, 1.6).usarSec!, 31.6))
ok('sem frase (so som), fica como estava', seguirSobAFrase(aparada, 30, 0).usarSec === 30)
ok('a que acabava antes do fim da parte fica como estava', seguirSobAFrase(trilha({ usarSec: 20 }), 30, 1.6).usarSec === 20)
ok('o arquivo que nao tem mais de onde tocar fica como estava', seguirSobAFrase(trilha({ durationSec: 30 }), 30, 1.6).usarSec === null)
const comMusicaLonga = juntarProjetos(
  [
    { file: { ...a, trilhas: a.trilhas.map((x) => ({ ...x, durationSec: 140 })) }, duracao: 30 },
    { file: b, duracao: 28 },
  ],
  [som],
  audio,
).file
const daPrimeira = comMusicaLonga.trilhas.find((x) => x.id === 'p1-musica')
ok('juntando: a musica longa da 1a parte para no comeco da 2a', !!daPrimeira && perto(daPrimeira.usarSec!, 30), String(daPrimeira?.usarSec))
const sobAFrase = juntarProjetos(
  [
    { file: { ...a, trilhas: a.trilhas.map((x) => ({ ...x, durationSec: 140, usarSec: 30 })) }, duracao: 30 },
    { file: b, duracao: 28 },
  ],
  [frase],
  audio,
).file.trilhas.find((x) => x.id === 'p1-musica')
ok('juntando: a musica da 1a parte cobre a frase (30 + 2)', !!sobAFrase && perto(sobAFrase.usarSec!, 32), String(sobAFrase?.usarSec))

console.log('\n== a cor da parte cobre a frase que a anuncia')
const corDe = (dur: number) =>
  sobreposicaoSchema.parse({
    id: 'cor',
    path: '',
    fileName: 'Camada de ajuste',
    tipo: 'ajuste',
    faixa: 0,
    at: 0,
    durationSec: dur,
    usarSec: dur,
    chaves: [{ t: 1, x: 0, y: 0, escala: 1.1, rotacao: 0 }],
  })
const comCor = juntarProjetos(
  [
    { file: { ...a, sobreposicoes: [corDe(30)] }, duracao: 30 },
    { file: { ...b, sobreposicoes: [corDe(28)] }, duracao: 28 },
  ],
  [frase],
  audio,
).file.sobreposicoes
const corDa2a = comCor.find((x) => x.id === 'p2-cor')
ok('a cor da 2a parte comeca na frase (30) e vai ate o fim dela (60)', !!corDa2a && perto(corDa2a.at, 30) && perto(corDa2a.usarSec!, 30), `${corDa2a?.at} ${corDa2a?.usarSec}`)
ok('a chave dela fica no mesmo ponto do video (33 s)', !!corDa2a && perto(corDa2a.at + corDa2a.chaves![0]!.t, 33))
const corDa1a = comCor.find((x) => x.id === 'p1-cor')
ok('a cor da 1a parte fica como estava (0 a 30)', !!corDa1a && perto(corDa1a.at, 0) && perto(corDa1a.usarSec!, 30))
const flash = { ...corDe(0.5), at: 32 }
ok('um flash curto no comeco da parte fica no comeco', cobrirAFraseAntes(flash, 32, 28, 2).at === 32)
const camadaLonga = juntarProjetos(
  [
    { file: { ...a, sobreposicoes: [{ ...corDe(40), id: 'video', tipo: 'video' as const, at: 25, usarSec: null }] }, duracao: 30 },
    { file: b, duracao: 28 },
  ],
  [frase],
  audio,
).file.sobreposicoes.find((x) => x.id === 'p1-video')
ok('um video por cima que passava do fim da parte para nele, sem fade a mais', !!camadaLonga && perto(camadaLonga.usarSec!, 5) && camadaLonga.fadeOutSec === 0, `${camadaLonga?.usarSec} ${camadaLonga?.fadeOutSec}`)

console.log('\n== a escolha da Biblioteca')
const blocos = f.biblioteca.blocos!
ok('7 blocos (2 + a frase + 2 + 2)', blocos.length === 7, String(blocos.length))
ok('o bloco da frase com a cena dela marcada', blocos[2]!.text === 'E não para por aí...' && f.biblioteca.porBloco['2']?.[0] === 'D:/Yami-a.mp4')
ok('as marcas da 2a parte andaram de indice (3 e 4)', f.biblioteca.porBloco['3']?.[0] === 'D:/Yami-a.mp4' && f.biblioteca.porBloco['4']?.[0] === 'D:/Yami-b.mp4')
ok('as frases do roteiro seguem numeradas', blocos.map((x) => x.sentence).join() === '0,1,2,3,4,5,6', blocos.map((x) => x.sentence).join())
ok('o bloco da 2a parte anda 32 s', perto(blocos[3]!.start, 32))

console.log('\n== cena escolhida para a frase, e o arquivo reabre')
const comCena = juntarProjetos(
  [
    { file: a, duracao: 30 },
    { file: b, duracao: 28 },
  ],
  [{ ...frase, cena: { path: 'D:/biblioteca/cena-da-ponte.mp4' } }],
  audio,
).file
const daPonte = comCena.plan!.scenes[2]!
ok('a cena da frase e a escolhida na Biblioteca', comCena.images[daPonte.imageIndex]!.path === 'D:/biblioteca/cena-da-ponte.mp4')
ok('o projeto juntado passa pelo schema do arquivo', projectFileSchema.safeParse(f).success && projectFileSchema.safeParse(comCena).success)
ok('o audio e o da narracao juntada', f.audio.path === 'D:/junto.wav')

console.log('\n== o que nao da')
let erro = ''
try {
  juntarProjetos([{ file: a, duracao: 30 }, { file: { ...b, formato: 'long' }, duracao: 28 }], [som], audio)
} catch (e) {
  erro = String(e)
}
ok('formatos diferentes: recusa com o motivo', erro.includes('formatos diferentes'), erro)

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
