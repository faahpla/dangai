import { Loader2 } from 'lucide-react'
import { useEdicaoRapida } from '../store/edicao-rapida'
import { AnaliseNaBarra } from './AnaliseNaBarra'

/**
 * [recap] O item do modulo na barra de status: o que a Edicao rapida esta
 * fazendo (ela leva alguns segundos: sons medidos, rostos, recortes) e, com o
 * assistente fechado, a analise, o roteiro e o corte das cenas por tras
 * (AnaliseNaBarra, parte 4). Nada rodando, nada aparece.
 */
export function NaBarraDeStatus() {
  const rodando = useEdicaoRapida((s) => s.rodando)
  return (
    <>
      <AnaliseNaBarra />
      {rodando && (
        <span className="flex items-center gap-1.5 text-ink-2">
          <Loader2 size={11} strokeWidth={1.5} className="animate-spin" />
          {rodando === 'musica' ? 'Musica...' : 'Edicao rapida...'}
        </span>
      )}
    </>
  )
}
