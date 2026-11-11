import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, ClipboardCopy, FileDown, Loader2, Mic, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { classifyFile } from '@shared/channels'
import { TAMANHOS_DO_RESUMO, textoDoResumo, type QuadroDoResumo, type TamanhoDoResumo } from '@shared/resumo-de-manga'
import { useResumoDeManga } from '@/store/resumo-de-manga'
import { avisar } from '@/store/aviso'
import { perguntar } from '@/store/pergunta'

/**
 * A TELA DO RESUMO DE MANGA (ver shared/resumo-de-manga.ts e o store dela).
 *
 * Dois momentos: escolher os capitulos (a IA le e escreve), e corrigir o
 * roteiro -- cada frase com os quadrinhos dela do lado, para ele ver o que vai
 * aparecer enquanto conta. No fim, a narracao gravada entra aqui e o projeto
 * nasce com tudo marcado.
 */
export function ResumoDeManga() {
  const aberta = useResumoDeManga((s) => s.aberta)
  if (!aberta) return null
  return <Tela />
}

/** O ritmo dele: ~240 palavras em ~70 s. */
const PALAVRAS_POR_SEGUNDO = 3.4

function Tela() {
  const resumo = useResumoDeManga((s) => s.resumo)
  const fechar = useResumoDeManga((s) => s.fechar)
  const usarNarracao = useResumoDeManga((s) => s.usarNarracao)

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-bg"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        // A narracao gravada entra aqui, e nao no Dangai vazio por baixo.
        e.preventDefault()
        e.stopPropagation()
        const caminhos = Array.from(e.dataTransfer.files).map((f) => window.dangai.pathForFile(f))
        const audio = caminhos.find((c) => classifyFile(c) === 'audio')
        if (!resumo) return
        if (audio) void usarNarracao(audio)
        else avisar('Solte o áudio da narração (.mp3, .wav, .m4a).')
      }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-3">
        <BookOpen size={16} strokeWidth={1.5} className="text-accent" />
        <h1 className="text-[15px] font-semibold text-ink">Resumo de mangá</h1>
        <span className="flex-1" />
        <button
          type="button"
          onClick={fechar}
          title="Fechar (o rascunho fica guardado)"
          className="rounded-sm p-1.5 text-ink-3 transition-colors hover:bg-elevated hover:text-ink"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </header>
      {resumo ? <Roteiro /> : <Capitulos />}
    </div>
  )
}

// ------------------------------------------------------------- os capitulos

function Capitulos() {
  const series = useResumoDeManga((s) => s.series)
  const escolhidos = useResumoDeManga((s) => s.escolhidos)
  const tamanho = useResumoDeManga((s) => s.tamanho)
  const pedido = useResumoDeManga((s) => s.pedido)
  const andamento = useResumoDeManga((s) => s.andamento)
  const erro = useResumoDeManga((s) => s.erro)
  const alternar = useResumoDeManga((s) => s.alternarCapitulo)
  const definir = useResumoDeManga((s) => s.definir)
  const escrever = useResumoDeManga((s) => s.escrever)

  return (
    <main className="flex min-h-0 flex-1 justify-center overflow-y-auto p-8">
      <div className="flex w-full max-w-[760px] flex-col gap-6">
        <p className="text-[13px] leading-relaxed text-ink-3">
          Escolha os capítulos. A IA lê as páginas e escreve o roteiro, e cada frase já vem com os quadrinhos que mostram o que
          ela conta. Você corrige, grava, e solta a narração aqui.
        </p>

        {series === null ? (
          <p className="flex items-center gap-2 text-[13px] text-ink-3">
            <Loader2 size={14} className="animate-spin" /> Procurando os mangás...
          </p>
        ) : series.length === 0 ? (
          <div className="rounded-md border border-line bg-surface p-4 text-[13px] leading-relaxed text-ink-2">
            Nenhum capítulo na pasta dos mangás. Crie uma pasta para cada mangá e, dentro dela, uma para cada capítulo, com as
            páginas em ordem — por exemplo <span className="text-ink">D:\Mangás\Black Clover\Cap. 359</span>. A pasta muda nas
            Configurações.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {series.map((s) => (
              <section key={s.serie} className="flex flex-col gap-2">
                <h2 className="text-[12px] font-medium uppercase tracking-wide text-ink-3">{s.serie}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {s.capitulos.map((c) => {
                    const ativo = escolhidos.includes(c.dir)
                    return (
                      <button
                        key={c.dir}
                        type="button"
                        disabled={andamento !== null}
                        onClick={() => alternar(c.dir)}
                        className={[
                          'flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[12px] transition-colors disabled:opacity-50',
                          ativo ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:border-line-strong hover:text-ink',
                        ].join(' ')}
                      >
                        {ativo && <Check size={12} strokeWidth={2} className="text-accent" />}
                        {c.capitulo}
                        <span className="tnum text-ink-3">· {c.paginas} pág.</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-[12px] font-medium uppercase tracking-wide text-ink-3">Tamanho do vídeo</h2>
          <div className="flex gap-1.5">
            {(Object.keys(TAMANHOS_DO_RESUMO) as TamanhoDoResumo[]).map((t) => (
              <button
                key={t}
                type="button"
                disabled={andamento !== null}
                onClick={() => definir({ tamanho: t })}
                className={[
                  'rounded-sm border px-3 py-1.5 text-[12px] transition-colors disabled:opacity-50',
                  tamanho === t ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:text-ink',
                ].join(' ')}
              >
                {TAMANHOS_DO_RESUMO[t].nome}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[12px] font-medium uppercase tracking-wide text-ink-3">O que destacar (opcional)</h2>
          <textarea
            value={pedido}
            disabled={andamento !== null}
            onChange={(e) => definir({ pedido: e.target.value })}
            rows={2}
            placeholder="Ex.: foca na luta do Asta e termina no gancho da última página"
            className="w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3/60 focus:border-line-strong"
          />
        </section>

        {erro && <div className="rounded-md border border-danger/40 bg-danger/5 p-3 text-[13px] text-ink">{erro}</div>}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void escrever()}
            disabled={escolhidos.length === 0 || andamento !== null}
            className="flex items-center gap-2 rounded-sm border border-accent bg-accent-dim px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-accent/30 disabled:opacity-40"
          >
            {andamento ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} strokeWidth={1.75} />}
            {andamento ? 'Trabalhando...' : 'Ler e escrever o roteiro'}
          </button>
          <span className="text-[12px] text-ink-3">
            {andamento ?? 'A primeira leitura de um capítulo leva 1 ou 2 minutos; depois fica guardada.'}
          </span>
        </div>
      </div>
    </main>
  )
}

// ---------------------------------------------------------------- o roteiro

function Roteiro() {
  const resumo = useResumoDeManga((s) => s.resumo)!
  const andamento = useResumoDeManga((s) => s.andamento)
  const erro = useResumoDeManga((s) => s.erro)
  const mudarTitulo = useResumoDeManga((s) => s.mudarTitulo)
  const escrever = useResumoDeManga((s) => s.escrever)
  const recomecar = useResumoDeManga((s) => s.recomecar)
  const salvarTxt = useResumoDeManga((s) => s.salvarTxt)
  const [escolhendo, setEscolhendo] = useState<number | null>(null)
  const [focar, setFocar] = useState<number | null>(null)

  const porRef = useMemo(() => new Map(resumo.quadros.map((q) => [q.ref, q])), [resumo.quadros])
  const texto = textoDoResumo(resumo.frases)
  const palavras = texto.split(/\s+/).filter(Boolean).length
  const segundos = Math.round(palavras / PALAVRAS_POR_SEGUNDO)

  const copiar = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(texto)
      avisar('Roteiro copiado.', 3000)
    } catch {
      avisar('Não deu para copiar. Selecione o texto e use Ctrl+C.')
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-2.5">
          <input
            value={resumo.titulo}
            onChange={(e) => mudarTitulo(e.target.value)}
            placeholder="Título do vídeo"
            title="O título do vídeo (vira o nome do projeto)"
            className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:text-ink-3"
          />
          <span className="tnum shrink-0 text-[12px] text-ink-3">
            {resumo.frases.length} frases · {palavras} palavras · ~{Math.floor(segundos / 60)}:{String(segundos % 60).padStart(2, '0')} na sua voz
          </span>
          <BotaoPequeno onClick={() => void copiar()} icone={ClipboardCopy} dica="Copia o roteiro, uma frase por linha">
            Copiar
          </BotaoPequeno>
          <BotaoPequeno
            onClick={() => void salvarTxt()}
            icone={FileDown}
            dica="Salva o roteiro em .txt. Gravou e editou o áudio? Solte este .txt na etapa do Roteiro: os quadrinhos de cada frase vêm junto."
          >
            Salvar .txt
          </BotaoPequeno>
          <BotaoPequeno
            onClick={async () => {
              const sim = await perguntar({
                titulo: 'Escrever de novo?',
                texto: 'A IA escreve outro roteiro com os mesmos capítulos. O que você corrigiu neste vai embora.',
                sim: 'Escrever de novo',
                nao: 'Cancelar',
              })
              if (sim) await escrever()
            }}
            icone={andamento ? Loader2 : RotateCcw}
            dica="A IA escreve outro roteiro com os mesmos capítulos (o que você corrigiu vai embora)"
            desligado={andamento !== null}
          >
            {andamento ? 'Escrevendo...' : 'Escrever de novo'}
          </BotaoPequeno>
          <BotaoPequeno onClick={recomecar} icone={BookOpen} dica="Escolher outros capítulos" desligado={andamento !== null}>
            Capítulos
          </BotaoPequeno>
        </div>
        {erro && <div className="mx-6 mt-3 rounded-md border border-danger/40 bg-danger/5 p-3 text-[13px] text-ink">{erro}</div>}

        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto flex max-w-[900px] flex-col gap-2">
            {resumo.frases.map((f, i) => (
              <Frase
                key={i}
                i={i}
                texto={f.texto}
                quadros={f.quadros.map((r) => porRef.get(r)).filter((q): q is QuadroDoResumo => !!q)}
                escolhendo={escolhendo === i}
                escolher={() => setEscolhendo(escolhendo === i ? null : i)}
                focar={focar === i}
                focou={() => setFocar(null)}
                novaDepois={() => setFocar(i + 1)}
              />
            ))}
          </div>
        </main>

        <Narracao />
      </div>
      {escolhendo !== null && escolhendo < resumo.frases.length && (
        <Escolher i={escolhendo} fechar={() => setEscolhendo(null)} />
      )}
    </div>
  )
}

function Frase(props: {
  i: number
  texto: string
  quadros: QuadroDoResumo[]
  escolhendo: boolean
  escolher: () => void
  focar: boolean
  focou: () => void
  novaDepois: () => void
}) {
  const { i, texto, quadros, escolhendo } = props
  const mudar = useResumoDeManga((s) => s.mudarFrase)
  const apagar = useResumoDeManga((s) => s.apagarFrase)
  const nova = useResumoDeManga((s) => s.novaFrase)
  const alternar = useResumoDeManga((s) => s.alternarQuadro)
  const ref = useRef<HTMLTextAreaElement>(null)

  // A altura acompanha o texto.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [texto])

  useEffect(() => {
    if (!props.focar) return
    ref.current?.focus()
    props.focou()
  }, [props.focar, props])

  return (
    <div
      className={[
        'group flex gap-3 rounded-md border p-3 transition-colors',
        escolhendo ? 'border-accent bg-accent-dim/40' : 'border-line bg-surface',
      ].join(' ')}
    >
      <span className="tnum w-5 shrink-0 pt-0.5 text-right text-[12px] text-ink-3">{i + 1}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <textarea
          ref={ref}
          value={texto}
          rows={1}
          onChange={(e) => mudar(i, e.target.value.replace(/\n/g, ' '))}
          onKeyDown={(e) => {
            // Enter abre a proxima frase: uma frase por linha, como ele grava.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              nova(i)
              props.novaDepois()
            }
            if (e.key === 'Backspace' && texto === '' && quadros.length === 0) {
              e.preventDefault()
              apagar(i)
            }
          }}
          placeholder="Escreva a frase"
          className="w-full resize-none overflow-hidden bg-transparent text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-3/60"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {quadros.map((q) => (
            <Miniatura key={q.ref} quadro={q} tirar={() => alternar(i, q.ref)} />
          ))}
          <button
            type="button"
            onClick={props.escolher}
            title="Escolher os quadrinhos desta frase"
            className={[
              'flex h-20 items-center gap-1 rounded-sm border border-dashed px-2.5 text-[11px] transition-colors',
              escolhendo ? 'border-accent text-ink' : 'border-line text-ink-3 hover:border-line-strong hover:text-ink',
            ].join(' ')}
          >
            <Plus size={12} strokeWidth={1.75} />
            {quadros.length === 0 ? 'Quadrinhos' : ''}
          </button>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => apagar(i)}
          title="Apagar a frase"
          className="rounded-sm p-1 text-ink-3 hover:bg-elevated hover:text-ink"
        >
          <Trash2 size={13} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={() => {
            nova(i)
            props.novaDepois()
          }}
          title="Nova frase embaixo"
          className="rounded-sm p-1 text-ink-3 hover:bg-elevated hover:text-ink"
        >
          <Plus size={13} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}

function dicaDo(q: QuadroDoResumo): string {
  const onde = `Página ${q.pagina}${q.quadro === null ? ' inteira' : `, quadro ${q.quadro}`}`
  return [onde, q.oque, q.falas && `“${q.falas}”`].filter(Boolean).join('\n')
}

function Miniatura({ quadro, tirar }: { quadro: QuadroDoResumo; tirar: () => void }) {
  return (
    <div className="group/q relative h-20 shrink-0" title={dicaDo(quadro)}>
      <img src={quadro.miniatura} alt="" draggable={false} className="h-20 w-auto max-w-[170px] rounded-sm bg-black/40 object-contain" />
      <button
        type="button"
        onClick={tirar}
        title="Tirar este quadrinho da frase"
        className="absolute right-0.5 top-0.5 hidden rounded-full bg-black/70 p-0.5 text-white group-hover/q:block"
      >
        <X size={11} strokeWidth={2} />
      </button>
    </div>
  )
}

/** Todos os quadrinhos dos capitulos, na ordem, para ligar e desligar na frase escolhida. */
function Escolher({ i, fechar }: { i: number; fechar: () => void }) {
  const resumo = useResumoDeManga((s) => s.resumo)!
  const alternar = useResumoDeManga((s) => s.alternarQuadro)
  const frase = resumo.frases[i]!
  const naFrase = new Set(frase.quadros)
  // Quem esta em outra frase: da para usar de novo, mas ele ve.
  const emOutra = new Map<string, number>()
  resumo.frases.forEach((f, k) => k !== i && f.quadros.forEach((r) => emOutra.set(r, k + 1)))
  const lista = useRef<HTMLDivElement>(null)

  // Abre perto de onde a frase esta na historia: no primeiro quadrinho dela, ou no ultimo da frase anterior.
  useEffect(() => {
    const anterior = resumo.frases
      .slice(0, i)
      .flatMap((f) => f.quadros)
      .at(-1)
    const alvo = frase.quadros[0] ?? anterior
    if (!alvo) return
    lista.current?.querySelector(`[data-ref="${alvo}"]`)?.scrollIntoView({ block: 'center' })
    // So ao abrir para esta frase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  const paginas: { chave: string; titulo: string; quadros: QuadroDoResumo[] }[] = []
  for (const q of resumo.quadros) {
    const chave = `${q.capitulo}-${q.pagina}`
    let p = paginas.at(-1)
    if (!p || p.chave !== chave) {
      const cap = resumo.capitulos[q.capitulo - 1]
      p = { chave, titulo: `${resumo.capitulos.length > 1 && cap ? `${cap.capitulo} · ` : ''}Página ${q.pagina}`, quadros: [] }
      paginas.push(p)
    }
    p.quadros.push(q)
  }

  return (
    <aside className="flex w-[440px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
          Quadrinhos da frase <span className="text-ink">{i + 1}</span>
        </p>
        <button type="button" onClick={fechar} className="rounded-sm p-1 text-ink-3 hover:bg-elevated hover:text-ink">
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div ref={lista} className="min-h-0 flex-1 overflow-y-auto p-3">
        {paginas.map((p) => (
          <div key={p.chave} className="mb-3">
            <p className="mb-1 text-[11px] text-ink-3">{p.titulo}</p>
            <div className="flex flex-wrap gap-1.5">
              {p.quadros.map((q) => {
                const ligado = naFrase.has(q.ref)
                const outra = emOutra.get(q.ref)
                return (
                  <button
                    key={q.ref}
                    type="button"
                    data-ref={q.ref}
                    onClick={() => alternar(i, q.ref)}
                    title={dicaDo(q) + (outra ? `\nJá está na frase ${outra}` : '')}
                    className={[
                      'relative rounded-sm border-2 transition-colors',
                      ligado ? 'border-accent' : 'border-transparent hover:border-line-strong',
                      outra && !ligado ? 'opacity-50' : '',
                    ].join(' ')}
                  >
                    <img src={q.miniatura} alt="" draggable={false} className="h-20 w-auto max-w-[190px] rounded-[2px] bg-black/40 object-contain" />
                    {q.forte && <span className="absolute left-1 top-1 rounded-sm bg-accent px-1 text-[9px] font-semibold text-white">FORTE</span>}
                    {ligado && (
                      <span className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-white">
                        <Check size={10} strokeWidth={2.5} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

/** O fim do caminho: a narracao gravada entra e o projeto nasce. */
function Narracao() {
  const usarNarracao = useResumoDeManga((s) => s.usarNarracao)
  const escolher = async (): Promise<void> => {
    const r = await window.dangai.pickFiles()
    if (!r.ok) return
    const audio = r.value.find((c) => classifyFile(c) === 'audio')
    if (audio) await usarNarracao(audio)
    else if (r.value.length > 0) avisar('Escolha o áudio da narração (.mp3, .wav, .m4a).')
  }
  return (
    <div className="shrink-0 border-t border-line px-6 py-3">
      <button
        type="button"
        onClick={() => void escolher()}
        className="mx-auto flex w-full max-w-[900px] items-center justify-center gap-3 rounded-md border border-dashed border-line-strong px-4 py-3 text-[13px] text-ink-2 transition-colors hover:border-accent hover:text-ink"
      >
        <Mic size={16} strokeWidth={1.5} className="text-accent" />
        Gravou? Solte a narração aqui (ou clique para escolher). O projeto nasce com os quadrinhos de cada frase já marcados.
      </button>
    </div>
  )
}

function BotaoPequeno(props: {
  onClick: () => void
  icone: typeof X
  dica: string
  desligado?: boolean
  children: React.ReactNode
}) {
  const Icone = props.icone
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.dica}
      disabled={props.desligado}
      className="flex shrink-0 items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
    >
      <Icone size={13} strokeWidth={1.5} className={Icone === Loader2 ? 'animate-spin' : ''} />
      {props.children}
    </button>
  )
}
