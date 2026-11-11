/**
 * Resumo de manga: os quadrinhos de cada frase chegam aos trechos da narracao
 * (shared/resumo-de-manga.ts, cenasDosTrechos).
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/teste/v-resumo-de-manga.ts
 */
import { cenasDosTrechos, resumoNoProjetoSchema, textoDoResumo } from '../../shared/resumo-de-manga.ts'

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

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
