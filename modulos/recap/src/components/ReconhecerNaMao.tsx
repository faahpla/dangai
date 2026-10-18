import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Circle, Link2, Loader2, TriangleAlert, X } from 'lucide-react'
import {
  CENAS_MINIMAS_POR_PERSONAGEM,
  chaveDaPessoa,
  conjuntoDe,
  limparNome,
  mudancasDaDecisao,
  MUDO_PARA_PARAR_MS,
  resumoDaDecisao,
  textoDasMudancas,
  type DecisaoDaDescoberta,
  type DescobertaPronta,
  type ForaDoElenco,
  type GrupoDeRostos,
  type PersonagemDaDecisao,
  type ResumoDaDecisao,
} from '../../shared/descoberta'
import { ROTULO_DA_ETAPA, slugDoEpisodio, type EtapaDaAnalise } from '../../shared/episodio'
import { useGerar } from '../store/gerar'
import { opcoesDoResumo, useDescoberta } from '../store/gerar-descoberta'
import { nucleo } from '../nucleo'
import { Barra, useRelogio } from './AndamentoDaAnalise'
import { BuscarElenco } from './BuscarElenco'
import { CartaoDoGrupo, GrupoAmpliado } from './GrupoDeRostos'
import { LinhaDoMotor } from './ResultadoDaBusca'
import { Botao, COR_DE_AVISO, focarBotao, formatarTempo, Secao } from './pecas'

/**
 * RECONHECER NA MAO, a tela (pedido do Levi, 15/10; contrato em
 * shared/descoberta.ts). Por cima do assistente inteiro, como a Biblioteca:
 * mesmo cabecalho de 46 px, mesmo rodape de 52 px, e a grade de cartoes no
 * meio, no visual da grade do passo 4.
 *
 * - agrupando: as etapas, a barra e o tempo. Pode fechar: segue por tras (a
 *   pilula do cabecalho e a linha do passo 1 mostram).
 * - pronta: os GRUPOS (um por personagem achado), dos com mais cenas para os
 *   com menos; os figurantes recolhidos no fim. Nome com o elenco, Ignorar,
 *   selecionar 2+ e Juntar (ou o mesmo nome em dois grupos), clicar num rosto
 *   amplia o grupo.
 * - salvando: a grade parada e "Salvando..." no rodape; com o motor mudo ha
 *   MUDO_PARA_PARAR_MS, "Parar" (e o main mata sozinho no PRAZO_DO_SALVAR_MS).
 *   Deu certo: a tela fecha e o passo 1 mostra os personagens e o resultado.
 * - falhou: o porque (curto; o cru no tooltip), Tentar de novo -- a decisao
 *   volta nos grupos iguais (gerar-descoberta.ts, `guardada`).
 *
 * Teclado: Tab/Shift+Tab completam e andam entre os nomes, Enter aceita e vai
 * ao proximo, Shift+Enter amplia, Ctrl+Enter confirma (aplicando a opcao
 * marcada no campo), Esc fecha. Fechar com mudancas pergunta e NAO descarta:
 * o processo segue vivo esperando os nomes (ate 60 min). Fechar SEM mudanca
 * nenhuma para o motor: ele segurava a vaga (e a GPU) a toa, e refazer e
 * rapido (corte e rostos em cache).
 */
export function ReconhecerNaMao() {
  const aberta = useDescoberta((s) => s.aberta)
  const episodioId = useDescoberta((s) => s.episodioId)
  const indiceId = useGerar((s) => s.indice?.id ?? null)
  if (!aberta || episodioId === null || episodioId !== indiceId) return null
  return <Tela />
}

const NENHUM: readonly number[] = []

/** Cartoes de 290 px no minimo: a tira de 5 rostos fica com ~55 px por rosto, o bastante para reconhecer alguem. */
const COLUNAS: React.CSSProperties = { gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))' }

/** As etapas da rodada, na ordem do run_discovery (as de corte so quando ele corta antes). */
const ETAPAS: EtapaDaAnalise[] = ['preparando', 'detectando', 'cortando', 'elenco', 'personagens', 'organizando']
const SO_COM_CORTE: EtapaDaAnalise[] = ['detectando', 'cortando']
const ROTULO_CURTO: Record<EtapaDaAnalise, string> = {
  preparando: 'Preparar',
  detectando: 'Cortes',
  cortando: 'Cenas',
  elenco: 'Elenco',
  personagens: 'Rostos',
  organizando: 'Agrupar',
}

/** Fora de campo de texto: ali as setas e as letras sao do campo. */
function digitando(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false
  return alvo.isContentEditable || alvo.closest('input, textarea, select') !== null
}

/** Poe o foco no campo do nome do grupo (rolando ate ele). false = nao esta na tela. */
function focarCampo(key: number): boolean {
  const campo = document.querySelector<HTMLInputElement>(`[data-campo-grupo="${key}"]`)
  if (!campo || campo.disabled) return false
  campo.focus()
  campo.scrollIntoView({ block: 'nearest' })
  return true
}

/**
 * O Ctrl+Enter chega a tela ANTES do campo: a opcao que ele marcou na lista
 * (digitou "lyn", "Lynette Blanc" marcada) entra antes de confirmar.
 */
function aplicarOpcaoMarcada(alvo: EventTarget | null): void {
  if (!(alvo instanceof HTMLInputElement)) return
  const marcada = alvo.dataset['marcada']
  const key = Number(alvo.dataset['grupoDoCampo'])
  if (marcada && Number.isInteger(key)) useDescoberta.getState().nomear(key, marcada)
}

/**
 * Os grupos na ordem da tela: mais cenas primeiro; os de um conjunto juntado
 * logo depois do primeiro dele (juntar se ve). Figurante juntado a um grupo
 * principal sobe com ele; o resto dos figurantes vai para o fim.
 */
function arrumar(
  grupos: readonly GrupoDeRostos[],
  juntar: readonly number[][],
): { principais: GrupoDeRostos[]; figurantes: GrupoDeRostos[] } {
  const porCenas = grupos.map((g, i) => ({ g, i })).sort((a, b) => b.g.cenas - a.g.cenas || a.i - b.i).map(({ g }) => g)
  const porKey = new Map(grupos.map((g) => [g.key, g]))
  const conjunto = (k: number): readonly number[] | null => juntar.find((c) => c.includes(k)) ?? null
  const principal = (g: GrupoDeRostos): boolean => !g.figurante || (conjunto(g.key)?.some((k) => porKey.get(k)?.figurante === false) ?? false)
  const montar = (lista: GrupoDeRostos[]): GrupoDeRostos[] => {
    const saida: GrupoDeRostos[] = []
    const vistos = new Set<number>()
    for (const g of lista) {
      if (vistos.has(g.key)) continue
      const c = conjunto(g.key)
      for (const m of c ? lista.filter((o) => c.includes(o.key)) : [g]) {
        if (vistos.has(m.key)) continue
        vistos.add(m.key)
        saida.push(m)
      }
    }
    return saida
  }
  return { principais: montar(porCenas.filter(principal)), figurantes: montar(porCenas.filter((g) => !principal(g))) }
}

/** A pergunta do fora do elenco, numa linha: "lyn" nao esta no elenco (seria Lynette Blanc?). */
function fraseDoForaDoElenco(fora: readonly ForaDoElenco[]): string {
  if (fora.length === 1) {
    const f = fora[0]!
    return `"${f.nome}" nao esta no elenco${f.parece ? ` (seria ${f.parece}?)` : ''}. Confirmar assim?`
  }
  return `${fora.length} nomes fora do elenco: ${fora.map((f) => f.nome).join(', ')}. Confirmar assim?`
}

function Tela() {
  const estado = useDescoberta((s) => s.estado)
  const pronta = useDescoberta((s) => s.pronta)
  const pedindo = useDescoberta((s) => s.pedindo)
  const confirmando = useDescoberta((s) => s.confirmando)
  const cancelando = useDescoberta((s) => s.cancelando)
  const erro = useDescoberta((s) => s.erro)
  const decisao = useDescoberta((s) => s.decisao)
  const foraDoElenco = useDescoberta((s) => s.perguntaForaDoElenco)
  const fecharTela = useDescoberta((s) => s.fecharTela)
  const cancelar = useDescoberta((s) => s.cancelar)
  const confirmar = useDescoberta((s) => s.confirmar)
  const voltarDaPergunta = useDescoberta((s) => s.voltarDaPergunta)
  const iniciar = useDescoberta((s) => s.iniciar)
  const limparErro = useDescoberta((s) => s.limparErro)
  const indice = useGerar((s) => s.indice)
  const motorPronto = useGerar((s) => s.motor?.studio.pronto === true)

  const [confirmacao, setConfirmacao] = useState<'sair' | 'descartar' | null>(null)
  const raiz = useRef<HTMLDivElement>(null)
  /** O ultimo campo de nome com o foco: fechar uma pergunta devolve o foco a ele. */
  const ultimoCampo = useRef<number | null>(null)

  const status = estado?.status ?? (pedindo ? 'agrupando' : erro ? 'falhou' : null)
  const salvando = confirmando || status === 'salvando'
  const comGrupos = pronta !== null && (status === 'pronta' || status === 'salvando')
  const mudancas = useMemo(() => mudancasDaDecisao(pronta, decisao), [pronta, decisao])
  const resumo = useMemo(() => (pronta ? resumoDaDecisao(pronta.grupos, decisao, opcoesDoResumo(pronta)) : null), [pronta, decisao])
  // O motor mudo no salvando: o "Parar" aparece (o main confere de novo).
  const agora = useRelogio(status === 'salvando')
  const mudoDesde = estado?.atualizadoEm ? Date.parse(estado.atualizadoEm) : Number.NaN
  const podeParar = status === 'salvando' && Number.isFinite(mudoDesde) && agora - mudoDesde >= MUDO_PARA_PARAR_MS

  const voltarAoCampo = useCallback((): void => {
    requestAnimationFrame(() => {
      const k = ultimoCampo.current
      if (k !== null && focarCampo(k)) return
      raiz.current?.focus()
    })
  }, [])

  // A pergunta era daquele momento: os grupos sumiram (salvou, parou), ela some.
  useEffect(() => {
    if (!comGrupos || salvando) setConfirmacao(null)
  }, [comGrupos, salvando])
  // Ele voltou a mexer nos grupos com a pergunta aberta (o Esc saiu sem querer
  // e ele seguiu nomeando): ela ficava no rodape escondendo o Confirmar, e
  // voltava depois da pergunta do fora do elenco. Mexeu, ela some.
  useEffect(() => {
    setConfirmacao(null)
  }, [decisao])
  // Abriu uma pergunta: o foco vai ao Voltar (Enter nao descarta nada). Fechou: volta ao campo.
  const perguntando = confirmacao !== null || foraDoElenco !== null
  const perguntavaAntes = useRef(false)
  useEffect(() => {
    if (perguntando) {
      perguntavaAntes.current = true
      focarBotao('voltar-da-pergunta')
      return
    }
    if (!perguntavaAntes.current) return
    perguntavaAntes.current = false
    voltarAoCampo()
  }, [perguntando, voltarAoCampo])

  // O foco entra na tela: sem isto o teclado seguia no passo de baixo (as setas do passo 4).
  useEffect(() => {
    if (!raiz.current?.contains(document.activeElement)) raiz.current?.focus()
  }, [])

  const sair = useCallback((): void => {
    if (comGrupos && !salvando) {
      if (mudancas.total > 0) setConfirmacao('sair')
      else {
        // Nada feito: fechar para o motor (segurava a vaga e a GPU a toa).
        fecharTela()
        void cancelar()
      }
    } else fecharTela()
  }, [comGrupos, salvando, mudancas.total, fecharTela, cancelar])

  const pedirCancelar = (): void => {
    if (comGrupos && mudancas.total > 0) setConfirmacao('descartar')
    else void cancelar()
  }

  const confirmarAgora = useCallback((): void => {
    if (status !== 'pronta' || salvando) return
    setConfirmacao(null)
    // A pergunta do fora do elenco aberta: o segundo Confirmar (ou Ctrl+Enter) vale.
    void confirmar(useDescoberta.getState().perguntaForaDoElenco !== null)
  }, [status, salvando, confirmar])

  /** Fecha a pergunta do fora do elenco e leva ao primeiro grupo com o nome de fora. */
  const corrigirForaDoElenco = useCallback((): void => {
    const primeiro = useDescoberta.getState().perguntaForaDoElenco?.[0]?.keys[0]
    if (primeiro !== undefined) ultimoCampo.current = primeiro
    voltarDaPergunta()
  }, [voltarDaPergunta])

  const teclas = useRef({ sair, confirmarAgora, confirmacao, corrigirForaDoElenco })
  teclas.current = { sair, confirmarAgora, confirmacao, corrigirForaDoElenco }
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (nucleo().haModalPorCima()) return
      const t = teclas.current
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        e.stopPropagation()
        aplicarOpcaoMarcada(e.target)
        t.confirmarAgora()
        return
      }
      // O grupo ampliado trata o proprio teclado (registrado depois, mas olha antes: ver Grupos).
      if (document.querySelector('[data-grupo-ampliado]')) return
      if (e.key === 'Escape') {
        // A lista do elenco aberta: o Esc e do campo (fecha a lista).
        if (e.target instanceof HTMLElement && e.target.getAttribute('aria-expanded') === 'true') return
        e.preventDefault()
        e.stopPropagation()
        if (useDescoberta.getState().perguntaForaDoElenco) t.corrigirForaDoElenco()
        else if (t.confirmacao) setConfirmacao(null)
        else t.sair()
        return
      }
      // O foco caiu no body (o botao clicado sumiu: Separar, Juntar, a pergunta):
      // a tecla nao pode descer aos atalhos do passo de baixo (as setas e o
      // Espaco do passo 4). Volta para a tela.
      const alvo = e.target
      if (alvo === document.body || alvo === document.documentElement) {
        e.stopPropagation()
        raiz.current?.focus()
      }
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [])

  // O nome do anime como o resto do app (o do indice); o titulo do motor (romaji) so no tooltip.
  const anime = indice?.anime || pronta?.anime || ''
  const episodio = indice ? slugDoEpisodio(indice.temporada, indice.episodio, indice.kind) : ''
  const titulo = [anime, episodio].filter(Boolean).join(' · ')
  const dicaDoTitulo = pronta?.anime && pronta.anime !== anime ? `${titulo}\nNo motor: ${pronta.anime}` : titulo

  return (
    <div
      ref={raiz}
      role="dialog"
      aria-modal="true"
      aria-label="Reconhecer na mao"
      tabIndex={-1}
      className="fixed inset-0 z-[36] flex flex-col bg-bg outline-none"
      // As teclas daqui nao descem ate os atalhos do passo de baixo (as setas e o Espaco do passo 4).
      onKeyDown={(e) => e.stopPropagation()}
      onFocusCapture={(e) => {
        const k = e.target instanceof HTMLElement ? e.target.dataset['campoGrupo'] : undefined
        if (k === undefined) return
        ultimoCampo.current = Number(k)
        // Clicou num nome com a pergunta (sair/descartar) aberta: escolheu continuar.
        setConfirmacao(null)
      }}
      // Soltar um episodio aqui trocaria de episodio por baixo (e cancelaria a descoberta): nada cai.
      onDragEnter={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'none'
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <header className="flex h-[46px] shrink-0 items-center gap-3 border-b border-line px-5">
        <h2 className="shrink-0 text-[15px] font-semibold text-ink">Reconhecer na mao</h2>
        <span className="min-w-0 truncate text-[12px] text-ink-3" title={dicaDoTitulo}>
          {titulo}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={sair}
          aria-label="Fechar"
          title={
            comGrupos
              ? mudancas.total > 0
                ? 'Fechar (Esc). Os grupos e as mudancas ficam esperando.'
                : 'Fechar (Esc). Sem mudancas, para o motor.'
              : status === 'agrupando'
                ? 'Fechar (Esc). Continua por tras.'
                : 'Fechar (Esc)'
          }
          className="grid size-6 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
        >
          <X size={13} strokeWidth={1.5} />
        </button>
      </header>

      {comGrupos && pronta && resumo ? (
        <Grupos pronta={pronta} decisao={decisao} resumo={resumo} salvando={salvando} />
      ) : status === 'falhou' ? (
        <Parou porque={estado?.erro ?? erro ?? 'Parou sem dizer por que.'} detalhe={estado?.detalhe ?? null} motorPronto={motorPronto} />
      ) : (
        <Agrupando />
      )}

      <footer className="flex h-[52px] shrink-0 items-center gap-3 border-t border-line px-5">
        <div className="flex min-w-0 flex-1 items-center" aria-live="polite">
          {foraDoElenco ? (
            <span
              className={`min-w-0 truncate text-[12px] ${COR_DE_AVISO}`}
              title={foraDoElenco.map((f) => `${f.nome}${f.parece ? ` -> ${f.parece}?` : ''}`).join('\n')}
            >
              {fraseDoForaDoElenco(foraDoElenco)}
            </span>
          ) : confirmacao ? (
            <span className={['min-w-0 truncate text-[12px]', confirmacao === 'descartar' ? 'text-danger' : 'text-ink-2'].join(' ')}>
              {confirmacao === 'descartar'
                ? `Descartar ${textoDasMudancas(mudancas)} e parar?`
                : 'Sair sem confirmar? As mudancas ficam guardadas.'}
            </span>
          ) : erro && status !== 'falhou' ? (
            <button
              type="button"
              onClick={limparErro}
              title={`${erro}\n\nClique para fechar o aviso.`}
              className="min-w-0 truncate text-left text-[11px] text-danger"
            >
              {erro}
            </button>
          ) : salvando ? (
            <span className="flex min-w-0 items-center gap-2 text-[11px] text-ink-2">
              <Loader2 size={12} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
              <span className="truncate">
                {estado?.mensagem === 'Parando...'
                  ? 'Parando o motor...'
                  : podeParar
                    ? 'O motor nao responde. Espere ou pare.'
                    : 'Salvando os personagens...'}
              </span>
            </span>
          ) : comGrupos && resumo ? (
            <Contagem resumo={resumo} />
          ) : status === 'falhou' ? (
            <span className="truncate text-[11px] text-ink-3">As cenas ficaram como estavam.</span>
          ) : (
            <span className="truncate text-[11px] text-ink-3">Pode fechar: continua por tras.</span>
          )}
        </div>

        {foraDoElenco ? (
          <Fragment key="fora">
            <Botao foco="voltar-da-pergunta" onClick={corrigirForaDoElenco} title="Corrige o nome (Esc)">
              Voltar
            </Botao>
            <Botao principal onClick={confirmarAgora} disabled={salvando} title="Salva com esses nomes mesmo (Ctrl+Enter)">
              <Check size={13} strokeWidth={1.75} />
              Confirmar assim
            </Botao>
          </Fragment>
        ) : confirmacao ? (
          <Fragment key="pergunta">
            <Botao foco="voltar-da-pergunta" onClick={() => setConfirmacao(null)} title="Continua nomeando (Esc)">
              Voltar
            </Botao>
            {confirmacao === 'descartar' ? (
              <Botao
                principal
                onClick={() => {
                  setConfirmacao(null)
                  void cancelar()
                }}
                disabled={cancelando}
                title="Para a descoberta. As cenas ficam como estao."
              >
                Descartar
              </Botao>
            ) : (
              <Botao
                principal
                onClick={() => {
                  setConfirmacao(null)
                  fecharTela()
                }}
                title="Fecha a tela. Os grupos esperam ate 60 min (Dar nomes, no cabecalho); se o motor cair, as mudancas voltam no Tentar de novo."
              >
                Sair
              </Botao>
            )}
          </Fragment>
        ) : status === 'falhou' ? (
          <Fragment key="parou">
            <Botao onClick={fecharTela}>Fechar</Botao>
            <Botao principal onClick={() => void iniciar()} disabled={pedindo} title="Agrupa de novo (o corte e os rostos ficam em cache; o que voce ja decidiu volta)">
              Tentar de novo
            </Botao>
          </Fragment>
        ) : comGrupos ? (
          <Fragment key="grupos">
            {podeParar || estado?.mensagem === 'Parando...' ? (
              <Botao
                onClick={() => void cancelar()}
                disabled={cancelando || estado?.mensagem === 'Parando...'}
                title="O motor parou de responder. Para o motor; as cenas ficam como estavam."
              >
                {estado?.mensagem === 'Parando...' ? 'Parando...' : 'Parar'}
              </Botao>
            ) : (
              <Botao onClick={pedirCancelar} disabled={salvando || cancelando} title="Descarta os grupos. As cenas ficam como estao.">
                {cancelando ? 'Cancelando...' : 'Cancelar'}
              </Botao>
            )}
            <Botao
              principal
              foco="confirmar-descoberta"
              onClick={confirmarAgora}
              disabled={salvando || (resumo?.erro ?? null) !== null}
              title={resumo?.erro ?? 'Salva os personagens nas cenas e as fotos como referencia (Ctrl+Enter)'}
            >
              {salvando ? (
                <>
                  <Loader2 size={13} strokeWidth={1.5} className="animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Check size={13} strokeWidth={1.75} />
                  Confirmar
                </>
              )}
            </Botao>
          </Fragment>
        ) : (
          <Botao
            key="agrupando"
            onClick={() => void cancelar()}
            disabled={cancelando || !estado?.jobId}
            title="Para de agrupar. As cenas ficam como estao."
          >
            {cancelando ? 'Cancelando...' : 'Cancelar'}
          </Botao>
        )}
      </footer>
    </div>
  )
}

/** "5 personagens · 33 sem nome · 13 figurantes · 2 ignorados", com os personagens e os avisos no tooltip. */
function Contagem({ resumo }: { resumo: ResumoDaDecisao }) {
  const n = resumo.personagens.length
  const grupos = resumo.personagens.reduce((soma, p) => soma + p.keys.length, 0)
  const semNome = resumo.semNome.length
  const figurantes = resumo.figurantes.length
  const marcados = resumo.marcados.length
  const lista = resumo.personagens
    .map((p) => `${p.nome}: ~${p.cenas} ${p.cenas === 1 ? 'cena' : 'cenas'}, ${p.refs} fotos${p.keys.length > 1 ? ` (${p.keys.length} grupos)` : ''}`)
    .join('\n')
  const dica = [
    lista || 'Nenhum personagem ainda.',
    grupos !== n ? `${grupos} grupos com nome viram ${n} ${n === 1 ? 'personagem' : 'personagens'}.` : null,
    semNome > 0 ? `Sem nome = ignorado (${semNome}).` : null,
    figurantes > 0 ? `Figurantes sem nome ficam de fora (${figurantes}).` : null,
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <span className="flex min-w-0 items-center gap-3 text-[11px]">
      <span className="tnum truncate text-ink-2" title={dica}>
        <span className="text-ink">{n}</span> {n === 1 ? 'personagem' : 'personagens'}
        {semNome > 0 && ` · ${semNome} sem nome`}
        {figurantes > 0 && ` · ${figurantes} ${figurantes === 1 ? 'figurante' : 'figurantes'}`}
        {marcados > 0 && ` · ${marcados} ${marcados === 1 ? 'ignorado' : 'ignorados'}`}
      </span>
      {resumo.avisos.length > 0 && (
        <span className={`flex shrink-0 items-center gap-1 ${COR_DE_AVISO}`} title={resumo.avisos.join('\n')}>
          <TriangleAlert size={11} strokeWidth={1.75} />
          {resumo.avisos.length} {resumo.avisos.length === 1 ? 'aviso' : 'avisos'}
        </span>
      )}
      {resumo.erro && n === 0 && <span className="shrink-0 text-ink-3">{resumo.erro}</span>}
    </span>
  )
}

/** O motor agrupando (e cortando antes, quando o episodio ainda nao tinha cenas). */
function Agrupando() {
  const estado = useDescoberta((s) => s.estado)
  const agora = useRelogio(true)
  const inicio = estado?.inicio ? Date.parse(estado.inicio) : Number.NaN
  const decorrido = Number.isFinite(inicio) ? Math.max(0, (agora - inicio) / 1000) : null
  const bruta: EtapaDaAnalise = estado?.etapa ?? 'preparando'
  // Sem corte, o motor ainda passa por 'detectando' ("432 cortes (ja achados antes)"): e o preparar.
  const atual: EtapaDaAnalise = !estado?.comCorte && SO_COM_CORTE.includes(bruta) ? 'preparando' : bruta
  const etapas = estado?.comCorte ? ETAPAS : ETAPAS.filter((e) => !SO_COM_CORTE.includes(e))
  const iAtual = etapas.indexOf(atual)
  const frase = estado?.mensagem || (estado ? `${ROTULO_DA_ETAPA[atual]}...` : 'Comecando...')
  const pct = estado?.progresso != null ? `${Math.round(estado.progresso * 100)}%` : ''

  return (
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-6 py-8">
        <Secao
          titulo="Agrupando rostos"
          acao={
            decorrido !== null ? (
              <span className="tnum text-[11px] text-ink-3" title="Tempo decorrido">
                {formatarTempo(decorrido)}
              </span>
            ) : undefined
          }
        >
          <ol className={['grid gap-1.5', etapas.length === 6 ? 'grid-cols-6' : 'grid-cols-4'].join(' ')}>
            {etapas.map((etapa, i) => {
              const eAtual = estado !== null && etapa === atual
              const feita = iAtual >= 0 && i < iAtual
              return (
                <li
                  key={etapa}
                  title={ROTULO_DA_ETAPA[etapa]}
                  aria-current={eAtual ? 'step' : undefined}
                  className={[
                    'flex h-7 min-w-0 items-center gap-1.5 rounded-sm border px-2',
                    eAtual ? 'border-accent bg-accent-dim' : 'border-line bg-elevated',
                  ].join(' ')}
                >
                  {eAtual ? (
                    <Loader2 size={11} strokeWidth={1.75} className="shrink-0 animate-spin text-accent" />
                  ) : feita ? (
                    <Check size={11} strokeWidth={2} className="shrink-0 text-ink-2" />
                  ) : (
                    <Circle size={11} strokeWidth={1.5} className="shrink-0 text-ink-3" />
                  )}
                  <span className={['min-w-0 truncate text-[11px]', eAtual ? 'text-ink' : feita ? 'text-ink-2' : 'text-ink-3'].join(' ')}>
                    {ROTULO_CURTO[etapa]}
                  </span>
                </li>
              )
            })}
          </ol>
          <Barra fracao={estado?.progresso ?? null} />
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 flex-1 select-text truncate text-[11px] text-ink-2" title={frase}>
              {frase}
            </p>
            {pct && <span className="tnum shrink-0 text-[11px] text-ink-3">{pct}</span>}
          </div>
          {estado?.comCorte && <p className="text-[11px] text-ink-3">Corta as cenas antes: alguns minutos.</p>}
        </Secao>
      </div>
    </div>
  )
}

/** Parou (motor fora, ocupado, episodio que nao pode, grupos expirados): o porque curto, o cru no tooltip. */
function Parou({ porque, detalhe, motorPronto }: { porque: string; detalhe: string | null; motorPronto: boolean }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-6 py-8">
        <Secao titulo="Parou">
          <p className="flex min-w-0 items-start gap-1.5 text-[12px] text-danger" title={detalhe ? `Do motor:\n${detalhe}` : undefined}>
            <TriangleAlert size={13} strokeWidth={1.5} className="mt-px shrink-0" />
            <span className="min-w-0 select-text">{porque}</span>
          </p>
          {!motorPronto && <LinhaDoMotor />}
        </Secao>
      </div>
    </div>
  )
}

/**
 * A GRADE DE GRUPOS e a barra de cima (contagem, selecao e Juntar). O grupo
 * ampliado mora aqui (precisa da ordem da grade para as setas).
 */
function Grupos({
  pronta,
  decisao,
  resumo,
  salvando,
}: {
  pronta: DescobertaPronta
  decisao: DecisaoDaDescoberta
  resumo: ResumoDaDecisao
  salvando: boolean
}) {
  const mostrarFigurantes = useDescoberta((s) => s.mostrarFigurantes)
  const alternarFigurantes = useDescoberta((s) => s.alternarFigurantes)
  const nomear = useDescoberta((s) => s.nomear)
  const ignorar = useDescoberta((s) => s.ignorar)
  const juntar = useDescoberta((s) => s.juntar)
  const separar = useDescoberta((s) => s.separar)
  const alternarRosto = useDescoberta((s) => s.alternarRosto)
  const [selecionados, setSelecionados] = useState<number[]>([])
  const [ampliado, setAmpliado] = useState<number | null>(null)
  // O nome com que as analises chamam o anime: e para ele que a escolha fica guardada.
  const animeDasAnalises = useGerar((s) => s.palpite?.anime.trim() || s.indice?.anime || '')

  const { principais, figurantes } = useMemo(() => arrumar(pronta.grupos, decisao.juntar), [pronta.grupos, decisao.juntar])
  const naTela = useMemo(
    () => [...principais, ...(mostrarFigurantes ? figurantes : [])],
    [principais, figurantes, mostrarFigurantes],
  )
  const porKey = useMemo(() => new Map(pronta.grupos.map((g) => [g.key, g])), [pronta.grupos])
  const ignorados = useMemo(() => new Set(decisao.ignorados), [decisao.ignorados])
  const personagemDe = useMemo(() => {
    const m = new Map<number, PersonagemDaDecisao>()
    for (const p of resumo.personagens) for (const k of p.keys) m.set(k, p)
    return m
  }, [resumo])
  // Pessoa -> quantos grupos tem ela (o campo marca "junta" no elenco). Pela grafia unida do resumo.
  const usados = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of resumo.personagens) m.set(chaveDaPessoa(p.nome), p.keys.length)
    return m
  }, [resumo])
  const proprioDe = (key: number): string => {
    const p = personagemDe.get(key)
    return p ? chaveDaPessoa(p.nome) : ''
  }
  /** O nome que vai ao motor quando nao e o digitado (a grafia do elenco ou a de outro grupo). */
  const viraDe = (key: number): string | null => {
    const p = personagemDe.get(key)
    if (!p) return null
    const dado = limparNome(decisao.nomes[String(key)] ?? '')
    return dado && dado !== p.nome ? p.nome : null
  }

  // Os grupos mudaram (outra rodada): a selecao e o ampliado eram dos de antes.
  useEffect(() => {
    setSelecionados([])
    setAmpliado(null)
  }, [pronta.jobId])

  // Os grupos chegaram (ou a tela reabriu): o foco vai ao primeiro sem nome e
  // nao ignorado (os conhecidos ja tem nome; o ignorado ja foi decidido).
  useEffect(() => {
    const primeiro =
      principais.find((g) => !decisao.ignorados.includes(g.key) && !(decisao.nomes[String(g.key)] ?? '').trim()) ?? principais[0]
    if (!primeiro) return
    requestAnimationFrame(() => focarCampo(primeiro.key))
    // So na chegada dos grupos, nao a cada nome.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronta.jobId])

  // A fila do Tab/Enter, sempre a de agora (os callbacks dos cartoes ficam estaveis).
  const fila = useRef<number[]>([])
  fila.current = naTela.map((g) => g.key)
  const onProximo = useCallback((key: number, direcao: 1 | -1): boolean => {
    const i = fila.current.indexOf(key)
    if (i < 0) return false
    const alvo = fila.current[i + direcao]
    return alvo !== undefined && focarCampo(alvo)
  }, [])
  const onSelecionar = useCallback((key: number): void => {
    setSelecionados((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]))
  }, [])
  const onAmpliar = useCallback((key: number): void => setAmpliado(key), [])
  // Separar some com o proprio botao: o foco vai ao nome do grupo separado (e nao ao body).
  const onSeparar = useCallback(
    (key: number): void => {
      separar(key)
      requestAnimationFrame(() => focarCampo(key))
    },
    [separar],
  )

  const juntarSelecionados = (): void => {
    // O dono e o primeiro na ordem da tela (o de mais cenas): o nome dele vale se ja tiver.
    const ordem = [...principais, ...figurantes].map((g) => g.key).filter((k) => selecionados.includes(k))
    const [dono, ...resto] = ordem
    if (dono === undefined || resto.length === 0) return
    for (const k of resto) juntar(k, dono)
    setSelecionados([])
    requestAnimationFrame(() => focarCampo(dono))
  }

  // Fechou o ampliado: o foco volta ao nome daquele grupo na grade.
  const ampliadoAgora = useRef<number | null>(null)
  ampliadoAgora.current = ampliado
  const fecharAmpliado = useCallback((): void => {
    const atual = ampliadoAgora.current
    setAmpliado(null)
    if (atual !== null) requestAnimationFrame(() => focarCampo(atual))
  }, [])
  const iAmpliado = ampliado === null ? -1 : naTela.findIndex((g) => g.key === ampliado)
  const irAmpliado = useCallback(
    (direcao: 1 | -1): boolean => {
      const i = fila.current.indexOf(ampliado ?? -1)
      const alvo = i < 0 ? undefined : fila.current[i + direcao]
      if (alvo === undefined) return false
      setAmpliado(alvo)
      return true
    },
    [ampliado],
  )

  // O teclado do grupo ampliado: Esc fecha, setas andam, 1-8 tiram/devolvem o rosto, letra vai ao nome VAZIO.
  const teclas = useRef({ ampliado, fecharAmpliado, irAmpliado, alternarRosto, salvando })
  teclas.current = { ampliado, fecharAmpliado, irAmpliado, alternarRosto, salvando }
  useEffect(() => {
    if (ampliado === null) return
    const tecla = (e: KeyboardEvent): void => {
      if (nucleo().haModalPorCima()) return
      const t = teclas.current
      if (t.ampliado === null) return
      if (e.key === 'Escape') {
        if (e.target instanceof HTMLElement && e.target.getAttribute('aria-expanded') === 'true') return
        e.preventDefault()
        e.stopPropagation()
        t.fecharAmpliado()
        return
      }
      if (digitando(e.target) || e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key === 'ArrowLeft') t.irAmpliado(-1)
      else if (e.key === 'ArrowRight') t.irAmpliado(1)
      // O store confere se o rosto existe (grupo com menos de 8 recortes).
      else if (/^[1-8]$/.test(e.key) && !t.salvando) t.alternarRosto(t.ampliado, Number(e.key) - 1)
      else {
        // Uma letra com o foco fora do campo vai ao nome -- so com ele VAZIO: o
        // foco seleciona tudo, e a letra trocava o nome ja dado (ou conhecido).
        if (e.key.length === 1 && e.key !== ' ') {
          const campo = document.querySelector<HTMLInputElement>('[data-grupo-ampliado] input')
          if (campo && !campo.disabled && campo.value.trim() === '') campo.focus()
        }
        return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [ampliado])

  const cartao = (g: GrupoDeRostos) => {
    const k = String(g.key)
    const c = conjuntoDe(decisao, g.key)
    const p = personagemDe.get(g.key)
    return (
      <CartaoDoGrupo
        key={g.key}
        grupo={g}
        nome={decisao.nomes[k] ?? ''}
        vira={viraDe(g.key)}
        proprio={proprioDe(g.key)}
        ignorado={ignorados.has(g.key)}
        junto={c ? { total: c.length, dono: c[0] === g.key } : null}
        mesmoNome={!c && (p?.keys.length ?? 0) > 1}
        poucasCenas={p !== undefined && p.cenas < CENAS_MINIMAS_POR_PERSONAGEM}
        removidos={decisao.removidos[k] ?? NENHUM}
        selecionado={selecionados.includes(g.key)}
        elenco={pronta.elenco}
        usados={usados}
        desligado={salvando}
        onNome={nomear}
        onIgnorar={ignorar}
        onSeparar={onSeparar}
        onSelecionar={onSelecionar}
        onAmpliar={onAmpliar}
        onProximo={onProximo}
      />
    )
  }

  const grupoAmpliado = ampliado !== null ? porKey.get(ampliado) : undefined
  const totalDeGrupos = principais.length + figurantes.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* A barra de cima: a mesma altura e o mesmo cinza da barra de filtros do passo 4. */}
      <div className="flex h-[42px] shrink-0 items-center gap-3 border-b border-line px-5">
        <span
          className="tnum shrink-0 text-[11px] text-ink-3"
          title={[
            `${totalDeGrupos} grupos de rostos (${figurantes.length} figurantes)`,
            `${pronta.totalDeRostos} rostos no episodio`,
            pronta.elenco.length > 0
              ? `Elenco: ${pronta.elenco.length} nomes${pronta.online ? '' : ' (os do banco local)'}`
              : 'Sem elenco: digite os nomes',
            pronta.online ? null : 'O anime nao foi achado no AniList/MAL (nome errado ou sem internet).',
          ]
            .filter(Boolean)
            .join('\n')}
        >
          {principais.length} {principais.length === 1 ? 'grupo' : 'grupos'} · {pronta.totalDeRostos.toLocaleString('pt-BR')} rostos
          {/* "offline" mentia com internet e o nome do anime errado: o motor so diz que nao achou. */}
          {!pronta.online && ' · anime nao achado online'}
        </span>
        {/* A1: o anime nao achado sozinho (ou o elenco errado): ele escolhe e as sugestoes chegam. */}
        <BuscarElenco
          episodioId={pronta.episodioId}
          anime={animeDasAnalises}
          principal={!pronta.online || pronta.elenco.length === 0}
        />
        {selecionados.length > 0 && (
          <span className="enter flex shrink-0 items-center gap-2">
            <span className="tnum text-[11px] text-ink-2">
              {selecionados.length} {selecionados.length === 1 ? 'selecionado' : 'selecionados'}
            </span>
            <Botao
              pequeno
              principal={selecionados.length >= 2}
              onClick={juntarSelecionados}
              disabled={selecionados.length < 2 || salvando}
              title={selecionados.length < 2 ? 'Selecione mais um grupo do mesmo personagem' : 'Os grupos viram um personagem so'}
            >
              <Link2 size={12} strokeWidth={1.75} />
              Juntar
            </Botao>
            <Botao pequeno onClick={() => setSelecionados([])} title="Limpar a selecao">
              Limpar
            </Botao>
          </span>
        )}
        <span className="flex-1" />
        <span className="hidden truncate text-[11px] text-ink-3 lg:inline" title="Shift+Enter amplia o grupo do campo">
          Tab completa · Enter aceita · Ctrl+Enter confirma
        </span>
      </div>

      {/* A grade usa a largura toda, como a Biblioteca e a grade do passo 4. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [scrollbar-gutter:stable]" aria-busy={salvando}>
        <div className="flex w-full flex-col gap-4">
          {principais.length > 0 ? (
            <div className="grid gap-2.5" style={COLUNAS}>
              {principais.map(cartao)}
            </div>
          ) : (
            <p className="py-8 text-center text-[12px] text-ink-3">
              {figurantes.length > 0 ? 'Nenhum grupo grande. Veja os figurantes.' : 'Nenhum rosto agrupado neste episodio.'}
            </p>
          )}

          {figurantes.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={alternarFigurantes}
                aria-expanded={mostrarFigurantes}
                title="Grupos com poucas cenas, ou mais nuca e cabelo do que rosto. Sem nome, ficam de fora."
                className="flex w-fit items-center gap-1 text-[11px] uppercase tracking-wide text-ink-3 transition-colors duration-150 hover:text-ink"
              >
                {mostrarFigurantes ? <ChevronDown size={12} strokeWidth={1.75} /> : <ChevronRight size={12} strokeWidth={1.75} />}
                Figurantes ({figurantes.length})
              </button>
              {mostrarFigurantes && (
                <div className="grid gap-2.5" style={COLUNAS}>
                  {figurantes.map(cartao)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {grupoAmpliado && (
        <div data-grupo-ampliado>
          <GrupoAmpliado
            grupo={grupoAmpliado}
            posicao={Math.max(0, iAmpliado)}
            total={naTela.length}
            nome={decisao.nomes[String(grupoAmpliado.key)] ?? ''}
            proprio={proprioDe(grupoAmpliado.key)}
            ignorado={ignorados.has(grupoAmpliado.key)}
            removidos={decisao.removidos[String(grupoAmpliado.key)] ?? NENHUM}
            elenco={pronta.elenco}
            usados={usados}
            desligado={salvando}
            onNome={nomear}
            onIgnorar={ignorar}
            onAlternarRosto={alternarRosto}
            onIr={irAmpliado}
            onFechar={fecharAmpliado}
          />
        </div>
      )}
    </div>
  )
}
