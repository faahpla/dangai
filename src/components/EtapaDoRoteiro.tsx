import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Captions, ClipboardPaste, FileText, Loader2, RotateCcw, TriangleAlert } from 'lucide-react'
import { roteiroNaoBate } from '@shared/preflight'
import { useProject } from '@/store/project'
import { BarraDeEtapas } from './BarraDeEtapas'

/**
 * A ETAPA DO ROTEIRO, entre o audio e as cenas: o roteiro entra e e casado com
 * a narracao, palavra por palavra. "Quando terminar de editar o audio quero
 * levar pra proxima etapa, a de arrastar o roteiro para o processo de
 * sincronizacao de legendas... quando terminar de sincronizar com o whisper
 * quero que me leve pra proxima etapa."
 *
 * Com o roteiro (solto aqui, colado, ou ja solto junto da gravacao), a sincronia
 * comeca sozinha -- e a mesma leitura que a Biblioteca fazia ao abrir
 * (loadScriptBlocks), so que antes dela. Deu certo: segue sozinha para as cenas.
 * O roteiro nao bate com a voz: para e mostra, porque seguir assim seria escolher
 * cenas em cima de legendas erradas.
 */
export function EtapaDoRoteiro() {
  const aberta = useProject((s) => s.etapaDoRoteiro)
  if (!aberta) return null
  return <Tela />
}

function Tela() {
  const audio = useProject((s) => s.audio)
  const script = useProject((s) => s.script)
  const blocos = useProject((s) => s.scriptBlocks)
  const lendo = useProject((s) => s.scriptBlocksBusy)
  const busy = useProject((s) => s.busy)
  const transcript = useProject((s) => s.transcript)
  const scriptNote = useProject((s) => s.scriptNote)
  const erro = useProject((s) => s.erroDaSincronia)
  const carregar = useProject((s) => s.loadScriptBlocks)
  const ir = useProject((s) => s.irParaEtapa)
  const openScript = useProject((s) => s.openScript)

  const [semRoteiro, setSemRoteiro] = useState(false)
  /** Esta visita pediu a sincronia: so entao ela segue sozinha quando acaba. */
  const pediu = useRef(false)
  /** Uma tentativa por narracao + roteiro: falhou, espera ele mandar de novo. */
  const tentado = useRef<string | null>(null)

  const chave = `${audio?.path ?? ''}|${script ?? ''}|${semRoteiro}`
  useEffect(() => {
    if (!audio || blocos || lendo || (!script && !semRoteiro) || tentado.current === chave) return
    tentado.current = chave
    pediu.current = true
    void carregar()
  }, [audio, blocos, lendo, script, semRoteiro, chave, carregar])

  const nota = blocos ? roteiroNaoBate(script, transcript, scriptNote) : null
  const frases = blocos ? new Set(blocos.map((b) => b.sentence)).size : 0

  // Sincronizou agora e bateu: as cenas.
  useEffect(() => {
    if (!pediu.current || !blocos || nota) return
    const t = setTimeout(() => void ir('cenas'), 1400)
    return () => clearTimeout(t)
  }, [blocos, nota, ir])

  const tentarDeNovo = (): void => {
    tentado.current = null
    useProject.setState({ erroDaSincronia: null })
    pediu.current = true
    void carregar()
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-3">
        <FileText size={16} strokeWidth={1.5} className="text-accent" />
        <h1 className="text-[15px] font-semibold text-ink">Roteiro</h1>
        <span className="flex-1" />
        <BarraDeEtapas />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void ir('cenas')}
          disabled={!blocos || lendo !== null}
          title="Escolher as cenas de cada frase"
          className="flex items-center gap-2 rounded-sm border border-accent bg-accent-dim px-4 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-accent/30 disabled:opacity-40"
        >
          Cenas
          <ArrowRight size={14} strokeWidth={1.75} />
        </button>
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8">
        <div className="flex w-full max-w-[620px] flex-col gap-5">
          <p className="text-[13px] leading-relaxed text-ink-3">
            O texto das legendas vem do roteiro. O Whisper só ouve a narração para saber quando cada palavra é dita.
          </p>

          {erro && !lendo ? (
            <div className="flex flex-col gap-3 rounded-md border border-danger/40 bg-danger/5 p-4">
              <p className="text-[13px] text-ink">{erro}</p>
              <div>
                <Botao onClick={tentarDeNovo} icone={RotateCcw}>
                  Tentar de novo
                </Botao>
              </div>
            </div>
          ) : !script && !semRoteiro && !blocos ? (
            <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-line-strong px-8 py-12 text-center">
              <FileText size={28} strokeWidth={1.25} className="text-accent" />
              <div className="flex flex-col gap-1">
                <p className="text-[16px] font-medium text-ink">Solte o roteiro aqui</p>
                <p className="text-[12px] text-ink-3">O .txt do vídeo. A sincronia começa sozinha.</p>
              </div>
              <div className="flex gap-2">
                <Botao onClick={() => openScript(true)} icone={ClipboardPaste}>
                  Colar o roteiro
                </Botao>
                <button
                  type="button"
                  onClick={() => setSemRoteiro(true)}
                  title="As legendas saem do que o Whisper ouvir"
                  className="rounded-sm px-3 py-1.5 text-[12px] text-ink-3 transition-colors hover:text-ink"
                >
                  Seguir sem roteiro
                </button>
              </div>
            </div>
          ) : lendo || (!blocos && (script || semRoteiro)) ? (
            <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5">
              <p className="flex items-center gap-2 text-[14px] text-ink">
                <Loader2 size={15} className="animate-spin text-accent" />
                {busy ?? lendo ?? 'Começando...'}
              </p>
              {script && <PreviaDoRoteiro script={script} />}
            </div>
          ) : nota ? (
            <div className="flex flex-col gap-3 rounded-md border border-accent/40 bg-accent-dim p-4">
              <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink">
                <TriangleAlert size={15} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
                {nota}
              </p>
              <p className="text-[12px] leading-relaxed text-ink-3">
                Confira se o roteiro é deste áudio. Solte o certo aqui para sincronizar de novo, ou siga com as legendas
                pelo que o Whisper ouviu.
              </p>
              <div className="flex gap-2">
                <Botao onClick={() => void ir('cenas')} icone={ArrowRight}>
                  Seguir assim
                </Botao>
                <Botao onClick={() => openScript(true)} icone={ClipboardPaste}>
                  Colar outro roteiro
                </Botao>
              </div>
            </div>
          ) : blocos ? (
            <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5">
              <p className="flex items-center gap-2 text-[14px] text-ink">
                <Captions size={15} strokeWidth={1.5} className="text-accent" />
                {semRoteiro && !script ? 'Legendas pelo que o Whisper ouviu' : 'Legendas sincronizadas com o roteiro'}
                <span className="text-ink-3">· {frases} {frases === 1 ? 'frase' : 'frases'}</span>
              </p>
              {scriptNote && <p className="text-[12px] text-ink-3">{scriptNote}</p>}
              <p className="text-[12px] text-ink-3">
                {pediu.current ? 'Indo para as cenas...' : 'Para trocar o roteiro, solte outro .txt aqui.'}
              </p>
              {!pediu.current && (
                <div>
                  <Botao onClick={() => openScript(true)} icone={ClipboardPaste}>
                    Colar ou editar o roteiro
                  </Botao>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  )
}

function PreviaDoRoteiro({ script }: { script: string }) {
  const palavras = script.trim().split(/\s+/).length
  return (
    <div className="flex flex-col gap-1.5">
      <p className="line-clamp-4 whitespace-pre-line text-[12px] leading-relaxed text-ink-3">{script.trim()}</p>
      <p className="text-[11px] text-ink-3/70">{palavras} palavras</p>
    </div>
  )
}

function Botao({ onClick, icone: Icone, children }: { onClick: () => void; icone: typeof ArrowRight; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-3 py-1.5 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
    >
      <Icone size={13} strokeWidth={1.5} />
      {children}
    </button>
  )
}
