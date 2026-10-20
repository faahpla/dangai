import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import type { EpisodeIndex } from '../../shared/episodio'
import { aplicarEscolhas, cenasDoRascunho, frasesDoRoteiro, type CenasGravadas, type EscolhaDaFrase, type EstadoDasCenas } from '../../shared/cenas'
import { encaixarEscolha, entradasDosPlanos } from '../../shared/encaixe'
import {
  desligarGrid,
  gridsAutomaticos,
  ligarGrid,
  familiaDoCabelo,
  referenciaDosRostos,
  type EntradaDoGrid,
  type ModoDoGrid,
  type QuemNoGrid,
  type RostoDoPlano,
} from '../../shared/grid'
import { roteiroAtual, type Evento, type RascunhoDoRecap, type Roteiro } from '../../shared/roteiro'
import { palavrasDaFrase, takeAtual, type TakeDaVoz } from '../../shared/voz'
import { linhasDaMatriz, produtoInterno } from '../../shared/visao'
import { configDoRecap } from '../contexto'
import { gravarRascunho, indiceDoRascunho, lerRascunhoDoDisco } from '../gerar/rascunho'
import { pastaDoPerfil } from '../episodio/perfil'
import { largurasDosRostos, rostosDosPlanos } from '../montar/rostos-motor'
import { citadosNoTexto, elencoDoEpisodio, fichasDe, mesmoNome, prepararPlanos, type PlanoDoCasar } from './casar'
import { comMesclas } from './mesclas'
import { quadrosDosPlanos } from './quadros'
import { rodarModoCenas, sinaisDoEpisodio } from './visao'

/**
 * [recap] O GRID no servico (rodada 4): os SINAIS que a decisao pura
 * (shared/grid.ts) nao tem como medir sozinha, e onde o passo roda.
 *
 * - os VETOS de metade: o close extremo (o maior rosto do plano, do mesmo
 *   cache do motor que o casar usa: largurasDosRostos) e o quadro que o
 *   ANIME JA DIVIDE (uma linha reta e escura cruzando o keyframe de ponta a
 *   ponta, o 0193 do Nia E01);
 * - a MESMA CENA: os vetores CLIP dos keyframes (o visao.json do episodio);
 *   as duas metades parecidas demais (MESMA_CENA) sao um plano so;
 * - QUEM a frase cita e quem cada plano mostra (o rosto separado da fala): a
 *   ordem cima/baixo e o veto da pessoa em comum nas duas metades;
 * - o ROSTO de cada plano (o detector do motor, o mesmo cache do close
 *   extremo) e o "de costas" do etiquetador: a metade sem sujeito legivel.
 *
 * O passo roda no fim do encaixarNaVoz (montar/index.ts) e no "Grid"/"Tela
 * cheia" do passo 4 (gridDaFrase). Os sinais saem ANTES de ler o rascunho:
 * ler -> aplicar -> gravar sem await no meio, como o resto.
 */

/** Na metade (1080x960) o close extremo comeca antes do que no 9:16: o rosto passa disto da largura do 16:9. */
export const CLOSE_EXTREMO_NA_METADE = 0.55
/** Dois keyframes com o CLIP acima disto sao a mesma cena (o MESMA_CENA_CLIP do casar). */
const MESMA_CENA = 0.88

// ------------------------------------------------- o quadro que ja e dividido

/** O tamanho em que o keyframe e lido para achar a linha da divisao. */
const LARGURA = 192
const ALTURA = 108
/** A linha e quase preta (0..255)... */
const LINHA_ESCURA = 55
/** ...e os DOIS lados sao mais claros que ela por pelo menos isto... */
const CONTRASTE_DA_LINHA = 45
/** ...em pelo menos esta fracao do caminho, de uma borda a outra da imagem. */
const LINHA_INTEIRA = 0.93
/** A linha nao encosta na borda da imagem (a tarja e o contorno da moldura nao sao divisao). */
const LONGE_DA_BORDA = 0.15
/** Coluna ou linha com a media abaixo disto e tarja preta (o anime em 4:3 dentro do 16:9). */
const TARJA = 24

/**
 * Uma linha reta e quase preta, mais escura que OS DOIS lados, de uma borda a
 * outra da imagem: o anime dividindo a tela (o 0193 do Nia E01, a diagonal
 * preta entre a criada e o irmao). Vertical ou diagonal ate ~45 graus, ou
 * horizontal. As tarjas pretas dos lados (o anime em 4:3) ficam de fora: a
 * busca e so dentro da imagem, longe da borda dela. O contorno de uma porta
 * ou de um pilar tem um lado escuro (a porta) e nao conta.
 * `luma`: LARGURA x ALTURA, um byte por pixel.
 */
export function temLinhaDeDivisao(luma: Uint8Array, w = LARGURA, h = ALTURA): boolean {
  const at = (x: number, y: number): number => luma[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!
  const mediaDaColuna = (x: number): number => {
    let s = 0
    for (let y = 0; y < h; y++) s += at(x, y)
    return s / h
  }
  const mediaDaLinha = (y: number): number => {
    let s = 0
    for (let x = 0; x < w; x++) s += at(x, y)
    return s / w
  }
  // A imagem de verdade, sem as tarjas.
  let ex = 0
  let dx = w - 1
  let cy = 0
  let by = h - 1
  while (ex < w && mediaDaColuna(ex) < TARJA) ex++
  while (dx > ex && mediaDaColuna(dx) < TARJA) dx--
  while (cy < h && mediaDaLinha(cy) < TARJA) cy++
  while (by > cy && mediaDaLinha(by) < TARJA) by--
  const lw = dx - ex + 1
  const lh = by - cy + 1
  if (lw < w * 0.4 || lh < h * 0.4) return false
  // O quadro escuro inteiro (noite, preto) nao tem "linha": nada contrasta.
  let soma = 0
  for (let y = cy; y <= by; y++) for (let x = ex; x <= dx; x++) soma += at(x, y)
  if (soma / (lw * lh) < 45) return false
  const margemX = Math.round(LONGE_DA_BORDA * lw)
  const margemY = Math.round(LONGE_DA_BORDA * lh)
  const lado = 4
  const boa = (meio: number, a: number, b: number): boolean => meio <= LINHA_ESCURA && Math.min(a, b) - meio >= CONTRASTE_DA_LINHA
  // Vertical/diagonal: de (x0, cy) a (x1, by).
  for (let x0 = ex + margemX; x0 <= dx - margemX; x0 += 2) {
    for (let x1 = Math.max(ex + margemX, x0 - lh); x1 <= Math.min(dx - margemX, x0 + lh); x1 += 2) {
      let boas = 0
      for (let y = cy; y <= by; y++) {
        const x = Math.round(x0 + ((x1 - x0) * (y - cy)) / Math.max(1, lh - 1))
        if (boa(Math.min(at(x - 1, y), at(x, y), at(x + 1, y)), at(x - lado, y), at(x + lado, y))) boas++
        else if (y - cy + 1 - boas > lh * (1 - LINHA_INTEIRA)) break
      }
      if (boas >= lh * LINHA_INTEIRA) return true
    }
  }
  // Horizontal: de (ex, y0) a (dx, y1), pouco inclinada.
  for (let y0 = cy + margemY; y0 <= by - margemY; y0 += 2) {
    for (let y1 = Math.max(cy + margemY, y0 - 12); y1 <= Math.min(by - margemY, y0 + 12); y1 += 2) {
      let boas = 0
      for (let x = ex; x <= dx; x++) {
        const y = Math.round(y0 + ((y1 - y0) * (x - ex)) / Math.max(1, lw - 1))
        if (boa(Math.min(at(x, y - 1), at(x, y), at(x, y + 1)), at(x, y - lado), at(x, y + lado))) boas++
        else if (x - ex + 1 - boas > lw * (1 - LINHA_INTEIRA)) break
      }
      if (boas >= lw * LINHA_INTEIRA) return true
    }
  }
  return false
}

async function lumaDoKeyframe(arquivo: string): Promise<Uint8Array | null> {
  try {
    const { data, info } = await sharp(arquivo).resize(LARGURA, ALTURA, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true })
    if (info.channels !== 1 || data.length < LARGURA * ALTURA) return null
    return new Uint8Array(data.buffer, data.byteOffset, LARGURA * ALTURA)
  } catch {
    return null
  }
}

/** Os planos ja olhados, por indice: planoId -> o anime divide o quadro (2 dos 3 keyframes com a linha). */
const divididosPorIndice = new Map<string, Map<string, boolean>>()

/** Quais dos `ids` o anime ja mostra divididos. Le so os que faltam (o resto vem da memoria). */
export async function planosJaDivididos(indice: Pick<EpisodeIndex, 'id' | 'planos' | 'atualizadoEm'>, ids: Iterable<string>): Promise<Set<string>> {
  const chave = `${indice.id}|${indice.planos.length}|${indice.atualizadoEm}`
  let vistos = divididosPorIndice.get(chave)
  if (!vistos) {
    vistos = new Map()
    divididosPorIndice.set(chave, vistos)
  }
  const porId = new Map(indice.planos.map((p) => [p.id, p]))
  const faltam = [...new Set(ids)].filter((id) => !vistos!.has(id) && porId.get(id)?.keyframe)
  for (let i = 0; i < faltam.length; i += 8) {
    await Promise.all(
      faltam.slice(i, i + 8).map(async (id) => {
        const kf = porId.get(id)!.keyframe!
        const arquivos = /_1\.jpe?g$/i.test(kf) ? [0, 1, 2].map((k) => kf.replace(/_1(\.jpe?g)$/i, `_${k}$1`)) : [kf]
        let com = 0
        let lidos = 0
        for (const a of arquivos) {
          const l = await lumaDoKeyframe(a)
          if (!l) continue
          lidos++
          if (temLinhaDeDivisao(l)) com++
        }
        vistos!.set(id, lidos > 0 && com >= Math.min(2, lidos))
      }),
    )
  }
  return new Set([...new Set(ids)].filter((id) => vistos!.get(id) === true))
}

// ------------------------------------------------- quem e quem sem reconhecimento

/** A folga do recorte em volta da caixa do rosto: o cabelo e o que mais distingue o personagem de anime. */
const FOLGA_DO_RECORTE = 0.35
/** O teto do motor para os vetores dos recortes (o CLIP sobe em ~15 s; os recortes sao poucos). */
const TETO_DOS_VETORES_MS = 4 * 60_000
const VERSAO_DOS_VETORES = 1

interface CacheDosVetores {
  versao: number
  /** chave do recorte -> o vetor (Float32, base64). */
  itens: Record<string, string>
}

function arquivoDosVetores(): string {
  return join(pastaDoPerfil(), 'grid-rostos.json')
}

function lerVetores(): Map<string, string> {
  try {
    const c = JSON.parse(readFileSync(arquivoDosVetores(), 'utf8')) as CacheDosVetores
    return c.versao === VERSAO_DOS_VETORES && c.itens && typeof c.itens === 'object' ? new Map(Object.entries(c.itens)) : new Map()
  } catch {
    return new Map()
  }
}

function gravarVetores(itens: Map<string, string>): void {
  try {
    const arquivo = arquivoDosVetores()
    mkdirSync(dirname(arquivo), { recursive: true })
    const tmp = `${arquivo}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ versao: VERSAO_DOS_VETORES, itens: Object.fromEntries([...itens].slice(-8000)) } satisfies CacheDosVetores), 'utf8')
    renameSync(tmp, arquivo)
  } catch {
    // cache e conveniencia
  }
}

const paraBase64 = (v: Float32Array): string => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64')
function deBase64(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64')
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

/** O keyframe do instante i do plano (os keyframes _0, _1 e _2 sao os instantes 25, 50 e 75%). */
function keyframeDoInstante(keyframe: string | null | undefined, i: number): string | null {
  if (!keyframe) return null
  if (/_1\.jpe?g$/i.test(keyframe)) return keyframe.replace(/_1(\.jpe?g)$/i, `_${i}$1`)
  return i === 1 ? keyframe : null
}

/**
 * (rodada 5) QUEM E QUEM SEM RECONHECIMENTO: o vetor CLIP (o mesmo modelo do
 * motor que identifica o elenco) do recorte de cada rosto do instante de
 * referencia de cada plano (referenciaDosRostos), com o cabelo junto. O Nia E01
 * nao tem reconhecimento (0 de 432 planos): sem isto a Nia passava nas duas
 * metades. Os recortes ficam num cache do perfil; o que falta vai ao motor
 * (modo cenas) de uma vez. Plano que nao deu: fora do mapa (o puro recusa).
 */
export async function vetoresDosRostos(
  indice: Pick<EpisodeIndex, 'planos'>,
  rostos: ReadonlyMap<string, readonly (readonly RostoDoPlano[] | null)[]>,
  ids: Iterable<string>,
): Promise<Map<string, Float32Array[]>> {
  const porId = new Map(indice.planos.map((p) => [p.id, p]))
  const cache = lerVetores()
  const pedidos: { planoId: string; chaves: string[] }[] = []
  const recortes: { chave: string; arquivo: string; caixa: RostoDoPlano }[] = []
  for (const id of new Set(ids)) {
    const instantes = rostos.get(id)
    const ref = instantes ? referenciaDosRostos(instantes) : null
    if (!ref || ref.rostos.length === 0) continue
    const arquivo = keyframeDoInstante(porId.get(id)?.keyframe, ref.instante)
    if (!arquivo) continue
    let base: string
    try {
      const st = statSync(arquivo)
      base = `${arquivo.replace(/\\/g, '/').toLowerCase()}|${st.size}|${Math.round(st.mtimeMs)}`
    } catch {
      continue
    }
    const chaves = ref.rostos.map((r) => createHash('sha1').update(`${base}|${[r.cx, r.cy, r.w, r.h].map((x) => x.toFixed(4)).join(',')}`).digest('hex'))
    pedidos.push({ planoId: id, chaves })
    for (const [i, chave] of chaves.entries()) if (!cache.has(chave)) recortes.push({ chave, arquivo, caixa: ref.rostos[i]! })
  }
  if (recortes.length > 0) {
    const pasta = join(pastaDoPerfil(), 'grid-rostos-tmp', `${process.pid}-${Date.now()}`)
    try {
      mkdirSync(join(pasta, 'saida'), { recursive: true })
      const imagens: { id: string; arquivo: string; prioridade: number }[] = []
      for (const [i, r] of recortes.entries()) {
        try {
          const img = sharp(r.arquivo)
          const { width = 0, height = 0 } = await img.metadata()
          if (!width || !height) continue
          // Quadrado em volta do rosto, um pouco para cima (o cabelo), dentro da imagem.
          const lado = Math.min(width, height, Math.round(Math.max(r.caixa.w * width, r.caixa.h * height) * (1 + 2 * FOLGA_DO_RECORTE)))
          const cx = r.caixa.cx * width
          const cy = (r.caixa.cy - 0.1 * r.caixa.h) * height
          const left = Math.min(Math.max(Math.round(cx - lado / 2), 0), width - lado)
          const top = Math.min(Math.max(Math.round(cy - lado / 2), 0), height - lado)
          const arq = join(pasta, `${i}.jpg`)
          await sharp(r.arquivo).extract({ left, top, width: lado, height: lado }).jpeg({ quality: 92 }).toFile(arq)
          imagens.push({ id: r.chave, arquivo: arq, prioridade: 0 })
        } catch {
          // keyframe que nao abre: esse rosto fica sem vetor
        }
      }
      if (imagens.length > 0) {
        const r = await rodarModoCenas({ imagens }, join(pasta, 'saida'), () => {}, TETO_DOS_VETORES_MS)
        if (!r.falha) {
          const meta = JSON.parse(readFileSync(join(pasta, 'saida', 'imagens.json'), 'utf8')) as { ids?: unknown[]; dim?: number }
          const linhas = linhasDaMatriz(readFileSync(join(pasta, 'saida', 'imagens.f32')), typeof meta.dim === 'number' ? meta.dim : 768)
          const idsLidos = (meta.ids ?? []).map(String)
          if (linhas.length === idsLidos.length) {
            for (const [i, chave] of idsLidos.entries()) cache.set(chave, paraBase64(linhas[i]!))
            gravarVetores(cache)
          }
        }
      }
    } catch {
      // sem o motor: os rostos ficam sem vetor (o puro recusa o par sem reconhecimento)
    } finally {
      try {
        rmSync(pasta, { recursive: true, force: true })
        rmdirSync(dirname(pasta))
      } catch {
        // a pasta temporaria (ou a de cima, com outra rodada dentro) sai na proxima
      }
    }
  }
  const saida = new Map<string, Float32Array[]>()
  for (const p of pedidos) {
    const vs = p.chaves.map((c) => cache.get(c))
    if (vs.every((v): v is string => typeof v === 'string')) saida.set(p.planoId, vs.map(deBase64))
  }
  return saida
}

// ---------------------------------------------------------------- os sinais

export interface SinaisDoGrid {
  vetados: Map<string, string>
  mesmaCena: (a: string, b: string) => boolean
  quem: QuemNoGrid
  /** Os rostos de cada plano em cada instante (o detector do motor, o cache do casar). */
  rostos?: Map<string, (RostoDoPlano[] | null)[]>
  /** (rodada 5) O vetor CLIP do recorte de cada rosto de referencia (quem e quem sem reconhecimento). */
  vetoresDosRostos?: Map<string, Float32Array[]>
  /** (polimento) Os planos "de costas" (from behind) pelo etiquetador. */
  deCostas?: Set<string>
  /** (rodada 5) As cores de cabelo (familias) que o etiquetador ve em cada plano. */
  cabelos?: Map<string, Set<string>>
  /** (rodada 5) A entrada depois do clarao ou borrao de cada plano que abre ruim (o quadros.json, so lido). */
  entradas?: Map<string, number>
}

/** A etiqueta de cor de cabelo vale com pelo menos esta confianca. */
const CABELO_MIN = 0.4

/** A etiqueta "de costas" vale com pelo menos esta confianca. */
const DE_COSTAS = 0.5

/** Os planos que podem virar metade: os das cenas e os das fitas de cada frase. */
function planosCandidatos(escolhas: readonly EscolhaDaFrase[]): Set<string> {
  const ids = new Set<string>()
  for (const e of escolhas) {
    for (const c of [...e.fita, ...(e.inteira ?? []), ...e.cenas.map((x) => x.candidato), ...e.cenas.flatMap((x) => (x.baixo ? [x.baixo] : []))]) {
      for (const id of c.planoIds) ids.add(id)
    }
  }
  return ids
}

/**
 * Os sinais do grid para o episodio: vetos, mesma cena e quem. Cada parte e
 * melhor esforco (sem motor, sem visao.json, keyframe que nao abre: aquela
 * parte fica de fora).
 */
export async function sinaisDoGrid(
  aberto: { indice: EpisodeIndex; caminho: string },
  roteiro: Pick<Roteiro, 'secoes'>,
  eventos: readonly Pick<Evento, 'personagens'>[],
  escolhas: readonly EscolhaDaFrase[],
): Promise<SinaisDoGrid> {
  const { indice } = aberto
  const candidatos = planosCandidatos(escolhas)
  const vetados = new Map<string, string>()
  try {
    for (const [id, w] of await largurasDosRostos(indice)) if (candidatos.has(id) && w > CLOSE_EXTREMO_NA_METADE) vetados.set(id, 'close extremo')
  } catch {
    // sem o motor: sem esse veto
  }
  try {
    for (const id of await planosJaDivididos(indice, candidatos)) vetados.set(id, 'o anime ja divide o quadro')
  } catch {
    // keyframes que nao abrem: sem esse veto
  }
  let entradas: Map<string, number> | undefined
  try {
    const q = await quadrosDosPlanos(indice, aberto.caminho, true)
    entradas = entradasDosPlanos(indice.planos, q.abremRuim)
  } catch {
    // sem a medida dos quadros: a metade pode comecar no comeco do plano
  }
  let rostos: Map<string, (RostoDoPlano[] | null)[]> | undefined
  let vetoresDeRosto: Map<string, Float32Array[]> | undefined
  try {
    const todos = await rostosDosPlanos(indice)
    if (todos.size > 0) rostos = new Map([...todos].filter(([id]) => candidatos.has(id)))
  } catch {
    // sem o motor: o automatico recusa (nao sabe se a metade tem rosto)
  }
  if (rostos) {
    try {
      vetoresDeRosto = await vetoresDosRostos(indice, rostos, candidatos)
    } catch {
      // sem o CLIP: o par sem reconhecimento e recusado
    }
  }
  let vetores = new Map<string, Float32Array[]>()
  let deCostas: Set<string> | undefined
  let cabelos: Map<string, Set<string>> | undefined
  try {
    const visao = sinaisDoEpisodio(indice, aberto.caminho)
    if (visao.quadros) vetores = new Map([...visao.quadros].map(([id, qs]) => [id, qs.flatMap((q) => (q.vetor ? [q.vetor] : []))]))
    if (visao.tagsDoPlano) {
      deCostas = new Set<string>()
      for (const [id, tags] of visao.tagsDoPlano) {
        if (!candidatos.has(id) || !tags.includes('from behind')) continue
        const conf = visao.confiancaDasTags?.get(id)?.get('from behind')
        if (conf === undefined || conf >= DE_COSTAS) deCostas.add(id)
      }
      cabelos = new Map<string, Set<string>>()
      for (const [id, tags] of visao.tagsDoPlano) {
        if (!candidatos.has(id)) continue
        const cores = new Set<string>()
        for (const t of tags) {
          const familia = familiaDoCabelo(t)
          const conf = visao.confiancaDasTags?.get(id)?.get(t)
          if (familia && (conf === undefined || conf >= CABELO_MIN)) cores.add(familia)
        }
        cabelos.set(id, cores)
      }
    }
  } catch {
    // sem a visao: a mesma cena fica so pelo plano, e sem o "de costas"
  }
  const mesmaCena = (a: string, b: string): boolean => {
    if (a === b) return true
    const va = vetores.get(a) ?? []
    const vb = vetores.get(b) ?? []
    for (const x of va) for (const y of vb) if (produtoInterno(x, y) >= MESMA_CENA) return true
    return false
  }
  return {
    vetados,
    mesmaCena,
    quem: quemNoGrid(indice, roteiro, eventos),
    ...(rostos ? { rostos } : {}),
    ...(vetoresDeRosto ? { vetoresDosRostos: vetoresDeRosto } : {}),
    ...(deCostas ? { deCostas } : {}),
    ...(cabelos ? { cabelos } : {}),
    ...(entradas ? { entradas } : {}),
  }
}

/** Quem cada frase cita (a palavra de cada um) e quem cada plano mostra, pelas fichas do casar. */
export function quemNoGrid(
  indice: Pick<EpisodeIndex, 'planos' | 'cues' | 'exclusoes'>,
  roteiro: Pick<Roteiro, 'secoes'>,
  eventos: readonly Pick<Evento, 'personagens'>[],
): QuemNoGrid {
  const todos = prepararPlanos(indice)
  const elenco = elencoDoEpisodio(todos, indice, eventos)
  const citados = new Map<string, { palavra: number; quem: string }[]>()
  const fichasCitadas = new Set<string>()
  for (const f of frasesDoRoteiro(roteiro)) {
    const tokens = palavrasDaFrase(f.texto).map((t) => fichasDe(t).map((x) => elenco.apelidos?.get(x) ?? x))
    const lista: { palavra: number; quem: string }[] = []
    for (const c of citadosNoTexto(f.texto, elenco)) {
      const palavra = tokens.findIndex((fs) => fs.includes(c.ficha) || fs.some((x) => mesmoNome([x], [c.ficha])))
      if (palavra < 0) continue
      lista.push({ palavra, quem: c.ficha })
      fichasCitadas.add(c.ficha)
    }
    if (lista.length > 0) citados.set(f.id, lista)
  }
  const porId = new Map<string, PlanoDoCasar>(todos.map((p) => [p.plano.id, p]))
  const cache = new Map<string, { todos: Set<string>; rostos: Set<string> }>()
  const doPlano = (planoId: string): { todos: Set<string>; rostos: Set<string> } => {
    const pronto = cache.get(planoId)
    if (pronto) return pronto
    const p = porId.get(planoId)
    const saida = { todos: new Set<string>(), rostos: new Set<string>() }
    if (p) {
      for (const f of fichasCitadas) {
        const peloRosto = p.rostos.some((n) => mesmoNome(n.fichas, [f]))
        if (peloRosto) saida.rostos.add(f)
        if (peloRosto || p.falas.some((n) => mesmoNome(n.fichas, [f]))) saida.todos.add(f)
      }
    }
    cache.set(planoId, saida)
    return saida
  }
  // (rodada 4) O rosto separado da fala: quem so fala no plano pode estar fora do quadro ou de costas.
  return { citados, noPlano: (id) => doPlano(id).todos, peloRosto: (id) => doPlano(id).rostos }
}

// ----------------------------------------------------------------- o passo

/** A entrada do passo puro, com as escolhas ja encaixadas. */
function entradaDoGrid(
  roteiro: Pick<Roteiro, 'secoes'>,
  take: Pick<TakeDaVoz, 'trechos' | 'palavras' | 'duracao'> | null,
  indice: Pick<EpisodeIndex, 'planos'>,
  escolhas: readonly EscolhaDaFrase[],
  modo: ModoDoGrid,
  sinais: SinaisDoGrid | null,
  minimoSec: number,
): EntradaDoGrid {
  return {
    roteiro,
    take,
    indice,
    escolhas,
    modo,
    minimoSec,
    ...(sinais ? { vetados: sinais.vetados, mesmaCena: sinais.mesmaCena, quem: sinais.quem } : {}),
    ...(sinais?.rostos ? { rostos: sinais.rostos } : {}),
    ...(sinais?.vetoresDosRostos ? { vetoresDosRostos: sinais.vetoresDosRostos } : {}),
    ...(sinais?.cabelos ? { cabelos: sinais.cabelos } : {}),
    ...(sinais?.entradas ? { entradas: sinais.entradas } : {}),
    ...(sinais?.deCostas ? { deCostas: sinais.deCostas } : {}),
  }
}

/** O modo e o minimo da config (sem config: o padrao). */
function daConfig(): { modo: ModoDoGrid; minimoSec: number } {
  try {
    const c = configDoRecap().cenas
    return { modo: c.grid, minimoSec: c.minimoNaTela }
  } catch {
    return { modo: 'automatico', minimoSec: 1 }
  }
}

/**
 * O PASSO DO GRID sobre as escolhas encaixadas (puro por cima dos sinais): os
 * grids automaticos sao decididos de novo e as frases que mudaram sao
 * encaixadas outra vez. Devolve as escolhas e os recados.
 */
export function aplicarGrids(
  e: {
    roteiro: Pick<Roteiro, 'secoes'>
    take: ReturnType<typeof takeAtual>
    indice: EpisodeIndex
    escolhas: readonly EscolhaDaFrase[]
    sinais: SinaisDoGrid | null
    modo?: ModoDoGrid
    minimoSec?: number
  },
): { escolhas: EscolhaDaFrase[]; postos: string[]; avisos: string[] } {
  const cfg = daConfig()
  const modo = e.modo ?? cfg.modo
  const minimoSec = e.minimoSec ?? cfg.minimoSec
  const saida = gridsAutomaticos(entradaDoGrid(e.roteiro, e.take, e.indice, e.escolhas, modo, e.sinais, minimoSec))
  const mudadas = new Set(saida.mudadas)
  const porId = new Map(frasesDoRoteiro(e.roteiro).map((f) => [f.id, f]))
  const escolhas = saida.escolhas.map((x) => {
    const frase = porId.get(x.fraseId)
    if (!mudadas.has(x.fraseId) || !frase) return x
    return encaixarEscolha(x, { indice: e.indice, frase, take: e.take, minimoSec, ...(e.sinais?.entradas ? { entradas: e.sinais.entradas } : {}) }).escolha
  })
  return { escolhas, postos: saida.postos, avisos: saida.avisos }
}

/** A marca do ultimo passo do grid no estado das cenas. */
export function marcaDoGrid(modo?: ModoDoGrid): NonNullable<EstadoDasCenas['grid']> {
  return { modo: modo ?? daConfig().modo, em: new Date().toISOString() }
}

/**
 * "Grid" / "Tela cheia" no passo 4, frase a frase. Grava o rascunho e devolve
 * inteiro (como o salvarCenas). Lanca com o recado quando o grid nao cabe.
 */
export async function gridDaFrase(rascunhoId: string, fraseId: string, ligar: boolean): Promise<CenasGravadas> {
  const antes = lerRascunhoDoDisco(rascunhoId)
  const roteiroAntes = roteiroAtual(antes)
  if (!roteiroAntes) throw new Error('Nao ha roteiro.')
  const abertoAntes = indiceDoRascunho(antes)
  const indiceAntes = comMesclas(abertoAntes.indice)
  // Os sinais antes de ler de novo: ler -> aplicar -> gravar sem await no meio.
  const sinais = ligar
    ? await sinaisDoGrid({ indice: indiceAntes, caminho: abertoAntes.caminho }, roteiroAntes, antes.eventos, cenasDoRascunho(antes).escolhas).catch(
        () => null,
      )
    : null

  const r = lerRascunhoDoDisco(rascunhoId)
  const roteiro = roteiroAtual(r)
  if (!roteiro) throw new Error('Nao ha roteiro.')
  const frase = frasesDoRoteiro(roteiro).find((f) => f.id === fraseId)
  if (!frase) throw new Error('Essa frase nao esta mais no roteiro.')
  const indice = comMesclas(indiceDoRascunho(r).indice)
  const take = takeAtual(r)
  const atual = cenasDoRascunho(r)
  const escolha = atual.escolhas.find((x) => x.fraseId === fraseId)
  if (!escolha || escolha.cenas.length === 0) throw new Error('Escolha uma cena nesta frase antes.')
  const { modo, minimoSec } = daConfig()
  let nova: EscolhaDaFrase
  if (ligar) {
    const feito = ligarGrid(entradaDoGrid(roteiro, take, indice, atual.escolhas, modo, sinais, minimoSec), fraseId)
    if ('erro' in feito) throw new Error(feito.erro)
    nova = feito.escolha
  } else {
    nova = desligarGrid(escolha)
  }
  const { escolha: encaixada } = encaixarEscolha(nova, { indice, frase, take, minimoSec, ...(sinais?.entradas ? { entradas: sinais.entradas } : {}) })
  const quando = new Date().toISOString()
  const novo: RascunhoDoRecap = { ...r, cenas: aplicarEscolhas(atual, [encaixada], roteiro), atualizadoEm: quando }
  gravarRascunho(novo)
  return { rascunho: novo, avisos: [] }
}
