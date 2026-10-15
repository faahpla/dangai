/**
 * AS ESCOLHAS SOBREVIVEM A TROCA DO ROTEIRO.
 *
 * "Arrastei um .txt do roteiro novo para corrigir, e perdi tudo que tinha
 * selecionado." As cenas marcadas moram por INDICE de trecho, e um roteiro
 * novo corta a narracao em outros trechos -- por isso o app zerava tudo.
 *
 * Mas a narracao e a MESMA: o tempo nao mudou. Cada trecho antigo entrega as
 * cenas dele ao trecho novo que mais se sobrepoe a ele no tempo (empate ou
 * nenhuma sobreposicao: o mais perto pelo meio). Dois antigos que caem no
 * mesmo novo somam as cenas, na ordem do video, sem repetir.
 */

export interface Intervalo {
  start: number
  end: number
}

export function remapearEscolhas(
  antigos: readonly Intervalo[],
  escolhas: Readonly<Record<number, readonly string[]>>,
  novos: readonly Intervalo[],
): Record<number, string[]> {
  const saida: Record<number, string[]> = {}
  if (novos.length === 0) return saida
  const indices = Object.keys(escolhas)
    .map(Number)
    .filter((i) => (escolhas[i]?.length ?? 0) > 0 && antigos[i] !== undefined)
    .sort((a, b) => a - b)
  for (const i of indices) {
    const velho = antigos[i]!
    let melhor = -1
    let maiorSobra = 0
    for (const [j, novo] of novos.entries()) {
      const sobra = Math.min(velho.end, novo.end) - Math.max(velho.start, novo.start)
      if (sobra > maiorSobra + 1e-6) {
        maiorSobra = sobra
        melhor = j
      }
    }
    if (melhor < 0) {
      // Nenhuma sobreposicao (trecho antigo sem par): o novo mais perto pelo meio.
      const meio = (velho.start + velho.end) / 2
      let dist = Number.POSITIVE_INFINITY
      for (const [j, novo] of novos.entries()) {
        const d = Math.abs((novo.start + novo.end) / 2 - meio)
        if (d < dist) {
          dist = d
          melhor = j
        }
      }
    }
    const lista = (saida[melhor] ??= [])
    for (const caminho of escolhas[i]!) if (!lista.includes(caminho)) lista.push(caminho)
  }
  return saida
}
