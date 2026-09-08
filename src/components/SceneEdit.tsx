import { useEffect, useRef, useState } from 'react'
import { BookmarkPlus, Spline, X } from 'lucide-react'
import {
  KEN_BURNS_EFFECTS,
  MOTION_CURVES,
  ROTATIONS,
  TRANSITIONS,
  type CurvePoints,
  type MotionCurve,
  type Transition,
} from '@shared/contract'
import { useProject } from '@/store/project'
import { Chip, Field, Grupo } from './painel'
import { Framing } from './Framing'

/**
 * Os controles FINOS do bloco, deitados na area do meio.
 *
 * Ate 07/09 tudo isto morava na coluna de 228px da direita, empilhado e com
 * rolagem. Ele montou um video inteiro assim e resumiu o problema: "ficar
 * scrollando e ruim pq eu acabo confundindo sliders de intensidade com trecho
 * do clipe".
 *
 * A divisao que ele escolheu: a coluna estreita fica com QUAL CENA E ESTA
 * (trocar, buscar na biblioteca, de que ponto do clipe ela parte), e este
 * painel fica com COMO ELA SE COMPORTA. Os dois sliders que ele confundia
 * passaram a viver em telas diferentes.
 *
 * A area reveza com o editor de legendas -- ideia dele tambem: "essa area ai so
 * usamos para edicao de legenda... entao acredito que de pra revezar ne?".
 */
export function SceneEdit() {
  const images = useProject((s) => s.images)
  const plan = useProject((s) => s.plan)
  const index = useProject((s) => s.selectedScene)
  const updateScene = useProject((s) => s.updateScene)
  const applyCurveToAll = useProject((s) => s.applyCurveToAll)
  const salvas = useProject((s) => s.curvePresets)
  const carregarCurvas = useProject((s) => s.loadCurvePresets)
  const guardarCurva = useProject((s) => s.saveCurvePreset)
  const removerCurva = useProject((s) => s.removeCurvePreset)

  // As curvas guardadas vivem nas configuracoes, entao vem do main uma vez.
  useEffect(() => void carregarCurvas(), [carregarCurvas])

  const scene = index === null ? undefined : plan?.scenes[index]
  const image = scene ? images[scene.imageIndex] : undefined

  if (index === null || !scene || !image) return null

  const total = plan?.scenes.length ?? 0

  // O botao de aplicar em todos so aparece quando ha o que aplicar -- se o
  // video inteiro ja usa esta curva, ele nao faria nada.
  const mesmaCurvaEmTodas =
    plan?.scenes.every(
      (s) =>
        s.curve === scene.curve &&
        JSON.stringify(s.curvePoints ?? null) === JSON.stringify(scene.curvePoints ?? null),
    ) ?? true

  return (
    <div className="enter grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)] items-start gap-3 overflow-y-auto">
      <Grupo titulo="Enquadramento">
        <Framing image={image} />

      {/*
        Girar existe para o material que chega deitado -- clipe gravado de lado,
        print girado, quadro de manga. Sao os quatro angulos retos: o corte
        continua preenchendo em todos, entao girar nunca abre tarja preta.

        Fora da tela dividida de proposito: ali sao duas cenas dividindo o
        quadro, e girar uma das metades gira a moldura junto.
      */}
      {scene.imageIndexB === null && (
        <Field label="Girar">
          <div className="grid grid-cols-4 gap-1.5">
            {ROTATIONS.map((graus) => (
              <Chip
                key={graus}
                active={(scene.rotation ?? 0) === graus}
                onClick={() => updateScene(index, { rotation: graus })}
              >
                {ROTATION_LABEL[graus]}
              </Chip>
            ))}
          </div>
        </Field>
      )}
      </Grupo>

      <Grupo titulo="Movimento">
      {/*
        Clipe tambem escolhe movimento agora.

        Ele so COMECA em "nenhum", porque ja se move sozinho e mover de novo
        costuma dar enjoo -- mas a decisao passou a ser do bloco. "Nenhum" fica
        na frente e sozinho na linha: e o padrao do clipe, e e o unico jeito de
        deixar um print parado, que antes nao existia.
      */}
      <Field label="Efeito">
        <Chip
          active={scene.effect === 'nenhum'}
          onClick={() => updateScene(index, { effect: 'nenhum' })}
        >
          {image.kind === 'video' ? 'Nenhum (so o do clipe)' : 'Nenhum'}
        </Chip>
        <div className="grid grid-cols-2 gap-1.5">
          {KEN_BURNS_EFFECTS.map((effect) => (
            <Chip
              key={effect}
              active={scene.effect === effect}
              onClick={() => updateScene(index, { effect })}
            >
              {EFFECT_LABEL[effect]}
            </Chip>
          ))}
        </div>
        {image.kind === 'video' && scene.effect !== 'nenhum' && (
          <p className="text-[11px] leading-relaxed text-ink-3">
            Movimento por cima de um clipe que ja se move. Use pouco, e confira no preview.
          </p>
        )}
      </Field>

      {/* Intensidade e ritmo so fazem sentido havendo movimento. */}
      {scene.effect !== 'nenhum' && (
        <>
          <Field label="Intensidade">
            <div className="flex items-center gap-2.5">
              <input
                type="range"
                min={0.04}
                max={0.15}
                step={0.01}
                value={scene.intensity}
                onChange={(event) => updateScene(index, { intensity: Number(event.target.value) })}
                className="dangai-range min-w-0 flex-1"
              />
              <span className="tnum w-8 shrink-0 text-right text-[11px] text-ink-3">
                {Math.round(scene.intensity * 100)}%
              </span>
            </div>
          </Field>

          <Field label="Ritmo do movimento">
            <div className="grid grid-cols-2 gap-1.5">
              {MOTION_CURVES.map((curve) => (
                <Chip
                  key={curve}
                  active={scene.curvePoints === null && scene.curve === curve}
                  // Escolher um preset apaga o desenho: sao dois jeitos de dizer
                  // a mesma coisa, e guardar o desenho por baixo faria o clique
                  // seguinte no "Desenhar" ressuscitar algo que ele largou.
                  onClick={() => updateScene(index, { curve, curvePoints: null })}
                >
                  {CURVE_LABEL[curve]}
                </Chip>
              ))}
            </div>

            {/*
              A curva na mao, pedido dele: "liberdade de mexer no movimento de
              cada imagem". Fica atras de um clique de proposito -- os quatro
              presets resolvem quase tudo e continuam sendo o que a montagem
              entrega pronta; o grafico e a saida para o bloco onde nenhum serve.
            */}
            <Chip
              active={scene.curvePoints !== null}
              onClick={() =>
                updateScene(index, {
                  curvePoints: scene.curvePoints === null ? CURVE_AS_BEZIER[scene.curve] : null,
                })
              }
            >
              <Spline size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
              Desenhar a curva
            </Chip>

            {scene.curvePoints !== null && (
              <>
                {/*
                  Quatro ritmos prontos, para nao ter que desenhar do zero toda
                  vez. Sao os que aparecem em recap: sair voando e assentar,
                  segurar e disparar, chegar freando, e o pulinho de mola.
                */}
                <div className="grid grid-cols-2 gap-1.5">
                  {CURVAS_PRONTAS.map((preset) => (
                    <Chip
                      key={preset.nome}
                      active={mesmaCurva(scene.curvePoints, preset.pontos)}
                      onClick={() => updateScene(index, { curvePoints: preset.pontos })}
                    >
                      {preset.nome}
                    </Chip>
                  ))}
                </div>

                {/* As dele, guardadas nas configuracoes e validas em todo video. */}
                {salvas.length > 0 && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {salvas.map((preset) => (
                      <div key={preset.nome} className="relative">
                        <Chip
                          active={mesmaCurva(scene.curvePoints, preset.pontos)}
                          onClick={() => updateScene(index, { curvePoints: preset.pontos })}
                        >
                          <span className="block truncate pr-3">{preset.nome}</span>
                        </Chip>
                        <button
                          type="button"
                          onClick={() => void removerCurva(preset.nome)}
                          title={`Esquecer "${preset.nome}"`}
                          aria-label={`Esquecer ${preset.nome}`}
                          className="absolute right-1 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-ink-3 hover:text-danger"
                        >
                          <X size={10} strokeWidth={2} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <GraficoDeCurva
                  pontos={scene.curvePoints}
                  onChange={(pontos) => updateScene(index, { curvePoints: pontos })}
                />

                <Chip active={false} onClick={() => void guardarCurva(scene.curvePoints!)}>
                  <BookmarkPlus size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
                  Salvar esta curva
                </Chip>
              </>
            )}

            <p className="text-[11px] leading-relaxed text-ink-3">
              {scene.curvePoints === null
                ? CURVE_HINT[scene.curve]
                : 'A linha diz quanto do movimento ja aconteceu ao longo do bloco. Plana e pausa, ingreme e disparada.'}
            </p>
            {total > 1 && !mesmaCurvaEmTodas && (
              <Chip
                active={false}
                onClick={() => applyCurveToAll(scene.curve, scene.curvePoints)}
              >
                Usar em todos os {total} blocos
              </Chip>
            )}
          </Field>
        </>
      )}
      </Grupo>

      <Grupo titulo="Transicao">
        {index === 0 ? (
          <p className="text-[11px] leading-relaxed text-ink-3">
            O primeiro bloco nao tem de onde entrar.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {TRANSITIONS.map((transition) => (
              <Chip
                key={transition}
                active={scene.transitionIn === transition}
                onClick={() => updateScene(index, { transitionIn: transition })}
              >
                {TRANSITION_LABEL[transition]}
              </Chip>
            ))}
          </div>
        )}
      </Grupo>
    </div>
  )
}

/**
 * Ritmos prontos, para nao desenhar do zero toda vez.
 *
 * Sao os quatro que aparecem em recap de anime, nomeados pelo que fazem e nao
 * pela matematica -- "0.2, 0.9, 0.3, 1" nao diz nada a quem esta escolhendo.
 */
const CURVAS_PRONTAS: readonly { nome: string; pontos: CurvePoints }[] = [
  // Dispara e assenta: o movimento acontece quase todo no comeco do bloco.
  { nome: 'Sai voando', pontos: [0, 0.85, 0.15, 1] },
  // Fica parado, e o movimento inteiro cai no fim -- bom para revelar algo.
  { nome: 'Segura e vai', pontos: [0.85, 0, 1, 0.35] },
  // Chega freando: entra rapido e encosta devagar.
  { nome: 'Chega freando', pontos: [0.1, 0.7, 0.35, 1] },
  // Passa do ponto e volta -- o mesmo repique da entrada elastica da legenda.
  { nome: 'Com repique', pontos: [0.3, 1, 0.5, 0.92] },
]

/** Duas curvas sao a mesma quando os quatro numeros batem. */
function mesmaCurva(a: CurvePoints | null, b: CurvePoints): boolean {
  return a !== null && a.every((v, i) => Math.abs(v - b[i]!) < 0.005)
}

/**
 * De onde o desenho PARTE quando ele abre o grafico.
 *
 * Cada preset na forma de bezier, com os mesmos numeros do CSS. Abrir o grafico
 * numa curva qualquer faria o movimento saltar no instante do clique; assim ele
 * comeca exatamente onde estava e so muda o que arrastar.
 */
const CURVE_AS_BEZIER: Record<MotionCurve, CurvePoints> = {
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in': [0.42, 0, 1, 1],
}

/**
 * O grafico da curva: dois pontos de controle arrastaveis.
 *
 * Horizontal e o tempo do bloco, vertical e quanto do movimento ja aconteceu.
 * Trecho plano e uma pausa, trecho ingreme e uma disparada -- e o mesmo desenho
 * de qualquer editor de video, que e onde ele ja sabe ler isto.
 *
 * A CAIXA E O LIMITE, e nao uma sugestao: arrastar para fora nao passa de 0..1.
 * Fora dessa faixa a curva ultrapassaria o fim do movimento e voltaria, e o pan
 * comeria a folga de borda que existe para nunca aparecer tarja preta.
 */
function GraficoDeCurva({
  pontos,
  onChange,
}: {
  pontos: CurvePoints
  onChange: (pontos: CurvePoints) => void
}) {
  const area = useRef<SVGSVGElement>(null)
  const [arrastando, setArrastando] = useState<0 | 1 | null>(null)
  const [x1, y1, x2, y2] = pontos

  const mover = (event: React.PointerEvent, qual: 0 | 1): void => {
    const caixa = area.current?.getBoundingClientRect()
    if (!caixa) return
    const x = presa(emUnidades((event.clientX - caixa.left) / caixa.width))
    // O SVG cresce para baixo e o progresso para cima: o eixo vira aqui.
    const y = presa(1 - emUnidades((event.clientY - caixa.top) / caixa.height))
    onChange(qual === 0 ? [x, y, x2, y2] : [x1, y1, x, y])
  }

  const px = (v: number): number => v * 100
  const py = (v: number): number => 100 - v * 100

  return (
    <div className="flex flex-col gap-1">
      <svg
        ref={area}
        viewBox={`${-FOLGA} ${-FOLGA} ${100 + FOLGA * 2} ${100 + FOLGA * 2}`}
        className="w-full touch-none rounded-sm bg-elevated"
        onPointerMove={(event) => arrastando !== null && mover(event, arrastando)}
        onPointerUp={() => setArrastando(null)}
        onPointerLeave={() => setArrastando(null)}
      >
        {/* A caixa desenhada, e nao a borda do elemento: com a folga em volta, a
            borda ficaria longe do limite real e mentiria sobre onde ele esta. */}
        <rect x={0} y={0} width={100} height={100} fill="none" className="stroke-line-strong" strokeWidth={0.8} />

        {/* Referencia: a diagonal e o movimento em ritmo constante. */}
        <line x1={0} y1={100} x2={100} y2={0} className="stroke-line-strong" strokeWidth={0.8} strokeDasharray="3 3" />

        <line x1={0} y1={100} x2={px(x1)} y2={py(y1)} className="stroke-ink-3" strokeWidth={0.8} />
        <line x1={100} y1={0} x2={px(x2)} y2={py(y2)} className="stroke-ink-3" strokeWidth={0.8} />

        <path
          d={`M 0 100 C ${px(x1)} ${py(y1)}, ${px(x2)} ${py(y2)}, 100 0`}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
        />

        {([0, 1] as const).map((qual) => (
          <g key={qual} className="cursor-grab">
            <circle cx={px(qual === 0 ? x1 : x2)} cy={py(qual === 0 ? y1 : y2)} r={4} className="fill-accent" />
            {/* Alvo maior que a bolinha: 4 unidades dao uns 8 pixels na largura
                do card, que e pouco para pegar com o mouse. */}
            <circle
              cx={px(qual === 0 ? x1 : x2)}
              cy={py(qual === 0 ? y1 : y2)}
              r={10}
              fill="transparent"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                setArrastando(qual)
              }}
            />
          </g>
        ))}
      </svg>
      {/* Os quatro numeros: e o que ele repete em outro bloco quando acerta um ritmo. */}
      <p className="tnum text-[10px] text-ink-3">{pontos.map((v) => v.toFixed(2)).join(', ')}</p>
    </div>
  )
}

/**
 * Folga em volta da caixa, em unidades do desenho.
 *
 * A alca de um preset comum cai exatamente em cima do limite -- o ease-in-out
 * poe uma no chao e outra no teto. Sem esta folga, metade da bolinha fica fora
 * do desenho e nao da para pegar.
 */
const FOLGA = 8

/** Fracao do ELEMENTO para unidade do desenho, descontando a folga das bordas. */
function emUnidades(fracao: number): number {
  return (fracao * (100 + FOLGA * 2) - FOLGA) / 100
}

/** Preso entre 0 e 1: a caixa do grafico e o limite do que a curva pode fazer. */
function presa(v: number): number {
  return Math.min(Math.max(v, 0), 1)
}

/**
 * O giro em graus, do jeito que ele pediu: 90, 180 e -90.
 *
 * -90 e 270 sao a mesma volta; o rotulo usa o numero negativo porque e assim
 * que se pensa em "gira para o outro lado", e nao em "gira tres quartos".
 */
const ROTATION_LABEL: Record<(typeof ROTATIONS)[number], string> = {
  0: 'Nao',
  90: '90°',
  180: '180°',
  270: '-90°',
}

const EFFECT_LABEL: Readonly<Record<(typeof KEN_BURNS_EFFECTS)[number], string>> = {
  'zoom-in': 'Zoom in',
  'zoom-out': 'Zoom out',
  'pan-left': 'Pan esq.',
  'pan-right': 'Pan dir.',
  'pan-up': 'Pan cima',
  'pan-down': 'Pan baixo',
}

/**
 * Nomeadas pelo que se ve, nao pelo nome tecnico.
 *
 * "ease-out" nao diz nada para quem esta montando um short -- e pior, o nome
 * sugere o contrario do que faz.
 */
const CURVE_LABEL: Readonly<Record<MotionCurve, string>> = {
  'ease-in-out': 'Suave',
  linear: 'Constante',
  'ease-out': 'Desacelera',
  'ease-in': 'Acelera',
}

const CURVE_HINT: Readonly<Record<MotionCurve, string>> = {
  'ease-in-out': 'Parte devagar e para devagar. E o que o app sempre fez.',
  linear: 'Mesma velocidade do inicio ao fim. Num movimento lento, fica menos travado que o suave.',
  'ease-out': 'Parte rapido e pousa. Bom para revelacao.',
  'ease-in': 'Parte devagar e acelera. Cria tensao entrando no corte.',
}

const TRANSITION_LABEL: Readonly<Record<Transition, string>> = {
  cut: 'Corte seco',
  crossfade: 'Crossfade',
  'slide-left': 'Slide esquerda',
  'slide-right': 'Slide direita',
  'whip-pan': 'Whip-pan',
}
