/**
 * O transform animado e a troca de pivo sem pulo.
 * `npx tsx scripts/teste/v-transform.ts`.
 */
import {
  bezierNoTempo,
  compensarPivo,
  deslocarChaves,
  gravarChave,
  transformNoTempo,
  type Transform2D,
} from '../../shared/transform.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}
const perto = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol

const base: Transform2D = { x: 5, y: -3, escala: 1.2, rotacao: 10 }

// Sem chaves: os valores fixos.
const fixo = transformNoTempo(base, [], 1, 'linear')
ok('sem chaves vale o fixo', JSON.stringify(fixo) === JSON.stringify(base))

const chaves = [
  { t: 0, x: 0, y: 0, escala: 1, rotacao: 0 },
  { t: 2, x: 20, y: -10, escala: 4, rotacao: 360 },
]
const meio = transformNoTempo(base, chaves, 1, 'linear')
ok('linear: posicao no meio', perto(meio.x, 10) && perto(meio.y, -5), JSON.stringify(meio))
ok('zoom em proporcao: 1x -> 4x passa por 2x', perto(meio.escala, 2), String(meio.escala))
ok('giro passa de 180 (meia volta no meio)', perto(meio.rotacao, 180))
ok('antes da primeira vale a primeira', transformNoTempo(base, chaves, -1, 'linear').x === 0)
ok('depois da ultima vale a ultima', transformNoTempo(base, chaves, 9, 'linear').x === 20)
const suave = transformNoTempo(base, chaves, 0.5, 'ease-in-out')
ok('ease-in-out comeca devagar', suave.x < 5 && suave.x > 0, String(suave.x))

// Gravar: na mesma chave corrige, fora dela cria.
const g1 = gravarChave(chaves, 2.01, { x: 30 }, base, 0.02)
ok('gravar perto de uma chave corrige ela', g1.length === 2 && g1[1]!.x === 30)
const g2 = gravarChave(chaves, 1, { x: 99 }, meio, 0.02)
ok('gravar no meio cria, em ordem', g2.length === 3 && g2[1]!.t === 1 && g2[1]!.x === 99 && g2[1]!.escala === meio.escala)

// O pivo troca e nada sai do lugar: p' = pivo + T + A(p - pivo).
const W = 1080
const H = 1920
const aplica = (v: Transform2D, pivo: { x: number; y: number }, espelhar: boolean, p: [number, number]): [number, number] => {
  const ox = pivo.x * W
  const oy = pivo.y * H
  const r = (v.rotacao * Math.PI) / 180
  const dx = (p[0] - ox) * (espelhar ? -1 : 1) * v.escala
  const dy = (p[1] - oy) * v.escala
  return [ox + (v.x / 100) * W + dx * Math.cos(r) - dy * Math.sin(r), oy + (v.y / 100) * H + dx * Math.sin(r) + dy * Math.cos(r)]
}
for (const espelhar of [false, true]) {
  const v: Transform2D = { x: 12, y: -7, escala: 0.6, rotacao: -144 }
  const de = { x: 0.5, y: 0.5 }
  const para = { x: 0.47, y: 0.53 }
  const c = compensarPivo(v, de, para, W, H, espelhar)
  const novo = { ...v, ...c }
  let pior = 0
  for (const p of [[100, 200], [540, 960], [900, 1700], [0, 0]] as [number, number][]) {
    const a = aplica(v, de, espelhar, p)
    const b = aplica(novo, para, espelhar, p)
    pior = Math.max(pior, Math.hypot(a[0] - b[0], a[1] - b[1]))
  }
  // A posicao e arredondada a 0,1% -- ate ~2 px num quadro de 1920.
  ok(`trocar o pivo nao move a imagem${espelhar ? ' (espelhada)' : ''}`, pior < 2.5, `${pior.toFixed(2)} px`)
}

// Puxar a borda esquerda: a animacao fica no mesmo lugar da linha do tempo.
const d = deslocarChaves(chaves, 0.5, 'linear')
ok('cortar o comeco poe uma chave no zero com o valor dali', d.length === 2 && d[0]!.t === 0 && perto(d[0]!.x, 5), JSON.stringify(d[0]))
ok('e a outra anda junto', perto(d[1]!.t, 1.5) && d[1]!.x === 20)
const volta = deslocarChaves(chaves, -1, 'linear')
ok('esticar o comeco empurra as chaves', perto(volta[0]!.t, 1) && perto(volta[1]!.t, 3))

// AS CURVAS DESENHADAS (o cubic-bezier do CSS).
ok('bezier reta = linear', [0, 0.25, 0.5, 0.9, 1].every((p) => perto(bezierNoTempo([0, 0, 1, 1], p), p, 1e-4)))
ok('bezier ease (0.25,0.1,0.25,1) no meio ~0,80', perto(bezierNoTempo([0.25, 0.1, 0.25, 1], 0.5), 0.8024, 2e-3), String(bezierNoTempo([0.25, 0.1, 0.25, 1], 0.5)))
ok('bezier: pontas no lugar', perto(bezierNoTempo([0.34, 1.56, 0.64, 1], 0), 0, 1e-6) && perto(bezierNoTempo([0.34, 1.56, 0.64, 1], 1), 1, 1e-6))
const passa = Math.max(...Array.from({ length: 50 }, (_, k) => bezierNoTempo([0.34, 1.56, 0.64, 1], k / 49)))
ok('"passa e volta" passa do fim', passa > 1.05, String(passa))
const recua = Math.min(...Array.from({ length: 50 }, (_, k) => bezierNoTempo([0.36, 0, 0.66, -0.56], k / 49)))
ok('"recua e vai" vai abaixo do comeco', recua < -0.05, String(recua))

// A curva do clipe vale para todas as passagens; a da chave ganha dela.
const tres = [
  { t: 0, x: 0, y: 0, escala: 1, rotacao: 0 },
  { t: 1, x: 10, y: 0, escala: 1, rotacao: 0, curva: [0.34, 1.56, 0.64, 1] as [number, number, number, number] },
  { t: 2, x: 20, y: 0, escala: 1, rotacao: 0 },
]
const naPrimeira = transformNoTempo(base, tres, 0.5, 'linear', [0, 0, 1, 1])
ok('passagem sem curva propria segue a do clipe', perto(naPrimeira.x, 5, 1e-3), String(naPrimeira.x))
const naSegunda = transformNoTempo(base, tres, 1.7, 'linear', [0, 0, 1, 1])
ok('passagem com curva propria segue a dela (passa do 20)', naSegunda.x > 20, String(naSegunda.x))
const corte = deslocarChaves(tres, 1.5, 'linear')
ok('cortar o comeco no meio de uma passagem leva a curva dela para a chave do zero', corte[0]!.t === 0 && !!corte[0]!.curva)

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
