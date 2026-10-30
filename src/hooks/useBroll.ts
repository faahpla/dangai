import { useMemo } from 'react'
import { lerBroll, resolverTemporadas, type ItemDoBroll, type PreferenciaDoBroll } from '@shared/broll'
import { buildScriptIndex } from '@shared/script-reader'
import { brollDosTrechos } from '@shared/suggest'
import { useProject } from '@/store/project'

/**
 * Os itens do B-roll do projeto, lidos uma vez por texto. Vazio sem B-roll.
 *
 * Com a biblioteca aberta, "Episodio 4" sem temporada ja vem com a temporada de
 * quem o B-roll cita (resolverTemporadas) -- a mesma conta da montagem.
 */
export function useItensDoBroll(): ItemDoBroll[] {
  const texto = useProject((s) => s.broll?.texto ?? null)
  const library = useProject((s) => s.library)
  const apelidos = useProject((s) => s.nicknames)
  return useMemo(() => {
    if (!texto) return []
    const itens = lerBroll(texto)
    if (!library) return itens
    return resolverTemporadas(itens, library.clips, [], buildScriptIndex(library.characters, Object.values(apelidos).flat()))
  }, [texto, library, apelidos])
}

/**
 * O que o B-roll pede para cada trecho do roteiro, na ordem dos trechos.
 *
 * O mesmo casamento que as sugestoes usam (shared/suggest.ts) -- a coluna do
 * roteiro mostra o episodio de cada frase, e ele tem que ser o mesmo que puxa
 * as cenas, senao a tela diria uma coisa e a sugestao faria outra.
 */
export function useBrollDosTrechos(): (PreferenciaDoBroll | null)[] {
  const itens = useItensDoBroll()
  const blocos = useProject((s) => s.scriptBlocks)
  const personagens = useProject((s) => s.library?.characters)
  const apelidos = useProject((s) => s.nicknames)
  return useMemo(() => {
    if (!blocos || itens.length === 0) return []
    return brollDosTrechos({
      blocks: blocos,
      clips: [],
      characters: personagens ?? [],
      nicknames: Object.values(apelidos).flat(),
      descriptions: {},
      broll: itens,
    })
  }, [blocos, itens, personagens, apelidos])
}
