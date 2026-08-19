import { useEffect, useRef } from 'react'
import { Loader2, Check } from 'lucide-react'
import { useProject } from '@/store/project'
import type { Word } from '@shared/contract'

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
  const transcript = useProject((s) => s.transcript)

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
              <Frase
                texto={bloco.text}
                palavras={transcript?.words ?? []}
                start={bloco.start}
                end={bloco.end}
                cenas={cenas.length}
                aberto={aberto}
              />
            </div>
          )
        })}
      </div>
    </Coluna>
  )
}

/**
 * O texto da frase pintado por cena.
 *
 * Cada cena cobre um trecho, e o trecho aparece: "A magia mais fraca do Rudeus"
 * e a cena 1, "gasta mais mana que a mais forte." e a cena 2. Foi o que ele
 * pediu -- ver ao vivo ate onde cada clipe vai ficar -- e da para fazer por
 * PALAVRA porque a transcricao ja traz o tempo de cada uma.
 *
 * Com uma cena so, ela cobre a frase inteira. Isso nao e um defeito da pintura:
 * e a divisao de verdade aparecendo, e e o aviso de que falta cena ali.
 */
function Frase({
  texto,
  palavras,
  start,
  end,
  cenas,
  aberto,
}: {
  texto: string
  palavras: readonly Word[]
  start: number
  end: number
  cenas: number
  aberto: boolean
}) {
  const cor = aberto ? 'text-ink' : 'text-ink-2'

  // Sem cena marcada nao ha o que repartir; sem palavra medida tambem nao.
  const daFrase = cenas > 0 ? palavras.filter((w) => w.start >= start && w.start < end) : []
  if (cenas === 0 || daFrase.length === 0) {
    return (
      <p className={['mt-1 text-[12px] leading-snug', aberto ? 'text-ink' : 'text-ink-3'].join(' ')}>
        {texto}
      </p>
    )
  }

  /*
   * Uma palavra pertence a cena que cobre o INSTANTE EM QUE ELA COMECA.
   *
   * Pelo comeco e nao pelo meio: e o comeco que o espectador ouve junto com o
   * corte, e uma palavra que atravessa a fronteira aparece pintada na cena em
   * que ela entrou -- que e onde ela vai ser vista.
   */
  const passo = (end - start) / cenas
  const trechos: Word[][] = Array.from({ length: cenas }, () => [])
  for (const palavra of daFrase) {
    const i = Math.min(cenas - 1, Math.max(0, Math.floor((palavra.start - start) / passo)))
    trechos[i]!.push(palavra)
  }

  return (
    <p className={['mt-1 text-[12px] leading-snug', cor].join(' ')}>
      {trechos.map((trecho, i) =>
        trecho.length === 0 ? null : (
          <span
            key={i}
            title={`Cena ${i + 1} · ${passo.toFixed(1)}s`}
            className={[
              'mr-1 box-decoration-clone rounded-[2px] px-1 py-[1px]',
              /*
                Uma cor so, alternando a forca -- rosa e a unica cor da interface
                por decisao dele. O que separa uma cena da outra e o contraste
                entre cheia e apagada, que funciona em qualquer numero de cenas
                sem inventar paleta nenhuma.
              */
              i % 2 === 0 ? 'bg-accent-dim text-ink' : 'bg-elevated text-ink-2',
            ].join(' ')}
          >
            {trecho.map((w) => w.text.trim()).join(' ')}
          </span>
        ),
      )}
    </p>
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
