import { KEN_BURNS_EFFECTS } from '@shared/contract'
import type { Scene } from '@shared/contract'
import { buildCaptions, imagemDaMetade, reordenarBlocos, MIN_SCENE_SEC } from '@shared/plan'
import { abrirEspaco, removerCena } from '@shared/indices'
import type { GetProjeto, ProjectState, SetProjeto } from '../project'
import { setInterimPlan, clamp01 } from './apoio'

/** Do store do editor (ver ../project.ts): a analise, as imagens e os blocos da faixa de cenas. */
export type FatiaDasCenas = Pick<ProjectState, 'analyze' | 'reorderImages' | 'removeImage' | 'alternarTrancaDasCenas' | 'insertImages' | 'removeScene' | 'setImageFocus' | 'commitImageFocus' | 'updateScene' | 'inverterClipe'>

export const fatiaDasCenas = (set: SetProjeto, get: GetProjeto): FatiaDasCenas => ({

  analyze: async () => {
    const { audio, images, subtitlePath, script } = get()
    if (!audio || images.length === 0) return

    set({ busy: 'Analisando...', error: null })

    const result = await window.dangai.analyze({
      audioPath: audio.path,
      subtitlePath,
      images,
      durationSec: audio.durationSec,
      script,
      // Travada: o main usa esta e nao ouve a narracao de novo.
      transcript: get().transcriptTravado ? get().transcript : null,
    })

    if (result.ok) {
      const state = get()

      /*
       * Trabalho manual sobrevive a uma reanalise. O plano so e preservado se
       * ainda servir: se o numero de imagens mudou, as cenas editadas nao
       * correspondem mais a nada e o plano novo e o unico correto.
       */
      /*
       * "Ainda serve" conta as IMAGENS que o plano usa, e nao as cenas: tela
       * dividida usa duas num bloco so. Comparar cenas com imagens jogava fora
       * todo plano com tela dividida na primeira reanalise.
       */
      const usadas = state.plan?.scenes.reduce((n, c) => n + (c.imageIndexB === null ? 1 : 2), 0)
      const keepPlan = state.planEdited && usadas === images.length

      set({
        plan: keepPlan ? state.plan : result.value.plan,
        // Trocando o plano, a selecao passa a apontar para blocos que nao sao
        // mais os mesmos -- e colar ajustes neles estragaria trabalho calado.
        ...(keepPlan ? {} : { selectedScene: null, selecionados: [] }),
        planOrigin: keepPlan ? state.planOrigin : result.value.origin,
        transcript: result.value.transcript,
        captions: state.captionsEdited
          ? state.captions
          : buildCaptions(result.value.transcript, state.captionRules),
        aiNote: result.value.aiNote,
        scriptNote: result.value.scriptNote,
        sectionNote: result.value.sectionNote,
        planEdited: keepPlan,
        busy: null,
      })
    } else {
      // Nem a analise pode travar o app: mantem o plano provisorio em vez de
      // ficar sem nenhum.
      const { audio, images } = get()
      if (audio && images.length > 0) setInterimPlan(set, images.length, audio.durationSec)
      set({ error: result.error, busy: null })
    }
  },

  /**
   * Arrastar na tira reordena os BLOCOS, sem refazer o plano.
   *
   * Duas coisas erradas moravam aqui, e as duas apareciam no mesmo gesto:
   *
   *  - o plano era TROCADO por fatias iguais (`setInterimPlan`). Camera,
   *    movimento, trecho do clipe, transicao: tudo o que ele tinha ajustado ia
   *    embora num arraste -- "ele joga para um lugar aleatorio";
   *  - e cada troca de posicao disparava `analyze()`, que roda transcricao e
   *    planejamento no main. O `onReorder` do motion avisa a CADA posicao
   *    trocada, e nao no fim do gesto: arrastar por cinco lugares eram cinco
   *    analises empilhadas. "Congela tudo".
   *
   * A conta mora em shared/plan, onde da para conferi-la sem a interface junto.
   * Nada e reanalisado: a ordem nova e a verdade, e nao uma sugestao a refazer.
   */
  reorderImages: (novas) => {
    const { images: antes, plan } = get()
    if (!plan) {
      set({ images: novas })
      return
    }

    const feito = reordenarBlocos(
      plan,
      antes.map((img) => img.id),
      novas.map((img) => img.id),
    )
    if (!feito) {
      // Lista que nao e permutacao da atual: mexe so na tira.
      set({ images: novas })
      return
    }

    set({
      images: novas,
      plan: feito.plan,
      // So conta como edicao quando os blocos REALMENTE andaram: reapontar
      // referencia nao muda o video, e nao deve impedir uma reanalise futura.
      ...(feito.moveuBlocos ? { planEdited: true } : {}),
    })
  },

  removeImage: (id) => {
    set((state) => ({
      images: state.images.filter((image) => image.id !== id),
      selectedScene: null,
      selecionados: [],
    }))
    const { audio, images } = get()
    if (audio && images.length > 0) setInterimPlan(set, images.length, audio.durationSec)
    void get().analyze()
  },

  /**
   * Importa imagens e as encaixa no meio da fila.
   *
   * O tempo das novas sai do bloco onde elas entraram, e nao de toda a linha do
   * tempo: inserir uma imagem no minuto tres nao pode empurrar tudo que ja
   * estava ajustado antes dela.
   */
  alternarTrancaDasCenas: () =>
    set((state) => ({
      cenasTrancadas: !state.cenasTrancadas,
      // O aviso de "trancada" sai junto com a tranca.
      error: state.error?.startsWith('A faixa de cenas está trancada') ? null : state.error,
      projectDirty: true,
    })),

  insertImages: async (paths, seconds) => {
    if (get().cenasTrancadas) {
      set({ error: 'A faixa de cenas está trancada. Clique no cadeado da faixa Cenas para mexer nos cortes.' })
      return
    }
    if (paths.length === 0) return

    set({ busy: `Lendo ${paths.length} ${paths.length === 1 ? 'imagem' : 'imagens'}...`, error: null })
    const result = await window.dangai.importImages(paths)
    if (!result.ok) {
      set({ error: result.error, busy: null })
      return
    }

    const novas = result.value
    const { images, plan, audio } = get()

    // Sem plano ainda: entra no fim e a analise monta tudo do zero.
    if (!plan || !audio || plan.scenes.length === 0) {
      const proximas = [...images, ...novas]
      set({ images: proximas, busy: null })
      if (audio && proximas.length > 0) {
        setInterimPlan(set, proximas.length, audio.durationSec)
        await get().analyze()
      }
      return
    }

    /*
     * A insercao e por TEMPO e nao por indice: assim o mesmo caminho serve para
     * "antes deste bloco" (o instante em que ele comeca), "no meio dele" e para
     * o arraste na linha do tempo, que cai onde o ponteiro estiver.
     *
     * Cair exatamente no comeco de um bloco significa entrar ANTES dele; cair
     * no meio significa parti-lo, com a imagem nova ficando com a metade da
     * direita. Nos dois casos o tempo sai so deste bloco -- nada antes ou
     * depois dele se mexe.
     */
    const ultimo = plan.scenes[plan.scenes.length - 1]!
    const t = Math.min(Math.max(seconds, 0), ultimo.end - 1e-6)
    const h = Math.max(
      plan.scenes.findIndex((scene) => t >= scene.start && t < scene.end),
      0,
    )
    const anfitriao = plan.scenes[h]!
    const n = novas.length
    const total = anfitriao.end - anfitriao.start
    const antesDele = t <= anfitriao.start + 1e-6

    let corte: number
    let at: number

    if (antesDele) {
      // Entra na frente: o anfitriao recua e cede a cabeca do proprio intervalo.
      corte = anfitriao.start + (total * n) / (n + 1)
      at = h
    } else {
      at = h + 1
      // Aperta o corte para os dois lados continuarem visiveis. Se o bloco e
      // curto demais para isso, reparte por igual e o minimo nao se aplica.
      corte =
        total >= (n + 1) * MIN_SCENE_SEC
          ? Math.min(Math.max(t, anfitriao.start + MIN_SCENE_SEC), anfitriao.end - n * MIN_SCENE_SEC)
          : anfitriao.start + total / (n + 1)
    }

    const inicio = antesDele ? anfitriao.start : corte
    const fim = antesDele ? corte : anfitriao.end
    const passo = (fim - inicio) / n

    const inseridas: Scene[] = novas.map((_, i) => ({
      imageIndex: at + i,
      // Tela cheia: a divisao e escolha dele, feita na fita da Biblioteca.
      imageIndexB: null,
      start: inicio + i * passo,
      end: i === n - 1 ? fim : inicio + (i + 1) * passo,
      effect: KEN_BURNS_EFFECTS[(at + i) % KEN_BURNS_EFFECTS.length] ?? 'zoom-in',
      intensity: 0.12,
      // A metade de baixo segue a de cima ate ele separar as duas.
      effectB: null,
      intensityB: null,
      // Comeca no inicio do clipe, como todo bloco novo.
      sourceStart: 0,
      sourceStartB: 0,
      // Herda a curva do bloco que cedeu o tempo, e nao o padrao: quem ja
      // ajustou o ritmo do video inteiro nao quer o bloco novo destoando.
      curve: anfitriao.curve,
      curvePoints: null,
      // Camera livre so quando ele desenhar as pontas.
      camera: null,
      rotation: 0 as const,
      transitionIn: 'cut' as const,
    }))

    // Os dois indices andam -- ver @shared/indices.
    const reindexar = (scene: Scene): Scene => abrirEspaco(scene, at, n)

    const scenes = antesDele
      ? [
          ...plan.scenes.slice(0, h).map(reindexar),
          ...inseridas,
          { ...reindexar(anfitriao), start: corte },
          ...plan.scenes.slice(h + 1).map(reindexar),
        ]
      : [
          ...plan.scenes.slice(0, h).map(reindexar),
          { ...reindexar(anfitriao), end: corte },
          ...inseridas,
          ...plan.scenes.slice(h + 1).map(reindexar),
        ]

    set({
      images: [...images.slice(0, at), ...novas, ...images.slice(at)],
      plan: { ...plan, scenes },
      planEdited: true,
      selectedScene: antesDele ? h : h + 1,
      selecionados: [],
      busy: null,
    })
  },

  /**
   * Tira um bloco da linha do tempo, junto com a imagem dele. O tempo vai para
   * o vizinho, senao sobraria um buraco preto no meio do video.
   */
  removeScene: (index) => {
    if (get().cenasTrancadas) {
      set({ error: 'A faixa de cenas está trancada. Clique no cadeado da faixa Cenas para mexer nos cortes.' })
      return
    }
    const { plan, images } = get()
    if (!plan) return
    // Tela dividida leva as duas imagens, e os dois indices de todo mundo
    // descem -- ver @shared/indices.
    const feito = removerCena(plan, images, index)
    if (!feito) return

    set({
      images: feito.images,
      plan: feito.plan,
      planEdited: true,
      selectedScene: null,
      selecionados: [],
    })
  },

  setImageFocus: (id, focusX, focusY) => {
    set((state) => ({
      images: state.images.map((image) =>
        image.id === id
          ? // Mexeu na mao, a marca de automatico sai: dali em diante o
            // enquadramento e escolha dele, e a interface para de dizer que foi
            // o detector que pos ali.
            { ...image, focusX: clamp01(focusX), focusY: clamp01(focusY), focusAuto: false }
          : image,
      ),
      enquadrando: id,
    }))
  },

  /*
   * O recorte real acontece no main, com sharp, e custa alguns centesimos --
   * caro demais para rodar a cada pixel arrastado. Enquanto o usuario arrasta,
   * so o retangulo do painel se move; a imagem do preview so e refeita quando
   * ele solta.
   */
  commitImageFocus: async (id) => {
    const image = get().images.find((item) => item.id === id)
    if (!image) return

    const result = await window.dangai.reframeImage({
      // Invertido: recorta a copia invertida, na chave dela no cache.
      id: image.invertido ? `${image.id}-inv` : image.id,
      path: image.invertido && image.caminhoInvertido ? image.caminhoInvertido : image.path,
      focusX: image.focusX,
      focusY: image.focusY,
    })

    if (!result.ok) {
      set({ error: result.error, enquadrando: null })
      return
    }

    // A imagem pode ter sido removida ou o foco ter mudado de novo enquanto o
    // recorte rodava; so aplica se ainda for o mesmo enquadramento.
    const current = get().images.find((item) => item.id === id)
    if (!current || current.focusX !== image.focusX || current.focusY !== image.focusY) return

    // O recorte novo esta pronto: o preview volta a copia leve.
    set((state) => ({
      images: state.images.map((item) =>
        item.id === id ? { ...item, url: result.value } : item,
      ),
      enquadrando: state.enquadrando === id ? null : state.enquadrando,
    }))
  },

  updateScene: (index, patch) => {
    const { plan } = get()
    if (!plan) return
    const scenes = plan.scenes.map((scene, i) => (i === index ? { ...scene, ...patch } : scene))
    set({ plan: { ...plan, scenes }, planEdited: true })
  },

  inverterClipe: async (sceneIndex, metade) => {
    const { plan, images } = get()
    const cena = plan?.scenes[sceneIndex]
    const alvo = imagemDaMetade(plan, sceneIndex, metade)
    const asset = alvo === null ? undefined : images[alvo]
    if (!cena || !asset || asset.kind !== 'video') return

    const invertido = !asset.invertido
    set({ busy: invertido ? 'Invertendo o clipe...' : 'Desinvertendo o clipe...', error: null })
    const r = await window.dangai.inverterClipe(asset, invertido)
    if (!r.ok) {
      set({ busy: null, error: r.error })
      return
    }

    /*
     * O MESMO TRECHO, tocando ao contrario.
     *
     * O bloco mostrava [s, s+d] do clipe. No arquivo invertido esses quadros
     * moram em [D-s-d, D-s] -- entao o ponto de entrada vira D-s-d, e o bloco
     * continua mostrando o momento que ele tinha escolhido, so que de tras
     * para frente. Vale nos dois sentidos: inverter de novo volta para s.
     */
    const total = asset.durationSec ?? 0
    const d = cena.end - cena.start
    const campo = metade === 'baixo' ? 'sourceStartB' : 'sourceStart'
    const s0 = (metade === 'baixo' ? cena.sourceStartB : cena.sourceStart) ?? 0
    const novoInicio = Math.max(0, total - s0 - d)

    const atual = get()
    set({
      images: atual.images.map((img, i) => (i === alvo ? r.value : img)),
      plan: atual.plan
        ? {
            ...atual.plan,
            scenes: atual.plan.scenes.map((c, i) => (i === sceneIndex ? { ...c, [campo]: novoInicio } : c)),
          }
        : atual.plan,
      planEdited: true,
      busy: null,
      projectDirty: true,
    })
  },
})
