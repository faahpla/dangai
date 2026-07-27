import {
  CAPTION_CHARS_PER_LINE,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  type CaptionBlock,
  type ImageAsset,
  type ScenePlan,
} from './contract'

/**
 * O que o app percebe de errado ANTES de gastar um minuto renderizando.
 *
 * Nada aqui impede o render. Sao observacoes, e a decisao continua sendo do
 * usuario -- um bloco de 0,5s pode ser exatamente o efeito que ele quer. O que
 * nao pode e ele descobrir o problema depois, assistindo o MP4 pronto.
 *
 * Roda no renderer, sobre estado que ja existe. E funcao pura de proposito:
 * da para testar cada regra sem abrir o app.
 */

export type AvisoTipo =
  | 'bloco-curto'
  | 'legenda-comprida'
  | 'imagem-pequena'
  | 'sobra-de-audio'
  | 'legenda-desligada'

export interface Aviso {
  tipo: AvisoTipo
  /** Frase pronta para a interface, ja explicando a consequencia. */
  texto: string
  /** Bloco a selecionar quando o usuario clica no aviso. */
  scene?: number
}

/**
 * Abaixo disto o bloco pisca em vez de ser visto.
 *
 * 0,8s sao 19 frames a 23,976 -- e o ponto em que a imagem deixa de registrar
 * como cena e vira um flash entre duas outras.
 */
const BLOCO_CURTO_SEC = 0.8

/**
 * Quanto de ampliacao ainda passa sem borrar.
 *
 * O numero parece alto e nao e. Virar um 16:9 em 9:16 obriga a recortar uma
 * fatia estreita e estica-la: um print de 1920x1080 -- a entrada NORMAL deste
 * app -- ja sai ampliado 2,04x, e sempre saiu. Avisar sobre isso seria acusar
 * cem por cento das imagens de cem por cento dos projetos, e um aviso que
 * aparece sempre ensina o olho a ignorar o lugar onde os avisos moram.
 *
 * 2,5x e o primeiro degrau ACIMA do normal: pega 1280x720 (3,07x) e o que vier
 * pior, sem incomodar quem esta trabalhando em 1080p.
 */
const AMPLIACAO_MAXIMA = 2.5

/** Silencio no fim que denuncia plano mais curto que a narracao. */
const SOBRA_SEC = 0.5

export interface PreflightInput {
  plan: ScenePlan | null
  images: readonly ImageAsset[]
  captions: readonly CaptionBlock[]
  captionsEnabled: boolean
  durationSec: number
}

export function preflight({
  plan,
  images,
  captions,
  captionsEnabled,
  durationSec,
}: PreflightInput): Aviso[] {
  if (!plan || plan.scenes.length === 0) return []

  const avisos: Aviso[] = []

  plan.scenes.forEach((scene, index) => {
    const duracao = scene.end - scene.start
    if (duracao < BLOCO_CURTO_SEC) {
      avisos.push({
        tipo: 'bloco-curto',
        texto: `Bloco ${index + 1} tem ${duracao.toFixed(1)}s e vai passar como um flash`,
        scene: index,
      })
    }

    const image = images[scene.imageIndex]
    if (!image) return

    // A imagem cobre o quadro, entao quem manda e o lado que precisa esticar
    // mais -- exatamente o mesmo calculo que o recorte faz com sharp, e contra
    // o tamanho de RENDER (com a folga do Ken Burns), que e o que de fato sai.
    const ampliacao = Math.max(RENDER_WIDTH / image.width, RENDER_HEIGHT / image.height)
    if (ampliacao > AMPLIACAO_MAXIMA) {
      avisos.push({
        tipo: 'imagem-pequena',
        texto: `"${image.fileName}" tem ${image.width}x${image.height} e precisa ser ampliada ${ampliacao.toFixed(1)}x — vai sair mole`,
        scene: index,
      })
    }
  })

  if (captionsEnabled) {
    for (const block of captions) {
      const texto = block.words.map((word) => word.text).join(' ')
      if (texto.length > CAPTION_CHARS_PER_LINE) {
        avisos.push({
          tipo: 'legenda-comprida',
          texto: `A legenda "${texto}" tem ${texto.length} letras e vai encolher para caber na tela`,
        })
      }
    }
  } else if (captions.length > 0) {
    avisos.push({
      tipo: 'legenda-desligada',
      texto: `Ha ${captions.length} legendas prontas, mas elas nao vao entrar no video`,
    })
  }

  const fim = plan.scenes[plan.scenes.length - 1]?.end ?? 0
  if (durationSec - fim > SOBRA_SEC) {
    avisos.push({
      tipo: 'sobra-de-audio',
      texto: `Sobram ${(durationSec - fim).toFixed(1)}s de narracao depois da ultima imagem — esse trecho sai preto`,
      scene: plan.scenes.length - 1,
    })
  }

  return avisos
}

/**
 * Uma imagem so aparece uma vez na lista, mesmo ocupando varios blocos.
 *
 * Sem isto, a mesma imagem pequena repetida em cinco blocos produziria cinco
 * avisos identicos e enterraria os outros.
 */
export function dedupe(avisos: readonly Aviso[]): Aviso[] {
  const vistos = new Set<string>()
  return avisos.filter((aviso) => {
    if (vistos.has(aviso.texto)) return false
    vistos.add(aviso.texto)
    return true
  })
}
