/**
 * EFEITOS NO CLIPE (27/11): desfoque, mosaico e tarja para censurar.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-efeitos.ts`.
 *
 * - a lista guardada: efeito quebrado sai, o resto fica; campo ruim cai no padrao;
 * - a area nunca passa da borda do quadro; sem area = a tela toda;
 * - so os ligados (e com forca) valem; a forca vira px proporcionais ao quadro;
 * - o plano leva os efeitos do bloco e do clipe da faixa ate o render;
 * - plano e clipe antigos (sem efeitos) abrem e renderizam sem nada.
 */
import { toRenderProps } from '../../shared/plan.ts'
import { AJUSTE_DE_COR_PADRAO, sceneSchema, sobreposicaoSchema, type ImageAsset, type ScenePlan, type SobreposicaoSalva } from '../../shared/contract.ts'
import {
  areaNoQuadro,
  desvioDoDesfoque,
  efeitosAtivos,
  efeitosSchema,
  ladoDoMosaico,
  novoEfeito,
  type EfeitoDoClipe,
} from '../../shared/efeitos.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

console.log('a lista guardada')
const lida = efeitosSchema.parse([
  { id: 'a', tipo: 'desfoque', forca: 0.4, area: null },
  { id: 'b', tipo: 'explosao', forca: 1, area: null },
  'lixo',
  { id: 'c', tipo: 'mosaico', forca: 'muito', area: { x: 2, y: 0, w: 0.5, h: 0.5 } },
])
ok('o tipo desconhecido e o lixo saem', lida.map((e) => e.id).join() === 'a,c')
ok('forca ruim cai em 50%, area ruim vira a tela toda', lida[1]!.forca === 0.5 && lida[1]!.area === null)

console.log('a area')
const a = areaNoQuadro({ x: 0.9, y: -0.2, w: 0.3, h: 0.5 })
ok('empurrada para dentro do quadro', Math.abs(a.x - 0.7) < 1e-9 && a.y === 0 && a.w === 0.3 && a.h === 0.5, JSON.stringify(a))
ok('sem area = o quadro inteiro', JSON.stringify(areaNoQuadro(null)) === JSON.stringify({ x: 0, y: 0, w: 1, h: 1 }))

console.log('os que valem')
const e = (p: Partial<EfeitoDoClipe>): EfeitoDoClipe => ({ ...novoEfeito('desfoque'), ...p })
const ativos = efeitosAtivos([e({ id: '1' }), e({ id: '2', ligado: false }), e({ id: '3', forca: 0 }), { ...novoEfeito('tarja'), id: '4', forca: 0 }])
ok('desligado e forca zero ficam de fora; a tarja nao depende de forca', ativos.map((x) => x.id).join() === '1,4')
ok('o desfoque cresce com a forca', desvioDoDesfoque(1, 1080) > desvioDoDesfoque(0.2, 1080))
ok('o 16:9 (1920 de largura) desfoca na mesma proporcao', Math.abs(desvioDoDesfoque(0.5, 1920) / 1920 - desvioDoDesfoque(0.5, 1080) / 1080) < 1e-9)
ok('quadradinho do mosaico: inteiro e de pelo menos 2 px', Number.isInteger(ladoDoMosaico(0.3, 1080)) && ladoDoMosaico(0, 100) >= 2)
const id1 = novoEfeito('mosaico').id
ok('cada efeito novo tem id proprio', id1 !== novoEfeito('mosaico').id)

console.log('do plano ao render')
const imagem = {
  id: 'a', path: 'a.png', fileName: 'a.png', url: 'u', urlSource: null, width: 1080, height: 1920,
  thumbnail: '', focusX: 0.5, focusY: 0.5, focusAuto: false, kind: 'image',
} as unknown as ImageAsset
const bloco = {
  imageIndex: 0, imageIndexB: null, start: 0, end: 4, effect: 'nenhum', intensity: 0.1, effectB: null,
  intensityB: null, curve: 'linear', sourceStart: 0, sourceStartB: 0, curvePoints: null, camera: null,
  rotation: 0, transitionIn: 'cut',
}
const censura = [{ ...novoEfeito('mosaico'), area: { x: 0.2, y: 0.2, w: 0.3, h: 0.2 } }]
const clipe = {
  id: 'i', path: 'x.png', fileName: 'x.png', tipo: 'image', faixa: 0, at: 1, durationSec: 2, inicioSec: 0,
  usarSec: 2, x: 0, y: 0, escala: 1, opacidade: 1, aspecto: 1, rotacao: 0, efeito: 'nenhum', intensidade: 0.1,
  curva: 'linear', pontosDaCurva: null, cor: AJUSTE_DE_COR_PADRAO, espelhar: false, fadeInSec: 0, fadeOutSec: 0, url: 'u2',
} as SobreposicaoSalva & { url: string }
const props = toRenderProps(
  { scenes: [{ ...bloco, efeitos: censura }] } as unknown as ScenePlan,
  [imagem], [], null, undefined, undefined, 4, {}, 'short',
  [{ ...clipe, efeitos: [novoEfeito('desfoque')] }],
)
ok('o bloco leva os efeitos', props.scenes[0]?.efeitos.length === 1 && props.scenes[0]!.efeitos[0]!.tipo === 'mosaico')
ok('o clipe da faixa leva os efeitos', props.sobreposicoes[0]?.efeitos.length === 1)
const antigo = toRenderProps({ scenes: [bloco] } as unknown as ScenePlan, [imagem], [], null, undefined, undefined, 4, {}, 'short', [clipe])
ok('plano e clipe antigos: sem efeito nenhum', antigo.scenes[0]?.efeitos.length === 0 && antigo.sobreposicoes[0]?.efeitos.length === 0)
ok('bloco salvo antes disto ainda valida', sceneSchema.safeParse({ ...bloco, reason: '' }).success || sceneSchema.safeParse(bloco).success)
const { url: _url, ...clipeSalvo } = clipe
ok('clipe salvo antes disto ainda valida', sobreposicaoSchema.safeParse(clipeSalvo).success)

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
