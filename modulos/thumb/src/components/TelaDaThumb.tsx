import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileVideo, FolderOpen, Images, Loader2, ScanFace, Sparkles, X } from 'lucide-react'
import { Segmentos } from '@/modulos/kit'
import { cenaNoInstante, duracaoDoPlano } from '../../shared/plano'
import {
  AjustesDaThumb,
  DoComputador,
  GradeDeSugestoes,
  PreviaDaThumb,
  ProvedorDoEditor,
  RodapeDaThumb,
  type FonteDaImagem,
} from '../editor/Editor'
import { Botao, formatarTempo, Link, Secao } from '../editor/pecas'
import { useInstaladorDoMotor } from '../motor'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { haProjetoAberto, lojaDo, useDoProjeto, useSolta, useTela, type ModoDaTela } from '../store/tela'

/**
 * [thumb] A TELA CHEIA DO MODULO THUMBNAIL: o mesmo editor da aba do recap
 * (editor/Editor.tsx), na mesma janela de vidro da tela "Video pronto": a
 * previa 1080x1920 a esquerda, os ajustes a direita, e no alto os dois
 * jeitos -- "Imagens soltas" (do PC) e "De um projeto" (os quadros limpos da
 * linha do tempo de um .dangai, normal ou do recap). Esc, o X e o "Fechar"
 * fecham; o resto do app fica inerte por baixo (nucleo.telaCheia).
 */
export function TelaDaThumb() {
  const aberta = useTela((s) => s.aberta)

  useEffect(() => {
    if (!aberta) return
    nucleo().telaCheia(true)
    // O projeto do editor mudou por baixo (escolheu outro .dangai): a thumb do projeto e a dele.
    const parar = nucleo().assinar((s, a) => {
      if (useTela.getState().modo !== 'projeto') return
      if (s.projectPath !== a.projectPath || (s.phase() === 'empty') !== (a.phase() === 'empty')) void useTela.getState().entrarNoProjeto()
    })
    return () => {
      parar()
      // Nunca lancar na limpeza: o erro derrubaria a janela inteira.
      try {
        useSolta.getState().gravarPendente()
        useDoProjeto.getState().gravarPendente()
        nucleo().telaCheia(false)
      } catch (err) {
        console.error('[thumb] limpeza da tela:', err)
      }
    }
  }, [aberta])

  if (!aberta) return null
  return createPortal(<JanelaDaThumb />, document.body)
}

/** O tamanho da janela antes da 1a medida (e no teste, sem ResizeObserver). */
const CAIXA_INICIAL = { largura: 1040, altura: 740 }
/** A coluna da direita nunca fica mais estreita que isto. */
const DIREITA_MIN = 460
/** Embaixo da previa: os avisos da area segura e o "Ver area segura". */
const AVISOS_DA_THUMB = 76

const nome = (c: string): string => c.split(/[\\/]/).pop() ?? c

/** A janela em si (exportada para o teste desenhar sem o portal). */
export function JanelaDaThumb() {
  const modo = useTela((s) => s.modo)
  const loja = lojaDo(modo)
  const janela = useRef<HTMLDivElement | null>(null)
  const [caixa, setCaixa] = useState(CAIXA_INICIAL)
  const projectPath = nucleo().usar((s) => s.projectPath)
  const temProjeto = nucleo().usar((s) => s.phase() !== 'empty')
  const fechar = (): void => useTela.getState().fechar()

  useEffect(() => {
    const el = janela.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const medir = (): void => {
      const r = el.getBoundingClientRect()
      setCaixa({ largura: Math.round(r.width - 40), altura: Math.round(r.height - 40) })
    }
    medir()
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Esc na SUBIDA, como a tela "Video pronto": com um modal do nucleo por cima (lido na descida), quem fecha e ele.
  useEffect(() => {
    let porCimaNaDescida = false
    const descida = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const foco = document.activeElement
      // A tela "Instalar motor" do recap por cima: o Esc e dela.
      const deOutro = foco !== null && foco !== document.body && !janela.current?.contains(foco)
      porCimaNaDescida = nucleo().haModalPorCima() || deOutro
    }
    const subida = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || porCimaNaDescida) return
      useTela.getState().fechar()
    }
    window.addEventListener('keydown', descida, true)
    window.addEventListener('keydown', subida)
    return () => {
      window.removeEventListener('keydown', descida, true)
      window.removeEventListener('keydown', subida)
    }
  }, [])

  const larguraMax = Math.max(200, caixa.largura - DIREITA_MIN - 20)
  const soltar = (caminhos: string[], slot: 0 | 1): void => void useTela.getState().soltar(caminhos, slot)
  const semProjeto = modo === 'projeto' && !temProjeto
  const larguraDaPrevia = Math.floor(Math.min(((caixa.altura - AVISOS_DA_THUMB) * 9) / 16, larguraMax))
  const subtitulo = modo === 'solta' ? 'Imagens do computador' : temProjeto ? nome(projectPath ?? 'Projeto sem nome') : 'Nenhum projeto aberto'

  return (
    <div className="fixed inset-0 z-[36] grid place-items-center bg-black/55 p-6" onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
      <ProvedorDoEditor loja={loja}>
        <div
          ref={janela}
          role="dialog"
          aria-modal="true"
          aria-label="Thumbnail"
          style={{ backgroundColor: 'var(--color-elevated)' }}
          className="glass enter flex h-[min(780px,100%)] w-[min(1180px,100%)] min-h-0 gap-5 rounded-lg p-5"
          data-thumb="tela"
        >
          {semProjeto ? (
            <div className="flex h-full shrink-0 flex-col justify-center" style={{ width: larguraDaPrevia }}>
              <div
                style={{ width: larguraDaPrevia, height: Math.floor((larguraDaPrevia * 16) / 9) }}
                className="grid place-items-center rounded-md border border-line bg-black/30 p-4 text-center text-[12px] text-ink-3"
              >
                <span>Escolha um projeto ao lado.</span>
              </div>
            </div>
          ) : (
            <PreviaDaThumb altura={Math.max(200, caixa.altura - AVISOS_DA_THUMB)} larguraMax={larguraMax} aoSoltar={soltar} />
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <header className="flex min-w-0 items-center gap-2.5">
              <Images size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
              <h2 className="shrink-0 text-[15px] font-medium text-ink">Thumbnail</h2>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3" title={modo === 'projeto' ? (projectPath ?? undefined) : undefined}>
                {subtitulo}
              </span>
              <div className="w-[236px] shrink-0" data-thumb="modos">
                <Segmentos
                  opcoes={[
                    { valor: 'solta' as const, rotulo: 'Imagens soltas', title: 'Cada imagem vem do computador' },
                    { valor: 'projeto' as const, rotulo: 'De um projeto', title: 'Os quadros limpos da linha do tempo de um projeto do Dangai' },
                  ]}
                  ativo={(v: ModoDaTela) => modo === v}
                  onChange={(v: ModoDaTela) => useTela.getState().trocarModo(v)}
                />
              </div>
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar"
                title="Fechar (Esc)"
                className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
              {modo === 'projeto' && <LinhaDoProjeto />}
              {!semProjeto && (
                <AjustesDaThumb
                  key={modo}
                  fontes={modo === 'solta' ? JEITOS_SOLTOS : JEITOS_DO_PROJETO}
                  extraDoSlot={<AvisoDoMotor />}
                  aoSoltar={soltar}
                />
              )}
            </div>

            <Rodape fechar={fechar} />
          </div>
        </div>
      </ProvedorDoEditor>
    </div>
  )
}

const JEITOS_SOLTOS: readonly FonteDaImagem[] = [
  {
    valor: 'arquivo',
    rotulo: 'Do computador',
    title: 'Uma imagem do PC',
    conteudo: ({ nomeDoSlot }) => (
      <DoComputador explicacao={`Vai para ${nomeDoSlot}. Ou solte a imagem na previa ou no cartao dela.`} />
    ),
  },
]

const JEITOS_DO_PROJETO: readonly FonteDaImagem[] = [
  {
    valor: 'sugestoes',
    rotulo: 'Sugestoes',
    title: 'Os melhores quadros das cenas do projeto (rosto, close, nitidez)',
    conteudo: () => (
      <GradeDeSugestoes
        carregandoTexto="Escolhendo os melhores quadros das cenas (rosto, close e nitidez)..."
        vazio="Nenhuma cena na linha do tempo para sugerir. Use um quadro do projeto ou uma imagem do computador."
      />
    ),
  },
  {
    valor: 'quadro',
    rotulo: 'Quadro do projeto',
    title: 'Qualquer instante da linha do tempo, tirado limpo da cena original (sem legenda)',
    conteudo: () => <QuadroDoProjeto />,
  },
  {
    valor: 'arquivo',
    rotulo: 'Do computador',
    title: 'Uma imagem do PC',
    conteudo: ({ nomeDoSlot }) => (
      <DoComputador explicacao={`Vai para ${nomeDoSlot} e e copiada para a pasta do projeto (thumb).`} />
    ),
  },
]

/** No modo projeto: qual projeto, onde o PNG vai, e o "Trocar". Sem projeto: a escolha. */
function LinhaDoProjeto() {
  const temProjeto = nucleo().usar((s) => s.phase() !== 'empty')
  const projectPath = nucleo().usar((s) => s.projectPath)
  const video = useTela((s) => s.video)
  const abrindo = useTela((s) => s.abrindoProjeto)
  const erro = useTela((s) => s.erroDoProjeto)
  if (!temProjeto) {
    return (
      <Secao titulo="Projeto">
        <p className="text-[12px] leading-relaxed text-ink-2">
          Escolha um projeto do Dangai (.dangai), de recap ou nao. Ele abre no editor, e as imagens da thumb saem limpas das cenas da linha do tempo.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Botao principal disabled={abrindo} onClick={() => void useTela.getState().escolherProjeto()} title="Abre o projeto no editor">
            {abrindo ? <Loader2 size={13} strokeWidth={1.5} className="animate-spin" /> : <FolderOpen size={13} strokeWidth={1.5} />}
            Escolher projeto...
          </Botao>
          {erro && <span className="text-[11px] text-[#f6a23c]">{erro}</span>}
        </div>
      </Secao>
    )
  }
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-3 py-2" data-thumb="projeto">
      <FileVideo size={14} strokeWidth={1.5} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={projectPath ?? undefined}>
        <span className="font-medium text-ink">{projectPath ? nome(projectPath) : 'Projeto sem nome'}</span>
        <span className="text-ink-3">{video ? ` - o PNG vai ao lado de ${nome(video)}` : ' - sem render ainda: o PNG vai onde voce escolher'}</span>
      </span>
      {erro && <span className="shrink-0 text-[11px] text-[#f6a23c]">{erro}</span>}
      <Link disabled={abrindo} onClick={() => void useTela.getState().escolherProjeto()} title="Abre outro projeto no editor">
        {abrindo ? 'Abrindo...' : 'Trocar projeto...'}
      </Link>
    </div>
  )
}

/**
 * Sem o motor de personagens: a imagem entra no meio, e um aviso discreto
 * com o "Instalar motor" (a tela do recap, emprestada quando ele esta ligado).
 */
function AvisoDoMotor() {
  const motor = useTela((s) => s.motor)
  const instalador = useInstaladorDoMotor((s) => s.instalador)
  useEffect(() => {
    if (!instalador) return
    return instalador.quandoFicarPronto(() => void useTela.getState().conferirMotor())
  }, [instalador])
  if (!motor || motor.pronto) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px] text-ink-3" data-thumb="aviso-do-motor" title={motor.motivo ?? undefined}>
      <ScanFace size={12} strokeWidth={1.5} className="shrink-0" />
      <span>Enquadramento automatico precisa do motor de personagens.</span>
      {instalador ? (
        <Botao pequeno onClick={() => instalador.abrir(() => void useTela.getState().conferirMotor())} title="Abre a instalacao do motor (a mesma do Gerar recap)">
          Instalar motor
        </Botao>
      ) : (
        <Link
          onClick={() => {
            useTela.getState().fechar()
            nucleo().abrirConfiguracoes('modulos')
          }}
          title="O motor e instalado pelo Gerar recap: ligue o modulo e instale por ele"
        >
          Ligar o Gerar recap
        </Link>
      )}
    </div>
  )
}

/**
 * Um instante qualquer da linha do tempo: a barra mostra as cenas do plano,
 * e o quadro sai LIMPO da cena de origem naquele instante (regra do Levi:
 * thumb nunca com legenda). No grid, ele escolhe a metade.
 */
function QuadroDoProjeto() {
  const plan = nucleo().usar((s) => s.plan)
  const images = nucleo().usar((s) => s.images)
  const plano = useMemo(() => ({ plan, images }), [plan, images])
  const duracao = useMemo(() => duracaoDoPlano(plano), [plano])
  const [tempo, setTempo] = useState(0)
  const [usando, setUsando] = useState<'a' | 'b' | null>(null)
  const [previa, setPrevia] = useState<{ chave: string; url: string } | null>(null)
  const [abrindo, setAbrindo] = useState(false)
  const barra = useRef<HTMLDivElement | null>(null)
  const cena = useMemo(() => cenaNoInstante(plano, tempo), [plano, tempo])
  // O quadro limpo do instante (um pouco depois de parar de arrastar: cada um vai para o cache).
  const alvo = cena ? `${cena.a.arquivo}|${(Math.round(cena.a.t * 10) / 10).toFixed(1)}` : null
  useEffect(() => {
    if (!cena || !alvo) return
    let vale = true
    setAbrindo(true)
    const t = setTimeout(() => {
      void ponte
        .quadro({ arquivo: cena.a.arquivo, t: Math.round(cena.a.t * 10) / 10 })
        .then((r) => {
          if (!vale) return
          setAbrindo(false)
          if (!r.ok) return
          const url = URL.createObjectURL(new Blob([r.value.previa as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }))
          setPrevia((antes) => {
            if (antes) URL.revokeObjectURL(antes.url)
            return { chave: alvo, url }
          })
        })
        .catch(() => vale && setAbrindo(false))
    }, 180)
    return () => {
      vale = false
      clearTimeout(t)
    }
  }, [alvo])
  // A ultima previa sai junto com a peca.
  const ultima = useRef<string | null>(null)
  ultima.current = previa?.url ?? null
  useEffect(
    () => () => {
      if (ultima.current) URL.revokeObjectURL(ultima.current)
    },
    [],
  )

  const scenes = plan?.scenes ?? []
  if (scenes.length === 0 || duracao <= 0) return <p className="text-[12px] text-ink-3">Esse projeto ainda nao tem cenas na linha do tempo.</p>
  const irPara = (clientX: number): void => {
    const el = barra.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setTempo(Math.max(0, Math.min(duracao - 0.001, ((clientX - r.left) / Math.max(1, r.width)) * duracao)))
  }
  const usar = (metade: 'a' | 'b'): void => {
    setUsando(metade)
    void useDoProjeto
      .getState()
      .usarQuadroDoVideo(tempo, metade)
      .finally(() => setUsando(null))
  }
  const botao = (metade: 'a' | 'b', rotulo: string, title: string) => (
    <Botao disabled={usando !== null || !cena} onClick={() => usar(metade)} title={title}>
      {usando === metade ? <Loader2 size={13} strokeWidth={1.5} className="animate-spin" /> : <Sparkles size={13} strokeWidth={1.5} />}
      {rotulo}
    </Botao>
  )
  const atual = scenes.findIndex((s) => tempo >= s.start && tempo < s.end)
  return (
    <div className="flex items-start gap-3" data-thumb="quadro-do-projeto">
      <span className="relative block aspect-video w-[176px] shrink-0 overflow-hidden rounded-sm bg-black">
        {previa && <img src={previa.url} alt="" className="size-full object-contain" />}
        {abrindo && <Loader2 size={14} strokeWidth={1.5} className="absolute right-1.5 top-1.5 animate-spin text-ink-2" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-0.5">
        <div className="flex items-center gap-2">
          <span className="tnum w-10 shrink-0 text-right text-[11px] text-ink-3">{formatarTempo(tempo, 1)}</span>
          <div
            ref={barra}
            role="slider"
            tabIndex={0}
            aria-label="Instante do projeto"
            aria-valuemin={0}
            aria-valuemax={Math.round(duracao * 10) / 10}
            aria-valuenow={Math.round(tempo * 10) / 10}
            data-thumb="barra-do-projeto"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              irPara(e.clientX)
            }}
            onPointerMove={(e) => {
              if (e.buttons & 1) irPara(e.clientX)
            }}
            onKeyDown={(e) => {
              const passo = e.shiftKey ? 1 : 1 / 10
              if (e.key === 'ArrowRight') setTempo((t) => Math.min(duracao - 0.001, t + passo))
              else if (e.key === 'ArrowLeft') setTempo((t) => Math.max(0, t - passo))
              else return
              e.preventDefault()
            }}
            className="relative h-7 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-sm border border-line bg-surface focus:border-line-strong focus:outline-none"
          >
            {scenes.map((s, i) => (
              <span
                key={i}
                title={`Cena ${i + 1} - ${formatarTempo(s.start, 1)}`}
                style={{ left: `${(s.start / duracao) * 100}%`, width: `${((s.end - s.start) / duracao) * 100}%` }}
                className={[
                  'absolute inset-y-0 border-r border-line',
                  i === atual ? 'bg-accent-dim' : i % 2 ? 'bg-elevated' : 'bg-surface',
                ].join(' ')}
              />
            ))}
            <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${(tempo / duracao) * 100}%` }} />
          </div>
          <span className="tnum w-10 shrink-0 text-[11px] text-ink-3">{formatarTempo(duracao, 1)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cena?.b ? (
            <>
              {botao('a', 'Metade de cima', `Tira o quadro limpo de ${cena.a.nome} em ${formatarTempo(cena.a.t, 1)}`)}
              {botao('b', 'Metade de baixo', `Tira o quadro limpo de ${cena.b.nome} em ${formatarTempo(cena.b.t, 1)}`)}
            </>
          ) : (
            botao('a', 'Usar este quadro', cena ? `Tira o quadro limpo de ${cena.a.nome} em ${formatarTempo(cena.a.t, 1)}` : '')
          )}
        </div>
        <p className="text-[11px] leading-snug text-ink-3" data-thumb="cena-no-instante">
          {cena
            ? `Cena ${atual + 1}: sai limpo, sem legenda, ${cena.b ? 'o grid tem duas cenas, escolha a metade' : `de ${cena.a.nome.replace(/\.[^.]+$/, '')} em ${formatarTempo(cena.a.t, 1)}`}.`
            : 'Esse instante nao tem cena no plano do projeto.'}
        </p>
      </div>
    </div>
  )
}

/** O rodape: para onde o PNG vai depende do jeito (e do render do projeto). */
function Rodape({ fechar }: { fechar: () => void }) {
  const modo = useTela((s) => s.modo)
  const video = useTela((s) => s.video)
  const temProjeto = nucleo().usar((s) => s.phase() !== 'empty')
  const projectPath = nucleo().usar((s) => s.projectPath)
  const imagem = useSolta((s) => s.thumb?.imagens[0]?.arquivo ?? s.thumb?.imagens[1]?.arquivo ?? null)
  if (modo === 'solta') {
    return (
      <RodapeDaThumb
        fechar={fechar}
        destino="1080x1920. O Salvar pergunta onde (abre na pasta da imagem)."
        tituloDoSalvar="Escolha onde gravar o PNG 1080x1920"
        podeSalvar
        alvoDaPasta={imagem}
      />
    )
  }
  return (
    <RodapeDaThumb
      fechar={fechar}
      destino={!temProjeto ? 'Escolha um projeto para comecar.' : video ? '1080x1920, ao lado do video do projeto.' : '1080x1920. Sem render ainda: o Salvar pergunta onde.'}
      tituloDoSalvar={video ? `Grava ${nome(video).replace(/\.[^.]+$/, '')}-thumb.png na pasta do video` : 'Escolha onde gravar o PNG 1080x1920'}
      podeSalvar={temProjeto && haProjetoAberto()}
      alvoDaPasta={video ?? projectPath}
    />
  )
}
