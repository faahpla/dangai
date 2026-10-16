import { velocidadeNativaEnviada, type ConfigDaVoz } from './voz'

/**
 * O RITMO DA NARRACAO: palavras por segundo do take FINAL (com o corte de
 * pausas e o "acelerar"), por configuracao de voz. Substitui o 2,7 fixo
 * (PALAVRAS_POR_SEGUNDO, roteiro.ts) onde ele dizia quanto tempo um roteiro
 * dura: o prompt do Gemini (alvo, minimo de 92% e numero de frases), o aviso
 * "Curto/Longo" e o "~Xs" da tela do roteiro.
 *
 * Por que por voz: em 15/10 o Levi passou a gerar a voz NATIVA a 1,2 (o speed
 * do provedor), e o 1,2 encurta ~1,3x, nao 1,2x (as pausas encolhem junto). Um
 * roteiro escrito para 2,7 p/s narrado a ~3,8 p/s dava 43 s num short de 1 min.
 *
 * Duas partes:
 *   - o INICIAL (calibrado, sem nenhum take): RITMO_DO_TAKE_REAL x nativa^K x
 *     acelerar. O "acelerar" (atempo) encolhe o arquivo por exatamente v; a
 *     nativa, pela curva medida nas amostras;
 *   - o APRENDIDO dos takes reais (electron/services/voz/ritmo.ts, guardado em
 *     <userData>/recaps/ritmos.json): a mesma configuracao ja narrada vale o
 *     que mediu; so a mesma voz em outra velocidade vale o inicial corrigido
 *     pelo quanto essa voz fala mais rapido ou devagar que a calibracao.
 *
 * Este arquivo e puro (main e renderer): a tela recebe o numero pronto do main
 * (ritmoDaVoz), que e quem le o arquivo e as Configuracoes.
 */

/**
 * O take real do Levi (S4-37, 15/10): 170 palavras em 59,82 s, ElevenLabs
 * multilingual_v2, nativa 1,0, sem acelerar, com o corte de pausas.
 */
export const RITMO_DO_TAKE_REAL = 170 / 59.82

/**
 * A mesma frase (28 palavras) gerada nativa a 1,0 (10,17 s) e a 1,2 (7,76 s),
 * passada pelo corte de pausas do app (alinhador + cortesDasPausas): 9,730 s e
 * 7,355 s. O 1,2 encurta 1,323x.
 */
export const ENCURTA_A_NATIVA_1_2 = 9.73 / 7.355

/*
 * O ritmo muda com o TEXTO, nao so com a velocidade: a chamada real de 15/10
 * (gancho + contexto do S4-37, 40 palavras, nativa 1,2) deu 3,04 p/s, abaixo
 * dos ~3,76 do inicial. Por isso o inicial e so o ponto de partida: o primeiro
 * take de verdade de cada voz ja corrige a mira (ritmoDaConfig).
 */

/** O expoente da curva nativa^K que passa por (1; 1) e (1,2; 1,323). */
const EXPOENTE_DA_NATIVA = Math.log(ENCURTA_A_NATIVA_1_2) / Math.log(1.2)

/** Quantas medidas da mesma configuracao valem (as mais recentes). */
export const MEDIDAS_POR_CHAVE = 5

/*
 * So um take de ROTEIRO inteiro ensina o ritmo: um take curto (um teste, um
 * gancho solto) varia demais com o texto e, sozinho, valeria 100% da mira
 * (8 palavras em 1,4 s levavam 60 s a pedir 343 palavras). 20 s e 50 palavras
 * ficam abaixo do menor roteiro de verdade e acima de qualquer frase solta.
 */
export const MEDIDA_MIN_SEGUNDOS = 20
export const MEDIDA_MIN_PALAVRAS = 50

/*
 * E o ritmo aprendido nunca sai de uma faixa em volta do inicial daquela
 * velocidade: o caminho 'da-voz' multiplica um fator medido em OUTRA
 * velocidade, e sem teto um take estranho levava a mira a 20 ou a 1121
 * palavras por minuto de video. A faixa cobre a variacao real medida (a
 * chamada de 15/10 deu 0,81x do inicial) com folga.
 */
export const RITMO_MIN_DO_INICIAL = 0.75
export const RITMO_MAX_DO_INICIAL = 1.35
/** Quantas medidas da mesma VOZ entram no fator dela (outras velocidades). */
export const MEDIDAS_POR_VOZ = 8

/**
 * O ritmo calibrado de uma velocidade nativa e de um "acelerar", sem take
 * nenhum. 1,0/1,0 = 2,84 p/s; 1,2/1,0 = ~3,76 p/s (60 s ~ 226 palavras).
 */
export function ritmoInicial(nativa: number, acelerar: number): number {
  return RITMO_DO_TAKE_REAL * Math.pow(nativa, EXPOENTE_DA_NATIVA) * acelerar
}

/**
 * Sem voz nenhuma escolhida (nem take, nem voz padrao), a narracao vai ser o
 * audio importado (a voz do proprio Levi, sem velocidade nativa): o roteiro
 * mira o ritmo do importado, o aprendido dele ou o de 1,0 (2,84 p/s).
 */
const SEM_VOZ = { voz: 'importado', chave: 'importado|n1.00|a1.00' }

/** Um take medido: palavras do roteiro e a duracao do arquivo final. */
export interface MedidaDoRitmo {
  /** chaveDoRitmo da config do take. */
  chave: string
  /** chaveDaVozDoRitmo (fonte + voz + modelo): junta as velocidades. */
  voz: string
  nativa: number
  acelerar: number
  palavras: number
  duracao: number
  /** O WAV da narracao (enderecado por conteudo): o mesmo take nao conta duas vezes. */
  arquivo: string
  quando: string
}

export interface RitmosGuardados {
  versao: 1
  /** Da mais velha para a mais nova. */
  medidas: MedidaDoRitmo[]
}

/** A voz (sem velocidade): fonte, voz e modelo. O importado e a voz do proprio Levi. */
export function chaveDaVozDoRitmo(c: ConfigDaVoz): string {
  return c.fonte === 'importado' ? 'importado' : `${c.fonte}|${c.voiceId}|${c.modelId}`
}

/** A configuracao do ritmo: voz + velocidade nativa (a ENVIADA) + acelerar. O corte de pausa nao entra (so takes com corte sao medidos). */
export function chaveDoRitmo(c: ConfigDaVoz): string {
  return `${chaveDaVozDoRitmo(c)}|n${velocidadeNativaEnviada(c).toFixed(2)}|a${c.velocidade.toFixed(2)}`
}

/** De onde o numero saiu: a tela diz "medido" ou "estimado". */
export type OrigemDoRitmo = 'medido' | 'da-voz' | 'inicial'

/** O ritmo que a tela mostra (ritmoDaVoz). */
export interface RitmoDaVoz {
  /** Palavras por segundo do take final. */
  ritmo: number
  origem: OrigemDoRitmo
  /** Quantos takes reais entraram na conta (0 no inicial). */
  takes: number
  /** A config de que ele fala. null = sem voz escolhida (o ritmo do audio importado). */
  nativa: number | null
  acelerar: number | null
}

/**
 * O ritmo de uma config, pelas medidas guardadas:
 *   1. a MESMA configuracao ja medida: palavras / segundos das ultimas
 *      MEDIDAS_POR_CHAVE;
 *   2. a mesma voz em outra velocidade: o inicial desta velocidade x o quanto
 *      essa voz fala acima ou abaixo da calibracao (soma das palavras sobre a
 *      soma do que o inicial previa, nas ultimas MEDIDAS_POR_VOZ);
 *   3. o inicial.
 */
export function ritmoDaConfig(config: ConfigDaVoz | null, medidas: readonly MedidaDoRitmo[]): RitmoDaVoz {
  const nativa = config ? velocidadeNativaEnviada(config) : 1
  const acelerar = config ? config.velocidade : 1
  const base = config ? { nativa, acelerar } : { nativa: null, acelerar: null }
  const inicial = ritmoInicial(nativa, acelerar)
  const chave = config ? chaveDoRitmo(config) : SEM_VOZ.chave
  // Medida guardada antes destes limites (ritmos.json velho) tambem passa pelo filtro.
  const valem = medidas.filter((m) => medidaPlausivel(m.palavras, m.duracao))
  const iguais = valem.filter((m) => m.chave === chave).slice(-MEDIDAS_POR_CHAVE)
  if (iguais.length > 0) {
    const palavras = iguais.reduce((s, m) => s + m.palavras, 0)
    const segundos = iguais.reduce((s, m) => s + m.duracao, 0)
    return { ritmo: naFaixa(palavras / segundos, inicial), origem: 'medido', takes: iguais.length, ...base }
  }
  const voz = config ? chaveDaVozDoRitmo(config) : SEM_VOZ.voz
  const daVoz = valem.filter((m) => m.voz === voz).slice(-MEDIDAS_POR_VOZ)
  if (daVoz.length > 0) {
    const palavras = daVoz.reduce((s, m) => s + m.palavras, 0)
    const previstas = daVoz.reduce((s, m) => s + m.duracao * ritmoInicial(m.nativa, m.acelerar), 0)
    if (previstas > 0) return { ritmo: naFaixa(inicial * (palavras / previstas), inicial), origem: 'da-voz', takes: daVoz.length, ...base }
  }
  return { ritmo: inicial, origem: 'inicial', takes: 0, ...base }
}

/** O ritmo aprendido preso em volta do inicial daquela velocidade e entre 1 e 6 p/s. */
function naFaixa(ritmo: number, inicial: number): number {
  const min = Math.max(1, inicial * RITMO_MIN_DO_INICIAL)
  const max = Math.min(6, inicial * RITMO_MAX_DO_INICIAL)
  return Math.min(max, Math.max(min, ritmo))
}

/**
 * Ritmo plausivel para guardar: um take de roteiro inteiro (MEDIDA_MIN_*) e
 * entre 1 e 6 palavras por segundo.
 */
export function medidaPlausivel(palavras: number, duracao: number): boolean {
  if (!(palavras >= MEDIDA_MIN_PALAVRAS) || !(duracao >= MEDIDA_MIN_SEGUNDOS)) return false
  const r = palavras / duracao
  return r >= 1 && r <= 6
}

/** "3,8 palavras/s" para o tooltip. */
export function textoDoRitmo(r: Pick<RitmoDaVoz, 'ritmo'>): string {
  return `${(Math.round(r.ritmo * 10) / 10).toFixed(1).replace('.', ',')} palavras/s`
}
