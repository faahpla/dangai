import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Reorder, useDragControls } from 'motion/react'
import { ArrowUpDown, Check, Copy, GripVertical, Link2, LocateFixed, Lock, LockOpen, Merge, Pause, Play, Rows2, TriangleAlert, X } from 'lucide-react'
import type { Plano } from '../../shared/episodio'
import { nomeNatural } from '@shared/nomes'
import { ROTULO_DO_PAPEL, type Frase, type Roteiro } from '../../shared/roteiro'
import { palavrasDaFrase, type TakeDaVoz } from '../../shared/voz'
import {
  AVISO_TRECHO_SEM_CENAS,
  divididaPeloCasar,
  duracaoDaFrase,
  escolhaDaFrase,
  temGrid,
  temposDasCenas,
  trechosDoCandidato,
  type CenaDaFrase,
  type EscolhaDaFrase,
  type EstadoDasCenas,
} from '../../shared/cenas'
import { Segmentos } from '@/modulos/kit'
import { useCenas, type AvisosDaFrase } from '../store/gerar-cenas'
import type { PlanosDaTela } from './GradeDasCenas'
import { COR_DE_AVISO } from './pecas'

/**
 * O ROTEIRO NA TELA DE CENAS, frase a frase: a coluna da esquerda, como a
 * ScriptColumn da selecao do Dangai. Cada frase com a parte (Gancho,
 * Contexto...), o tempo dela na narracao, a(s) miniatura(s) da(s) cena(s), a
 * duracao REAL (do take aprovado) e os avisos (sem cena, repetida, emendada).
 *
 * A frase aberta mostra as cenas dela uma por linha, na ordem do video,
 * arrastaveis pela alca -- e, com duas ou mais, o texto pintado por cena com a
 * barrinha rosa entre elas: arrastar escolhe em que palavra a cena comeca.
 * Clicar numa linha escolhe qual cena o proximo clique da grade troca.
 *
 * Setas para cima e para baixo andam entre as frases (PassoDasCenas).
 */
export function FrasesDasCenas({
  roteiro,
  cenas,
  take,
  planos,
  avisos,
}: {
  roteiro: Roteiro
  cenas: EstadoDasCenas
  take: TakeDaVoz | null
  planos: PlanosDaTela
  avisos: ReadonlyMap<string, AvisosDaFrase>
}) {
  const fraseAtiva = useCenas((s) => s.fraseAtiva)
  const lista = useRef<HTMLDivElement>(null)
  const pedirMiniaturas = useCenas((s) => s.pedirMiniaturas)

  // A frase aberta anda com as setas: sem isto ela sairia da vista.
  useEffect(() => {
    lista.current?.querySelector('[data-ativa="sim"]')?.scrollIntoView({ block: 'nearest' })
  }, [fraseAtiva])

  // As miniaturas das cenas escolhidas (a coluna inteira, poucas dezenas).
  const escolhidas = useMemo(
    () => cenas.escolhas.flatMap((e) => e.cenas.flatMap((c) => [c.candidato.planoIds[0] ?? '', c.baixo?.planoIds[0] ?? ''])).filter(Boolean),
    [cenas],
  )
  useEffect(() => {
    if (escolhidas.length > 0) pedirMiniaturas(planos.episodioId, escolhidas)
  }, [escolhidas, planos.episodioId, pedirMiniaturas])

  const trechos = useMemo(() => new Map((take?.trechos ?? []).map((t) => [t.fraseId, t])), [take])
  const numeros = useMemo(() => {
    const mapa = new Map<string, number>()
    let n = 0
    for (const s of roteiro.secoes) for (const f of s.frases) mapa.set(f.id, ++n)
    return mapa
  }, [roteiro])

  let semCena = 0
  let total = 0
  for (const a of avisos.values()) if (a.semCena) semCena += 1
  for (const s of roteiro.secoes) for (const f of s.frases) total += duracaoDaFrase(f, take).duracao

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-r border-line">
      <header className="flex shrink-0 items-baseline justify-between border-b border-line px-4 py-2.5">
        <span className="text-[12px] font-medium text-ink">Roteiro</span>
        <span className="tnum text-[11px] text-ink-3">
          {numeros.size} frases · {total.toFixed(1)}s
          {semCena > 0 && (
            <span className="text-accent" title="Frases sem cena. Clique numa cena ao lado para dar uma.">
              {' '}
              · {semCena} sem cena
            </span>
          )}
        </span>
      </header>

      <div ref={lista} className="min-h-0 flex-1 overflow-y-auto">
        {roteiro.secoes.map((secao) => (
          <div key={secao.id} className="border-b border-line">
            <div className="px-4 pb-0.5 pt-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-ink-3">{ROTULO_DO_PAPEL[secao.papel]}</span>
            </div>
            {secao.frases.map((f) => (
              <LinhaDaFrase
                key={f.id}
                frase={f}
                numero={numeros.get(f.id) ?? 0}
                escolha={escolhaDaFrase(cenas, f.id)}
                take={take}
                inicio={trechos.get(f.id)?.offset ?? null}
                aberta={f.id === fraseAtiva}
                avisos={avisos.get(f.id) ?? null}
                planos={planos}
                numeros={numeros}
                cenas={cenas}
              />
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}

/** Com decimo, sempre (como a ScriptColumn): "0:03 - 0:03" se leria como duracao zero. */
function tempo(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}

const LinhaDaFrase = memo(function LinhaDaFrase({
  frase,
  numero,
  escolha,
  take,
  inicio,
  aberta,
  avisos,
  planos,
  numeros,
  cenas,
}: {
  frase: Frase
  numero: number
  escolha: EscolhaDaFrase | null
  take: TakeDaVoz | null
  /** Onde a frase comeca na narracao. null = sem trecho do take (estimada). */
  inicio: number | null
  aberta: boolean
  avisos: AvisosDaFrase | null
  planos: PlanosDaTela
  numeros: ReadonlyMap<string, number>
  cenas: EstadoDasCenas
}) {
  const escolherFrase = useCenas((s) => s.escolherFrase)
  const d = duracaoDaFrase(frase, take)
  const lista = escolha?.cenas ?? []
  const tempos = useMemo(() => (escolha ? temposDasCenas(escolha, frase, take) : []), [escolha, frase, take])

  /** Em que outra(s) frase(s) o mesmo trecho esta: o tooltip diz onde olhar. */
  const ondeRepete = useMemo(() => {
    if (!avisos || avisos.repetidaCom.length === 0) return ''
    return avisos.repetidaCom
      .map((id) => numeros.get(id) ?? 0)
      .sort((a, b) => a - b)
      .join(', ')
  }, [avisos, numeros])
  const semCenasNoIndice = escolha?.avisos.includes(AVISO_TRECHO_SEM_CENAS) ?? false

  return (
    <div
      role="button"
      tabIndex={0}
      data-ativa={aberta ? 'sim' : 'nao'}
      onClick={() => escolherFrase(frase.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          escolherFrase(frase.id)
        }
      }}
      className={[
        'group/frase w-full cursor-pointer border-l-2 py-2 pl-3.5 pr-3 text-left transition-colors duration-150',
        aberta ? 'border-l-accent bg-accent-dim' : 'border-l-transparent hover:bg-elevated',
      ].join(' ')}
    >
      <div className="flex gap-2.5">
        {!aberta && <Miniaturas cenas={lista} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="tnum text-[10px] text-ink-3"
              title={d.real ? 'Onde a frase cai na narracao' : 'Duracao estimada (sem trecho do take)'}
            >
              {numero}. {inicio !== null && d.real ? `${tempo(inicio)} – ${tempo(inicio + d.duracao)}` : `~${d.duracao.toFixed(1)}s`}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {semCenasNoIndice && (
                <span title="Trecho sem cenas no indice: a cena e a mais perto que existe" className={COR_DE_AVISO}>
                  <TriangleAlert size={10} strokeWidth={2} />
                </span>
              )}
              {avisos?.textoMudou && (
                <span title="O texto mudou depois desta escolha. Confira a cena." className={COR_DE_AVISO}>
                  <TriangleAlert size={10} strokeWidth={2} />
                </span>
              )}
              {avisos && avisos.repetidos.length > 0 && (
                <span title={`Cena repetida${ondeRepete ? ` (tambem na frase ${ondeRepete})` : ''}`} className={COR_DE_AVISO}>
                  <Copy size={10} strokeWidth={2} />
                </span>
              )}
              {avisos?.emendada && (
                <span title="Cena emendada: a frase e mais longa que o plano, e entra o plano seguinte" className="text-ink-3">
                  <Link2 size={10} strokeWidth={2} />
                </span>
              )}
              {temGrid(escolha) && (
                <span
                  title={escolha?.grid?.origem === 'auto' ? 'Grid automatico: duas cenas, uma em cima da outra' : 'Grid: duas cenas, uma em cima da outra'}
                  className="text-accent"
                >
                  <Rows2 size={10} strokeWidth={2} />
                </span>
              )}
              {escolha && lista.length > 0 && <Cadeado fraseId={frase.id} travada={escolha.travada} aberta={aberta} />}
              {lista.length === 0 ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Sem cena" />
              ) : (
                <span
                  className="tnum flex items-center gap-1 text-[10px] text-accent"
                  title={`${lista.length} ${lista.length === 1 ? 'cena' : 'cenas'} dividindo ${d.duracao.toFixed(1)}s${divididaPeloCasar(escolha) ? `
dividida: ${lista.length} cenas` : ''}${escolha?.avisos.length ? `\n${escolha.avisos.join('\n')}` : ''}`}
                >
                  <Check size={10} strokeWidth={2} />
                  {lista.length === 1 ? `1 cena · ${d.duracao.toFixed(1)}s` : `${lista.length} cenas · ${d.duracao.toFixed(1)}s`}
                </span>
              )}
            </span>
          </div>
          <TextoComCortes frase={frase} cenas={lista} aberta={aberta} />
        </div>
      </div>

      {aberta && <FitaDaFrase frase={frase} escolha={escolha} tempos={tempos} planos={planos} />}
    </div>
  )
})

/**
 * O cadeado da frase: travada (escolhida ou mexida a mao), "Sugerir de novo"
 * nao mexe nela. Fechado aparece sempre; aberto so na frase aberta ou com o
 * mouse em cima (pouco icone na coluna). Clique trava ou destrava.
 */
function Cadeado({ fraseId, travada, aberta }: { fraseId: string; travada: boolean; aberta: boolean }) {
  const travar = useCenas((s) => s.travar)
  const rotulo = travada ? 'Travada: Sugerir de novo nao mexe nela. Clique para destravar' : 'Travar: Sugerir de novo nao mexe nela'
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        travar(fraseId, !travada)
      }}
      aria-label={rotulo}
      aria-pressed={travada}
      title={rotulo}
      className={[
        'grid size-[14px] place-items-center rounded-sm transition-colors duration-150 hover:text-ink',
        travada
          ? 'text-ink-3'
          : aberta
            ? 'text-ink-3/70'
            : 'text-ink-3/70 opacity-0 group-hover/frase:opacity-100 focus-visible:opacity-100',
      ].join(' ')}
    >
      {travada ? <Lock size={10} strokeWidth={2} /> : <LockOpen size={10} strokeWidth={2} />}
    </button>
  )
}

/** As miniaturas das cenas da frase fechada: a primeira, com quantas sao no canto. Sem cena, o quadro tracejado. */
function Miniaturas({ cenas }: { cenas: readonly CenaDaFrase[] }) {
  const primeira = cenas[0]?.candidato.planoIds[0] ?? null
  const url = useCenas((s) => (primeira ? (s.miniaturas[primeira] ?? null) : null))
  const [quebrou, setQuebrou] = useState(false)
  // Uma segunda tentativa: no primeiro carregamento de um perfil novo a miniatura
  // pode chegar antes do arquivo terminar de ser escrito (o .webp fica integro
  // logo depois). Remontar o <img> uma vez pede de novo; a segunda falha e de verdade.
  const [tentativa, setTentativa] = useState(0)
  useEffect(() => {
    setQuebrou(false)
    setTentativa(0)
  }, [url])
  if (!primeira) {
    return <span className="block h-[36px] w-[64px] shrink-0 rounded-[2px] border border-dashed border-line-strong" title="Sem cena" />
  }
  return (
    <span className="relative shrink-0">
      {url && !quebrou ? (
        <img
          key={tentativa}
          src={url}
          alt=""
          draggable={false}
          onError={() => {
            if (tentativa === 0) window.setTimeout(() => setTentativa(1), 400)
            else setQuebrou(true)
          }}
          className="h-[36px] w-[64px] rounded-[2px] border border-line object-cover"
        />
      ) : (
        <span className="block h-[36px] w-[64px] rounded-[2px] border border-line bg-elevated" />
      )}
      {cenas.length > 1 && (
        <span className="tnum absolute right-0 top-0 rounded-bl-[2px] bg-black/75 px-1 text-[10px] text-white">{cenas.length}</span>
      )}
    </span>
  )
}

/** Ja arrastou a barrinha nesta sessao: a dica nao precisa mais aparecer. */
let jaPuxou = false

/**
 * O texto da frase pintado por cena, com a BARRINHA ROSA entre elas (so na
 * frase aberta): o mesmo gesto da ScriptColumn do Dangai. O arraste mora na
 * janela, e a palavra sob o dedo vem do elemento sob o ponteiro -- o texto
 * quebra linha, e a coordenada horizontal sozinha nao diz nada.
 */
function TextoComCortes({ frase, cenas, aberta }: { frase: Frase; cenas: readonly CenaDaFrase[]; aberta: boolean }) {
  const moverCorte = useCenas((s) => s.moverCorte)
  const palavras = useMemo(() => palavrasDaFrase(frase.texto), [frase.texto])
  const [puxando, setPuxando] = useState<number | null>(null)
  const [alvo, setAlvo] = useState<number | null>(null)

  useEffect(() => {
    if (puxando === null) return
    const mover = (e: PointerEvent): void => {
      const sob = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-palavra]')
      const valor = sob?.getAttribute('data-palavra')
      if (valor === null || valor === undefined) return
      const palavra = Number(valor)
      setAlvo(palavra)
      moverCorte(frase.id, puxando, palavra)
    }
    const soltar = (): void => {
      setPuxando(null)
      setAlvo(null)
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', soltar)
    return () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', soltar)
    }
  }, [puxando, moverCorte, frase.id])

  if (cenas.length < 2 || palavras.length === 0) {
    return <p className={['mt-1 text-[12px] leading-snug', aberta ? 'text-ink' : 'text-ink-2'].join(' ')}>{frase.texto}</p>
  }

  // As palavras agrupadas por cena: o fundo e do grupo (continuo); cada palavra e um elemento (o arraste precisa).
  const grupos: {
    cena: number
    palavras: { texto: string; indice: number }[]
  }[] = []
  for (const [indice, texto] of palavras.entries()) {
    let cena = 0
    for (const [k, c] of cenas.entries()) if (c.palavraInicio <= indice) cena = k
    const ultimo = grupos[grupos.length - 1]
    if (!ultimo || ultimo.cena !== cena) grupos.push({ cena, palavras: [{ texto, indice }] })
    else ultimo.palavras.push({ texto, indice })
  }

  return (
    <>
      <p
        className={[
          'mt-1 text-[12px] leading-snug',
          aberta ? 'text-ink' : 'text-ink-2',
          puxando !== null ? 'cursor-ew-resize select-none' : '',
        ].join(' ')}
      >
        {grupos.map((grupo, g) => (
          <span key={g}>
            {g > 0 && aberta && (
              <span
                role="separator"
                title={`Arraste para escolher em que palavra a cena ${grupo.cena + 1} comeca`}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  jaPuxou = true
                  setPuxando(grupo.cena)
                }}
                onClick={(e) => e.stopPropagation()}
                className="group/alca inline-flex h-4 w-[13px] cursor-ew-resize items-center justify-center align-middle"
              >
                <span
                  className={[
                    'block w-[3px] rounded-full transition-all duration-100',
                    puxando === grupo.cena
                      ? 'h-4 bg-accent shadow-[0_0_6px_rgba(255,62,128,0.8)]'
                      : 'h-3 bg-accent/60 group-hover/alca:h-4 group-hover/alca:bg-accent',
                  ].join(' ')}
                />
              </span>
            )}
            <span
              className={[
                'mr-1 box-decoration-clone rounded-[2px] px-1 py-[1px]',
                grupo.cena % 2 === 0 ? 'bg-accent-dim text-ink' : 'bg-elevated text-ink-2',
              ].join(' ')}
            >
              {grupo.palavras.map((p, i) => (
                <span
                  key={p.indice}
                  data-palavra={p.indice}
                  className={puxando !== null && alvo === p.indice ? 'rounded-[2px] outline outline-1 outline-accent' : undefined}
                >
                  {i > 0 ? ' ' : ''}
                  {p.texto}
                </span>
              ))}
            </span>
          </span>
        ))}
      </p>
      {/* A dica some depois do primeiro arraste da sessao (pouco texto na tela, como na ScriptColumn). */}
      {aberta && puxando === null && !jaPuxou && (
        <p className="mt-1 text-[10px] text-ink-3">Arraste a barrinha rosa para escolher em que palavra cada cena comeca.</p>
      )}
    </>
  )
}

/**
 * As cenas da frase ABERTA, uma por linha, na ordem do video (a Fita da
 * ScriptColumn): os segundos que cada uma ganha, tocar a frase com ela,
 * "Perto desta cena", tirar. A linha marcada e a cena que o proximo clique
 * na grade troca. So a alca arrasta.
 */
function FitaDaFrase({
  frase,
  escolha,
  tempos,
  planos,
}: {
  frase: Frase
  escolha: EscolhaDaFrase | null
  tempos: readonly { inicio: number; fim: number }[]
  planos: PlanosDaTela
}) {
  const cenaAlvo = useCenas((s) => s.cenaAlvo)
  const reordenarCenas = useCenas((s) => s.reordenarCenas)
  const juntarCenas = useCenas((s) => s.juntarCenas)
  // (20/10) O grid na mao desta frase: escolhendo a de cima, ou esperando a de baixo da cena k.
  const naMao = useCenas((s) => (s.gridNaMao?.fraseId === frase.id ? s.gridNaMao : null))
  const cenas = escolha?.cenas ?? []

  if (cenas.length === 0) {
    return (
      <p className="mt-2 rounded-[2px] border border-dashed border-line-strong px-2 py-2 text-center text-[11px] text-ink-3">
        Clique numa cena ao lado
      </p>
    )
  }

  /*
   * A chave e da CENA, nao da posicao: com a posicao na chave, cada troca no
   * meio do arraste mudava as chaves e o item era recriado embaixo do dedo. A
   * mesma cena duas vezes ganha a ocorrencia ("#1"), para as chaves nao
   * baterem.
   */
  const vistas = new Map<string, number>()
  const itens = cenas.map((c) => {
    const base = c.candidato.planoIds.join('+')
    const n = vistas.get(base) ?? 0
    vistas.set(base, n + 1)
    return `${base}#${n}`
  })
  const posicaoDe = new Map(itens.map((k, i) => [k, i]))
  const alvo = Math.min(cenaAlvo, cenas.length - 1)

  return (
    <>
      {naMao?.etapa === 'cima' && (
        <p className="mt-2 rounded-[3px] bg-accent/15 px-2 py-1 text-[11px] font-medium text-accent" title="Esc cancela">
          Escolha a cena de CIMA (clique nela)
        </p>
      )}
      <Reorder.Group
        axis="y"
        values={itens}
        onReorder={(novos) =>
          reordenarCenas(
            frase.id,
            novos.map((k) => posicaoDe.get(k) ?? 0),
          )
        }
        as="ul"
        className="mt-2 flex flex-col gap-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        {cenas.map((c, i) => (
          <LinhaDaCena
            key={itens[i]}
            chave={itens[i]!}
            fraseId={frase.id}
            posicao={i}
            cena={c}
            alvo={i === alvo}
            multipla={cenas.length > 1}
            naMao={naMao ? (naMao.etapa === 'cima' ? 'cima' : naMao.cena === i ? 'baixo' : null) : null}
            segundos={(tempos[i]?.fim ?? 0) - (tempos[i]?.inicio ?? 0)}
            plano={planos.porId.get(c.candidato.planoIds[0] ?? '') ?? null}
            janela={trechosDoCandidato(
              c.candidato,
              c.candidato.planoIds.map((id) => planos.porId.get(id)).filter((p): p is Plano => p !== undefined),
            ).reduce((s, t) => s + (t.ate - t.de), 0)}
          />
        ))}
      </Reorder.Group>
      <GridDaFrase fraseId={frase.id} escolha={escolha} />
      {/* A divisao automatica se desfaz aqui: volta a uma cena so, a melhor para a frase inteira. */}
      {divididaPeloCasar(escolha) && !temGrid(escolha) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            juntarCenas(frase.id)
          }}
          title="Dividida pelo app. Juntar volta a uma cena so (a melhor para a frase inteira)"
          className="mt-1 flex items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] text-ink-3 transition-colors duration-150 hover:bg-elevated hover:text-ink"
        >
          <Merge size={11} strokeWidth={1.75} />
          Juntar em 1
        </button>
      )}
    </>
  )
}

/**
 * (rodada 4) GRID / TELA CHEIA da frase aberta: o grid poe duas cenas, uma em
 * cima da outra. (20/10) Na mao: "Grid", a cena de cima aqui (ja feita com
 * uma cena so) e a de baixo na grade ao lado; a sugestao do app entra
 * embaixo enquanto isso. Tela cheia volta a uma cena por vez (ou cancela o
 * grid pela metade), e o automatico nao poe mais grid nesta frase.
 */
function GridDaFrase({ fraseId, escolha }: { fraseId: string; escolha: EscolhaDaFrase | null }) {
  const alternarGrid = useCenas((s) => s.alternarGrid)
  const pedirGrid = useCenas((s) => s.pedirGrid)
  const cancelarGrid = useCenas((s) => s.cancelarGrid)
  const gridando = useCenas((s) => s.gridando)
  // (20/10) O grid na mao em andamento conta como ligado (o "Tela cheia" cancela).
  const naMao = useCenas((s) => s.gridNaMao?.fraseId === fraseId)
  const temMetade = temGrid(escolha)
  const ligado = temMetade || naMao
  const ocupado = gridando !== null
  const auto = temMetade && escolha?.grid?.origem === 'auto'
  return (
    <div
      className={['mt-1.5 flex items-center gap-2', ocupado ? 'pointer-events-none opacity-60' : ''].join(' ')}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="shrink-0 text-[11px] text-ink-3" title="Grid: duas cenas boas para a mesma frase, uma em cima da outra (como no Kiumaz)">
        {gridando === fraseId ? 'Montando...' : auto ? 'Grid (auto)' : 'Tela'}
      </span>
      <Segmentos
        opcoes={[
          { valor: false, rotulo: 'Tela cheia', title: 'Uma cena por vez (o grid automatico nao entra nesta frase). Com o grid pela metade, cancela' },
          {
            valor: true,
            rotulo: (
              <>
                <Rows2 size={11} strokeWidth={1.75} />
                Grid
              </>
            ),
            title: 'Duas cenas, uma em cima da outra: escolha a de cima aqui e a de baixo na grade ao lado',
          },
        ]}
        ativo={(v) => v === ligado}
        onChange={(v) => {
          if (v === ligado) return
          if (v) pedirGrid(fraseId)
          else if (temMetade) void alternarGrid(fraseId, false)
          else cancelarGrid()
        }}
      />
    </div>
  )
}

function LinhaDaCena({
  chave,
  fraseId,
  posicao,
  cena,
  alvo,
  multipla,
  naMao,
  segundos,
  plano,
  janela,
}: {
  chave: string
  fraseId: string
  posicao: number
  cena: CenaDaFrase
  /** A cena que o proximo clique na grade troca. */
  alvo: boolean
  multipla: boolean
  /** (20/10) O grid na mao: 'cima' = o clique escolhe esta para cima; 'baixo' = a grade poe embaixo desta. */
  naMao: 'cima' | 'baixo' | null
  /** Quanto a cena fica na tela (pelas palavras de inicio, no tempo da voz). */
  segundos: number
  plano: Plano | null
  /** Quanto de video o candidato tem (a soma dos pedacos de mp4). */
  janela: number
}) {
  const controles = useDragControls()
  const url = useCenas((s) => s.miniaturas[cena.candidato.planoIds[0] ?? ''] ?? null)
  const urlDeBaixo = useCenas((s) => (cena.baixo ? (s.miniaturas[cena.baixo.planoIds[0] ?? ''] ?? null) : null))
  const tocandoEsta = useCenas((s) => s.previa?.fraseId === fraseId && s.previa.candidato === null)
  const definirCenaAlvo = useCenas((s) => s.definirCenaAlvo)
  const removerCena = useCenas((s) => s.removerCena)
  const completarCena = useCenas((s) => s.completarCena)
  const escolherCima = useCenas((s) => s.escolherCima)
  const trocarDeBaixo = useCenas((s) => s.trocarDeBaixo)
  const inverterGrid = useCenas((s) => s.inverterGrid)
  const tirarDeBaixo = useCenas((s) => s.tirarDeBaixo)
  const abrirPrevia = useCenas((s) => s.abrirPrevia)
  const definirFiltros = useCenas((s) => s.definirFiltros)
  const parada = segundos - janela
  const emenda = cena.candidato.planoIds.length > 1

  return (
    <Reorder.Item value={chave} as="li" dragListener={false} dragControls={controles} className="list-none">
      <div
        onClick={() => (naMao === 'cima' ? escolherCima(posicao) : definirCenaAlvo(posicao))}
        title={
          naMao === 'cima'
            ? 'Clique: esta fica em cima'
            : multipla
            ? alvo
              ? 'O proximo clique numa cena ao lado troca esta'
              : 'Clique para trocar esta cena'
            : `cena ${cena.candidato.planoIds.join('+')}${plano && plano.personagens.length > 0 ? ` · ${plano.personagens.map((p) => nomeNatural(p.nome)).join(', ')}` : ''}`
        }
        className={[
          'flex cursor-pointer items-center gap-2 rounded-[3px] py-1 pr-1',
          naMao === 'cima'
            ? 'pl-1 ring-1 ring-inset ring-accent/40 hover:bg-accent/10 hover:ring-accent'
            : naMao === 'baixo' || (multipla && alvo)
              ? 'bg-surface pl-1 ring-1 ring-inset ring-accent/70'
              : 'pl-1',
        ].join(' ')}
      >
        <button
          type="button"
          onPointerDown={(e) => controles.start(e)}
          aria-label="Arrastar para mudar a ordem"
          title="Arrastar para mudar a ordem"
          className="shrink-0 cursor-grab touch-none text-ink-3 hover:text-ink-2 active:cursor-grabbing"
        >
          <GripVertical size={13} strokeWidth={1.5} />
        </button>
        <span className="relative shrink-0">
          {url ? (
            <img
              src={url}
              alt=""
              draggable={false}
              className={['h-[36px] w-[64px] rounded-[2px] border object-cover', parada > 0.05 ? 'border-accent' : 'border-line'].join(
                ' ',
              )}
            />
          ) : (
            <span className="block h-[36px] w-[64px] rounded-[2px] border border-line bg-elevated" />
          )}
          {/* (rodada 4) O grid: a metade de baixo logo embaixo da de cima, como no video.
              (20/10) Clicar nela troca so ela; inverter e tirar a de baixo ficam em cima dela. */}
          {cena.baixo && (
            <span className="relative mt-px block">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  trocarDeBaixo(fraseId, posicao)
                }}
                title="Trocar a de baixo: clique aqui e depois numa cena ao lado"
                className="block"
              >
                {urlDeBaixo ? (
                  <img
                    src={urlDeBaixo}
                    alt=""
                    draggable={false}
                    className={[
                      'block h-[36px] w-[64px] rounded-[2px] border object-cover',
                      naMao === 'baixo' ? 'border-accent' : 'border-line',
                    ].join(' ')}
                  />
                ) : (
                  <span className="block h-[36px] w-[64px] rounded-[2px] border border-line bg-elevated" />
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  inverterGrid(fraseId, posicao)
                }}
                aria-label="Inverter cima e baixo"
                title="Inverter cima e baixo"
                className="absolute -top-[9px] right-0.5 grid size-[17px] place-items-center rounded-full border border-line bg-surface text-ink-2 shadow-sm hover:border-accent hover:text-accent"
              >
                <ArrowUpDown size={10} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  tirarDeBaixo(fraseId, posicao)
                }}
                aria-label="Tirar a de baixo"
                title="Tirar a de baixo (esta cena volta a tela cheia)"
                className="absolute bottom-0.5 right-0.5 grid size-[15px] place-items-center rounded-sm bg-black/75 text-white hover:bg-danger"
              >
                <X size={10} strokeWidth={2.25} />
              </button>
            </span>
          )}
          {/* (20/10) Esperando a de baixo: o lugar dela, vazio. */}
          {!cena.baixo && naMao === 'baixo' && (
            <span
              className="mt-px grid h-[36px] w-[64px] place-items-center rounded-[2px] border border-dashed border-accent text-[9px] leading-tight text-accent"
              title="Clique numa cena ao lado: ela vai embaixo"
            >
              embaixo?
            </span>
          )}
          <span className="tnum absolute left-0 top-0 rounded-br-[2px] bg-black/75 px-1 text-[10px] text-white">{posicao + 1}</span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="tnum text-[12px] text-ink-2">{segundos.toFixed(1)}s</span>
          {cena.baixo && (
            <span
              className="flex items-center gap-1 truncate text-[10px] leading-tight text-accent"
              title={`Grid: ${cena.candidato.planoIds[0] ?? ''} em cima, ${cena.baixo.planoIds[0] ?? ''} embaixo.`}
            >
              <Rows2 size={10} strokeWidth={2} />
              grid
            </span>
          )}
          {cena.baixo && cena.baixo.origem !== 'usuario' && (
            <span className="truncate text-[10px] leading-tight text-ink-3" title="Sugestao do app: clique na metade de baixo e depois numa cena ao lado para trocar">
              sugestao do app
            </span>
          )}
          {emenda && <span className="truncate text-[10px] leading-tight text-ink-3">emendada</span>}
          {parada > 0.05 && (
            <span
              className="tnum whitespace-nowrap text-[10px] text-accent"
              title={`A cena tem ${janela.toFixed(1)}s de video e fica ${segundos.toFixed(1)}s na tela: nos ultimos ${parada.toFixed(1)}s a imagem fica PARADA.`}
            >
              parada {parada.toFixed(1)}s
            </span>
          )}
          {/* (20/10) A cena dele que nao cobre: emendar o plano seguinte so a pedido. */}
          {parada > 0.05 && !cena.baixo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                completarCena(fraseId, posicao)
              }}
              title="Completar com o plano seguinte do episodio (a cena emenda e para de ficar parada)"
              className="w-fit text-left text-[10px] leading-tight text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            >
              completar
            </button>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-0.5">
          <Acao
            rotulo={tocandoEsta ? 'Tocando no player' : 'Tocar a frase com a narracao (Espaco)'}
            onClick={() => abrirPrevia({ fraseId, candidato: null })}
          >
            {tocandoEsta ? <Pause size={12} strokeWidth={1.75} /> : <Play size={12} strokeWidth={1.75} />}
          </Acao>
          <Acao rotulo="Perto desta cena" onClick={() => definirFiltros({ vizinhasDe: cena.candidato.planoIds[0] ?? null })}>
            <LocateFixed size={12} strokeWidth={1.5} />
          </Acao>
          <Acao rotulo="Tirar esta cena da frase" onClick={() => removerCena(fraseId, posicao)} perigo>
            <X size={13} strokeWidth={1.75} />
          </Acao>
        </span>
      </div>
    </Reorder.Item>
  )
}

function Acao({
  rotulo,
  onClick,
  perigo = false,
  children,
}: {
  rotulo: string
  onClick: () => void
  perigo?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={rotulo}
      title={rotulo}
      className={[
        'grid size-[22px] place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:bg-elevated',
        perigo ? 'hover:text-danger' : 'hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
