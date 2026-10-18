import { conjuntoDe, ignorarGrupo, juntarGrupos, limparNome, nomearGrupo, SIMILARIDADE_FORTE, type DecisaoDaDescoberta, type GrupoDeRostos } from './descoberta'

/**
 * OS ATALHOS DO RECONHECER NA MAO (O1, pedido do Levi em 18/10): nomear os
 * grupos em sequencia sem o mouse. Valem com o foco num CARTAO (o cursor do
 * teclado); no campo do nome, as teclas sao do campo (Enter aceita e volta ao
 * cartao seguinte, Esc volta ao cartao).
 *
 *   1-9      a sugestao de numero N (as do motor: o elenco e os ja batizados)
 *   Enter    confirma: com nome, so anda; sem nome e com palpite forte, aceita
 *            o palpite; sem palpite forte, vai ao campo para digitar
 *   I        ignora (ou volta a considerar) o grupo
 *   J        junta com o grupo de antes (o mesmo personagem)
 *   setas    andam pelos cartoes (cima/baixo: uma linha da grade)
 *   Espaco   ve os rostos do grupo (ampliado)
 *   Tab      vai ao campo do nome
 *   ?        a lista dos atalhos
 *   letra    vai ao campo do nome, ja digitando
 *
 * Funcoes puras: a tela so chama (e o teste confere sem janela).
 */

export type AcaoDoAtalho =
  | { tipo: 'sugestao'; indice: number }
  | { tipo: 'confirmar' }
  | { tipo: 'ignorar' }
  | { tipo: 'juntar' }
  | { tipo: 'andar'; para: 'antes' | 'depois' | 'acima' | 'abaixo' }
  | { tipo: 'ampliar' }
  | { tipo: 'campo' }
  | { tipo: 'digitar' }
  | { tipo: 'ajuda' }

export interface TeclaDoAtalho {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

/** A acao de uma tecla com o foco num cartao. null = a tecla nao e atalho (segue normal). */
export function acaoDaTecla(e: TeclaDoAtalho): AcaoDoAtalho | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null
  const k = e.key
  if (/^[1-9]$/.test(k)) return { tipo: 'sugestao', indice: Number(k) - 1 }
  if (k === 'Enter') return { tipo: 'confirmar' }
  if (k === 'i' || k === 'I') return { tipo: 'ignorar' }
  if (k === 'j' || k === 'J') return { tipo: 'juntar' }
  if (k === 'ArrowLeft') return { tipo: 'andar', para: 'antes' }
  if (k === 'ArrowRight') return { tipo: 'andar', para: 'depois' }
  if (k === 'ArrowUp') return { tipo: 'andar', para: 'acima' }
  if (k === 'ArrowDown') return { tipo: 'andar', para: 'abaixo' }
  if (k === ' ' || k === 'Spacebar') return { tipo: 'ampliar' }
  if (k === 'Tab') return { tipo: 'campo' }
  if (k === '?') return { tipo: 'ajuda' }
  // Uma letra (ou numero/acento fora dos atalhos) comeca o nome.
  if (k.length === 1 && k !== ' ' && /\p{L}/u.test(k)) return { tipo: 'digitar' }
  return null
}

/** O cartao para onde as setas levam. `colunas` = cartoes por linha da grade. null = nao ha. */
export function cartaoVizinho(
  ordem: readonly number[],
  atual: number,
  para: 'antes' | 'depois' | 'acima' | 'abaixo',
  colunas: number,
): number | null {
  const i = ordem.indexOf(atual)
  if (i < 0) return ordem[0] ?? null
  const passo = para === 'antes' ? -1 : para === 'depois' ? 1 : para === 'acima' ? -Math.max(1, colunas) : Math.max(1, colunas)
  const j = i + passo
  if (j < 0 || j >= ordem.length) return null
  return ordem[j] ?? null
}

/** As sugestoes de um grupo na ordem das teclas (as do motor, ou o palpite sozinho). */
export function sugestoesDoGrupo(g: Pick<GrupoDeRostos, 'sugestoes' | 'sugestao'>): { nome: string; similaridade: number }[] {
  if (g.sugestoes.length) return g.sugestoes.slice(0, 9)
  return g.sugestao ? [g.sugestao] : []
}

export interface ResultadoDoAtalho {
  decisao: DecisaoDaDescoberta
  /** Para onde o cursor vai (o proximo cartao). null = fica. */
  proximo: number | null
  /** O campo do nome do grupo atual deve receber o foco (Enter sem palpite forte). */
  campo: boolean
}

/** O proximo cartao SEM nome (e nao ignorado) depois do atual; sem ele, o seguinte; null = acabou. */
export function proximoSemNome(ordem: readonly number[], atual: number, decisao: DecisaoDaDescoberta): number | null {
  const i = ordem.indexOf(atual)
  for (let j = i + 1; j < ordem.length; j++) {
    const k = ordem[j]!
    if (!decisao.ignorados.includes(k) && !limparNome(decisao.nomes[String(k)] ?? '')) return k
  }
  return ordem[i + 1] ?? null
}

/**
 * Aplica um atalho de DECISAO (sugestao, confirmar, ignorar, juntar) ao grupo
 * `atual`. `ordem` = as keys na ordem da tela. As outras acoes (andar,
 * ampliar, campo, digitar, ajuda) sao da tela e nao mudam a decisao.
 */
export function aplicarAtalho(
  acao: AcaoDoAtalho,
  decisao: DecisaoDaDescoberta,
  grupos: ReadonlyMap<number, Pick<GrupoDeRostos, 'key' | 'sugestoes' | 'sugestao' | 'conhecido'>>,
  ordem: readonly number[],
  atual: number,
): ResultadoDoAtalho {
  const g = grupos.get(atual)
  const fica = { decisao, proximo: null, campo: false }
  if (!g) return fica
  if (acao.tipo === 'sugestao') {
    const sug = sugestoesDoGrupo(g)[acao.indice]
    if (!sug) return fica
    const nova = nomearGrupo(decisao, atual, sug.nome)
    return { decisao: nova, proximo: proximoSemNome(ordem, atual, nova), campo: false }
  }
  if (acao.tipo === 'confirmar') {
    const nome = limparNome(decisao.nomes[String(atual)] ?? '')
    if (nome || decisao.ignorados.includes(atual)) return { decisao, proximo: proximoSemNome(ordem, atual, decisao), campo: false }
    const palpite = !g.conhecido && g.sugestao && g.sugestao.similaridade >= SIMILARIDADE_FORTE ? g.sugestao.nome : null
    if (!palpite) return { decisao, proximo: null, campo: true }
    const nova = nomearGrupo(decisao, atual, palpite)
    return { decisao: nova, proximo: proximoSemNome(ordem, atual, nova), campo: false }
  }
  if (acao.tipo === 'ignorar') {
    const ignorado = decisao.ignorados.includes(atual)
    const nova = ignorarGrupo(decisao, atual, !ignorado)
    return { decisao: nova, proximo: ignorado ? null : proximoSemNome(ordem, atual, nova), campo: false }
  }
  if (acao.tipo === 'juntar') {
    const i = ordem.indexOf(atual)
    const antes = i > 0 ? ordem[i - 1] : undefined
    if (antes === undefined) return fica
    // Ja juntos: nada a fazer.
    if (conjuntoDe(decisao, antes)?.includes(atual)) return fica
    const nova = juntarGrupos(decisao, atual, antes)
    return { decisao: nova, proximo: proximoSemNome(ordem, atual, nova), campo: false }
  }
  return fica
}

/** As linhas do "?" (ASCII, pouco texto). */
export const LISTA_DE_ATALHOS: readonly [string, string][] = [
  ['1-9', 'escolhe a sugestao'],
  ['Enter', 'confirma e anda'],
  ['I', 'ignora'],
  ['J', 'junta ao anterior'],
  ['Setas', 'andam'],
  ['Espaco', 've os rostos'],
  ['Tab / letra', 'digita o nome'],
  ['Ctrl+Enter', 'salva tudo'],
  ['Esc', 'fecha'],
]
