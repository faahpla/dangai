import { emitir } from '@/modulos/ganchos'
import type { MusicPick } from '@shared/channels'
import { temDadosDeModulo } from '@shared/contract'
import { repararMetadesDeBaixo } from '@shared/indices'
import { chavesDesconhecidas, versaoParaGravar, type ProjectFile } from '@shared/project-file'
import type { GetProjeto, ProjectState, SetProjeto } from '../project'
import { semSujar } from '../quiet'
import type { SetState } from './apoio'

/** Do store do editor (ver ../project.ts): salvar, abrir e o autosave. */
export type FatiaDoArquivo = Pick<ProjectState, 'toProjectFile' | 'saveProject' | 'openProject' | 'checkAutosave' | 'restoreAutosave' | 'discardAutosave' | 'markSaved'>

export const fatiaDoArquivo = (set: SetProjeto, get: GetProjeto): FatiaDoArquivo => ({

  // ------------------------------------------------------------------ projeto

  toProjectFile: () => {
    const state = get()
    if (!state.audio) return null

    // `rel` sai null daqui: quem sabe para onde o arquivo esta indo e o main,
    // que recalcula todos na hora de gravar. "Salvar como" em outra pasta
    // reescreve os caminhos relativos sem o renderer participar.
    const sobreposicoes = state.sobreposicoes.map(({ url: _fora, ...resto }) => resto)
    const trilhas = state.trilhas.map(({ url: _fora, ...resto }) => resto)
    const modulos = temDadosDeModulo(state.modulos) ? state.modulos : undefined
    return {
      // O que veio de um app irmao (ou de uma versao futura) volta como veio.
      // Primeiro, para nada daqui ser sobrescrito por ele.
      ...state.extrasDoProjeto,
      version: versaoParaGravar({ modulos, trilhas, sobreposicoes }),
      savedAt: new Date().toISOString(),
      formato: state.formato,
      audio: { path: state.audio.path, rel: null, fileName: state.audio.fileName },
      images: state.images.map((image) => ({
        path: image.path,
        rel: null,
        fileName: image.fileName,
        focusX: image.focusX,
        focusY: image.focusY,
        focusAuto: image.focusAuto,
        section: image.section,
        sectionName: image.sectionName,
        invertido: image.invertido === true,
      })),
      script: state.script,
      subtitle: state.subtitlePath
        ? {
            path: state.subtitlePath,
            rel: null,
            fileName: state.subtitlePath.split(/[\\/]/).pop() ?? '',
          }
        : null,
      plan: state.plan,
      planOrigin: state.planOrigin,
      planEdited: state.planEdited,
      transcript: state.transcript,
      transcriptTravado: state.transcriptTravado,
      captions: state.captions,
      captionsEdited: state.captionsEdited,
      captionsEnabled: state.captionsEnabled,
      captionColor: state.captionColor,
      // So o nome: a URL e desta sessao e nao vale nada na proxima abertura.
      captionFont: state.captionFont?.nome ?? '',
      captionAnimation: state.captionAnimation,
      captionAnimationFrames: state.captionAnimationFrames,
      captionAnimationCurve: state.captionAnimationCurve,
      captionMark: state.captionMark,
      captionShadow: state.captionShadow,
      captionStroke: state.captionStroke,
      // A URL fica de fora: ela e desta sessao e nao vale nada amanha.
      sfxManual: state.sfxManual.map(({ url: _fora, ...resto }) => resto),
      trilhas,
      sobreposicoes,
      faixasMudas: state.faixasMudas,
      cenasTrancadas: state.cenasTrancadas,
      captionY: state.captionY,
      captionScale: state.captionScale,
      sfxEnabled: state.sfxEnabled,
      music: state.music
        ? { path: state.music.path, rel: null, fileName: state.music.fileName }
        : null,
      musicGainDb: state.musicGainDb,
      hookText: state.hookText,
      hookSec: state.hookSec,
      endText: state.endText,
      endSec: state.endSec,
      metadata: state.metadata,
      /*
       * A ESCOLHA EM ANDAMENTO na Biblioteca.
       *
       * As frases vao junto de proposito: `porBloco` e indexado por posicao da
       * frase, e as frases nascem de uma passada do Whisper que NAO roda de
       * novo ao abrir o projeto. Salvar os indices sem elas seria salvar
       * ponteiros para o vazio.
       */
      biblioteca: {
        escolhidos: state.escolhidos,
        blocos: state.scriptBlocks,
        porBloco: state.blockClips,
        pesos: state.blockWeights,
        unioes: state.blockSplits,
        cortes: state.blockCuts,
        ativo: state.activeBlock,
      },
      ...(modulos ? { modulos } : {}),
    }
  },

  saveProject: async (comoNovo) => {
    const state = get()
    const file = state.toProjectFile()
    if (!file || !state.audio) {
      set({ error: 'Não há projeto para salvar. Solte a narração e as imagens primeiro.' })
      return
    }

    const result = await window.dangai.saveProject({
      path: comoNovo ? null : state.projectPath,
      file,
      suggestedName: state.audio.fileName.replace(/\.[^.]+$/, ''),
    })

    if (!result.ok) {
      set({ error: result.error })
      return
    }
    // null = fechou o dialogo. Cancelar nao e erro e nao vira mensagem.
    if (result.value === null) return

    get().markSaved(result.value)
    emitir('depoisDeSalvar', { path: result.value })
  },

  openProject: async (path) => {
    const result = await window.dangai.openProject(path ?? null)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    if (result.value === null) return

    await applyProjectFile(set, result.value.file, result.value.path, false)
    // O projeto guarda so o NOME da fonte; e esta leitura que reencontra a URL
    // dela na pasta -- ou derruba a escolha, se o arquivo nao estiver mais la.
    // Ainda e abrir (sem passo de Ctrl+Z), e as legendas refeitas vem DEPOIS:
    // o passo delas fotografava as faixas de audio ainda sem url e sem onda, e
    // o primeiro Ctrl+Z depois de abrir as deixava mudas.
    await semSujar(async () => {
      await get().refreshFontes()
      await get().refreshSfxManual()
      await get().refreshTrilhas()
      await get().refreshSobreposicoes()
    })
    /*
     * As legendas que ele NAO editou sao refeitas pelas regras de agora -- e
     * isso ainda e abrir: nao suja o projeto (todo projeto com legenda nao
     * editada abria como "nao salvo") nem vira passo de Ctrl+Z.
     */
    await semSujar(async () => get().refazerLegendasNaoEditadas())
    await get().migrarSonsAntigos()
    // Abriu com ressalva (um clipe mesclado no lugar do pedaco): avisa, sem impedir.
    if (result.value.avisos?.length) set({ error: result.value.avisos.join(' ') })
    emitir('abrirProjeto', { path: get().projectPath })
  },

  checkAutosave: async () => {
    const result = await window.dangai.readAutosave()
    set({ hasAutosave: result.ok && result.value !== null })
  },

  restoreAutosave: async () => {
    const result = await window.dangai.readAutosave()
    if (!result.ok) {
      set({ error: result.error, hasAutosave: false })
      return
    }
    if (result.value === null) {
      set({ hasAutosave: false })
      return
    }

    // Sujo de proposito: o autosave e, por definicao, mais novo que o ultimo
    // save de verdade. Marcar limpo faria o app dizer que nao ha nada a gravar
    // justamente sobre o trabalho que quase se perdeu.
    await applyProjectFile(set, result.value.file, result.value.path, true)
    // Mesmo motivo do openProject: a fonte volta pelo nome e precisa da URL, e
    // as legendas refeitas vem depois das faixas ja com url.
    await semSujar(async () => {
      await get().refreshFontes()
      await get().refreshSfxManual()
      await get().refreshTrilhas()
      await get().refreshSobreposicoes()
    })
    /*
     * As legendas que ele NAO editou sao refeitas pelas regras de agora -- e
     * isso ainda e abrir: nao suja o projeto (todo projeto com legenda nao
     * editada abria como "nao salvo") nem vira passo de Ctrl+Z.
     */
    await semSujar(async () => get().refazerLegendasNaoEditadas())
    await get().migrarSonsAntigos()
    // Abriu com ressalva (um clipe mesclado no lugar do pedaco): avisa, sem impedir.
    if (result.value.avisos?.length) set({ error: result.value.avisos.join(' ') })
    emitir('abrirProjeto', { path: get().projectPath })
  },

  discardAutosave: async () => {
    await window.dangai.clearAutosave()
    set({ hasAutosave: false })
  },

  markSaved: (path) => set({ projectPath: path, projectDirty: false, hasAutosave: false }),
})


/**
 * Reconstroi o estado a partir de um arquivo de projeto.
 *
 * Miniatura, recorte e URL nao vem do arquivo -- sao refeitos a partir dos
 * originais no disco. Por isso abrir custa quase o mesmo que importar, e por
 * isso o .dangai fica em kilobytes em vez de dezenas de megabytes.
 */
async function applyProjectFile(
  set: SetState,
  file: ProjectFile,
  path: string | null,
  sujo: boolean,
): Promise<void> {
  await semSujar(async () => {
    set({ busy: 'Abrindo projeto...', error: null })

    /*
     * O MAIN PRECISA SABER O FORMATO ANTES das imagens entrarem.
     *
     * O recorte acontece la, na importacao: avisar depois faria o projeto
     * horizontal reabrir com todo o material recortado em 9:16 -- e o usuario
     * so descobriria olhando o preview.
     */
    await window.dangai.setFormato(file.formato)

    const audio = await window.dangai.analyzeAudio(file.audio.path)
    if (!audio.ok) {
      set({ error: audio.error, busy: null })
      return
    }

    const images = await window.dangai.importImages(
      file.images.map((image) => image.path),
      file.images.map((image) => ({
        focusX: image.focusX,
        focusY: image.focusY,
        focusAuto: image.focusAuto,
      })),
      // As partes voltam junto. Projeto salvo antes disto existir nao tem o
      // campo, o schema devolve null, e o `undefined` abaixo desliga o caminho
      // das partes exatamente como era antes.
      file.images.some((image) => image.section !== null)
        ? file.images.map((image) =>
            image.section === null
              ? null
              : { index: image.section, name: image.sectionName ?? `Parte ${image.section + 1}` },
          )
        : undefined,
    )
    if (!images.ok) {
      set({ error: images.error, busy: null })
      return
    }

    /*
     * Clipe invertido volta invertido. A copia invertida mora num cache por
     * arquivo, entao reabrir acha a que ja existe; so o recorte 9:16 e refeito.
     * Clipe que nao da para inverter mais (sumiu do disco) volta para frente,
     * em vez de impedir o projeto de abrir.
     */
    for (const [i, salva] of file.images.entries()) {
      const asset = images.value[i]
      if (!salva.invertido || !asset || asset.kind !== 'video') continue
      const r = await window.dangai.inverterClipe(asset, true)
      if (r.ok) images.value[i] = r.value
    }

    /*
     * A musica precisa de URL nova: o .dangai guarda o caminho, mas a URL do
     * servidor local carrega um id sorteado que morre com a sessao.
     *
     * Faixa que sumiu do disco nao impede o projeto de abrir -- o main ja
     * devolve `music: null` nesse caso, e o campo aparece vazio na interface.
     */
    let music: MusicPick | null = null
    if (file.music) {
      const carregada = await window.dangai.loadMusic(file.music.path)
      if (carregada.ok) music = carregada.value
    }

    set({
      audio: audio.value,
      images: images.value,
      music,
      musicGainDb: file.musicGainDb,
      hookText: file.hookText,
      hookSec: file.hookSec,
      endText: file.endText,
      endSec: file.endSec,
      metadata: file.metadata,
      script: file.script,
      subtitlePath: file.subtitle?.path ?? null,
      formato: file.formato,
      // Conserta a metade de baixo que versoes anteriores desalinharam --
      // ver @shared/indices.
      plan: file.plan ? repararMetadesDeBaixo(file.plan, images.value.length).plan : file.plan,
      planOrigin: file.planOrigin,
      planEdited: file.planEdited,
      transcript: file.transcript,
      transcriptTravado: file.transcriptTravado,
      captions: file.captions,
      captionsEdited: file.captionsEdited,
      captionsEnabled: file.captionsEnabled,
      captionColor: file.captionColor,
      /*
       * A fonte volta pelo nome, e a URL e reencontrada.
       *
       * `refreshFontes` roda logo depois de abrir e resolve o par nome->URL; se
       * o arquivo nao estiver mais na pasta, ela derruba a escolha para a fonte
       * embutida em vez de deixar uma URL morta no projeto.
       */
      captionFont: file.captionFont ? { nome: file.captionFont, url: '' } : null,
      captionAnimation: file.captionAnimation,
      captionAnimationFrames: file.captionAnimationFrames,
      captionAnimationCurve: file.captionAnimationCurve,
      captionMark: file.captionMark,
      captionShadow: file.captionShadow,
      captionStroke: file.captionStroke,
      // Sem URL ainda; `refreshSfxManual` a repoe logo depois de abrir.
      sfxManual: file.sfxManual.map((s) => ({ ...s, url: '' })),
      trilhas: file.trilhas.map((t) => ({ ...t, url: '' })),
      sobreposicoes: file.sobreposicoes.map((o) => ({ ...o, url: '' })),
      faixasMudas: file.faixasMudas,
      cenasTrancadas: file.cenasTrancadas ?? false,
      captionY: file.captionY,
      captionScale: file.captionScale,
      sfxEnabled: file.sfxEnabled,

      // Nada de estado de sessao atravessa a abertura: o render anterior nao e
      // deste projeto, e um erro antigo na barra confundiria com falha ao abrir.
      playhead: 0,
      playing: false,
      selectedScene: null,
      selecionados: [],
      render: null,
      lastOutput: null,
      aiNote: null,

      /*
       * A ESCOLHA DA BIBLIOTECA VOLTA COMO ESTAVA -- com a ordem.
       *
       * E a unica coisa aqui que nao e estado de sessao: as outras linhas
       * deste bloco zeram de proposito, porque o render anterior e o erro
       * anterior nao sao deste projeto. A selecao E deste projeto, e e o
       * trabalho mais longo que ele faz no app.
       *
       * As frases voltam do arquivo em vez de serem recalculadas. Recalcular
       * pediria outra passada do Whisper ao abrir, e -- pior -- uma passada
       * que devolvesse uma frase a mais ou a menos deslocaria TODAS as
       * marcacoes em silencio, porque elas sao indexadas por posicao.
       */
      escolhidos: file.biblioteca.escolhidos,
      scriptBlocks: file.biblioteca.blocos,
      blockClips: file.biblioteca.porBloco,
      blockWeights: file.biblioteca.pesos,
      blockSplits: file.biblioteca.unioes,
      blockCuts: file.biblioteca.cortes,
      activeBlock: file.biblioteca.ativo,
      // O aviso do roteiro sai da analise, que nao roda de novo aqui. Manter o
      // texto antigo seria afirmar um resultado que esta sessao nao mediu.
      scriptNote: null,
      busy: null,

      // Os dados de modulo e o que este app nao conhece voltam intactos.
      modulos: file.modulos ?? {},
      extrasDoProjeto: chavesDesconhecidas(file),

      projectPath: path,
      projectDirty: sujo,
      hasAutosave: false,
    })
  })
}
