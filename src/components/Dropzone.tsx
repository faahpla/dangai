import { motion } from 'motion/react'
import { History, Library as LibraryIcon, RectangleHorizontal, RectangleVertical, X } from 'lucide-react'
import { useProject } from '@/store/project'
import { FORMATOS, medidasDo, type Formato } from '@shared/contract'

interface DropzoneProps {
  isDragging: boolean
}

/**
 * Estado vazio: ocupa a tela, uma frase so, um convite para agir. Clicar abre o
 * dialogo nativo -- soltar os arquivos e o caminho principal.
 */
export function Dropzone({ isDragging }: DropzoneProps) {
  const ingest = useProject((s) => s.ingest)
  const busy = useProject((s) => s.busy)

  const pick = async () => {
    const result = await window.dangai.pickFiles()
    if (result.ok && result.value.length > 0) await ingest(result.value)
  }

  return (
    <div className="relative h-full w-full">
      <button
        type="button"
        onClick={pick}
        disabled={busy !== null}
        className={[
          'group relative flex h-full w-full flex-col items-center justify-center gap-5 rounded-lg',
          'border border-dashed transition-colors duration-200 ease-dangai',
          isDragging ? 'border-accent bg-accent-dim' : 'border-line hover:border-line-strong',
        ].join(' ')}
      >
        <motion.div
          animate={{ scale: isDragging ? 1.04 : 1 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center gap-5"
        >
          <span
            className={[
              'text-[32px] font-semibold tracking-tight transition-colors duration-200',
              isDragging ? 'text-accent' : 'text-ink',
            ].join(' ')}
          >
            {busy ?? 'Soltar audio e imagens aqui'}
          </span>
          <span className="text-[13px] text-ink-3">
            A ordem em que voce solta as imagens e a ordem no video
          </span>
          <span className="text-[11px] text-ink-3">
            Solte o roteiro em .txt junto e as legendas saem com o texto exato
          </span>
        </motion.div>
      </button>

      <EscolhaDeFormato />
      <AbrirBiblioteca />
      <Recuperar />
    </div>
  )
}

/**
 * Vertical ou horizontal, escolhido antes de soltar o material.
 *
 * Fica na TELA VAZIA, e nao numa janela na abertura do app. Uma janela na
 * abertura pergunta cedo demais: ela apareceria tambem quando ele so quer
 * reabrir um projeto salvo, e ai a resposta ja esta no arquivo. Aqui a pergunta
 * so existe enquanto nao ha projeto -- que e exatamente quando ela cabe.
 *
 * E some assim que o primeiro arquivo entra. Trocar o formato depois de
 * importar significaria reenquadrar tudo que ja foi enquadrado, entao a escolha
 * acontece antes de haver o que perder.
 */
function EscolhaDeFormato() {
  const formato = useProject((s) => s.formato)
  const definirFormato = useProject((s) => s.definirFormato)
  const busy = useProject((s) => s.busy)

  if (busy !== null) return null

  const rotulo: Record<Formato, { nome: string; dica: string }> = {
    short: { nome: 'Short', dica: 'vertical, para Shorts, Reels e TikTok' },
    long: { nome: 'Long form', dica: 'horizontal, para o YouTube' },
  }

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 gap-1.5">
      {FORMATOS.map((f) => {
        const medidas = medidasDo(f)
        const ativo = formato === f
        const Icone = f === 'long' ? RectangleHorizontal : RectangleVertical
        return (
          <button
            key={f}
            type="button"
            onClick={() => void definirFormato(f)}
            title={rotulo[f].dica}
            className={[
              'pointer-events-auto flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] transition-colors',
              ativo
                ? 'border-accent bg-accent-dim text-ink'
                : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
            ].join(' ')}
          >
            <Icone size={12} strokeWidth={1.5} />
            {rotulo[f].nome}
            <span className="tnum text-ink-3">
              {medidas.width}x{medidas.height}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Atalho para a biblioteca no canto da tela vazia.
 *
 * Fica aqui porque e aqui que a duvida aparece: "que material eu uso neste
 * video?". Discreto de proposito -- soltar arquivo continua sendo o caminho
 * principal, e quem nunca apontou uma pasta de biblioteca nao perde nada
 * ignorando este botao.
 */
function AbrirBiblioteca() {
  const openLibrary = useProject((s) => s.openLibrary)
  const busy = useProject((s) => s.busy)

  if (busy !== null) return null

  return (
    <button
      type="button"
      onClick={() => void openLibrary(true)}
      title="Procurar cenas na biblioteca (Ctrl+B)"
      className="absolute right-6 top-6 flex items-center gap-2 rounded-sm border border-line bg-bg px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink"
    >
      <LibraryIcon size={13} strokeWidth={1.5} className="text-accent" />
      Biblioteca
    </button>
  )
}

/**
 * O convite para retomar o que sobrou da sessao anterior.
 *
 * Fica aqui e nao num modal de propostito: a spec so admite dois, e perguntar
 * "quer recuperar?" antes de o app abrir seria uma parede na frente de quem
 * talvez so queira comecar outro video. Aqui e uma oferta, nao um pedagio --
 * e o X ao lado deixa recusar sem pensar duas vezes.
 */
function Recuperar() {
  const hasAutosave = useProject((s) => s.hasAutosave)
  const busy = useProject((s) => s.busy)
  const restoreAutosave = useProject((s) => s.restoreAutosave)
  const discardAutosave = useProject((s) => s.discardAutosave)

  if (!hasAutosave || busy !== null) return null

  return (
    <div className="enter absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1">
      <button
        type="button"
        onClick={() => void restoreAutosave()}
        title="Reabre a narracao, as imagens, os cortes e as legendas como estavam"
        className="flex items-center gap-2 rounded-sm border border-line bg-bg px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink"
      >
        <History size={13} strokeWidth={1.5} className="text-accent" />
        Continuar de onde parou
      </button>
      <button
        type="button"
        onClick={() => void discardAutosave()}
        aria-label="Descartar o trabalho anterior"
        title="Descartar"
        className="grid size-[30px] place-items-center rounded-sm border border-line bg-bg text-ink-3 transition-colors duration-150 hover:border-line-strong hover:text-ink"
      >
        <X size={13} strokeWidth={1.5} />
      </button>
    </div>
  )
}
