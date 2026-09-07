/**
 * A aritmetica de como um trecho se reparte entre as cenas.
 *
 * Roda sem app: e conta pura, e conta pura e onde os erros silenciosos moram.
 * `npx tsx scripts/teste/v-trecho.ts` ou node --experimental-strip-types.
 */
import {
  cabeCortePorPalavra,
  cortesAutomaticos,
  limitesDaFronteira,
  palavrasPorSlot,
  prender,
  slotsDoTrecho,
  spansDoTrecho,
} from '../../shared/trecho.ts'

let falhas = 0
function conferir(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) {
    console.log(`  ok   ${nome}`)
  } else {
    falhas += 1
    console.log(`  FALHA ${nome}\n        obtido:   ${a}\n        esperado: ${b}`)
  }
}

// Dez palavras, uma por segundo, de 0 a 10.
const palavras = Array.from({ length: 10 }, (_, i) => ({
  text: `p${i}`,
  start: i,
  end: i + 0.9,
}))

console.log('slots')
conferir('sem uniao, um slot por cena', slotsDoTrecho(['a', 'b', 'c'], undefined, undefined).length, 3)
conferir('uniao junta duas num slot so', slotsDoTrecho(['a', 'b', 'c'], undefined, [0]).length, 2)
conferir('o par guarda os dois caminhos', slotsDoTrecho(['a', 'b', 'c'], undefined, [0])[0]!.paths, ['a', 'b'])
conferir('peso do par e o da primeira', slotsDoTrecho(['a', 'b', 'c'], [3, 1, 1], [0])[0]!.peso, 3)

console.log('\nproporcional (sem ninguem puxar)')
const tresIguais = slotsDoTrecho(['a', 'b', 'c'], undefined, undefined)
conferir(
  'tres cenas iguais num trecho de 0..9',
  spansDoTrecho(0, 9, tresIguais, palavras, null).map((s) => [s.start, s.end]),
  [[0, 3], [3, 6], [6, 9]],
)
const comPeso = slotsDoTrecho(['a', 'b'], [3, 1], undefined)
conferir(
  'peso 3x1 da 3/4 do tempo para a primeira',
  spansDoTrecho(0, 8, comPeso, palavras, null).map((s) => [s.start, s.end]),
  [[0, 6], [6, 8]],
)

console.log('\no corte automatico GRUDA na palavra (o defeito de 07/09)')
{
  // Palavras em tempos irregulares, como fala de verdade -- e nenhuma comeca
  // no instante que a proporcao escolheria.
  const irregulares = [
    { text: 'a', start: 0.0, end: 0.34 },
    { text: 'b', start: 0.41, end: 0.79 },
    { text: 'c', start: 0.88, end: 1.52 },
    { text: 'd', start: 1.61, end: 2.13 },
    { text: 'e', start: 2.28, end: 2.61 },
    { text: 'f', start: 2.74, end: 3.2 },
  ]
  const duas = slotsDoTrecho(['x', 'y'], undefined, undefined)
  // A proporcao cairia em 1,60s -- que e silencio entre 'c' e 'd', mas o corte
  // antigo caia em qualquer lugar, inclusive no meio de uma palavra.
  const spans = spansDoTrecho(0, 3.2, duas, irregulares, null)
  const fronteira = spans[0]!.end
  conferir('a fronteira cai no comeco de uma palavra', irregulares.some((w) => Math.abs(w.start - fronteira) < 1e-9), true)
  conferir('e e a palavra mais proxima da proporcao (1,60s -> "d" em 1,61s)', fronteira, 1.61)

  const tres = slotsDoTrecho(['x', 'y', 'z'], undefined, undefined)
  const s3 = spansDoTrecho(0, 3.2, tres, irregulares, null)
  const caemEmPalavra = s3
    .slice(1)
    .every((sp) => irregulares.some((w) => Math.abs(w.start - sp.start) < 1e-9))
  conferir('com tres cenas, TODAS as fronteiras caem em palavra', caemEmPalavra, true)

  // Nenhuma fronteira pode cair DENTRO de uma palavra falada -- era isso que
  // fazia a imagem trocar no meio da palavra.
  const dentro = s3
    .slice(1)
    .filter((sp) => irregulares.some((w) => sp.start > w.start && sp.start < w.end))
  conferir('nenhuma fronteira cai no meio de uma palavra', dentro.length, 0)
}

console.log('\ncorte por palavra')
conferir('cabe: 3 slots e 10 palavras', cabeCortePorPalavra(3, 10), true)
conferir('nao cabe: 3 slots e 2 palavras', cabeCortePorPalavra(3, 2), false)
conferir('nao cabe: um slot so', cabeCortePorPalavra(1, 10), false)
conferir(
  'a fronteira cai no COMECO da palavra escolhida',
  spansDoTrecho(0, 10, tresIguais, palavras, [2, 7]).map((s) => [s.start, s.end]),
  [[0, 2], [2, 7], [7, 10]],
)
conferir(
  'uma palavra antes muda so aquela fronteira',
  spansDoTrecho(0, 10, tresIguais, palavras, [1, 7]).map((s) => [s.start, s.end]),
  [[0, 1], [1, 7], [7, 10]],
)

console.log('\nos limites (o que impede bloco de duracao zero)')
conferir('nao passa por cima da fronteira seguinte', prender([8, 3], 3, 10), [8, 9])
conferir('cada slot fica com ao menos uma palavra', prender([0, 0], 3, 10), [1, 2])
conferir('nem o ultimo slot fica vazio', prender([9, 9], 3, 10), [8, 9])
conferir('quatro slots, dez palavras, tudo no fim', prender([99, 99, 99], 4, 10), [7, 8, 9])

console.log('\numa fronteira PARA na vizinha, nao empurra')
// tres slots, doze palavras, fronteiras em 2 e 8 -- foi o caso real do trecho 3
conferir('a primeira para uma palavra antes da segunda', limitesDaFronteira([2, 8], 0, 3, 12), { min: 1, max: 7 })
conferir('a segunda nao invade a primeira', limitesDaFronteira([2, 8], 1, 3, 12).min, 3)
conferir('a ultima deixa uma palavra para o ultimo slot', limitesDaFronteira([2, 8], 1, 3, 12).max, 11)

console.log('\nautomatico -> palavra (o ponto de partida do primeiro arraste)')
conferir('tres iguais em 0..9 caem nas palavras 3 e 6', cortesAutomaticos(tresIguais, palavras, 0, 9), [3, 6])

console.log('\npintura: a qual cena cada palavra pertence')
conferir(
  'palavra vai para a cena que cobre o instante em que ela COMECA',
  palavrasPorSlot(palavras, spansDoTrecho(0, 10, tresIguais, palavras, [2, 7])),
  [0, 0, 1, 1, 1, 1, 1, 2, 2, 2],
)

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
