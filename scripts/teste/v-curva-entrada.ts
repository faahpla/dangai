/**
 * A curva da entrada com alcas (bezier por ponto). Sem alcas ela tem de dar
 * EXATAMENTE o que dava antes (Hermite monotona); com alcas deitadas, o Easy
 * Ease do After Effects. `npx tsx scripts/teste/v-curva-entrada.ts`.
 */
import { CURVA_DA_ENTRADA_PADRAO, escalaDaEntrada, type CurvaDaEntrada } from '../../shared/contract.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

/** A implementacao de antes, copiada: a referencia para "nada mudou". */
function antiga(curva: CurvaDaEntrada, t: number): number {
  const pts = [...curva].sort((a, b) => a.t - b.t)
  if (t <= pts[0]!.t) return pts[0]!.v
  if (t >= pts.at(-1)!.t) return pts.at(-1)!.v
  const n = pts.length
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1]!.v - pts[i]!.v) / Math.max(pts[i + 1]!.t - pts[i]!.t, 1e-9))
  const m: number[] = [d[0]!]
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2)
  m.push(d[n - 2]!)
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i]! / d[i]!
    const b = m[i + 1]! / d[i]!
    const h = a * a + b * b
    if (h > 9) { const k = 3 / Math.sqrt(h); m[i] = k * a * d[i]!; m[i + 1] = k * b * d[i]! }
  }
  let i = 0
  while (t > pts[i + 1]!.t) i++
  const p0 = pts[i]!
  const p1 = pts[i + 1]!
  const h = p1.t - p0.t
  const s = (t - p0.t) / h
  const s2 = s * s
  const s3 = s2 * s
  return (2 * s3 - 3 * s2 + 1) * p0.v + (s3 - 2 * s2 + s) * h * m[i]! + (-2 * s3 + 3 * s2) * p1.v + (s3 - s2) * h * m[i + 1]!
}

const curvas: Record<string, CurvaDaEntrada> = {
  padrao: CURVA_DA_ENTRADA_PADRAO,
  pop: [{ t: 0, v: 0.3 }, { t: 0.35, v: 1.25 }, { t: 0.65, v: 0.94 }, { t: 1, v: 1 }],
  repique: [{ t: 0, v: 0.5 }, { t: 0.25, v: 1.18 }, { t: 0.45, v: 0.9 }, { t: 0.65, v: 1.06 }, { t: 0.82, v: 0.98 }, { t: 1, v: 1 }],
}
for (const [nome, c] of Object.entries(curvas)) {
  let pior = 0
  for (let k = 0; k <= 400; k++) pior = Math.max(pior, Math.abs(escalaDaEntrada(c, k / 400) - antiga(c, k / 400)))
  ok(`${nome}: sem alcas, igual a de antes`, pior < 1e-6, `diferenca maxima ${pior.toExponential(2)}`)
}

// Easy Ease: dois pontos com alcas deitadas a 1/3 -- a bezier (0.33, 0, 0.67, 1).
const easy: CurvaDaEntrada = [{ t: 0, v: 0.6, sai: { dt: 1 / 3, dv: 0 } }, { t: 1, v: 1, ent: { dt: -1 / 3, dv: 0 } }]
ok('easy ease passa pelo meio no meio', Math.abs(escalaDaEntrada(easy, 0.5) - 0.8) < 1e-6, escalaDaEntrada(easy, 0.5).toFixed(4))
const passo = 0.001
const inclinacaoInicio = (escalaDaEntrada(easy, passo) - escalaDaEntrada(easy, 0)) / passo
const inclinacaoMeio = (escalaDaEntrada(easy, 0.5 + passo) - escalaDaEntrada(easy, 0.5)) / passo
ok('easy ease sai parado e acelera no meio', inclinacaoInicio < 0.05 && inclinacaoMeio > 0.5, `${inclinacaoInicio.toFixed(3)} / ${inclinacaoMeio.toFixed(3)}`)

// Alca mais longa = mais suave: o ponto do meio com alcas longas e deitadas
// fica "parado" mais tempo em volta dele.
const curta: CurvaDaEntrada = [{ t: 0, v: 0.5 }, { t: 0.5, v: 1.2, ent: { dt: -0.05, dv: 0 }, sai: { dt: 0.05, dv: 0 } }, { t: 1, v: 1 }]
const longa: CurvaDaEntrada = [{ t: 0, v: 0.5 }, { t: 0.5, v: 1.2, ent: { dt: -0.45, dv: 0 }, sai: { dt: 0.45, dv: 0 } }, { t: 1, v: 1 }]
ok('alca longa segura mais perto do pico', escalaDaEntrada(longa, 0.35) > escalaDaEntrada(curta, 0.35), `${escalaDaEntrada(longa, 0.35).toFixed(3)} > ${escalaDaEntrada(curta, 0.35).toFixed(3)}`)

// Alca maior que o vizinho e presa a ele: a curva continua uma funcao do tempo.
const exagerada: CurvaDaEntrada = [{ t: 0, v: 0.5, sai: { dt: 0.9, dv: 0.4 } }, { t: 0.3, v: 1.1 }, { t: 1, v: 1 }]
const amostras = Array.from({ length: 201 }, (_, k) => escalaDaEntrada(exagerada, k / 200))
ok('alca exagerada nao quebra a curva', amostras.every((v) => Number.isFinite(v) && v > 0 && v < 2.5))

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
