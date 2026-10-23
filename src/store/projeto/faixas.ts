import { classifyFile } from '@shared/channels'
import {
  duracaoDoTrecho,
  SFX_GAIN_MAX,
  SFX_GAIN_MIN,
  SFX_MINIMO_SEC,
  MOTION_CURVE_DEFAULT,
  AJUSTE_DE_COR_PADRAO,
  MUSIC_FADE_IN_SEC,
  MUSIC_FADE_OUT_SEC,
} from '@shared/contract'
import { buildCaptions } from '@shared/plan'
import { deslocarChaves } from '@shared/transform'
import type { GetProjeto, ProjectState, SetProjeto } from '../project'
import { clipesEscolhidos, ondaDoTrecho, reduzirPicos } from './apoio'

/** Do store do editor (ver ../project.ts): as faixas de video e de audio, os SFX e os clipes. */
export type FatiaDasFaixas = Pick<ProjectState, 'addSfxAt' | 'addTrilhasAt' | 'levarSomParaAudio' | 'moveTrilha' | 'cortarFimDaTrilha' | 'cortarInicioDaTrilha' | 'ajustarTrilha' | 'removeTrilha' | 'refreshTrilhas' | 'addSobreposicoesAt' | 'moveSobreposicao' | 'cortarFimDaSobreposicao' | 'cortarInicioDaSobreposicao' | 'ajustarSobreposicao' | 'removeSobreposicao' | 'refreshSobreposicoes' | 'alternarMudo' | 'selecionarClipe' | 'alternarClipeNaSelecao' | 'definirSelecaoDeClipes' | 'removerClipesEscolhidos' | 'duplicarClipe' | 'clipeCopiado' | 'copiarClipe' | 'colarClipe' | 'removerFaixa' | 'addCamadaDeAjuste' | 'cortarClipeNaAgulha' | 'refazerLegendasNaoEditadas' | 'migrarSonsAntigos' | 'refreshSfxManual' | 'moveSfx' | 'trimSfx' | 'setSfxGain' | 'removeSfx' | 'clearSfxManual'>

export const fatiaDasFaixas = (set: SetProjeto, get: GetProjeto): FatiaDasFaixas => ({

  addSfxAt: async (paths, seconds) => {
    const audios = paths.filter((p) => classifyFile(p) === 'audio')
    if (audios.length === 0) return

    /*
     * Analisa o som para saber quanto ele DURA e como e a onda dele.
     *
     * Sem isso o chip era um retangulo de tamanho fixo, e ele nao tinha como
     * saber onde estava pondo -- palavras dele: "como eu vou saber onde estou
     * pondo se o sfx nao tem waveform". A mesma analise devolve a URL do
     * servidor local, que e o que faz o som TOCAR no preview.
     */
    for (const [i, path] of audios.entries()) {
      const r = await window.dangai.analyzeAudio(path)
      if (!r.ok) {
        set({ error: r.error })
        continue
      }
      set((state) => ({
        sfxManual: [
          ...state.sfxManual,
          {
            id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
            path,
            fileName: r.value.fileName,
            // Soltar dois de uma vez espalha, para nao empilharem no mesmo ponto.
            at: Math.max(0, seconds + i * 0.25),
            durationSec: r.value.durationSec,
            peaks: reduzirPicos(r.value.peaks),
            url: r.value.url,
            usarSec: null,
            gainDb: 0,
          },
        ],
        projectDirty: true,
      }))
    }
  },

  addTrilhasAt: async (paths, seconds, faixa) => {
    // Um video solto na faixa de audio entra pelo SOM dele.
    const audios = paths.filter((p) => classifyFile(p) === 'audio' || classifyFile(p) === 'video')
    let cursor = Math.max(0, seconds)
    for (const [i, path] of audios.entries()) {
      const r = await window.dangai.analyzeAudio(path)
      if (!r.ok) {
        set({ error: r.error })
        continue
      }
      const trecho = {
        id: `trilha-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        path,
        fileName: r.value.fileName,
        faixa,
        at: cursor,
        durationSec: r.value.durationSec,
        inicioSec: 0,
        usarSec: null,
        // Entra em 0 dB, como o arquivo veio: "todo audio importado ta vindo
        // -20 dB". O volume de musica de fundo e um dos atalhos do controle.
        gainDb: 0,
        // Sem fade: "quero eles por padrao, e o fade eu adiciono quando quiser".
        fadeInSec: 0,
        fadeOutSec: 0,
        ...ondaDoTrecho(r.value),
        url: r.value.url,
      }
      // Soltar varios de uma vez enfileira na mesma faixa, um depois do outro.
      cursor += r.value.durationSec
      set((state) => ({ trilhas: [...state.trilhas, trecho], projectDirty: true }))
    }
  },

  levarSomParaAudio: async (path, at, corte) => {
    const r = await window.dangai.analyzeAudio(path)
    if (!r.ok) {
      set({ error: r.error })
      return false
    }
    const inicioSec = corte?.inicioSec ?? 0
    const toca = corte?.usarSec ?? r.value.durationSec - inicioSec
    // A primeira faixa de audio sem nada nesse intervalo.
    const ocupa = get().trilhas
    let faixa = 0
    while (ocupa.some((t) => t.faixa === faixa && at < t.at + duracaoDoTrecho(t) - 1e-3 && at + toca > t.at + 1e-3)) faixa++
    const trecho = {
      id: `trilha-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path,
      fileName: r.value.fileName,
      faixa,
      at,
      durationSec: r.value.durationSec,
      inicioSec,
      usarSec: corte?.usarSec ?? null,
      gainDb: 0,
      fadeInSec: 0,
      fadeOutSec: 0,
      ...ondaDoTrecho(r.value),
      url: r.value.url,
    }
    set((state) => ({
      trilhas: [...state.trilhas, trecho],
      projectDirty: true,
      error: `"${r.value.fileName}" só tem som (a imagem dele e só uma capa): foi para a faixa de áudio A${faixa + 1}.`,
    }))
    return true
  },

  moveTrilha: (id, at, faixa) =>
    set((state) => ({
      trilhas: state.trilhas.map((t) =>
        t.id === id ? { ...t, at: Math.max(0, at), faixa: faixa === undefined ? t.faixa : Math.max(0, faixa) } : t,
      ),
      projectDirty: true,
    })),

  cortarFimDaTrilha: (id, toca) =>
    set((state) => ({
      trilhas: state.trilhas.map((t) => {
        if (t.id !== id) return t
        if (toca === null) return { ...t, usarSec: null }
        const max = t.durationSec - t.inicioSec
        return { ...t, usarSec: Math.min(Math.max(toca, 0.1), max) }
      }),
      projectDirty: true,
    })),

  cortarInicioDaTrilha: (id, at) =>
    set((state) => ({
      trilhas: state.trilhas.map((t) => {
        if (t.id !== id) return t
        /*
         * Puxar a borda ESQUERDA: o fim fica onde estava, e o trecho passa a
         * entrar mais tarde (comendo o comeco do arquivo) ou mais cedo
         * (devolvendo o que tinha sido comido). Nao volta antes do comeco do
         * arquivo nem passa do proprio fim.
         */
        const fim = t.at + duracaoDoTrecho(t)
        const novoAt = Math.min(Math.max(at, t.at - t.inicioSec, 0), fim - 0.1)
        const delta = novoAt - t.at
        return { ...t, at: novoAt, inicioSec: t.inicioSec + delta, usarSec: fim - novoAt }
      }),
      projectDirty: true,
    })),

  ajustarTrilha: (id, patch) =>
    set((state) => ({
      trilhas: state.trilhas.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      projectDirty: true,
    })),

  removeTrilha: (id) =>
    set((state) => ({ trilhas: state.trilhas.filter((t) => t.id !== id), projectDirty: true })),

  refreshTrilhas: async () => {
    const atuais = get().trilhas
    if (atuais.length === 0) return
    const repostos = await Promise.all(
      atuais.map(async (t) => {
        const r = await window.dangai.analyzeAudio(t.path)
        // A onda tambem e refeita: projeto salvo com a onda antiga (120 barras,
        // sem RMS) abre com a nova.
        return r.ok ? { ...t, url: r.value.url, ...ondaDoTrecho(r.value) } : t
      }),
    )
    set({ trilhas: repostos })
  },

  addSobreposicoesAt: async (paths, seconds, faixa) => {
    const visuais = paths.filter((p) => {
      const t = classifyFile(p)
      return t === 'video' || t === 'image'
    })
    let cursor = Math.max(0, seconds)
    for (const [i, path] of visuais.entries()) {
      set({ busy: 'Preparando o vídeo para a faixa...' })
      const r = await window.dangai.prepararSobreposicao(path)
      set({ busy: null })
      if (!r.ok) {
        set({ error: r.error })
        continue
      }
      if (r.value.tipo === 'som') {
        await get().levarSomParaAudio(path, cursor)
        continue
      }
      const imagem = r.value.tipo === 'image'
      const nova = {
        id: `sobre-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        path,
        fileName: path.split(/[\\/]/).pop() ?? path,
        tipo: r.value.tipo,
        faixa,
        at: cursor,
        durationSec: r.value.durationSec,
        inicioSec: 0,
        // Imagem nasce com 3 s na tela; video, inteiro.
        usarSec: imagem ? 3 : null,
        x: 0,
        y: 0,
        escala: 1,
        opacidade: 1,
        aspecto: r.value.aspecto,
        espelhar: false,
        fadeInSec: 0,
        fadeOutSec: 0,
        rotacao: 0,
        efeito: 'nenhum' as const,
        intensidade: 0.1,
        curva: MOTION_CURVE_DEFAULT,
        pontosDaCurva: null,
        url: r.value.url,
      }
      cursor += imagem ? 3 : r.value.durationSec
      set((state) => ({ sobreposicoes: [...state.sobreposicoes, nova], projectDirty: true }))
    }
  },

  moveSobreposicao: (id, at, faixa) =>
    set((state) => ({
      sobreposicoes: state.sobreposicoes.map((o) =>
        o.id === id ? { ...o, at: Math.max(0, at), faixa: faixa === undefined ? o.faixa : Math.max(0, faixa) } : o,
      ),
      projectDirty: true,
    })),

  cortarFimDaSobreposicao: (id, toca) =>
    set((state) => ({
      sobreposicoes: state.sobreposicoes.map((o) => {
        if (o.id !== id) return o
        if (toca === null) return { ...o, usarSec: o.tipo === 'video' ? null : 3 }
        return { ...o, usarSec: Math.min(Math.max(toca, 0.1), o.durationSec - o.inicioSec) }
      }),
      projectDirty: true,
    })),

  cortarInicioDaSobreposicao: (id, at) =>
    set((state) => ({
      sobreposicoes: state.sobreposicoes.map((o) => {
        if (o.id !== id) return o
        const toca = o.usarSec ?? o.durationSec - o.inicioSec
        const fim = o.at + toca
        // Imagem nao tem "comeco do arquivo": a borda esquerda so move a entrada.
        const piso = o.tipo !== 'video' ? 0 : Math.max(o.at - o.inicioSec, 0)
        const novoAt = Math.min(Math.max(at, piso), fim - 0.1)
        const delta = novoAt - o.at
        return {
          ...o,
          at: novoAt,
          inicioSec: o.tipo !== 'video' ? 0 : o.inicioSec + delta,
          usarSec: fim - novoAt,
          // A animacao fica presa a linha do tempo, e nao ao comeco do clipe.
          ...(o.chaves?.length ? { chaves: deslocarChaves(o.chaves, delta, o.curvaDasChaves ?? 'ease-in-out') } : {}),
        }
      }),
      projectDirty: true,
    })),

  ajustarSobreposicao: (id, patch) =>
    set((state) => ({
      sobreposicoes: state.sobreposicoes.map((o) => (o.id === id ? { ...o, ...patch } : o)),
      projectDirty: true,
    })),

  removeSobreposicao: (id) =>
    set((state) => ({ sobreposicoes: state.sobreposicoes.filter((o) => o.id !== id), projectDirty: true })),

  refreshSobreposicoes: async () => {
    const atuais = get().sobreposicoes
    if (atuais.length === 0) return
    const soDeSom: typeof atuais = []
    const repostos = await Promise.all(
      atuais.map(async (o) => {
        // A camada de ajuste nao tem arquivo: e so um filtro sobre o que esta embaixo.
        if (o.tipo === 'ajuste') return o
        const r = await window.dangai.prepararSobreposicao(o.path)
        if (r.ok && r.value.tipo === 'som') soDeSom.push(o)
        return r.ok ? { ...o, url: r.value.url } : o
      }),
    )
    /*
     * UM CLIPE SO DE SOM NA FAIXA DE VIDEO (o projeto do ajk): o render quebrava
     * nele. Sai da faixa de video e vai para uma de audio, no mesmo ponto e com
     * o mesmo corte -- o som que ele queria passa a tocar, e o render anda.
     */
    const idsDeSom = new Set(soDeSom.map((o) => o.id))
    set({ sobreposicoes: repostos.filter((o) => !idsDeSom.has(o.id)) })
    for (const o of soDeSom) {
      await get().levarSomParaAudio(o.path, o.at, { inicioSec: o.inicioSec, usarSec: o.usarSec })
    }
  },

  alternarMudo: (tipo, faixa) =>
    set((state) => {
      const atuais = state.faixasMudas[tipo]
      const proximos = atuais.includes(faixa) ? atuais.filter((f) => f !== faixa) : [...atuais, faixa]
      return { faixasMudas: { ...state.faixasMudas, [tipo]: proximos }, projectDirty: true }
    }),

  selecionarClipe: (clipe) => set({ clipeSelecionado: clipe, outrosClipes: [] }),

  alternarClipeNaSelecao: (clipe) =>
    set((state) => {
      const todos = clipesEscolhidos(state)
      const ja = todos.some((c) => c.tipo === clipe.tipo && c.id === clipe.id)
      const lista = ja ? todos.filter((c) => !(c.tipo === clipe.tipo && c.id === clipe.id)) : [clipe, ...todos]
      return { clipeSelecionado: lista[0] ?? null, outrosClipes: lista.slice(1) }
    }),

  definirSelecaoDeClipes: (clipes) => set({ clipeSelecionado: clipes[0] ?? null, outrosClipes: clipes.slice(1) }),

  removerClipesEscolhidos: () => {
    const todos = clipesEscolhidos(get())
    if (todos.length === 0) return false
    const audio = new Set(todos.filter((c) => c.tipo === 'audio').map((c) => c.id))
    const video = new Set(todos.filter((c) => c.tipo === 'video').map((c) => c.id))
    set((state) => ({
      trilhas: state.trilhas.filter((t) => !audio.has(t.id)),
      sobreposicoes: state.sobreposicoes.filter((o) => !video.has(o.id)),
      clipeSelecionado: null,
      outrosClipes: [],
      projectDirty: true,
    }))
    return true
  },

  duplicarClipe: (tipo, id) => {
    const novoId = `${id.replace(/-d\d+$/, '')}-d${Date.now()}`
    if (tipo === 'audio') {
      const t = get().trilhas.find((x) => x.id === id)
      if (!t) return null
      set((state) => ({ trilhas: [...state.trilhas, { ...t, id: novoId }], projectDirty: true }))
    } else {
      const o = get().sobreposicoes.find((x) => x.id === id)
      if (!o) return null
      set((state) => ({ sobreposicoes: [...state.sobreposicoes, { ...o, id: novoId }], projectDirty: true }))
    }
    return novoId
  },

  clipeCopiado: null,

  copiarClipe: () => {
    const todos = clipesEscolhidos(get())
    if (todos.length === 0) return false
    set({ clipeCopiado: todos })
    return true
  },

  /*
   * COLAR: o grupo copiado entra na agulha, cada clipe na mesma distancia dos
   * outros que tinha, e na faixa dele se couber -- senao na primeira livre
   * acima. Os colados viram a selecao.
   */
  colarClipe: () => {
    const copiados = get().clipeCopiado
    if (!copiados || copiados.length === 0) return false
    const { playhead } = get()
    type Ocupa = { id: string; faixa: number; at: number; fim: number }
    const ocupacao = (tipo: 'video' | 'audio'): Ocupa[] =>
      tipo === 'audio'
        ? get().trilhas.map((t) => ({ id: t.id, faixa: t.faixa, at: t.at, fim: t.at + duracaoDoTrecho(t) }))
        : get().sobreposicoes.map((o) => ({ id: o.id, faixa: o.faixa, at: o.at, fim: o.at + (o.usarSec ?? o.durationSec - o.inicioSec) }))
    const originais: { c: (typeof copiados)[number]; o: Ocupa }[] = []
    for (const c of copiados) {
      const o = ocupacao(c.tipo).find((x) => x.id === c.id)
      if (o) originais.push({ c, o })
    }
    if (originais.length === 0) return false
    const inicio = Math.min(...originais.map((x) => x.o.at))
    const colados: { tipo: 'video' | 'audio'; id: string }[] = []
    for (const { c, o } of originais) {
      const at = Math.max(0, playhead + (o.at - inicio))
      const dur = o.fim - o.at
      const lista = ocupacao(c.tipo)
      const livre = (faixa: number): boolean =>
        lista.every((x) => x.faixa !== faixa || at + dur <= x.at + 1e-6 || at >= x.fim - 1e-6)
      // A faixa dele primeiro; senao as de cima; senao uma nova, acima de todas.
      const maior = Math.max(...lista.map((x) => x.faixa))
      let faixa = o.faixa
      while (!livre(faixa) && faixa <= maior) faixa += 1
      const novoId = get().duplicarClipe(c.tipo, c.id)
      if (!novoId) continue
      if (c.tipo === 'audio') get().moveTrilha(novoId, at, faixa)
      else get().moveSobreposicao(novoId, at, faixa)
      colados.push({ tipo: c.tipo, id: novoId })
    }
    set({ clipeSelecionado: colados[0] ?? null, outrosClipes: colados.slice(1) })
    return colados.length > 0
  },

  removerFaixa: (tipo, faixa) =>
    set((state) => {
      const desce = <T extends { faixa: number }>(lista: readonly T[]): T[] =>
        lista.filter((x) => x.faixa !== faixa).map((x) => (x.faixa > faixa ? { ...x, faixa: x.faixa - 1 } : x))
      const mudas = state.faixasMudas[tipo].filter((f) => f !== faixa).map((f) => (f > faixa ? f - 1 : f))
      const sumiu =
        state.clipeSelecionado?.tipo === tipo &&
        (tipo === 'audio' ? state.trilhas : state.sobreposicoes).some(
          (x) => x.id === state.clipeSelecionado?.id && x.faixa === faixa,
        )
      return {
        ...(tipo === 'audio' ? { trilhas: desce(state.trilhas) } : { sobreposicoes: desce(state.sobreposicoes) }),
        faixasMudas: { ...state.faixasMudas, [tipo]: mudas },
        clipeSelecionado: sumiu ? null : state.clipeSelecionado,
        outrosClipes: [],
        projectDirty: true,
      }
    }),

  addCamadaDeAjuste: (faixa) => {
    const { playhead, plan, audio } = get()
    // Nasce cobrindo o bloco da agulha -- o caso de "corrigir esta cena" --, ou
    // 5 s quando a agulha nao esta sobre bloco nenhum.
    const bloco = plan?.scenes.find((c) => playhead >= c.start && playhead < c.end)
    const at = bloco ? bloco.start : Math.max(0, playhead)
    const fimDoVideo = audio?.durationSec ?? at + 5
    const dur = Math.max(0.2, Math.min(bloco ? bloco.end - bloco.start : 5, fimDoVideo - at))
    const nova = {
      id: `ajuste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: '',
      fileName: 'Camada de ajuste',
      tipo: 'ajuste' as const,
      faixa,
      at,
      durationSec: 3600,
      inicioSec: 0,
      usarSec: dur,
      x: 0,
      y: 0,
      escala: 1,
      opacidade: 1,
      aspecto: 16 / 9,
      rotacao: 0,
      efeito: 'nenhum' as const,
      intensidade: 0.1,
      curva: MOTION_CURVE_DEFAULT,
      pontosDaCurva: null,
      cor: AJUSTE_DE_COR_PADRAO,
      espelhar: false,
      fadeInSec: 0,
      fadeOutSec: 0,
      url: '',
    }
    set((state) => ({
      sobreposicoes: [...state.sobreposicoes, nova],
      clipeSelecionado: { tipo: 'video', id: nova.id },
      outrosClipes: [],
      projectDirty: true,
    }))
  },

  cortarClipeNaAgulha: () => {
    const { clipeSelecionado, playhead } = get()
    if (!clipeSelecionado) return false
    const novoId = (id: string): string => `${id}-c${Math.round(playhead * 1000)}`

    /*
     * O CORTE DE EDITOR: a primeira metade fica com o comeco, a segunda
     * continua do ponto exato do arquivo onde a primeira parou -- nada repete,
     * nada pula. O fade de saida fica so na segunda, e o de entrada so na
     * primeira: a emenda no meio e seca, como num editor.
     */
    if (clipeSelecionado.tipo === 'audio') {
      const t = get().trilhas.find((x) => x.id === clipeSelecionado.id)
      if (!t) return false
      const toca = duracaoDoTrecho(t)
      const local = playhead - t.at
      if (local <= 0.05 || local >= toca - 0.05) return false
      const primeira = { ...t, usarSec: local, fadeOutSec: 0 }
      const segunda = {
        ...t,
        id: novoId(t.id),
        at: playhead,
        inicioSec: t.inicioSec + local,
        usarSec: toca - local,
        fadeInSec: 0,
      }
      set((state) => ({
        trilhas: state.trilhas.flatMap((x) => (x.id === t.id ? [primeira, segunda] : [x])),
        clipeSelecionado: { tipo: 'audio', id: segunda.id },
        outrosClipes: [],
        projectDirty: true,
      }))
      return true
    }

    const o = get().sobreposicoes.find((x) => x.id === clipeSelecionado.id)
    if (!o) return false
    const toca = o.usarSec ?? o.durationSec - o.inicioSec
    const local = playhead - o.at
    if (local <= 0.05 || local >= toca - 0.05) return false
    const primeira = { ...o, usarSec: local }
    const segunda = {
      ...o,
      id: novoId(o.id),
      at: playhead,
      // Imagem nao tem "ponto do arquivo": as duas metades sao a mesma imagem.
      inicioSec: o.tipo !== 'video' ? 0 : o.inicioSec + local,
      usarSec: toca - local,
    }
    set((state) => ({
      sobreposicoes: state.sobreposicoes.flatMap((x) => (x.id === o.id ? [primeira, segunda] : [x])),
      clipeSelecionado: { tipo: 'video', id: segunda.id },
      outrosClipes: [],
      projectDirty: true,
    }))
    return true
  },

  refazerLegendasNaoEditadas: () => {
    const { captionsEdited, transcript, captionRules } = get()
    if (captionsEdited || !transcript || transcript.words.length === 0) return
    set({ captions: buildCaptions(transcript, captionRules) })
  },

  migrarSonsAntigos: async () => {
    const { sfxManual, music, musicGainDb, audio, trilhas } = get()
    if (sfxManual.length === 0 && !music) return

    /*
     * "Pode tirar essa track de SFX e deixar so as de audio, que eu vou usar
     * os SFX por la. Os botoes de SFX e Musica pode tirar tambem, esse sistema
     * vai ser inutil a partir de agora."
     *
     * Tirar so a tela deixaria os projetos antigos com SFX e musica que nada
     * mostra e nada desliga. Entao o que eles tinham vira CLIPE, nas faixas de
     * audio, no mesmo volume: o SFX era mixado a -12 dB mais o ajuste dele, e
     * a cama de musica, no ganho dela, com os mesmos fades.
     */
    const novas: typeof trilhas = []
    let proximaFaixa = Math.max(...trilhas.map((t) => t.faixa + 1), 0)
    const ocupado = new Map<number, { at: number; fim: number }[]>()
    const caber = (at: number, fim: number, primeira: number): number => {
      for (let f = primeira; ; f++) {
        const lista = ocupado.get(f) ?? []
        if (lista.every((o) => fim <= o.at || at >= o.fim)) {
          lista.push({ at, fim })
          ocupado.set(f, lista)
          return f
        }
      }
    }

    const faixaDosSfx = proximaFaixa
    for (const som of [...sfxManual].sort((a, b) => a.at - b.at)) {
      const toca = som.usarSec ?? som.durationSec
      const faixa = caber(som.at, som.at + toca, faixaDosSfx)
      novas.push({
        id: `sfx-${som.id}`,
        path: som.path,
        fileName: som.fileName,
        faixa,
        at: som.at,
        durationSec: som.durationSec,
        inicioSec: 0,
        usarSec: som.usarSec,
        gainDb: Math.round(-12 + som.gainDb),
        fadeInSec: 0,
        fadeOutSec: som.usarSec !== null ? 0.03 : 0,
        peaks: som.peaks,
        rms: [],
        url: som.url,
      })
    }
    proximaFaixa = Math.max(proximaFaixa, ...novas.map((t) => t.faixa + 1))

    if (music && audio) {
      const r = await window.dangai.analyzeAudio(music.path)
      if (r.ok && r.value.durationSec > 0) {
        // A cama repetia a musica ate o fim: vira um clipe por volta.
        const total = audio.durationSec
        let at = 0
        let volta = 0
        while (at < total - 0.05) {
          const toca = Math.min(r.value.durationSec, total - at)
          novas.push({
            id: `musica-${Date.now()}-${volta}`,
            path: music.path,
            fileName: r.value.fileName,
            faixa: proximaFaixa,
            at,
            durationSec: r.value.durationSec,
            inicioSec: 0,
            usarSec: toca < r.value.durationSec ? toca : null,
            gainDb: Math.round(musicGainDb),
            fadeInSec: at === 0 ? MUSIC_FADE_IN_SEC : 0,
            fadeOutSec: at + toca >= total - 0.05 ? MUSIC_FADE_OUT_SEC : 0,
            ...ondaDoTrecho(r.value),
            url: r.value.url,
          })
          at += toca
          volta += 1
        }
      }
    }

    set((state) => ({
      trilhas: [...state.trilhas, ...novas],
      sfxManual: [],
      music: null,
      projectDirty: true,
    }))
  },

  refreshSfxManual: async () => {
    const atuais = get().sfxManual
    if (atuais.length === 0) return
    const repostos = await Promise.all(
      atuais.map(async (som) => {
        const r = await window.dangai.analyzeAudio(som.path)
        return r.ok ? { ...som, url: r.value.url } : som
      }),
    )
    set({ sfxManual: repostos })
  },

  moveSfx: (id, seconds) =>
    set((state) => ({
      sfxManual: state.sfxManual.map((s) => (s.id === id ? { ...s, at: Math.max(0, seconds) } : s)),
      projectDirty: true,
    })),

  trimSfx: (id, seconds) =>
    set((state) => ({
      sfxManual: state.sfxManual.map((som) =>
        som.id === id
          ? {
              ...som,
              /*
               * O corte nao passa do arquivo nem fica curto demais para ouvir.
               * Puxar a alca ate o comeco deixaria um som de duracao zero, que
               * no video e silencio com um chip ocupando espaco.
               */
              usarSec:
                seconds === null
                  ? null
                  : Math.min(Math.max(seconds, SFX_MINIMO_SEC), som.durationSec),
            }
          : som,
      ),
      projectDirty: true,
    })),

  setSfxGain: (id, gainDb) =>
    set((state) => ({
      sfxManual: state.sfxManual.map((som) =>
        som.id === id
          ? { ...som, gainDb: Math.min(Math.max(Math.round(gainDb), SFX_GAIN_MIN), SFX_GAIN_MAX) }
          : som,
      ),
      projectDirty: true,
    })),

  removeSfx: (id) =>
    set((state) => ({
      sfxManual: state.sfxManual.filter((s) => s.id !== id),
      projectDirty: true,
    })),

  clearSfxManual: () => set({ sfxManual: [], projectDirty: true }),
})
