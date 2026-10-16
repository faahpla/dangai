import { passoDoRascunho, type RascunhoDoRecap } from '../../shared/roteiro'

/**
 * A ORDEM DO ASSISTENTE "GERAR RECAP" (decisao do Levi, 14/10):
 *
 *   1 Episodio -> 2 Roteiro -> 3 Voz -> 4 Cenas -> abrir no Editor
 *
 * - 1 Episodio: falas e OP/ED saem rapido e o "Proximo: Roteiro" libera logo;
 *   o corte das cenas roda em segundo plano (shared/episodio.ts, corte).
 * - 2 Roteiro: aprovado, leva a Voz. Aprovar ja dispara, de graca e por tras,
 *   as sugestoes de cena (quando os planos existirem).
 * - 3 Voz: aprovada, "Proximo: Cenas".
 * - 4 Cenas: no tempo REAL da voz (take aprovado). Espera o corte se ele ainda
 *   nao acabou, mostrando o andamento. O botao final e "Abrir no editor".
 *
 * Mora aqui so a regra de navegacao, pura (sem store), para o cabecalho, os
 * rodapes e o "voltar onde parou" usarem a mesma. Dono: agente C. O fluxo do
 * passo 1 (analisar, indexar, corte em segundo plano) mora em gerar.ts (agente
 * E); este arquivo nao importa store nenhuma.
 */

export type PassoDoAssistente = 1 | 2 | 3 | 4

export type IdDoPasso = 'episodio' | 'roteiro' | 'voz' | 'cenas'

export const PASSOS: readonly { n: PassoDoAssistente; id: IdDoPasso; nome: string }[] = [
  { n: 1, id: 'episodio', nome: 'Episodio' },
  { n: 2, id: 'roteiro', nome: 'Roteiro' },
  { n: 3, id: 'voz', nome: 'Voz' },
  { n: 4, id: 'cenas', nome: 'Cenas' },
]

/** O que libera cada passo. Cada store calcula o seu pedaco; aqui so se combina. */
export interface CondicoesDosPassos {
  /** podeIrAoRoteiro (gerar.ts): falas lidas, regua salva. NAO espera o corte. */
  episodioPronto: boolean
  /** O roteiro atual esta aprovado (gerar-roteiro.ts). */
  roteiroAprovado: boolean
  /** podeIrParaCenas (shared/voz.ts): voz aprovada e em dia com o roteiro. */
  vozAprovada: boolean
}

/** Da para ir a este passo agora? O 1 sempre; cada um pede o anterior pronto. */
export function passoLiberado(passo: PassoDoAssistente, c: CondicoesDosPassos): boolean {
  switch (passo) {
    case 1:
      return true
    case 2:
      return c.episodioPronto
    case 3:
      return c.episodioPronto && c.roteiroAprovado
    case 4:
      return c.episodioPronto && c.roteiroAprovado && c.vozAprovada
  }
}

/**
 * Onde o "Continuar" reabre o rascunho: no 4 quando a voz esta aprovada e em
 * dia com o roteiro (o mesmo que libera o passo 4); no 3 quando o roteiro
 * aprovado ja tem voz; senao no 2. A regra mora em shared/roteiro.ts
 * (passoDoRascunho) porque a lista de rascunhos do main sai com ela: a linha
 * do "Continuar" e o abrir tem de dizer o mesmo passo.
 */
export function passoAoRestaurar(
  r: Pick<RascunhoDoRecap, 'aprovado' | 'voz' | 'roteiros' | 'atual'>,
): PassoDoAssistente {
  return passoDoRascunho(r)
}

/**
 * Um passo anterior mudou depois do seguinte: o aviso curto do cabecalho
 * (ponto ambar + tooltip). null = em dia. O passo 3 fica velho quando o
 * roteiro mudou depois da voz; o 4, quando as cenas ja foram encaixadas numa
 * voz e ela deixou de estar aprovada (roteiro editado, outro take, regravou)
 * ou o encaixe e de outro take -- ele se refaz sozinho quando a voz volta a
 * ser aprovada. Na primeira passada (cenas sugeridas antes da voz, nunca
 * encaixadas) nao ha aviso: nada mudou.
 */
export function avisoDoPasso(
  passo: PassoDoAssistente,
  c: { vozDesatualizada: boolean; cenasEncaixadas: boolean; vozAprovada: boolean; cenasForaDaVoz: boolean },
): string | null {
  if (passo === 3 && c.vozDesatualizada) return 'Roteiro mudou depois da voz'
  if (passo === 4 && c.cenasEncaixadas && (!c.vozAprovada || c.cenasForaDaVoz)) return 'Roteiro ou voz mudou: as cenas se reajustam'
  return null
}
