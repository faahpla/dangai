/**
 * MARCA D'AGUA POR CANAL (28/11).
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-marca-dagua.ts`.
 *
 * - a lista das configuracoes: a quebrada sai; modo e forca ruins caem no padrao (Overlay, 100%);
 * - canal novo: Overlay, 100%, nome sugerido pelo arquivo;
 * - projeto antigo abre sem marca; o campo vai nas props do video.
 */
import { lerMarcas, nomeSugerido, novaMarca } from '../../shared/marca-dagua.ts'
import { projectFileSchema } from '../../shared/project-file.ts'
import { renderPropsSchema } from '../../shared/contract.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const lidas = lerMarcas([
  { id: 'a', nome: 'Dopanimes', caminho: 'C:/m/dopa.png', modo: 'overlay', opacidade: 0.8 },
  { id: 'b', nome: '', caminho: 'C:/m/x.png' },
  { id: 'c', nome: 'Euforilmes', caminho: 'C:/m/eufo.png', modo: 'brilhar', opacidade: 7 },
  null,
])
ok('a sem nome e o lixo saem', lidas.map((m) => m.id).join() === 'a,c')
ok('modo e forca ruins: Overlay e 100%', lidas[1]!.modo === 'overlay' && lidas[1]!.opacidade === 1)
const nova = novaMarca(nomeSugerido('D:\\Canais\\Marca Dopa.png'), 'D:\\Canais\\Marca Dopa.png')
ok('canal novo: nome do arquivo, Overlay, 100%', nova.nome === 'Marca Dopa' && nova.modo === 'overlay' && nova.opacidade === 1)
ok('cada canal tem id proprio', nova.id !== novaMarca('x', 'y').id)
ok('projeto antigo: sem marca', projectFileSchema.shape.marcaDagua.parse(undefined) === '')
const props = renderPropsSchema.shape.marcaDagua.parse({ url: 'http://x/m', modo: 'overlay', opacidade: 0.5 })
ok('a marca vai nas props do video', props?.modo === 'overlay' && props.opacidade === 0.5)
ok('props antigas: sem marca', renderPropsSchema.shape.marcaDagua.parse(undefined) === undefined)

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
