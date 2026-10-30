import { useEffect, useMemo, useState } from 'react'
import type { ScriptBlock } from '@shared/channels'
import { consultasDosTrechos } from '@shared/visao'

/**
 * O quanto cada cena lida parece com cada trecho do roteiro (shared/visao.ts).
 *
 * A comparacao roda no Ollama, entao chega depois: ate la (e sem cenas lidas,
 * ou sem o comparador baixado) sai undefined, e as sugestoes seguem como eram.
 * Refaz quando muda o roteiro ou o conjunto de cenas lidas -- nao a cada clique.
 */
export function useVisaoDosTrechos(
  blocos: readonly ScriptBlock[] | null,
  /** As cenas JA LIDAS que podem entrar (as da serie do roteiro). */
  ids: readonly string[],
): (Record<string, number> | null)[] | undefined {
  const consultas = useMemo(() => (blocos ? consultasDosTrechos(blocos) : []), [blocos])
  // Ids em ordem de biblioteca: o tamanho e as pontas bastam para saber se mudou.
  const chave = `${consultas.join('\n')}|${ids.length}|${ids[0] ?? ''}|${ids[ids.length - 1] ?? ''}`
  const [pronto, setPronto] = useState<{ chave: string; notas: Record<string, number>[] } | null>(null)

  useEffect(() => {
    if (consultas.length === 0 || ids.length === 0) return
    let vivo = true
    void window.dangai.compararCenas(consultas, ids).then((r) => {
      if (vivo && r.ok) setPronto({ chave, notas: r.value })
    })
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a chave resume consultas e ids
  }, [chave])

  return pronto?.chave === chave ? pronto.notas : undefined
}
