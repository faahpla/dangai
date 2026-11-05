import type { AjusteDeCor, SobreposicaoSalva } from '@shared/contract'

/**
 * [thumb] A COR DO PROJETO (05/11, "puxar a cc que ja ta no adjustment
 * layer"): a camada de ajuste do projeto aberto. A da Edicao rapida (o
 * `papel: 'cor'` em `modulos.recap`) ganha; senao, a camada de ajuste com cor
 * que fica mais tempo no video. null = o projeto nao tem camada de ajuste com
 * cor. Puro: o teste chama direto.
 */
export function corDaCamadaDeAjuste(
  sobreposicoes: readonly Pick<SobreposicaoSalva, 'tipo' | 'cor' | 'usarSec' | 'durationSec' | 'inicioSec' | 'modulos'>[] | null | undefined,
): AjusteDeCor | null {
  const comCor = (sobreposicoes ?? []).filter((o) => o.tipo === 'ajuste' && o.cor)
  if (comCor.length === 0) return null
  const daEdicao = comCor.find((o) => {
    const recap = o.modulos?.['recap']
    return !!recap && typeof recap === 'object' && (recap as Record<string, unknown>)['papel'] === 'cor'
  })
  if (daEdicao?.cor) return daEdicao.cor
  const tempo = (o: (typeof comCor)[number]): number => o.usarSec ?? o.durationSec - o.inicioSec
  return [...comCor].sort((a, b) => tempo(b) - tempo(a))[0]!.cor ?? null
}
