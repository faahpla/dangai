/**
 * A regra de disparo dos SFX no preview.
 *
 * `npx tsx scripts/teste/v-sfx-disparo.ts`
 */
import { sfxParaDisparar, SALTO_MAXIMO_SEC } from '../../shared/sfx.ts'

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

const sons = [
  { id: 'a', at: 1.5 },
  { id: 'b', at: 5.0 },
  { id: 'c', at: 5.02 },
  { id: 'd', at: 40 },
]

console.log('tocando para a frente')
conferir('cruzar um som dispara ele', sfxParaDisparar(sons, 1.4, 1.6), ['a'])
conferir('nao cruzar nada nao dispara', sfxParaDisparar(sons, 2.0, 2.2), [])
conferir('dois no mesmo quadro disparam juntos', sfxParaDisparar(sons, 4.99, 5.05), ['b', 'c'])

console.log('\no som exatamente na borda toca UMA vez so')
conferir('o instante final entra', sfxParaDisparar(sons, 1.4, 1.5), ['a'])
conferir('e no passo seguinte nao repete', sfxParaDisparar(sons, 1.5, 1.6), [])

console.log('\ngestos que NAO sao tocar')
conferir('agulha parada', sfxParaDisparar(sons, 3.0, 3.0), [])
conferir('rebobinar', sfxParaDisparar(sons, 6.0, 1.0), [])
conferir('saltar para frente nao toca o caminho', sfxParaDisparar(sons, 3, 41), [])
conferir(
  `salto de ${SALTO_MAXIMO_SEC}s ainda conta como tocar`,
  sfxParaDisparar(sons, 1.0, 1.0 + SALTO_MAXIMO_SEC),
  ['a'],
)
conferir(
  'um milesimo alem do limite ja e salto',
  sfxParaDisparar(sons, 1.0, 1.0 + SALTO_MAXIMO_SEC + 0.001),
  [],
)

console.log('\nsem sons na faixa')
conferir('lista vazia nunca dispara', sfxParaDisparar([], 0, 10), [])

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
