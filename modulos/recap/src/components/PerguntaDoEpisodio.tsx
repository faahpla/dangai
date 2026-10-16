import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Film, Loader2, WandSparkles, X } from 'lucide-react'
import { create } from 'zustand'
import { ehEpisodio, useGerar } from '../store/gerar'
import { nucleo } from '../nucleo'
import { Botao, focarBotao, formatarTempo } from './pecas'

/**
 * UM VIDEO LONGO SOLTO NA TELA INICIAL: episodio ou clipe?
 *
 * No Dangai, todo video solto na area grande vira clipe de um projeto novo.
 * No Studio, um episodio inteiro solto ali quase sempre quer dizer "gerar um
 * recap dele" -- mas ainda pode ser um clipe longo de verdade. Entao, para UM
 * video so e mais longo que EPISODIO_MIN_SEC, a tela pergunta: "Gerar recap
 * com este episodio" (o principal) ou "Usar como clipe" (o caminho do
 * Dangai). Video curto, varios arquivos, audio, imagem: tudo segue como no
 * Dangai, sem pergunta.
 *
 * A DURACAO vem da sonda do main (sondarVideo: o ffprobe que o "Legendar
 * video pronto" ja usa), que le so o cabecalho do arquivo -- exata, em
 * decimos de segundo, sem decodificar nada. O tamanho do arquivo nao serve:
 * um episodio de 24 min em 1080p sai com 300 MB num release leve e 1,5 GB no
 * Corte Cenas, e um clipe 4K de 30 s passa de 400 MB.
 */

/** Daqui para cima, um video solto e tratado como episodio: um episodio de anime tem ~24 min, um clipe raramente passa de 2. */
export const EPISODIO_MIN_SEC = 5 * 60

interface Pergunta {
  path: string
  nome: string
  duracaoSec: number
}

interface EstadoDaPergunta {
  pergunta: Pergunta | null
  /** A sonda esta rodando (o arquivo acabou de cair). */
  sondando: string | null
}

const usePergunta = create<EstadoDaPergunta>(() => ({
  pergunta: null,
  sondando: null,
}))

function nomeDoArquivo(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * Os arquivos soltos (ou escolhidos) sao UM video longo? Entao a pergunta
 * assume e devolve true; o resto (false) segue para o ingest do Dangai. Sonda
 * que falha tambem e false: na duvida, o caminho de sempre.
 */
export async function perguntarSeEpisodio(caminhos: readonly string[]): Promise<boolean> {
  const unico = caminhos.length === 1 ? caminhos[0] : undefined
  if (!unico || !ehEpisodio(unico)) return false
  usePergunta.setState({ sondando: unico })
  const sonda = await window.dangai.sondarVideo(unico)
  if (usePergunta.getState().sondando !== unico) return true
  usePergunta.setState({ sondando: null })
  if (!sonda.ok || sonda.value.durationSec < EPISODIO_MIN_SEC) return false
  usePergunta.setState({
    pergunta: {
      path: unico,
      nome: nomeDoArquivo(unico),
      duracaoSec: sonda.value.durationSec,
    },
  })
  return true
}

/**
 * O cartao da pergunta, por cima da tela inicial INTEIRA (ela continua atras,
 * apagada): com o fundo so na area de soltar, "Projetos recentes" e a barra
 * de status ficavam acesos e clicaveis por baixo. Vai para o body (portal):
 * o `fixed` dentro da area animada ficaria preso a ela. Esc, o X ou clicar
 * fora fecham sem fazer nada.
 */
export function PerguntaDoEpisodio() {
  const pergunta = usePergunta((s) => s.pergunta)
  const sondando = usePergunta((s) => s.sondando)

  const fechar = (): void => usePergunta.setState({ pergunta: null })

  useEffect(() => {
    if (!pergunta) return
    focarBotao('gerar-com-episodio')
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // So a pergunta fecha: o Esc nao desce ate o do app.
      e.stopPropagation()
      fechar()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [pergunta])

  if (!pergunta && sondando) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
        <span className="enter flex items-center gap-2 rounded-sm border border-line bg-bg px-3 py-1.5 text-[12px] text-ink-2">
          <Loader2 size={13} strokeWidth={1.5} className="animate-spin text-accent" />
          {nomeDoArquivo(sondando)}
        </span>
      </div>
    )
  }
  if (!pergunta) return null

  const gerar = (): void => {
    fechar()
    useGerar.getState().abrir(pergunta.path)
  }
  const usarComoClipe = (): void => {
    fechar()
    // [recap] O caminho do Dangai, sem passar de novo pelos modulos.
    void nucleo().trazerArquivos([pergunta.path])
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[45] grid place-items-center bg-black/45"
      onPointerDown={fechar}
      // Outro arquivo solto por cima: vale o que caiu agora (o ingest da janela decide).
      onDrop={fechar}
    >
      <div
        role="dialog"
        aria-label="Episodio"
        onPointerDown={(e) => e.stopPropagation()}
        // Fundo cheio por cima do glass: o titulo grande da tela atravessava os 72% dele.
        style={{ backgroundColor: 'var(--color-elevated)' }}
        className="glass enter flex w-[440px] max-w-[calc(100%-32px)] flex-col gap-4 rounded-lg p-5"
      >
        <header className="flex min-w-0 items-center gap-2.5">
          <Film size={15} strokeWidth={1.5} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink" title={pergunta.path}>
            {pergunta.nome}
          </span>
          <span className="tnum shrink-0 text-[11px] text-ink-3">{formatarTempo(pergunta.duracaoSec)}</span>
          <button
            type="button"
            onClick={fechar}
            aria-label="Fechar"
            title="Fechar (Esc)"
            className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </header>
        <div className="flex flex-wrap justify-end gap-2">
          <Botao onClick={usarComoClipe} title="Vira um clipe de um projeto novo, como no Dangai">
            Usar como clipe
          </Botao>
          <Botao principal foco="gerar-com-episodio" onClick={gerar} title="Abre o assistente com este episodio">
            <WandSparkles size={13} strokeWidth={1.5} />
            Gerar recap com este episodio
          </Botao>
        </div>
      </div>
    </div>,
    document.body,
  )
}
