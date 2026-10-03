/**
 * As regras de montagem da legenda, na frase real dele.
 *
 * Duas palavras por linha, doze caracteres, e nunca juntar uma palavra com a
 * que vem depois de um ponto final.
 *
 * Com UMA excecao, coberta no fim: quando a regra deixaria uma palavrinha
 * sozinha por tres quadros, ela e resgatada junto com a vizinha -- ate tres
 * palavras e dezoito caracteres. O ponto final continua sendo parede mesmo ali.
 *
 * `npx tsx scripts/teste/v-legendas.ts`.
 */
import { buildCaptions } from '../../shared/plan.ts'
import {
  CAPTION_MAX_CHARS,
  CAPTION_MAX_WORDS,
  VIDEO_FPS,
  type Transcript,
  type Word,
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
/** Um par obtido/esperado, no mesmo formato das outras suites. */
function conferir(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) console.log(`  ok   ${nome}`)
  else {
    falhas += 1
    console.log(`  FALHA ${nome}
        obtido:   ${a}
        esperado: ${b}`)
  }
}

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
console.log(`  ok   sem resgate, nenhuma linha passa de ${CAPTION_MAX_WORDS} palavras`)
console.log(`  ok   sem resgate, nenhuma linha passa de ${CAPTION_MAX_CHARS} caracteres`)

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

/*
 * O RESGATE DA PISCADA.
 *
 * Fala rapida com uma palavra longa deixa a palavrinha seguinte orfa, e orfa
 * ela dura tres quadros. Foi o que ele viu em 45,44s do video do Rudeus: a
 * legenda "para" aparecendo e sumindo. O resgate junta ela com a vizinha,
 * quebrando os limites dele SO nesse caso e dentro de um teto.
 */
console.log('\nresgate da piscada (o caso de 45,44s)')
{
  // Reproduz o ritmo real: "suficiente" longa, "para" curtissima.
  const rapidas: Word[] = [
    { text: 'vive', start: 0, end: 0.2 },
    { text: 'tempo', start: 0.2, end: 0.44 },
    { text: 'suficiente', start: 0.44, end: 0.93 },
    { text: 'para', start: 0.93, end: 1.06 },
    { text: 'descobrir', start: 1.06, end: 1.48 },
    { text: 'coisas', start: 1.48, end: 1.9 },
  ]
  const blocos = buildCaptions({
    source: 'whisper',
    words: rapidas,
    segments: [],
    text: '',
    cutCandidates: [],
  })
  const textos = blocos.map((b) => b.words.map((w) => w.text).join(' '))
  // "suficiente para" e "para descobrir" passam dos dez caracteres. O teto
  // nao se quebra por preposicao: "para" fica na propria linha, curta mesmo.
  const passa = blocos.filter((b) => b.words.length > 1 && b.words.map((w) => w.text).join(' ').length > 10)
  conferir('nenhuma linha de duas palavras passa de dez caracteres', passa.length, 0)
  conferir('"para" fica sozinha, porque nao cabe com nenhuma vizinha', textos.includes('para'), true)
}

console.log('\no exemplo dele: "desde recem-nascido," com uma palavra por linha')
{
  const blocos = buildCaptions(
    {
      source: 'script',
      words: [
        { text: 'DESDE', start: 0, end: 0.3 },
        { text: 'RECÉM-NASCIDO,', start: 0.3, end: 1.0 },
        { text: 'A', start: 1.1, end: 1.15 },
        { text: 'LILIA', start: 1.15, end: 1.5 },
      ],
      segments: [],
      text: '',
      cutCandidates: [],
    },
    { palavras: 1, caracteres: 10, minimo: 0.45, maximo: 2, adiantar: 0.04, fecharVaos: 0.5 },
  )
  const textos = blocos.map((b) => b.words.map((w) => w.text).join(' '))
  conferir('"desde" numa linha, "recem-nascido," na outra', textos.slice(0, 2), ['DESDE', 'RECÉM-NASCIDO,'])
  conferir('artigo que cabe continua descendo junto ("a lilia")', textos.includes('A LILIA'), true)
}

console.log('\nos limites do resgate')
{
  // Depois de um ponto, resgatar juntaria duas ideias -- e proibido mesmo que
  // caiba nos limites de palavra e caractere.
  const comPonto: Word[] = [
    { text: 'ver', start: 0, end: 0.3 },
    { text: 'isso.', start: 0.3, end: 0.6 },
    { text: 'E', start: 0.6, end: 0.7 },
    { text: 'ai', start: 0.7, end: 1.2 },
  ]
  const blocos = buildCaptions({
    source: 'whisper',
    words: comPonto,
    segments: [],
    text: '',
    cutCandidates: [],
  })
  const textos = blocos.map((b) => b.words.map((w) => w.text).join(' '))
  conferir('nada atravessa o ponto final', textos.some((t) => t.includes('isso. E')), false)
}

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
