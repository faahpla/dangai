/**
 * O caso real que quebrava: a palavra do roteiro que cai entre duas medidas
 * COLADAS uma na outra -- tipicamente a primeira depois de um ponto final.
 *
 * `npx tsx scripts/teste/v-alinhamento.ts`
 */
import { transcriptFromScript } from '../../shared/align.ts'
import type { Transcript } from '../../shared/contract.ts'

let falhas = 0
function conferir(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) console.log(`  ok   ${nome}`)
  else {
    falhas += 1
    console.log(`  FALHA ${nome}\n        obtido:   ${a}\n        esperado: ${b}`)
  }
}

/*
 * O Whisper fecha "original." exatamente onde abre "manga," -- nao sobra
 * um milissegundo para o "No" que existe no roteiro. Era assim que nasciam as
 * palavras de duracao zero.
 */
const medido: Transcript = {
  source: 'whisper',
  words: [
    { text: 'era', start: 0.0, end: 0.5 },
    { text: 'original.', start: 0.5, end: 1.0 },
    { text: 'manga,', start: 1.0, end: 1.8 },
    { text: 'ele', start: 1.9, end: 2.3 },
  ],
  segments: [],
  text: 'era original. manga, ele',
  cutCandidates: [],
}

const roteiro = 'era original. No manga, ele'
const resultado = transcriptFromScript(roteiro, medido)
const saida = resultado?.transcript
if (!resultado) console.log('  (o alinhamento recusou o par roteiro/audio)')

console.log('palavras que sairam:')
for (const w of saida?.words ?? []) {
  console.log(`  ${w.start.toFixed(3)}s -> ${w.end.toFixed(3)}s  "${w.text}"  (${(w.end - w.start).toFixed(3)}s)`)
}
console.log()

const no = saida?.words.find((w) => w.text === 'No')
conferir('a palavra do roteiro aparece', no !== undefined, true)
conferir('e ela NAO tem duracao zero', no !== undefined && no.end - no.start > 0, true)
conferir('ela cabe antes da palavra seguinte', no !== undefined && no.end <= 1.8, true)

const manga = saida?.words.find((w) => w.text === 'manga,')
conferir('a palavra medida cedeu no maximo metade', manga !== undefined && manga.start <= 1.0 + 0.4 + 1e-9, true)
conferir('e continua tendo duracao', manga !== undefined && manga.end - manga.start > 0, true)

// A ordem nunca pode se inverter: e disso que dependem os trechos e a legenda.
const ordenado = (saida?.words ?? []).every((w, i, arr) => i === 0 || w.start >= arr[i - 1]!.start - 1e-9)
conferir('as palavras seguem em ordem crescente', ordenado, true)

const zeradas = (saida?.words ?? []).filter((w) => w.end - w.start <= 0).length
conferir('nenhuma palavra com duracao zero', zeradas, 0)

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
