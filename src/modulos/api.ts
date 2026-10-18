import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { SobreposicaoSalva, TrechoDeAudioSalvo } from '@shared/contract'
import type { Nucleo } from './nucleo'

/**
 * O QUE UM MODULO PODE POR NO RENDERER -- o Gerar recap do Levi, e o que vier
 * depois. Tudo opcional; o nucleo so mostra o que o modulo der, e so com o
 * modulo LIGADO nas Configuracoes.
 *
 * O modulo nunca importa o store: fala com o nucleo pela fachada (`Nucleo`,
 * em ./nucleo), que e a parte do Dangai que ele pode usar sem quebrar quando
 * o nucleo mudar por dentro.
 */
export interface ModuloDoRenderer {
  /** O MESMO id do lado do main (`recap`). */
  id: string
  /** Roda quando o modulo liga (no inicio, ou nas Configuracoes). Devolva a limpeza. */
  iniciar?(nucleo: Nucleo): void | (() => void)
  /** Botoes na tela inicial, ao lado de "Abrir projeto". */
  BotoesDaTelaInicial?: ComponentType<PropsDosBotoesDaTelaInicial>
  /**
   * As telas proprias (o assistente do recap, a instalacao do motor).
   * Montadas o tempo todo com o modulo ligado: cada uma decide se aparece. Uma
   * tela cheia avisa com `nucleo.telaCheia(true)` -- o nucleo deixa o resto
   * inerte e os atalhos quietos por baixo dela.
   */
  Telas?: ComponentType
  /** Secoes nas Configuracoes, cada uma depois de uma ancora do nucleo. */
  secoesDasConfiguracoes?: SecaoDasConfiguracoes[]
  /** Comandos na paleta (Ctrl+K). Chamado a cada vez que a paleta monta a lista. */
  comandos?(): ComandoDoModulo[]
  /** Botoes na barra de cima da linha do tempo (a do Renderizar). */
  BotoesDaBarraDeRender?: ComponentType
  /** Um item na barra de status (ex.: "analise rodando"). */
  ItemDaBarraDeStatus?: ComponentType
  /** O nome que aparece no clipe da linha do tempo. null = o nome do arquivo. */
  rotuloDoClipe?(clipe: ClipeDaFaixa): string | null
  /**
   * A etiqueta no card de "Projetos recentes" quando o projeto tem dado deste
   * modulo (`modulos.<id>` na raiz ou num item). Texto curto, ASCII ("Recap").
   */
  rotuloDoProjeto?: { texto: string }
  /**
   * Arquivos que ele soltou na janela ou escolheu no dialogo de abrir, ANTES
   * de o nucleo ver. Devolve os que o modulo CONSUMIU (o nucleo segue so com o
   * resto). Ex.: um episodio .mkv de 24 min vira "Gerar recap".
   */
  interceptarArquivos?(caminhos: readonly string[], origem: OrigemDosArquivos): Promise<readonly string[]>
}

export type OrigemDosArquivos = 'dialogo' | 'soltar'

export interface PropsDosBotoesDaTelaInicial {
  /** Ha um arquivo sendo arrastado sobre a janela. */
  arrastando: boolean
  /** "O arquivo esta em cima de MIM": a area de soltar do nucleo se apaga. */
  definirAlvo(alvo: boolean): void
}

/** Onde uma secao do modulo entra nas Configuracoes. */
export type AncoraDasConfiguracoes = 'ia' | 'whisper' | 'sons' | 'biblioteca' | 'fim'

export interface SecaoDasConfiguracoes {
  /** Unico; serve para abrir as Configuracoes direto nela (`nucleo.abrirConfiguracoes(id)`). */
  id: string
  titulo: string
  depoisDe: AncoraDasConfiguracoes
  Componente: ComponentType
}

export interface ComandoDoModulo {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  disabled?: boolean
  run: () => void
}

export type ClipeDaFaixa =
  | { tipo: 'video'; clipe: SobreposicaoSalva }
  | { tipo: 'audio'; clipe: TrechoDeAudioSalvo }
