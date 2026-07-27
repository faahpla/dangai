/**
 * Silencia o marcador de "nao salvo" durante o carregamento.
 *
 * Abrir um projeto mexe exatamente nos mesmos campos que editar um -- do ponto
 * de vista de quem observa o estado, restaurar 46 imagens e indistinguivel de
 * importar 46 imagens. Sem esta trava, um projeto recem-aberto nasceria sujo e
 * o app pediria para salvar o que acabou de ler do disco.
 *
 * Vive fora do store de proposito: quem observa (autosave) e quem carrega
 * (store) precisam dos dois lados da trava, e importar um do outro fecharia um
 * ciclo entre os modulos.
 */

let carregando = false

export function estaCarregando(): boolean {
  return carregando
}

/**
 * Roda `fn` sem que as mudancas contem como edicao do usuario.
 *
 * Nao aninha e nao precisa: so existe um carregamento por vez, e ele sempre
 * comeca por uma acao explicita -- abrir, recuperar ou limpar.
 */
export async function semSujar<T>(fn: () => Promise<T>): Promise<T> {
  carregando = true
  try {
    return await fn()
  } finally {
    carregando = false
  }
}
