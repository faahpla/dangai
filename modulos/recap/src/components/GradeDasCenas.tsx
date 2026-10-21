import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Link2, Loader2, LocateFixed, Maximize2, RotateCcw, Rows2, Search, X } from 'lucide-react'
import type { TiraDaCena } from '@shared/channels'
import { FORMATO_PADRAO, medidasDo } from '@shared/contract'
import { coberturaDaFonte } from '@shared/camera'
import type { EpisodeIndex, Plano } from '../../shared/episodio'
import { nomeNatural } from '@shared/nomes'
import type { Frase } from '../../shared/roteiro'
import type { CandidatoDeCena, EscolhaDaFrase } from '../../shared/cenas'
import { mesmaCena, passaNaDuracao, useCenas, type FaixaDeDuracao } from '../store/gerar-cenas'
import { formatarTempo } from './pecas'

/**
 * A GRADE DA TELA DE CENAS: a direita da coluna do roteiro, como a Biblioteca
 * do Dangai no modo "por roteiro" (Library.tsx). Mesmos cartoes, mesmas
 * classes, mesmo jeito de escolher -- so que as cenas sao as do episodio do
 * recap e a frase aberta e a do roteiro aprovado.
 *
 * De cima para baixo:
 *   - os filtros (busca e tamanho dos cartoes, Ctrl+roda tambem);
 *   - os personagens do episodio, como botoes (clicar filtra, de novo solta);
 *   - "Sugestoes para este trecho": a fita da frase (ate 6), o porque no hover;
 *   - "Perto deste momento": as cenas vizinhas no episodio;
 *   - o resto do episodio (fora OP/ED), na ordem do episodio.
 *
 * Clique troca a cena alvo da frase; Shift/Ctrl+clique poe mais uma cena;
 * o cartao ja escolhido, clicado de novo, sai (como na Biblioteca). O botao
 * de expandir abre o player grande, com a narracao da frase por cima.
 */

/** Largura alvo de cada cartao. Define quantas colunas cabem. Igual a da Biblioteca. */
const ITEM_ALVO = 190
const TAMANHO_MIN = 120
const TAMANHO_MAX = 520
const GAP = 10
/** Linhas desenhadas fora da vista, de cada lado, para o scroll nao piscar. */
const FOLGA = 3
/** A largura dos cartoes das faixas (a da Biblioteca). */
const LARGURA_DA_FAIXA = 168
const CHAVE_DO_TAMANHO = 'dangai.cenas.tamanho'
/** "Perto deste momento" recolhido ou aberto (escolha dele, por maquina). */
const CHAVE_DAS_VIZINHAS = 'dangai.cenas.vizinhas'
/** Abaixo desta altura de janela, "Perto deste momento" comeca recolhido: a grade precisa do espaco. */
const ALTURA_PARA_ABRIR_VIZINHAS = 900

/** As faixas da Biblioteca, com "Cobre a frase" (plano mais longo que a frase: nada parado). */
const FAIXAS_DE_DURACAO: readonly { valor: FaixaDeDuracao; nome: string }[] = [
  { valor: 'qualquer', nome: 'Qualquer' },
  { valor: 'cobre', nome: 'Cobre a frase' },
  { valor: 'ate2', nome: 'ate 2s' },
  { valor: '2a5', nome: '2 a 5s' },
  { valor: 'mais5', nome: 'mais de 5s' },
]

function lerVizinhasAbertas(): boolean {
  try {
    const v = localStorage.getItem(CHAVE_DAS_VIZINHAS)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* sem armazenamento: decide pela altura */
  }
  return window.innerHeight >= ALTURA_PARA_ABRIR_VIZINHAS
}
function gravarVizinhasAbertas(v: boolean): void {
  try {
    localStorage.setItem(CHAVE_DAS_VIZINHAS, v ? '1' : '0')
  } catch {
    /* vale so nesta sessao */
  }
}

function lerTamanho(): number {
  try {
    const v = Number(localStorage.getItem(CHAVE_DO_TAMANHO))
    return v >= TAMANHO_MIN && v <= TAMANHO_MAX ? v : ITEM_ALVO
  } catch {
    return ITEM_ALVO
  }
}
function gravarTamanho(v: number): void {
  try {
    localStorage.setItem(CHAVE_DO_TAMANHO, String(v))
  } catch {
    /* vale so nesta sessao */
  }
}

/** "Nanami, Ryuusui" -> "Ryusui Nanami": o nome como a tela mostra (o filtro segue pelo cru). */
function natural(nome: string): string {
  return nomeNatural(nome)
}

/** O que a grade precisa saber de um plano para desenhar o cartao (sem carregar o indice inteiro em cada um). */
export interface PlanosDaTela {
  porId: ReadonlyMap<string, Plano>
  episodioId: string
  /** O idioma da legenda ('eng', 'por', '' sem tag): a busca procura nas falas dela. */
  idioma: string
}

export function usePlanosDaTela(indice: EpisodeIndex): PlanosDaTela {
  return useMemo(
    () => ({
      porId: new Map(indice.planos.map((p) => [p.id, p])),
      episodioId: indice.id,
      idioma: indice.faixaLegenda?.idioma ?? '',
    }),
    [indice],
  )
}

/** A busca procura nas falas da LEGENDA: em ingles, palavra em PT nao acha nada -- o campo avisa. */
function textoDaBusca(idioma: string): string {
  const i = idioma.toLowerCase()
  if (i.startsWith('en')) return 'Buscar fala (EN) ou personagem'
  if (i.startsWith('pt') || i.startsWith('por')) return 'Buscar fala ou personagem'
  return 'Buscar fala (como na legenda) ou personagem'
}

/**
 * A lista que o player percorre com as setas: a fita, as vizinhas e o resto,
 * na ordem da tela, com o filtro de duracao (o resto vem do main ja filtrado).
 * `duracao` = os segundos da frase (para "Cobre a frase").
 */
export function useListaDaFrase(
  frase: Pick<Frase, 'id'>,
  escolha: EscolhaDaFrase | null,
  duracao = escolha?.duracao ?? 0,
): {
  sugestoes: CandidatoDeCena[]
  vizinhas: CandidatoDeCena[]
  outras: CandidatoDeCena[]
  carregando: boolean
  erro: string | null
  momento: number | null
} {
  const grade = useCenas((s) => s.grade)
  const faixa = useCenas((s) => s.filtros.duracao)
  return useMemo(() => {
    const valor = grade?.valor ?? null
    const deste = valor !== null && valor.fraseId === frase.id
    const passa = (c: CandidatoDeCena): boolean => passaNaDuracao(c, faixa, duracao)
    return {
      // A fita da frase vem da escolha na tela (instantanea); sem escolha, a da grade.
      sugestoes: escolha?.fita ?? (deste ? valor.sugestoes : []),
      vizinhas: deste ? valor.vizinhas.filter(passa) : [],
      // O resto do episodio quase nao muda de frase para frase: o anterior fica ate o novo chegar.
      outras: (valor?.outras ?? []).filter(passa),
      carregando: grade?.carregando === true || !deste,
      erro: grade?.erro ?? null,
      momento: deste ? valor.momento : null,
    }
  }, [grade, frase.id, escolha, faixa, duracao])
}

export function GradeDasCenas({
  frase,
  escolha,
  planos,
  usadas,
  duracao,
}: {
  frase: Frase
  escolha: EscolhaDaFrase | null
  planos: PlanosDaTela
  /** Planos ja escolhidos em OUTRA frase: apagados, nao proibidos. */
  usadas: ReadonlySet<string>
  /** Os segundos da frase no take (ou a estimativa): o "Cobre a frase" do filtro. */
  duracao: number
}) {
  const filtros = useCenas((s) => s.filtros)
  const definirFiltros = useCenas((s) => s.definirFiltros)
  const carregarGrade = useCenas((s) => s.carregarGrade)
  const personagens = useCenas((s) => s.personagens)
  const sugerindo = useCenas((s) => s.sugerindo)
  const sugerirDeNovo = useCenas((s) => s.sugerirDeNovo)
  const trocarCena = useCenas((s) => s.trocarCena)
  const adicionarCena = useCenas((s) => s.adicionarCena)
  const abrirPrevia = useCenas((s) => s.abrirPrevia)
  const pedirMiniaturas = useCenas((s) => s.pedirMiniaturas)
  const lista = useListaDaFrase(frase, escolha, duracao)
  const [vizinhasAbertas, setVizinhasAbertas] = useState(lerVizinhasAbertas)

  const [tamanho, setTamanho] = useState(lerTamanho)
  const mudarTamanho = useCallback((v: number) => {
    const novo = Math.round(Math.min(TAMANHO_MAX, Math.max(TAMANHO_MIN, v)))
    setTamanho(novo)
    gravarTamanho(novo)
  }, [])

  // A busca espera a mao parar (cada letra seria um pedido ao main).
  const [texto, setTexto] = useState(filtros.busca)
  useEffect(() => {
    if (texto === filtros.busca) return
    const t = setTimeout(() => definirFiltros({ busca: texto }), 250)
    return () => clearTimeout(t)
  }, [texto, filtros.busca, definirFiltros])

  // A fita gravada entra na chave: uma sugestao nova pede a grade de novo.
  const fitaSalva = escolha?.fita.map((c) => c.planoIds.join('+')).join(',') ?? ''
  useEffect(() => {
    void carregarGrade()
  }, [frase.id, filtros, fitaSalva, carregarGrade])

  // As miniaturas das faixas (as da grade sao pedidas so quando entram na vista).
  useEffect(() => {
    const ids = [...lista.sugestoes, ...lista.vizinhas].map((c) => c.planoIds[0]!).filter(Boolean)
    if (ids.length > 0) pedirMiniaturas(planos.episodioId, ids)
  }, [lista.sugestoes, lista.vizinhas, planos.episodioId, pedirMiniaturas])

  // (rodada 4) A metade de baixo do grid ganha o numero da cena dela (clicar de novo tira so ela).
  const ordemDe = (c: CandidatoDeCena): number =>
    (escolha?.cenas.findIndex((e) => mesmaCena(e.candidato, c) || (e.baixo !== undefined && mesmaCena(e.baixo, c))) ?? -1) + 1

  const escolher = (c: CandidatoDeCena, evento?: React.MouseEvent | React.KeyboardEvent): void => {
    if (evento && (evento.shiftKey || evento.ctrlKey || evento.metaKey)) adicionarCena(c, frase.id)
    else trocarCena(c, frase.id)
  }
  const abrir = (c: CandidatoDeCena): void => abrirPrevia({ fraseId: frase.id, candidato: c })
  const vizinhasDe = (c: CandidatoDeCena): void => definirFiltros({ vizinhasDe: c.planoIds[0] ?? null })

  const cartao = (c: CandidatoDeCena, chave: string) => (
    <CartaoDaCena
      key={chave}
      candidato={c}
      plano={planos.porId.get(c.planoIds[0] ?? '') ?? null}
      ordem={ordemDe(c)}
      usada={ordemDe(c) === 0 && c.planoIds.some((id) => usadas.has(id))}
      onEscolher={(e) => escolher(c, e)}
      onAbrir={() => abrir(c)}
      onVizinhas={() => vizinhasDe(c)}
    />
  )

  // Com filtro, a conta e so do que o filtro achou (a fita nao passa pelo filtro):
  // "6 cenas" com a grade vazia parecia engano. Sem filtro, tudo o que esta na tela.
  const filtrando = filtros.busca.trim() !== '' || filtros.personagem !== null || filtros.duracao !== 'qualquer'
  const achadas = lista.vizinhas.length + lista.outras.length
  const total = filtrando ? achadas : lista.sugestoes.length + achadas
  const daFrase = sugerindo === frase.id

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      {/* Os filtros: a mesma barra da Biblioteca (busca, tamanho, contagem). */}
      <div className="flex h-[46px] shrink-0 items-center gap-3 border-b border-line px-4">
        <div className="relative min-w-0 flex-1">
          <Search size={12} strokeWidth={1.5} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && texto) {
                e.preventDefault()
                e.stopPropagation()
                setTexto('')
              }
            }}
            placeholder={textoDaBusca(planos.idioma)}
            spellCheck={false}
            className="w-full select-text rounded-sm border border-line bg-elevated py-1.5 pl-7 pr-2.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5" title="Tamanho das cenas na grade (Ctrl+roda tambem muda)">
          <button
            type="button"
            onClick={() => mudarTamanho(tamanho / 1.25)}
            aria-label="Cenas menores"
            className="grid size-5 place-items-center rounded-sm text-ink-3 hover:text-ink"
          >
            <span className="text-[13px] leading-none">−</span>
          </button>
          <input
            type="range"
            min={TAMANHO_MIN}
            max={TAMANHO_MAX}
            step={10}
            value={tamanho}
            onChange={(e) => mudarTamanho(Number(e.target.value))}
            aria-label="Tamanho das cenas"
            className="dangai-range w-[84px]"
          />
          <button
            type="button"
            onClick={() => mudarTamanho(tamanho * 1.25)}
            aria-label="Cenas maiores"
            className="grid size-5 place-items-center rounded-sm text-ink-3 hover:text-ink"
          >
            <span className="text-[13px] leading-none">+</span>
          </button>
        </div>
        <select
          value={filtros.duracao}
          onChange={(e) => definirFiltros({ duracao: e.target.value as FaixaDeDuracao })}
          title="Duracao da cena"
          className="shrink-0 rounded-sm border border-line bg-elevated px-2 py-1 text-[11px] text-ink-2 focus:border-line-strong focus:outline-none"
        >
          {FAIXAS_DE_DURACAO.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.nome}
            </option>
          ))}
        </select>
        <span
          className="tnum shrink-0 text-[11px] text-ink-3"
          title={filtrando ? 'Cenas que passam no filtro (a fita de sugestoes fica inteira)' : undefined}
        >
          {lista.carregando && total === 0 ? (
            <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
          ) : (
            `${total.toLocaleString('pt-BR')} ${total === 1 ? 'cena' : 'cenas'}`
          )}
        </span>
      </div>

      <AvisoDoGridNaMao fraseId={frase.id} escolha={escolha} />

      <Personagens nomes={personagens} ativo={filtros.personagem} onEscolher={(nome) => definirFiltros({ personagem: nome })} />

      {/* A fita da frase: o que o casar sugere, com o porque. Acima da grade, nunca no lugar dela. */}
      <Faixa
        titulo="Sugestoes para este trecho"
        detalhe={motivoComum(lista.sugestoes)}
        acao={
          <button
            type="button"
            onClick={() => void sugerirDeNovo(frase.id)}
            disabled={sugerindo !== null && sugerindo !== 'auto'}
            title="Sugere de novo so esta frase (a escolha dela volta para a sugestao)"
            className="flex items-center gap-1 rounded-sm border border-line px-2 py-0.5 text-[11px] text-ink-2 transition-colors duration-150 hover:border-accent hover:text-ink disabled:opacity-40"
          >
            {daFrase ? <Loader2 size={11} strokeWidth={1.5} className="animate-spin" /> : <RotateCcw size={11} strokeWidth={1.5} />}
            Sugerir de novo
          </button>
        }
        vazio={lista.sugestoes.length === 0 ? 'Sem sugestao para esta frase. Busque abaixo.' : null}
      >
        {lista.sugestoes.map((c, i) => (
          <div key={`s${i}-${c.planoIds.join('+')}`} className="shrink-0" style={{ width: LARGURA_DA_FAIXA }}>
            {cartao(c, 'c')}
          </div>
        ))}
      </Faixa>

      <Faixa
        titulo="Perto deste momento"
        aberta={vizinhasAbertas || filtros.vizinhasDe !== null}
        onAbrir={(v) => {
          setVizinhasAbertas(v)
          gravarVizinhasAbertas(v)
          if (!v && filtros.vizinhasDe) definirFiltros({ vizinhasDe: null })
        }}
        detalhe={filtros.vizinhasDe ? null : lista.momento !== null ? formatarTempo(lista.momento) : null}
        acao={
          filtros.vizinhasDe ? (
            <button
              type="button"
              onClick={() => definirFiltros({ vizinhasDe: null })}
              title="Voltar ao momento da frase"
              className="flex items-center gap-1 rounded-sm border border-accent bg-accent-dim px-2 py-0.5 text-[11px] text-ink transition-colors duration-150 hover:bg-accent-glow"
            >
              Cena {filtros.vizinhasDe}
              <X size={11} strokeWidth={1.75} />
            </button>
          ) : null
        }
        vazio={
          lista.carregando && lista.vizinhas.length === 0
            ? 'carregando'
            : lista.vizinhas.length === 0
              ? 'Nada perto deste momento.'
              : null
        }
      >
        {lista.vizinhas.map((c, i) => (
          <div key={`v${i}-${c.planoIds.join('+')}`} className="shrink-0" style={{ width: LARGURA_DA_FAIXA }}>
            {cartao(c, 'c')}
          </div>
        ))}
      </Faixa>

      {lista.erro ? (
        <div className="grid flex-1 place-items-center px-6 text-center text-[12px] text-danger">{lista.erro}</div>
      ) : (
        <GradeDeCartoes
          itens={lista.outras}
          carregando={lista.carregando}
          // So filtro novo volta ao topo (como a Biblioteca): trocar de frase mantem onde ele estava no episodio.
          chave={[filtros.personagem ?? '', filtros.busca].join('|')}
          tamanho={tamanho}
          onTamanho={mudarTamanho}
          onVisiveis={(ids) => pedirMiniaturas(planos.episodioId, ids)}
          desenhar={(c) => cartao(c, c.planoIds.join('+'))}
        />
      )}
    </div>
  )
}

/** O motivo da maioria, uma vez so no cabecalho (como a Biblioteca): repetir em cada cartao so enchia de texto. */
/**
 * (20/10) O AVISO DO GRID NA MAO, no topo da grade: o que falta fazer (a cena
 * de cima na esquerda, ou a de baixo aqui), a sugestao do app que ja entrou e
 * como sair (Esc cancela).
 */
function AvisoDoGridNaMao({ fraseId, escolha }: { fraseId: string; escolha: EscolhaDaFrase | null }) {
  const g = useCenas((s) => (s.gridNaMao?.fraseId === fraseId ? s.gridNaMao : null))
  const manterSugestao = useCenas((s) => s.manterSugestao)
  const cancelarGrid = useCenas((s) => s.cancelarGrid)
  if (!g) return null
  const baixo = g.etapa === 'baixo' ? escolha?.cenas[g.cena]?.baixo : undefined
  const sugerida = baixo !== undefined && baixo.origem !== 'usuario'
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-accent/40 bg-accent/15 px-4 py-2 text-[12px] text-ink"
      data-grid-na-mao={g.etapa}
    >
      <Rows2 size={13} strokeWidth={2} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        {g.etapa === 'cima' ? (
          <>
            <b className="font-semibold text-accent">Grid:</b> na esquerda, clique na cena que vai EM CIMA
          </>
        ) : (
          <>
            <b className="font-semibold text-accent">Agora clique na cena que vai EMBAIXO</b>
            {g.buscando ? (
              <span className="text-ink-3"> · procurando uma sugestao...</span>
            ) : sugerida ? (
              <span className="text-ink-3"> · a sugestao do app ja esta embaixo (clique numa cena para trocar)</span>
            ) : null}
          </>
        )}
      </span>
      {sugerida && !g.buscando && (
        <button
          type="button"
          onClick={manterSugestao}
          title="Fica a sugestao do app embaixo"
          className="shrink-0 rounded-sm border border-accent/60 px-2 py-0.5 text-[11px] text-ink transition-colors duration-150 hover:bg-accent/20"
        >
          Manter a sugestao
        </button>
      )}
      <button
        type="button"
        onClick={cancelarGrid}
        title="Cancela o grid (Esc): a frase volta a como estava"
        className="shrink-0 rounded-sm px-2 py-0.5 text-[11px] text-ink-3 transition-colors duration-150 hover:bg-elevated hover:text-ink"
      >
        Cancelar (Esc)
      </button>
    </div>
  )
}

function motivoComum(candidatos: readonly CandidatoDeCena[]): string | null {
  const conta = new Map<string, number>()
  for (const c of candidatos) {
    const motivo = c.porque[0] ?? ''
    if (motivo) conta.set(motivo, (conta.get(motivo) ?? 0) + 1)
  }
  const [motivo, quantos] = [...conta].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
  return quantos > 0 && quantos >= candidatos.length / 2 ? motivo : null
}

/**
 * Os personagens do episodio, como botoes (os da Biblioteca). UMA linha, os
 * que mais aparecem primeiro, e "+N" no fim abre o resto: em duas linhas eles
 * espremiam a grade em 1280x800. O filtrado fica sempre a vista.
 *
 * Quantos cabem sai de uma REGUA invisivel com todos os botoes (nome e largura
 * variam); medir os proprios botoes da linha mudaria a medida a cada corte.
 */
function Personagens({
  nomes,
  ativo,
  onEscolher,
}: {
  nomes: readonly { nome: string; cenas: number }[]
  ativo: string | null
  onEscolher: (nome: string | null) => void
}) {
  const [todos, setTodos] = useState(false)
  const [cabem, setCabem] = useState<number>(Infinity)
  const regua = useRef<HTMLDivElement>(null)
  const ordenados = useMemo(
    () =>
      nomes
        .map((p) => ({ ...p, rotulo: natural(p.nome) }))
        .sort((a, b) => b.cenas - a.cenas || a.rotulo.localeCompare(b.rotulo, 'pt-BR', { sensitivity: 'base' })),
    [nomes],
  )

  useLayoutEffect(() => {
    const alvo = regua.current
    if (!alvo) return
    const medir = (): void => {
      const largura = alvo.clientWidth
      const botoes = [...alvo.children] as HTMLElement[]
      const ultimo = botoes[botoes.length - 1]
      if (!ultimo || ultimo.offsetLeft + ultimo.offsetWidth <= largura) {
        setCabem(Infinity)
        return
      }
      // O "+N" fica fora da linha (a linha encolhe e a regua mede de novo). O primeiro botao e o "Todos".
      let n = 0
      for (const b of botoes.slice(1)) {
        if (b.offsetLeft + b.offsetWidth > largura) break
        n += 1
      }
      setCabem(Math.max(1, n))
    }
    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(alvo)
    return () => observer.disconnect()
  }, [ordenados])

  if (ordenados.length === 0) return null
  const botao = (ligado: boolean): string =>
    [
      'flex h-6 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-[11px] transition-colors duration-150',
      ligado ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:text-ink',
    ].join(' ')
  // Recolhido: os que cabem; o ativo entra no lugar do ultimo se nao couber (o filtro em uso nunca some).
  const recolhido = !todos && cabem !== Infinity
  const daLinha = recolhido ? ordenados.slice(0, cabem) : ordenados
  const visiveis =
    recolhido && ativo !== null && !daLinha.some((p) => p.nome === ativo)
      ? [...daLinha.slice(0, -1), ...ordenados.filter((p) => p.nome === ativo)]
      : daLinha
  const escondidos = ordenados.length - visiveis.length
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-line px-3 py-2">
      <span className="shrink-0 pt-1 text-[11px] uppercase tracking-wide text-ink-3">Personagens</span>
      <div className="relative min-w-0 flex-1">
        <div
          ref={regua}
          aria-hidden="true"
          className="pointer-events-none invisible absolute inset-x-0 top-0 flex flex-nowrap gap-1 overflow-hidden"
        >
          <span className={botao(false)}>Todos</span>
          {ordenados.map((p) => (
            <span key={p.nome} className={botao(false)}>
              {p.rotulo}
              <span className="tnum text-[10px]">{p.cenas.toLocaleString('pt-BR')}</span>
            </span>
          ))}
        </div>
        <div className={['flex gap-1', todos ? 'max-h-[52px] flex-wrap overflow-y-auto' : 'flex-nowrap overflow-hidden'].join(' ')}>
          <button type="button" onClick={() => onEscolher(null)} className={botao(ativo === null)}>
            Todos
          </button>
          {visiveis.map((p) => (
            <button
              key={p.nome}
              type="button"
              onClick={() => onEscolher(ativo === p.nome ? null : p.nome)}
              className={botao(ativo === p.nome)}
            >
              {p.rotulo}
              <span className="tnum text-[10px] text-ink-3">{p.cenas.toLocaleString('pt-BR')}</span>
            </button>
          ))}
        </div>
      </div>
      {/* Fora da linha: aberto, o "Menos" continua a vista (dentro, ele rolava junto). */}
      {(escondidos > 0 || todos) && cabem !== Infinity && (
        <button
          type="button"
          onClick={() => setTodos(!todos)}
          title={todos ? 'Mostrar uma linha so' : `Mais ${escondidos} personagens`}
          className="flex h-6 shrink-0 items-center rounded-sm border border-line bg-elevated px-2 text-[11px] text-ink-3 transition-colors duration-150 hover:text-ink"
        >
          {todos ? 'Menos' : `+${escondidos}`}
        </button>
      )}
    </div>
  )
}

/**
 * Uma faixa que rola na horizontal, com o cabecalho da faixa de sugestoes da
 * Biblioteca. Com `onAbrir`, o titulo recolhe e abre a faixa (so o cabecalho
 * fica): em tela baixa a grade precisa do espaco.
 */
function Faixa({
  titulo,
  detalhe,
  acao,
  vazio,
  aberta = true,
  onAbrir,
  children,
}: {
  titulo: string
  detalhe: string | null
  acao?: React.ReactNode
  /** Texto curto no lugar dos cartoes. 'carregando' = o giro. null = ha cartoes. */
  vazio: string | null
  aberta?: boolean
  onAbrir?: (aberta: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div className={['shrink-0 border-b border-line px-3 pt-2', aberta ? 'pb-3' : 'pb-2'].join(' ')}>
      <div className={['flex min-h-[22px] items-center gap-2', aberta ? 'mb-1.5' : ''].join(' ')}>
        {onAbrir ? (
          <button
            type="button"
            onClick={() => onAbrir(!aberta)}
            aria-expanded={aberta}
            title={aberta ? 'Recolher' : 'Mostrar'}
            className="flex shrink-0 items-center gap-1 text-[11px] uppercase tracking-wide text-ink-3 transition-colors duration-150 hover:text-ink"
          >
            {aberta ? <ChevronDown size={12} strokeWidth={1.75} /> : <ChevronRight size={12} strokeWidth={1.75} />}
            {titulo}
          </button>
        ) : (
          <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-3">{titulo}</span>
        )}
        {detalhe && <span className="tnum min-w-0 truncate text-[11px] text-ink-3">· {detalhe}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-3">{acao}</span>
      </div>
      {!aberta ? null : vazio === 'carregando' ? (
        <div className="flex h-[96px] items-center gap-2 text-[11px] text-ink-3">
          <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
        </div>
      ) : vazio ? (
        <p className="py-1 text-[11px] text-ink-3">{vazio}</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">{children}</div>
      )}
    </div>
  )
}

/**
 * O resto do episodio, com janela de rolagem (a mesma conta da Grade da
 * Biblioteca): so as linhas visiveis vao para o DOM, e as miniaturas so sao
 * pedidas quando entram na vista. Filtro novo (ou outra frase) volta ao topo.
 */
function GradeDeCartoes({
  itens,
  carregando,
  chave,
  tamanho,
  onTamanho,
  onVisiveis,
  desenhar,
}: {
  itens: readonly CandidatoDeCena[]
  carregando: boolean
  chave: string
  tamanho: number
  onTamanho: (v: number) => void
  onVisiveis: (planoIds: string[]) => void
  desenhar: (c: CandidatoDeCena) => React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(0)
  const [altura, setAltura] = useState(0)
  const [scroll, setScroll] = useState(0)

  // A medida sai antes da pintura (o ResizeObserver atrasa com a janela parada), como na Biblioteca.
  useLayoutEffect(() => {
    const alvo = ref.current
    if (!alvo) return
    const medir = (): void => {
      setLargura(alvo.clientWidth)
      setAltura(alvo.clientHeight)
    }
    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(alvo)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
    setScroll(0)
  }, [chave])

  // Ctrl+roda muda o tamanho dos cartoes, como o zoom de um editor.
  const tamanhoRef = useRef(tamanho)
  tamanhoRef.current = tamanho
  useEffect(() => {
    const alvo = ref.current
    if (!alvo) return
    const roda = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      onTamanho(tamanhoRef.current * Math.exp(-e.deltaY * 0.0015))
    }
    alvo.addEventListener('wheel', roda, { passive: false })
    return () => alvo.removeEventListener('wheel', roda)
  }, [onTamanho])

  const colunas = Math.max(1, Math.floor((largura + GAP) / (tamanho + GAP)))
  const itemW = largura > 0 ? (largura - GAP * (colunas - 1) - 24) / colunas : 0
  // O cartao tem borda de 1 px: a miniatura 16:9 e da largura de dentro, e a linha soma as duas bordas.
  const linhaH = Math.max(1, Math.round(((itemW - 2) * 9) / 16 + 2) + GAP)
  const linhas = Math.ceil(itens.length / colunas)
  const primeira = Math.max(0, Math.floor(scroll / linhaH) - FOLGA)
  const ultima = Math.min(linhas, Math.ceil((scroll + altura) / linhaH) + FOLGA)
  const visiveis = itens.slice(primeira * colunas, ultima * colunas)

  const idsVisiveis = visiveis.map((c) => c.planoIds[0] ?? '').join(',')
  const onVisiveisRef = useRef(onVisiveis)
  onVisiveisRef.current = onVisiveis
  useEffect(() => {
    if (idsVisiveis) onVisiveisRef.current(idsVisiveis.split(',').filter(Boolean))
  }, [idsVisiveis])

  // O mesmo elemento sempre (vazio ou nao): a medida e a roda de Ctrl ficam presas nele desde a montagem.
  return (
    <div ref={ref} onScroll={(e) => setScroll(e.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {itens.length === 0 ? (
        <div className="grid h-full place-items-center text-[13px] text-ink-3">
          {carregando ? (
            <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-accent" />
          ) : (
            'Nenhuma cena com esses filtros.'
          )}
        </div>
      ) : (
        <div style={{ height: linhas * linhaH, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              top: primeira * linhaH,
              left: 0,
              right: 0,
              display: 'grid',
              gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))`,
              gap: GAP,
            }}
          >
            {itemW > 0 && visiveis.map((c) => desenhar(c))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Uma cena na grade: o MESMO cartao da Biblioteca (Library.tsx, Cartao) --
 * miniatura que o mouse percorre como agulha (a tira de quadros do main), a
 * janela do 9:16 escurecida nas bordas, a duracao no canto, o numero da
 * ordem quando escolhida, apagada quando ja usada noutra frase. O texto mora
 * no tooltip ("escolho pela imagem").
 *
 * Sem a estrela de favorito (favorito e da biblioteca, nao deste recap); no
 * lugar dela, "Perto desta cena" (as vizinhas a partir dela).
 */
export const CartaoDaCena = memo(function CartaoDaCena({
  candidato,
  plano,
  ordem,
  usada,
  onEscolher,
  onAbrir,
  onVizinhas,
}: {
  candidato: CandidatoDeCena
  /** O primeiro plano do candidato (arquivo, personagens). null = fora do indice. */
  plano: Plano | null
  /** Posicao na frase, comecando em 1. Zero = nao escolhida. */
  ordem: number
  usada: boolean
  onEscolher: (evento?: React.MouseEvent | React.KeyboardEvent) => void
  onAbrir: () => void
  onVizinhas: () => void
}) {
  const marcado = ordem > 0
  const id = candidato.planoIds[0] ?? ''
  const miniatura = useCenas((s) => s.miniaturas[id] ?? null)
  const [dentro, setDentro] = useState(false)
  const [quebrou, setQuebrou] = useState(false)
  const timer = useRef<number | null>(null)
  const [tira, setTira] = useState<TiraDaCena | null>(null)
  const [fracao, setFracao] = useState<number | null>(null)
  const pedindo = useRef(false)
  const arquivo = plano?.arquivo ?? null

  useEffect(() => setQuebrou(false), [miniatura])

  const apontar = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const caixa = e.currentTarget.getBoundingClientRect()
    setFracao(Math.min(Math.max((e.clientX - caixa.left) / caixa.width, 0), 1))
  }, [])

  // A tira de quadros (a mesma da Biblioteca): o mouse e a agulha do clipe, custo zero por movimento.
  const entrar = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setDentro(true)
      apontar(e)
      if (tira || pedindo.current || !arquivo) return
      timer.current = window.setTimeout(() => {
        pedindo.current = true
        void window.dangai.libraryClipStrip(arquivo).then((r) => {
          if (!r.ok) {
            pedindo.current = false
            return
          }
          const img = new Image()
          img.onload = () => setTira(r.value)
          img.onerror = () => {
            pedindo.current = false
          }
          img.src = r.value.url
        })
      }, 120)
    },
    [arquivo, apontar, tira],
  )

  const sair = useCallback(() => {
    setDentro(false)
    setFracao(null)
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  // [recap] Num clipe mesclado pelo Dangai, a tira e do mesclado inteiro: a agulha anda so no pedaco do plano.
  const pedaco =
    plano && plano.inicioNoArquivo !== undefined && plano.duracaoDoArquivo
      ? { de: plano.inicioNoArquivo / plano.duracaoDoArquivo, ate: (plano.inicioNoArquivo + plano.end - plano.start) / plano.duracaoDoArquivo }
      : { de: 0, ate: 1 }
  const naTira = fracao === null ? null : Math.min(Math.max(pedaco.de + fracao * (pedaco.ate - pedaco.de), 0), 1)
  const quadroDaTira = tira && naTira !== null ? Math.min(tira.quadros - 1, Math.round(naTira * (tira.quadros - 1))) : 0
  // A fatia que sobra no short (9:16), escurecida: o pior caso, sem o foco no rosto.
  const aspecto = tira?.aspecto ?? 16 / 9
  const { width: quadroW, height: quadroH } = medidasDo(FORMATO_PADRAO)
  const cobertura = coberturaDaFonte(aspecto, quadroW / quadroH).largura
  const visivel = Math.min(1, 16 / 9 / aspecto)
  const janela = cobertura / visivel
  const mostraJanela = dentro && janela < 0.98

  const duracao = candidato.outSec - candidato.inSec
  const nomes = [...new Set([...(plano?.personagens.map((p) => p.nome) ?? []), ...(plano?.falantes ?? [])])].map(natural)
  const emenda = candidato.planoIds.length > 1
  const dica = [
    `cena ${candidato.planoIds.join('+')} · ${duracao.toFixed(1)}s · ${formatarTempo(candidato.inSec)}`,
    nomes.length > 0 ? nomes.join(', ') : null,
    // O "por que" curto (1-2 palavras: "Nia + soco", "fala citada"): o casar poe na frente.
    candidato.porque[0] ?? null,
    emenda ? 'Emenda o plano seguinte' : null,
    usada ? 'Ja usada em outra frase' : null,
    marcado ? 'Clique: tirar desta frase' : 'Clique: usar nesta frase · Shift+clique: mais uma cena',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => onEscolher(e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onEscolher(e)
        } else if (e.key === ' ') {
          // Espaco no cartao: ouvir a frase com ele, sem escolher.
          e.preventDefault()
          onAbrir()
        }
      }}
      onMouseEnter={entrar}
      onMouseMove={apontar}
      onMouseLeave={sair}
      title={dica}
      className={[
        'group flex cursor-pointer flex-col overflow-hidden rounded-sm border text-left transition-colors duration-150',
        marcado ? 'border-accent' : usada ? 'border-line opacity-45 hover:opacity-100' : 'border-line hover:border-line-strong',
      ].join(' ')}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-elevated">
        {miniatura && !quebrou && (
          <img
            src={miniatura}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setQuebrou(true)}
            className="size-full object-cover"
          />
        )}
        {dentro && tira && (
          <span
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `url(${tira.url})`,
              backgroundSize: `${tira.colunas * 100}% ${tira.linhas * 100}%`,
              backgroundPosition: `${tira.colunas > 1 ? ((quadroDaTira % tira.colunas) / (tira.colunas - 1)) * 100 : 0}% ${tira.linhas > 1 ? (Math.floor(quadroDaTira / tira.colunas) / (tira.linhas - 1)) * 100 : 0}%`,
            }}
          />
        )}
        {mostraJanela && (
          <>
            <span
              className="pointer-events-none absolute inset-y-0 left-0 bg-black/55"
              style={{ width: `${((1 - janela) / 2) * 100}%` }}
            />
            <span
              className="pointer-events-none absolute inset-y-0 right-0 bg-black/55"
              style={{ width: `${((1 - janela) / 2) * 100}%` }}
            />
            <span
              className="pointer-events-none absolute inset-y-0 border-x border-white/70"
              style={{
                left: `${((1 - janela) / 2) * 100}%`,
                width: `${janela * 100}%`,
              }}
            />
          </>
        )}
        {fracao !== null && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-black/50">
            <span className="block h-full bg-accent" style={{ width: `${fracao * 100}%` }} />
          </span>
        )}
        <span className="tnum absolute bottom-1 right-1 flex items-center gap-0.5 rounded-sm bg-black/70 px-1 py-0.5 text-[10px] text-white">
          {emenda && <Link2 size={9} strokeWidth={2} />}
          {duracao.toFixed(1)}s
        </span>
        {/* No lugar da estrela da Biblioteca: as vizinhas a partir desta cena. */}
        <span
          role="button"
          tabIndex={0}
          aria-label="Perto desta cena"
          title="Perto desta cena"
          onClick={(e) => {
            e.stopPropagation()
            onVizinhas()
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            e.stopPropagation()
            onVizinhas()
          }}
          className="absolute right-1 top-1 grid size-[20px] cursor-pointer place-items-center rounded-sm bg-black/60 text-white opacity-0 transition-opacity duration-150 hover:bg-accent group-hover:opacity-100"
        >
          <LocateFixed size={11} strokeWidth={1.75} />
        </span>
        {/* O PLAYER GRANDE: a frase com esta cena, com a narracao por cima. */}
        <span
          role="button"
          tabIndex={0}
          aria-label="Abrir no player com a narracao"
          title="Abrir no player (grande, com a narracao)"
          onClick={(e) => {
            e.stopPropagation()
            onAbrir()
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            e.stopPropagation()
            onAbrir()
          }}
          className="absolute bottom-1 left-1 grid size-[20px] cursor-pointer place-items-center rounded-sm bg-black/60 text-white opacity-0 transition-opacity duration-150 hover:bg-accent group-hover:opacity-100"
        >
          <Maximize2 size={11} strokeWidth={1.75} />
        </span>
        {marcado && (
          <>
            <span className="pointer-events-none absolute inset-0 border-2 border-accent bg-accent-dim/30" />
            <span className="tnum absolute left-1 top-1 grid size-[18px] place-items-center rounded-full bg-accent text-[10px] font-semibold text-white">
              {ordem}
            </span>
          </>
        )}
        {!marcado && usada && (
          <span className="absolute left-1 top-1 grid size-[18px] place-items-center rounded-full bg-black/70 text-[10px] text-white">
            ✓
          </span>
        )}
      </div>
    </div>
  )
})
