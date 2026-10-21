import sharp from 'sharp'
import { temPlanos, type EpisodeIndex } from '../../shared/episodio'
import { canonizar, nomeNatural } from '@shared/nomes'
import { roteiroAtual, type Frase, type RascunhoDoRecap, type Roteiro } from '../../shared/roteiro'
import { consultaVisual } from '../../shared/ponte-visual'
import { podeIrParaCenas, takeAtual } from '../../shared/voz'
import {
  aplicarEscolhas,
  candidatoDosPlanos,
  cenasDoRascunho,
  escolhaDaFrase,
  escolhasDesatualizadas,
  escolhasForaDoIndice,
  frasesDoRoteiro,
  type CandidatoDeCena,
  type CandidatosDaFrase,
  type CenasGravadas,
  type EscolhaDaFrase,
  type FiltrosDeCandidatos,
} from '../../shared/cenas'
import { gravarRascunho, indiceDoRascunho, lerRascunhoDoDisco } from '../gerar/rascunho'
import { completarDicas } from '../gerar/dicas'
import { configDoRecap } from '../contexto'
import { legibilidadeDoQuadro, LEITURA_ALTURA, LEITURA_LARGURA, type CamadasDoCasar, type SinaisDoCasar } from '../../shared/visao'
import type { ConfigDasCenas } from '../../shared/config'
import { corteDaFrase, idDoPedaco, minimoNaTela, type OpcoesDaDivisao } from '../../shared/divisao'
import { comMesclas } from './mesclas'
import { casarFrases, fichasDe, fichasFortes, janelasDasFrases, mesmoNome, prepararPlanos, type PlanoDoCasar } from './casar'
import { camadasDaConfig, garantirVisao, sinaisDasFrases, sinaisDoEpisodio } from './visao'
import { largurasDosRostos, largurasPorInstante } from '../montar/rostos-motor'
import { quadrosDosPlanos } from './quadros'
import type { SinaisDaImagem } from './casar'

/**
 * O CASAR do passo 4 (agente A): a fita de cada frase, de graca, e a grade da
 * tela de Cenas. A logica pura mora em ./casar.ts (casar v0 do PLANO: janela
 * pela ancora, exclusoes duras, nota explicavel, sem plano repetido, fita de
 * 6 com o porque); aqui so le o rascunho e o indice, chama e grava.
 *
 * Mesma regra do rascunho.ts: ler -> aplicar -> gravar, sem await no meio, e
 * devolver o rascunho inteiro.
 */

function agora(): string {
  return new Date().toISOString()
}

// ------------------------------------------- a luz e a leitura dos keyframes

/** Luz media (0-255) do primeiro quadro abaixo da qual o plano "abre escuro" (o 0307 do S4 - 37 abre em ~20). */
const LUZ_ESCURA = 32
/** ...e o meio do plano tem que clarear pelo menos isto: cena de noite inteira nao conta. */
const CLAREIA = 15
/** Leituras de JPG ao mesmo tempo (o sharp usa o pool do libuv). */
const LEITURAS_JUNTAS = 8

/** O que o servico le de um keyframe: a luz media (0-255) e a legibilidade (0..1, legibilidadeDoQuadro). */
interface QuadroLido {
  luz: number
  leitura: number
}

const lidosPorIndice = new Map<string, Promise<Map<string, (QuadroLido | null)[]>>>()

/** A luz media e a legibilidade de um JPG, reduzido na decodificacao. null = nao deu para ler. */
async function lerQuadro(arquivo: string): Promise<QuadroLido | null> {
  try {
    const [cinza, cor] = await Promise.all([
      sharp(arquivo).resize(32, 18, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true }),
      sharp(arquivo)
        .resize(LEITURA_LARGURA, LEITURA_ALTURA, { fit: 'fill' })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ])
    if (cinza.data.length === 0 || cor.info.channels !== 3) return null
    let soma = 0
    for (const v of cinza.data) soma += v
    return { luz: soma / cinza.data.length, leitura: legibilidadeDoQuadro(cor.data, cor.info.width, cor.info.height) }
  } catch {
    return null
  }
}

/**
 * A luz e a legibilidade dos 3 keyframes de cada plano (_0, _1, _2: 25/50/75%
 * do plano), uma vez por indice. Falhou = mapa vazio (ajuste fino, nunca
 * impede a sugestao).
 */
function quadrosLidos(indice: Pick<EpisodeIndex, 'id' | 'planos' | 'atualizadoEm'>): Promise<Map<string, (QuadroLido | null)[]>> {
  const chave = `${indice.id}|${indice.planos.length}|${indice.atualizadoEm}`
  const pronta = lidosPorIndice.get(chave)
  if (pronta) return pronta
  const conta = (async () => {
    const saida = new Map<string, (QuadroLido | null)[]>()
    const comKeyframe = indice.planos.filter((p) => p.keyframe && /_1\.jpe?g$/i.test(p.keyframe))
    for (let i = 0; i < comKeyframe.length; i += LEITURAS_JUNTAS) {
      await Promise.all(
        comKeyframe.slice(i, i + LEITURAS_JUNTAS).map(async (p) => {
          const meio = p.keyframe!
          saida.set(p.id, await Promise.all([0, 1, 2].map((k) => lerQuadro(meio.replace(/_1(\.jpe?g)$/i, `_${k}$1`)))))
        }),
      )
    }
    return saida
  })().catch(() => new Map<string, (QuadroLido | null)[]>())
  lidosPorIndice.set(chave, conta)
  return conta
}

/** A luz media (0-255) dos 3 keyframes de cada plano: o plano que abre escuro. */
export async function luzDosPlanos(indice: Pick<EpisodeIndex, 'id' | 'planos' | 'atualizadoEm'>): Promise<Map<string, (number | null)[]>> {
  return new Map([...(await quadrosLidos(indice))].map(([id, qs]) => [id, qs.map((q) => q?.luz ?? null)]))
}

/**
 * (19/10, 2a rodada) A LEGIBILIDADE (0..1) dos 3 keyframes de cada plano: o
 * gancho e o comeco de cada parte desempatam pelo quadro legivel. A luz media
 * enganava no MRM E02: o grupo de olhos vermelhos (0006) tem luz 36 e e
 * legivel; o queixo na chuva (0007), luz 46, nao.
 */
export async function leituraDosPlanos(indice: Pick<EpisodeIndex, 'id' | 'planos' | 'atualizadoEm'>): Promise<Map<string, (number | null)[]>> {
  return new Map([...(await quadrosLidos(indice))].map(([id, qs]) => [id, qs.map((q) => q?.leitura ?? null)]))
}

/**
 * Os planos que abrem escuros (fade do preto, a Terra nascendo no escuro): o
 * casar comeca a janela um pouco depois, se o plano sobra. O keyframe do
 * comeco (_0) escuro e o do meio (_1) clareando.
 */
export async function planosQueAbremEscuro(indice: Pick<EpisodeIndex, 'id' | 'planos' | 'atualizadoEm'>): Promise<Set<string>> {
  const saida = new Set<string>()
  for (const [id, [luz0, luz1]] of await luzDosPlanos(indice)) {
    if (luz0 === null || luz0 === undefined || luz0 >= LUZ_ESCURA) continue
    if (luz1 !== null && luz1 !== undefined && luz1 >= luz0 + CLAREIA) saida.add(id)
  }
  return saida
}

/**
 * (4a rodada) As consultas de imagem da ponte visual (consultaVisual): a frase
 * sem a `visualEn` da IA pede pelo texto e pela intencao; cada pedaco, pelo
 * proprio texto. O casar usa so onde falta a da IA.
 */
export function consultasDaPonte(
  frases: readonly Pick<Frase, 'id' | 'texto' | 'intencaoVisual' | 'visualEn'>[],
  pedacos: readonly { id: string; texto: string }[],
): { id: string; texto: string }[] {
  const saida: { id: string; texto: string }[] = []
  for (const f of frases) {
    const q = consultaVisual(f.visualEn?.trim() ? f.texto : `${f.texto} ${f.intencaoVisual}`)
    if (q) saida.push({ id: f.id, texto: q })
  }
  for (const p of pedacos) {
    const q = consultaVisual(p.texto)
    if (q) saida.push({ id: p.id, texto: q })
  }
  return saida
}

/**
 * (4a rodada) O que o casar ve de perto de cada plano: o rosto por instante (o
 * cache do motor), o comeco ruim, o movimento e o quadro dividido (quadros.json
 * ao lado da visao). `soCache` (a grade) so le. Falhou: sem essas medidas.
 */
async function sinaisDaImagem(rascunhoId: string, indice: EpisodeIndex, soCache: boolean): Promise<SinaisDaImagem> {
  try {
    const caminho = indiceDoRascunho(lerRascunhoDoDisco(rascunhoId)).caminho
    const [larguras, quadros] = await Promise.all([largurasPorInstante(indice), quadrosDosPlanos(indice, caminho, soCache)])
    return { ...quadros, larguras }
  } catch {
    return {}
  }
}

/** As frases que abrem uma parte do roteiro (a 1a de cada secao; a 1a de todas e o gancho). */
export function frasesQueAbrem(roteiro: Pick<Roteiro, 'secoes'>): Set<string> {
  return new Set(roteiro.secoes.flatMap((s) => (s.frases[0] ? [s.frases[0].id] : [])))
}

// ------------------------------------------------- o que se ve (lote 2)

interface SinaisParaOCasar {
  sinais: SinaisDoCasar
  camadas: Partial<CamadasDoCasar>
  /** Recados ASCII para o log ("sem motor: so as regras"). */
  avisos: string[]
}

/** "Ate 2 cenas por frase", o limiar e o minimo na tela, da config "Cenas". */
export function divisaoDaConfig(c: Pick<ConfigDasCenas, 'duasCenas' | 'limiarDuasCenas'> & Partial<Pick<ConfigDasCenas, 'minimoNaTela'>>): OpcoesDaDivisao {
  return { ligada: c.duasCenas, limiarSec: c.limiarDuasCenas, ...(c.minimoNaTela !== undefined ? { minimoSec: c.minimoNaTela } : {}) }
}

/**
 * Os sinais do lote 2 para o casar, pela config "Cenas": as dicas que faltam
 * no roteiro (um pedido de IA so, gratis), o que se ve do episodio (medido
 * agora se faltar) e os vetores das frases. `soCache` (a grade da tela) nunca
 * chama o motor nem a IA. Falhou qualquer parte: o casar segue sem ela.
 */
async function sinaisParaOCasar(rascunhoId: string, soCache = false): Promise<SinaisParaOCasar> {
  const cfg = configDoRecap().cenas
  const camadas = camadasDaConfig(cfg)
  const avisos: string[] = []
  if (!cfg.visao && !cfg.etiquetas) return { sinais: {}, camadas, avisos }
  const t0 = Date.now()
  try {
    if (!soCache) {
      const d = await completarDicas(rascunhoId)
      if (d.nota) avisos.push(`dicas: ${d.nota}`)
    }
    const r = lerRascunhoDoDisco(rascunhoId)
    const roteiro = roteiroAtual(r)
    if (!roteiro) return { sinais: {}, camadas, avisos }
    const aberto = indiceDoRascunho(r)
    if (!soCache) {
      const est = await garantirVisao(aberto.indice, aberto.caminho, { motor: cfg.visao, etiquetas: cfg.etiquetas })
      if (est.motivo) avisos.push(`visao: ${est.motivo}`)
    }
    const doEpisodio = sinaisDoEpisodio(aberto.indice, aberto.caminho)
    const frases = frasesDoRoteiro(roteiro)
    // Ate 2 cenas: o sentido de cada pedaco possivel (o casar pontua cada um com o que ELE diz).
    const divisao = divisaoDaConfig(cfg)
    const take = takeAtual(r)
    const pedacos = divisao.ligada
      ? frases.flatMap((f, i) => (corteDaFrase(f, take, divisao, i === 0)?.pedacos ?? []).map((p, k) => ({ id: idDoPedaco(f.id, k), texto: p.texto })))
      : []
    const dasFrases = cfg.visao ? await sinaisDasFrases([...frases, ...pedacos], { imagem: true, sentido: true, soCache }, consultasDaPonte(frases, pedacos)) : null
    if (dasFrases?.falha) avisos.push(`frases: ${dasFrases.falha}`)
    const tagsDaFrase = new Map(frases.flatMap((f) => (f.tags && f.tags.length > 0 ? [[f.id, f.tags] as const] : [])))
    const sinais: SinaisDoCasar = { ...doEpisodio, ...(dasFrases?.sinais ?? {}), ...(tagsDaFrase.size > 0 ? { tagsDaFrase } : {}) }
    if (!soCache) console.log(`[cenas] sinais em ${Date.now() - t0} ms: ${Object.keys(sinais).join(', ') || 'nenhum'}${avisos.length ? ` (${avisos.join(' | ')})` : ''}`)
    return { sinais, camadas, avisos }
  } catch (e) {
    avisos.push(e instanceof Error ? e.message : String(e))
    return { sinais: {}, camadas, avisos }
  }
}

/** O roteiro aprovado e o indice com planos, ou o erro pronto para a tela. */
function abrirParaCenas(r: RascunhoDoRecap): { indice: EpisodeIndex; roteiro: NonNullable<ReturnType<typeof roteiroAtual>> } {
  const roteiro = roteiroAtual(r)
  if (!roteiro || !r.aprovado) throw new Error('Aprove o roteiro antes das cenas.')
  // [recap] Plano mesclado pelo Dangai depois do indice: o mesclado no lugar (so le).
  const indice = comMesclas(indiceDoRascunho(r).indice)
  if (!temPlanos(indice)) throw new Error('As cenas do episodio ainda estao sendo cortadas.')
  return { indice, roteiro }
}

/**
 * A fita (ate 6) e a cena colocada de cada frase sem escolha ou com o texto
 * mudado (as travadas ficam, e os planos delas nao se repetem). Escolhas de
 * frases que sairam do roteiro saem. Nada a fazer = nada gravado.
 */
export async function sugerirCenas(rascunhoId: string, variar = false): Promise<CenasGravadas> {
  // Os sinais (dicas, motor) e a leitura dos keyframes antes: entre ler e gravar o rascunho nao ha await.
  const { sinais, camadas } = await sinaisParaOCasar(rascunhoId)
  const indiceAntes = abrirParaCenas(lerRascunhoDoDisco(rascunhoId)).indice
  const abremEscuro = await planosQueAbremEscuro(indiceAntes)
  const leitura = await leituraDosPlanos(indiceAntes)
  // (3a rodada) O maior rosto de cada plano: o close extremo (a 1a vez do episodio, ~1 min no motor).
  const rostos = await largurasDosRostos(indiceAntes)
  // (4a rodada) Os vetos do recorte e a acao: o rosto por instante, o comeco ruim, o movimento e o
  // quadro que o anime ja divide (a 1a vez do episodio, ~30 s de ffmpeg; depois, o cache).
  const imagem = await sinaisDaImagem(rascunhoId, indiceAntes, false)
  const r = lerRascunhoDoDisco(rascunhoId)
  const { indice, roteiro } = abrirParaCenas(r)
  const take = takeAtual(r)
  const atual = cenasDoRascunho(r)
  const velhas = escolhasDesatualizadas(roteiro, take, atual)
  const refazer = new Set([
    ...velhas.semEscolha,
    ...velhas.textoMudou.filter((id) => !escolhaDaFrase(atual, id)?.travada),
    // Corte refeito: a cena escolhida nao existe mais no indice (mesmo travada).
    ...escolhasForaDoIndice(atual, indice.planos),
    // Sugeridas pela estimativa antes da voz: com ela aprovada, no tempo real das falas.
    ...(podeIrParaCenas(r, roteiro) ? velhas.antesDaVoz : []),
  ])
  if (refazer.size === 0 && velhas.orfas.length === 0) return { rascunho: r, avisos: [] }

  const frases = frasesDoRoteiro(roteiro)
  const divisao = divisaoDaConfig(configDoRecap().cenas)
  const casar = (de: typeof atual, quais: ReadonlySet<string>, evitar?: ReadonlySet<string>) =>
    casarFrases({
      indice,
      eventos: r.eventos,
      frases,
      take,
      fixas: new Map(de.escolhas.filter((e) => !quais.has(e.fraseId)).map((e) => [e.fraseId, e])),
      refazer: quais,
      abremEscuro,
      sinais,
      camadas,
      divisao,
      leitura,
      rostos,
      imagem,
      abrem: frasesQueAbrem(roteiro),
      evitar,
    })
  const primeira = casar(atual, refazer)
  let escolhidas = aplicarEscolhas(atual, primeira.casadas.map((c) => c.escolha), roteiro)
  const avisos = [...primeira.avisos]
  // (21/10) "Sugerir de novo" sem nada mudado dava as MESMAS cenas ("nao muda nada", Levi). Pedido
  // pelo botao, a frase que voltou igual sai de novo sem os planos de antes. O que mudou (personagens
  // reconhecidos, texto novo) ja trocou na primeira passada e fica.
  if (variar) {
    const planosDe = (e: ReturnType<typeof escolhaDaFrase>): string[] =>
      (e?.cenas ?? []).flatMap((c) => [...c.candidato.planoIds, ...(c.baixo?.planoIds ?? [])])
    const chave = (ids: string[]): string => [...ids].sort().join('|')
    const iguais = new Set<string>()
    const evitar = new Set<string>()
    for (const id of refazer) {
      const antes = planosDe(escolhaDaFrase(atual, id))
      if (antes.length > 0 && chave(antes) === chave(planosDe(escolhaDaFrase(escolhidas, id)))) {
        iguais.add(id)
        for (const p of antes) evitar.add(p)
      }
    }
    if (iguais.size > 0) {
      const segunda = casar(escolhidas, iguais, evitar)
      escolhidas = aplicarEscolhas(escolhidas, segunda.casadas.map((c) => c.escolha), roteiro)
      avisos.push(...segunda.avisos.filter((a) => !avisos.includes(a)))
    }
  }
  const quando = agora()
  const cenas = {
    ...escolhidas,
    sugeridasEm: quando,
    roteiroVersao: roteiro.versao,
  }
  const novo: RascunhoDoRecap = { ...r, cenas, atualizadoEm: quando }
  gravarRascunho(novo)
  return { rascunho: novo, avisos }
}

// ------------------------------------------------------------------- grade

/** Quantos planos de cada lado o "Perto deste momento" mostra. */
const VIZINHAS_DE_CADA_LADO = 4

/** Falante sem rosto com menos cenas que isto nao vira chip ("Joel 1", "Carlos 2" enchiam duas linhas). */
const CENAS_DO_FALANTE_MIN = 3

/**
 * Os personagens do filtro: os rostos (com as grafias unidas, como na
 * Biblioteca) e os falantes da legenda que nao tem rosto ("Stanley",
 * "Why-Man") e aparecem em CENAS_DO_FALANTE_MIN cenas ou mais, cada um com
 * quantas cenas tem ele por rosto OU por fala.
 */
export function personagensDoEpisodio(indice: Pick<EpisodeIndex, 'planos'>, todos: readonly PlanoDoCasar[]): { nome: string; cenas: number }[] {
  const crus = new Map<string, number>()
  for (const p of indice.planos) for (const x of p.personagens) crus.set(x.nome, (crus.get(x.nome) ?? 0) + 1)
  const unido = canonizar(crus)
  interface Grupo {
    nome: string
    fichas: string[]
    planos: Set<string>
    grafias: Map<string, number>
  }
  const grupos: Grupo[] = []
  const grupoDe = (nome: string, fichas: string[], criar: boolean): Grupo | null => {
    const achado = grupos.find((g) => g.nome === nome || mesmoNome(g.fichas, fichas))
    if (achado || !criar) return achado ?? null
    const novo: Grupo = { nome, fichas, planos: new Set(), grafias: new Map() }
    grupos.push(novo)
    return novo
  }
  for (const p of todos) {
    for (const r of p.rostos) {
      const nome = unido.get(r.nome) ?? r.nome
      grupoDe(nome, fichasFortes(nome), true)?.planos.add(p.plano.id)
    }
  }
  const comRosto = grupos.length
  for (const p of todos) {
    for (const f of p.falas) {
      if (f.fichas.length === 0) continue
      const g = grupoDe(f.nome, f.fichas, true)!
      g.planos.add(p.plano.id)
      if (grupos.indexOf(g) >= comRosto) g.grafias.set(f.nome, (g.grafias.get(f.nome) ?? 0) + 1)
    }
  }
  return grupos
    .filter((g, i) => i < comRosto || g.planos.size >= CENAS_DO_FALANTE_MIN)
    .map((g) => {
      // Falante sem rosto: a grafia mais usada, sem a letra de figurante ("Why-Man A" -> "Why-Man").
      const grafia = [...g.grafias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      const nome = grafia ? grafia.replace(/\s+[A-Z]$/, '') : g.nome
      return { nome, cenas: g.planos.size }
    })
    .sort((a, b) => b.cenas - a.cenas || a.nome.localeCompare(b.nome, 'pt-BR'))
}

function textoBuscavel(p: PlanoDoCasar, falaDaCue: ReadonlyMap<string, string>): string {
  const falas = p.plano.cueIds.map((id) => falaDaCue.get(id) ?? '').join(' ')
  const nomes = [...p.rostos.map((r) => `${r.nome} ${nomeNatural(r.nome)}`), ...p.falas.map((f) => f.nome)].join(' ')
  return fichasDe(`${falas} ${nomes} ${p.plano.id}`).join(' ')
}

function passaNoFiltro(p: PlanoDoCasar, filtros: FiltrosDeCandidatos, falaDaCue: ReadonlyMap<string, string>): boolean {
  const personagem = filtros.personagem?.trim()
  if (personagem) {
    const fichas = fichasFortes(personagem)
    const nomes = [...p.rostos, ...p.falas]
    const ok =
      fichas.length > 0
        ? nomes.some((n) => mesmoNome(n.fichas, fichas))
        : nomes.some((n) => fichasDe(n.nome).join(' ') === fichasDe(personagem).join(' '))
    if (!ok) return false
  }
  const busca = filtros.busca?.trim()
  if (busca) {
    const texto = textoBuscavel(p, falaDaCue)
    if (!fichasDe(busca).every((w) => texto.includes(w))) return false
  }
  return true
}

/** "no momento", "3s antes", "12s depois": onde o plano fica em relacao ao momento. */
function ondeFica(p: PlanoDoCasar, t: number | null): string[] {
  if (t === null) return []
  if (t >= p.plano.start && t < p.plano.end) return ['no momento']
  const s = Math.round(t < p.plano.start ? p.plano.start - t : t - p.plano.end)
  return [`${Math.max(1, s)}s ${t < p.plano.start ? 'depois' : 'antes'}`]
}

function candidatoDoPlano(p: PlanoDoCasar, episodioId: string, origem: 'vizinha' | 'busca', porque: string[], entrada = p.util!.de): CandidatoDeCena {
  return candidatoDosPlanos([p.plano], episodioId, origem, { inSec: entrada, outSec: p.util!.ate, porque })
}

/**
 * (4a rodada) A ENTRADA de um plano da grade: depois do preto, do clarao ou do
 * borrao do comeco (o casar faz o mesmo nas sugestoes), se sobra o minimo na
 * tela; senao, o comeco de sempre.
 */
export function entradaDepoisDoEfeito(p: Pick<PlanoDoCasar, 'plano' | 'util'>, abremRuim: ReadonlyMap<string, number> | undefined, minimo: number): number {
  const de = p.util!.de
  const ruim = abremRuim?.get(p.plano.id) ?? 0
  const pulo = p.plano.start + ruim
  return ruim > 0 && de < pulo && p.util!.ate - pulo >= minimo ? pulo : de
}

/**
 * A grade da tela para uma frase. So le. As sugestoes sao a fita gravada (ou,
 * antes da primeira sugerirCenas, a fita calculada na hora sem gravar); as
 * vizinhas e as outras respeitam os filtros e nunca mostram OP/ED.
 */
export async function candidatosDaFrase(
  rascunhoId: string,
  fraseId: string,
  filtros: FiltrosDeCandidatos,
): Promise<CandidatosDaFrase> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const { indice, roteiro } = abrirParaCenas(r)
  const frases = frasesDoRoteiro(roteiro)
  const i = frases.findIndex((f) => f.id === fraseId)
  if (i < 0) throw new Error('Essa frase nao esta mais no roteiro.')
  const cenas = cenasDoRascunho(r)
  const escolha = escolhaDaFrase(cenas, fraseId)
  const todos = prepararPlanos(indice)
  const janela = janelasDasFrases(frases, r.eventos, indice, todos)[i]!

  let sugestoes: CandidatoDeCena[] = escolha?.fita ?? []
  // (4a rodada) So le (a grade): o comeco ruim de cada plano, para a entrada da grade tambem pular o efeito.
  const imagem = await sinaisDaImagem(rascunhoId, indice, true)
  const divisao = divisaoDaConfig(configDoRecap().cenas)
  const minimo = minimoNaTela(divisao.minimoSec)
  if (!escolha) {
    const fixas = new Map(cenas.escolhas.map((e): [string, EscolhaDaFrase] => [e.fraseId, e]))
    const abremEscuro = await planosQueAbremEscuro(indice)
    const leitura = await leituraDosPlanos(indice)
    const rostos = await largurasDosRostos(indice)
    const { sinais, camadas } = await sinaisParaOCasar(rascunhoId, true)
    const { casadas } = casarFrases({
      indice,
      eventos: r.eventos,
      frases,
      take: takeAtual(r),
      fixas,
      refazer: new Set([fraseId]),
      abremEscuro,
      sinais,
      camadas,
      divisao,
      leitura,
      rostos,
      imagem,
      abrem: frasesQueAbrem(roteiro),
    })
    sugestoes = casadas[0]?.escolha.fita ?? []
  }
  const naFita = new Set(sugestoes.flatMap((c) => c.planoIds))
  const falaDaCue = new Map(indice.cues.map((c) => [c.id, c.texto]))
  const visiveis = todos.filter((p) => p.util !== null)

  // "Perto deste momento": em volta do plano pedido, ou do instante da frase.
  let centro = filtros.vizinhasDe ? visiveis.findIndex((p) => p.plano.id === filtros.vizinhasDe) : -1
  const t = janela.ancora
  if (centro < 0 && t !== null && visiveis.length > 0) {
    let melhor = 0
    let menor = Infinity
    for (const [k, p] of visiveis.entries()) {
      const d = t < p.plano.start ? p.plano.start - t : t > p.plano.end ? t - p.plano.end : 0
      if (d < menor) {
        menor = d
        melhor = k
      }
    }
    centro = melhor
  }
  const vizinhas =
    centro < 0
      ? []
      : visiveis
          .slice(Math.max(0, centro - VIZINHAS_DE_CADA_LADO), centro + VIZINHAS_DE_CADA_LADO + 1)
          .filter((p) => !naFita.has(p.plano.id) && passaNoFiltro(p, filtros, falaDaCue))
          .map((p) => candidatoDoPlano(p, indice.id, 'vizinha', ondeFica(p, t), entradaDepoisDoEfeito(p, imagem.abremRuim, minimo)))
  const vistos = new Set(vizinhas.map((c) => c.planoIds[0]))
  const outras = visiveis
    .filter((p) => !naFita.has(p.plano.id) && !vistos.has(p.plano.id) && passaNoFiltro(p, filtros, falaDaCue))
    .map((p) => candidatoDoPlano(p, indice.id, 'busca', [], entradaDepoisDoEfeito(p, imagem.abremRuim, minimo)))
  return {
    fraseId,
    sugestoes,
    vizinhas,
    outras,
    personagens: personagensDoEpisodio(indice, todos),
    // Frase sem evento: o contrato diz null (a janela dela e emprestada da vizinha).
    momento: janela.herdada ? null : t,
  }
}

/** Grava as escolhas da tela (a do mesmo fraseId e trocada; ordem do roteiro). */
export async function salvarCenas(rascunhoId: string, escolhas: readonly EscolhaDaFrase[]): Promise<CenasGravadas> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const roteiro = roteiroAtual(r)
  if (!roteiro) throw new Error('Nao ha roteiro.')
  const ids = new Set(frasesDoRoteiro(roteiro).map((f) => f.id))
  const fora = escolhas.filter((e) => !ids.has(e.fraseId)).map((e) => e.fraseId)
  if (fora.length > 0) throw new Error(`Frase(s) fora do roteiro: ${fora.join(', ')}.`)
  const quando = agora()
  const novo: RascunhoDoRecap = { ...r, cenas: aplicarEscolhas(cenasDoRascunho(r), escolhas, roteiro), atualizadoEm: quando }
  gravarRascunho(novo)
  return { rascunho: novo, avisos: [] }
}
