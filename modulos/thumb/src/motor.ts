import { create } from 'zustand'

/**
 * [thumb] A TELA "INSTALAR MOTOR" EMPRESTADA. O motor de personagens (e a
 * tela que instala o runtime dele) e do recap; o modulo Thumbnail nao importa
 * o recap: e o recap que, quando liga, empresta aqui o jeito de abrir a tela
 * dele (e devolve ao desligar). Sem o recap ligado, a thumb so avisa.
 */
export interface InstaladorDoMotor {
  /** Abre a tela de instalar; `depois` roda quando o motor ficar pronto. */
  abrir(depois?: () => void): void
  /** Avisa quando o motor acabou de ficar pronto (por qualquer caminho). Devolve o "parar". */
  quandoFicarPronto(fn: () => void): () => void
}

export const useInstaladorDoMotor = create<{ instalador: InstaladorDoMotor | null }>(() => ({ instalador: null }))

/** Empresta o instalador; devolve a funcao que o tira (o recap desligando). */
export function emprestarInstaladorDoMotor(i: InstaladorDoMotor): () => void {
  useInstaladorDoMotor.setState({ instalador: i })
  return () => {
    if (useInstaladorDoMotor.getState().instalador === i) useInstaladorDoMotor.setState({ instalador: null })
  }
}
