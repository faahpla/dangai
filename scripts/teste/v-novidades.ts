/**
 * O QUE MUDOU (shared/novidades.ts): a versao do package.json tem entrada --
 * sem ela o GitHub nao publica --, a lista vem da mais nova para a mais
 * velha, e a janelinha mostra o que deve para cada caso de quem abre.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-novidades.ts`.
 */
import { readFileSync } from 'node:fs'
import { compararVersoes, NOVIDADES, novidadesParaMostrar, type Novidade } from '../../shared/novidades.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const versao = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
// O npm version roda DEPOIS de escrever a entrada: ela pode estar um passo a frente do package.json.
ok(
  `a versao do package.json (${versao}) tem entrada, ou a proxima ja esta escrita`,
  NOVIDADES.length > 0 && compararVersoes(NOVIDADES[0]!.versao, versao) >= 0,
  `a mais nova da lista e ${NOVIDADES[0]?.versao}`,
)
ok('a lista vem da mais nova para a mais velha, sem repetir', NOVIDADES.every((n, i) => i === 0 || compararVersoes(NOVIDADES[i - 1]!.versao, n.versao) > 0))
ok('toda versao tem o formato 1.2.3', NOVIDADES.every((n) => /^\d+\.\d+\.\d+$/.test(n.versao)))
ok('nenhum item vazio', NOVIDADES.every((n) => n.itens.every((t) => t.trim().length > 10)))

ok('1.77.0 > 1.76.0', compararVersoes('1.77.0', '1.76.0') === 1)
ok('1.10.0 > 1.9.0 (numero, nao letra)', compararVersoes('1.10.0', '1.9.0') === 1)
ok('1.77.1 = 1.77.1', compararVersoes('1.77.1', '1.77.1') === 0)

const lista: Novidade[] = [
  { versao: '1.80.0', itens: ['oitenta'] },
  { versao: '1.79.0', itens: [] },
  { versao: '1.78.1', itens: ['setenta e oito e um'] },
  { versao: '1.78.0', itens: ['setenta e oito'] },
  { versao: '1.77.0', itens: ['setenta e sete'] },
]
const vs = (n: Novidade[]): string => n.map((x) => x.versao).join(' ')
ok('primeira vez no Dangai: nada', novidadesParaMostrar('1.80.0', null, false, lista).length === 0)
ok('ja usava, mas nunca viu a janelinha: so a atual', vs(novidadesParaMostrar('1.78.0', null, true, lista)) === '1.78.0')
ok('mesma versao de novo: nada', novidadesParaMostrar('1.78.0', '1.78.0', true, lista).length === 0)
ok('pulou versoes: as do meio tambem, a mais nova em cima', vs(novidadesParaMostrar('1.80.0', '1.77.0', true, lista)) === '1.80.0 1.78.1 1.78.0')
ok('versao sem itens nao aparece', !vs(novidadesParaMostrar('1.80.0', '1.77.0', true, lista)).includes('1.79.0'))
ok('nada do futuro (lista a frente da versao instalada)', vs(novidadesParaMostrar('1.78.0', '1.77.0', true, lista)) === '1.78.0')
ok('voltou de versao (vista maior que a atual): nada', novidadesParaMostrar('1.77.0', '1.80.0', true, lista).length === 0)

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
