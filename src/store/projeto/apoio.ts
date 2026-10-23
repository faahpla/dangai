import type { AutomountBlock, LibraryClip } from '@shared/channels'
import { VIDEO_FPS, CLIP_INTENSITY, CLIP_MOTION_CURVE, KEN_BURNS_EFFECTS } from '@shared/contract'
import type { Word, Scene, ScenePlan, Transcript } from '@shared/contract'
import { planEqualSplit } from '@shared/plan'
import type { CaptionBlock } from '@shared/contract'
import { type MarcacoesDosTrechos } from '@shared/juntar'
import type { ProjectState } from '../project'

/*
 * As funcoes de apoio do store do editor (../project.ts e as fatias desta
 * pasta). Puras, ou so com o set que recebem: nenhuma importa o store.
 */


export type SetState = (partial: Partial<ProjectState>) => void


/**
 * Plano provisorio por divisao igual, aplicado no instante em que ha material.
 *
 * Serve para o preview e a timeline terem o que mostrar enquanto a analise
 * roda -- e, principalmente, para `plan` nunca precisar ser derivado dentro de
 * um seletor.
 */
/**
 * O plano em que cada bloco dura exatamente a frase que escolheu o clipe dele.
 *
 * E o unico plano do app onde o corte e o conteudo vieram da mesma decisao: nos
 * outros as imagens sao distribuidas POR CIMA de uma narracao que ja existia.
 * Por isso os tempos vem dos blocos e nao passam por redistribuicao.
 *
 * O fim do ultimo bloco e esticado ate a narracao acabar. Sem isso o video
 * terminaria na ultima frase transcrita e cortaria o respiro final -- foi
 * exatamente o defeito que ele achou testando a v1.6.
 */
export function planoDosBlocos(
  blocos: readonly AutomountBlock[],
  durationSec: number,
  /*
   * Quais imagens cada bloco usa, por posicao na lista importada.
   *
   * Sem isto o bloco N usava sempre a imagem N -- verdade enquanto cada bloco
   * tinha uma cena so. Com tela dividida um bloco consome DUAS imagens, e as
   * contas deixam de bater a partir do primeiro par: os ultimos blocos
   * apontariam para imagem que nao existe.
   */
  pares?: readonly (readonly number[])[],
): ScenePlan {
  const scenes: Scene[] = blocos.map((bloco, index) => ({
    imageIndex: pares?.[index]?.[0] ?? index,
    imageIndexB: pares?.[index]?.[1] ?? null,
    start: index === 0 ? 0 : bloco.start,
    end: index === blocos.length - 1 ? Math.max(bloco.end, durationSec) : bloco.end,
    /*
     * Clipe tambem entra com movimento, em ritmo constante.
     *
     * Tudo que sai daqui e clipe, entao o rodizio de efeito e o mesmo do print
     * -- o que muda e a curva e a intensidade. Remover o movimento de um bloco
     * especifico continua sendo um clique no card da cena.
     */
    /*
     * TELA DIVIDIDA NASCE COM AS METADES INDO PARA LADOS OPOSTOS.
     *
     * Cima para a esquerda, baixo para a direita. Duas metades andando para o
     * mesmo lado leem como uma imagem so escorregando; indo em sentidos
     * contrarios, cada uma se afirma como uma cena, e a divisao ganha a
     * tensao que e o motivo de existir dela -- reacao em cima, causa embaixo.
     *
     * E so o PONTO DE PARTIDA. Os dois controles ficam no card do bloco, e
     * trocar qualquer um deles nao traz este padrao de volta.
     */
    effect: pares?.[index]?.[1] !== undefined
      ? ('pan-left' as const)
      : KEN_BURNS_EFFECTS[index % KEN_BURNS_EFFECTS.length]!,
    intensity: CLIP_INTENSITY,
    effectB: pares?.[index]?.[1] !== undefined ? ('pan-right' as const) : null,
    intensityB: null,
    curve: CLIP_MOTION_CURVE,
    // Parte do comeco do clipe. Mover o ponto de entrada e escolha dele, no
    // card da cena.
    sourceStart: 0,
    sourceStartB: 0,
    curvePoints: null,
    // Camera livre so quando ele desenhar as pontas.
    camera: null,
    rotation: 0,
    transitionIn: 'cut',
  }))
  return { scenes }
}


/**
 * Poe a cena escolhida na mao a frente da fita daquele bloco.
 *
 * O indice na TIMELINE nao e o indice no roteiro: bloco que ficou sem cena nao
 * virou imagem. Contar quantos blocos uteis vieram antes e o que liga os dois
 * -- a mesma conta que a fita e o swapCandidate ja fazem.
 */
export function substituirNaFita(
  blocos: readonly AutomountBlock[],
  posicaoNaTimeline: number,
  path: string,
  clip: LibraryClip | undefined,
): AutomountBlock[] {
  let restante = posicaoNaTimeline
  const alvo = blocos.findIndex((b) => b.candidates.length > 0 && restante-- === 0)
  if (alvo < 0) return [...blocos]

  const escolhida = {
    path,
    thumbUrl: clip?.thumbUrl ?? '',
    label: clip ? `${clip.anime} S${clip.season}E${clip.episode} #${clip.shot}` : 'Cena escolhida',
    durationSec: clip?.duration ?? 0,
    reason: 'escolhida por você na biblioteca',
  }
  return blocos.map((b, i) =>
    i === alvo
      ? { ...b, candidates: [escolhida, ...b.candidates.filter((c) => c.path !== path)] }
      : b,
  )
}


/**
 * Menos picos para o chip do SFX.
 *
 * O analisador devolve milhares, feitos para uma faixa de 1400 pixels. O chip
 * tem algumas dezenas -- guardar o resto so engordaria o arquivo do projeto
 * sem mudar um pixel na tela.
 */
/** A selecao inteira de clipes de faixa: o principal primeiro. */
export function clipesEscolhidos(state: {
  clipeSelecionado: { tipo: 'video' | 'audio'; id: string } | null
  outrosClipes: readonly { tipo: 'video' | 'audio'; id: string }[]
}): { tipo: 'video' | 'audio'; id: string }[] {
  return state.clipeSelecionado ? [state.clipeSelecionado, ...state.outrosClipes] : []
}


/** Os ids escolhidos de um tipo -- os alvos de um controle que vale para todos. */
export function idsEscolhidos(
  state: Parameters<typeof clipesEscolhidos>[0],
  tipo: 'video' | 'audio',
): string[] {
  return clipesEscolhidos(state)
    .filter((c) => c.tipo === tipo)
    .map((c) => c.id)
}


/**
 * A onda de um trecho de audio das faixas: 1000 buckets, com tres casas.
 *
 * Eram 120 para a musica inteira -- numa faixa de 2:30, uma barra a cada 1,2s,
 * e esticada no clipe virava um pente de dentes iguais. Mil da uns 150 ms numa
 * musica longa, e com tres casas o projeto salvo nao incha.
 */
export function ondaDoTrecho(a: { peaks: readonly number[]; rms?: readonly number[] }): { peaks: number[]; rms: number[] } {
  const casas = (v: number): number => Math.round(v * 1000) / 1000
  return {
    peaks: reduzirPicos(a.peaks, 1000).map(casas),
    rms: a.rms && a.rms.length > 0 ? reduzirPicos(a.rms, 1000).map(casas) : [],
  }
}


export function reduzirPicos(peaks: readonly number[], quantos = 40): number[] {
  if (peaks.length <= quantos) return [...peaks]
  const passo = peaks.length / quantos
  return Array.from({ length: quantos }, (_, i) => {
    let maior = 0
    for (let j = Math.floor(i * passo); j < Math.floor((i + 1) * passo); j++) {
      maior = Math.max(maior, peaks[j] ?? 0)
    }
    return maior
  })
}


/**
 * As palavras das legendas, na ordem, cada uma com o tempo MEDIDO.
 *
 * As legendas editadas carregam o texto dele, a transcricao carrega os tempos.
 * Quase sempre as duas tem o mesmo numero de palavras (mesclar e dividir nao
 * mudam isso), e a correspondencia e uma a uma. Se ele reescreveu um bloco com
 * mais ou menos palavras, cada palavra da legenda pega a da transcricao na
 * mesma POSICAO RELATIVA -- aproximado, mas nunca fora do trecho certo por
 * mais que o bloco reescrito.
 */
export function palavrasDasLegendas(captions: readonly CaptionBlock[], transcript: Transcript | null): Word[] {
  const texto = captions.flatMap((b) => b.words.map((w) => w.text))
  const medidas = transcript?.words ?? []
  if (medidas.length === 0) {
    return captions.flatMap((b) =>
      b.words.map((w) => ({ text: w.text, start: w.from / VIDEO_FPS, end: (w.from + w.durationInFrames) / VIDEO_FPS })),
    )
  }
  return texto.map((t, k) => {
    const i =
      texto.length === medidas.length
        ? k
        : Math.min(Math.floor((k * medidas.length) / texto.length), medidas.length - 1)
    return { text: t, start: medidas[i]!.start, end: medidas[i]!.end }
  })
}


export function setInterimPlan(set: SetState, imageCount: number, durationSec: number): void {
  set({
    plan: planEqualSplit(imageCount, durationSec),
    planOrigin: 'equal',
    selectedScene: null,
    selecionados: [],
  })
}


/**
 * Aplica uma mudanca de trechos (juntar, separar) as cinco marcacoes de uma vez.
 *
 * As cinco andam juntas porque sao indexadas pela mesma coisa -- a posicao do
 * trecho. Trocar so as cenas e esquecer o peso deixaria um "2x" colado na
 * frase errada.
 */
export function aplicarMarcacoes(
  set: SetState,
  get: () => ProjectState,
  mudar: (m: MarcacoesDosTrechos) => MarcacoesDosTrechos | null,
): void {
  const s = get()
  if (!s.scriptBlocks) return
  const r = mudar({
    blocos: s.scriptBlocks,
    porBloco: s.blockClips,
    pesos: s.blockWeights,
    unioes: s.blockSplits,
    cortes: s.blockCuts,
    ativo: s.activeBlock,
  })
  if (!r) return
  set({
    scriptBlocks: r.blocos,
    blockClips: r.porBloco,
    blockWeights: r.pesos,
    blockSplits: r.unioes,
    blockCuts: r.cortes,
    activeBlock: r.ativo,
    // Os trechos vao para o .dangai: juntar sem sujar seria perder a juncao
    // no proximo fechar, sem pergunta nenhuma.
    projectDirty: true,
  })
}


export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.5
}


/** mm:ss.cc — o formato de timecode usado em toda a interface. */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const minutes = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  const centis = Math.floor((safe % 1) * 100)
  return `${minutes}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}
