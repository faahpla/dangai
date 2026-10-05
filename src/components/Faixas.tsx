import { useMemo, useRef, useState } from 'react'
import { Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProject } from '@/store/project'
import { Waveform } from './Waveform'
import { caminhosDoArraste } from './arrastar'

/**
 * As faixas da linha do tempo, no jeito do DaVinci.
 *
 * "Faz essa track de video se comportar como a de um editor normal, e que tenha
 * aquela ferramenta de magnet link -- ela da uma guardada a cada corte de bloco.
 * Algo bem parecido com a timeline do proprio DaVinci." E, para o audio, a
 * trilha sonora montada em varias faixas, como no print que ele mandou.
 *
 * O que isso quer dizer aqui:
 *
 *   - CABECALHO FIXO a esquerda de cada faixa (V1, V2, A1...), com o M de mudo.
 *     Ele nao rola com a linha do tempo, como no editor.
 *   - FAIXAS FIXAS: duas de video e tres de audio desde o comeco, mais as que
 *     ele criar no "+". Nada de linha de "solte aqui" no lugar de faixa.
 *   - CLIPE DE VERDADE: bloco alto, a onda ocupando o clipe, nome e duracao no
 *     rodape -- verde no audio, azul no video.
 *   - IMA: arrastar ou cortar gruda a borda nos cortes dos blocos, na agulha e
 *     nas bordas dos outros clipes. Uma linha amarela mostra onde grudou.
 *   - CLIPE NAO SOBREPOE CLIPE na mesma faixa: ele encaixa no vao livre mais
 *     perto, como num editor.
 */

/** Largura do cabecalho das faixas, em px. */
export const CABECALHO = 104

/** O ima da linha do tempo. */
export interface Ima {
  ligado: boolean
  /** Distancia de encaixe, em segundos (uns 10 px na escala atual). */
  tolerancia: number
  /** Cortes dos blocos, agulha e bordas de clipes -- menos as do clipe `ignorar`. */
  alvos: (ignorar: string | null) => readonly number[]
  /** Mostra (ou apaga, com null) a linha de onde grudou. */
  mostrar: (t: number | null) => void
}

/** O instante grudado no alvo mais perto, se houver um dentro da tolerancia. */
export function alinhar(t: number, ima: Ima, ignorar: string | null): { t: number; grudou: boolean } {
  if (!ima.ligado) return { t, grudou: false }
  let melhor = t
  let dist = ima.tolerancia
  for (const alvo of ima.alvos(ignorar)) {
    const d = Math.abs(alvo - t)
    if (d < dist) {
      dist = d
      melhor = alvo
    }
  }
  return { t: melhor, grudou: melhor !== t }
}

/**
 * Um trecho inteiro sendo arrastado: gruda pelo COMECO ou pelo FIM, o que
 * estiver mais perto de um alvo. Devolve o novo comeco e o ponto que grudou.
 */
export function alinharTrecho(
  at: number,
  dur: number,
  ima: Ima,
  ignorar: string | null,
): { at: number; linha: number | null } {
  if (!ima.ligado) return { at, linha: null }
  const inicio = alinhar(at, ima, ignorar)
  const fim = alinhar(at + dur, ima, ignorar)
  const dInicio = inicio.grudou ? Math.abs(inicio.t - at) : Infinity
  const dFim = fim.grudou ? Math.abs(fim.t - (at + dur)) : Infinity
  if (dInicio === Infinity && dFim === Infinity) return { at, linha: null }
  return dInicio <= dFim ? { at: inicio.t, linha: inicio.t } : { at: fim.t - dur, linha: fim.t }
}

/**
 * Onde o trecho cabe nesta faixa sem cobrir outro clipe.
 *
 * Se o lugar pedido esta livre, e ele. Senao, o vao livre mais perto: encostado
 * no fim de um clipe ou no comeco de outro. null quando nao ha vao que caiba.
 */
export function encaixar(
  at: number,
  dur: number,
  outros: readonly { at: number; fim: number }[],
): number | null {
  const livre = (x: number): boolean => x >= 0 && outros.every((o) => x + dur <= o.at + 1e-6 || x >= o.fim - 1e-6)
  if (livre(at)) return at
  const candidatos = outros.flatMap((o) => [o.fim, o.at - dur]).filter(livre)
  if (candidatos.length === 0) return null
  return candidatos.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a))
}

/** A linha: cabecalho fixo a esquerda, conteudo na largura da linha do tempo. */
export function Linha({
  largura,
  altura,
  cabecalho,
  children,
  linhaRef,
  fundo = 'bg-surface',
}: {
  largura: number
  altura: number
  cabecalho: React.ReactNode
  children: React.ReactNode
  linhaRef?: (el: HTMLDivElement | null) => void
  fundo?: string
}) {
  return (
    <div className="flex border-t border-line" style={{ width: CABECALHO + largura, height: altura }}>
      <div
        className="sticky left-0 z-30 flex shrink-0 items-center border-r border-line bg-elevated px-1.5"
        style={{ width: CABECALHO }}
      >
        {cabecalho}
      </div>
      <div ref={linhaRef} className={`relative ${fundo}`} style={{ width: largura, height: altura }}>
        {children}
      </div>
    </div>
  )
}

/** O cabecalho de uma faixa: nome, quantos clipes, e o M de mudo. */
export function Cabecalho({
  nome,
  detalhe,
  mudo,
  onMudo,
  extra,
  onRemover,
}: {
  nome: string
  detalhe?: string
  mudo?: boolean
  onMudo?: () => void
  extra?: React.ReactNode
  /** Tira a faixa inteira. Aparece so com o mouse em cima do cabecalho. */
  onRemover?: () => void
}) {
  return (
    <div className="group/cab flex w-full items-center gap-1">
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[11px] font-semibold text-ink">{nome}</div>
        {detalhe && <div className="truncate text-[9px] text-ink-3">{detalhe}</div>}
      </div>
      {onRemover && (
        <button
          type="button"
          onClick={onRemover}
          title="Excluir esta faixa e os clipes dela (Ctrl+Z traz de volta)"
          aria-label={`Excluir a faixa ${nome}`}
          className="hidden size-[18px] shrink-0 place-items-center rounded-[3px] border border-line text-ink-3 hover:border-danger hover:text-danger group-hover/cab:grid"
        >
          <Trash2 size={10} strokeWidth={1.75} />
        </button>
      )}
      {extra}
      {onMudo && (
        <button
          type="button"
          onClick={onMudo}
          title={mudo ? 'Faixa muda: some do preview e do render. Clique para voltar.' : 'Mutar esta faixa'}
          aria-pressed={mudo}
          className={[
            'grid size-[18px] shrink-0 place-items-center rounded-[3px] border text-[9px] font-bold',
            mudo ? 'border-danger bg-danger text-white' : 'border-line text-ink-3 hover:text-ink',
          ].join(' ')}
        >
          M
        </button>
      )}
    </div>
  )
}

/** Um clipe, do jeito que o grupo de faixas precisa enxergar. */
export interface ClipeDaFaixa {
  id: string
  faixa: number
  at: number
  toca: number
  nome: string
  /** Picos do arquivo inteiro, para a onda. */
  peaks?: readonly number[]
  /** RMS do arquivo inteiro, nos mesmos buckets. */
  rms?: readonly number[]
  /** Duracao do arquivo e de onde o trecho parte, para mostrar o pedaco certo da onda. */
  arquivoSec?: number
  inicioSec?: number
  fadeInSec?: number
  fadeOutSec?: number
  /** Miniatura (imagem). */
  imagem?: string
  /** Camada de ajuste: roxa, sem miniatura. */
  ajuste?: boolean
}

const formatarDuracao = (s: number): string => {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  const f = Math.floor((s % 1) * 100)
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}.${String(f).padStart(2, '0')}s`
}

/**
 * Um GRUPO de faixas do mesmo tipo -- as de video ou as de audio.
 *
 * Os gestos moram aqui, e nao em cada faixa, porque um clipe arrastado ANDA
 * ENTRE FAIXAS: quem decide em qual ele caiu precisa enxergar todas.
 */
export function GrupoDeFaixas({
  tipo,
  clipes,
  faixasMinimas,
  largura,
  duration,
  altura,
  timeAt,
  ima,
  aceita,
  onSoltar,
  onMover,
  onCortarInicio,
  onCortarFim,
  onRemover,
  onVazio,
  onFade,
}: {
  tipo: 'video' | 'audio'
  clipes: readonly ClipeDaFaixa[]
  faixasMinimas: number
  largura: number
  duration: number
  altura: number
  timeAt: (clientX: number) => number
  ima: Ima
  aceita: (path: string) => boolean
  onSoltar: (paths: string[], at: number, faixa: number) => void
  onMover: (id: string, at: number, faixa: number) => void
  onCortarInicio: (id: string, at: number) => void
  onCortarFim: (id: string, toca: number | null) => void
  onRemover: (id: string) => void
  /**
   * Clique no vazio de uma faixa. Quem decide o que ele faz e a linha do
   * tempo: com a ferramenta de agulha, leva a agulha; com a de selecao, abre o
   * laco.
   */
  onVazio: (event: React.PointerEvent) => void
  /** Puxar a alca de fade de um clipe: quantos segundos de entrada ou saida. */
  onFade: (id: string, qual: 'entra' | 'sai', segundos: number) => void
}) {
  const principal = useProject((s) => (s.clipeSelecionado?.tipo === tipo ? s.clipeSelecionado.id : null))
  const juntos = useProject(
    useShallow((s) => s.outrosClipes.filter((c) => c.tipo === tipo).map((c) => c.id)),
  )
  const selecionar = useProject((s) => s.selecionarClipe)
  const alternarNaSelecao = useProject((s) => s.alternarClipeNaSelecao)
  const definirSelecao = useProject((s) => s.definirSelecaoDeClipes)
  const mudas = useProject((s) => s.faixasMudas[tipo])
  const alternarMudo = useProject((s) => s.alternarMudo)
  const duplicarClipe = useProject((s) => s.duplicarClipe)
  const removerFaixa = useProject((s) => s.removerFaixa)

  const [extras, setExtras] = useState(0)
  const [sobre, setSobre] = useState<number | null>(null)
  const gesto = useRef<
    | {
        tipo: 'mover'
        id: string
        pega: number
        /** Onde o clipe pego estava ao comecar. */
        at0: number
        faixa0: number
        /** Os outros escolhidos deste tipo, que andam junto. */
        grupo: { id: string; at: number; faixa: number; toca: number }[]
      }
    | { tipo: 'inicio'; id: string }
    | { tipo: 'fim'; id: string }
    | null
  >(null)
  const linhas = useRef(new Map<number, HTMLDivElement>())

  const usadas = Math.max(...clipes.map((c) => c.faixa + 1), 0)
  // `extras` pode ficar negativo: excluir faixa desce abaixo do numero inicial.
  const total = Math.max(1, usadas, faixasMinimas + extras)

  /*
   * EXCLUIR A FAIXA: os clipes dela saem e as de cima descem uma -- como no
   * editor. Fica pelo menos uma faixa de cada tipo.
   */
  const excluirFaixa = (faixa: number): void => {
    const depois = Math.max(
      0,
      ...clipes.filter((c) => c.faixa !== faixa).map((c) => (c.faixa > faixa ? c.faixa : c.faixa + 1)),
    )
    removerFaixa(tipo, faixa)
    setExtras(Math.max(total - 1, depois, 1) - faixasMinimas)
  }
  // Video: a faixa de numero maior fica EM CIMA (e por cima no video), como no
  // editor. Audio: A1 em cima.
  const ordem = Array.from({ length: total }, (_, i) => (tipo === 'video' ? total - 1 - i : i))
  const prefixo = tipo === 'video' ? 'V' : 'A'

  /** Em que faixa esta este ponto da tela. Fora delas, a mais perto. */
  const faixaEm = (clientY: number): number => {
    let melhor = 0
    let dist = Infinity
    for (const [faixa, el] of linhas.current) {
      const r = el.getBoundingClientRect()
      if (clientY >= r.top && clientY < r.bottom) return faixa
      const d = Math.min(Math.abs(clientY - r.top), Math.abs(clientY - r.bottom))
      if (d < dist) {
        dist = d
        melhor = faixa
      }
    }
    return melhor
  }

  const vizinhos = (id: string, faixa: number) =>
    clipes.filter((c) => c.faixa === faixa && c.id !== id).map((c) => ({ at: c.at, fim: c.at + c.toca }))

  const aoMover = (event: { clientX: number; clientY: number }): void => {
    const g = gesto.current
    if (!g) return
    const c = clipes.find((x) => x.id === g.id)
    if (!c) return
    if (g.tipo === 'mover') {
      const { at, linha } = alinharTrecho(Math.max(0, timeAt(event.clientX) - g.pega), c.toca, ima, c.id)
      const alvo = faixaEm(event.clientY)
      /*
       * VARIOS ESCOLHIDOS ANDAM JUNTOS, mantendo a distancia entre eles. O
       * grupo so anda se TODOS couberem; senao tenta sem trocar de faixa, e
       * senao fica onde esta.
       */
      if (g.grupo.length > 0) {
        const dt = at - g.at0
        const df = alvo - g.faixa0
        const membros = [{ id: c.id, at: g.at0, faixa: g.faixa0, toca: c.toca }, ...g.grupo]
        const ids = new Set(membros.map((m) => m.id))
        const fixos = clipes.filter((x) => !ids.has(x.id))
        const cabe = (dtx: number, dfx: number): boolean =>
          membros.every((m) => {
            const na = m.at + dtx
            const nf = m.faixa + dfx
            if (na < -1e-6 || nf < 0) return false
            return fixos.every((o) => o.faixa !== nf || na + m.toca <= o.at + 1e-6 || na >= o.at + o.toca - 1e-6)
          })
        const dfOk = cabe(dt, df) ? df : cabe(dt, 0) ? 0 : null
        if (dfOk === null) return
        ima.mostrar(linha)
        for (const m of membros) onMover(m.id, Math.max(0, m.at + dt), m.faixa + dfOk)
        return
      }
      let faixa = alvo
      let lugar = encaixar(at, c.toca, vizinhos(c.id, alvo))
      if (lugar === null) {
        // Nao cabe na faixa de destino: fica na dele.
        faixa = c.faixa
        lugar = encaixar(at, c.toca, vizinhos(c.id, c.faixa))
      }
      ima.mostrar(lugar !== null && lugar === at ? linha : null)
      if (lugar !== null) onMover(c.id, lugar, faixa)
      return
    }
    const outros = vizinhos(c.id, c.faixa)
    if (g.tipo === 'inicio') {
      const { t, grudou } = alinhar(timeAt(event.clientX), ima, c.id)
      // Nao invade o clipe de tras.
      const piso = Math.max(0, ...outros.filter((o) => o.fim <= c.at + 1e-6).map((o) => o.fim))
      const novo = Math.max(t, piso)
      ima.mostrar(grudou && novo === t ? t : null)
      onCortarInicio(c.id, novo)
      return
    }
    const { t, grudou } = alinhar(timeAt(event.clientX), ima, c.id)
    // Nao invade o clipe da frente.
    const teto = Math.min(duration, ...outros.filter((o) => o.at >= c.at + c.toca - 1e-6).map((o) => o.at))
    const fim = Math.min(t, teto)
    ima.mostrar(grudou && fim === t ? t : null)
    onCortarFim(c.id, fim - c.at)
  }

  const soltar = (): void => {
    gesto.current = null
    ima.mostrar(null)
  }

  /*
   * O ARRASTE E OUVIDO NA JANELA, e nao no clipe.
   *
   * Passar para outra faixa recria o clipe dentro de outra linha -- o elemento
   * que pegou o ponteiro deixa de existir no meio do gesto, e com ele iria a
   * captura. Ouvindo na janela, o gesto atravessa as faixas inteiro. A ref
   * guarda a versao mais nova de `aoMover`, que enxerga os clipes de agora.
   */
  const aoMoverAgora = useRef(aoMover)
  aoMoverAgora.current = aoMover
  const comecarGesto = (): void => {
    const mover = (e: PointerEvent): void => aoMoverAgora.current(e)
    const fim = (): void => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', fim)
      window.removeEventListener('pointercancel', fim)
      soltar()
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', fim)
    window.addEventListener('pointercancel', fim)
  }

  return (
    <>
      {ordem.map((faixa, i) => {
        const daFaixa = clipes.filter((c) => c.faixa === faixa)
        const muda = mudas.includes(faixa)
        return (
          <Linha
            key={faixa}
            largura={largura}
            altura={altura}
            fundo={sobre === faixa ? 'bg-accent-dim' : 'bg-surface'}
            linhaRef={(el) => {
              if (el) linhas.current.set(faixa, el)
              else linhas.current.delete(faixa)
            }}
            cabecalho={
              <Cabecalho
                nome={`${prefixo}${faixa + 1}`}
                detalhe={daFaixa.length === 0 ? 'vazia' : `${daFaixa.length} ${daFaixa.length === 1 ? 'clipe' : 'clipes'}`}
                mudo={muda}
                onMudo={() => alternarMudo(tipo, faixa)}
                onRemover={total > 1 ? () => excluirFaixa(faixa) : undefined}
                extra={
                  // O "+" mora no cabecalho da ultima faixa da lista.
                  i === ordem.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => setExtras((n) => n + 1)}
                      title={`Mais uma faixa de ${tipo === 'video' ? 'video' : 'audio'}`}
                      aria-label={`Nova faixa de ${tipo}`}
                      className="grid size-[18px] shrink-0 place-items-center rounded-[3px] border border-line text-ink-3 hover:text-ink"
                    >
                      <Plus size={10} strokeWidth={2} />
                    </button>
                  ) : undefined
                }
              />
            }
          >
            <div
              data-faixa={`${tipo}-${faixa}`}
              // overflow-hidden: um clipe mais longo que o video (a musica de
              // 2:30 num video de 1:12) e cortado no fim da linha do tempo, em
              // vez de alargar a rolagem e empurrar a vista para fora das cenas.
              className={['absolute inset-0 overflow-hidden', muda ? 'opacity-40' : ''].join(' ')}
              onDragOver={(event) => {
                event.preventDefault()
                setSobre(faixa)
              }}
              onDragLeave={() => setSobre(null)}
              onDrop={(event) => {
                setSobre(null)
                const paths = caminhosDoArraste(event).filter(aceita)
                if (paths.length === 0) return
                // Sem isto o drop sobe ate a janela e viraria material novo.
                event.preventDefault()
                event.stopPropagation()
                onSoltar(paths, alinhar(timeAt(event.clientX), ima, null).t, faixa)
              }}
              onPointerDown={(event) => {
                // So o botao esquerdo: o do meio e de arrastar a vista.
                if (event.button !== 0 || event.target !== event.currentTarget) return
                onVazio(event)
              }}
            >
              {daFaixa.map((c) => (
                <Clipe
                  key={c.id}
                  tipo={tipo}
                  clipe={c}
                  duration={duration}
                  escolhido={principal === c.id ? 'principal' : juntos.includes(c.id) ? 'junto' : null}
                  onPegar={(event, parte) => {
                    if (event.button !== 0) return
                    event.stopPropagation()
                    // Ctrl ou Shift: liga e desliga o clipe na selecao, como no editor.
                    if (event.ctrlKey || event.metaKey || event.shiftKey) {
                      alternarNaSelecao({ tipo, id: c.id })
                      return
                    }
                    /*
                     * ALT + ARRASTAR DUPLICA, como no editor: a copia fica no
                     * lugar e o que anda e o clipe pego.
                     */
                    if (parte === 'corpo' && event.altKey) duplicarClipe(tipo, c.id)
                    const naSelecao = principal === c.id || juntos.includes(c.id)
                    const outros = naSelecao && parte === 'corpo' ? juntos.concat(principal ? [principal] : []).filter((id) => id !== c.id) : []
                    if (!naSelecao) selecionar({ tipo, id: c.id })
                    else {
                      // Pegar um dos escolhidos o torna o principal, sem desfazer o grupo.
                      const todos = useProject.getState().outrosClipes.filter((x) => !(x.tipo === tipo && x.id === c.id))
                      const atual = useProject.getState().clipeSelecionado
                      definirSelecao([
                        { tipo, id: c.id },
                        ...(atual && !(atual.tipo === tipo && atual.id === c.id) ? [atual] : []),
                        ...todos,
                      ])
                    }
                    gesto.current =
                      parte === 'corpo'
                        ? {
                            tipo: 'mover',
                            id: c.id,
                            pega: timeAt(event.clientX) - c.at,
                            at0: c.at,
                            faixa0: c.faixa,
                            grupo: clipes
                              .filter((x) => outros.includes(x.id))
                              .map((x) => ({ id: x.id, at: x.at, faixa: x.faixa, toca: x.toca })),
                          }
                        : { tipo: parte, id: c.id }
                    comecarGesto()
                  }}
                  onFade={(qual, segundos) => onFade(c.id, qual, segundos)}
                  onRestaurarFim={() => onCortarFim(c.id, null)}
                  onRemover={() => {
                    onRemover(c.id)
                    if (principal === c.id) selecionar(null)
                  }}
                />
              ))}
            </div>
            </Linha>
        )
      })}
    </>
  )
}

/** Um clipe na faixa, com as duas alcas de corte. */
function Clipe({
  tipo,
  clipe: c,
  duration,
  escolhido,
  onPegar,
  onFade,
  onRestaurarFim,
  onRemover,
}: {
  tipo: 'video' | 'audio'
  clipe: ClipeDaFaixa
  duration: number
  /** O principal (o que o inspetor mostra) ou um dos que vao junto. */
  escolhido: 'principal' | 'junto' | null
  onPegar: (event: React.PointerEvent<HTMLElement>, parte: 'corpo' | 'inicio' | 'fim') => void
  onFade: (qual: 'entra' | 'sai', segundos: number) => void
  onRestaurarFim: () => void
  onRemover: () => void
}) {
  const audio = tipo === 'audio'
  const arquivo = c.arquivoSec ?? c.toca
  /*
   * A onda e do arquivo inteiro, mas so o PEDACO QUE TOCA vai para o canvas.
   * Antes o canvas tinha a largura da musica inteira e era deslocado para a
   * esquerda: numa musica longa cortada curta, com zoom, ele passava do teto
   * de largura do Chrome e a onda saia quebrada.
   */
  const fatia = (v: readonly number[] | undefined): number[] => {
    if (!v || v.length === 0) return []
    const de = Math.floor(((c.inicioSec ?? 0) / Math.max(arquivo, 0.01)) * v.length)
    const ate = Math.ceil((((c.inicioSec ?? 0) + c.toca) / Math.max(arquivo, 0.01)) * v.length)
    return v.slice(Math.max(0, de), Math.min(v.length, Math.max(ate, de + 1)))
  }
  const picos = useMemo(() => fatia(c.peaks), [c.peaks, c.inicioSec, c.toca, arquivo])
  const rms = useMemo(() => fatia(c.rms), [c.rms, c.inicioSec, c.toca, arquivo])
  return (
    <div
      data-clipe={c.id}
      data-tipo={tipo}
      onPointerDown={(event) => onPegar(event, 'corpo')}
      style={{ left: `${(c.at / duration) * 100}%`, width: `${(c.toca / duration) * 100}%` }}
      title={`${c.nome} — entra em ${c.at.toFixed(2)}s, ${formatarDuracao(c.toca)}`}
      className={[
        'group/clipe absolute inset-y-[3px] cursor-grab overflow-hidden rounded-[3px] border',
        audio
          ? 'border-[#4f9a74] bg-[#2b5a43]'
          : c.ajuste
            ? 'border-[#9a7bd6] bg-[#43356b]'
            : 'border-[#5b7fb8] bg-[#2c4670]',
        escolhido === 'principal' ? 'ring-2 ring-accent' : escolhido === 'junto' ? 'ring-2 ring-accent/60' : '',
      ].join(' ')}
    >
      {audio && picos.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bottom-[13px]">
          <Waveform
            peaks={picos}
            rms={rms}
            cor="rgba(170, 235, 195, 0.38)"
            corRms="rgba(205, 250, 220, 0.85)"
            className="block h-full w-full"
          />
        </div>
      )}
      {c.ajuste && (
        <SlidersHorizontal
          size={12}
          strokeWidth={1.75}
          className="pointer-events-none absolute left-1.5 top-1.5 text-white/70"
        />
      )}
      {!audio && c.imagem && (
        <img
          src={c.imagem}
          alt=""
          draggable={false}
          className="pointer-events-none absolute left-1 top-1 bottom-[14px] rounded-[2px] object-contain opacity-80"
        />
      )}
      {/* Os fades: rampa escura de entrada e de saida. */}
      {(c.fadeInSec ?? 0) > 0 && (
        <span
          className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/55 to-transparent"
          style={{ width: `${Math.min((c.fadeInSec ?? 0) / c.toca, 0.5) * 100}%` }}
        />
      )}
      {(c.fadeOutSec ?? 0) > 0 && (
        <span
          className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/55 to-transparent"
          style={{ width: `${Math.min((c.fadeOutSec ?? 0) / c.toca, 0.5) * 100}%` }}
        />
      )}
      {/* O rodape do DaVinci: nome e duracao. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[13px] items-center gap-1.5 truncate bg-black/25 px-1 text-[9px] text-white/90">
        <span className="min-w-0 truncate">{c.nome}</span>
        <span className="tnum shrink-0 text-white/60">{formatarDuracao(c.toca)}</span>
      </span>

      {/*
        AS ALCAS DE FADE, no canto de cima, como no DaVinci: puxar para dentro
        do clipe aumenta o fade. Aparecem com o mouse em cima ou com o clipe
        escolhido.
      */}
      {(['entra', 'sai'] as const).map((qual) => {
        const seg = (qual === 'entra' ? c.fadeInSec : c.fadeOutSec) ?? 0
        const pos = `${Math.min(seg / Math.max(c.toca, 0.01), 0.5) * 100}%`
        return (
          <span
            key={qual}
            data-alca={`fade-${qual}`}
            title={`Fade de ${qual === 'entra' ? 'entrada' : 'saida'}: ${seg.toFixed(2)}s -- arraste; dois cliques zeram`}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              const clipe = event.currentTarget.closest('[data-clipe]')
              if (!clipe) return
              event.currentTarget.setPointerCapture(event.pointerId)
              const mover = (e: PointerEvent): void => {
                const r = clipe.getBoundingClientRect()
                const fracao = qual === 'entra' ? (e.clientX - r.left) / r.width : (r.right - e.clientX) / r.width
                onFade(qual, Math.round(Math.min(Math.max(fracao, 0), 0.5) * c.toca * 100) / 100)
              }
              const soltar = (): void => {
                window.removeEventListener('pointermove', mover)
                window.removeEventListener('pointerup', soltar)
              }
              window.addEventListener('pointermove', mover)
              window.addEventListener('pointerup', soltar)
            }}
            onDoubleClick={(event) => {
              event.stopPropagation()
              onFade(qual, 0)
            }}
            style={qual === 'entra' ? { left: pos } : { right: pos }}
            className={[
              'absolute top-0 z-20 size-[9px] cursor-ew-resize rounded-[2px] border border-black/60 bg-white',
              qual === 'entra' ? '-ml-[4px]' : '-mr-[4px]',
              escolhido ? 'opacity-90' : 'opacity-0 group-hover/clipe:opacity-90',
            ].join(' ')}
          />
        )
      })}
      <span
        data-alca="inicio"
        onPointerDown={(event) => onPegar(event, 'inicio')}
          title="Puxe para cortar o comeco"
        className="absolute inset-y-0 left-0 w-[6px] cursor-col-resize hover:bg-white/30"
      />
      <span
        data-alca="fim"
        onPointerDown={(event) => onPegar(event, 'fim')}
        onDoubleClick={(event) => {
          event.stopPropagation()
          onRestaurarFim()
        }}
          title="Puxe para cortar o fim; dois cliques devolvem o resto"
        className="absolute inset-y-0 right-0 w-[6px] cursor-col-resize hover:bg-white/30"
      />
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onRemover}
        aria-label={`Tirar ${c.nome}`}
        className="absolute right-2 top-0.5 z-10 grid size-[13px] place-items-center rounded-full border border-line bg-surface text-ink-3 opacity-0 hover:text-danger group-hover/clipe:opacity-100"
      >
        <X size={8} strokeWidth={2.5} />
      </button>
    </div>
  )
}

/** Um controle deslizante pequeno, para o painel do clipe escolhido. */
export function ControleDoClipe({
  rotulo,
  titulo,
  valor,
  min,
  max,
  passo,
  texto,
  padrao,
  onChange,
}: {
  rotulo: string
  titulo: string
  valor: number
  min: number
  max: number
  passo: number
  texto: string
  /** Duplo clique volta para este valor. */
  padrao: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-1" title={`${titulo} (duplo clique volta ao padrao)`}>
      <span className="text-[9px] uppercase tracking-wide text-ink-3">{rotulo}</span>
      <input
        type="range"
        aria-label={titulo}
        min={min}
        max={max}
        step={passo}
        value={valor}
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={() => onChange(padrao)}
        className="dangai-range w-[56px]"
      />
      <span className="tnum w-[36px] text-right text-[10px] text-ink-2">{texto}</span>
    </label>
  )
}
