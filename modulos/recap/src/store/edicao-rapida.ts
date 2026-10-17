import { create } from 'zustand'
import { captionStyleSchema, type AjusteDeCor, type CaptionStyle } from '@shared/contract'
import type { EstadoPublico, Nucleo } from '@/modulos/nucleo'
import type { PedidoDeMontagem } from '../../shared/cenas'
import type { ConfigDoRecapNaTela } from '../../shared/config'
import {
  CONFIG_DA_EDICAO_RAPIDA_PADRAO,
  chaveDoPedidoDeRosto,
  faixasDaEdicaoRapida,
  lookDaCor,
  naFaixaDaEdicaoRapida,
  presetsDeCorConferidos,
  PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO,
  secoesParaSom,
  trilhasDoPlanoDeSom,
  trocaDaCamadaDeCor,
  type ConfigDaEdicaoRapida,
  type PedidoDeRosto,
  type PlanoDeSom,
  type PreferenciasDaEdicaoRapida,
  type PresetDeCorSalvo,
  type ResumoDaEdicaoRapida,
  type RostosDoLote,
} from '../../shared/edicao-rapida'
import {
  clipeParaOModulo,
  clipeParaONucleo,
  papelDaSobreposicao,
  papelDaTrilha,
  recapDoProjeto,
  trilhaParaOModulo,
  trilhaParaONucleo,
  type PapelDaTrilha,
} from '../../shared/projeto-do-recap'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'

/**
 * [recap] A EDICAO RAPIDA no editor, portada do Studio (src/store/edicao-rapida.ts
 * de la). O contrato e as funcoes puras moram em shared/edicao-rapida.ts; o som
 * e o rosto sao do main do modulo. Aqui fica:
 *
 * - prepararEdicaoRapida: TODO o trabalho assincrono (plano de som, ondas dos
 *   arquivos, rostos, recorte das imagens, estilo salvo) ANTES de mexer no
 *   projeto. Devolve um `aplicar(documento)` que vai para o
 *   `nucleo.aplicarNoDocumento`: a Edicao rapida inteira e UM passo de Ctrl+Z.
 *   O estilo da legenda entra pela troca programatica do nucleo
 *   (`nucleo.aplicarEstiloDeLegenda`, nao vira o padrao), DENTRO da mesma
 *   receita: o mesmo passo.
 * - useEdicaoRapida: o que a interface lembra (as preferencias, o ultimo
 *   resumo e quem esta rodando).
 *
 * No Dangai o `papel` dos trechos e o `papel`/`corOriginal` da camada de cor
 * moram em `modulos.recap` do item (shared/projeto-do-recap.ts): o codigo do
 * Studio ve o item achatado (`paraOModulo`) e devolve no lugar (`paraONucleo`).
 * O `ducking` da musica e o campo do nucleo (`trilha.ducking`).
 */

// =========================================================== preparar/aplicar

/** O documento do nucleo (o mesmo tipo que a receita do aplicarNoDocumento recebe). */
export type Documento = Parameters<Parameters<Nucleo['aplicarNoDocumento']>[0]>[0]

/** O que a Edicao rapida le do projeto. */
export type EstadoParaEdicaoRapida = Pick<
  Documento,
  'audio' | 'images' | 'plan' | 'transcript' | 'trilhas' | 'sobreposicoes' | 'faixasMudas' | 'modulos'
> &
  Pick<EstadoPublico, 'formato'>

export interface OpcoesDaEdicaoRapida {
  /** Forca esta musica (o "trocar" do controle de musica, pelo dialogo). */
  musicaForcada?: string | null
}

type TrechoDoDocumento = Documento['trilhas'][number]
type ClipeDoDocumento = Documento['sobreposicoes'][number]

export interface PreparoDaEdicaoRapida {
  /**
   * O patch do documento, calculado sobre o documento ATUAL (ele pode ter
   * mexido enquanto o som e o rosto rodavam): trilhas dele ficam, foco mexido
   * a mao no meio fica. {} = nada a aplicar.
   */
  aplicar: (atual: Documento) => Partial<Documento>
  /** O estilo salvo da legenda (vai pelo nucleo). null = a legenda fica como esta. */
  estilo: CaptionStyle | null
  resumo: ResumoDaEdicaoRapida
  /** A musica que entrou. null = nenhuma. O historico so ao salvar/renderizar. */
  musica: string | null
}

/**
 * O patch sem os campos que ja estao IGUAIS no projeto (comparados por valor).
 * Rodar duas vezes com o mesmo resultado nao vira passo de Ctrl+Z -- e o
 * resumo sabe que nada mudou.
 */
export function soOQueMuda(patch: Partial<Documento>, atual: Partial<Documento>): Partial<Documento> {
  const saida: Partial<Documento> = {}
  for (const [campo, valor] of Object.entries(patch) as [keyof Documento, unknown][]) {
    const agora = atual[campo]
    if (valor === agora) continue
    if (typeof valor === 'object' && valor !== null && JSON.stringify(valor) === JSON.stringify(agora)) continue
    // Os SFX refeitos nascem com id novo (prefixo da rodada) e a musica mantida
    // vem antes deles: iguais em todo o resto, nao sao mudanca. A camada de
    // cor igual a de antes (rodar duas vezes) tambem nao.
    if ((campo === 'trilhas' || campo === 'sobreposicoes') && trilhasPorValor(valor) === trilhasPorValor(agora)) continue
    ;(saida as Record<string, unknown>)[campo] = valor
  }
  return saida
}

/** As trilhas sem o id e sem a ordem do array (a faixa e o tempo ja dizem onde ficam). */
function trilhasPorValor(v: unknown): string | null {
  if (!Array.isArray(v)) return null
  const cada = v.map((t: unknown) => JSON.stringify(t !== null && typeof t === 'object' ? { ...t, id: '' } : t))
  return JSON.stringify(cada.sort())
}

/** O estilo salvo e o do projeto sao o mesmo (a legenda ja esta assim: nada a fazer). */
function estiloIgual(estilo: CaptionStyle, e: EstadoPublicoDaLegenda): boolean {
  const igual = <T,>(a: T | undefined, b: T): boolean => a === undefined || JSON.stringify(a) === JSON.stringify(b)
  return (
    igual(estilo.color, e.captionColor) &&
    igual(estilo.y, e.captionY) &&
    igual(estilo.scale, e.captionScale) &&
    igual(estilo.animation, e.captionAnimation) &&
    igual(estilo.animationFrames, e.captionAnimationFrames) &&
    igual(estilo.animationCurve, e.captionAnimationCurve) &&
    igual(estilo.mark, e.captionMark) &&
    igual(estilo.shadow, e.captionShadow) &&
    igual(estilo.stroke, e.captionStroke) &&
    (estilo.fontNome === undefined || estilo.fontNome === (e.captionFont?.nome ?? ''))
  )
}

type EstadoPublicoDaLegenda = Pick<
  Documento,
  | 'captionColor'
  | 'captionY'
  | 'captionScale'
  | 'captionFont'
  | 'captionAnimation'
  | 'captionAnimationFrames'
  | 'captionAnimationCurve'
  | 'captionMark'
  | 'captionShadow'
  | 'captionStroke'
>

/**
 * Foco que ELE pos: sem a marca de automatico e fora do centro. Esse a Edicao
 * rapida nao toca (a mao dele manda).
 */
export function focoDaMao(img: { focusX: number; focusY: number; focusAuto?: boolean }): boolean {
  return !img.focusAuto && (img.focusX !== 0.5 || img.focusY !== 0.5)
}

/** A onda reduzida que o nucleo guarda no trecho (o ondaDoTrecho do store). */
export function ondaDoTrecho(a: { peaks: readonly number[]; rms?: readonly number[] }): { peaks: number[]; rms: number[] } {
  const casas = (v: number): number => Math.round(v * 1000) / 1000
  return {
    peaks: reduzirPicos(a.peaks, 1000).map(casas),
    rms: a.rms && a.rms.length > 0 ? reduzirPicos(a.rms, 1000).map(casas) : [],
  }
}

function reduzirPicos(peaks: readonly number[], quantos: number): number[] {
  if (peaks.length <= quantos) return [...peaks]
  const passo = peaks.length / quantos
  return Array.from({ length: quantos }, (_, i) => {
    let maior = 0
    for (let j = Math.floor(i * passo); j < Math.floor((i + 1) * passo); j++) maior = Math.max(maior, peaks[j] ?? 0)
    return maior
  })
}

const RE_EPISODIO = /^ep_[0-9a-f]{40}$/

export async function prepararEdicaoRapida(
  estado: EstadoParaEdicaoRapida,
  config: ConfigDaEdicaoRapida,
  opcoes: OpcoesDaEdicaoRapida,
): Promise<PreparoDaEdicaoRapida> {
  const avisos: string[] = []
  // Parte que quebra vira aviso: as outras seguem (melhor esforco).
  const seguro = <T,>(nome: string, p: Promise<T>): Promise<T | null> =>
    p.catch((err: unknown) => {
      avisos.push(`${nome}: ${err instanceof Error ? err.message : String(err)}`)
      return null
    })
  const [som, rostos, legenda, cor] = await Promise.all([
    config.sfx || config.musica ? seguro('Sem som', prepararSom(estado, config, opcoes, avisos)) : Promise.resolve(null),
    config.rosto ? seguro('Sem rosto', prepararRostos(estado, avisos)) : Promise.resolve(null),
    config.legenda ? seguro('Legenda sem o estilo salvo', prepararLegenda(avisos)) : Promise.resolve(null),
    config.cor ? seguro('Sem cor', prepararCor(avisos)) : Promise.resolve(null),
  ])

  const aplicar = (atual: Documento): Partial<Documento> => {
    const patch: Partial<Documento> = {}
    if (som && som.papeis.size > 0) {
      // As faixas de novo sobre o documento atual: ele pode ter posto trilha
      // numa faixa nova enquanto isto rodava. Cada papel fica na faixa que ja
      // tinha (so muda se ele pos um som la no mesmo trecho de tempo).
      const vistas = atual.trilhas.map((t) => trilhaParaOModulo(t))
      const ficam = atual.trilhas.filter((t) => {
        const papel = papelDaTrilha(t)
        return !papel || !som.papeis.has(papel)
      })
      const entram = naFaixaDaEdicaoRapida(
        vistas,
        som.novas.filter((t) => t.papel !== undefined && som.papeis.has(t.papel)),
        som.papeis,
      ).map((t) => trilhaParaONucleo(t) as TrechoDoDocumento)
      patch.trilhas = [...ficam, ...entram]
    }
    if (rostos && rostos.porImagem.size > 0) {
      let mudou = false
      const images = atual.images.map((img) => {
        const novo = rostos.porImagem.get(img.id)
        if (!novo) return img
        // Mexeu no foco enquanto o detector rodava: a mao dele ganha.
        if (img.focusX !== novo.antes.focusX || img.focusY !== novo.antes.focusY) return img
        mudou = true
        return { ...img, focusX: novo.focusX, focusY: novo.focusY, focusAuto: novo.focusAuto, ...(novo.url ? { url: novo.url } : {}) }
      })
      if (mudou) patch.images = images
    }
    const duracao = atual.audio?.durationSec ?? 0
    if (cor && duracao > 0) {
      const vistas = atual.sobreposicoes.map((o) => clipeParaOModulo(o))
      const feito = trocaDaCamadaDeCor(vistas, {
        look: cor,
        duracaoSec: duracao,
        mudas: atual.faixasMudas.video,
        presets: cor.presets,
        id: `er-cor-${Date.now().toString(36)}`,
        extra: { url: '' },
      })
      patch.sobreposicoes = feito.sobreposicoes.map((o) => clipeParaONucleo(o) as ClipeDoDocumento)
      // O que ela fez com a cor depende do documento ATUAL: o resumo e completado aqui.
      if (feito.rodada.acao === 'mantida') {
        resumo.cor = null
        resumo.corMantida = feito.rodada.motivo
        resumo.corPresetSumiu = null
        resumo.corFaixaMuda = null
      } else {
        resumo.cor = feito.rodada.nome
        resumo.corMantida = null
        resumo.corPresetSumiu = cor.sumiu
        resumo.corFaixaMuda = feito.rodada.faixaMuda
      }
    }
    return patch
  }

  const aplicadas = som ? som.novas.filter((t) => t.papel !== undefined && som.papeis.has(t.papel)) : []
  const musica = aplicadas.find((t) => t.papel === 'musica')?.path ?? null
  // Sem musica nova (pasta vazia): a que estava no projeto fica -- o resumo diz.
  const mantida = config.musica && !musica ? (estado.trilhas.find((t) => papelDaTrilha(t) === 'musica')?.fileName ?? null) : null
  const resumo: ResumoDaEdicaoRapida = {
    config,
    whoosh: aplicadas.filter((t) => t.papel === 'whoosh').length,
    impacto: aplicadas.filter((t) => t.papel === 'impacto').length,
    musica: musica ? (aplicadas.find((t) => t.papel === 'musica')?.fileName ?? null) : null,
    rostos: rostos ? { comRosto: rostos.comRosto, total: rostos.total, fonte: rostos.fonte } : null,
    legenda: legenda !== null,
    // Completados pelo aplicar (sobre o documento de la).
    cor: null,
    corMantida: null,
    corPresetSumiu: null,
    corFaixaMuda: null,
    avisos: [...new Set(avisos)],
    musicaMantida: mantida,
  }
  return { aplicar, estilo: legenda, resumo, musica }
}

/**
 * Roda a Edicao rapida no projeto aberto e aplica num passo so de Ctrl+Z.
 * null = nada aberto, outro projeto abriu no meio, ou ja rodando.
 */
export async function edicaoRapidaNoProjeto(
  config: ConfigDaEdicaoRapida,
  opcoes: OpcoesDaEdicaoRapida = {},
): Promise<(ResumoDaEdicaoRapida & { aplicou: boolean }) | null> {
  const n = nucleo()
  const antes = n.ler()
  if (!antes.audio || !antes.plan || antes.images.length === 0 || antes.busy !== null) return null
  const preparo = await prepararEdicaoRapida(
    {
      audio: antes.audio,
      images: antes.images,
      plan: antes.plan,
      transcript: antes.transcript,
      trilhas: antes.trilhas,
      sobreposicoes: antes.sobreposicoes,
      // As faixas mudas so pesam na faixa da camada de cor: o aplicar le as de agora.
      faixasMudas: { video: [], audio: [] },
      modulos: antes.modulos,
      formato: antes.formato,
    },
    config,
    opcoes,
  )
  // Outro projeto aberto no meio: o que foi preparado nao e dele.
  if (n.ler().audio?.path !== antes.audio.path) return null
  let aplicou = false
  const agora = n.ler()
  const estilo = preparo.estilo && !estiloIgual(preparo.estilo, agora as unknown as EstadoPublicoDaLegenda) ? preparo.estilo : null
  n.aplicarNoDocumento((documento) => {
    // So o que muda de verdade: nada mudou = nenhum passo de Ctrl+Z.
    const patch = soOQueMuda(preparo.aplicar(documento), documento)
    aplicou = Object.keys(patch).length > 0 || estilo !== null
    // O estilo pela troca programatica do nucleo, DENTRO da receita: o mesmo passo.
    if (estilo) n.aplicarEstiloDeLegenda(estilo)
    return patch
  })
  return { ...preparo.resumo, aplicou }
}

// ------------------------------------------------------------------- cor

/**
 * O look da parte "cor": o Anime vivo ou o preset de cor escolhido nas
 * Configuracoes do modulo (Edicao rapida > Cor), lido AGORA. Os presets sao
 * os do nucleo (os mesmos do inspetor da camada de ajuste).
 */
async function prepararCor(
  avisos: string[],
): Promise<{ nome: string; cor: AjusteDeCor; sumiu: string | null; presets: PresetDeCorSalvo[] }> {
  const [r, c] = await Promise.all([window.dangai.getSettings(), ponte.lerConfig()])
  if (!r.ok || !c.ok) {
    avisos.push(`Cor no Anime vivo (sem ler as Configuracoes: ${!r.ok ? r.error : !c.ok ? c.error : ''})`)
    return { ...lookDaCor(null, []), presets: [] }
  }
  const presets = presetsDeCorConferidos(r.value.presetsDeCor ?? [])
  return { ...lookDaCor(c.value.edicaoRapidaPadrao.corPreset, presets), presets }
}

// ------------------------------------------------------------------- som

type TrechoNovo = ReturnType<typeof trilhasDoPlanoDeSom>[number] & { url: string }

async function prepararSom(
  e: EstadoParaEdicaoRapida,
  config: ConfigDaEdicaoRapida,
  opcoes: OpcoesDaEdicaoRapida,
  avisos: string[],
): Promise<{ novas: TrechoNovo[]; papeis: Set<PapelDaTrilha>; plano: PlanoDeSom } | null> {
  const duracaoSec = e.audio?.durationSec ?? 0
  if (!(duracaoSec > 0)) return null
  const vistas = e.trilhas.map((t) => trilhaParaOModulo(t))
  const atuais = [...new Set(vistas.filter((t) => t.papel === 'musica').map((t) => t.path))]
  const forcada = opcoes.musicaForcada ?? null
  const r = await ponte.planejarSom({
    sfx: config.sfx,
    musica: config.musica,
    duracaoSec,
    cortes: [...new Set((e.plan?.scenes ?? []).map((s) => s.start))].sort((a, b) => a - b),
    secoes: secoesParaSom({
      studio: recapDoProjeto(e.modulos),
      images: e.images,
      plan: e.plan,
      words: e.transcript?.words ?? [],
      duracaoSec,
    }),
    // Rodar de novo troca a musica (a de agora so volta se nao houver outra).
    evitarMusicas: forcada ? [] : atuais.slice(0, 50),
    musicaForcada: forcada,
    // A narracao: cada SFX tambem fica abaixo da voz NAQUELE instante.
    vozPath: e.audio?.path ?? null,
  })
  if (!r.ok) {
    avisos.push(`Sem som: ${r.error}`)
    return null
  }
  const plano = r.value
  // O main ja diz por que nao ha musica (pasta vazia, sumida, sem pasta).
  avisos.push(...plano.avisos)

  const trechos = trilhasDoPlanoDeSom(plano, {
    duracaoSec,
    faixas: faixasDaEdicaoRapida(vistas),
    prefixoId: `er-${Date.now().toString(36)}`,
  })
  // A URL do servidor local e a onda de cada ARQUIVO (uma vez por arquivo).
  const analises = new Map<string, { url: string; peaks: number[]; rms: number[] } | null>()
  for (const path of new Set(trechos.map((t) => t.path))) {
    const a = await window.dangai.analyzeAudio(path)
    analises.set(path, a.ok ? { url: a.value.url, ...ondaDoTrecho(a.value) } : null)
    if (!a.ok) avisos.push(`Nao deu para ler ${path.split(/[\\/]/).pop() ?? path}: ${a.error}`)
  }
  const novas: TrechoNovo[] = trechos.flatMap((t) => {
    const a = analises.get(t.path)
    return a ? [{ ...t, ...a }] : []
  })
  // So troca o papel que tem substituto: pasta vazia nao apaga o que ja estava.
  const papeis = new Set<PapelDaTrilha>()
  if (config.sfx && novas.some((t) => t.papel === 'whoosh' || t.papel === 'impacto')) {
    papeis.add('whoosh')
    papeis.add('impacto')
  }
  if (config.musica && novas.some((t) => t.papel === 'musica')) papeis.add('musica')
  return { novas, papeis, plano }
}

// ----------------------------------------------------------------- rosto

interface FocoNovo {
  focusX: number
  focusY: number
  focusAuto: boolean
  /** O recorte 9:16 novo. Ausente = o recorte falhou (o foco nao entra). */
  url?: string
  /** O foco de quando comecou: se mudar ate o fim, a mao dele ganha. */
  antes: { focusX: number; focusY: number }
}

/**
 * O rosto de cada imagem do plano, pelo lote do main (o detector antigo ate
 * o motor, parte 4). Olha o trecho que o bloco MAIS LONGO daquela imagem
 * toca, e manda quem a frase daquele trecho cita (para o motor).
 *
 * Fica de fora: foco que ele pos a mao (focoDaMao) e tela dividida.
 */
async function prepararRostos(
  e: EstadoParaEdicaoRapida,
  avisos: string[],
): Promise<{ porImagem: Map<string, FocoNovo>; comRosto: number; total: number; fonte: RostosDoLote['fonte'] } | null> {
  const plan = e.plan
  if (!plan || e.images.length === 0) return null
  const divididas = new Set<number>()
  const maisLonga = new Map<number, { de: number; dura: number; start: number; end: number }>()
  for (const s of plan.scenes) {
    if (s.imageIndexB !== null) {
      divididas.add(s.imageIndex)
      divididas.add(s.imageIndexB)
      continue
    }
    const dura = Math.max(s.end - s.start, 0)
    const antes = maisLonga.get(s.imageIndex)
    if (!antes || dura > antes.dura) maisLonga.set(s.imageIndex, { de: s.sourceStart, dura, start: s.start, end: s.end })
  }
  const recap = recapDoProjeto(e.modulos)
  const frases = (recap?.secoes ?? []).flatMap((sec) => sec.frases)
  const nomesDoTrecho = (start: number, end: number): string[] => {
    let melhor: { n: number; nomes: string[] } | null = null
    for (const f of frases) {
      const n = Math.min(end, f.fim) - Math.max(start, f.inicio)
      if (n > 0 && (!melhor || n > melhor.n)) melhor = { n, nomes: f.personagens }
    }
    return (melhor?.nomes ?? []).map((x) => x.slice(0, 120)).slice(0, 20)
  }

  const pedidos = new Map<string, PedidoDeRosto>()
  const imagensDaChave = new Map<string, number[]>()
  for (const [i, alvo] of maisLonga) {
    const img = e.images[i]
    if (!img || divididas.has(i) || focoDaMao(img)) continue
    const video = img.kind === 'video'
    const arquivo = img.invertido && img.caminhoInvertido ? img.caminhoInvertido : img.path
    const de = video ? Math.max(alvo.de, 0) : 0
    const ate = video ? de + alvo.dura : 0
    const chave = chaveDoPedidoDeRosto(arquivo, de)
    if (!pedidos.has(chave)) pedidos.set(chave, { chave, arquivo, de, ate, personagens: nomesDoTrecho(alvo.start, alvo.end) })
    imagensDaChave.set(chave, [...(imagensDaChave.get(chave) ?? []), i])
  }
  if (pedidos.size === 0) return { porImagem: new Map(), comRosto: 0, total: 0, fonte: 'nenhum' }

  const episodioId = recap?.episodioId ?? null
  const r = await ponte.rostosDosPedacos({
    pedidos: [...pedidos.values()],
    formato: e.formato,
    episodioId: episodioId && RE_EPISODIO.test(episodioId) ? episodioId : null,
    tetoMs: 120_000,
    motor: true,
  })
  if (!r.ok) {
    avisos.push(`Sem rosto: ${r.error}`)
    return null
  }
  avisos.push(...r.value.avisos)

  const porImagem = new Map<string, FocoNovo>()
  for (const f of r.value.focos) {
    if (f.fonte === null) continue
    for (const i of imagensDaChave.get(f.chave) ?? []) {
      const img = e.images[i]
      if (!img || (img.focusX === f.focusX && img.focusY === f.focusY && img.focusAuto === f.focusAuto)) continue
      porImagem.set(img.id, { focusX: f.focusX, focusY: f.focusY, focusAuto: f.focusAuto, antes: { focusX: img.focusX, focusY: img.focusY } })
    }
  }
  // O recorte 9:16 e refeito agora para TODO bloco: o preview e o render leem
  // image.url (o recorte pronto), e so trocar o foco deixava o quadro antigo.
  // O mesmo pedido do commitImageFocus do nucleo (copia invertida na chave dela).
  await emParalelo([...porImagem.entries()], 4, async ([id, foco]) => {
    const img = e.images.find((x) => x.id === id)
    if (!img) {
      porImagem.delete(id)
      return
    }
    const feito = await window.dangai.reframeImage({
      id: img.invertido ? `${img.id}-inv` : img.id,
      path: img.invertido && img.caminhoInvertido ? img.caminhoInvertido : img.path,
      focusX: foco.focusX,
      focusY: foco.focusY,
    })
    if (feito.ok) foco.url = feito.value
    else porImagem.delete(id)
  })
  return { porImagem, comRosto: r.value.comRosto, total: r.value.total, fonte: r.value.fonte }
}

/** Roda `tarefa` em cada item, no maximo `juntos` ao mesmo tempo. */
async function emParalelo<T>(itens: readonly T[], juntos: number, tarefa: (item: T) => Promise<void>): Promise<void> {
  let proximo = 0
  const trabalhador = async (): Promise<void> => {
    while (proximo < itens.length) {
      const item = itens[proximo++]!
      await tarefa(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(juntos, itens.length) }, trabalhador))
}

// --------------------------------------------------------------- legenda

/** O estilo salvo dele (settings.captionStyle do nucleo). null = nunca salvou: a legenda fica. */
async function prepararLegenda(avisos: string[]): Promise<CaptionStyle | null> {
  const r = await window.dangai.getSettings()
  if (!r.ok) {
    avisos.push(`Legenda sem o estilo salvo: ${r.error}`)
    return null
  }
  const lido = r.value.captionStyle ? captionStyleSchema.safeParse(r.value.captionStyle) : null
  if (!lido?.success) {
    avisos.push('Sem estilo de legenda salvo: a legenda ficou como estava.')
    return null
  }
  return lido.data
}

// ======================================================= estado da interface

export type QualRoda = 'tudo' | 'musica'

interface EstadoDaInterface {
  /** As preferencias (config do modulo). null = ainda nao lidas. */
  padrao: PreferenciasDaEdicaoRapida | null
  /** O ultimo resumo (do botao ou do "Abrir no editor"). */
  resumo: (ResumoDaEdicaoRapida & { aplicou?: boolean }) | null
  resumoAberto: boolean
  /** De onde veio o resumo: do botao ou da montagem do passo 4. */
  origemDoResumo: 'editor' | 'montagem'
  /** Quem esta rodando agora: o botao inteiro ou so a musica. */
  rodando: QualRoda | null
  carregarPadrao: () => Promise<PreferenciasDaEdicaoRapida>
  /** Grava na config do modulo. Devolve a config nova (null = falhou). */
  gravarPadrao: (p: PreferenciasDaEdicaoRapida) => Promise<ConfigDoRecapNaTela | null>
  /** A config chegou por outro caminho (a secao das Configuracoes). */
  lerDaConfig: (c: Pick<ConfigDoRecapNaTela, 'edicaoRapidaPadrao'>) => void
  mostrarResumo: (r: ResumoDaEdicaoRapida & { aplicou?: boolean }, origem?: 'editor' | 'montagem') => void
  fecharResumo: () => void
  marcarRodando: (qual: QualRoda | null) => void
}

export const useEdicaoRapida = create<EstadoDaInterface>((set, get) => ({
  padrao: null,
  resumo: null,
  resumoAberto: false,
  origemDoResumo: 'editor',
  rodando: null,

  carregarPadrao: async () => {
    // Ler a config nunca pode travar o "Abrir no editor": sem leitura, vale
    // o que ja estava (ou o padrao de fabrica, ligada).
    const r = await ponte.lerConfig().catch(() => null)
    const p = r?.ok ? r.value.edicaoRapidaPadrao : (get().padrao ?? PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO)
    set({ padrao: p })
    return p
  },

  gravarPadrao: async (p) => {
    // Otimista: a caixinha responde na hora; falhou, volta ao que o main tem.
    set({ padrao: p })
    const r = await ponte.salvarConfig({ edicaoRapidaPadrao: p })
    if (!r.ok) {
      await get().carregarPadrao()
      return null
    }
    set({ padrao: r.value.edicaoRapidaPadrao })
    return r.value
  },

  lerDaConfig: (c) => set({ padrao: c.edicaoRapidaPadrao }),

  mostrarResumo: (r, origem = 'editor') => set({ resumo: r, resumoAberto: true, origemDoResumo: origem }),
  fecharResumo: () => set({ resumoAberto: false }),
  marcarRodando: (qual) => set({ rodando: qual }),
}))

/**
 * A musica que o projeto TEM agora vai para o historico de "ja usada" (uma
 * entrada por projeto, sobrescrita). Chamado depois de SALVAR e de
 * RENDERIZAR (os eventos do nucleo), e nao ao aplicar: uma musica
 * experimentada e desfeita com Ctrl+Z nao conta como usada. O projeto sem
 * arquivo ainda vale pela narracao. Falhar so perde o "sem repetir".
 */
export function registrarMusicaDoProjeto(estado: Pick<EstadoPublico, 'trilhas' | 'projectPath' | 'audio'>): void {
  const projeto = estado.projectPath ?? estado.audio?.path ?? null
  if (!projeto) return
  const musica = estado.trilhas.find((t) => papelDaTrilha(t) === 'musica')?.path ?? null
  // Projeto sem nada da Edicao rapida nem musica dela: nada a anotar.
  void ponte.registrarMusicaUsada(musica, projeto).catch(() => undefined)
}

/** O config das preferencias (lido agora, para valer o que ele acabou de mudar). */
export async function configDoPadrao(): Promise<ConfigDaEdicaoRapida> {
  const p = await useEdicaoRapida.getState().carregarPadrao()
  return p.config ?? CONFIG_DA_EDICAO_RAPIDA_PADRAO
}

/**
 * O pedido do "Abrir no editor" (passo 4): com a Edicao rapida se a caixinha
 * estiver ligada, e o que e do nucleo e a montagem precisa (o estilo salvo da
 * legenda e os presets de cor), lido das Configuracoes publicas.
 */
export async function pedidoDaMontagem(): Promise<PedidoDeMontagem> {
  const p = useEdicaoRapida.getState().padrao ?? (await useEdicaoRapida.getState().carregarPadrao())
  const s = await window.dangai.getSettings().catch(() => null)
  return {
    edicaoRapida: p.aoAbrirNoEditor ? p.config : null,
    ...(s?.ok ? { estilo: s.value.captionStyle ?? undefined, presetsDeCor: s.value.presetsDeCor ?? [] } : {}),
  }
}

/** So a musica: o controle de musica da barra (por, trocar). */
export const SO_A_MUSICA: ConfigDaEdicaoRapida = { sfx: false, musica: true, rosto: false, legenda: false, cor: false }

/** Os trechos de musica que a Edicao rapida pos (o controle de musica mexe neles). */
export function trechosDaMusica<T extends { modulos?: Record<string, unknown> | undefined }>(trilhas: readonly T[]): T[] {
  return trilhas.filter((t) => papelDaTrilha(t) === 'musica')
}

/** O projeto tem algo da Edicao rapida (o botao fica "ligado"). */
export function temEdicaoRapida(e: Pick<EstadoPublico, 'trilhas' | 'sobreposicoes'>): boolean {
  return e.trilhas.some((t) => papelDaTrilha(t) !== undefined) || e.sobreposicoes.some((o) => papelDaSobreposicao(o) !== undefined)
}

/** Uma linha do resumo para a tela, ASCII e curta (`dica` = o title, quando diz mais que o valor). */
export function linhasDoResumo(
  r: ResumoDaEdicaoRapida,
  origem: 'editor' | 'montagem' = 'editor',
): { rotulo: string; valor: string; dica?: string }[] {
  const linhas: { rotulo: string; valor: string; dica?: string }[] = []
  if (r.config.sfx) {
    const n = r.whoosh + r.impacto
    linhas.push({ rotulo: 'Sons', valor: n === 0 ? 'nenhum' : `${r.whoosh} whoosh, ${r.impacto} ${r.impacto === 1 ? 'impacto' : 'impactos'}` })
  }
  if (r.config.musica) {
    const tirar = (nome: string): string => nome.replace(/\.[^.]+$/, '')
    linhas.push({
      rotulo: 'Musica',
      valor: r.musica ? tirar(r.musica) : r.musicaMantida ? `${tirar(r.musicaMantida)} (mantida)` : 'nenhuma',
    })
  }
  if (r.config.rosto && r.rostos) {
    const quem = r.rostos.fonte === 'motor' ? ' (motor)' : r.rostos.fonte === 'lbp' ? ' (antigo)' : r.rostos.fonte === 'misto' ? ' (motor + antigo)' : ''
    linhas.push({ rotulo: 'Rosto', valor: `${r.rostos.comRosto} de ${r.rostos.total}${quem}` })
  }
  if (r.config.legenda) {
    linhas.push({
      rotulo: 'Legenda',
      valor: r.legenda ? 'estilo salvo' : origem === 'montagem' ? 'padrao do app (sem estilo salvo)' : 'como estava (sem estilo salvo)',
    })
  }
  if (r.config.cor) linhas.push(linhaDaCor(r))
  return linhas
}

/** A linha da Cor: o look, com o que ele precisa saber NA linha. */
function linhaDaCor(r: ResumoDaEdicaoRapida): { rotulo: string; valor: string; dica?: string } {
  if (r.corMantida) {
    return {
      rotulo: 'Cor',
      valor: r.corMantida === 'varias' ? 'mantida (cortada ou copiada)' : 'mantida (editada por voce)',
      dica: 'Voce mexeu na camada de cor: ela ficou como estava. Apague a camada para por o look de novo.',
    }
  }
  if (!r.cor) return { rotulo: 'Cor', valor: 'nenhuma' }
  const notas = [
    r.corPresetSumiu ? `"${r.corPresetSumiu}" apagado` : null,
    r.corFaixaMuda !== null && r.corFaixaMuda !== undefined ? `V${r.corFaixaMuda + 1} muda` : null,
  ].filter((x): x is string => x !== null)
  const dicas = [
    r.corPresetSumiu ? `O preset "${r.corPresetSumiu}" foi apagado: entrou o ${r.cor}.` : null,
    r.corFaixaMuda !== null && r.corFaixaMuda !== undefined
      ? `A camada esta na V${r.corFaixaMuda + 1}, que esta muda: o video sai sem a cor.`
      : null,
  ].filter((x): x is string => x !== null)
  return {
    rotulo: 'Cor',
    valor: notas.length > 0 ? `${r.cor} (${notas.join(', ')})` : r.cor,
    ...(dicas.length > 0 ? { dica: dicas.join(' ') } : {}),
  }
}
