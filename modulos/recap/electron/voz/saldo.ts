/**
 * [recap] O SALDO DO ELEVENLABS QUE A TELA MOSTRA, com o que esta sessao ja
 * gastou descontado (teste real do E02, 18/10: gastou 284 creditos e a tela
 * seguia "restam 10.000"). A conta payg dele demora a refletir o gasto no
 * GET /v1/user/subscription; aqui a ultima leitura vira ANCORA e cada chamada
 * paga soma o cobrado nela:
 * - leitura nova MENOR ou igual ao esperado (ancora - gasto): a conta ja
 *   refletiu (ou gastou fora do app): vira a ancora nova, gasto zerado;
 * - leitura MAIOR que o esperado (a conta ainda nao refletiu): vale o esperado.
 * So memoria do main: reabrir o app volta a confiar na conta.
 */

let ancora: { restam: number; gasto: number } | null = null

/** Soma o que uma chamada paga cobrou (character-cost, ou a conta conservadora). */
export function registrarGastoEleven(creditos: number): void {
  if (!ancora || !Number.isFinite(creditos) || creditos <= 0) return
  ancora = { ...ancora, gasto: ancora.gasto + creditos }
}

/** O "restam" para a tela, a partir do que a conta acabou de dizer. */
export function restamDescontado(lido: number): number {
  const esperado = ancora ? ancora.restam - ancora.gasto : Number.POSITIVE_INFINITY
  if (!ancora || lido <= esperado) {
    ancora = { restam: lido, gasto: 0 }
    return lido
  }
  return Math.max(0, Math.round(esperado))
}

/** Os testes: esquece a ancora. */
export function esquecerSaldo(): void {
  ancora = null
}
