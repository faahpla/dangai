import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Loader2, Plus, TriangleAlert, WandSparkles, X } from 'lucide-react'
import { ehEpisodio, useGerar } from '../store/gerar'
import { haQuantoTempo, type RecapParaContinuar } from '../store/gerar-continuar'
import { usePrenderFoco } from '../hooks/usePrenderFoco'
import { Aviso, COR_DE_AVISO, focarBotao } from './pecas'

/**
 * A ESCOLHA DA PORTA DO "GERAR RECAP" (decisao do Levi, 15/10): "Novo recap"
 * ou "Continuar" um dos ultimos. Antes, o primeiro clique reabria sozinho o
 * ultimo rascunho, e comecar outro episodio pedia um "Trocar episodio".
 *
 * - "Novo recap" e o principal (o unico rosa): clicar abre o dialogo do .mkv,
 *   e soltar o arquivo em qualquer ponto do cartao tambem vale (ele acende
 *   cheio, como o botao da tela inicial);
 * - "Continuar": os ultimos recaps, um por episodio, do mais recente ao mais
 *   antigo (gerar-continuar.ts). Clicar volta no passo onde parou; se nao
 *   abrir (episodio apagado), a lista fica com o porque embaixo.
 *
 * Quem decide se a escolha aparece e o abrirOuEscolher (gerar.ts): sem
 * rascunho nenhum, o clique vai direto ao dialogo, como antes. Monta com o
 * app (GerarRecap) porque a paleta tambem abre a porta, com projeto aberto.
 *
 * Por cima de tudo (portal no body, z-45 como a pergunta do episodio): Esc, o
 * X ou clicar fora fecham sem fazer nada.
 */
export function EscolhaDoRecap() {
  const escolha = useGerar((s) => s.escolha)
  const fechar = useGerar((s) => s.fecharEscolha)
  const aberta = escolha !== null

  useEffect(() => {
    if (!aberta) return
    focarBotao('novo-recap')
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // So a escolha fecha: o Esc nao desce ate o do app (que fecharia o assistente atras).
      e.stopPropagation()
      useGerar.getState().fecharEscolha()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [aberta])

  // O Continuar que nao abriu: o foco volta para a linha dele (a lista ficou, com a marca).
  const falhou = escolha?.falhou ?? null
  useEffect(() => {
    if (falhou) focarBotao(`continuar-${falhou}`, 'novo-recap')
  }, [falhou])

  if (!escolha) return null
  return createPortal(
    <CartaoDaEscolha recaps={escolha.recaps} abrindo={escolha.abrindo} erro={escolha.erro} falhou={falhou} fechar={fechar} />,
    document.body,
  )
}

/** O cartao em si, sem o portal (o teste de tela desenha este: o render do servidor nao tem portal). */
export function CartaoDaEscolha({
  recaps,
  abrindo,
  erro,
  falhou = null,
  fechar,
}: {
  recaps: RecapParaContinuar[]
  abrindo: string | null
  erro: string | null
  /** O episodio cujo Continuar nao abriu: a linha fica marcada. */
  falhou?: string | null
  fechar: () => void
}) {
  const novoRecap = useGerar((s) => s.novoRecap)
  const continuar = useGerar((s) => s.continuar)
  const [arrastando, setArrastando] = useState(false)
  // Entrar num filho dispara leave no pai: conta a profundidade.
  const profundidade = useRef(0)
  const caixa = useRef<HTMLDivElement>(null)
  usePrenderFoco(caixa)
  const temArquivos = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')
  const ocupado = abrindo !== null

  return (
    <div
      className="fixed inset-0 z-[45] grid place-items-center bg-black/45"
      onPointerDown={fechar}
      /*
       * O arraste tambem PARA AQUI (stopPropagation em enter/over/leave): o
       * useFileDrop da janela acendia a area da tela inicial por tras ("Solte
       * para importar"), dois alvos acesos com o drop indo para o Novo recap.
       */
      onDragEnter={(e) => {
        if (!temArquivos(e)) return
        e.preventDefault()
        e.stopPropagation()
        profundidade.current += 1
        setArrastando(true)
      }}
      onDragOver={(e) => {
        if (!temArquivos(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!temArquivos(e)) return
        e.stopPropagation()
        profundidade.current = Math.max(0, profundidade.current - 1)
        if (profundidade.current === 0) setArrastando(false)
      }}
      onDrop={(e) => {
        /*
         * O drop PARA AQUI: a escolha e sobre um recap, e o da janela
         * (useFileDrop) faria o ingest do Dangai e o .mkv viraria clipe de um
         * projeto novo por baixo dela.
         */
        e.preventDefault()
        e.stopPropagation()
        profundidade.current = 0
        setArrastando(false)
        if (ocupado) return
        const caminhos = Array.from(e.dataTransfer.files)
          .map((f) => window.dangai.pathForFile(f))
          .filter((p): p is string => Boolean(p))
        const episodio = caminhos.find(ehEpisodio)
        if (episodio) {
          void novoRecap(episodio)
          return
        }
        const atual = useGerar.getState().escolha
        if (atual && caminhos.length > 0) {
          useGerar.setState({ escolha: { ...atual, erro: 'Solte um episodio em video (.mkv, .mp4, .m4v, .webm ou .mov).' } })
        }
      }}
    >
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-label="Gerar recap"
        onPointerDown={(e) => e.stopPropagation()}
        // Fundo cheio por cima do glass: o titulo grande da tela inicial atravessava.
        style={{ backgroundColor: 'var(--color-elevated)' }}
        className="glass enter flex w-[460px] max-w-[calc(100%-32px)] flex-col gap-4 rounded-lg p-5"
      >
        <header className="flex min-w-0 items-center gap-2.5">
          <WandSparkles size={15} strokeWidth={1.5} className="shrink-0 text-accent" />
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">Gerar recap</h2>
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

        <button
          type="button"
          data-foco="novo-recap"
          onClick={() => void novoRecap()}
          disabled={ocupado}
          title="Escolher o episodio (ou soltar o .mkv aqui)"
          className={[
            'flex h-[88px] w-full shrink-0 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-accent transition-colors duration-150 ease-dangai disabled:cursor-not-allowed disabled:opacity-40',
            arrastando ? 'bg-accent text-white' : 'bg-accent-dim text-ink hover:bg-accent-glow',
          ].join(' ')}
        >
          <span className="flex items-center gap-2 text-[14px] font-medium">
            <Plus size={15} strokeWidth={1.75} className={arrastando ? 'text-white' : 'text-accent'} />
            Novo recap
          </span>
          <span className={['text-[11px]', arrastando ? 'text-white/80' : 'text-ink-3'].join(' ')}>
            Clique ou solte o .mkv
          </span>
        </button>

        <section className="flex min-w-0 flex-col gap-1.5">
          <h3 className="px-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">Continuar</h3>
          <ul className="flex flex-col">
            {recaps.map((r) => (
              <li key={r.episodioId}>
                <LinhaDoRecap
                  recap={r}
                  abrindo={abrindo === r.episodioId}
                  falhou={falhou === r.episodioId}
                  desligada={ocupado}
                  onClick={() => void continuar(r.episodioId)}
                />
              </li>
            ))}
          </ul>
        </section>

        {erro && <Aviso>{erro}</Aviso>}
      </div>
    </div>
  )
}

/** "Dr STONE   S04E24   Voz   ha 2 h  >": anime, episodio, passo e quando, em colunas. */
function LinhaDoRecap({
  recap,
  abrindo,
  falhou,
  desligada,
  onClick,
}: {
  recap: RecapParaContinuar
  abrindo: boolean
  /** O Continuar dela nao abriu (o recado esta embaixo). */
  falhou: boolean
  desligada: boolean
  onClick: () => void
}) {
  const quando = haQuantoTempo(recap.atualizadoEm)
  const nome = [recap.anime, recap.episodio].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      data-foco={`continuar-${recap.episodioId}`}
      onClick={onClick}
      disabled={desligada}
      title={falhou ? `${nome}: nao abriu` : `${nome}: volta no passo ${recap.passo} (${recap.nomeDoPasso})`}
      className="group flex h-9 w-full min-w-0 items-center gap-3 rounded-sm border border-transparent px-2.5 text-left transition-colors duration-150 hover:border-line hover:bg-surface disabled:cursor-not-allowed disabled:hover:border-transparent disabled:hover:bg-transparent"
    >
      {falhou && <TriangleAlert size={12} strokeWidth={1.75} className={`shrink-0 ${COR_DE_AVISO}`} />}
      <span className={['min-w-0 flex-1 truncate text-[12px]', (desligada && !abrindo) || falhou ? 'text-ink-3' : 'text-ink'].join(' ')}>
        {recap.anime}
      </span>
      {recap.episodio && <span className="tnum shrink-0 text-[11px] text-ink-2">{recap.episodio}</span>}
      <span className="w-[52px] shrink-0">
        <span className="rounded-sm border border-line bg-bg px-1.5 py-0.5 text-[10px] text-ink-2">{recap.nomeDoPasso}</span>
      </span>
      <span className="tnum w-[58px] shrink-0 text-right text-[11px] text-ink-3">{quando}</span>
      {abrindo ? (
        <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
      ) : (
        <ChevronRight
          size={13}
          strokeWidth={1.5}
          className="shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      )}
    </button>
  )
}
