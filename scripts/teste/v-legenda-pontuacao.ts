/**
 * "Pontuação: só ? ! %" na legenda queimada (textoNaLegenda). Mexe só no que aparece:
 * o hifen/apostrofo dentro da palavra e o separador de numero ficam.
 */
import assert from 'node:assert/strict'
import { captionStyleSchema, textoNaLegenda } from '../../shared/contract'
import { projectFileSchema } from '../../shared/project-file'

const casos: [string, string][] = [
  ['Mano,', 'Mano'],
  ['briga.', 'briga'],
  ['sorrindo...', 'sorrindo'],
  ['sorrindo…', 'sorrindo'],
  ['sério?!', 'sério?!'],
  ['100%', '100%'],
  ['"forte"', 'forte'],
  ['(dela)', 'dela'],
  ['—', ''],
  ['guarda-chuva,', 'guarda-chuva'],
  ["d'água", "d'água"],
  ['1,5', '1,5'],
  ['2.000.', '2.000'],
  ['mostrá-lo:', 'mostrá-lo'],
  ['ela-', 'ela'],
]
for (const [entra, sai] of casos) assert.equal(textoNaLegenda(entra, 'limpar'), sai, entra)
for (const [entra] of casos) assert.equal(textoNaLegenda(entra, 'manter'), entra)

// Projeto e preset antigos (sem o campo) abrem como antes.
assert.equal(captionStyleSchema.parse({}).pontuacao, undefined)
assert.equal(captionStyleSchema.parse({ pontuacao: 'xyz' }).pontuacao, 'manter')
const p = projectFileSchema.safeParse({ version: 1 })
if (p.success) assert.equal((p.data as { captionPontuacao: string }).captionPontuacao, 'manter')
console.log('v-legenda-pontuacao ok')
