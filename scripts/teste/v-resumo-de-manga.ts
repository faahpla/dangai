/**
 * Resumo de manga: os quadrinhos de cada frase chegam aos trechos da narracao
 * (shared/resumo-de-manga.ts, cenasDosTrechos).
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/teste/v-resumo-de-manga.ts
 */
import { cenasDosTrechos, frasesDoTexto, quantoBate, resumoNoProjetoSchema, resumoParaOProjeto, roteiroQueBate, textoDoResumo } from '../../shared/resumo-de-manga.ts'

let falhas = 0
function ok(nome: string, condicao: boolean, detalhe = ''): void {
  if (condicao) console.log(`  ok    ${nome}`)
  else {
    falhas += 1
    console.log(`  FALHA ${nome}${detalhe ? `  -- ${detalhe}` : ''}`)
  }
}
const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const frases = [
  { texto: 'O Kazui abriu o Portão do Inferno, e ninguém percebeu.', quadros: ['a', 'b', 'c'] },
  { texto: 'O Szayelaporro voltou.', quadros: ['d'] },
  { texto: 'E os capitães mortos vão todos pro Inferno, um por um, sem volta.', quadros: ['e'] },
]

console.log('cada trecho fica com os quadrinhos da sua frase')
{
  // A narracao corta na virgula: a frase 1 vira dois trechos, a 3 vira tres.
  const trechos = [
    { text: 'O Kazui abriu o Portão do Inferno,' },
    { text: 'e ninguém percebeu.' },
    { text: 'O Szayelaporro voltou.' },
    { text: 'E os capitães mortos vão todos pro Inferno,' },
    { text: 'um por um,' },
    { text: 'sem volta.' },
  ]
  const cenas = cenasDosTrechos(frases, trechos)
  ok('frase de 3 quadrinhos em 2 trechos: o maior leva 2', igual(cenas[0], ['a', 'b']) && igual(cenas[1], ['c']), JSON.stringify(cenas))
  ok('frase de um trecho leva tudo', igual(cenas[2], ['d']))
  ok('quadrinho so: no primeiro trecho, os outros seguem com ele', igual(cenas[3], ['e']) && !cenas[4] && !cenas[5])
}

console.log('ele mexeu no roteiro depois')
{
  // Trocou uma palavra e juntou as frases 1 e 2 num trecho so.
  const trechos = [
    { text: 'O Kazui abriu o Portão do Inferno, e quase ninguém percebeu.' },
    { text: 'O Szayelaporro voltou.' },
    { text: 'Uma frase nova que nao estava no resumo.' },
    { text: 'E os capitães mortos vão todos pro Inferno, um por um, sem volta.' },
  ]
  const cenas = cenasDosTrechos(frases, trechos)
  ok('a palavra trocada nao tira a frase do lugar', igual(cenas[0], ['a', 'b', 'c']))
  ok('a frase seguinte continua certa', igual(cenas[1], ['d']))
  ok('frase nova fica sem quadrinho (ele escolhe)', !cenas[2])
  ok('a ultima continua casando', igual(cenas[3], ['e']))
}

console.log('o roteiro e o arquivo')
{
  ok('uma frase por linha, sem linha vazia', textoDoResumo([{ texto: ' A. ' }, { texto: '' }, { texto: 'B.' }]) === 'A.\nB.')
  const lido = resumoNoProjetoSchema.parse({ capitulos: ['x'], frases: [{ texto: 'A.', quadros: ['q.jpg'] }] })
  ok('projeto salvo antes do titulo abre (titulo vazio)', lido.titulo === '')
}

console.log('o roteiro pronto na etapa do Roteiro: reconhecer o que o Resumo escreveu')
{
  const guardado = {
    id: 'r1',
    em: 1,
    titulo: 'T',
    capitulos: ['d'],
    frases: [
      { texto: 'O Yamamoto lutou contra a Unohana.', quadros: ['a.jpg'] },
      { texto: 'E ninguém esperava o que veio depois!', quadros: ['b.jpg'] },
    ],
  }
  const outro = { ...guardado, id: 'r2', frases: [{ texto: 'O Asta treinou com a Noelle a noite inteira.', quadros: ['c.jpg'] }] }
  ok('o mesmo texto bate inteiro', quantoBate('O Yamamoto lutou contra a Unohana.\nE ninguém esperava o que veio depois!', guardado.frases) === 1)
  ok('com umas palavras trocadas ainda bate', quantoBate('O Yamamoto lutou contra Unohana. E ninguem imaginava o que veio depois.', guardado.frases) > 0.75)
  ok('outro roteiro nao bate', quantoBate('Hoje vamos falar de um assunto totalmente diferente.', guardado.frases) < 0.3)
  ok('acha o guardado certo', roteiroQueBate('O Yamamoto lutou contra a Unohana. E ninguém esperava o que veio depois.', [outro, guardado])?.id === 'r1')
  ok('nenhum guardado parecido: null', roteiroQueBate('Um texto qualquer sem nada a ver.', [outro, guardado]) === null)
  ok('frases pela pontuacao', igual(frasesDoTexto('Primeira frase. Segunda? Terceira!  E a sem ponto'), ['Primeira frase.', 'Segunda?', 'Terceira!', 'E a sem ponto']))
  const p = resumoParaOProjeto({
    titulo: 'X',
    capitulos: [{ dir: 'D', serie: 'S', capitulo: 'C', numero: 1, paginas: 3 }],
    quadros: [{ ref: 'c1p1q1', capitulo: 1, pagina: 1, quadro: 1, caminho: 'q1.jpg', miniatura: '', arquivoDaMiniatura: '', oque: '', falas: '', forte: false }],
    frases: [
      { texto: ' A. ', quadros: ['c1p1q1', 'nao-existe'] },
      { texto: '  ', quadros: [] },
    ],
  })
  ok('para o projeto: refs viram arquivos, frase vazia sai', igual(p, { titulo: 'X', capitulos: ['D'], frases: [{ texto: 'A.', quadros: ['q1.jpg'] }] }))
}

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
