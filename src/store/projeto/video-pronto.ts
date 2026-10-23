import { planEqualSplit } from '@shared/plan'
import type { GetProjeto, ProjectState, SetProjeto } from '../project'

/** Do store do editor (ver ../project.ts): legendar e melhorar um video ja pronto. */
export type FatiaDoVideoPronto = Pick<ProjectState, 'legendarVideoPronto' | 'melhorarVideoPronto' | 'cancelarVideoPronto' | 'setVideoProntoProgresso'>

export const fatiaDoVideoPronto = (set: SetProjeto, get: GetProjeto): FatiaDoVideoPronto => ({

  /*
   * O VIDEO PRONTO: "importar um video pronto so pra fazer a legenda ou algum
   * ajuste como corte e etc".
   *
   * O mesmo arquivo entra duas vezes: como NARRACAO (o audio dele, que manda
   * no tempo, e de onde o Whisper tira as legendas) e como o clipe de UM bloco
   * do comeco ao fim, sem movimento. Como o bloco toca o clipe desde o zero, o
   * que se ve continua batendo com o que se ouve. Cortar (C) parte o bloco e a
   * segunda metade continua de onde a primeira parou -- dai cada pedaco ganha
   * zoom, transicao, cor, SFX como qualquer bloco. O formato segue o video:
   * deitado abre como Long form, em pe como Short.
   */
  legendarVideoPronto: async (caminhoDado, roteiroDado) => {
    let caminho = caminhoDado ?? null
    let roteiro = roteiroDado ?? null
    if (!caminho) {
      const escolha = await window.dangai.escolherVideo()
      if (!escolha.ok) {
        set({ error: escolha.error })
        return
      }
      caminho = escolha.value?.video ?? null
      roteiro = escolha.value?.roteiro ?? null
    }
    if (!caminho) return

    set({ busy: 'Lendo o vídeo...', error: null })
    const sonda = await window.dangai.sondarVideo(caminho)
    if (!sonda.ok) {
      set({ busy: null, error: sonda.error })
      return
    }
    if (!sonda.value.temAudio) {
      set({ busy: null, error: 'Esse vídeo não tem áudio: não há fala para legendar nem para mandar no tempo.' })
      return
    }

    // Antes de importar: o recorte do clipe sai no quadro do formato.
    await get().definirFormato(sonda.value.width > sonda.value.height ? 'long' : 'short')

    set({ busy: 'Preparando o vídeo...' })
    const importado = await window.dangai.importImages([caminho])
    if (!importado.ok || importado.value.length === 0) {
      set({ busy: null, error: importado.ok ? 'Não deu para abrir esse vídeo.' : importado.error })
      return
    }

    set({ busy: 'Lendo o áudio do vídeo...' })
    const audio = await window.dangai.analyzeAudio(caminho)
    if (!audio.ok) {
      set({ busy: null, error: audio.error })
      return
    }

    const duracao = audio.value.durationSec
    const plano = planEqualSplit(1, duracao)
    set({
      images: importado.value,
      audio: audio.value,
      playhead: 0,
      // Legenda ligada mesmo no Long form: e para isso que ele trouxe o video.
      captionsEnabled: true,
      plan: {
        ...plano,
        scenes: plano.scenes.map((cena) => ({
          ...cena,
          effect: 'nenhum' as const,
          sourceStart: 0,
          transitionIn: 'cut' as const,
        })),
      },
      planOrigin: 'equal',
      // Editado: a analise abaixo traz as legendas sem redistribuir o bloco.
      planEdited: true,
      selectedScene: null,
      selecionados: [],
      busy: null,
    })

    /*
     * O ROTEIRO JUNTO: "nao posso enviar o roteiro junto pra ele sincronizar?"
     * Com ele, a regra do app vale aqui tambem -- o texto das legendas vem do
     * roteiro, e o Whisper so da os tempos.
     */
    if (roteiro) {
      const lido = await window.dangai.readScript(roteiro)
      if (lido.ok) set({ script: lido.value, captionsEdited: false, scriptBlocks: null })
      else set({ error: lido.error })
    }
    await get().analyze()
  },

  melhorarVideoPronto: async () => {
    if (get().videoPronto) return
    set({ error: null, videoProntoSaida: null })
    const r = await window.dangai.upscaleVideoPronto()
    set({ videoPronto: null })
    if (!r.ok) {
      set({ error: `O upscale do vídeo falhou: ${r.error}` })
      return
    }
    // null: fechou o dialogo ou cancelou. Nada a dizer.
    if (r.value) set({ videoProntoSaida: r.value })
  },

  cancelarVideoPronto: async () => {
    await window.dangai.cancelarUpscale()
  },

  setVideoProntoProgresso: (p) => set({ videoPronto: p }),
})
