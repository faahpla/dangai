import { ascii } from '../frase-do-motor'

/**
 * O ERRO DO MOTOR NA TELA do Reconhecer na mao.
 *
 * O motor.ts entrega o fim anormal como "O motor parou sem terminar (codigo
 * 4294967295): <as 6 ultimas linhas do stderr>". Na auditoria de 15/10 isso
 * chegava cru a tela: ingles, cortado no meio da palavra, e enganoso (o aviso
 * do HF_TOKEN e o "NVENC disponivel" sao ruido de log, nao a causa). Aqui vira
 * UMA frase curta em portugues do que fazer; o texto cru fica no `detalhe`
 * (tooltip) e inteiro no log do motor (<dados>/logs/ultima-analise.log).
 */

/** Uma excecao do Python na cauda do stderr: "RuntimeError: CUDA out of memory". */
const EXCECAO = /\b([A-Z][A-Za-z]*(?:Error|Exception|Interrupt))\b:?\s*(.*)$/

/** Frases do Python que tem resposta conhecida. */
function porque(texto: string): string | null {
  if (/out of memory|CUDA_ERROR_OUT_OF_MEMORY|cudaErrorMemoryAllocation/i.test(texto)) {
    return 'Faltou memoria na GPU. Feche outros programas pesados e tente de novo.'
  }
  if (/No space left on device|Errno 28/i.test(texto)) return 'O disco encheu. Libere espaco e tente de novo.'
  if (/Permission denied|Errno 13|PermissionError/i.test(texto)) {
    return 'O motor nao conseguiu gravar na pasta (arquivo aberto em outro programa?). Tente de novo.'
  }
  return null
}

export interface ErroNaTela {
  /** ASCII, uma frase, sem jargao. */
  curto: string
  /** O texto cru (ASCII), para o tooltip. null = o curto ja e o texto todo. */
  detalhe: string | null
}

/** O erro do fim do motor (FimDaAnalise.erro) para a tela. Nunca lanca. */
export function erroNaTela(cru: string | null | undefined): ErroNaTela {
  const texto = ascii(String(cru ?? '').trim())
  if (!texto) return { curto: 'O motor parou sem dizer por que. Tente de novo.', detalhe: null }

  // Processo morto sem evento final (fechado, morto pelo Gerenciador, quebrou).
  const morto = /^O motor parou sem terminar \(codigo ([^)]*)\)[.:]?\s*(.*)$/s.exec(texto)
  if (morto) {
    const cauda = morto[2] ?? ''
    const conhecido = porque(cauda)
    if (conhecido) return { curto: conhecido, detalhe: texto }
    const excecao = cauda
      .split(' | ')
      .map((linha) => EXCECAO.exec(linha.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .at(-1)
    const tipo = excecao ? ` (${excecao[1]})` : ''
    return { curto: `O motor fechou sem terminar${tipo}. Tente de novo.`, detalhe: texto }
  }

  // Evento 'failed' do motor: a mensagem dele (as do pipeline ja vem em portugues).
  const falhou = /^O motor parou com erro:\s*(.*)$/s.exec(texto)
  if (falhou) {
    const msg = (falhou[1] ?? '').trim()
    const conhecido = porque(msg)
    if (conhecido) return { curto: conhecido, detalhe: texto }
    // So a primeira frase, e curta: o resto vai no tooltip.
    const primeira = msg.split(/(?<=[.!?])\s+|\s+\|\s+|\n/)[0]?.trim() ?? ''
    const curta = primeira.length > 140 ? `${primeira.slice(0, 137).trimEnd()}...` : primeira
    return { curto: curta ? `O motor parou: ${curta}` : 'O motor parou com erro. Tente de novo.', detalhe: texto }
  }

  if (texto.length <= 160) return { curto: texto, detalhe: null }
  return { curto: `${texto.slice(0, 157).trimEnd()}...`, detalhe: texto }
}
