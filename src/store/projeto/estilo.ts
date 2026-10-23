import {
  curvaDaEntradaSchema,
  CAPTION_ANIMATION_FRAMES_MAX,
  CAPTION_ANIMATION_FRAMES_MIN,
  CAPTION_STROKE_MAX,
  CAPTION_STROKE_MIN,
  MUSIC_GAIN_DB_MAX,
  MUSIC_GAIN_DB_MIN,
} from '@shared/contract'
import type { GetProjeto, ProjectState, SetProjeto } from '../project'

/** Do store do editor (ver ../project.ts): o estilo da legenda, a musica, os textos do card e o metadata. */
export type FatiaDoEstilo = Pick<ProjectState, 'toggleSfx' | 'setCard' | 'generateMetadata' | 'pickMusic' | 'clearMusic' | 'setMusicGain' | 'refreshSfx' | 'setUpdate' | 'setAppVersion' | 'toggleCaptions' | 'setCaptionColor' | 'refreshFontes' | 'setCaptionFont' | 'openFontesDir' | 'setCaptionAnimation' | 'setCaptionAnimationFrames' | 'setCaptionAnimationCurve' | 'setCaptionMark' | 'setCaptionShadow' | 'setCaptionStroke'>

export const fatiaDoEstilo = (set: SetProjeto, get: GetProjeto): FatiaDoEstilo => ({

  toggleSfx: () => set((state) => ({ sfxEnabled: !state.sfxEnabled })),

  setCard: (qual, patch) => {
    // Um card nao pode ser mais curto que o proprio fade de entrada e saida.
    const segundos = patch.seconds === undefined ? undefined : Math.min(Math.max(patch.seconds, 0.5), 10)
    if (qual === 'hook') {
      set({
        ...(patch.text !== undefined ? { hookText: patch.text } : {}),
        ...(segundos !== undefined ? { hookSec: segundos } : {}),
      })
    } else {
      set({
        ...(patch.text !== undefined ? { endText: patch.text } : {}),
        ...(segundos !== undefined ? { endSec: segundos } : {}),
      })
    }
  },

  /*
   * O roteiro escrito e a melhor fonte; a transcricao serve de plano B.
   *
   * Ler do texto e nao do video e o que mantem a promessa da spec: so o texto
   * sai da maquina, nunca o audio nem as imagens.
   */
  generateMetadata: async () => {
    const { script, transcript } = get()
    const texto = script?.trim() || transcript?.text?.trim() || ''

    if (texto.length < 40) {
      set({ error: 'Cole o roteiro para eu escrever o título e a descrição.' })
      return
    }

    set({ busy: 'Escrevendo título e descrição...', error: null })
    const result = await window.dangai.generateMetadata(texto)

    if (!result.ok) {
      set({ error: result.error, busy: null })
      return
    }
    set({ metadata: result.value, busy: null })
  },

  pickMusic: async () => {
    const result = await window.dangai.pickMusic()
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    // null = fechou o dialogo sem escolher. Nao mexe na faixa que ja havia.
    if (result.value === null) return
    set({ music: result.value })
  },

  clearMusic: () => set({ music: null }),

  setMusicGain: (db) =>
    set({
      musicGainDb: Math.min(Math.max(Math.round(db), MUSIC_GAIN_DB_MIN), MUSIC_GAIN_DB_MAX),
    }),

  refreshSfx: async () => {
    const result = await window.dangai.listSfx()
    if (result.ok) set({ sfxFiles: result.value })
  },

  setUpdate: (status) => set({ update: status }),

  setAppVersion: (version) => set({ appVersion: version }),

  toggleCaptions: () => set((state) => ({ captionsEnabled: !state.captionsEnabled })),

  setCaptionColor: (color) => set({ captionColor: color }),

  refreshFontes: async () => {
    const r = await window.dangai.listFontes()
    if (!r.ok) return
    const fontes = r.value
    /*
     * A fonte escolhida some quando o arquivo some.
     *
     * Ele pode apagar da pasta entre uma sessao e outra. Manter a escolha
     * apontando para um arquivo que nao existe faria o render cair na fonte
     * reserva sem dizer por que.
     */
    const escolhida = get().captionFont
    const aindaExiste = escolhida && fontes.find((f) => f.nome === escolhida.nome)
    set({ fontes, captionFont: aindaExiste ?? null })
  },

  setCaptionFont: (nome) => {
    if (nome === null) {
      set({ captionFont: null })
      return
    }
    const achada = get().fontes.find((f) => f.nome === nome)
    if (achada) set({ captionFont: achada })
  },

  openFontesDir: async () => {
    await window.dangai.openFontesDir()
  },

  setCaptionAnimation: (animation) => set({ captionAnimation: animation }),

  setCaptionAnimationFrames: (frames) =>
    set({
      captionAnimationFrames: Math.min(
        Math.max(Math.round(frames), CAPTION_ANIMATION_FRAMES_MIN),
        CAPTION_ANIMATION_FRAMES_MAX,
      ),
    }),

  setCaptionAnimationCurve: (curva) => {
    /*
     * Ordenada, presa as pontas e conferida pelo schema: o primeiro ponto fica
     * em t = 0 e o ultimo em t = 1 com escala 1 -- a entrada sempre termina no
     * tamanho da legenda, por mais que ele arraste.
     */
    const pts = [...curva].sort((a, b) => a.t - b.t)
    if (pts.length < 2) return
    pts[0] = { ...pts[0]!, t: 0 }
    // A alca de chegada do fim continua dele: e ela que faz o pouso suave.
    pts[pts.length - 1] = { ...pts[pts.length - 1]!, t: 1, v: 1 }
    const ok = curvaDaEntradaSchema.safeParse(pts)
    if (ok.success) set({ captionAnimationCurve: ok.data })
  },

  setCaptionMark: (mark) => set({ captionMark: mark }),

  setCaptionShadow: (patch) =>
    set((state) => ({ captionShadow: { ...state.captionShadow, ...patch } })),

  setCaptionStroke: (px) =>
    set({
      captionStroke: Math.min(Math.max(Math.round(px), CAPTION_STROKE_MIN), CAPTION_STROKE_MAX),
    }),
})
