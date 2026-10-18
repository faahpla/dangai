import { create } from 'zustand'
import type { CaptionStyle } from '@shared/contract'
import { useProject, type ProjectState } from '@/store/project'
import { fotografar, type Documento } from '@/store/documento'
import { desfazer, fecharPassoAgora, refazer } from '@/store/undo'
import { semSujar } from '@/store/quiet'
import { aplicarEstiloSemVirarPadrao } from '@/store/estilo-legenda'
import { ouvir, type EventosDoNucleo } from './ganchos'
import { useModulos } from './lista'
import type { ModuloPublico } from '@shared/modulos'

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
  | 'transcriptTravado'
>

/** A tela cheia de modulo aberta agora (o assistente do recap), se houver. */
export const useTelaCheia = create<{ de: string | null }>(() => ({ de: null }))

export interface Nucleo {
  /** O id do modulo dono desta fachada. */
  readonly id: string
  /**
   * Hook: o que o main diz DESTE modulo -- ligado, a config publica (o
   * `paraRenderer`) e o tem/dica de cada chave dele. Atualiza sozinho quando
   * a lista e relida (ver `reler`).
   */
  usarEuMesmo(): ModuloPublico | null
  /** O mesmo, fora do React. */
  euMesmo(): ModuloPublico | null
  /**
   * Rele a lista no main -- depois de o modulo gravar a config ou uma chave
   * pelos canais dele, para a tela mostrar o tem/dica novos.
   */
  reler(): Promise<void>
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
  /**
   * Trava (ou solta) a transcricao: com os tempos travados, nenhuma
   * reanalise roda o Whisper por cima -- o "Abrir no editor" da voz gerada.
   */
  travarTranscript(travado: boolean): void

  /** O Ctrl+Z e o Ctrl+Y do projeto. Devolvem se havia o que fazer. */
  desfazer(): boolean
  refazer(): boolean
  /**
   * Muda o projeto SEM sujar e sem passo de Ctrl+Z: o que se refaz sozinho ao
   * abrir (converter o formato antigo do proprio modulo, por exemplo). Nao ha
   * "marcar limpo" de proposito: um modulo dizendo que esta salvo o que nao
   * esta faria o app fechar sem perguntar.
   */
  semSujar<T>(fn: () => T | Promise<T>): Promise<T>
  /**
   * Tira um campo DESCONHECIDO da raiz do arquivo (o `studio` do Studio, ja
   * convertido para modulos.<id>). Campo do nucleo nao sai por aqui.
   */
  esquecerDoProjeto(campo: string): void
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
    usarEuMesmo: () => useModulos((s) => s.lista.find((m) => m.id === id) ?? null),
    euMesmo: () => useModulos.getState().lista.find((m) => m.id === id) ?? null,
    reler: () => useModulos.getState().carregar(),
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
    travarTranscript: (travado) => store().travarTranscript(travado),

    desfazer: () => desfazer(),
    refazer: () => refazer(),
    semSujar: (fn) => semSujar(async () => fn()),
    esquecerDoProjeto: (campo) =>
      useProject.setState((s) => {
        if (!(campo in s.extrasDoProjeto)) return s
        const { [campo]: _fora, ...resto } = s.extrasDoProjeto
        return { extrasDoProjeto: resto }
      }),
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
