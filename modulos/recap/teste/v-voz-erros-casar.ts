/**
 * CORTAR ERROS (V1), as partes PURAS: o casamento do que foi dito com o
 * roteiro (casar-fala.ts) e o corte na borda do silencio (erros.ts, pos.ts),
 * sem Whisper nem wav2vec2.
 *
 *   1. a fixture (Whisper de verdade sobre a voz do Windows com 3 erros): os
 *      tres blocos achados, do tipo certo, e a ULTIMA leitura fica;
 *   2. casos de borda: frase repetida igualzinha, gaguejo, Whisper errando
 *      nome/numero/palavra partida (nao e erro), sobra no comeco e no fim,
 *      fala fora demais (desconfiado), a sequencia falada;
 *   3. o corte num audio sintetico (tons e silencios): pontas em quadro
 *      calado, nunca em palavra do roteiro; 'longo', 'sem-silencio',
 *      'incerto'; trecho sem fala some; os cortes extras no pos (uniao, a
 *      energia calada, a conta do remapear).
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-voz-erros-casar.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tokenizeScript } from '../../../shared/align'
import {
  acharCandidatos,
  casarFalaComRoteiro,
  chaveDaFala,
  semelhanca,
  sequenciaFalada,
} from '../electron/voz/casar-fala'
import { cortesDosErros, trechosDosErros, type ErroOuvido } from '../electron/voz/erros'
import { cortadoAntes, cortesDasPausas, energiaSemOsCortes, medirEnergia, remapear, unirCortes } from '../electron/voz/pos'
import type { Pcm } from '../electron/voz/wav'

let falhas = 0
let total = 0
function ok(nome: string, cond: boolean, detalhe = ''): void {
  total++
  if (cond) console.log(`  ok   ${nome}${detalhe ? `  (${detalhe})` : ''}`)
  else {
    falhas++
    console.log(`  FALHA ${nome}${detalhe ? `\n        ${detalhe}` : ''}`)
  }
}
const toks = (t: string): string[] => t.split(/\s+/).filter(Boolean)

// ------------------------------------------------ 1. a fixture
console.log('1. fixture: o Whisper de verdade sobre a voz do Windows com erros')
interface Caso {
  nome: string
  roteiro: string[]
  ouvido: string[]
  esperado: { ouvidas: number[]; antesDe: number; tipo: string }[] | null
}
const fx = JSON.parse(readFileSync(join(process.cwd(), 'modulos', 'recap', 'teste', 'fixture', 'fala-com-erros.json'), 'utf8')) as { casos: Caso[] }
for (const caso of fx.casos) {
  const roteiro = caso.roteiro.flatMap((f) => tokenizeScript(f))
  const achados = acharCandidatos(roteiro, caso.ouvido)
  const falados = achados.candidatos.map((c) => `${c.tipo}: ${c.ouvidas.map((j) => caso.ouvido[j]).join(' ')}`)
  ok(`${caso.nome}: os blocos esperados`, caso.esperado !== null && JSON.stringify(achados.candidatos) === JSON.stringify(caso.esperado), JSON.stringify(achados.candidatos) + ' | ' + falados.join(' | '))
  ok(`${caso.nome}: nao desconfiado`, !achados.desconfiado)
  // A frase lida duas vezes: sai a 1a leitura, fica a ultima (o bloco termina antes da ultima leitura comecar).
  const repetida = achados.candidatos.find((c) => c.ouvidas.length >= 6)
  ok(`${caso.nome}: a frase lida duas vezes sai inteira (a 1a), num bloco so`, repetida !== undefined && repetida.tipo === 'repeticao', falados.join(' | '))
  const passos = casarFalaComRoteiro(roteiro.map(chaveDaFala), caso.ouvido.map(chaveDaFala))
  const casados = passos.filter((p) => p.tipo === 'casou').length
  const faltas = passos.filter((p) => p.tipo === 'falta').length
  ok(`${caso.nome}: toda palavra do roteiro casa ou falta (nenhuma some)`, casados + faltas === roteiro.length, `${casados} casadas + ${faltas} faltas = ${roteiro.length}`)
}
{
  const caso = fx.casos[0]!
  const roteiro = caso.roteiro.flatMap((f) => tokenizeScript(f))
  const passos = casarFalaComRoteiro(roteiro.map(chaveDaFala), caso.ouvido.map(chaveDaFala))
  const ryusui = passos.find((p) => p.tipo === 'casou' && roteiro[p.i] === 'Ryusui')
  ok('S4-37: "Ryusui" casa com o WHY da 2a leitura (ouvida 55)', ryusui?.tipo === 'casou' && ryusui.j === 55, JSON.stringify(ryusui))
}

// ------------------------------------------------ 2. casos de borda
console.log('\n2. casos de borda')
{
  const rot = toks('a casa era velha. o gato subiu no telhado e dormiu ali a noite inteira sem fazer barulho')
  const c = acharCandidatos(rot, toks('a casa era velha. o gato subiu no telhado o gato subiu no telhado e dormiu ali a noite inteira sem fazer barulho'))
  ok('frase repetida igualzinha: um bloco so, a 1a leitura (fica a ultima)', c.candidatos.length === 1 && JSON.stringify(c.candidatos[0]!.ouvidas) === '[4,5,6,7,8]' && c.candidatos[0]!.tipo === 'repeticao' && c.candidatos[0]!.antesDe === 4, JSON.stringify(c.candidatos))
}
{
  const rot = toks('e o mundo foi totalmente reconstruido')
  const c = acharCandidatos(rot, toks('e o mundo o mundo foi totalmente reconstruido'))
  ok('"o mundo, o mundo": sai o 1o, repeticao', c.candidatos.length === 1 && JSON.stringify(c.candidatos[0]!.ouvidas) === '[1,2]' && c.candidatos[0]!.tipo === 'repeticao', JSON.stringify(c.candidatos))
}
{
  const rot = toks('ele tinha 37 anos quando partiu')
  const c = acharCandidatos(rot, toks('ele tinha trinta e sete anos quando partiu'))
  ok('numero ouvido por extenso ("37" / "trinta e sete") nao e erro', c.candidatos.length === 0, JSON.stringify(c.candidatos))
}
{
  const rot = toks('o Taiju e a Yuzuriha abriram uma empresa')
  const c = acharCandidatos(rot, toks('o Taiju e a Yuzu riha abriram uma empresa'))
  ok('nome partido pelo Whisper ("Yuzu riha") nao e erro', c.candidatos.length === 0, JSON.stringify(c.candidatos))
}
{
  const rot = toks('e o Why-Man quer voltar')
  const c = acharCandidatos(rot, toks('e o why man quer voltar'))
  ok('"Why-Man" ouvido "why man" nao e erro', c.candidatos.length === 0, JSON.stringify(c.candidatos))
}
{
  const rot = toks('o Senku chamou o Chrome para ajudar')
  const c = acharCandidatos(rot, toks('o Senku chamou o Kroma da casa para ajudar'))
  ok('palavra mal ouvida com sobra encostada (troca) nao e erro', c.candidatos.length === 0, JSON.stringify(c.candidatos))
}
{
  const rot = toks('Anos se passaram e o mundo mudou')
  const c = acharCandidatos(rot, toks('Hum anos se passaram e o mundo mudou'))
  ok('"Hum" no comeco: hesitacao antes do 1o token', c.candidatos.length === 1 && c.candidatos[0]!.tipo === 'hesitacao' && c.candidatos[0]!.antesDe === 0, JSON.stringify(c.candidatos))
}
{
  const rot = toks('e o destino de todos mudou')
  const c = acharCandidatos(rot, toks('e o destino de todos mudou obrigado por assistir'))
  ok('sobra no fim (Whisper inventando): candidata, no fim do roteiro', c.candidatos.length === 1 && c.candidatos[0]!.antesDe === rot.length && c.candidatos[0]!.tipo === 'sobra', JSON.stringify(c.candidatos))
}
{
  const rot = toks('um dois tres quatro cinco seis')
  const c = acharCandidatos(rot, toks('bolo de cenoura com chocolate um dois tres quatro cinco seis e cobertura de morango por cima'))
  ok('fala fora do roteiro demais: desconfiado, nada marcado', c.desconfiado && c.candidatos.length === 0)
}
ok('semelhanca: acento e caixa nao contam', semelhanca(chaveDaFala('Construído'), chaveDaFala('construido')) === 'igual')
ok('semelhanca: curta so igual ("e"/"o")', semelhanca('e', 'o') === 'troca' && semelhanca('pra', 'para') === 'perto')
{
  const rot = toks('a b c')
  const ouv = toks('x a b y c')
  const seq = sequenciaFalada(rot, ouv, [
    { ouvidas: [0], antesDe: 0, tipo: 'sobra' },
    { ouvidas: [3], antesDe: 2, tipo: 'sobra' },
  ])
  ok('sequencia falada: os erros no lugar, os indices de volta', seq.tokens.join(' ') === 'x a b y c' && seq.doRoteiro.join(',') === '-1,0,1,-1,2' && seq.doCandidato.join(',') === '0,-1,-1,1,-1')
}

// ------------------------------------------------ 3. o corte no som
console.log('\n3. o corte na borda do silencio (audio sintetico)')
const TAXA = 16_000
/** Tons (fala) e silencios em segundos: [inicio, fim) de cada som. */
function sintetico(sons: [number, number][], duracao: number, ruido = 0): Pcm {
  const amostras = new Int16Array(Math.round(duracao * TAXA))
  let semente = 7
  for (let n = 0; n < amostras.length; n++) {
    semente = (semente * 1103515245 + 12345) & 0x7fffffff
    amostras[n] = Math.round(((semente / 0x7fffffff) * 2 - 1) * ruido)
  }
  for (const [a, b] of sons) {
    for (let n = Math.round(a * TAXA); n < Math.round(b * TAXA) && n < amostras.length; n++) {
      amostras[n] = Math.round(9000 * Math.sin((2 * Math.PI * 220 * n) / TAXA))
    }
  }
  return { taxa: TAXA, amostras }
}
// Roteiro: A (0,5-1,0) | erro (1,6-2,4) | B (3,0-3,5) C (3,6-4,0) | erro emendado (4,0-4,3) colado em D (4,3-4,8)
const pcm = sintetico([[0.5, 1.0], [1.6, 2.4], [3.0, 3.5], [3.6, 4.0], [4.0, 4.3], [4.3, 4.8]], 7, 30)
const e = medirEnergia(pcm)
const palavras = [
  { start: 0.5, end: 1.0 },
  { start: 3.0, end: 3.5 },
  { start: 3.6, end: 4.0 },
  { start: 4.3, end: 4.8 },
]
const erros: ErroOuvido[] = [
  { falado: 'erro um', tipo: 'repeticao', start: 1.62, end: 2.38, score: 0.8, antesDe: 1 },
  { falado: 'emendado', tipo: 'hesitacao', start: 4.02, end: 4.28, score: 0.8, antesDe: 3 },
  // O Whisper "ouviu" no silencio do fim: sem fala no tempo dele, nem entra.
  { falado: 'obrigado', tipo: 'sobra', start: 5.2, end: 5.6, score: 0.6, antesDe: 4 },
]
const tr = trechosDosErros(erros, palavras, e, 7)
ok('o trecho sem fala (Whisper no silencio) nao entra', tr.length === 2 && !tr.some((t) => t.falado === 'obrigado'), tr.map((t) => t.falado).join(' | '))
const primeiro = tr[0]!
ok('o erro entre pausas: corte do meio da pausa de antes ao meio da de depois',
  primeiro.corte !== null && Math.abs(primeiro.corte.de - 1.3) < 0.02 && Math.abs(primeiro.corte.ate - 2.7) < 0.02,
  JSON.stringify(primeiro.corte))
const calado = (t: number): boolean => {
  const q = Math.floor((t * e.taxa) / e.amostrasPorQuadro)
  return e.db[q]! <= e.limiar
}
ok('as duas pontas em quadro calado', primeiro.corte !== null && calado(primeiro.corte.de) && calado(primeiro.corte.ate))
ok('o corte nao encosta em palavra do roteiro', palavras.every((p) => !primeiro.corte || p.end <= primeiro.corte.de || p.start >= primeiro.corte.ate))
ok('fala emendada (sem silencio na borda): fica, "sem-silencio"', tr[1]!.corte === null && tr[1]!.motivo === 'sem-silencio', JSON.stringify(tr[1]))
{
  const incerto = trechosDosErros([{ ...erros[0]!, score: 0.1 }], palavras, e, 7)
  ok('confianca baixa do wav2vec2: fica, "incerto"', incerto[0]?.corte === null && incerto[0]?.motivo === 'incerto')
  const pcmLongo = sintetico([[0.5, 1.0], [1.6, 6.4], [7.0, 7.5]], 8, 30)
  const eLongo = medirEnergia(pcmLongo)
  const pLongo = [{ start: 0.5, end: 1.0 }, { start: 7.0, end: 7.5 }]
  const longoSobra = trechosDosErros([{ falado: 'cafe com bolo', tipo: 'sobra', start: 1.6, end: 6.4, score: 0.8, antesDe: 1 }], pLongo, eLongo, 8)
  ok('sobra de 4,8 s que nao repete o roteiro: fica, "longo"', longoSobra[0]?.corte === null && longoSobra[0]?.motivo === 'longo')
  const longaRepeticao = trechosDosErros([{ falado: 'frase de novo', tipo: 'repeticao', start: 1.6, end: 6.4, score: 0.8, antesDe: 1 }], pLongo, eLongo, 8)
  ok('repeticao longa: corta (fica a ultima leitura)', longaRepeticao[0]?.corte !== null)
}
{
  // No pos: os extras e a pausa juntos; a conta do remapear.
  const extras = cortesDosErros(tr, TAXA, pcm.amostras.length)
  ok('cortesDosErros: so os que saem, em amostras', extras.length === 1 && extras[0]!.de === Math.round(primeiro.corte!.de * TAXA))
  const semErro = energiaSemOsCortes(e, extras)
  const q = Math.floor((2.0 * TAXA) / e.amostrasPorQuadro)
  ok('a energia com o erro calado (para o corte de pausa)', semErro.db[q]! === -120 && e.db[q]! > e.limiar)
  const pausas = cortesDasPausas(palavras, semErro, pcm.amostras.length)
  const juntos = unirCortes([...pausas, ...extras])
  // O vao A..B (1,0-3,0) vira UMA pausa curta: pausa + erro + pausa = um silencio so.
  const tA = remapear(juntos, TAXA, 1, 1.0)
  const tB = remapear(juntos, TAXA, 1, 3.0)
  ok('com o corte de pausa: o vao do erro encolhe para a pausa curta (0,15 s)', Math.abs(tB - tA - 0.15) < 0.02, `${(tB - tA).toFixed(3)} s`)
  ok('unirCortes: em ordem e sem sobreposicao', juntos.every((c, i) => i === 0 || c.de > juntos[i - 1]!.ate))
  const so = remapear(extras, TAXA, 1.2, 3.0)
  const conta = (3.0 * TAXA - cortadoAntes(extras, 3.0 * TAXA)) / TAXA / 1.2
  ok("so o erro, a 1,2x: t' = (t - cortado)/v", Math.abs(so - conta) < 1e-9 && Math.abs(so - (3.0 - (primeiro.corte!.ate - primeiro.corte!.de)) / 1.2) < 1e-3)
}

console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`} em ${total} conferencias`)
process.exit(falhas === 0 ? 0 : 1)
