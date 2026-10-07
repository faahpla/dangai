import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Blend,
  ChevronsLeft,
  ChevronsRight,
  Download,
  MoveHorizontal,
  Scissors,
  Sun,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  AJUSTE_DA_TRANSICAO_PADRAO,
  framesDaTransicao,
  TRANSITIONS_NA_TELA,
  VIDEO_FPS,
  type AjusteDaTransicao,
  type Transition,
} from '@shared/contract'
import { useProject } from '@/store/project'
import {
  ajustarEmenda,
  aplicarNaEmenda,
  iniciarArrasteDeTransicao,
  lerEmenda,
  TRANSITION_LABEL,
  usePresetsDeTransicao,
} from '@/store/transicoes'
import { Deslizante } from './painel'

/**
 * O EDITOR DE UMA EMENDA: abre no botao direito entre dois blocos, num clique
 * na marca da transicao, ou no botao "Transicao" da barra. "Deixa essas
 * transicoes serem aplicadas de forma facil, tanto drag and drop quanto
 * clicando na intersecao dos blocos com botao direito."
 *
 * Em cima, as transicoes (clique aplica; arrastar leva para outra emenda). Em
 * baixo, o ajuste da que esta aplicada: duracao, intensidade, borrao de
 * movimento e, na luz, a cor. Por fim os presets -- guardar, aplicar,
 * exportar, importar.
 */

export function IconeDaTransicao({ tipo, size = 13 }: { tipo: Transition; size?: number }) {
  const props = { size, strokeWidth: 1.75 }
  switch (tipo) {
    case 'cut':
      return <Scissors {...props} />
    case 'crossfade':
      return <Blend {...props} />
    case 'zoom-in':
      return <ZoomIn {...props} />
    case 'zoom-out':
      return <ZoomOut {...props} />
    case 'light':
      return <Sun {...props} />
    case 'pan-left':
      return <ArrowLeft {...props} />
    case 'pan-right':
      return <ArrowRight {...props} />
    case 'pan-up':
      return <ArrowUp {...props} />
    case 'pan-down':
      return <ArrowDown {...props} />
    case 'slide-left':
      return <ChevronsLeft {...props} />
    case 'slide-right':
      return <ChevronsRight {...props} />
    default:
      return <MoveHorizontal {...props} />
  }
}

/** As transicoes em grade: clique escolhe, arrastar leva para uma emenda da linha do tempo. */
export function PaletaDeTransicoes({
  atual,
  onEscolher,
}: {
  atual?: Transition
  onEscolher: (t: Transition) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {TRANSITIONS_NA_TELA.map((t) => (
        <button
          key={t}
          type="button"
          draggable={t !== 'cut'}
          onDragStart={(e) => iniciarArrasteDeTransicao(e, { tipo: t })}
          onClick={() => onEscolher(t)}
          title={t === 'cut' ? 'Sem transicao' : `${TRANSITION_LABEL[t]} -- clique aplica, ou arraste ate um corte da linha do tempo`}
          className={[
            'flex flex-col items-center gap-1 rounded-sm border px-1 py-1.5 text-[10px] leading-none transition-colors',
            atual === t ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:border-line-strong hover:text-ink',
            t === 'cut' ? '' : 'cursor-grab active:cursor-grabbing',
          ].join(' ')}
        >
          <IconeDaTransicao tipo={t} />
          <span className="truncate">{TRANSITION_LABEL[t]}</span>
        </button>
      ))}
    </div>
  )
}

const CORES_DA_LUZ = ['#ffe6c4', '#ffffff', '#ffd27a', '#ff9e6b', '#ff7ab8', '#8fd3ff'] as const

/** Os sliders do ajuste de uma transicao. Serve a emenda e o preset. */
export function AjusteDaTransicaoCampos({
  tipo,
  ajuste,
  onChange,
}: {
  tipo: Transition
  ajuste: AjusteDaTransicao | undefined
  onChange: (parcial: AjusteDaTransicao) => void
}) {
  const frames = framesDaTransicao(tipo, ajuste)
  const intensidade = ajuste?.intensidade ?? AJUSTE_DA_TRANSICAO_PADRAO.intensidade
  const borrao = ajuste?.borrao ?? AJUSTE_DA_TRANSICAO_PADRAO.borrao
  const cor = ajuste?.cor ?? AJUSTE_DA_TRANSICAO_PADRAO.cor
  const linha = 'flex items-center gap-2'
  const rotulo = 'w-[74px] shrink-0 text-[11px] text-ink-2'
  return (
    <div className="flex flex-col gap-1.5">
      <div className={linha}>
        <span className={rotulo}>Duracao</span>
        <Deslizante
          valor={frames}
          min={2}
          max={72}
          step={1}
          onChange={(v) => onChange({ frames: v })}
          texto={`${(frames / VIDEO_FPS).toFixed(2)}s`}
        />
      </div>
      {tipo !== 'crossfade' && (
        <div className={linha}>
          <span className={rotulo}>{tipo === 'light' ? 'Forca da luz' : 'Intensidade'}</span>
          <Deslizante
            valor={intensidade}
            min={0}
            max={1}
            step={0.01}
            padrao={AJUSTE_DA_TRANSICAO_PADRAO.intensidade}
            onChange={(v) => onChange({ intensidade: v })}
            texto={`${Math.round(intensidade * 100)}%`}
          />
        </div>
      )}
      {tipo !== 'crossfade' && tipo !== 'light' && (
        <div className={linha}>
          <span className={rotulo} title="O rastro do movimento: 0 = imagem nitida, 100% = obturador aberto o quadro inteiro">
            Motion blur
          </span>
          <Deslizante
            valor={borrao}
            min={0}
            max={1}
            step={0.01}
            padrao={AJUSTE_DA_TRANSICAO_PADRAO.borrao}
            onChange={(v) => onChange({ borrao: v })}
            texto={`${Math.round(borrao * 100)}%`}
          />
        </div>
      )}
      {tipo === 'light' && (
        <div className={linha}>
          <span className={rotulo}>Cor da luz</span>
          <div className="flex flex-1 items-center gap-1">
            {CORES_DA_LUZ.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ cor: c })}
                aria-label={`Luz ${c}`}
                className={[
                  'size-[18px] rounded-full border',
                  cor.toLowerCase() === c ? 'border-accent ring-1 ring-accent' : 'border-line',
                ].join(' ')}
                style={{ background: c }}
              />
            ))}
            <input
              type="color"
              value={cor}
              onChange={(e) => onChange({ cor: e.target.value })}
              aria-label="Outra cor"
              title="Outra cor"
              className="ml-auto h-[18px] w-7 cursor-pointer rounded-sm border border-line bg-transparent"
            />
          </div>
        </div>
      )}
    </div>
  )
}

const SEM_CENAS: never[] = []

function tituloDaEmenda(e: number, n: number): string {
  if (e === 0) return 'Entrada do video (bloco 1)'
  if (e === n) return `Saida do video (bloco ${n})`
  return `Corte entre o bloco ${e} e o ${e + 1}`
}

/** Os presets de transicao: aplicar, guardar o que esta na emenda, exportar, importar, esquecer. */
function PresetsDeTransicao({ onAplicar, atual }: { onAplicar: (p: { tipo: Transition; ajuste: AjusteDaTransicao }) => void; atual: { tipo: Transition; ajuste: AjusteDaTransicao | undefined } | null }) {
  const lista = usePresetsDeTransicao((s) => s.lista)
  const carregado = usePresetsDeTransicao((s) => s.carregado)
  const carregar = usePresetsDeTransicao((s) => s.carregar)
  const salvar = usePresetsDeTransicao((s) => s.salvar)
  const remover = usePresetsDeTransicao((s) => s.remover)
  const exportar = usePresetsDeTransicao((s) => s.exportar)
  const importar = usePresetsDeTransicao((s) => s.importar)
  const [nome, setNome] = useState('')
  const [recado, setRecado] = useState<string | null>(null)
  useEffect(() => {
    if (!carregado) void carregar()
  }, [carregado, carregar])

  const podeSalvar = atual !== null && atual.tipo !== 'cut'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className="flex-1 text-[10px] uppercase tracking-wide text-ink-3">Presets de transicao</span>
        <button
          type="button"
          onClick={() => void importar().then(setRecado)}
          title="Importar um preset (.dangai-transicao)"
          className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-ink-3 hover:text-ink"
        >
          <Upload size={11} strokeWidth={1.75} />
          Importar
        </button>
      </div>
      {lista.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {lista.map((p) => (
            <span
              key={p.nome}
              draggable
              onDragStart={(e) => iniciarArrasteDeTransicao(e, { tipo: p.tipo, ajuste: p.ajuste })}
              className="group/pt flex cursor-grab items-center rounded-sm border border-line bg-elevated"
            >
              <button
                type="button"
                onClick={() => onAplicar(p)}
                title={`${TRANSITION_LABEL[p.tipo]} -- clique aplica, ou arraste ate um corte`}
                className="flex items-center gap-1 py-1 pl-1.5 pr-1 text-[11px] text-ink-2 hover:text-ink"
              >
                <IconeDaTransicao tipo={p.tipo} size={11} />
                {p.nome}
              </button>
              <button
                type="button"
                onClick={() => void exportar(p.nome).then(setRecado)}
                aria-label={`Exportar o preset ${p.nome}`}
                title="Exportar"
                className="px-0.5 text-ink-3 opacity-0 hover:text-ink group-hover/pt:opacity-100"
              >
                <Download size={10} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => void remover(p.nome)}
                aria-label={`Esquecer o preset ${p.nome}`}
                title="Esquecer"
                className="pl-0.5 pr-1 text-ink-3 opacity-0 hover:text-danger group-hover/pt:opacity-100"
              >
                <X size={10} strokeWidth={1.75} />
              </button>
            </span>
          ))}
        </div>
      )}
      {podeSalvar && (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (!nome.trim() || !atual) return
            void salvar(nome, atual.tipo, atual.ajuste).then(() => setRecado(`"${nome.trim()}" guardado.`))
            setNome('')
          }}
        >
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Guardar esta como preset..."
            aria-label="Nome do preset de transicao"
            className="min-w-0 flex-1 rounded-sm border border-line bg-bg px-2 py-1 text-[11px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
          />
          <button
            type="submit"
            disabled={!nome.trim()}
            className="rounded-sm border border-line bg-elevated px-2 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40"
          >
            Salvar
          </button>
        </form>
      )}
      {recado && <p className="text-[10px] text-ink-3">{recado}</p>}
    </div>
  )
}

/**
 * O editor flutuante de uma emenda, no ponto da tela onde ele clicou. Fecha no
 * Esc, num clique fora ou no X.
 */
export function EditorDaEmenda({
  emenda,
  x,
  y,
  onFechar,
  topo,
  ignorar,
}: {
  emenda: number
  x: number
  y: number
  onFechar: () => void
  /** Algo entre o titulo e as transicoes (o botao da barra poe Entrada/Saida aqui). */
  topo?: React.ReactNode
  /** Um clique NESTE elemento nao conta como "fora" (o botao que abre e fecha). */
  ignorar?: React.RefObject<HTMLElement | null>
}) {
  const scenes = useProject((s) => s.plan)?.scenes ?? SEM_CENAS
  const duracao = useProject((s) => s.audio?.durationSec ?? 0)
  const painel = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Cabe na janela: abre para cima/esquerda quando o clique foi perto da borda.
  useLayoutEffect(() => {
    const el = painel.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(x - r.width / 2, window.innerWidth - r.width - 8))
    const top = y + r.height + 12 > window.innerHeight ? Math.max(8, y - r.height - 12) : y + 12
    setPos({ left, top })
  }, [x, y])

  useEffect(() => {
    const fora = (e: PointerEvent): void => {
      if (ignorar?.current?.contains(e.target as Node)) return
      if (painel.current && !painel.current.contains(e.target as Node)) onFechar()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onFechar()
    }
    window.addEventListener('pointerdown', fora, true)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', fora, true)
      window.removeEventListener('keydown', esc)
    }
  }, [onFechar, ignorar])

  const atual = lerEmenda(scenes, emenda, duracao)
  if (!atual) return null

  return createPortal(
    <div
      ref={painel}
      role="dialog"
      aria-label="Transicao"
      onContextMenu={(e) => e.preventDefault()}
      className="glass enter fixed z-[70] flex w-[340px] flex-col gap-3 rounded-md p-3"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11px] font-medium text-ink">{tituloDaEmenda(emenda, scenes.length)}</span>
        <button type="button" onClick={onFechar} aria-label="Fechar" className="text-ink-3 hover:text-ink">
          <X size={13} strokeWidth={1.75} />
        </button>
      </div>

      {topo}
      <PaletaDeTransicoes atual={atual.tipo} onEscolher={(t) => aplicarNaEmenda(emenda, t)} />

      {atual.tipo !== 'cut' && (
        <>
          <AjusteDaTransicaoCampos
            tipo={atual.tipo}
            ajuste={atual.ajuste}
            onChange={(parcial) => ajustarEmenda(emenda, parcial)}
          />
          {(emenda === 0 || emenda === scenes.length) && (
            <p className="text-[10px] leading-snug text-ink-3">
              {emenda === 0
                ? 'Na entrada do video a imagem chega do preto (ou da luz).'
                : 'Na saida do video a imagem vai para o preto (ou para a luz).'}
            </p>
          )}
        </>
      )}

      <div className="border-t border-line pt-2.5">
        <PresetsDeTransicao
          atual={atual}
          onAplicar={(p) => aplicarNaEmenda(emenda, p.tipo, p.ajuste)}
        />
      </div>
    </div>,
    document.body,
  )
}
