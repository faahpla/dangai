import { useProject } from './project'
import { estaCarregando } from './quiet'
import { mudou } from './documento'

/**
 * Rede de seguranca: grava o projeto sozinho no userData enquanto o usuario
 * trabalha, e marca o projeto como "nao salvo" na hora em que ele muda.
 *
 * Existe porque o trabalho caro deste app nao e o render -- e o enquadramento
 * imagem por imagem e a legenda corrigida na mao. Perder isso porque a maquina
 * reiniciou seria perder a unica parte que o app nao consegue refazer sozinho.
 *
 * Nao substitui salvar: o autosave e uma copia so, no userData, e a proxima
 * sessao pergunta se quer retomar.
 */

/**
 * Tempo de espera depois da ultima mudanca.
 *
 * Arrastar um limite na timeline dispara dezenas de alteracoes por segundo;
 * gravar em todas transformaria o autosave num travamento a cada arraste.
 */
const ESPERA_MS = 1200

export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const gravar = async (): Promise<void> => {
    const state = useProject.getState()
    const file = state.toProjectFile()
    // Sem narracao nao ha projeto -- e o estado vazio nao tem o que recuperar.
    if (!file) return
    await window.dangai.autosaveProject(file, state.projectPath)
  }

  const unsubscribe = useProject.subscribe((state, anterior) => {
    if (estaCarregando()) return
    // A lista dos campos mora em documento.ts: o desfazer observa a mesma coisa,
    // e as duas respostas para "o usuario editou?" tem que ser uma so.
    if (!mudou(state, anterior)) return

    // Setar aqui dispara este mesmo observador de novo, mas na segunda passada
    // nenhum campo do documento mudou e a comparacao acima corta o caminho.
    if (!state.projectDirty) useProject.setState({ projectDirty: true })

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void gravar()
    }, ESPERA_MS)
  })

  return () => {
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}
