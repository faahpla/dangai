import { captionStyleSchema, type CaptionStyle } from '@shared/contract'
import { useProject } from './project'
import { estaCarregando } from './quiet'

/**
 * O estilo de legenda vira PADRAO do proximo video.
 *
 * Cor, altura, tamanho, fonte, animacao, marcacao, sombra e contorno sao gosto
 * dele, nao caracteristica de um video. Guardados so no projeto, cada video
 * novo nascia no padrao de fabrica e obrigava a refazer os mesmos ajustes --
 * "toda vez ficar alterando e um saco".
 *
 * As curvas de movimento ja moravam nas configuracoes pelo mesmo motivo. Isto
 * e o irmao delas.
 *
 * O PROJETO CONTINUA MANDANDO NO QUE E DELE. Abrir um video antigo mostra o
 * estilo que aquele video tinha, e nao o de agora -- por isso o salvamento
 * ignora tudo que acontece enquanto um projeto esta sendo carregado. O padrao
 * so serve para quem comeca do zero.
 */

/** Espera o gesto terminar: arrastar um slider dispara dezenas de mudancas. */
const ESPERA_MS = 600

let timer: ReturnType<typeof setTimeout> | null = null

function estiloAtual(): CaptionStyle {
  const s = useProject.getState()
  return {
    color: s.captionColor,
    y: s.captionY,
    scale: s.captionScale,
    // Pelo NOME: a URL e desta sessao e nao vale amanha. Quem reencontra o
    // arquivo na pasta e o refreshFontes, na abertura.
    fontNome: s.captionFont?.nome ?? '',
    animation: s.captionAnimation,
    animationFrames: s.captionAnimationFrames,
    mark: s.captionMark,
    shadow: s.captionShadow,
    stroke: s.captionStroke,
  }
}

/** Mudou alguma coisa que o estilo descreve? */
function mudou(a: ReturnType<typeof useProject.getState>, b: typeof a): boolean {
  return (
    a.captionColor !== b.captionColor ||
    a.captionY !== b.captionY ||
    a.captionScale !== b.captionScale ||
    a.captionFont?.nome !== b.captionFont?.nome ||
    a.captionAnimation !== b.captionAnimation ||
    a.captionAnimationFrames !== b.captionAnimationFrames ||
    a.captionMark !== b.captionMark ||
    a.captionShadow !== b.captionShadow ||
    a.captionStroke !== b.captionStroke
  )
}

export function startEstiloLegenda(): () => void {
  const unsubscribe = useProject.subscribe((state, anterior) => {
    // Abrir projeto e recuperar autosave escrevem nestes campos pela mesma
    // porta que ele usa. Sem esta guarda, abrir um video antigo trocaria o
    // padrao pelo estilo daquele video.
    if (estaCarregando()) return
    if (!mudou(state, anterior)) return

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void window.dangai.saveSettings({ captionStyle: estiloAtual() })
    }, ESPERA_MS)
  })

  return () => {
    if (timer) clearTimeout(timer)
    timer = null
    unsubscribe()
  }
}

/**
 * Aplica o estilo guardado, uma vez, na abertura do app.
 *
 * So mexe no que esta gravado: campo ausente fica no padrao de fabrica, e um
 * valor que deixou de existir numa versao nova cai no `.catch()` do schema sem
 * levar os outros junto.
 *
 * A FONTE fica de fora daqui de proposito. Ela precisa da URL que o
 * refreshFontes resolve lendo a pasta, e chutar uma URL agora daria legenda em
 * fallback ate a proxima abertura.
 */
export async function aplicarEstiloGuardado(): Promise<void> {
  const r = await window.dangai.getSettings()
  if (!r.ok || !r.value.captionStyle) return

  const parsed = captionStyleSchema.safeParse(r.value.captionStyle)
  if (!parsed.success) return

  const e = parsed.data
  const store = useProject.getState()

  if (e.color !== undefined) store.setCaptionColor(e.color)
  if (e.y !== undefined) store.setCaptionY(e.y)
  if (e.scale !== undefined) store.setCaptionScale(e.scale)
  if (e.animation !== undefined) store.setCaptionAnimation(e.animation)
  if (e.animationFrames !== undefined) store.setCaptionAnimationFrames(e.animationFrames)
  if (e.mark !== undefined) store.setCaptionMark(e.mark)
  if (e.shadow !== undefined) store.setCaptionShadow(e.shadow)
  if (e.stroke !== undefined) store.setCaptionStroke(e.stroke)
}
