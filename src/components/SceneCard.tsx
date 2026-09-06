import { Film, ImagePlus, Library as LibraryIcon, Scissors, Spline } from 'lucide-react'
import { useRef, useState } from 'react'
import { isVisual } from '@shared/channels'
import {
  KEN_BURNS_EFFECTS,
  MOTION_CURVES,
  ROTATIONS,
  TRANSITIONS,
  type CurvePoints,
  type ImageAsset,
  type MotionCurve,
  type Scene,
  type Transition,
} from '@shared/contract'
import { useProject, formatTimecode } from '@/store/project'
import { Framing } from './Framing'

/**
 * Painel fino da cena selecionada. So aparece quando ha cena selecionada -- e o
 * terceiro elemento do estado "editando", nao uma coluna permanente.
 */
/**
 * As outras cinco cenas que serviam neste bloco.
 *
 * So aparece no projeto que veio da montagem automatica -- e ali ela e o que
 * torna a proposta revisavel. Sem a fita, discordar de uma escolha voltaria a
 * ser uma busca na biblioteca inteira, e revisar 20 blocos assim custa mais que
 * ter montado na mao.
 *
 * A razao aparece escrita ("Kisuke Urahara, so ele em cena, cobre o bloco")
 * porque ele precisa saber se confia: um motivo fraco e o aviso de que este e
 * um bloco para olhar com atencao.
 */
function Fita({ index }: { index: number }) {
  const blocos = useProject((s) => s.automountBlocks)
  const swapCandidate = useProject((s) => s.swapCandidate)
  const busy = useProject((s) => s.busy)

  if (!blocos) return null

  /*
   * O indice na TIMELINE nao e o indice no roteiro: bloco que ficou sem cena
   * nao virou imagem. Andar pelos blocos uteis e o que liga os dois.
   */
  let restante = index
  const bloco = blocos.find((b) => b.candidates.length > 0 && restante-- === 0)
  const posicao = blocos.indexOf(bloco!)
  if (!bloco || bloco.candidates.length < 2) return null

  return (
    <Field label={`Trocar a cena (${bloco.candidates.length - 1} opcoes)`}>
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] leading-relaxed text-ink-3">{bloco.candidates[0]!.reason}</p>
        <div className="flex flex-wrap gap-1">
          {bloco.candidates.slice(1).map((candidato, i) => (
            <button
              key={candidato.path}
              type="button"
              disabled={busy !== null}
              onClick={() => void swapCandidate(posicao, i + 1)}
              title={`${candidato.label} -- ${candidato.reason}`}
              className="overflow-hidden rounded-sm border border-line transition-colors duration-150 hover:border-accent disabled:opacity-40"
            >
              <img src={candidato.thumbUrl} alt={candidato.label} className="h-[38px] w-[68px] object-cover" />
            </button>
          ))}
        </div>
      </div>
    </Field>
  )
}

export function SceneCard() {
  const images = useProject((s) => s.images)
  const plan = useProject((s) => s.plan)
  const index = useProject((s) => s.selectedScene)
  const updateScene = useProject((s) => s.updateScene)
  const applyCurveToAll = useProject((s) => s.applyCurveToAll)
  const insertImages = useProject((s) => s.insertImages)
  const abrirBiblioteca = useProject((s) => s.openLibraryToReplace)

  const scene = index === null ? undefined : plan?.scenes[index]
  const image = scene ? images[scene.imageIndex] : undefined

  if (index === null || !scene || !image) return null

  const total = plan?.scenes.length ?? 0

  // O botao de aplicar em todos so aparece quando ha o que aplicar -- se o
  // video inteiro ja usa esta curva, ele nao faria nada.
  // Compara o DESENHO junto: com a curva na mao, "todos iguais" so e verdade se
  // os quatro numeros baterem -- senao o botao sumiria com o desenho por
  // espalhar, so porque o preset por baixo coincidia.
  const mesmaCurvaEmTodas =
    plan?.scenes.every(
      (s) =>
        s.curve === scene.curve &&
        JSON.stringify(s.curvePoints ?? null) === JSON.stringify(scene.curvePoints ?? null),
    ) ?? true

  const inserir = async (seconds: number): Promise<void> => {
    const picked = await window.dangai.pickFiles()
    if (!picked.ok) return
    const imagens = picked.value.filter((path) => isVisual(path))
    if (imagens.length > 0) await insertImages(imagens, seconds)
  }

  return (
    <aside className="enter flex w-[228px] shrink-0 flex-col gap-5 overflow-y-auto">
      <header className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink">
          Bloco {index + 1} <span className="text-ink-3">de {total}</span>
        </span>
        <span className="tnum text-[11px] text-ink-3">
          {(scene.end - scene.start).toFixed(1)}s
        </span>
      </header>

      <Fita index={index} />

      <PontoDeEntrada index={index} scene={scene} image={image} />

      <Field label="Trocar por outra cena">
        {/*
          A fita resolve o caso comum -- discordar e pegar outra das seis. Esta
          porta e para o caso MUITO especifico, quando ele sabe exatamente qual
          cena quer e ela nao esta entre as seis. Fica fora da Fita de proposito:
          vale para qualquer bloco, inclusive nos projetos que nao vieram da
          montagem automatica.
        */}
        <Chip active={false} onClick={() => void abrirBiblioteca(index)}>
          <LibraryIcon size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
          Buscar na biblioteca
        </Chip>
      </Field>

      <Field label="Entra em">
        <span className="tnum text-[13px] text-ink-2">{formatTimecode(scene.start)}</span>
      </Field>

      <Field label="Inserir imagem">
        <div className="flex flex-col gap-1.5">
          <Chip active={false} onClick={() => void inserir(scene.start)}>
            <ImagePlus size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            Antes deste bloco
          </Chip>
          <Chip active={false} onClick={() => void inserir((scene.start + scene.end) / 2)}>
            <Scissors size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            No meio, cortando ao meio
          </Chip>
          <Chip active={false} onClick={() => void inserir(scene.end)}>
            <ImagePlus size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            Depois deste bloco
          </Chip>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-3">
          O tempo sai deste bloco, entao o resto da linha do tempo nao se mexe. Arrastar imagens
          direto na timeline faz o mesmo.
        </p>
      </Field>

      <Field label="Enquadramento">
        <Framing image={image} />
      </Field>

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

      {/*
        Clipe tambem escolhe movimento agora.

        Ele so COMECA em "nenhum", porque ja se move sozinho e mover de novo
        costuma dar enjoo -- mas a decisao passou a ser do bloco. "Nenhum" fica
        na frente e sozinho na linha: e o padrao do clipe, e e o unico jeito de
        deixar um print parado, que antes nao existia.
      */}
      <Field label="Movimento">
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
              <GraficoDeCurva
                pontos={scene.curvePoints}
                onChange={(pontos) => updateScene(index, { curvePoints: pontos })}
              />
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

      <Field label="Transicao de entrada">
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
      </Field>

      <p className="flex items-baseline gap-1.5 text-[11px] leading-relaxed text-ink-3">
        {/* Miniatura de clipe e miniatura de print sao a mesma coisa na tela.
            Sem esta marca nao da para saber qual bloco e qual. */}
        {image.kind === 'video' && (
          <span className="flex items-center gap-1 text-accent">
            <Film size={11} strokeWidth={1.5} />
            clipe
          </span>
        )}
        <span className="min-w-0 truncate">{image.fileName}</span>
      </p>
    </aside>
  )
}

/**
 * De que ponto do clipe este bloco parte.
 *
 * O clipe chega cortado do AnCut, mas o bloco quase nunca tem a duracao dele:
 * uma cena de 6 segundos num bloco de 2 mostrava sempre os dois PRIMEIROS
 * segundos. Palavras dele: "a parte q eu quero e la pro final ou no meio, por
 * padrao ele ta so no inicio certo?". Antes disso a unica saida era procurar
 * outra cena.
 *
 * So aparece em clipe que SOBRA. Print nao tem de onde partir, e clipe que ja
 * cabe justo nao tem para onde correr -- oferecer um controle que nao muda nada
 * e pior que nao oferecer.
 */
function PontoDeEntrada({
  index,
  scene,
  image,
}: {
  index: number
  scene: Scene
  image: ImageAsset
}) {
  const updateScene = useProject((s) => s.updateScene)
  const setPlayhead = useProject((s) => s.setPlayhead)

  const bloco = scene.end - scene.start
  const total = image.durationSec ?? 0
  const sobra = total - bloco
  if (image.kind !== 'video' || sobra <= 0.05) return null

  const inicio = Math.min(scene.sourceStart ?? 0, sobra)

  return (
    <Field label="Trecho do clipe">
      <div className="flex flex-col gap-1.5">
        <input
          type="range"
          min={0}
          max={Math.round(sobra * 10)}
          value={Math.round(inicio * 10)}
          onChange={(event) => {
            updateScene(index, { sourceStart: Number(event.target.value) / 10 })
            /*
             * Leva o preview para o comeco do bloco a cada arrasto.
             *
             * Sem isto ele arrastaria olhando um instante do video que nao tem
             * relacao com o que esta mudando -- e o ponto de entrada so se ve
             * assistindo o bloco.
             */
            setPlayhead(scene.start)
          }}
          className="w-full accent-accent"
          aria-label="De que ponto do clipe este bloco comeca"
        />
        <span className="tnum text-[11px] text-ink-2">
          {inicio.toFixed(1)}s – {(inicio + bloco).toFixed(1)}s
          <span className="text-ink-3"> de {total.toFixed(1)}s</span>
        </span>
      </div>
    </Field>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium text-ink-2">{label}</span>
      {children}
    </div>
  )
}

function Chip({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'lift rounded-sm border px-2 py-1.5 text-[11px] disabled:opacity-40',
        active ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2',
      ].join(' ')}
    >
      {children}
    </button>
  )
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
