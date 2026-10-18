import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Circle, Cpu, FileText, FolderOpen, HardDrive, Loader2, RotateCcw, TriangleAlert, X } from 'lucide-react'
import {
  ETAPAS_DA_INSTALACAO,
  ROTULO_DA_ETAPA,
  textoDoTamanho,
  type EstadoDoMotorRuntime,
  type EtapaDaInstalacao,
  type VarianteDoMotor,
} from '../../../shared/motor-runtime'
import { ouvirMotorRuntime, useMotorRuntime } from '../../store/motor-runtime'
import { Barra } from '../AndamentoDaAnalise'
import { Botao, focarBotao, gpuCurta, Link, meioDoCaminho } from '../pecas'

/**
 * A TELA "INSTALAR MOTOR DE PERSONAGENS" (app instalado, desenho de 15/10).
 *
 * O .exe do app nao leva o Python + torch do motor (~5 GB no disco; o GitHub
 * limita a 2 GB por arquivo): no 1o uso que precisa dele (cortar, reconhecer,
 * Reconhecer na mao) esta tela abre UMA vez (pedirMotor), instala com barra,
 * e quando fica pronto fecha sozinha e roda o que estava esperando.
 *
 * Montada uma vez no App.tsx: tambem liga o evento do main ao store e mostra o
 * aviso de uma linha da atualizacao automatica ("Motor atualizado: 3 pacotes").
 * Cartao no estilo da PerguntaDoEpisodio (portal, fundo apagado, glass).
 * Fechar (X, Esc, clicar fora) so esconde: a instalacao continua por tras.
 */

/** "1,2 GB" / "45 MB" / "1,6 TB" (ASCII, virgula). */
export function tamanhoCurto(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1).replace('.', ',')} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

/** "RTX 5080" ou o motivo de ir pela CPU. */
export function textoDaPlaca(e: EstadoDoMotorRuntime): string {
  if (!e.gpu) return 'Procurando a placa...'
  const variante: VarianteDoMotor = e.variante ?? e.varianteSugerida
  // Instalado e a placa nao rodou a conta (sem kernel no cu128, driver velho): o motor vai na CPU.
  if (variante === 'cu128' && e.cudaOk === false) return e.gpu.nome ? `${gpuCurta(e.gpu.nome)}: CPU` : 'CPU'
  if (variante === 'cu128') return e.gpu.nome ? gpuCurta(e.gpu.nome) : 'NVIDIA'
  return e.gpu.nome ? 'CPU (sem CUDA)' : 'Sem NVIDIA: CPU, mais lento'
}

/** O tamanho do botao: o que falta baixar ("~3 GB"). */
function tamanhoDoBotao(e: EstadoDoMotorRuntime): string {
  return textoDoTamanho(Math.max(e.bytesParaBaixar, 1e6))
}

export function InstalarMotor() {
  const estado = useMotorRuntime((s) => s.estado)
  const aberta = useMotorRuntime((s) => s.aberta)

  useEffect(() => {
    void useMotorRuntime.getState().conferir()
    return ouvirMotorRuntime()
  }, [])

  useEffect(() => {
    if (!aberta) return
    focarBotao('motor-principal', 'motor-fechar')
    const tecla = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      useMotorRuntime.getState().fechar()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [aberta])

  return (
    <>
      <AvisoDoMotor />
      {aberta && estado &&
        createPortal(
          // z-55: POR CIMA das Configuracoes (z-50). O "Instalar motor" e o "Reinstalar" de la abrem
          // esta tela; com z-46 ela nascia atras do painel e o clique parecia nao fazer nada.
          <div className="fixed inset-0 z-[55] grid place-items-center bg-black/45" onPointerDown={() => useMotorRuntime.getState().fechar()}>
            <div
              role="dialog"
              aria-label="Motor de personagens"
              onPointerDown={(ev) => ev.stopPropagation()}
              style={{ backgroundColor: 'var(--color-elevated)' }}
              className="glass enter flex w-[560px] max-w-[calc(100%-32px)] flex-col gap-4 rounded-lg p-5"
            >
              <header className="flex min-w-0 items-center gap-2.5">
                <Cpu size={15} strokeWidth={1.5} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">Motor de personagens</span>
                <button
                  type="button"
                  onClick={() => useMotorRuntime.getState().fechar()}
                  aria-label="Fechar"
                  title={estado.fase === 'instalando' ? 'Fechar (Esc). A instalacao continua por tras.' : 'Fechar (Esc)'}
                  className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
                >
                  <X size={13} strokeWidth={1.5} />
                </button>
              </header>
              <Corpo estado={estado} />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

function Corpo({ estado }: { estado: EstadoDoMotorRuntime }) {
  switch (estado.fase) {
    case 'instalando':
      return <Instalando estado={estado} />
    case 'incompleto':
      return <Parou estado={estado} />
    case 'desatualizado':
      return <Desatualizado estado={estado} />
    case 'pronto':
      return <Pronto estado={estado} />
    case 'dev':
      return (
        <>
          <p className="text-[12px] text-ink-2">Em desenvolvimento o motor e o motor/.venv: nada a instalar.</p>
          <Rodape>
            <Botao foco="motor-fechar" onClick={() => useMotorRuntime.getState().fechar()}>
              Fechar
            </Botao>
          </Rodape>
        </>
      )
    default:
      return <Ausente estado={estado} />
  }
}

function Rodape({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">{children}</div>
}

/** Placa, disco e pasta: o que a instalacao vai usar. */
function Detalhes({ estado, trocarPasta }: { estado: EstadoDoMotorRuntime; trocarPasta: boolean }) {
  const { escolherPasta } = useMotorRuntime.getState()
  const falta = estado.livreNoDisco !== null && estado.precisaDeLivre > 0 && estado.livreNoDisco < estado.precisaDeLivre
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="flex h-7 items-center gap-1.5 rounded-sm border border-line bg-elevated px-2 text-[11px] text-ink-2"
          title={estado.gpu?.nome ? `${estado.gpu.nome}${estado.gpu.driver ? ` · driver ${estado.gpu.driver}` : ''}` : undefined}
        >
          <Cpu size={12} strokeWidth={1.5} className="shrink-0 text-ink-3" />
          {textoDaPlaca(estado)}
        </span>
        <span
          className="flex h-7 items-center gap-1.5 rounded-sm border border-line bg-elevated px-2 text-[11px] text-ink-2"
          title="Quanto o motor ocupa depois de instalado"
        >
          <HardDrive size={12} strokeWidth={1.5} className="shrink-0 text-ink-3" />
          {tamanhoCurto(estado.bytesNoDisco)} no disco
        </span>
        {estado.livreNoDisco !== null && (
          <span className={['tnum text-[11px]', falta ? 'text-danger' : 'text-ink-3'].join(' ')}>
            {falta ? `Precisa de ${tamanhoCurto(estado.precisaDeLivre)} livres (tem ${tamanhoCurto(estado.livreNoDisco)})` : `Livre: ${tamanhoCurto(estado.livreNoDisco)}`}
          </span>
        )}
      </div>
      {estado.gpu?.driverAntigo && (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-2">
          <TriangleAlert size={12} strokeWidth={1.5} className="shrink-0 text-ink-3" />
          Atualize o driver da NVIDIA (o seu e {estado.gpu.driver}).
        </p>
      )}
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-ink-3">
        <FolderOpen size={12} strokeWidth={1.5} className="shrink-0" />
        <span className="min-w-0 flex-1 select-text truncate" title={estado.pasta}>
          {meioDoCaminho(estado.pasta, 58)}
        </span>
        {trocarPasta && (
          <>
            {!estado.pastaPadrao && <Link onClick={() => void escolherPasta(true)}>Usar o padrao</Link>}
            <Link onClick={() => void escolherPasta()} title="Outro disco (precisa de ~5 GB)">
              Trocar
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

function ErroDoPedido() {
  const erro = useMotorRuntime((s) => s.erroDoPedido)
  if (!erro) return null
  return <p className="select-text text-[11px] leading-relaxed text-danger">{erro}</p>
}

function Ausente({ estado }: { estado: EstadoDoMotorRuntime }) {
  const { instalar, agoraNao } = useMotorRuntime.getState()
  return (
    <>
      <p className="text-[13px] text-ink">Corta as cenas e reconhece os personagens.</p>
      <Detalhes estado={estado} trocarPasta />
      {estado.erro && (
        <p className="select-text text-[11px] leading-relaxed text-danger" title={estado.erro.detalhe}>
          {estado.erro.mensagem}
        </p>
      )}
      <ErroDoPedido />
      <Rodape>
        <Botao principal foco="motor-principal" onClick={() => void instalar()} disabled={!estado.gpu}>
          Instalar motor de personagens ({tamanhoDoBotao(estado)})
        </Botao>
        <Botao onClick={agoraNao}>Agora nao</Botao>
      </Rodape>
    </>
  )
}

/**
 * O rotulo do chip: uma palavra (sete chips cabem numa linha). O inteiro
 * (ROTULO_DA_ETAPA, "Baixar torch") vai no tooltip e na frase de baixo.
 */
const CURTO: Record<EtapaDaInstalacao, string> = {
  preparar: 'Preparar',
  python: 'Python',
  venv: 'Ambiente',
  'baixar-torch': 'Baixar',
  torch: 'Instalar',
  pacotes: 'Pacotes',
  conferir: 'Conferir',
}

/** As etapas em chips, como o corte das cenas (AndamentoDoCorte). */
function Etapas({ estado }: { estado: EstadoDoMotorRuntime }) {
  const atual = estado.andamento?.etapa ?? 'preparar'
  const iAtual = ETAPAS_DA_INSTALACAO.indexOf(atual)
  const vivo = estado.fase === 'instalando'
  return (
    <ol className="flex gap-1">
      {ETAPAS_DA_INSTALACAO.map((etapa, i) => {
        const eAtual = etapa === atual
        const feita = i < iAtual
        return (
          <li
            key={etapa}
            title={ROTULO_DA_ETAPA[etapa]}
            aria-current={eAtual ? 'step' : undefined}
            className={[
              'flex h-7 min-w-0 flex-auto items-center gap-1 rounded-sm border px-1.5',
              eAtual ? (vivo ? 'border-accent bg-accent-dim' : 'border-line-strong bg-elevated') : 'border-line bg-elevated',
            ].join(' ')}
          >
            {eAtual && vivo ? (
              <Loader2 size={10} strokeWidth={1.75} className="shrink-0 animate-spin text-accent" />
            ) : feita ? (
              <Check size={10} strokeWidth={2} className="shrink-0 text-ink-2" />
            ) : eAtual ? (
              <TriangleAlert size={10} strokeWidth={1.75} className="shrink-0 text-ink-3" />
            ) : (
              <Circle size={10} strokeWidth={1.5} className="shrink-0 text-ink-3" />
            )}
            <span className={['min-w-0 truncate text-[10px]', eAtual ? 'text-ink' : feita ? 'text-ink-2' : 'text-ink-3'].join(' ')}>
              {CURTO[etapa]}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Instalando({ estado }: { estado: EstadoDoMotorRuntime }) {
  const { cancelar, fechar } = useMotorRuntime.getState()
  const [cancelando, setCancelando] = useState(false)
  const a = estado.andamento
  const bytes =
    a?.baixados !== undefined && a.total
      ? `${tamanhoCurto(a.baixados).replace(/ (GB|MB|TB)$/, a.total >= 1e9 === a.baixados >= 1e9 ? '' : ' $1')} de ${tamanhoCurto(a.total)}`
      : null
  const velocidade = a?.bytesPorSegundo ? `${Math.max(0.1, a.bytesPorSegundo / 1e6).toFixed(a.bytesPorSegundo >= 1e7 ? 0 : 1).replace('.', ',')} MB/s` : null
  return (
    <>
      <Etapas estado={estado} />
      <Barra fracao={a?.fracao ?? null} />
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 select-text truncate text-[12px] text-ink-2" title={a?.mensagem}>
          {a?.mensagem ?? 'Preparando'}
          {estado.mudancas && !estado.mudancas.torch && !estado.mudancas.python ? ' (atualizacao)' : ''}
        </p>
        <span className="tnum shrink-0 text-[11px] text-ink-3">
          {[bytes, velocidade, a?.fracao !== null && a?.fracao !== undefined ? `${Math.round(a.fracao * 100)}%` : null].filter(Boolean).join(' · ')}
        </span>
      </div>
      <p className="text-[11px] text-ink-3">Pode fechar: continua por tras. Se o app fechar, continua de onde parou.</p>
      <ErroDoPedido />
      <Rodape>
        <Botao
          foco="motor-fechar"
          onClick={() => {
            setCancelando(true)
            void cancelar().finally(() => setCancelando(false))
          }}
          disabled={cancelando}
          title="Para a instalacao. O que ja baixou fica para o Continuar."
        >
          {cancelando ? 'Cancelando...' : 'Cancelar'}
        </Botao>
        <span className="flex-1" />
        <Botao onClick={fechar}>Fechar</Botao>
      </Rodape>
    </>
  )
}

function Parou({ estado }: { estado: EstadoDoMotorRuntime }) {
  const { instalar, agoraNao } = useMotorRuntime.getState()
  const fracao = estado.andamento?.fracao ?? 0
  const etapa = estado.andamento ? ROTULO_DA_ETAPA[estado.andamento.etapa] : null
  const conferencia = estado.erro?.tipo === 'conferencia'
  return (
    <>
      <Etapas estado={estado} />
      <Barra fracao={fracao} />
      <p className="text-[13px] text-ink">
        {/* O2: o app fechado no meio (sem erro e sem Cancelar) e "Parou", nao "Cancelado" (o main diz qual). */}
        {estado.erro || estado.andamento?.mensagem !== 'Cancelado' ? 'Parou' : 'Cancelado'} em {Math.round(fracao * 100)}%
        {etapa ? ` (${etapa})` : ''}.
      </p>
      {estado.erro && (
        <p className="flex items-start gap-1.5 text-[12px] text-danger" title={estado.erro.detalhe}>
          <TriangleAlert size={13} strokeWidth={1.5} className="mt-px shrink-0" />
          <span className="min-w-0 select-text">{estado.erro.mensagem}</span>
        </p>
      )}
      <Detalhes estado={estado} trocarPasta={false} />
      <ErroDoPedido />
      <Rodape>
        <Botao principal={!conferencia} foco="motor-principal" onClick={() => void instalar()}>
          Continuar ({tamanhoDoBotao(estado)})
        </Botao>
        {conferencia && (
          <Botao principal onClick={() => void instalar({ recomecar: true })} title="Apaga o que foi instalado e faz do zero">
            <RotateCcw size={12} strokeWidth={1.5} />
            Recomecar
          </Botao>
        )}
        {estado.log && (
          <Botao onClick={() => void window.dangai.revealFile(estado.log!)} title={estado.log}>
            <FileText size={12} strokeWidth={1.5} />
            Abrir log
          </Botao>
        )}
        <span className="flex-1" />
        <Botao onClick={agoraNao}>Agora nao</Botao>
      </Rodape>
    </>
  )
}

function Desatualizado({ estado }: { estado: EstadoDoMotorRuntime }) {
  const { instalar, agoraNao } = useMotorRuntime.getState()
  const m = estado.mudancas
  const oQue = m?.python ? 'Python novo' : m?.torch ? 'torch novo' : m ? `${m.pacotes.length} ${m.pacotes.length === 1 ? 'pacote' : 'pacotes'}` : null
  return (
    <>
      <p className="text-[13px] text-ink" title={m?.pacotes.join('\n') || undefined}>
        O motor precisa de uma atualizacao ({tamanhoDoBotao(estado)}).
      </p>
      {oQue && <p className="text-[11px] text-ink-3">{oQue}. O resto fica.</p>}
      {estado.erro && (
        <p className="select-text text-[11px] text-danger" title={estado.erro.detalhe}>
          {estado.erro.mensagem}
        </p>
      )}
      <Detalhes estado={estado} trocarPasta={false} />
      <ErroDoPedido />
      <Rodape>
        <Botao principal foco="motor-principal" onClick={() => void instalar()}>
          Atualizar motor
        </Botao>
        <Botao onClick={agoraNao}>Agora nao</Botao>
      </Rodape>
    </>
  )
}

function Pronto({ estado }: { estado: EstadoDoMotorRuntime }) {
  const { fechar } = useMotorRuntime.getState()
  const pendente = useMotorRuntime((s) => s.pendente)
  return (
    <>
      <p className="flex items-center gap-2 text-[13px] text-ink">
        <Check size={14} strokeWidth={2} className="shrink-0 text-accent" />
        Motor pronto · {textoDaPlaca(estado)}
      </p>
      {pendente && <p className="text-[11px] text-ink-3">Continuando o que estava esperando...</p>}
      <Rodape>
        <Botao foco="motor-fechar" onClick={fechar}>
          Fechar
        </Botao>
      </Rodape>
    </>
  )
}

/**
 * "Motor atualizado: 3 pacotes": o aviso de uma linha da atualizacao
 * automatica (so pacotes, ao abrir o app), no canto, por alguns segundos.
 */
function AvisoDoMotor() {
  const aviso = useMotorRuntime((s) => s.estado?.aviso ?? null)
  const [visivel, setVisivel] = useState<string | null>(null)
  const visto = useRef<string | null>(null)
  useEffect(() => {
    if (!aviso || aviso === visto.current) return
    visto.current = aviso
    setVisivel(aviso)
    const t = setTimeout(() => setVisivel(null), 8000)
    return () => clearTimeout(t)
  }, [aviso])
  if (!visivel) return null
  return createPortal(
    <div className="pointer-events-none fixed bottom-10 right-4 z-[47]">
      <span className="enter pointer-events-auto flex items-center gap-2 rounded-sm border border-line bg-elevated px-3 py-1.5 text-[12px] text-ink-2">
        <Check size={12} strokeWidth={2} className="text-accent" />
        {visivel}
      </span>
    </div>,
    document.body,
  )
}
