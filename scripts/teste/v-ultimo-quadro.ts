/**
 * Clipe da faixa de video que termina no fim da narracao vai ate o ULTIMO
 * quadro do video. "O ultimo frame fica sem a minha CC."
 * `npx tsx scripts/teste/v-ultimo-quadro.ts`.
 */
import { toRenderProps } from '../../shared/plan.ts'
import { AJUSTE_DE_COR_PADRAO, VIDEO_FPS, type ImageAsset, type ScenePlan, type SobreposicaoSalva } from '../../shared/contract.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const imagem = {
  id: 'a', path: 'a.png', fileName: 'a.png', url: 'u', urlSource: null, width: 1080, height: 1920,
  thumbnail: '', focusX: 0.5, focusY: 0.5, focusAuto: false, kind: 'image',
} as unknown as ImageAsset

for (const duracao of [72.45, 10.01, 33.333, 5.5]) {
  const plan = {
    scenes: [{
      imageIndex: 0, imageIndexB: null, start: 0, end: duracao, effect: 'nenhum', intensity: 0.1,
      effectB: null, intensityB: null, curve: 'linear', sourceStart: 0, sourceStartB: 0, curvePoints: null,
      camera: null, rotation: 0, transitionIn: 'cut',
    }],
  } as unknown as ScenePlan
  const ajuste = {
    id: 'aj', path: '', fileName: 'Camada de ajuste', tipo: 'ajuste', faixa: 0, at: 1.2345, durationSec: 3600,
    inicioSec: 0, usarSec: duracao - 1.2345, x: 0, y: 0, escala: 1, opacidade: 1, aspecto: 1, rotacao: 0,
    efeito: 'nenhum', intensidade: 0.1, curva: 'linear', pontosDaCurva: null, cor: AJUSTE_DE_COR_PADRAO,
    espelhar: false, fadeInSec: 0, fadeOutSec: 0, url: '',
  } as SobreposicaoSalva & { url: string }
  const props = toRenderProps(plan, [imagem], [], null, undefined, undefined, duracao, {}, 'short', [ajuste])
  const total = Math.ceil(duracao * VIDEO_FPS)
  const o = props.sobreposicoes[0]!
  ok(`${duracao}s: a camada vai ate o quadro ${total - 1}`, o.from + o.durationInFrames >= total, `termina em ${o.from + o.durationInFrames}, video tem ${total}`)
}

// E um clipe que acaba ANTES do fim nao e esticado.
{
  const plan = { scenes: [{ imageIndex: 0, imageIndexB: null, start: 0, end: 20, effect: 'nenhum', intensity: 0.1, effectB: null, intensityB: null, curve: 'linear', sourceStart: 0, sourceStartB: 0, curvePoints: null, camera: null, rotation: 0, transitionIn: 'cut' }] } as unknown as ScenePlan
  const curto = { id: 'c', path: '', fileName: 'x', tipo: 'ajuste', faixa: 0, at: 2, durationSec: 3600, inicioSec: 0, usarSec: 3, x: 0, y: 0, escala: 1, opacidade: 1, aspecto: 1, rotacao: 0, efeito: 'nenhum', intensidade: 0.1, curva: 'linear', pontosDaCurva: null, cor: AJUSTE_DE_COR_PADRAO, espelhar: false, fadeInSec: 0, fadeOutSec: 0, url: '' } as SobreposicaoSalva & { url: string }
  const o = toRenderProps(plan, [imagem], [], null, undefined, undefined, 20, {}, 'short', [curto]).sobreposicoes[0]!
  ok('clipe no meio continua do tamanho dele', o.from === 48 && o.durationInFrames === 72, `${o.from} + ${o.durationInFrames}`)
}

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
