import type { PedacoDoTrecho, ScriptBlock } from './channels'

/**
 * Juntar e separar trechos do roteiro.
 *
 * A pontuacao corta onde corta, e as vezes corta curto demais para caber um
 * clipe: "Veldora," sozinho sao 0,3s, e "por exemplo," logo depois mais 0,6s.
 * Pedido dele: "quero uma opcao para juntar frases".
 *
 * A conta mora aqui, fora do store, porque o que ela mexe e tudo INDEXADO POR
 * POSICAO -- as cenas de cada trecho, o peso de cada uma, as unioes de tela
 * dividida, as fronteiras puxadas. Juntar o trecho 12 com o 13 faz o 14 virar
 * 13, o 15 virar 14, e assim ate o fim. Errar um deslocamento aqui manda as
 * cenas que ele marcou para a frase errada, em silencio.
 */

export interface MarcacoesDosTrechos {
  blocos: ScriptBlock[]
  porBloco: Record<number, string[]>
  pesos: Record<number, number[]>
  unioes: Record<number, number[]>
  cortes: Record<number, number[]>
  ativo: number | null
}

/** Os pedacos originais de um trecho: ele mesmo, se nunca foi juntado. */
function pedacosDe(bloco: ScriptBlock): PedacoDoTrecho[] {
  return (
    bloco.partes ?? [{ text: bloco.text, start: bloco.start, end: bloco.end, sentence: bloco.sentence }]
  )
}

/**
 * Desloca as chaves a partir de `desde` por `delta`, e descarta as de `fora`.
 *
 * As chaves chegam como texto (e o que um objeto JS e por dentro), e saem como
 * numero de novo -- o resto do app indexa com numero.
 */
function deslocar<T>(
  registro: Record<number, T>,
  desde: number,
  delta: number,
  fora: ReadonlySet<number>,
): Record<number, T> {
  const saida: Record<number, T> = {}
  for (const [chave, valor] of Object.entries(registro)) {
    const i = Number(chave)
    if (fora.has(i)) continue
    saida[i >= desde ? i + delta : i] = valor as T
  }
  return saida
}

/**
 * Junta o trecho `i` com o seguinte.
 *
 * As CENAS dos dois somam, na ordem do roteiro: as do primeiro, depois as do
 * segundo. Peso, uniao e fronteira puxada morrem nos dois -- sao por POSICAO
 * na fita, e a fita acabou de mudar. E a mesma regra que marcar ou desmarcar
 * uma cena ja segue: sobreviver faria um "2x" escorregar para a cena vizinha.
 *
 * Juntar atravessa frase, de proposito: o fim de uma frase curta com o comeco
 * da proxima e um caso real. O trecho novo fica na frase do primeiro.
 */
export function juntarComOProximo(
  m: MarcacoesDosTrechos,
  i: number,
): MarcacoesDosTrechos | null {
  const a = m.blocos[i]
  const b = m.blocos[i + 1]
  if (!a || !b) return null

  const junto: ScriptBlock = {
    text: `${a.text} ${b.text}`,
    start: a.start,
    end: b.end,
    sentence: a.sentence,
    partes: [...pedacosDe(a), ...pedacosDe(b)],
  }
  const blocos = [...m.blocos.slice(0, i), junto, ...m.blocos.slice(i + 2)]

  const fora = new Set([i, i + 1])
  const porBloco = deslocar(m.porBloco, i + 2, -1, fora)
  const cenas = [...(m.porBloco[i] ?? []), ...(m.porBloco[i + 1] ?? [])]
  if (cenas.length > 0) porBloco[i] = cenas

  const ativo =
    m.ativo === null ? null : m.ativo <= i ? m.ativo : m.ativo === i + 1 ? i : m.ativo - 1

  return {
    blocos,
    porBloco,
    pesos: deslocar(m.pesos, i + 2, -1, fora),
    unioes: deslocar(m.unioes, i + 2, -1, fora),
    cortes: deslocar(m.cortes, i + 2, -1, fora),
    ativo,
  }
}

/**
 * Desfaz a juncao: o trecho `i` volta a ser os pedacos que o formaram.
 *
 * As CENAS VAO TODAS PARA O PRIMEIRO PEDACO. Depois de juntar ele pode ter
 * marcado, tirado e reordenado cenas no trecho unido, e nao ha como saber de
 * qual pedaco cada uma "era". Por inteiro no primeiro, pelo menos nada some:
 * os outros aparecem vazios na coluna, e vazio ja e um estado que a coluna
 * anuncia.
 */
export function separarTrecho(m: MarcacoesDosTrechos, i: number): MarcacoesDosTrechos | null {
  const alvo = m.blocos[i]
  if (!alvo?.partes || alvo.partes.length < 2) return null

  const novos: ScriptBlock[] = alvo.partes.map((p) => ({ ...p }))
  const n = novos.length
  const blocos = [...m.blocos.slice(0, i), ...novos, ...m.blocos.slice(i + 1)]

  const fora = new Set([i])
  const porBloco = deslocar(m.porBloco, i + 1, n - 1, fora)
  const cenas = m.porBloco[i] ?? []
  if (cenas.length > 0) porBloco[i] = cenas

  const ativo = m.ativo === null ? null : m.ativo <= i ? m.ativo : m.ativo + n - 1

  return {
    blocos,
    porBloco,
    pesos: deslocar(m.pesos, i + 1, n - 1, fora),
    unioes: deslocar(m.unioes, i + 1, n - 1, fora),
    cortes: deslocar(m.cortes, i + 1, n - 1, fora),
    ativo,
  }
}
