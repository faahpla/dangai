/**
 * O alinhamento forcado, numa emissao de brinquedo com a resposta conhecida.
 *
 * A paridade com o LegendAI foi medida fora daqui, sobre a saida real do
 * wav2vec2 na narracao do Lye: 246 de 246 palavras identicas ao WhisperX, ao
 * milissegundo. Isto guarda a conta contra regressao sem precisar do modelo.
 * `npx esbuild scripts/teste/v-alinhar.ts --bundle --platform=node` e rodar.
 */
import { alinharPalavras } from '../../shared/alinhar'

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

const vocab = { '<pad>': 0, '|': 1, o: 2, i: 3, l: 4, a: 5 }
const classes = 6
/**
 * Uma emissao em que cada quadro "diz" com certeza um simbolo. `roteiro` e a
 * sequencia de simbolos por quadro; "_" e silencio (o branco do CTC).
 */
function emissao(roteiro: string): Float32Array {
  const dados = new Float32Array(roteiro.length * classes).fill(Math.log(0.01))
  for (const [t, c] of [...roteiro].entries()) {
    const k = c === '_' ? 0 : vocab[c as keyof typeof vocab]!
    dados[t * classes + k] = Math.log(0.95)
  }
  return dados
}

console.log('duas palavras separadas por silencio')
{
  //            0123456789
  const fala = '__oi_|_la_'
  const r = alinharPalavras(['oi', 'la'], emissao(fala), fala.length, classes, vocab, 0.02)!
  // "oi": o no quadro 2, i no 3 (e o silencio seguinte fica com o i ate o |)
  conferir('oi comeca no quadro do o', r[0]!.start, 0.04)
  conferir('la comeca no quadro do l', r[1]!.start, 0.14)
  conferir('oi termina antes de la comecar', r[0]!.end <= r[1]!.start, true)
}

console.log('pontuacao vira curinga e nao desalinha nada')
{
  const fala = '__oi_|_la_'
  const r = alinharPalavras(['OI,', 'LA.'], emissao(fala), fala.length, classes, vocab, 0.02)!
  conferir('maiuscula e pontuacao nao mudam o inicio', [r[0]!.start, r[1]!.start], [0.04, 0.14])
}

console.log('texto maior que o audio')
{
  conferir('devolve null, sem inventar', alinharPalavras(['oi', 'la'], emissao('oi'), 2, classes, vocab, 0.02), null)
}

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
