import type { AutomountBlock } from '@shared/channels'
import type { ImageAsset } from '@shared/contract'
import { juntarComOProximo, separarTrecho as separarPedacos, tirarDaFita } from '@shared/juntar'
import { buildCaptions, imagemDaMetade } from '@shared/plan'
import { roteiroNaoBate } from '@shared/preflight'
import { remapearEscolhas } from '@shared/remapear-escolhas'
import { herdarAjustes, reaproveitar } from '@shared/remontar'
import {
  cabeCortePorPalavra,
  cortesAutomaticos,
  limitesDaFronteira,
  palavrasDoTrecho,
  prender,
  slotsDoTrecho,
  spansDoTrecho,
} from '@shared/trecho'
import { perguntar } from '../pergunta'
import type { GetProjeto, ProjectState, SetProjeto } from '../project'
import { semPassoDeDesfazer } from '../quiet'
import { aplicarMarcacoes, planoDosBlocos, substituirNaFita } from './apoio'

/** Do store do editor (ver ../project.ts): montar sozinho, a selecao por roteiro e os blocos da Biblioteca. */
export type FatiaDaEscolhaDeCenas = Pick<ProjectState, 'automount' | 'setAutomountSeries' | 'openLibraryToReplace' | 'replaceSceneWith' | 'loadScriptBlocks' | 'trocarRoteiro' | 'setActiveBlock' | 'voltarParaSelecao' | 'toggleBlockClip' | 'alternarEscolhido' | 'removerEscolhido' | 'limparEscolhidos' | 'juntarTrechos' | 'separarTrecho' | 'reorderBlockClips' | 'toggleBlockSplit' | 'duplicateBlockClip' | 'setBlockWeight' | 'removeBlockClip' | 'setBlockCut' | 'clearBlockCuts' | 'applyBlockClips' | 'swapCandidate'>

export const fatiaDaEscolhaDeCenas = (set: SetProjeto, get: GetProjeto): FatiaDaEscolhaDeCenas => ({

  automount: async (mode, series) => {
    const { audio, subtitlePath, script } = get()
    if (!audio) {
      set({ error: 'Carregue a narração antes de montar sozinho.' })
      return
    }

    set({ busy: 'Montando...', error: null })

    const proposta = await window.dangai.automount({
      audioPath: audio.path,
      subtitlePath,
      script,
      mode,
      series,
      transcript: get().transcriptTravado ? get().transcript : null,
    })
    if (!proposta.ok) {
      set({ busy: null, error: proposta.error })
      return
    }

    const { blocks, note, scriptNote, transcript } = proposta.value
    /*
     * O ROTEIRO NAO BATEU: pergunta antes de montar. Montado assim, os cortes
     * e as legendas seguem o que foi falado -- com um audio de outro assunto,
     * 59 cenas aleatorias, e antes sem ninguem avisar.
     */
    const nota = roteiroNaoBate(script, transcript, scriptNote)
    if (nota) {
      set({ busy: null })
      const seguir = await perguntar({
        titulo: 'O roteiro não bate com a narração',
        texto: `${nota}\n\nMontando assim, os cortes e as legendas seguem o que foi falado, e não o roteiro. Confira se a narração e o roteiro são do mesmo vídeo.`,
        sim: 'Montar pela narração',
        nao: 'Cancelar',
      })
      if (!seguir) {
        set({ scriptNote: nota })
        return
      }
      set({ busy: 'Montando...' })
    }
    const uteis = blocks.filter((b) => b.candidates.length > 0)
    if (uteis.length === 0) {
      set({
        busy: null,
        error:
          series
            ? `Não há cena de "${series}" para nenhum bloco desta narração.`
            : 'A biblioteca não tem cena para nenhum bloco desta narração. Confira a pasta das cenas nas configurações.',
      })
      return
    }

    set({ busy: `Trazendo ${uteis.length} cenas...` })
    /*
     * CLIPE QUE NAO ABRE vira a PROXIMA SUGESTAO do mesmo bloco, e o resto
     * segue. Antes um clipe preto da biblioteca (o 0440.mp4, 10/2026) jogava
     * fora as 34 cenas escolhidas. Ate tres tentativas por bloco; sem nenhuma
     * que abra, o bloco sai e o vizinho de antes estica ate o proximo.
     */
    const escolha = uteis.map(() => 0)
    const imagens: (ImageAsset | null)[] = uteis.map(() => null)
    const pulados: string[] = []
    let faltam = uteis.map((_, i) => i)
    for (let rodada = 0; rodada < 3 && faltam.length > 0; rodada++) {
      const r = await window.dangai.importImagesPulando(faltam.map((i) => uteis[i]!.candidates[escolha[i]!]!.path))
      if (!r.ok) {
        set({ busy: null, error: r.error })
        return
      }
      const deNovo: number[] = []
      faltam.forEach((i, k) => {
        const img = r.value.imagens[k]
        if (img) {
          imagens[i] = img
          return
        }
        pulados.push(uteis[i]!.candidates[escolha[i]!]!.path.split(/[\\/]/).pop() ?? '?')
        escolha[i]! += 1
        if (uteis[i]!.candidates[escolha[i]!]) deNovo.push(i)
      })
      faltam = deNovo
    }
    // A fita de cada bloco passa a comecar pela cena que abriu (e a "trocar
    // cena" continua dali); bloco sem nenhuma fica sem fita, como os sem cena.
    let k = 0
    const blocosFinais = blocks.map((b) => {
      if (b.candidates.length === 0) return b
      const i = k++
      return imagens[i] ? { ...b, candidates: b.candidates.slice(escolha[i]) } : { ...b, candidates: [] }
    })
    const ficam = blocosFinais.filter((b) => b.candidates.length > 0)
    if (ficam.length === 0) {
      set({ busy: null, error: `Nenhuma das cenas escolhidas abriu (${pulados.slice(0, 3).join(', ')}). Confira a pasta das cenas.` })
      return
    }
    const plano = planoDosBlocos(ficam, audio.durationSec)
    // Bloco que saiu deixaria um buraco: quem vem antes estica ate o proximo.
    plano.scenes.forEach((cena, i) => {
      const proxima = plano.scenes[i + 1]
      if (proxima) cena.end = proxima.start
    })

    set({
      images: imagens.filter((img): img is ImageAsset => img !== null),
      plan: plano,
      planOrigin: 'auto',
      /*
       * Marcado como editado de proposito. O plano da montagem automatica sai
       * das FRASES da narracao; qualquer reanalise o substituiria por uma
       * distribuicao por cima, e a cena deixaria de casar com a frase que a
       * escolheu.
       */
      planEdited: true,
      automountBlocks: blocosFinais,
      automountMode: mode,
      /*
       * A transcricao vem junto da proposta, e nao de uma segunda analise.
       *
       * Transcrever de novo custaria outra passada de Whisper pelo mesmo audio
       * E daria um texto PIOR: so a passada da montagem leva os nomes da
       * biblioteca como vocabulario. Medido: com vocabulario sai "ichigo", sem
       * sai "Ischigo" -- e a legenda contradiria o corte que aquele mesmo nome
       * decidiu.
       */
      transcript,
      captions: buildCaptions(transcript, get().captionRules),
      captionsEdited: false,
      scriptNote,
      sectionNote: note,
      aiNote: null,
      selectedScene: null,
      selecionados: [],
      busy: null,
      error: pulados.length
        ? `${pulados.length === 1 ? 'Uma cena não abriu' : `${pulados.length} cenas não abriram`} (${pulados.slice(0, 3).join(', ')}): usei a próxima sugestão no lugar.`
        : null,
    })
  },

  setAutomountSeries: (series) => set({ automountSeries: series }),

  openLibraryToReplace: async (sceneIndex, metade = 'cima') => {
    set({ replaceTarget: { scene: sceneIndex, metade } })
    await get().openLibrary(true)
  },

  replaceSceneWith: async (path) => {
    const { replaceTarget, images, library } = get()
    const alvo =
      replaceTarget === null
        ? null
        : imagemDaMetade(get().plan, replaceTarget.scene, replaceTarget.metade)
    if (alvo === null || !images[alvo]) return

    set({ busy: 'Trocando a cena...', error: null, libraryOpen: false })
    const importada = await window.dangai.importImages([path])
    if (!importada.ok || !importada.value[0]) {
      set({ busy: null, replaceTarget: null, error: importada.ok ? 'Não deu para abrir essa cena.' : importada.error })
      return
    }

    /*
     * A fita da montagem automatica passa a comecar pela escolha DELE.
     *
     * Sem isto a fita seguiria anunciando o candidato que o app tinha
     * escolhido, e o card diria uma coisa enquanto a timeline mostra outra. O
     * motivo vira "escolhida por voce" porque e a verdade -- nenhuma regra
     * levou a esta cena.
     */
    const clip = library?.clips.find((c) => c.path === path)

    /*
     * A TROCA VALE PARA A SELECAO TAMBEM.
     *
     * Sem isto, voltar a selecao e remontar desfaria a troca em silencio: a
     * selecao continuaria com a cena velha, e a remontagem a traria de volta.
     * O trecho e o que contem o bloco -- e, se a mesma cena estiver em mais de
     * um, o mais perto no tempo.
     */
    const caminhoVelho = images[alvo]!.path
    const cenaTrocada = get().plan?.scenes[replaceTarget!.scene]
    const { scriptBlocks, blockClips } = get()
    let selecao = blockClips
    if (scriptBlocks && cenaTrocada) {
      let melhor = -1
      let distancia = Number.POSITIVE_INFINITY
      for (const [chave, fita] of Object.entries(blockClips)) {
        const bloco = scriptBlocks[Number(chave)]
        if (!bloco || !fita.includes(caminhoVelho)) continue
        /*
         * A frase que CONTEM o bloco ganha de qualquer outra. So "a mais perto
         * pelo comeco" errava quando o mesmo clipe estava tambem na frase
         * seguinte: o segundo bloco de uma frase comeca mais perto da proxima
         * frase do que da propria, e a troca ia parar na fita errada.
         */
        const contem = cenaTrocada.start >= bloco.start - 0.01 && cenaTrocada.start < bloco.end
        const d = contem ? -1 : Math.abs(bloco.start - cenaTrocada.start)
        if (d < distancia) {
          distancia = d
          melhor = Number(chave)
        }
      }
      if (melhor >= 0) {
        const fita = [...blockClips[melhor]!]
        fita[fita.indexOf(caminhoVelho)] = path
        selecao = { ...blockClips, [melhor]: fita }
      }
    }

    set((state) => ({
      images: state.images.map((img, i) => (i === alvo ? importada.value[0]! : img)),
      blockClips: selecao,
      automountBlocks: state.automountBlocks
        ? substituirNaFita(state.automountBlocks, alvo, path, clip)
        : null,
      busy: null,
      replaceTarget: null,
      selectedScene: replaceTarget!.scene,
      selecionados: [],
      projectDirty: true,
    }))
  },

  loadScriptBlocks: async () => {
    const { audio, subtitlePath, script, scriptBlocks, scriptBlocksBusy, transcript } = get()
    // Ja lido, ou lendo: transcrever de novo custaria outra passada de Whisper
    // pelo mesmo audio para chegar no mesmo texto.
    if (!audio || scriptBlocks || scriptBlocksBusy) return

    /*
     * O estado sozinho nao tranca, porque ele pode ser zerado POR BAIXO.
     *
     * `clearProject` limpa `scriptBlocks` e `scriptBlocksBusy` juntos, e
     * importar outra narracao faz o mesmo. Acontecendo isso no meio de uma
     * leitura, a tranca abre com a leitura ainda correndo e o proximo render
     * pede outra -- e cada pedido subia um Whisper proprio, com o modelo
     * inteiro na memoria. A promessa viva mora FORA do estado exatamente para
     * nao ser apagada junto com ele.
     */
    if (lendoRoteiro) return

    set({ scriptBlocksBusy: 'Ouvindo a narração...' })
    const pedido = window.dangai.scriptBlocks({
      audioPath: audio.path,
      subtitlePath,
      script,
      /*
       * A transcricao da importacao vai junto.
       *
       * Sem ela, o main mandava o Whisper passar de novo pelo mesmo audio para
       * chegar ao mesmo texto -- e a Biblioteca ficava minutos "ouvindo a
       * narracao" que ela ja tinha ouvido.
       */
      transcript,
    })

    lendoRoteiro = pedido
    let r
    try {
      r = await pedido
    } finally {
      lendoRoteiro = null
    }

    /*
     * A narracao ainda e a MESMA?
     *
     * A leitura leva minutos, e nesse tempo o usuario pode ter limpado o
     * projeto ou solto outro audio. Sem esta conferencia o resultado antigo
     * cairia por cima -- trechos medidos num audio que nao esta mais ali,
     * apontando para instantes que nao existem.
     */
    if (get().audio !== audio) {
      // Limpa ao sair: importar outra narracao zera `scriptBlocks` mas NAO o
      // `scriptBlocksBusy`, e deixar o antigo pendurado fecharia a tranca para
      // sempre -- a Biblioteca nunca leria o roteiro novo.
      set({ scriptBlocksBusy: null, busy: null })
      return
    }

    /*
     * `busy` tambem tem que ser limpo, e nao so o `scriptBlocksBusy`.
     *
     * O main transmite o andamento desta leitura pelo canal de analise, e o
     * App joga toda mensagem desse canal no `busy` geral. Como quem clareia o
     * `busy` e sempre a acao que o ACENDEU, e esta acendia so o proprio
     * estado, a ultima mensagem ficava pendurada para sempre -- e a cortina da
     * Biblioteca, que olha o `busy`, cobria a tela inteira com "Casando o
     * roteiro com a narracao..." depois de a leitura ja ter dado certo.
     */
    if (!r.ok) {
      set({ scriptBlocksBusy: null, busy: null, libraryError: r.error })
      return
    }
    // A leitura chegou sozinha: nao e uma edicao, e nao vira passo de Ctrl+Z
    // (desfaze-la so faria a Biblioteca ler de novo). O autosave ve.
    semPassoDeDesfazer(() =>
      set({
        scriptBlocks: r.value.blocks,
        // A transcricao vem junto e fica: as legendas saem dela sem outra passada.
        transcript: r.value.transcript,
        captions: get().captionsEdited ? get().captions : buildCaptions(r.value.transcript, get().captionRules),
        scriptNote: r.value.scriptNote,
        activeBlock: r.value.blocks.length > 0 ? 0 : null,
        scriptBlocksBusy: null,
        busy: null,
      }),
    )
  },

  trocarRoteiro: async (texto) => {
    const { audio, subtitlePath, scriptBlocks, blockClips, transcript } = get()
    if (!audio || !scriptBlocks || lendoRoteiro) {
      // Nada lido ainda: nao ha escolha para preservar.
      set({ script: texto, captionsEdited: false, scriptBlocks: null, blockClips: {}, blockWeights: {}, blockSplits: {}, blockCuts: {} })
      return
    }
    /*
     * Le os trechos do roteiro NOVO antes de mexer em qualquer coisa. Ate o
     * resultado chegar, a Biblioteca segue com o roteiro e as escolhas de antes
     * -- e se der errado, nada se perde.
     */
    set({ scriptBlocksBusy: 'Lendo o roteiro novo...' })
    const pedido = window.dangai.scriptBlocks({ audioPath: audio.path, subtitlePath, script: texto, transcript })
    lendoRoteiro = pedido
    let r
    try {
      r = await pedido
    } finally {
      lendoRoteiro = null
    }
    if (get().audio !== audio) {
      set({ scriptBlocksBusy: null, busy: null })
      return
    }
    if (!r.ok) {
      set({ scriptBlocksBusy: null, busy: null, libraryError: `O roteiro novo não entrou (${r.error}). As escolhas ficaram como estavam.` })
      return
    }
    const novos = r.value.blocks
    const remapeadas = remapearEscolhas(scriptBlocks, blockClips, novos)
    const ativo = get().activeBlock
    // UM set so: o Ctrl+Z volta roteiro, trechos e escolhas juntos.
    set({
      script: texto,
      captionsEdited: false,
      scriptNote: r.value.scriptNote,
      scriptBlocks: novos,
      transcript: r.value.transcript ?? transcript,
      captions: buildCaptions(r.value.transcript ?? transcript, get().captionRules),
      blockClips: remapeadas,
      // Peso, tela dividida e cortes por palavra eram de trechos que mudaram.
      blockWeights: {},
      blockSplits: {},
      blockCuts: {},
      activeBlock: novos.length === 0 ? null : Math.min(ativo ?? 0, novos.length - 1),
      scriptBlocksBusy: null,
      busy: null,
    })
  },

  setActiveBlock: (index) => set({ activeBlock: index }),

  voltarParaSelecao: async () => {
    /*
     * Abre a Biblioteca JA NO TRECHO do bloco em que ele esta.
     *
     * Ele volta porque alguma cena deu errado, e quase sempre esta parado em
     * cima dela na timeline. Abrir no primeiro trecho o faria procurar de novo,
     * entre ~40, a frase que ele ja estava olhando.
     */
    const { plan, selectedScene, playhead, scriptBlocks } = get()
    const cena = selectedScene === null ? null : plan?.scenes[selectedScene]
    const instante = cena ? cena.start + 0.01 : playhead
    if (scriptBlocks && scriptBlocks.length > 0) {
      let trecho = 0
      for (const [i, bloco] of scriptBlocks.entries()) {
        if (bloco.start <= instante) trecho = i
        else break
      }
      set({ activeBlock: trecho })
    }
    await get().openLibrary(true)
  },

  toggleBlockClip: (path) => {
    const { activeBlock, blockClips } = get()
    if (activeBlock === null) return
    const atuais = blockClips[activeBlock] ?? []
    /*
     * A ordem e a de MARCACAO, nao a da grade.
     *
     * Dentro de uma frase a ordem e a do argumento dele -- a grade so sabe a
     * ordem do episodio, que em video de teoria nao quer dizer nada.
     */
    const proximos = atuais.includes(path)
      ? atuais.filter((p) => p !== path)
      : [...atuais, path]
    /*
     * Mexer na fita zera os pesos DAQUELE trecho.
     *
     * O peso e por POSICAO na fita. Tirar a cena do meio faria o peso dela
     * escorregar para a vizinha em silencio, e o video sairia com o ritmo
     * trocado sem ninguem ter pedido.
     */
    const { [activeBlock]: _fora, ...outrosPesos } = get().blockWeights
    const { [activeBlock]: _foraSplit, ...outrasUnioes } = get().blockSplits
    // A fronteira puxada tambem e por posicao: mudar o numero de cenas a
    // transforma numa fronteira de uma divisao que nao existe mais.
    const { [activeBlock]: _foraCorte, ...outrosCortes } = get().blockCuts
    set({
      blockClips: { ...blockClips, [activeBlock]: proximos },
      blockWeights: outrosPesos,
      blockSplits: outrasUnioes,
      blockCuts: outrosCortes,
      /*
       * Marcar cena AGORA suja o projeto.
       *
       * Nao sujava antes, e estava certo: a marcacao nao ia para o arquivo,
       * entao nao havia o que salvar. Agora que ela vai, nao sujar seria pior
       * que o problema original -- ele fecharia o app sem nenhuma pergunta e
       * perderia a tarde de marcacao achando que nada tinha mudado.
       */
      projectDirty: true,
    })
  },

  /*
   * Marcar poe no FIM da fila, sempre.
   *
   * E o que faz a ordem ser a de clique e nao a da grade -- em video de teoria
   * a ordem e a do argumento, que nenhuma ordenacao do acervo conhece.
   */
  alternarEscolhido: (id) =>
    set((state) => ({
      escolhidos: state.escolhidos.includes(id)
        ? state.escolhidos.filter((x) => x !== id)
        : [...state.escolhidos, id],
      // Suja o projeto: a fila vai para o arquivo, e fechar sem aviso depois
      // de marcar quarenta cenas seria perder tudo em silencio.
      projectDirty: true,
    })),

  /*
   * Tirar da fila sem voltar na grade.
   *
   * Desmarcar so existia clicando no cartao de novo -- e achar de novo um
   * cartao entre milhares, depois de ter mudado de filtro, e uma busca. Ele
   * pediu exatamente isso: "quero a opcao de remover um clipe selecionado, nao
   * so tendo que clicar manualmente no clipe novamente".
   */
  removerEscolhido: (id) =>
    set((state) => ({
      escolhidos: state.escolhidos.filter((x) => x !== id),
      projectDirty: true,
    })),

  limparEscolhidos: () => set({ escolhidos: [], projectDirty: true }),

  juntarTrechos: (blockIndex) => aplicarMarcacoes(set, get, (m) => juntarComOProximo(m, blockIndex)),

  separarTrecho: (blockIndex) => aplicarMarcacoes(set, get, (m) => separarPedacos(m, blockIndex)),

  reorderBlockClips: (blockIndex, paths) => {
    /*
     * Sem isto, errar a ordem custava desmarcar e remarcar tudo.
     *
     * Dentro de uma frase a ordem e a do argumento dele, nao a do episodio --
     * nenhuma ordenacao automatica sabe qual imagem vem primeiro em "comprime
     * uma nuvem carregada". Por isso ela precisa ser arrastavel, e nao apenas a
     * ordem em que ele calhou de clicar.
     */
    set((state) => {
      // Reordenar tambem invalida o peso por posicao, pelo mesmo motivo.
      const { [blockIndex]: _fora, ...outros } = state.blockWeights
      const { [blockIndex]: _foraSplit, ...semUniao } = state.blockSplits
      const { [blockIndex]: _foraCorte, ...semCortes } = state.blockCuts
      return {
        blockClips: { ...state.blockClips, [blockIndex]: [...paths] },
        blockWeights: outros,
        blockSplits: semUniao,
        blockCuts: semCortes,
        // A ordem vai para o .dangai: reordenar sem sujar seria perder a ordem
        // nova no proximo fechar, sem pergunta nenhuma.
        projectDirty: true,
      }
    })
  },

  toggleBlockSplit: (blockIndex, posicao) => {
    /*
     * Une a cena com a SEGUINTE, e as duas passam a ocupar um slot so.
     *
     * Em recap ele quer, as vezes, mostrar duas cenas ao mesmo tempo -- reacao
     * em cima, o que causou embaixo. O par nao ganha tempo extra: ele divide o
     * trecho como uma cena unica dividiria, e o peso continua sendo do par.
     *
     * Uniao encadeada nao existe: unir 1-2 e 2-3 daria tres cenas num quadro
     * partido em dois. Por isso unir a posicao 1 desfaz qualquer uniao que a 0
     * tivesse com ela.
     */
    set((state) => {
      const cenas = state.blockClips[blockIndex] ?? []
      if (posicao < 0 || posicao + 1 >= cenas.length) return {}
      const atuais = state.blockSplits[blockIndex] ?? []
      const proximos = atuais.includes(posicao)
        ? atuais.filter((i) => i !== posicao)
        : [...atuais.filter((i) => i !== posicao - 1 && i !== posicao + 1), posicao].sort((a, b) => a - b)
      // Unir junta dois slots num so: as fronteiras puxadas eram de outra
      // divisao e nao querem dizer mais nada.
      const { [blockIndex]: _foraCorte, ...semCortes } = state.blockCuts
      return {
        blockSplits: { ...state.blockSplits, [blockIndex]: proximos },
        blockCuts: semCortes,
        projectDirty: true,
      }
    })
  },

  duplicateBlockClip: (blockIndex, posicao) => {
    /*
     * Repetir a mesma cena e legitimo, e ate agora nao dava.
     *
     * O clique no cartao ALTERNA -- e assim que ele desmarca --, entao clicar
     * de novo numa cena ja marcada tirava a cena em vez de repetir. A repeticao
     * ganha um gesto proprio, na fita, onde a ordem ja e visivel: a copia entra
     * logo depois da original.
     *
     * Palavras dele: "em alguns momentos e cabivel eu colocar a mesma cena
     * novamente e hj eu nao posso fazer isso".
     */
    set((state) => {
      const atuais = state.blockClips[blockIndex] ?? []
      const alvo = atuais[posicao]
      if (alvo === undefined) return {}
      const proximos = [...atuais.slice(0, posicao + 1), alvo, ...atuais.slice(posicao + 1)]
      // A fita mudou de tamanho: o peso e por POSICAO e nao sobrevive a isso.
      const { [blockIndex]: _fora, ...outrosPesos } = state.blockWeights
      const { [blockIndex]: _foraSplit, ...semUniao } = state.blockSplits
      const { [blockIndex]: _foraCorte, ...semCortes } = state.blockCuts
      return {
        blockClips: { ...state.blockClips, [blockIndex]: proximos },
        blockWeights: outrosPesos,
        blockSplits: semUniao,
        blockCuts: semCortes,
        projectDirty: true,
      }
    })
  },

  setBlockWeight: (blockIndex, posicao, peso) => {
    /*
     * Tres niveis, 1x a 3x, escolhidos por menos e mais.
     *
     * Era um ciclo num "1x" de 9 pixels, e ele nao tinha como saber o que
     * aquilo era: "o que significa aquele 1x em cima do bloco?". Agora a fita
     * mostra os SEGUNDOS que a cena ganha, com menos e mais do lado -- o peso
     * continua existindo, mas como mecanismo, e nao como a coisa que ele le.
     *
     * Continua curto de proposito: a decisao e "esta aqui importa mais", e o
     * ajuste fino ja existe na linha do tempo, depois de montado.
     */
    set((state) => {
      const quantas = (state.blockClips[blockIndex] ?? []).length
      if (posicao < 0 || posicao >= quantas) return {}
      const atuais = state.blockWeights[blockIndex] ?? []
      const pesos = Array.from({ length: quantas }, (_, i) => atuais[i] ?? 1)
      pesos[posicao] = Math.min(Math.max(Math.round(peso), 1), 3)
      /*
       * Mexer no peso devolve o trecho a divisao proporcional.
       *
       * Peso e fronteira puxada sao dois jeitos de dizer onde a cena comeca, e
       * a puxada ganha. Sem isto, clicar no 2x com o trecho ja puxado nao faria
       * absolutamente nada e pareceria botao quebrado.
       */
      const { [blockIndex]: _foraCorte, ...semCortes } = state.blockCuts
      return {
        blockWeights: { ...state.blockWeights, [blockIndex]: pesos },
        blockCuts: semCortes,
        projectDirty: true,
      }
    })
  },

  removeBlockClip: (blockIndex, posicao) => {
    /*
     * Tirar uma cena direto da fita, e nao so desmarcando o cartao na grade.
     *
     * "Eu nao tenho como clicar pra remover um bloco." Desmarcar existia so na
     * grade da Biblioteca -- achar de novo o cartao entre milhares, depois de
     * ter trocado de filtro, so para tirar uma cena que esta bem ali na fita.
     */
    set((state) => {
      const r = tirarDaFita(
        state.blockClips[blockIndex] ?? [],
        state.blockWeights[blockIndex],
        state.blockSplits[blockIndex],
        posicao,
      )
      if (!r) return {}
      const { [blockIndex]: _foraCorte, ...semCortes } = state.blockCuts
      return {
        blockClips: { ...state.blockClips, [blockIndex]: r.cenas },
        blockWeights: { ...state.blockWeights, [blockIndex]: r.pesos },
        blockSplits: { ...state.blockSplits, [blockIndex]: r.unioes },
        blockCuts: semCortes,
        projectDirty: true,
      }
    })
  },

  setBlockCut: (blockIndex, fronteira, palavra) => {
    set((state) => {
      const cenas = state.blockClips[blockIndex] ?? []
      const bloco = state.scriptBlocks?.[blockIndex]
      if (!bloco || cenas.length === 0) return {}

      const slots = slotsDoTrecho(cenas, state.blockWeights[blockIndex], state.blockSplits[blockIndex])
      const palavras = palavrasDoTrecho(state.transcript?.words ?? [], bloco.start, bloco.end)
      if (!cabeCortePorPalavra(slots.length, palavras.length)) return {}
      if (fronteira < 0 || fronteira >= slots.length - 1) return {}

      /*
       * O primeiro arraste congela TODAS as fronteiras onde elas ja estavam.
       *
       * Sem isso, puxar a segunda fronteira faria a primeira -- ate entao
       * proporcional -- se recalcular junto, e o trecho se reorganizaria
       * inteiro a cada arraste.
       */
      const atuais =
        state.blockCuts[blockIndex]?.length === slots.length - 1
          ? state.blockCuts[blockIndex]!
          : cortesAutomaticos(slots, palavras, bloco.start, bloco.end)

      /*
       * A fronteira PARA na vizinha em vez de empurra-la.
       *
       * Sem este limite, arrastar a primeira ate o fim levava a segunda junto e
       * o trecho inteiro se reorganizava -- o oposto de "uma palavra antes".
       */
      const { min, max } = limitesDaFronteira(atuais, fronteira, slots.length, palavras.length)
      const preso = Math.min(Math.max(palavra, min), max)
      const proximos = prender(
        atuais.map((v, k) => (k === fronteira ? preso : v)),
        slots.length,
        palavras.length,
      )
      return { blockCuts: { ...state.blockCuts, [blockIndex]: proximos }, projectDirty: true }
    })
  },

  clearBlockCuts: (blockIndex) => {
    set((state) => {
      if (!state.blockCuts[blockIndex]) return {}
      const { [blockIndex]: _fora, ...resto } = state.blockCuts
      return { blockCuts: resto, projectDirty: true }
    })
  },

  applyBlockClips: async () => {
    const { scriptBlocks, blockClips, blockWeights, blockSplits, blockCuts, transcript, audio } =
      get()
    if (!scriptBlocks || !audio) return

    /*
     * Cada frase se divide igualmente entre as cenas que ELE marcou nela.
     *
     * Igualmente e nao por pausa: dentro de uma frase nao ha pontuacao para
     * consultar, e inventar um ritmo aqui seria decidir por ele exatamente onde
     * ele acabou de pedir para decidir. Frase sem cena nenhuma nao vira bloco --
     * o tempo dela e absorvido pela cena anterior, que so fica mais longa.
     */
    const caminhos: string[] = []
    // Para cada slot, os indices em `caminhos` das suas imagens: um so em tela
    // cheia, dois quando ele uniu as cenas.
    const pares: number[][] = []
    const spans: { start: number; end: number }[] = []
    for (const [i, frase] of scriptBlocks.entries()) {
      const cenas = blockClips[i] ?? []
      if (cenas.length === 0) continue

      /*
       * A conta de como o trecho se reparte mora em @shared/trecho, e nao aqui.
       *
       * Ela roda em dois lugares -- aqui e na pintura das palavras da coluna do
       * roteiro. Enquanto eram duas contas parecidas elas DIVERGIRAM: a pintura
       * dividia em partes iguais enquanto o video ja respeitava o peso, e a cor
       * mostrava uma coisa enquanto o mp4 fazia outra.
       */
      const slots = slotsDoTrecho(cenas, blockWeights[i], blockSplits[i])
      const palavras = palavrasDoTrecho(transcript?.words ?? [], frase.start, frase.end)
      const cortes = blockCuts[i]?.length === slots.length - 1 ? blockCuts[i]! : null
      const doTrecho = spansDoTrecho(frase.start, frase.end, slots, palavras, cortes)

      for (const [k, slot] of slots.entries()) {
        pares.push(
          slot.paths.map((path) => {
            caminhos.push(path)
            return caminhos.length - 1
          }),
        )
        spans.push(doTrecho[k]!)
      }
    }

    if (caminhos.length === 0) {
      set({ libraryError: 'Marque pelo menos uma cena em algum trecho.' })
      return
    }

    /*
     * Marca que sobrou de um roteiro ANTERIOR nao entra em silencio.
     *
     * blockClips e indexado por posicao do trecho. Se o roteiro foi relido e
     * encurtou, os indices que passam do fim nao viram bloco nenhum -- e o que
     * ele marcou simplesmente nao aparece no video. Melhor dizer.
     */
    const perdidas = Object.entries(blockClips).filter(
      ([chave, cenas]) => cenas.length > 0 && Number(chave) >= scriptBlocks.length,
    )
    if (perdidas.length > 0) {
      set({
        libraryError:
          `${perdidas.length} ${perdidas.length === 1 ? 'trecho marcado não existe' : 'trechos marcados não existem'} ` +
          'mais no roteiro -- ele mudou depois que você marcou. Limpe e marque de novo.',
      })
      return
    }

    /*
     * REAPROVEITA os clipes que ja estao no projeto, e so importa os novos.
     *
     * Remontar reimportava tudo: o enquadramento que ele arrastou voltava ao
     * rosto detectado, o cache do upscale era pago de novo, e o bloco novo nao
     * tinha como saber qual velho ele era. Com o mesmo asset de volta, as tres
     * coisas se resolvem -- ver @shared/remontar.
     */
    const { images: imagensVelhas, plan: planoVelho } = get()
    const reusadas = reaproveitar(caminhos, imagensVelhas)
    const faltam = caminhos.filter((_, i) => reusadas[i] === null)

    set({
      busy:
        faltam.length === 0
          ? 'Remontando...'
          : `Trazendo ${faltam.length} ${faltam.length === 1 ? 'cena' : 'cenas'}...`,
      libraryError: null,
    })
    let novas: ImageAsset[] = []
    if (faltam.length > 0) {
      const importadas = await window.dangai.importImages(faltam)
      if (!importadas.ok) {
        set({ busy: null, error: importadas.error })
        return
      }
      novas = importadas.value
    }
    let proxima = 0
    const imagens = reusadas.map((img) => img ?? novas[proxima++]!)

    /*
     * As cenas se costuram, e a EMENDA CAI NO COMECO DA FALA SEGUINTE.
     *
     * Vao no plano e tela preta no video, entao alguem tem que ficar com a
     * pausa entre uma frase e outra. Ate aqui quem ficava era a cena NOVA: ela
     * comecava onde a anterior tinha acabado, ou seja, no silencio, antes de a
     * frase dela comecar. Era isso que fazia "o clipe nao iniciar aonde estava
     * marcado pelo roteiro" -- a Biblioteca prometia a cena casada com a frase,
     * e o video trocava a imagem antes de a frase comecar.
     *
     * MEDIDO no projeto dele (Ram x Lye, 42 trechos, 272 palavras): 1,98s de
     * pausa somada em 41 emendas, mediana 0,030s, nove emendas acima de 0,10s
     * e a maior com 0,240s -- quase seis frames de imagem nova em cima do
     * silencio da frase anterior.
     *
     * Agora quem segura a pausa e a cena ANTERIOR, que so fica um pouco mais
     * longa. A imagem troca quando a fala troca, que e onde o olho espera. O
     * mesmo vale para frase sem cena nenhuma: o tempo dela inteiro e absorvido
     * por quem vem antes. As pontas seguem presas ao zero e ao fim da narracao.
     */
    const blocos = spans.map((s, i) => ({
      start: i === 0 ? 0 : s.start,
      end:
        i === spans.length - 1
          ? Math.max(s.end, audio.durationSec)
          : spans[i + 1]!.start,
      text: '',
      characters: [],
      candidates: [],
    }))

    /*
     * Cada bloco herda os ajustes do bloco que ja mostrava o MESMO clipe:
     * camera, efeito, curva, trecho do clipe, giro. Voltar a selecao para
     * consertar UMA cena nao pode custar o trabalho feito em todas as outras.
     */
    const { plan } = herdarAjustes(
      planoDosBlocos(blocos, audio.durationSec, pares),
      imagens,
      planoVelho,
      imagensVelhas,
    )

    set({
      images: imagens,
      plan,
      planOrigin: 'auto',
      // O plano saiu das frases dele; reanalisar o trocaria por distribuicao.
      planEdited: true,
      automountBlocks: null,
      libraryOpen: false,
      selectedScene: null,
      selecionados: [],
      busy: null,
      projectDirty: true,
    })
  },

  swapCandidate: async (blockIndex, candidateIndex) => {
    const { automountBlocks, images } = get()
    const bloco = automountBlocks?.[blockIndex]
    const escolhido = bloco?.candidates[candidateIndex]
    if (!automountBlocks || !bloco || !escolhido) return

    /*
     * O indice na TIMELINE nao e o indice no roteiro: bloco sem cena nao virou
     * imagem. Contar quantos blocos uteis vieram antes e o que liga os dois.
     */
    const posicao = automountBlocks
      .slice(0, blockIndex)
      .filter((b) => b.candidates.length > 0).length
    if (!images[posicao]) return

    set({ busy: 'Trocando a cena...', error: null })
    const importada = await window.dangai.importImages([escolhido.path])
    if (!importada.ok || !importada.value[0]) {
      set({ busy: null, error: importada.ok ? 'Não deu para abrir essa cena.' : importada.error })
      return
    }

    // A fita passa a comecar pelo escolhido, para o proximo clique na seta
    // continuar de onde ele parou em vez de voltar ao comeco.
    const reordenada = [
      escolhido,
      ...bloco.candidates.filter((_c, i) => i !== candidateIndex),
    ]

    set((state) => ({
      images: state.images.map((img, i) => (i === posicao ? importada.value[0]! : img)),
      automountBlocks: state.automountBlocks!.map((b: AutomountBlock, i: number) =>
        i === blockIndex ? { ...b, candidates: reordenada } : b,
      ),
      busy: null,
      projectDirty: true,
    }))
  },
})


/**
 * A leitura do roteiro em andamento, se houver.
 *
 * Fora do estado de proposito: e justamente quando o estado e zerado no meio
 * de uma leitura que a tranca precisa continuar valendo.
 */
let lendoRoteiro: Promise<unknown> | null = null
