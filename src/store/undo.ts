import { useProject } from './project'
import { estaCarregando } from './quiet'
import { fotografar, mudou, type Documento } from './documento'

/**
 * Ctrl+Z para o projeto inteiro.
 *
 * Fotografa o documento em vez de registrar cada acao ao contrario. Sao vinte e
 * poucas acoes que mexem no projeto, e cada uma teria que saber se desfazer --
 * o dia em que uma esquecesse, o Ctrl+Z devolveria a coisa errada, que e pior
 * do que nao ter Ctrl+Z. Com fotografia, uma acao nova ja nasce desfazivel.
 *
 * O que conta como documento esta em documento.ts, e e a MESMA lista que o
 * autosave observa: mover a agulha ou selecionar um bloco nao gasta um passo.
 */

/** Passos guardados. Cinquenta cobre uma sessao inteira sem pesar. */
const LIMITE = 50

/**
 * Espera antes de fechar um passo.
 *
 * Arrastar um limite na timeline dispara dezenas de alteracoes por segundo, e
 * uma fotografia por alteracao faria um Ctrl+Z andar um pixel. O passo fecha
 * quando o gesto para -- e o mesmo raciocinio do autosave, com espera menor
 * porque aqui o custo e so memoria.
 */
const ESPERA_MS = 400

interface Pilha {
  atras: Documento[]
  frente: Documento[]
}

const pilha: Pilha = { atras: [], frente: [] }

/** Ligado enquanto aplicamos uma fotografia, para ela nao virar passo novo. */
let aplicando = false

/** O estado de antes do gesto atual, guardado ate o gesto fechar. */
let antesDoGesto: Documento | null = null
let timer: ReturnType<typeof setTimeout> | null = null

export function startUndo(): () => void {
  const unsubscribe = useProject.subscribe((state, anterior) => {
    // Abrir projeto, recuperar autosave e limpar nao sao edicoes: entram pela
    // mesma porta no estado, mas ninguem espera desfaze-los com Ctrl+Z.
    if (aplicando || estaCarregando()) return
    if (!mudou(state, anterior)) return

    /*
     * O primeiro evento da rajada e o unico que ainda enxerga o "antes" de
     * verdade. Do segundo em diante, `anterior` ja e um estado do proprio
     * gesto -- guardar ele faria o Ctrl+Z voltar meio arraste.
     */
    if (antesDoGesto === null) antesDoGesto = fotografar(anterior)

    if (timer) clearTimeout(timer)
    timer = setTimeout(fecharPasso, ESPERA_MS)
  })

  return () => {
    if (timer) clearTimeout(timer)
    timer = null
    antesDoGesto = null
    pilha.atras = []
    pilha.frente = []
    unsubscribe()
  }
}

function fecharPasso(): void {
  timer = null
  if (!antesDoGesto) return

  pilha.atras.push(antesDoGesto)
  if (pilha.atras.length > LIMITE) pilha.atras.shift()
  // Editar depois de desfazer abandona o que estava por refazer -- e o que todo
  // editor faz, e manter seria oferecer um futuro que nao existe mais.
  pilha.frente = []
  antesDoGesto = null
}

/**
 * Fecha o passo em aberto AGORA.
 *
 * Sem isto, apertar Ctrl+Z no meio da espera desfaria o passo anterior e
 * deixaria o gesto recem-feito de pe -- um pulo para tras que ninguem pediu.
 */
function fecharAgora(): void {
  if (timer) clearTimeout(timer)
  fecharPasso()
}

function aplicar(foto: Documento): void {
  aplicando = true
  try {
    // A selecao pode apontar para um bloco que a fotografia nao tem.
    useProject.setState({ ...foto, selectedScene: null })
  } finally {
    aplicando = false
  }
}

export function podeDesfazer(): boolean {
  return pilha.atras.length > 0 || antesDoGesto !== null
}

export function podeRefazer(): boolean {
  return pilha.frente.length > 0
}

/** Volta um passo. Devolve false quando nao ha o que desfazer. */
export function desfazer(): boolean {
  fecharAgora()
  const foto = pilha.atras.pop()
  if (!foto) return false

  pilha.frente.push(fotografar(useProject.getState()))
  aplicar(foto)
  return true
}

/** Refaz o que o desfazer tirou. */
export function refazer(): boolean {
  const foto = pilha.frente.pop()
  if (!foto) return false

  pilha.atras.push(fotografar(useProject.getState()))
  aplicar(foto)
  return true
}
