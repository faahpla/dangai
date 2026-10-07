import { useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkPlus, RotateCcw, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  AJUSTE_DE_COR_PADRAO,
  CURVA_DE_COR_RETA,
  type AjusteDeCor,
  type PontoDeCurvaDeCor,
} from '@shared/contract'
import { curvaInterpolada } from '@shared/cor'
import { idsEscolhidos, useProject } from '@/store/project'
import { usePresetsDeCor } from '@/store/presets-de-cor'
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
  const sobreposicoes = useProject((s) => s.sobreposicoes)
  const escolhidos = useProject(useShallow((s) => idsEscolhidos(s, 'video')))
  const presets = usePresetsDeCor((s) => s.lista)
  const carregarPresets = usePresetsDeCor((s) => s.carregar)
  const salvarPreset = usePresetsDeCor((s) => s.salvar)
  const removerPreset = usePresetsDeCor((s) => s.remover)
  const [canal, setCanal] = useState<keyof AjusteDeCor['curvas']>('mestre')
  const [nomeNovo, setNomeNovo] = useState<string | null>(null)
  useEffect(() => void carregarPresets(), [carregarPresets])
  if (!o) return null
  const cor = o.cor ?? AJUSTE_DE_COR_PADRAO

  /*
   * VARIAS CAMADAS ESCOLHIDAS: cada mexida vale para todas, e cada uma guarda
   * o resto do proprio ajuste -- mexer no contraste de tres camadas nao copia
   * a saturacao de uma para as outras.
   */
  const alvos = escolhidos.filter((x) => sobreposicoes.find((y) => y.id === x)?.tipo === 'ajuste')
  const paraCada = (f: (atual: AjusteDeCor) => AjusteDeCor): void => {
    for (const alvo of alvos.length > 0 ? alvos : [id]) {
      const atual = sobreposicoes.find((y) => y.id === alvo)?.cor ?? AJUSTE_DE_COR_PADRAO
      ajustar(alvo, { cor: f(atual) })
    }
  }
  const mudar = (patch: Partial<AjusteDeCor>): void => paraCada((atual) => ({ ...atual, ...patch }))
  const mudarCurva = (pontos: PontoDeCurvaDeCor[]): void =>
    paraCada((atual) => ({ ...atual, curvas: { ...atual.curvas, [canal]: pontos } }))
  const mudarClipe = (patch: { fadeInSec?: number; fadeOutSec?: number }): void => {
    for (const alvo of alvos.length > 0 ? alvos : [id]) ajustar(alvo, patch)
  }

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
          {alvos.length > 1 && (
            <p className="text-[11px] text-accent">{alvos.length} camadas escolhidas -- mexer aqui muda todas.</p>
          )}
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
          <Linha label="Fade entra" title="A correcao entra aos poucos nesse tempo">
            <Deslizante
              valor={o.fadeInSec ?? 0}
              min={0}
              max={Math.max(0.1, toca)}
              step={0.05}
              padrao={0}
              texto={`${(o.fadeInSec ?? 0).toFixed(2)}s`}
              onChange={(x) => mudarClipe({ fadeInSec: x })}
            />
          </Linha>
          <Linha label="Fade sai" title="A correcao sai aos poucos nesse tempo">
            <Deslizante
              valor={o.fadeOutSec ?? 0}
              min={0}
              max={Math.max(0.1, toca)}
              step={0.05}
              padrao={0}
              texto={`${(o.fadeOutSec ?? 0).toFixed(2)}s`}
              onChange={(x) => mudarClipe({ fadeOutSec: x })}
            />
          </Linha>
        </Grupo>

        {/*
          PRESETS DE COR: "salvar preset da Color Correction que eu fizer".
          Valem para todos os projetos. Um clique aplica o preset inteiro
          (curvas incluidas); salvar com um nome que ja existe substitui.
        */}
        <Grupo
          titulo="Presets"
          acao={
            nomeNovo === null ? (
              <Botaozinho onClick={() => setNomeNovo('')} title="Guarda este ajuste com um nome">
                <BookmarkPlus size={11} strokeWidth={1.5} />
                Salvar preset
              </Botaozinho>
            ) : undefined
          }
        >
          {nomeNovo !== null && (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={nomeNovo}
                onChange={(e) => setNomeNovo(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && nomeNovo.trim()) {
                    void salvarPreset(nomeNovo, cor)
                    setNomeNovo(null)
                  } else if (e.key === 'Escape') setNomeNovo(null)
                }}
                placeholder="Nome do preset (Enter salva)"
                aria-label="Nome do preset de cor"
                className="h-6 min-w-0 flex-1 rounded-sm border border-line bg-elevated px-2 text-[11px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
              />
              <Botaozinho
                onClick={() => {
                  if (nomeNovo.trim()) void salvarPreset(nomeNovo, cor)
                  setNomeNovo(null)
                }}
              >
                Salvar
              </Botaozinho>
            </div>
          )}
          {presets.length === 0 ? (
            <p className="text-[10px] text-ink-3">Nenhum preset ainda. Ajuste a cor e clique em Salvar preset.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {presets.map((p) => (
                <div
                  key={p.nome}
                  className="flex h-6 max-w-[160px] items-center rounded-sm border border-line bg-elevated text-[11px] text-ink-2"
                >
                  <button
                    type="button"
                    onClick={() => paraCada(() => ({ ...p.cor }))}
                    title={`Aplicar "${p.nome}"`}
                    className="min-w-0 truncate pl-2 pr-1 hover:text-ink"
                  >
                    {p.nome}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removerPreset(p.nome)}
                    title={`Esquecer "${p.nome}"`}
                    aria-label={`Esquecer o preset ${p.nome}`}
                    className="grid h-full w-5 shrink-0 place-items-center text-ink-3 hover:text-danger"
                  >
                    <X size={10} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          )}
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
              onClick={() => mudarCurva(CURVA_DE_COR_RETA.map((p) => ({ ...p })))}
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
            onChange={mudarCurva}
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
