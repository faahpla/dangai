import { FORMATO_PADRAO, medidasDo, type Formato } from '@shared/contract'

/**
 * O formato do projeto ABERTO, para os servicos do main.
 *
 * Estado de modulo, como o caminho do Whisper e o do cascade de rosto: o app e
 * de uma janela so e ha exatamente um projeto aberto por vez. Passar o formato
 * em cada chamada de IPC atravessaria importar, reenquadrar, ampliar e sondar
 * -- quatro assinaturas e todos os chamadores delas -- para carregar um dado
 * que nao muda enquanto o projeto esta aberto.
 *
 * Quem manda e o renderer: ele avisa ao criar ou abrir um projeto. Com isso o
 * main nunca ADIVINHA o formato, que e o unico jeito de ele divergir da tela.
 *
 * O RENDER e a excecao e leva as medidas nas proprias props, de proposito: ali
 * errar significa gravar o video inteiro no quadro errado, e vale o custo de
 * nao depender de um estado que alguem pode ter esquecido de atualizar.
 */
let atual: Formato = FORMATO_PADRAO

export function definirFormato(formato: Formato): void {
  atual = formato
}

export function formatoAtual(): Formato {
  return atual
}

/** As medidas do formato aberto. Atalho para quem so precisa dos numeros. */
export function medidasAtuais(): ReturnType<typeof medidasDo> {
  return medidasDo(atual)
}
