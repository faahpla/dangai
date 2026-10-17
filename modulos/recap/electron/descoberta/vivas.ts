/**
 * Qual episodio esta no Reconhecer na mao agora (agrupando, esperando os nomes
 * ou salvando). Modulo sem import nenhum de proposito: o corte-fundo.ts le
 * daqui sem criar ciclo com descoberta/index.ts (que le o estado do corte de la).
 *
 * Uma descoberta por vez: ela usa a mesma vaga do motor (motor.ts, `atual`).
 */

let viva: string | null = null

/** index.ts marca a cada troca de status. null = nenhuma viva. */
export function marcarViva(episodioId: string | null): void {
  viva = episodioId
}

/** Ha descoberta viva deste episodio? O corte-fundo recusa cortar por cima dela. */
export function haDescobertaViva(episodioId: string): boolean {
  return viva !== null && viva === episodioId
}

/**
 * Alguma descoberta segura a vaga do motor (de qualquer episodio)? O corte de
 * OUTRO episodio espera na fila ("Esperando o motor") em vez de voltar erro.
 */
export function motorComADescoberta(): boolean {
  return viva !== null
}
