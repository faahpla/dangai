import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  chaveDaVozDoRitmo,
  chaveDoRitmo,
  medidaPlausivel,
  ritmoDaConfig,
  type MedidaDoRitmo,
  type RitmoDaVoz,
  type RitmosGuardados,
} from '../../shared/ritmo'
import { lerRascunho, type RascunhoDoRecap } from '../../shared/roteiro'
import { configPadrao, takeAtual, velocidadeNativaEnviada, type ConfigDaVoz, type TakeDaVoz } from '../../shared/voz'
import { gravarJsonAtomico } from '../episodio/perfil'
import { lerRascunhoDoDisco, pastaDosRascunhos } from '../gerar/rascunho'
import { getSettings } from '../settings'

/**
 * O RITMO APRENDIDO (shared/ritmo.ts): cada take com o corte de pausas vira
 * uma medida (palavras do roteiro / duracao do arquivo final), guardada em
 * <userData>/recaps/ritmos.json. O roteiro seguinte mira o alvo no ritmo que a
 * voz DE FATO teve, e nao no 2,7 fixo.
 *
 * Sem o arquivo (perfil de antes disto), as medidas saem dos takes que ja
 * estao nos rascunhos (so leitura): o take real do Levi a 1,0 ja calibra a voz
 * dele no primeiro roteiro.
 *
 * Nunca derruba nada: ler quebrado = sem medidas; gravar falhou = so o ritmo
 * fica no inicial.
 */

/** Medidas guardadas no total (as mais velhas saem). */
const MEDIDAS_MAX = 60
/** Rascunhos lidos para semear o arquivo (os mais novos). */
const RASCUNHOS_PARA_SEMEAR = 40

function arquivo(): string {
  return join(pastaDosRascunhos(), 'ritmos.json')
}

function medidaValida(x: unknown): x is MedidaDoRitmo {
  if (typeof x !== 'object' || x === null) return false
  const m = x as Record<string, unknown>
  const numero = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
  return (
    typeof m['chave'] === 'string' &&
    typeof m['voz'] === 'string' &&
    typeof m['arquivo'] === 'string' &&
    typeof m['quando'] === 'string' &&
    numero(m['nativa']) &&
    numero(m['acelerar']) &&
    numero(m['palavras']) &&
    numero(m['duracao']) &&
    medidaPlausivel(m['palavras'] as number, m['duracao'] as number)
  )
}

/** A medida de um take. null = nao conta (sem corte de pausa, sem palavra, ritmo absurdo). */
export function medidaDoTake(take: Pick<TakeDaVoz, 'config' | 'palavras' | 'duracao' | 'arquivo' | 'criadoEm'>): MedidaDoRitmo | null {
  // So o take com o corte de pausas mede o ritmo de verdade (e o padrao, e o que o Levi usa).
  if (!take.config.cortarPausas) return null
  const palavras = take.palavras.length
  if (!medidaPlausivel(palavras, take.duracao)) return null
  return {
    chave: chaveDoRitmo(take.config),
    voz: chaveDaVozDoRitmo(take.config),
    nativa: velocidadeNativaEnviada(take.config),
    acelerar: take.config.velocidade,
    palavras,
    duracao: take.duracao,
    arquivo: take.arquivo,
    quando: take.criadoEm,
  }
}

/** Os takes que ja estao nos rascunhos, do mais velho para o mais novo (so leitura). */
function medidasDosRascunhos(): MedidaDoRitmo[] {
  const pasta = pastaDosRascunhos()
  if (!existsSync(pasta)) return []
  const lidos: RascunhoDoRecap[] = []
  let nomes: string[]
  try {
    nomes = readdirSync(pasta).filter((n) => n.endsWith('.json') && n.startsWith('rc_'))
  } catch {
    return []
  }
  for (const nome of nomes) {
    try {
      lidos.push(lerRascunho(JSON.parse(readFileSync(join(pasta, nome), 'utf8'))))
    } catch {
      /* rascunho quebrado nao semeia */
    }
  }
  const medidas = lidos
    .sort((a, b) => a.atualizadoEm.localeCompare(b.atualizadoEm))
    .slice(-RASCUNHOS_PARA_SEMEAR)
    .flatMap((r) => (r.voz?.takes ?? []).map(medidaDoTake))
    .filter((m): m is MedidaDoRitmo => m !== null)
    .sort((a, b) => a.quando.localeCompare(b.quando))
  return semRepetir(medidas)
}

/** O mesmo arquivo de narracao (dois rascunhos com o mesmo audio do cache) conta uma vez. */
function semRepetir(medidas: readonly MedidaDoRitmo[]): MedidaDoRitmo[] {
  const vistos = new Set<string>()
  const saida: MedidaDoRitmo[] = []
  for (const m of medidas) {
    if (vistos.has(m.arquivo)) continue
    vistos.add(m.arquivo)
    saida.push(m)
  }
  return saida.slice(-MEDIDAS_MAX)
}

/** As medidas guardadas (semeadas pelos rascunhos na primeira vez). */
export function lerMedidas(): MedidaDoRitmo[] {
  try {
    const cru = JSON.parse(readFileSync(arquivo(), 'utf8')) as Partial<RitmosGuardados>
    if (cru.versao === 1 && Array.isArray(cru.medidas)) return cru.medidas.filter(medidaValida)
  } catch {
    /* sem arquivo (ou quebrado): semeia abaixo */
  }
  const semeadas = medidasDosRascunhos()
  gravar(semeadas)
  return semeadas
}

function gravar(medidas: readonly MedidaDoRitmo[]): void {
  try {
    const dados: RitmosGuardados = { versao: 1, medidas: [...medidas] }
    gravarJsonAtomico(arquivo(), dados)
  } catch {
    /* so o ritmo fica no inicial ate a proxima medida */
  }
}

/** Um take novo entrou no rascunho: a medida dele (o mesmo arquivo nao conta de novo). */
export function aprenderRitmo(take: TakeDaVoz): void {
  try {
    const m = medidaDoTake(take)
    if (!m) return
    const medidas = lerMedidas()
    if (medidas.some((x) => x.arquivo === m.arquivo)) return
    gravar(semRepetir([...medidas, m]))
  } catch {
    /* o take ja esta gravado: o ritmo e so a mira do proximo roteiro */
  }
}

/** O ritmo de uma config (ou de "sem voz"), pelas medidas guardadas. */
export function ritmoDe(config: ConfigDaVoz | null): RitmoDaVoz {
  return ritmoDaConfig(config, lerMedidas())
}

/**
 * A voz que vai narrar este rascunho: a do take atual; sem take, a voz padrao
 * das Configuracoes (na velocidade nativa do perfil, sem acelerar).
 */
export function configQueNarra(r: Pick<RascunhoDoRecap, 'voz'> | null): ConfigDaVoz | null {
  const take = r ? takeAtual(r) : null
  if (take) return take.config
  try {
    return configPadrao(getSettings().vozPadrao)
  } catch {
    // Sem Configuracoes (teste sem perfil): o ritmo de sem voz (o do audio importado).
    return null
  }
}

/** O ritmo do roteiro deste rascunho (o prompt, o minimo de 92% e o "~Xs" da tela). */
export function ritmoDoRascunho(r: Pick<RascunhoDoRecap, 'voz'> | null): RitmoDaVoz {
  return ritmoDe(configQueNarra(r))
}

/** O ritmoDaVoz do IPC: o rascunho pelo id (ja conferido por quem chama). null ou sumido = a voz padrao. */
export function ritmoPeloId(rascunhoId: string | null): RitmoDaVoz {
  if (rascunhoId === null) return ritmoDoRascunho(null)
  let r: RascunhoDoRecap | null = null
  try {
    r = lerRascunhoDoDisco(rascunhoId)
  } catch {
    r = null
  }
  return ritmoDoRascunho(r)
}
