/**
 * [recap] O RUNTIME DO MOTOR (instalar Python + torch no 1o uso) chega na
 * parte 4. Ate la nada pede o motor: `pedirMotor` responde "nao abri a tela",
 * e ninguem avisa mudanca de fase.
 */
export async function pedirMotor(_depois: () => void): Promise<boolean> {
  return false
}

export function quandoAFaseMudar(_ouvinte: () => void): () => void {
  return () => {}
}
