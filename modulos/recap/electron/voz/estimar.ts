import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { roteiroAtual, type RascunhoDoRecap, type Roteiro } from '../../shared/roteiro'
import {
  caracteresDasFrases,
  contarCaracteres,
  contextoDaFrase,
  dolaresDoFish,
  frasesMudadas,
  frasesParaRegravar,
  modeloEleven,
  soMudaOPos,
  takeAtual,
  textoParaNarrar,
  vozDesatualizada,
  type ConfigDaVoz,
  type EstimativaDeCusto,
  type FraseParaNarrar,
  type PedidoDeEstimativa,
  type TakeDaVoz,
} from '../../shared/voz'
import { getSettings } from '../settings'
import { lerRascunhoDoDisco } from '../gerar/rascunho'
import { lerOuvidos, planejarPedido, type ConfigPaga, type PedidoDeVoz, type PlanoDoPedido } from './cache'
import { assinaturaEleven } from './eleven'
import { saldoFish } from './fish'
import { restamDescontado } from './saldo'
import { arquivoDaVoz } from './pastas'
import { creditosPorCaractere, esperaDaVozFalsa, formatosDoPedido } from './provedor'
import { taxaAprendida } from './taxa'
import { lerWav } from './wav'

/**
 * ESTIMATIVA do passo 3: quanto custaria, SEM gastar nada.
 *
 * O PLANO (o que seria pedido, a que chave do cache, se ja esta pago) mora
 * aqui e e o MESMO que a geracao usa (gerar.ts chama planejarTudo /
 * planejarFrases de novo na hora): o custo mostrado e o cobrado nunca
 * divergem. A geracao recusa se o custo real passar do `confirmado`.
 *
 * O saldo vem de GET gratis (ElevenLabs /v1/user/subscription, Fish
 * /wallet/self/api-credit). Falhou = null, nunca erro: a estimativa do
 * texto vale mesmo sem internet. A chave sai do getSettings e nunca entra em
 * erro nem log.
 */

export function exigirRoteiroAprovado(r: RascunhoDoRecap): Roteiro {
  const roteiro = roteiroAtual(r)
  if (!r.aprovado || !roteiro) throw new Error('Aprove o roteiro antes da voz.')
  return roteiro
}

/** O plano do "Gerar voz" / "Gerar tudo de novo": o roteiro inteiro em UM pedido. */
export interface PlanoDoTudo {
  roteiro: Roteiro
  texto: string
  frases: FraseParaNarrar[]
  plano: PlanoDoPedido
  caracteres: number
  /** Caracteres pagos (0 = do cache). */
  pagos: number
  /** Bytes UTF-8 pagos: a unidade do preco do Fish. */
  bytesPagos: number
  aCobrar: number
}

export function planejarTudo(rascunhoId: string, r: RascunhoDoRecap, config: ConfigPaga): PlanoDoTudo {
  const roteiro = exigirRoteiroAprovado(r)
  const { texto, frases } = textoParaNarrar(roteiro)
  if (frases.length === 0) throw new Error('O roteiro esta sem frase para narrar.')
  const pedido: PedidoDeVoz = { config, texto, contexto: { anterior: '', seguinte: '' } }
  // Pedido explicito: uma leitura que este rascunho ainda nao ouviu (ver cache.ts).
  const plano = planejarPedido(pedido, formatosDoPedido(config), { explicito: true, ouvidos: lerOuvidos(rascunhoId) })
  const caracteres = contarCaracteres(texto)
  const pagos = plano.doCache ? 0 : caracteres
  const bytesPagos = plano.doCache ? 0 : Buffer.byteLength(texto, 'utf8')
  return { roteiro, texto, frases, plano, caracteres, pagos, bytesPagos, aCobrar: pagos * creditosPorCaractere(config) }
}

/** O plano do "Regravar esta frase" / "Atualizar a voz", sobre o take atual. */
export interface PlanoDasFrases {
  roteiro: Roteiro
  take: TakeDaVoz
  config: ConfigPaga
  /** As frases a GERAR, na ordem do roteiro (frasesParaRegravar). */
  gerar: string[]
  planos: Map<string, PlanoDoPedido>
  /** A taxa do bruto do take: o pedaco novo tem que vir nela. */
  taxa: number
  caracteres: number
  /** Caracteres pagos: fora do cache, e cada chave paga uma vez so. */
  pagos: number
  /** Bytes UTF-8 pagos: a unidade do preco do Fish. */
  bytesPagos: number
  aCobrar: number
}

/** A taxa do WAV do bruto (le so o cabecalho). */
function taxaDoBruto(rascunhoId: string, take: TakeDaVoz): number {
  const caminho = arquivoDaVoz(rascunhoId, take.bruto.arquivo)
  if (!existsSync(caminho)) throw new Error('O audio deste take sumiu do disco. Gere de novo.')
  const fd = openSync(caminho, 'r')
  try {
    const cabeca = Buffer.alloc(4096)
    const lidos = readSync(fd, cabeca, 0, cabeca.length, 0)
    const pcm = lerWav(cabeca.subarray(0, lidos))
    if (!pcm) throw new Error('O audio do take nao e um WAV que o Studio le.')
    return pcm.taxa
  } finally {
    closeSync(fd)
  }
}

export function planejarFrases(rascunhoId: string, r: RascunhoDoRecap, pedidas: readonly string[]): PlanoDasFrases {
  const roteiro = exigirRoteiroAprovado(r)
  const take = takeAtual(r)
  if (!take) throw new Error('Gere a voz antes de regravar uma frase.')
  if (take.config.fonte === 'importado') throw new Error('Audio importado: grave de novo e importe.')
  const config = take.config
  const gerar = frasesParaRegravar(roteiro, take, pedidas)
  const frases = new Map(textoParaNarrar(roteiro).frases.map((f) => [f.fraseId, f]))
  const taxa = taxaDoBruto(rascunhoId, take)
  const formatos = formatosDoPedido(config, taxa)
  const ouvidos = lerOuvidos(rascunhoId)
  const explicitas = new Set(pedidas)
  const planos = new Map<string, PlanoDoPedido>()
  /*
   * Cada CHAVE paga uma vez so. No Fish o contexto vai vazio: duas frases com o
   * mesmo texto ("E isso e ciencia!") sao a mesma leitura e a mesma chave -- a
   * conta soma uma vez, e o regravarFrases reaproveita o audio da primeira.
   */
  const pagas = new Set<string>()
  let pagos = 0
  let bytesPagos = 0
  for (const id of gerar) {
    const f = frases.get(id)!
    // O Fish nao tem previous_text: contexto vazio (e fora da chave do cache).
    const contexto = config.fonte === 'elevenlabs' ? contextoDaFrase(roteiro, id) : { anterior: '', seguinte: '' }
    const plano = planejarPedido({ config, texto: f.texto, contexto }, formatos, { explicito: explicitas.has(id), ouvidos })
    planos.set(id, plano)
    if (!plano.doCache && !pagas.has(plano.chave)) {
      pagas.add(plano.chave)
      pagos += contarCaracteres(f.texto)
      bytesPagos += Buffer.byteLength(f.texto, 'utf8')
    }
  }
  const aCobrar = pagos * creditosPorCaractere(config)
  return { roteiro, take, config, gerar, planos, taxa, caracteres: caracteresDasFrases(roteiro, gerar), pagos, bytesPagos, aCobrar }
}

function zerada(fonte: EstimativaDeCusto['fonte'], fraseIds: string[], caracteres: number): EstimativaDeCusto {
  return {
    fonte,
    fraseIds,
    caracteres,
    pagos: 0,
    aCobrar: 0,
    creditos: null,
    doCache: true,
    restam: null,
    limite: null,
    plano: null,
    saldo: null,
    dolares: null,
    suficiente: null,
    aviso: null,
  }
}

/**
 * O modo de teste da voz falsa (RECAP_TESTE_VOZ_FALSA) tambem nao le a conta:
 * uma assinatura e um saldo fixos, sem rede e sem chave.
 */
const ASSINATURA_DE_TESTE = { plano: 'teste', usados: 0, limite: 10_000, estica: false }
const SALDO_DE_TESTE = '7.51'

/** Um take deste rascunho com a mesma voz e o roteiro em dia: voltar para ele e de graca. */
function takeParecido(r: RascunhoDoRecap, roteiro: Roteiro, config: ConfigDaVoz): TakeDaVoz | null {
  const takes = r.voz?.takes ?? []
  for (let i = takes.length - 1; i >= 0; i--) {
    const t = takes[i]!
    if (soMudaOPos(t.config, config) && !vozDesatualizada(frasesMudadas(roteiro, t))) return t
  }
  return null
}

export async function estimarVoz(rascunhoId: string, pedido: PedidoDeEstimativa): Promise<EstimativaDeCusto> {
  const r = lerRascunhoDoDisco(rascunhoId)
  let config: ConfigPaga
  let fraseIds: string[]
  let caracteres: number
  let pagos: number
  let bytesPagos: number
  let aCobrar: number
  const avisos: string[] = []
  const falsa = esperaDaVozFalsa() !== null

  if (pedido.tipo === 'tudo') {
    if (pedido.config.fonte === 'importado') {
      const roteiro = exigirRoteiroAprovado(r)
      return zerada('importado', textoParaNarrar(roteiro).frases.map((f) => f.fraseId), 0)
    }
    config = pedido.config
    const p = planejarTudo(rascunhoId, r, config)
    fraseIds = p.frases.map((f) => f.fraseId)
    caracteres = p.caracteres
    pagos = p.pagos
    bytesPagos = p.bytesPagos
    aCobrar = p.aCobrar
    const limite = config.fonte === 'elevenlabs' ? modeloEleven(config.modelId).limite : null
    if (limite !== null && caracteres > limite) {
      avisos.push(`Passa do limite do modelo (${limite.toLocaleString('pt-BR')} caracteres por pedido).`)
    }
    /*
     * O aviso "volte para ele" so vale quando a tela esta em OUTRA voz (ou num
     * importado) e um take antigo ja tem esta. Na mesma voz do take atual o
     * "Gerar tudo de novo" e de proposito (uma leitura nova), e o aviso
     * mandava voltar para onde ele ja esta.
     */
    const atual = takeAtual(r)
    const naMesmaVoz = atual !== null && soMudaOPos(atual.config, config)
    const parecido = aCobrar > 0 && !naMesmaVoz ? takeParecido(r, p.roteiro, config) : null
    if (parecido) avisos.push(`Ja tem o take ${parecido.id} com esta voz: volte para ele em Takes, sem custo.`)
  } else {
    const p = planejarFrases(rascunhoId, r, pedido.fraseIds)
    config = p.config
    fraseIds = p.gerar
    caracteres = p.caracteres
    pagos = p.pagos
    bytesPagos = p.bytesPagos
    aCobrar = p.aCobrar
    if (p.gerar.length === 0 && !vozDesatualizada(frasesMudadas(p.roteiro, p.take))) {
      avisos.push('A voz ja esta em dia com o roteiro.')
    }
  }

  const taxa = taxaAprendida(config)
  const estimativa: EstimativaDeCusto = {
    fonte: config.fonte,
    fraseIds,
    caracteres,
    pagos,
    aCobrar,
    creditos: taxa !== null && aCobrar > 0 ? pagos * taxa : null,
    doCache: aCobrar === 0,
    restam: null,
    limite: null,
    plano: null,
    saldo: null,
    // O Fish cobra em dolar por byte do texto: o custo de fato, como os creditos do ElevenLabs.
    dolares: config.fonte === 'fish' && aCobrar > 0 ? dolaresDoFish(bytesPagos, config.modelId) : null,
    suficiente: null,
    aviso: null,
  }

  const s = getSettings()
  if (config.fonte === 'elevenlabs') {
    if (!s.elevenlabsApiKey && !falsa) avisos.push('Cole a chave do ElevenLabs em Configuracoes > Voz.')
    else if (aCobrar > 0) {
      const a = falsa ? ASSINATURA_DE_TESTE : await assinaturaEleven(s.elevenlabsApiKey)
      if (a) {
        estimativa.plano = a.plano
        estimativa.limite = a.limite
        // O que a conta diz, menos o que esta sessao ja gastou e ela ainda nao refletiu (saldo.ts).
        estimativa.restam = a.usados !== null && a.limite !== null ? restamDescontado(Math.max(0, a.limite - a.usados)) : null
        if (estimativa.restam !== null) {
          // Creditos contra creditos: a taxa aprendida quando ha, senao a conta conservadora.
          const precisa = estimativa.creditos ?? aCobrar
          estimativa.suficiente = estimativa.restam >= precisa || a.estica
          if (!estimativa.suficiente) {
            avisos.push(`Faltam creditos: restam ${estimativa.restam.toLocaleString('pt-BR')}, precisa de ~${Math.ceil(precisa).toLocaleString('pt-BR')}.`)
          } else if (estimativa.restam < precisa) {
            avisos.push('Passa do limite do plano: o ElevenLabs cobra a parte.')
          }
        }
      }
    }
  } else {
    if (!s.fishApiKey && !falsa) avisos.push('Cole a chave do Fish Audio em Configuracoes > Voz.')
    else if (aCobrar > 0) {
      estimativa.saldo = falsa ? SALDO_DE_TESTE : await saldoFish(s.fishApiKey)
      const saldo = estimativa.saldo !== null ? Number(estimativa.saldo) : Number.NaN
      if (Number.isFinite(saldo) && saldo <= 0) avisos.push('Sem saldo no Fish Audio: escolha o modelo "S2.1 Pro gratis" (sem custo) ou recarregue em fish.audio.')
    }
  }
  estimativa.aviso = avisos.join(' ') || null
  return estimativa
}
