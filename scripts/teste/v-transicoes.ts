/**
 * As transicoes configuraveis (v1.61) nao tiram o video do tempo da narracao.
 * `npx tsx scripts/teste/v-transicoes.ts`.
 *
 * - somadas as duracoes e descontadas as sobreposicoes, o total bate com o audio;
 * - cada emenda cabe na metade do bloco mais curto dos dois vizinhos;
 * - a entrada do primeiro bloco e a saida do ultimo nao sobrepoem nada;
 * - o clipe que entra por transicao recua o ponto de entrada na metade dela.
 */
import { toRenderProps } from '../../shared/plan.ts'
import { VIDEO_FPS, type ImageAsset, type ScenePlan, type Transition } from '../../shared/contract.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const clipe = {
  id: 'a', path: 'a.mp4', fileName: 'a.mp4', url: 'u', urlSource: null, width: 1080, height: 1920,
  thumbnail: '', focusX: 0.5, focusY: 0.5, focusAuto: false, kind: 'video', durationSec: 60,
} as unknown as ImageAsset

const cena = (start: number, end: number, tipo: Transition, extra: Record<string, unknown> = {}) => ({
  imageIndex: 0, imageIndexB: null, start, end, effect: 'nenhum', intensity: 0.1, effectB: null, intensityB: null,
  curve: 'linear', sourceStart: start, sourceStartB: 0, curvePoints: null, camera: null, rotation: 0,
  transitionIn: tipo, ...extra,
})

const duracao = 12
const plan = {
  scenes: [
    cena(0, 2, 'light'),
    cena(2, 2.4, 'zoom-in', { transicao: { frames: 60 } }), // bloco de 0,4s: a transicao tem que encolher
    cena(2.4, 5, 'pan-up'),
    cena(5, 8, 'zoom-out', { transicao: { frames: 30, intensidade: 0.9 } }),
    cena(8, 12, 'crossfade', { transitionOut: 'zoom-out', transicaoSaida: { frames: 20 } }),
  ],
} as unknown as ScenePlan

const props = toRenderProps(plan, [clipe], [], null, undefined, undefined, duracao, {}, 'short', [])
const s = props.scenes
const total = Math.round(duracao * VIDEO_FPS)

const soma = s.reduce((n, x, i) => n + x.durationInFrames - (i > 0 ? x.transitionInFrames : 0), 0)
ok('o total bate com a narracao', soma === total, `${soma} quadros, audio tem ${total}`)

const bases = plan.scenes.map((c) => Math.round(c.end * VIDEO_FPS) - Math.round(c.start * VIDEO_FPS))
for (let i = 1; i < s.length; i++) {
  const teto = Math.floor(Math.min(bases[i - 1]!, bases[i]!) / 2)
  ok(`emenda ${i} cabe na metade do bloco mais curto`, s[i]!.transitionInFrames <= teto, `${s[i]!.transitionInFrames} <= ${teto}`)
}
ok('a emenda de 60 quadros num bloco de 0,4s encolheu', s[1]!.transitionInFrames < 60 && s[1]!.transitionInFrames > 0)
ok('a de 30 quadros pedidos ficou com 30', s[3]!.transitionInFrames === 30)
ok('a intensidade chega ao Remotion', s[3]!.entrada?.intensidade === 0.9)

ok('entrada do video: luz, sem sobrepor nada', s[0]!.entrada?.tipo === 'light' && s[0]!.transitionInFrames > 0)
ok('saida do video: so no ultimo, com 20 quadros', s.at(-1)!.saida?.tipo === 'zoom-out' && s.at(-1)!.saida?.frames === 20)
ok('nenhum outro bloco tem saida', s.slice(0, -1).every((x) => x.saida === null))

// O clipe do bloco 3 comeca no segundo 5 do arquivo; entrando por 30 quadros,
// o Remotion recebe o ponto 15 quadros antes.
const esperado = Math.round(5 * VIDEO_FPS) - 15
ok('o ponto de entrada recua meia transicao', s[3]!.sourceStartFrames === esperado, `${s[3]!.sourceStartFrames} vs ${esperado}`)

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
