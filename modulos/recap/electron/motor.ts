/**
 * [recap] O MOTOR do Studio (corte das cenas e personagens) chega na parte 4.
 * Ate la, o que o passo 1 pergunta a ele responde "sem motor": o palpite fica
 * so pelo nome do arquivo, e a busca nao sabe de onde vieram as fotos.
 */

/** O palpite do motor pelo arquivo. Sem motor: nada (o nome do arquivo decide). */
export async function adivinharPeloMotor(_caminho: string): Promise<unknown> {
  return null
}

/** A pasta de dados do motor. Sem motor, lanca (quem chama trata como "nao se sabe"). */
export function pastaDeDadosDoMotor(): string {
  throw new Error('Motor do recap: em breve.')
}
