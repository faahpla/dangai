/**
 * [recap] A TRILHA SONORA da Edicao rapida (01/11), sem app:
 *
 * - clima pela pasta, pelo nome da musica e pela fala da parte;
 * - os trechos: o gancho toca o comeco da musica da parte seguinte, partes
 *   do mesmo clima sao uma musica so, trecho curto se junta ao vizinho;
 * - o drop cai no corte: o ponto do arquivo que toca no `at` deixa o trecho
 *   calmo antes da entrada sob o gancho;
 * - a musica do clima sem repetir, com os vizinhos quando falta;
 * - as trocas viram riser curto + impacto (ou tape stop quando o clima cai);
 * - o plano com 2 musicas vira os trechos certos na faixa de musica;
 * - entradasDaOnda acha o drop de uma onda sintetica.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-trilha-sonora.ts
 */
import { planejarSfx, sfxPeloNome, trilhasDoPlanoDeSom, type ArquivoDeSfx, type PlanoDeSom } from '../shared/edicao-rapida'
import { climaDaPasta, climaPelaFala, inicioParaODrop, musicaDoClima, trechosDaTrilha, type ParteComClima } from '../shared/trilha-sonora'
import { climaPeloNomeDaMusica } from '../electron/som/clima'
import { entradasDaOnda } from '../electron/som/entradas'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}

console.log('clima')
confere(climaDaPasta('Ação') === 'acao' && climaDaPasta('sad') === 'sentimental' && climaDaPasta('Épica') === 'epica', 'pasta: Acao, sad, Epica')
confere(climaDaPasta('musicas') === null, 'pasta que nao diz: null')
confere(climaPeloNomeDaMusica('ELSE PARIS (MUSICA DE SUSPENSE DO TIKTOK).mp3') === 'suspense', 'nome: musica de suspense')
confere(climaPeloNomeDaMusica('Boku No Hero Academia Movie OST - MY HERO IS OUR HERO.mp3') === 'epica', 'nome: hero = epica')
confere(climaPeloNomeDaMusica('Montagem Batchi.m4a') === null, 'nome que nao diz: null (a IA decide)')
confere(climaPelaFala('A luta comeca e ele ataca com a espada') === 'acao', 'fala: luta = acao')
confere(climaPelaFala('Ela chorou ao lembrar da morte da mae') === 'sentimental', 'fala: chorou/morte = sentimental')

console.log('os trechos')
const partes: ParteComClima[] = [
  { inicio: 0, fim: 4, papel: 'gancho', clima: 'suspense' },
  { inicio: 4, fim: 14, papel: 'contexto', clima: 'suspense' },
  { inicio: 14, fim: 26, papel: 'desenvolvimento', clima: 'suspense' },
  { inicio: 26, fim: 30, papel: 'virada', clima: 'acao' },
  { inicio: 30, fim: 44, papel: 'climax', clima: 'acao' },
  { inicio: 44, fim: 58, papel: 'fechamento', clima: 'sentimental' },
]
const tr = trechosDaTrilha(partes, 4, 58)
confere(tr.length === 3, `3 trechos (suspense, acao, sentimental): ${tr.map((t) => t.clima).join(',')}`)
confere(tr[0]?.at === 0 && tr[0]?.drop === 4 && tr[0]?.clima === 'suspense', 'o 1o comeca no 0 com o drop na saida do gancho')
confere(tr[1]?.at === 26 && tr[1]?.drop === 26, 'troca na virada (26 s), drop na troca')
confere(tr[2]?.at === 44 && tr[2]?.ate === 58, 'o ultimo vai ate o fim')
const curto = trechosDaTrilha(
  [
    { inicio: 0, fim: 4, papel: 'gancho', clima: 'acao' },
    { inicio: 4, fim: 20, papel: 'contexto', clima: 'suspense' },
    { inicio: 20, fim: 24, papel: 'virada', clima: 'comedia' },
    { inicio: 24, fim: 50, papel: 'climax', clima: 'epica' },
  ],
  4,
  50,
)
confere(curto.length === 2 && !curto.some((t) => t.clima === 'comedia'), 'trecho de 4 s (comedia) se junta ao vizinho')
confere(trechosDaTrilha([{ inicio: 0, fim: 30, papel: null, clima: 'calma' }], null, 30).length === 1, 'sem partes: uma musica so')

console.log('o drop no corte')
const musica = { entradas: [{ t: 2, forca: 5 }, { t: 19.5, forca: 12 }, { t: 58, forca: 20 }], durationSec: 224, inicioSomSec: 0.4 }
const d = inicioParaODrop(musica, { at: 0, ate: 26, drop: 4 })
confere(d.entrada?.t === 58 && d.inSec === 54, 'a entrada mais forte que cabe: toca de 54 s, o drop de 58 s cai no 4 s do video')
const d2 = inicioParaODrop({ ...musica, durationSec: 70 }, { at: 0, ate: 26, drop: 4 })
confere(d2.entrada?.t === 19.5, 'a que deixa o trecho inteiro sem dar a volta ganha da mais forte')
const d3 = inicioParaODrop(musica, { at: 26, ate: 44, drop: 26 })
confere(d3.inSec === 58, 'na troca a musica entra direto no drop')
const semEntrada = inicioParaODrop({ entradas: [], durationSec: 100, inicioSomSec: 1.2 }, { at: 0, ate: 30, drop: 4 })
confere(semEntrada.entrada === null && Math.abs(semEntrada.inSec - 1.15) < 1e-9, 'sem entrada: o comeco do som')

console.log('a musica do clima')
const ordem = [
  { path: 'a', clima: 'acao' as const },
  { path: 'b', clima: 'sentimental' as const },
  { path: 'c', clima: null },
  { path: 'd', clima: 'acao' as const },
]
confere(musicaDoClima('acao', ordem, new Set())?.path === 'a', 'a 1a de acao na ordem do sem repetir')
confere(musicaDoClima('acao', ordem, new Set(['a']))?.path === 'd', 'nao repete no mesmo video')
confere(musicaDoClima('calma', ordem, new Set())?.path === 'b', 'sem calma: o vizinho (sentimental)')
confere(musicaDoClima('romance', [{ path: 'c', clima: null }], new Set())?.path === 'c', 'sem nada do clima: a sem clima')

console.log('as trocas nos SFX')
const som = (fileName: string, extra: Partial<ArquivoDeSfx> = {}): ArquivoDeSfx => {
  const n = sfxPeloNome(fileName)!
  return {
    path: `C:/sfx/${fileName}`,
    fileName,
    durationSec: 2,
    lufsIntegrado: -20,
    lufsMomentaneoMax: -16,
    picoSec: 0.2,
    inicioSomSec: 0.02,
    fimSomSec: 0.5,
    tipo: n.tipo,
    reserva: false,
    ...(n.soNaAbertura ? { soNaAbertura: true } : {}),
    ...(n.riserCurto ? { riserCurto: true } : {}),
    ...(n.parada ? { parada: true } : {}),
    ...extra,
  }
}
const arquivos = [som('cartoon-pop.mp3'), som('deep-sub-impact.mp3'), som('Riser Metallic.mp3', { picoSec: 1.7 }), som('sharp-riser.mp3', { picoSec: 1.78 }), som('whoosh.mp3')]
const secoes = partes.map((p) => ({ papel: p.papel as 'gancho', inicio: p.inicio, fim: p.fim }))
const cenas = [0, 4, 9, 14, 20, 26, 30, 36, 44, 50].map((start) => ({ start }))
const trocas = [
  { t: 26, calma: false },
  { t: 44, calma: true },
]
const plano = planejarSfx(cenas, secoes, arquivos, undefined, 58, null, [], 0, trocas)
const em = (t: number) => plano.filter((s) => s.marcaSec === t).map((s) => `${s.tipo}:${s.arquivo.split('/').pop()}`)
confere(em(26).includes('riser:sharp-riser.mp3') && em(26).includes('impacto:deep-sub-impact.mp3'), `troca 26 s: sharp riser + impacto (${em(26).join(' ')})`)
confere(em(44).includes('riser:sharp-riser.mp3'), 'troca 44 s sem tape stop na pasta: sharp riser tambem')
confere(!em(30).some((x) => x.startsWith('riser')) && !em(30).some((x) => x.startsWith('impacto')), `climax 4 s depois da troca: sem outro riser + impacto (${em(30).join(' ')})`)
const comParada = planejarSfx(cenas, secoes, [...arquivos, som('tape stop.mp3')], undefined, 58, null, [], 0, trocas)
const em2 = comParada.filter((s) => s.marcaSec === 44).map((s) => s.arquivo.split('/').pop())
confere(em2.length === 1 && em2[0] === 'tape stop.mp3', `troca para sentimental com tape stop: so ele (${em2.join(' ')})`)

console.log('o plano vira trilhas')
const mus = (arquivo: string, at: number, ate: number | null, inSec: number) => ({
  arquivo,
  ganhoDb: -8,
  fadeInSec: at === 0 ? 1.2 : 0.05,
  fadeOutSec: 2,
  ducking: { abaixoDb: 6, ataqueSec: 0.1, soltaSec: 0.25, pausaMinSec: 0.5 },
  inSec,
  durationSec: 120,
  lufsIntegrado: -10,
  at,
  ate,
  clima: 'acao',
  dropSec: at === 0 ? 4 : at,
})
const p: PlanoDeSom = { musica: mus('C:/m/a.mp3', 0, 26, 54), musicas: [mus('C:/m/a.mp3', 0, 26, 54), mus('C:/m/b.mp3', 26, null, 58)], sfx: [], avisos: [] }
const tri = trilhasDoPlanoDeSom(p, { duracaoSec: 58, faixas: { musica: 0, whoosh: 1, impacto: 2, riser: 3, tema: 4 }, prefixoId: 't' })
confere(tri.length === 2, `2 trechos de musica (${tri.length})`)
confere(tri[0]!.at === 0 && tri[0]!.inicioSec === 54 && tri[0]!.usarSec === 26 && tri[0]!.fadeOutSec <= 0.6, 'a 1a: de 54 s do arquivo, 26 s, sai rapido no corte')
confere(tri[1]!.at === 26 && tri[1]!.inicioSec === 58 && tri[1]!.usarSec === 32 && tri[1]!.fadeInSec === 0.05 && tri[1]!.fadeOutSec === 2, 'a 2a: entra no drop (58 s) na troca, ate o fim com o fade')
const umaSo = trilhasDoPlanoDeSom({ musica: mus('C:/m/a.mp3', 0, null, 3), musicas: [], sfx: [], avisos: [] }, { duracaoSec: 30, faixas: { musica: 0, whoosh: 1, impacto: 2, riser: 3, tema: 4 }, prefixoId: 't' })
confere(umaSo.length === 1 && umaSo[0]!.usarSec === 30, 'projeto de antes (so `musica`): igual')

console.log('entradas pela onda')
const rms: number[] = []
const grave: number[] = []
for (let i = 0; i < 600; i++) {
  const forte = i >= 300
  rms.push(forte ? -10 : -24)
  grave.push(forte ? -12 : -34)
}
const e = entradasDaOnda(rms, grave, 0.05)
confere(e.length === 1 && Math.abs(e[0]!.t - 15) < 0.06, `o drop sintetico em 15 s (${e.map((x) => x.t).join(',')})`)
confere(entradasDaOnda(new Array(600).fill(-12), new Array(600).fill(-20), 0.05).length === 0, 'musica sem subida: nenhuma entrada')
const doZero = [...new Array(40).fill(-80), ...new Array(560).fill(-12)]
confere(entradasDaOnda(doZero, doZero, 0.05).length === 0, 'o comeco da musica (silencio > som) nao e drop')

if (falhas > 0) {
  console.log(`\n${falhas} falha(s)`)
  process.exit(1)
}
console.log('\ntudo certo')
