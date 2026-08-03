import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Captions as CaptionsIcon,
  FolderOpen,
  Play,
  Pause,
  RotateCcw,
  Settings2,
  Volume2,
  Film,
  FileText,
  Pencil,
  Save,
  FolderInput,
  ListVideo,
  Hash,
  Library as LibraryIcon,
  type LucideIcon,
} from 'lucide-react'
import { useProject } from '@/store/project'

interface Command {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  disabled?: boolean
  run: () => void
}

/**
 * Ctrl+K. Tudo que o app faz alcancavel sem tirar a mao do teclado.
 *
 * Nao e uma feature extra: e o que permite a interface ficar limpa. Cada acao
 * que vive aqui e uma que nao precisa de botao permanente na tela.
 */
export function CommandPalette() {
  const open = useProject((s) => s.paletteOpen)
  const openPalette = useProject((s) => s.openPalette)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const commands = useCommands()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return commands
    // Busca por subsequencia: "rnd" acha "Renderizar".
    return commands.filter((command) => {
      const label = command.label.toLowerCase()
      let index = 0
      for (const char of q) {
        index = label.indexOf(char, index)
        if (index === -1) return false
        index++
      }
      return true
    })
  }, [commands, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    // O foco tem que ir para o campo, senao as setas rolam a pagina atras.
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(filtered.length - 1, 0)))
  }, [filtered.length])

  if (!open) return null

  const run = (command: Command | undefined): void => {
    if (!command || command.disabled) return
    openPalette(false)
    command.run()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-[18vh]"
      onPointerDown={() => openPalette(false)}
    >
      <div
        onPointerDown={(event) => event.stopPropagation()}
        className="glass enter w-full max-w-[520px] overflow-hidden rounded-lg"
      >
        <input
          ref={inputRef}
          value={query}
          spellCheck={false}
          placeholder="O que voce quer fazer?"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') {
              event.preventDefault()
              openPalette(false)
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setCursor((c) => Math.min(c + 1, filtered.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              run(filtered[cursor])
            }
          }}
          className="w-full select-text border-b border-line bg-transparent px-4 py-3.5 text-[15px] text-ink placeholder:text-ink-3 focus:outline-none"
        />

        <ul className="max-h-[340px] overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-[11px] text-ink-3">Nada com esse nome.</li>
          )}
          {filtered.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                disabled={command.disabled}
                onPointerEnter={() => setCursor(index)}
                onClick={() => run(command)}
                className={[
                  'flex w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left text-[13px] transition-colors duration-100',
                  command.disabled ? 'text-ink-3 opacity-50' : 'text-ink-2',
                  index === cursor && !command.disabled ? 'bg-accent-dim text-ink' : '',
                ].join(' ')}
              >
                <command.icon
                  size={14}
                  strokeWidth={1.5}
                  className={index === cursor ? 'text-accent' : 'text-ink-3'}
                />
                <span className="flex-1 truncate">{command.label}</span>
                {command.hint && (
                  <span className="tnum shrink-0 text-[11px] text-ink-3">{command.hint}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function useCommands(): Command[] {
  const playing = useProject((s) => s.playing)
  const sfxEnabled = useProject((s) => s.sfxEnabled)
  const captionsEnabled = useProject((s) => s.captionsEnabled)
  const captionCount = useProject((s) => s.captions.length)
  const lastOutput = useProject((s) => s.lastOutput)
  const audio = useProject((s) => s.audio)
  const imageCount = useProject((s) => s.images.length)
  const sfxCount = useProject((s) =>
    s.plan && s.sfxFiles.length > 0 ? Math.ceil((s.plan.scenes.length - 1) / 2) : 0,
  )
  const rendering = useProject((s) => s.render !== null)
  const script = useProject((s) => s.script)
  const captionsOpen = useProject((s) => s.captionsOpen)
  const projectPath = useProject((s) => s.projectPath)
  const queueRunning = useProject((s) => s.queueRunning)
  const pendentes = useProject((s) => s.queue.filter((item) => item.status === 'pendente').length)
  const transcriptText = useProject((s) => s.transcript?.text ?? '')

  const pronto = Boolean(audio) && imageCount > 0
  const temTexto = (script?.trim().length ?? 0) >= 40 || transcriptText.trim().length >= 40

  return useMemo(() => {
    const store = useProject.getState
    return [
      {
        id: 'render',
        label: rendering ? 'Cancelar render' : 'Renderizar',
        hint: 'Ctrl R',
        icon: Film,
        disabled: !pronto,
        run: () => (rendering ? void store().cancelRender() : void store().startRender()),
      },
      {
        id: 'play',
        label: playing ? 'Pausar' : 'Reproduzir',
        hint: 'Espaco',
        icon: playing ? Pause : Play,
        disabled: !pronto || rendering,
        run: () => store().togglePlay(),
      },
      {
        id: 'library',
        label: 'Procurar cenas na biblioteca',
        hint: 'Ctrl+B',
        icon: LibraryIcon,
        run: () => void store().openLibrary(true),
      },
      {
        id: 'script',
        label: script ? 'Trocar o roteiro' : 'Colar o roteiro',
        hint: script ? 'carregado' : 'legendas sem erro de escrita',
        icon: FileText,
        run: () => store().openScript(true),
      },
      {
        id: 'edit-captions',
        label: captionsOpen ? 'Fechar o editor de legendas' : 'Mesclar e dividir legendas',
        hint: captionCount > 0 ? `${captionCount} blocos` : 'sem transcricao',
        icon: Pencil,
        disabled: captionCount === 0,
        run: () => store().openCaptions(!captionsOpen),
      },
      {
        id: 'captions',
        label: captionsEnabled ? 'Desligar legendas' : 'Ligar legendas',
        hint: captionCount > 0 ? `${captionCount} blocos` : 'sem transcricao',
        icon: CaptionsIcon,
        disabled: captionCount === 0,
        run: () => store().toggleCaptions(),
      },
      {
        id: 'sfx',
        label: sfxEnabled ? 'Mutar SFX' : 'Ativar SFX',
        hint: sfxCount > 0 ? `${sfxCount}` : 'nenhum',
        icon: Volume2,
        disabled: sfxCount === 0,
        run: () => store().toggleSfx(),
      },
      {
        id: 'save',
        label: 'Salvar projeto',
        // Sem arquivo ainda, o hint diz o que vai acontecer: abre o dialogo.
        hint: projectPath ? 'Ctrl S' : 'escolher onde',
        icon: Save,
        disabled: !pronto,
        run: () => void store().saveProject(),
      },
      // So aparece quando ha um arquivo do qual se separar. Sem projeto salvo
      // ele faria exatamente o mesmo que o de cima.
      ...(projectPath
        ? [
            {
              id: 'save-as',
              label: 'Salvar projeto como...',
              hint: 'Ctrl Shift S',
              icon: Save,
              run: () => void store().saveProject(true),
            },
          ]
        : []),
      {
        id: 'open',
        label: 'Abrir projeto',
        hint: 'Ctrl O',
        icon: FolderInput,
        disabled: rendering,
        run: () => void store().openProject(),
      },
      ...(pendentes > 0
        ? [
            {
              id: 'queue',
              label: queueRunning ? 'Parar a fila' : `Renderizar a fila`,
              hint: `${pendentes} na fila`,
              icon: ListVideo,
              run: () => (queueRunning ? store().stopQueue() : void store().runQueue()),
            },
          ]
        : []),
      {
        id: 'metadata',
        label: 'Escrever titulo, descricao e hashtags',
        hint: 'pelo roteiro',
        icon: Hash,
        disabled: !temTexto || rendering,
        run: () => void store().generateMetadata(),
      },
      {
        id: 'reveal',
        label: 'Abrir a pasta do video',
        icon: FolderOpen,
        disabled: lastOutput === null,
        run: () => {
          if (lastOutput) void window.dangai.revealFile(lastOutput)
        },
      },
      {
        id: 'settings',
        label: 'Configuracoes',
        hint: 'Ctrl ,',
        icon: Settings2,
        run: () => store().openSettings(true),
      },
      {
        id: 'reset',
        label: 'Limpar o projeto',
        icon: RotateCcw,
        disabled: !pronto,
        run: () => {
          store().reset()
          // Sem isto o proximo inicio ofereceria recuperar justamente o que o
          // usuario acabou de mandar limpar.
          void store().discardAutosave()
        },
      },
    ]
  }, [
    playing,
    sfxEnabled,
    captionsEnabled,
    captionCount,
    lastOutput,
    pronto,
    sfxCount,
    rendering,
    script,
    captionsOpen,
    projectPath,
    queueRunning,
    pendentes,
    temTexto,
  ])
}
