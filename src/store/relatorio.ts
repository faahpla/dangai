import { create } from 'zustand'
import { useProject } from './project'

/** "Relatorio copiado" na barra de baixo, por uns segundos depois de copiar. */
export const useRelatorioCopiado = create<{ copiado: boolean }>(() => ({ copiado: false }))
let apagar: ReturnType<typeof setTimeout> | null = null

/**
 * COPIAR RELATORIO: o que esta na tela agora, para o relatorio que o main monta
 * (versao, maquina, fim do registro). Vai o FORMATO do projeto -- quantos
 * blocos, quanto dura, o que tem nas faixas --, nunca o texto do roteiro.
 */
export async function copiarRelatorio(): Promise<boolean> {
  const s = useProject.getState()
  const tela: Record<string, string> = {}
  if (s.error) tela['erro'] = s.error
  if (s.busy) tela['fazendo'] = s.busy
  if (s.render) tela['render'] = `${Math.round(s.render.progress * 100)}% ${s.render.message ?? ''}`.trim()
  if (s.audio) {
    const seg = Math.round(s.audio.durationSec)
    tela['projeto'] = [
      `${s.plan?.scenes.length ?? 0} blocos`,
      `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`,
      `${s.images.length} cenas`,
      `roteiro ${s.script ? 'sim' : 'nao'}`,
      `formato ${s.formato}`,
      `faixa de video ${s.sobreposicoes.length}`,
      `faixas de audio ${s.trilhas.length}`,
      ...(s.transcriptTravado ? ['tempos travados'] : []),
    ].join(', ')
  } else {
    tela['projeto'] = 'nenhum aberto'
  }
  const r = await window.dangai.copiarRelatorio(tela)
  if (r.ok) {
    useRelatorioCopiado.setState({ copiado: true })
    if (apagar) clearTimeout(apagar)
    apagar = setTimeout(() => useRelatorioCopiado.setState({ copiado: false }), 5000)
  }
  return r.ok
}
