import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Library as LibraryIcon, Settings2, X } from 'lucide-react'
import { ehEpisodio, escutarGerar, podeIrAoRoteiro, useGerar, type FaseDoEpisodio } from '../store/gerar'
import { escutarAncut } from '../store/ancut'
import { escutarRoteiro, roteiroAprovado, useRoteiro } from '../store/gerar-roteiro'
import { escutarVoz, useSituacaoDaVoz, useVoz } from '../store/gerar-voz'
import { escutarCenas, useCenas } from '../store/gerar-cenas'
import { roteiroAtual } from '../../shared/roteiro'
import { takeAtual } from '../../shared/voz'
import { cenasDoRascunho, escolhasDesatualizadas } from '../../shared/cenas'
import { avisoDoPasso, PASSOS, passoLiberado } from '../store/gerar-passos'
import { classifyFile } from '@shared/channels'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { AndamentoDaAnalise, Indexando } from './AndamentoDaAnalise'
import { AndamentoDoCorte, corteVivo, textoCurtoDoCorte } from './AndamentoDoCorte'
import { AndamentoDaDescoberta } from './EntradaDaDescoberta'
import { ReconhecerNaMao } from './ReconhecerNaMao'
import { escutarDescoberta } from '../store/gerar-descoberta'
import { AreaDeSoltar, CartaoDoEpisodio } from './CartaoDoEpisodio'
import { EscolhaDoRecap } from './EscolhaDoRecap'
import { PassoDaVoz } from './PassoDaVoz'
import { PassoDasCenas } from './PassoDasCenas'
import { PassoDoRoteiro } from './PassoDoRoteiro'
import { PedidoDeDescoberta, ResultadoDaBusca } from './ResultadoDaBusca'
import { ResumoDoEpisodio } from './ResumoDoEpisodio'
import { RodapeDaVoz } from './RodapeDaVoz'
import { RodapeDasCenas } from './RodapeDasCenas'
import { RodapeDoRoteiro } from './RodapeDoRoteiro'
import { Botao, COR_DE_AVISO } from './pecas'

/**
 * O ASSISTENTE "GERAR RECAP": do episodio ao projeto, em quatro paradas
 * (Episodio -> Roteiro -> Voz -> Cenas -> abrir no Editor). A ordem e a regra
 * de cada parada moram em gerar-passos.ts.
 *
 * Tela cheia por cima do app, como a Biblioteca -- e um lugar, nao um aviso.
 * Fica ABAIXO da Biblioteca, das Configuracoes e da paleta (z-35 contra 40 e
 * 50): "Ver cenas na Biblioteca" e "Trocar pasta" abrem por cima, e fechar
 * volta para ca. O App poe o resto da tela em `inert` enquanto ele esta aberto,
 * para o Tab nao fugir para os botoes escondidos atras.
 *
 * Esc fecha. Fechar nao cancela nada: a IA continua e reabrir mostra onde
 * parou.
 *
 * [recap] No Dangai ele e a tela cheia do modulo (`nucleo.telaCheia`): o
 * nucleo deixa o resto inerte e os atalhos quietos por baixo. Partes 1 a 3:
 * os passos 1 (Episodio), 2 (Roteiro), 3 (Voz) e 4 (Cenas). Parte 4: o corte
 * em segundo plano, o motor e o Reconhecer na mao.
 */
export function GerarRecap() {
  const aberto = useGerar((s) => s.aberto)

  // A escuta mora aqui, e nao no Assistente: o componente monta com o app e
  // continua ouvindo o motor com a tela fechada.
  useEffect(() => escutarGerar(), [])
  // L1: o resultado do "Enviar sempre para o AnCut" ao fim de um corte.
  useEffect(() => escutarAncut(), [])
  useEffect(() => escutarRoteiro(), [])
  useEffect(() => escutarVoz(), [])
  // As sugestoes de cena saem em segundo plano assim que o roteiro e aprovado (com o assistente fechado tambem).
  useEffect(() => escutarCenas(), [])
  // Reconhecer na mao: o andamento e os grupos chegam com o assistente fechado tambem.
  useEffect(() => escutarDescoberta(), [])

  // [recap] Aberto, avisa o nucleo (o resto da janela fica inerte e quieto).
  useEffect(() => {
    nucleo().telaCheia(aberto)
    return () => nucleo().telaCheia(false)
  }, [aberto])

  return (
    <>
      {aberto && <Assistente />}
      {/* A escolha "Novo recap | Continuar" da porta (abrirOuEscolher): fora do assistente, a paleta tambem abre. */}
      <EscolhaDoRecap />
    </>
  )
}

function Assistente() {
  const fase = useGerar((s) => s.fase)
  const passo = useGerar((s) => s.passo)
  const temJob = useGerar((s) => s.job !== null)
  const fechar = useGerar((s) => s.fechar)
  // A IA escrevendo o roteiro: trocar de episodio agora deixaria a resposta gravando no rascunho de outro, fora da vista.
  const temIa = useRoteiro((s) => s.geracao !== null)
  // O mesmo para a voz sendo gerada (passo 3).
  const temVoz = useVoz((s) => s.pedido !== null)
  // O projeto sendo montado (passo 4): trocar de episodio no meio abriria o projeto de outro.
  const montando = useCenas((s) => s.montando)

  const [arrastando, setArrastando] = useState(false)
  /** No passo 3 um audio solto vira a narracao: o aviso do arraste diz isso (pelo tipo, quando o sistema da). */
  const [arrastandoAudio, setArrastandoAudio] = useState(false)
  const profundidade = useRef(0)

  const temArquivos = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')
  const noPassoDaVoz = passo === 3 && fase !== 'vazio'
  const noPassoDasCenas = passo === 4 && fase !== 'vazio'

  /*
   * [recap] O Esc da tela cheia, na SUBIDA ate a janela, como o do App: o
   * que esta por dentro (a lista de versoes, o Meu roteiro, a escolha, um
   * campo) trata o proprio Esc e para a propagacao antes. Com a Biblioteca ou
   * as Configuracoes por cima, quem fecha e o App (a de cima) -- e como o App
   * ja fechou a dele quando o Esc chega aqui, quem estava por cima e lido na
   * DESCIDA (captura), antes de todo mundo.
   */
  useEffect(() => {
    let porCimaNaDescida = false
    const descida = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') porCimaNaDescida = nucleo().haModalPorCima()
    }
    const subida = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || porCimaNaDescida) return
      if (useGerar.getState().escolha !== null) return
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return
      useGerar.getState().fechar()
    }
    window.addEventListener('keydown', descida, true)
    window.addEventListener('keydown', subida)
    return () => {
      window.removeEventListener('keydown', descida, true)
      window.removeEventListener('keydown', subida)
    }
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Gerar recap"
      className="fixed inset-0 z-[35] flex flex-col bg-bg"
      onDragEnter={(e) => {
        if (!temArquivos(e)) return
        e.preventDefault()
        profundidade.current += 1
        setArrastando(true)
        setArrastandoAudio(Array.from(e.dataTransfer.items).some((i) => i.kind === 'file' && i.type.startsWith('audio/')))
      }}
      onDragOver={(e) => {
        if (!temArquivos(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!temArquivos(e)) return
        profundidade.current = Math.max(0, profundidade.current - 1)
        if (profundidade.current === 0) setArrastando(false)
      }}
      onDrop={(e) => {
        /*
         * O drop PARA AQUI, sempre, ate no fundo da tela: o da janela
         * (useFileDrop) faria o ingest do Dangai e o .mkv viraria clipe de um
         * projeto novo por baixo do assistente.
         */
        e.preventDefault()
        e.stopPropagation()
        profundidade.current = 0
        setArrastando(false)
        const caminhos = Array.from(e.dataTransfer.files)
          .map((f) => window.dangai.pathForFile(f))
          .filter((p): p is string => Boolean(p))
        if (caminhos.length === 0) return
        /*
         * No passo 3 o audio solto e a narracao gravada por ele (o texto vem do
         * roteiro, o audio so da os tempos). Episodio continua trocando de
         * episodio; o resto ganha o recado no rodape DESTE passo.
         */
        if (noPassoDaVoz) {
          const audio = caminhos.find((c) => classifyFile(c) === 'audio')
          if (audio) {
            void useVoz.getState().importar(audio)
            return
          }
          if (!caminhos.some(ehEpisodio)) {
            useVoz.setState({ erro: 'Solte um audio (.wav, .mp3, .m4a) ou um episodio.' })
            return
          }
        }
        // O store confere a extensao e diz o que fazer com o que nao for episodio.
        const gerar = useGerar.getState()
        const escolhido = caminhos.find(ehEpisodio) ?? caminhos[0]!
        if (escolhido === gerar.arquivo) return
        if (useCenas.getState().montando) {
          useCenas.setState({ erro: 'Espere o projeto abrir antes de trocar de episodio.' })
          return
        }
        if (useRoteiro.getState().geracao) {
          useRoteiro.setState({ erro: 'Cancele a IA antes de trocar de episodio.' })
          return
        }
        if (useVoz.getState().pedido) {
          // O recado vai para o rodape do passo na tela (cada passo mostra o erro da store dele).
          const erro = 'Cancele a voz antes de trocar de episodio.'
          if (noPassoDaVoz) useVoz.setState({ erro })
          else if (noPassoDasCenas) useCenas.setState({ erro })
          else if (passo === 2) useRoteiro.setState({ erro })
          else useGerar.setState({ erro })
          return
        }
        void gerar.carregarArquivo(escolhido)
      }}
    >
      {/* O mesmo cabecalho da Biblioteca: 46 px, titulo de 15 px, acoes no canto. */}
      <header className="flex h-[46px] shrink-0 items-center gap-3 border-b border-line px-5">
        <h2 className="text-[15px] font-semibold text-ink">Gerar recap</h2>
        <Passos />
        {/* O corte em segundo plano, discreto. */}
        <AndamentoDoCorte />
        <AndamentoDaDescoberta />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => nucleo().abrirConfiguracoes('recap-biblioteca')}
          aria-label="Configuracoes"
          title="Configuracoes (Ctrl+,)"
          className="grid size-6 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
        >
          <Settings2 size={13} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={fechar}
          aria-label="Fechar"
          title={
            temJob
              ? 'Fechar (Esc). A analise continua rodando.'
              : temIa
                ? 'Fechar (Esc). A IA continua.'
                : temVoz
                  ? 'Fechar (Esc). A voz continua.'
                  : 'Fechar (Esc)'
          }
          className="grid size-6 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
        >
          <X size={13} strokeWidth={1.5} />
        </button>
      </header>

      {/*
       * scrollbar-gutter: o lugar da barra de rolagem fica reservado. Sem ele o
       * conteudo pulava 5 px para o lado quando a barra aparecia ou sumia (passo
       * 1 -> 2, o roteiro chegando depois da geracao).
       */}
      {/* O passo 4 rola por dentro (coluna do roteiro e grade, como a Biblioteca): aqui nao rola. */}
      <div
        className={[
          'relative min-h-0 flex-1',
          noPassoDasCenas ? 'overflow-hidden' : 'overflow-y-auto [scrollbar-gutter:stable]',
        ].join(' ')}
      >
        {fase === 'vazio' ? (
          // Sem episodio, a area de soltar e a tela inteira, como o Dropzone da tela inicial.
          <div className="flex h-full p-6">
            <AreaDeSoltar arrastando={arrastando} />
          </div>
        ) : passo === 4 ? (
          <PassoDasCenas />
        ) : passo === 3 ? (
          <PassoDaVoz />
        ) : passo === 2 ? (
          <PassoDoRoteiro />
        ) : (
          <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-6 py-6">
            <CartaoDoEpisodio />
            <PedidoDeDescoberta />
            <ResultadoDaBusca />
            <AndamentoDaAnalise />
            <Indexando />
            <ResumoDoEpisodio />
          </div>
        )}
        {/* bg/90: com /70 o texto da tela vazava por baixo da frase grande e disputava com ela. */}
        {arrastando && fase !== 'vazio' && (
          <div className="pointer-events-none fixed inset-x-0 bottom-[52px] top-[46px] z-20 grid place-items-center bg-bg/90 p-6">
            <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-accent bg-accent-dim">
              <span className="text-[32px] font-semibold tracking-tight text-accent">
                {noPassoDaVoz && arrastandoAudio
                  ? temVoz
                    ? 'Espere a voz terminar'
                    : 'Solte para importar a narracao'
                  : montando
                    ? 'Espere o projeto abrir'
                    : temJob
                    ? 'Cancele a analise antes de trocar'
                    : temIa
                      ? 'Cancele a IA antes de trocar'
                      : temVoz
                        ? 'Cancele a voz antes de trocar'
                        : noPassoDaVoz
                          ? 'Solte a narracao ou um episodio'
                          : 'Solte para trocar de episodio'}
              </span>
            </div>
          </div>
        )}
      </div>

      {noPassoDasCenas ? (
        <RodapeDasCenas />
      ) : noPassoDaVoz ? (
        <RodapeDaVoz />
      ) : passo === 2 && fase !== 'vazio' ? (
        <RodapeDoRoteiro />
      ) : (
        <Rodape />
      )}

      {/* Reconhecer na mao: a tela de grupos por cima de tudo do assistente (z-36). */}
      <ReconhecerNaMao />
    </div>
  )
}

/**
 * Os quatro passos no cabecalho, numa barra so -- o mesmo seletor das
 * Configuracoes (Geral / Atalhos) e dos Segmentos do painel. O passo onde se
 * esta fica marcado; os outros viram botao quando da para ir (a regra e a de
 * gerar-passos.ts: o 2 com o episodio pronto e a regua salva, o 3 com o
 * roteiro aprovado, o 4 com a voz aprovada). O porque de nao poder vai no
 * tooltip, para nao repetir a mesma frase na tela.
 *
 * Mudou um passo depois do seguinte (o roteiro depois da voz, a voz depois
 * das cenas): o seguinte ganha um ponto ambar, com o aviso curto no tooltip.
 */
function Passos() {
  const passo = useGerar((s) => s.passo)
  const fase = useGerar((s) => s.fase)
  const pode2 = useGerar(podeIrAoRoteiro)
  const mudaram = useGerar((s) => s.exclusoesMudaram)
  const episodioId = useGerar((s) => s.indice?.id ?? null)
  const irParaPasso = useGerar((s) => s.irParaPasso)
  const aprovado = useRoteiro((s) => episodioId !== null && s.episodioId === episodioId && roteiroAprovado(s))
  const rascunho = useRoteiro((s) => (episodioId !== null && s.episodioId === episodioId ? s.rascunho : null))

  // Episodio pronto no passo 1: le o rascunho dele (so se ja tem roteiro), e os
  // passos 3 e 4 ja aparecem como sao -- sem precisar passar pelo passo 2.
  useEffect(() => {
    if (episodioId && fase === 'pronto') void useRoteiro.getState().espiar(episodioId)
  }, [episodioId, fase])

  const situacao = useSituacaoDaVoz()
  const vozAprovada = situacao === 'aprovada' && aprovado
  const condicoes = { episodioPronto: pode2, roteiroAprovado: aprovado, vozAprovada }
  // As cenas ja foram encaixadas numa voz e a voz mudou depois (outro take, regravou): o encaixe se refaz ao voltar.
  const cenas = rascunho ? cenasDoRascunho(rascunho) : null
  const roteiro = rascunho ? roteiroAtual(rascunho) : null
  const cenasEncaixadas = cenas !== null && cenas.escolhas.length > 0 && cenas.encaixadoEm !== null
  const foraDaVoz =
    rascunho !== null && roteiro !== null && cenas !== null && cenasEncaixadas
      ? (() => {
          const d = escolhasDesatualizadas(roteiro, takeAtual(rascunho), cenas)
          return d.encaixeVelho || d.duracaoMudou.length > 0
        })()
      : false
  const contexto = { vozDesatualizada: aprovado && situacao === 'desatualizada', cenasEncaixadas, vozAprovada, cenasForaDaVoz: foraDaVoz }

  return (
    <ol aria-label="Passos do assistente" className="ml-3 flex items-center gap-0.5 rounded-sm border border-line bg-elevated p-0.5">
      {PASSOS.map((p) => {
        const atual = p.n === passo
        const feito = (p.n === 1 && fase === 'pronto') || (p.n === 2 && aprovado) || (p.n === 3 && vozAprovada)
        const clicavel = !atual && passoLiberado(p.n, condicoes)
        const aviso = atual ? null : avisoDoPasso(p.n, contexto)
        const motivo = atual
          ? undefined
          : p.n === 1
            ? 'Voltar ao episodio'
            : p.n === 2
              ? pode2
                ? 'Ir ao roteiro'
                : mudaram
                  ? 'Salve as marcacoes de OP/ED antes'
                  : 'Primeiro o episodio'
              : p.n === 3
                ? !pode2
                  ? 'Primeiro o episodio'
                  : aprovado
                    ? 'Ir a voz'
                    : 'Aprove o roteiro antes'
                : !pode2
                  ? 'Primeiro o episodio'
                  : !aprovado
                    ? 'Aprove o roteiro antes'
                    : vozAprovada
                      ? 'Ir as cenas'
                      : 'Aprove a voz antes'
        const dica = aviso && motivo ? `${aviso}. ${motivo}` : (aviso ?? motivo)
        const classe = [
          'flex h-6 items-center gap-1.5 rounded-[3px] px-2.5 text-[11px]',
          atual
            ? 'bg-accent-dim text-ink ring-1 ring-inset ring-accent'
            : clicavel
              ? 'text-ink-2 transition-colors hover:bg-surface hover:text-ink'
              : 'text-ink-3',
        ].join(' ')
        const conteudo = (
          <>
            {feito ? (
              <Check size={11} strokeWidth={2} className="text-accent" aria-label="feito" />
            ) : (
              <span className="tnum">{p.n}</span>
            )}
            {p.nome}
            {aviso && <span aria-label={aviso} className={`-ml-0.5 text-[13px] leading-none ${COR_DE_AVISO}`}>•</span>}
          </>
        )
        return (
          <li key={p.n} aria-current={atual ? 'step' : undefined}>
            {clicavel ? (
              <button type="button" onClick={() => irParaPasso(p.n)} title={dica} className={classe}>
                {conteudo}
              </button>
            ) : (
              <span title={dica} className={classe}>
                {conteudo}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Barra, caixa e barra final nao importam no Windows. */
function normal(caminho: string): string {
  return caminho.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/**
 * As cenas deste episodio estao na Biblioteca do editor? Ela le a libraryDir
 * do Dangai e a raiz `recap:` (a biblioteca do recap, com o modulo ligado). Um
 * episodio do Corte Cenas so esta la se a libraryDir apontar para a pasta dele
 * -- sem isso o "Ver cenas na Biblioteca" abria num episodio errado, sem
 * aviso. Le de novo quando as Configuracoes fecham.
 */
function useNaBibliotecaDoEditor(): boolean {
  const indice = useGerar((s) => s.indice)
  const configuracoesAbertas = nucleo().usar((s) => s.settingsOpen)
  const [libraryDir, setLibraryDir] = useState('')
  useEffect(() => {
    if (configuracoesAbertas) return
    let vivo = true
    void ponte.lerConfig().then((r) => {
      if (vivo && r.ok) setLibraryDir(r.value.bibliotecaDoDangai)
    })
    return () => {
      vivo = false
    }
  }, [configuracoesAbertas])
  if (!indice) return false
  const { origem, pasta } = indice.biblioteca
  if (origem === 'studio' || origem === 'dangai') return true
  if (!libraryDir) return false
  const p = normal(pasta)
  const r = normal(libraryDir)
  return p === r || p.startsWith(`${r}\\`)
}

/**
 * A barra de baixo: onde se esta, e os recados. O erro mora AQUI, em vermelho
 * discreto como na barra de status do editor: no topo da pagina ele ficava
 * fora da vista com a regua rolada, e o clique parecia nao ter feito nada.
 * Clicar no erro (ou no recado) fecha; o texto inteiro fica no tooltip.
 */
function Rodape() {
  const fase = useGerar((s) => s.fase)
  const totalCenas = useGerar((s) => s.indice?.planos.length ?? 0)
  const corte = useGerar((s) => s.corte)
  const mudaram = useGerar((s) => s.exclusoesMudaram)
  const erro = useGerar((s) => s.erro)
  const recado = useGerar((s) => s.recado)
  const limparErro = useGerar((s) => s.limparErro)
  const limparRecado = useGerar((s) => s.limparRecado)
  const verNaBiblioteca = useGerar((s) => s.verNaBiblioteca)
  const irParaPasso = useGerar((s) => s.irParaPasso)
  const pode2 = useGerar(podeIrAoRoteiro)
  const naBiblioteca = useNaBibliotecaDoEditor()

  const texto: Record<FaseDoEpisodio, string> = {
    vazio: '',
    sondando: 'Lendo o episodio...',
    escolha: '',
    analisando: 'Pode fechar: a analise continua',
    indexando: 'Lendo as falas...',
    // As cenas ainda sendo cortadas por tras: "0 cenas" parecia erro; diz onde o corte esta.
    pronto: `${
      totalCenas === 0 && corte && corte.status !== 'pronto'
        ? `Falas prontas · ${textoCurtoDoCorte(corte)}`
        : totalCenas === 0
          ? 'Falas prontas'
          : `Pronto · ${totalCenas.toLocaleString('pt-BR')} cenas`
    }${mudaram ? ' · OP/ED nao salvos' : ''}`,
  }

  return (
    <footer className="flex h-[52px] shrink-0 items-center gap-3 border-t border-line px-5">
      <div className="flex min-w-0 flex-1 items-center" aria-live="polite">
        {erro ? (
          <button
            type="button"
            onClick={limparErro}
            title={`${erro}\n\nClique para fechar o aviso.`}
            className="min-w-0 truncate text-left text-[11px] text-danger"
          >
            {erro}
          </button>
        ) : recado ? (
          <button
            type="button"
            onClick={limparRecado}
            title={`${recado}\n\nClique para fechar o recado.`}
            className="min-w-0 truncate text-left text-[11px] text-ink-2"
          >
            {recado}
          </button>
        ) : (
          <span className="min-w-0 truncate text-[11px] text-ink-3">{texto[fase]}</span>
        )}
      </div>
      {fase === 'pronto' && naBiblioteca && (
        <Botao
          onClick={() => void verNaBiblioteca()}
          // Sem cenas ainda (corte por tras): nada a ver, o botao espera.
          disabled={totalCenas === 0}
          title={
            totalCenas === 0
              ? // Corte cancelado ou parado (sem fotos do elenco) nao esta "sendo cortado".
                corteVivo(corte)
                ? 'As cenas ainda estao sendo cortadas'
                : 'O corte das cenas parou'
              : 'Abre a Biblioteca do editor neste episodio. Fechar a Biblioteca volta para ca.'
          }
        >
          <LibraryIcon size={13} strokeWidth={1.5} className="text-accent" />
          Ver cenas na Biblioteca
        </Botao>
      )}
      {/* A acao que leva adiante: o rosa da tela (com marcacao por salvar, o Salvar assume). */}
      {fase === 'pronto' && (
        <Botao
          principal
          onClick={() => irParaPasso(2)}
          disabled={!pode2}
          title={pode2 ? 'Ir ao roteiro (passo 2)' : 'Salve ou desfaca as marcacoes de OP/ED antes'}
        >
          Proximo: Roteiro
          <ArrowRight size={13} strokeWidth={1.5} />
        </Botao>
      )}
    </footer>
  )
}
