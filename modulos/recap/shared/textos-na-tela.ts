import { z } from 'zod'
import { FORMATOS, MOTION_CURVE_DEFAULT, type MotionCurve } from '@shared/contract'
import type { ClipeDoRecap } from './projeto-do-recap'

/**
 * [recap] OS TEXTOS NA TELA da Edicao rapida (teste real do Magic Repo Man E02,
 * 18/10): o roteiro marcava "DIVIDA MAGICA", "PAGAMENTO ROTATIVO" e "JUROS
 * ETERNOS", e o video saia sem nenhum. So o texto da 1a frase virava o card
 * de gancho -- e ela nao tinha texto, entao nem card.
 *
 * Agora:
 * - o texto da 1a frase continua sendo o CARD DE GANCHO do nucleo (hookText);
 *   sem texto nela, entra a 1a sugestao de thumb ("DIVIDA INFINITA");
 * - o texto de cada uma das outras frases vira um CLIPE DE IMAGEM na faixa de
 *   video: um PNG transparente do tamanho do quadro com o rotulo desenhado no
 *   alto (Komika Axis, branco, contorno preto e sombra rosa: o padrao das
 *   legendas do Dangai), que ENTRA com um pop (quadros-chave do nucleo,
 *   `chaves` + `curvaDasChaves` + `pivo` no centro do rotulo) e um fade, e sai
 *   com fade. Entra na palavra do rotulo ("divida"), nao no comeco da frase;
 * - o clipe leva `modulos.recap` = { papel: 'texto', fraseId, marca }: a marca
 *   e a impressao do que a Edicao rapida pos. Rodar de novo troca so os
 *   textos INTACTOS (marca igual); o que ele mexeu (moveu, cortou, escalou,
 *   mudou a chave) fica como esta, como a camada de cor.
 *
 * Regras do Levi: pouco texto (1-2 palavras, no maximo ~3), grande e legivel
 * no 9:16, na area segura, nunca em cima da legenda.
 *
 * Puro (sem disco, sem electron): roda igual no main, no renderer e nos
 * testes. NAO importa valor de roteiro.ts (roteiro -> cenas -> edicao-rapida
 * fecharia um ciclo de valor).
 */

export const PAPEL_DO_TEXTO = 'texto' as const

// ===================================================================== regras

/** Palavras de conteudo (artigo e preposicao nao contam): "DIVIDA MAGICA" = 2. */
export const TEXTO_MAX_PALAVRAS = 3
/** Palavras no total e caracteres: acima disso nao se le de relance. */
export const TEXTO_MAX_PALAVRAS_TOTAL = 4
export const TEXTO_MAX_CARACTERES = 24

/** Quanto tempo o texto fica na tela (s). */
export const TEXTO_MIN_SEC = 1.2
export const TEXTO_MAX_SEC = 2.8
/** Entra um tico antes da palavra: o pop termina quando ela soa. */
export const TEXTO_ANTES_SEC = 0.08
/** Fica um pouco depois da frase acabar (saida limpa, sem cortar no seco). */
export const TEXTO_DEPOIS_SEC = 0.3
/** Respiro entre um texto e o proximo (e o card de gancho). */
export const TEXTO_FOLGA_SEC = 0.1
/** Menos que isto na tela nao da para ler: o texto fica fora (aviso). */
export const TEXTO_CURTO_SEC = 0.6

/** A entrada: pop (escala) + fade. A saida: so fade. */
export const POP_SEC = 0.3
export const TEXTO_FADE_IN_SEC = 0.12
export const TEXTO_FADE_OUT_SEC = 0.22
export const CURVA_DO_POP: MotionCurve = 'ease-out'

/**
 * Onde o rotulo fica: o centro a 27% da altura (no 1080x1920, y = 518). Abaixo
 * da interface do TikTok/Reels no alto (~12%) e longe da legenda, que mora a
 * 35,5% do rodape por padrao (CAPTION_Y_DEFAULT): o rotulo de 2 linhas acaba
 * em ~35% da altura, a legenda comeca em ~59%.
 */
export const CENTRO_Y_PADRAO = 0.27
/** O mais alto que o rotulo sobe para fugir de uma legenda alta. */
export const CENTRO_Y_MIN = 0.17
/** A largura util do rotulo (fracao do quadro): fora das bordas e dos botoes da direita. */
export const LARGURA_UTIL = 0.8

/** A legenda: corpo de 68 px (Captions.tsx) x escala, numa linha so. */
const CORPO_DA_LEGENDA_PX = 68
/** Folga entre o rotulo e o topo da legenda (inclui o repique da entrada elastica). */
const FOLGA_DA_LEGENDA = 0.04

const VAZIAS = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'por', 'pelo', 'pela', 'com', 'sem', 'pra', 'pro', 'para', 'ao', 'aos', 'e', 'ou', 'the', 'of',
])

/** Sem acento, minusculas, so letras e numeros. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function palavrasDoRotulo(texto: string): string[] {
  return normalizar(texto).split(' ').filter(Boolean)
}

export function palavrasDeConteudo(texto: string): string[] {
  return palavrasDoRotulo(texto).filter((p) => !VAZIAS.has(p))
}

/** O rotulo como vai para a tela: uma linha, sem espaco sobrando. */
export function rotuloLimpo(texto: string | null | undefined): string {
  return (texto ?? '').replace(/\s+/g, ' ').trim()
}

/** Por que um texto de tela NAO entra no video (null = entra). */
export function porQueFicaFora(texto: string): string | null {
  const limpo = rotuloLimpo(texto)
  if (!limpo || palavrasDoRotulo(limpo).length === 0) return 'vazio'
  if (palavrasDeConteudo(limpo).length > TEXTO_MAX_PALAVRAS || palavrasDoRotulo(limpo).length > TEXTO_MAX_PALAVRAS_TOTAL) {
    return `"${limpo}" tem palavras demais (no maximo ${TEXTO_MAX_PALAVRAS})`
  }
  if (limpo.length > TEXTO_MAX_CARACTERES) return `"${limpo}" e longo demais (${TEXTO_MAX_CARACTERES} letras no maximo)`
  return null
}

/**
 * As linhas do rotulo: ate 11 letras (ou uma palavra so) numa linha; mais que
 * isso, duas linhas equilibradas ("PAGAMENTO" / "ROTATIVO"). Caixa alta.
 */
export function linhasDoRotulo(texto: string): string[] {
  const palavras = rotuloLimpo(texto).toLocaleUpperCase('pt-BR').split(' ').filter(Boolean)
  const junto = palavras.join(' ')
  if (palavras.length <= 1 || junto.length <= 11) return [junto]
  let melhor = 1
  let diferenca = Number.POSITIVE_INFINITY
  for (let i = 1; i < palavras.length; i++) {
    const d = Math.abs(palavras.slice(0, i).join(' ').length - palavras.slice(i).join(' ').length)
    if (d < diferenca) {
      diferenca = d
      melhor = i
    }
  }
  return [palavras.slice(0, melhor).join(' '), palavras.slice(melhor).join(' ')]
}

// ==================================================================== gancho

/**
 * O CARD DE GANCHO (hookText do nucleo): o texto de tela da 1a frase; sem ele,
 * a 1a sugestao de thumb do roteiro ("DIVIDA INFINITA"). Vazio = sem card.
 */
export function ganchoDoRoteiro(
  primeira: { textoDeTela: string | null } | null | undefined,
  thumbs: readonly string[] | null | undefined,
): { texto: string; origem: 'frase' | 'thumb' | null } {
  const daFrase = rotuloLimpo(primeira?.textoDeTela)
  if (daFrase) return { texto: daFrase, origem: 'frase' }
  const thumb = (thumbs ?? []).map((t) => rotuloLimpo(t)).find((t) => t.length > 0)
  if (thumb) return { texto: thumb, origem: 'thumb' }
  return { texto: '', origem: null }
}

/**
 * O que a etiqueta do texto de tela no roteiro promete (a tela diz a verdade):
 * a 1a frase vira o card de gancho; as outras entram animadas, com a Edicao
 * rapida > Textos na tela ligada.
 */
export function destinoDoTextoDeTela(e: { primeira: boolean; textosLigados: boolean }): { noVideo: boolean; dica: string } {
  if (e.primeira) return { noVideo: true, dica: 'Vai no video como card de gancho, no alto, no comeco.' }
  if (e.textosLigados) {
    return { noVideo: true, dica: 'Vai no video: entra animado no alto da tela quando a frase e dita (Edicao rapida > Textos na tela).' }
  }
  return { noVideo: false, dica: 'Fica so no roteiro: a Edicao rapida > Textos na tela esta desligada.' }
}

// ===================================================================== tempo

/** Um texto de tela de uma frase: o que a montagem/edicao rapida pede. */
export interface TextoDaFrase {
  fraseId: string
  texto: string
  /** A frase no tempo do video (s). */
  inicio: number
  fim: number
}

/** O texto no tempo do video: quando entra e quando sai. */
export interface TextoNoTempo {
  fraseId: string
  texto: string
  inicio: number
  fim: number
}

export interface PalavraNoTempo {
  texto: string
  start: number
  end: number
}

/** "divida" bate com "DIVIDA"; "juros" com "juro"; 5 letras iguais no comeco tambem. */
function mesmaPalavra(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
  return a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5)
}

/**
 * Quando o texto deve aparecer: na primeira palavra DITA da frase que e uma
 * palavra do rotulo ("divida" em "...com uma divida impagavel"). Nenhuma bate:
 * o comeco da frase. O tempo vem das palavras do take (o roteiro e a fonte do
 * texto; o tempo e o do alinhamento, nunca estimado).
 */
export function momentoDoTexto(texto: string, frase: { inicio: number; fim: number }, palavras: readonly PalavraNoTempo[]): number {
  const alvo = palavrasDeConteudo(texto)
  if (alvo.length === 0) return frase.inicio
  for (const p of palavras) {
    if (p.start < frase.inicio - 0.05 || p.start >= frase.fim) continue
    const dita = palavrasDoRotulo(p.texto)
    if (dita.some((d) => alvo.some((a) => mesmaPalavra(d, a)))) return p.start
  }
  return frase.inicio
}

/**
 * Os textos no tempo do video, em ordem: entram na palavra (TEXTO_ANTES_SEC
 * antes), ficam ate a frase acabar (+ TEXTO_DEPOIS_SEC) dentro de
 * [TEXTO_MIN_SEC, TEXTO_MAX_SEC], nunca por cima do card de gancho
 * (`ganchoAteSec`) nem do texto seguinte, nunca depois do fim do video. O que
 * ficaria menos de TEXTO_CURTO_SEC na tela fica fora (aviso).
 */
export function momentosDosTextos(
  textos: readonly TextoDaFrase[],
  palavras: readonly PalavraNoTempo[],
  e: { duracaoSec: number; ganchoAteSec: number },
): { textos: TextoNoTempo[]; avisos: string[] } {
  const avisos: string[] = []
  const brutos: TextoNoTempo[] = []
  for (const t of textos) {
    const texto = rotuloLimpo(t.texto)
    const fora = porQueFicaFora(texto)
    if (fora) {
      if (fora !== 'vazio') avisos.push(`Texto fora do video: ${fora}.`)
      continue
    }
    const palavra = momentoDoTexto(texto, t, palavras)
    const piso = e.ganchoAteSec > 0 ? e.ganchoAteSec + TEXTO_FOLGA_SEC : 0
    const inicio = Math.max(palavra - TEXTO_ANTES_SEC, t.inicio - TEXTO_ANTES_SEC, piso, 0)
    const fim = Math.min(Math.max(inicio + TEXTO_MIN_SEC, t.fim + TEXTO_DEPOIS_SEC), inicio + TEXTO_MAX_SEC, e.duracaoSec)
    brutos.push({ fraseId: t.fraseId, texto, inicio, fim })
  }
  brutos.sort((a, b) => a.inicio - b.inicio)
  const saida: TextoNoTempo[] = []
  brutos.forEach((t, i) => {
    const seguinte = brutos[i + 1]
    const fim = seguinte ? Math.min(t.fim, seguinte.inicio - TEXTO_FOLGA_SEC) : t.fim
    if (fim - t.inicio < TEXTO_CURTO_SEC) {
      avisos.push(`Texto fora do video: "${t.texto}" ficaria pouco tempo na tela.`)
      return
    }
    saida.push({ ...t, inicio: arredondar(t.inicio), fim: arredondar(fim) })
  })
  return { textos: saida, avisos }
}

// ===================================================================== lugar

/**
 * O centro vertical do rotulo (fracao da altura), longe da legenda: a legenda
 * fica a `captionY` do rodape (uma linha de 68 px x escala); o rotulo de
 * altura `alturaRel` (fracao) tem que acabar FOLGA_DA_LEGENDA acima do topo
 * dela. Legenda alta demais: o rotulo sobe ate CENTRO_Y_MIN.
 */
export function centroDoTexto(e: { captionY: number; captionScale: number; alturaRel: number; alturaPx: number }): number {
  const linha = (CORPO_DA_LEGENDA_PX * Math.max(e.captionScale, 0.5) * 1.3) / Math.max(e.alturaPx, 1)
  const topoDaLegenda = 1 - e.captionY - linha
  const limite = topoDaLegenda - FOLGA_DA_LEGENDA - e.alturaRel / 2
  const centro = Math.min(CENTRO_Y_PADRAO, limite)
  return arredondar(Math.max(centro, CENTRO_Y_MIN, e.alturaRel / 2 + 0.02))
}

/** As chaves do pop: cresce passando do ponto e assenta (escala no pivo = centro do rotulo). */
export function chavesDoPop(): { t: number; x: number; y: number; escala: number; rotacao: number }[] {
  return [
    { t: 0, x: 0, y: 0, escala: 0.6, rotacao: 0 },
    { t: 0.16, x: 0, y: 0, escala: 1.1, rotacao: 0 },
    { t: POP_SEC, x: 0, y: 0, escala: 1, rotacao: 0 },
  ]
}

// ===================================================================== clipe

/** O que o modulo guarda no clipe de texto (`modulos.recap`). */
export interface DadosDoTexto {
  papel: typeof PAPEL_DO_TEXTO
  fraseId: string
  /** A impressao do clipe como a Edicao rapida pos (marcaDoTexto). */
  marca: string
}

/** O pedaco do recap no `modulos` de um item (sem depender de projeto-do-recap: tipos so). */
function dadosDoRecap(o: { modulos?: Record<string, unknown> | undefined }): Record<string, unknown> {
  const d = o.modulos?.['recap']
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {}
}

/** O papel do clipe: o achatado (codigo do Studio) ou o de `modulos.recap`. */
function papelDe(o: { papel?: unknown; modulos?: Record<string, unknown> | undefined }): unknown {
  return o.papel ?? dadosDoRecap(o)['papel']
}

export function ehTextoDaEdicaoRapida(o: { papel?: unknown; modulos?: Record<string, unknown> | undefined }): boolean {
  return papelDe(o) === PAPEL_DO_TEXTO
}

export function fraseDoTexto(o: { modulos?: Record<string, unknown> | undefined }): string | null {
  const f = dadosDoRecap(o)['fraseId']
  return typeof f === 'string' ? f : null
}

type ClipeVisivel = Pick<
  ClipeDoRecap,
  | 'path'
  | 'tipo'
  | 'at'
  | 'inicioSec'
  | 'usarSec'
  | 'durationSec'
  | 'x'
  | 'y'
  | 'escala'
  | 'opacidade'
  | 'rotacao'
  | 'efeito'
  | 'espelhar'
  | 'fadeInSec'
  | 'fadeOutSec'
> &
  Partial<Pick<ClipeDoRecap, 'chaves' | 'curvaDasChaves' | 'pivo' | 'preencher' | 'transicaoEntrada' | 'transicaoSaida' | 'cor'>>

/** FNV-1a 32 bits, em hexa: so para comparar, sem cripto (roda no renderer). */
function hash(texto: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * A IMPRESSAO do que se ve do clipe: arquivo, tempo, lugar, tamanho, giro,
 * opacidade, fades, chaves, pivo, transicoes. Fica de fora o que pode mudar
 * sem ele "mexer no texto": id, faixa, nome, url e o `modulos`. Numeros
 * arredondados a 3 casas (o que o .dangai guarda e o que o zod devolve).
 */
export function marcaDoTexto(o: ClipeVisivel): string {
  const n = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)
  const chaves = (o.chaves ?? []).map((c) => [n(c.t), n(c.x), n(c.y), n(c.escala), n(c.rotacao)])
  const visto = [
    o.path.replace(/\\/g, '/').toLowerCase(),
    o.tipo,
    n(o.at),
    n(o.inicioSec),
    n(o.usarSec ?? o.durationSec - o.inicioSec),
    n(o.x),
    n(o.y),
    n(o.escala),
    n(o.opacidade),
    n(o.rotacao),
    o.efeito,
    o.espelhar === true,
    o.preencher === true,
    n(o.fadeInSec),
    n(o.fadeOutSec),
    chaves,
    chaves.length > 0 ? (o.curvaDasChaves ?? MOTION_CURVE_DEFAULT) : null,
    o.pivo ? [n(o.pivo.x), n(o.pivo.y)] : null,
    o.transicaoEntrada?.tipo ?? null,
    o.transicaoSaida?.tipo ?? null,
    o.cor ? JSON.stringify(o.cor) : null,
  ]
  return hash(JSON.stringify(visto))
}

/** O clipe de texto esta EXATAMENTE como a Edicao rapida pos (so a faixa pode ter mudado). */
export function textoIntacto(o: ClipeVisivel & { papel?: unknown; modulos?: Record<string, unknown> | undefined }): boolean {
  if (!ehTextoDaEdicaoRapida(o) || o.tipo !== 'image') return false
  const marca = dadosDoRecap(o)['marca']
  return typeof marca === 'string' && marca === marcaDoTexto(o)
}

/**
 * O pedido dos PNGs ao main (a montagem chama direto; o editor, pela ponte):
 * os textos, a pasta do projeto (null = a do modulo) e o que decide o lugar
 * (formato do quadro e a legenda, para nao cair em cima dela).
 */
export const pedidoDeTextosSchema = z.object({
  textos: z
    .array(z.object({ fraseId: z.string().min(1).max(40), texto: z.string().min(1).max(80) }))
    .max(60),
  pasta: z.string().min(1).max(1024).nullable(),
  formato: z.enum(FORMATOS),
  captionY: z.number().min(0).max(1),
  captionScale: z.number().min(0.1).max(5),
})
export type PedidoDeTextos = z.infer<typeof pedidoDeTextosSchema>

/** O PNG de um rotulo pronto: onde esta e onde o rotulo ficou no quadro. */
export interface PngDoTexto {
  fraseId: string
  path: string
  /** Centro do rotulo (fracao do quadro): o pivo do pop. */
  centroX: number
  centroY: number
  /** Largura/altura do PNG (= do quadro). */
  aspecto: number
}

/**
 * O clipe de texto da Edicao rapida: o PNG do tamanho do quadro (contain =
 * cai exatamente onde foi desenhado), do inicio ao fim do texto, com o pop e
 * os fades. `modulos.recap` leva o papel, a frase e a marca.
 */
export function clipeDoTexto(e: { id: string; png: PngDoTexto; texto: TextoNoTempo; faixa: number }): ClipeDoRecap {
  const usar = Math.max(arredondar(e.texto.fim - e.texto.inicio), 0.2)
  const base: ClipeDoRecap = {
    id: e.id,
    path: e.png.path,
    fileName: `Texto: ${e.texto.texto}`.slice(0, 60),
    tipo: 'image',
    faixa: e.faixa,
    at: arredondar(e.texto.inicio),
    // Imagem nao tem duracao: o teto largo do nucleo (prepararSobreposicao), ele estica a vontade.
    durationSec: 3600,
    inicioSec: 0,
    usarSec: usar,
    x: 0,
    y: 0,
    escala: 1,
    opacidade: 1,
    aspecto: e.png.aspecto,
    rotacao: 0,
    efeito: 'nenhum',
    intensidade: 0.1,
    curva: MOTION_CURVE_DEFAULT,
    pontosDaCurva: null,
    espelhar: false,
    fadeInSec: TEXTO_FADE_IN_SEC,
    fadeOutSec: TEXTO_FADE_OUT_SEC,
    chaves: chavesDoPop(),
    curvaDasChaves: CURVA_DO_POP,
    pivo: { x: arredondar(e.png.centroX), y: arredondar(e.png.centroY) },
    papel: PAPEL_DO_TEXTO,
  }
  const dados: DadosDoTexto = { papel: PAPEL_DO_TEXTO, fraseId: e.texto.fraseId, marca: marcaDoTexto(base) }
  return { ...base, modulos: { recap: dados } }
}

// ===================================================================== faixa

type NaFaixa = Pick<ClipeDoRecap, 'faixa' | 'at' | 'usarSec' | 'durationSec' | 'inicioSec' | 'tipo'> & {
  papel?: unknown
  modulos?: Record<string, unknown> | undefined
}

function fimDe(o: NaFaixa): number {
  return o.at + (o.usarSec ?? o.durationSec - o.inicioSec)
}

/**
 * A faixa de video dos textos: SEMPRE acima da camada de cor da Edicao rapida
 * (a cor corrige o que esta embaixo dela: o branco e o rosa do rotulo nao
 * podem ser tingidos), livre nos tempos dos textos e nao muda. Prefere a faixa
 * em que os textos intactos ja estavam (`preferida`).
 */
export function faixaDosTextos(
  ficam: readonly NaFaixa[],
  tempos: readonly { inicio: number; fim: number }[],
  mudas: readonly number[] = [],
  preferida: number | null = null,
): number {
  const cores = ficam.filter((o) => papelDe(o) === 'cor' || (o.tipo === 'ajuste' && dadosDoRecap(o)['papel'] === 'cor'))
  const base = cores.length > 0 ? Math.max(...cores.map((o) => o.faixa)) + 1 : 0
  const ocupada = (f: number): boolean =>
    ficam.some((o) => o.faixa === f && tempos.some((t) => o.at < t.fim - 1e-3 && fimDe(o) > t.inicio + 1e-3))
  if (preferida !== null && preferida >= base && !ocupada(preferida) && !mudas.includes(preferida)) return preferida
  let f = base
  while (ocupada(f) || mudas.includes(f)) f++
  return f
}

/** O que a rodada fez com os textos (vai para o resumo). */
export interface TextosDaRodada {
  /** Textos postos (novos ou trocados). */
  postos: number
  /** Textos que ele mexeu: ficaram como estavam. */
  mantidos: number
  /** A faixa dos textos postos (0 = V1). null = nenhum posto. */
  faixa: number | null
}

/**
 * A faixa de video com os textos da Edicao rapida (pura; o store chama com o
 * documento ATUAL). Nunca apaga trabalho dele:
 * - texto INTACTO (textoIntacto) sai e o novo da mesma frase entra no lugar,
 *   com o mesmo id (o inspetor aberto nele continua aberto);
 * - texto que ele MEXEU fica como esta, e o novo daquela frase nao entra
 *   (nada de dois textos para a mesma frase);
 * - os clipes dele (sem papel) ficam como estao.
 */
export function trocaDosTextos<T extends NaFaixa & { id: string }>(
  sobreposicoes: readonly T[],
  novos: readonly T[],
  e: { mudas?: readonly number[] } = {},
): { sobreposicoes: T[]; rodada: TextosDaRodada } {
  const textos = sobreposicoes.filter((o) => ehTextoDaEdicaoRapida(o))
  const intactos = new Set(textos.filter((o) => textoIntacto(o as unknown as ClipeVisivel & NaFaixa)))
  const mexidos = textos.filter((o) => !intactos.has(o))
  const frasesMexidas = new Set(mexidos.map((o) => fraseDoTexto(o)).filter((f): f is string => f !== null))
  const entram = novos.filter((n) => {
    const f = fraseDoTexto(n)
    return f === null || !frasesMexidas.has(f)
  })
  const ficam = sobreposicoes.filter((o) => !intactos.has(o))
  const antes = [...intactos].map((o) => o.faixa)
  const preferida = antes.length > 0 ? maisComum(antes) : null
  const faixa = faixaDosTextos(
    ficam,
    entram.map((n) => ({ inicio: n.at, fim: fimDe(n) })),
    e.mudas ?? [],
    preferida,
  )
  const idDaFrase = new Map([...intactos].map((o) => [fraseDoTexto(o), o.id] as const))
  const postos = entram.map((n) => {
    const id = idDaFrase.get(fraseDoTexto(n)) ?? n.id
    return { ...n, id, faixa }
  })
  // Os trocados ficam no lugar da lista em que estavam; os novos vao para o fim.
  const porId = new Map(postos.map((p) => [p.id, p]))
  const saida: T[] = []
  for (const o of sobreposicoes) {
    if (!intactos.has(o)) {
      saida.push(o)
      continue
    }
    const novo = porId.get(o.id)
    if (novo) {
      saida.push(novo)
      porId.delete(o.id)
    }
  }
  saida.push(...porId.values())
  return {
    sobreposicoes: saida,
    rodada: { postos: postos.length, mantidos: mexidos.length, faixa: postos.length > 0 ? faixa : null },
  }
}

function maisComum(xs: readonly number[]): number {
  const n = new Map<number, number>()
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0]
}

function arredondar(s: number): number {
  return Math.round(s * 1000) / 1000
}
