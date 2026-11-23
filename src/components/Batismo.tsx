import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, ChevronDown, Link2, Sparkles, Users } from 'lucide-react'
import type { BatismoDoMotor, GrupoDoBatismo } from '@shared/ancut'
import { useCortar } from '@/store/cortar-episodios'

/**
 * O BATISMO (23/11, o Modo Descoberta do AnCut dentro do Dangai): o motor
 * agrupou os rostos do episodio em "personagens sem nome"; aqui ele da o nome
 * de cada um. Grupo sem nome e ignorado (figurante). Dois grupos com o MESMO
 * nome viram um so -- e assim que se junta o personagem que o agrupamento
 * partiu em dois. Cada recorte pode ser desmarcado: sao as imagens que viram
 * referencia, e um rosto alheio no grupo atrapalharia os proximos episodios.
 *
 * Como no AnCut: os ja conhecidos (batizados em outro episodio) chegam com
 * nome numa secao fechada; os figurantes ficam atras de um botao; a janela
 * nao fecha num clique torto (pode haver vinte nomes digitados).
 */

const LEMBRAR_REFORCO = 'dangai.batismo.reforcar'

export function Batismo() {
  const aberto = useCortar((s) => s.batismo)
  if (!aberto) return null
  return createPortal(<Janela key={aberto.itemId} batismo={aberto.batismo} />, document.body)
}

/** Minusculas e sem acento: "Ichigo" acha "Kurosaki, Ichigo", "joao" acha "João". */
function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function Janela({ batismo }: { batismo: BatismoDoMotor }) {
  const [nomes, setNomes] = useState<Record<number, string>>(() =>
    Object.fromEntries(batismo.grupos.map((g) => [g.chave, g.conhecido ? g.sugestao : ''])),
  )
  const [removidos, setRemovidos] = useState<Record<number, Set<number>>>({})
  const [verConhecidos, setVerConhecidos] = useState(false)
  const [verFigurantes, setVerFigurantes] = useState(false)
  const [confirmarSaida, setConfirmarSaida] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [reforcar, setReforcar] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LEMBRAR_REFORCO) !== 'nao'
    } catch {
      return true
    }
  })

  const conhecidos = useMemo(() => batismo.grupos.filter((g) => g.conhecido), [batismo.grupos])
  const principais = useMemo(() => batismo.grupos.filter((g) => !g.conhecido && !g.figurante), [batismo.grupos])
  const figurantes = useMemo(() => batismo.grupos.filter((g) => !g.conhecido && g.figurante), [batismo.grupos])
  const nomeados = Object.values(nomes).filter((n) => n.trim()).length

  /** Quantos grupos cada nome tem (o aviso "junta com outro"). */
  const repetidos = useMemo(() => {
    const conta = new Map<string, number>()
    for (const v of Object.values(nomes)) {
      const k = v.trim().toLowerCase()
      if (k) conta.set(k, (conta.get(k) ?? 0) + 1)
    }
    return conta
  }, [nomes])

  const fotoDe = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of batismo.fotos) if (f.foto) m.set(f.nome.toLowerCase(), f.foto)
    return m
  }, [batismo.fotos])

  const alternarRecorte = (chave: number, i: number): void =>
    setRemovidos((antes) => {
      const set = new Set(antes[chave] ?? [])
      if (set.has(i)) set.delete(i)
      else set.add(i)
      return { ...antes, [chave]: set }
    })

  const salvar = (): void => {
    setEnviando(true)
    try {
      localStorage.setItem(LEMBRAR_REFORCO, reforcar ? 'sim' : 'nao')
    } catch {
      /* so a lembranca */
    }
    void useCortar.getState().responderBatismo(
      {
        nomes,
        removidos: Object.fromEntries(
          Object.entries(removidos)
            .map(([k, v]): [number, number[]] => [Number(k), [...v]])
            .filter(([, v]) => v.length > 0),
        ),
      },
      reforcar,
    )
  }

  const linha = (g: GrupoDoBatismo) => (
    <Grupo
      key={g.chave}
      grupo={g}
      batismo={batismo}
      fotoDe={fotoDe}
      valor={nomes[g.chave] ?? ''}
      removidos={removidos[g.chave] ?? new Set()}
      juntaCom={(repetidos.get((nomes[g.chave] ?? '').trim().toLowerCase()) ?? 0) > 1}
      aoNomear={(v) => setNomes((p) => ({ ...p, [g.chave]: v }))}
      aoRecorte={(i) => alternarRecorte(g.chave, i)}
    />
  )

  const titulo = batismo.temporada || batismo.episodio ? `${batismo.anime} · S${String(batismo.temporada).padStart(2, '0')}E${String(batismo.episodio).padStart(2, '0')}` : batismo.anime

  return (
    <div className="fixed inset-0 z-[45] grid place-items-center bg-black/65 p-6">
      <div role="dialog" aria-label="Dar nome aos personagens" style={{ backgroundColor: 'var(--color-elevated)' }} className="glass enter flex max-h-[94vh] w-[min(920px,96vw)] flex-col overflow-hidden rounded-lg" data-batismo="janela">
        <header className="flex shrink-0 flex-col gap-1 border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink">Dê o nome dos personagens</h2>
          <p className="text-[12px] leading-relaxed text-ink-3">
            {titulo}. {conhecidos.length > 0 && `${conhecidos.length} já ${conhecidos.length === 1 ? 'conhecido' : 'conhecidos'} de outros episódios. `}
            {principais.length} {principais.length === 1 ? 'grupo novo' : 'grupos novos'} para batizar: deixe em branco para ignorar.{' '}
            <span className="text-ink-2">Dois grupos com o mesmo nome viram um só.</span> Clique num recorte para ele <span className="text-ink-2">não</span> virar
            foto do personagem.
          </p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-4">
          {conhecidos.length > 0 && (
            <div className="rounded-md border border-accent/30 bg-accent-dim/20">
              <button
                type="button"
                onClick={() => setVerConhecidos((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-accent-dim/30"
              >
                <CheckCircle2 size={14} strokeWidth={1.75} className="shrink-0 text-accent" />
                <span className="font-medium text-ink">
                  {conhecidos.length} já {conhecidos.length === 1 ? 'conhecido' : 'conhecidos'}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-3">{conhecidos.map((g) => (nomes[g.chave] ?? '').trim() || '(sem nome)').join(', ')}</span>
                <span className="shrink-0 text-[11px] text-ink-3">{verConhecidos ? 'Fechar' : 'Revisar'}</span>
                <ChevronDown size={13} className={['shrink-0 text-ink-3 transition-transform', verConhecidos ? 'rotate-180' : ''].join(' ')} />
              </button>
              {verConhecidos && <div className="flex flex-col gap-2.5 border-t border-accent/20 p-2.5">{conhecidos.map(linha)}</div>}
            </div>
          )}

          {principais.map(linha)}

          {figurantes.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setVerFigurantes((v) => !v)}
                className="flex items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2 text-[12px] text-ink-3 transition-colors hover:text-ink"
              >
                <ChevronDown size={13} className={['transition-transform', verFigurantes ? 'rotate-180' : ''].join(' ')} />
                {verFigurantes ? 'Esconder' : 'Mostrar'} {figurantes.length} {figurantes.length === 1 ? 'grupo pequeno' : 'grupos pequenos'}
                <span className="text-ink-3/70">— figurante de fundo, ou mais nuca e cabelo do que rosto</span>
              </button>
              {verFigurantes && figurantes.map(linha)}
            </>
          )}

          {principais.length === 0 && !verFigurantes && (
            <p className="py-8 text-center text-[12px] text-ink-3">
              {conhecidos.length > 0
                ? 'Nenhum personagem novo neste episódio: só os já conhecidos acima.'
                : 'Nenhum grupo com cenas suficientes. Abra os grupos pequenos se quiser batizar mesmo assim.'}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-5 py-3">
          {confirmarSaida ? (
            <>
              <span className="mr-auto text-[12px] text-danger">Desistir do batismo? Os {nomeados} nomes se perdem (as cenas cortadas ficam).</span>
              <button type="button" onClick={() => setConfirmarSaida(false)} className="h-8 rounded-sm border border-line bg-elevated px-4 text-[12px] text-ink-2 hover:text-ink">
                Voltar
              </button>
              <button type="button" onClick={() => useCortar.getState().desistirDoBatismo()} className="h-8 rounded-sm bg-danger px-4 text-[12px] font-semibold text-white hover:opacity-90">
                Desistir
              </button>
            </>
          ) : (
            <>
              <span className="text-[12px] text-ink-3">
                {nomeados} {nomeados === 1 ? 'nomeado' : 'nomeados'}
              </span>
              <label
                className="mr-auto flex cursor-pointer items-center gap-1.5 pl-2 text-[12px] text-ink-3 hover:text-ink"
                title="Quando o corte terminar, os rostos mais confiáveis deste episódio viram foto do elenco: o reconhecimento dos próximos fica melhor. Só acrescenta, nunca apaga."
              >
                <input type="checkbox" checked={reforcar} disabled={enviando} onChange={(e) => setReforcar(e.target.checked)} className="accent-[var(--color-accent)]" />
                Reforçar as fotos ao terminar
              </label>
              <button
                type="button"
                onClick={() => (nomeados > 0 ? setConfirmarSaida(true) : useCortar.getState().desistirDoBatismo())}
                disabled={enviando}
                className="h-8 rounded-sm border border-line bg-elevated px-4 text-[12px] text-ink-2 hover:text-ink disabled:opacity-40"
              >
                Desistir
              </button>
              <button
                type="button"
                onClick={salvar}
                disabled={enviando || nomeados === 0}
                title={nomeados === 0 ? 'Dê nome a pelo menos um grupo.' : undefined}
                className="h-8 rounded-sm bg-accent px-5 text-[12px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
                data-batismo="salvar"
              >
                {enviando ? 'Salvando…' : nomeados === 0 ? 'Dê nome a pelo menos um' : `Salvar ${nomeados} ${nomeados === 1 ? 'personagem' : 'personagens'}`}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

function Grupo({
  grupo,
  batismo,
  fotoDe,
  valor,
  removidos,
  juntaCom,
  aoNomear,
  aoRecorte,
}: {
  grupo: GrupoDoBatismo
  batismo: BatismoDoMotor
  fotoDe: Map<string, string>
  valor: string
  removidos: Set<number>
  juntaCom: boolean
  aoNomear: (v: string) => void
  aoRecorte: (i: number) => void
}) {
  const nomeado = valor.trim().length > 0
  const [galeria, setGaleria] = useState(false)
  const [digitou, setDigitou] = useState(false)
  const fechar = useRef<number | null>(null)
  const temFotos = batismo.fotos.some((f) => f.foto)
  const filtro = normalizar(valor.trim())
  /** A galeria acompanha o que esta sendo digitado: primeiro quem tem uma palavra comecando assim. */
  const visiveis = useMemo(() => {
    if (!digitou || !filtro) return batismo.fotos
    const comeca: typeof batismo.fotos = []
    const contem: typeof batismo.fotos = []
    for (const f of batismo.fotos) {
      const n = normalizar(f.nome)
      if (n.startsWith(filtro) || n.split(/[\s,.'-]+/).some((p) => p.startsWith(filtro))) comeca.push(f)
      else if (n.includes(filtro)) contem.push(f)
    }
    return [...comeca, ...contem]
  }, [batismo.fotos, digitou, filtro])
  const filtrando = digitou && filtro !== ''
  const lista = `elenco-${grupo.chave}`

  return (
    <div className={['rounded-md border p-3 transition-colors', nomeado ? 'border-accent/40 bg-accent-dim/20' : 'border-line bg-surface'].join(' ')} data-batismo="grupo">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <Users size={13} strokeWidth={1.5} />
          {grupo.cenas} {grupo.cenas === 1 ? 'cena' : 'cenas'} · {grupo.rostos} rostos
        </span>
        {juntaCom && (
          <span className="flex items-center gap-1 rounded-sm border border-accent/40 bg-accent-dim px-2 py-0.5 text-[11px] font-medium text-accent" title="Outro grupo tem este mesmo nome: os dois viram um personagem só.">
            <Link2 size={11} />
            junta com outro grupo
          </span>
        )}
        <span className="flex-1" />
        {grupo.palpites.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {grupo.palpites.map((p, i) => {
              const foto = fotoDe.get(p.nome.toLowerCase())
              const escolhido = valor.trim().toLowerCase() === p.nome.toLowerCase()
              return (
                <button
                  key={p.nome}
                  type="button"
                  onClick={() => aoNomear(p.nome)}
                  title={`${p.nome} — semelhança ${p.semelhanca.toFixed(2)}`}
                  className={[
                    'flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-[11px] font-medium transition-colors',
                    escolhido
                      ? 'border-accent bg-accent-dim text-ink'
                      : i === 0
                        ? 'border-accent/50 text-accent hover:bg-accent-dim'
                        : 'border-line text-ink-3 hover:text-ink',
                  ].join(' ')}
                >
                  {foto ? <img src={foto} alt="" className="size-6 rounded-full object-cover" /> : <Sparkles size={11} className="ml-1" />}
                  {p.nome}
                </button>
              )
            })}
          </div>
        ) : (
          grupo.sugestao &&
          !grupo.conhecido && (
            <button
              type="button"
              onClick={() => aoNomear(grupo.sugestao)}
              title={`Semelhança ${grupo.semelhanca.toFixed(2)}`}
              className="flex items-center gap-1 rounded-sm border border-accent/40 px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent-dim"
            >
              <Sparkles size={11} />
              parece {grupo.sugestao}
            </button>
          )
        )}
      </div>

      <div className="mt-2 flex gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {grupo.recortes.map((url, i) => {
            const fora = removidos.has(i)
            return (
              <button
                key={`${url}-${i}`}
                type="button"
                onClick={() => aoRecorte(i)}
                title={fora ? 'Voltar a usar como foto do personagem' : 'Não usar como foto do personagem'}
                className={['size-14 shrink-0 overflow-hidden rounded border transition-all', fora ? 'border-danger/60 opacity-30 grayscale' : 'border-line hover:border-accent'].join(' ')}
              >
                {url && <img src={url} alt="" loading="lazy" className="size-full object-cover" />}
              </button>
            )
          })}
        </div>

        <div className="relative w-56 shrink-0">
          <input
            value={valor}
            onChange={(e) => {
              aoNomear(e.target.value)
              setDigitou(true)
              if (temFotos) setGaleria(true)
            }}
            onFocus={() => {
              if (fechar.current) window.clearTimeout(fechar.current)
              setDigitou(false)
              if (temFotos) setGaleria(true)
            }}
            onBlur={() => {
              fechar.current = window.setTimeout(() => setGaleria(false), 150)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setGaleria(false)
              if (e.key === 'Enter' && galeria && filtrando && visiveis.length > 0) {
                e.preventDefault()
                aoNomear(visiveis[0]!.nome)
                setGaleria(false)
              }
            }}
            list={!temFotos && batismo.elenco.length > 0 ? lista : undefined}
            placeholder={temFotos ? 'Nome, ou escolha pela foto' : 'Nome (vazio = ignorar)'}
            aria-label="Nome do personagem"
            className="h-8 w-full rounded-sm border border-line bg-elevated px-2.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          {galeria && filtrando && visiveis.length === 0 && (
            <p className="absolute right-0 top-full z-10 mt-1 w-[22rem] rounded-md border border-line bg-elevated px-3 py-2 text-[11px] text-ink-3 shadow-lg">
              Ninguém do elenco com “{valor.trim()}”: o nome digitado vale assim mesmo.
            </p>
          )}
          {galeria && visiveis.length > 0 && (
            <div className="absolute right-0 top-full z-10 mt-1 grid max-h-72 w-[22rem] grid-cols-4 gap-1.5 overflow-y-auto rounded-md border border-line bg-elevated p-2 shadow-lg">
              {visiveis.map((f, i) => (
                <button
                  key={f.nome}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    aoNomear(f.nome)
                    setGaleria(false)
                  }}
                  title={f.nome}
                  className={[
                    'flex flex-col items-center gap-1 rounded p-1 text-[10px] leading-tight text-ink-3 transition-colors hover:bg-surface hover:text-ink',
                    filtrando && i === 0 ? 'bg-accent-dim text-ink ring-1 ring-accent/60' : '',
                  ].join(' ')}
                >
                  {f.foto ? (
                    <img src={f.foto} alt="" loading="lazy" className="size-14 rounded object-cover" />
                  ) : (
                    <span className="grid size-14 place-items-center rounded bg-surface text-[10px]">sem foto</span>
                  )}
                  <span className="line-clamp-2 w-full text-center">{f.nome}</span>
                </button>
              ))}
            </div>
          )}
          {batismo.elenco.length > 0 && (
            <datalist id={lista}>
              {batismo.elenco.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          )}
        </div>
      </div>
    </div>
  )
}
