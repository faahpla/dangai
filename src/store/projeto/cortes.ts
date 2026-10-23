import { VIDEO_FPS } from '@shared/contract'
import type { Scene } from '@shared/contract'
import { abrirEspaco } from '@shared/indices'
import type { GetProjeto, ProjectState, SetProjeto } from '../project'

/** Do store do editor (ver ../project.ts): cortes, limites e curva dos blocos. */
export type FatiaDosCortes = Pick<ProjectState, 'applyCurveToAll' | 'moveBoundary' | 'splitSceneAtPlayhead'>

export const fatiaDosCortes = (set: SetProjeto, get: GetProjeto): FatiaDosCortes => ({

  /**
   * A mesma curva em todas as cenas.
   *
   * Existe porque o projeto real dele tem 46 blocos: escolher o ritmo de camera
   * um a um seria 46 idas ao painel para uma decisao que quase sempre e do video
   * inteiro, nao de um bloco.
   */
  applyCurveToAll: (curve, pontos) => {
    const { plan } = get()
    if (!plan) return
    set({
      plan: {
        ...plan,
        scenes: plan.scenes.map((scene) => ({ ...scene, curve, curvePoints: pontos ?? null })),
      },
      planEdited: true,
    })
  },

  /**
   * Move a fronteira entre duas cenas, respeitando o minimo dos dois lados.
   *
   * So as duas cenas vizinhas mudam -- arrastar um limite nao pode empurrar o
   * resto da timeline em cascata, senao um ajuste pequeno reorganiza o video
   * inteiro.
   */
  moveBoundary: (index, seconds) => {
    if (get().cenasTrancadas) return
    const { plan } = get()
    if (!plan || index <= 0 || index >= plan.scenes.length) return

    const previous = plan.scenes[index - 1]!
    const next = plan.scenes[index]!

    /*
     * O ARRASTE E LIVRE. O piso de 0,6s vale na MONTAGEM, nao aqui.
     *
     * `MIN_SCENE_SEC` existe para nenhum bloco NASCER piscando, e nisso ele
     * continua mandando: e o planner, o snap e o sanitize que o respeitam. Mas
     * ele tambem barrava o ajuste a mao, e a fronteira entre dois blocos curtos
     * simplesmente nao andava -- ele arrastava e nada acontecia. Palavras dele:
     * "nao quero ser barrado quando quero expandir ou diminuir um clipe".
     *
     * Sobra o unico limite que nao e gosto e sim aritmetica: um bloco nao pode
     * ter duracao zero nem negativa, senao ele some do video e leva junto o
     * proprio meio de ser recuperado. Um frame de cada lado basta para isso, e
     * um frame e curto o suficiente para nao atrapalhar ninguem.
     */
    const umFrame = 1 / VIDEO_FPS
    const min = previous.start + umFrame
    const max = next.end - umFrame
    if (max <= min) return

    const clamped = Math.min(Math.max(seconds, min), max)

    const scenes = plan.scenes.map((scene, i) => {
      if (i === index - 1) return { ...scene, end: clamped }
      if (i === index) return { ...scene, start: clamped }
      return scene
    })

    set({ plan: { ...plan, scenes }, planEdited: true })
  },

  /**
   * Parte em dois o bloco que esta sob a agulha.
   *
   * UMA IMAGEM, UM BLOCO -- inclusive aqui. A regra vale contra o app repartir
   * sozinho, e quem aperta C esta pedindo o bloco a mais. Mas o bloco novo ganha
   * a PROPRIA entrada na lista de imagens, uma copia da que ele partiu, em vez
   * de as duas metades dividirem a mesma.
   *
   * Foi assim que a primeira versao errou. Ela deixava as duas metades com o
   * mesmo `imageIndex`, e o app inteiro conta com a igualdade "cena i usa imagem
   * i": `openLibraryToReplace` guarda o indice da CENA e depois escreve em
   * `images[indice]`. Depois de um corte, mandar trocar a segunda metade
   * trocava o clipe do bloco SEGUINTE -- que foi exatamente o que ele viu.
   *
   * Duplicar a imagem conserta isso na raiz, e de quebra faz o corte sobreviver
   * ao `sanitize`, que reconstroi o plano contando uma cena por imagem.
   */
  splitSceneAtPlayhead: () => {
    if (get().cenasTrancadas) {
      set({ error: 'A faixa de cenas está trancada. Clique no cadeado da faixa Cenas para mexer nos cortes.' })
      return
    }
    const { plan, playhead, images } = get()
    if (!plan) return

    const index = plan.scenes.findIndex(
      (scene) => playhead > scene.start && playhead < scene.end,
    )
    if (index === -1) return

    const scene = plan.scenes[index]!
    /*
     * O CORTE TAMBEM E LIVRE, pelo mesmo motivo do arraste.
     *
     * Exigia 0,6s de cada lado, com o argumento de que as metades precisavam
     * nascer utilizaveis. Mas quem aperta C escolheu o ponto, e o bloco curto
     * que sai dali pode ser esticado na linha do tempo -- que agora tambem nao
     * barra ninguem. A regra so atrapalhava quem queria um quadro isolado no
     * fim de um bloco.
     *
     * Fica o limite aritmetico: um frame de cada lado, senao o corte produziria
     * um bloco de duracao zero, que some do video.
     */
    const umFrame = 1 / VIDEO_FPS
    if (playhead - scene.start < umFrame) return
    if (scene.end - playhead < umFrame) return

    const original = images[scene.imageIndex]
    if (!original) return
    const originalB = scene.imageIndexB === null ? undefined : images[scene.imageIndexB]

    /*
     * Tela dividida ganha copia das DUAS metades.
     *
     * Copiar so a de cima deixava as duas metades do corte com a mesma imagem
     * de baixo -- e trocar a de baixo de uma trocava a da outra, o mesmo
     * defeito que a copia existe para evitar.
     *
     * As copias entram logo DEPOIS da original: na fita da Biblioteca as
     * imagens aparecem na ordem dos blocos, e mandar a copia para o fim da
     * lista poria na tela uma ordem que nao existe na linha do tempo.
     */
    const sufixo = `+corte${Math.round(playhead * 1000)}`
    const copias = [
      { ...original, id: `${original.id}${sufixo}` },
      ...(originalB ? [{ ...originalB, id: `${originalB.id}${sufixo}` }] : []),
    ]
    const at = Math.max(scene.imageIndex, scene.imageIndexB ?? -1) + 1
    const reindexar = (alvo: Scene): Scene => abrirEspaco(alvo, at, copias.length)
    const andou = playhead - scene.start

    const scenes = [
      ...plan.scenes.slice(0, index).map(reindexar),
      { ...reindexar(scene), end: playhead },
      {
        ...reindexar(scene),
        imageIndex: at,
        imageIndexB: originalB ? at + 1 : null,
        start: playhead,
        /*
         * O clipe CONTINUA de onde parou, em vez de rebobinar.
         *
         * Um print ignora este campo. Num clipe, herdar o sourceStart do bloco
         * inteiro faria a segunda metade repetir o mesmo trecho que a primeira
         * acabou de mostrar -- que e o oposto de cortar. Vale para as duas
         * metades da tela dividida.
         */
        sourceStart: scene.sourceStart + andou,
        sourceStartB: (scene.sourceStartB ?? 0) + andou,
        // Corte seco entre as metades: uma transicao aqui inventaria um efeito
        // que ele nao pediu, bem no ponto onde ele mandou cortar.
        transitionIn: 'cut' as const,
      },
      ...plan.scenes.slice(index + 1).map(reindexar),
    ]

    set({
      images: [...images.slice(0, at), ...copias, ...images.slice(at)],
      plan: { ...plan, scenes },
      planEdited: true,
      // A segunda metade fica selecionada: quem corta costuma querer mexer
      // justamente no pedaco novo.
      selectedScene: index + 1,
      selecionados: [],
    })
  },
})
