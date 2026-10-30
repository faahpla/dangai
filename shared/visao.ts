import type { SceneDescription } from './channels'

/**
 * Achar a cena CERTA dentro do episodio (o passo 3 do B-roll).
 *
 * O B-roll acerta o episodio, mas um episodio tem 400 a 800 cenas, e o AnCut
 * so sabe quem aparece em um quarto delas (medido no episodio 50 do Bleach: 118
 * de 403). O leitor de cenas (electron/services/describe.ts) escreve o que cada
 * uma mostra numa frase; aqui ficam as pecas puras de casar essa frase com o
 * roteiro. Quem compara de verdade e um modelo de vetores no Ollama
 * (electron/services/visao.ts): "Rukia e Renji se casaram" e "casal em trajes
 * de casamento" nao dividem palavra nenhuma, e e exatamente o par que importa.
 */

/** O texto de uma cena lida que vira vetor: a frase e os campos curtos. */
export function textoDaCena(d: SceneDescription): string {
  return [d.cena, d.acao, d.cenario, d.emocao].filter(Boolean).join('. ')
}

/**
 * A consulta de cada trecho: o PROPRIO trecho, e nao a frase inteira dele.
 *
 * Parecia que "Seis meses depois," sozinho pediria pouco e a frase inteira
 * pediria mais. Medido nos dois videos do Bleach (scripts/teste/medir-visao.ts),
 * e o contrario: com a frase inteira, os trechos de uma frase longa disputam a
 * mesma cena; com o trecho, cada um acha a sua -- a cena dele (ou uma do mesmo
 * momento) nas 12 primeiras sugestoes foi de 35% para 46%.
 */
export function consultasDosTrechos(blocos: readonly { text: string }[]): string[] {
  return blocos.map((b) => b.text.trim())
}

/**
 * As notas que contam: so a cena que se DESTACA da media para a consulta.
 *
 * A semelhanca crua de vetores fica espremida (quase tudo entre 0,3 e 0,6), e o
 * que separa a cena certa e quantos desvios ela fica acima das outras. Abaixo de
 * um desvio e ruido -- ir para a selecao so engordaria a mensagem.
 */
export const DESTAQUE_MINIMO = 1

export function notasDeDestaque(semelhancas: ReadonlyMap<string, number>): Record<string, number> {
  const valores = [...semelhancas.values()]
  if (valores.length < 2) return {}
  const media = valores.reduce((a, b) => a + b, 0) / valores.length
  const desvio = Math.sqrt(valores.reduce((a, b) => a + (b - media) ** 2, 0) / valores.length)
  if (desvio === 0) return {}
  const saida: Record<string, number> = {}
  for (const [id, s] of semelhancas) {
    const z = (s - media) / desvio
    if (z >= DESTAQUE_MINIMO) saida[id] = Math.round(z * 100) / 100
  }
  return saida
}

export function cosseno(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0
  let na = 0
  let nb = 0
  for (let k = 0; k < a.length; k++) {
    s += a[k]! * b[k]!
    na += a[k]! * a[k]!
    nb += b[k]! * b[k]!
  }
  return na === 0 || nb === 0 ? 0 : s / Math.sqrt(na * nb)
}

/**
 * Segundos por cena no leitor (Qwen3-VL 8B numa RTX 3060, medido em 10/2026).
 * So para a estimativa antes de comecar; lendo, o relogio e o de verdade.
 */
export const SEGUNDOS_POR_CENA = 3.3

/** "1h 20min", "35 min", "menos de 1 min". */
export function duracaoLegivel(ms: number): string {
  const min = Math.ceil(ms / 60000)
  if (min <= 1) return 'menos de 1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const resto = min % 60
  return resto > 0 ? `${h}h ${resto}min` : `${h}h`
}

/** Quanto leva ler tantas cenas, antes de comecar. */
export function tempoDeLeitura(cenas: number): string {
  return duracaoLegivel(cenas * SEGUNDOS_POR_CENA * 1000)
}
