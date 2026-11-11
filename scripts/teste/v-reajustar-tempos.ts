/**
 * Acertar os tempos quando a narracao mudou de ritmo (shared/reajustar-tempos.ts).
 * O caso do ajk: as palavras medidas a 100%, a narracao final a 115%.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/teste/v-reajustar-tempos.ts
 */
import {
  ancorasDasPalavras,
  fimDaFala,
  legendasNosTemposNovos,
  mapaDeTempo,
  temposDeOutraNarracao,
  trechoNosTemposNovos,
  type PalavraComTempo,
  transcricaoNosTemposNovos,
} from '../../shared/reajustar-tempos.ts'
import { ancorasEntreTempos, mesmosTempos, type TemposDaSaida } from '../../shared/edicao-de-audio.ts'

let falhas = 0
function ok(nome: string, condicao: boolean, detalhe = ''): void {
  if (condicao) console.log(`  ok    ${nome}`)
  else {
    falhas += 1
    console.log(`  FALHA ${nome}${detalhe ? `  -- ${detalhe}` : ''}`)
  }
}
const perto = (a: number, b: number, tol = 0.002): boolean => Math.abs(a - b) <= tol

// O roteiro falado a 100%: uma palavra a cada 0,4 s, com uma pausa de 1 s no meio.
const texto = 'A Noelle vai perder a transformação nova, e ninguém esperava isso em Black Clover.'.split(' ')
const velhas: PalavraComTempo[] = []
let t = 0.3
for (const [i, p] of texto.entries()) {
  velhas.push({ text: p, start: t, end: t + 0.3 })
  t += i === 6 ? 1.4 : 0.4
}
const fator = 1.15
const novas = velhas.map((p) => ({ ...p, start: p.start / fator, end: p.end / fator }))

console.log('perceber que os tempos sao de outra narracao')
{
  const fim = fimDaFala(velhas)
  ok('a fala velha nao cabe no audio a 115%', temposDeOutraNarracao(velhas, fim / fator + 0.2))
  ok('no audio de onde veio, cabe', !temposDeOutraNarracao(velhas, fim + 0.3))
  ok('sem palavras, nada a dizer', !temposDeOutraNarracao([], 10))
}

console.log('o mapa do tempo, palavra com palavra')
{
  const mapa = mapaDeTempo(ancorasDasPalavras(velhas, novas), fimDaFala(velhas), fimDaFala(novas))
  ok('o comeco de cada palavra vai para o dela', velhas.every((p, i) => perto(mapa(p.start), novas[i]!.start)))
  ok('no meio da pausa, proporcional', perto(mapa((velhas[6]!.end + velhas[7]!.start) / 2), (novas[6]!.end + novas[7]!.start) / 2))
  ok('zero e zero', mapa(0) === 0)
  const vals = Array.from({ length: 200 }, (_, k) => mapa(k * 0.05))
  ok('sempre crescente', vals.every((v, k) => k === 0 || v >= vals[k - 1]!))
}

console.log('o Whisper juntou duas palavras na narracao nova')
{
  // "ninguém esperava" virou uma palavra so; o resto casa pelo texto.
  const juntas: PalavraComTempo[] = [...novas.slice(0, 8), { text: 'ninguémesperava', start: novas[8]!.start, end: novas[9]!.end }, ...novas.slice(10)]
  const mapa = mapaDeTempo(ancorasDasPalavras(velhas, juntas), fimDaFala(velhas), fimDaFala(juntas))
  ok('as outras palavras continuam casando', [0, 3, 7, 10, 13].every((i) => perto(mapa(velhas[i]!.start), novas[i]!.start)))
  ok('a que sumiu cai entre as vizinhas', mapa(velhas[8]!.start) > novas[7]!.end - 0.01 && mapa(velhas[9]!.end) < novas[10]!.start + 0.01)
}

console.log('os trechos, as juncoes e as legendas vao junto')
{
  const mapa = mapaDeTempo(ancorasDasPalavras(velhas, novas), fimDaFala(velhas), fimDaFala(novas))
  const juncao = { text: 'A Noelle vai perder', start: velhas[0]!.start, end: velhas[3]!.end, sentence: 0, partes: [{ text: 'A Noelle', start: velhas[0]!.start, end: velhas[1]!.end, sentence: 0 }, { text: 'vai perder', start: velhas[2]!.start, end: velhas[3]!.end, sentence: 0 }] }
  const nova = trechoNosTemposNovos(juncao, mapa)
  ok('o trecho anda', perto(nova.start, novas[0]!.start) && perto(nova.end, novas[3]!.end))
  ok('os pedacos da juncao andam junto', perto(nova.partes![1]!.start, novas[2]!.start))
  ok('texto e frase ficam', nova.text === juncao.text && nova.sentence === 0)
  const fps = 24000 / 1001
  const q = (s: number): number => Math.round(s * fps)
  const legendas = [{ from: q(velhas[0]!.start), durationInFrames: q(velhas[3]!.end) - q(velhas[0]!.start), words: velhas.slice(0, 4).map((p) => ({ text: p.text, from: q(p.start), durationInFrames: q(p.end) - q(p.start) })) }]
  const levadas = legendasNosTemposNovos(legendas, mapa, fps)
  ok('a legenda editada vai para o tempo novo (no quadro mais perto)', Math.abs(levadas[0]!.from - q(novas[0]!.start)) <= 1 && Math.abs(levadas[0]!.words[3]!.from - q(novas[3]!.start)) <= 1)
}

console.log('voltar ao Audio: os tempos de um Pronto para o outro, sem ouvir de novo')
{
  // A narracao do video: a gravacao inteira (30 s) menos uma respiracao (de 10 a 12 s).
  const velhos: TemposDaSaida = {
    trechos: [
      { de: 0, ate: 10, em: 0, fonte: 'principal', id: 'a' },
      { de: 12, ate: 30, em: 10, fonte: 'principal', id: 'b' },
    ],
    velocidade: 100,
  }
  ok('so o Fresh Air mudou: mesmos tempos', mesmosTempos(velhos, { ...velhos, trechos: velhos.trechos.map((x) => ({ ...x, id: `${x.id}x` })) }))
  ok('acelerou: outros tempos', !mesmosTempos(velhos, { ...velhos, velocidade: 115 }))

  // A 115%: tudo encolhe na mesma proporcao.
  const rapido: TemposDaSaida = { ...velhos, velocidade: 115 }
  const m1 = mapaDeTempo(ancorasEntreTempos(velhos, rapido), 28, 28 / 1.15)
  ok('a 115%, cada instante vai para o mesmo ponto da fala', [0, 3, 9.99, 10.01, 20, 27.9].every((t) => perto(m1(t), t / 1.15)))

  // Cortou mais uma respiracao (de 20 a 21 s da gravacao, que estava em 18-19 s do video).
  const cortado: TemposDaSaida = {
    trechos: [
      { de: 0, ate: 10, em: 0, fonte: 'principal', id: 'a' },
      { de: 12, ate: 20, em: 10, fonte: 'principal', id: 'b' },
      { de: 21, ate: 30, em: 18, fonte: 'principal', id: 'c' },
    ],
    velocidade: 100,
  }
  const m2 = mapaDeTempo(ancorasEntreTempos(velhos, cortado), 28, 27)
  ok('antes do corte, nada anda', perto(m2(5), 5) && perto(m2(17.5), 17.5))
  ok('depois do corte, tudo anda 1 s para tras', perto(m2(19.5), 18.5) && perto(m2(25), 24) && perto(m2(28), 27))
  ok('dentro do pedaco cortado, para no corte', perto(m2(18.5), 18))

  // A transcricao vai junto, com as mesmas palavras.
  const tr = { words: [{ text: 'a', start: 19.5, end: 19.8 }], segments: [{ start: 19, end: 20, text: 'a' }], cutCandidates: [19.9, 25] }
  const tr2 = transcricaoNosTemposNovos(tr, m2)
  ok('as palavras andam junto', perto(tr2.words[0]!.start, 18.5) && tr2.words.length === 1)
  ok('os pontos de corte andam junto', perto(tr2.cutCandidates[1]!, 24))
}

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
