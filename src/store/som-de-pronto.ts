/**
 * O "PRONTO" DO RENDER: um barulhinho quando o video termina de sair.
 *
 * "Quero que voce coloque um audio para indicar quando termina de renderizar,
 * tipo um barulhinho de finalizacao." Duas notas que sobem, com timbre de sino
 * (a nota e dois harmonicos baixinhos, caindo devagar). Sintetizado aqui, sem
 * arquivo de som para empacotar. Desliga em Configuracoes > Sons.
 */
let contexto: AudioContext | null = null

/** Toca o som, sem perguntar a configuracao (o "Ouvir" das Configuracoes). */
export function tocarSomDePronto(): void {
  try {
    contexto ??= new AudioContext()
    const ctx = contexto
    void ctx.resume()
    const agora = ctx.currentTime + 0.03
    // Sol e re uma quinta acima: soa como "concluido", nao como alarme.
    const notas: [number, number][] = [
      [783.99, 0],
      [1174.66, 0.13],
    ]
    const timbre: [number, number][] = [
      [1, 0.2],
      [2, 0.05],
      [3, 0.02],
    ]
    for (const [frequencia, atraso] of notas) {
      for (const [harmonico, volume] of timbre) {
        const osc = ctx.createOscillator()
        const ganho = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = frequencia * harmonico
        const t0 = agora + atraso
        ganho.gain.setValueAtTime(0, t0)
        ganho.gain.linearRampToValueAtTime(volume, t0 + 0.01)
        ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1)
        osc.connect(ganho).connect(ctx.destination)
        osc.start(t0)
        osc.stop(t0 + 1.15)
      }
    }
  } catch {
    // Sem saida de audio: o render terminou do mesmo jeito.
  }
}

/** Toca se ele nao desligou o som nas Configuracoes. */
export async function avisarQueFicouPronto(): Promise<void> {
  const r = await window.dangai.getSettings()
  if (r.ok && !r.value.somAoRenderizar) return
  tocarSomDePronto()
}
