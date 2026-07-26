import { useEffect, useState } from 'react'
import { useProject } from '@/store/project'

/**
 * Drop em toda a janela, nao apenas na area da dropzone. Devolve se algo esta
 * sendo arrastado por cima, para a interface reagir.
 *
 * O caminho real do arquivo vem de webUtils via ponte -- File.path foi removido
 * no Electron 32 e retorna undefined.
 */
export function useFileDrop(): boolean {
  const [isOver, setIsOver] = useState(false)
  const ingest = useProject((s) => s.ingest)

  useEffect(() => {
    let depth = 0

    const onDragEnter = (event: DragEvent) => {
      event.preventDefault()
      depth++
      if (event.dataTransfer?.types.includes('Files')) setIsOver(true)
    }

    const onDragOver = (event: DragEvent) => {
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    const onDragLeave = (event: DragEvent) => {
      event.preventDefault()
      depth = Math.max(depth - 1, 0)
      if (depth === 0) setIsOver(false)
    }

    /*
     * A timeline trata o proprio drop e interrompe a propagacao para as imagens
     * entrarem na posicao certa em vez de irem para o fim da fila. Isso faria o
     * handler de baixo nunca rodar e o destaque de arraste ficar aceso para
     * sempre -- por isso apagar o destaque acontece na fase de captura, que
     * roda antes de qualquer alvo e nao pode ser interrompida por eles.
     */
    const onDropCapture = () => {
      depth = 0
      setIsOver(false)
    }

    const onDrop = (event: DragEvent) => {
      event.preventDefault()

      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return

      const paths = files
        .map((file) => window.dangai.pathForFile(file))
        .filter((path): path is string => Boolean(path))

      if (paths.length > 0) void ingest(paths)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDropCapture, true)
    window.addEventListener('drop', onDrop)

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDropCapture, true)
      window.removeEventListener('drop', onDrop)
    }
  }, [ingest])

  return isOver
}
