/**
 * AUDIO SEM UM PEDACO DO ROTEIRO (B1, 20/10): trechoQueFalta, sem audio.
 *
 * Base: a fixture do Nia E01 (Whisper small de verdade sobre a voz do Windows,
 * com hesitacao, frase lida duas vezes e nome ouvido errado). Os tempos sao
 * sinteticos (0,35 s por palavra) e a "fala" do audio e onde ha palavra.
 * Cortar o audio = tirar as palavras ouvidas E a fala delas.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-audio-incompleto.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tokenizeScript } from '../../../shared/align'
import { casarFalaComRoteiro, chaveDaFala } from '../electron/voz/casar-fala'
import {
  MINIMO_DE_PALAVRAS,
  mensagemDoTrechoQueFalta,
  trechoQueFalta,
  type PalavraOuvida,
} from '../electron/voz/falta-no-audio'

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

interface Caso {
  nome: string
  roteiro: string[]
  ouvido: string[]
}
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixture', 'fala-com-erros.json'), 'utf8')) as { casos: Caso[] }
const nia = fixture.casos.find((c) => c.nome.startsWith('Nia'))!
const dr = fixture.casos.find((c) => c.nome.startsWith('S4-37'))!

const POR_PALAVRA = 0.35
/** O audio: as palavras ouvidas com tempo, e os intervalos com fala (a voz). */
interface Audio {
  ouvidas: PalavraOuvida[]
  fala: [number, number][]
  duracao: number
}
function audioDe(ouvido: readonly string[]): Audio {
  const ouvidas = ouvido.map((text, j) => ({ text, start: 0.5 + j * POR_PALAVRA, end: 0.5 + j * POR_PALAVRA + 0.3 }))
  return { ouvidas, fala: ouvidas.map((w) => [w.start, w.end]), duracao: (ouvidas.at(-1)?.end ?? 0) + 0.8 }
}
/** O audio sem as palavras [j0, j1): o som delas sai e o resto encosta (o arquivo encurta). */
function semAsPalavras(ouvido: readonly string[], j0: number, j1: number): Audio {
  return audioDe([...ouvido.slice(0, j0), ...ouvido.slice(j1)])
}
function falaEntre(audio: Audio): (a: number, b: number) => number {
  return (a, b) => audio.fala.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0)
}
function falta(roteiro: readonly string[], audio: Audio) {
  return trechoQueFalta(roteiro, audio.ouvidas, falaEntre(audio), audio.duracao)
}

const roteiro = nia.roteiro.flatMap((f) => tokenizeScript(f))
const ouvido = nia.ouvido
/** As palavras ouvidas de cada frase do roteiro (pelo casamento do audio inteiro). */
const passos = casarFalaComRoteiro(roteiro.map(chaveDaFala), ouvido.map(chaveDaFala))
const inicioDaFrase: number[] = []
nia.roteiro.reduce((n, f) => (inicioDaFrase.push(n), n + tokenizeScript(f).length), 0)
function ouvidasDasFrases(f0: number, f1: number): [number, number] {
  const i0 = inicioDaFrase[f0]!
  const i1 = f1 < inicioDaFrase.length ? inicioDaFrase[f1]! : roteiro.length
  const js = passos.flatMap((p) => (p.tipo === 'casou' && p.i >= i0 && p.i < i1 ? [p.j] : []))
  return [Math.min(...js), Math.max(...js) + 1]
}

console.log(`Nia E01: ${roteiro.length} palavras no roteiro, ${ouvido.length} ouvidas, ${nia.roteiro.length} frases\n`)

console.log('1. audio inteiro')
ok('a narracao inteira (com hesitacao, repeticao e nome errado) passa', falta(roteiro, audioDe(ouvido)) === null)
const doDr = audioDe(dr.ouvido)
ok('audio de OUTRO roteiro: null (quem recusa e o veredito, com a frase dele)', falta(roteiro, doDr) === null)

console.log('\n2. falta o fim')
{
  const corte = Math.round(ouvido.length * 0.6)
  const t = falta(roteiro, semAsPalavras(ouvido, corte, ouvido.length))
  ok('60% do audio: falta o fim', t?.onde === 'fim' && t.ate === roteiro.length - 1, JSON.stringify(t))
  ok('  e o bloco comeca perto de onde o audio parou', !!t && Math.abs(t.de - Math.round(roteiro.length * 0.6)) <= 12, `de ${t?.de}`)
  const [j0] = ouvidasDasFrases(nia.roteiro.length - 2, nia.roteiro.length)
  const t2 = falta(roteiro, semAsPalavras(ouvido, j0, ouvido.length))
  ok('sem as 2 ultimas frases (o CTA): falta o fim', t2?.onde === 'fim' && t2.de === inicioDaFrase[nia.roteiro.length - 2], JSON.stringify(t2))
  const t3 = falta(roteiro, semAsPalavras(ouvido, ouvido.length - 3, ouvido.length))
  ok(`so as 3 ultimas palavras (< ${MINIMO_DE_PALAVRAS}): passa`, t3 === null, JSON.stringify(t3))
  const m = t2 ? mensagemDoTrechoQueFalta(roteiro, t2) : ''
  ok('a mensagem diz onde e cita o roteiro', m.startsWith('Falta o fim do roteiro nesse audio (18 palavras). Nao foi dito de "') && m.includes(roteiro[t2!.de]!), m)
  ok('  e a 1a frase cabe no rodape (resumoDaFalhaDaVoz: ate 56)', m.split(/(?<=[.!?])\s/)[0]!.length <= 56)
}

console.log('\n3. falta o comeco')
{
  const [, j1] = ouvidasDasFrases(0, 2)
  const t = falta(roteiro, semAsPalavras(ouvido, 0, j1))
  ok('sem as 2 primeiras frases: falta o comeco', t?.onde === 'comeco' && t.de === 0, JSON.stringify(t))
  const m = t ? mensagemDoTrechoQueFalta(roteiro, t) : ''
  ok('a mensagem', m.startsWith('Falta o comeco do roteiro nesse audio (19 palavras). Nao foi dito do inicio ate "...') && m.includes('nela".'), m)
}

console.log('\n4. falta uma frase no meio')
{
  const f = 7
  const [j0, j1] = ouvidasDasFrases(f, f + 1)
  const t = falta(roteiro, semAsPalavras(ouvido, j0, j1))
  const n = tokenizeScript(nia.roteiro[f]!).length
  ok(`frase ${f + 1} (${n} palavras) pulada na gravacao: falta no meio`, t?.onde === 'meio' && t.de === inicioDaFrase[f] && t.palavras === n, JSON.stringify(t))
  const m = t ? mensagemDoTrechoQueFalta(roteiro, t) : ''
  ok('a mensagem', m.startsWith(`Falta um trecho do roteiro nesse audio (${n} palavras). Nao foi dito de "`), m)

  // O Whisper pulou a frase, mas a VOZ esta la: nada e recusado.
  const inteiro = audioDe(ouvido)
  const whisperPulou: Audio = { ...inteiro, ouvidas: inteiro.ouvidas.filter((_, j) => j < j0 || j >= j1) }
  ok('o Whisper pulou a frase, mas ha fala ali: passa', falta(roteiro, whisperPulou) === null)
}

console.log('\n5. o que nao e trecho faltando')
{
  // Silencio longo no fim (o arquivo tem 20 s de nada depois da ultima frase).
  const a = audioDe(ouvido)
  ok('silencio longo depois da ultima palavra: passa', falta(roteiro, { ...a, duracao: a.duracao + 20 }) === null)
  // Audio vazio de palavras.
  ok('Whisper sem palavra: null', trechoQueFalta(roteiro, [], () => 0, 10) === null)
}

console.log(falhas === 0 ? `\nTUDO OK (${total})` : `\n${falhas} FALHA(S) de ${total}`)
process.exit(falhas === 0 ? 0 : 1)
