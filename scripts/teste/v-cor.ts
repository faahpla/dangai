/**
 * A matematica da camada de ajuste: zerada nao mexe em nada, cada controle
 * puxa para o lado que o nome diz, e as curvas sao monotonas.
 * `npx tsx scripts/teste/v-cor.ts`.
 */
import { AJUSTE_DE_COR_PADRAO, type AjusteDeCor } from '../../shared/contract.ts'
import { ajusteNeutro, curvaInterpolada, tabelasDoAjuste, PONTOS_DA_TABELA } from '../../shared/cor.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}
const com = (patch: Partial<AjusteDeCor>): AjusteDeCor => ({ ...AJUSTE_DE_COR_PADRAO, ...patch })
const meio = Math.round((PONTOS_DA_TABELA - 1) / 2)
const crescente = (t: number[]): boolean => t.every((v, i) => i === 0 || v >= t[i - 1]! - 1e-9)

const zero = tabelasDoAjuste(AJUSTE_DE_COR_PADRAO)
ok('zerado e a identidade', zero.r.every((v, i) => Math.abs(v - i / (PONTOS_DA_TABELA - 1)) < 1e-6))
ok('zerado e neutro', ajusteNeutro(AJUSTE_DE_COR_PADRAO))
ok('com saturacao deixa de ser neutro', !ajusteNeutro(com({ saturacao: 0.3 })))

const exp = tabelasDoAjuste(com({ exposicao: 1 }))
ok('+1 de exposicao clareia o meio', exp.r[meio]! > zero.r[meio]! + 0.1, exp.r[meio]!.toFixed(3))
ok('e preto continua preto', exp.r[0] === 0)

const bri = tabelasDoAjuste(com({ brilho: 0.5 }))
ok('brilho clareia o meio sem mexer nas pontas', bri.g[meio]! > zero.g[meio]! && bri.g[0] === 0 && Math.abs(bri.g.at(-1)! - 1) < 1e-9)

const con = tabelasDoAjuste(com({ contraste: 1 }))
ok('contraste escurece o quarto escuro e clareia o claro',
  con.r[Math.round(PONTOS_DA_TABELA * 0.25)]! < zero.r[Math.round(PONTOS_DA_TABELA * 0.25)]! &&
  con.r[Math.round(PONTOS_DA_TABELA * 0.75)]! > zero.r[Math.round(PONTOS_DA_TABELA * 0.75)]!)

const sombras = tabelasDoAjuste(com({ sombras: 1 }))
const q = Math.round(PONTOS_DA_TABELA * 0.25)
const tq = Math.round(PONTOS_DA_TABELA * 0.85)
ok('sombras levanta o escuro mais que o claro', sombras.r[q]! - zero.r[q]! > sombras.r[tq]! - zero.r[tq]!)

const quente = tabelasDoAjuste(com({ temperatura: 1 }))
ok('temperatura positiva: mais vermelho, menos azul', quente.r[meio]! > zero.r[meio]! && quente.b[meio]! < zero.b[meio]!)

for (const [nome, patch] of Object.entries({
  contraste: { contraste: 1 }, contrasteNeg: { contraste: -1 }, sombras: { sombras: 1 }, realces: { realces: -1 },
  tudo: { exposicao: 1.5, brilho: -0.6, contraste: 0.8, sombras: -1, realces: 1, brancos: 1, pretos: -1 },
} as Record<string, Partial<AjusteDeCor>>)) {
  const t = tabelasDoAjuste(com(patch))
  ok(`${nome}: tabela crescente e dentro de 0..1`, crescente(t.r) && t.r.every((v) => v >= 0 && v <= 1))
}

// A curva: passa pelos pontos e nao passa do teto entre eles.
const pts = [{ x: 0, y: 0 }, { x: 0.3, y: 0.6 }, { x: 0.35, y: 0.95 }, { x: 1, y: 1 }]
const f = curvaInterpolada(pts)
ok('a curva passa pelos pontos', pts.every((p) => Math.abs(f(p.x) - p.y) < 1e-9))
const amostras = Array.from({ length: 201 }, (_, i) => f(i / 200))
ok('e nao passa do teto (monotona)', amostras.every((v) => v <= 1 + 1e-9) && crescente(amostras))

const sCurve = tabelasDoAjuste(com({ curvas: { ...AJUSTE_DE_COR_PADRAO.curvas, mestre: [{ x: 0, y: 0 }, { x: 0.25, y: 0.18 }, { x: 0.75, y: 0.82 }, { x: 1, y: 1 }] } }))
ok('curva em S no mestre mexe nos tres canais igual', sCurve.r[q] === sCurve.g[q] && sCurve.g[q] === sCurve.b[q] && sCurve.r[q]! < zero.r[q]!)
const soR = tabelasDoAjuste(com({ curvas: { ...AJUSTE_DE_COR_PADRAO.curvas, r: [{ x: 0, y: 0.2 }, { x: 1, y: 1 }] } }))
ok('curva so do R mexe so no vermelho', soR.r[0]! > 0.19 && soR.g[0] === 0)

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
