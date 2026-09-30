import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioLines, Merge, Plus, RotateCcw, Scissors, SlidersHorizontal } from 'lucide-react'
import { activeWordIndex, VIDEO_FPS, type RegrasDaLegenda } from '@shared/contract'
import { useProject, formatTimecode } from '@/store/project'

/**
 * O editor de legendas, no jeito do LegendAI dele.
 *
 * "Tem opcoes que eu queria ter, que tem no LegendAI: botao pra mesclar com a
 * proxima, opcao de editar o que esta escrito, regras da lingua portuguesa."
 * Mesclar, dividir e corrigir ja existiam aqui -- mas escondidos: mesclar pedia
 * selecionar dois blocos e apertar M, corrigir pedia clique duplo numa palavra.
 * Quem nao sabia nao achava. Agora tudo esta a vista, onde ele ja procura no
 * LegendAI:
 *
 *   - clicar no TEXTO edita a legenda inteira; Enter confirma, Esc desiste
 *   - o "+" entre duas legendas junta a de cima com a de baixo
 *   - editando, "Dividir no cursor" parte a legenda onde o cursor esta
 *   - o traco entre duas palavras continua dividindo com um clique
 *
 * Os tempos nunca sao inventados: mesclar usa o inicio da primeira e o fim da
 * ultima, dividir usa o instante real da palavra que abre a nova.
 */
export function CaptionEditor() {
  const captions = useProject((s) => s.captions)
  const captionsEdited = useProject((s) => s.captionsEdited)
  const playhead = useProject((s) => s.playhead)
  const alinhado = useProject((s) => s.transcript?.alinhado === true)
  const temPalavras = useProject((s) => (s.transcript?.words.length ?? 0) > 0)
  const busy = useProject((s) => s.busy)
  const mergeCaptions = useProject((s) => s.mergeCaptions)
  const splitCaption = useProject((s) => s.splitCaption)
  const editCaptionText = useProject((s) => s.editCaptionText)
  const resetCaptions = useProject((s) => s.resetCaptions)
  const ressincronizar = useProject((s) => s.ressincronizarLegendas)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const setPlaying = useProject((s) => s.setPlaying)

  const [selected, setSelected] = useState<readonly number[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [regrasAbertas, setRegrasAbertas] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  const ordered = [...selected].sort((a, b) => a - b)
  const contiguous =
    ordered.length >= 2 && ordered.at(-1)! - ordered[0]! + 1 === ordered.length

  // Bloco que esta no ar agora, para acompanhar a reproducao.
  const currentFrame = Math.round(playhead * VIDEO_FPS)
  const activeIndex = captions.findIndex(
    (block) => currentFrame >= block.from && currentFrame < block.from + block.durationInFrames,
  )

  const toggle = useCallback((index: number, additive: boolean) => {
    setSelected((previous) => {
      if (!additive) return previous.length === 1 && previous[0] === index ? [] : [index]
      return previous.includes(index)
        ? previous.filter((item) => item !== index)
        : [...previous, index]
    })
  }, [])

  // Mesclar e dividir mudam os indices; manter a selecao antiga apontaria para
  // blocos que nao existem mais.
  const merge = useCallback(() => {
    if (!contiguous) return
    mergeCaptions(ordered)
    setSelected([ordered[0]!])
  }, [contiguous, ordered, mergeCaptions])

  const mesclarComAProxima = (index: number): void => {
    mergeCaptions([index, index + 1])
    setSelected([index])
    setEditing(null)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing !== null) return
      if ((event.key === 'm' || event.key === 'M') && contiguous) {
        event.preventDefault()
        merge()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [contiguous, merge, editing])

  if (captions.length === 0) {
    return (
      <div className="grid flex-1 place-items-center rounded-md border border-line bg-surface px-6 text-center text-[11px] leading-relaxed text-ink-3">
        Sem legendas ainda. Elas aparecem depois que a narracao e transcrita —
        cole o roteiro para o texto sair exato.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Sincronizar vem primeiro porque e a queixa principal. Em projeto
          novo ja sai sincronizado; aqui e para os que foram feitos antes, ou
          para medir de novo depois de trocar o roteiro.
        */}
        <button
          type="button"
          onClick={() => void ressincronizar()}
          disabled={!temPalavras || busy !== null}
          title="Mede de novo onde cada palavra soa na narracao (o mesmo modelo do LegendAI)"
          className={[
            'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] disabled:opacity-40',
            alinhado
              ? 'border-line bg-elevated text-ink-2 hover:text-ink'
              : 'border-accent bg-accent-dim text-ink hover:brightness-110',
          ].join(' ')}
        >
          <AudioLines size={12} strokeWidth={1.5} />
          {alinhado ? 'Sincronizada' : 'Sincronizar com a narracao'}
        </button>

        <button
          type="button"
          onClick={() => setRegrasAbertas((v) => !v)}
          title="Palavras por legenda, duracao, adiantar e fechar vaos"
          className={[
            'lift flex items-center gap-1.5 rounded-sm border border-line px-2.5 py-1.5 text-[11px]',
            regrasAbertas ? 'bg-accent-dim text-ink' : 'bg-elevated text-ink-2 hover:text-ink',
          ].join(' ')}
        >
          <SlidersHorizontal size={12} strokeWidth={1.5} />
          Regras
        </button>

        <button
          type="button"
          onClick={merge}
          disabled={!contiguous}
          title="Mesclar as legendas selecionadas (M). Ctrl+clique seleciona mais de uma."
          className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40"
        >
          <Merge size={12} strokeWidth={1.5} />
          Mesclar{ordered.length >= 2 ? ` (${ordered.length})` : ''}
        </button>

        <div className="flex-1" />

        {captionsEdited && (
          <button
            type="button"
            onClick={() => {
              resetCaptions()
              setSelected([])
              setEditing(null)
            }}
            title="Descarta as edicoes e refaz as legendas pelas regras"
            className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[11px] text-ink-3 hover:text-ink-2"
          >
            <RotateCcw size={12} strokeWidth={1.5} />
            Refazer
          </button>
        )}

        <span className="tnum text-[11px] text-ink-3">{captions.length} legendas</span>
      </div>

      {regrasAbertas && <PainelDeRegras />}

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-md border border-line bg-surface"
      >
        {captions.map((block, index) => {
          const isSelected = selected.includes(index)
          const isActive = index === activeIndex
          const texto = block.words.map((w) => w.text).join(' ')
          const fim = (block.from + block.durationInFrames) / VIDEO_FPS

          return (
            <div key={`${block.from}-${index}`}>
              <div
                onPointerDown={(event) => toggle(index, event.ctrlKey || event.metaKey || event.shiftKey)}
                className={[
                  'group/linha flex cursor-pointer items-center gap-3 px-3 py-1.5',
                  isSelected ? 'bg-accent-dim' : isActive ? 'bg-elevated' : 'hover:bg-elevated/50',
                ].join(' ')}
              >
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    setPlaying(false)
                    setPlayhead(block.from / VIDEO_FPS)
                  }}
                  title="Ir para este ponto"
                  className={[
                    'tnum w-[124px] shrink-0 whitespace-nowrap text-left text-[10.5px]',
                    isActive ? 'text-accent' : 'text-ink-3 hover:text-ink-2',
                  ].join(' ')}
                >
                  {formatTimecode(block.from / VIDEO_FPS)} — {formatTimecode(fim)}
                </button>

                {editing === index ? (
                  <EdicaoDoTexto
                    texto={texto}
                    onConfirmar={(novo) => {
                      if (novo.trim() && novo.trim() !== texto) editCaptionText(index, novo)
                      setEditing(null)
                    }}
                    onDividir={(novo, palavrasAntes) => {
                      if (novo.trim() && novo.trim() !== texto) editCaptionText(index, novo)
                      splitCaption(index, palavrasAntes)
                      setEditing(null)
                      setSelected([])
                    }}
                    onDesistir={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex min-w-0 flex-1 flex-wrap items-baseline">
                    {block.words.map((word, wordIndex) => (
                      <span key={`${word.from}-${wordIndex}`} className="flex items-baseline">
                        {wordIndex > 0 && (
                          <button
                            type="button"
                            onPointerDown={(event) => {
                              event.stopPropagation()
                              splitCaption(index, wordIndex)
                              setSelected([])
                            }}
                            aria-label={`Dividir antes de ${word.text}`}
                            title="Dividir aqui"
                            className="mx-0.5 px-1 text-[13px] leading-none text-ink-3/60 hover:text-accent"
                          >
                            |
                          </button>
                        )}
                        <span
                          /*
                           * Abre no CLICK, e nao no pointerdown. Aberto no
                           * pointerdown, o campo nascia com foco e o proprio
                           * mousedown devolvia o foco ao lugar clicado: o campo
                           * perdia o foco, confirmava e fechava na hora. O
                           * pointerdown so segura a selecao da linha.
                           */
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            setEditing(index)
                          }}
                          title="Clique para editar o texto"
                          className={[
                            'cursor-text rounded-[3px] px-0.5 text-[13px] hover:bg-elevated',
                            // Mesma regra do video: a ultima palavra que ja comecou.
                            isActive && activeWordIndex(block, currentFrame) === wordIndex
                              ? 'text-accent'
                              : 'text-ink-2',
                          ].join(' ')}
                        >
                          {word.text}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {index < captions.length - 1 && (
                <JuntarComAProxima onJuntar={() => mesclarComAProxima(index)} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * O texto inteiro da legenda num campo so, como no LegendAI.
 *
 * "Dividir no cursor" parte ANTES da palavra onde o cursor esta. Se ele tambem
 * reescreveu o texto, a reescrita vale primeiro e o corte cai no texto novo.
 */
function EdicaoDoTexto({
  texto,
  onConfirmar,
  onDividir,
  onDesistir,
}: {
  texto: string
  onConfirmar: (novo: string) => void
  onDividir: (novo: string, palavrasAntes: number) => void
  onDesistir: () => void
}) {
  const campo = useRef<HTMLInputElement | null>(null)
  const saiu = useRef(false)

  const palavrasAntesDoCursor = (): number => {
    const el = campo.current
    if (!el) return 0
    const antes = el.value.slice(0, el.selectionStart ?? 0)
    return antes.trim() === '' ? 0 : antes.trim().split(/\s+/).length
  }
  const podeDividir = (): boolean => {
    const el = campo.current
    if (!el) return false
    const n = palavrasAntesDoCursor()
    return n > 0 && n < el.value.trim().split(/\s+/).length
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={campo}
        autoFocus
        defaultValue={texto}
        onBlur={(e) => {
          if (saiu.current) return
          saiu.current = true
          onConfirmar(e.currentTarget.value)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            saiu.current = true
            onConfirmar(e.currentTarget.value)
          } else if (e.key === 'Escape') {
            saiu.current = true
            onDesistir()
          }
        }}
        aria-label="Texto da legenda"
        className="min-w-0 flex-1 select-text rounded-[3px] border border-accent bg-elevated px-1.5 py-0.5 text-[13px] text-ink focus:outline-none"
      />
      <button
        type="button"
        // mousedown, e nao click: o click chegaria depois do blur do campo,
        // que ja teria confirmado e fechado a edicao.
        onMouseDown={(e) => {
          e.preventDefault()
          if (!podeDividir() || !campo.current) return
          saiu.current = true
          onDividir(campo.current.value, palavrasAntesDoCursor())
        }}
        title="Parte a legenda antes da palavra onde o cursor esta"
        className="lift flex shrink-0 items-center gap-1 rounded-sm border border-line bg-elevated px-2 py-1 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40"
      >
        <Scissors size={11} strokeWidth={1.5} />
        Dividir no cursor
      </button>
    </div>
  )
}

/**
 * A faixa fina entre duas legendas, com o "+" que junta as duas -- o mesmo
 * gesto do LegendAI. Discreta ate o mouse chegar perto, para nao poluir a
 * lista.
 */
function JuntarComAProxima({ onJuntar }: { onJuntar: () => void }) {
  return (
    <div className="group/vao relative h-2 border-b border-line/60">
      <button
        type="button"
        onPointerDown={(e) => {
          e.stopPropagation()
          onJuntar()
        }}
        title="Mesclar com a proxima"
        aria-label="Mesclar com a proxima"
        className="absolute left-[64px] top-1/2 z-10 flex h-4 items-center gap-1 rounded-full border border-line bg-elevated px-1.5 text-[10px] text-ink-3 opacity-0 transition-opacity hover:border-accent hover:text-ink focus-visible:opacity-100 group-hover/vao:opacity-100 -translate-y-1/2"
      >
        <Plus size={9} strokeWidth={2} />
        mesclar com a proxima
      </button>
    </div>
  )
}

/**
 * As regras do LegendAI, como opcoes. Mudar refaz as legendas na hora; as que
 * ele editou mantem o agrupamento e so ganham os tempos novos.
 */
function PainelDeRegras() {
  const regras = useProject((s) => s.captionRules)
  const setRegras = useProject((s) => s.setCaptionRules)

  const numero = (
    rotulo: string,
    campo: keyof RegrasDaLegenda,
    { passo, min, max, fator = 1, sufixo }: { passo: number; min: number; max: number; fator?: number; sufixo: string },
    dica: string,
  ) => (
    <label className="flex items-center justify-between gap-2 text-[11px] text-ink-2" title={dica}>
      <span>{rotulo}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={passo}
          min={min}
          max={max}
          value={Math.round(regras[campo] * fator * 1000) / 1000}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) setRegras({ [campo]: v / fator })
          }}
          className="tnum w-16 rounded-sm border border-line bg-elevated px-1.5 py-0.5 text-right text-[11px] text-ink focus:border-accent focus:outline-none"
        />
        <span className="w-5 text-ink-3">{sufixo}</span>
      </span>
    </label>
  )

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-line bg-surface px-3 py-2.5">
      <div className="col-span-2 flex items-center justify-between gap-2 text-[11px] text-ink-2">
        <span title="Quantas palavras podem dividir a mesma legenda">Palavras por legenda</span>
        <span className="flex gap-1">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRegras({ palavras: n })}
              className={[
                'tnum w-7 rounded-sm border py-0.5 text-[11px]',
                regras.palavras === n
                  ? 'border-accent bg-accent-dim text-ink'
                  : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
              ].join(' ')}
            >
              {n}
            </button>
          ))}
        </span>
      </div>
      {numero('Caracteres por linha', 'caracteres', { passo: 1, min: 4, max: 30, sufixo: '' },
        'Teto da linha. Palavra maior que isso fica sozinha, inteira.')}
      {numero('Adiantar', 'adiantar', { passo: 10, min: 0, max: 300, fator: 1000, sufixo: 'ms' },
        'Quanto a legenda entra antes da palavra. O olho le como "na hora" quando o texto chega um fio antes do som.')}
      {numero('Duracao minima', 'minimo', { passo: 0.05, min: 0, max: 2, sufixo: 's' },
        'Legenda curta cresce para dentro do silencio depois dela, nunca atrasando a proxima.')}
      {numero('Duracao maxima', 'maximo', { passo: 0.25, min: 0.5, max: 10, sufixo: 's' },
        'Legenda que ficaria mais que isso na tela sai antes.')}
      {numero('Fechar vaos ate', 'fecharVaos', { passo: 0.1, min: 0, max: 2, sufixo: 's' },
        'Vao menor que isso entre duas legendas e fechado: a de cima fica ate a de baixo entrar. 0 desliga.')}
      <p className="col-span-2 text-[10.5px] leading-relaxed text-ink-3">
        Sempre valem as regras do portugues: artigo, preposicao e conjuncao nunca fecham a linha —
        descem junto com o que apresentam — e pontuacao fecha a linha.
      </p>
    </div>
  )
}
