import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { modeloEleven, velocidadeNativaEnviada, type ConfigEleven, type ConfigFish } from '../../shared/voz'
import type { ErroOuvido } from './erros'
import type { AlinhamentoDeCaracteres } from './palavras'
import { pastaDaVoz, pastaDoCacheDaVoz } from './pastas'
import { sha256 } from './wav'

/**
 * O CACHE DO PROVEDOR: nunca pagar duas vezes pela mesma coisa.
 *
 * <userData>/recaps/cache/voz/<chave>.wav  os bytes que o provedor mandou
 *                            /<chave>.json o resto (alignment, normalized_alignment,
 *                                          request-id, character-cost)
 *
 * A chave e sha256 de { fonte, voiceId, modelId, settings ENVIADOS, texto,
 * contexto, formato } -- tudo o que muda o audio que volta. A velocidade
 * NATIVA (speed do provedor) entra SO quando nao e 1: a chave de quem gerou a
 * 1.0 fica identica a de antes do campo, e o cache pago antigo continua
 * valendo. O "acelerar" e o corte de pausa ficam fora (sao pos, de graca). Era
 * o defeito do AniRecap: a chave dele nao tinha os voice settings.
 *
 * VARIANTE. "Gerar tudo de novo" e "Regravar esta frase" sao pedidos de uma
 * leitura NOVA do mesmo texto: devolver o mesmo audio do cache faria o botao
 * nao fazer nada. Entao a chave ganha um numero de variante (0 = a chave do
 * contrato, sem campo extra) e cada rascunho guarda as chaves que ja OUVIU
 * (recaps/<id>/voz/ouvidos.json). Um pedido explicito usa a primeira variante
 * que este rascunho ainda nao ouviu: se ela ja esta no cache (gerada por outro
 * rascunho, ou paga e perdida num fechamento no meio) sai de graca; senao, paga
 * uma nova. Frase que so MUDOU de texto usa sempre a variante 0 -- voltar um
 * texto para o que ja foi gerado nao paga de novo.
 *
 * O cache e compartilhado entre rascunhos: o mesmo texto na mesma voz e o mesmo
 * audio. Os arquivos nunca sao reescritos (temporario + rename; o .json por
 * ultimo marca a entrada como completa).
 */

export type ConfigPaga = ConfigEleven | ConfigFish

/** O que muda o audio do provedor (o corpo do pedido sem a chave). */
export interface PedidoDeVoz {
  config: ConfigPaga
  /** O `text`: o roteiro inteiro (textoParaNarrar) ou uma frase (textoFalado). */
  texto: string
  /** previous_text / next_text (vazio = nao manda). O Fish nao tem: fica vazio. */
  contexto: { anterior: string; seguinte: string }
}

export interface MetaDoCache {
  versao: 1
  fonte: 'elevenlabs' | 'fish'
  /** O modelo pedido (so nas entradas gravadas depois de 14/10: as de antes nao tem). */
  modelId?: string
  formato: string
  requestId: string | null
  /** Cabecalho character-cost do ElevenLabs (o que de fato foi cobrado). null = nao veio. */
  custo: number | null
  caracteres: number
  alignment: AlinhamentoDeCaracteres | null
  normalized_alignment: AlinhamentoDeCaracteres | null
  criadoEm: string
}

/**
 * Os voice settings como vao no corpo do pedido. O style so vai quando o modelo
 * aceita (o eleven_v4 nao tem): fora do corpo, fora da chave -- mexer no style
 * de um v4 nao paga de novo pelo mesmo audio.
 */
export function settingsEnviados(config: ConfigPaga): Record<string, number | boolean> {
  if (config.fonte === 'elevenlabs') {
    const s = config.settings
    const corpo: Record<string, number | boolean> = {
      stability: s.stability,
      similarity_boost: s.similarityBoost,
      use_speaker_boost: s.speakerBoost,
    }
    if (modeloEleven(config.modelId).estilo) corpo['style'] = s.style
    return corpo
  }
  return { temperature: config.settings.temperature, top_p: config.settings.topP }
}

function emOrdem(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(emOrdem)
  if (typeof x !== 'object' || x === null) return x
  const obj = x as Record<string, unknown>
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, emOrdem(obj[k])]))
}

export function chaveDoCache(pedido: PedidoDeVoz, formato: string, variante: number): string {
  const base: Record<string, unknown> = {
    fonte: pedido.config.fonte,
    voiceId: pedido.config.voiceId,
    modelId: pedido.config.modelId,
    settings: settingsEnviados(pedido.config),
    texto: pedido.texto.normalize('NFC'),
    contexto: { anterior: pedido.contexto.anterior, seguinte: pedido.contexto.seguinte },
    formato,
  }
  if (variante > 0) base['variante'] = variante
  // So fora do 1: a chave da 1.0 e byte a byte a de antes (v-voz-velocidade.ts confere o hash antigo).
  const nativa = velocidadeNativaEnviada(pedido.config)
  if (nativa !== 1) base['velocidadeNativa'] = nativa
  return sha256(JSON.stringify(emOrdem(base)))
}

const CHAVE_VALIDA = /^[0-9a-f]{64}$/

function arquivos(chave: string): { wav: string; json: string } {
  if (!CHAVE_VALIDA.test(chave)) throw new Error('Chave de cache invalida.')
  const pasta = pastaDoCacheDaVoz()
  return { wav: join(pasta, `${chave}.wav`), json: join(pasta, `${chave}.json`) }
}

export function estaNoCache(chave: string): boolean {
  const a = arquivos(chave)
  return existsSync(a.json) && existsSync(a.wav)
}

export function lerDoCache(chave: string): { bytes: Buffer; meta: MetaDoCache } | null {
  if (!estaNoCache(chave)) return null
  const a = arquivos(chave)
  try {
    const meta = JSON.parse(readFileSync(a.json, 'utf8')) as MetaDoCache
    if (meta.versao !== 1) return null
    return { bytes: readFileSync(a.wav), meta }
  } catch {
    return null
  }
}

function gravarAtomico(caminho: string, dados: Buffer | string): void {
  mkdirSync(join(caminho, '..'), { recursive: true })
  const temp = `${caminho}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temp, dados)
    renameSync(temp, caminho)
  } finally {
    rmSync(temp, { force: true })
  }
}

/** Grava a resposta paga. Chamado ASSIM que ela chega, antes de qualquer outra coisa. */
export function gravarNoCache(chave: string, bytes: Buffer, meta: MetaDoCache): void {
  const a = arquivos(chave)
  if (estaNoCache(chave)) return
  gravarAtomico(a.wav, bytes)
  gravarAtomico(a.json, JSON.stringify(meta))
}

// ------------------------------------------------------------ ouvidos

function arquivoDosOuvidos(rascunhoId: string): string {
  return join(pastaDaVoz(rascunhoId), 'ouvidos.json')
}

/** As chaves de cache que este rascunho ja usou num take. */
export function lerOuvidos(rascunhoId: string): Set<string> {
  try {
    const cru = JSON.parse(readFileSync(arquivoDosOuvidos(rascunhoId), 'utf8')) as unknown
    return new Set(Array.isArray(cru) ? cru.filter((c): c is string => typeof c === 'string' && CHAVE_VALIDA.test(c)) : [])
  } catch {
    return new Set()
  }
}

export function marcarOuvidos(rascunhoId: string, chaves: readonly string[]): void {
  if (chaves.length === 0) return
  const ouvidos = lerOuvidos(rascunhoId)
  const antes = ouvidos.size
  for (const c of chaves) ouvidos.add(c)
  if (ouvidos.size !== antes) gravarAtomico(arquivoDosOuvidos(rascunhoId), JSON.stringify([...ouvidos]))
}

// ------------------------------------------------------------ plano

/** O que um pedido vai fazer: qual chave, qual formato pedir, e se ja esta pago. */
export interface PlanoDoPedido {
  pedido: PedidoDeVoz
  variante: number
  /** A chave que vale agora: a do cache quando `doCache`, senao a do formato a pedir. */
  chave: string
  /** O formato a pedir (ou o que esta no cache). */
  formato: string
  doCache: boolean
}

/**
 * Escolhe variante e formato. `formatos` em ordem de preferencia: o primeiro e
 * o que se pede; todos valem como acerto no cache (o wav_24000 de quando o
 * plano recusou 44,1 kHz continua valendo).
 */
export function planejarPedido(
  pedido: PedidoDeVoz,
  formatos: readonly string[],
  opcoes: { explicito: boolean; ouvidos: ReadonlySet<string> },
): PlanoDoPedido {
  const pedir = formatos[0]!
  // Teto de seguranca: nenhum texto tem mil leituras guardadas.
  for (let variante = 0; variante < 1000; variante++) {
    const achada = formatos.map((f) => ({ f, chave: chaveDoCache(pedido, f, variante) })).find((x) => estaNoCache(x.chave))
    if (!achada) return { pedido, variante, chave: chaveDoCache(pedido, pedir, variante), formato: pedir, doCache: false }
    if (!opcoes.explicito || !opcoes.ouvidos.has(achada.chave)) {
      return { pedido, variante, chave: achada.chave, formato: achada.f, doCache: true }
    }
  }
  throw new Error('Leituras demais deste texto no cache.')
}

// ------------------------------------------------------- audio importado

/** O alinhamento de um audio importado, guardado para nao rodar o Whisper de novo. */
export interface AlinhamentoGuardado {
  versao: 1
  palavras: { texto: string; start: number; end: number; fraseId: string }[]
  ancoradas: number
  total: number
  score: number | null
  avisos: string[]
  /** A fala fora do roteiro com o tempo do wav2vec2 (V1). */
  erros: ErroOuvido[]
}

export function chaveDoImportado(hashDoAudio: string, frases: readonly { fraseId: string; texto: string }[]): string {
  // alinhador 2: as palavras vao ao wav2vec2 sem pontuacao (alinhamento.ts). Os alinhamentos da versao 1 tinham a ultima palavra da frase esticada por cima da pausa e nao valem mais.
  // alinhador 3 (V1): o Whisper procura a fala fora do roteiro e, com ela, o wav2vec2 alinha a sequencia falada.
  // alinhador 4 (B1): audio sem um pedaco do roteiro e recusado (falta-no-audio.ts); um aceito antes disso confere de novo.
  return sha256(JSON.stringify({ fonte: 'importado', audio: hashDoAudio, frases: frases.map((f) => [f.fraseId, f.texto]), alinhador: 4 }))
}

export function lerAlinhamentoGuardado(chave: string): AlinhamentoGuardado | null {
  const a = arquivos(chave)
  try {
    const cru = JSON.parse(readFileSync(a.json, 'utf8')) as AlinhamentoGuardado
    return cru.versao === 1 && Array.isArray(cru.palavras) ? { ...cru, erros: Array.isArray(cru.erros) ? cru.erros : [] } : null
  } catch {
    return null
  }
}

export function guardarAlinhamento(chave: string, dados: AlinhamentoGuardado): void {
  gravarAtomico(arquivos(chave).json, JSON.stringify(dados))
}
