/**
 * Trocar o roteiro nao perde as cenas escolhidas: elas vao para o trecho novo
 * que cai no mesmo tempo da narracao. `npx tsx scripts/teste/v-remapear.ts`.
 */
import { remapearEscolhas } from '../../shared/remapear-escolhas.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const antigos = [
  { start: 0, end: 2 },
  { start: 2, end: 5 },
  { start: 5, end: 9 },
  { start: 9, end: 12 },
]
const escolhas = { 0: ['a', 'b'], 1: ['c'], 2: ['d', 'e'], 3: ['f'] }

// Mesmo corte: tudo no mesmo lugar.
const igual = remapearEscolhas(antigos, escolhas, antigos)
ok('roteiro com o mesmo corte mantem tudo', JSON.stringify(igual) === JSON.stringify({ 0: ['a', 'b'], 1: ['c'], 2: ['d', 'e'], 3: ['f'] }), JSON.stringify(igual))

// O novo junta os dois primeiros e parte o terceiro.
const novos = [
  { start: 0, end: 5 },
  { start: 5, end: 7.2 },
  { start: 7.2, end: 9 },
  { start: 9, end: 12 },
]
const r = remapearEscolhas(antigos, escolhas, novos)
ok('dois antigos num novo somam as cenas, em ordem', JSON.stringify(r[0]) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(r[0]))
ok('o antigo partido vai para a parte maior', JSON.stringify(r[1]) === JSON.stringify(['d', 'e']), JSON.stringify(r[1]))
ok('o ultimo continua no ultimo', JSON.stringify(r[3]) === JSON.stringify(['f']))
const total = Object.values(r).reduce((n, v) => n + v.length, 0)
ok('nenhuma cena some', total === 6, `${total} de 6`)

// Cena repetida em dois trechos que viram um so: aparece uma vez.
const rep = remapearEscolhas([{ start: 0, end: 1 }, { start: 1, end: 2 }], { 0: ['x'], 1: ['x', 'y'] }, [{ start: 0, end: 2 }])
ok('sem repetir a mesma cena', JSON.stringify(rep[0]) === JSON.stringify(['x', 'y']), JSON.stringify(rep[0]))

// Trecho antigo fora de qualquer novo: vai para o mais perto.
const fora = remapearEscolhas([{ start: 20, end: 21 }], { 0: ['z'] }, [{ start: 0, end: 5 }, { start: 5, end: 10 }])
ok('sem sobreposicao: o mais perto', JSON.stringify(fora[1]) === JSON.stringify(['z']), JSON.stringify(fora))

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
