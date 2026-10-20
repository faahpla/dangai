import { casarFalaComRoteiro, chaveDaFala, SOBRA_MAXIMA } from './casar-fala'

/**
 * AUDIO QUE NAO TEM O ROTEIRO INTEIRO (B1, 20/10): a narracao certa, mas
 * cortada (exportou so ate a metade, esqueceu o CTA, pulou uma frase).
 *
 * O veredito do alinhamento.ts nao pega isto. O Whisper concorda (o que ele
 * ouviu e deste roteiro) e o wav2vec2 forca o roteiro INTEIRO no som que
 * existe: medido com a voz do Windows, o audio com 60% do roteiro saiu
 * "Importado, alinhamento fraco" (score 0,45) e o com 85% (score 0,65) tambem,
 * com as ~95 e ~35 palavras que ninguem falou espremidas no fim. As legendas
 * corriam ate 25 s na frente da voz e as cenas do fim nao tinham fala.
 *
 * O sinal: um bloco de palavras do roteiro que o Whisper nao ouviu (passo
 * 'falta' do casarFalaComRoteiro) E sem fala no audio onde ele teria que
 * estar. Os dois juntos, porque cada um sozinho erra:
 *   - o Whisper as vezes pula um trecho dito: ali ha FALA, e nada e recusado;
 *   - o silencio sozinho nao diz qual palavra falta.
 * Funcao pura: a fala vem de fora (falaEntre), o teste usa audio nenhum.
 */

/** Menos que isto e o Whisper engolindo palavra solta, nao trecho faltando. */
export const MINIMO_DE_PALAVRAS = 8
/**
 * Fala (segundos com som de voz) que cada palavra que falta precisaria ter.
 * Baixo de proposito (dez palavras por segundo de fala): so recusa quando nao
 * cabe nem a leitura mais rapida.
 */
export const FALA_POR_PALAVRA_SEC = 0.1
/** Os tempos do Whisper erram por centenas de ms: a janela da fala abre esta folga dos dois lados. */
const FOLGA_SEC = 0.3

export interface TrechoQueFalta {
  /** Indices (no roteiro) da primeira e da ultima palavra que faltam. */
  de: number
  ate: number
  /** Quantas palavras do roteiro faltam no bloco. */
  palavras: number
  onde: 'comeco' | 'meio' | 'fim'
}

export interface PalavraOuvida {
  text: string
  start: number
  end: number
}

/**
 * O maior trecho do roteiro que o audio nao tem, ou null.
 *
 * null tambem quando o que se ouviu NAO e este roteiro (sobra demais): ai
 * quem decide e o vereditoDoAlinhamento ("nao parece ser a narracao"), que e
 * a frase certa para um audio de outra coisa.
 */
export function trechoQueFalta(
  roteiro: readonly string[],
  ouvidas: readonly PalavraOuvida[],
  /** Segundos de fala no audio entre `a` e `b`. */
  falaEntre: (a: number, b: number) => number,
  duracao: number,
): TrechoQueFalta | null {
  const r = roteiro.map(chaveDaFala)
  const o = ouvidas.map((w) => chaveDaFala(w.text))
  if (r.length === 0 || o.length === 0) return null
  const passos = casarFalaComRoteiro(r, o)
  const sobras = passos.filter((p) => p.tipo === 'sobra').length
  if (sobras / o.length > SOBRA_MAXIMA) return null

  let pior: TrechoQueFalta | null = null
  let antes: number | null = null // a ultima palavra ouvida casada (indice em `ouvidas`)
  let k = 0
  while (k < passos.length) {
    const p = passos[k]!
    if (p.tipo === 'casou') {
      antes = p.j
      k++
      continue
    }
    // Um bloco sem casamento: as palavras do roteiro que faltam, e a sobra (fala ouvida) no meio dele.
    const faltas: number[] = []
    while (k < passos.length && passos[k]!.tipo !== 'casou') {
      const q = passos[k]!
      if (q.tipo === 'falta') faltas.push(q.i)
      k++
    }
    if (faltas.length < MINIMO_DE_PALAVRAS) continue
    const depois = passos[k]
    const a = antes === null ? 0 : Math.max(0, ouvidas[antes]!.end - FOLGA_SEC)
    const b = depois?.tipo === 'casou' ? Math.min(duracao, ouvidas[depois.j]!.start + FOLGA_SEC) : duracao
    if (falaEntre(a, b) >= faltas.length * FALA_POR_PALAVRA_SEC) continue
    if (pior && pior.palavras >= faltas.length) continue
    pior = {
      de: faltas[0]!,
      ate: faltas.at(-1)!,
      palavras: faltas.length,
      onde: antes === null ? 'comeco' : depois ? 'meio' : 'fim',
    }
  }
  return pior
}

/**
 * A frase da tela. A primeira frase e curta (o rodape mostra so ela,
 * resumoDaFalhaDaVoz); o resto vai no tooltip e cita o roteiro, que e por
 * onde o Levi acha o trecho.
 */
export function mensagemDoTrechoQueFalta(roteiro: readonly string[], t: TrechoQueFalta): string {
  // Sem a pontuacao da ponta: o "..." ja diz que continua ("graça...." -> "graça...").
  const semPonta = (s: string): string => s.replace(/[.!?,;:…]+$/u, '')
  const inicio = semPonta(roteiro.slice(t.de, Math.min(t.de + 4, t.ate + 1)).join(' '))
  const fim = semPonta(roteiro.slice(Math.max(t.de, t.ate - 3), t.ate + 1).join(' '))
  const parte = t.onde === 'fim' ? 'o fim do' : t.onde === 'comeco' ? 'o comeco do' : 'um trecho do'
  const qual =
    t.onde === 'fim'
      ? `de "${inicio}..." ate o fim`
      : t.onde === 'comeco'
        ? `do inicio ate "...${fim}"`
        : `de "${inicio}..." ate "...${fim}"`
  return `Falta ${parte} roteiro nesse audio (${t.palavras} palavras). Nao foi dito ${qual}. Importe a narracao inteira ou tire esse trecho do roteiro.`
}
