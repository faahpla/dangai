/**
 * [recap] OS SFX DO JEITO DO LEVI (01/11) na Edicao rapida, sem app:
 *
 * - pelo nome: cartoon pop = so abertura, riser x riser curto ("sharp"),
 *   tema (espada, soco...) antes do whoosh ("sword whoosh" e espada), o
 *   "click" fica de fora;
 * - o video SEMPRE abre com um som em t = 0 (o cartoon pop quando ha, senao
 *   um impacto), mesmo sem papeis;
 * - a saida do gancho leva o RISER com o pico no corte; sem riser, whoosh;
 * - o climax leva o riser curto + o impacto, juntos mais baixos;
 * - a virada cuja fala cita "espada" leva a espada no lugar do whoosh, um
 *   golpe diferente por vez (o pacote separado em golpes);
 * - golpesDaOnda: o pacote de 3 golpes vira 3, com o pico de cada um.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-sfx-do-levi.ts
 */
import {
  planejarSfx,
  sfxPeloNome,
  temaDaFala,
  type ArquivoDeSfx,
  type PalavraParaSom,
  type SecaoParaSom,
} from '../shared/edicao-rapida'
import { golpesDaOnda } from '../electron/som/golpes'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}

console.log('pelo nome')
confere(sfxPeloNome('cartoon-pop-up-2-SBA-300463163.mp3')?.soNaAbertura === true, 'cartoon pop: so abertura')
confere(sfxPeloNome('ES_Riser Metallic - SFX Producer.mp3')?.tipo === 'riser' && !sfxPeloNome('ES_Riser Metallic - SFX Producer.mp3')?.riserCurto, 'riser metallic: riser principal')
confere(sfxPeloNome('sharp-riser-327342.mp3')?.riserCurto === true, 'sharp riser: o curto')
confere(sfxPeloNome('sword slash (sound effects) __ mani creation __ [4bJI-e28kFg].mp3')?.tema === 'espada', 'sword slash: tema espada')
confere(sfxPeloNome('sword-whoosh.mp3')?.tema === 'espada', 'sword whoosh: espada, nao whoosh')
confere(sfxPeloNome('deep-sub-impact-SBA-300286067.mp3')?.tipo === 'impacto', 'deep sub impact: impacto')
confere(sfxPeloNome('FlashWhoosh.mp3')?.tipo === 'whoosh', 'FlashWhoosh: whoosh')
confere(sfxPeloNome('camera_shutter_2.mp3')?.tema === 'camera', 'camera shutter: tema camera')
confere(sfxPeloNome('ui-click.mp3') === null, 'click: fora')
confere(sfxPeloNome('Cartoon Bounce Sound Effect(OPPAI).mp3')?.soNaAbertura === true, 'cartoon bounce: so abertura')
confere(sfxPeloNome('among-us-role-reveal-sound.mp3')?.tema === 'revelacao', 'among us reveal: tema revelacao')
confere(sfxPeloNome('anime-wow-sound-effect-mp3cut.mp3')?.tema === 'surpresa', 'anime wow: tema surpresa')
confere(sfxPeloNome('som do sino.m4a')?.tema === 'sino', 'som do sino: tema sino')
confere(temaDaFala('e ele revelou ser o traidor', new Set(['revelacao'])) === 'revelacao', 'revelou/traidor = revelacao')

console.log('tema pela fala')
confere(temaDaFala('Ele saca a ESPADA e avança', new Set(['espada'])) === 'espada', 'espada (maiuscula)')
confere(temaDaFala('o grimório brilhou', new Set(['magia'])) === 'magia', 'grimorio com acento = magia')
confere(temaDaFala('ele saca a espada', new Set(['soco'])) === null, 'tema sem arquivo nao entra')
confere(temaDaFala('o soco veio antes da espada', new Set(['soco', 'espada'])) === 'soco', 'o primeiro citado ganha')

const som = (fileName: string, extra: Partial<ArquivoDeSfx>): ArquivoDeSfx => {
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
    ...(n.tema ? { tema: n.tema } : {}),
    ...(n.soNaAbertura ? { soNaAbertura: true } : {}),
    ...(n.riserCurto ? { riserCurto: true } : {}),
    ...extra,
  }
}
const golpes = [0.8, 2.1, 3.4].map((p, k) =>
  som('sword slash.mp3', { fileName: `sword slash.mp3 #${k + 1}`, picoSec: p, inicioSomSec: p - 0.05, fimSomSec: p + 0.5, recorte: { de: p - 0.07, ate: p + 0.6 } }),
)
const arquivos: ArquivoDeSfx[] = [
  som('cartoon-pop-up.mp3', { inicioSomSec: 0.01 }),
  som('deep-sub-impact.mp3', { inicioSomSec: 0.46, durationSec: 4.95, fimSomSec: 2.8 }),
  som('ES_Riser Metallic.mp3', { picoSec: 1.695, fimSomSec: 1.71, durationSec: 1.71 }),
  som('sharp-riser.mp3', { picoSec: 1.785, fimSomSec: 1.88, durationSec: 1.88 }),
  som('whoosh.mp3', {}),
  som('FlashWhoosh.mp3', {}),
  ...golpes,
]
const secoes: SecaoParaSom[] = [
  { papel: 'gancho', inicio: 0, fim: 4 },
  { papel: 'contexto', inicio: 4, fim: 12 },
  { papel: 'desenvolvimento', inicio: 12, fim: 20 },
  { papel: 'virada', inicio: 20, fim: 28 },
  { papel: 'climax', inicio: 28, fim: 36 },
  { papel: 'fechamento', inicio: 36, fim: 44 },
]
const palavras: PalavraParaSom[] = [
  { t: 12.1, texto: 'Asta' },
  { t: 12.4, texto: 'ergue' },
  { t: 12.7, texto: 'a' },
  { t: 12.9, texto: 'espada' },
  { t: 20.2, texto: 'Mas' },
  { t: 20.5, texto: 'a' },
  { t: 20.8, texto: 'espada' },
  { t: 21.0, texto: 'quebra' },
]
const cenas = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40].map((start) => ({ start }))
const plano = planejarSfx(cenas, secoes, arquivos, undefined, 44, null, palavras, 0)
const nome = (s: { arquivo: string }): string => s.arquivo.split('/').pop()!

console.log('o plano')
const abre = plano.find((s) => s.marcaSec === 0)
confere(abre !== undefined && nome(abre).startsWith('cartoon') && abre.at === 0, 'abre em t=0 com o cartoon pop')
const riser = plano.find((s) => s.marcaSec === 4)
confere(riser?.tipo === 'riser' && nome(riser).startsWith('ES_Riser'), 'saida do gancho: o riser metallic')
confere(riser !== undefined && Math.abs(riser.at + 1.695 - 4) < 0.002, 'o pico do riser cai no corte')
const espadas = plano.filter((s) => s.tipo === 'tema')
confere(espadas.length === 2 && espadas.every((s) => nome(s).startsWith('sword')), 'as 2 viradas que falam de espada levam espada')
confere(espadas.length === 2 && espadas[0]!.inSec !== espadas[1]!.inSec, 'um golpe diferente em cada')
confere(espadas.every((s) => s.outSec <= s.inSec + 0.7), 'cada golpe toca so o pedaco dele')
const e0 = espadas[0]
confere(e0 !== undefined && Math.abs(e0.at + (0.8 - e0.inSec) - (12 - 0.04)) < 0.002, 'o pico do golpe cai no corte (40 ms antes)')
const climax = plano.filter((s) => s.marcaSec === 28)
confere(climax.some((s) => s.tipo === 'riser' && nome(s).startsWith('sharp')) && climax.some((s) => s.tipo === 'impacto' && nome(s).startsWith('deep')), 'climax: sharp riser + deep impact')
const deep = climax.find((s) => s.tipo === 'impacto')
confere(deep !== undefined && Math.abs(deep.at + 0.46 - 28) < 0.002, 'o ataque do impacto (0,46 s no arquivo) cai no corte')
confere(plano.filter((s) => s.tipo === 'whoosh').length === 1, 'o resto: whoosh (so a virada > fechamento)')
confere(!plano.some((s) => s.tipo === 'impacto' && nome(s).startsWith('cartoon') && s.marcaSec > 0), 'o cartoon pop nunca no climax')

console.log('sem riser e sem papeis')
const semRiser = planejarSfx(cenas, secoes, arquivos.filter((a) => a.tipo !== 'riser'), undefined, 44, null, [], 0)
confere(semRiser.find((s) => s.marcaSec === 4)?.tipo === 'whoosh', 'sem riser: whoosh na saida do gancho')
confere(semRiser.some((s) => s.marcaSec === 28 && s.tipo === 'impacto'), 'sem riser: o impacto do climax fica')
const semPapel = planejarSfx(cenas, [{ papel: null, inicio: 0, fim: 10 }, { papel: null, inicio: 10, fim: 44 }], arquivos, undefined, 44, null, [], 0)
confere(semPapel.some((s) => s.marcaSec === 0) && semPapel.some((s) => s.tipo === 'riser' && s.marcaSec === 10), 'sem papeis: abre com som e a 1a virada leva o riser')
const umaParte = planejarSfx([], [{ papel: null, inicio: 0, fim: 30 }], arquivos.filter((a) => !a.soNaAbertura), undefined, 30, null, [], 0)
confere(umaParte.length === 1 && umaParte[0]!.at === 0 && nome(umaParte[0]!).startsWith('deep'), 'sem pop e sem partes: abre com o impacto')

console.log('golpes pela onda')
const onda: number[] = []
const bloco = (n: number, v: number): void => {
  for (let i = 0; i < n; i++) onda.push(v)
}
bloco(10, -90)
bloco(20, -10)
onda[15] = -3
bloco(40, -90)
bloco(30, -12)
bloco(40, -90)
bloco(15, -8)
bloco(5, -90)
const g = golpesDaOnda(onda, 0.01)
confere(g.length === 3, `3 golpes (${g.length})`)
confere(Math.abs((g[0]?.picoSec ?? 0) - 0.155) < 0.001, 'o pico do 1o golpe e a janela mais forte dele')
confere(g[0]?.relativoDb === 0 && (g[1]?.relativoDb ?? 0) < 0, 'nivel de cada golpe contra o mais forte')
confere((g[0]?.ateSec ?? 9) <= (g[1]?.inicioSec ?? 0), 'a cauda de um golpe nao entra no proximo')
const colado = golpesDaOnda([-90, -10, -10, -90, -10, -10, -90], 0.01)
confere(colado.length === 1, 'vao curto (10 ms) nao separa')

if (falhas > 0) {
  console.log(`\n${falhas} falha(s)`)
  process.exit(1)
}
console.log('\ntudo certo')
