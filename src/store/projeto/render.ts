import { familiaDaFonte, medidasDo } from '@shared/contract'
import { alvoDoRastreio, chavesDoCaminho, enquadrar, fonteDaCamera, janelaDaCamera } from '@shared/camera'
import { toRenderProps, totalFrames } from '@shared/plan'
import { trilhaParaMixar } from '@shared/ducking'
import { emitir } from '@/modulos/ganchos'
import type { GetProjeto, ProjectState, SetProjeto } from '../project'

/** Do store do editor (ver ../project.ts): o render e o rastreio de rosto. */
export type FatiaDoRender = Pick<ProjectState, 'startRender' | 'cancelRender' | 'seguirRosto' | 'rastrear' | 'cancelAnalyze' | 'applyRenderProgress'>

export const fatiaDoRender = (set: SetProjeto, get: GetProjeto): FatiaDoRender => ({

  startRender: async () => {
    const {
      audio, images, plan, sfxEnabled, sfxFiles, captionsEnabled, captions, captionColor,
      captionY, captionScale, music, musicGainDb,
    } = get()
    if (!audio || images.length === 0 || !plan) return null

    /*
     * Bloco que aponta para imagem inexistente some do video EM SILENCIO.
     *
     * toRenderProps descarta essas cenas -- e precisa descartar, senao o render
     * quebraria --, mas ate agora ninguem era avisado: o video saia com a
     * duracao certa e um pedaco a menos de conteudo, que e exatamente o
     * sintoma de "cortou os ultimos blocos". Se o plano e a esteira
     * discordarem, e melhor recusar e dizer do que entregar um video errado
     * sem avisar.
     */
    // A metade de baixo conta igual: bloco dividido com uma das duas faltando
    // sairia com meia tela preta, e em silencio.
    const orfas = plan.scenes.filter(
      (scene) => !images[scene.imageIndex] || (scene.imageIndexB !== null && !images[scene.imageIndexB]),
    )
    if (orfas.length > 0) {
      set({
        error:
          `${orfas.length} ${orfas.length === 1 ? 'bloco aponta' : 'blocos apontam'} para uma cena ` +
          'que não está mais no projeto, e sairiam do vídeo sem aviso. ' +
          'Monte de novo antes de renderizar.',
      })
      return null
    }

    set({
      playing: false,
      error: null,
      render: { progress: 0, stage: 'bundling', message: 'Preparando...' },
    })

    const { hookText, hookSec, endText, endSec } = get()

    /*
     * O upscale acontece AQUI, antes de montar as props.
     *
     * As cenas melhoradas saem com as mesmas medidas do recorte de sempre, e a
     * unica coisa que muda e a `url` de cada asset. Assim nada depois deste
     * ponto -- nem as props, nem o Remotion, nem a mixagem -- precisa saber que
     * o upscale existiu.
     *
     * So as cenas que o video USA: o plano pode apontar para 40 de 200 imagens
     * importadas, e melhorar as outras 160 seria pagar por nada.
     *
     * Falhando, o render segue sem upscale em vez de morrer. Perder a melhoria
     * e chato; perder o render inteiro depois de esperar por ele e pior.
     */
    let imagens = images
    if (get().upscale) {
      const usadas = new Set<number>()
      /*
       * Ate que segundo de cada clipe o video chega.
       *
       * O bloco toca de `sourceStart` por `end - start` segundos; depois disso
       * o clipe continua existindo mas ninguem ve. Melhorar so ate ali corta um
       * bom pedaco da espera -- as cenas da biblioteca quase sempre sobram.
       *
       * A mesma cena pode aparecer duas vezes com pontos de entrada diferentes,
       * entao vale o MAIOR alcance entre os blocos que a usam.
       */
      const limites: Record<string, number> = {}
      const alcancar = (
        indice: number,
        cena: (typeof plan.scenes)[number],
        /*
         * A METADE DE BAIXO PARTE DE OUTRO PONTO.
         *
         * Ela usa `sourceStartB`, e este calculo usava `sourceStart` para as
         * duas. Numa tela dividida em que a de baixo entrava mais adiante no
         * clipe, o arquivo melhorado era cortado antes do trecho que ela toca
         * -- e o render acabava o video no meio do bloco, congelando o ultimo
         * quadro sem nada avisar.
         */
        inicio: number,
      ): void => {
        usadas.add(indice)
        const id = images[indice]?.id
        if (!id) return
        const ate = inicio + (cena.end - cena.start)
        limites[id] = Math.max(limites[id] ?? 0, ate)
      }
      for (const cena of plan.scenes) {
        alcancar(cena.imageIndex, cena, cena.sourceStart ?? 0)
        if (cena.imageIndexB !== null) alcancar(cena.imageIndexB, cena, cena.sourceStartB ?? 0)
      }
      const alvos = images
        .filter((_, i) => usadas.has(i))
        // Invertido melhora a COPIA invertida: e ela que a cena toca.
        .map((img) => (img.invertido && img.caminhoInvertido ? { ...img, path: img.caminhoInvertido } : img))
      const melhoradas = await window.dangai.upscaleAssets(alvos, limites)
      // Cancelado no meio: o render para aqui, sem seguir sem o upscale.
      if (melhoradas.ok && melhoradas.value === null) {
        set({ render: null })
        return null
      }
      if (melhoradas.ok && melhoradas.value) {
        const mapa = melhoradas.value
        imagens = images.map((img) =>
          mapa[img.id] ? { ...img, url: mapa[img.id]! } : img,
        )
      } else if (!melhoradas.ok) {
        set({ error: `O upscale falhou (${melhoradas.error}); renderizando sem ele.` })
      }
    }

    const result = await window.dangai.startRender({
      props: toRenderProps(
        plan,
        imagens,
        captionsEnabled ? captions : [],
        { hook: hookText, hookSec, end: endText, endSec },
        captionColor,
        captionY,
        // O MESMO numero que vai na composicao logo abaixo. Eram duas contas
        // separadas, e quando discordavam o fim do video ficava sem imagem.
        audio.durationSec,
        {
          font: get().captionFont?.url ? {
            family: familiaDaFonte(get().captionFont!.nome),
            url: get().captionFont!.url,
          }
        : null,
          animation: get().captionAnimation,
          animationFrames: get().captionAnimationFrames,
          animationCurve: get().captionAnimationCurve,
          mark: get().captionMark,
          shadow: get().captionShadow,
          stroke: get().captionStroke,
          scale: get().captionScale,
        },
        get().formato,
        get().sobreposicoes.filter((o) => !get().faixasMudas.video.includes(o.faixa)),
      ),
      audioPath: audio.path,
      durationInFrames: totalFrames(audio.durationSec),
      // Os cues sao montados aqui e nao guardados no plano: eles dependem dos
      // arquivos que estao na pasta AGORA, e o usuario pode ter acabado de
      // trocar os sons sem refazer a analise.
      /*
       * Os postos a mao mandam. So quando nao ha nenhum e que o rodizio
       * automatico entra -- ver o comentario de `sfxManual` no estado.
       */
      /*
       * O rodizio automatico de SFX e a cama de musica sairam: o som do video e
       * o das faixas de audio. Projeto antigo ja chega aqui migrado -- ver
       * migrarSonsAntigos.
       */
      sfxCues: [],
      music: null,
      // trilhaParaMixar: o de sempre e, no trecho com `ducking`, o envelope
      // pelas palavras -- a mesma conta do preview (shared/ducking.ts).
      trilhas: get()
        .trilhas.filter((t) => !get().faixasMudas.audio.includes(t.faixa))
        .map((t) => trilhaParaMixar(t, get().transcript?.words ?? [], audio.durationSec)),
    })

    if (!result.ok) {
      set({ error: result.error, render: null })
      return null
    }
    // value === null significa que o usuario cancelou. Nao e erro, e o evento
    // 'cancelled' ja limpou o estado -- so garantimos que nada ficou pendurado.
    if (result.value === null) {
      set({ render: null })
      return null
    }
    return result.value
  },

  cancelRender: async () => {
    await window.dangai.cancelRender()
  },

  seguirRosto: async (index) => {
    const { plan, images } = get()
    const cena = plan?.scenes[index]
    const image = cena ? images[cena.imageIndex] : undefined
    if (!cena?.camera || !image) return 'nenhum'

    /*
     * Os mesmos dois instantes que os quadros de enquadrar mostram.
     *
     * Se aqui fosse outro par, o botao encheria as pontas com um rosto que a
     * tela nao esta mostrando -- e o usuario veria o retangulo pular para um
     * lugar sem relacao com a imagem na frente dele.
     */
    const inicio = cena.sourceStart ?? 0
    const fim = inicio + (cena.end - cena.start)

    set({ busy: 'Procurando o rosto...', error: null })
    const r = await window.dangai.faceAt(image.path, [inicio, fim])
    set({ busy: null })
    if (!r.ok) {
      set({ error: r.error })
      return 'nenhum'
    }

    const [noComeco, noFim] = r.value
    if (!noComeco && !noFim) return 'nenhum'

    /*
     * O rosto de UMA ponta serve para as duas.
     *
     * Achar so no comeco e o caso comum -- o personagem vira de perfil no meio
     * do corte e o detector para de responder. Repetir o que se achou deixa a
     * camera parada e certa, em vez de deixar a outra ponta no centro, que e
     * quase sempre o lugar errado.
     */
    const quadro = medidasDo(get().formato)
    const aspectoDoQuadro = quadro.width / quadro.height
    const aspecto = fonteDaCamera(image, cena.camera, aspectoDoQuadro).aspecto
    const de = noComeco ?? noFim!
    const ate = noFim ?? noComeco!

    get().updateScene(index, {
      camera: {
        ...cena.camera,
        // A escala de cada ponta e mantida: ela e a aproximacao que ele
        // escolheu, e mexer nela seria mudar duas coisas num pedido so.
        from: enquadrar(de.centroX, de.centroY, cena.camera.from.scale, aspecto, aspectoDoQuadro),
        to: enquadrar(ate.centroX, ate.centroY, cena.camera.to.scale, aspecto, aspectoDoQuadro),
      },
    })
    return noComeco && noFim ? 'ambos' : 'um'
  },

  rastrear: async (index) => {
    const { plan, images } = get()
    const cena = plan?.scenes[index]
    const image = cena ? images[cena.imageIndex] : undefined
    if (!cena?.camera || !image || image.kind !== 'video') return null

    /*
     * O ALVO E O PROPRIO RETANGULO INICIAL.
     *
     * Nao ha uma segunda ferramenta de selecao: ele ja arrasta esse retangulo
     * para escolher o que aparece, e "o que aparece no comeco" e exatamente o
     * que ele quer continuar vendo. Uma caixa separada seria um segundo jeito de
     * dizer a mesma coisa, com a chance de os dois discordarem.
     */
    const medidasQ = medidasDo(get().formato)
    const aspectoQ = medidasQ.width / medidasQ.height
    const fonte = fonteDaCamera(image, cena.camera, aspectoQ)
    const janela = janelaDaCamera(cena.camera.from, fonte.aspecto, aspectoQ)
    const alvo = alvoDoRastreio(janela, image.width, image.height)

    const inicio = cena.sourceStart ?? 0
    const duracao = cena.end - cena.start

    set({ busy: 'Seguindo o alvo...', error: null })
    const r = await window.dangai.trackBox(image.path, inicio, duracao, alvo)
    set({ busy: null })
    if (!r.ok) {
      set({ error: r.error })
      return null
    }

    const caminho = chavesDoCaminho(
      r.value.caminho,
      cena.camera.from,
      cena.camera.to,
      fonte.aspecto,
      aspectoQ,
    )
    if (!caminho) return null

    get().updateScene(index, { camera: { ...cena.camera, ...caminho } })
    return r.value.ateOnde
  },

  cancelAnalyze: async () => {
    await window.dangai.cancelAnalyze()
    /*
     * A tela e devolvida AQUI, e nao quando o main responder.
     *
     * Quem cancela quer a tela de volta agora. A leitura interrompida ainda vai
     * resolver com erro la atras, e a conferencia de que a narracao continua a
     * mesma cuida de nao deixar nada cair por cima depois.
     */
    set({ busy: null, scriptBlocksBusy: null, libraryBusy: null })
  },

  applyRenderProgress: (progress) => {
    if (progress.stage === 'done') {
      set({ render: null, lastOutput: progress.outputPath ?? null, error: null })
      emitir('depoisDeRenderizar', { outputPath: progress.outputPath ?? null })
      return
    }
    if (progress.stage === 'failed') {
      set({ render: null, error: progress.message ?? 'O render falhou.' })
      return
    }
    if (progress.stage === 'cancelled') {
      set({ render: null })
      return
    }

    // O Remotion ainda emite alguns eventos de progresso depois do cancelamento.
    // Sem esta guarda eles ressuscitam o estado e a timeline fica presa
    // preenchida pela metade, com o botao travado em "Cancelar".
    if (get().render === null) return

    set({ render: progress })
  },
})
