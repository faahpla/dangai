import { dividirEmFrases, type FraseDaIa, type RoteiroDaIa, type SecaoDaIa } from '../../shared/roteiro'

/**
 * UMA frase por item do roteiro.
 *
 * A regra do Dangai: o ponto final encerra a frase e a cena. O prompt pede um
 * item por frase, mas o modelo as vezes devolve "Sera que da? O plano final
 * comecou." num item so (visto no S04E24, 13/10/2026). Deixar assim faria a
 * parte 4 cortar duas cenas com a mesma intencao visual e o mesmo momento; o
 * conserto e aqui, sem gastar outra chamada.
 *
 * A divisao mora em shared/roteiro.ts (dividirEmFrases): a tela usa a mesma
 * regra para avisar quando uma EDICAO junta duas frases num item. Cada pedaco
 * herda os eventos, o momento e a intencao visual; o texto de tela e a
 * citacao ficam no primeiro pedaco.
 */

export { dividirEmFrases }

function dividirFrase(f: FraseDaIa): FraseDaIa[] {
  const partes = dividirEmFrases(f.texto)
  if (partes.length <= 1) return [f]
  return partes.map((texto, i) => ({
    ...f,
    texto,
    textoDeTela: i === 0 ? f.textoDeTela : null,
    citacaoCueId: i === 0 ? f.citacaoCueId : null,
  }))
}

export function umaFrasePorItem(bruto: RoteiroDaIa): RoteiroDaIa {
  return { secoes: bruto.secoes.map((s) => ({ ...s, frases: s.frases.flatMap(dividirFrase) })) }
}

export function umaFrasePorItemDaSecao(bruto: SecaoDaIa): SecaoDaIa {
  return { frases: bruto.frases.flatMap(dividirFrase) }
}
