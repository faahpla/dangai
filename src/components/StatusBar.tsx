import {
  Loader2,
  Settings2,
  Sparkles,
  AudioWaveform,
  Rows3,
  Pilcrow,
  Download,
} from 'lucide-react'
import { useProject } from '@/store/project'
import type { PlanOrigin } from '@shared/contract'

interface StatusBarProps {
  isDragging: boolean
}

/**
 * Barra inferior discreta. Carrega o feedback de progresso, o erro e a origem
 * do plano -- nenhum estado de carregamento fica sem sinal visivel. Erro e
 * texto vermelho discreto, e nada mais.
 *
 * Sem animacao de opacidade aqui: a barra e o unico canal de feedback do app, e
 * ela nao pode ficar invisivel se um frame engasgar.
 */
export function StatusBar({ isDragging }: StatusBarProps) {
  const busy = useProject((s) => s.busy)
  const error = useProject((s) => s.error)
  const audio = useProject((s) => s.audio)
  const lastOutput = useProject((s) => s.lastOutput)
  const planOrigin = useProject((s) => s.planOrigin)
  const aiNote = useProject((s) => s.aiNote)
  const scriptNote = useProject((s) => s.scriptNote)
  const dismissError = useProject((s) => s.dismissError)
  const openSettings = useProject((s) => s.openSettings)
  const openScript = useProject((s) => s.openScript)
  const appVersion = useProject((s) => s.appVersion)

  // So o nome do arquivo: o caminho inteiro e ruido, e o botao "Abrir pasta"
  // esta a um clique de distancia.
  const idleMessage = isDragging
    ? 'Solte para importar'
    : lastOutput
      ? `Renderizado · ${lastOutput.split(/[\\/]/).pop()}`
      : (audio?.fileName ?? 'Solte a narracao e as prints')

  return (
    <footer className="flex h-[38px] shrink-0 items-center justify-between gap-4 border-t border-line px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {busy ? (
          <span className="flex items-center gap-2 text-[11px] text-ink-2">
            <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
            {busy}
          </span>
        ) : error ? (
          <button
            type="button"
            onClick={dismissError}
            className="truncate text-left text-[11px] text-danger"
            title={error}
          >
            {error}
          </button>
        ) : (
          <span className="truncate text-[11px] text-ink-3">{idleMessage}</span>
        )}
      </div>

      {!busy && scriptNote && (
        <button
          type="button"
          onClick={() => openScript(true)}
          className="max-w-[340px] shrink-0 truncate text-[11px] text-ink-3 hover:text-ink-2"
          title={scriptNote}
        >
          {scriptNote}
        </button>
      )}

      {!busy && planOrigin && <PlanBadge origin={planOrigin} note={aiNote} />}

      <UpdateBadge />

      {appVersion && (
        <span className="tnum shrink-0 text-[11px] text-ink-3" title="Versao instalada">
          v{appVersion}
        </span>
      )}

      <button
        type="button"
        onClick={() => openSettings(true)}
        aria-label="Configuracoes"
        title="Configuracoes (Ctrl+,)"
        className="grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
      >
        <Settings2 size={13} strokeWidth={1.5} />
      </button>
    </footer>
  )
}

/**
 * Atualizacao do app, discreta.
 *
 * Enquanto baixa, e so uma nota; quando esta pronta, vira um botao. Reiniciar e
 * decisao do usuario -- trocar de versao no meio de um render de um minuto
 * seria pior que ficar uma versao atras.
 *
 * "Tudo em dia" nao aparece: informacao que nunca muda nada vira ruido.
 */
function UpdateBadge() {
  const update = useProject((s) => s.update)
  const rendering = useProject((s) => s.render !== null)

  if (!update || update.state === 'atual' || update.state === 'erro') return null

  if (update.state === 'baixando') {
    return (
      <span className="tnum flex shrink-0 items-center gap-1.5 text-[11px] text-ink-3">
        <Download size={12} strokeWidth={1.5} />
        Baixando atualizacao {Math.round(update.percent * 100)}%
      </span>
    )
  }

  return (
    <button
      type="button"
      disabled={rendering}
      onClick={() => void window.dangai.installUpdate()}
      title={rendering ? 'Termine o render primeiro' : `Instala a ${update.version} e reabre o app`}
      className="flex shrink-0 items-center gap-1.5 rounded-sm border border-accent bg-accent-dim px-2 py-0.5 text-[11px] text-ink disabled:opacity-40"
    >
      <Download size={12} strokeWidth={1.5} className="text-accent" />
      Atualizar para {update.version}
    </button>
  )
}

/**
 * De onde veio a distribuicao das cenas. O usuario precisa saber se a IA
 * participou ou se o app caiu no determinístico -- sem isso, um plano pior
 * chega sem explicacao.
 */
function PlanBadge({ origin, note }: { origin: PlanOrigin; note: string | null }) {
  const config: Record<PlanOrigin, { icon: typeof Sparkles; label: string }> = {
    ai: { icon: Sparkles, label: 'Cenas pela IA' },
    rhythm: { icon: Pilcrow, label: 'Cenas pela pontuacao' },
    silence: { icon: AudioWaveform, label: 'Cenas pelas pausas' },
    equal: { icon: Rows3, label: 'Cenas divididas igualmente' },
  }
  const { icon: Icon, label } = config[origin]

  return (
    <span
      className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-3"
      title={note ?? label}
    >
      <Icon size={12} strokeWidth={1.5} className={origin === 'ai' ? 'text-accent' : undefined} />
      {label}
    </span>
  )
}
