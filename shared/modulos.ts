import type { IpcResult } from './channels'

/**
 * O CONTRATO DOS MODULOS entre o main, o preload e o renderer.
 *
 * Um modulo (o Gerar recap do Levi) mora em `modulos/<id>/` e fala com o
 * nucleo so pelos ganchos: no main, `electron/modulos.ts`; na ponte, uma
 * fabrica de `PontesDosModulos`; no renderer, `src/modulos/`. O nucleo nao
 * importa codigo de modulo nenhum fora dos tres arquivos de registro
 * (`modulos/registro.*.ts`), que sao uma linha por modulo.
 *
 * Cada modulo tem um id (`recap`) e usa so os canais de IPC com o prefixo
 * dele (`recap:`). O nucleo recusa canal fora do prefixo, nos dois lados.
 */

/** O id de um modulo: minusculas, numero e traco. Vira o prefixo dos canais. */
export const ID_DE_MODULO = /^[a-z][a-z0-9-]{1,30}$/

export const prefixoDoModulo = (id: string): string => `${id}:`

/** O que o renderer sabe de um modulo instalado. */
export interface ModuloPublico {
  id: string
  nome: string
  descricao: string
  /** Mostra "beta" ao lado do nome. */
  beta: boolean
  /** Ligado nas Configuracoes. Desligado, o modulo nao aparece em lugar nenhum. */
  ligado: boolean
  /** O modulo quebrou ao subir: o Dangai segue sem ele, e isto diz por que. */
  falhou: string | null
  /** A parte das configuracoes dele que o renderer pode ver (o `paraRenderer`). */
  config: unknown
  /** As chaves de API dele: so se existe e a dica (os 4 ultimos), nunca a chave. */
  chaves: Record<string, { tem: boolean; dica: string }>
}

/**
 * O que a ponte do nucleo entrega a fabrica da ponte de um modulo. As duas
 * so alcancam canais do prefixo do modulo: o `ipcRenderer` cru nunca chega a
 * ele.
 */
export interface FabricasDaPonte {
  /** ipcRenderer.invoke, ja com o IpcResult do nucleo. */
  invocar<T>(canal: string, ...args: unknown[]): Promise<IpcResult<T>>
  /** Ouve um evento do main. Devolve a funcao que para de ouvir. */
  assinar<T>(canal: string, ouvinte: (dados: T) => void): () => void
}

/**
 * A fabrica da ponte de um modulo: recebe as fabricas e devolve o objeto que
 * aparece em `window.dangai.modulos.<id>`. Roda no preload (sandbox): so
 * `import type` e constantes, nada de node.
 */
export type CriarPonte = (fabricas: FabricasDaPonte) => object
