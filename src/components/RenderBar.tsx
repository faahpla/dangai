import {
  Play,
  Pause,
  FolderOpen,
  Volume2,
  VolumeX,
  Captions,
  CaptionsOff,
  FileText,
  Pencil,
} from 'lucide-react'
import { useProject } from '@/store/project'

/**
 * Transporte e acao. Um botao primario so -- renderizar, que vira cancelar
 * durante o render. O rosa mora no preenchimento da timeline nesse momento,
 * entao aqui o botao fica cinza.
 */
export function RenderBar() {
  const audio = useProject((s) => s.audio)
  const images = useProject((s) => s.images)
  const playing = useProject((s) => s.playing)
  const render = useProject((s) => s.render)
  const lastOutput = useProject((s) => s.lastOutput)
  const sfxEnabled = useProject((s) => s.sfxEnabled)
  const sfxCount = useProject((s) => s.plan?.sfxCues.length ?? 0)
  const toggleSfx = useProject((s) => s.toggleSfx)
  const captionsEnabled = useProject((s) => s.captionsEnabled)
  const captionCount = useProject((s) => s.captions.length)
  const toggleCaptions = useProject((s) => s.toggleCaptions)
  const script = useProject((s) => s.script)
  const openScript = useProject((s) => s.openScript)
  const captionsOpen = useProject((s) => s.captionsOpen)
  const openCaptions = useProject((s) => s.openCaptions)
  const togglePlay = useProject((s) => s.togglePlay)
  const startRender = useProject((s) => s.startRender)
  const cancelRender = useProject((s) => s.cancelRender)

  const isRendering = render !== null
  const canRender = Boolean(audio) && images.length > 0

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={togglePlay}
        disabled={!canRender || isRendering}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
        className="lift grid size-8 place-items-center rounded-sm border border-line bg-elevated text-ink-2 hover:text-ink disabled:opacity-40"
      >
        {playing ? <Pause size={14} strokeWidth={1.5} /> : <Play size={14} strokeWidth={1.5} />}
      </button>

      {!isRendering && (
        <button
          type="button"
          onClick={() => openScript(true)}
          title={
            script
              ? 'Roteiro carregado — o texto das legendas vem dele'
              : 'Cole o roteiro para as legendas sairem sem erro de escrita'
          }
          className={[
            'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
            script
              ? 'border-accent bg-accent-dim text-ink'
              : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
          ].join(' ')}
        >
          <FileText size={12} strokeWidth={1.5} />
          Roteiro
        </button>
      )}

      {captionCount > 0 && !isRendering && (
        <button
          type="button"
          onClick={() => openCaptions(!captionsOpen)}
          title="Mesclar e dividir legendas"
          className={[
            'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
            captionsOpen
              ? 'border-line-strong bg-elevated text-ink'
              : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
          ].join(' ')}
        >
          <Pencil size={12} strokeWidth={1.5} />
          Editar
        </button>
      )}

      {captionCount > 0 && !isRendering && (
        <button
          type="button"
          onClick={toggleCaptions}
          title={captionsEnabled ? 'Legendas queimadas no video' : 'Sem legendas'}
          className={[
            'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
            captionsEnabled
              ? 'border-accent bg-accent-dim text-ink'
              : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
          ].join(' ')}
        >
          {captionsEnabled ? (
            <Captions size={12} strokeWidth={1.5} />
          ) : (
            <CaptionsOff size={12} strokeWidth={1.5} />
          )}
          Legendas
        </button>
      )}

      {sfxCount > 0 && !isRendering && (
        <button
          type="button"
          onClick={toggleSfx}
          title={sfxEnabled ? `${sfxCount} SFX no video` : 'SFX mutados'}
          className={[
            'lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[11px]',
            sfxEnabled ? 'text-ink-2 hover:text-ink' : 'text-ink-3',
          ].join(' ')}
        >
          {sfxEnabled ? (
            <Volume2 size={12} strokeWidth={1.5} />
          ) : (
            <VolumeX size={12} strokeWidth={1.5} />
          )}
          <span className="tnum">{sfxCount} SFX</span>
        </button>
      )}

      {lastOutput && !isRendering && (
        <button
          type="button"
          onClick={() => void window.dangai.revealFile(lastOutput)}
          className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[11px] text-ink-2 hover:text-ink"
        >
          <FolderOpen size={12} strokeWidth={1.5} />
          Abrir pasta
        </button>
      )}

      <div className="flex-1" />

      {isRendering ? (
        <div className="flex items-center gap-3">
          <span className="tnum text-[11px] text-ink-2">
            {render.message ?? `${Math.round(render.progress * 100)}%`}
          </span>
          <button
            type="button"
            onClick={() => void cancelRender()}
            className="lift rounded-sm border border-line bg-elevated px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:text-ink"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void startRender()}
          disabled={!canRender}
          className="lift rounded-sm border border-line bg-elevated px-3.5 py-1.5 text-[13px] font-medium text-ink hover:bg-[#1d1d21] disabled:opacity-40"
        >
          Renderizar
        </button>
      )}
    </div>
  )
}
