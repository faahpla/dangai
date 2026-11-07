import { useProject } from './project'
import { estaCarregando } from './quiet'
import { mudou } from './documento'
import { useRecentes } from './recentes'
import { ehProjetoDoStudio } from '@shared/project-file'

/**
 * O AUTO SAVE: grava o projeto sozinho enquanto o usuario trabalha, e marca o
 * projeto como "nao salvo" na hora em que ele muda.
 *
 * Projeto com arquivo (o normal desde a 1.98: soltar a narracao ja pergunta o
 * nome e cria o .dangai na pasta dos projetos) e gravado NO PROPRIO ARQUIVO --
 * "quero que vc tenha um sistema de auto save". Sem arquivo (ele disse "Agora
 * nao" ao nome, ou um .anirecap, que nunca e regravado), vai para a copia de
 * seguranca no userData, como antes, e a proxima sessao pergunta se quer
 * retomar.
 *
 * Existe porque o trabalho caro deste app nao e o render -- e o enquadramento
 * imagem por imagem e a legenda corrigida na mao.
 */

/**
 * Tempo de espera depois da ultima mudanca.
 *
 * Arrastar um limite na timeline dispara dezenas de alteracoes por segundo;
 * gravar em todas transformaria o autosave num travamento a cada arraste.
 */
const ESPERA_MS = 1200

/** Quantas mudancas o documento ja teve: gravou a versao de agora, pode marcar limpo. */
let versao = 0
let gravando: Promise<void> | null = null
let pendente = false

async function gravarAgora(): Promise<void> {
  const state = useProject.getState()
  const file = state.toProjectFile()
  // Sem narracao nao ha projeto -- e o estado vazio nao tem o que recuperar.
  if (!file) return
  const path = state.projectPath
  const esta = versao

  if (path && !ehProjetoDoStudio(path)) {
    const r = await window.dangai.gravarProjeto(path, file)
    if (r.ok && r.value) {
      // Mudou de novo enquanto gravava (ou trocou de projeto)? Continua sujo: a proxima passada grava.
      if (versao === esta && useProject.getState().projectPath === path) {
        useProject.setState({ projectDirty: false, hasAutosave: false })
        void useRecentes.getState().atualizarSeMudou(path)
      }
      return
    }
    // r.ok com false: perda grande, o main guardou na copia de seguranca. Fica sujo ate o Ctrl+S.
    if (r.ok) return
    console.warn('[autosave] nao gravou no projeto:', r.error)
  }
  await window.dangai.autosaveProject(file, path)
}

/**
 * Grava ja, sem esperar a pausa (antes do render terminar de limpar, por
 * exemplo). Uma gravacao por vez: chamado no meio de outra, grava de novo no fim.
 */
export async function salvarJa(): Promise<void> {
  if (gravando) {
    pendente = true
    await gravando
    return
  }
  gravando = (async () => {
    try {
      do {
        pendente = false
        await gravarAgora()
      } while (pendente)
    } finally {
      gravando = null
    }
  })()
  await gravando
}

export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const unsubscribe = useProject.subscribe((state, anterior) => {
    if (estaCarregando()) return
    // A lista dos campos mora em documento.ts: o desfazer observa a mesma coisa,
    // e as duas respostas para "o usuario editou?" tem que ser uma so.
    if (!mudou(state, anterior)) return
    versao += 1

    // Setar aqui dispara este mesmo observador de novo, mas na segunda passada
    // nenhum campo do documento mudou e a comparacao acima corta o caminho.
    if (!state.projectDirty) useProject.setState({ projectDirty: true })

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void salvarJa()
    }, ESPERA_MS)
  })

  return () => {
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}
