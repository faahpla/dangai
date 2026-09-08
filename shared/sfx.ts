/**
 * Quais SFX disparam quando a agulha anda de `antes` para `agora`.
 *
 * Mora aqui, fora do componente, porque e a unica parte da reproducao no
 * preview que da para provar sem abrir janela: o Player do Remotion pausa a
 * cada seek externo, entao nenhum teste consegue simular a agulha ANDANDO. A
 * regra fica testada aqui e o componente so a chama.
 *
 * Um SFX nao e uma faixa sincronizada como a narracao -- e um DISPARO. Ele toca
 * do inicio quando a agulha CRUZA o instante dele, e por isso a decisao depende
 * dos dois instantes e nao so do atual.
 */

/**
 * Maior avanco que ainda conta como "tocando", em segundos.
 *
 * Acima disso foi salto: arrastar a agulha de 3s para 40s cruzaria todos os
 * instantes no meio e tocaria o video inteiro de sons de uma vez. Um segundo e
 * folgado para um quadro (0,04s) e apertado para qualquer arraste.
 */
export const SALTO_MAXIMO_SEC = 1

export function sfxParaDisparar<T extends { id: string; at: number }>(
  sons: readonly T[],
  antes: number,
  agora: number,
): string[] {
  const avanco = agora - antes
  // Voltar nunca dispara: rebobinar tocaria tudo que ficou para tras.
  if (avanco <= 0 || avanco > SALTO_MAXIMO_SEC) return []

  // Intervalo aberto no inicio e fechado no fim: o som exatamente em `antes` ja
  // tocou na passada anterior, e o exatamente em `agora` toca nesta.
  return sons.filter((som) => som.at > antes && som.at <= agora).map((som) => som.id)
}
