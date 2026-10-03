import { useEffect, useState } from 'react'
import { Plus, RotateCcw, X } from 'lucide-react'
import {
  ACOES,
  comboDoEvento,
  rotuloDoCombo,
  useAtalhos,
  type Acao,
} from '@/store/atalhos'

/**
 * A lista dos atalhos, cada um trocavel.
 *
 * O "+" grava a proxima tecla apertada. Uma combinacao so pode ser de uma acao:
 * gravar o X em "Excluir" tira o X de quem o tinha, e a tela DIZ de quem tirou
 * -- sem o aviso, o atalho antigo sumiria sem explicacao.
 */
export function Atalhos() {
  const mapa = useAtalhos((s) => s.mapa)
  const definir = useAtalhos((s) => s.definir)
  const restaurar = useAtalhos((s) => s.restaurar)
  const [gravando, setGravando] = useState<Acao | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    if (gravando === null) return
    /*
     * Na CAPTURA e parando tudo: enquanto grava, nenhuma tecla pode chegar ao
     * Esc das configuracoes nem aos atalhos do app -- gravar o espaco nao pode
     * dar play, e gravar o Esc... nao grava: o Esc cancela.
     */
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Escape') {
        setGravando(null)
        return
      }
      const combo = comboDoEvento(event)
      if (!combo) return
      const dono = ACOES.find((a) => a.id !== gravando && mapa[a.id].includes(combo))
      definir(gravando, [...mapa[gravando].filter((c) => c !== combo), combo])
      setAviso(dono ? `${rotuloDoCombo(combo)} saiu de "${dono.nome}".` : null)
      setGravando(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [gravando, mapa, definir])

  const grupos = [...new Set(ACOES.map((a) => a.grupo))]

  return (
    <div className="flex flex-col gap-3">
      {grupos.map((grupo) => (
        <section key={grupo} className="flex flex-col gap-0.5">
          <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">{grupo}</h3>
          {ACOES.filter((a) => a.grupo === grupo).map((a) => (
            <div key={a.id} className="flex min-h-7 items-center gap-2 rounded-sm px-1 hover:bg-elevated/60">
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{a.nome}</span>
              <div className="flex flex-wrap items-center justify-end gap-1">
                {mapa[a.id].map((combo) => (
                  <span
                    key={combo}
                    className="group/combo flex h-6 items-center gap-1 rounded-sm border border-line bg-elevated pl-2 pr-1 font-mono text-[11px] text-ink"
                  >
                    {rotuloDoCombo(combo)}
                    <button
                      type="button"
                      onClick={() => definir(a.id, mapa[a.id].filter((c) => c !== combo))}
                      aria-label={`Tirar ${rotuloDoCombo(combo)} de ${a.nome}`}
                      title="Tirar este atalho"
                      className="grid size-4 place-items-center rounded-sm text-ink-3 opacity-0 hover:text-danger group-hover/combo:opacity-100"
                    >
                      <X size={10} strokeWidth={2} />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setAviso(null)
                    setGravando(gravando === a.id ? null : a.id)
                  }}
                  aria-label={`Gravar um atalho para ${a.nome}`}
                  title="Gravar um atalho: clique e aperte as teclas (Esc cancela)"
                  className={[
                    'flex h-6 items-center gap-1 rounded-sm border px-1.5 text-[11px]',
                    gravando === a.id
                      ? 'border-accent bg-accent-dim text-ink'
                      : 'border-dashed border-line text-ink-3 hover:text-ink',
                  ].join(' ')}
                >
                  {gravando === a.id ? 'Aperte as teclas...' : <Plus size={11} strokeWidth={1.75} />}
                </button>
              </div>
            </div>
          ))}
        </section>
      ))}

      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-[11px] text-accent">{aviso}</span>
        <button
          type="button"
          onClick={() => {
            restaurar()
            setAviso(null)
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] text-ink-3 hover:text-ink-2"
        >
          <RotateCcw size={11} strokeWidth={1.5} />
          Voltar aos atalhos de fabrica
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-3">
        Tecla solta (sem Ctrl) nao dispara com o cursor num campo de texto: ali ela e so uma letra.
      </p>
    </div>
  )
}
