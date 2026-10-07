import { useEffect, useId, useState } from 'react'
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  getRemotionEnvironment,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import type { TransicaoResolvida, Transition } from '@shared/contract'

/**
 * AS TRANSICOES, feitas a mao -- sem o TransitionSeries.
 *
 * "Quero uma transicao de Light e outra de zoom, entrada e saida... e os Pans,
 * pra direita, esquerda, baixo e cima... mas deixa elas boas de verdade, com
 * motion blur e uma animacao decente."
 *
 * Por que nao o TransitionSeries: ele EMBRULHA a cena no componente da
 * transicao so durante a transicao. A arvore muda de forma no primeiro e no
 * ultimo quadro dela, o React remonta a cena, e o <video> do preview nasce de
 * novo -- piscando bem no meio do efeito. Aqui toda cena vive o tempo inteiro
 * dentro do mesmo `Transicionada`; o que muda quadro a quadro e so estilo.
 *
 * Como cada efeito fica bom:
 *
 * - BORDAS ESPELHADAS: o zoom que encolhe e o pan que corre abririam tarja
 *   preta. Quatro -webkit-box-reflect aninhados ladrilham a cena em espelho em
 *   volta dela -- e o Chrome repinta a camada, nao decodifica o video de novo.
 *   Sob o borrao, a costura do espelho nao aparece.
 * - BORRAO DE MOVIMENTO de verdade: a pose e calculada no quadro e meio
 *   obturador adiante; a diferenca vira o rastro. No pan, um gaussiano so na
 *   direcao do movimento. No zoom, um borrao RADIAL: a imagem ampliada por
 *   fatores entre as duas poses e media, por um filtro SVG de deslocamento
 *   (feDisplacementMap) com um mapa em rampa -- 6 x 6 amostras em duas
 *   passadas de 6.
 * - A TROCA no meio, quando as duas estao no maximo do borrao: o olho nao ve o
 *   corte, ve o movimento.
 */

type Lado = 'entra' | 'sai'

/** A transicao de uma ponta da cena, com o que precisa para desenhar. */
export interface Ponta extends TransicaoResolvida {
  /** Entrada do video (primeiro bloco) ou saida do video (ultimo): nao ha vizinho. */
  borda: boolean
}

interface Pose {
  /** Escala da imagem. */
  s: number
  /** Deslocamento, em % do quadro. */
  x: number
  y: number
  /** Opacidade da cena. */
  o: number
  /** Multiplicador de brilho (luz). */
  brilho: number
  /** Opacidade da camada de luz por cima. */
  luz: number
}

const NEUTRA: Pose = { s: 1, x: 0, y: 0, o: 1, brilho: 1, luz: 0 }

const limita = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const entraCubica = (u: number): number => u * u * u
const saiCubica = (u: number): number => 1 - (1 - u) ** 3
function suave(a: number, b: number, x: number): number {
  const t = limita((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** O pan para onde a IMAGEM corre. O whip-pan antigo andava ao contrario do nome. */
function direcaoDoPan(tipo: Transition): [number, number] | null {
  switch (tipo) {
    case 'pan-left':
    case 'whip-pan-right':
      return [-1, 0]
    case 'pan-right':
    case 'whip-pan-left':
    case 'whip-pan':
      return [1, 0]
    case 'pan-up':
      return [0, -1]
    case 'pan-down':
      return [0, 1]
    default:
      return null
  }
}

/** Transicao em duas fases: a cena de saida anda ate o meio, a de entrada termina. */
function emDuasFases(tipo: Transition): boolean {
  return tipo === 'zoom-in' || tipo === 'zoom-out' || tipo === 'light' || direcaoDoPan(tipo) !== null
}

/**
 * A pose de UMA cena num instante `p` (0..1) da emenda.
 *
 * Funcao pura: o borrao chama de novo meio obturador adiante e mede o rastro
 * pela diferenca.
 */
function poseNa(tipo: Transition, lado: Lado, p: number, intensidade: number): Pose {
  const u = limita(p / 0.5)
  const v = limita((p - 0.5) / 0.5)
  // A troca dura ~um quadro, no meio, com as duas no pico do borrao.
  const troca = suave(0.44, 0.56, p)

  const pan = direcaoDoPan(tipo)
  if (pan) {
    const distancia = 0.22 + 0.5 * intensidade
    // A de saida acelera PARA o lado; a de entrada chega pelo lado oposto, freando.
    const t = lado === 'sai' ? distancia * entraCubica(u) : -distancia * (1 - saiCubica(v))
    // Um respiro de escala no pico vende a velocidade.
    const s = 1 + 0.08 * intensidade * Math.sin(Math.PI * p)
    return {
      ...NEUTRA,
      s,
      x: pan[0] * t * 100,
      y: pan[1] * t * 100,
      o: lado === 'sai' ? 1 : troca,
    }
  }

  if (tipo === 'zoom-in' || tipo === 'zoom-out') {
    const maximo = Math.log(1 + 0.3 + 1.7 * intensidade)
    const sinal = tipo === 'zoom-in' ? 1 : -1
    // zoom-in: a de saida AMPLIA ate o centro, a de entrada chega pequena e
    // cresce ate o quadro. zoom-out: o contrario. Sempre na mesma direcao --
    // a camera nunca da re no meio.
    const ln = lado === 'sai' ? sinal * maximo * entraCubica(u) : -sinal * maximo * (1 - saiCubica(v))
    return { ...NEUTRA, s: Math.exp(ln), o: lado === 'sai' ? 1 : troca }
  }

  if (tipo === 'light') {
    // A luz sobe ate o meio e desce; a cena troca por baixo dela.
    const envelope = Math.sin(Math.PI * limita(p)) ** 1.4
    return {
      ...NEUTRA,
      s: 1 + 0.035 * intensidade * envelope,
      brilho: 1 + (0.7 + 2.6 * intensidade) * envelope,
      luz: (0.45 + 0.55 * intensidade) * envelope,
      o: lado === 'sai' ? 1 : suave(0.3, 0.68, p),
    }
  }

  if (tipo === 'slide-left' || tipo === 'slide-right') {
    // Empurra: a nova chega de um lado e leva a velha para o outro.
    const sinal = tipo === 'slide-left' ? 1 : -1
    const x = lado === 'entra' ? sinal * (1 - p) * 100 : -sinal * p * 100
    return { ...NEUTRA, x }
  }

  if (tipo === 'crossfade') return { ...NEUTRA, o: lado === 'entra' ? p : 1 }

  return NEUTRA
}

/**
 * A pose na PONTA DO VIDEO (entrada do primeiro bloco, saida do ultimo): nao
 * ha a outra cena, entao a fase dela some e o resto vem do preto -- ou da luz.
 */
function poseNaBorda(tipo: Transition, lado: Lado, q: number, intensidade: number): Pose {
  const duas = emDuasFases(tipo)
  // Na saida a fase da cena acelera do repouso; sozinha, comecaria lenta demais
  // -- q^0,6 faz o movimento aparecer ja nos primeiros quadros.
  const p = duas ? (lado === 'entra' ? 0.5 + 0.5 * q : 0.5 * q ** 0.6) : q
  const pose = poseNa(tipo, lado, p, intensidade)
  if (tipo === 'light') return { ...pose, o: 1 }
  if (tipo === 'crossfade') return { ...pose, o: lado === 'entra' ? q : 1 - q }
  if (duas) return { ...pose, o: lado === 'entra' ? Math.min(1, q / 0.35) : Math.min(1, (1 - q) / 0.35) }
  return { ...pose, o: 1 }
}

function poseDa(ponta: Ponta, lado: Lado, p: number): Pose {
  return ponta.borda
    ? poseNaBorda(ponta.tipo, lado, p, ponta.intensidade)
    : poseNa(ponta.tipo, lado, p, ponta.intensidade)
}

/*
 * O MAPA DO BORRAO RADIAL: vermelho cresce da esquerda para a direita, verde
 * de cima para baixo, os dois sobre a MAIOR medida do quadro -- assim o
 * deslocamento e o mesmo nos dois eixos e o zoom nao entorta. Feito num
 * canvas (numeros exatos; o degrade de SVG vem com pontilhado, e pontilhado no
 * mapa vira tremedeira no borrao).
 */
const mapas = new Map<string, string>()
function mapaDoZoom(w: number, h: number): string {
  const chave = `${w}x${h}`
  const pronto = mapas.get(chave)
  if (pronto) return pronto
  const N = 512
  const canvas = document.createElement('canvas')
  canvas.width = N
  canvas.height = N
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(N, N)
  const d = Math.max(w, h)
  for (let j = 0; j < N; j++) {
    const g = Math.round(255 * (0.5 + ((j + 0.5) / N - 0.5) * (h / d)))
    for (let i = 0; i < N; i++) {
      const k = (j * N + i) * 4
      img.data[k] = Math.round(255 * (0.5 + ((i + 0.5) / N - 0.5) * (w / d)))
      img.data[k + 1] = g
      img.data[k + 2] = 0
      img.data[k + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const url = canvas.toDataURL('image/png')
  mapas.set(chave, url)
  return url
}

/** No render, segura o quadro ate o mapa decodificar -- o feImage carrega sozinho. */
function useMapaPronto(src: string | null): void {
  const [handle] = useState(() =>
    src && getRemotionEnvironment().isRendering ? delayRender('mapa do borrao radial') : null,
  )
  useEffect(() => {
    if (handle === null || !src) return
    /*
     * onload, e nao img.decode(): no Chrome do render a promessa do decode de
     * uma imagem fora do documento as vezes nunca resolve, e o quadro ficava
     * esperando ate o timeout de 30s. O relogio e a rede de seguranca.
     */
    let feito = false
    const pronto = (): void => {
      if (feito) return
      feito = true
      continueRender(handle)
    }
    const img = new Image()
    img.onload = pronto
    img.onerror = pronto
    img.src = src
    const relogio = setTimeout(pronto, 2000)
    return () => {
      clearTimeout(relogio)
      pronto()
    }
  }, [handle, src])
}

const TAPS = 6

/**
 * O filtro do borrao: radial (zoom, pela razao `r` entre as escalas) e/ou
 * direcional (pan, gaussiano em x e y).
 */
function FiltroDoBorrao({
  id,
  r,
  sx,
  sy,
  largura,
  altura,
  mapa,
}: {
  id: string
  r: number
  sx: number
  sy: number
  largura: number
  altura: number
  mapa: string
}) {
  const d = Math.max(largura, altura)
  const passos: React.ReactNode[] = []
  let ultimo = 'SourceGraphic'
  const radial = Math.abs(Math.log(r)) > 0.004

  if (radial) {
    passos.push(
      <feImage
        key="mapa"
        href={mapa}
        x={0}
        y={0}
        width={largura}
        height={altura}
        preserveAspectRatio="none"
        result="mapa"
      />,
    )
    /*
     * 36 amostras, de r^-0,5 a r^+0,5 (o rastro centrado no quadro), em duas
     * passadas: a primeira espalha em passos finos, a segunda repete o
     * conjunto em passos 6x maiores. Ampliar por m e deslocar cada ponto u por
     * (1/m - 1)u -- o mapa da `u / d`, entao a escala do deslocamento e
     * d * (1/m - 1).
     */
    const total = TAPS * TAPS - 1
    const passada = (entrada: string, passo: number, nome: string): string => {
      let media = ''
      for (let k = 0; k < TAPS; k++) {
        const expoente = (k * passo) / total - (passo === 1 ? 0 : 0.5)
        const m = Math.pow(r, expoente)
        const escala = d * (1 / m - 1)
        const amostra = `${nome}-${k}`
        passos.push(
          <feDisplacementMap
            key={amostra}
            in={entrada}
            in2="mapa"
            scale={escala}
            xChannelSelector="R"
            yChannelSelector="G"
            result={amostra}
          />,
        )
        if (k === 0) {
          media = amostra
        } else {
          const nova = `${nome}-m${k}`
          passos.push(
            <feComposite
              key={nova}
              in={media}
              in2={amostra}
              operator="arithmetic"
              k1={0}
              k2={k / (k + 1)}
              k3={1 / (k + 1)}
              k4={0}
              result={nova}
            />,
          )
          media = nova
        }
      }
      return media
    }
    // A fina primeiro (sem o deslocamento de meio rastro), depois a grossa
    // centrada -- juntas cobrem r^-0,5 .. r^+0,5 em 36 passos iguais.
    ultimo = passada(ultimo, 1, 'fina')
    ultimo = passada(ultimo, TAPS, 'grossa')
  }

  if (sx > 0.3 || sy > 0.3) {
    passos.push(
      <feGaussianBlur key="dir" in={ultimo} stdDeviation={`${sx.toFixed(2)} ${sy.toFixed(2)}`} result="dir" />,
    )
    ultimo = 'dir'
  }

  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <filter
          id={id}
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
          filterUnits="objectBoundingBox"
          primitiveUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          {passos}
        </filter>
      </defs>
    </svg>
  )
}

/** "#rrggbb" com alfa. */
function rgba(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`
}

/**
 * A luz por cima da cena: dois focos quentes atravessando o quadro e, no pico,
 * o quadro inteiro tomado pela cor -- o "estouro".
 */
function Luz({ cor, forca, fase }: { cor: string; forca: number; fase: number }) {
  if (forca <= 0.002) return null
  const x1 = 15 + 70 * fase
  const x2 = 85 - 55 * fase
  return (
    <AbsoluteFill
      style={{
        mixBlendMode: 'screen',
        opacity: Math.min(1, forca),
        background: [
          `radial-gradient(ellipse 70% 45% at ${x1}% 28%, ${rgba(cor, 1)} 0%, ${rgba(cor, 0)} 70%)`,
          `radial-gradient(ellipse 60% 50% at ${x2}% 78%, ${rgba(cor, 0.85)} 0%, ${rgba(cor, 0)} 65%)`,
          `linear-gradient(${rgba(cor, Math.min(1, forca) ** 1.4)}, ${rgba(cor, Math.min(1, forca) ** 1.4)})`,
        ].join(', '),
      }}
    />
  )
}

/**
 * Ladrilha a cena em espelho nas quatro direcoes quando `ativo`. A arvore e
 * sempre a mesma -- so o estilo liga e desliga --, entao o <video> de dentro
 * nunca e remontado.
 */
function Espelho({ ativo, children }: { ativo: boolean; children: React.ReactNode }) {
  const camada = (reflexo: string, filho: React.ReactNode) => (
    <div style={{ position: 'absolute', inset: 0, WebkitBoxReflect: ativo ? reflexo : undefined }}>{filho}</div>
  )
  return camada('above', camada('below', camada('left', camada('right', children))))
}

/**
 * Uma cena com as transicoes das duas pontas. `entrada` cobre os primeiros
 * quadros dela, `saida` os ultimos. O quadro conta do comeco da cena (vive
 * dentro da <Sequence> dela).
 */
export function Transicionada({
  entrada,
  saida,
  duracao,
  children,
}: {
  entrada: Ponta | null
  saida: Ponta | null
  duracao: number
  children: React.ReactNode
}) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const id = `trans-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  let ponta: Ponta | null = null
  let lado: Lado = 'entra'
  let p = 0
  if (entrada && entrada.frames > 0 && frame < entrada.frames) {
    ponta = entrada
    lado = 'entra'
    p = frame / entrada.frames
  } else if (saida && saida.frames > 0 && frame >= duracao - saida.frames) {
    ponta = saida
    lado = 'sai'
    p = (frame - (duracao - saida.frames)) / saida.frames
  }

  // O mapa e preparado se ALGUMA ponta for zoom: no render o quadro espera por ele.
  const precisaMapa =
    entrada?.tipo === 'zoom-in' || entrada?.tipo === 'zoom-out' || saida?.tipo === 'zoom-in' || saida?.tipo === 'zoom-out'
  const mapa = precisaMapa ? mapaDoZoom(width, height) : null
  useMapaPronto(mapa)

  const pose = ponta ? poseDa(ponta, lado, p) : NEUTRA

  /*
   * O RASTRO: a pose meio obturador adiante. `borrao` 1 = obturador aberto o
   * quadro inteiro (360 graus) -- o maximo que uma camera de verdade faria.
   */
  let r = 1
  let sx = 0
  let sy = 0
  if (ponta && ponta.borrao > 0) {
    const dp = (ponta.borrao * 0.9) / ponta.frames
    const adiante = poseDa(ponta, lado, Math.min(p + dp, 1))
    r = adiante.s / pose.s
    // Gaussiano de um rastro de comprimento L: sigma ~ 0,3 L.
    sx = Math.abs(((adiante.x - pose.x) / 100) * width) * 0.3
    sy = Math.abs(((adiante.y - pose.y) / 100) * height) * 0.3
  }
  const radial = mapa !== null && Math.abs(Math.log(r)) > 0.004
  const comFiltro = radial || sx > 0.3 || sy > 0.3

  // Bordas espelhadas sempre que o quadro pode ficar descoberto.
  const espelhar = ponta !== null && (pose.s < 0.999 || Math.abs(pose.x) > 0.01 || Math.abs(pose.y) > 0.01 || comFiltro)

  const filtros: string[] = []
  if (comFiltro) filtros.push(`url(#${id})`)
  if (pose.brilho > 1.001) {
    filtros.push(`brightness(${pose.brilho.toFixed(3)})`)
    // Um brilho que estoura tambem desbota e espalha um pouco.
    filtros.push(`saturate(${(1 - 0.25 * Math.min(1, pose.brilho - 1)).toFixed(3)})`)
    if (ponta) filtros.push(`blur(${(10 * ponta.intensidade * pose.luz).toFixed(2)}px)`)
  }

  return (
    <AbsoluteFill style={{ opacity: pose.o, isolation: 'isolate' }}>
      {comFiltro && (
        <FiltroDoBorrao
          id={id}
          r={radial ? r : 1}
          sx={sx}
          sy={sy}
          largura={width}
          altura={height}
          mapa={mapa ?? ''}
        />
      )}
      <AbsoluteFill style={{ filter: filtros.length > 0 ? filtros.join(' ') : undefined }}>
        <AbsoluteFill
          style={{
            transform:
              pose.s !== 1 || pose.x !== 0 || pose.y !== 0
                ? `translate(${pose.x.toFixed(3)}%, ${pose.y.toFixed(3)}%) scale(${pose.s.toFixed(5)})`
                : undefined,
            transformOrigin: 'center center',
          }}
        >
          <Espelho ativo={espelhar}>{children}</Espelho>
        </AbsoluteFill>
      </AbsoluteFill>
      {ponta?.tipo === 'light' && <Luz cor={ponta.cor} forca={pose.luz} fase={p} />}
    </AbsoluteFill>
  )
}
