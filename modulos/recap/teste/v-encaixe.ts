/**
 * [recap] Portado do Studio (scripts/teste/v-montar-encaixe.ts), sem mudar as regras.
 *
 * O ENCAIXE de uma escolha de cena na duracao da frase (shared/encaixe.ts),
 * puro, com um indice sintetico pequeno e as regras do Levi (14/10):
 *
 *   A. frase mais curta que o plano: janela no comeco do plano;
 *   B/C. fala citada dentro do plano: a janela comeca nela (recua so o
 *      necessario quando a frase nao cabe depois dela);
 *   D. frase mais longa: emenda com o plano SEGUINTE, com aviso;
 *   E. falta pequena (<= 0,25 s) nao emenda;
 *   F. vao entre planos nao conta como imagem;
 *   G. seguinte na OP/ED: emenda com o ANTERIOR;
 *   H. fim do episodio: cena curta, com aviso;
 *   I. idempotente; J. take novo encolhe/cresce a partir do mesmo comeco;
 *   K. duas cenas na frase, cada uma no seu pedaco (barrinha);
 *   L. candidato posto a mao guarda o comeco dele;
 *   M. sem take: a estimativa pelas palavras;
 *   N. a escolha encaixada passa no schema e cobre a frase sem buraco.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-encaixe.ts
 */
import {
  candidatoDosPlanos,
  escolhaDaFraseSchema,
  palavrasNaFrase,
  temposDasCenas,
  trechosDoCandidato,
  type CandidatoDeCena,
  type EscolhaDaFrase,
} from '../shared/cenas'
import {
  AVISO_CENA_CURTA,
  AVISO_CENA_EMENDADA,
  encaixarEscolha,
  FOLGA_SEM_EMENDA_SEC,
  type ContextoDoEncaixe,
} from '../shared/encaixe'
import type { Cue, Exclusao, Plano } from '../shared/episodio'
import { hashDoTexto, palavrasDaFrase, textoFalado, type TakeDaVoz } from '../shared/voz'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
const perto = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol

const EP = `ep_${'a'.repeat(40)}`
function plano(id: string, start: number, end: number): Plano {
  return { id, start, end, arquivo: `C:/fake/${id}.mp4`, keyframe: `C:/fake/${id}_1.jpg`, cueIds: [], falantes: [], personagens: [] }
}
const P = [
  plano('0001', 100, 103),
  plano('0002', 103, 105),
  plano('0003', 105, 106),
  plano('0004', 106, 110),
  plano('0005', 112, 115), // vao de 2 s antes dele
  plano('0006', 200, 210), // dentro da ED
  plano('0007', 260, 262), // o ultimo do episodio
]
const ED: Exclusao = { start: 199, end: 260, motivo: 'ed', origem: 'capitulo', confirmada: true, porque: '' }
const CUES: Cue[] = [
  { id: 'c0001', start: 101.5, end: 102.4, texto: 'Fala A', falante: 'Senku', estilo: 'Default', tipo: 'fala' },
  { id: 'c0002', start: 100.5, end: 101.2, texto: 'Fala B', falante: 'Chrome', estilo: 'Default', tipo: 'fala' },
  // Comeca 0,2 s antes do fim do 0001 (o caso do relance no comeco da emenda).
  { id: 'c0003', start: 102.8, end: 104, texto: 'Fala C', falante: 'Senku', estilo: 'Default', tipo: 'fala' },
]
const indice: ContextoDoEncaixe['indice'] = { id: EP, planos: P, cues: CUES, exclusoes: [ED] }

const TEXTO = 'Senku liga o radio e todos ouvem a voz do outro lado.'
function frase(citacao: string | null = null): ContextoDoEncaixe['frase'] {
  return { id: 'f01', texto: TEXTO, citacaoCueId: citacao, cueDoMomento: null, eventoIds: [] }
}
/** Um take de uma frase so, com `dur` segundos e as palavras espalhadas por igual. */
function take(dur: number, id = 't1'): NonNullable<ContextoDoEncaixe['take']> {
  const palavras = palavrasDaFrase(TEXTO)
  const passo = (dur - 0.2) / palavras.length
  return {
    id,
    trechos: [{ fraseId: 'f01', offset: 0, duracao: dur, hashTexto: hashDoTexto(TEXTO), texto: textoFalado(TEXTO) }],
    palavras: palavras.map((texto, i) => ({ texto, start: 0.1 + i * passo, end: 0.1 + (i + 0.9) * passo, fraseId: 'f01' })),
  } satisfies Pick<TakeDaVoz, 'id' | 'trechos' | 'palavras'>
}
function escolha(cands: { c: CandidatoDeCena; palavra: number }[]): EscolhaDaFrase {
  return {
    fraseId: 'f01',
    cenas: cands.map(({ c, palavra }) => ({ candidato: c, palavraInicio: palavra })),
    fita: cands.map(({ c }) => c).slice(0, 6),
    confianca: 0.5,
    travada: false,
    hashTexto: hashDoTexto(TEXTO),
    duracao: 0,
    avisos: [],
  }
}
const cand = (ids: string[], extra: Partial<CandidatoDeCena> = {}): CandidatoDeCena => ({
  ...candidatoDosPlanos(
    ids.map((id) => P.find((p) => p.id === id)!),
    EP,
    'sugestao',
  ),
  ...extra,
})
/** Segundos de imagem que a cena k da escolha encaixada usa (soma dos pedacos de mp4). */
function imagem(e: EscolhaDaFrase, k = 0): number {
  return trechosDoCandidato(e.cenas[k]!.candidato, P).reduce((s, t) => s + (t.ate - t.de), 0)
}
function encaixa(e: EscolhaDaFrase, t: ReturnType<typeof take> | null, f = frase()) {
  return encaixarEscolha(e, { indice, frase: f, take: t })
}

console.log('A. frase mais curta que o plano')
{
  const r = encaixa(escolha([{ c: cand(['0001']), palavra: 0 }]), take(2))
  const c = r.escolha.cenas[0]!.candidato
  confere(perto(c.inSec, 100) && perto(c.outSec, 102) && c.planoIds.join() === '0001', `janela [100, 102] no comeco do plano (veio [${c.inSec}, ${c.outSec}])`)
  confere(r.avisos.length === 0 && r.escolha.avisos.length === 0 && perto(r.escolha.duracao, 2), 'sem aviso, duracao = a do take')
}

console.log('B/C. fala citada')
{
  const r = encaixa(escolha([{ c: cand(['0001']), palavra: 0 }]), take(2), frase('c0002'))
  const c = r.escolha.cenas[0]!.candidato
  confere(perto(c.inSec, 100.5) && perto(c.outSec, 102.5), `comeca no instante da fala citada (100,5) [${c.inSec}, ${c.outSec}]`)
  const r2 = encaixa(escolha([{ c: cand(['0001']), palavra: 0 }]), take(2), frase('c0001'))
  const c2 = r2.escolha.cenas[0]!.candidato
  confere(
    perto(c2.inSec, 101) && perto(c2.outSec, 103) && c2.inSec <= 101.5 && c2.planoIds.join() === '0001',
    `citada perto do fim: recua so o necessario, a fala continua dentro [${c2.inSec}, ${c2.outSec}]`,
  )
}

console.log('D. frase mais longa: emenda com o plano seguinte')
const dEmenda = encaixa(escolha([{ c: cand(['0001']), palavra: 0 }]), take(4.5))
{
  const c = dEmenda.escolha.cenas[0]!.candidato
  confere(c.planoIds.join() === '0001,0002' && perto(c.inSec, 100) && perto(c.outSec, 104.5), `planos ${c.planoIds.join('+')} [${c.inSec}, ${c.outSec}]`)
  confere(perto(imagem(dEmenda.escolha), 4.5), `imagem = 4,5 s (${imagem(dEmenda.escolha).toFixed(3)})`)
  confere(dEmenda.escolha.avisos.includes(AVISO_CENA_EMENDADA) && dEmenda.avisos.some((a) => a.startsWith('f01: cena emendada')), `aviso: ${dEmenda.avisos.join(' | ')}`)
}

console.log('E. falta pequena nao emenda')
{
  const r = encaixa(escolha([{ c: cand(['0001']), palavra: 0 }]), take(3 + FOLGA_SEM_EMENDA_SEC - 0.05))
  const c = r.escolha.cenas[0]!.candidato
  confere(c.planoIds.join() === '0001' && perto(c.inSec, 100) && perto(c.outSec, 103) && r.avisos.length === 0, `fica no plano, segura o ultimo quadro sem aviso [${c.inSec}, ${c.outSec}]`)
}

console.log('F. vao entre planos nao vira imagem')
{
  const r = encaixa(escolha([{ c: cand(['0004']), palavra: 0 }]), take(6))
  const c = r.escolha.cenas[0]!.candidato
  confere(c.planoIds.join() === '0004,0005' && perto(c.outSec, 114), `janela [${c.inSec}, ${c.outSec}] atravessa o vao; ${c.planoIds.join('+')}`)
  confere(perto(imagem(r.escolha), 6), `imagem = 6 s, sem os 2 s do vao (${imagem(r.escolha).toFixed(3)})`)
}

console.log('G. seguinte na ED: emenda com o anterior')
{
  const r = encaixa(escolha([{ c: cand(['0005']), palavra: 0 }]), take(5))
  const c = r.escolha.cenas[0]!.candidato
  confere(c.planoIds.join() === '0004,0005' && perto(c.inSec, 108) && perto(c.outSec, 115), `o 0006 (ED) fica de fora; anterior entra: [${c.inSec}, ${c.outSec}]`)
  confere(perto(imagem(r.escolha), 5), `imagem = 5 s (${imagem(r.escolha).toFixed(3)})`)
}

console.log('H. fim do episodio: cena curta')
{
  const r = encaixa(escolha([{ c: cand(['0007']), palavra: 0 }]), take(5))
  const c = r.escolha.cenas[0]!.candidato
  confere(c.planoIds.join() === '0007' && perto(c.inSec, 260) && perto(c.outSec, 262), `fica no ultimo plano [${c.inSec}, ${c.outSec}]`)
  confere(r.escolha.avisos.includes(AVISO_CENA_CURTA) && r.avisos.some((a) => a.includes('falta 3,0s')), `aviso: ${r.avisos.join(' | ')}`)
}

console.log('I. idempotente')
{
  const outra = encaixa(dEmenda.escolha, take(4.5))
  confere(JSON.stringify(outra.escolha) === JSON.stringify(dEmenda.escolha), 'encaixar de novo com o mesmo take devolve a mesma escolha')
}

console.log('J. take novo: encolhe e cresce a partir do mesmo comeco')
{
  const curta = encaixa(dEmenda.escolha, take(2, 't2'))
  const c = curta.escolha.cenas[0]!.candidato
  confere(c.planoIds.join() === '0001' && perto(c.inSec, 100) && perto(c.outSec, 102) && curta.escolha.avisos.length === 0, `frase regravada mais curta solta a emenda [${c.inSec}, ${c.outSec}]`)
  const longa = encaixa(curta.escolha, take(4.5, 't3'))
  confere(JSON.stringify(longa.escolha.cenas) === JSON.stringify(dEmenda.escolha.cenas), 'mais longa de novo: a mesma emenda de antes')
  const citada = encaixa(escolha([{ c: cand(['0001']), palavra: 0 }]), take(2), frase('c0002'))
  const maior = encaixa(citada.escolha, take(2.4, 't2'), frase('c0002'))
  confere(perto(maior.escolha.cenas[0]!.candidato.inSec, 100.5) && perto(maior.escolha.cenas[0]!.candidato.outSec, 102.9), 'o comeco na fala citada fica; so o fim anda')
}

console.log('K. duas cenas na frase (barrinha)')
{
  const t = take(6)
  const e = escolha([
    { c: cand(['0001']), palavra: 0 },
    { c: cand(['0004']), palavra: 5 },
  ])
  const r = encaixa(e, t)
  const tempos = temposDasCenas(r.escolha, frase(), t)
  const corte = t.palavras[5]!.start
  confere(tempos.length === 2 && perto(tempos[0]!.fim, corte) && perto(tempos[1]!.inicio, corte) && perto(tempos[1]!.fim, 6), `corte no start da palavra 5 (${corte.toFixed(3)} s)`)
  confere(perto(imagem(r.escolha, 0), corte) && perto(imagem(r.escolha, 1), 6 - corte), `cada cena com o seu pedaco: ${imagem(r.escolha, 0).toFixed(3)} + ${imagem(r.escolha, 1).toFixed(3)}`)
  confere(r.escolha.cenas.map((c) => c.palavraInicio).join() === '0,5', 'palavras de inicio mantidas')
}

console.log('L. posto a mao guarda o comeco')
{
  const mao = cand(['0001'], { inSec: 100.2, outSec: 101, origem: 'usuario' })
  const r = encaixa(escolha([{ c: mao, palavra: 0 }]), take(2), frase('c0002'))
  const c = r.escolha.cenas[0]!.candidato
  confere(perto(c.inSec, 100.2) && perto(c.outSec, 102.2) && c.origem === 'usuario', `comeco dele (100,2), nao a fala citada [${c.inSec}, ${c.outSec}]`)
}

console.log('M. sem take: a estimativa')
{
  const r = encaixa(escolha([{ c: cand(['0001']), palavra: 0 }]), null)
  const estimada = palavrasNaFrase(TEXTO) / 2.7
  confere(perto(r.escolha.duracao, estimada) && perto(imagem(r.escolha), estimada), `duracao estimada ${estimada.toFixed(3)} s, imagem ${imagem(r.escolha).toFixed(3)}`)
}

console.log('O. emenda sem relance (pedaco < 0,8 s = o flash do editor)')
{
  // O1: falta 0,4 s -> segura o ultimo quadro em vez de 0,4 s do 0002.
  const r1 = encaixa(escolha([{ c: cand(['0001']), palavra: 0 }]), take(3.4))
  const c1 = r1.escolha.cenas[0]!.candidato
  confere(c1.planoIds.join() === '0001' && perto(c1.inSec, 100) && perto(c1.outSec, 103) && r1.avisos.length === 0, `falta 0,4 s: fica no 0001 e segura [${c1.inSec}, ${c1.outSec}] ${r1.avisos.join(' | ')}`)
  confere(JSON.stringify(encaixa(r1.escolha, take(3.4)).escolha) === JSON.stringify(r1.escolha), 'O1 idempotente')
  // O2: falta 0,6 s -> emenda, mas a janela anda 0,2 s: o 0002 entra com 0,8 s.
  const r2 = encaixa(escolha([{ c: cand(['0001']), palavra: 0 }]), take(3.6))
  const c2 = r2.escolha.cenas[0]!.candidato
  const pedacos2 = trechosDoCandidato(c2, P).map((t) => t.ate - t.de)
  confere(c2.planoIds.join() === '0001,0002' && perto(c2.inSec, 100.2) && perto(c2.outSec, 103.8), `falta 0,6 s: ${c2.planoIds.join('+')} [${c2.inSec.toFixed(3)}, ${c2.outSec.toFixed(3)}]`)
  confere(pedacos2.every((d) => d >= 0.8 - 1e-6) && perto(imagem(r2.escolha), 3.6), `pedacos ${pedacos2.map((d) => d.toFixed(2)).join(' + ')} (nenhum < 0,8 s), imagem 3,6 s`)
  confere(JSON.stringify(encaixa(r2.escolha, take(3.6)).escolha) === JSON.stringify(r2.escolha), 'O2 idempotente')
  // O3: fala citada 0,2 s antes do fim do plano numa frase longa: o relance do comeco sai.
  const r3 = encaixa(escolha([{ c: cand(['0001']), palavra: 0 }]), take(3.5), frase('c0003'))
  const c3 = r3.escolha.cenas[0]!.candidato
  const pedacos3 = trechosDoCandidato(c3, P).map((t) => t.ate - t.de)
  confere(pedacos3.every((d) => d >= 0.8 - 1e-6) && !r3.escolha.avisos.includes(AVISO_CENA_CURTA), `citada no fim do plano: ${c3.planoIds.join('+')} [${c3.inSec.toFixed(3)}, ${c3.outSec.toFixed(3)}] pedacos ${pedacos3.map((d) => d.toFixed(2)).join(' + ')}`)
  confere(JSON.stringify(encaixa(r3.escolha, take(3.5), frase('c0003')).escolha) === JSON.stringify(r3.escolha), 'O3 idempotente')
}

console.log('N. schema e cobertura')
{
  const casos = [dEmenda.escolha, encaixa(escolha([{ c: cand(['0005']), palavra: 0 }]), take(5)).escolha]
  confere(casos.every((e) => escolhaDaFraseSchema.safeParse(e).success), 'as escolhas encaixadas passam no escolhaDaFraseSchema')
  const vazia = encaixa(escolha([]), take(3))
  confere(vazia.escolha.cenas.length === 0 && perto(vazia.escolha.duracao, 3) && vazia.avisos.length === 0, 'escolha sem cena: so a duracao')
  const fora = encaixa(escolha([{ c: { ...cand(['0001']), planoIds: ['9999'] }, palavra: 0 }]), take(2))
  confere(fora.escolha.avisos.includes('Cena fora do episodio'), 'plano que o indice nao conhece: aviso, sem quebrar')
}

console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
process.exitCode = falhas === 0 ? 0 : 1
