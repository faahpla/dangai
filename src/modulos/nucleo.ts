import { create } from 'zustand'
import type { CaptionStyle } from '@shared/contract'
import { useProject, type ProjectState } from '@/store/project'
import { fotografar, type Documento } from '@/store/documento'
import { fecharPassoAgora } from '@/store/undo'
import { aplicarEstiloSemVirarPadrao } from '@/store/estilo-legenda'
import { ouvir, type EventosDoNucleo } from './ganchos'

/**
 * A FACHADA DO NUCLEO: o pedaco do Dangai que um modulo pode usar.
 *
 * O store inteiro tem centenas de membros e muda por dentro o tempo todo; um
 * modulo amarrado nele quebraria a cada versao. Isto e o que o nucleo PROMETE
 * manter -- mudar algo daqui e combinar antes com quem usa (ver CLAUDE.md).
 */

/** O que o modulo pode LER do projeto e da tela. */
export type EstadoPublico = Pick<
  ProjectState,
  | 'settingsOpen'
  | 'libraryOpen'
  | 'paletteOpen'
  | 'scriptOpen'
  | 'busy'
  | 'error'
  | 'phase'
  | 'projectPath'
  | 'projectDirty'
  | 'formato'
  | 'audio'
  | 'images'
  | 'plan'
  | 'script'
  | 'transcript'
  | 'captions'
  | 'trilhas'
  | 'sobreposicoes'
  | 'library'
  | 'playhead'
  | 'render'
  | 'lastOutput'
  | 'appVersion'
  | 'update'
  | 'modulos'
>

/** A tela cheia de modulo aberta agora (o assistente do recap), se houver. */
export const useTelaCheia = create<{ de: string | null }>(() => ({ de: null }))

export interface Nucleo {
  /** O id do modulo dono desta fachada. */
  readonly id: string
  /** Hook de React: le um pedaco do estado, como o useProject. */
  usar<T>(seletor: (estado: EstadoPublico) => T): T
  /** O estado agora, fora do React. */
  ler(): EstadoPublico
  /** Avisa a cada mudanca de estado. Devolve a funcao que para. */
  assinar(ouvinte: (estado: EstadoPublico, anterior: EstadoPublico) => void): () => void
  /** Ouve um evento do nucleo (abrir, salvar, renderizar, narracao trocada). */
  ao<K extends keyof EventosDoNucleo>(evento: K, ouvinte: (dados: EventosDoNucleo[K]) => void): () => void

  abrirProjeto(caminho?: string): Promise<void>
  /** Os arquivos entram como se ele tivesse soltado na janela (sem passar pelos modulos). */
  trazerArquivos(caminhos: readonly string[]): Promise<void>
  /** Abre as Configuracoes, ja numa secao se der o id dela. */
  abrirConfiguracoes(secao?: string): void
  abrirBiblioteca(): Promise<void>
  sincronizarBiblioteca(): Promise<void>
  mostrarNaBiblioteca(caminho: string): Promise<void>
  /** O projeto como iria para o disco agora (null sem narracao). */
  paraArquivo(): ReturnType<ProjectState['toProjectFile']>

  /**
   * Muda o documento num passo SO de Ctrl+Z. A receita recebe o documento de
   * agora e devolve so o que muda.
   */
  aplicarNoDocumento(receita: (documento: Documento) => Partial<Documento>): void
  /** O pedaco deste modulo guardado no projeto (`modulos.<id>`). */
  lerDoProjeto(): unknown
  /** Grava (ou apaga, com undefined) o pedaco deste modulo no projeto. Um passo de Ctrl+Z. */
  gravarNoProjeto(dados: unknown): void
  /** Poe um estilo de legenda sem virar o padrao dos proximos videos. */
  aplicarEstiloDeLegenda(estilo: CaptionStyle): void

  marcarSujo(): void
  mostrarErro(mensagem: string): void
  /** Avisa que uma tela cheia DESTE modulo abriu ou fechou. */
  telaCheia(aberta: boolean): void
  /**
   * Ha um modal do nucleo por cima (paleta, Configuracoes, Biblioteca,
   * roteiro)? A tela cheia so trata o proprio Esc quando nao ha.
   */
  haModalPorCima(): boolean
}

export function criarNucleo(id: string): Nucleo {
  const store = useProject.getState
  return {
    id,
    usar: (seletor) => useProject((s) => seletor(s)),
    ler: () => store(),
    assinar: (ouvinte) => useProject.subscribe((s, a) => ouvinte(s, a)),
    ao: (evento, ouvinte) => ouvir(evento, ouvinte),

    abrirProjeto: (caminho) => store().openProject(caminho),
    trazerArquivos: (caminhos) => store().ingest(caminhos),
    abrirConfiguracoes: (secao) => store().openSettings(true, secao),
    abrirBiblioteca: () => store().openLibrary(true),
    sincronizarBiblioteca: () => store().syncLibrary(),
    mostrarNaBiblioteca: (caminho) => store().mostrarNaBiblioteca(caminho),
    paraArquivo: () => store().toProjectFile(),

    aplicarNoDocumento: (receita) => {
      fecharPassoAgora()
      const patch = receita(fotografar(store()))
      useProject.setState({ ...patch, projectDirty: true })
      fecharPassoAgora()
    },
    lerDoProjeto: () => store().lerModulo(id),
    gravarNoProjeto: (dados) => {
      fecharPassoAgora()
      store().gravarModulo(id, dados)
      fecharPassoAgora()
    },
    aplicarEstiloDeLegenda: (estilo) => aplicarEstiloSemVirarPadrao(estilo, true),

    marcarSujo: () => useProject.setState({ projectDirty: true }),
    mostrarErro: (mensagem) => useProject.setState({ error: mensagem }),
    telaCheia: (aberta) =>
      useTelaCheia.setState((s) => (aberta ? { de: id } : s.de === id ? { de: null } : s)),
    haModalPorCima: () => {
      const s = store()
      return s.paletteOpen || s.settingsOpen || s.scriptOpen || s.libraryOpen
    },
  }
}
