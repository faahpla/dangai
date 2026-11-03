/**
 * A legenda editada na mao na linha do tempo: mover, puxar as pontas, cortar.
 *
 * Conta pura (shared/legenda-na-timeline.ts). O que importa: o bloco nunca
 * invade a vizinha nem sai do video, e as palavras andam junto -- uma palavra
 * fora do bloco nunca acenderia no marcador.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/teste/v-legenda-na-timeline.ts
 */
import type { CaptionBlock } from '../../shared/contract.ts'
import { cortarLegenda, duracaoMinima, limitesDaLegenda, reposicionarLegenda } from '../../shared/legenda-na-timeline.ts'

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

/** Toda palavra dentro do bloco, em ordem, sem se cruzar, com um quadro ou mais. */
function sao(bloco: CaptionBlock): boolean {
  const fim = bloco.from + bloco.durationInFrames
  return bloco.words.every((p, k) => {
    const prox = bloco.words[k + 1]
    return (
      p.durationInFrames >= 1 &&
      p.from >= bloco.from &&
      p.from + p.durationInFrames <= fim &&
      (!prox || p.from + p.durationInFrames <= prox.from)
    )
  })
}

// "a piada com voz" de 100 a 160: tres palavras de 20 quadros.
const piada: CaptionBlock = {
  from: 100,
  durationInFrames: 60,
  words: [
    { text: 'a', from: 100, durationInFrames: 20 },
    { text: 'piada', from: 120, durationInFrames: 20 },
    { text: 'engraçada', from: 140, durationInFrames: 20 },
  ],
}

console.log('mover')
{
  const m = reposicionarLegenda(piada, 130, 190)
  conferir('anda inteira, mesma duracao', [m.from, m.durationInFrames], [130, 60])
  conferir('as palavras andam junto', m.words.map((p) => p.from), [130, 150, 170])
  conferir('o texto nao muda', m.words.map((p) => p.text), ['a', 'piada', 'engraçada'])
}

console.log('puxar as pontas')
{
  const longa = reposicionarLegenda(piada, 100, 220)
  conferir('o dobro: as palavras esticam na proporcao', longa.words.map((p) => [p.from, p.durationInFrames]), [[100, 40], [140, 40], [180, 40]])
  const curta = reposicionarLegenda(piada, 130, 160)
  conferir('puxar o comeco: termina no mesmo lugar', [curta.from, curta.from + curta.durationInFrames], [130, 160])
  conferir('puxar o comeco: palavras dentro', sao(curta), true)
  const minima = reposicionarLegenda(piada, 100, 100)
  conferir('nunca menor que a duracao minima', minima.durationInFrames, duracaoMinima(piada))
  conferir('no minimo, um quadro por palavra', minima.words.map((p) => [p.from, p.durationInFrames]), [[100, 1], [101, 1], [102, 1]])
  conferir('antes do zero, fica no zero', reposicionarLegenda(piada, -15, 45).from, 0)
}

console.log('os vizinhos e o fim do video')
{
  const blocos: CaptionBlock[] = [
    { from: 10, durationInFrames: 40, words: [{ text: 'antes', from: 10, durationInFrames: 40 }] },
    piada,
    { from: 200, durationInFrames: 30, words: [{ text: 'depois', from: 200, durationInFrames: 30 }] },
  ]
  conferir('entre o fim da anterior e o comeco da proxima', limitesDaLegenda(blocos, 1, 500), { piso: 50, teto: 200 })
  conferir('a primeira comeca no zero', limitesDaLegenda(blocos, 0, 500).piso, 0)
  conferir('a ultima vai ate o fim do video', limitesDaLegenda(blocos, 2, 500).teto, 500)
}

console.log('cortar na agulha')
{
  const partes = cortarLegenda(piada, 135)
  conferir('duas legendas, coladas na agulha', partes?.map((b) => [b.from, b.durationInFrames]), [[100, 35], [135, 25]])
  conferir('cada palavra fica do lado do meio dela', partes?.map((b) => b.words.map((p) => p.text)), [['a', 'piada'], ['engraçada']])
  conferir('as palavras cabem nas duas', partes?.every(sao), true)
  const cedo = cortarLegenda(piada, 105)
  conferir('agulha antes do meio da primeira: ela ainda vai sozinha para a esquerda', cedo?.map((b) => b.words.map((p) => p.text)), [['a'], ['piada', 'engraçada']])
  conferir('a segunda empurra a palavra para dentro', cedo?.[1]?.words[0]?.from, 120)
  conferir('agulha fora da legenda: nada', cortarLegenda(piada, 160), null)
  conferir('agulha na ponta: nada', cortarLegenda(piada, 100), null)
  const sozinha: CaptionBlock = { from: 0, durationInFrames: 30, words: [{ text: 'BOOM', from: 0, durationInFrames: 30 }] }
  conferir('uma palavra so: nada', cortarLegenda(sozinha, 15), null)
  // Duas palavras no ultimo quadro (o Whisper as vezes cola o fim): a direita
  // teria um quadro para duas.
  const apertada: CaptionBlock = {
    from: 0,
    durationInFrames: 4,
    words: [
      { text: 'um', from: 0, durationInFrames: 1 },
      { text: 'dois', from: 1, durationInFrames: 1 },
      { text: 'tres', from: 3, durationInFrames: 1 },
      { text: 'quatro', from: 3, durationInFrames: 1 },
    ],
  }
  conferir('lado sem quadro para as palavras dele: nada', cortarLegenda(apertada, 3), null)
  conferir('um quadro antes, cabe', cortarLegenda(apertada, 2)?.every(sao), true)
}

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
