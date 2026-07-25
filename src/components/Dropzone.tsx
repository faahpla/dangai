import { motion } from 'motion/react'
import { useProject } from '@/store/project'

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
  )
}
