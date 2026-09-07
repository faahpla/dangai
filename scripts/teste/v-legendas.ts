/**
 * As regras de montagem da legenda, na frase real dele.
 *
 * Duas palavras por linha, doze caracteres, e nunca juntar uma palavra com a
 * que vem depois de um ponto final. `npx tsx scripts/teste/v-legendas.ts`.
 */
import { buildCaptions } from '../../shared/plan.ts'
import {
  CAPTION_MAX_CHARS,
  CAPTION_MAX_WORDS,
  VIDEO_FPS,
  type Transcript,
} from '../../shared/contract.ts'

const frase =
  'MANO... BLEACH MUDOU O FINAL DE NOVO. E nesse ponto, ate quem leu o manga ja ' +
  'nao sabe exatamente como essa guerra vai terminar no anime.'

// Meio segundo por palavra, coladas: o pior caso para as regras, porque nenhuma
// quebra vem de pausa -- toda quebra tem que sair das regras de texto.
const palavras = frase.split(' ').map((text, i) => ({
  text,
  start: i * 0.5,
  end: i * 0.5 + 0.48,
}))
const transcript: Transcript = {
  source: 'whisper',
  words: palavras,
  segments: [],
  text: frase,
  cutCandidates: [],
}

const blocos = buildCaptions(transcript)
console.log(`${blocos.length} blocos:\n`)
for (const b of blocos) {
  const texto = b.words.map((w) => w.text).join(' ')
  console.log(`  ${(b.from / VIDEO_FPS).toFixed(2)}s  ${texto}`)
}

let falhas = 0
const falhar = (msg: string): void => {
  falhas += 1
  console.log(`  FALHA ${msg}`)
}

console.log('\nconferencia:')
for (const b of blocos) {
  const texto = b.words.map((w) => w.text).join(' ')
  if (b.words.length > CAPTION_MAX_WORDS) falhar(`"${texto}" tem ${b.words.length} palavras`)
  // A palavra sozinha comprida demais e a excecao conhecida: quebrar palavra no
  // meio seria pior que a linha passar do limite.
  if (texto.length > CAPTION_MAX_CHARS && b.words.length > 1) {
    falhar(`"${texto}" tem ${texto.length} caracteres com ${b.words.length} palavras`)
  }
}
console.log(`  ok   nenhuma linha passa de ${CAPTION_MAX_WORDS} palavras`)
console.log(`  ok   nenhuma linha de 2 palavras passa de ${CAPTION_MAX_CHARS} caracteres`)

// A regra que ele pediu com todas as letras: depois de ponto final, a proxima
// palavra nunca divide linha com a anterior.
for (const b of blocos) {
  for (let i = 0; i < b.words.length - 1; i++) {
    if (/[.!?…]["')\]]?$/.test(b.words[i]!.text)) {
      falhar(`"${b.words[i]!.text}" fecha frase e ainda tem "${b.words[i + 1]!.text}" na mesma linha`)
    }
  }
}
console.log('  ok   nenhuma palavra depois de ponto divide linha com a anterior')

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
