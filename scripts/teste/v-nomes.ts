/**
 * Nome natural do personagem na Biblioteca (shared/nomes.ts).
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-nomes.ts`.
 *
 * O MyAnimeList escreve "Ishigami, Senkuu"; a tela mostra "Senku Ishigami".
 * A vogal longa so encurta em palavra que e romaji ("Gourry" fica), o "oo"
 * fica ("Ooki"), e o indice continua com o nome cru. As duas grafias do mesmo
 * personagem (vogal longa diferente, sobrenome igual) viram um nome so.
 * So funcao pura: nao le nem grava nada.
 */
import { canonizar, fichasDoNome, mesmaPessoaComErro, nomeNatural, vogalLongaCurta } from '../../shared/nomes.ts'

let falhas = 0
const igual = (nome: string, veio: unknown, esperado: unknown): void => {
  const ok = JSON.stringify(veio) === JSON.stringify(esperado)
  console.log((ok ? '  ok    ' : '  FALHA ') + nome + (ok ? '' : `  -- veio ${JSON.stringify(veio)}, esperado ${JSON.stringify(esperado)}`))
  if (!ok) falhas++
}

// Vogal longa: so "uu" e o "ou" que fecha silaba, so em romaji.
for (const [cru, tela] of [
  ['Senkuu', 'Senku'],
  ['Ryuusui', 'Ryusui'],
  ['Ukyou', 'Ukyo'],
  ['Inoue', 'Inoue'],
  ['Ooki', 'Ooki'],
  ['Gourry', 'Gourry'],
  ['Louis', 'Louis'],
  ['Douglas', 'Douglas'],
  ['Rousseau', 'Rousseau'],
  ['Rem', 'Rem'],
] as const) igual(`vogalLongaCurta(${cru})`, vogalLongaCurta(cru), tela)

// A ordem da AniList, e a grafia da legenda quando ha.
igual('virgula vira nome sobrenome', nomeNatural('Ishigami, Senkuu'), 'Senku Ishigami')
igual('Nanami, Ryuusui', nomeNatural('Nanami, Ryuusui'), 'Ryusui Nanami')
igual('sem virgula fica na ordem', nomeNatural('Ukyo Saionji'), 'Ukyo Saionji')
igual('espacos sobrando', nomeNatural('  Kurosaki,   Ichigo '), 'Ichigo Kurosaki')
igual('nome de uma palavra', nomeNatural('Rem'), 'Rem')
igual('legenda em caixa alta so manda na grafia', nomeNatural('Ishigami, Senkuu', ['SENKU']), 'Senku Ishigami')
igual('legenda com outra grafia manda', nomeNatural('Ishigami, Senkuu', ['Senkuu']), 'Senkuu Ishigami')

// Mesma pessoa: vogal longa diferente, sobrenome identico.
const mesma = (a: string, b: string): boolean => mesmaPessoaComErro(fichasDoNome(a), fichasDoNome(b))
igual('Saionji, Ukyou == Ukyo Saionji', mesma('Saionji, Ukyou', 'Ukyo Saionji'), true)
igual('Rem != Ram', mesma('Rem', 'Ram'), false)
igual('Kurosaki Ichigo != Kurosaki Isshin', mesma('Kurosaki, Ichigo', 'Kurosaki, Isshin'), false)
igual('sobrenome diferente nao junta', mesma('Saionji, Ukyou', 'Ukyo Ishigami'), false)
const mapa = canonizar(new Map([['Saionji, Ukyou', 3], ['Ukyo Saionji', 9]]))
igual('canonizar junta no mais usado', [mapa.get('Saionji, Ukyou'), mapa.get('Ukyo Saionji')], ['Ukyo Saionji', 'Ukyo Saionji'])

// A ordem da lista e a do nome na tela.
const ordem = ['Nanami, Ryuusui', 'Ishigami, Senkuu', 'Asagiri, Gen']
  .map((n) => nomeNatural(n))
  .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
igual('ordem alfabetica pelo nome natural', ordem, ['Gen Asagiri', 'Ryusui Nanami', 'Senku Ishigami'])

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
process.exitCode = falhas === 0 ? 0 : 1
