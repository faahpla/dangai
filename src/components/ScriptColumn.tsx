import { useEffect, useRef } from 'react'
import { Loader2, Check } from 'lucide-react'
import { useProject } from '@/store/project'

/**
 * O roteiro dentro da Biblioteca, frase a frase.
 *
 * Existe porque escolher cena sem saber ONDE ela cai era escolher no escuro --
 * palavras dele, "hoje e meio aleatorio ne?!". A frase aberta recebe as cenas
 * que ele marcar na grade, e o contador diz na hora quanto cada uma vai durar.
 *
 * A frase e a unidade, e nao um bloco de tantos segundos: quantas cenas o
 * gancho tem e decisao dele. "Nessa parte eu usaria 3 cenas provavelmente".
 */
export function ScriptColumn() {
  const audio = useProject((s) => s.audio)
  const blocos = useProject((s) => s.scriptBlocks)
  const busy = useProject((s) => s.scriptBlocksBusy)
  const ativo = useProject((s) => s.activeBlock)
  const porBloco = useProject((s) => s.blockClips)
  const setAtivo = useProject((s) => s.setActiveBlock)
  const carregar = useProject((s) => s.loadScriptBlocks)

  const lista = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (audio) void carregar()
  }, [audio, carregar])

  // A frase aberta anda sozinha ao marcar cenas; sem isto ela sairia da vista.
  useEffect(() => {
    lista.current?.querySelector('[data-ativo="sim"]')?.scrollIntoView({ block: 'nearest' })
  }, [ativo])

  if (!audio) {
    return (
      <Coluna>
        <p className="p-4 text-[12px] leading-relaxed text-ink-3">
          Solte a narracao para ver o roteiro aqui e marcar as cenas de cada frase.
        </p>
      </Coluna>
    )
  }

  if (!blocos) {
    return (
      <Coluna>
        <p className="flex items-center gap-2 p-4 text-[12px] text-ink-3">
          <Loader2 size={13} strokeWidth={1.5} className="animate-spin text-accent" />
          {busy ?? 'Lendo o roteiro...'}
        </p>
      </Coluna>
    )
  }

  const marcadas = Object.values(porBloco).reduce((n, c) => n + c.length, 0)

  return (
    <Coluna>
      <header className="flex shrink-0 items-baseline justify-between border-b border-line px-4 py-2.5">
        <span className="text-[12px] font-medium text-ink">Roteiro</span>
        <span className="tnum text-[11px] text-ink-3">
          {blocos.length} frases · {marcadas} cenas
        </span>
      </header>

      <div ref={lista} className="min-h-0 flex-1 overflow-y-auto">
        {blocos.map((bloco, i) => {
          const cenas = porBloco[i] ?? []
          const dura = bloco.end - bloco.start
          const cada = cenas.length > 0 ? dura / cenas.length : dura
          const aberto = ativo === i

          return (
            <div
              key={i}
              role="button"
              tabIndex={0}
              data-ativo={aberto ? 'sim' : 'nao'}
              onClick={() => setAtivo(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setAtivo(i)
                }
              }}
              className={[
                'w-full cursor-pointer border-l-2 px-4 py-2.5 text-left transition-colors duration-150',
                aberto
                  ? 'border-l-accent bg-accent-dim'
                  : 'border-l-transparent hover:bg-elevated',
              ].join(' ')}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="tnum text-[10px] text-ink-3">
                  {tempo(bloco.start)} – {tempo(bloco.end)}
                </span>
                {cenas.length > 0 && (
                  <span
                    className="tnum flex items-center gap-1 text-[10px] text-accent"
                    /* O numero que ensina o ritmo: 4,2s numa cena so grita que
                       falta cena, sem eu ter que proibir nada. */
                    title={`${cenas.length} cenas dividindo ${dura.toFixed(1)}s`}
                  >
                    <Check size={10} strokeWidth={2} />
                    {cenas.length}× {cada.toFixed(1)}s
                  </span>
                )}
              </div>
              <p
                className={[
                  'mt-1 text-[12px] leading-snug',
                  aberto ? 'text-ink' : cenas.length > 0 ? 'text-ink-2' : 'text-ink-3',
                ].join(' ')}
              >
                {bloco.text}
              </p>
            </div>
          )
        })}
      </div>
    </Coluna>
  )
}

function Coluna({ children }: { children: React.ReactNode }) {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-line">{children}</aside>
  )
}

/**
 * Com decimo, sempre.
 *
 * Sem ele "E nao e teoria de fa." aparecia como 0:03 - 0:03, que se le como
 * duracao zero. A frase curta e justamente onde ele precisa ver o numero para
 * decidir se cabe uma cena ou nenhuma.
 */
function tempo(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}
