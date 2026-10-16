import type { Redivisao } from './roteiro'

/**
 * [recap] O passo 4 (Cenas) chega na parte 4 do modulo; ate la o rascunho
 * guarda `cenas` como veio (ver roteiro.ts). Isto e so o que o "Meu roteiro"
 * (religar.ts) precisa: depois de re-dividir o texto, so ficam as escolhas de
 * cena das frases mantidas -- a frase nova nao herda a cena de outra.
 *
 * A versao do Studio tambem normaliza os cortes de cada escolha
 * (normalizarCortes); ela volta com o resto do passo 4.
 */
export function cenasDepoisDaRedivisao(cenas: unknown, redivisao: Pick<Redivisao, 'frases'>): unknown {
  if (!cenas || typeof cenas !== 'object') return null
  const escolhas = (cenas as { escolhas?: unknown }).escolhas
  if (!Array.isArray(escolhas)) return cenas
  const mantidas = new Set(redivisao.frases.filter((f) => f.destino !== 'nova').map((f) => f.id))
  return {
    ...cenas,
    escolhas: escolhas.filter(
      (e: unknown) => !!e && typeof e === 'object' && mantidas.has(String((e as { fraseId?: unknown }).fraseId)),
    ),
  }
}
