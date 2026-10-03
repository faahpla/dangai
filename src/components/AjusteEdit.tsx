import { useMemo, useRef, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import {
  AJUSTE_DE_COR_PADRAO,
  CURVA_DE_COR_RETA,
  type AjusteDeCor,
  type PontoDeCurvaDeCor,
} from '@shared/contract'
import { curvaInterpolada } from '@shared/cor'
import { useProject } from '@/store/project'
import { Botaozinho, Deslizante, Grupo, Linha, Segmentos } from './painel'

/**
 * O INSPETOR DA CAMADA DE AJUSTE: a correcao de cor.
 *
 * "Quero criar tipo uma adjustment layer na track de video e fazer a minha
 * color correction nela: Curves, brightness e contrast, highlights, sharpen,
 * saturacao e vibrance, exposure e essas coisas." Os controles seguem a ordem
 * do Lightroom/DaVinci -- luz, depois cor, depois detalhe -- e as curvas
 * ficam ao lado, com um canal por vez.
 *
 * Tudo vale para o que estiver EMBAIXO da camada, no trecho que ela ocupa.
 */
export function AjusteEdit({ id }: { id: string }) {
  const o = useProject((s) => s.sobreposicoes.find((x) => x.id === id))
  const ajustar = useProject((s) => s.ajustarSobreposicao)
  const selecionar = useProject((s) => s.selecionarClipe)
  const [canal, setCanal] = useState<keyof AjusteDeCor['curvas']>('mestre')
  if (!o) return null
  const cor = o.cor ?? AJUSTE_DE_COR_PADRAO
  const mudar = (patch: Partial<AjusteDeCor>): void => ajustar(id, { cor: { ...cor, ...patch } })

  /**
   * Um controle de -100 a 100, com o duplo clique voltando ao zero. Funcao, e
   * nao componente: um componente criado aqui dentro seria outro a cada render,
   * e o slider sendo arrastado seria desmontado no meio do gesto.
   */
  const lado = (campo: keyof AjusteDeCor, nome: string, dica?: string) => {
    const v = cor[campo] as number
    return (
      <Linha key={campo} label={nome} title={dica}>
        <Deslizante
          valor={v}
          min={-1}
          max={1}
          step={0.01}
          padrao={0}
          texto={`${v > 0 ? '+' : ''}${Math.round(v * 100)}`}
          onChange={(x) => mudar({ [campo]: x })}
        />
      </Linha>
    )
  }

  const toca = o.usarSec ?? o.durationSec - o.inicioSec

  return (
    <div className="enter grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
        <Grupo
          titulo={`Camada de ajuste · V${o.faixa + 1}`}
          acao={
            <>
              <Botaozinho onClick={() => mudar({ ...AJUSTE_DE_COR_PADRAO })} title="Zera todos os ajustes e as curvas">
                <RotateCcw size={11} strokeWidth={1.5} />
                Zerar
              </Botaozinho>
              <button
                type="button"
                onClick={() => selecionar(null)}
                aria-label="Fechar a camada e voltar ao bloco"
                title="Voltar aos controles do bloco"
                className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink"
              >
                <X size={12} strokeWidth={1.75} />
              </button>
            </>
          }
        >
          <p className="text-[10px] leading-snug text-ink-3">
            Corrige tudo o que esta embaixo dela (as cenas e as faixas de video de numero menor) durante{' '}
            <span className="tnum">{toca.toFixed(2)}s</span>. Estique ou arraste na linha do tempo.
          </p>
          <Linha label="Intensidade" title="Quanto do ajuste vale: 0% e o original">
            <Deslizante
              valor={cor.intensidade}
              min={0}
              max={1}
              step={0.01}
              padrao={1}
              texto={`${Math.round(cor.intensidade * 100)}%`}
              onChange={(x) => mudar({ intensidade: x })}
            />
          </Linha>
        </Grupo>

        <Grupo titulo="Luz">
          <Linha label="Exposicao" title="Em stops: +1 dobra a luz">
            <Deslizante
              valor={cor.exposicao}
              min={-3}
              max={3}
              step={0.05}
              padrao={0}
              texto={`${cor.exposicao > 0 ? '+' : ''}${cor.exposicao.toFixed(2)}`}
              onChange={(x) => mudar({ exposicao: x })}
            />
          </Linha>
          {lado('brilho', 'Brilho', 'Clareia ou escurece o meio-tom, sem estourar as pontas')}
          {lado('contraste', 'Contraste')}
          {lado('realces', 'Realces', 'Highlights: as partes claras')}
          {lado('sombras', 'Sombras', 'Shadows: as partes escuras')}
          {lado('brancos', 'Brancos')}
          {lado('pretos', 'Pretos')}
        </Grupo>

        <Grupo titulo="Cor">
          {lado('temperatura', 'Temperatura', 'Negativo esfria (azul), positivo esquenta (laranja)')}
          {lado('tint', 'Tint', 'Negativo puxa para o verde, positivo para o magenta')}
          {lado('saturacao', 'Saturacao', '-100 deixa preto e branco')}
          {lado('vibrance', 'Vibrance', 'Satura mais o que tem pouca cor e poupa o que ja e saturado, como pele')}
        </Grupo>

        <Grupo titulo="Detalhe">
          <Linha label="Nitidez" title="Sharpen">
            <Deslizante
              valor={cor.nitidez}
              min={0}
              max={1}
              step={0.01}
              padrao={0}
              texto={`${Math.round(cor.nitidez * 100)}`}
              onChange={(x) => mudar({ nitidez: x })}
            />
          </Linha>
        </Grupo>
      </div>

      <div className="min-h-0 overflow-y-auto pr-1">
        <Grupo
          titulo="Curvas"
          acao={
            <Botaozinho
              onClick={() => mudar({ curvas: { ...cor.curvas, [canal]: CURVA_DE_COR_RETA.map((p) => ({ ...p })) } })}
              title="Volta este canal para a reta"
            >
              <RotateCcw size={11} strokeWidth={1.5} />
              Reta
            </Botaozinho>
          }
        >
          <Segmentos
            opcoes={(['mestre', 'r', 'g', 'b'] as const).map((c) => ({
              valor: c,
              rotulo: c === 'mestre' ? 'RGB' : c.toUpperCase(),
              title: c === 'mestre' ? 'Os tres canais juntos (luminosidade)' : `So o canal ${c.toUpperCase()}`,
            }))}
            ativo={(c) => c === canal}
            onChange={setCanal}
          />
          <EditorDeCurva
            pontos={cor.curvas[canal]}
            traco={CORES_DO_CANAL[canal]}
            onChange={(pontos) => mudar({ curvas: { ...cor.curvas, [canal]: pontos } })}
          />
          <p className="text-[10px] leading-snug text-ink-3">
            Clique na linha para criar um ponto e arraste. Dois cliques num ponto o tiram. Esquerda sao as sombras,
            direita os realces; subir clareia.
          </p>
        </Grupo>
      </div>
    </div>
  )
}

const CORES_DO_CANAL: Record<keyof AjusteDeCor['curvas'], string> = {
  mestre: '#e8e8ea',
  r: '#ff5c5c',
  g: '#5ce07a',
  b: '#5c9dff',
}

/**
 * O grafico de uma curva: x e o tom que entra, y o que sai. Os pontos das
 * pontas so andam na vertical (o preto e o branco de entrada sao fixos); os do
 * meio andam livres entre os vizinhos.
 */
function EditorDeCurva({
  pontos,
  traco,
  onChange,
}: {
  pontos: readonly PontoDeCurvaDeCor[]
  traco: string
  onChange: (pontos: PontoDeCurvaDeCor[]) => void
}) {
  const area = useRef<SVGSVGElement>(null)
  const [pegando, setPegando] = useState<number | null>(null)
  const ordenados = useMemo(() => [...pontos].sort((a, b) => a.x - b.x), [pontos])
  const caminho = useMemo(() => {
    const f = curvaInterpolada(ordenados)
    return Array.from({ length: 101 }, (_, i) => {
      const x = i / 100
      const y = Math.min(Math.max(f(x), 0), 1)
      return `${i === 0 ? 'M' : 'L'} ${x * 100} ${100 - y * 100}`
    }).join(' ')
  }, [ordenados])

  const noGrafico = (event: { clientX: number; clientY: number }): PontoDeCurvaDeCor | null => {
    const r = area.current?.getBoundingClientRect()
    if (!r) return null
    const c = (v: number): number => Math.min(Math.max(v, 0), 1)
    return { x: c((event.clientX - r.left) / r.width), y: c(1 - (event.clientY - r.top) / r.height) }
  }

  const mover = (i: number, p: PontoDeCurvaDeCor): void => {
    const novo = ordenados.map((q) => ({ ...q }))
    const ultimo = novo.length - 1
    const x = i === 0 ? 0 : i === ultimo ? 1 : Math.min(Math.max(p.x, novo[i - 1]!.x + 0.01), novo[i + 1]!.x - 0.01)
    novo[i] = { x, y: p.y }
    onChange(novo)
  }

  return (
    <svg
      ref={area}
      viewBox="0 0 100 100"
      className="aspect-square w-full max-w-[300px] touch-none select-none self-center overflow-visible rounded-sm bg-elevated"
      onPointerDown={(event) => {
        // Clique no vazio: ponto novo ali, ja pego para arrastar.
        const p = noGrafico(event)
        if (!p || ordenados.length >= 16) return
        if (ordenados.some((q) => Math.abs(q.x - p.x) < 0.02)) return
        const novo = [...ordenados.map((q) => ({ ...q })), p].sort((a, b) => a.x - b.x)
        onChange(novo)
        setPegando(novo.findIndex((q) => q === p || (q.x === p.x && q.y === p.y)))
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (pegando === null) return
        const p = noGrafico(event)
        if (p) mover(pegando, p)
      }}
      onPointerUp={() => setPegando(null)}
      onPointerCancel={() => setPegando(null)}
    >
      {[25, 50, 75].map((v) => (
        <g key={v} className="stroke-line" strokeWidth={0.4}>
          <line x1={v} y1={0} x2={v} y2={100} />
          <line x1={0} y1={v} x2={100} y2={v} />
        </g>
      ))}
      <line x1={0} y1={100} x2={100} y2={0} className="stroke-line-strong" strokeWidth={0.5} strokeDasharray="2 2" />
      <path d={caminho} fill="none" stroke={traco} strokeWidth={1.2} />
      {ordenados.map((p, i) => (
        <circle
          key={i}
          cx={p.x * 100}
          cy={100 - p.y * 100}
          r={pegando === i ? 2.6 : 2.1}
          fill={traco}
          stroke="#000"
          strokeWidth={0.5}
          className="cursor-grab"
          onPointerDown={(event) => {
            event.stopPropagation()
            setPegando(i)
            area.current?.setPointerCapture(event.pointerId)
          }}
          onDoubleClick={(event) => {
            event.stopPropagation()
            if (i === 0 || i === ordenados.length - 1) return
            onChange(ordenados.filter((_, j) => j !== i).map((q) => ({ ...q })))
            setPegando(null)
          }}
        />
      ))}
    </svg>
  )
}
