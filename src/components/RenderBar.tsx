import { Play, Pause, FolderOpen, Volume2, VolumeX } from 'lucide-react'
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
