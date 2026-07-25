import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { PublicSettings } from '@shared/channels'
import { useProject } from '@/store/project'

/**
 * Um campo que importa: a chave da API. O resto e escolha rara.
 *
 * A chave nunca volta do main por inteiro -- so um hint com os quatro ultimos
 * caracteres, o suficiente para reconhecer qual chave esta salva.
 */
export function Settings() {
  const open = useProject((s) => s.settingsOpen)
  const openSettings = useProject((s) => s.openSettings)
  const analyze = useProject((s) => s.analyze)

  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setKeyInput('')
    void window.dangai.getSettings().then((result) => {
      if (result.ok) setSettings(result.value)
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        openSettings(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openSettings])

  if (!open) return null

  const save = async (patch: Parameters<typeof window.dangai.saveSettings>[0]) => {
    setSaving(true)
    const result = await window.dangai.saveSettings(patch)
    if (result.ok) setSettings(result.value)
    setSaving(false)
    return result.ok
  }

  const saveKey = async () => {
    const trimmed = keyInput.trim()
    if (trimmed.length === 0) return
    if (await save({ anthropicApiKey: trimmed })) {
      setKeyInput('')
      // Com chave nova, refaz o plano: o usuario acabou de habilitar a IA.
      void analyze()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6"
      onPointerDown={() => openSettings(false)}
    >
      <div
        onPointerDown={(event) => event.stopPropagation()}
        className="glass enter w-full max-w-[440px] rounded-lg p-5"
      >
        <header className="mb-5 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Configuracoes</h2>
          <button
            type="button"
            onClick={() => openSettings(false)}
            aria-label="Fechar"
            className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </header>

        <label className="mb-1.5 block text-[11px] font-medium text-ink-2">
          Chave da API da Anthropic
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveKey()
              event.stopPropagation()
            }}
            placeholder={settings?.hasApiKey ? settings.apiKeyHint : 'sk-ant-...'}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 select-text rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void saveKey()}
            disabled={saving || keyInput.trim().length === 0}
            className="lift shrink-0 rounded-sm border border-line bg-elevated px-3 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40"
          >
            Salvar
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Fica so nesta maquina. Sem ela, as cenas sao distribuidas pelas pausas da narracao.
        </p>

        <div className="my-5 h-px bg-line" />

        <label className="mb-1.5 block text-[11px] font-medium text-ink-2">Modelo do Whisper</label>
        <div className="flex gap-1.5">
          {(['base', 'small', 'medium'] as const).map((model) => (
            <button
              key={model}
              type="button"
              onClick={() => void save({ whisperModel: model })}
              className={[
                'lift flex-1 rounded-sm border px-2 py-1.5 text-[13px]',
                settings?.whisperModel === model
                  ? 'border-accent bg-accent-dim text-ink'
                  : 'border-line bg-elevated text-ink-2',
              ].join(' ')}
            >
              {model}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Baixado uma vez na primeira transcricao. Maior transcreve melhor e mais devagar.
        </p>
      </div>
    </div>
  )
}
