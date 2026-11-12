import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Diamond, Spline, Trash2 } from 'lucide-react'
import { MOTION_CURVES, type MotionCurve, type SobreposicaoSalva } from '@shared/contract'
import { chaveEm, ordenadas, type CurvaLivre, type Transform2D } from '@shared/transform'
import { useProject } from '@/store/project'
import {
  TOLERANCIA_DA_CHAVE,
  animado,
  patchDeChaveAqui,
  patchDoTransform,
  patchSemAnimacao,
  patchSemChaveAqui,
  tempoNoClipe,
  transformNaAgulha,
} from '@/store/transform-do-clipe'
import { Botaozinho, Deslizante, Linha, Segmentos } from './painel'
import { GraficoDeCurva } from './GraficoDeCurva'

const RITMO: Record<(typeof MOTION_CURVES)[number], string> = {
  'ease-in-out': 'Suave',
  linear: 'Constante',
  'ease-out': 'Freia',
  'ease-in': 'Acelera',
}

/**
 * POSICAO, TAMANHO E GIRO -- e a ANIMACAO deles por quadros-chave.
 *
 * "Coloca uma opcao de transform na adjustment layer, pra eu poder animar o
 * que eu quiser." O mesmo painel serve ao clipe comum e a camada de ajuste
 * (nela, o transform e o de tudo o que esta embaixo). Os valores mostrados sao
 * os da AGULHA: com chaves, eles andam enquanto o video toca, e mexer em
 * qualquer um -- aqui ou na caixa do preview -- grava uma chave ali.
 */
export function TransformDoClipe({
  o,
  alvos,
  comPresetsDeGiro = false,
}: {
  o: SobreposicaoSalva
  /** Os clipes que a mexida alcanca (a selecao). */
  alvos: readonly string[]
  comPresetsDeGiro?: boolean
}) {
  const playhead = useProject((s) => s.playhead)
  const ajustarUm = useProject((s) => s.ajustarSobreposicao)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const v = transformNaAgulha(o, playhead)
  const tem = animado(o)
  const toca = o.usarSec ?? o.durationSec - o.inicioSec
  const t = tempoNoClipe(o, playhead)
  const dentro = playhead >= o.at - 1e-3 && playhead <= o.at + toca + 1e-3
  const naChave = chaveEm(o.chaves, t, TOLERANCIA_DA_CHAVE) >= 0
  const chaves = ordenadas(o.chaves ?? [])

  /** Cada alvo recebe o patch feito com os PROPRIOS valores e chaves. */
  const paraCada = (f: (x: SobreposicaoSalva) => Partial<SobreposicaoSalva>): void => {
    const todos = useProject.getState().sobreposicoes
    for (const id of alvos.length > 0 ? alvos : [o.id]) {
      const x = todos.find((y) => y.id === id)
      if (x) ajustarUm(id, f(x))
    }
  }
  const mudar = (valores: Partial<Transform2D>): void => paraCada((x) => patchDoTransform(x, playhead, valores))
  const irPara = (tc: number): void => setPlayhead(o.at + tc + 1e-4)
  const anterior = [...chaves].reverse().find((c) => c.t < t - TOLERANCIA_DA_CHAVE)
  const proxima = chaves.find((c) => c.t > t + TOLERANCIA_DA_CHAVE)

  return (
    <>
      <Linha label="Posição X">
        <Deslizante valor={v.x} min={-150} max={150} step={0.5} padrao={0} texto={`${Math.round(v.x)}%`}
          onChange={(x) => mudar({ x })} digitar={{ numero: v.x, aplicar: (x) => mudar({ x }) }} />
      </Linha>
      <Linha label="Posição Y">
        <Deslizante valor={v.y} min={-150} max={150} step={0.5} padrao={0} texto={`${Math.round(v.y)}%`}
          onChange={(y) => mudar({ y })} digitar={{ numero: v.y, aplicar: (y) => mudar({ y }) }} />
      </Linha>
      <Linha label="Tamanho">
        <Deslizante valor={v.escala} min={0.1} max={8} step={0.01} padrao={1}
          texto={`${Math.round(v.escala * 100)}%`} onChange={(escala) => mudar({ escala })}
          digitar={{ numero: v.escala * 100, aplicar: (n) => mudar({ escala: n / 100 }) }} />
      </Linha>
      <Linha label="Rotação" title="Duplo clique no slider volta para 0°. Com chaves, passa de 180° para dar voltas.">
        <Deslizante valor={v.rotacao} min={tem ? -720 : -180} max={tem ? 720 : 180} step={1} padrao={0}
          texto={`${Math.round(v.rotacao)}°`} onChange={(rotacao) => mudar({ rotacao })}
          digitar={{ numero: v.rotacao, aplicar: (rotacao) => mudar({ rotacao }) }} />
      </Linha>
      {comPresetsDeGiro && (
        <Linha label="">
          <Segmentos
            opcoes={[-90, -45, 0, 45, 90, 180].map((g) => ({ valor: g, rotulo: `${g}°`, title: `Girar para ${g}°` }))}
            ativo={(g) => Math.round(v.rotacao) === g}
            onChange={(rotacao) => mudar({ rotacao })}
          />
        </Linha>
      )}

      {/*
        OS QUADROS-CHAVE. A fita mostra o clipe inteiro: cada losango e uma
        chave (clique leva a agulha ate ela), a linha e a agulha.
      */}
      <Linha
        label="Animar"
        title="Grava uma chave na agulha com a posição, o tamanho e o giro de agora. Com chaves, mexer em qualquer valor grava outra."
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Botaozinho
            active={naChave}
            onClick={() => (naChave ? paraCada((x) => patchSemChaveAqui(x, playhead)) : paraCada((x) => patchDeChaveAqui(x, playhead)))}
            title={
              !dentro
                ? 'Leve a agulha para dentro do clipe'
                : naChave
                  ? 'Tirar a chave da agulha'
                  : tem
                    ? 'Gravar uma chave na agulha'
                    : 'Comecar a animar: a primeira chave fica na agulha'
            }
          >
            <Diamond size={11} strokeWidth={1.75} fill={naChave ? 'currentColor' : 'none'} />
            {naChave ? 'Chave' : tem ? 'Chave aqui' : 'Animar'}
          </Botaozinho>
          {tem && (
            <>
              <button
                type="button"
                disabled={!anterior}
                onClick={() => anterior && irPara(anterior.t)}
                title="Chave anterior"
                aria-label="Chave anterior"
                className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink disabled:opacity-30"
              >
                <ChevronLeft size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                disabled={!proxima}
                onClick={() => proxima && irPara(proxima.t)}
                title="Próxima chave"
                aria-label="Próxima chave"
                className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink disabled:opacity-30"
              >
                <ChevronRight size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => paraCada((x) => patchSemAnimacao(x, playhead))}
                title="Parar de animar: fica o que se ve na agulha, sem chave nenhuma"
                aria-label="Apagar a animação"
                className="ml-auto grid size-6 place-items-center rounded-sm text-ink-3 hover:text-danger"
              >
                <Trash2 size={12} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </Linha>
      {tem && (
        <>
          <Linha label="">
            <div className="relative h-5 min-w-0 flex-1 rounded-sm border border-line bg-elevated" data-fita-de-chaves>
              {dentro && (
                <span
                  className="pointer-events-none absolute inset-y-0 w-px bg-ink-2"
                  style={{ left: `${Math.min(Math.max(t / Math.max(toca, 1e-3), 0), 1) * 100}%` }}
                />
              )}
              {chaves.map((c, i) => (
                <button
                  key={`${i}-${c.t}`}
                  type="button"
                  onClick={() => irPara(c.t)}
                  title={`Chave em ${c.t.toFixed(2)}s`}
                  className="absolute top-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rotate-45 border border-accent bg-accent/70 hover:bg-accent"
                  style={{ left: `${Math.min(Math.max(c.t / Math.max(toca, 1e-3), 0), 1) * 100}%` }}
                />
              ))}
            </div>
          </Linha>
          <RitmoDasChaves o={o} t={t} paraCada={paraCada} />
        </>
      )}
    </>
  )
}

/** A curva de cada ritmo pronto, para o desenho comecar de onde o movimento estava. */
const RITMO_EM_CURVA: Record<MotionCurve, CurvaLivre> = {
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in': [0.42, 0, 1, 1],
}

/**
 * Curvas prontas da animacao, nomeadas pelo que fazem. As tres ultimas passam
 * da caixa: so existem aqui (na camera dos blocos abririam tarja preta).
 */
const CURVAS_DA_ANIMACAO: readonly { nome: string; pontos: CurvaLivre; dica: string }[] = [
  { nome: 'Sai voando', pontos: [0, 0.85, 0.15, 1], dica: 'O movimento acontece quase todo no começo' },
  { nome: 'Chega freando', pontos: [0.1, 0.7, 0.35, 1], dica: 'Entra rápido e encosta devagar' },
  { nome: 'Segura e vai', pontos: [0.85, 0, 1, 0.35], dica: 'Fica parado e dispara no fim' },
  { nome: 'Passa e volta', pontos: [0.34, 1.56, 0.64, 1], dica: 'Passa do ponto e volta (o "back" do After Effects)' },
  { nome: 'Recua e vai', pontos: [0.36, 0, 0.66, -0.56], dica: 'Recua um pouco antes de ir' },
  { nome: 'Recua e passa', pontos: [0.68, -0.6, 0.32, 1.6], dica: 'Recua antes, passa do ponto e volta' },
]

const mesma = (a: CurvaLivre | null | undefined, b: CurvaLivre): boolean => !!a && a.every((v, i) => Math.abs(v - b[i]!) < 0.005)

/**
 * O RITMO DA ANIMACAO: "sabe a animacao de uma adjustment layer? eu quero ter
 * controle de animacao de curvas la tambem". Os quatro ritmos prontos, a curva
 * desenhada (o grafico dos blocos, com o ultrapassar liberado) e ONDE ela vale:
 * em todas as passagens do clipe, ou so na passagem em que a agulha esta --
 * cada chave pode ter a curva dela ate a proxima, como no grafico do After Effects.
 */
function RitmoDasChaves({
  o,
  t,
  paraCada,
}: {
  o: SobreposicaoSalva
  t: number
  paraCada: (f: (x: SobreposicaoSalva) => Partial<SobreposicaoSalva>) => void
}) {
  const salvas = useProject((s) => s.curvePresets)
  const carregarCurvas = useProject((s) => s.loadCurvePresets)
  useEffect(() => void carregarCurvas(), [carregarCurvas])
  const playhead = useProject((s) => s.playhead)
  const chaves = ordenadas(o.chaves ?? [])
  const i = passagemEm(chaves, t)
  const daPassagem = i >= 0 ? chaves[i]!.curva : undefined
  const [soEsta, setSoEsta] = useState(daPassagem !== undefined)
  // Outra passagem na agulha: o escopo segue o que ELA tem.
  const chaveDaPassagem = i >= 0 ? chaves[i]!.t : null
  useEffect(() => setSoEsta(daPassagem !== undefined), [chaveDaPassagem]) // eslint-disable-line react-hooks/exhaustive-deps
  const naPassagem = soEsta && i >= 0
  const ritmo = o.curvaDasChaves ?? 'ease-in-out'
  const doClipe = o.pontosDasChaves ?? null
  const curva: CurvaLivre | null = naPassagem ? (daPassagem ?? doClipe ?? RITMO_EM_CURVA[ritmo]) : doClipe

  /** A curva da passagem da agulha em cada clipe escolhido (cada um na sua). */
  const naPassagemDeCada = (c: CurvaLivre | undefined): void =>
    paraCada((x) => {
      const cs = ordenadas(x.chaves ?? [])
      const k = passagemEm(cs, Math.max(0, playhead - x.at))
      if (k < 0) return {}
      return { chaves: cs.map((ch, j) => (j === k ? { ...ch, curva: c ? [...c] : undefined } : ch)) }
    })
  const mudarCurva = (c: CurvaLivre): void =>
    naPassagem ? naPassagemDeCada(c) : paraCada(() => ({ pontosDasChaves: [...c] as [number, number, number, number] }))

  /*
   * O RITMO DA ANIMACAO num bloco proprio, com as barras na largura toda: ao
   * lado dos rotulos "Vale para" e "Ritmo" elas nao cabiam numa coluna do
   * painel e os nomes encavalavam.
   */
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
      <span
        className="cursor-help self-start text-[10px] font-medium text-ink-3"
        title="Quanto do movimento já aconteceu ao longo de cada passagem de uma chave para a próxima. Acima da caixa, passa do ponto e volta."
      >
        Ritmo da animação
      </span>
      {i >= 0 && chaves.length > 2 && (
        <div className="flex" title="A curva de todas as passagens, ou só da passagem em que a agulha está">
          <Segmentos
            opcoes={[
              { valor: false, rotulo: 'Todas as passagens' },
              { valor: true, rotulo: `Só ${i + 1} → ${i + 2}`, title: `Só a passagem da chave ${i + 1} para a ${i + 2}` },
            ]}
            ativo={(v) => v === naPassagem}
            onChange={(v) => {
              setSoEsta(v)
              // Voltar para "todas": a passagem deixa de ter curva propria.
              if (!v && daPassagem !== undefined) naPassagemDeCada(undefined)
              // "So esta": comeca na curva que ela ja seguia.
              if (v && daPassagem === undefined) naPassagemDeCada(doClipe ?? RITMO_EM_CURVA[ritmo])
            }}
          />
        </div>
      )}
      {!naPassagem && (
        <div className="flex" title="Como cada passagem de uma chave para a próxima acelera e freia">
          <Segmentos
            opcoes={[
              ...MOTION_CURVES.map((c) => ({ valor: c as MotionCurve | 'curva', rotulo: RITMO[c] })),
              {
                valor: 'curva' as const,
                rotulo: (
                  <>
                    <Spline size={11} strokeWidth={1.5} />
                    Curva
                  </>
                ),
                title: 'Desenhar a curva a mão',
              },
            ]}
            ativo={(c) => (c === 'curva' ? doClipe !== null : doClipe === null && ritmo === c)}
            onChange={(c) =>
              paraCada(() =>
                c === 'curva'
                  ? { pontosDasChaves: doClipe === null ? [...RITMO_EM_CURVA[ritmo]] : undefined }
                  : { curvaDasChaves: c, pontosDasChaves: undefined },
              )
            }
          />
        </div>
      )}
      {curva && (
        <div className="flex gap-2.5">
          <GraficoDeCurva livre pontos={curva} onChange={mudarCurva} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap gap-1">
              {CURVAS_DA_ANIMACAO.map((p) => (
                <Botaozinho key={p.nome} active={mesma(curva, p.pontos)} onClick={() => mudarCurva(p.pontos)} title={p.dica}>
                  {p.nome}
                </Botaozinho>
              ))}
              {/* As dele, guardadas no grafico dos blocos. */}
              {salvas.map((p) => (
                <Botaozinho key={p.nome} active={mesma(curva, p.pontos)} onClick={() => mudarCurva(p.pontos)}>
                  {p.nome}
                </Botaozinho>
              ))}
            </div>
            {naPassagem && (
              <p className="text-[10px] leading-snug text-ink-3">
                Só a passagem da chave {i + 1} para a {i + 2}. As outras seguem o ritmo do clipe.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** A passagem em que `t` cai: o indice da chave de onde ela parte (com uma proxima), ou -1. */
function passagemEm(chaves: readonly { t: number }[], t: number): number {
  if (chaves.length < 2) return -1
  let k = -1
  for (const [j, c] of chaves.entries()) if (c.t <= t + TOLERANCIA_DA_CHAVE) k = j
  if (k < 0) return 0
  return Math.min(k, chaves.length - 2)
}
