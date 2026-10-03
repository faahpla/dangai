import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FileAudio,
  FileImage,
  FileVideo,
  FolderOpen,
  FolderX,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { classifyFile, type ArquivoDaBin } from '@shared/channels'
import { useProject } from '@/store/project'
import {
  adicionarArquivos,
  apagarBin,
  criarBin,
  desligarPasta,
  ligarPasta,
  renomearBin,
  tirarArquivo,
} from '@/store/bins'
import { caminhosDoArraste, iniciarArraste } from './arrastar'

/**
 * As POWER BINS: o acervo dele, a um arraste da linha do tempo.
 *
 * "Uma funcao tipo as Power Bins do DaVinci, nessas bins eu colocaria todos os
 * meus SFX, e seria mais facil de fazer o drag and drop onde eu quero." Cada
 * bin junta arquivos soltos e, se quiser, uma pasta inteira -- que e relida
 * sozinha. O que esta aqui se arrasta para a faixa de SFX, para as faixas de
 * audio e para a faixa de video, do mesmo jeito que se arrasta do Explorer.
 *
 * Moram nas configuracoes: valem para todo projeto, e nada aqui suja o video.
 */

type Filtro = 'tudo' | 'audio' | 'video' | 'image'

const ICONE = { audio: FileAudio, video: FileVideo, image: FileImage } as const

export function Bins() {
  const bins = useProject((s) => s.bins)
  const [ativa, setAtiva] = useState<string | null>(null)
  const [daPasta, setDaPasta] = useState<Record<string, ArquivoDaBin[]>>({})
  const [lendo, setLendo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('tudo')
  const [busca, setBusca] = useState('')
  const [nomeando, setNomeando] = useState<'nova' | 'renomear' | null>(null)
  const [nome, setNome] = useState('')
  const [sobre, setSobre] = useState(false)
  const [tocando, setTocando] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  const bin = bins.find((b) => b.id === ativa) ?? bins[0] ?? null

  // A pasta da bin e relida ao abrir a bin: largar um som la ja o traz.
  const lerPasta = async (pasta: string): Promise<void> => {
    setLendo(true)
    setErro(null)
    const r = await window.dangai.listarPasta(pasta)
    setLendo(false)
    if (r.ok) setDaPasta((atual) => ({ ...atual, [pasta]: r.value }))
    else setErro(r.error)
  }
  useEffect(() => {
    if (bin?.pasta && !daPasta[bin.pasta]) void lerPasta(bin.pasta)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bin?.pasta])

  const itens = useMemo(() => {
    if (!bin) return []
    const soltos: ArquivoDaBin[] = bin.arquivos.flatMap((path) => {
      const tipo = classifyFile(path)
      return tipo === 'audio' || tipo === 'video' || tipo === 'image'
        ? [{ path, nome: path.split(/[\\/]/).pop() ?? path, tipo }]
        : []
    })
    const vistos = new Set(soltos.map((a) => a.path))
    const todos = [...soltos, ...(bin.pasta ? (daPasta[bin.pasta] ?? []) : []).filter((a) => !vistos.has(a.path))]
    const termo = busca.trim().toLowerCase()
    return todos.filter(
      (a) => (filtro === 'tudo' || a.tipo === filtro) && (!termo || a.nome.toLowerCase().includes(termo)),
    )
  }, [bin, daPasta, filtro, busca])

  const ouvir = async (path: string): Promise<void> => {
    const el = audio.current
    if (!el) return
    if (tocando === path) {
      el.pause()
      setTocando(null)
      return
    }
    const r = await window.dangai.libraryClipUrl(path)
    if (!r.ok) return
    el.src = r.value
    el.currentTime = 0
    void el.play().catch(() => undefined)
    setTocando(path)
  }

  const confirmarNome = (): void => {
    if (nomeando === 'nova') {
      const id = criarBin(nome)
      if (id) setAtiva(id)
    } else if (nomeando === 'renomear' && bin) {
      renomearBin(bin.id, nome)
    }
    setNomeando(null)
    setNome('')
  }

  return (
    <div className="enter flex min-h-0 flex-1 gap-3">
      <audio ref={audio} onEnded={() => setTocando(null)} className="hidden" />

      {/* As bins. */}
      <div className="flex w-[180px] shrink-0 flex-col gap-1 overflow-y-auto rounded-md border border-line bg-surface p-2">
        <span className="px-1 text-[10px] uppercase tracking-wide text-ink-3">Power Bins</span>
        {bins.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setAtiva(b.id)}
            className={[
              'flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[12px]',
              bin?.id === b.id ? 'bg-accent-dim text-ink' : 'text-ink-2 hover:bg-elevated',
            ].join(' ')}
          >
            <span className="min-w-0 truncate">{b.nome}</span>
            {b.pasta && <FolderOpen size={11} strokeWidth={1.5} className="shrink-0 text-ink-3" />}
          </button>
        ))}
        {nomeando === 'nova' ? (
          <input
            autoFocus
            value={nome}
            maxLength={40}
            placeholder="Nome da bin"
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') confirmarNome()
              if (e.key === 'Escape') setNomeando(null)
            }}
            onBlur={confirmarNome}
            className="rounded-sm border border-accent bg-elevated px-2 py-1 text-[12px] text-ink focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setNome('')
              setNomeando('nova')
            }}
            className="mt-1 flex items-center gap-1.5 rounded-sm border border-dashed border-line px-2 py-1.5 text-[11px] text-ink-3 hover:text-ink-2"
          >
            <Plus size={11} strokeWidth={1.5} />
            Nova bin
          </button>
        )}
      </div>

      {/* O conteudo da bin escolhida. Soltar arquivos aqui os poe nela. */}
      <div
        onDragOver={(e) => {
          if (!bin) return
          e.preventDefault()
          setSobre(true)
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => {
          setSobre(false)
          if (!bin) return
          const caminhos = caminhosDoArraste(e).filter((p) => {
            const t = classifyFile(p)
            return t === 'audio' || t === 'video' || t === 'image'
          })
          if (caminhos.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          adicionarArquivos(bin.id, caminhos)
        }}
        className={[
          'flex min-w-0 flex-1 flex-col gap-2 rounded-md border p-2',
          sobre ? 'border-accent bg-accent-dim' : 'border-line bg-surface',
        ].join(' ')}
      >
        {!bin ? (
          <div className="grid flex-1 place-items-center px-6 text-center text-[11px] leading-relaxed text-ink-3">
            Crie uma bin e solte aqui seus SFX, musicas e .mov -- ou ligue a bin a uma pasta. Depois e
            so arrastar para a linha do tempo.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {nomeando === 'renomear' ? (
                <input
                  autoFocus
                  value={nome}
                  maxLength={40}
                  onChange={(e) => setNome(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') confirmarNome()
                    if (e.key === 'Escape') setNomeando(null)
                  }}
                  onBlur={confirmarNome}
                  className="w-40 rounded-sm border border-accent bg-elevated px-2 py-1 text-[12px] text-ink focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNome(bin.nome)
                    setNomeando('renomear')
                  }}
                  title="Clique para renomear"
                  className="text-[13px] font-medium text-ink hover:text-accent"
                >
                  {bin.nome}
                </button>
              )}
              <div className="flex-1" />
              <Botao
                onClick={async () => {
                  const r = await window.dangai.pickFiles()
                  if (r.ok && r.value.length > 0) adicionarArquivos(bin.id, r.value)
                }}
              >
                <Plus size={11} strokeWidth={1.5} /> Arquivos
              </Botao>
              {bin.pasta ? (
                <>
                  <Botao onClick={() => void lerPasta(bin.pasta!)} titulo={`Reler ${bin.pasta}`}>
                    <RefreshCw size={11} strokeWidth={1.5} className={lendo ? 'animate-spin' : ''} /> Reler pasta
                  </Botao>
                  <Botao onClick={() => desligarPasta(bin.id)} titulo="Os arquivos soltos ficam">
                    <FolderX size={11} strokeWidth={1.5} /> Desligar pasta
                  </Botao>
                </>
              ) : (
                <Botao onClick={() => void ligarPasta(bin.id)} titulo="A bin passa a mostrar tudo que estiver na pasta">
                  <FolderOpen size={11} strokeWidth={1.5} /> Ligar a uma pasta
                </Botao>
              )}
              <Botao
                onClick={() => {
                  apagarBin(bin.id)
                  setAtiva(null)
                }}
                titulo="Apaga a bin, nao os arquivos"
              >
                <Trash2 size={11} strokeWidth={1.5} />
              </Botao>
            </div>

            <div className="flex items-center gap-1.5">
              {(['tudo', 'audio', 'video', 'image'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFiltro(f)}
                  className={[
                    'rounded-sm border px-2 py-0.5 text-[10px]',
                    filtro === f ? 'border-accent bg-accent-dim text-ink' : 'border-line text-ink-3 hover:text-ink-2',
                  ].join(' ')}
                >
                  {{ tudo: 'Tudo', audio: 'Audio', video: 'Video', image: 'Imagem' }[f]}
                </button>
              ))}
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Buscar"
                className="ml-auto w-36 rounded-sm border border-line bg-elevated px-2 py-0.5 text-[11px] text-ink focus:border-accent focus:outline-none"
              />
            </div>

            {erro && <p className="text-[11px] text-danger">{erro}</p>}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {itens.length === 0 ? (
                <p className="px-1 py-6 text-center text-[11px] text-ink-3">
                  {lendo ? 'Lendo a pasta...' : 'Vazia. Solte arquivos aqui, ou ligue a bin a uma pasta.'}
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-1">
                  {itens.map((a) => {
                    const Icone = ICONE[a.tipo]
                    const solto = bin.arquivos.includes(a.path)
                    return (
                      <div
                        key={a.path}
                        draggable
                        onDragStart={(e) => iniciarArraste(e, [a.path])}
                        title={`${a.path}\nArraste para a linha do tempo`}
                        className="group/item flex cursor-grab items-center gap-1.5 rounded-sm border border-line bg-elevated px-1.5 py-1 hover:border-line-strong"
                      >
                        {a.tipo === 'audio' ? (
                          <button
                            type="button"
                            onClick={() => void ouvir(a.path)}
                            aria-label={tocando === a.path ? `Parar ${a.nome}` : `Ouvir ${a.nome}`}
                            className="grid size-5 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-accent-dim hover:text-ink"
                          >
                            {tocando === a.path ? <Pause size={11} strokeWidth={1.5} /> : <Play size={11} strokeWidth={1.5} />}
                          </button>
                        ) : (
                          <Icone size={13} strokeWidth={1.5} className="shrink-0 text-ink-3" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">{a.nome}</span>
                        {solto && (
                          <button
                            type="button"
                            onClick={() => tirarArquivo(bin.id, a.path)}
                            aria-label={`Tirar ${a.nome} da bin`}
                            className="shrink-0 text-ink-3 opacity-0 hover:text-danger group-hover/item:opacity-100"
                          >
                            <X size={10} strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <p className="text-[10px] text-ink-3">
              Arraste para a faixa de SFX, para uma faixa de audio ou para a faixa de video.
              {bin.pasta ? ` Pasta: ${bin.pasta}` : ''}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Botao({
  onClick,
  titulo,
  children,
}: {
  onClick: () => void
  titulo?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      className="lift flex items-center gap-1 rounded-sm border border-line bg-elevated px-2 py-1 text-[11px] text-ink-2 hover:text-ink"
    >
      {children}
    </button>
  )
}
