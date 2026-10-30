import type { DetectorDoMotor } from './editor'

/**
 * [thumb] O MOTOR DE ROSTOS EMPRESTADO. O detector de rosto de anime mora no
 * motor de personagens do recap (o runtime de ~5 GB que quem usa o recap ja
 * instalou); o modulo Thumbnail nao importa o recap: e o recap que, no
 * `configurar` dele (que roda ligado ou nao), empresta o motor aqui. Sem o
 * recap no app, ou sem o motor instalado, a thumb fica sem detector e a
 * imagem entra no meio.
 */
export interface MotorDeRostosEmprestado {
  /** null = roda agora; senao, por que nao (frase curta: "O motor de personagens nao esta instalado."). */
  motivoParaNaoRodar(): string | null
  detector: DetectorDoMotor
  /** Mata o lote que estiver rodando (a saida do app). */
  encerrar(): void
}

let emprestado: MotorDeRostosEmprestado | null = null

export function emprestarMotorDeRostos(m: MotorDeRostosEmprestado | null): void {
  emprestado = m
}

export function motorDeRostos(): MotorDeRostosEmprestado | null {
  return emprestado
}

/** Por que o detector nao roda agora (null = roda). */
export function motivoSemMotor(): string | null {
  if (!emprestado) return 'O motor de personagens vem com o modulo Gerar recap.'
  try {
    return emprestado.motivoParaNaoRodar()
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
