import { useEffect, useState } from 'react'
import { Check, Circle, Loader2, RotateCcw, Scissors, TriangleAlert } from 'lucide-react'
import {
  ROTULO_DA_ETAPA,
  ROTULO_DO_STATUS_DO_CORTE,
  type EstadoDoCorte,
  type EtapaDaAnalise,
} from '../../shared/episodio'
import { useGerar } from '../store/gerar'
import { Barra, useRelogio } from './AndamentoDaAnalise'
import { BotaoReconhecerNaMao, LinhaDaDescoberta, useDescobertaViva } from './EntradaDaDescoberta'
import { LinhaDoMotor } from './ResultadoDaBusca'
import { Botao, Caixinha, CAMPO_PEQUENO, CLASSE_DO_CAMPO, formatarTempo, Secao } from './pecas'

/**
 * O CORTE EM SEGUNDO PLANO na tela (decisao do Levi, 14/10): o passo 1 nao
 * espera o motor. As falas saem em segundos, o "Proximo: Roteiro" libera, e as
 * cenas sao cortadas (e os personagens reconhecidos) por tras.
 *
 * - AndamentoDoCorte: a linha discreta no cabecalho do assistente, em qualquer
 *   passo ("Cenas 42%"). Clicar leva ao passo 1, onde mora o detalhe. Com o
 *   assistente fechado quem mostra e a AnaliseNaBarra.
 * - SecaoDoCorte: o detalhe, no passo 1 (ResumoDoEpisodio) -- etapas, barra,
 *   Cancelar e, quando para, o porque e o que fazer ("Cortar sem
 *   personagens"). O passo 4 pode montar a mesma secao enquanto espera.
 */

/** Por quanto tempo o cabecalho diz "Cenas prontas" depois que elas chegam. */
const MOSTRAR_PRONTO_MS = 6000

/** A mesma ordem e as mesmas palavras do AndamentoDaAnalise: e o mesmo motor. */
const ORDEM: EtapaDaAnalise[] = ['preparando', 'elenco', 'detectando', 'cortando', 'personagens', 'organizando']
const SO_COM_PERSONAGENS: EtapaDaAnalise[] = ['elenco', 'personagens']
const ROTULO_CURTO: Record<EtapaDaAnalise, string> = {
  preparando: 'Preparar',
  elenco: 'Elenco',
  detectando: 'Cortes',
  cortando: 'Cenas',
  personagens: 'Personagens',
  organizando: 'Finalizar',
}

function porcento(estado: EstadoDoCorte): string {
  return estado.progresso === null ? '' : `${Math.round(estado.progresso * 100)}%`
}

/** O corte esta vivo no main: cortando, ou esperando a vaga do motor. */
export function corteVivo(estado: EstadoDoCorte | null): boolean {
  if (!estado) return false
  return (
    estado.status === 'cortando' ||
    (estado.status === 'pendente' && (estado.mensagem === 'Na fila' || estado.mensagem === 'Esperando o motor'))
  )
}

/** "Cenas 42%" e companhia, numa palavra ou duas. Compartilhado com a barra de status. */
export function textoCurtoDoCorte(estado: EstadoDoCorte): string {
  if (estado.status === 'cortando') return estado.mensagem === 'Cancelando...' ? 'Cancelando...' : `Cenas ${porcento(estado)}`.trim()
  if (estado.status === 'pendente') return corteVivo(estado) ? ROTULO_DO_STATUS_DO_CORTE.pendente : 'Cenas paradas'
  if (estado.status === 'falhou') return ROTULO_DO_STATUS_DO_CORTE.falhou
  return ROTULO_DO_STATUS_DO_CORTE.pronto
}

/** Um Date.now() que so precisa andar uma vez: some o "Cenas prontas" depois de MOSTRAR_PRONTO_MS. */
function useAindaRecente(desde: number | null): boolean {
  const [, setTique] = useState(0)
  const recente = desde !== null && Date.now() - desde < MOSTRAR_PRONTO_MS
  useEffect(() => {
    if (!recente || desde === null) return
    const t = setTimeout(() => setTique((n) => n + 1), Math.max(0, MOSTRAR_PRONTO_MS - (Date.now() - desde)) + 50)
    return () => clearTimeout(t)
  }, [recente, desde])
  return recente
}

/**
 * A linha discreta do cabecalho: o corte do episodio da tela, em qualquer
 * passo. So aparece enquanto ha algo a dizer (cortando, na fila, parado,
 * falhou) e por uns segundos depois de as cenas chegarem.
 */
export function AndamentoDoCorte() {
  const corte = useGerar((s) => s.corte)
  const passo = useGerar((s) => s.passo)
  const fimEm = useGerar((s) => s.fimDoCorteEm)
  const irParaPasso = useGerar((s) => s.irParaPasso)
  const recente = useAindaRecente(corte?.status === 'pronto' ? fimEm : null)

  if (!corte) return null
  if (corte.status === 'pronto') {
    if (!recente) return null
    return (
      <span className="enter flex h-6 items-center gap-1.5 rounded-sm border border-line bg-elevated px-2 text-[11px] text-ink-2">
        <Check size={11} strokeWidth={2} className="text-accent" />
        Cenas prontas
      </span>
    )
  }

  const vivo = corteVivo(corte)
  const falhou = corte.status === 'falhou'
  const texto = textoCurtoDoCorte(corte)
  const etapa = corte.etapa ? ROTULO_DA_ETAPA[corte.etapa] : null
  const dica = falhou
    ? `O corte das cenas parou${corte.erro ? `: ${corte.erro}` : ''}. As falas e o roteiro continuam valendo.`
    : vivo
      ? `${corte.status === 'cortando' ? `Cortando as cenas por tras${etapa ? ` (${etapa})` : ''}` : 'Na fila do motor'}. Pode seguir; o passo Cenas espera por elas.`
      : 'As cenas ainda nao foram cortadas.'
  const conteudo = (
    <>
      {vivo ? (
        <Loader2 size={11} strokeWidth={1.75} className="shrink-0 animate-spin text-accent" />
      ) : falhou ? (
        <TriangleAlert size={11} strokeWidth={1.75} className="shrink-0 text-ink-3" />
      ) : (
        <Scissors size={11} strokeWidth={1.75} className="shrink-0 text-ink-3" />
      )}
      <span className="tnum whitespace-nowrap">{texto}</span>
    </>
  )
  const classe = 'enter flex h-6 items-center gap-1.5 rounded-sm border border-line bg-elevated px-2 text-[11px] text-ink-2'
  // No passo 1 o detalhe ja esta na tela: a linha so informa.
  if (passo === 1) {
    return (
      <span className={classe} title={dica} aria-live="polite">
        {conteudo}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => irParaPasso(1)}
      title={`${dica}\n\nClique para ver no passo Episodio.`}
      aria-live="polite"
      className={`${classe} transition-colors hover:text-ink`}
    >
      {conteudo}
    </button>
  )
}

/**
 * O detalhe do corte, uma secao "Cenas": so aparece enquanto as cenas nao
 * chegaram. Uma acao principal por tela -- o rosa e o "Proximo: Roteiro" do
 * rodape --, entao tudo aqui e neutro.
 */
export function SecaoDoCorte({ dica = 'Pode seguir para o roteiro.' }: { dica?: string } = {}) {
  const corte = useGerar((s) => s.corte)
  const temIndice = useGerar((s) => s.indice !== null)
  if (!corte || !temIndice || corte.status === 'pronto') return null
  if (corte.status === 'cortando') return <Cortando corte={corte} dica={dica} />
  if (corte.status === 'falhou') return <Parou corte={corte} />
  if (corteVivo(corte)) return <NaFila corte={corte} />
  return <PorCortar corte={corte} />
}

function Cortando({ corte, dica }: { corte: EstadoDoCorte; dica: string }) {
  const cancelarCorte = useGerar((s) => s.cancelarCorte)
  const agora = useRelogio(true)
  const inicio = corte.inicio ? Date.parse(corte.inicio) : Number.NaN
  const decorrido = Number.isFinite(inicio) ? Math.max(0, (agora - inicio) / 1000) : null
  const atual: EtapaDaAnalise = corte.etapa ?? 'preparando'
  const etapas = corte.reconhecer ? ORDEM : ORDEM.filter((e) => !SO_COM_PERSONAGENS.includes(e))
  const iAtual = etapas.indexOf(atual)
  const cancelando = corte.mensagem === 'Cancelando...'
  const frase = corte.mensagem || `${ROTULO_DA_ETAPA[atual]}...`

  return (
    <Secao
      titulo="Cenas"
      acao={
        <div className="flex items-center gap-3">
          {decorrido !== null && (
            <span className="tnum text-[11px] text-ink-3" title="Tempo decorrido">
              {formatarTempo(decorrido)}
            </span>
          )}
          <Botao
            pequeno
            onClick={() => void cancelarCorte()}
            disabled={cancelando}
            title="Para o corte. As falas e o roteiro continuam valendo."
          >
            {cancelando ? 'Cancelando...' : 'Cancelar'}
          </Botao>
        </div>
      }
    >
      <ol className={['grid gap-1.5', etapas.length === 6 ? 'grid-cols-6' : 'grid-cols-4'].join(' ')}>
        {etapas.map((etapa, i) => {
          const eAtual = etapa === atual
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

      <Barra fracao={corte.progresso} />

      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 select-text truncate text-[11px] text-ink-2" title={frase}>
          {frase}
        </p>
        {corte.progresso !== null && <span className="tnum shrink-0 text-[11px] text-ink-3">{porcento(corte)}</span>}
      </div>
      <p className="text-[11px] text-ink-3">{dica}</p>
    </Secao>
  )
}

function NaFila({ corte }: { corte: EstadoDoCorte }) {
  const cancelarCorte = useGerar((s) => s.cancelarCorte)
  const cancelando = corte.mensagem === 'Cancelando...'
  return (
    <Secao
      titulo="Cenas"
      acao={
        <Botao pequeno onClick={() => void cancelarCorte()} disabled={cancelando} title="Tira da fila. As falas continuam valendo.">
          {cancelando ? 'Cancelando...' : 'Cancelar'}
        </Botao>
      }
    >
      <p className="flex items-center gap-2 text-[12px] text-ink-2">
        <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
        {corte.mensagem === 'Esperando o motor' ? 'Esperando o motor terminar outra analise.' : 'Na fila: o motor esta cortando outro episodio.'}
      </p>
      <Barra fracao={null} />
    </Secao>
  )
}

/** O nome do anime para o elenco, ao lado do "Tentar de novo" (o AniList nao achou). */
function CampoDoAnime({ onEnter }: { onEnter: () => void }) {
  const anime = useGerar((s) => s.palpite?.anime ?? '')
  const editarPalpite = useGerar((s) => s.editarPalpite)
  return (
    <input
      type="text"
      value={anime}
      onChange={(e) => editarPalpite({ anime: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onEnter()
        if (e.key === 'Escape') e.currentTarget.blur()
      }}
      aria-label="Anime"
      title="O nome usado para achar o elenco no AniList e no MyAnimeList (em romaji)."
      placeholder="Nome do anime"
      spellCheck={false}
      className={`${CLASSE_DO_CAMPO} ${CAMPO_PEQUENO} w-[240px]`}
    />
  )
}

/**
 * O corte parou: o porque numa linha (inteiro no tooltip) e o que fazer. Sem
 * fotos do elenco, a acao da secao e o [Reconhecer na mao] (rosa, pedido do
 * Levi em 15/10): os nomes que ele da viram as fotos dos proximos episodios.
 */
function Parou({ corte }: { corte: EstadoDoCorte }) {
  const cortarNoFundo = useGerar((s) => s.cortarNoFundo)
  const pedindo = useGerar((s) => s.pedindoCorte)
  const semAnime = useGerar((s) => !s.palpite?.anime.trim())
  const motor = useGerar((s) => s.motor)
  const erro = corte.erro ?? 'O corte parou sem dizer por que.'
  const descobrindo = useDescobertaViva()
  const tentar = (): void => {
    if (!pedindo && !semAnime && !descobrindo) void cortarNoFundo()
  }
  const semElenco = corte.descoberta !== null
  const frase =
    corte.descoberta === 'anime-nao-encontrado'
      ? 'Anime nao achado no AniList/MAL.'
      : corte.descoberta === 'sem-referencias'
        ? 'Sem fotos do elenco.'
        : erro

  return (
    <Secao titulo="Cenas">
      <p className="flex min-w-0 items-start gap-1.5 text-[12px] text-ink-2" title={erro}>
        <TriangleAlert size={13} strokeWidth={1.5} className="mt-px shrink-0 text-ink-3" />
        <span className="min-w-0 select-text truncate">Corte parou: {frase}</span>
      </p>
      {/* Reconhecer na mao rodando: a linha dela no lugar dos botoes (o corte esperaria por ela). */}
      <LinhaDaDescoberta />
      <div className={['flex flex-wrap items-center gap-2', descobrindo ? 'hidden' : ''].join(' ')}>
        {corte.descoberta === 'anime-nao-encontrado' && <CampoDoAnime onEnter={tentar} />}
        <Botao
          pequeno
          onClick={tentar}
          disabled={pedindo || semAnime}
          title={semAnime ? 'Falta o nome do anime' : 'Corta de novo, do mesmo jeito'}
        >
          <RotateCcw size={12} strokeWidth={1.5} />
          Tentar de novo
        </Botao>
        {(semElenco || corte.reconhecer) && (
          <Botao
            pequeno
            onClick={() => void cortarNoFundo({ reconhecer: false })}
            disabled={pedindo}
            title={
              corte.descoberta === 'sem-referencias'
                ? 'As cenas ja estao cortadas: so falta montar, sem os personagens (segundos)'
                : 'Corta sem reconhecer os personagens (bem mais rapido)'
            }
          >
            <Scissors size={12} strokeWidth={1.5} />
            Cortar sem personagens
          </Botao>
        )}
        {/* Sem fotos do elenco: o Levi da os nomes aos grupos de rostos (a acao da secao). */}
        <BotaoReconhecerNaMao principal pequeno />
      </div>
      {corte.motor === 'studio' && !motor?.studio.pronto && <LinhaDoMotor depois={tentar} />}
    </Secao>
  )
}

/** Ninguem esta cortando (cancelou, ou o motor nao subiu): os mesmos botoes do episodio novo. */
function PorCortar({ corte }: { corte: EstadoDoCorte }) {
  const cortarNoFundo = useGerar((s) => s.cortarNoFundo)
  const pedindo = useGerar((s) => s.pedindoCorte)
  const reconhecer = useGerar((s) => s.reconhecer)
  const definirReconhecer = useGerar((s) => s.definirReconhecer)
  const motor = useGerar((s) => s.motor)
  return (
    <Secao titulo="Cenas">
      <p className="text-[12px] text-ink-2">{corte.mensagem === 'Cancelado' ? 'Corte cancelado.' : 'Cenas por cortar.'}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Botao
          pequeno
          onClick={() => void cortarNoFundo({ motor: 'studio', reconhecer })}
          disabled={pedindo}
          title="Corta por tras, na biblioteca do recap. As falas continuam valendo."
        >
          <Scissors size={12} strokeWidth={1.5} />
          Cortar cenas
        </Botao>
        {motor?.ancut.instalado && (
          <Botao
            pequeno
            onClick={() => void cortarNoFundo({ motor: 'ancut', reconhecer })}
            disabled={pedindo}
            title="Usa o AnCut HUB instalado. As cenas ficam na biblioteca dele, e o recap le de la."
          >
            <Scissors size={12} strokeWidth={1.5} />
            Cortar com o AnCut
          </Botao>
        )}
        <span className="ml-1">
          <Caixinha ligada={reconhecer} onChange={definirReconhecer}>
            Reconhecer personagens
          </Caixinha>
        </span>
      </div>
      <LinhaDoMotor depois={() => void cortarNoFundo({ motor: 'studio', reconhecer })} />
    </Secao>
  )
}
