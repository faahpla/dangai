import type { GetProjeto, ProjectState, SetProjeto } from '../project'

/** Do store do editor (ver ../project.ts): as etapas do video, na barra de cima. */
export type FatiaDasEtapas = Pick<ProjectState, 'irParaEtapa'>

/*
 * AS ETAPAS: Audio -> Roteiro -> Cenas -> Edicao. "Quando terminar de editar o
 * audio quero levar pra proxima etapa... a de arrastar o roteiro para o processo
 * de sincronizacao de legendas... quando terminar de sincronizar com o whisper
 * quero que me leve pra proxima etapa, que vai direto pra biblioteca."
 *
 * Cada etapa e uma tela que ja existe (a de audio, a do roteiro, a Biblioteca,
 * o editor); a barra so diz onde ele esta e leva de uma para outra. Uma de cada
 * vez: abrir uma fecha as outras.
 */
export type Etapa = 'audio' | 'roteiro' | 'cenas' | 'edicao'

/** Em que etapa ele esta agora, pelo que esta aberto na tela. */
export function etapaAtual(s: Pick<ProjectState, 'etapaDoAudio' | 'etapaDoRoteiro' | 'libraryOpen'>): Etapa {
  if (s.etapaDoAudio) return 'audio'
  if (s.etapaDoRoteiro) return 'roteiro'
  if (s.libraryOpen) return 'cenas'
  return 'edicao'
}

export const fatiaDasEtapas = (set: SetProjeto, get: GetProjeto): FatiaDasEtapas => ({
  irParaEtapa: async (etapa) => {
    const s = get()
    if (etapa === 'audio') {
      set({ etapaDoRoteiro: false })
      // Projeto de antes da etapa existir: a edicao comeca na narracao de agora.
      await s.abrirEtapaDoAudio(s.edicaoDeAudio ? undefined : s.audio?.path)
      return
    }
    if (etapa === 'roteiro') {
      set({ etapaDoRoteiro: true, etapaDoAudio: false, libraryOpen: false, replaceTarget: null })
      return
    }
    set({ etapaDoAudio: false, etapaDoRoteiro: false })
    if (etapa === 'cenas') {
      // Com o video ja montado, volta no trecho do bloco escolhido (o "Selecao").
      if (s.images.length > 0 && s.scriptBlocks) await s.voltarParaSelecao()
      else await s.openLibrary(true)
      return
    }
    await s.openLibrary(false)
  },
})
