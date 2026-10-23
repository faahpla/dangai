import { regrasDaLegendaSchema } from '@shared/contract'
import { buildCaptions, cutCandidatesFrom } from '@shared/plan'
import type { CaptionBlock } from '@shared/contract'
import { retemporizar } from '@shared/legendas'
import type { GetProjeto, ProjectState, SetProjeto } from '../project'
import { palavrasDasLegendas } from './apoio'

/** Do store do editor (ver ../project.ts): o roteiro e as legendas. */
export type FatiaDasLegendas = Pick<ProjectState, 'setScript' | 'openScript' | 'openCaptions' | 'mergeCaptions' | 'splitCaption' | 'editCaptionWord' | 'editCaptionText' | 'resetCaptions' | 'setCaptionRules' | 'ressincronizarLegendas'>

export const fatiaDasLegendas = (set: SetProjeto, get: GetProjeto): FatiaDasLegendas => ({

  setScript: async (script) => {
    const clean = script?.trim() ? script : null
    // Roteiro novo refaz as legendas do zero: manter as antigas seria misturar
    // texto de duas fontes.
    set({ script: clean, captionsEdited: false, scriptNote: null })
    await get().analyze()
  },

  openScript: (open) => set({ scriptOpen: open }),

  openCaptions: (open) => set(open ? { captionsOpen: true, binsOpen: false } : { captionsOpen: false }),

  /**
   * Junta blocos vizinhos. O bloco resultante vai do inicio do primeiro ao fim
   * do ultimo e carrega todas as palavras, cada uma com o proprio tempo -- o
   * realce palavra a palavra continua funcionando depois da mesclagem.
   */
  mergeCaptions: (indices) => {
    const ordered = [...new Set(indices)].sort((a, b) => a - b)
    if (ordered.length < 2) return

    const { captions } = get()
    const first = ordered[0]!
    const last = ordered.at(-1)!
    if (first < 0 || last >= captions.length) return
    // Mesclar blocos separados deixaria um buraco de tempo dentro do bloco.
    if (last - first + 1 !== ordered.length) return

    const group = captions.slice(first, last + 1)
    const merged: CaptionBlock = {
      from: group[0]!.from,
      durationInFrames: Math.max(
        group.at(-1)!.from + group.at(-1)!.durationInFrames - group[0]!.from,
        1,
      ),
      words: group.flatMap((block) => block.words),
    }

    set({
      captions: [...captions.slice(0, first), merged, ...captions.slice(last + 1)],
      captionsEdited: true,
    })
  },

  /**
   * Quebra um bloco em dois, com a palavra indicada abrindo o segundo. Os
   * tempos vem das proprias palavras, entao nenhuma legenda passa a aparecer
   * fora do momento em que e dita.
   */
  splitCaption: (index, wordIndex) => {
    const { captions } = get()
    const block = captions[index]
    if (!block) return
    if (wordIndex <= 0 || wordIndex >= block.words.length) return

    const head = block.words.slice(0, wordIndex)
    const tail = block.words.slice(wordIndex)
    const cut = tail[0]!.from

    const first: CaptionBlock = {
      from: block.from,
      durationInFrames: Math.max(cut - block.from, 1),
      words: head,
    }
    const second: CaptionBlock = {
      from: cut,
      durationInFrames: Math.max(block.from + block.durationInFrames - cut, 1),
      words: tail,
    }

    set({
      captions: [...captions.slice(0, index), first, second, ...captions.slice(index + 1)],
      captionsEdited: true,
    })
  },

  editCaptionWord: (index, wordIndex, text) => {
    const { captions } = get()
    const block = captions[index]
    if (!block || !block.words[wordIndex]) return

    const words = block.words.map((word, i) => (i === wordIndex ? { ...word, text } : word))
    set({
      captions: captions.map((item, i) => (i === index ? { ...item, words } : item)),
      captionsEdited: true,
    })
  },

  editCaptionText: (index, text) => {
    const { captions } = get()
    const block = captions[index]
    const tokens = text.trim().split(/\s+/).filter((t) => t.length > 0)
    if (!block || tokens.length === 0) return

    /*
     * Mesmo numero de palavras: so o texto muda, cada palavra no seu tempo.
     * Numero diferente: nao ha como saber qual palavra nova e qual velha, e o
     * tempo do bloco e repartido pelo tamanho de cada uma -- a mesma conta do
     * dividir do LegendAI. O bloco nao sai do lugar em nenhum dos casos.
     */
    let words: CaptionBlock['words']
    if (tokens.length === block.words.length) {
      words = block.words.map((w, i) => ({ ...w, text: tokens[i]! }))
    } else {
      const pesos = tokens.map((t) => Math.max(t.length, 1))
      const soma = pesos.reduce((a, b) => a + b, 0)
      const fim = block.from + block.durationInFrames
      let cursor = block.from
      let acumulado = 0
      words = tokens.map((t, i) => {
        acumulado += pesos[i]!
        const ate = i === tokens.length - 1 ? fim : Math.round(block.from + (block.durationInFrames * acumulado) / soma)
        const from = Math.min(cursor, fim - 1)
        const to = Math.max(Math.min(ate, fim), from + 1)
        cursor = to
        return { text: t, from, durationInFrames: to - from }
      })
    }
    set({
      captions: captions.map((item, i) => (i === index ? { ...item, words } : item)),
      captionsEdited: true,
    })
  },

  resetCaptions: () => {
    set({ captions: buildCaptions(get().transcript, get().captionRules), captionsEdited: false })
  },

  setCaptionRules: (patch) => {
    const parsed = regrasDaLegendaSchema.safeParse({ ...get().captionRules, ...patch })
    if (!parsed.success) return
    const regras = parsed.data
    const { transcript, captions, captionsEdited } = get()
    /*
     * Legenda editada NAO e refeita: mesclar e dividir sao decisoes dele. Ela
     * so ganha os tempos pelas regras novas -- adiantar, fechar vaos, duracao.
     */
    const novas = !captionsEdited
      ? buildCaptions(transcript, regras)
      : retemporizar(captions, palavrasDasLegendas(captions, transcript), regras)
    set({ captionRules: regras, captions: novas })
  },

  ressincronizarLegendas: async () => {
    const { audio, transcript } = get()
    if (!audio || !transcript || transcript.words.length === 0) return
    set({ busy: 'Sincronizando as legendas com a narração...', error: null })
    const r = await window.dangai.sincronizarLegendas(
      audio.path,
      transcript.words.map((w) => w.text),
    )
    if (!r.ok) {
      set({ busy: null, error: `Não deu para sincronizar: ${r.error}` })
      return
    }
    // O mesmo limite do LegendAI: abaixo disto o texto nao e o que se ouve.
    if (r.value.score < 0.35) {
      set({
        busy: null,
        error: 'A sincronia não reconheceu o texto na narração. Confira se o roteiro e deste áudio.',
      })
      return
    }
    const words = transcript.words.map((w, i) => ({
      ...w,
      start: r.value.tempos[i]!.start,
      end: Math.max(r.value.tempos[i]!.end, r.value.tempos[i]!.start),
    }))
    const novo = {
      ...transcript,
      words,
      cutCandidates: cutCandidatesFrom(words, transcript.segments),
      alinhado: true,
    }
    const { captions, captionsEdited, captionRules } = get()
    set({
      transcript: novo,
      captions: captionsEdited
        ? retemporizar(captions, palavrasDasLegendas(captions, novo), captionRules)
        : buildCaptions(novo, captionRules),
      busy: null,
      projectDirty: true,
    })
  },
})
