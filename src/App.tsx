import { useEffect } from 'react'
import { useProject } from '@/store/project'
import { startAutosave } from '@/store/autosave'
import { desfazer, refazer, startUndo } from '@/store/undo'
import { aplicarEstiloGuardado, startEstiloLegenda } from '@/store/estilo-legenda'
import { carregarBins } from '@/store/bins'
import { Bins } from '@/components/Bins'
import { Divisor } from '@/components/Divisor'
import { LAYOUT_PADRAO, useFerramenta, useIma, useLayout } from '@/store/layout'
import { useRecentes } from '@/store/recentes'
import { acaoDoCombo, comboDoEvento, ehTeclaSolta, useAtalhos } from '@/store/atalhos'
import { useFileDrop } from '@/hooks/useFileDrop'
import { Dropzone } from '@/components/Dropzone'
import { Timeline } from '@/components/Timeline'
import { ImageStrip } from '@/components/ImageStrip'
import { Automount } from '@/components/Automount'
import { SceneCard } from '@/components/SceneCard'
import { SceneEdit } from '@/components/SceneEdit'
import { SobreposicaoEdit } from '@/components/SobreposicaoEdit'
import { Preview } from '@/components/Preview'
import { RenderBar } from '@/components/RenderBar'
import { StatusBar } from '@/components/StatusBar'
import { Settings } from '@/components/Settings'
import { Script } from '@/components/Script'
import { CaptionEditor } from '@/components/CaptionEditor'
import { CommandPalette } from '@/components/CommandPalette'
import { Library } from '@/components/Library'
import { Queue } from '@/components/Queue'
import { VIDEO_FPS } from '@shared/contract'

/** O foco esta num lugar onde o proprio campo trata o teclado. */
function editando(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false
  return (
    alvo instanceof HTMLInputElement ||
    alvo instanceof HTMLTextAreaElement ||
    alvo.isContentEditable
  )
}

export function App() {
  const isDragging = useFileDrop()
  const phase = useProject((s) => s.phase())
  const applyRenderProgress = useProject((s) => s.applyRenderProgress)
  const setBusy = useProject((s) => s.setBusy)
  const captionsOpen = useProject((s) => s.captionsOpen)
  const binsOpen = useProject((s) => s.binsOpen)
  const temBloco = useProject((s) => s.selectedScene !== null && s.plan !== null)
  // O clipe da faixa de video escolhido: o inspetor dele toma o lugar dos
  // controles do bloco enquanto estiver escolhido.
  const clipeDeVideo = useProject((s) => (s.clipeSelecionado?.tipo === 'video' ? s.clipeSelecionado.id : null))
  const layout = useLayout()
  const refreshSfx = useProject((s) => s.refreshSfx)
  const refreshFontes = useProject((s) => s.refreshFontes)
  const setUpdate = useProject((s) => s.setUpdate)
  const setAppVersion = useProject((s) => s.setAppVersion)
  const checkAutosave = useProject((s) => s.checkAutosave)
  const setLibraryBusy = useProject((s) => s.setLibraryBusy)
  const projectPath = useProject((s) => s.projectPath)
  const projectDirty = useProject((s) => s.projectDirty)

  // Progresso do render vindo do main.
  useEffect(() => window.dangai.onRenderProgress(applyRenderProgress), [applyRenderProgress])

  // Lista de SFX na abertura: ela define quantos sons entram no video.
  useEffect(() => void refreshSfx(), [refreshSfx])

  // As fontes tambem: um projeto aberto guarda so o NOME do arquivo, e e esta
  // leitura que reencontra a URL dele -- ou derruba a escolha, se ele apagou.
  useEffect(() => void refreshFontes(), [refreshFontes])

  // Atualizacao do app: o main avisa, a barra de status mostra.
  useEffect(() => window.dangai.onUpdateStatus(setUpdate), [setUpdate])
  useEffect(() => {
    void window.dangai.appVersion().then((r) => {
      if (r.ok) setAppVersion(r.value)
    })
  }, [setAppVersion])

  // Andamento da analise: Whisper e a chamada da IA levam tempo e nenhum
  // carregamento pode ficar sem sinal visivel.
  useEffect(() => window.dangai.onAnalyzeProgress((message) => setBusy(message)), [setBusy])
  useEffect(
    () => window.dangai.onVideoProntoProgress((p) => useProject.getState().setVideoProntoProgresso(p)),
    [],
  )

  // A primeira varredura da biblioteca gera as miniaturas locais e leva perto de
  // um minuto. Sem este sinal, um minuto parado parece travamento.
  useEffect(() => window.dangai.onLibraryProgress(setLibraryBusy), [setLibraryBusy])

  // Autosave e a pergunta "sobrou algo da sessao passada?", nesta ordem: o
  // observador precisa estar de pe antes de qualquer coisa mexer no estado.
  useEffect(() => startAutosave(), [])
  // Antes de qualquer coisa mexer no estado, como o autosave: os dois observam
  // o documento e precisam ver a primeira edicao da sessao.
  useEffect(() => startUndo(), [])
  /*
   * O estilo de legenda guardado vale como ponto de partida, e dai em diante o
   * que ele deixar vira o padrao do proximo video. Aplicar ANTES de o
   * observador comecar evitaria um salvamento redundante, mas a ordem aqui e
   * indiferente: o guard de carregamento cobre os dois casos.
   */
  useEffect(() => startEstiloLegenda(), [])
  useEffect(() => void aplicarEstiloGuardado(), [])
  useEffect(() => void carregarBins(), [])
  useEffect(() => void checkAutosave(), [checkAutosave])

  /*
   * A barra de titulo da janela e o unico lugar onde cabe dizer QUAL projeto
   * esta aberto sem gastar espaco da interface. O ponto antes do nome e a
   * convencao de "tem coisa nao salva" que todo editor usa.
   */
  // Todo projeto aberto ou salvo num caminho entra nos recentes da tela inicial.
  useEffect(() => {
    if (projectPath) void useRecentes.getState().lembrar(projectPath)
  }, [projectPath])

  useEffect(() => {
    const nome = projectPath?.split(/[\\/]/).pop()?.replace(/\.dangai$/i, '') ?? null
    document.title = nome
      ? `${projectDirty ? '• ' : ''}${nome} — Dangai`
      : `${projectDirty ? '• ' : ''}Dangai`
  }, [projectPath, projectDirty])

  useEffect(() => void useAtalhos.getState().carregar(), [])

  useEffect(() => {
    /*
     * OS ATALHOS SAO DELE: cada tecla e procurada no mapa de @/store/atalhos,
     * que ele troca nas configuracoes. Aqui so mora o que cada ACAO faz.
     */
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useProject.getState()
      const rendering = store.phase() === 'rendering'
      const combo = comboDoEvento(event)
      const acao = combo ? acaoDoCombo(combo) : null

      // A paleta e os modais tratam o proprio teclado; enquanto abertos, os
      // atalhos globais ficam quietos para nao disparar por baixo.
      if (store.paletteOpen || store.settingsOpen || store.scriptOpen || store.libraryOpen) {
        if (acao === 'paleta') {
          event.preventDefault()
          store.openPalette(false)
          return
        }

        /*
         * Salvar NUNCA fica bloqueado.
         *
         * Em 12/09/2026 o app ficou preso com o trabalho de uma tarde por
         * gravar, e nao havia como salvar. Salvar nao mexe na tela, nao pode
         * dar errado e e exatamente o que se quer poder fazer quando algo
         * travou -- nao ha motivo para um modal aberto tirar isso da mao do
         * usuario.
         */
        if (acao === 'salvar' || acao === 'salvarComo') {
          event.preventDefault()
          void store.saveProject(acao === 'salvarComo')
          return
        }

        /*
         * Esc fecha TUDO, como ultimo recurso.
         *
         * Cada modal ja trata o proprio Esc, e com a tela no ar este daqui nao
         * muda nada. Ele existe para o caso contrario: uma marca de "aberto"
         * que sobrou no estado sem nada na tela para limpa-la deixa o app
         * inteiro sem atalho e sem saida -- so restaria fechar na marra, com o
         * que nao foi salvo junto. Digitando nao vale: ali o Esc e de quem
         * esta no campo.
         */
        if (event.key === 'Escape' && !editando(event.target)) {
          store.openPalette(false)
          store.openSettings(false)
          store.openScript(false)
          void store.openLibrary(false)
          return
        }

        return
      }

      // Esc devolve a ferramenta de agulha, como sair de um modo no editor.
      if (event.key === 'Escape' && !editando(event.target) && useFerramenta.getState().ferramenta === 'selecao') {
        useFerramenta.getState().definir('agulha')
        return
      }

      if (!acao || !combo) return

      /*
       * COPIAR E COLAR CLIPE DE FAIXA. Num campo de texto, ou sem clipe
       * escolhido, o Ctrl+C e o Ctrl+V continuam sendo do texto -- o evento
       * segue adiante sem preventDefault.
       */
      if (acao === 'copiar' || acao === 'colar') {
        if (editando(event.target) || rendering) return
        if (acao === 'copiar' ? store.copiarClipe() : store.colarClipe()) event.preventDefault()
        return
      }

      /*
       * Digitando num campo, tecla solta e LETRA -- o C, o X e o espaco sao do
       * texto. E o Ctrl+Z e do campo: desfazer o projeto inteiro porque a
       * pessoa errou uma letra seria um susto. Salvar continua valendo.
       */
      if (editando(event.target)) {
        if (ehTeclaSolta(combo)) return
        if (acao === 'desfazer' || acao === 'refazer') return
      }

      /*
       * Durante o render nada que mexa no projeto: o video sendo gerado usa o
       * estado de agora, e mudar no meio produziria um MP4 que nao corresponde
       * nem ao antes nem ao depois.
       */
      const mexeNoProjeto: readonly string[] = [
        'tocar', 'quadroAnterior', 'quadroSeguinte', 'corteAnterior', 'corteSeguinte', 'inicio', 'fim',
        'cortar', 'excluir', 'desfazer', 'refazer', 'abrir', 'selecao',
      ]
      if (rendering && mexeNoProjeto.includes(acao)) return

      event.preventDefault()
      const scenes = store.plan?.scenes ?? []
      const irPara = (t: number): void => {
        store.setPlayhead(Math.max(0, t))
        const sob = scenes.findIndex((c) => t >= c.start && t < c.end)
        if (sob !== -1) store.selectScene(sob)
      }

      switch (acao) {
        case 'tocar':
          store.togglePlay()
          break
        case 'quadroAnterior':
          store.setPlayhead(store.playhead - 1 / VIDEO_FPS)
          break
        case 'quadroSeguinte':
          store.setPlayhead(store.playhead + 1 / VIDEO_FPS)
          break
        case 'corteAnterior': {
          // Um pouco de folga: parado EM um corte, o anterior e o de antes dele.
          const antes = scenes.map((c) => c.start).filter((t) => t < store.playhead - 0.01)
          irPara(antes.length > 0 ? antes[antes.length - 1]! : 0)
          break
        }
        case 'corteSeguinte': {
          const depois = scenes.map((c) => c.start).find((t) => t > store.playhead + 0.01)
          irPara(depois ?? scenes[scenes.length - 1]?.end ?? store.playhead)
          break
        }
        case 'inicio':
          irPara(0)
          break
        case 'fim':
          store.setPlayhead(scenes[scenes.length - 1]?.end ?? store.audio?.durationSec ?? 0)
          break
        case 'cortar':
          // Com um clipe de faixa escolhido sob a agulha, corta ELE -- como a
          // lamina do editor. Sem clipe escolhido, corta o bloco.
          if (store.cortarClipeNaAgulha()) break
          store.splitSceneAtPlayhead()
          break
        case 'excluir': {
          /*
           * "O X para excluir o que eu tiver selecionado": o clipe de faixa
           * escolhido, se houver; senao os blocos marcados na timeline (do
           * ultimo para o primeiro, para os indices nao andarem no meio).
           */
          // Todos os clipes escolhidos de uma vez (Ctrl+clique ou o laco).
          if (store.removerClipesEscolhidos()) break
          const alvos =
            store.selecionados.length > 1
              ? store.selecionados
              : store.selectedScene !== null
                ? [store.selectedScene]
                : []
          for (const i of [...alvos].sort((a, b) => b - a)) store.removeScene(i)
          break
        }
        case 'ima':
          useIma.getState().alternar()
          break
        case 'ferramentaSelecao':
          useFerramenta.getState().alternar()
          break
        case 'desfazer':
          desfazer()
          break
        case 'refazer':
          refazer()
          break
        case 'salvar':
        case 'salvarComo':
          void store.saveProject(acao === 'salvarComo')
          break
        case 'abrir':
          void store.openProject()
          break
        case 'renderizar':
          if (!rendering) void store.startRender()
          break
        case 'paleta':
          store.openPalette(true)
          break
        case 'selecao':
          // Mesma volta do botao "Selecao": abre no trecho do bloco atual.
          void store.voltarParaSelecao()
          break
        case 'legendas':
          store.openCaptions(!store.captionsOpen)
          break
        case 'bins':
          store.openBins(!store.binsOpen)
          break
        case 'configuracoes':
          store.openSettings(!store.settingsOpen)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex h-full flex-col bg-bg">
      {/*
       * A troca de estado usa keyframes CSS (utility `enter`), nao motion. O
       * conteudo principal nunca fica dependendo de JS para se tornar visivel --
       * ver o comentario da keyframe em index.css.
       */}
      {phase === 'empty' ? (
        <main className="enter flex-1 p-6">
          <Dropzone isDragging={isDragging} />
        </main>
      ) : (
        <main className="enter flex min-h-0 flex-1 flex-col px-6 pt-6 pb-3">
          {/*
            O LAYOUT E DELE, como no Premiere: as divisorias se arrastam (a
            altura da linha do tempo e a largura da coluna do bloco), e o
            preview mora ao lado do bloco -- "coloca ele do lado direito de
            'Bloco', onde eu posso configurar o trecho do clipe" -- ou na
            direita, pelo botao Layout. Ver @/store/layout.
          */}
          <div className="flex min-h-0 flex-1">
            {temBloco && (
              <>
                <div className="flex min-h-0 shrink-0" style={{ width: layout.larguraDoBloco }}>
                  <SceneCard />
                </div>
                <Divisor
                  eixo="x"
                  valor={layout.larguraDoBloco}
                  min={200}
                  max={420}
                  onChange={(v) => layout.mudar({ larguraDoBloco: v })}
                  onPadrao={() => layout.mudar({ larguraDoBloco: LAYOUT_PADRAO.larguraDoBloco })}
                  titulo="Largura da coluna do bloco"
                />
              </>
            )}
            {layout.previewAoLado && (
              <div className="mr-4 flex min-h-0 shrink-0">
                <Preview />
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <ImageStrip />
              <Automount />
              {/*
                A area do meio REVEZA, e nao acumula: legendas, bins ou os
                controles do bloco.
              */}
              {captionsOpen ? (
                <CaptionEditor />
              ) : binsOpen ? (
                <Bins />
              ) : clipeDeVideo ? (
                <SobreposicaoEdit id={clipeDeVideo} />
              ) : (
                <SceneEdit />
              )}
            </div>
            {!layout.previewAoLado && (
              <div className="ml-6 flex min-h-0 shrink-0">
                <Preview />
              </div>
            )}
          </div>

          <Divisor
            eixo="y"
            valor={layout.alturaDeBaixo}
            min={190}
            max={Math.max(260, Math.round(window.innerHeight * 0.75))}
            sinal={-1}
            onChange={(v) => layout.mudar({ alturaDeBaixo: v })}
            onPadrao={() => layout.mudar({ alturaDeBaixo: LAYOUT_PADRAO.alturaDeBaixo })}
            titulo="Altura da linha do tempo"
          />

          <div className="flex min-h-0 shrink-0 flex-col gap-3" style={{ height: layout.alturaDeBaixo }}>
            <RenderBar />
            <Timeline />
          </div>
        </main>
      )}

      {/*
        Fora do <main>: a fila sobrevive a troca de estado vazio/editando, que
        acontece sozinha a cada projeto que ela abre.
      */}
      <div className="px-6 pb-4 empty:hidden">
        <Queue />
      </div>

      <StatusBar isDragging={isDragging} />
      <Settings />
      <Script />
      <Library />
      <CommandPalette />
    </div>
  )
}
