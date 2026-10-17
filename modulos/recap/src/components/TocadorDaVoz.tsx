import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, History, Loader2, Pause, Play, TriangleAlert } from 'lucide-react'
import type { RascunhoDoRecap } from '../../shared/roteiro'
import {
  ROTULO_DA_FONTE,
  estadoDaVoz,
  modeloEleven,
  velocidadeNativaEnviada,
  type ConfigDaVoz,
  type PalavraComTempo,
  type TakeDaVoz,
} from '../../shared/voz'
import type { VozDoProvedor } from '../../shared/tipos-da-voz'
import {
  alinhamentoFraco,
  audioDoTake,
  nomeCurto,
  segundosCurtos,
  textoDaVelocidade,
  textoDoGasto,
  tocador,
  useTocador,
  useVoz,
} from '../store/gerar-voz'
import { nucleo } from '../nucleo'
import { Waveform } from '@/modulos/kit'
import { quando } from './PassoDoRoteiro'
import { Botao, COR_DE_AVISO, formatarTempo, Link } from './pecas'

/** Uma palavra do take com o indice dela na lista inteira (o karaoke compara pelo indice). */
export interface PalavraIndexada {
  texto: string
  i: number
}

/** As palavras do take agrupadas pela frase, cada uma com o indice global. */
export function palavrasPorFrase(palavras: readonly PalavraComTempo[]): Map<string, PalavraIndexada[]> {
  const mapa = new Map<string, PalavraIndexada[]>()
  palavras.forEach((p, i) => {
    const lista = mapa.get(p.fraseId)
    if (lista) lista.push({ texto: p.texto, i })
    else mapa.set(p.fraseId, [{ texto: p.texto, i }])
  })
  return mapa
}

/**
 * O nome da voz de uma config, pela lista da conta; sem a lista, o id curto.
 * `curto`: so o nome ("Andrea Wolff"), sem a descricao da biblioteca do
 * ElevenLabs ("- clear, youthful, evenly paced"), que fica para o tooltip.
 */
export function nomeDaVoz(config: ConfigDaVoz, vozes: Record<'elevenlabs' | 'fish', VozDoProvedor[] | null>, curto = false): string {
  if (config.fonte === 'importado') return config.audio.nome
  const achada = vozes[config.fonte]?.find((v) => v.id === config.voiceId)
  if (!achada) return `${config.voiceId.slice(0, 8)}...`
  return curto ? nomeCurto(achada.nome) : achada.nome
}

/** Fora de campo de texto, botao, select e slider: ai o Espaco e de quem tem o foco. */
function teclaLivre(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return true
  if (alvo.isContentEditable) return false
  return !alvo.closest('input, textarea, select, button, a, [role="slider"], [role="checkbox"]')
}

/**
 * O TOCADOR DA VOZ: ouvir a narracao inteira com a onda, a agulha e as
 * palavras do roteiro acendendo (karaoke da frase que toca). Fica preso no
 * topo enquanto a lista das frases rola embaixo: o olho segue a frase, a mao
 * fica no play.
 *
 * O audio e o WAV do take publicado no servidor de midia local (urlDoAudio);
 * o tempo e o do proprio <audio> (useTocador), e as palavras sao as do roteiro
 * com o tempo do take -- o texto nunca vem do que o provedor "ouviu".
 *
 * Espaco toca e pausa (fora de campo e de botao, onde o Espaco e deles).
 */
export function TocadorDaVoz({ rascunho, take }: { rascunho: RascunhoDoRecap; take: TakeDaVoz }) {
  const rascunhoId = rascunho.id
  const chave = `${rascunhoId}:${take.id}`
  const audio = useVoz((s) => audioDoTake(s, rascunhoId, take.id))
  const carregando = useVoz((s) => s.carregandoAudio === chave)
  const audioErro = useVoz((s) => (s.audioErro?.chave === chave ? s.audioErro.erro : null))
  const carregarAudio = useVoz((s) => s.carregarAudio)
  const erroDoTocador = useTocador((s) => s.erro)

  useEffect(() => {
    void carregarAudio(take.id)
  }, [carregarAudio, take.id, rascunhoId])

  // Take novo sem o audio publicado ainda: o tocador larga o anterior (o play
  // das linhas tocaria o trecho do take velho com os tempos do novo).
  useEffect(() => {
    if (audio) tocador.carregar(chave, audio.url, take)
    else if (useTocador.getState().chave !== chave) tocador.descarregar()
  }, [audio, chave, take])

  // Saiu do passo 3 (ou fechou o assistente): o audio para.
  useEffect(() => () => tocador.descarregar(), [])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== ' ' || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented || !teclaLivre(e.target)) return
      const p = nucleo().ler()
      if (p.settingsOpen || p.paletteOpen || p.libraryOpen) return
      e.preventDefault()
      tocador.alternar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  const falha = audioErro ?? erroDoTocador
  const { sentinela, preso, compacto } = usePresoNoTopo()

  /*
   * sticky: preso no topo da rolagem enquanto as frases passam embaixo. z-10
   * tambem segura a lista de Takes por cima dos cartoes de baixo (cada um tem
   * camada propria pelo `enter`).
   *
   * Preso, ele tem o fundo da pagina em volta (8 px em cima, e nenhuma fresta
   * da linha de baixo) e um degrade embaixo: as linhas somem por baixo dele em
   * vez de serem cortadas a seco. Em janela baixa, preso, fica compacto (onda
   * menor, sem a linha do karaoke -- a frase que toca ja acende na lista).
   */
  return (
    <>
      <div ref={sentinela} aria-hidden className="h-0" />
      <div className="sticky top-0 z-10 -mb-2 -mt-6 bg-bg pb-2 pt-2">
        <section className="enter flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-4">
          <div className="flex min-w-0 items-center gap-3">
        <BotaoTocar pronto={audio !== null} />
        <Tempo duracao={take.duracao} />
        <span className="flex-1" />
        {alinhamentoFraco(take) && <AlinhamentoFraco take={take} />}
        <ResumoDoTake take={take} />
        <Takes rascunho={rascunho} />
      </div>
      <div className="relative">
        <Onda take={take} peaks={audio?.peaks ?? null} rms={audio?.rms ?? null} baixa={compacto} />
        {(carregando || falha) && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            {falha ? null : (
              <span className="flex items-center gap-2 text-[11px] text-ink-3">
                <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
                Carregando o audio...
              </span>
            )}
          </div>
        )}
      </div>
      {falha && (
        <p className="flex min-w-0 items-center gap-2 text-[11px] text-danger" title={falha}>
          <TriangleAlert size={12} strokeWidth={1.5} className="shrink-0" />
          <span className="min-w-0 truncate">{falha}</span>
          <Link onClick={() => void carregarAudio(take.id)} title="Pede o audio deste take de novo">
            Tentar de novo
          </Link>
        </p>
      )}
      {!compacto && <Karaoke take={take} />}
        </section>
        {preso && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-full h-4"
            style={{ background: 'linear-gradient(var(--color-bg), transparent)' }}
          />
        )}
      </div>
    </>
  )
}

/** Abaixo desta altura de janela, o tocador preso fica compacto (em 1024x700 sobravam ~330 px para a lista). */
const ALTURA_BAIXA = 820

/**
 * Se o tocador esta preso no topo (a sentinela logo antes dele saiu da area
 * rolavel por cima) e se a janela e baixa. A rolagem do assistente corta a
 * sentinela, entao o IntersectionObserver com a janela inteira basta.
 */
function usePresoNoTopo(): { sentinela: React.RefObject<HTMLDivElement>; preso: boolean; compacto: boolean } {
  const sentinela = useRef<HTMLDivElement>(null)
  const [preso, setPreso] = useState(false)
  const [baixa, setBaixa] = useState(() => window.innerHeight < ALTURA_BAIXA)
  useEffect(() => {
    const el = sentinela.current
    if (!el) return
    // So conta sair POR CIMA (rolou a pagina): saindo por baixo o tocador nem esta preso.
    const obs = new IntersectionObserver(([e]) => setPreso(e !== undefined && !e.isIntersecting && e.boundingClientRect.top < window.innerHeight / 2))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  useEffect(() => {
    const medir = (): void => setBaixa(window.innerHeight < ALTURA_BAIXA)
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [])
  return { sentinela, preso, compacto: preso && baixa }
}

/** O play/pause da narracao inteira: o mesmo botao da barra do editor (RenderBar). */
function BotaoTocar({ pronto }: { pronto: boolean }) {
  // Tocando uma frase so tambem conta: o clique aqui pausa, entao o icone e o de pausar.
  const tocando = useTocador((s) => s.tocando)
  return (
    <button
      type="button"
      data-foco="tocar-voz"
      onClick={() => tocador.alternar()}
      disabled={!pronto}
      aria-label={tocando ? 'Pausar' : 'Tocar a narracao'}
      title={tocando ? 'Pausar (Espaco)' : 'Tocar a narracao (Espaco)'}
      className="lift grid size-8 shrink-0 place-items-center rounded-sm border border-line bg-elevated text-ink-2 hover:text-ink disabled:opacity-40"
    >
      {tocando ? <Pause size={14} strokeWidth={1.5} /> : <Play size={14} strokeWidth={1.5} />}
    </button>
  )
}

/** "0:12.3 / 1:06.4": so isto redesenha a cada quadro. */
function Tempo({ duracao }: { duracao: number }) {
  const tempo = useTocador((s) => s.tempo)
  return (
    <span className="tnum shrink-0 text-[12px] text-ink-2" title="Agulha / duracao da narracao">
      {formatarTempo(tempo, 1)}
      <span className="text-ink-3"> / {formatarTempo(duracao, 1)}</span>
    </span>
  )
}

/**
 * A ONDA da narracao, com as fronteiras das frases (fio), a frase sob a
 * agulha (fundo rosa apagado) e a agulha. Clicar (ou arrastar) leva a agulha;
 * com o foco, as setas andam 2 s e Home/End vao as pontas.
 */
function Onda({ take, peaks, rms, baixa = false }: { take: TakeDaVoz; peaks: number[] | null; rms: number[] | null; baixa?: boolean }) {
  const tempo = useTocador((s) => s.tempo)
  const frase = useTocador((s) => (s.usado ? s.frase : null))
  const caixa = useRef<HTMLDivElement>(null)
  const arrastando = useRef(false)
  const duracao = Math.max(take.duracao, 0.001)
  const pct = (t: number): string => `${Math.min(100, Math.max(0, (t / duracao) * 100))}%`
  const trecho = frase ? (take.trechos.find((t) => t.fraseId === frase) ?? null) : null
  const desligada = peaks === null
  /*
   * A voz do TTS vem baixa (pico ~0,4): em escala crua a onda vira um fio. Aqui
   * so se le a forma (onde ha fala e pausa), entao ela e esticada ate o pico
   * dela -- com teto, para um audio quase mudo nao virar ruido gigante.
   */
  const onda = useMemo(() => {
    if (!peaks) return null
    let max = 0
    for (const p of peaks) if (p > max) max = p
    const ganho = max > 0 ? Math.min(8, 0.95 / max) : 1
    return { peaks: peaks.map((p) => p * ganho), rms: rms ? rms.map((r) => r * ganho) : null }
  }, [peaks, rms])

  const irPara = (clientX: number): void => {
    const r = caixa.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    tocador.irPara(((clientX - r.left) / r.width) * take.duracao)
  }

  return (
    <div
      ref={caixa}
      role="slider"
      tabIndex={desligada ? -1 : 0}
      aria-label="Posicao na narracao"
      aria-valuemin={0}
      aria-valuemax={Math.round(take.duracao * 10) / 10}
      aria-valuenow={Math.round(tempo * 10) / 10}
      aria-valuetext={formatarTempo(tempo, 1)}
      aria-disabled={desligada}
      title="Clique para levar a agulha (setas: 2 s)"
      onPointerDown={(e) => {
        if (desligada || e.button !== 0) return
        arrastando.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        irPara(e.clientX)
      }}
      onPointerMove={(e) => {
        if (arrastando.current) irPara(e.clientX)
      }}
      onPointerUp={() => {
        arrastando.current = false
      }}
      onPointerCancel={() => {
        arrastando.current = false
      }}
      onKeyDown={(e) => {
        if (desligada) return
        const t = useTocador.getState().tempo
        const alvo =
          e.key === 'ArrowLeft' ? t - 2 : e.key === 'ArrowRight' ? t + 2 : e.key === 'Home' ? 0 : e.key === 'End' ? take.duracao : null
        if (alvo === null) return
        e.preventDefault()
        tocador.irPara(alvo)
      }}
      className={[
        'relative overflow-hidden rounded-sm border border-line bg-elevated transition-[height] duration-200',
        baixa ? 'h-[44px]' : 'h-[72px]',
        desligada ? 'cursor-default' : 'cursor-pointer',
      ].join(' ')}
    >
      {trecho && (
        <span
          className="pointer-events-none absolute inset-y-0 bg-accent-dim"
          style={{ left: pct(trecho.offset), width: pct(trecho.duracao) }}
        />
      )}
      <div className="pointer-events-none absolute inset-0">
        {onda && (
          <Waveform
            peaks={onda.peaks}
            rms={onda.rms ?? undefined}
            cor="rgba(255, 255, 255, 0.13)"
            corRms="rgba(255, 255, 255, 0.26)"
            className="block h-full"
          />
        )}
      </div>
      {take.trechos.slice(1).map((t) => (
        <span
          key={t.fraseId}
          className="pointer-events-none absolute inset-y-0 w-px bg-line-strong"
          style={{ left: pct(t.offset) }}
        />
      ))}
      {!desligada && (
        <span className="pointer-events-none absolute inset-y-0 w-px bg-accent" style={{ left: pct(tempo) }} />
      )}
    </div>
  )
}

/**
 * O KARAOKE: a frase sob a agulha, com as palavras do roteiro acendendo na
 * hora em que soam -- as ditas em branco, a da vez em rosa, as que faltam
 * apagadas. Antes de tocar, a primeira frase espera apagada.
 */
function Karaoke({ take }: { take: TakeDaVoz }) {
  const frase = useTocador((s) => (s.usado ? s.frase : null))
  const palavra = useTocador((s) => s.palavra)
  const porFrase = useMemo(() => palavrasPorFrase(take.palavras), [take.palavras])
  const alvo = frase ?? take.trechos[0]?.fraseId ?? null
  const lista = alvo ? (porFrase.get(alvo) ?? []) : []
  return (
    <p className="min-h-[52px] select-text text-[16px] leading-[26px]">
      {lista.map((p) => (
        <span
          key={p.i}
          className={[
            'transition-colors duration-100',
            frase === null || p.i > palavra ? 'text-ink-3' : p.i === palavra ? 'text-accent' : 'text-ink',
          ].join(' ')}
        >
          {p.texto}{' '}
        </span>
      ))}
    </p>
  )
}

/** "t3 · Andrea Wolff · 1,05x": o take na tela, curto. O resto no tooltip. */
function ResumoDoTake({ take }: { take: TakeDaVoz }) {
  const vozes = useVoz((s) => s.vozes)
  const c = take.config
  const partes = [take.id, nomeDaVoz(c, vozes, true), Math.abs(c.velocidade - 1) > 1e-6 ? textoDaVelocidade(c.velocidade) : null]
  return (
    <span className="tnum min-w-0 max-w-[320px] truncate text-[11px] text-ink-3" title={detalheDoTake(take, vozes)}>
      {partes.filter(Boolean).join(' · ')}
    </span>
  )
}

/** O tooltip de um take: de onde veio, quanto custou, como o tempo foi medido. */
function detalheDoTake(take: TakeDaVoz, vozes: Record<'elevenlabs' | 'fish', VozDoProvedor[] | null>): string {
  const c = take.config
  const origem: Record<TakeDaVoz['origemDoAlinhamento'], string> = {
    provedor: 'tempos do provedor',
    normalizado: 'tempos do provedor (texto normalizado)',
    alinhador: 'tempos do alinhador',
  }
  return [
    `${ROTULO_DA_FONTE[c.fonte]} · ${nomeDaVoz(c, vozes)}${c.fonte === 'elevenlabs' ? ` · ${modeloEleven(c.modelId).nome}` : c.fonte === 'fish' ? ` · ${c.modelId}` : ''}`,
    // As duas velocidades (15/10): a nativa (gerada) e o acelerar (o pos). A
    // nativa e a que FOI ao provedor: o eleven_v4 nao tem speed e gera a 1,0,
    // mesmo com a do perfil guardada no take (a mesma conta do cache e do slider).
    `${c.fonte !== 'importado' ? `velocidade ${textoDaVelocidade(velocidadeNativaEnviada(c))} · ` : ''}acelerar ${textoDaVelocidade(c.velocidade)} · ${c.cortarPausas ? 'pausas cortadas' : 'pausas inteiras'}${c.fonte === 'importado' && c.cortarErros ? ' · erros cortados' : ''} · ${segundosCurtos(take.duracao)}`,
    take.cobrados > 0 ? textoDoGasto(c.fonte, take.cobrados) : 'sem custo',
    take.volume ? `volume ${take.volume.lufs.toFixed(1).replace('.', ',')} LUFS ${take.volume.ganho >= 0 ? '+' : ''}${take.volume.ganho.toFixed(1).replace('.', ',')} dB` : null,
    origem[take.origemDoAlinhamento],
    take.regravadas.length > 0 ? `regravou ${take.regravadas.join(', ')}${take.derivadoDe ? ` do ${take.derivadoDe}` : ''}` : null,
    ...take.avisos,
  ]
    .filter(Boolean)
    .join('\n')
}

/** O alinhamento mediu pouco: o audio pode nao ser este roteiro (o importado, sobretudo). */
function AlinhamentoFraco({ take }: { take: TakeDaVoz }) {
  const q = take.qualidade
  const dica = [
    q ? `${q.ancoradas} de ${q.total} palavras com tempo medido (o resto foi estimado)` : null,
    q && q.suspeitas > 0 ? `${q.suspeitas} ${q.suspeitas === 1 ? 'palavra' : 'palavras'} com tempo que o som desmente` : null,
    q?.score !== null && q?.score !== undefined ? `confianca ${q.score.toFixed(2).replace('.', ',')}` : null,
    'Confira ouvindo: as palavras podem acender fora de hora.',
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <span title={dica} className={`flex shrink-0 items-center gap-1 text-[11px] ${COR_DE_AVISO}`}>
      <TriangleAlert size={11} strokeWidth={1.75} />
      Alinhamento fraco
    </span>
  )
}

/** "Regravou 2 frases", "Ajuste", "ElevenLabs · Andrea". */
function origemDoTake(t: TakeDaVoz, vozes: Record<'elevenlabs' | 'fish', VozDoProvedor[] | null>): string {
  if (t.regravadas.length > 0) return `Regravou ${t.regravadas.length} ${t.regravadas.length === 1 ? 'frase' : 'frases'}`
  if (t.derivadoDe) return `Ajuste · ${textoDaVelocidade(t.config.velocidade)}`
  return `${ROTULO_DA_FONTE[t.config.fonte]} · ${nomeDaVoz(t.config, vozes, true)}`
}

/**
 * OS TAKES: toda narracao gerada, regravada, ajustada ou importada fica no
 * rascunho (nada e apagado). Clicar num volta a ele -- e tira a aprovacao.
 */
function Takes({ rascunho }: { rascunho: RascunhoDoRecap }) {
  const pedido = useVoz((s) => s.pedido)
  const aprovando = useVoz((s) => s.aprovando)
  // Uma pergunta de custo aberta trava a troca de take (ela fala do take atual).
  const perguntando = useVoz((s) => s.pergunta !== null || s.perguntando !== null)
  const vozes = useVoz((s) => s.vozes)
  const escolherTake = useVoz((s) => s.escolherTake)
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  const estado = estadoDaVoz(rascunho)

  // Esc fecha a lista, e so ela: sem isto o Esc do app fechava o assistente inteiro.
  useEffect(() => {
    if (!aberto) return
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setAberto(false)
      caixa.current?.querySelector<HTMLButtonElement>('button')?.focus()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [aberto])

  // Clicar fora fecha (pelo documento: o `enter` deixa transform no cartao, ver Versoes).
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent): void => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('pointerdown', fora, true)
    return () => document.removeEventListener('pointerdown', fora, true)
  }, [aberto])

  // Um pedido comecou com a lista aberta: ela fecha (nao da para trocar agora).
  useEffect(() => {
    if (pedido) setAberto(false)
  }, [pedido])

  if (estado.takes.length === 0) return null
  const lista = [...estado.takes].reverse()

  return (
    <div ref={caixa} className="relative shrink-0">
      <Botao
        pequeno
        onClick={() => setAberto((v) => !v)}
        disabled={pedido !== null || aprovando || perguntando}
        title="Voltar a um take anterior"
      >
        <History size={12} strokeWidth={1.5} />
        Takes
        <span className="tnum text-ink-3">{estado.takes.length}</span>
      </Botao>
      {aberto && (
        <ul
          className="glass enter absolute right-0 top-[calc(100%+6px)] z-50 max-h-[320px] w-[420px] overflow-y-auto rounded-md p-1.5"
          style={{ backgroundColor: 'var(--color-elevated)' }}
        >
          {lista.map((t) => {
            const atual = t.id === estado.atual
            const aprovado = atual && estado.aprovado
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    setAberto(false)
                    void escolherTake(t.id)
                  }}
                  title={detalheDoTake(t, vozes)}
                  aria-current={atual ? 'true' : undefined}
                  className={[
                    'flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[12px]',
                    atual ? 'bg-accent-dim text-ink' : 'text-ink-2 hover:bg-accent-dim hover:text-ink',
                  ].join(' ')}
                >
                  <span className="tnum w-7 shrink-0 font-medium">{t.id}</span>
                  <span className="min-w-0 flex-1 truncate">{origemDoTake(t, vozes)}</span>
                  {aprovado && (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-2">
                      <Check size={11} strokeWidth={2} className="text-accent" />
                      Aprovado
                    </span>
                  )}
                  <span className="tnum shrink-0 text-[11px] text-ink-3">{formatarTempo(t.duracao, 1)}</span>
                  <span className="tnum min-w-[36px] shrink-0 text-right text-[11px] text-ink-3">{quando(t.criadoEm)}</span>
                  <span className="grid w-3 shrink-0 place-items-center">
                    {atual && !aprovado && <Check size={12} strokeWidth={2} className="text-accent" />}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
