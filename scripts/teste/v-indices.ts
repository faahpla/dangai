/**
 * Os dois indices de cada cena -- cima e baixo -- andando juntos.
 *
 * O defeito do ajk: tirar um bloco antes de uma tela dividida deixava a metade
 * de baixo apontando para a imagem do bloco SEGUINTE, e trocar uma trocava a
 * outra. `npx tsx scripts/teste/v-indices.ts` ou node --experimental-strip-types.
 */
import { abrirEspaco, removerCena, repararMetadesDeBaixo } from '../../shared/indices.ts'
import type { Scene, ScenePlan } from '../../shared/contract.ts'

let falhas = 0
function conferir(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) {
    console.log(`  ok   ${nome}`)
  } else {
    falhas += 1
    console.log(`  FALHA ${nome}\n        obtido:   ${a}\n        esperado: ${b}`)
  }
}

const cena = (imageIndex: number, imageIndexB: number | null, start: number, end: number): Scene =>
  ({ imageIndex, imageIndexB, start, end }) as Scene
const indices = (p: ScenePlan): (number | null)[][] => p.scenes.map((c) => [c.imageIndex, c.imageIndexB])

/*
 * A montagem da Biblioteca: bloco 0 em tela cheia, bloco 1 = frase de 3 cenas
 * (a 1a sozinha, 2a e 3a unidas), bloco 3 o seguinte.
 *   imagens: 0=A  1=B  2=C  3=D  4=E
 *   cenas:   [A] [B] [C|D] [E]
 */
const imagens = ['A', 'B', 'C', 'D', 'E']
const plano: ScenePlan = { scenes: [cena(0, null, 0, 1), cena(1, null, 1, 2), cena(2, 3, 2, 3), cena(4, null, 3, 4)] } as ScenePlan

console.log('remover um bloco ANTES da tela dividida')
{
  const r = removerCena(plano, imagens, 0)!
  conferir('a imagem dele sai', r.images, ['B', 'C', 'D', 'E'])
  conferir('cima E baixo descem', indices(r.plan), [[0, null], [1, 2], [3, null]])
  conferir('a metade de baixo continua sendo D', r.images[r.plan.scenes[1]!.imageIndexB!], 'D')
  conferir('e o bloco seguinte continua sendo E', r.images[r.plan.scenes[2]!.imageIndex], 'E')
  conferir('o tempo vai para o vizinho', [r.plan.scenes[0]!.start, r.plan.scenes[0]!.end], [0, 2])
}

console.log('remover a PROPRIA tela dividida')
{
  const r = removerCena(plano, imagens, 2)!
  conferir('as duas imagens saem', r.images, ['A', 'B', 'E'])
  conferir('ninguem aponta para fora', indices(r.plan), [[0, null], [1, null], [2, null]])
  conferir('o anterior herda o tempo', r.plan.scenes[1]!.end, 3)
}

console.log('inserir antes da tela dividida')
{
  const s = plano.scenes.map((c) => abrirEspaco(c, 1, 2))
  conferir('cima e baixo andam juntos', s.map((c) => [c.imageIndex, c.imageIndexB]), [[0, null], [3, null], [4, 5], [6, null]])
}

console.log('reparar o projeto que ja salvou o desalinhamento')
{
  // O que a v1.43 deixava depois de remover o bloco 0: baixo ficou em 3 (o E),
  // e o D (agora 2) sem ninguem.
  const quebrado = { scenes: [cena(0, null, 0, 2), cena(1, 3, 2, 3), cena(3, null, 3, 4)] } as ScenePlan
  const r = repararMetadesDeBaixo(quebrado, 4)
  conferir('uma reparada', r.reparadas, 1)
  conferir('a de baixo volta para a vizinha orfa', indices(r.plan), [[0, null], [1, 2], [3, null]])
  conferir('projeto saudavel fica intacto', repararMetadesDeBaixo(plano, 5).reparadas, 0)
  // Compartilhada mas sem orfa ao lado: nao ha como saber, nao mexe.
  const ambiguo = { scenes: [cena(0, 2, 0, 1), cena(1, null, 1, 2), cena(2, null, 2, 3)] } as ScenePlan
  conferir('sem orfa vizinha, nao inventa', repararMetadesDeBaixo(ambiguo, 3).reparadas, 0)
}

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
