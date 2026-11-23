/**
 * [recap] O GUIA DE MUSICAS DO LEVI (22/11) e as regras do Overgeared S01E09:
 *
 * - cada musica da pasta dele e achada pelo nome, com o clima e a entrada;
 * - a especifica (ELSE PARIS, Afternoon of Konoha) so no clima exato, nunca
 *   como vizinha nem como "qualquer uma";
 * - a slowed da Montagem Batchi so no 1o trecho (o gancho);
 * - o sino nunca vira impacto;
 * - a emenda (o gancho sem ducking + a mesma faixa seguindo) sai seca e o
 *   gancho fica sem ducking;
 * - o gancho de 5,6 s sai com 5 a 7 cenas, nenhuma longa demais.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-guia-de-musicas.ts
 */
import { sfxPeloNome, trilhasDoPlanoDeSom, type PlanoDeSom } from '../shared/edicao-rapida'
import { entradaDoGuia, musicaDoGuia, servePeloAnime } from '../shared/guia-de-musicas'
import { musicaDoClima } from '../shared/trilha-sonora'
import { cenasDoGancho, corteDaFrase, DIVISAO_PADRAO } from '../shared/divisao'
import { hashDoTexto, type TakeDaVoz } from '../shared/voz'

let falhas = 0
function confere(ok: boolean, mensagem: string, visto?: unknown): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}${visto === undefined ? '' : ` -> ${JSON.stringify(visto)}`}`)
  }
}

console.log('== o guia pelo nome')
const PASTA = [
  'ATLXS - PASSO BEM SOLTO   instrumental.mp3',
  'Black Clover - Haruka Mirai (OP1 - Filtered Instrumental).mp3',
  'Boku No Hero Academia Movie OST - MY HERO IS OUR HERO - Futari No Hero.mp3',
  'CLIMA LINDO.m4a',
  'Echoes of the Eye Soundtrack - River’s End.mp3',
  'ELSE PARIS (MUSICA DE SUSPENSE DO TIKTOK).mp3',
  'GLICHERY, MXCCREE, DJ GLICHEKY - X-GALACTICO (SLOWED) (1).m4a',
  'Jujutsu Kaisen Season 2 Opening 2   King Gnu - SPECIALZ (Instrumental).mp3',
  'Kaikai Kitan - Eve (Instrumental).mp3',
  'MENTE MÁ (Instrumental).mp3',
  'MONTAGEM BATCHI (Super Slowed + Reverb) [BRAZILIAN PHONK].m4a',
  'MXZI, Rushex - Montagem Batchi (Instrumental HQ).m4a',
  'Naruto - Afternoon of Konoha.mp3',
  'NO BATIDÃO - ZXKAI Instrumental.mp3',
  'no signal (slowed).m4a',
  "We Don't Talk Anymore Instrumental - Mighty Seven (youtube).mp3",
  'Where Our Blue Is (Instrumental).mp3',
]
const ids = PASTA.map((n) => musicaDoGuia(n)?.id ?? null)
confere(ids.every((x) => x !== null), 'todas as 17 musicas da pasta estao no guia', PASTA.filter((_, i) => !ids[i]))
confere(new Set(ids).size === PASTA.length, 'cada uma acha a sua (sem duas no mesmo item)', ids)
confere(musicaDoGuia('G:/App Resumo/music/MONTAGEM BATCHI (Super Slowed + Reverb) [BRAZILIAN PHONK].m4a')?.id === 'montagem-slowed', 'a slowed e a slowed (pelo caminho inteiro)')
confere(musicaDoGuia('MXZI, Rushex - Montagem Batchi (Instrumental HQ).m4a')?.id === 'montagem-instrumental', 'a instrumental e a instrumental')
confere(entradaDoGuia(musicaDoGuia('Where Our Blue Is (Instrumental).mp3'), 'epica') === 46, 'Where Our Blue Is entra em 0:46')
confere(entradaDoGuia(musicaDoGuia('Boku No Hero Academia Movie OST - MY HERO IS OUR HERO.mp3'), 'epica') === 104, 'MY HERO: 1:44 no epico')
confere(entradaDoGuia(musicaDoGuia('Boku No Hero Academia Movie OST - MY HERO IS OUR HERO.mp3'), 'sentimental') === null, 'MY HERO: o comeco no sentimental')
confere(musicaDoGuia('CLIMA LINDO.m4a')?.comecoSec === 10, 'CLIMA LINDO comeca em 0:10')
confere(musicaDoGuia('uma qualquer.mp3') === null, 'musica fora do guia: null (o palpite de sempre)')
const haruka = musicaDoGuia('Black Clover - Haruka Mirai (OP1 - Filtered Instrumental).mp3')
confere(servePeloAnime(haruka, 'G:/x/_projetos/Black Clover S02E08 - 2026/Black Clover S02E08 2026-11-21.wav'), 'Haruka Mirai no Black Clover: sim')
confere(!servePeloAnime(haruka, 'C:\\x\\Black Clover\\Overgeared S01E09 2026-11-22.wav'), 'Haruka Mirai no Overgeared: nao')
confere(!servePeloAnime(haruka, null), 'Haruka Mirai sem saber o anime: nao')
confere(servePeloAnime(musicaDoGuia('SPECIALZ.mp3'), null), 'as outras servem em qualquer anime')

console.log('\n== a escolha pelo clima')
const m = (nome: string): { path: string; clima: ReturnType<typeof musicaDoGuia> extends infer G ? any : never } => {
  const g = musicaDoGuia(nome)
  return { path: nome, clima: g?.climas[0] ?? null, climas: g?.climas, especifica: g?.especifica, soNoGancho: g?.soNoGancho } as any
}
// O Overgeared: a pasta so com as especificas e uma de acao ja usada.
const especificas = [m('ELSE PARIS (MUSICA DE SUSPENSE).mp3'), m('Naruto - Afternoon of Konoha.mp3'), m('SPECIALZ (Instrumental).mp3')]
confere(musicaDoClima('acao', especificas, new Set())?.path.includes('SPECIALZ') === true, 'acao: SPECIALZ, nunca ELSE PARIS')
confere(musicaDoClima('acao', especificas, new Set(['SPECIALZ (Instrumental).mp3']))?.path.includes('SPECIALZ') === true, 'acao com SPECIALZ ja usada: repete ela, nunca uma especifica')
confere(musicaDoClima('suspense', especificas, new Set())?.path.includes('ELSE PARIS') === true, 'suspense de verdade: ELSE PARIS')
confere(musicaDoClima('suspense', especificas, new Set(), false, 9)?.path.includes('ELSE PARIS') === false, 'suspense de 9 s: nao vale trocar para ELSE PARIS')
confere(musicaDoClima('calma', [m('Naruto - Afternoon of Konoha.mp3')], new Set()) === null, 'calma so com Naruto: nenhuma (comedia nao e calma)')
const combo = [m('MONTAGEM BATCHI (Super Slowed + Reverb).m4a'), m('Kaikai Kitan - Eve (Instrumental).mp3')]
confere(musicaDoClima('acao', combo, new Set(), true)?.path.includes('Slowed') === true, 'no gancho a slowed pode')
confere(musicaDoClima('acao', combo, new Set(), false)?.path.includes('Kaikai') === true, 'fora do gancho a slowed nao entra')
confere(musicaDoClima('comedia', [m('ATLXS - PASSO BEM SOLTO instrumental.mp3')], new Set())?.path.includes('PASSO') === true, 'PASSO BEM SOLTO serve em quase tudo (comedia)')

console.log('\n== o sino')
confere(sfxPeloNome('som do sino.m4a') === null, '"som do sino" nunca e impacto')
confere(sfxPeloNome('church bell.mp3') === null, '"bell" tambem nao')
confere(sfxPeloNome('impact.mp3')?.tipo === 'impacto', 'impact.mp3 continua impacto')

console.log('\n== o gancho com musica (a emenda)')
const ducking = { abaixoDb: 6, ataqueSec: 0.1, soltaSec: 0.25, pausaMinSec: 0.5 }
const base = { arquivo: 'm.mp3', ganhoDb: -14, fadeOutSec: 2, durationSec: 200, inicioSomSec: 0, fimUtilSec: 198, lufsIntegrado: -12, clima: 'acao', dropSec: null }
const plano: PlanoDeSom = {
  musica: null,
  sfx: [],
  avisos: [],
  musicas: [
    { ...base, fadeInSec: 0.05, ducking: null, inSec: 30, at: 0, ate: 5.58, emenda: true },
    { ...base, fadeInSec: 0, ducking, inSec: 35.58, at: 5.58, ate: null },
  ],
}
const tr = trilhasDoPlanoDeSom(plano, { duracaoSec: 60, faixas: { musica: 3, whoosh: 4, impacto: 4, riser: 4, tema: 4 } as any, prefixoId: 't' }).filter((x) => x.papel === 'musica')
confere(tr.length === 2, 'dois trechos', tr.length)
confere(tr[0]!.fadeOutSec === 0 && tr[1]!.fadeInSec === 0, 'a emenda e seca (sem fade no meio)', tr.map((x) => [x.fadeInSec, x.fadeOutSec]))
confere(!('ducking' in tr[0]!) && !!tr[1]!.ducking, 'o gancho sem ducking, o resto com', tr.map((x) => !!x.ducking))
confere(Math.abs(tr[1]!.inicioSec - 35.58) < 1e-3, 'o resto segue do ponto certo da faixa')

console.log('\n== o gancho do Overgeared (5,58 s)')
confere(cenasDoGancho(5.58) >= 5 && cenasDoGancho(5.58) <= 7, '5,58 s mira 5 a 7 cenas', cenasDoGancho(5.58))
confere(cenasDoGancho(3.25) === 3 && cenasDoGancho(2.5) === 2, 'os ganchos curtos de antes continuam (3,25 s = 3; 2,5 s = 2)')
const texto = 'Mano, esse cara que todo mundo achava fraco conseguiu derrotar um monstro que nem os jogadores mais poderosos do mundo conseguiam vencer!'
const inicios = [0, 0.3, 0.55, 0.7, 0.86, 1.0, 1.2, 1.55, 1.85, 2.18, 2.5, 2.62, 2.86, 3.0, 3.14, 3.3, 3.55, 3.8, 4.0, 4.3, 4.75, 5.1]
const ws = texto.split(/\s+/)
const take = {
  palavras: ws.map((w, i) => ({ texto: w, start: inicios[i]!, end: (inicios[i + 1] ?? 5.58) - 0.02, fraseId: 'f01' })),
  trechos: [{ fraseId: 'f01', offset: 0, duracao: 5.58, hashTexto: hashDoTexto(texto), texto }],
} as unknown as Pick<TakeDaVoz, 'trechos' | 'palavras'>
const corte = corteDaFrase({ id: 'f01', texto, citacaoCueId: null }, take, DIVISAO_PADRAO, true)
const durs = corte?.pedacos.map((p) => Math.round((p.fim - p.inicio) * 100) / 100) ?? []
confere(durs.length >= 5, `5 ou mais cenas: ${corte?.pedacos.map((p) => p.texto).join(' | ')}`, durs)
confere(durs.every((d) => d <= 1.7), 'nenhuma cena do gancho passa de 1,7 s', durs)

console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
