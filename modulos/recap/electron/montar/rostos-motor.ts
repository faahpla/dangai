import { spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { Formato } from '@shared/contract'
import type { FocoDoRosto, FonteDoRosto, LoteDeRostos, PedidoDeRosto, RostosDoLote } from '../../shared/edicao-rapida'
import type { EpisodeIndex, Plano } from '../../shared/episodio'
import {
  descritorDoRecorte,
  janelaVisivel,
  medidasDoQuadro,
  RECORTE_ALTURA,
  RECORTE_IGUAL,
  RECORTE_LARGURA,
  semelhancaDosRecortes,
  type DescritorDoRecorte,
  type QuadroDoRecorte,
} from '../../shared/recorte'
import { posDoKeyframe } from '../../shared/visao'
import { fichasDoNome } from '@shared/nomes'
import { abrirIndicePorId } from '../episodio/abrir-indice'
import { pastaDoPerfil } from '../episodio/perfil'
import { elencoPrincipal } from '../cenas/casar'
import { ffmpegPath } from '../ffmpeg-path'
import { configDoMotor, pastaDeDadosDoMotor } from '../motor'
import { focoNoQuadro, focosDosPedacos, instantesDoTrecho } from './foco'
import { chaveDaMetade, chaveDoPedaco } from './projeto'
import { pythonDoMotor } from '../python-do-motor'
import { ambienteDoRuntime, backendDoRuntime, usaRuntime } from '../motor-runtime'
import { rodarFfmpeg } from '../voz/ffmpeg'

/**
 * O ROSTO PELO MOTOR (Edicao rapida, agente B, 14/10).
 *
 * O detector antigo do Dangai (lbpcascade, ./foco.ts) e frontal e conservador:
 * no S4-37 achou rosto em 6 de 20 blocos. Aqui o enquadramento vem do YOLO de
 * rosto de anime do MOTOR (motor/app/matching/face_detector.py, o mesmo do
 * AnCut, com a cabeca de reserva para perfil e personagem de longe), num modo
 * headless NOVO e pequeno (`python -m app.headless rostos`, motor/app/rostos.py,
 * anotado em motor/STUDIO.md): UM processo para o lote inteiro, porque importar
 * o torch e subir a GPU custa ~8 s.
 *
 * Divisao do trabalho:
 * - o motor DETECTA (rosto/cabeca, com confianca) nos instantes pedidos e
 *   IDENTIFICA pelo CLIP QUEM e cada rosto num conjunto FECHADO
 *   (candidatosDoPedaco, 19/10): os citados, quem o indice reconhece no plano e
 *   o elenco principal do episodio -- nunca o elenco inteiro (medido no S4-37:
 *   Gen virava Gozan). Antes so identificava entre os do indice no plano, e so
 *   quando um citado estava la: no MRM E02 a fadinha "MP" (o rosto "Empee")
 *   nunca era achada e a Misa grande ganhava do Lent pequeno. Com as fotos do
 *   elenco do cache do motor (so lido). O 1o citado sem rosto achado ganha as
 *   JANELAS: o CLIP de cada posicao do recorte (a fadinha de costas em close);
 * - daqui sai a DECISAO (escolherNoPedaco, pura e testada): os rostos dos
 *   instantes viram trilhas (o mesmo rosto ao longo do pedaco), e o foco e a
 *   mediana da trilha escolhida -- um foco so por bloco, sem tremer. Escolhe a
 *   trilha do citado de maior preferencia (o 1o citado no texto do pedaco, o
 *   sujeito herdado, quem fala: nomesDaMontagem), mesmo pequena; a janela do
 *   1o citado quando so um citado depois dele tem rosto; o indice quando so ha
 *   uma pessoa na tela e o plano so tem ela; sem nada disso, a de mais presenca
 *   x tamanho ("o maior rosto", suavizado). Outro citado que cabe junto entra
 *   no enquadramento (os dois), e outro rosto grande que cabe tambem.
 * - o CACHE (19/10): a resposta do motor por arquivo, instantes e conjunto
 *   fica no perfil do modulo (rostos-cache.json): montar de novo nao roda.
 *
 * Reserva: motor desligado (lote.motor false), sem motor (app instalado sem o
 * runtime: motor-runtime/), erro ao subir ou teto: os pedacos sem resposta vao para o detector
 * antigo (focosDosPedacos), e `fonte` diz quem achou cada um. Rosto e melhoria,
 * nunca requisito: nada daqui lanca para quem chama.
 *
 * Teto: lote.tetoMs vale para a etapa inteira. O motor recebe ate 75% dele; o
 * resto fica para o detector antigo terminar o que faltou.
 */

/** Um quadro como o motor devolve (pixels do quadro original). */
export interface QuadroDoMotor {
  t: number
  /** false = o instante nao abriu (arquivo ruim, depois do fim). */
  ok: boolean
  rostos: RostoDoMotor[]
  /**
   * (19/10) O 1o citado sem rosto achado: as posicoes do recorte, da esquerda
   * para a direita, e quem cada uma mostra (motor/app/rostos.py, _Elenco.janelas).
   */
  janelas?: JanelaDoMotor[]
}

export interface RostoDoMotor {
  x: number
  y: number
  w: number
  h: number
  conf: number
  tipo: 'rosto' | 'cabeca'
  /** O nome CITADO (como veio no pedido) quando o motor identificou. */
  personagem: string | null
  /** (19/10) QUEM e o rosto (a pasta do elenco), citado ou nao, quando a identificacao passou. */
  pessoa: string | null
  /** Similaridade com quem o motor achou mais parecido (so quando identificou). */
  sim: number | null
  /** O mais parecido do elenco (pasta do personagem), so quando identificou. */
  quem: string | null
  /**
   * (4a rodada) A LUZ do rosto: o cinza medio (0-255) dentro da caixa, medido
   * aqui (comLuzDosRostos) no quadro do instante -- nunca pelo motor, e nunca
   * no cache. Ausente = nao medido.
   */
  luz?: number
  /** (4a rodada) A caixa e uma SILHUETA (ehSilhueta): escura, lisa e mais escura que o quadro. */
  silhueta?: boolean
}

/** Uma posicao do recorte no quadro (px) e o citado que ela mostra, quando mostra. */
export interface JanelaDoMotor {
  x: number
  w: number
  quem: string | null
  sim: number | null
  personagem: string | null
}

/** O que o motor devolve de um pedaco. */
export interface RostosDoPedaco {
  largura: number
  altura: number
  quadros: QuadroDoMotor[]
}

// ================================================================ decisao

/**
 * Como o foco foi escolhido (o teste e o log contam). 'janela' (19/10): o
 * citado sem rosto achado, pela posicao do recorte que mais parece com ele.
 */
export type ComoEscolheu = 'citado' | 'janela' | 'indice' | 'maior' | 'nenhum'

export interface EscolhaNoPedaco {
  /** Ponto do quadro (fracao 0..1) que vai ao centro da janela. null = centro, sem rosto. */
  centro: { centroX: number; centroY: number } | null
  /** (3a rodada) Close extremo: o recorte mira um olho (os dois nao cabem na janela). */
  olho?: 'esquerdo' | 'direito'
  /** O personagem citado que ficou enquadrado. null = o maior rosto (ou nenhum). */
  personagem: string | null
  como: ComoEscolheu
  /** Outros rostos que couberam junto na janela (plano de dois). */
  juntos: number
  instantesComRosto: number
  instantes: number
}

interface Deteccao {
  q: number
  cx: number
  cy: number
  w: number
  h: number
  peso: number
  personagem: string | null
  /** (3a rodada) Quem e o rosto, citado ou nao (RostoDoMotor.pessoa). */
  pessoa: string | null
  /** (4a rodada) 'cabeca' = a cabeca sem rosto achado (de costas, de perfil, encapuzada). */
  tipo: 'rosto' | 'cabeca'
  /** (4a rodada) RostoDoMotor.luz. null = nao medida. */
  luz: number | null
  /** (4a rodada) RostoDoMotor.silhueta. */
  silhueta: boolean
}

/** A cabeca (rosto + cabelo) tem ~2x a area do rosto: pesa metade, para nao ganhar so por ser cabeca. */
const PESO_DA_CABECA = 0.5
/**
 * (4a rodada, a edicao do Levi no Nia E01) Sem o citado identificado, a CABECA
 * SEM ROSTO (a nuca do artesao no 0294) perde do maior rosto visivel que pesa
 * pelo menos isto dela: o Levi enquadrou a Nia e a criada assistindo (focusX
 * 1,0), o app a nuca (0,04).
 */
const ROSTO_SOBRE_CABECA = 0.25
/**
 * (4a rodada) A SILHUETA: o rosto (ou cabeca) escuro (cinza medio da caixa
 * abaixo de LUZ_SILHUETA), LISO (desvio abaixo de CONTRASTE_SILHUETA: sem olho
 * nem boca) e mais escuro que o quadro (SILHUETA_NO_QUADRO da luz dele) nao e
 * o foco quando outro do plano esta ACESO (pelo menos LUZ_ACESA, sem ser
 * silhueta) e pesa pelo menos ACESO_PESO_MIN dele -- o 0132 do Nia: o mordomo
 * em silhueta (0,917) contra a criada iluminada (o Levi, 0,0). O rosto na
 * NOITE nao e silhueta: o Lent do MRM E02 tem luz 51-75, mas desvio 39-53 (o
 * olho, a boca) num quadro de 37-88. Sem rosto aceso (o 0038, a silhueta que o
 * Levi escolheu), a silhueta continua o foco.
 */
export const LUZ_SILHUETA = 60
export const CONTRASTE_SILHUETA = 25
const SILHUETA_NO_QUADRO = 0.7
export const LUZ_ACESA = 100
const ACESO_PESO_MIN = 0.25

/** (4a rodada) A caixa e uma silhueta: escura, lisa e mais escura que o quadro em volta. */
export function ehSilhueta(caixa: { media: number; desvio: number }, luzDoQuadro: number): boolean {
  return caixa.media < LUZ_SILHUETA && caixa.desvio < CONTRASTE_SILHUETA && caixa.media < SILHUETA_NO_QUADRO * luzDoQuadro
}
/** O mesmo rosto de um instante ao outro: anda menos que o proprio tamanho e nao muda de escala demais. */
const ANDA_NO_MAXIMO = 1.0
const ESCALA_NO_MAXIMO = 3
/**
 * O citado identificado so ganha do maior quando pesa pelo menos isto dele.
 * Era 0,2 (no S4-37 um figurante de fundo saiu "Chrome"); desde 19/10 o
 * conjunto fechado tem o elenco principal e cada rosto precisa ganhar com folga
 * dos outros -- e o citado pequeno de verdade (o Lent no meio da rua, a fadinha
 * voando a 50 px no MRM E02) pesava 0,07-0,18 do maior.
 */
const CITADO_PESO_MIN = 0.03
/** Outro rosto entra junto quando pesa pelo menos isto do escolhido... */
const JUNTO_PESO_MIN = 0.5
/** ...e os dois cabem nesta fracao da janela visivel (folga para o Ken Burns). */
const JUNTO_CABE = 0.9

/** Mediana ponderada (poucos valores: a trilha tem no maximo um por instante). */
function medianaPonderada(valores: readonly { v: number; p: number }[]): number {
  const ordem = [...valores].sort((a, b) => a.v - b.v)
  const total = ordem.reduce((s, x) => s + x.p, 0)
  let acc = 0
  for (let i = 0; i < ordem.length; i++) {
    acc += ordem[i]!.p
    // Exatamente na metade (dois instantes de mesmo peso): o meio dos dois.
    if (Math.abs(acc - total / 2) <= total * 1e-9 && i + 1 < ordem.length) return (ordem[i]!.v + ordem[i + 1]!.v) / 2
    if (acc >= total / 2) return ordem[i]!.v
  }
  return ordem[ordem.length - 1]?.v ?? 0.5
}

/** A vogal longa do romaji: "Senkuu" (MyAnimeList) == "Senku" (roteiro). O semVogalLonga do nomes.ts. */
function fichasCurtas(nome: string): string[] {
  return fichasDoNome(nome).map((f) => f.replace(/ou/g, 'o').replace(/uu/g, 'u').replace(/oo/g, 'o'))
}

/** A mesma pessoa: as mesmas palavras, ou um nome contido no outro ("Senku" em "Ishigami, Senkuu"). */
export function mesmaPessoa(a: string, b: string): boolean {
  const fa = new Set(fichasCurtas(a))
  const fb = new Set(fichasCurtas(b))
  if (fa.size === 0 || fb.size === 0) return false
  const [menor, maior] = fa.size <= fb.size ? [fa, fb] : [fb, fa]
  for (const f of menor) if (!maior.has(f)) return false
  return true
}

/** A largura visivel da janela do formato (ou da metade do grid), em fracao da largura do quadro. */
export function janelaDoFormato(largura: number, altura: number, formato: QuadroDoRecorte = 'short'): number {
  const m = medidasDoQuadro(formato)
  const escala = Math.max(m.renderWidth / largura, m.renderHeight / altura)
  return Math.min(1, m.width / escala / largura)
}

/**
 * O foco de UM pedaco a partir dos quadros do motor (pura).
 *
 * `citados`: quem o pedaco cita, em ordem de preferencia (o 1o citado no texto,
 * o sujeito herdado, quem fala, os do evento). `noPlano`: quem o indice
 * reconhece no plano (pode estar vazio). `janela`: janelaDoFormato.
 *
 * A decisao (19/10):
 *   1. a trilha do citado de maior preferencia que o motor identificou (mesmo
 *      pequena, ate CITADO_PESO_MIN do maior rosto);
 *   2. o 1o citado sem rosto achado, mas com a mesma posicao do recorte
 *      parecendo com ele na maioria dos instantes (as `janelas` do motor), ganha
 *      de um citado depois dele (a fadinha de costas em close no "Ela ativou");
 *   3. o indice: uma pessoa so na tela, e o plano so tem ela, citada;
 *   4. sem identidade: o maior rosto (o de sempre).
 * Outro CITADO que cabe junto na janela entra no enquadramento (os dois); nao
 * cabendo, fica o de maior preferencia. Outro rosto grande que cabe tambem
 * entra (plano de dois), como antes.
 */
export function escolherNoPedaco(
  pedaco: RostosDoPedaco,
  citados: readonly string[],
  noPlano: readonly string[],
  janela: number,
): EscolhaNoPedaco {
  const { largura, altura, quadros } = pedaco
  const instantes = quadros.length
  const instantesComRosto = quadros.filter((q) => q.ok && q.rostos.length > 0).length
  const nada: EscolhaNoPedaco = { centro: null, personagem: null, como: 'nenhum', juntos: 0, instantesComRosto, instantes }
  if (largura <= 0 || altura <= 0) return nada
  const rankDe = (nome: string | null): number => {
    if (!nome) return Infinity
    const i = citados.findIndex((c) => c === nome || mesmaPessoa(c, nome))
    return i >= 0 ? i : Infinity
  }

  // 1. Trilhas: o mesmo rosto de um instante ao outro (trilhasDoPedaco).
  const trilhas = trilhasDoPedaco(pedaco)

  const pesoDa = (t: readonly Deteccao[]): number => t.reduce((s, d) => s + d.peso, 0)
  const rankDa = (t: readonly Deteccao[]): number => Math.min(Infinity, ...t.map((d) => rankDe(d.personagem)))
  const porPeso = [...trilhas].sort((a, b) => pesoDa(b) - pesoDa(a))
  const maiorPeso = porPeso[0] ? pesoDa(porPeso[0]) : 0
  // (4a rodada) A silhueta escura com um rosto aceso no plano nao e foco, nem citada.
  const escura = (t: readonly Deteccao[]): boolean => t.filter((d) => d.silhueta).length * 2 > t.length
  const silhueta = (t: readonly Deteccao[]): boolean =>
    escura(t) && porPeso.some((o) => o !== t && !escura(o) && (luzDaTrilha(o) ?? 0) >= LUZ_ACESA && pesoDa(o) >= ACESO_PESO_MIN * pesoDa(t))
  // Rosto miudo de fundo nao puxa o quadro, mesmo marcado (o CLIP erra mais neles).
  const citadas = porPeso
    .filter((t) => pesoDa(t) >= CITADO_PESO_MIN * maiorPeso && !silhueta(t))
    .map((t) => ({ t, rank: rankDa(t) }))
    .filter((x) => Number.isFinite(x.rank))
    .sort((a, b) => a.rank - b.rank || pesoDa(b.t) - pesoDa(a.t))
  const rankDaTrilha = citadas[0]?.rank ?? Infinity

  // 2. A janela do citado de maior preferencia que nenhuma trilha mostra.
  const pelaJanela = janelaDoCitado(quadros, citados, rankDe, rankDaTrilha)
  if (pelaJanela) {
    return {
      centro: { centroX: Math.min(1, Math.max(0, pelaJanela.centro / largura)), centroY: 0.5 },
      personagem: citados[pelaJanela.rank] ?? null,
      como: 'janela',
      juntos: 0,
      instantesComRosto,
      instantes,
    }
  }
  if (trilhas.length === 0) return nada

  // 3. Quem: o citado identificado (o de maior preferencia); senao o indice; senao o maior
  // VISIVEL (4a rodada): o rosto no lugar da nuca, o aceso no lugar da silhueta.
  let escolhida = maiorVisivel(porPeso, pesoDa, silhueta)
  let como: ComoEscolheu = 'maior'
  let personagem: string | null = null
  if (citadas.length > 0) {
    escolhida = citadas[0]!.t
    como = 'citado'
    personagem = citados[citadas[0]!.rank] ?? null
  } else if (citados.length > 0 && trilhas.length === 1) {
    // Uma pessoa so na tela, e o indice diz que o plano tem UMA pessoa e
    // ela e citada: e ela (o que o indice sabe, sem precisar do CLIP).
    const pessoas: string[] = []
    for (const n of noPlano) if (!pessoas.some((p) => mesmaPessoa(p, n))) pessoas.push(n)
    const unica = pessoas.length === 1 ? pessoas[0]! : null
    const citado = unica ? citados.find((c) => mesmaPessoa(c, unica)) : undefined
    if (citado) {
      como = 'indice'
      personagem = citado
    }
  }

  // 4. Onde: a mediana da trilha (suaviza o pedaco inteiro num foco so).
  const caixa = caixaDaTrilha
  const base = caixa(escolhida)
  let x0 = base.cx - base.w / 2
  let x1 = base.cx + base.w / 2
  let y0 = base.cy - base.h / 2
  let y1 = base.cy + base.h / 2
  let juntos = 0
  const juntar = (t: readonly Deteccao[]): void => {
    const c = caixa(t)
    const nx0 = Math.min(x0, c.cx - c.w / 2)
    const nx1 = Math.max(x1, c.cx + c.w / 2)
    if (nx1 - nx0 > janela * JUNTO_CABE) return
    x0 = nx0
    x1 = nx1
    y0 = Math.min(y0, c.cy - c.h / 2)
    y1 = Math.max(y1, c.cy + c.h / 2)
    juntos += 1
  }
  // Os outros citados primeiro (os dois cabem: os dois), depois os rostos grandes.
  for (const { t } of citadas) if (t !== escolhida) juntar(t)
  const pesoEscolhida = pesoDa(escolhida)
  for (const t of porPeso) {
    if (t === escolhida || citadas.some((c) => c.t === t) || pesoDa(t) < JUNTO_PESO_MIN * pesoEscolhida) continue
    juntar(t)
  }
  // (3a rodada) A reserva do close extremo (o casar evita, mas ele entra sem outra saida ou travado):
  // os dois olhos nao cabem na janela -> o recorte mira UM olho, nunca o nariz e a boca.
  const olho = juntos === 0 ? centroNumOlho(base, janela) : null
  return {
    centro: olho ? { centroX: olho.centroX, centroY: (y0 + y1) / 2 } : { centroX: (x0 + x1) / 2, centroY: (y0 + y1) / 2 },
    personagem,
    como,
    juntos,
    instantesComRosto,
    instantes,
    ...(olho ? { olho: olho.olho } : {}),
  }
}

/** A luz de uma trilha: a mediana das medidas (null = nenhuma medida). */
function luzDaTrilha(t: readonly Deteccao[]): number | null {
  const ls = t.map((d) => d.luz).filter((l): l is number => l !== null).sort((a, b) => a - b)
  return ls.length > 0 ? ls[Math.floor((ls.length - 1) / 2)]! : null
}

/**
 * (4a rodada) O MAIOR VISIVEL, sem citado: a trilha mais pesada, menos (1) a
 * cabeca sem rosto quando um rosto visivel pesa ROSTO_SOBRE_CABECA dela e (2) a
 * silhueta escura quando um rosto aceso pesa ACESO_PESO_MIN dela. `porPeso`
 * vem do mais pesado ao mais leve.
 */
function maiorVisivel(
  porPeso: readonly Deteccao[][],
  pesoDa: (t: readonly Deteccao[]) => number,
  silhueta: (t: readonly Deteccao[]) => boolean,
): Deteccao[] {
  const soCabeca = (t: readonly Deteccao[]): boolean => t.every((d) => d.tipo === 'cabeca')
  let t = porPeso[0]!
  if (soCabeca(t)) {
    const rosto = porPeso.find((x) => !soCabeca(x) && !silhueta(x) && pesoDa(x) >= ROSTO_SOBRE_CABECA * pesoDa(t))
    if (rosto) t = rosto
  }
  if (silhueta(t)) {
    const acesa = porPeso.find((x) => x !== t && !silhueta(x) && (luzDaTrilha(x) ?? 0) >= LUZ_ACESA)
    if (acesa) t = acesa
  }
  return t
}

/** Em rosto de anime, os olhos ficam a ~30% e ~70% da largura da caixa: +-OLHO_X do centro. */
const OLHO_X = 0.2
/** O olho fica a esta fracao da janela, do lado de fora: o resto do rosto entra pelo lado de dentro. */
const OLHO_NA_JANELA = 0.3

/**
 * (19/10, 3a rodada) O CLOSE EXTREMO na tela (o Nia E01, bloco 1: o rosto
 * maior que a janela, os olhos perto das bordas do 16:9, e o recorte no meio
 * mostrava so o nariz e a boca): quando os dois olhos (estimados pela caixa,
 * OLHO_X) nao cabem na janela, o recorte mira o olho que esta dentro do quadro
 * e mais perto do meio dele, com o olho a OLHO_NA_JANELA da borda de fora. A
 * caixa cortada pela borda do quadro vale pela parte visivel. null = cabem (o
 * de sempre: o meio dos olhos e o meio da caixa).
 */
export function centroNumOlho(caixa: { cx: number; w: number }, janela: number): { centroX: number; olho: 'esquerdo' | 'direito' } | null {
  if (!(janela > 0) || 2 * OLHO_X * caixa.w <= janela) return null
  const esq = caixa.cx - OLHO_X * caixa.w
  const dir = caixa.cx + OLHO_X * caixa.w
  const dentro = (x: number): boolean => x >= 0.02 && x <= 0.98
  const opcoes = [
    { x: esq, olho: 'esquerdo' as const },
    { x: dir, olho: 'direito' as const },
  ].filter((o) => dentro(o.x))
  if (opcoes.length === 0) return null
  const o = opcoes.sort((a, b) => Math.abs(a.x - 0.5) - Math.abs(b.x - 0.5))[0]!
  // O resto do rosto fica para dentro: o olho esquerdo na parte esquerda da janela, o direito na direita.
  const desvio = (0.5 - OLHO_NA_JANELA) * janela
  const centroX = o.olho === 'esquerdo' ? o.x + desvio : o.x - desvio
  return { centroX: Math.min(1 - janela / 2, Math.max(janela / 2, centroX)), olho: o.olho }
}

/** As trilhas do pedaco: o mesmo rosto de um instante ao outro (guloso, do maior ao menor). */
function trilhasDoPedaco(pedaco: RostosDoPedaco): Deteccao[][] {
  const { largura, altura, quadros } = pedaco
  const trilhas: Deteccao[][] = []
  if (largura <= 0 || altura <= 0) return trilhas
  quadros.forEach((quadro, q) => {
    if (!quadro.ok) return
    const dets: Deteccao[] = quadro.rostos
      .filter((r) => r.w > 0 && r.h > 0)
      .map((r) => {
        const w = r.w / largura
        const h = r.h / altura
        return {
          q,
          cx: (r.x + r.w / 2) / largura,
          cy: (r.y + r.h / 2) / altura,
          w,
          h,
          peso: w * h * (r.tipo === 'cabeca' ? PESO_DA_CABECA : 1),
          personagem: r.personagem,
          pessoa: r.pessoa ?? null,
          tipo: r.tipo === 'cabeca' ? ('cabeca' as const) : ('rosto' as const),
          luz: typeof r.luz === 'number' && Number.isFinite(r.luz) ? r.luz : null,
          silhueta: r.silhueta === true,
        }
      })
      .sort((a, b) => b.peso - a.peso)
    const usadas = new Set<Deteccao[]>()
    for (const d of dets) {
      let melhor: Deteccao[] | null = null
      let menor = Infinity
      for (const t of trilhas) {
        if (usadas.has(t)) continue
        const u = t[t.length - 1]!
        if (u.q >= q) continue
        const escala = (d.w * d.h) / (u.w * u.h)
        if (escala > ESCALA_NO_MAXIMO || escala < 1 / ESCALA_NO_MAXIMO) continue
        const anda = Math.hypot((d.cx - u.cx) / Math.max(d.w, u.w), (d.cy - u.cy) / Math.max(d.h, u.h))
        if (anda < ANDA_NO_MAXIMO && anda < menor) {
          menor = anda
          melhor = t
        }
      }
      if (melhor) {
        melhor.push(d)
        usadas.add(melhor)
      } else {
        const nova = [d]
        trilhas.push(nova)
        usadas.add(nova)
      }
    }
  })
  return trilhas
}

/** A caixa de uma trilha: a mediana ponderada de cada medida (um foco so por pedaco). */
function caixaDaTrilha(t: readonly Deteccao[]): { cx: number; cy: number; w: number; h: number } {
  return {
    cx: medianaPonderada(t.map((d) => ({ v: d.cx, p: d.peso }))),
    cy: medianaPonderada(t.map((d) => ({ v: d.cy, p: d.peso }))),
    w: medianaPonderada(t.map((d) => ({ v: d.w, p: d.peso }))),
    h: medianaPonderada(t.map((d) => ({ v: d.h, p: d.peso }))),
  }
}

/** Um recorte possivel de um pedaco: centrado num rosto (fracao do quadro) e quem ele mostra. */
export interface OutroRecorte {
  centro: { centroX: number; centroY: number }
  /** Quem o rosto e (o motor identificou), ou null. */
  quem: string | null
  peso: number
}

/**
 * (3a rodada) OS OUTROS RECORTES de um pedaco: cada rosto que aparece de verdade
 * (trilha com pelo menos CITADO_PESO_MIN do maior), fora do recorte de agora
 * (mais de meia janela do centro atual), um por posicao. Na ordem: quem o
 * pedaco cita (`preferidos`), depois o maior. Pura: o pos-passo do recorte
 * (semRecortesIguais) prova cada um contra a cena vizinha.
 */
export function outrosRecortes(
  pedaco: RostosDoPedaco,
  preferidos: readonly string[],
  janela: number,
  centroAtual: number | null,
): OutroRecorte[] {
  const trilhas = trilhasDoPedaco(pedaco)
  if (trilhas.length === 0) return []
  const pesoDa = (t: readonly Deteccao[]): number => t.reduce((s, d) => s + d.peso, 0)
  const maior = Math.max(...trilhas.map(pesoDa))
  const quemDa = (t: readonly Deteccao[]): string | null => {
    const conta = new Map<string, number>()
    for (const d of t) {
      const n = d.pessoa ?? d.personagem
      if (n) conta.set(n, (conta.get(n) ?? 0) + d.peso)
    }
    return [...conta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }
  const rankDe = (nome: string | null): number => {
    if (!nome) return Infinity
    const i = preferidos.findIndex((c) => c === nome || mesmaPessoa(c, nome))
    return i >= 0 ? i : Infinity
  }
  const todos = trilhas
    .filter((t) => pesoDa(t) >= CITADO_PESO_MIN * maior)
    .map((t) => {
      const c = caixaDaTrilha(t)
      return { centro: { centroX: c.cx, centroY: c.cy }, quem: quemDa(t), peso: pesoDa(t) }
    })
    .sort((a, b) => rankDe(a.quem) - rankDe(b.quem) || b.peso - a.peso)
  const saida: OutroRecorte[] = []
  for (const r of todos) {
    if (centroAtual !== null && Math.abs(r.centro.centroX - centroAtual) < janela / 2) continue
    if (saida.some((x) => Math.abs(x.centro.centroX - r.centro.centroX) < janela / 2)) continue
    saida.push(r)
  }
  return saida
}

/**
 * (19/10) A posicao do recorte do citado que nenhum rosto mostra: a janela
 * marcada para ele na MAIORIA dos instantes, todas na mesma posicao ou na
 * vizinha (a mediana delas). So o citado de preferencia MAIOR que o da trilha
 * achada conta. null = nenhuma.
 */
export function janelaDoCitado(
  quadros: readonly QuadroDoMotor[],
  citados: readonly string[],
  rankDe: (nome: string | null) => number,
  rankDaTrilha: number,
): { centro: number; rank: number } | null {
  const validos = quadros.filter((q) => q.ok)
  if (validos.length === 0) return null
  const porRank = new Map<number, number[]>()
  for (const q of validos) {
    // Num quadro, a janela marcada mais parecida com cada citado.
    const melhor = new Map<number, JanelaDoMotor>()
    for (const j of q.janelas ?? []) {
      const r = rankDe(j.personagem)
      if (!Number.isFinite(r) || r >= rankDaTrilha) continue
      const atual = melhor.get(r)
      if (!atual || (j.sim ?? 0) > (atual.sim ?? 0)) melhor.set(r, j)
    }
    for (const [r, j] of melhor) porRank.set(r, [...(porRank.get(r) ?? []), j.x + j.w / 2])
  }
  const metade = Math.floor(validos.length / 2) + 1
  for (const r of [...porRank.keys()].sort((a, b) => a - b)) {
    const centros = [...porRank.get(r)!].sort((a, b) => a - b)
    if (centros.length < metade || r >= citados.length) continue
    const w = (validos.flatMap((q) => q.janelas ?? [])[0]?.w ?? 0) || 1
    // As marcadas no mesmo lugar (ou na posicao vizinha): a pessoa nao pulou de um lado ao outro.
    if (centros[centros.length - 1]! - centros[0]! > w * 0.75) continue
    return { centro: centros[Math.floor((centros.length - 1) / 2)]!, rank: r }
  }
  return null
}

// ================================================================== motor

/** Para os testes (sem Electron) e para trocar o motor; tudo opcional. */
export interface OpcoesDoRostoPeloMotor {
  /** O python do venv do motor. Padrao: <appPath>/motor/.venv/Scripts/python.exe. */
  python?: string
  /** A pasta motor/ (cwd do processo). */
  cwd?: string
  /** ANIRECAP_MOTOR_DADOS (elenco e config do motor, so lidos). Padrao: pastaDeDadosDoMotor(). */
  dados?: string
  /** O indice ja aberto. Padrao: abrirIndicePorId(lote.episodioId); null = sem indice. */
  indice?: Pick<EpisodeIndex, 'anime' | 'temporada' | 'planos'> | null
  /** O stderr do motor. Padrao: <dados>/logs/ultimos-rostos.log. null = nao grava. */
  log?: string | null
  /** false = so detectar (nao sobe o CLIP). Padrao: true. */
  identificar?: boolean
  /**
   * (19/10) O cache das respostas do motor por plano e instante (o mesmo
   * pedaco nao roda de novo). Padrao: <perfil do modulo>/rostos-cache.json.
   * null = sem cache.
   */
  cache?: string | null
}

interface Backend {
  python: string
  cwd: string
  dados: string
  /** O runtime do app instalado: o ambiente vem do ambienteDoRuntime. */
  runtime?: { cudaOk: boolean; modelos: string }
}

function backend(o: OpcoesDoRostoPeloMotor): Backend | { erro: string } {
  try {
    if (o.python && o.cwd) return { python: o.python, cwd: o.cwd, dados: o.dados ?? pastaDeDadosDoMotor() }
    const c = configDoMotor()
    // App instalado: o runtime baixado no 1o uso (o mesmo do motor.ts). Sem ele, o detector antigo.
    if (usaRuntime()) {
      const r = backendDoRuntime()
      if ('erro' in r) return { erro: r.erro }
      return { python: r.python, cwd: r.cwd, dados: o.dados ?? pastaDeDadosDoMotor(), runtime: { cudaOk: r.cudaOk, modelos: r.modelos } }
    }
    const cwd = join(c.appPath, 'motor')
    const python =
      process.platform === 'win32' ? join(cwd, '.venv', 'Scripts', 'python.exe') : join(cwd, '.venv', 'bin', 'python')
    if (!existsSync(python)) return { erro: 'motor de personagens nao instalado' }
    return { python, cwd, dados: o.dados ?? pastaDeDadosDoMotor() }
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) }
  }
}

/** Processos vivos, para a saida do app nao deixar orfao. */
const vivos = new Set<ChildProcess>()

function matarArvore(filho: ChildProcess, sincrono = false): void {
  const pid = filho.pid
  if (!pid || filho.exitCode !== null || filho.signalCode !== null) return
  if (process.platform !== 'win32') {
    filho.kill('SIGKILL')
    return
  }
  // O child.kill() so derruba o python no Windows; o /T leva o ffmpeg de reserva junto.
  const args = ['/PID', String(pid), '/T', '/F']
  if (sincrono) spawnSync('taskkill', args, { windowsHide: true, timeout: 5000, stdio: 'ignore' })
  else spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => filho.kill())
}

/** Ha um lote de rostos rodando (o runtime nao reinstala por baixo dele). */
export function rostosRodando(): boolean {
  return [...vivos].some((f) => f.exitCode === null && f.signalCode === null)
}

/** Mata o motor de rostos que estiver rodando (saida do app). */
export function encerrarRostosDoMotor(): void {
  for (const f of vivos) matarArvore(f, true)
  vivos.clear()
}

export interface ItemDoMotor {
  chave: string
  arquivo: string
  instantes: number[]
  /** Quem o pedaco cita, em ordem de preferencia. */
  personagens: string[]
  /**
   * O conjunto FECHADO em que o motor identifica cada rosto (candidatosDoPedaco):
   * os citados, quem o indice reconhece no plano e o elenco principal. Vazio =
   * nao identifica.
   */
  candidatos: string[]
  /** (rodada 4) A janela DESTE item (a metade do grid), no lugar da do lote. Ausente = a do lote. */
  aspecto?: number
}

export interface RespostaDoMotor {
  resultados: Map<string, RostosDoPedaco>
  /** null = respondeu tudo. Senao, por que parou (ASCII). */
  falha: string | null
  /** Tempo ate os modelos subirem (torch + YOLO + aquecer a GPU). */
  prontoMs: number | null
  gpu: boolean | null
  /** A pasta do elenco usada para identificar. null = sem identificar. */
  elenco: string | null
  semElenco: string | null
  identificados: number
  clipMs: number
  ms: number
}

/**
 * Roda o modo `rostos` do motor e junta as respostas. Nunca lanca: falha vira
 * `falha` e o que chegou antes fica em `resultados`.
 */
export function rodarMotorDeRostos(
  itens: readonly ItemDoMotor[],
  extra: { anime: string | null; temporada: number | null; identificar: boolean; aspecto?: number | null },
  limiteMs: number,
  o: OpcoesDoRostoPeloMotor = {},
): Promise<RespostaDoMotor> {
  const inicio = Date.now()
  const resposta: RespostaDoMotor = {
    resultados: new Map(),
    falha: null,
    prontoMs: null,
    gpu: null,
    elenco: null,
    semElenco: null,
    identificados: 0,
    clipMs: 0,
    ms: 0,
  }
  const b = backend(o)
  if ('erro' in b) return Promise.resolve({ ...resposta, falha: b.erro })

  return new Promise((resolver) => {
    const stderr: string[] = []
    let acabou = false
    let fim = false
    let filho: ChildProcessWithoutNullStreams

    const terminar = (falha: string | null): void => {
      if (acabou) return
      acabou = true
      clearTimeout(relogio)
      vivos.delete(filho)
      try {
        filho.stdin.end()
      } catch {
        // ja fechado
      }
      if (!fim && !falha) falha = stderr.length ? `o motor parou: ${ascii(stderr.slice(-3).join(' | ')).slice(0, 300)}` : 'o motor parou sem responder'
      resposta.falha = falha
      resposta.ms = Date.now() - inicio
      const log = o.log === undefined ? join(b.dados, 'logs', 'ultimos-rostos.log') : o.log
      if (log) {
        try {
          mkdirSync(dirname(log), { recursive: true })
          writeFileSync(log, stderr.slice(-400).join('\n'), 'utf8')
        } catch {
          // log e conveniencia
        }
      }
      resolver(resposta)
    }

    let env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      // O run.py do exe liga isto; rodando o modulo, a ultralytics tentaria um pip install sozinha.
      YOLO_AUTOINSTALL: 'false',
      ANIRECAP_MOTOR_DADOS: b.dados,
    }
    if (b.runtime) {
      // App instalado: ffmpeg do app primeiro, Python isolado, sem .pyc na pasta de instalacao.
      env = ambienteDoRuntime(env, b.runtime)
    } else {
      const chavePath = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
      env[chavePath] = [env[chavePath], dirname(ffmpegPath)].filter(Boolean).join(delimiter)
    }

    try {
      // Direto no Python base, sem o lancador do venv (python-do-motor.ts).
      const py = pythonDoMotor(b.python)
      filho = spawn(py.cmd, ['-m', 'app.headless', 'rostos'], { cwd: b.cwd, windowsHide: true, env: { ...env, ...py.env } })
    } catch (e) {
      resolver({ ...resposta, falha: e instanceof Error ? e.message : String(e), ms: Date.now() - inicio })
      return
    }
    vivos.add(filho)
    const relogio = setTimeout(() => {
      matarArvore(filho)
      terminar(`o motor nao terminou em ${Math.round(limiteMs / 1000)} s`)
    }, limiteMs)

    let resto = ''
    filho.stdout.setEncoding('utf8')
    filho.stdout.on('data', (d: string) => {
      resto += d
      let i = resto.indexOf('\n')
      while (i >= 0) {
        const linha = resto.slice(0, i).trim()
        resto = resto.slice(i + 1)
        if (linha) lerLinha(linha)
        i = resto.indexOf('\n')
      }
    })
    let resto2 = ''
    filho.stderr.setEncoding('utf8')
    filho.stderr.on('data', (d: string) => {
      resto2 += d
      const linhas = resto2.split(/\r?\n/)
      resto2 = linhas.pop() ?? ''
      for (const l of linhas) if (l.trim()) stderr.push(l)
      if (stderr.length > 600) stderr.splice(0, stderr.length - 600)
    })
    filho.stdin.on('error', () => {})
    filho.on('error', (e) => terminar(e.message))
    filho.on('close', () => terminar(null))

    // A requisicao na 1a linha; o stdin fica ABERTO: pipe fechado o motor le como "o host morreu".
    filho.stdin.write(
      `${JSON.stringify({ itens, anime: extra.anime, temporada: extra.temporada, identificar: extra.identificar, aspecto: extra.aspecto ?? null })}\n`,
    )

    function lerLinha(linha: string): void {
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(linha) as Record<string, unknown>
      } catch {
        return
      }
      if (ev['type'] === 'pronto') {
        resposta.prontoMs = num(ev['ms'])
        resposta.gpu = ev['gpu'] === true
        resposta.elenco = typeof ev['elenco'] === 'string' ? ev['elenco'] : null
        resposta.semElenco = typeof ev['semElenco'] === 'string' ? ev['semElenco'] : null
      } else if (ev['type'] === 'rostos' && typeof ev['chave'] === 'string') {
        resposta.resultados.set(ev['chave'], {
          largura: num(ev['largura']) ?? 0,
          altura: num(ev['altura']) ?? 0,
          quadros: Array.isArray(ev['quadros']) ? (ev['quadros'] as unknown[]).map(lerQuadro) : [],
        })
      } else if (ev['type'] === 'fim') {
        fim = true
        resposta.identificados = num(ev['identificados']) ?? 0
        resposta.clipMs = num(ev['clipMs']) ?? 0
      } else if (ev['type'] === 'failed') {
        const m = typeof ev['message'] === 'string' ? ev['message'] : 'erro do motor'
        matarArvore(filho)
        terminar(ascii(m).slice(0, 300))
      }
    }
  })
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function ascii(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?')
}

function lerQuadro(cru: unknown): QuadroDoMotor {
  const q = (cru && typeof cru === 'object' ? cru : {}) as Record<string, unknown>
  const rostos = Array.isArray(q['rostos']) ? (q['rostos'] as unknown[]) : []
  return {
    t: num(q['t']) ?? 0,
    ok: q['ok'] !== false,
    rostos: rostos
      .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
      .map((r) => ({
        x: num(r['x']) ?? 0,
        y: num(r['y']) ?? 0,
        w: num(r['w']) ?? 0,
        h: num(r['h']) ?? 0,
        conf: num(r['conf']) ?? 0,
        tipo: r['tipo'] === 'cabeca' ? ('cabeca' as const) : ('rosto' as const),
        personagem: typeof r['personagem'] === 'string' ? r['personagem'] : null,
        pessoa: typeof r['pessoa'] === 'string' ? r['pessoa'] : null,
        sim: num(r['sim']),
        quem: typeof r['quem'] === 'string' ? r['quem'] : null,
      }))
      .filter((r) => r.w > 0 && r.h > 0),
    ...(Array.isArray(q['janelas'])
      ? {
          janelas: (q['janelas'] as unknown[])
            .map((j) => (j && typeof j === 'object' ? (j as Record<string, unknown>) : {}))
            .map((j) => ({
              x: num(j['x']) ?? 0,
              w: num(j['w']) ?? 0,
              quem: typeof j['quem'] === 'string' ? j['quem'] : null,
              sim: num(j['sim']),
              personagem: typeof j['personagem'] === 'string' ? j['personagem'] : null,
            }))
            .filter((j) => j.w > 0),
        }
      : {}),
  }
}

// ================================================================== o lote

/** Fracao do teto que o motor pode gastar; o resto e do detector antigo. */
const PARTE_DO_MOTOR = 0.75

/** Quem o indice reconhece no plano que e este mp4 (pelo caminho, sem caixa nem barra). */
function personagensPorArquivo(indice: Pick<EpisodeIndex, 'planos'> | null): (arquivo: string) => string[] {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
  const mapa = new Map<string, string[]>()
  for (const p of indice?.planos ?? []) mapa.set(norm(p.arquivo), p.personagens.map((x) => x.nome))
  return (arquivo) => mapa.get(norm(arquivo)) ?? []
}

/** As deteccoes ja medidas por indice (a sugestao de cenas pede de novo a cada frase). */
const deteccoesPorIndice = new Map<string, Promise<Map<string, RostosDoPedaco>>>()

/**
 * (19/10, 3a rodada) A LARGURA DO MAIOR ROSTO de cada plano (fracao do quadro),
 * para o casar evitar o close extremo: o modo rostos do motor nos 3 instantes
 * de cada plano (25/50/75%), so detectando (sem identificar), com o mesmo
 * cache do rostosDosPedacos -- a 1a vez de um episodio leva ~1 min (375 planos
 * do MRM E02: 63 s na GPU); depois, nada. A largura e a mediana entre os
 * instantes do maior rosto de cada um. Sem motor ou teto: o que chegou (o
 * casar fica sem a regra nos outros).
 */
export async function largurasDosRostos(
  indice: Pick<EpisodeIndex, 'id' | 'anime' | 'temporada' | 'planos' | 'atualizadoEm'>,
  o: OpcoesDoRostoPeloMotor & { tetoMs?: number } = {},
): Promise<Map<string, number>> {
  const saida = new Map<string, number>()
  for (const [id, achado] of await deteccoesDosPlanos(indice, o)) {
    const w = larguraDoMaiorRosto(achado)
    if (w !== null) saida.set(id, w)
  }
  return saida
}

/**
 * (rodada 4) A ALTURA DO MAIOR ROSTO (fracao do quadro) em cada instante que o
 * motor olhou de cada plano, as mesmas deteccoes do largurasDosRostos: null =
 * nenhum rosto naquele instante (so a cabeca, de costas, ou ninguem). O grid
 * confere se a metade mostra um rosto legivel. Plano fora do mapa: nao se sabe.
 */
export async function alturasDosRostos(
  indice: Pick<EpisodeIndex, 'id' | 'anime' | 'temporada' | 'planos' | 'atualizadoEm'>,
  o: OpcoesDoRostoPeloMotor & { tetoMs?: number } = {},
): Promise<Map<string, (number | null)[]>> {
  const saida = new Map<string, (number | null)[]>()
  for (const [id, achado] of await deteccoesDosPlanos(indice, o)) {
    const alturas = alturasDoMaiorRosto(achado)
    if (alturas.length > 0) saida.set(id, alturas)
  }
  return saida
}

/** Em cada instante que abriu, a altura (fracao) do maior ROSTO (a cabeca nao conta); null = nenhum rosto. */
export function alturasDoMaiorRosto(achado: RostosDoPedaco): (number | null)[] {
  if (!(achado.altura > 0)) return []
  return achado.quadros
    .filter((q) => q.ok)
    .map((q) => {
      const rostos = q.rostos.filter((r) => r.tipo === 'rosto')
      return rostos.length > 0 ? Math.max(...rostos.map((r) => r.h)) / achado.altura : null
    })
}

/** O modo rostos do motor em cada plano (3 instantes, so detectando), pelo cache; o que falta vai ao motor. */
function deteccoesDosPlanos(
  indice: Pick<EpisodeIndex, 'id' | 'anime' | 'temporada' | 'planos' | 'atualizadoEm'>,
  o: OpcoesDoRostoPeloMotor & { tetoMs?: number },
): Promise<Map<string, RostosDoPedaco>> {
  const chave = `${indice.id}|${indice.planos.length}|${indice.atualizadoEm}`
  const pronta = deteccoesPorIndice.get(chave)
  if (pronta) return pronta
  const conta = (async () => {
    const itens: ItemDoMotor[] = indice.planos
      .filter((p) => p.arquivo && p.end > p.start)
      .map((p) => {
        const base = p.inicioNoArquivo ?? 0
        const d = p.end - p.start
        return { chave: p.id, arquivo: p.arquivo, instantes: [0.25, 0.5, 0.75].map((f) => base + f * d), personagens: [], candidatos: [] }
      })
    const arquivoCache = arquivoDoCache(o)
    const cache = lerCache(arquivoCache)
    const chaves = new Map(itens.map((it) => [it.chave, chaveDoCache(it, null, false)]))
    const resultados = new Map<string, RostosDoPedaco>()
    for (const it of itens) {
      const k = chaves.get(it.chave)
      const achado = k ? cache.get(k) : undefined
      if (achado) resultados.set(it.chave, achado)
    }
    const faltam = itens.filter((it) => !resultados.has(it.chave))
    if (faltam.length > 0) {
      const r = await rodarMotorDeRostos(faltam, { anime: null, temporada: null, identificar: false, aspecto: null }, o.tetoMs ?? 240_000, o)
      for (const [k, achado] of r.resultados) {
        resultados.set(k, achado)
        const ck = chaves.get(k)
        if (ck) {
          cache.delete(ck)
          cache.set(ck, achado)
        }
      }
      if (r.resultados.size > 0) gravarCache(arquivoCache, cache)
    }
    return resultados
  })().catch(() => new Map<string, RostosDoPedaco>())
  deteccoesPorIndice.set(chave, conta)
  return conta
}

/**
 * (4a rodada) A largura do maior rosto em CADA instante (25/50/75% do plano;
 * null = sem rosto naquele instante): o casar olha so os instantes que a cena
 * toca (o 0057 do Nia E01 tem o rosto grande depois das maos brilhando); as mesmas deteccoes.
 */
export async function largurasPorInstante(
  indice: Pick<EpisodeIndex, 'id' | 'anime' | 'temporada' | 'planos' | 'atualizadoEm'>,
  o: OpcoesDoRostoPeloMotor & { tetoMs?: number } = {},
): Promise<Map<string, (number | null)[]>> {
  const saida = new Map<string, (number | null)[]>()
  for (const [id, achado] of await deteccoesDosPlanos(indice, o)) {
    const ws = larguraPorInstante(achado)
    if (ws) saida.set(id, ws)
  }
  return saida
}

/** A largura (fracao) do maior rosto de cada instante. null = sem medida (largura do quadro desconhecida). */
export function larguraPorInstante(achado: RostosDoPedaco): (number | null)[] | null {
  if (!(achado.largura > 0)) return null
  return achado.quadros.map((q) => (q.ok && q.rostos.length > 0 ? Math.max(...q.rostos.map((r) => r.w)) / achado.largura : null))
}

/** A mediana, entre os instantes com rosto, da largura (fracao) do maior rosto. null = rosto em menos de 2. */
export function larguraDoMaiorRosto(achado: RostosDoPedaco): number | null {
  if (!(achado.largura > 0)) return null
  const ws = achado.quadros
    .filter((q) => q.ok && q.rostos.length > 0)
    .map((q) => [...q.rostos].sort((a, b) => b.w * b.h - a.w * a.h)[0]!.w / achado.largura)
    .sort((a, b) => a - b)
  return ws.length >= 2 ? ws[Math.floor((ws.length - 1) / 2)]! : null
}

// ================================================ a luz dos rostos (4a rodada)

/** A largura do quadro em cinza em que a luz dos rostos e medida. */
const LUZ_LARGURA = 160
/** Pedacos medidos ao mesmo tempo (cada um, ate 3 ffmpeg curtos). */
const LUZ_JUNTOS = 6

/**
 * A LUZ de um rosto: o cinza medio (0-255) e o desvio dentro da caixa (pixels
 * do quadro original), num quadro em cinza `largura` x `altura` do mesmo
 * instante. null = caixa fora do quadro.
 */
export function luzNaCaixa(
  cinza: Uint8Array,
  largura: number,
  altura: number,
  caixa: Pick<RostoDoMotor, 'x' | 'y' | 'w' | 'h'>,
  larguraOriginal: number,
  alturaOriginal: number,
): { media: number; desvio: number } | null {
  if (!(larguraOriginal > 0) || !(alturaOriginal > 0) || cinza.length < largura * altura) return null
  const sx = largura / larguraOriginal
  const sy = altura / alturaOriginal
  const x0 = Math.max(0, Math.floor(caixa.x * sx))
  const y0 = Math.max(0, Math.floor(caixa.y * sy))
  const x1 = Math.min(largura, Math.ceil((caixa.x + caixa.w) * sx))
  const y1 = Math.min(altura, Math.ceil((caixa.y + caixa.h) * sy))
  if (x1 <= x0 || y1 <= y0) return null
  let soma = 0
  let quad = 0
  for (let l = y0; l < y1; l++) {
    for (let c = x0; c < x1; c++) {
      const v = cinza[l * largura + c]!
      soma += v
      quad += v * v
    }
  }
  const n = (x1 - x0) * (y1 - y0)
  const media = soma / n
  return { media, desvio: Math.sqrt(Math.max(0, quad / n - media * media)) }
}

/** A luz media (0-255) do quadro inteiro em cinza. */
function luzDoQuadro(cinza: Uint8Array): number {
  let soma = 0
  for (const v of cinza) soma += v
  return cinza.length > 0 ? soma / cinza.length : 0
}

/**
 * (4a rodada) A luz de cada rosto dos pedacos com dois rostos ou mais num
 * instante (so ali a silhueta pode perder de um rosto aceso): um quadro em
 * cinza por instante, pelo ffmpeg. Devolve COPIAS (o cache do motor fica sem a
 * luz); o pedaco que falhou fica de fora (sem luz, a escolha de sempre).
 */
async function comLuzDosRostos(itens: readonly { chave: string; arquivo: string; achado: RostosDoPedaco }[]): Promise<Map<string, RostosDoPedaco>> {
  const saida = new Map<string, RostosDoPedaco>()
  const medir = itens.filter((it) => it.achado.largura > 0 && it.achado.altura > 0 && it.achado.quadros.some((q) => q.ok && q.rostos.length >= 2))
  for (let i = 0; i < medir.length; i += LUZ_JUNTOS) {
    await Promise.all(
      medir.slice(i, i + LUZ_JUNTOS).map(async ({ chave, arquivo, achado }) => {
        const W = LUZ_LARGURA
        const H = Math.max(2, Math.round((W * achado.altura) / achado.largura))
        try {
          const quadros = await Promise.all(
            achado.quadros.map(async (q): Promise<QuadroDoMotor> => {
              if (!q.ok || q.rostos.length === 0) return q
              const cinza = await rodarFfmpeg(['-ss', q.t.toFixed(3), '-i', arquivo, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'])
              const px = new Uint8Array(cinza.buffer, cinza.byteOffset, Math.min(cinza.byteLength, W * H))
              const doQuadro = luzDoQuadro(px)
              return {
                ...q,
                rostos: q.rostos.map((r) => {
                  const luz = luzNaCaixa(px, W, H, r, achado.largura, achado.altura)
                  return luz === null ? r : { ...r, luz: Math.round(luz.media), silhueta: ehSilhueta(luz, doQuadro) }
                }),
              }
            }),
          )
          saida.set(chave, { ...achado, quadros })
        } catch {
          // Sem a luz: a escolha de sempre.
        }
      }),
    )
  }
  return saida
}

/** O plano do indice de cada mp4 (o mesmo caminho, sem caixa nem barra). */
function planoPorArquivo(indice: Pick<EpisodeIndex, 'planos'>): (arquivo: string) => Plano | null {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
  const mapa = new Map<string, Plano>()
  for (const p of indice.planos) mapa.set(norm(p.arquivo), p)
  return (arquivo) => mapa.get(norm(arquivo)) ?? null
}

// ============================================ o recorte visto de perto (3a rodada)

/** O keyframe do plano mais perto do meio do trecho que o pedido toca (segundos do mp4). */
function keyframeDoTrecho(plano: Pick<Plano, 'keyframe' | 'start' | 'end' | 'inicioNoArquivo'>, de: number, ate: number): string | null {
  const kf = plano.keyframe
  if (!kf) return null
  if (!/_1\.jpe?g$/i.test(kf)) return kf
  const dur = plano.end - plano.start
  const meio = (de + ate) / 2 - (plano.inicioNoArquivo ?? 0)
  let k = 1
  let menor = Infinity
  for (const kk of [0, 1, 2]) {
    const d = Math.abs(posDoKeyframe(kk) * dur - meio)
    if (d < menor) {
      menor = d
      k = kk
    }
  }
  return kf.replace(/_1(\.jpe?g)$/i, `_${k}$1`)
}

/** O recorte que a tela mostra de um keyframe, no focusX, reduzido para a comparacao. null = nao leu. */
async function descritorNoFoco(kf: string, focusX: number, formato: Formato): Promise<DescritorDoRecorte | null> {
  try {
    const meta = await sharp(kf).metadata()
    const W = meta.width ?? 0
    const H = meta.height ?? 0
    if (W <= 0 || H <= 0) return null
    const j = janelaVisivel(focusX, W, H, formato)
    const w = Math.max(1, Math.min(W, Math.round(j.largura * W)))
    const x = Math.max(0, Math.min(W - w, Math.round(j.centro * W - w / 2)))
    const { data } = await sharp(kf)
      .extract({ left: x, top: 0, width: w, height: H })
      .resize(RECORTE_LARGURA, RECORTE_ALTURA, { fit: 'fill' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true })
    return descritorDoRecorte(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  } catch {
    return null
  }
}

/** Dois pedidos do mesmo mp4, o segundo continuando o primeiro: e a mesma cena seguindo (sem corte). */
function colados(a: Pick<PedidoDeRosto, 'arquivo' | 'de' | 'ate'>, b: Pick<PedidoDeRosto, 'arquivo' | 'de' | 'ate'>): boolean {
  return a.arquivo.toLowerCase() === b.arquivo.toLowerCase() && Math.abs(b.de - a.ate) < 0.6
}

/**
 * (19/10, 3a rodada) SEM RECORTES IGUAIS: a cena seguida quase igual DEPOIS do
 * recorte 9:16 (o Lent com o papel em 0126 -> 0129, o Lent de perfil em 0285 ->
 * 0286 no MRM E02) parece um jump cut. Para cada pedido, na ordem da montagem,
 * o recorte e comparado com o da cena de antes e com as vezes anteriores do
 * MESMO plano (a repeticao nunca mostra o mesmo quadro). Acima de RECORTE_IGUAL:
 *   1. outro recorte na cena de agora: outro rosto do pedaco (outrosRecortes,
 *      quem o pedaco cita primeiro), o primeiro que fica diferente das vizinhas;
 *   2. senao, outro recorte na cena de antes (se ela ainda nao foi trocada);
 *   3. senao, fica, com aviso.
 * Cada pedido troca no maximo uma vez. Muda `focos` no lugar; devolve os avisos.
 */
async function semRecortesIguais(e: {
  pedidos: readonly PedidoDeRosto[]
  focos: Map<string, FocoDoRosto>
  resultados: ReadonlyMap<string, RostosDoPedaco>
  planoDe: (arquivo: string) => Plano | null
  formato: Formato
}): Promise<string[]> {
  const ordem: PedidoDeRosto[] = []
  for (const p of e.pedidos) if (ordem[ordem.length - 1]?.chave !== p.chave) ordem.push(p)
  const lidos = new Map<string, Promise<DescritorDoRecorte | null>>()
  const descritor = (p: PedidoDeRosto, focusX: number): Promise<DescritorDoRecorte | null> => {
    const k = `${p.chave}|${focusX.toFixed(4)}`
    let d = lidos.get(k)
    if (!d) {
      const plano = e.planoDe(p.arquivo)
      const kf = plano ? keyframeDoTrecho(plano, p.de, Math.max(p.ate, p.de)) : null
      d = kf ? descritorNoFoco(kf, focusX, e.formato) : Promise.resolve(null)
      lidos.set(k, d)
    }
    return d
  }
  const atual = (p: PedidoDeRosto): Promise<DescritorDoRecorte | null> => descritor(p, e.focos.get(p.chave)?.focusX ?? 0.5)
  /** A maior semelhanca do recorte `d` (do pedido p) com os vizinhos. */
  const piorContra = async (d: DescritorDoRecorte, vizinhos: readonly PedidoDeRosto[]): Promise<number> => {
    let pior = 0
    for (const v of vizinhos) {
      const dv = await atual(v)
      if (dv) pior = Math.max(pior, semelhancaDosRecortes(d, dv))
    }
    return pior
  }
  const trocados = new Set<string>()
  /** Tenta outro recorte em `p` que fique diferente de todos os `vizinhos`. */
  const tentar = async (p: PedidoDeRosto, vizinhos: readonly PedidoDeRosto[]): Promise<boolean> => {
    if (trocados.has(p.chave)) return false
    const achado = e.resultados.get(p.chave)
    const foco = e.focos.get(p.chave)
    if (!achado || !foco || achado.largura <= 0 || achado.altura <= 0) return false
    const janela = janelaDoFormato(achado.largura, achado.altura, e.formato)
    const centroAtual = janelaVisivel(foco.focusX, achado.largura, achado.altura, e.formato).centro
    for (const alt of outrosRecortes(achado, citadosNaOrdem(p.personagens), janela, centroAtual)) {
      const f = focoNoQuadro(alt.centro, achado.largura, achado.altura, e.formato)
      const d = await descritor(p, f.focusX)
      if (!d || (await piorContra(d, vizinhos)) >= RECORTE_IGUAL) continue
      e.focos.set(p.chave, { ...foco, focusX: f.focusX, focusY: f.focusY, focusAuto: true, fonte: 'motor', personagem: alt.quem })
      trocados.add(p.chave)
      return true
    }
    return false
  }
  const avisos: string[] = []
  let trocas = 0
  let ficaram = 0
  for (let i = 1; i < ordem.length; i++) {
    const b = ordem[i]!
    const anteriores = ordem.slice(0, i - 1).filter((x) => x.arquivo.toLowerCase() === b.arquivo.toLowerCase() && x.chave !== b.chave)
    const vizinhos = [ordem[i - 1]!, ...anteriores].filter((a) => a.chave !== b.chave && !colados(a, b))
    if (vizinhos.length === 0) continue
    const db = await atual(b)
    if (!db || (await piorContra(db, vizinhos)) < RECORTE_IGUAL) continue
    // 1. Outro recorte na cena de agora, diferente das de antes e da seguinte.
    const seguinte = ordem[i + 1] && !colados(b, ordem[i + 1]!) ? [ordem[i + 1]!] : []
    if (await tentar(b, [...vizinhos, ...seguinte])) {
      trocas += 1
      continue
    }
    // 2. Outro recorte na cena de antes (a vizinha imediata), diferente da dela de antes e desta.
    const a = ordem[i - 1]!
    const antesDeA = i >= 2 && !colados(ordem[i - 2]!, a) ? [ordem[i - 2]!] : []
    if (vizinhos.includes(a) && (await tentar(a, [...antesDeA, b]))) {
      trocas += 1
      continue
    }
    ficaram += 1
  }
  const nomeDe = (chave: string): string => chave.replace(/@[^@]*$/, '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  if (trocas > 0) avisos.push(`Recorte trocado em ${trocas} cena(s) (${[...trocados].map(nomeDe).join(', ')}): ficava quase igual a cena vizinha.`)
  if (ficaram > 0) avisos.push(`${ficaram} cena(s) seguem quase iguais a vizinha depois do recorte (sem outro rosto para enquadrar).`)
  return avisos
}

/**
 * Os citados na ordem que vieram (a montagem ja ordena: o citado no texto, o
 * sujeito herdado, quem fala, os do evento), uma vez cada pessoa. Desde 19/10
 * a ordem nao e mais a de quem o indice ve no plano: no MRM E02 "O Guy e as
 * garotas" enquadrava a Misa porque o indice tinha a Misa com mais confianca.
 */
function citadosNaOrdem(citados: readonly string[]): string[] {
  const unicos: string[] = []
  for (const c of citados) if (c.trim() && !unicos.some((u) => mesmaPessoa(u, c))) unicos.push(c)
  return unicos
}

/** Quantas pessoas, no maximo, no conjunto fechado de um pedaco. */
const CANDIDATOS_MAX = 12

/**
 * O conjunto FECHADO em que o motor identifica os rostos do pedaco (19/10): os
 * citados, quem o indice ve no plano e o elenco principal do episodio, uma vez
 * cada pessoa. Antes era so quem o indice via no plano, e so quando um citado
 * estava la: com uma pessoa so no conjunto, todo rosto de anime parece com ela
 * (~0,8 no CLIP) e nada se decidia. Nunca o elenco inteiro do anime (no S4-37
 * o CLIP trocou o Gen pelo Gozan). Sem nenhum citado: vazio (o maior rosto).
 */
export function candidatosDoPedaco(citados: readonly string[], noPlano: readonly string[], elenco: readonly string[] = []): string[] {
  if (!citados.some((c) => c.trim())) return []
  const unicos: string[] = []
  for (const n of [...citados, ...noPlano, ...elenco]) if (n.trim() && !unicos.some((u) => mesmaPessoa(u, n))) unicos.push(n)
  return unicos.slice(0, CANDIDATOS_MAX)
}

// ================================================================== o cache

/** Sobe quando a resposta do motor muda de forma (o cache velho e ignorado). */
const VERSAO_DO_CACHE = 1
/** Quantas respostas o cache guarda (as mais antigas saem). */
const CACHE_MAX = 4000

interface CacheDosRostos {
  versao: number
  itens: Record<string, RostosDoPedaco>
}

/**
 * A chave de um item no cache: o arquivo (caminho, tamanho e data), os
 * instantes, quem cita, o conjunto fechado e o recorte. Arquivo que nao abre:
 * sem chave (o motor responde).
 */
function chaveDoCache(item: ItemDoMotor, aspecto: number | null, identificar: boolean): string | null {
  try {
    const st = statSync(item.arquivo)
    const base = {
      v: VERSAO_DO_CACHE,
      a: item.arquivo.replace(/\\/g, '/').toLowerCase(),
      t: st.size,
      m: Math.round(st.mtimeMs),
      i: item.instantes.map((x) => Math.round(x * 1000)),
      p: item.personagens,
      c: [...item.candidatos].sort(),
      j: aspecto === null ? null : Math.round(aspecto * 1000),
      id: identificar,
    }
    return createHash('sha1').update(JSON.stringify(base)).digest('hex')
  } catch {
    return null
  }
}

function lerCache(arquivo: string | null): Map<string, RostosDoPedaco> {
  if (!arquivo) return new Map()
  try {
    const c = JSON.parse(readFileSync(arquivo, 'utf8')) as CacheDosRostos
    return c.versao === VERSAO_DO_CACHE && c.itens && typeof c.itens === 'object' ? new Map(Object.entries(c.itens)) : new Map()
  } catch {
    return new Map()
  }
}

function gravarCache(arquivo: string | null, cache: Map<string, RostosDoPedaco>): void {
  if (!arquivo) return
  try {
    const itens = [...cache.entries()].slice(-CACHE_MAX)
    mkdirSync(dirname(arquivo), { recursive: true })
    const tmp = `${arquivo}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ versao: VERSAO_DO_CACHE, itens: Object.fromEntries(itens) } satisfies CacheDosRostos), 'utf8')
    renameSync(tmp, arquivo)
  } catch {
    // cache e conveniencia
  }
}

function arquivoDoCache(o: OpcoesDoRostoPeloMotor): string | null {
  if (o.cache !== undefined) return o.cache
  try {
    return join(pastaDoPerfil(), 'rostos-cache.json')
  } catch {
    return null
  }
}

export async function rostosDosPedacos(lote: LoteDeRostos, o: OpcoesDoRostoPeloMotor = {}): Promise<RostosDoLote> {
  const inicio = Date.now()
  const limite = inicio + lote.tetoMs
  const avisos: string[] = []
  const formato = lote.formato
  const focos = new Map<string, FocoDoRosto>()

  // O indice: quem esta em cada plano e o anime (para o motor achar o elenco).
  let indice: Pick<EpisodeIndex, 'anime' | 'temporada' | 'planos'> | null = o.indice ?? null
  if (o.indice === undefined && lote.episodioId) {
    try {
      indice = abrirIndicePorId(lote.episodioId).indice
    } catch {
      indice = null
    }
  }
  const noPlanoDe = personagensPorArquivo(indice)
  // O elenco principal (quem mais aparece no indice) e o do roteiro: o conjunto fechado de cada pedaco.
  const elenco = [...(indice ? elencoPrincipal(indice) : []), ...(lote.elenco ?? [])]
  // (rodada 4) O quadro de cada pedido: o do formato, ou a METADE do grid (a janela 9:8).
  const quadroDe = (p: Pick<PedidoDeRosto, 'metade'>): QuadroDoRecorte => (p.metade ? 'metade' : formato)
  // A largura visivel do recorte sobre a altura do quadro (as janelas do motor, janelaDoFormato).
  const aspectoDe = (q: QuadroDoRecorte): number => {
    const m = medidasDoQuadro(q)
    return m.width / m.renderHeight
  }
  const aspecto = aspectoDe(formato)

  // Um item por chave (o mesmo pedaco pode vir duas vezes).
  const unicos = new Map<string, PedidoDeRosto>()
  for (const p of lote.pedidos) if (!unicos.has(p.chave)) unicos.set(p.chave, p)
  const pedidos = [...unicos.values()]

  // 1. O motor (o que o cache ja sabe nao roda de novo).
  const resultados = new Map<string, RostosDoPedaco>()
  const noOlho: string[] = []
  if (lote.motor && pedidos.length > 0) {
    const identificar = o.identificar !== false
    const itens: ItemDoMotor[] = pedidos.map((p) => ({
      chave: p.chave,
      arquivo: p.arquivo,
      instantes: instantesDoTrecho(p.de, Math.max(p.ate, p.de)),
      personagens: citadosNaOrdem(p.personagens),
      candidatos: candidatosDoPedaco(p.personagens, noPlanoDe(p.arquivo), elenco),
      ...(p.metade ? { aspecto: aspectoDe('metade') } : {}),
    }))
    const pedidoDe = new Map(pedidos.map((p) => [p.chave, p]))
    const arquivoCache = arquivoDoCache(o)
    const cache = lerCache(arquivoCache)
    const chaves = new Map(itens.map((it) => [it.chave, chaveDoCache(it, it.aspecto ?? aspecto, identificar)]))
    for (const it of itens) {
      const k = chaves.get(it.chave)
      const pronto = k ? cache.get(k) : undefined
      if (pronto) resultados.set(it.chave, pronto)
    }
    const faltamNoCache = itens.filter((it) => !resultados.has(it.chave))
    if (faltamNoCache.length > 0) {
      const r = await rodarMotorDeRostos(
        faltamNoCache,
        { anime: indice?.anime ?? null, temporada: indice?.temporada ?? null, identificar, aspecto },
        Math.max(1000, Math.round(lote.tetoMs * PARTE_DO_MOTOR)),
        o,
      )
      if (r.falha) {
        avisos.push(
          r.resultados.size + resultados.size > 0
            ? `Motor parou no meio (${r.falha}): o resto foi pelo detector antigo.`
            : `Motor indisponivel (${r.falha}): usei o detector antigo.`,
        )
      }
      for (const [chave, achado] of r.resultados) {
        resultados.set(chave, achado)
        const k = chaves.get(chave)
        // So guarda resposta de um motor que identificou (o elenco carregado).
        if (k && (r.elenco !== null || !identificar)) {
          cache.delete(k)
          cache.set(k, achado)
        }
      }
      if (r.resultados.size > 0) gravarCache(arquivoCache, cache)
    }
    // (4a rodada) A luz de cada rosto, nos pedacos com dois ou mais (a silhueta perde do aceso).
    const acesos = await comLuzDosRostos(itens.flatMap((it) => {
      const achado = resultados.get(it.chave)
      return achado ? [{ chave: it.chave, arquivo: it.arquivo, achado }] : []
    }))
    for (const item of itens) {
      const achado = acesos.get(item.chave) ?? resultados.get(item.chave)
      if (!achado) continue
      const quadro = quadroDe(pedidoDe.get(item.chave) ?? {})
      const escolha = escolherNoPedaco(
        achado,
        item.personagens,
        noPlanoDe(item.arquivo),
        janelaDoFormato(achado.largura || 1920, achado.altura || 1080, quadro),
      )
      const foco = escolha.centro ? focoNoQuadro(escolha.centro, achado.largura, achado.altura, quadro) : null
      if (escolha.olho) noOlho.push(item.arquivo.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''))
      focos.set(item.chave, {
        chave: item.chave,
        focusX: foco?.focusX ?? 0.5,
        focusY: foco?.focusY ?? 0.5,
        focusAuto: foco !== null,
        fonte: foco ? 'motor' : null,
        personagem: escolha.personagem,
        instantesComRosto: escolha.instantesComRosto,
        instantes: escolha.instantes,
      })
    }
  }

  // 2. A reserva: o detector antigo nos pedacos que o motor nao respondeu.
  const faltam = pedidos.filter((p) => !focos.has(p.chave))
  if (faltam.length > 0) {
    const resta = limite - Date.now()
    let achados = new Map<string, { focusX: number; focusY: number; focusAuto: boolean }>()
    if (resta > 500) {
      try {
        achados = await focosDosPedacos(
          faltam.map((p) => ({ arquivo: p.arquivo, de: p.de, ate: Math.max(p.ate, p.de), ...(p.metade ? { metade: true } : {}) })),
          resta,
          formato,
        )
      } catch {
        avisos.push('Nao deu para procurar os rostos: os blocos ficam no centro.')
      }
    } else {
      avisos.push('Sem tempo para procurar os rostos que faltaram: ficam no centro.')
    }
    for (const p of faltam) {
      const f = achados.get(p.metade ? chaveDaMetade({ arquivo: p.arquivo, de: p.de }) : chaveDoPedaco({ arquivo: p.arquivo, de: p.de }))
      focos.set(p.chave, {
        chave: p.chave,
        focusX: f?.focusX ?? 0.5,
        focusY: f?.focusY ?? 0.5,
        focusAuto: f?.focusAuto ?? false,
        fonte: f ? 'lbp' : null,
        personagem: null,
        // O detector antigo olha os mesmos 3 instantes e nao diz em quantos achou.
        instantesComRosto: f ? 1 : 0,
        instantes: instantesDoTrecho(p.de, p.ate).length,
      })
    }
  }

  if (noOlho.length > 0) avisos.push(`Close extremo: recorte num olho em ${noOlho.length} cena(s) (${[...new Set(noOlho)].join(', ')})`)

  // 3. (3a rodada) Cenas seguidas quase iguais DEPOIS do recorte: outro recorte numa delas.
  if (resultados.size > 0 && indice) {
    try {
      // (rodada 4) So a tela cheia: as metades do grid ficam juntas na tela, nao seguidas.
      const cheios = lote.pedidos.filter((p) => !p.metade)
      avisos.push(...(await semRecortesIguais({ pedidos: cheios, focos, resultados, planoDe: planoPorArquivo(indice), formato })))
    } catch {
      // Ajuste fino: sem ele, o recorte de cada pedaco fica o que o motor escolheu.
    }
  }

  // Um por pedido, na ordem dos pedidos (repetidos ganham o foco do primeiro).
  const lista: FocoDoRosto[] = lote.pedidos.map((p) => ({ ...focos.get(p.chave)!, chave: p.chave }))
  const comRosto = lista.filter((f) => f.focusAuto).length
  const fontes = new Set(lista.filter((f) => f.focusAuto).map((f) => f.fonte).filter((f): f is FonteDoRosto => f !== null))
  return {
    focos: lista,
    fonte: fontes.size === 0 ? 'nenhum' : fontes.size > 1 ? 'misto' : [...fontes][0]!,
    comRosto,
    total: lista.length,
    avisos,
    ms: Date.now() - inicio,
  }
}
