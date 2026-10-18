import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contarCaracteres, modeloEleven, ROTULO_DA_FONTE } from '../../shared/voz'
import { getSettings } from '../settings'
import {
  chaveDoCache,
  gravarNoCache,
  lerDoCache,
  type ConfigPaga,
  type MetaDoCache,
  type PlanoDoPedido,
} from './cache'
import { ErroDoProvedor, FORMATOS_ELEVEN, sintetizarEleven, type RespostaDoProvedor } from './eleven'
import { decodificar } from './ffmpeg'
import { formatoFish, sintetizarFish } from './fish'
import type { AlinhamentoDeCaracteres } from './palavras'
import { pastaDoCacheDaVoz } from './pastas'
import { aprenderTaxa } from './taxa'
import { lerWav, wavDoPcm, type Pcm } from './wav'

/**
 * Um pedido de voz de ponta a ponta: cache -> provedor -> cache -> PCM.
 *
 * A resposta paga vai para o cache ANTES de qualquer outra coisa (decodificar,
 * alinhar, montar): se algo der errado depois, ou o app fechar, o que foi
 * pago esta guardado e o proximo pedido igual nao cobra.
 */

export interface VozDoProvedor {
  pcm: Pcm
  alignment: AlinhamentoDeCaracteres | null
  normalizado: AlinhamentoDeCaracteres | null
  requestId: string | null
  /** O formato que de fato veio ("wav_24000" quando o plano recusou 44,1 kHz). */
  formato: string
  /** A chave do cache desta voz (vai para ouvidos.json quando entra num take). */
  chave: string
  doCache: boolean
  /** Caracteres do `text` (o contexto nao conta). */
  caracteres: number
  /** character-cost do ElevenLabs quando veio (o cobrado de fato). */
  custo: number | null
  avisos: string[]
}

/** Creditos por caractere da config (Flash custa metade; Fish: 1 ate a doc dizer outra coisa). */
export function creditosPorCaractere(config: ConfigPaga): number {
  return config.fonte === 'elevenlabs' ? modeloEleven(config.modelId).creditosPorCaractere : 1
}

/**
 * TESTE (O2): RECAP_TESTE_VOZ_FALSA=<ms> troca o provedor pago por uma voz
 * FALSA, local: um tom baixo do tamanho do texto, com o alinhamento por
 * caractere, depois de <ms> de espera (o "no ar" de uma chamada de verdade).
 * Nunca chama a rede nem pede chave: e o teste de fechar o app no meio da voz
 * sem gastar credito. Sem a variavel, nada muda. null = desligada.
 */
export function esperaDaVozFalsa(): number | null {
  const v = process.env['RECAP_TESTE_VOZ_FALSA']
  if (!v) return null
  const ms = Number(v)
  return Number.isFinite(ms) && ms >= 0 ? ms : 0
}

/** A voz falsa do teste (ver esperaDaVozFalsa). ~16 caracteres por segundo, pausa nas pontuacoes. */
export async function sintetizarFalso(texto: string, formato: string, esperaMs: number, signal?: AbortSignal): Promise<RespostaDoProvedor> {
  await new Promise<void>((ok, falha) => {
    if (signal?.aborted) {
      falha(new Error('Cancelado'))
      return
    }
    const relogio = setTimeout(ok, esperaMs)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(relogio)
        falha(new Error('Cancelado'))
      },
      { once: true },
    )
  })
  const taxa = Number(/^wav_(\d+)$/.exec(formato)?.[1] ?? 44_100) || 44_100
  const letras = [...texto]
  const porLetra = 1 / 16
  const amostras = new Int16Array(Math.max(1, Math.round(letras.length * porLetra * taxa)))
  for (const [i, letra] of letras.entries()) {
    if (/[\s.,!?;:]/.test(letra)) continue
    const de = Math.round(i * porLetra * taxa)
    const ate = Math.min(amostras.length, Math.round((i + 1) * porLetra * taxa))
    for (let j = de; j < ate; j++) amostras[j] = Math.round(1200 * Math.sin((2 * Math.PI * 180 * j) / taxa))
  }
  return {
    bytes: wavDoPcm({ taxa, amostras }),
    formato,
    alignment: {
      characters: letras,
      character_start_times_seconds: letras.map((_, i) => i * porLetra),
      character_end_times_seconds: letras.map((_, i) => (i + 1) * porLetra),
    },
    normalizado: null,
    requestId: 'teste-voz-falsa',
    custo: null,
  }
}

/** A chave da API salva (cifrada) nas Configuracoes. Nunca vai para erro nem log. */
export function chaveDaApi(fonte: ConfigPaga['fonte']): string {
  if (esperaDaVozFalsa() !== null) return 'teste-voz-falsa'
  const s = getSettings()
  const chave = fonte === 'elevenlabs' ? s.elevenlabsApiKey : s.fishApiKey
  if (!chave) throw new Error(`Cole a chave do ${ROTULO_DA_FONTE[fonte]} em Configuracoes > Voz.`)
  return chave
}

// ---------------------------------------------- formato (44,1 kHz recusado)

const LEMBRAR_RECUSA_MS = 24 * 60 * 60 * 1000

function arquivoDosFormatos(): string {
  return join(pastaDoCacheDaVoz(), 'formatos.json')
}

function recusouWav44(): boolean {
  try {
    const cru = JSON.parse(readFileSync(arquivoDosFormatos(), 'utf8')) as { wav44Recusado?: unknown }
    const quando = typeof cru.wav44Recusado === 'string' ? Date.parse(cru.wav44Recusado) : Number.NaN
    return Number.isFinite(quando) && Date.now() - quando < LEMBRAR_RECUSA_MS
  } catch {
    return false
  }
}

function lembrarRecusa(): void {
  try {
    writeFileSync(arquivoDosFormatos(), JSON.stringify({ wav44Recusado: new Date().toISOString() }))
  } catch {
    /* so economiza um pedido recusado (gratis); nao vale derrubar a geracao */
  }
}

/**
 * Os formatos em ordem de preferencia. `taxa` = a do bruto que a frase
 * regravada vai emendar (o pedaco novo tem que ter a mesma taxa).
 */
export function formatosDoPedido(config: ConfigPaga, taxa?: number): string[] {
  if (config.fonte === 'fish') return [formatoFish(taxa ?? 44_100)]
  const todos: string[] = [...FORMATOS_ELEVEN]
  if (taxa) {
    const alvo = `wav_${taxa}`
    return todos.includes(alvo) ? [alvo, ...todos.filter((f) => f !== alvo)] : todos
  }
  return recusouWav44() ? ['wav_24000', 'wav_44100'] : todos
}

// ---------------------------------------------------------------- execucao

/** WAV do provedor -> PCM 16 bits mono na taxa pedida (ffmpeg so quando precisa). */
export async function pcmDosBytes(bytes: Buffer, taxa: number | null, signal?: AbortSignal): Promise<Pcm> {
  const direto = lerWav(bytes)
  if (direto && direto.amostras.length > 0 && (taxa === null || direto.taxa === taxa)) return direto
  const pasta = mkdtempSync(join(tmpdir(), 'anirecap-voz-'))
  try {
    const arquivo = join(pasta, 'voz.wav')
    writeFileSync(arquivo, bytes)
    return await decodificar(arquivo, taxa, signal)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

function sintetizar(chave: string, plano: PlanoDoPedido, formato: string, signal?: AbortSignal): Promise<RespostaDoProvedor> {
  const p = plano.pedido
  const falsa = esperaDaVozFalsa()
  if (falsa !== null) return sintetizarFalso(p.texto, formato, falsa, signal)
  if (p.config.fonte === 'elevenlabs') return sintetizarEleven(chave, { ...p, config: p.config }, formato, signal)
  return sintetizarFish(chave, { ...p, config: p.config }, formato, signal)
}

/**
 * Cumpre o plano (planejarPedido): do cache, ou UMA chamada paga (mais uma
 * recusada por formato, que nao cobra). `taxa` = a do PCM devolvido (null = a
 * que veio). O `signal` so vale ate a resposta paga chegar: depois dela, nada
 * mais e abortado aqui.
 */
export async function cumprirPlano(plano: PlanoDoPedido, taxa: number | null, signal?: AbortSignal): Promise<VozDoProvedor> {
  const caracteres = contarCaracteres(plano.pedido.texto)
  if (plano.doCache) {
    const lido = lerDoCache(plano.chave)
    if (!lido) throw new Error('A voz guardada sumiu do cache. Confira o custo de novo.')
    return {
      pcm: await pcmDosBytes(lido.bytes, taxa, signal),
      alignment: lido.meta.alignment,
      normalizado: lido.meta.normalized_alignment,
      requestId: lido.meta.requestId,
      formato: lido.meta.formato,
      chave: plano.chave,
      doCache: true,
      caracteres,
      custo: null,
      avisos: [],
    }
  }

  const chave = chaveDaApi(plano.pedido.config.fonte)
  const avisos: string[] = []
  const formatos = plano.pedido.config.fonte === 'elevenlabs'
    ? [plano.formato, ...FORMATOS_ELEVEN.filter((f) => f !== plano.formato)]
    : [plano.formato]
  let resposta: RespostaDoProvedor | null = null
  for (const [i, formato] of formatos.entries()) {
    try {
      resposta = await sintetizar(chave, plano, formato, signal)
      break
    } catch (err) {
      const ultimo = i === formatos.length - 1
      if (err instanceof ErroDoProvedor && err.formatoRecusado && !ultimo) {
        if (formato === 'wav_44100') lembrarRecusa()
        avisos.push(`${formato} recusado pelo plano: ${formatos[i + 1]}.`)
        continue
      }
      throw err
    }
  }
  if (!resposta) throw new Error('A voz nao veio.')

  const chaveReal = chaveDoCache(plano.pedido, resposta.formato, plano.variante)
  const meta: MetaDoCache = {
    versao: 1,
    fonte: plano.pedido.config.fonte,
    modelId: plano.pedido.config.modelId,
    formato: resposta.formato,
    requestId: resposta.requestId,
    custo: resposta.custo,
    caracteres,
    alignment: resposta.alignment,
    normalized_alignment: resposta.normalizado,
    criadoEm: new Date().toISOString(),
  }
  gravarNoCache(chaveReal, resposta.bytes, meta)
  if (resposta.custo !== null) {
    console.log(`[voz] ${plano.pedido.config.fonte}: ${caracteres} caracteres, character-cost ${resposta.custo}`)
    // A taxa da conta (creditos por caractere): a estimativa seguinte mostra o custo de fato.
    aprenderTaxa(plano.pedido.config, caracteres, resposta.custo)
  }
  return {
    // Ja pago: decodifica sem o signal (o take vai para o historico se cancelado).
    pcm: await pcmDosBytes(resposta.bytes, taxa),
    alignment: resposta.alignment,
    normalizado: resposta.normalizado,
    requestId: resposta.requestId,
    formato: resposta.formato,
    chave: chaveReal,
    doCache: false,
    caracteres,
    custo: resposta.custo,
    avisos,
  }
}
