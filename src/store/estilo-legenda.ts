import {
  captionPresetSchema,
  captionStyleSchema,
  curvaGuardadaSchema,
  type CaptionPreset,
  type CaptionStyle,
  type CurvaDaEntrada,
  type CurvaGuardada,
} from '@shared/contract'
import { useProject } from './project'
import { estaCarregando } from './quiet'
import { exportarPreset, importarPreset, nomeLivre } from './arquivo-de-preset'

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

export function estiloAtual(): CaptionStyle {
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
    // As regras do LegendAI tambem sao gosto dele, nao do video.
    regras: s.captionRules,
    animationCurve: s.captionAnimationCurve,
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
    a.captionStroke !== b.captionStroke ||
    a.captionRules !== b.captionRules ||
    a.captionAnimationCurve !== b.captionAnimationCurve
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
  if (!r.ok) return

  // Os estilos com nome chegam na mesma leitura -- e ANTES do retorno abaixo:
  // quem nunca mexeu no estilo pode ter presets do mesmo jeito.
  useProject.setState({
    captionPresets: (r.value.captionPresets ?? []).flatMap((p) => {
      const ok = captionPresetSchema.safeParse(p)
      return ok.success ? [ok.data] : []
    }),
    curvasDeEntrada: (r.value.curvasDeEntrada ?? []).flatMap((c) => {
      const ok = curvaGuardadaSchema.safeParse(c)
      return ok.success ? [ok.data] : []
    }),
  })

  if (!r.value.captionStyle) return
  const parsed = captionStyleSchema.safeParse(r.value.captionStyle)
  if (!parsed.success) return
  aplicarEstilo(parsed.data, false)
}

/**
 * Poe um estilo inteiro na legenda.
 *
 * `comFonte` false na abertura do app: la a fonte precisa da URL que o
 * refreshFontes resolve lendo a pasta. Aplicando um preset com a pasta ja lida,
 * a fonte vai junto, pelo nome.
 */
export function aplicarEstilo(e: CaptionStyle, comFonte: boolean): void {
  const store = useProject.getState()
  if (e.color !== undefined) store.setCaptionColor(e.color)
  if (e.y !== undefined) store.setCaptionY(e.y)
  if (e.scale !== undefined) store.setCaptionScale(e.scale)
  if (e.animation !== undefined) store.setCaptionAnimation(e.animation)
  if (e.animationFrames !== undefined) store.setCaptionAnimationFrames(e.animationFrames)
  if (e.animationCurve !== undefined) store.setCaptionAnimationCurve(e.animationCurve)
  if (e.mark !== undefined) store.setCaptionMark(e.mark)
  if (e.shadow !== undefined) store.setCaptionShadow(e.shadow)
  if (e.stroke !== undefined) store.setCaptionStroke(e.stroke)
  if (e.regras !== undefined) store.setCaptionRules(e.regras)
  if (comFonte && e.fontNome !== undefined) {
    const existe = store.fontes.some((f) => f.nome === e.fontNome)
    store.setCaptionFont(e.fontNome && existe ? e.fontNome : null)
  }
}

function gravarPresets(lista: CaptionPreset[]): void {
  useProject.setState({ captionPresets: lista })
  void window.dangai.saveSettings({ captionPresets: lista })
}

/** Guarda o estilo de agora com um nome. O mesmo nome substitui o antigo. */
export function salvarPreset(nome: string): void {
  const limpo = nome.trim().slice(0, 40)
  if (!limpo) return
  const outros = useProject.getState().captionPresets.filter((p) => p.nome !== limpo)
  gravarPresets([...outros, { nome: limpo, estilo: estiloAtual() }])
}

export function aplicarPreset(nome: string): void {
  const p = useProject.getState().captionPresets.find((x) => x.nome === nome)
  if (p) aplicarEstilo(p.estilo, true)
}

export function removerPreset(nome: string): void {
  gravarPresets(useProject.getState().captionPresets.filter((p) => p.nome !== nome))
}

/*
 * A LEGENDA INTEIRA NUM ARQUIVO: "inclusive uma configuracao inteira de
 * legenda". Cor, altura, tamanho, fonte (pelo nome), entrada e a curva dela,
 * marcacao, sombra, contorno e as regras -- tudo o que o estilo descreve.
 * Quem importa ganha um preset com esse nome, ja aplicado. A fonte so vem se
 * existir na pasta de fontes de quem importa; senao fica a embutida.
 */
export function exportarPresetDeLegenda(nome: string): Promise<string | null> {
  const p = useProject.getState().captionPresets.find((x) => x.nome === nome)
  return p ? exportarPreset('legenda', p.nome, p.estilo) : Promise.resolve(null)
}

export function exportarEstiloAtual(): Promise<string | null> {
  return exportarPreset('legenda', 'Minha legenda', estiloAtual())
}

export async function importarEstilo(): Promise<string | null> {
  const r = await importarPreset('legenda', captionStyleSchema)
  if (r === null) return null
  if ('erro' in r) return r.erro
  const nome = nomeLivre(r.nome, useProject.getState().captionPresets.map((p) => p.nome))
  gravarPresets([...useProject.getState().captionPresets, { nome, estilo: r.dados }])
  aplicarEstilo(r.dados, true)
  const fonte = r.dados.fontNome
  const semFonte = fonte && !useProject.getState().fontes.some((f) => f.nome === fonte)
  return semFonte
    ? `"${nome}" importado e aplicado. A fonte "${fonte}" nao esta na sua pasta de fontes -- ficou a embutida.`
    : `"${nome}" importado e aplicado.`
}

function gravarCurvas(lista: CurvaGuardada[]): void {
  useProject.setState({ curvasDeEntrada: lista })
  void window.dangai.saveSettings({ curvasDeEntrada: lista })
}

/** Guarda a curva da entrada com um nome. O mesmo nome substitui. */
export function salvarCurvaDeEntrada(nome: string, curva: CurvaDaEntrada): void {
  const limpo = nome.trim().slice(0, 30)
  if (!limpo) return
  const outras = useProject.getState().curvasDeEntrada.filter((c) => c.nome !== limpo)
  gravarCurvas([...outras, { nome: limpo, curva }])
}

export function removerCurvaDeEntrada(nome: string): void {
  gravarCurvas(useProject.getState().curvasDeEntrada.filter((c) => c.nome !== nome))
}
