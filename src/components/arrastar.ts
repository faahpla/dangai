/**
 * Arrastar arquivos DE DENTRO do app -- das Power Bins -- para a linha do
 * tempo, pelo mesmo gesto de arrastar do Explorer.
 *
 * O arraste interno leva os caminhos num tipo proprio do dataTransfer; o de
 * fora leva File. Quem recebe nao precisa saber de onde veio: `caminhosDoArraste`
 * devolve os caminhos dos dois jeitos.
 */
export const TIPO_ARRASTE = 'application/x-dangai-arquivos'

export function iniciarArraste(event: React.DragEvent, caminhos: readonly string[]): void {
  event.dataTransfer.setData(TIPO_ARRASTE, JSON.stringify(caminhos))
  event.dataTransfer.effectAllowed = 'copy'
}

export function caminhosDoArraste(event: React.DragEvent): string[] {
  const interno = event.dataTransfer.getData(TIPO_ARRASTE)
  if (interno) {
    try {
      const lista: unknown = JSON.parse(interno)
      if (Array.isArray(lista)) return lista.filter((x): x is string => typeof x === 'string')
    } catch {
      /* nao era nosso */
    }
  }
  return Array.from(event.dataTransfer.files).map((file) => window.dangai.pathForFile(file))
}
