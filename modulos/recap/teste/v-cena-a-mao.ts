/**
 * [recap] A CENA POSTA A MAO entra como ele escolheu (20/10, Nia S01E03 f01).
 *
 * O Levi clicou no 0217 (0,75 s) em "Perto deste momento" para a 1a cena da
 * f01 (pedaco de 1,4 s) e a cena nao entrava: o encaixe emendava o 0218, e o
 * semRelance (minimo na tela de 1 s) tirava o PRIMEIRO pedaco, o plano dele.
 * Ficava o 0218, e a grade nao marcava o 0217 ("vai pra proxima").
 *
 *   A. a sugestao do casar continua como antes (emenda / relance);
 *   B. o clique (origem 'usuario'): o 0217 fica, sozinho, o fim congela, e o
 *      recado diz "cena curta: 0,8 s para 1,4 s";
 *   C. falta ate 0,5 s congela sem aviso;
 *   D. nunca o plano anterior na frente (fim do episodio / porta da OP/ED);
 *   E. o "completar" (a pedido): emenda o 0218 e o 0217 continua o primeiro;
 *   F. idempotente; a escolha passa no schema;
 *   G. a entrada depois do efeito continua valendo no recuo para caber;
 *   H. o grid: a metade escolhida a mao (em cima ou embaixo) fica a mesma, e
 *      o "Grid" na frase nao troca o 0217 pelo 0218 do "completar";
 *   I. o store: clicar no cartao poe a cena como 'usuario' (o recado, o completar).
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-cena-a-mao.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  candidatoDosPlanos,
  escolhaDaFraseSchema,
  type CandidatoDeCena,
  type EscolhaDaFrase,
} from '../shared/cenas'
import { AVISO_CENA_CURTA, AVISO_CENA_EMENDADA, encaixarEscolha, type ContextoDoEncaixe } from '../shared/encaixe'
import type { Exclusao, Plano } from '../shared/episodio'
import { metadeDoCandidato } from '../shared/grid'
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

const EP = `ep_${'e'.repeat(40)}`
function plano(id: string, start: number, end: number): Plano {
  return { id, start, end, arquivo: `C:/fake/${id}.mp4`, keyframe: `C:/fake/${id}_1.jpg`, cueIds: [], falantes: [], personagens: [] }
}
// Os planos de verdade do Nia Liston S01E03 (episodio.json).
const P = [
  plano('0215', 751.251, 756.756),
  plano('0216', 756.756, 762.512),
  plano('0217', 762.512, 763.263), // 0,75 s
  plano('0218', 763.263, 764.889), // 1,63 s
  plano('0219', 764.889, 768.893),
]
const indice: ContextoDoEncaixe['indice'] = { id: EP, planos: P, cues: [], exclusoes: [] }

const TEXTO = 'Mano... essa garotinha invadiu a mafia so pra arrumar briga.'
const frase: ContextoDoEncaixe['frase'] = { id: 'f01', texto: TEXTO, citacaoCueId: null, cueDoMomento: null, eventoIds: [] }
/** Um take de uma frase so, com `dur` segundos e as palavras espalhadas por igual. */
function take(dur: number): NonNullable<ContextoDoEncaixe['take']> {
  const palavras = palavrasDaFrase(TEXTO)
  const passo = dur / palavras.length
  return {
    id: 't1',
    trechos: [{ fraseId: 'f01', offset: 0, duracao: dur, hashTexto: hashDoTexto(TEXTO), texto: textoFalado(TEXTO) }],
    palavras: palavras.map((texto, i) => ({ texto, start: i * passo, end: (i + 0.95) * passo, fraseId: 'f01' })),
  } satisfies Pick<TakeDaVoz, 'id' | 'trechos' | 'palavras'>
}
function escolha(c: CandidatoDeCena, travada = true): EscolhaDaFrase {
  return { fraseId: 'f01', cenas: [{ candidato: c, palavraInicio: 0 }], fita: [c], confianca: 0.5, travada, hashTexto: hashDoTexto(TEXTO), duracao: 0, avisos: [] }
}
const doPlano = (id: string, origem: CandidatoDeCena['origem'], extra: Partial<CandidatoDeCena> = {}): CandidatoDeCena => ({
  ...candidatoDosPlanos([P.find((p) => p.id === id)!], EP, origem),
  ...extra,
})
const encaixa = (e: EscolhaDaFrase, dur: number, extra: Partial<ContextoDoEncaixe> = {}) =>
  encaixarEscolha(e, { indice, frase, take: take(dur), ...extra })

console.log('A. a sugestao do casar: como antes')
{
  const r = encaixa(escolha(doPlano('0217', 'vizinha'), false), 1.425)
  const c = r.escolha.cenas[0]!.candidato
  confere(c.planoIds.join() === '0218', `sem ser a mao, o relance ainda tira o 0217 (ficou ${c.planoIds.join('+')})`)
}

console.log('B. o clique no 0217 (0,75 s) para 1,4 s')
{
  const r = encaixa(escolha(doPlano('0217', 'usuario')), 1.425)
  const c = r.escolha.cenas[0]!.candidato
  confere(c.planoIds.join() === '0217', `a cena e a dele: ${c.planoIds.join('+')}`)
  confere(perto(c.inSec, 762.512) && perto(c.outSec, 763.263), `o plano inteiro, o fim congela [${c.inSec}, ${c.outSec}]`)
  confere(r.escolha.avisos.includes(AVISO_CENA_CURTA) && !r.escolha.avisos.includes(AVISO_CENA_EMENDADA), `aviso Cena curta, sem emenda [${r.escolha.avisos.join(', ')}]`)
  confere(r.avisos.includes('f01: cena curta: 0,8 s para 1,4 s'), `recado claro: ${r.avisos.join(' | ')}`)
  confere(c.origem === 'usuario', 'continua posta a mao')
}

console.log('C. falta ate 0,5 s: congela sem aviso')
{
  const r = encaixa(escolha(doPlano('0217', 'usuario')), 1.2)
  const c = r.escolha.cenas[0]!.candidato
  confere(c.planoIds.join() === '0217' && r.escolha.avisos.length === 0, `0217 sozinho, sem aviso (falta 0,45 s) [${r.escolha.avisos.join(', ')}]`)
}

console.log('D. nunca o anterior na frente')
{
  // O seguinte na OP/ED: a sugestao puxaria o 0216 para a frente; a mao, nao.
  const ED: Exclusao = { start: 763.263, end: 800, motivo: 'ed', origem: 'capitulo', confirmada: true, porque: '' }
  const comEd: ContextoDoEncaixe['indice'] = { ...indice, exclusoes: [ED] }
  const sug = encaixa(escolha(doPlano('0217', 'vizinha'), false), 1.425, { indice: comEd })
  const mao = encaixa(escolha(doPlano('0217', 'usuario')), 1.425, { indice: comEd })
  confere(sug.escolha.cenas[0]!.candidato.planoIds[0] === '0216', `sugestao: o anterior entra (${sug.escolha.cenas[0]!.candidato.planoIds.join('+')})`)
  confere(mao.escolha.cenas[0]!.candidato.planoIds.join() === '0217', `a mao: o 0217 fica sozinho (${mao.escolha.cenas[0]!.candidato.planoIds.join('+')})`)
}

console.log('E. o "completar": emenda o seguinte a pedido')
{
  const pedido = { ...doPlano('0217', 'usuario'), planoIds: ['0217', '0218'], outSec: 763.263 + 1.626 }
  const r = encaixa(escolha(pedido), 1.425)
  const c = r.escolha.cenas[0]!.candidato
  confere(c.planoIds.join('+') === '0217+0218', `0217 primeiro, depois o 0218 (${c.planoIds.join('+')})`)
  confere(perto(c.inSec, 762.512) && perto(c.outSec, 762.512 + 1.425, 1e-3), `cobre o pedaco [${c.inSec}, ${c.outSec}]`)
  confere(r.escolha.avisos.includes(AVISO_CENA_EMENDADA) && !r.escolha.avisos.includes(AVISO_CENA_CURTA), `emendada, sem Cena curta [${r.escolha.avisos.join(', ')}]`)
  // A frase encolheu (outro take): a emenda solta, o plano dele fica.
  const menor = encaixa(r.escolha, 0.6)
  confere(menor.escolha.cenas[0]!.candidato.planoIds.join() === '0217', `take mais curto: so o 0217 (${menor.escolha.cenas[0]!.candidato.planoIds.join('+')})`)
}

console.log('F. idempotente e no schema')
{
  const r1 = encaixa(escolha(doPlano('0217', 'usuario')), 1.425)
  const r2 = encaixa(r1.escolha, 1.425)
  confere(JSON.stringify(r1.escolha) === JSON.stringify(r2.escolha), 'encaixar de novo devolve a mesma escolha')
  confere(escolhaDaFraseSchema.safeParse(r1.escolha).success, 'passa no schema')
}

console.log('G. a entrada depois do efeito continua no recuo')
{
  // 0218 com 0,3 s de clarao: o cartao da grade ja vem com o inSec na entrada.
  const entradas = new Map([['0218', 763.563]])
  const r = encaixa(escolha(doPlano('0218', 'usuario', { inSec: 763.563 })), 1.4, { entradas })
  const c = r.escolha.cenas[0]!.candidato
  confere(c.inSec >= 763.563 - 1e-6 && c.planoIds.join() === '0218', `nao recua para dentro do clarao (${c.inSec})`)
  // Ele arrastou o comeco para antes da entrada: o comeco e dele.
  const r2 = encaixa(escolha(doPlano('0218', 'usuario', { inSec: 763.3 })), 1.0, { entradas })
  confere(perto(r2.escolha.cenas[0]!.candidato.inSec, 763.3), `o comeco que ele escolheu vale (${r2.escolha.cenas[0]!.candidato.inSec})`)
}

console.log('H. o grid: a metade escolhida a mao fica')
{
  const cima = doPlano('0219', 'usuario')
  const baixo = doPlano('0217', 'usuario')
  const e: EscolhaDaFrase = { ...escolha(cima), cenas: [{ candidato: cima, palavraInicio: 0, baixo }], grid: { origem: 'mao', antes: [] } }
  const r = encaixa(e, 1.425)
  const cena = r.escolha.cenas[0]!
  confere(cena.candidato.planoIds.join() === '0219' && cena.baixo?.planoIds.join() === '0217', `cima 0219, baixo 0217 (${cena.candidato.planoIds.join('+')} / ${cena.baixo?.planoIds.join('+')})`)
  confere(r.escolha.avisos.includes(AVISO_CENA_CURTA), 'a metade curta avisa, nao troca')
  const invertido: EscolhaDaFrase = { ...e, cenas: [{ candidato: baixo, palavraInicio: 0, baixo: cima }] }
  const r2 = encaixa(invertido, 1.425)
  confere(r2.escolha.cenas[0]!.candidato.planoIds.join() === '0217', 'em cima tambem fica')
  // O "Grid" da frase: a metade da cena dele e o plano dele, nunca o vizinho emendado.
  const mapa = new Map(P.map((p) => [p.id, p]))
  const span = { ...doPlano('0217', 'usuario'), planoIds: ['0217', '0218'], outSec: 764.889 }
  confere(metadeDoCandidato(span, 1.425, mapa) === null, 'a mao: 0217+0218 nao vira a metade 0218 (sem grid nesta cena)')
  confere(metadeDoCandidato({ ...span, origem: 'sugestao' }, 1.425, mapa)?.planoIds.join() === '0218', 'a sugestao: como antes (0218)')
  confere(metadeDoCandidato(doPlano('0219', 'usuario'), 1.425, mapa)?.planoIds.join() === '0219', 'plano dele que cobre: a metade e ele')
}

console.log('I. o store: o clique e posto a mao')
{
  const fonte = readFileSync(join(__dirname, '..', 'src', 'store', 'gerar-cenas.ts'), 'utf8')
  const trocar = fonte.slice(fonte.indexOf('    trocarCena: (candidato, fraseId) =>'), fonte.indexOf('    adicionarCena: (candidato, fraseId) =>'))
  const adicionar = fonte.slice(fonte.indexOf('    adicionarCena: (candidato, fraseId) =>'), fonte.indexOf('    completarCena: (fraseId, k) =>'))
  confere(/candidato: dele\(candidato\)/.test(trocar) && !/\{ \.\.\.c, candidato \}/.test(trocar), 'trocarCena poe o cartao como usuario')
  confere(/candidato: dele\(candidato\), palavraInicio \}/.test(adicionar), 'adicionarCena (Shift+clique) tambem')
  confere(fonte.includes("'Cena curta: ${") || fonte.includes('`Cena curta: ${'), 'o recado "Cena curta: ..." no rodape')
}

console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
process.exitCode = falhas === 0 ? 0 : 1
