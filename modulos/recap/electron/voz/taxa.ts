import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { modeloEleven } from '../../shared/voz'
import type { ConfigPaga, MetaDoCache } from './cache'
import { pastaDoCacheDaVoz } from './pastas'

/**
 * A TAXA DA CONTA: quantos creditos o provedor cobra de fato por caractere de
 * texto, aprendida do cabecalho `character-cost` do ElevenLabs.
 *
 * A estimativa mostrava "~1.034 caracteres · restam 9.745", mas o "restam" e em
 * creditos do plano e a conta payg do Levi cobrou 227 pelo take de 1.034
 * caracteres (~0,22 por caractere): as unidades se misturavam e o custo parecia
 * 4,5 vezes maior. A conta conservadora (1 credito por caractere) continua
 * sendo o `confirmado`; esta taxa so diz, na tela, quanto deve sair de fato.
 *
 * <userData>/recaps/cache/voz/taxas.json:
 *   "elevenlabs:<modelId>"  creditos por caractere daquele modelo (o melhor);
 *   "elevenlabs:*"          o FATOR da conta: cobrado / (caracteres x a taxa
 *                           nominal do modelo, modeloEleven) -- vale para um
 *                           modelo que ainda nao foi pago (Flash = metade).
 * Sem o arquivo (cache de antes disto), o fator sai das respostas pagas que ja
 * estao no cache (o .json de cada uma guarda o character-cost); as gravadas
 * antes de 14/10 nao dizem o modelo e contam como nominal 1 (era o
 * multilingual_v2).
 */

interface TaxaGuardada {
  creditosPorCaractere: number
  quando: string
}

const DA_CONTA = 'elevenlabs:*'

function arquivo(): string {
  return join(pastaDoCacheDaVoz(), 'taxas.json')
}

function chave(config: Pick<ConfigPaga, 'fonte' | 'modelId'>): string {
  return `${config.fonte}:${config.modelId}`
}

function lerTaxas(): Record<string, TaxaGuardada> {
  try {
    const cru = JSON.parse(readFileSync(arquivo(), 'utf8')) as unknown
    return typeof cru === 'object' && cru !== null ? (cru as Record<string, TaxaGuardada>) : {}
  } catch {
    return {}
  }
}

function gravarTaxas(taxas: Record<string, TaxaGuardada>): void {
  try {
    writeFileSync(arquivo(), JSON.stringify(taxas))
  } catch {
    /* so a tela perde a conta aproximada */
  }
}

/** Taxa plausivel: positiva e no maximo 2 por caractere (nada no ElevenLabs passa de 1). */
function valida(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 2
}

const arredondar = (x: number): number => Math.round(x * 10_000) / 10_000

/** Guarda a taxa de uma chamada paga que trouxe o character-cost. Falhar aqui nunca derruba a voz. */
export function aprenderTaxa(config: Pick<ConfigPaga, 'fonte' | 'modelId'>, caracteres: number, custo: number | null): void {
  if (config.fonte !== 'elevenlabs' || custo === null || caracteres <= 0) return
  const taxa = custo / caracteres
  if (!valida(taxa)) return
  const quando = new Date().toISOString()
  const taxas = lerTaxas()
  taxas[chave(config)] = { creditosPorCaractere: arredondar(taxa), quando }
  taxas[DA_CONTA] = { creditosPorCaractere: arredondar(taxa / modeloEleven(config.modelId).creditosPorCaractere), quando }
  gravarTaxas(taxas)
}

/** O fator da conta pelas respostas pagas que ja estao no cache (a mais nova). null = nenhuma trouxe character-cost. */
function fatorPeloCache(): number | null {
  let melhor: { fator: number; quando: string } | null = null
  let nomes: string[] = []
  try {
    nomes = readdirSync(pastaDoCacheDaVoz()).filter((n) => /^[0-9a-f]{64}\.json$/.test(n))
  } catch {
    return null
  }
  for (const n of nomes) {
    try {
      const m = JSON.parse(readFileSync(join(pastaDoCacheDaVoz(), n), 'utf8')) as Partial<MetaDoCache>
      if (m.fonte !== 'elevenlabs' || typeof m.custo !== 'number' || typeof m.caracteres !== 'number' || m.caracteres <= 0) continue
      const nominal = typeof m.modelId === 'string' ? modeloEleven(m.modelId).creditosPorCaractere : 1
      const fator = m.custo / (m.caracteres * nominal)
      const quando = typeof m.criadoEm === 'string' ? m.criadoEm : ''
      if (valida(fator) && (!melhor || quando > melhor.quando)) melhor = { fator, quando }
    } catch {
      /* uma entrada ilegivel nao derruba a estimativa */
    }
  }
  if (!melhor) return null
  const taxas = lerTaxas()
  taxas[DA_CONTA] = { creditosPorCaractere: arredondar(melhor.fator), quando: melhor.quando || new Date().toISOString() }
  gravarTaxas(taxas)
  return melhor.fator
}

/** A taxa de fato desta fonte/modelo. null = ainda nao se sabe (a tela mostra so os caracteres). */
export function taxaAprendida(config: Pick<ConfigPaga, 'fonte' | 'modelId'>): number | null {
  // O Fish cobra em dolar e nao manda character-cost: la vale o saldo, nao credito.
  if (config.fonte !== 'elevenlabs') return null
  const taxas = lerTaxas()
  const doModelo = taxas[chave(config)]?.creditosPorCaractere
  if (valida(doModelo)) return doModelo
  const fator = taxas[DA_CONTA]?.creditosPorCaractere ?? fatorPeloCache()
  return valida(fator) ? fator * modeloEleven(config.modelId).creditosPorCaractere : null
}
